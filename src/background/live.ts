/** Live sessions, background half: it gets the tab's capture stream id
 *  (only the service worker may, right after the person invoked the
 *  extension on that tab), makes sure the offscreen document exists, and
 *  relays. Captions go to the frame of the tab that holds the main video.
 *  On YouTube, a tab's recording is fed the video's buffered audio ahead
 *  of playback instead of the tab's sound (lib/ahead.ts), when the page
 *  can give it. The toolbar badge says REC while anything records. */

import { push, RpcError, rpcError, type Handlers, type LiveEvent, type Push } from '../lib/rpc';
import { GENERIC, userText } from '../lib/errors';
import { report } from '../lib/sentry';
import { currentEnv } from '../lib/env';
import { capturable, isRunning, meetingHost, meetingOf, tabHolder, RECORDING_MODES, type LiveStart, type LiveStatus, type CaptionStyle } from '../lib/live';
import type { OffAnswer, OffCmd } from '../lib/offscreen';
import { showInPanel } from './panel';
import { vsClient } from './video';

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
  if (!a) throw new RpcError('VocalStack’s audio didn’t start. Try again.');
  if (!a.ok) throw rpcError(a);
  return a as { value?: T; statuses?: LiveStatus[] };
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t?.id) throw new RpcError('There is no tab to use.');
  return t;
}

/* ── Invoked tabs ──────────────────────────────────────────────────
 * Chrome lets an extension capture a tab only after the person invoked it
 * on that tab (the toolbar icon, a shortcut, a context menu), until the
 * tab goes to another site. The panel cannot ask Chrome, so the
 * invocations are noted here (in session storage: the worker sleeps) and
 * the panel says what to do before a start fails. */

const INVOKED = 'live.invoked';
const originOf = (url: string | undefined) => { try { return new URL(url ?? '').origin; } catch { return ''; } };

async function invokedList(): Promise<{ tabId: number; origin: string }[]> {
  return ((await chrome.storage.session.get(INVOKED))[INVOKED] as { tabId: number; origin: string }[] | undefined) ?? [];
}

export async function markInvoked(tab: chrome.tabs.Tab | undefined) {
  if (tab?.id === undefined) return;
  void invokeBadge(tab.id, false);
  const all = (await invokedList()).filter((x) => x.tabId !== tab.id);
  await chrome.storage.session.set({ [INVOKED]: [...all.slice(-100), { tabId: tab.id, origin: originOf(tab.url) }] });
}

/** The toolbar icon's "!" on a tab: the panel is asking for the click.
 *  Off, the tab shows the global badge again (REC, II, CC). */
export async function invokeBadge(tabId: number, on: boolean) {
  await chrome.action.setBadgeText({ tabId, text: on ? '!' : (null as unknown as string) }).catch(() => {});
  if (on) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#f78472' }).catch(() => {});
    await chrome.action.setBadgeTextColor?.({ tabId, color: '#1b0f0e' }).catch(() => {});
  }
}

async function forgetInvoked(tabId: number, url?: string) {
  const all = await invokedList();
  const keep = all.filter((x) => x.tabId !== tabId || (url !== undefined && x.origin === originOf(url)));
  if (keep.length !== all.length) await chrome.storage.session.set({ [INVOKED]: keep });
}

export async function wasInvoked(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return !!tab && (await invokedList()).some((x) => x.tabId === tabId && x.origin === originOf(tab.url));
}

/** The tab's capture stream id. Chrome grants it only after the person
 *  invoked the extension on the tab: the toolbar icon, a shortcut, a menu. */
async function streamIdFor(tab: chrome.tabs.Tab): Promise<string> {
  if (!capturable(tab.url)) throw new RpcError('Browser pages and the extension store cannot be captured.', 'tab_capture');
  try {
    const id = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id! });
    void markInvoked(tab);
    return id;
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (/invoked|activeTab/i.test(m)) {
      // Noted as invoked, but Chrome no longer agrees (the extension was
      // reloaded, say): forget it, so the panel asks for the click again.
      await forgetInvoked(tab.id!);
      throw new RpcError('Click the VocalStack icon in Chrome’s toolbar while on this tab, then start again: Chrome lets VocalStack record a tab only after that.', 'invoke');
    }
    if (/active stream|already/i.test(m)) throw new RpcError('Another extension or browser feature is already using this tab’s sound. Stop it there, then start again.', 'tab_busy');
    report(e, 'capture stream id');
    throw new RpcError('This tab’s sound couldn’t be captured. Reload the tab, then start again.', 'tab_capture');
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

/** The frame that can feed a tab's session the video's buffered audio,
 *  ahead of playback (content/ahead.ts), if one can. */
async function aheadFrame(tabId: number): Promise<number | null> {
  const frameId = await videoFrame(tabId);
  const r = (await chrome.tabs.sendMessage(tabId, { ahead: 'probe' }, { frameId }).catch(() => null)) as { ready?: boolean } | null;
  return r?.ready ? frameId : null;
}

/** Where each running session's captions go: captions sessions, and
 *  recordings shown as captions on their tab. Kept in session storage too,
 *  so captions survive the service worker going to sleep. */
/** `hide`: a recording shown as captions: closing them hides them, it does not stop it. */
type Target = { tabId: number; frameId: number; hide?: boolean };
const captionTargets = new Map<string, Target>();
const TARGETS = 'live.captionTargets';
const targetsLoaded = chrome.storage.session.get(TARGETS).then((g) => {
  for (const [id, t] of Object.entries((g[TARGETS] as Record<string, Target>) ?? {})) if (!captionTargets.has(id)) captionTargets.set(id, t);
}, () => {});
function saveTargets() { void chrome.storage.session.set({ [TARGETS]: Object.fromEntries(captionTargets) }); }
function setTarget(id: string, t: Target) { captionTargets.set(id, t); saveTargets(); }
function dropTarget(id: string) {
  const t = captionTargets.get(id);
  if (!t) return;
  captionTargets.delete(id);
  saveTargets();
  chrome.tabs.sendMessage(t.tabId, { caption: 'off', id }, { frameId: t.frameId }).catch(() => {});
}

/** Show (or hide) a running session's transcript as captions on its tab,
 *  starting with what was said last. */
async function overlay(s: LiveStatus, on: boolean) {
  if (!on) { dropTarget(s.id); await off({ off: 'live.set', id: s.id, overlay: false }); return; }
  if (s.tabId === undefined) throw new RpcError('This session has no tab to show captions on.');
  const t: Target = { tabId: s.tabId, frameId: await videoFrame(s.tabId), hide: s.mode !== 'captions' };
  setTarget(s.id, t);
  await off({ off: 'live.set', id: s.id, overlay: true });
  tellTarget(t, { ...s, overlay: true });
  const all = (await off<LiveEvent[]>({ off: 'live.history', id: s.id })).value ?? [];
  // Read ahead, the lines still to come are in the history too.
  for (const event of s.ahead ? all : all.slice(-6)) await chrome.tabs.sendMessage(t.tabId, { caption: event, id: s.id, hide: t.hide }, { frameId: t.frameId }).catch(() => {});
}

/** What the floating captions show of a session: its state, languages,
 *  speaker labels and host. */
function tellTarget(t: Target, s: LiveStatus) {
  const status = { state: s.state, mode: s.mode, spokenLanguage: s.spokenLanguage ?? null, translateTo: s.translateTo ?? null, speakerLabels: s.speakerLabels ?? 'auto', host: s.host, ahead: !!s.ahead };
  chrome.tabs.sendMessage(t.tabId, { captionStatus: status, id: s.id, hide: t.hide }, { frameId: t.frameId }).catch(() => {});
}

/** The spoken-language list, once per service worker. */
const langLists: Partial<Record<'transcription' | 'translation', Promise<{ code: string; flag?: string; name: string; native?: string }[]>>> = {};

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return undefined; } };

function defaultName(start: LiveStart, tab: chrome.tabs.Tab | null): string {
  const when = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (start.name?.trim()) return start.name.trim();
  if (start.mode === 'meeting') return `${meetingOf(tab?.url) ?? 'Meeting'} · ${when}`;
  if (start.input.tab && tab?.title) return tab.title.slice(0, 120);
  return `Microphone · ${when}`;
}

export async function startLive(start: LiveStart, invokedTab?: chrome.tabs.Tab): Promise<LiveStatus> {
  const env = await currentEnv();
  // The offscreen document cannot ask for the microphone: ask first, here,
  // so Go live and Start recording just work the first time.
  if (start.input.mic && (await micState()) !== 'granted' && !(await askMic())) {
    throw new RpcError('VocalStack may not use the microphone. Allow it, then try again.', 'mic_permission');
  }
  let tab: chrome.tabs.Tab | null = null;
  if (start.input.tab || start.mode === 'captions') {
    tab = invokedTab ?? (start.tabId !== undefined ? await chrome.tabs.get(start.tabId) : await activeTab());
  }
  if (invokedTab) void markInvoked(invokedTab);
  // One capture per tab: say who holds it, or work with it.
  const holder = start.input.tab ? tabHolder(await listLive().catch(() => []), tab?.id) : undefined;
  if (holder) {
    if (start.mode === 'captions' && holder.mode !== 'captions') {
      // Captions of a tab that is being recorded: the recording's own
      // transcript, shown on the tab.
      if (start.translateTo !== undefined && (start.translateTo ?? null) !== (holder.translateTo ?? null)) await off({ off: 'live.set', id: holder.id, translateTo: start.translateTo ?? null });
      await overlay(holder, true);
      return { ...holder, overlay: true, translateTo: start.translateTo ?? holder.translateTo };
    }
    if (holder.mode === 'captions' && start.mode !== 'captions') {
      // Recording a tab that shows captions: the recording takes the tab's
      // sound over, and its transcript keeps showing as the captions.
      await off({ off: 'live.stop', id: holder.id });
      start = { ...start, overlay: true, translateTo: start.translateTo ?? holder.translateTo ?? null };
    } else if (holder.mode === 'captions') {
      throw new RpcError('Captions are already on for this tab. Turn them off first.', 'tab_busy');
    } else {
      throw new RpcError(`This tab is already being recorded (“${holder.name}”). Its transcript is in Live; you can show it as captions on the tab from there.`, 'tab_busy');
    }
  }
  // The tab's sound alone, on YouTube: the video's buffered audio instead,
  // so the captions are ready before the words are said.
  const feeder = tab?.id !== undefined && start.input.tab && !start.input.mic && (start.mode === 'record' || start.mode === 'captions')
    ? await aheadFrame(tab.id) : null;
  if (feeder !== null) start = { ...start, ahead: true };
  let streamId: string | undefined;
  if (tab && start.input.tab && feeder === null) {
    // A capture just stopped may take a moment to let the tab go.
    for (let i = 0; ; i++) {
      try { streamId = await streamIdFor(tab); break; } catch (e) {
        if (!(e instanceof RpcError) || e.code !== 'tab_busy' || !holder || i >= 6) throw e;
        await wait(250);
      }
    }
  }
  const id = crypto.randomUUID();
  const showOnTab = start.mode === 'captions' || (!!start.overlay && start.input.tab);
  if (showOnTab && tab?.id !== undefined && capturable(tab.url)) {
    setTarget(id, { tabId: tab.id, frameId: await videoFrame(tab.id), hide: start.mode !== 'captions' });
  }
  const where = tab?.url ? { meeting: meetingHost(tab.url)?.key, host: hostOf(tab.url) } : {};
  const cmd: OffCmd = { off: 'live.start', id, api: env.api, start: { ...start, ...where, tabId: tab?.id ?? start.tabId }, name: defaultName(start, tab), streamId, tabTitle: tab?.title };
  try {
    const status = (await off<LiveStatus>(cmd)).value!;
    if (feeder !== null) await chrome.tabs.sendMessage(tab!.id!, { ahead: 'start', id }, { frameId: feeder }).catch(() => {});
    return status;
  } catch (e) {
    dropTarget(id);
    throw e;
  }
}

/** Any session still capturing (the environment may not change under it). */
export async function anyRunning(): Promise<boolean> {
  return (await listLive().catch(() => [])).some((s) => !['done', 'failed'].includes(s.state));
}

export async function listLive(): Promise<LiveStatus[]> {
  if (!(await hasOffscreen())) return [];
  return (await off({ off: 'live.list' })).statuses ?? [];
}

/** The toolbar badge: REC while anything records, II while a recording
 *  is paused, CC while only captions run (they record nothing). */
async function badge() {
  const all = await listLive().catch(() => []);
  const on = (s: LiveStatus) => s.state === 'live' || s.state === 'warming' || s.state === 'starting';
  const recording = all.filter((s) => RECORDING_MODES.includes(s.mode));
  const rec = recording.some(on);
  const paused = !rec && recording.some((s) => s.state === 'paused');
  const cc = !rec && !paused && all.some((s) => s.mode === 'captions' && on(s));
  await chrome.action.setBadgeBackgroundColor({ color: paused ? '#f0b429' : cc ? '#55abe5' : '#f78472' });
  await chrome.action.setBadgeText({ text: rec ? 'REC' : paused ? 'II' : cc ? 'CC' : '' });
}

/** The captured tab is gone: its sessions end with it. */
async function stopForTab(tabId: number) {
  for (const s of await listLive().catch(() => [])) {
    if (s.tabId === tabId && s.input.tab && !['done', 'failed', 'stopping'].includes(s.state)) await off({ off: 'live.stop', id: s.id }).catch(() => {});
  }
}

/** The panel's language choices (ui/langs.tsx), for a start made here. */
export async function livePrefs(): Promise<Pick<LiveStart, 'translateTo' | 'spokenLanguage' | 'speakerLabels'>> {
  const g = await chrome.storage.local.get(['readLang', 'liveLang', 'speakerLabels']);
  return { translateTo: (g.readLang as string) || null, spokenLanguage: (g.liveLang as string) || null, speakerLabels: (g.speakerLabels as LiveStart['speakerLabels']) ?? 'auto' };
}

/** The captions shortcut: this tab's recording shown on the page, on or
 *  off; with none, a recording starts with its captions on (every live
 *  session is a saved live transcription). */
async function captionsOn(tab: chrome.tabs.Tab) {
  const all = await listLive().catch(() => []);
  const holder = tabHolder(all, tab.id);
  if (holder && holder.mode !== 'captions') { await overlay(holder, !holder.overlay); return; }
  if (holder) { await off({ off: 'live.stop', id: holder.id }); return; }
  await startLive({ mode: meetingOf(tab.url) ? 'meeting' : 'record', input: { tab: true, mic: !!meetingOf(tab.url) }, tabId: tab.id, overlay: true, ...(await livePrefs()) }, tab);
}

export function registerLive(): Handlers {
  chrome.runtime.onMessage.addListener((msg: Push) => {
    if (msg?.push === 'live.status') {
      void badge();
      const st = msg.status;
      // Reading ahead ended: the page stops sending.
      if (st.ahead && st.tabId !== undefined && ['done', 'failed'].includes(st.state)) chrome.tabs.sendMessage(st.tabId, { ahead: 'stop', id: st.id }).catch(() => {});
      void targetsLoaded.then(() => {
        if (['done', 'failed'].includes(st.state)) { dropTarget(st.id); return; }
        const t = captionTargets.get(st.id);
        if (t) tellTarget(t, st);
      });
    }
    if (msg?.push === 'live.event') {
      void targetsLoaded.then(() => {
        const t = captionTargets.get(msg.id);
        if (t) chrome.tabs.sendMessage(t.tabId, { caption: msg.event, id: msg.id, hide: t.hide }, { frameId: t.frameId }).catch(() => {});
      });
    }
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => { void stopForTab(tabId); void forgetInvoked(tabId); });
  // The reading language (ui/langs.tsx) changed: every running session
  // reads in it, whether or not the panel is open.
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !('readLang' in c)) return;
    const lang = (c.readLang!.newValue as string | null) || null;
    void listLive().then((all) => {
      for (const s of all) if (s.mode !== 'broadcast' && (s.state === 'live' || s.state === 'paused') && (s.translateTo ?? null) !== lang) void off({ off: 'live.set', id: s.id, translateTo: lang }).catch(() => {});
    }, () => {});
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url) void forgetInvoked(tabId, info.url); });
  chrome.commands.onCommand.addListener((command, tab) => {
    if (!tab?.id) return;
    // Inside the shortcut's gesture: open the panel first, then capture.
    void showInPanel({ view: 'live', tabId: tab.id }, tab.windowId);
    void markInvoked(tab);
    if (command === 'record-tab') void livePrefs().then((p) => startLive({ mode: meetingOf(tab.url) ? 'meeting' : 'record', input: { tab: true, mic: !!meetingOf(tab.url) }, tabId: tab.id, ...p }, tab)).catch((e) => notifyError(e));
    if (command === 'captions') void captionsOn(tab).catch((e) => notifyError(e));
  });

  return {
    'live.start': (start) => startLive(start),
    'live.stop': async ({ id }) => { await off({ off: 'live.stop', id }); },
    'live.pause': async ({ id, paused }) => { await off({ off: 'live.pause', id, paused }); },
    'live.list': () => listLive(),
    'live.ahead': async (_, sender) => {
      const s = (await listLive()).find((x) => x.ahead && x.tabId === sender.tab?.id && isRunning(x) && x.state !== 'stopping');
      return s ? { id: s.id } : null;
    },
    'live.forget': async ({ id }) => {
      if (await hasOffscreen()) await off({ off: 'live.forget', id });
      else push({ push: 'live.gone', id });
    },
    'live.overlay': async ({ id, on }) => {
      const s = (await listLive()).find((x) => x.id === id);
      if (!s) throw new RpcError('That session has ended.');
      await overlay(s, on);
    },
    'live.settings': async ({ id, ...patch }) => { await off({ off: 'live.set', id, ...patch }); },
    'live.langs': (args) => {
      const list = args?.list === 'translation' ? 'translation' : 'transcription';
      langLists[list] ??= vsClient().then((vs) => vs.languages.list()).then((l) => {
        const codes = new Set(l[list] ?? []);
        return l.languages.filter((x) => codes.has(x.code)).sort((a, b) => a.name.localeCompare(b.name))
          .map((x) => ({ code: x.code, flag: x.flag ?? undefined, name: x.name, native: x.native && x.native !== x.name ? x.native : undefined }));
      }).catch((e) => { delete langLists[list]; throw e; });
      return langLists[list]!;
    },
    'live.translate': async ({ id, lang }) => { await off({ off: 'live.set', id, translateTo: lang }); },
    'tab.invoked': ({ tabId }) => wasInvoked(tabId),
    'tab.badge': async ({ tabId, on }) => { await invokeBadge(tabId, on && !(await wasInvoked(tabId))); },
    'live.history': async ({ id }) => (await hasOffscreen() ? ((await off<never>({ off: 'live.history', id })).value ?? []) : []),
    'captions.style': async (style: CaptionStyle) => {
      await chrome.storage.local.set({ captionStyle: style });
      // Running overlays pick it up from storage.onChanged in the content script.
    },
    'mic.ask': () => askMic(),
  };
}

function notifyError(e: unknown) {
  chrome.notifications.create({ type: 'basic', iconUrl: chrome.runtime.getURL('/icon/128.png'), title: 'VocalStack', message: userText(e) || GENERIC });
}

/** Whether the extension may use the microphone; 'unknown' when the
 *  browser cannot say (the capture then reports a refusal itself). */
async function micState(): Promise<PermissionState | 'unknown'> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    return 'unknown';
  }
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
