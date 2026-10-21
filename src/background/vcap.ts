/** Captions on a page's video (design 3, Page → Captions): VocalStack
 *  transcribes the video from its address (the one transcription the dub
 *  shares, background/video.ts), then the content script shows its
 *  sentences in time with the video, in the reading language. A new
 *  reading language translates the same transcription again.
 *
 *  With Settings → Captions on videos (on by default), this starts by
 *  itself when the person starts a video playing with its sound on, on a
 *  page whose video VocalStack can fetch (once per address while the
 *  browser runs). */

import { push, RpcError, type Handlers } from '../lib/rpc';
import { account } from '../lib/auth';
import { AUTO_CAPTIONS, type VcapStart, type VcapStatus } from '../lib/live';
import { videoFrame } from './live';
import { sleep, tabStore, transcribeVideo, videoSource, vsClient } from './video';

const AUTO_SEEN = 'vcap.autoSeen';
interface TabCap { status: VcapStatus; frameId: number; run: number }
const store = tabStore<TabCap>('vcap.state');
const get = store.get;
const put = store.put;
const all = store.all;

async function current(tabId: number, run: number): Promise<boolean> {
  return (await get(tabId))?.run === run;
}
async function set(s: VcapStatus, run: number) {
  const ok = await store.update(s.tabId, (d) => (d && d.run === run ? [{ ...d, status: s }, true] : [d, false]));
  if (ok) push({ push: 'vcap.status', status: s });
}

export interface Cue { s: number; e: number; t: string; o?: string }

async function run(req: VcapStart, runId: number) {
  const { tabId } = req;
  const lang = req.lang ?? null;
  const base: VcapStatus = { tabId, lang, url: req.url, title: req.title, state: 'transcribing', progress: 0, auto: req.auto };
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
  await store.update(tabId, (d) => [d && d.run === runId ? { ...d, frameId } : d, undefined]);
  await chrome.tabs.sendMessage(tabId, { vcap: 'on', lang, cues }, { frameId }).catch(() => {});
  await set({ ...withIds, state: 'on', progress: undefined }, runId);
}

async function start(req: VcapStart): Promise<VcapStatus> {
  const prev = await get(req.tabId);
  if (prev) await hide(req.tabId, prev);
  const runId = Date.now();
  const first: VcapStatus = { tabId: req.tabId, lang: req.lang ?? null, url: req.url, title: req.title, state: 'transcribing', progress: 0, auto: req.auto };
  await put(req.tabId, { status: first, frameId: 0, run: runId });
  run(req, runId).catch((e) => set({ ...first, state: 'failed', error: e instanceof Error ? e.message : String(e) }, runId));
  return first;
}

async function hide(tabId: number, d: TabCap | null) {
  await chrome.tabs.sendMessage(tabId, { vcap: 'off' }, { frameId: d?.frameId ?? 0 }).catch(() => {});
}

async function stop(tabId: number) {
  const d = await get(tabId);
  await put(tabId, null);
  await hide(tabId, d);
  push({ push: 'vcap.gone', tabId });
}

export function registerVcap(): Handlers {
  chrome.runtime.onMessage.addListener((m: { vcapOff?: boolean; videoPlaying?: { url: string } }, sender) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    // × on the captions, or the tab's recording took the captions over.
    if (m?.vcapOff) void stop(tabId);
    // The person started a video with its sound on: Captions on videos.
    if (m?.videoPlaying) void auto(sender.tab!);
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => { void put(tabId, null); });
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url) void get(tabId).then((d) => d && stop(tabId)); });
  // The reading language changed: running captions follow it (the same
  // transcription, translated).
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !('readLang' in c)) return;
    const lang = (c.readLang!.newValue as string | null) || null;
    void all().then((caps) => {
      for (const d of caps) if (d.status.state !== 'failed' && d.status.lang !== lang) void start({ tabId: d.status.tabId, url: d.status.url, title: d.status.title, lang, auto: d.status.auto });
    });
  });
  return {
    'vcap.start': (req) => start(req),
    'vcap.stop': ({ tabId }) => stop(tabId),
    'vcap.status': async ({ tabId }) => (await get(tabId))?.status ?? null,
  };
}

async function auto(tab: chrome.tabs.Tab) {
  if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) return;
  const g = await chrome.storage.local.get([AUTO_CAPTIONS, 'readLang']);
  if (g[AUTO_CAPTIONS] === false || !(await account())) return;
  if (await get(tab.id)) return;
  // Once per address while the browser runs: turned off, it stays off.
  const seen = ((await chrome.storage.session.get(AUTO_SEEN))[AUTO_SEEN] as string[] | undefined) ?? [];
  if (seen.includes(tab.url)) return;
  // Only a video VocalStack can fetch: never the page's address instead.
  const url = await videoSource(tab.id, tab.url, true);
  if (!url) return;
  await chrome.storage.session.set({ [AUTO_SEEN]: [...seen.slice(-200), tab.url] });
  await start({ tabId: tab.id, url, title: tab.title, lang: (g.readLang as string) || null, auto: true });
}
