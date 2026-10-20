/** Live capture, in the offscreen document: a tab's audio and/or the
 *  microphone, mixed to mono 16 kHz in one AudioContext, cut into
 *  quarter-second chunks and sent over the session's socket.
 *
 *  - captions: a realtime session (nothing stored), translated when asked;
 *  - record / meeting: a live transcription (`source: mic`) and its
 *    recording's publisher socket, as the dashboard records;
 *  - broadcast: a take in a broadcast, the same way.
 *
 *  Every change of state is pushed as `live.status`; transcript events as
 *  `live.event` (the background forwards captions to the tab). */

import { VocalStack, type RealtimeSession, type Subscription } from '@vocalstack/sdk';
import { push, rpc, type LiveEvent } from '../lib/rpc';
import type { LiveStatus } from '../lib/live';
import type { OffCmd } from '../lib/offscreen';

const RATE = 16000;
/** Samples per socket chunk: a quarter of a second. */
const CHUNK = RATE / 4;
/** How much transcript a session keeps for a panel that opens late. */
const KEEP = 400;

interface Live {
  status: LiveStatus;
  vs: VocalStack;
  session?: RealtimeSession;
  /** Recording modes: the transcript comes on an owner subscription (a
   *  publisher socket carries audio up, not the transcript down). */
  sub?: Subscription;
  streams: MediaStream[];
  ctx?: AudioContext;
  playback?: HTMLAudioElement;
  paused: boolean;
  stopping: boolean;
  buf: Float32Array;
  fill: number;
  sent: number;
  peak: number;
  levelAt: number;
  reading?: Promise<void>;
  history: LiveEvent[];
}

const lives = new Map<string, Live>();

class Coded extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

function set(l: Live, patch: Partial<LiveStatus>) {
  l.status = { ...l.status, ...patch };
  push({ push: 'live.status', status: l.status });
}

function emit(l: Live, event: LiveEvent) {
  if (event.type === 'committed' || event.type === 'translated') {
    l.history.push(event);
    if (l.history.length > KEEP) l.history.splice(0, l.history.length - KEEP);
  }
  push({ push: 'live.event', id: l.status.id, tabId: l.status.tabId, event });
}

export function listLive(): LiveStatus[] {
  return [...lives.values()].map((l) => l.status);
}

export function liveHistory(id: string): LiveEvent[] {
  return lives.get(id)?.history ?? [];
}

export async function startLive(cmd: Extract<OffCmd, { off: 'live.start' }>): Promise<LiveStatus> {
  const s = cmd.start;
  const vs = new VocalStack({ baseUrl: cmd.api, token: () => rpc('auth.token') });
  const l: Live = {
    status: {
      id: cmd.id, mode: s.mode, state: 'starting', input: s.input, name: cmd.name, tabId: s.tabId, tabTitle: cmd.tabTitle,
      startedAt: Date.now(), broadcastId: s.broadcastId, translateTo: s.translateTo ?? null, sentS: 0,
      spokenLanguage: s.spokenLanguage ?? null, overlay: !!s.overlay,
    },
    vs, streams: [], paused: false, stopping: false, buf: new Float32Array(CHUNK), fill: 0, sent: 0, peak: 0, levelAt: 0, history: [],
  };
  lives.set(cmd.id, l);
  set(l, {});
  // Stop may be pressed while this is still starting (a cold engine takes
  // a while): every step checks, and what was made so far is undone.
  const alive = () => { if (l.stopping) throw new Coded('Stopped before it started.', 'cancelled'); };
  try {
    // The inputs first: a refused microphone fails before anything is
    // created on the account.
    await openInputs(l, cmd.streamId);
    alive();
    set(l, { state: 'warming' });
    const onLoading = () => { if (l.status.state !== 'warming') set(l, { state: 'warming' }); };
    const lang = s.spokenLanguage ?? null;
    if (s.mode === 'captions') {
      l.session = await vs.realtime.connect({ spokenLanguage: lang, ...(s.translateTo ? { translate: [s.translateTo] } : {}) }, { onLoading });
      alive();
    } else if (s.mode === 'broadcast') {
      if (!s.broadcastId) throw new Coded('No broadcast was chosen.', 'invalid_options');
      const grant = await vs.broadcasts.startRecording(s.broadcastId, { takeover: s.takeover ?? false, ...(s.spokenLanguage !== undefined ? { settings: { spokenLanguage: lang } } : {}) });
      set(l, { recordingId: grant.recording.id });
      alive();
      l.session = await vs.recordings.publish(grant, { onLoading });
      alive();
    } else {
      const tx = await vs.transcriptions.createLive({ name: cmd.name, settings: { spokenLanguage: lang }, source: { kind: 'mic' } });
      set(l, { transcriptionId: tx.id });
      alive();
      const grant = await vs.transcriptions.startRecording(tx.id, {});
      set(l, { recordingId: grant.recording.id });
      alive();
      l.session = await vs.recordings.publish(grant, { onLoading });
      alive();
    }
    set(l, { state: 'live' });
    l.reading = read(l);
    if (l.status.recordingId) void follow(l, l.status.recordingId);
    return l.status;
  } catch (e) {
    const code = (e as { code?: string }).code;
    // A live transcription made for this start but never recorded into
    // stays empty in the account: delete it.
    const empty = l.status.transcriptionId && !l.status.recordingId ? l.status.transcriptionId : null;
    if (empty) {
      await vs.transcriptions.archive(empty).then(() => vs.transcriptions.purge(empty)).catch(() => {});
      set(l, { transcriptionId: undefined });
    }
    if (code === 'cancelled') {
      // Stopped while starting: close what the start had already opened.
      const rid = l.status.recordingId;
      if (rid) {
        await vs.recordings.pause(rid).catch(() => {});
        await vs.recordings.stop(rid).catch(() => {});
      }
      await teardown(l);
      set(l, { state: 'done' });
      forgetLater(l);
      return l.status;
    }
    await teardown(l);
    set(l, { state: 'failed', error: e instanceof Error ? e.message : String(e), errorCode: code });
    forgetLater(l);
    throw e;
  }
}

async function openInputs(l: Live, streamId: string | undefined) {
  const md = navigator.mediaDevices;
  if (l.status.input.tab) {
    if (!streamId) throw new Coded('The tab could not be captured.', 'tab_capture');
    const tab = await md.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
      video: false,
    }).catch((e) => { throw new Coded(`The tab could not be captured: ${(e as Error).message}`, 'tab_capture'); });
    l.streams.push(tab);
    // Capturing a tab silences it: play it back so the person still hears it.
    const a = new Audio();
    a.srcObject = tab;
    await a.play().catch(() => {});
    l.playback = a;
    // The tab closed, or another capture took it.
    tab.getAudioTracks()[0]?.addEventListener('ended', () => { void stopLive(l.status.id); });
  }
  if (l.status.input.mic) {
    const mic = await md.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .catch((e: DOMException) => {
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw new Coded('VocalStack may not use the microphone yet. Allow it, then try again.', 'mic_permission');
        if (e.name === 'NotFoundError') throw new Coded('No microphone was found.', 'mic_missing');
        throw new Coded(`The microphone could not be opened: ${e.message}`, 'mic_error');
      });
    l.streams.push(mic);
  }
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: RATE });
  } catch {
    throw new Coded('This browser cannot capture audio at 16 kHz.', 'audio');
  }
  l.ctx = ctx;
  await ctx.audioWorklet.addModule(chrome.runtime.getURL('/pcm-worklet.js'));
  // One mono input: the tab and the microphone are summed into it.
  const node = new AudioWorkletNode(ctx, 'pcm-processor', { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  for (const st of l.streams) ctx.createMediaStreamSource(st).connect(node);
  // A node nobody pulls may not run: pull it into a silent output.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onPcm(l, e.data);
}

function onPcm(l: Live, block: Float32Array) {
  let peak = 0;
  for (let i = 0; i < block.length; i++) {
    const v = Math.abs(block[i]!);
    if (v > peak) peak = v;
  }
  if (peak > l.peak) l.peak = peak;
  const now = performance.now();
  if (now - l.levelAt > 150) {
    push({ push: 'live.level', id: l.status.id, level: l.paused ? 0 : Math.min(1, Math.sqrt(l.peak)) });
    l.peak = 0;
    l.levelAt = now;
  }
  if (l.paused || l.stopping || !l.session || l.status.state !== 'live') return;
  let off = 0;
  while (off < block.length) {
    const n = Math.min(CHUNK - l.fill, block.length - off);
    l.buf.set(block.subarray(off, off + n), l.fill);
    l.fill += n;
    off += n;
    if (l.fill === CHUNK) flush(l);
  }
}

function flush(l: Live) {
  if (!l.fill || !l.session) return;
  l.session.sendAudio(l.buf.slice(0, l.fill));
  l.sent += l.fill;
  l.fill = 0;
  // A status a second is plenty for the clock.
  if (Math.floor(l.sent / RATE) !== Math.floor((l.sent - CHUNK) / RATE)) set(l, { sentS: l.sent / RATE });
}

async function read(l: Live) {
  try {
    for await (const ev of l.session!) {
      // The language can change while it runs (live.set).
      const lang = l.status.translateTo;
      if (ev.type === 'transcript.committed') {
        const g = ev.segment;
        emit(l, { type: 'committed', seq: g.seq, text: g.text, startS: g.start, endS: g.end, speaker: String(g.speaker) });
        const tr = lang ? g.translations?.[lang] : undefined;
        if (tr) emit(l, { type: 'translated', seq: g.seq, lang: lang!, text: tr });
      } else if (ev.type === 'transcript.draft') {
        emit(l, { type: 'draft', text: ev.segments.map((x) => x.text).join(' ').trim() });
        if (lang) {
          const tr = ev.segments.map((x) => x.translations?.[lang] ?? '').join(' ').trim();
          if (tr) emit(l, { type: 'draftTranslated', lang, text: tr });
        }
      } else if (ev.type === 'transcript.sentence') {
        const st = ev.sentence;
        const tr = lang ? st.translations?.[lang] : undefined;
        if (tr && st.seqs.length) emit(l, { type: 'translated', seq: Math.max(...st.seqs), seqs: st.seqs, sentenceId: st.sentenceId, lang: lang!, text: tr });
      } else if (ev.type === 'transcript.translated') {
        const tr = lang ? ev.translations[lang] : undefined;
        if (tr) emit(l, { type: 'translated', seq: ev.seq, lang: lang!, text: tr });
      }
    }
  } catch (e) {
    if (!l.stopping) set(l, { error: e instanceof Error ? e.message : String(e), errorCode: (e as { code?: string }).code });
  }
  if (!l.stopping) {
    // The session ended on its own: the plan's time limit, or a dropped
    // connection. Close the recording properly all the same.
    const why = l.session?.doneReason === 'max_duration' ? 'The recording reached its maximum length.' : l.status.error || 'The connection to VocalStack ended.';
    await finish(l, why);
  }
}

type Seg = { seq: number; text: string; start: number; end: number; speaker: number; translations?: Record<string, string> };
type Sent = { sentenceId: number; seqs: number[]; translations?: Record<string, string> };

/** A recording's transcript, as the dashboard reads it: committed and
 *  draft lines from the owner's subscription, and their translation when
 *  the session translates (the subscription's `lang`). Called again with
 *  the new language when it changes. */
async function follow(l: Live, rid: string) {
  const lang = l.status.translateTo ?? null;
  const mine = (sub: unknown) => l.sub === sub && !l.stopping;
  try {
    const sub = await l.vs.recordings.subscribe(rid, { ...(lang ? { lang } : {}) });
    // Stopped, or the language changed again, while this one opened.
    if (l.stopping || (l.status.translateTo ?? null) !== lang) { sub.close(); return; }
    try { l.sub?.close(); } catch { /* closed */ }
    l.sub = sub;
    const seen = new Set<number>();
    const segment = (g: Seg) => {
      if (!seen.has(g.seq)) {
        seen.add(g.seq);
        emit(l, { type: 'committed', seq: g.seq, text: g.text, startS: g.start, endS: g.end, speaker: String(g.speaker) });
      }
      const tr = lang ? g.translations?.[lang] : undefined;
      if (tr) emit(l, { type: 'translated', seq: g.seq, lang: lang!, text: tr });
    };
    const sentence = (st: Sent) => {
      const tr = lang ? st.translations?.[lang] : undefined;
      if (tr && st.seqs.length) emit(l, { type: 'translated', seq: Math.max(...st.seqs), seqs: st.seqs, sentenceId: st.sentenceId, lang: lang!, text: tr });
    };
    for await (const ev of sub) {
      if (!mine(sub)) break;
      if (ev.type === 'snapshot') {
        for (const g of ev.snapshot.segments) segment(g as Seg);
        for (const st of ev.snapshot.sentences ?? []) sentence(st as Sent);
      } else if (ev.type === 'frame') {
        const f = ev.frame as { type: string; segment?: Seg; segments?: { text: string; translations?: Record<string, string> }[]; sentence?: Sent; seq?: number; translations?: Record<string, string> };
        if (f.type === 'transcript.committed' && f.segment) segment(f.segment);
        else if (f.type === 'transcript.draft' && f.segments) {
          emit(l, { type: 'draft', text: f.segments.map((x) => x.text).join(' ').trim() });
          if (lang) {
            const tr = f.segments.map((x) => x.translations?.[lang] ?? '').join(' ').trim();
            if (tr) emit(l, { type: 'draftTranslated', lang, text: tr });
          }
        } else if (f.type === 'transcript.sentence' && f.sentence) sentence(f.sentence);
        else if (f.type === 'transcript.translated' && lang && typeof f.seq === 'number') {
          const tr = f.translations?.[lang];
          if (tr) emit(l, { type: 'translated', seq: f.seq, lang, text: tr });
        }
      } else if (ev.type === 'closed') break;
    }
  } catch { /* the transcript stays in the dashboard */ }
}

/** Change what a running session translates into, or whether its
 *  transcript shows on the tab (the background draws it there). */
export async function setLive(id: string, patch: { translateTo?: string | null; overlay?: boolean }) {
  const l = lives.get(id);
  if (!l) return;
  if (patch.overlay !== undefined) set(l, { overlay: patch.overlay });
  if (patch.translateTo === undefined || (patch.translateTo ?? null) === (l.status.translateTo ?? null)) return;
  if (l.stopping || !['live', 'paused'].includes(l.status.state)) throw new Coded('Wait until it is live, then change the language.', 'not_live');
  const lang = patch.translateTo;
  if (l.status.mode === 'captions') {
    // A realtime session translates on its own socket.
    l.session?.update({ translate: lang ? [lang] : [] });
    set(l, { translateTo: lang });
  } else if (l.status.recordingId) {
    // A recording's transcript comes on the subscription: open it again in
    // the new language (the old one closes once the new one is in).
    set(l, { translateTo: lang });
    void follow(l, l.status.recordingId);
  }
}

/** Drop a finished session from the list (Dismiss). */
export function forgetLive(id: string) {
  const l = lives.get(id);
  if (l && !['done', 'failed'].includes(l.status.state)) return;
  lives.delete(id);
  // Pushed even when it was already forgotten (after ten minutes): a panel
  // open since then still lists it.
  push({ push: 'live.gone', id });
}

export async function pauseLive(id: string, paused: boolean) {
  const l = lives.get(id);
  if (!l || l.stopping) return;
  if (paused) flush(l);
  if (l.status.recordingId) {
    if (paused) await l.vs.recordings.pause(l.status.recordingId);
    else await l.vs.recordings.resume(l.status.recordingId);
  }
  l.paused = paused;
  set(l, { state: paused ? 'paused' : 'live' });
}

export async function stopLive(id: string) {
  const l = lives.get(id);
  if (!l || l.stopping) return;
  await finish(l, null);
}

async function finish(l: Live, error: string | null) {
  const starting = l.status.state === 'starting' || l.status.state === 'warming';
  l.stopping = true;
  set(l, { state: 'stopping' });
  // Still starting: startLive sees `stopping` at its next step and undoes it.
  if (starting && !l.session) return;
  flush(l);
  const rid = l.status.recordingId;
  if (rid) {
    // A live recording stops only from paused, as in the dashboard.
    // The pause can take a moment to land: retry, and say so if it never does.
    let stopErr: unknown = null;
    for (let i = 0; i < 4; i++) {
      if (i > 0 || !l.paused) await l.vs.recordings.pause(rid).catch(() => {});
      try { await l.vs.recordings.stop(rid); stopErr = null; break; } catch (e) { stopErr = e; await new Promise((r) => setTimeout(r, 800)); }
    }
    if (stopErr && !error) error = `The recording could not be stopped: ${(stopErr as Error).message ?? stopErr}. Stop it in the dashboard.`;
  } else {
    l.session?.eof();
    await Promise.race([l.reading, new Promise((r) => setTimeout(r, 4000))]);
  }
  await teardown(l);
  set(l, { state: error ? 'failed' : 'done', ...(error ? { error } : {}) });
  if (l.status.mode === 'meeting' && rid && !error) void summarize(l, rid);
  else forgetLater(l);
}

async function teardown(l: Live) {
  try { l.session?.close(); } catch { /* closed */ }
  try { l.sub?.close(); } catch { /* closed */ }
  for (const st of l.streams) st.getTracks().forEach((t) => t.stop());
  l.streams = [];
  if (l.playback) { l.playback.srcObject = null; l.playback = undefined; }
  await l.ctx?.close().catch(() => {});
  l.ctx = undefined;
}

/** A meeting ends with its summary: asked for, then read until ready. */
async function summarize(l: Live, rid: string) {
  try {
    await l.vs.recordings.summarize(rid).catch(() => {});
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, i < 5 ? 3000 : 6000));
      const s = await l.vs.recordings.summary(rid);
      if (s.state === 'ready') { set(l, { summary: s.summary ?? '', name: s.title || l.status.name }); break; }
      if (s.state === 'unavailable') break;
    }
  } catch { /* the summary stays in the dashboard */ }
  forgetLater(l);
}

/** A finished session stays listed for a while, so the panel can show how it ended. */
function forgetLater(l: Live) {
  setTimeout(() => lives.delete(l.status.id), 10 * 60_000);
}
