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
import { off } from './live';

const KNOWN = 'dub.known';
const statuses = new Map<number, DubStatus>();
const cancelled = new Set<number>();

function set(s: DubStatus) {
  statuses.set(s.tabId, s);
  push({ push: 'dub.status', status: s });
}

async function vsClient(): Promise<VocalStack> {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(req: DubStart) {
  const { tabId, lang } = req;
  const base: DubStatus = { tabId, lang, title: req.title, state: 'transcribing', progress: 0 };
  set(base);
  const vs = await vsClient();
  let ids = await known(req.url);
  if (ids) {
    // Still there? (It may have been archived or purged.)
    const t = await vs.transcriptions.get(ids.transcriptionId).catch(() => null);
    if (!t || t.lifecycle !== 'active') ids = null;
  }
  if (!ids) {
    const t: Transcription = await vs.transcriptions.createFromUrl(req.url, { name: req.title ? `${req.title} (dub)` : null });
    const rid = t.job?.recordingId ?? t.currentRecording?.recordingId ?? t.lastRecording?.recordingId;
    if (!rid) throw new RpcError('VocalStack did not start transcribing this video.');
    ids = { transcriptionId: t.id, recordingId: rid };
  }
  set({ ...base, transcriptionId: ids.transcriptionId, recordingId: ids.recordingId });
  // Transcribe: a job, read every few seconds until done.
  for (;;) {
    if (cancelled.has(tabId)) return;
    const job = await vs.jobs.get(ids.recordingId).catch(() => null);
    if (!job || job.state === 'done') break;
    if (job.state === 'failed' || job.state === 'stopped') throw new RpcError(job.error || 'VocalStack could not transcribe this video.');
    set({ ...base, transcriptionId: ids.transcriptionId, recordingId: ids.recordingId, progress: (job.progress?.pct ?? 0) / 100 });
    await sleep(3000);
  }
  await remember(req.url, ids);
  if (cancelled.has(tabId)) return;
  set({ ...base, state: 'translating', transcriptionId: ids.transcriptionId, recordingId: ids.recordingId, progress: undefined });
  if (req.voice) await vs.recordings.settings(ids.recordingId, { voiceByLang: { [lang]: req.voice } }).catch(() => {});
  const snap = await vs.recordings.transcript(ids.recordingId, { lang });
  const sentences = snap.sentences.filter((s) => !s.suppressed && s.text.trim()).map((s) => ({ id: s.sentenceId, start: s.start, end: s.end }));
  if (!sentences.length) throw new RpcError('No speech was found in this video.');
  set({ ...base, state: 'voicing', transcriptionId: ids.transcriptionId, recordingId: ids.recordingId });
  const env = await currentEnv();
  await off({ off: 'dub.load', tabId, api: env.api, recordingId: ids.recordingId, lang, voice: req.voice ?? null, sentences });
  if (cancelled.has(tabId)) return;
  // The content script turns the video down and starts reporting its clock.
  await chrome.tabs.sendMessage(tabId, { dub: 'on' }).catch(() => {});
  set({ ...base, state: 'playing', transcriptionId: ids.transcriptionId, recordingId: ids.recordingId });
}

export function registerDub(): Handlers {
  // The video's clock, from the content script, to the offscreen player.
  chrome.runtime.onMessage.addListener((m: { dubSync?: { t: number; paused: boolean; rate: number; at: number } }, sender) => {
    if (m?.dubSync && sender.tab?.id !== undefined && statuses.get(sender.tab.id)?.state === 'playing') {
      void off({ off: 'dub.sync', tabId: sender.tab.id, ...m.dubSync }).catch(() => {});
    }
    return false;
  });
  const stop = async (tabId: number) => {
    cancelled.add(tabId);
    statuses.delete(tabId);
    await chrome.tabs.sendMessage(tabId, { dub: 'off' }).catch(() => {});
    await off({ off: 'dub.stop', tabId }).catch(() => {});
  };
  chrome.tabs.onRemoved.addListener((tabId) => { if (statuses.has(tabId)) void stop(tabId); });
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url && statuses.has(tabId)) void stop(tabId); });
  return {
    'dub.start': async (req) => {
      cancelled.delete(req.tabId);
      run(req).catch((e) => set({ tabId: req.tabId, lang: req.lang, title: req.title, state: 'failed', error: e instanceof Error ? e.message : String(e) }));
      return { tabId: req.tabId, lang: req.lang, title: req.title, state: 'transcribing', progress: 0 };
    },
    'dub.stop': ({ tabId }) => stop(tabId),
    'dub.status': ({ tabId }) => statuses.get(tabId) ?? null,
  };
}
