/** Microphone capture for a voice sample, in the side panel: one
 *  MediaRecorder (webm/opus), paused and resumed rather than restarted so
 *  the take is one continuous recording, a live level meter, and a clock.
 *
 *  getUserMedia in a side panel fails with NotAllowedError until the
 *  extension holds the microphone permission; `needsPermission` says so,
 *  and the screen offers `rpc('mic.ask')` before trying again. */

import { useCallback, useEffect, useRef, useState } from 'react';

export type RecState = 'idle' | 'starting' | 'recording' | 'paused' | 'done';

const BARS = 32;
/** Peak below which a finished take is silence (the dashboard's SILENT_PEAK). */
const SILENT_PEAK = 0.006;
/** The meter's smallest full scale, so a quiet room is not drawn as speech. */
const METER_FLOOR = 0.02;

function pickMime(): string | undefined {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported(t)) return t;
  return undefined;
}

/** The take's loudest sample, off the decoded file (null if it cannot be decoded). */
async function peakOf(blob: Blob): Promise<number | null> {
  const ac = new AudioContext();
  try {
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    const pcm = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]!); if (a > peak) peak = a; }
    return peak;
  } catch {
    return null;
  } finally {
    void ac.close().catch(() => {});
  }
}

export function useRecorder(maxS: number) {
  const [state, setState] = useState<RecState>('idle');
  const [secs, setSecs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [blob, setBlob] = useState<Blob | null>(null);
  const [quiet, setQuiet] = useState(false);
  const [error, setError] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);

  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const nodes = useRef<AudioNode[]>([]);
  const raf = useRef<number | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsed = useRef(0);
  const last = useRef(0);
  const ref = useRef(METER_FLOOR);

  const stopClock = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  }, []);

  const release = useCallback(() => {
    stopClock();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    nodes.current = [];
  }, [stopClock]);

  useEffect(() => () => {
    const m = rec.current;
    if (m && m.state !== 'inactive') { m.onstop = null; m.stop(); }
    release();
  }, [release]);

  const finish = useCallback(() => {
    const m = rec.current;
    stopClock();
    if (m && m.state !== 'inactive') m.stop();
  }, [stopClock]);

  const runClock = useCallback(() => {
    const an = nodes.current[1] as AnalyserNode | undefined;
    if (an) {
      const buf = new Float32Array(an.fftSize);
      const draw = () => {
        an.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        ref.current = Math.max(peak, ref.current * 0.9985, METER_FLOOR);
        const level = Math.min(1, Math.pow(peak / ref.current, 0.7));
        setLevels((prev) => [...prev.slice(1), level]);
        raf.current = requestAnimationFrame(draw);
      };
      raf.current = requestAnimationFrame(draw);
    }
    last.current = performance.now();
    tick.current = setInterval(() => {
      const now = performance.now();
      elapsed.current += (now - last.current) / 1000;
      last.current = now;
      setSecs(elapsed.current);
      if (elapsed.current >= maxS) finish();
    }, 200);
  }, [finish, maxS]);

  const start = useCallback(async () => {
    setError('');
    setNeedsPermission(false);
    setQuiet(false);
    setBlob(null);
    elapsed.current = 0;
    setSecs(0);
    setState('starting');
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } });
    } catch (e) {
      const name = (e as { name?: string }).name;
      setState('idle');
      if (name === 'NotAllowedError' || name === 'SecurityError') setNeedsPermission(true);
      else if (name === 'NotFoundError') setError('No microphone was found.');
      else setError('The microphone is not available.');
      return;
    }
    stream.current = s;
    const chunks: Blob[] = [];
    const mime = pickMime();
    const m = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
    m.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    m.onstop = () => {
      const b = chunks.length ? new Blob(chunks, { type: m.mimeType || 'audio/webm' }) : null;
      release();
      rec.current = null;
      setLevels(Array(BARS).fill(0));
      setBlob(b);
      setState(b ? 'done' : 'idle');
      if (b) void peakOf(b).then((p) => { if (p !== null) setQuiet(p < SILENT_PEAK); });
    };
    rec.current = m;

    const ac = new AudioContext();
    ctx.current = ac;
    const src = ac.createMediaStreamSource(s);
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    const mute = ac.createGain();
    mute.gain.value = 0;
    src.connect(an);
    an.connect(mute).connect(ac.destination);
    nodes.current = [src, an, mute];
    ref.current = METER_FLOOR;
    if (ac.state === 'suspended') void ac.resume().catch(() => {});

    m.start(1000);
    setState('recording');
    runClock();
  }, [release, runClock]);

  const pause = useCallback(() => {
    const m = rec.current;
    if (m?.state !== 'recording') return;
    m.pause();
    stopClock();
    setState('paused');
  }, [stopClock]);

  const resume = useCallback(() => {
    const m = rec.current;
    if (m?.state !== 'paused') return;
    m.resume();
    setState('recording');
    runClock();
  }, [runClock]);

  /** Throw the take away (and let go of the microphone). */
  const reset = useCallback(() => {
    const m = rec.current;
    if (m && m.state !== 'inactive') { m.onstop = null; m.stop(); }
    rec.current = null;
    release();
    elapsed.current = 0;
    setSecs(0);
    setBlob(null);
    setQuiet(false);
    setError('');
    setLevels(Array(BARS).fill(0));
    setState('idle');
  }, [release]);

  return { state, secs, levels, blob, quiet, error, needsPermission, setNeedsPermission, start, pause, resume, finish, reset };
}
