/** When a link the person's own tab plays goes to VocalStack's server, and
 *  when its sound is taken from the tab instead. The positive rule: the
 *  browser plays it, so whenever the server can't make audio of the link
 *  (a refusal, another region, nothing or no audio, a live stream, no
 *  answer, a page where the media should be), the tab's sound is used,
 *  without an error first. The server keeps what it does better: public
 *  files, transcribed whole and fast. Failures that are not the link's
 *  (credit, a usage cap, a stop, our own fault, a file too long) stay as
 *  they are: the tab would not help.
 *
 *  The server says why by code (transcribe src/domain/source_check.rs
 *  `link_error_code` and `viewer_only`); an older server only in words,
 *  read here as a fallback. */

import { firstVariant, isManifestUrl, isSessionBound, manifestKind } from './media.ts';
import type { Reason } from './linkCheck.ts';

export type Way = 'tab' | 'keep';

/** A failed job's codes for a link the tab can play instead
 *  (`TranscriptionJob.errorCode`). Not `link_too_long` (the tab would
 *  record it all as it plays: the person picks a part), nor
 *  `link_not_shared` (a file host's own next step is to share it). */
const TAB_CODES = new Set(['link_refused', 'link_empty', 'link_live', 'link_not_found', 'link_unreachable', 'link_unreadable']);

/** An older server's words for the same failures (transcribe
 *  src/domain/public_error.rs, src/stream_source/sites.rs `refusal`). */
const TAB_WORDS = /refused access|asks for a sign-in|needs a sign-in|(?:post|video) is private|only on the websites its owner chose|in the region our servers|returned nothing to transcribe|this is a live stream|link is live|could not be reached|did not answer in time|nothing is at this link|that's a web page|that’s a web page|isn't audio or video we can read|isn’t audio or video we can read|is refusing requests from our servers|is not serving this video to us|redirects in a way|answered with an error|server had a problem|limiting requests/i;

/** The probe's reasons (`LinkProbe.reason`) the tab can do better on. */
const TAB_REASONS = new Set<Reason>(['forbidden', 'empty', 'unreachable', 'not_found', 'web_page', 'copy_protected', 'site_not_fetched', 'unknown']);

export interface JobLike {
  state: string;
  error?: string | null;
  errorCode?: string | null;
  attempts?: number;
  progress?: { pct?: number | null; fetchedBytes?: number | null } | null;
}

/** A finished job: was its failure the link's, one the tab plays past? */
export function jobWay(job: JobLike | null | undefined): Way {
  if (!job || job.state !== 'failed') return 'keep';
  const code = job.errorCode ?? null;
  if (code) return TAB_CODES.has(code) ? 'tab' : 'keep';
  return job.error && TAB_WORDS.test(job.error) ? 'tab' : 'keep';
}

/** A job still waiting on its link: tried again and again with nothing
 *  fetched (a server that never answers us, one that drops us), or one
 *  stopped like that. The tab plays it now; waiting on retries would only
 *  show a spinner. */
export function stalled(job: JobLike | null | undefined): boolean {
  if (!job || (job.state !== 'queued' && job.state !== 'fetching' && job.state !== 'stopped')) return false;
  if ((job.attempts ?? 0) < 2 || (job.progress?.fetchedBytes ?? 0) || (job.progress?.pct ?? 0)) return false;
  // Only the link's own words: a retry of ours (an engine, a restart) is not the link's.
  return !!job.error && TAB_WORDS.test(job.error);
}

/** A link that didn't answer is asked again after a while (our side may
 *  have been the one cut off); a refusal stays the tab's. */
const ASK_AGAIN_MS = 10 * 60_000;
export function askAgain(job: JobLike & { finishedAt?: string | null }, now = Date.now()): boolean {
  if (job.state !== 'failed') return false;
  const unreachable = job.errorCode ? job.errorCode === 'link_unreachable' : !!job.error && /could not be reached|did not answer in time|server had a problem|limiting requests|is refusing requests from our servers|is not serving this video to us/i.test(job.error);
  const at = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
  return unreachable && Number.isFinite(at) && now - at > ASK_AGAIN_MS;
}

/** A failure worth offering the tab for in a list (Library, the page's
 *  toasts), even for a link not playing anywhere now: refused, empty,
 *  live, no answer. */
export function tabOffered(job: JobLike | null | undefined): boolean {
  if (jobWay(job) !== 'tab') return false;
  const code = job?.errorCode;
  return code ? ['link_refused', 'link_empty', 'link_live', 'link_unreachable'].includes(code) : true;
}

/** A finished job that got next to no audio from its link (none kept,
 *  or under two seconds): what the server fetched was not what the tab
 *  plays. */
export function emptyAudio(job: { state: string; hasAudio?: boolean; source?: { durationS?: number | null } | null }): boolean {
  if (job.state !== 'done') return false;
  const d = job.source?.durationS;
  return job.hasAudio === false || (typeof d === 'number' && d < 2);
}

/** The probe's verdict on a link (lib/linkCheck.ts `Checked`), with what
 *  the browser itself read of a playlist (`manifestKind`; null when it
 *  isn't one, or couldn't be read). */
export interface ProbeLike { go: boolean; live?: boolean; viewerOnly?: boolean; reason?: Reason }

/** Before anything is made: the server fetches the link, the tab's sound
 *  is used, or neither (the probe's sentence says why: a meeting, a file
 *  too long, something that isn't a recording). */
export function linkWay(url: string, probe: ProbeLike | null, browser: 'live' | 'vod' | 'master' | null = null): 'server' | 'tab' | 'refuse' {
  if (isSessionBound(url)) return 'tab';
  if (browser === 'live') return 'tab';
  if (!probe) return 'server';
  if (probe.go) return probe.live && browser !== 'vod' ? 'tab' : 'server';
  if (probe.viewerOnly) return 'tab';
  return probe.reason === undefined || TAB_REASONS.has(probe.reason) ? 'tab' : 'refuse';
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A playlist as this browser reads it (it may play only here: the
 *  viewer's address, cookies and country): live or not. A master playlist
 *  is told by its first rendition. Null when it isn't a playlist, or the
 *  browser can't read it either. */
export async function browserManifest(url: string, get: Fetch = fetch, withinMs = 4000): Promise<'live' | 'vod' | null> {
  if (!isManifestUrl(url)) return null;
  const read = async (u: string): Promise<{ text: string; at: string } | null> => {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), withinMs);
    try {
      const r = await get(u, { credentials: 'include', cache: 'no-store', signal: stop.signal });
      if (!r.ok) return null;
      const text = await r.text();
      return { text: text.slice(0, 512 * 1024), at: r.url || u };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const top = await read(url);
  if (!top) return null;
  const kind = manifestKind(top.text);
  if (kind !== 'master') return kind;
  const v = firstVariant(top.text, top.at);
  const sub = v ? await read(v) : null;
  const k = sub ? manifestKind(sub.text) : null;
  return k === 'master' ? null : k;
}
