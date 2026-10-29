/** Reading ahead, content half (YouTube): the player's audio as it
 *  buffers, before it plays. The page-world hook (entrypoints/
 *  buffer.content.ts) copies each append to an audio SourceBuffer here;
 *  this keeps the WebM Clusters (lib/webm.ts) of the last few minutes,
 *  and while a live session reads ahead on this tab, sends each Cluster
 *  of the main player once, with its time on the video, and the video's
 *  clock, to the offscreen document (offscreen/ahead.ts). Ads are
 *  neither kept nor sent. With Settings → Read-ahead debug, a panel on
 *  the page says how far ahead each stage is (content/aheadHud.ts), and
 *  the console logs how early each line came back. */

import { WebmReader, type WebmCluster } from '../lib/webm';
import { AHEAD_DEBUG, AHEAD_LEAD, toB64, videoIdOf, type AheadChunk, type AheadClock, type AheadStats } from '../lib/ahead';
import type { OffAnswer, OffCmd } from '../lib/offscreen';
import { mainVideo } from './video';
import { makeHud, type HudRow } from './aheadHud';

const TAG = 'vocalstack.buffer';
/** Clusters kept, all buffers together: some 20 minutes of YouTube's Opus. */
const KEEP_BYTES = 24 << 20;
/** Clusters this far behind the playhead are never sent (a seek left them). */
const STALE_S = 30;
const CLOCK_MS = 1000;

/** The Clusters after one init segment. */
interface Stream { key: string; src: string; init: Uint8Array; encoded: boolean; clusters: Kept[] }
interface Kept extends WebmCluster { vid: string | null }
/** One audio SourceBuffer of the page. */
interface Track { type: string; src: string; reader: WebmReader; stream: Stream | null }
type HookMsg = { sb: number; type?: string; src?: string; offset?: number; data?: ArrayBuffer; abort?: boolean };

/** YouTube's player (its video), else the frame's main video. A Short
 *  plays in a player of its own: the watch player stays in the page then,
 *  hidden, and the Short is the reel on screen. */
function playerVideo(): HTMLVideoElement | null {
  if (location.pathname.startsWith('/shorts/')) return document.querySelector<HTMLVideoElement>('ytd-reel-video-renderer[is-active] video, #shorts-player video') ?? mainVideo();
  return document.querySelector<HTMLVideoElement>('#movie_player video') ?? mainVideo();
}
const adShowing = () => !!document.querySelector('#movie_player.ad-showing');

export function startAhead() {
  const tracks = new Map<number, Track>();
  const streams: Stream[] = [];
  let kept = 0;
  let made = 0;
  let asked = false;
  /** The session reading ahead on this tab, and what it was sent. */
  let run: { id: string; sent: Set<string>; inits: Set<string> } | null = null;
  let outbox: { s: Stream; c: Kept }[] = [];
  let flushTimer: number | undefined;
  let clockTimer: number | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  /** The video's place before an ad took the player over. */
  let lastNow = 0;
  /** Read-ahead debug: on, the offscreen document's last answer, the lines logged. */
  let debug = false;
  let stats: AheadStats | null = null;
  const logged = new Set<number>();
  const hud = makeHud();
  let hudTimer: number | undefined;

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const m = (e.data as Record<string, HookMsg> | null)?.[TAG];
    if (!m || typeof m.sb !== 'number') return;
    let tr = tracks.get(m.sb);
    if (!tr) { tr = { type: '', src: '', reader: new WebmReader(), stream: null }; tracks.set(m.sb, tr); }
    if (m.type) tr.type = m.type;
    if (m.src) tr.src = m.src;
    if (m.abort) tr.reader.reset();
    if (m.data && /^audio\/webm/i.test(tr.type)) take(tr, new Uint8Array(m.data), m.offset ?? 0);
  });

  function take(tr: Track, bytes: Uint8Array, offset: number) {
    const got = tr.reader.push(bytes, offset);
    if (got.init && tr.reader.init) {
      tr.stream = { key: String(++made), src: tr.src, init: tr.reader.init, encoded: tr.reader.encoded, clusters: [] };
      streams.push(tr.stream);
      resume();
    }
    const s = tr.stream;
    if (!s || !got.clusters.length || adShowing()) return;
    // The address names the video playing, not one YouTube buffers ahead
    // for later (the next Short): that one's audio is named when it plays.
    const vid = tr.src && tr.src === playerVideo()?.src ? videoIdOf(location.href) : null;
    for (const c of got.clusters) {
      const k: Kept = { ...c, vid };
      s.clusters.push(k);
      kept += c.data.length;
      offer(s, k);
    }
    trim();
  }

  function trim() {
    while (kept > KEEP_BYTES) {
      const s = streams.find((x) => x.clusters.length);
      if (!s) break;
      kept -= s.clusters.shift()!.data.length;
    }
    const live = new Set([...tracks.values()].map((t) => t.stream));
    for (let i = streams.length - 1; i >= 0; i--) if (!streams[i]!.clusters.length && !live.has(streams[i]!)) streams.splice(i, 1);
  }

  /** The latest stream of the main player. Audio buffered before it
   *  played (the next Short, swiped to) is named now: it is this video's. */
  function current(): Stream | null {
    const src = playerVideo()?.src;
    for (let i = streams.length - 1; i >= 0; i--) {
      const s = streams[i]!;
      if (s.src !== src) continue;
      if (s.clusters.some((c) => c.vid === null)) {
        const vid = videoIdOf(location.href);
        for (const c of s.clusters) c.vid ??= vid;
        adopted = true;
      }
      return s;
    }
    return null;
  }
  /** Audio was named for the video now playing: it is sent on the next tick. */
  let adopted = false;

  /** Whether this frame can feed a session: the main player's audio, as
   *  WebM a decoder can read (no DRM), with some of this video kept. */
  function ready(): boolean {
    return why() === null;
  }

  /** Why this frame cannot feed a session (null: it can). */
  function why(): string | null {
    const v = playerVideo();
    if (!v) return 'no player on this page';
    if (v.mediaKeys) return 'the video is DRM-protected';
    const s = current();
    if (!s) return 'no WebM audio seen from this player (reload the tab)';
    if (s.encoded) return 'the audio is encrypted';
    if (!s.clusters.some((c) => c.vid === videoIdOf(location.href))) return 'nothing of this video buffered yet';
    return null;
  }

  /** Seconds the player has buffered past its playhead. */
  function bufferedAhead(v: HTMLVideoElement): number {
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.1 && v.currentTime <= v.buffered.end(i)) return v.buffered.end(i) - v.currentTime;
    return 0;
  }

  function drawHud() {
    if (!debug) return;
    const v = playerVideo();
    const now = v?.currentTime ?? 0;
    const ahead = (t: number | null | undefined) => (t === null || t === undefined ? '—' : `${t - now >= 0 ? '+' : ''}${(t - now).toFixed(1)} s`);
    const s = current();
    const vid = videoIdOf(location.href);
    const kept = s?.clusters.filter((c) => c.vid === vid).reduce((m, c) => Math.max(m, c.t), -Infinity);
    const rows: HudRow[] = [
      { k: 'playhead', v: `${now.toFixed(1)} s${v?.paused ? ' (paused)' : ''}` },
      { k: 'YouTube buffer', v: v ? ahead(now + bufferedAhead(v)) : '—' },
      { k: 'kept here (start of last cluster)', v: kept !== undefined && kept > -Infinity ? ahead(kept) : '—' },
    ];
    if (run && stats) {
      const tr = stats.transcribedTo;
      rows.push(
        { k: 'audio sent to VocalStack', v: `${ahead(stats.sentTo)}  (${stats.queuedS.toFixed(1)} s queued)` },
        { k: 'transcribed', v: ahead(tr), tone: tr === null ? undefined : tr - now >= 2 ? 'good' : 'bad' },
        { k: 'lines waiting for the video', v: String(stats.waiting) },
        { k: 'clusters decoded / failed', v: `${stats.decoded} / ${stats.failed}`, tone: stats.failed ? 'bad' : undefined },
        ...stats.lines.slice(-5).reverse().map((l): HudRow => ({ k: `line ${l.seq % 1_000_000}`, v: `${l.early >= 0 ? `${l.early.toFixed(1)} s early` : `${(-l.early).toFixed(1)} s LATE`} · ${l.text}`, tone: l.early >= 0.5 ? 'good' : 'bad' })),
      );
    }
    const reason = why();
    hud.show(run ? 'VOCALSTACK · READING AHEAD' : `VOCALSTACK · NOT READING AHEAD${reason ? '' : ' (ready)'}`, run || !reason ? rows : [{ k: 'why', v: reason, tone: 'bad' }, ...rows]);
  }

  function setDebug(on: boolean) {
    debug = on;
    if (on) { hudTimer ??= window.setInterval(drawHud, 500); drawHud(); }
    else { if (hudTimer) clearInterval(hudTimer); hudTimer = undefined; hud.hide(); }
  }
  chrome.storage.local.get(AHEAD_DEBUG).then((g) => setDebug(g[AHEAD_DEBUG] === true), () => {});
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && AHEAD_DEBUG in c) setDebug(c[AHEAD_DEBUG]!.newValue === true); });

  /** The offscreen document's answer: how the session is doing. */
  function took(st: AheadStats) {
    stats = st;
    const now = playerVideo()?.currentTime;
    tellLead(st.transcribedTo !== null && now !== undefined ? st.transcribedTo - now : null);
    if (!debug) return;
    for (const l of st.lines) {
      if (logged.has(l.seq)) continue;
      logged.add(l.seq);
      console.info(`[VocalStack read-ahead] line ${l.seq % 1_000_000}: ${l.early >= 0 ? `${l.early.toFixed(1)} s early` : `${(-l.early).toFixed(1)} s LATE`} — ${l.text}`);
    }
  }

  function clock(): AheadClock {
    if (current() && adopted) { adopted = false; sendFrom(); }
    const v = playerVideo();
    const ad = adShowing();
    if (v && !ad) lastNow = v.currentTime;
    return { vid: videoIdOf(location.href), now: lastNow, paused: !v || v.paused || ad, rate: v?.playbackRate ?? 1 };
  }

  /** Queue a Cluster for the session, once, if it is the main player's
   *  and not long behind the playhead. */
  function offer(s: Stream, c: Kept) {
    if (!run || !c.vid || s !== current()) return;
    const k = `${c.vid}@${c.t.toFixed(3)}`;
    if (run.sent.has(k) || c.t < (playerVideo()?.currentTime ?? 0) - STALE_S) return;
    run.sent.add(k);
    outbox.push({ s, c });
    flushTimer ??= window.setTimeout(flush, 50);
  }

  /** What is kept from the playhead on: the Cluster playing, and after. */
  function sendFrom() {
    const s = current();
    const v = playerVideo();
    if (!s || !v) return;
    const vid = videoIdOf(location.href);
    const mine = s.clusters.filter((c) => c.vid === vid).sort((a, b) => a.t - b.t);
    let from = -Infinity;
    for (const c of mine) if (c.t <= v.currentTime) from = c.t;
    for (const c of mine) if (c.t >= from) offer(s, c);
  }

  function flush() {
    flushTimer = undefined;
    const r = run;
    const items = outbox;
    outbox = [];
    if (!r) return;
    // One message per init segment and video, in order.
    const out: AheadChunk[] = [];
    for (const { s, c } of items) {
      let chunk = out[out.length - 1];
      if (!chunk || chunk.key !== s.key || chunk.vid !== c.vid) {
        chunk = { vid: c.vid!, key: s.key, clusters: [] };
        if (!r.inits.has(s.key)) { chunk.init = toB64(s.init); r.inits.add(s.key); }
        out.push(chunk);
      }
      chunk.clusters.push({ t: c.t, d: toB64(c.data) });
    }
    for (const c of out) send(r.id, c);
  }

  function send(id: string, chunk?: AheadChunk) {
    const msg: OffCmd = { off: 'ahead.data', id, clock: clock(), ...(chunk ? { chunk } : {}) };
    chain = chain.then(async () => {
      const a = (await chrome.runtime.sendMessage(msg).catch(() => null)) as OffAnswer | null;
      // The session ended, or the offscreen document is gone.
      if ((!a?.ok || a.value === false) && run?.id === id) stop();
      else if (a?.ok && a.value) took(a.value as AheadStats);
    });
  }

  const tick = () => { if (run) send(run.id); };
  const onSeeked = () => { tick(); sendFrom(); };

  function start(id: string) {
    if (run?.id === id) return;
    run = { id, sent: new Set(), inits: new Set() };
    for (const t of ['play', 'pause', 'ratechange'] as const) document.addEventListener(t, tick, true);
    document.addEventListener('seeked', onSeeked, true);
    clockTimer = window.setInterval(tick, CLOCK_MS);
    tick();
    sendFrom();
  }

  /** How far ahead the transcript is, for the captions' BUFFERING. */
  function tellLead(lead: number | null) {
    document.dispatchEvent(new CustomEvent(AHEAD_LEAD, { detail: lead }));
  }

  function stop() {
    run = null;
    stats = null;
    tellLead(null);
    outbox = [];
    for (const t of ['play', 'pause', 'ratechange'] as const) document.removeEventListener(t, tick, true);
    document.removeEventListener('seeked', onSeeked, true);
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = undefined;
  }

  /** A page loaded again in a tab that reads ahead: carry on feeding it. */
  function resume() {
    if (asked) return;
    asked = true;
    void chrome.runtime.sendMessage({ rpc: 'live.ahead' }).then((r: { ok: boolean; value?: { id: string } | null } | undefined) => {
      if (r?.ok && r.value) start(r.value.id);
    }, () => {});
  }

  chrome.runtime.onMessage.addListener((m: { ahead?: string; id?: string }, _sender, reply) => {
    if (m?.ahead === 'probe') { reply({ ready: ready() }); return false; }
    if (m?.ahead === 'start' && typeof m.id === 'string') start(m.id);
    if (m?.ahead === 'stop' && m.id === run?.id) stop();
    return false;
  });
}
