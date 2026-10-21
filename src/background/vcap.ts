/** Captions on a page's video (design 3, Page → Captions): VocalStack
 *  transcribes the video from its address (a file transcription, kept in
 *  the account, shared with the dub), then the content script shows its
 *  sentences in time with the video, in the reading language.
 *
 *  With Settings → Captions on videos, this starts by itself when a video
 *  starts playing on a page (once per address while the browser runs). */

import { push, RpcError, type Handlers } from '../lib/rpc';
import { account } from '../lib/auth';
import type { VcapStart, VcapStatus } from '../lib/live';
import { transcribeVideo, sleep, vsClient } from './dub';
import { videoFrame } from './live';
import { scan } from './page';

const STATE = 'vcap.state';
/** Settings: captions on every video played (default off). */
export const AUTO_KEY = 'captions.auto';
const AUTO_SEEN = 'vcap.autoSeen';
interface TabCap { status: VcapStatus; frameId: number; run: number }

async function all(): Promise<Record<string, TabCap>> {
  return ((await chrome.storage.session.get(STATE))[STATE] as Record<string, TabCap> | undefined) ?? {};
}
async function get(tabId: number): Promise<TabCap | null> {
  return (await all())[tabId] ?? null;
}
async function put(tabId: number, d: TabCap | null) {
  const a = await all();
  if (d) a[tabId] = d; else delete a[tabId];
  await chrome.storage.session.set({ [STATE]: a });
}
async function current(tabId: number, run: number): Promise<boolean> {
  return (await get(tabId))?.run === run;
}
async function set(s: VcapStatus, run: number) {
  const d = await get(s.tabId);
  if (!d || d.run !== run) return;
  await put(s.tabId, { ...d, status: s });
  push({ push: 'vcap.status', status: s });
}

export interface Cue { s: number; e: number; t: string; o?: string }

async function run(req: VcapStart, runId: number) {
  const { tabId } = req;
  const lang = req.lang ?? null;
  const base: VcapStatus = { tabId, lang, url: req.url, title: req.title, state: 'transcribing', progress: 0 };
  await set(base, runId);
  const vs = await vsClient();
  const ids = await transcribeVideo(vs, { url: req.url, title: req.title }, (p) => set({ ...base, ...p }, runId), () => current(tabId, runId));
  if (!ids) return;
  const withIds = { ...base, transcriptionId: ids.transcriptionId, recordingId: ids.recordingId };
  const snap = await vs.recordings.transcript(ids.recordingId, lang ? { lang } : {});
  const sentences = snap.sentences.filter((x) => !x.suppressed && x.text.trim());
  if (!sentences.length) throw new RpcError('No speech was found in this video.');
  const tr: Record<number, string> = {};
  if (lang) {
    await set({ ...withIds, state: 'translating', progress: 0 }, runId);
    for (const x of sentences) { const t = x.translations?.[lang]; if (t) tr[x.sentenceId] = t; }
    const missing = sentences.filter((x) => !tr[x.sentenceId]).map((x) => x.sentenceId);
    for (let i = 0; i < missing.length; i += 40) {
      if (!(await current(tabId, runId))) return;
      const got = await vs.recordings.translation(ids.recordingId, lang, missing.slice(i, i + 40));
      for (const [k, v] of Object.entries(got.translations)) tr[Number(k)] = v;
      await set({ ...withIds, state: 'translating', progress: Math.min(1, (i + 40) / missing.length) }, runId);
      await sleep(50);
    }
  }
  if (!(await current(tabId, runId))) return;
  const cues: Cue[] = sentences.map((x) => (lang ? { s: x.start, e: x.end, t: tr[x.sentenceId] ?? x.text, o: x.text } : { s: x.start, e: x.end, t: x.text }));
  const frameId = await videoFrame(tabId);
  const d = await get(tabId);
  if (d) await put(tabId, { ...d, frameId });
  await chrome.tabs.sendMessage(tabId, { vcap: 'on', lang, cues }, { frameId }).catch(() => {});
  await set({ ...withIds, state: 'on', progress: undefined }, runId);
}

async function start(req: VcapStart): Promise<VcapStatus> {
  const prev = await get(req.tabId);
  if (prev) await stop(req.tabId);
  const runId = Date.now();
  const first: VcapStatus = { tabId: req.tabId, lang: req.lang ?? null, url: req.url, title: req.title, state: 'transcribing', progress: 0, auto: req.auto };
  await put(req.tabId, { status: first, frameId: 0, run: runId });
  run(req, runId).catch((e) => set({ ...first, state: 'failed', error: e instanceof Error ? e.message : String(e) }, runId));
  return first;
}

async function stop(tabId: number) {
  const d = await get(tabId);
  await put(tabId, null);
  await chrome.tabs.sendMessage(tabId, { vcap: 'off' }, { frameId: d?.frameId ?? 0 }).catch(() => {});
  push({ push: 'vcap.gone', tabId });
}

/** What VocalStack transcribes for a tab's video: the main video's own
 *  file when it has one, an embedded player's page, else the page. */
export async function videoSource(tabId: number, pageUrl: string): Promise<string> {
  const found = await scan(tabId).catch(() => null);
  const media = found?.media ?? [];
  const playing = (k: string) => media.filter((m) => m.kind === k && !m.streamOnly).sort((a, b) => Number(!!b.playing) - Number(!!a.playing) || (b.durationS ?? 0) - (a.durationS ?? 0));
  return playing('video')[0]?.url ?? playing('embed')[0]?.url ?? pageUrl;
}

export function registerVcap(): Handlers {
  chrome.runtime.onMessage.addListener((m: { vcapOff?: boolean; videoPlaying?: boolean }, sender) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    // × on the captions.
    if (m?.vcapOff) void stop(tabId);
    // A video started playing: Captions on videos.
    if (m?.videoPlaying) void auto(sender.tab!);
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => { void get(tabId).then((d) => d && put(tabId, null)); });
  // The reading language changed: running captions follow it.
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !('readLang' in c)) return;
    const lang = (c.readLang!.newValue as string | null) || null;
    void all().then((caps) => {
      for (const d of Object.values(caps)) if (d.status.state !== 'failed' && d.status.lang !== lang) void start({ tabId: d.status.tabId, url: d.status.url, title: d.status.title, lang, auto: d.status.auto });
    });
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url) void get(tabId).then((d) => d && stop(tabId)); });
  return {
    'vcap.start': (req) => start(req),
    'vcap.stop': ({ tabId }) => stop(tabId),
    'vcap.status': async ({ tabId }) => (await get(tabId))?.status ?? null,
  };
}

async function auto(tab: chrome.tabs.Tab) {
  if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) return;
  const g = await chrome.storage.local.get([AUTO_KEY, 'readLang']);
  if (g[AUTO_KEY] !== true || !(await account())) return;
  if (await get(tab.id)) return;
  // Once per address while the browser runs: turned off, it stays off.
  const seen = ((await chrome.storage.session.get(AUTO_SEEN))[AUTO_SEEN] as string[] | undefined) ?? [];
  if (seen.includes(tab.url)) return;
  await chrome.storage.session.set({ [AUTO_SEEN]: [...seen.slice(-200), tab.url] });
  const url = await videoSource(tab.id, tab.url);
  await start({ tabId: tab.id, url, title: tab.title, lang: (g.readLang as string) || null, auto: true });
}
