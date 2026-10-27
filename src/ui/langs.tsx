/** Languages in the panel design (design 3), both in the header:
 *
 *  - the spoken language of what is recorded or uploaded (Auto detect, or
 *    one language), the header's first chip; with the speaker labels (a
 *    setting), one choice for Live and Upload;
 *  - the reading language (READ IN), the chip after the arrow: transcripts,
 *    captions and dubs show in it; null is no translation.
 *
 *  Kept in chrome.storage.local, so the background and every open panel
 *  follow them. */

import { useEffect, useState, type ReactNode } from 'react';
import { useLanguages } from './kit';
import { LanguagePicker, Switch, Eyebrow, type PickLang } from './ds';
import { HiArrowRight, HiChevronDown, HiGlobe, HiLang } from './icons';
import { useTip } from './tip';

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

const READ_NOTE = 'Transcripts, captions and dubs show in this language. Change it any time.';
const readRows = (rows: PickLang[]): PickLang[] => [{ code: 'NONE', flag: <AsSpokenGlyph />, label: 'No translation' }, ...rows];

/** The header's languages: the spoken language (Auto, or a flag and its
 *  name), an arrow, and the reading language (No translation, or a flag
 *  and its name), each opening its picker. */
export function LangBar() {
  const [spoken, setSpoken] = useSpokenLang();
  const [read, setRead] = useReadLang();
  const [open, setOpen] = useState<'spoken' | 'read' | null>(null);
  const spokenRows = usePickLangs('transcription');
  const readList = usePickLangs('translation');
  const lang = useLang();
  const sp = lang(spoken);
  const rd = lang(read);
  const tip = useTip();
  return (
    <div className="langbar">
      <button type="button" className="langbar__chip" aria-label={sp ? `Spoken language: ${sp.name}` : 'Spoken language: auto detect'} onClick={() => setOpen('spoken')}
        {...tip('Spoken language', sp ? `${sp.name}. Click to change.` : 'Auto detect. Each line gets its own detected language.')}>
        {sp ? <><span className="langbar__flag">{sp.flag}</span><span className="langbar__name">{sp.name}</span></> : <><HiLang width={16} height={16} /><span className="langbar__name">Auto</span></>}
        <HiChevronDown className="langbar__chev" width={11} height={11} />
      </button>
      <HiArrowRight className="langbar__arrow" width={13} height={13} />
      <button type="button" className="langbar__chip langbar__chip--read" aria-label={rd ? `Reading in ${rd.name}` : 'No translation'} onClick={() => setOpen('read')}
        {...tip('Translate into', rd ? `${rd.name}. Transcripts and captions show in this language.` : 'No translation. Shown as spoken.')}>
        {rd ? <><span className="langbar__flag">{rd.flag}</span><span className="langbar__name">{rd.name}</span></> : <><HiLang width={16} height={16} /><span className="langbar__name">No translation</span></>}
        <HiChevronDown className="langbar__chev" width={11} height={11} />
      </button>
      <LanguagePicker open={open === 'spoken'} onClose={() => setOpen(null)} title="SPOKEN LANGUAGE" note="The language spoken in what you record or upload. Auto detect gives each line its own detected language."
        value={spoken ?? 'AUTO'} searchPlaceholder={`Search ${spokenRows.length} languages`} languages={[{ code: 'AUTO', flag: <AutoGlyph />, label: 'Auto detect' }, ...spokenRows]}
        onSelect={(c) => { setSpoken(c === 'AUTO' ? null : c); setOpen(null); }} />
      <LanguagePicker open={open === 'read'} onClose={() => setOpen(null)} title="READ IN" note={READ_NOTE}
        value={read ?? 'NONE'} searchPlaceholder={`Search ${readList.length} languages`} languages={readRows(readList)}
        onSelect={(c) => { setRead(c === 'NONE' ? null : c); setOpen(null); }} />
    </div>
  );
}

/** Opens the READ IN picker from elsewhere (Dub's "Choose a language"). */
export function ReadInPicker({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked?: (code: string | null) => void }) {
  const [lang, setLang] = useReadLang();
  const rows = usePickLangs('translation');
  return (
    <LanguagePicker open={open} onClose={onClose} title="READ IN" note={READ_NOTE}
      value={lang ?? 'NONE'} searchPlaceholder={`Search ${rows.length} languages`} languages={readRows(rows)}
      onSelect={(c) => { const v = c === 'NONE' ? null : c; setLang(v); onClose(); onPicked?.(v); }} />
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
