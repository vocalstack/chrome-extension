/** What the voice screens share: the backend's sample limits, the
 *  dashboard's consent wording and reading passage, the state badge, the
 *  colour avatar, and one audio player for previews and samples.
 *
 *  Numbers and copy mirror transcribe: `src/domain/voices.rs`
 *  (MIN_SAMPLE_S, SAMPLE_TOLERANCE_S, MAX_SAMPLE_BYTES, the 1–60 name) and
 *  `app/src/screens/Voices.tsx` / `shared.tsx` (PASSAGE, PermissionCheck,
 *  CONSENT). Previews speak the engine's fixed line only: VocalStack never
 *  speaks text a caller provides. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Voice } from '@vocalstack/js-sdk';
import { client } from '../../lib/client';
import { Badge, errorText } from '../../ui/kit';

/** The shortest sample the server builds from (`MIN_SAMPLE_S`). */
export const MIN_SAMPLE_S = 30;
/** The server takes a sample this much under the minimum (`SAMPLE_TOLERANCE_S`). */
export const SAMPLE_TOLERANCE_S = 1.5;
/** The largest sample upload (`MAX_SAMPLE_BYTES`). */
export const MAX_SAMPLE_BYTES = 40 * 1024 * 1024;
/** A voice name is 1–60 characters. */
export const MAX_NAME = 60;
/** The panel's recorder stops itself here. The server has no length cap
 *  (only the 40 MB one); two minutes of Opus is well under it. */
export const MAX_RECORD_S = 120;

/** The dashboard's passage to read aloud (design 31): plain narrative, read evenly. */
export const PASSAGE =
  'The sun came up and the street was quiet. A dog barked twice, then went back to sleep. ' +
  'Anna made coffee and opened the window. She could hear the bus at the corner and a bird in the tree next door. ' +
  'Her brother called to say he would be late. She told him not to worry, the food was still warm. ' +
  'Outside, two boys ran past with a red ball. ' +
  'A woman watered the plants on her balcony and waved at no one in particular. ' +
  'The baker across the road pulled up his shutter and the smell of bread reached the corner. ' +
  'Anna washed her cup, put on her shoes and decided to walk to the market before it filled up. ' +
  'The day felt slow and easy, the way a Sunday should feel.';

/** The dashboard's consent checkbox (`PermissionCheck`) and its tooltip. */
export const CONSENT_LABEL = 'I have this person’s permission to clone their voice.';
export const CONSENT_INFO = 'A cloned voice reads transcriptions out loud in that person’s voice, in any language. If they speak in a future recording, they are recognised and labelled by name automatically.';
/** The dashboard's note under the voice list. */
export const CONSENT_FOOTER = 'A cloned voice speaks your translations aloud to your listeners. Only record people who have agreed to it.';
export const DELETE_NOTE = 'Live transcriptions that speak with this voice fall back to a synthetic one. This cannot be undone.';

export const COLOR_SLOTS = ['1', '2', '3', '4', '5', '6'] as const;

/** A voice colour ("1"–"6" or "#rrggbb") as a CSS colour. */
export function voiceColor(c: string | null | undefined): string | undefined {
  if (!c) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^[1-6]$/.test(c)) return `var(--vx-${c})`;
  return undefined;
}

export function initials(name: string): string {
  return name.replace(/[^\p{L} ]/gu, ' ').trim().split(/\s+/).map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '?';
}

export function VoiceAvatar({ v, large }: { v: Pick<Voice, 'name' | 'color' | 'state' | 'draft'>; large?: boolean }) {
  const c = v.state === 'ready' && !v.draft ? voiceColor(v.color) : undefined;
  return (
    <span className={`vc-av${large ? ' vc-av--lg' : ''}`} style={c ? ({ '--vc': c } as React.CSSProperties) : undefined} aria-hidden="true">
      {v.name.trim() ? initials(v.name) : '—'}
    </span>
  );
}

export function StateBadge({ v }: { v: Voice }) {
  if (v.draft) return <Badge kind="warn">Not complete</Badge>;
  if (v.state === 'training') return <Badge kind="brand" dot="pulse">Building {v.progress}%</Badge>;
  if (v.state === 'failed') return <Badge kind="bad">Failed</Badge>;
  if (v.state === 'ready') return v.enabled ? <Badge kind="ok">Ready</Badge> : <Badge>Disabled</Badge>;
  return <Badge>{v.state}</Badge>;
}

export function seconds(s: number): string {
  return `${Math.round(s)} s`;
}

export function ConsentCheck({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="sect">
      <label className="check">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {CONSENT_LABEL}
      </label>
      <p className="hint" style={{ margin: 0 }}>{CONSENT_INFO}</p>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Cancelled extends Error {}

/** One `<audio>` for the whole screen: a preview, the sample, a take.
 *  `key` says which thing is playing; pressing it again stops it. */
export function usePlayer() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const el = useRef<HTMLAudioElement | null>(null);
  const current = useRef<string | null>(null);
  const seq = useRef(0);
  /** Blob URLs by key, so a second press does not fetch again. */
  const cache = useRef(new Map<string, string>());

  const stop = useCallback(() => {
    seq.current++;
    current.current = null;
    el.current?.pause();
    el.current = null;
    setPlaying(null);
    setLoading(null);
  }, []);

  useEffect(() => () => {
    stop();
    for (const u of cache.current.values()) URL.revokeObjectURL(u);
    cache.current.clear();
  }, [stop]);

  const play = useCallback(async (key: string, load: (alive: () => boolean) => Promise<Blob>) => {
    if (current.current === key) { stop(); return; }
    stop();
    const mine = ++seq.current;
    const alive = () => seq.current === mine;
    current.current = key;
    setPlaying(key);
    setLoading(key);
    setError('');
    try {
      let url = cache.current.get(key);
      if (!url) {
        const blob = await load(alive);
        if (!alive()) return;
        url = URL.createObjectURL(blob);
        cache.current.set(key, url);
      }
      const a = new Audio(url);
      a.onended = () => { if (alive()) stop(); };
      a.onerror = () => { if (alive()) { stop(); setError('That audio could not be played.'); } };
      el.current = a;
      await a.play();
      if (alive()) setLoading(null);
    } catch (e) {
      if (!alive() || e instanceof Cancelled) return;
      stop();
      setError(errorText(e) || 'That audio could not be played.');
    }
  }, [stop]);

  /** Forget cached audio whose key starts with `prefix` (a re-recorded take). */
  const forget = useCallback((prefix: string) => {
    for (const [k, u] of cache.current) if (k.startsWith(prefix)) { URL.revokeObjectURL(u); cache.current.delete(k); }
  }, []);

  return { playing, loading, error, setError, play, stop, forget };
}

/** A clone speaking the engine's fixed preview line in `lang`. The first
 *  ask for a language starts a render (202), so it is asked again until
 *  the clip is there. */
export async function previewBlob(id: string, lang: string, langName: string, alive: () => boolean): Promise<Blob> {
  const vs = await client();
  for (let i = 0; i < 12; i++) {
    let res: Response | null = null;
    try {
      res = await vs.voices.clonePreview(id, { lang });
    } catch (e) {
      const err = e as { code?: string; status?: number };
      if (err.code === 'language_unavailable') throw new Error(`No voice can speak ${langName} yet.`);
      if (err.status === 409) throw new Error('This voice is not ready yet.');
      if (err.status !== 503) throw e;
    }
    if (res && res.status !== 202) return res.blob();
    await sleep(2500);
    if (!alive()) throw new Cancelled();
  }
  throw new Error('Still preparing this voice. Try again in a moment.');
}

export async function sampleBlob(id: string): Promise<Blob> {
  const vs = await client();
  return (await vs.voices.sample(id)).blob();
}

/** How long an audio file is, when the browser can tell (0 when it cannot). */
export function audioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    const done = (s: number) => { URL.revokeObjectURL(url); a.src = ''; resolve(s); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    a.src = url;
  });
}

/** Keep a voice fresh while it is being built: every 3 s while `training`. */
export function usePollWhile(active: boolean, tick: () => Promise<void> | void, ms = 3000) {
  const fn = useRef(tick);
  fn.current = tick;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { void fn.current(); }, ms);
    return () => clearInterval(t);
  }, [active, ms]);
}
