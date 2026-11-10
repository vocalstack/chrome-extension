/** Speakers: the people the account saved, newest first, each with their
 *  cloned voice speaking a preview line in the Preview language; and Add a
 *  Speaker. The stock voices are not people: they are not listed here. */

import { useEffect, useState } from 'react';
import { listSpeakers, type SavedSpeaker } from '../../lib/speakers';
import { Note, useLoad } from '../../ui/kit';
import { Eyebrow, LanguageChip, LanguagePicker } from '../../ui/ds';
import { HiPause, HiPlay, HiPlus } from '../../ui/icons';
import { usePickLangs, useLang } from '../../ui/langs';
import { previewBlob, usePlayer, usePollWhile, speakerColor } from './shared';

const SLOTS = ['var(--vx-1)', 'var(--vx-2)', 'var(--vx-3)', 'var(--vx-4)', 'var(--vx-5)', 'var(--vx-6)'];
const PREVIEW = 'speakers.lang';

function meta(v: SavedSpeaker): string {
  if (v.draft) return v.state === 'training' ? 'SAMPLE IN · BUILDING' : 'NOT COMPLETE';
  if (!v.cloned) return 'RECOGNISED BY VOICE';
  if (v.state === 'failed') return 'VOICE COULD NOT BE BUILT';
  if (v.state === 'training') return `BUILDING VOICE · ${v.progress}%`;
  return v.enabled ? 'CLONED VOICE' : 'CLONED VOICE · OFF';
}

/** Two letters: a name's initials, or a one-word name's first two. */
function twoLetters(name: string): string {
  const words = name.replace(/\([^)]*\)/g, ' ').replace(/[^\p{L} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2)).toUpperCase();
}

export function SpeakerList({ onOpen, onNew }: { onOpen: (v: SavedSpeaker) => void; onNew: () => void }) {
  const { data, error, loading, setData } = useLoad(listSpeakers);
  const [lang, setLangState] = useState('en');
  const [open, setOpen] = useState(false);
  const rows = usePickLangs('voice');
  const info = useLang()(lang);
  const player = usePlayer();
  // As the dashboard's Speakers lists them: not one kept with one transcription only.
  const people = (data ?? []).filter((v) => v.library);
  const sorted = [...people].sort((a, b) => Number(b.draft) - Number(a.draft) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  usePollWhile(people.some((v) => v.state === 'training'), async () => {
    try { setData(await listSpeakers()); } catch { /* the next poll may work */ }
  });

  useEffect(() => { chrome.storage.local.get(PREVIEW).then((g) => { if (g[PREVIEW]) setLangState(g[PREVIEW] as string); }); }, []);
  const setLang = (v: string) => { setLangState(v); void chrome.storage.local.set({ [PREVIEW]: v }); };

  const play = (v: SavedSpeaker) => {
    void player.play(`pv:${v.id}:${lang}`, (alive) => previewBlob(v.id, lang, info?.name ?? lang, alive));
  };
  const anyCloned = sorted.some((v) => v.cloned);

  return (
    <div className="screen screen--fill" data-screen-label="Speakers">
      {anyCloned && (
        <div className="card2">
          <Eyebrow>PREVIEW LANGUAGE</Eyebrow>
          <div className="card2__row">
            <div className="lrow__main" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.2px' }}>{info?.name ?? lang}</div>
            <LanguageChip flag={info?.flag} code={lang.toUpperCase()} label="Preview language" onClick={() => setOpen(true)} />
          </div>
          <p className="card2__note">A cloned voice speaks its preview line in this language.</p>
        </div>
      )}
      {error && <Note kind="bad">{error}</Note>}
      {player.error && <Note kind="bad">{player.error}</Note>}
      <div className="card2" style={{ padding: '14px 14px 4px' }}>
        <div className="ey ey--line">YOUR SPEAKERS</div>
        <div style={{ marginTop: 6 }}>
          {loading && !data && <div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div>}
          {data && !sorted.length && <p className="pref__sub" style={{ margin: '6px 0 12px' }}>No speakers yet. Save a person, and they are recognised and named in every transcription they speak in.</p>}
          {sorted.map((v, i) => {
            const c = speakerColor(v.color) ?? SLOTS[i % SLOTS.length]!;
            const canPlay = v.cloned && v.state === 'ready' && !v.draft;
            const key = `pv:${v.id}:${lang}`;
            return (
              <div key={v.id} className="lrow lrow--click" style={{ padding: '11px 0' }} role="button" tabIndex={0}
                onClick={() => { player.stop(); onOpen(v); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); player.stop(); onOpen(v); } }}>
                <span className="vav" style={{ '--vc': c } as React.CSSProperties}>{twoLetters(v.name)}</span>
                <div className="lrow__main">
                  <div className="lrow__title">{v.name.trim() || 'Unnamed speaker'}</div>
                  <div className="lrow__meta" style={v.state === 'failed' ? { color: 'var(--bad)' } : undefined}>{meta(v)}</div>
                  {v.state === 'training' && <div className="lrow__bar"><i style={{ width: `${v.progress}%` }} /></div>}
                </div>
                {canPlay && <PlayBtn on={player.playing === key} busy={player.loading === key} onClick={(e) => { e.stopPropagation(); play(v); }} />}
              </div>
            );
          })}
        </div>
      </div>
      <button type="button" className="cta cta--dashed cta--end" onClick={onNew}><HiPlus width={15} height={15} />Add a Speaker</button>
      <LanguagePicker open={open} onClose={() => setOpen(false)} title="PREVIEW LANGUAGE" note="The language a cloned voice speaks its preview line in."
        value={lang} searchPlaceholder={`Search ${rows.length} languages`}
        languages={rows.map((r) => ({ ...r, voice: false }))}
        onSelect={(c) => { setLang(c); setOpen(false); player.stop(); }} />
    </div>
  );
}

function PlayBtn({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" className="playbtn" aria-label={on ? 'Stop' : 'Play preview'} title={on ? 'Stop' : 'Play preview'} onClick={onClick}>
      {busy ? <span className="spin" /> : on ? <HiPause width={14} height={14} /> : <HiPlay width={13} height={13} />}
    </button>
  );
}
