/** The side panel's building blocks: buttons, notes, empty states, the
 *  language picker, and the hooks every screen uses. Class names are in
 *  styles/panel.css. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LanguageLists } from '@vocalstack/contract';
import { client, currentEnv } from '../lib/client';
import { IconAlert, IconInfo, IconCheck } from './icons';

export function Btn({ kind, size, block, busy, icon, children, ...rest }: {
  kind?: 'primary' | 'live' | 'danger' | 'ghost';
  size?: 'sm' | 'lg';
  block?: boolean;
  busy?: boolean;
  icon?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ['btn', kind && `btn--${kind}`, size && `btn--${size}`, block && 'btn--block', rest.className].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} className={cls} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="spin" /> : icon}
      {children}
    </button>
  );
}

export function IconBtn({ label, children, ...rest }: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="icon-btn" title={label} aria-label={label} {...rest}>{children}</button>;
}

export function Note({ kind, children }: { kind?: 'bad' | 'warn' | 'ok'; children: ReactNode }) {
  const Icon = kind === 'ok' ? IconCheck : kind ? IconAlert : IconInfo;
  return <div className={`note${kind ? ` note--${kind}` : ''}`} role={kind === 'bad' ? 'alert' : undefined}><Icon /><div>{children}</div></div>;
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <div className="empty">{icon}{children}</div>;
}

export function Badge({ kind, dot, children }: { kind?: 'live' | 'ok' | 'warn' | 'bad' | 'brand'; dot?: boolean | 'pulse'; children: ReactNode }) {
  return <span className={`badge${kind ? ` badge--${kind}` : ''}`}>{dot && <i className={`dot${dot === 'pulse' ? ' dot--pulse' : ''}`} />}{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled} title={o.title} onClick={() => onChange(o.value)}>{o.icon}{o.label}</button>
      ))}
    </div>
  );
}

export function Section({ title, side, children }: { title: string; side?: ReactNode; children: ReactNode }) {
  return (
    <section className="sect">
      <div className="sect__head"><span className="eyebrow">{title}</span>{side}</div>
      {children}
    </section>
  );
}

/** An error's message, worded for a person. */
export function errorText(e: unknown): string {
  if (!e) return '';
  const m = (e as { message?: string }).message ?? String(e);
  return m.replace(/^VocalStackError:\s*/, '');
}

/** Load once (and again on `reload`), with loading and error state. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const v = await load();
      if (n === seq.current) { setData(v); setError(''); }
    } catch (e) {
      if (n === seq.current) setError(errorText(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Run an action with busy and error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

let languages: Promise<LanguageLists> | null = null;
/** The API's language lists, fetched once per panel. */
export function useLanguages(): LanguageLists | undefined {
  const [l, setL] = useState<LanguageLists>();
  useEffect(() => {
    languages ??= client().then((vs) => vs.languages.list()).catch((e) => { languages = null; throw e; });
    languages.then(setL, () => {});
  }, []);
  return l;
}

/** A language's name ("French") from its code, once the lists are in. */
export function useLangName(): (code: string | null | undefined) => string {
  const l = useLanguages();
  return (code) => (code ? l?.languages.find((x) => x.code === code)?.name ?? code : '');
}

/** A language picker over one of the API's lists. `auto` adds "Detect". */
export function LanguageSelect({ value, onChange, list, auto, none, label, disabled }: {
  value: string | null;
  onChange: (v: string | null) => void;
  list: 'transcription' | 'translation' | 'voice';
  auto?: boolean;
  /** The label of a "no language" choice (e.g. "Don't translate"). */
  none?: string;
  label: string;
  disabled?: boolean;
}) {
  const l = useLanguages();
  const codes = new Set(l?.[list] ?? []);
  const langs = (l?.languages ?? []).filter((x) => codes.has(x.code)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select className="select" aria-label={label} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {auto && <option value="">Detect automatically</option>}
      {none && <option value="">{none}</option>}
      {!l && value && <option value={value}>{value}</option>}
      {langs.map((x) => <option key={x.code} value={x.code}>{x.flag ? `${x.flag} ` : ''}{x.name}</option>)}
    </select>
  );
}

/** Open a dashboard page (`/transcriptions/…`, `/s/…`, `/voices/…`) in a tab. */
export async function openApp(path: string): Promise<void> {
  const env = await currentEnv();
  await chrome.tabs.create({ url: new URL(path, env.app).toString() });
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: s > 300 * 86400 ? 'numeric' : undefined });
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function copy(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
