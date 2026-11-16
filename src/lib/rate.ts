/** Asking for a rating in the store (Now's rating card, screens/page/RateCard.tsx).
 *
 *  Who is asked is chosen from what VocalStack did for them, never from
 *  what they said about it: no failed transcription since this version,
 *  every video's first line in under 45 s, at least 3 videos done,
 *  installed (or updated to this) at least 3 days ago. When: on Now, soon
 *  after they used a result (opened, copied, or watched captions for a
 *  while). At most 2 asks, 30 days apart; never again after Rate or
 *  "Don't ask again". Rate and Tell us are always offered together.
 *
 *  Kept in chrome.storage.local under one key, written by the background
 *  (live sessions, videos) and the panel (Now's transcriptions, uploads,
 *  the card). Only store installs are asked: an unpacked install can't
 *  rate. This file has no imports, so `npm test` runs it as is. */

export const RATE_KEY = 'rate';

export interface RateState {
  /** When this was first kept (the install, or the update that brought it). */
  since: number;
  videos: number;
  files: number;
  /** Transcriptions or sessions that failed (any, since `since`). */
  failed: number;
  /** The slowest time to a first line, in ms (live sessions and videos). */
  slowMs: number;
  /** The last time they used a result. */
  usedAt: number;
  asks: number;
  lastAskAt: number;
  /** The counts at the last ask: the next asks only once they grew. */
  askedAt: number;
  /** Rated, or said not to ask again. */
  done: boolean;
  /** Transcriptions and sessions already counted (newest last). */
  seen: string[];
}

export const FRESH = (now: number): RateState => ({ since: now, videos: 0, files: 0, failed: 0, slowMs: 0, usedAt: 0, asks: 0, lastAskAt: 0, askedAt: 0, done: false, seen: [] });

export const MIN_VIDEOS = 3;
export const MAX_FIRST_LINE_MS = 45_000;
export const MIN_AGE_MS = 3 * 86_400_000;
export const COOLDOWN_MS = 30 * 86_400_000;
export const MAX_ASKS = 2;
/** How recently a result must have been used. */
export const USED_WITHIN_MS = 10 * 60_000;

export type Why = 'ok' | 'done' | 'failed' | 'slow' | 'few' | 'young' | 'cooldown' | 'unchanged' | 'unused';

/** Whether the card may show now, and if not, why (the first reason). */
export function eligible(s: RateState, now: number): Why {
  if (s.done || s.asks >= MAX_ASKS) return 'done';
  if (s.failed > 0) return 'failed';
  if (s.slowMs >= MAX_FIRST_LINE_MS) return 'slow';
  if (s.videos < MIN_VIDEOS) return 'few';
  if (now - s.since < MIN_AGE_MS) return 'young';
  if (s.asks > 0 && now - s.lastAskAt < COOLDOWN_MS) return 'cooldown';
  if (s.asks > 0 && s.videos + s.files <= s.askedAt) return 'unchanged';
  if (now - s.usedAt > USED_WITHIN_MS) return 'unused';
  return 'ok';
}

/** "14 videos and 3 files", zero counts left out: each count and its word. */
export function summaryParts(s: Pick<RateState, 'videos' | 'files'>): { n: number; word: string }[] {
  return [{ n: s.videos, w: 'video' }, { n: s.files, w: 'file' }].filter((x) => x.n > 0).map((x) => ({ n: x.n, word: x.n === 1 ? x.w : `${x.w}s` }));
}

export const CHROME_ID = 'oaenfiioponhlnnemllhgdmgdmaceilk';
export const EDGE_ID = 'gdcnchohpgbnnakmhlcbcdkpnoadhjpa';

/** The listing to rate, from where this copy was installed (its id and
 *  update address), never from the browser: a Chrome Web Store install
 *  running in Edge is rated on the Chrome Web Store. Null: not a store
 *  install (unpacked), which can't be rated. */
export function storeUrl(id: string, updateUrl: string | undefined): string | null {
  if (!updateUrl) return null;
  if (id === EDGE_ID || /edge\.microsoft\.com/.test(updateUrl)) return `https://microsoftedge.microsoft.com/addons/detail/${EDGE_ID}`;
  if (id === CHROME_ID || /google\.com/.test(updateUrl)) return `https://chromewebstore.google.com/detail/${CHROME_ID}/reviews`;
  return null;
}

/* Storage: one read-modify-write at a time in each context. */

let chain: Promise<unknown> = Promise.resolve();

export async function readRate(): Promise<RateState> {
  const got = (await chrome.storage.local.get(RATE_KEY))[RATE_KEY] as Partial<RateState> | undefined;
  return { ...FRESH(Date.now()), ...got };
}

export function updateRate(f: (s: RateState) => RateState | void): Promise<RateState> {
  const next = chain.then(async () => {
    const s = await readRate();
    const out = f(s) ?? s;
    await chrome.storage.local.set({ [RATE_KEY]: { ...out, seen: out.seen.slice(-200) } });
    return out;
  });
  chain = next.catch(() => {});
  return next;
}

/** A transcription or session finished well (counted once per id). */
export function noteDone(id: string, kind: 'video' | 'file', firstLineMs?: number): Promise<RateState> {
  return updateRate((s) => {
    if (s.seen.includes(id)) return;
    s.seen.push(id);
    if (kind === 'video') s.videos++; else s.files++;
    if (firstLineMs !== undefined) s.slowMs = Math.max(s.slowMs, firstLineMs);
  });
}

/** A first line took this long (kept even if the session never ends well). */
export function noteFirstLine(ms: number): Promise<RateState> {
  return updateRate((s) => { s.slowMs = Math.max(s.slowMs, ms); });
}

/** A transcription or session failed (counted once per id). */
export function noteFailed(id: string): Promise<RateState> {
  return updateRate((s) => {
    if (s.seen.includes(`x:${id}`)) return;
    s.seen.push(`x:${id}`);
    s.failed++;
  });
}

/** They used a result: opened a transcript, copied one, or watched captions a while. */
export function noteUsed(): Promise<RateState> {
  return updateRate((s) => { s.usedAt = Date.now(); });
}
