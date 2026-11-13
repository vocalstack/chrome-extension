/** What a click on a Library item does: finished ones play here, in the
 *  panel's player (screens/Player.tsx, the @vocalstack/player package);
 *  the rest say why not. No chrome.* calls here. */

import type { SearchHit, Transcription } from '@vocalstack/contract';

/** What the player is given. */
export interface PlayTarget {
  transcriptionId: string;
  name: string;
  /** Start here, in seconds (a search hit's line). */
  startAt?: number;
  /** Words to mark in the transcript (the search that found it). */
  find?: string;
  /** Its Dashboard page, for "Open in Dashboard". */
  path: string;
}

/** Why an item has nothing to play yet:
 *  `live` it is being recorded now; `working` it is still being fetched or
 *  transcribed; `failed` it failed or was stopped; `trim` it waits to be
 *  trimmed in the Dashboard; `blocked` VocalStack disabled it; `empty` a
 *  live transcription nothing was recorded in. */
export type NoPlay = 'live' | 'working' | 'failed' | 'trim' | 'blocked' | 'empty';

export type Play = { target: PlayTarget; why?: undefined } | { target?: undefined; why: NoPlay };

type Item = Pick<Transcription, 'id' | 'name' | 'live'> & {
  blocked?: unknown;
  job?: { state: string } | null;
  state?: string | null;
};

export function playOf(t: Item): Play {
  if (t.blocked) return { why: 'blocked' };
  const state = t.state;
  if (state === 'pending' || state === 'live' || state === 'paused') return { why: 'live' };
  const job = t.job;
  if (job) {
    if (job.state === 'failed' || job.state === 'stopped') return { why: 'failed' };
    if (job.state === 'cropping') return { why: 'trim' };
    if (job.state !== 'done') return { why: 'working' };
    return { target: { transcriptionId: t.id, name: t.name, path: `/transcriptions/${t.id}` } };
  }
  if (state === 'processing') return { why: 'working' };
  if (state !== 'ended' && state !== 'finalized') return { why: 'empty' };
  // A finished live transcription: its transcript, not the live screen.
  return { target: { transcriptionId: t.id, name: t.name, path: `/transcriptions/${t.id}` } };
}

/** A search hit plays at its line. Not one in a transcription still going,
 *  nor one of a broadcast's own (the player opens transcriptions): those
 *  open in the Dashboard. `path` is the hit's Dashboard address. */
export function hitPlay(h: Pick<SearchHit, 'transcriptionId' | 'mediaStart' | 'live' | 'linkName'>, ownBroadcasts: Set<string>, q: string, path: string): PlayTarget | null {
  if (h.live || ownBroadcasts.has(h.transcriptionId)) return null;
  const find = q.trim();
  return { transcriptionId: h.transcriptionId, name: h.linkName, startAt: Math.max(0, h.mediaStart), ...(find ? { find } : {}), path };
}

/** What a row that cannot play says to a screen reader and on hover. */
export const NO_PLAY_TEXT: Record<NoPlay, string> = {
  live: 'Being recorded now. It plays here once it has ended.',
  working: 'Still being transcribed. It plays here once it is ready.',
  failed: 'It could not be transcribed, so there is nothing to play.',
  trim: 'It waits to be trimmed in the Dashboard.',
  blocked: 'VocalStack disabled this transcription.',
  empty: 'Nothing has been recorded in it yet.',
};
