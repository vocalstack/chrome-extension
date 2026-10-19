/** Dub playback, in the offscreen document: each sentence's voice clip
 *  (`GET /v1/recordings/:id/voice/:sentence?lang=`, made on demand by the
 *  server) is fetched a few seconds ahead and started when the page's video
 *  reaches the sentence. The content script reports the video's clock
 *  (`dub.sync`); a pause, a seek or a rate change stops what is playing and
 *  schedules again from the new position. */

import { VocalStack } from '@vocalstack/sdk';
import { rpc } from '../lib/rpc';
import type { DubSentence, OffCmd } from '../lib/offscreen';

/** Fetch and schedule this far ahead of the video, in media seconds. */
const AHEAD_S = 12;
/** A clock this far from where we expected it is a seek. */
const JUMP_S = 0.6;

interface Clock { t: number; at: number; paused: boolean; rate: number }

interface Dub {
  vs: VocalStack;
  recordingId: string;
  lang: string;
  sentences: DubSentence[];
  ctx: AudioContext;
  out: GainNode;
  buffers: Map<number, Promise<AudioBuffer | null>>;
  playing: Map<number, AudioBufferSourceNode>;
  /** Sentences already played since the last jump. */
  done: Set<number>;
  clock: Clock | null;
}

const dubs = new Map<number, Dub>();

export async function dubLoad(cmd: Extract<OffCmd, { off: 'dub.load' }>) {
  dubStop(cmd.tabId);
  const vs = new VocalStack({ baseUrl: cmd.api, token: () => rpc('auth.token') });
  const ctx = new AudioContext();
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const d: Dub = { vs, recordingId: cmd.recordingId, lang: cmd.lang, sentences: [...cmd.sentences].sort((a, b) => a.start - b.start), ctx, out, buffers: new Map(), playing: new Map(), done: new Set(), clock: null };
  dubs.set(cmd.tabId, d);
  // The first lines now, so playback can start at once.
  await Promise.all(d.sentences.slice(0, 3).map((s) => clip(d, s.id)));
}

export function dubStop(tabId: number) {
  const d = dubs.get(tabId);
  if (!d) return;
  stopAll(d);
  void d.ctx.close().catch(() => {});
  dubs.delete(tabId);
}

function mediaNow(c: Clock): number {
  return c.paused ? c.t : c.t + ((Date.now() - c.at) / 1000) * c.rate;
}

export function dubSync(cmd: Extract<OffCmd, { off: 'dub.sync' }>) {
  const d = dubs.get(cmd.tabId);
  if (!d) return;
  const next: Clock = { t: cmd.t, at: cmd.at, paused: cmd.paused, rate: cmd.rate || 1 };
  const prev = d.clock;
  d.clock = next;
  const jumped = !prev || prev.paused !== next.paused || prev.rate !== next.rate || Math.abs(mediaNow(prev) - mediaNow(next)) > JUMP_S;
  if (jumped) {
    stopAll(d);
    d.done.clear();
  }
  if (next.paused) return;
  void d.ctx.resume();
  schedule(d);
}

function stopAll(d: Dub) {
  for (const src of d.playing.values()) {
    try { src.stop(); } catch { /* not started */ }
  }
  d.playing.clear();
}

function clip(d: Dub, id: number): Promise<AudioBuffer | null> {
  let p = d.buffers.get(id);
  if (!p) {
    p = d.vs.recordings.voiceClip(d.recordingId, id, d.lang, { format: 'ogg' })
      .then((r) => r.arrayBuffer())
      .then((b) => d.ctx.decodeAudioData(b))
      .catch(() => null);
    d.buffers.set(id, p);
  }
  return p;
}

function schedule(d: Dub) {
  const c = d.clock;
  if (!c || c.paused) return;
  const t = mediaNow(c);
  for (const s of d.sentences) {
    if (s.start > t + AHEAD_S) break;
    if (s.end < t || d.done.has(s.id) || d.playing.has(s.id)) continue;
    void clip(d, s.id).then((buf) => {
      const cc = d.clock;
      if (!buf || !cc || cc !== c || cc.paused || d.done.has(s.id) || d.playing.has(s.id)) return;
      const now = mediaNow(cc);
      const delay = (s.start - now) / cc.rate;
      // Joined mid-sentence: start into the clip, unless most of it is gone.
      const into = delay < 0 ? -delay * cc.rate : 0;
      if (into > buf.duration * 0.6) { d.done.add(s.id); return; }
      const src = d.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = cc.rate;
      src.connect(d.out);
      src.start(d.ctx.currentTime + Math.max(0, delay), into);
      d.playing.set(s.id, src);
      d.done.add(s.id);
      src.onended = () => { if (d.playing.get(s.id) === src) d.playing.delete(s.id); };
    });
  }
}
