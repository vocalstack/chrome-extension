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
import { videoIdOf } from '../lib/ahead';
import { checkLink } from '../lib/linkCheck';
import { envOfPage, isOwn, playerState, shareCode, sharedJob, type PlayerState } from '../lib/shared';

export interface VideoIds { transcriptionId: string; recordingId: string }

/** The link check refused the address: nothing was made from it. */
export const LINK_REFUSED = 'link_refused';

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

const ytId = (url: string) => (/^https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|youtu\.be)\//i.test(url) ? (videoIdOf(url) ?? url.match(/youtu\.be\/([\w-]{6,})/)?.[1] ?? null) : null);

/** A YouTube video's transcription in the account, found on the server
 *  when this browser doesn't know it (made elsewhere, or the extension's
 *  storage cleared): the newest active one of the video's address, among
 *  the latest 200. A miss is remembered for a minute. */
const misses = new Map<string, number>();
async function onServer(vs: VocalStack, url: string): Promise<VideoIds | null> {
  const id = ytId(url);
  if (!id || (misses.get(id) ?? 0) > Date.now()) return null;
  const page = await vs.transcriptions.listPage({ limit: 200 }).catch(() => null);
  const t = page?.transcriptions.find((x) => x.lifecycle === 'active' && x.job?.source?.url && ytId(x.job.source.url) === id);
  if (!t?.job) {
    if (page) misses.set(id, Date.now() + 60_000);
    return null;
  }
  const ids = { transcriptionId: t.id, recordingId: t.job.recordingId };
  await remember(await keyOf(url), ids);
  return ids;
}

/** The address's transcription, made or found: one promise per address
 *  while the worker runs, so two features started together share it. */
const inflight = new Map<string, Promise<VideoIds>>();

function idsFor(vs: VocalStack, key: string, req: { url: string; title?: string }): Promise<VideoIds> {
  let p = inflight.get(key);
  if (p) return p;
  p = (async () => {
    let ids = (await known(key)) ?? (await onServer(vs, req.url));
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
      // Checked first, as any link (lib/linkCheck.ts): a page that isn't a recording is never sent.
      const c = await checkLink(vs, req.url);
      if (!c.go) throw new RpcError(c.problem, LINK_REFUSED);
      // A live stream has no whole file to fetch: never a job that can only
      // fail (captions take the tab's sound instead, as for any refusal).
      if (c.live) throw new RpcError('This is a live stream. Use Live Transcription to transcribe it as it plays.', LINK_REFUSED);
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
/** A YouTube video's player link, by environment and video id (any
 *  address of the video: a timestamp or a playlist doesn't matter). */
const PLAYER = 'video.player';

async function playerKey(url: string): Promise<string | null> {
  const id = ytId(url);
  return id ? `${PLAYER}:${(await currentEnv()).name}|yt:${id}` : null;
}

/** A video's transcription (the player's, the captions', the dub's): known
 *  here by this address or the plain watch address, or else found on the server. */
async function videoIds(url: string): Promise<VideoIds | null> {
  const id = ytId(url);
  const plain = id ? `https://www.youtube.com/watch?v=${id}` : url;
  return (await known(await keyOf(url))) ?? (plain !== url ? await known(await keyOf(plain)) : null) ?? (await onServer(await vsClient(), url));
}

/** The video's player link code: remembered, or else found on the
 *  server, on the transcription this extension made of the video (by
 *  this address or the plain watch address), and remembered from then. */
async function playerCode(url: string, key: string): Promise<string | null> {
  const got = ((await chrome.storage.local.get(key))[key] as { code?: string } | undefined)?.code;
  if (got) return got;
  const ids = await videoIds(url);
  if (!ids) return null;
  const links = await (await vsClient()).transcriptions.listShareLinks(ids.transcriptionId).catch(() => []);
  const code = links.find((l) => l.label === PLAYER_LABEL && !l.revokedAt)?.code ?? null;
  if (code) await chrome.storage.local.set({ [key]: { code } });
  return code;
}

/** A video's place on the player, or null: never given one here, or its
 *  link revoked since (then forgotten). The job is read without sign-in. */
async function playerOf(url: string): Promise<PlayerState | null> {
  let api: string;
  let code: string | null;
  let base: string;
  let key: string | null = null;
  if (isOwn(url)) {
    const env = envOfPage(url);
    const cur = await currentEnv();
    api = cur.name === env.name ? cur.api : env.api;
    base = url;
    code = shareCode(url);
  } else {
    key = await playerKey(url);
    if (!key) return null;
    code = await playerCode(url, key);
    const env = await currentEnv();
    api = env.api;
    base = code ? `${env.video}/${code}` : '';
    // Transcribed here (captions, the dub) but never opened on the player:
    // on offer all the same, its link made when it is opened.
    if (!code) {
      const ids = await videoIds(url);
      if (!ids) return null;
      const vs = await vsClient();
      const t = await vs.transcriptions.get(ids.transcriptionId).catch(() => null);
      if (!t || t.lifecycle !== 'active') return null;
      const job = t.job ?? await vs.jobs.get(ids.recordingId).catch(() => null);
      return playerState('', job ?? null);
    }
  }
  if (!code) return null;
  const job = await sharedJob(api, code).catch(() => null);
  if (job === 'gone') {
    if (key) await chrome.storage.local.remove(key);
    return null;
  }
  return playerState(base, job);
}

/** The video player for a page's video: its transcription (the one the
 *  dub and captions share, in the spoken language), and that
 *  transcription's share link, opened on the player while the job runs.
 *  Remembered per video, so Now and the page offer it again. */
export function registerVideo(): Handlers {
  return {
    'video.player': async ({ tabId: asked, url, title, here }, sender) => {
      const tabId = asked ?? sender.tab?.id;
      const env = await currentEnv();
      const key = await playerKey(url);
      let code = key ? await playerCode(url, key) : null;
      if (!code) {
        const vs = await vsClient();
        const { transcriptionId } = await idsFor(vs, await keyOf(url), { url, title });
        const links = await vs.transcriptions.listShareLinks(transcriptionId);
        const link = links.find((l) => l.label === PLAYER_LABEL && !l.revokedAt)
          ?? await vs.transcriptions.createShareLink(transcriptionId, { label: PLAYER_LABEL, allowDownload: false, allowExport: false });
        code = link.code;
        if (key) await chrome.storage.local.set({ [key]: { code } });
        // The page's prompt shows from now on.
        if (tabId !== undefined) void chrome.tabs.sendMessage(tabId, { playerKnown: true }).catch(() => {});
      }
      const tab = tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => null) : null;
      if (here && tab?.id !== undefined) {
        await chrome.tabs.update(tab.id, { url: `${env.video}/${code}` });
        return;
      }
      await chrome.tabs.create({ url: `${env.video}/${code}`, ...(tab ? { index: tab.index + 1, openerTabId: tab.id, windowId: tab.windowId } : {}) });
      // Watched there now: the video here stops, so the two don't play over each other.
      if (tab?.id !== undefined) void chrome.tabs.sendMessage(tab.id, { pauseVideo: true }).catch(() => {});
    },
    'video.known': ({ url }) => playerOf(url),
  };
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
