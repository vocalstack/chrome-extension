/** A Library row's actions, as the Dashboard's and the Mac app's: open,
 *  rename, tag, lock, move between broadcasts, archive, delete now. The
 *  menu opens from the row's folder button or a right-click where the
 *  mouse is; Rename, Delete now and a broadcast move ask first. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Broadcast, Tag, Transcription } from '@vocalstack/contract';
import { HiArchive, HiBack, HiBroadcast, HiCheck, HiChevronRight, HiExternal, HiLock, HiLockOpen, HiPencil, HiPlus, HiTag, HiTrash, HiX } from '../../ui/icons';

/** Where a menu was asked for: its top-left, and where its bottom goes
 *  when it would run off the panel's bottom. */
export interface MenuAt { id: string; x: number; y: number; above: number }

export type RowAsk =
  | { kind: 'rename'; id: string }
  | { kind: 'delete'; id: string }
  /** To this broadcast, or out of the one it feeds (null). */
  | { kind: 'broadcast'; id: string; to: { id: string; name: string } | null };

/** The Dashboard's tag colours. */
const TAG_COLOR: Record<string, string> = { coral: '#e66e68', amber: '#d6810c', lime: '#8da523', green: '#32b36e', teal: '#00b2bd', blue: '#449df0', violet: '#a083ea', pink: '#d76fad' };
export const tagColor = (c: string | undefined) => TAG_COLOR[c ?? ''] ?? TAG_COLOR.blue!;

export const capturing = (t: Transcription) => t.state === 'live' || t.state === 'paused';

const WIDTH = 232;

function Item({ icon, label, danger, disabled, note, more, checked, autoFocus, onClick }: {
  icon: React.ReactNode; label: string; danger?: boolean; disabled?: boolean; note?: string; more?: boolean; checked?: boolean; autoFocus?: boolean; onClick: () => void;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-autofocus
    <button type="button" role="menuitem" className={`rmenu__item${danger ? ' rmenu__item--danger' : ''}`} disabled={disabled} autoFocus={autoFocus} onClick={onClick}>
      <span className="rmenu__icon">{icon}</span>
      <span className="rmenu__label">{label}</span>
      {note ? <span className="rmenu__note">{note}</span> : more ? <HiChevronRight width={13} height={13} className="rmenu__more" /> : checked ? <HiCheck width={14} height={14} className="rmenu__check" /> : null}
    </button>
  );
}

export function RowMenu({ at, t, tags, broadcasts, onPlay, onDashboard, onLock, onArchive, onAsk, onToggleTag, onNewTag, onClose }: {
  at: MenuAt; t: Transcription;
  /** Undefined while they load. */
  tags: Tag[] | undefined; broadcasts: Broadcast[] | undefined;
  /** None where the player cannot open it. */
  onPlay?: () => void;
  onDashboard: () => void; onLock: (on: boolean) => void; onArchive: () => void; onAsk: (a: RowAsk) => void;
  onToggleTag: (tag: Tag) => void; onNewTag: (name: string) => void; onClose: () => void;
}) {
  const [sub, setSub] = useState<'tags' | 'broadcasts' | null>(null);
  const [newTag, setNewTag] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Inside the panel: flipped above when it would run off the bottom.
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    const left = Math.min(Math.max(8, at.x), Math.max(8, innerWidth - WIDTH - 8));
    let top = at.y;
    if (top + h > innerHeight - 8) top = at.above - h;
    setPos({ left, top: Math.min(Math.max(8, top), Math.max(8, innerHeight - h - 8)) });
  }, [at, sub, tags?.length, broadcasts?.length]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); if (sub) setSub(null); else onClose(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [sub, onClose]);

  const locked = t.locked === true;
  const stop = capturing(t) ? 'LIVE' : locked ? 'LOCKED' : undefined;
  const own = t.broadcasts?.[0];
  const others = (broadcasts ?? []).filter((b) => b.id !== own?.id);
  const has = (tag: Tag) => !!t.tags?.some((x) => x.id === tag.id);
  const sep = <div className="rmenu__sep" />;

  return (
    <div className="rmenu-scrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={box} className="rmenu" role="menu" aria-label={`Actions for ${t.name || 'Untitled'}`} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }} onClick={(e) => e.stopPropagation()}>
        {sub === 'tags' ? (
          <>
            <Item icon={<HiBack />} label="Tag" onClick={() => setSub(null)} />
            {sep}
            <form className="rmenu__new" onSubmit={(e) => { e.preventDefault(); if (newTag.trim()) onNewTag(newTag.trim()); setNewTag(''); }}>
              <span className="rmenu__icon"><HiPlus /></span>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input autoFocus value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="New tag" aria-label="New tag" maxLength={60} />
            </form>
            {!tags ? <div className="rmenu__empty"><span className="spin" /></div>
              : !tags.length ? <div className="rmenu__empty">No tags yet. Name one above.</div>
              : <div className="rmenu__list">{tags.map((tag) => <Item key={tag.id} icon={<i className="rmenu__dot" style={{ background: tagColor(tag.color) }} />} label={tag.name} checked={has(tag)} onClick={() => onToggleTag(tag)} />)}</div>}
          </>
        ) : sub === 'broadcasts' ? (
          <>
            <Item icon={<HiBack />} label="Move to broadcast" autoFocus onClick={() => setSub(null)} />
            {sep}
            {!broadcasts ? <div className="rmenu__empty"><span className="spin" /></div>
              : !others.length ? <Item icon={<HiBroadcast />} label="No other broadcasts" disabled onClick={() => {}} />
              : <div className="rmenu__list">{others.map((b) => <Item key={b.id} icon={<HiBroadcast />} label={b.name} onClick={() => onAsk({ kind: 'broadcast', id: t.id, to: { id: b.id, name: b.name } })} />)}</div>}
          </>
        ) : (
          <>
            {onPlay && <Item icon={<HiChevronRight />} label="Open" autoFocus onClick={onPlay} />}
            <Item icon={<HiExternal />} label="Open in Dashboard" autoFocus={!onPlay} onClick={onDashboard} />
            {sep}
            <Item icon={<HiPencil />} label="Rename…" onClick={() => onAsk({ kind: 'rename', id: t.id })} />
            <Item icon={<HiTag />} label="Tag" more onClick={() => setSub('tags')} />
            <Item icon={locked ? <HiLockOpen /> : <HiLock />} label={locked ? 'Unlock' : 'Lock'} onClick={() => onLock(!locked)} />
            {t.live && (
              <>
                {sep}
                <Item icon={<HiBroadcast />} label="Move to broadcast" more onClick={() => setSub('broadcasts')} />
                {own && <Item icon={<HiX />} label="Remove from broadcast" onClick={() => onAsk({ kind: 'broadcast', id: t.id, to: null })} />}
              </>
            )}
            {sep}
            <Item icon={<HiArchive />} label="Archive" disabled={!!stop} note={stop} onClick={onArchive} />
            <Item icon={<HiTrash />} label="Delete now…" danger disabled={!!stop} note={stop} onClick={() => onAsk({ kind: 'delete', id: t.id })} />
          </>
        )}
      </div>
    </div>
  );
}

/** The row actions that ask first, as the Dashboard's dialogs. */
export function RowAskDialog({ ask, t, onRename, onDelete, onBroadcast, onClose }: {
  ask: RowAsk; t: Transcription;
  onRename: (name: string) => void; onDelete: () => void; onBroadcast: (to: string | null) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(t.name);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [onClose]);

  let title: string;
  let body: string | null = null;
  let confirm: string;
  let danger = false;
  let enabled = true;
  let go: () => void;
  if (ask.kind === 'rename') {
    title = 'Rename transcription';
    confirm = 'Rename';
    enabled = !!draft.trim();
    go = () => onRename(draft.trim());
  } else if (ask.kind === 'delete') {
    title = `Delete “${t.name || 'Untitled'}” now?`;
    body = 'Its audio, video, transcript, translations and spoken translations are deleted at once, without going to Archived first. This cannot be undone.';
    confirm = 'Delete now';
    danger = true;
    go = onDelete;
  } else {
    const from = t.broadcasts?.[0]?.name;
    const to = ask.to;
    title = to ? `Move this transcription to ${to.name}?` : `Remove this transcription from ${from ?? 'its broadcast'}?`;
    body = capturing(t)
      ? `It is recording now: ${from ? `listeners of ${from} stop hearing it at once` : 'nobody hears it here any more'}${to ? `, and listeners of ${to.name} start hearing it.` : '.'}`
      : to ? `It shows in ${to.name}${from ? ` and no longer in ${from}` : ''}.` : 'It stays in your transcriptions, in no broadcast.';
    confirm = to ? 'Move' : 'Remove';
    go = () => onBroadcast(to?.id ?? null);
  }

  return (
    <div className="rask-scrim" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <form className="rask" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (enabled) go(); }}>
        <div className="rask__title">{title}</div>
        {body && <div className="rask__body">{body}</div>}
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        {ask.kind === 'rename' && <input className="rask__input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Name" aria-label="Name" maxLength={200} />}
        <div className="rask__acts">
          <button type="button" className="rask__btn" onClick={onClose}>Cancel</button>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button type="submit" className={`rask__btn ${danger ? 'rask__btn--danger' : 'rask__btn--go'}`} disabled={!enabled} autoFocus={ask.kind !== 'rename'}>{confirm}</button>
        </div>
      </form>
    </div>
  );
}
