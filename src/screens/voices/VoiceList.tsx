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
import { usePickLangs, useLang } from '../../ui/langs';
import { CONSENT_FOOTER, initials, previewBlob, usePlayer, usePollWhile, voiceColor } from './shared';

const SLOTS = ['var(--vx-1)', 'var(--vx-2)', 'var(--vx-3)', 'var(--vx-4)', 'var(--vx-5)', 'var(--vx-6)'];
const FILTER = 'voices.lang';

function clonedMeta(v: Voice, langName: string | null): string {
  if (v.state === 'failed') return 'COULD NOT BUILD';
  if (v.draft) return v.state === 'training' ? 'SAMPLE IN · BUILDING' : 'NOT COMPLETE';
  if (v.state === 'training') return `BUILDING · ${v.progress}%`;
  return ['CLONED', v.enabled ? '' : 'DISABLED', langName?.toUpperCase() ?? ''].filter(Boolean).join(' · ');
}

export function VoiceList({ onOpen, onNew }: { onOpen: (v: Voice) => void; onNew: () => void }) {
  const { data, error, loading, setData } = useLoad(async () => (await client()).voices.list());
  const [lang, setLangState] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState<VoiceOption[]>([]);
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
  useEffect(() => {
    setStock([]);
    setStockError('');
    if (!lang) return;
    let on = true;
    client().then((vs) => vs.voices.available(lang)).then((c) => { if (on) setStock(c.voices.filter((v) => !v.cloned)); }, (e) => { if (on) setStockError(errorText(e)); });
    return () => { on = false; };
  }, [lang]);

  const playCloned = (v: Voice) => {
    const l = lang ?? 'en';
    void player.play(`pv:${v.id}:${l}`, (alive) => previewBlob(v.id, l, info?.name ?? 'English', alive));
  };
  const playStock = (v: VoiceOption) => {
    void player.play(`st:${v.id}:${lang}`, async () => {
      const res = await (await client()).voices.preview(v.id, lang!);
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
          <LanguageChip flag={info ? info.flag : <HiGlobe width={18} height={18} style={{ color: 'var(--ink-62)' }} />} code={lang ? lang.toUpperCase() : ''} label="Voice language" onClick={() => setOpen(true)} />
        </div>
        <p className="card2__note">{info ? `Showing voices that speak ${info.name}.` : 'Showing voices for every language. Pick a language to see only the voices that speak it.'}</p>
      </div>
      {error && <Note kind="bad">{error}</Note>}
      {stockError && <Note kind="warn">{stockError}</Note>}
      {player.error && <Note kind="bad">{player.error}</Note>}
      <div className="card2" style={{ padding: '14px 14px 4px' }}>
        <Eyebrow>YOUR VOICES</Eyebrow>
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
                <span className="vav" style={{ '--vc': c } as React.CSSProperties}>{v.name.trim() ? initials(v.name) : '—'}</span>
                <div className="lrow__main">
                  <div className="lrow__title">{v.name.trim() || 'Unnamed voice'}</div>
                  <div className="lrow__meta" style={v.state === 'failed' ? { color: 'var(--bad)' } : undefined}>{clonedMeta(v, info?.name ?? null)}</div>
                  {v.state === 'training' && <div className="lrow__bar"><i style={{ width: `${v.progress}%` }} /></div>}
                </div>
                {canPlay && <PlayBtn on={player.playing === key} busy={player.loading === key} onClick={(e) => { e.stopPropagation(); playCloned(v); }} />}
              </div>
            );
          })}
          {stock.map((v, i) => {
            const key = `st:${v.id}:${lang}`;
            return (
              <div key={v.id} className="lrow" style={{ padding: '11px 0' }}>
                <span className="vav" style={{ '--vc': SLOTS[(sorted.length + i + 1) % SLOTS.length] } as React.CSSProperties}>{initials(v.name)}</span>
                <div className="lrow__main">
                  <div className="lrow__title">{v.name}</div>
                  <div className="lrow__meta">{['STOCK', v.gender, v.accent, info?.name].filter(Boolean).join(' · ')}</div>
                </div>
                <PlayBtn on={player.playing === key} busy={player.loading === key} onClick={() => playStock(v)} />
              </div>
            );
          })}
        </div>
      </div>
      <button type="button" className="cta cta--dashed" onClick={onNew}><HiPlus width={15} height={15} />Clone a Voice</button>
      <p className="pref__sub" style={{ margin: 0 }}>{CONSENT_FOOTER}</p>
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
