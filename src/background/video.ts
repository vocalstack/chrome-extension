/** A page video's one transcription, shared by the dub and by captions on
 *  the video: made once per address (and environment), remembered from
 *  the moment it is created, so a second feature started while the first
 *  is still transcribing waits on the same job. A reading-language change
 *  only translates it. Also: per-tab state in session storage, one key
 *  per tab, written one at a time. */

import { VocalStack } from '@vocalstack/js-sdk';
import type { Transcription } from '@vocalstack/contract';
import { accessToken } from '../lib/auth';
import { currentEnv } from '../lib/env';
import { RpcError, type Handlers } from '../lib/rpc';
import { MEDIA_PAGE } from '../lib/media';
import { scan } from './page';

export interface VideoIds { transcriptionId: string; recordingId: string }

const KNOWN = 'video.known';
/** The map an earlier version kept every address in (read, not written). */
const OLD_KNOWN = 'dub.known';
const TERMINAL = new Set(['done', 'failed', 'stopped', 'cropping']);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function vsClient(): Promise<VocalStack> {
  const env = await currentEnv();
  return new VocalStack({ baseUrl: env.api, token: () => accessToken() });
}

async function keyOf(url: string): Promise<string> {
  return `${(await currentEnv()).name}|${url}`;
}

async function known(key: string): Promise<VideoIds | null> {
  const k = `${KNOWN}:${key}`;
  const g = await chrome.storage.local.get([k, OLD_KNOWN]);
  return (g[k] as VideoIds | undefined) ?? (g[OLD_KNOWN] as Record<string, VideoIds> | undefined)?.[key] ?? null;
}

/** Each address its own key: two addresses never overwrite each other. */
async function remember(key: string, ids: VideoIds) {
  await chrome.storage.local.set({ [`${KNOWN}:${key}`]: ids });
}

/** The address's transcription, made or found: one promise per address
 *  while the worker runs, so two features started together share it. */
const inflight = new Map<string, Promise<VideoIds>>();

function idsFor(vs: VocalStack, key: string, req: { url: string; title?: string }): Promise<VideoIds> {
  let p = inflight.get(key);
  if (p) return p;
  p = (async () => {
    let ids = await known(key);
    if (ids) {
      const t = await vs.transcriptions.get(ids.transcriptionId).catch(() => null);
      if (!t || t.lifecycle !== 'active') {
        // Superseded (archived or purged meanwhile): a job still running
        // on it is stopped, then the video is transcribed again.
        if (t?.job && !TERMINAL.has(t.job.state)) await vs.recordings.stop(ids.recordingId).catch(() => {});
        ids = null;
      } else if (t.job && (t.job.state === 'failed' || t.job.state === 'stopped')) {
        // The same transcription, its job run again: never a second one.
        await vs.jobs.retry(ids.recordingId);
      }
    }
    if (!ids) {
      const t: Transcription = await vs.transcriptions.createFromUrl(req.url, { name: req.title || null });
      const rid = t.job?.recordingId ?? t.currentRecording?.recordingId ?? t.lastRecording?.recordingId;
      if (!rid) throw new RpcError('VocalStack did not start transcribing this video.');
      ids = { transcriptionId: t.id, recordingId: rid };
    }
    // Registered before the job finishes: the other feature waits on it.
    await remember(key, ids);
    return ids;
  })();
  inflight.set(key, p);
  p.catch(() => inflight.delete(key));
  return p;
}

/** The video's transcription, its job read every few seconds until done.
 *  `current` stops the waiting quietly (null); the job itself goes on, for
 *  the Library and for the other feature. */
export async function transcribeVideo(vs: VocalStack, req: { url: string; title?: string }, onProgress: (p: { progress: number } & VideoIds) => Promise<void>, current: () => Promise<boolean>): Promise<VideoIds | null> {
  const key = await keyOf(req.url);
  const ids = await idsFor(vs, key, req);
  await onProgress({ progress: 0, ...ids });
  for (;;) {
    if (!(await current())) return null;
    const job = await vs.jobs.get(ids.recordingId).catch(() => null);
    if (!job || job.state === 'done') break;
    if (job.state === 'failed' || job.state === 'stopped') {
      inflight.delete(key);
      throw new RpcError(job.error || 'VocalStack could not transcribe this video.');
    }
    await onProgress({ progress: (job.progress?.pct ?? 0) / 100, ...ids });
    await sleep(3000);
  }
  return ids;
}

const PLAYER_LABEL = 'Video player';

/** The video player for a page's video: its transcription (the one the
 *  dub and captions share, in the spoken language), and that
 *  transcription's share link, opened on the player while the job runs. */
export function registerVideo(): Handlers {
  return {
    'video.player': async ({ tabId, url, title }) => {
      const vs = await vsClient();
      const env = await currentEnv();
      const { transcriptionId } = await idsFor(vs, await keyOf(url), { url, title });
      const links = await vs.transcriptions.listShareLinks(transcriptionId);
      const link = links.find((l) => l.label === PLAYER_LABEL && !l.revokedAt)
        ?? await vs.transcriptions.createShareLink(transcriptionId, { label: PLAYER_LABEL, allowDownload: false, allowExport: false });
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      await chrome.tabs.create({ url: `${env.video}/${link.code}`, ...(tab ? { index: tab.index + 1, openerTabId: tabId, windowId: tab.windowId } : {}) });
    },
  };
}

/** What VocalStack transcribes for a tab's video: the main video's own
 *  file, an embedded player's page, or the page when it is a known media
 *  page (YouTube, Vimeo…). `strict`: nothing else (auto-captions); else
 *  the page address as a last try (the server says if it can't). */
export async function videoSource(tabId: number, pageUrl: string, strict: boolean): Promise<string | null> {
  const found = await scan(tabId).catch(() => null);
  const media = found?.media ?? [];
  const by = (k: string) => media.filter((m) => m.kind === k && !m.streamOnly).sort((a, b) => Number(!!b.playing) - Number(!!a.playing) || (b.durationS ?? 0) - (a.durationS ?? 0));
  const page = MEDIA_PAGE.test(pageUrl) ? pageUrl : null;
  return by('video')[0]?.url ?? by('embed')[0]?.url ?? page ?? (strict ? null : pageUrl);
}

/** Per-tab state in session storage (it outlives the sleeping worker):
 *  one key per tab, and each tab's writes one after another. */
export function tabStore<T>(prefix: string) {
  const k = (tabId: number) => `${prefix}:${tabId}`;
  const queue = new Map<number, Promise<unknown>>();
  const get = async (tabId: number): Promise<T | null> => ((await chrome.storage.session.get(k(tabId)))[k(tabId)] as T | undefined) ?? null;
  const put = async (tabId: number, v: T | null) => { if (v) await chrome.storage.session.set({ [k(tabId)]: v }); else await chrome.storage.session.remove(k(tabId)); };
  /** Read, change and write one tab's state with no other write between. */
  const update = <R>(tabId: number, fn: (v: T | null) => Promise<[T | null, R]> | [T | null, R]): Promise<R> => {
    const next = (queue.get(tabId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const [v, r] = await fn(await get(tabId));
      await put(tabId, v);
      return r;
    });
    queue.set(tabId, next);
    return next;
  };
  const all = async (): Promise<T[]> => Object.entries(await chrome.storage.session.get(null)).filter(([key]) => key.startsWith(`${prefix}:`)).map(([, v]) => v as T);
  return { get, put: (tabId: number, v: T | null) => update(tabId, () => [v, undefined]), update, all };
}
