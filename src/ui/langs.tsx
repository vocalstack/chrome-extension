/** Languages in the panel design (design 3):
 *
 *  - the reading language: one for the whole panel (the header chip, READ
 *    IN). Transcripts, captions and dubs show in it; null reads as spoken.
 *    Kept in chrome.storage.local, so the background and every open panel
 *    follow it;
 *  - the spoken language of what is recorded or uploaded (Auto detect /
 *    Custom), and its speaker labels: one choice for Live and Upload. */

import { useEffect, useState, type ReactNode } from 'react';
import { useLanguages } from './kit';
import { LanguageChip, LanguagePicker, Switch, Eyebrow, type PickLang } from './ds';
import { HiGlobe, HiLang } from './icons';

export const READ_LANG = 'readLang';
const SPOKEN = 'liveLang';
const LABELS = 'speakerLabels';

export type SpeakerLabels = 'auto' | 'on' | 'off';

/** A value in chrome.storage.local, kept current. */
function useStored<T>(key: string, fallback: T): [T, (v: T) => void, boolean] {
  const [v, setV] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    chrome.storage.local.get(key).then((g) => { if (g[key] !== undefined) setV(g[key] as T); setReady(true); });
    const l = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && key in c) setV((c[key]!.newValue as T) ?? fallback);
    };
    chrome.storage.onChanged.addListener(l);
    return () => chrome.storage.onChanged.removeListener(l);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (x: T) => { setV(x); void chrome.storage.local.set({ [key]: x }); };
  return [v, set, ready];
}

export const useReadLang = () => useStored<string | null>(READ_LANG, null);
export const useSpokenLang = () => useStored<string | null>(SPOKEN, null);
export const useSpeakerLabels = () => useStored<SpeakerLabels>(LABELS, 'auto');

/** The "CC" glyph: reading as spoken. */
export const AsSpokenGlyph = () => <span className="cc-glyph">CC</span>;
/** Auto detect's glyph: the language and globe marks. */
export const AutoGlyph = () => <span className="auto-glyph"><HiLang width={19} height={19} /><HiGlobe width={18} height={18} /></span>;

/** The API's languages on one of its lists, as picker rows. */
export function usePickLangs(list: 'transcription' | 'translation' | 'voice'): PickLang[] {
  const l = useLanguages();
  if (!l) return [];
  const codes = new Set(l[list] ?? []);
  const voice = new Set(l.voice ?? []);
  return l.languages
    .filter((x) => codes.has(x.code))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((x) => ({ code: x.code, flag: x.flag ?? undefined, label: x.name, native: x.native && x.native !== x.name ? x.native : undefined, voice: list === 'translation' && voice.has(x.code) }));
}

/** A language's row (flag and name), once the lists are in. */
export function useLang(): (code: string | null | undefined) => { flag?: string; name: string } | null {
  const l = useLanguages();
  return (code) => {
    if (!code) return null;
    const x = l?.languages.find((y) => y.code === code);
    return { flag: x?.flag ?? undefined, name: x?.name ?? code };
  };
}

/** The header's reading-language chip and its READ IN picker. */
export function ReadInChip() {
  const [lang, setLang] = useReadLang();
  const [open, setOpen] = useState(false);
  const rows = usePickLangs('translation');
  const info = useLang()(lang);
  const label = info ? `Reading in ${info.name}` : 'Reading as spoken';
  return (
    <>
      <button type="button" className={`read-chip${info ? ' read-chip--on' : ''}`} aria-label={label} title={label} onClick={() => setOpen(true)}>
        {info ? <><span className="read-chip__flag">{info.flag}</span><span>{info.name}</span></> : <><HiLang width={16} height={16} /><span>As spoken</span></>}
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
      </button>
      <LanguagePicker open={open} onClose={() => setOpen(false)} title="READ IN" note="Transcripts, captions and dubs show in this language. Change it any time."
        value={lang ?? 'NONE'} searchPlaceholder={`Search ${rows.length} languages`} languages={[{ code: 'NONE', flag: <AsSpokenGlyph />, label: 'As spoken' }, ...rows]}
        onSelect={(c) => { setLang(c === 'NONE' ? null : c); setOpen(false); }} />
    </>
  );
}

/** Opens the READ IN picker from elsewhere (Dub's "Choose a language"). */
export function ReadInPicker({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked?: (code: string | null) => void }) {
  const [lang, setLang] = useReadLang();
  const rows = usePickLangs('translation');
  return (
    <LanguagePicker open={open} onClose={onClose} title="READ IN" note="Transcripts, captions and dubs show in this language. Change it any time."
      value={lang ?? 'NONE'} searchPlaceholder={`Search ${rows.length} languages`} languages={[{ code: 'NONE', flag: <AsSpokenGlyph />, label: 'As spoken' }, ...rows]}
      onSelect={(c) => { const v = c === 'NONE' ? null : c; setLang(v); onClose(); onPicked?.(v); }} />
  );
}

/** SPOKEN LANGUAGE: Auto detect / Custom, the chip, and its note. */
export function SpokenLanguageCard() {
  const [lang, setLang] = useSpokenLang();
  const [custom, setCustom] = useState(false);
  const [open, setOpen] = useState(false);
  const rows = usePickLangs('transcription');
  const info = useLang()(lang);
  const auto = !lang && !custom;
  const pick = (v: 'auto' | 'custom') => {
    if (v === 'auto') { setCustom(false); setLang(null); } else { setCustom(true); if (!lang) setOpen(true); }
  };
  return (
    <div className="card2">
      <Eyebrow>SPOKEN LANGUAGE</Eyebrow>
      <div className="card2__row">
        <Switch size="sm" label="Spoken language" value={auto ? 'auto' : 'custom'} onChange={pick} options={[{ value: 'auto', label: 'Auto detect' }, { value: 'custom', label: 'Custom' }]} />
        <div className="card2__end"><LanguageChip flag={auto || !info ? <AutoGlyph /> : info.flag} code={auto || !info ? '' : lang!.toUpperCase()} label={info ? info.name : 'Detect automatically'} onClick={() => setOpen(true)} /></div>
      </div>
      <p className="card2__note">{auto
        ? 'Each spoken segment in this recording gets its own detected language, so speakers can switch languages mid-conversation.'
        : 'Naming the spoken language improves accuracy on noisy recordings and heavy accents.'}</p>
      <LanguagePicker open={open} onClose={() => { setOpen(false); if (!lang) setCustom(false); }} title="SPOKEN LANGUAGE" note="The language spoken in this recording."
        value={lang} languages={rows} onSelect={(c) => { setLang(c); setCustom(true); setOpen(false); }} />
    </div>
  );
}

const LABEL_NOTES: Record<SpeakerLabels, string> = {
  auto: 'The voices in this recording are counted first. If there’s more than one, each line is labelled with its speaker; if not, the transcript is plain text.',
  on: 'Each line in this transcript will be labelled with its speaker, even if only one person is talking.',
  off: 'This transcript will be plain text with no speaker labels. Use this for a single speaker.',
};

/** SPEAKER LABELS: When Needed / On / Off. */
export function SpeakerLabelsCard({ extra }: { extra?: ReactNode }) {
  const [v, setV] = useSpeakerLabels();
  return (
    <div className="card2">
      <Eyebrow>SPEAKER LABELS</Eyebrow>
      <div className="card2__row">
        <Switch size="sm" label="Speaker labels" value={v} onChange={setV} options={[{ value: 'auto', label: 'When Needed' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
      </div>
      <p className="card2__note">{LABEL_NOTES[v]}{extra}</p>
    </div>
  );
}
