/** Reading ahead, offscreen half: each Cluster of the YouTube player's
 *  buffered audio (content/ahead.ts) is decoded to 16 kHz mono and put
 *  on the timeline (lib/ahead.ts), which sends it to the live session
 *  SPEED times faster than it plays, up to LEAD_S past the playhead.
 *  The transcript coming back waits for the video (AheadGate): the side
 *  panel and the captions get each line as it is said, together. */

import { AheadGate, AheadTimeline, fromB64, RATE, SPEED, type AheadChunk, type AheadClock, type AheadStats } from '../lib/ahead';
import type { LiveEvent } from '../lib/rpc';

const TICK_MS = 250;
/** Clusters that fail to decode, none having decoded, before giving up. */
const UNREADABLE = 3;

export interface FeedOut {
  /** Audio for the session, in order. */
  send(pcm: Float32Array): void;
  /** Not now (starting, paused, stopping): the audio waits. */
  held(): boolean;
  /** The audio cannot be read: the session ends with this. */
  fail(message: string): void;
  /** Transcript events the video has reached, in order. */
  publish(ev: LiveEvent): void;
}

export class AheadFeed {
  #out: FeedOut;
  #tl: AheadTimeline;
  #gate = new AheadGate();
  #ctx = new OfflineAudioContext(1, 1, RATE);
  #inits = new Map<string, Uint8Array>();
  #clock: (AheadClock & { at: number }) | null = null;
  #chain: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setInterval>;
  #decoded = 0;
  #failed = 0;
  #transcribedTo: number | null = null;

  constructor(out: FeedOut) {
    this.#out = out;
    this.#tl = new AheadTimeline((pcm) => out.send(pcm));
    this.#timer = setInterval(() => this.#pump(), TICK_MS);
  }

  /** The video's clock, and new audio: decoded in the order it came. */
  take(clock: AheadClock, chunk?: AheadChunk): Promise<void> {
    this.#clock = { ...clock, at: performance.now() };
    if (!chunk) return Promise.resolve();
    const p = this.#chain.then(() => this.#decode(chunk));
    this.#chain = p.catch(() => {});
    return p;
  }

  async #decode(c: AheadChunk) {
    if (c.init) this.#inits.set(c.key, fromB64(c.init));
    const init = this.#inits.get(c.key);
    if (!init) return;
    // One Cluster at a time, behind the init segment: each decodes alone
    // and keeps its own time on the video.
    for (const cl of c.clusters) {
      const body = fromB64(cl.d);
      const bytes = new Uint8Array(init.length + body.length);
      bytes.set(init);
      bytes.set(body, init.length);
      let audio: AudioBuffer;
      try {
        audio = await this.#ctx.decodeAudioData(bytes.buffer);
      } catch {
        if (++this.#failed >= UNREADABLE && !this.#decoded) this.#out.fail('This video’s audio couldn’t be read ahead of playback.');
        continue;
      }
      this.#decoded++;
      let pcm = mono(audio);
      // Should a decoder count from the stream's start, not the
      // Cluster's, it leads with silence that long: cut it.
      if (cl.t > 20 && audio.duration > cl.t) pcm = pcm.subarray(Math.round(cl.t * RATE));
      this.#tl.add({ vid: c.vid, t: cl.t, pcm });
    }
  }

  /** The video's playhead now, as last told; -Infinity before it was. */
  #now(): number {
    const c = this.#clock;
    if (!c) return -Infinity;
    return c.paused ? c.now : c.now + ((performance.now() - c.at) / 1000) * c.rate;
  }

  #pump() {
    for (const ev of this.#gate.release(this.#clock?.vid ?? null, this.#now())) this.#out.publish(ev);
    if (!this.#clock || this.#out.held()) return;
    this.#tl.pump(this.#clock.vid, this.#now(), (SPEED * RATE * TICK_MS) / 1000);
  }

  /** A transcript event: a line put on the video's clock, then out
   *  when the video gets there. */
  emit(ev: LiveEvent) {
    const e = ev.type === 'committed' ? this.#tl.onVideo(ev) : ev;
    if (e.type === 'committed' && e.vid === this.#clock?.vid) this.#transcribedTo = Math.max(this.#transcribedTo ?? -Infinity, e.endS);
    for (const x of this.#gate.take(e, this.#clock?.vid ?? null, this.#now())) this.#out.publish(x);
  }

  /** For Read-ahead debug. */
  stats(): AheadStats {
    const sent = this.#tl.sentTo();
    return {
      queuedS: this.#tl.queuedS(),
      sentTo: sent && sent.vid === this.#clock?.vid ? sent.t : null,
      transcribedTo: this.#transcribedTo,
      waiting: this.#gate.waiting,
      lines: this.#gate.arrived,
      decoded: this.#decoded,
      failed: this.#failed,
    };
  }

  close() {
    clearInterval(this.#timer);
    this.#tl.clear();
  }
}

function mono(a: AudioBuffer): Float32Array {
  if (a.numberOfChannels === 1) return a.getChannelData(0);
  const out = new Float32Array(a.length);
  for (let ch = 0; ch < a.numberOfChannels; ch++) {
    const d = a.getChannelData(ch);
    for (let i = 0; i < d.length; i++) out[i]! += d[i]! / a.numberOfChannels;
  }
  return out;
}
