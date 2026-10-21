/** Dub this video: VocalStack transcribes the page's video from its
 *  address (a file transcription, kept in the account), then the
 *  offscreen document plays each sentence's voice clip in the chosen
 *  language in time with the video, which the content script turns down.
 *
 *  Speech comes only from the video's own transcript, translated: the
 *  owner's rule (no speech from text a caller provides) holds. A video
 *  dubbed or captioned before is not transcribed again: its transcription
 *  is shared per address (background/video.ts). */

import { push, RpcError, type Handlers } from '../lib/rpc';
import { currentEnv } from '../lib/env';
import type { DubStart, DubStatus } from '../lib/live';
import { off, videoFrame } from './live';
import { tabStore, transcribeVideo, vsClient } from './video';

/** Per tab: the dub's status and the frame whose video it follows. Kept in
 *  chrome.storage.session, because a dub outlives the service worker (a
 *  paused video sends nothing, and the worker is suspended meanwhile). */
interface TabDub { status: DubStatus; frameId: number; run: number }
const store = tabStore<TabDub>('dub.state');
const get = store.get;
const put = store.put;
const all = store.all;

/** This run is still the tab's dub (not stopped, not replaced by a newer one). */
async function current(tabId: number, run: number): Promise<boolean> {
  return (await get(tabId))?.run === run;
}

async function set(s: DubStatus, run: number) {
  // Stopped, or replaced by a newer dub: this run reports nothing more.
  const ok = await store.update(s.tabId, (d) => (d && d.run === run ? [{ ...d, status: s }, true] : [d, false]));
  if (ok) push({ push: 'dub.status', status: s });
}

async function run(req: DubStart, run: number) {
  const { tabId, lang } = req;
  const base: DubStatus = { tabId, lang, title: req.title, url: req.url, state: 'transcribing', progress: 0 };
  await set(base, run);
  const vs = await vsClient();
  const ids = await transcribeVideo(vs, { url: req.url, title: req.title }, (p) => set({ ...base, ...p }, run), () => current(tabId, run));
  if (!ids) return;
  const withIds = { ...base, transcriptionId: ids.transcriptionId, recordingId: ids.recordingId };
  if (!(await current(tabId, run))) return;
  await set({ ...withIds, state: 'translating', progress: undefined }, run);
  if (req.voice) await vs.recordings.settings(ids.recordingId, { voiceByLang: { [lang]: req.voice } }).catch(() => {});
  const snap = await vs.recordings.transcript(ids.recordingId, { lang });
  const sentences = snap.sentences.filter((s) => !s.suppressed && s.text.trim()).map((s) => ({ id: s.sentenceId, start: s.start, end: s.end }));
  if (!sentences.length) throw new RpcError('No speech was found in this video.');
  await set({ ...withIds, state: 'voicing' }, run);
  const env = await currentEnv();
  await off({ off: 'dub.load', tabId, api: env.api, recordingId: ids.recordingId, lang, voice: req.voice ?? null, sentences });
  if (!(await current(tabId, run))) { await off({ off: 'dub.stop', tabId }).catch(() => {}); return; }
  // One frame's video leads: the one with the largest visible video. It
  // turns the video down and reports its clock.
  const frameId = await videoFrame(tabId);
  await store.update(tabId, (d) => [d && d.run === run ? { ...d, frameId } : d, undefined]);
  await chrome.tabs.sendMessage(tabId, { dub: 'on' }, { frameId }).catch(() => {});
  await set({ ...withIds, state: 'playing' }, run);
}

export function registerDub(): Handlers {
  // The video's clock, from the leading frame, to the offscreen player.
  chrome.runtime.onMessage.addListener((m: { dubSync?: { t: number; paused: boolean; rate: number; at: number } }, sender) => {
    const tabId = sender.tab?.id;
    if (!m?.dubSync || tabId === undefined) return false;
    void get(tabId).then((d) => {
      if (d?.status.state === 'playing' && d.frameId === (sender.frameId ?? 0)) void off({ off: 'dub.sync', tabId, ...m.dubSync! }).catch(() => {});
    });
    return false;
  });
  const startDub = async (req: DubStart): Promise<DubStatus> => {
    const prev = await get(req.tabId);
    if (prev) await stop(req.tabId);
    const runId = Date.now();
    const first: DubStatus = { tabId: req.tabId, lang: req.lang, title: req.title, url: req.url, state: 'transcribing', progress: 0 };
    await put(req.tabId, { status: first, frameId: 0, run: runId });
    run(req, runId).catch((e) => set({ ...first, state: 'failed', error: e instanceof Error ? e.message : String(e) }, runId));
    return first;
  };
  /** Dub on, no language to dub into: the voice stops, the dub waits. */
  const wait = async (st: DubStatus) => {
    const d = await get(st.tabId);
    await chrome.tabs.sendMessage(st.tabId, { dub: 'off' }, { frameId: d?.frameId ?? 0 }).catch(() => {});
    await off({ off: 'dub.stop', tabId: st.tabId }).catch(() => {});
    const status: DubStatus = { ...st, state: 'waiting', progress: undefined, error: undefined };
    await put(st.tabId, { status, frameId: 0, run: Date.now() });
    push({ push: 'dub.status', status });
  };
  const stop = async (tabId: number) => {
    const d = await get(tabId);
    await put(tabId, null);
    await chrome.tabs.sendMessage(tabId, { dub: 'off' }, { frameId: d?.frameId ?? 0 }).catch(() => {});
    await off({ off: 'dub.stop', tabId }).catch(() => {});
  };
  chrome.tabs.onRemoved.addListener((tabId) => { void get(tabId).then((d) => d && stop(tabId)); });
  // The reading language changed: a dub follows it, translating the same
  // transcription. As spoken: it waits for a language to dub into.
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !('readLang' in c)) return;
    const lang = (c.readLang!.newValue as string | null) || null;
    void all().then((dubs) => {
      for (const d of dubs) {
        if (d.status.state === 'failed' || (d.status.lang === lang && d.status.state !== 'waiting')) continue;
        if (!lang) { void wait(d.status); continue; }
        if (d.status.url) void startDub({ tabId: d.status.tabId, url: d.status.url, title: d.status.title, lang });
      }
    });
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url) void get(tabId).then((d) => d && stop(tabId)); });
  return {
    'dub.start': (req) => startDub(req),
    'dub.stop': ({ tabId }) => stop(tabId),
    'dub.status': async ({ tabId }) => (await get(tabId))?.status ?? null,
  };
}
