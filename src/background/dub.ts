/** Dub this video: VocalStack transcribes the page's video from its
 *  address (a file transcription, kept in the account), then the
 *  offscreen document plays each sentence's voice clip in the chosen
 *  language in time with the video, which the content script turns down.
 *
 *  Speech comes only from the video's own transcript, translated: the
 *  owner's rule (no speech from text a caller provides) holds. A video
 *  dubbed before is not transcribed again: its transcription is
 *  remembered per address. */

import { VocalStack } from '@vocalstack/sdk';
import type { Transcription } from '@vocalstack/contract';
import { accessToken } from '../lib/auth';
import { currentEnv } from '../lib/env';
import { push, RpcError, type Handlers } from '../lib/rpc';
import type { DubStart, DubStatus } from '../lib/live';
import { off, videoFrame } from './live';

const KNOWN = 'dub.known';
/** Per tab: the dub's status and the frame whose video it follows. Kept in
 *  chrome.storage.session, because a dub outlives the service worker (a
 *  paused video sends nothing, and the worker is suspended meanwhile). */
const STATE = 'dub.state';
interface TabDub { status: DubStatus; frameId: number; run: number }

async function all(): Promise<Record<string, TabDub>> {
  return ((await chrome.storage.session.get(STATE))[STATE] as Record<string, TabDub> | undefined) ?? {};
}
async function get(tabId: number): Promise<TabDub | null> {
  return (await all())[tabId] ?? null;
}
async function put(tabId: number, d: TabDub | null) {
  const a = await all();
  if (d) a[tabId] = d; else delete a[tabId];
  await chrome.storage.session.set({ [STATE]: a });
}

/** This run is still the tab's dub (not stopped, not replaced by a newer one). */
async function current(tabId: number, run: number): Promise<boolean> {
  return (await get(tabId))?.run === run;
}

async function set(s: DubStatus, run: number) {
  const d = await get(s.tabId);
  // Stopped, or replaced by a newer dub: this run reports nothing more.
  if (!d || d.run !== run) return;
  await put(s.tabId, { ...d, status: s });
  push({ push: 'dub.status', status: s });
}

export async function vsClient(): Promise<VocalStack> {
  const env = await currentEnv();
  return new VocalStack({ baseUrl: env.api, token: () => accessToken() });
}

async function known(url: string): Promise<{ transcriptionId: string; recordingId: string } | null> {
  const env = await currentEnv();
  const g = await chrome.storage.local.get(KNOWN);
  return (g[KNOWN] as Record<string, { transcriptionId: string; recordingId: string }> | undefined)?.[`${env.name}|${url}`] ?? null;
}

async function remember(url: string, v: { transcriptionId: string; recordingId: string }) {
  const env = await currentEnv();
  const g = await chrome.storage.local.get(KNOWN);
  const all = (g[KNOWN] as Record<string, unknown>) ?? {};
  await chrome.storage.local.set({ [KNOWN]: { ...all, [`${env.name}|${url}`]: v } });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A page video's transcription (made once per address and remembered),
 *  its job read every few seconds until done. Shared by the dub and by
 *  captions on a video (background/vcap.ts). `current` stops it quietly;
 *  null means it was stopped. */
export async function transcribeVideo(vs: VocalStack, req: { url: string; title?: string; suffix?: string }, onProgress: (p: { progress: number; transcriptionId: string; recordingId: string }) => Promise<void>, current: () => Promise<boolean>): Promise<{ transcriptionId: string; recordingId: string } | null> {
  let ids = await known(req.url);
  if (ids) {
    // Still there? (It may have been archived or purged.)
    const t = await vs.transcriptions.get(ids.transcriptionId).catch(() => null);
    if (!t || t.lifecycle !== 'active') ids = null;
  }
  if (!ids) {
    const t: Transcription = await vs.transcriptions.createFromUrl(req.url, { name: req.title ? `${req.title}${req.suffix ?? ''}` : null });
    const rid = t.job?.recordingId ?? t.currentRecording?.recordingId ?? t.lastRecording?.recordingId;
    if (!rid) throw new RpcError('VocalStack did not start transcribing this video.');
    ids = { transcriptionId: t.id, recordingId: rid };
  }
  await onProgress({ progress: 0, ...ids });
  for (;;) {
    if (!(await current())) return null;
    const job = await vs.jobs.get(ids.recordingId).catch(() => null);
    if (!job || job.state === 'done') break;
    if (job.state === 'failed' || job.state === 'stopped') throw new RpcError(job.error || 'VocalStack could not transcribe this video.');
    await onProgress({ progress: (job.progress?.pct ?? 0) / 100, ...ids });
    await sleep(3000);
  }
  await remember(req.url, ids);
  return ids;
}

async function run(req: DubStart, run: number) {
  const { tabId, lang } = req;
  const base: DubStatus = { tabId, lang, title: req.title, url: req.url, state: 'transcribing', progress: 0 };
  await set(base, run);
  const vs = await vsClient();
  const ids = await transcribeVideo(vs, { url: req.url, title: req.title, suffix: ' (dub)' }, (p) => set({ ...base, ...p }, run), () => current(tabId, run));
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
  const d = await get(tabId);
  if (d) await put(tabId, { ...d, frameId });
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
  const stop = async (tabId: number) => {
    const d = await get(tabId);
    await put(tabId, null);
    await chrome.tabs.sendMessage(tabId, { dub: 'off' }, { frameId: d?.frameId ?? 0 }).catch(() => {});
    await off({ off: 'dub.stop', tabId }).catch(() => {});
  };
  chrome.tabs.onRemoved.addListener((tabId) => { void get(tabId).then((d) => d && stop(tabId)); });
  // The reading language changed: a dub follows it (as spoken: it stops).
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !('readLang' in c)) return;
    const lang = (c.readLang!.newValue as string | null) || null;
    void all().then((dubs) => {
      for (const d of Object.values(dubs)) {
        if (d.status.state === 'failed' || d.status.lang === lang) continue;
        if (!lang) { void stop(d.status.tabId); push({ push: 'dub.status', status: { ...d.status, state: 'failed', error: 'Dub stopped: pick a language to dub into.' } }); continue; }
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
