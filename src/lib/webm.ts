/** Just enough WebM (Matroska) to follow a player's audio as it is
 *  appended to a SourceBuffer (content/ahead.ts): the init segment (EBML
 *  header, Segment head, Info, Tracks) and the Clusters after it, each
 *  with its time on the video. The bytes come in whatever pieces the
 *  player appends; a Cluster is handed out once it is whole. */

export const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
/** Compressed or encrypted frames: nothing a decoder can read alone. */
const CONTENT_ENCODINGS = 0x6d80;
export const CLUSTER = 0x1f43b675;
const TIMECODE = 0xe7;
/** No element of an audio stream comes near this: a size above it is garbage. */
const MAX_SIZE = 64 << 20;

/** An element's head: its id, its body's size (null: unknown), and the head's length. */
export interface Head { id: number; size: number | null; len: number }

/** The element head at `p`; null when the bytes end first, 'bad' when
 *  they are no element head. */
export function readHead(b: Uint8Array, p: number): Head | null | 'bad' {
  if (p >= b.length) return null;
  const f = b[p]!;
  const il = Math.clz32(f) - 23;
  if (!f || il > 4) return 'bad';
  if (p + il >= b.length) return null;
  let id = 0;
  for (let i = 0; i < il; i++) id = id * 256 + b[p + i]!;
  const q = p + il;
  const s0 = b[q]!;
  const sl = Math.clz32(s0) - 23;
  if (!s0) return 'bad';
  if (q + sl > b.length) return null;
  const mask = 0xff >> sl;
  let size = s0 & mask;
  let ones = size === mask;
  for (let i = 1; i < sl; i++) {
    const x = b[q + i]!;
    size = size * 256 + x;
    if (x !== 0xff) ones = false;
  }
  if (!ones && size > MAX_SIZE && id !== SEGMENT) return 'bad';
  return { id, size: ones ? null : size, len: il + sl };
}

function readUint(b: Uint8Array, p: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[p + i]!;
  return v;
}

/** The children of the element whose body is [from, to), while whole. */
function* children(b: Uint8Array, from: number, to: number): Generator<{ id: number; body: number; size: number }> {
  let p = from;
  while (p < to) {
    const h = readHead(b, p);
    if (!h || h === 'bad' || h.size === null || p + h.len + h.size > to) return;
    yield { id: h.id, body: p + h.len, size: h.size };
    p += h.len + h.size;
  }
}

/** An init segment: where it ends (the first Cluster, or the bytes' end),
 *  the timecode scale (ns per tick), and whether its frames are
 *  encoded (encrypted, compressed) so no decoder reads them alone.
 *  Null when `b` does not start with one. */
export function parseInit(b: Uint8Array): { end: number; scale: number; encoded: boolean } | null {
  const h = readHead(b, 0);
  if (!h || h === 'bad' || h.id !== EBML || h.size === null) return null;
  let p = h.len + h.size;
  const seg = readHead(b, p);
  if (!seg || seg === 'bad' || seg.id !== SEGMENT) return null;
  p += seg.len;
  let scale = 1e6;
  let encoded = false;
  while (p < b.length) {
    const c = readHead(b, p);
    if (!c || c === 'bad' || c.id === CLUSTER || c.size === null) break;
    const body = p + c.len;
    const end = Math.min(b.length, body + c.size);
    if (c.id === INFO) for (const x of children(b, body, end)) if (x.id === TIMECODE_SCALE) scale = readUint(b, x.body, x.size);
    if (c.id === TRACKS) {
      for (const tr of children(b, body, end)) if (tr.id === TRACK_ENTRY) for (const x of children(b, tr.body, tr.body + tr.size)) if (x.id === CONTENT_ENCODINGS) encoded = true;
    }
    p = body + c.size;
  }
  return { end: Math.min(p, b.length), scale, encoded };
}

/** The first Cluster id at or after `from`, or -1. */
function findCluster(b: Uint8Array, from: number): number {
  for (let i = Math.max(0, from); i + 3 < b.length; i++) {
    if (b[i] === 0x1f && b[i + 1] === 0x43 && b[i + 2] === 0xb6 && b[i + 3] === 0x75) return i;
  }
  return -1;
}

/** A Cluster's Timecode, in ticks. */
function clusterTicks(b: Uint8Array, from: number, to: number): number | null {
  for (const x of children(b, from, to)) if (x.id === TIMECODE) return readUint(b, x.body, x.size);
  return null;
}

export interface WebmCluster {
  /** Seconds on the video: the Cluster's timecode plus the
   *  SourceBuffer's timestampOffset when it was appended. */
  t: number;
  /** The whole Cluster element. */
  data: Uint8Array;
}

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** One SourceBuffer's WebM, append by append. */
export class WebmReader {
  /** The latest init segment. */
  init: Uint8Array | null = null;
  /** Its frames are encoded: no decoder reads them alone. */
  encoded = false;
  #scale = 1e6;
  #buf: Uint8Array = new Uint8Array(0);
  /** The timestampOffset of the append the unread bytes began in. */
  #offset = 0;

  /** One append, and the SourceBuffer's timestampOffset at the time.
   *  Says whether it began with a new init segment, and hands out the
   *  Clusters it completed. */
  push(bytes: Uint8Array, offset = 0): { init: boolean; clusters: WebmCluster[] } {
    let init = false;
    const i = bytes.length >= 4 && readUint(bytes, 0, 4) === EBML ? parseInit(bytes) : null;
    if (i) {
      this.init = bytes.slice(0, i.end);
      this.#scale = i.scale;
      this.encoded = i.encoded;
      this.#buf = new Uint8Array(0);
      bytes = bytes.subarray(i.end);
      init = true;
    }
    if (!this.#buf.length) this.#offset = offset;
    this.#buf = join(this.#buf, bytes);
    return { init, clusters: this.#drain(offset) };
  }

  /** The SourceBuffer was reset (abort()): a half-read element is dropped. */
  reset() {
    this.#buf = new Uint8Array(0);
  }

  #drain(offset: number): WebmCluster[] {
    const out: WebmCluster[] = [];
    const b = this.#buf;
    let p = 0;
    for (;;) {
      const h = readHead(b, p);
      if (h === null) break;
      if (h === 'bad' || (h.size === null && h.id !== CLUSTER)) {
        // Lost the thread: pick it up at the next Cluster.
        const q = findCluster(b, p + 1);
        if (q < 0) { p = Math.max(p, b.length - 3); break; }
        p = q;
        continue;
      }
      let end: number;
      if (h.size !== null) end = p + h.len + h.size;
      else {
        // A Cluster of unknown size ends where the next one starts.
        const q = findCluster(b, p + h.len);
        if (q < 0) break;
        end = q;
      }
      if (end > b.length) break;
      if (h.id === CLUSTER) {
        const ticks = clusterTicks(b, p + h.len, end);
        if (ticks !== null) out.push({ t: (ticks * this.#scale) / 1e9 + this.#offset, data: b.slice(p, end) });
      }
      p = end;
      this.#offset = offset;
    }
    this.#buf = b.slice(p);
    return out;
  }
}
