/** The design system's controls the panel design uses (design 3: the
 *  Claude Design bundle's Switch, Toggle, LanguageChip, LanguagePicker),
 *  with the same props and class names. Styles: styles/panel.css (`vs-`). */

import { useEffect, useState, type ReactNode } from 'react';
import { HiCheck, HiChevronDown, HiSearch, HiSpeaker } from './icons';

/** Segmented switch: mutually exclusive options. `sm` sizes to its labels. */
export function Switch<T extends string>({ options, value, onChange, size, label }: {
  options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm';
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`vs-switch${size === 'sm' ? ' vs-switch--sm' : ''}`}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className="vs-switch__opt" disabled={o.disabled} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon && <span className="vs-switch__icon">{o.icon}</span>}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Settings toggle. */
export function Toggle({ checked, onChange, label, disabled, busy }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; busy?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} aria-busy={busy || undefined} disabled={disabled || busy} className="vs-toggle" onClick={() => onChange(!checked)}>
      <span className="vs-toggle__knob" />
    </button>
  );
}

/** The flag + code button that opens the LanguagePicker. */
export function LanguageChip({ flag, code, label, onClick, disabled }: { flag?: ReactNode; code?: string; label?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="vs-lang-chip vs-lang-chip--borderless" aria-label={label || code} title={label} onClick={onClick} disabled={disabled}>
      {flag ? <span className="vs-lang-chip__flag">{flag}</span> : null}
      <span className="vs-lang-chip__code">{code}</span>
      <HiChevronDown width={13} height={13} className="vs-lang-chip__chevron" />
    </button>
  );
}

export interface PickLang {
  code: string;
  flag?: ReactNode;
  label: string;
  native?: string;
  /** Has a voice (a speaker mark on the row). */
  voice?: boolean;
}

/** The language sheet: search, flagged rows, a checkmark. Fixed over the
 *  whole panel: the header that opens it sits in a `position: relative`
 *  tooltip row, which would otherwise hold it. */
export function LanguagePicker({ open, onClose, value, onSelect, languages, title, note, searchPlaceholder }: {
  open: boolean;
  onClose: () => void;
  value: string | null;
  onSelect: (code: string) => void;
  languages: PickLang[];
  title: string;
  note?: string;
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState('');
  useEffect(() => { if (!open) setQ(''); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  const list = q ? languages.filter((l) => `${l.label} ${l.native ?? ''}`.toLowerCase().includes(q.toLowerCase())) : languages;
  const placeholder = searchPlaceholder ?? `Search ${languages.length} languages`;
  return (
    <div className="vs-sheet-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ flex: 1 }} onClick={onClose} />
      <div className="vs-sheet">
        <div className="vs-sheet__grip" />
        <div className="vs-sheet__head"><span className="vs-sheet__title">{title}</span><button type="button" className="vs-sheet__done" onClick={onClose}>Done</button></div>
        {note && <div className="vs-sheet__note">{note}</div>}
        <div className="vs-sheet__header">
          <div className="vs-picker__search">
            <HiSearch width={16} height={16} style={{ color: 'var(--ink-45)', flex: 'none' }} />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
          </div>
        </div>
        <div className="vs-sheet__body" role="listbox">
          {list.map((l) => (
            <button key={l.code} type="button" role="option" aria-selected={l.code === value} className="vs-picker__row" onClick={() => onSelect(l.code)}>
              <span className="vs-picker__flag">{l.flag}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="vs-picker__label" style={{ display: 'block' }}>{l.label}</span>
                {l.native ? <span className="vs-picker__native" style={{ display: 'block' }}>{l.native}</span> : null}
              </span>
              <span className="vs-picker__slot">{l.voice ? <HiSpeaker width={16} height={16} /> : null}</span>
              <span className="vs-picker__check">{l.code === value ? <HiCheck width={16} height={16} /> : null}</span>
            </button>
          ))}
          {list.length === 0 && <div className="vs-picker__more">No match for “{q}”</div>}
        </div>
      </div>
    </div>
  );
}

/** A small card heading (`AUDIO SOURCE`, `SPOKEN LANGUAGE`…). */
export function Eyebrow({ children, side }: { children: ReactNode; side?: ReactNode }) {
  return side
    ? <div className="ey-row"><span className="ey">{children}</span><span className="ey">{side}</span></div>
    : <div className="ey">{children}</div>;
}
