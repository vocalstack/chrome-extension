import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AheadGate, AheadTimeline, LEAD_S, RATE, toB64, fromB64, videoIdOf } from './ahead.ts';

/** `s` seconds of audio, each sample its own second on the video (to see what was sent). */
const audio = (s: number, from = 0) => Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => from + i / RATE);
function rig() {
  const sent: Float32Array[] = [];
  const tl = new AheadTimeline((pcm) => sent.push(pcm));
  const total = () => sent.reduce((a, b) => a + b.length, 0) / RATE;
  return { tl, sent, total };
}
const BIG = 1e9;

test('sends up to LEAD_S past the playhead, no further', () => {
  const { tl, total } = rig();
  tl.add({ vid: 'a', t: 10, pcm: audio(60) });
  tl.pump('a', 10, BIG);
  assert.equal(total(), LEAD_S);
  tl.pump('a', 25, BIG);
  assert.equal(total(), 15 + LEAD_S);
});

test('a budget caps each pump', () => {
  const { tl, total } = rig();
  tl.add({ vid: 'a', t: 0, pcm: audio(10) });
  tl.pump('a', 0, RATE * 2);
  assert.equal(total(), 2);
});

test('the transcript lands back on the video: across a seek, word by word', () => {
  const { tl } = rig();
  tl.add({ vid: 'a', t: 100, pcm: audio(5) });
  tl.pump('a', 100, BIG);
  // A seek: the next audio is from 300 s.
  tl.add({ vid: 'a', t: 300, pcm: audio(5) });
  tl.pump('a', 300, BIG);
  assert.deepEqual(tl.video(2), { t: 102, vid: 'a' });
  assert.deepEqual(tl.video(6), { t: 301, vid: 'a' });
  const ev = tl.onVideo({ type: 'committed', seq: 1, text: 'hi there', startS: 5.5, endS: 7, words: [{ s: 5.5, e: 6, t: 'hi' }, { s: 6.2, e: 7, t: 'there' }] });
  assert.equal(ev.vid, 'a');
  assert.equal(ev.startS, 300.5);
  assert.deepEqual(ev.words?.map((w) => [w.s, w.e]), [[300.5, 301], [301.2, 302]]);
});

test('a small hole is filled with silence; a small overlap is cut', () => {
  const { tl, sent, total } = rig();
  tl.add({ vid: 'a', t: 0, pcm: audio(2) });
  tl.add({ vid: 'a', t: 2.25, pcm: audio(1) });
  tl.pump('a', 0, BIG);
  assert.equal(total(), 3.25);
  assert.deepEqual(tl.video(3), { t: 3, vid: 'a' });
  tl.add({ vid: 'a', t: 3, pcm: audio(1, 1000) });
  tl.pump('a', 0, BIG);
  // 0.25 s of it was already sent.
  assert.equal(total(), 4);
  assert.equal(sent[sent.length - 1]![0], 1000.25);
});

test('audio behind the playhead, or of another video, is dropped unsent', () => {
  const { tl, total } = rig();
  tl.add({ vid: 'a', t: 0, pcm: audio(5) });
  tl.add({ vid: 'b', t: 50, pcm: audio(5) });
  tl.add({ vid: 'a', t: 60, pcm: audio(5) });
  tl.pump('a', 60, BIG);
  assert.equal(total(), 5);
  assert.deepEqual(tl.video(0), { t: 60, vid: 'a' });
});

test('the transcript waits for the video: lines, their translations; drafts never', () => {
  const g = new AheadGate();
  const line = (seq: number, startS: number) => ({ type: 'committed' as const, seq, text: `l${seq}`, startS, endS: startS + 2, vid: 'a' });
  assert.deepEqual(g.take({ type: 'draft', text: 'x' }, 'a', 0), []);
  assert.deepEqual(g.take(line(1, 0.3), 'a', 0), [line(1, 0.3)]);
  assert.deepEqual(g.take(line(2, 10), 'a', 0), []);
  assert.deepEqual(g.take({ type: 'translated', seq: 2, seqs: [1, 2], sentenceId: 7, lang: 'fr', text: 'fr' }, 'a', 0), []);
  assert.deepEqual(g.release('a', 9).map((e) => e.type), []);
  assert.deepEqual(g.release('a', 9.6).map((e) => e.type), ['committed', 'translated']);
  // A line of a video left behind is dropped.
  g.take(line(3, 50), 'a', 10);
  assert.deepEqual(g.release('b', 60), []);
});

test('a sentence waits until all its lines are out', () => {
  const g = new AheadGate();
  const line = (seq: number, startS: number) => ({ type: 'committed' as const, seq, text: `l${seq}`, startS, endS: startS + 2, vid: 'a' });
  g.take(line(1, 0), 'a', 0);
  g.take(line(2, 5), 'a', 0);
  assert.deepEqual(g.take({ type: 'sentence', sentenceId: 3, seqs: [1, 2], text: 'l1 l2', speaker: '0' }, 'a', 0), []);
  assert.deepEqual(g.release('a', 4.6).map((e) => e.type), ['committed', 'sentence']);
});

test('base64 both ways; YouTube ids from addresses', () => {
  const u = Uint8Array.from({ length: 70000 }, (_, i) => i & 0xff);
  assert.deepEqual(fromB64(toB64(u)), u);
  assert.equal(videoIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
  assert.equal(videoIdOf('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  assert.equal(videoIdOf('https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0'), 'abcdefghijk');
  assert.equal(videoIdOf('https://www.youtube.com/'), null);
});
