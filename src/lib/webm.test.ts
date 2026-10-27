import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebmReader, parseInit, readHead } from './webm.ts';

/** An element: its id's bytes, then its size as an 8-byte vint, then the body. */
function el(id: number[], ...body: Uint8Array[]): Uint8Array {
  const n = body.reduce((a, b) => a + b.length, 0);
  const size = [0x01, 0, 0, 0, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return cat(new Uint8Array([...id, ...size]), ...body);
}
const bytes = (...b: number[]) => new Uint8Array(b);
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

const SEGMENT_UNKNOWN = bytes(0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], bytes(0x77, 0x65, 0x62, 0x6d)));
const info = (scale: number) => el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], bytes((scale >>> 16) & 0xff, (scale >>> 8) & 0xff, scale & 0xff)));
const tracks = (encoded: boolean) => el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xd7], bytes(1)), ...(encoded ? [el([0x6d, 0x80], bytes(0))] : [])));
const init = (scale = 1_000_000, encoded = false) => cat(header, SEGMENT_UNKNOWN, info(scale), tracks(encoded));
/** A Cluster at `ticks`, with a block of `n` filler bytes. */
const cluster = (ticks: number, n = 40) => el([0x1f, 0x43, 0xb6, 0x75], el([0xe7], bytes((ticks >>> 8) & 0xff, ticks & 0xff)), el([0xa3], new Uint8Array(n).fill(0x11)));

test('element heads: id, size, length; unknown size; short and bad bytes', () => {
  assert.deepEqual(readHead(bytes(0xe7, 0x82, 0, 0), 0), { id: 0xe7, size: 2, len: 2 });
  assert.deepEqual(readHead(SEGMENT_UNKNOWN, 0), { id: 0x18538067, size: null, len: 12 });
  assert.equal(readHead(bytes(0x1f, 0x43), 0), null);
  assert.equal(readHead(bytes(0x00, 0x81), 0), 'bad');
});

test('an init segment: where it ends, its scale, whether it is encoded', () => {
  const i = init(1000);
  const parsed = parseInit(cat(i, cluster(0)));
  assert.deepEqual(parsed, { end: i.length, scale: 1000, encoded: false });
  assert.equal(parseInit(init(1000, true))?.encoded, true);
  assert.equal(parseInit(cluster(0)), null);
});

test('clusters come out whole, with their time, however the bytes are cut', () => {
  // Timecode scale 1 ms (1e6 ns): ticks are milliseconds.
  const stream = cat(init(), cluster(0), cluster(5000), cluster(10000));
  const whole = new WebmReader().push(stream);
  assert.equal(whole.init, true);
  assert.deepEqual(whole.clusters.map((c) => c.t), [0, 5, 10]);
  // A player appends the init segment whole, then media in any pieces.
  const media = stream.subarray(init().length);
  for (const cut of [1, 7, 33, 64, 101]) {
    const r = new WebmReader();
    r.push(init());
    const ts: number[] = [];
    for (let p = 0; p < media.length; p += cut) ts.push(...r.push(media.subarray(p, p + cut)).clusters.map((c) => c.t));
    assert.deepEqual(ts, [0, 5, 10], `cut every ${cut} bytes`);
  }
});

test('timestampOffset is added; the init is kept; garbage is skipped to the next cluster', () => {
  const r = new WebmReader();
  r.push(init());
  assert.ok(r.init);
  assert.deepEqual(r.push(cluster(2000), 100).clusters.map((c) => c.t), [102]);
  assert.deepEqual(r.push(cat(bytes(0x00, 0x00, 0x05), cluster(3000))).clusters.map((c) => c.t), [3]);
});

test('reset drops a half-read cluster', () => {
  const r = new WebmReader();
  r.push(init());
  const c = cluster(4000);
  r.push(c.subarray(0, 20));
  r.reset();
  assert.deepEqual(r.push(cluster(6000)).clusters.map((x) => x.t), [6]);
});
