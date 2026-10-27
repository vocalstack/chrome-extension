/** Reading ahead: a YouTube video's audio, taken from the player's buffer
 *  before it plays (content/ahead.ts), is sent to a live session faster
 *  than it plays (offscreen/ahead.ts). The session's clock is then not
 *  the video's: every stretch of audio sent is noted (a span: where it
 *  starts in the session, and where on which video), and the
 *  transcript's times, word by word, are put back on the video's clock,
 *  so the captions wait for the video to get there (content/overlay.ts).
 *
 *  This file: what the content script sends, and the timeline. */

import type { LiveEvent } from './rpc';

export const RATE = 16000;
/** How much faster than it plays the audio is sent. */
export const SPEED = 8;
/** How far past the video's playhead audio is sent: transcribed early
 *  enough to show on time, and never much of what nobody watches. */
export const LEAD_S = 20;
/** A hole or overlap up to this long is evened out (silence, or cut);
 *  longer, the audio after it starts a new span (a seek). */
export const SNAP_S = 0.5;
/** Audio this far behind the playhead is dropped unsent (a seek passed it). */
export const BEHIND_S = 1;

/** The DOM event content/ahead.ts tells the captions (content/overlay.ts)
 *  with how far past the playhead the transcript reaches, in seconds
 *  (null: nothing yet, or no session reading ahead). */
export const AHEAD_LEAD = 'vocalstack-ahead-lead';

/** Settings → Read-ahead debug: the numbers on the video (content/ahead.ts). */
export const AHEAD_DEBUG = 'aheadDebug';

/** How a session reading ahead is doing, for Read-ahead debug. Times are
 *  on the video's clock. */
export interface AheadStats {
  /** Decoded audio waiting to be sent, in seconds. */
  queuedS: number;
  /** Where the audio sent so far ends (null: none yet). */
  sentTo: number | null;
  /** Where the transcript so far ends. */
  transcribedTo: number | null;
  /** Lines waiting for the video to get there. */
  waiting: number;
  /** The latest lines: how many seconds before their first word they came
   *  back (negative: late, the word was already said). */
  lines: { seq: number; early: number; text: string }[];
  decoded: number;
  failed: number;
}

/** The video's clock, as the content script last saw it. */
export interface AheadClock {
  /** The YouTube video id on the page (null: none). */
  vid: string | null;
  now: number;
  paused: boolean;
  rate: number;
}

/** Clusters of one init segment (`key`), base64, with their times on the video. */
export interface AheadChunk {
  vid: string;
  key: string;
  /** The init segment, the first time this key is sent. */
  init?: string;
  clusters: { t: number; d: string }[];
}

/** Audio decoded and waiting: `t` seconds on video `vid`. */
export interface Piece { vid: string; t: number; pcm: Float32Array }
interface Span { at: number; t: number; vid: string }
type Committed = Extract<LiveEvent, { type: 'committed' }>;

export class AheadTimeline {
  #queue: Piece[] = [];
  #spans: Span[] = [];
  /** Samples sent so far: where the next audio lands in the session. */
  #sent = 0;
  #send: (pcm: Float32Array) => void;

  constructor(send: (pcm: Float32Array) => void) {
    this.#send = send;
  }

  /** Decoded audio, in time order (a seek back puts it before the rest). */
  add(p: Piece) {
    let i = this.#queue.length;
    while (i > 0 && this.#queue[i - 1]!.t > p.t) i--;
    this.#queue.splice(i, 0, p);
  }

  /** Send what is due, at most `budget` samples: audio up to LEAD_S past
   *  the playhead `now` of video `vid`. Behind it, or of another video,
   *  it is dropped. */
  pump(vid: string | null, now: number, budget: number) {
    while (budget > 0 && this.#queue.length) {
      const p = this.#queue[0]!;
      if (p.vid !== vid || p.t + p.pcm.length / RATE < now - BEHIND_S) { this.#queue.shift(); continue; }
      const room = Math.floor((now + LEAD_S - p.t) * RATE);
      if (room <= 0) break;
      const n = Math.min(budget, room, p.pcm.length);
      this.#put(p.vid, p.t, p.pcm.subarray(0, n));
      budget -= n;
      if (n === p.pcm.length) this.#queue.shift();
      else { p.t += n / RATE; p.pcm = p.pcm.subarray(n); }
    }
  }

  #put(vid: string, t: number, pcm: Float32Array) {
    const last = this.#spans[this.#spans.length - 1];
    const gap = last && last.vid === vid ? t - (last.t + this.#sent / RATE - last.at) : Infinity;
    if (Math.abs(gap) > SNAP_S) this.#spans.push({ at: this.#sent / RATE, t, vid });
    else if (gap > 0) this.#out(new Float32Array(Math.round(gap * RATE)));
    else if (gap < 0) pcm = pcm.subarray(Math.min(pcm.length, Math.round(-gap * RATE)));
    if (pcm.length) this.#out(pcm);
  }

  #out(pcm: Float32Array) {
    this.#send(pcm);
    this.#sent += pcm.length;
  }

  /** Where second `x` of the session's audio is on the video. */
  video(x: number): { t: number; vid: string } | null {
    let lo = 0, hi = this.#spans.length - 1, i = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (this.#spans[m]!.at <= x + 1e-6) { i = m; lo = m + 1; } else hi = m - 1;
    }
    const s = this.#spans[i];
    return s ? { t: s.t + (x - s.at), vid: s.vid } : null;
  }

  /** A committed line on the video's clock: when the captions show it,
   *  and each of its words. */
  onVideo(ev: Committed): Committed {
    const a = this.video(ev.startS);
    if (!a) return ev;
    // A word past a seek keeps its place in the line, not the jump.
    const at = (x: number) => {
      const m = this.video(x);
      return m && m.vid === a.vid && m.t >= a.t ? m.t : a.t + (x - ev.startS);
    };
    return { ...ev, startS: a.t, endS: at(ev.endS), words: ev.words?.map((w) => ({ ...w, s: at(w.s), e: at(w.e) })), vid: a.vid };
  }

  /** Decoded audio not sent yet, in seconds. */
  queuedS(): number {
    return this.#queue.reduce((a, p) => a + p.pcm.length, 0) / RATE;
  }

  /** Where on the video the audio sent so far ends. */
  sentTo(): { t: number; vid: string } | null {
    return this.video(this.#sent / RATE);
  }

  clear() {
    this.#queue = [];
  }
}

/** A line goes out this long before its first word: it is on the page
 *  when the word is said. */
export const EARLY_S = 0.5;

/** Read ahead, the transcript goes out as the video reaches it, to the
 *  side panel and the captions alike: a line (on the video's clock)
 *  waits until the playhead gets there, a translation or a sentence
 *  until its lines are out. Drafts never go out: they are the audio sent, not said. */
export class AheadGate {
  #waiting: LiveEvent[] = [];
  /** Lines waiting, by seq. */
  #held = new Set<number>();
  /** How early the latest lines came back (AheadStats.lines). */
  #arrived: AheadStats['lines'] = [];

  get waiting(): number {
    return this.#held.size;
  }

  get arrived(): AheadStats['lines'] {
    return this.#arrived;
  }

  /** A new event: and whatever can go out now, in order. */
  take(ev: LiveEvent, vid: string | null, now: number): LiveEvent[] {
    if (ev.type === 'draft' || ev.type === 'draftTranslated') return [];
    this.#waiting.push(ev);
    if (ev.type === 'committed') {
      this.#held.add(ev.seq);
      if (now > -Infinity) this.#arrived = [...this.#arrived.filter((x) => x.seq !== ev.seq), { seq: ev.seq, early: ev.startS - now, text: ev.text }].slice(-12);
    }
    return this.release(vid, now);
  }

  /** What video `vid`'s playhead at `now` has reached, in order. A line
   *  of another video is dropped. */
  release(vid: string | null, now: number): LiveEvent[] {
    const out: LiveEvent[] = [];
    const keep: LiveEvent[] = [];
    for (const ev of this.#waiting) {
      if (ev.type === 'committed') {
        if (ev.vid && vid && ev.vid !== vid) { this.#held.delete(ev.seq); continue; }
        if (ev.startS - EARLY_S <= now) { this.#held.delete(ev.seq); out.push(ev); } else keep.push(ev);
      } else if (ev.type === 'translated' && (ev.seqs ?? [ev.seq]).some((q) => this.#held.has(q))) keep.push(ev);
      else if (ev.type === 'sentence' && ev.seqs.some((q) => this.#held.has(q))) keep.push(ev);
      else out.push(ev);
    }
    this.#waiting = keep;
    return out;
  }
}

export function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/** A YouTube address's video id (watch, shorts, embed, live), else null. */
export function videoIdOf(href: string): string | null {
  try {
    const u = new URL(href);
    return u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1] ?? null;
  } catch {
    return null;
  }
}
