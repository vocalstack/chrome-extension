/** Voices (design 3): a Voice language filter (All languages: the
 *  account's cloned voices; a language: those and the stock voices that
 *  speak it), one row per voice with its sample, and Clone a Voice. */

import { useEffect, useState } from 'react';
import type { Voice } from '@vocalstack/sdk';
import type { VoiceOption } from '@vocalstack/contract';
import { client } from '../../lib/client';
import { Note, errorText, useLoad } from '../../ui/kit';
import { Eyebrow, LanguageChip, LanguagePicker } from '../../ui/ds';
import { HiPause, HiPlay, HiPlus, HiGlobe } from '../../ui/icons';
import { AutoGlyph, usePickLangs, useLang } from '../../ui/langs';
import { previewBlob, usePlayer, usePollWhile, voiceColor } from './shared';

const SLOTS = ['var(--vx-1)', 'var(--vx-2)', 'var(--vx-3)', 'var(--vx-4)', 'var(--vx-5)', 'var(--vx-6)'];
const FILTER = 'voices.lang';

function clonedMeta(v: Voice): string {
  if (v.state === 'failed') return 'COULD NOT BUILD';
  if (v.draft) return v.state === 'training' ? 'SAMPLE IN · BUILDING' : 'NOT COMPLETE';
  if (v.state === 'training') return `BUILDING · ${v.progress}%`;
  return v.enabled ? 'CLONED' : 'CLONED · DISABLED';
}

/** Two letters: a name's initials, or a one-word name's first two. */
function twoLetters(name: string): string {
  const words = name.replace(/\([^)]*\)/g, ' ').replace(/[^\p{L} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2)).toUpperCase();
}

type Stock = VoiceOption & { lang: string };
/* Every voice language's stock voices, fetched once per panel. */
let allStock: Promise<Stock[]> | null = null;
function stockFor(langs: string[]): Promise<Stock[]> {
  allStock ??= client().then((vs) => Promise.all(langs.map((l) => vs.voices.available(l).then((c) => (c.voices ?? []).filter((v) => !v.cloned).map((v) => ({ ...v, lang: l })), () => [] as Stock[]))).then((x) => x.flat()));
  allStock.catch(() => { allStock = null; });
  return allStock;
}

/** A stock voice speaks several languages: listed once (its first one plays). */
function onePerVoice(all: Stock[]): Stock[] {
  const seen = new Set<string>();
  return all.filter((v) => { const k = v.name.trim().toLowerCase() || v.id; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function VoiceList({ onOpen, onNew }: { onOpen: (v: Voice) => void; onNew: () => void }) {
  const { data, error, loading, setData } = useLoad(async () => (await client()).voices.list());
  const [lang, setLangState] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState<Stock[]>([]);
  const [stockError, setStockError] = useState('');
  const rows = usePickLangs('voice');
  const info = useLang()(lang);
  const player = usePlayer();
  const voices = data ?? [];
  const sorted = [...voices].sort((a, b) => Number(b.draft) - Number(a.draft) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  usePollWhile(voices.some((v) => v.state === 'training'), async () => {
    try { setData(await (await client()).voices.list()); } catch { /* the next poll may work */ }
  });

  useEffect(() => { chrome.storage.local.get(FILTER).then((g) => { if (g[FILTER]) setLangState(g[FILTER] as string); }); }, []);
  const setLang = (v: string | null) => { setLangState(v); void chrome.storage.local.set({ [FILTER]: v }); };
  const voiceLangs = rows.map((r) => r.code).join(',');
  useEffect(() => {
    setStockError('');
    if (!voiceLangs) return;
    let on = true;
    // All languages: every stock voice once; a language: the ones that speak it.
    stockFor(voiceLangs.split(',')).then((all) => { if (on) setStock(lang ? all.filter((v) => v.lang === lang) : onePerVoice(all)); }, (e) => { if (on) setStockError(errorText(e)); });
    return () => { on = false; };
  }, [lang, voiceLangs]);
  const langOf = useLang();

  const playCloned = (v: Voice) => {
    const l = lang ?? 'en';
    void player.play(`pv:${v.id}:${l}`, (alive) => previewBlob(v.id, l, info?.name ?? 'English', alive));
  };
  const playStock = (v: Stock) => {
    void player.play(`st:${v.id}:${v.lang}`, async () => {
      const res = await (await client()).voices.preview(v.id, v.lang);
      if (res.status === 202) throw new Error('This voice is still being prepared. Try again in a moment.');
      return res.blob();
    });
  };

  return (
    <div className="screen" data-screen-label="Voices">
      <div className="card2">
        <Eyebrow>VOICE LANGUAGE</Eyebrow>
        <div className="card2__row">
          <div className="lrow__main" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.2px' }}>{info ? info.name : 'All languages'}</div>
          <LanguageChip flag={info ? info.flag : <AutoGlyph />} code={lang ? lang.toUpperCase() : ''} label="Voice language" onClick={() => setOpen(true)} />
        </div>
        <p className="card2__note">{info ? `Showing voices that speak ${info.name}.` : 'Showing voices for every language. Pick a language to see only the voices that speak it.'}</p>
      </div>
      {error && <Note kind="bad">{error}</Note>}
      {stockError && <Note kind="warn">{stockError}</Note>}
      {player.error && <Note kind="bad">{player.error}</Note>}
      <div className="card2" style={{ padding: '14px 14px 4px' }}>
        <div className="ey ey--line">YOUR VOICES</div>
        <div style={{ marginTop: 6 }}>
          {loading && !data && <div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div>}
          {data && !sorted.length && !stock.length && <p className="pref__sub" style={{ margin: '6px 0 12px' }}>No voices yet. Record thirty seconds and the voice is built from it.</p>}
          {sorted.map((v, i) => {
            const c = voiceColor(v.color) ?? SLOTS[i % SLOTS.length]!;
            const canPlay = v.state === 'ready' && !v.draft;
            const key = `pv:${v.id}:${lang ?? 'en'}`;
            return (
              <div key={v.id} className="lrow lrow--click" style={{ padding: '11px 0' }} role="button" tabIndex={0}
                onClick={() => { player.stop(); onOpen(v); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); player.stop(); onOpen(v); } }}>
                <span className="vav" style={{ '--vc': c } as React.CSSProperties}>{twoLetters(v.name)}</span>
                <div className="lrow__main">
                  <div className="lrow__title">{v.name.trim() || 'Unnamed voice'}</div>
                  <div className="lrow__meta" style={v.state === 'failed' ? { color: 'var(--bad)' } : undefined}>{clonedMeta(v)}</div>
                  {v.state === 'training' && <div className="lrow__bar"><i style={{ width: `${v.progress}%` }} /></div>}
                </div>
                {canPlay && <PlayBtn on={player.playing === key} busy={player.loading === key} onClick={(e) => { e.stopPropagation(); playCloned(v); }} />}
              </div>
            );
          })}
          {stock.map((v, i) => {
            const key = `st:${v.id}:${v.lang}`;
            return (
              <div key={`${v.lang}:${v.id}`} className="lrow" style={{ padding: '11px 0' }}>
                <span className="vav" style={{ '--vc': SLOTS[(sorted.length + i) % SLOTS.length] } as React.CSSProperties}>{twoLetters(v.name)}</span>
                <div className="lrow__main">
                  <div className="lrow__title">{v.name}</div>
                  <div className="lrow__meta">{['STOCK', v.accent, lang && (langOf(v.lang)?.name ?? v.lang)].filter(Boolean).join(' · ').toUpperCase()}</div>
                </div>
                <PlayBtn on={player.playing === key} busy={player.loading === key} onClick={() => playStock(v)} />
              </div>
            );
          })}
        </div>
      </div>
      <button type="button" className="cta cta--dashed" onClick={onNew}><HiPlus width={15} height={15} />Clone a Voice</button>
      <LanguagePicker open={open} onClose={() => setOpen(false)} title="VOICE LANGUAGE" note="Show only the voices that speak this language."
        value={lang ?? 'ALL'} searchPlaceholder={`Search ${rows.length} languages`}
        languages={[{ code: 'ALL', flag: <HiGlobe width={20} height={20} />, label: 'All languages', native: 'Every voice' }, ...rows.map((r) => ({ ...r, voice: false }))]}
        onSelect={(c) => { setLang(c === 'ALL' ? null : c); setOpen(false); player.stop(); }} />
    </div>
  );
}

function PlayBtn({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" className="playbtn" aria-label={on ? 'Stop' : 'Play sample'} title={on ? 'Stop' : 'Play sample'} onClick={onClick}>
      {busy ? <span className="spin" /> : on ? <HiPause width={14} height={14} /> : <HiPlay width={13} height={13} />}
    </button>
  );
}
