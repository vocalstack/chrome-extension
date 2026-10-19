/** Live sessions, background half: it gets the tab's capture stream id
 *  (only the service worker may, right after the person invoked the
 *  extension on that tab), makes sure the offscreen document exists, and
 *  relays. Captions go to the frame of the tab that holds the main video.
 *  The toolbar badge says REC while anything records. */

import { push, RpcError, type Handlers, type Push } from '../lib/rpc';
import { currentEnv } from '../lib/env';
import { meetingOf, type LiveStart, type LiveStatus, type CaptionStyle } from '../lib/live';
import type { OffAnswer, OffCmd } from '../lib/offscreen';
import { showInPanel } from './panel';

const OFFSCREEN = 'offscreen.html';
let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  if (creating) return creating;
  const url = chrome.runtime.getURL(OFFSCREEN);
  const have = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (have.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN,
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Capture tab and microphone audio for transcription, and play dubbed audio.',
    })
    .finally(() => { creating = null; });
  await creating;
}

async function hasOffscreen(): Promise<boolean> {
  const have = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return have.length > 0;
}

export async function off<T = unknown>(cmd: OffCmd): Promise<{ value?: T; statuses?: LiveStatus[] }> {
  await ensureOffscreen();
  const a = (await chrome.runtime.sendMessage(cmd)) as OffAnswer | undefined;
  if (!a) throw new RpcError('The audio page did not answer.');
  if (!a.ok) throw new RpcError(a.error, a.code);
  return a as { value?: T; statuses?: LiveStatus[] };
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t?.id) throw new RpcError('There is no tab to use.');
  return t;
}

function capturable(url: string | undefined): boolean {
  return !!url && /^(https?|file):/.test(url) && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/.test(url);
}

/** The tab's capture stream id. Chrome grants it only after the person
 *  invoked the extension on the tab: the toolbar icon, a shortcut, a menu. */
async function streamIdFor(tab: chrome.tabs.Tab): Promise<string> {
  if (!capturable(tab.url)) throw new RpcError('Browser pages and the extension store cannot be captured.', 'tab_capture');
  try {
    return await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id! });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (/invoked|activeTab/i.test(m)) {
      throw new RpcError('Chrome lets VocalStack capture a tab only after you click the VocalStack icon on that tab. Click the icon in the toolbar, then start again.', 'invoke');
    }
    if (/active stream|already/i.test(m)) throw new RpcError('This tab is already being captured.', 'tab_busy');
    throw new RpcError(`The tab could not be captured: ${m}`, 'tab_capture');
  }
}

/** The frame with the largest visible video (captions and dubs go there), else the top. */
export async function videoFrame(tabId: number): Promise<number> {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) ?? [{ frameId: 0 }];
  let best = { frameId: 0, area: 0 };
  await Promise.all(frames.map(async (f) => {
    const r = (await chrome.tabs.sendMessage(tabId, { pick: true }, { frameId: f.frameId }).catch(() => null)) as { area?: number } | null;
    if (r?.area && r.area > best.area) best = { frameId: f.frameId, area: r.area };
  }));
  return best.frameId;
}

/** Where each running session's captions go. */
const captionTargets = new Map<string, { tabId: number; frameId: number }>();

function defaultName(start: LiveStart, tab: chrome.tabs.Tab | null): string {
  const when = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (start.name?.trim()) return start.name.trim();
  if (start.mode === 'meeting') return `${meetingOf(tab?.url) ?? 'Meeting'} · ${when}`;
  if (start.input.tab && tab?.title) return tab.title.slice(0, 120);
  return `Microphone · ${when}`;
}

export async function startLive(start: LiveStart, invokedTab?: chrome.tabs.Tab): Promise<LiveStatus> {
  const env = await currentEnv();
  let tab: chrome.tabs.Tab | null = null;
  if (start.input.tab || start.mode === 'captions') {
    tab = invokedTab ?? (start.tabId !== undefined ? await chrome.tabs.get(start.tabId) : await activeTab());
  }
  const streamId = tab && start.input.tab ? await streamIdFor(tab) : undefined;
  const id = crypto.randomUUID();
  if (start.mode === 'captions' && tab?.id !== undefined) {
    captionTargets.set(id, { tabId: tab.id, frameId: await videoFrame(tab.id) });
  }
  const cmd: OffCmd = { off: 'live.start', id, api: env.api, start: { ...start, tabId: tab?.id ?? start.tabId }, name: defaultName(start, tab), streamId, tabTitle: tab?.title };
  try {
    return (await off<LiveStatus>(cmd)).value!;
  } catch (e) {
    captionTargets.delete(id);
    throw e;
  }
}

/** Any session still capturing (the environment may not change under it). */
export async function anyRunning(): Promise<boolean> {
  return (await listLive().catch(() => [])).some((s) => !['done', 'failed'].includes(s.state));
}

async function listLive(): Promise<LiveStatus[]> {
  if (!(await hasOffscreen())) return [];
  return (await off({ off: 'live.list' })).statuses ?? [];
}

async function badge() {
  const all = await listLive().catch(() => []);
  const rec = all.some((s) => s.state === 'live' || s.state === 'warming' || s.state === 'starting');
  const paused = !rec && all.some((s) => s.state === 'paused');
  await chrome.action.setBadgeBackgroundColor({ color: paused ? '#f0b429' : '#f78472' });
  await chrome.action.setBadgeText({ text: rec ? 'REC' : paused ? 'II' : '' });
}

/** The captured tab is gone: its sessions end with it. */
async function stopForTab(tabId: number) {
  for (const s of await listLive().catch(() => [])) {
    if (s.tabId === tabId && s.input.tab && !['done', 'failed', 'stopping'].includes(s.state)) await off({ off: 'live.stop', id: s.id }).catch(() => {});
  }
}

async function captionsOn(tab: chrome.tabs.Tab) {
  const all = await listLive().catch(() => []);
  const running = all.find((s) => s.mode === 'captions' && s.tabId === tab.id && !['done', 'failed', 'stopping'].includes(s.state));
  if (running) { await off({ off: 'live.stop', id: running.id }); return; }
  const { captionLang } = await chrome.storage.local.get('captionLang');
  await startLive({ mode: 'captions', input: { tab: true, mic: false }, tabId: tab.id, translateTo: (captionLang as string) || null }, tab);
}

export function registerLive(): Handlers {
  chrome.runtime.onMessage.addListener((msg: Push) => {
    if (msg?.push === 'live.status') {
      void badge();
      if (['done', 'failed'].includes(msg.status.state)) {
        const t = captionTargets.get(msg.status.id);
        if (t) chrome.tabs.sendMessage(t.tabId, { caption: 'off', id: msg.status.id }, { frameId: t.frameId }).catch(() => {});
        captionTargets.delete(msg.status.id);
      }
    }
    if (msg?.push === 'live.event') {
      const t = captionTargets.get(msg.id);
      if (t) chrome.tabs.sendMessage(t.tabId, { caption: msg.event, id: msg.id }, { frameId: t.frameId }).catch(() => {});
    }
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => { void stopForTab(tabId); });
  chrome.commands.onCommand.addListener((command, tab) => {
    if (!tab?.id) return;
    // Inside the shortcut's gesture: open the panel first, then capture.
    void showInPanel({ view: 'live', tabId: tab.id }, tab.windowId);
    if (command === 'record-tab') void startLive({ mode: meetingOf(tab.url) ? 'meeting' : 'record', input: { tab: true, mic: !!meetingOf(tab.url) }, tabId: tab.id }, tab).catch((e) => notifyError(e));
    if (command === 'captions') void captionsOn(tab).catch((e) => notifyError(e));
  });

  return {
    'live.start': (start) => startLive(start),
    'live.stop': async ({ id }) => { await off({ off: 'live.stop', id }); },
    'live.pause': async ({ id, paused }) => { await off({ off: 'live.pause', id, paused }); },
    'live.list': () => listLive(),
    'live.history': async ({ id }) => (await hasOffscreen() ? ((await off<never>({ off: 'live.history', id })).value ?? []) : []),
    'captions.style': async (style: CaptionStyle) => {
      await chrome.storage.local.set({ captionStyle: style });
      // Running overlays pick it up from storage.onChanged in the content script.
    },
    'mic.ask': () => askMic(),
  };
}

function notifyError(e: unknown) {
  chrome.notifications.create({ type: 'basic', iconUrl: chrome.runtime.getURL('/icon/128.png'), title: 'VocalStack', message: e instanceof Error ? e.message : String(e) });
}

/** Offscreen documents cannot ask for the microphone: a small tab does,
 *  once, for the whole extension. Resolves with whether it was granted. */
async function askMic(): Promise<boolean> {
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/permission.html'), active: true });
  return new Promise((resolve) => {
    const done = (granted: boolean) => {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.tabs.onRemoved.removeListener(onGone);
      resolve(granted);
    };
    const onMsg = (m: { micGranted?: boolean }) => { if (typeof m?.micGranted === 'boolean') done(m.micGranted); return false; };
    const onGone = (id: number) => { if (id === tab.id) done(false); };
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.tabs.onRemoved.addListener(onGone);
  });
}

export { push };
