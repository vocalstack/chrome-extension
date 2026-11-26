/** Library (design 3): search every transcript, or the latest
 *  transcriptions by day, with their progress. A click on a finished one,
 *  or on a line a search found, plays it here in the panel's player
 *  (lib/play.ts, screens/Player.tsx); each row's small arrow opens it in
 *  the Dashboard instead. A failed one can be tried again, one waiting to
 *  be trimmed opens in the dashboard. A row's other actions (rename, tag,
 *  lock, broadcast, archive, delete) are in its menu: the folder button,
 *  or a right-click (screens/library/RowMenu.tsx). */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Broadcast, SearchHit, Tag, Transcription } from '@vocalstack/contract';
import type { PanelIntent } from '../background/panel';
import type { Account } from '../lib/auth';
import { client } from '../lib/client';
import { isRefusedAccess } from '../lib/errors';
import { tabOffered } from '../lib/fallback';
import { Note, ago, clock, errorText, openApp, useAction, useLoad } from '../ui/kit';
import { HiAudio, HiBroadcast, HiDoc, HiExternal, HiFolderCog, HiLock, HiMic, HiSearch, HiVideo, HiX } from '../ui/icons';
import { RowAskDialog, RowMenu, tagColor, type MenuAt, type RowAsk } from './library/RowMenu';
import { MEETING_HOSTS } from '../lib/live';
import { hitPath, txPath } from '../background/page/paths';
import { jobPct, jobText } from './page/tracker';
import { NO_PLAY_TEXT, hitPlay, playOf, type PlayTarget } from '../lib/play';
import { mmss } from './Live';

/** The ids of the person's broadcasts: a hit in one opens under /s/… */
let broadcasts: Promise<Set<string>> | null = null;
function broadcastIds(): Promise<Set<string>> {
  broadcasts ??= client()
    .then((vs) => vs.broadcasts.list())
    .then((l) => new Set(l.map((b) => b.id)))
    .catch(() => { broadcasts = null; return new Set<string>(); });
  return broadcasts;
}

/** `text` with every case-insensitive `q` in a <mark>. */
function Marked({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return <>{text}</>;
  const out: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, at)) {
    if (i > at) out.push(text.slice(at, i));
    out.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

export function LibraryScreen({ account, intent, onIntentDone, onPlay, onLive }: { account: Account; intent: PanelIntent | null; onIntentDone: () => void; onPlay: (t: PlayTarget) => void; onLive: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const seq = useRef(0);

  // The omnibox's free text: run it here.
  useEffect(() => {
    if (!intent) return;
    if (intent.query !== undefined) setQ(intent.query);
    onIntentDone();
  }, [intent?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = q.trim();
    const n = ++seq.current;
    if (term.length < 2) { setHits(null); setSearching(false); setSearchError(''); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const vs = await client();
        const r = await vs.search.query(term, { limit: 30 });
        if (n === seq.current) { setHits(r.hits); setSearchError(''); }
      } catch (e) {
        if (n === seq.current) setSearchError(errorText(e));
      } finally {
        if (n === seq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  /** A line plays from where it is said; one the player cannot open (a
   *  recording still going, a broadcast's own) opens in the Dashboard. */
  const openHit = async (h: SearchHit, dashboard = false) => {
    const own = await broadcastIds();
    const path = hitPath(h, own, q);
    const target = dashboard ? null : hitPlay(h, own, q, path);
    if (target) onPlay(target); else await openApp(path);
  };
  const term = q.trim();

  return (
    <div className="screen" data-screen-label="Library">
      <label className="search2">
        <HiSearch width={15} height={15} />
        <input type="search" placeholder="Search transcripts" aria-label="Search transcripts" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} />
        {searching ? <span className="spin" /> : q && <button type="button" className="file__x" aria-label="Clear" onClick={() => setQ('')}><HiX width={14} height={14} /></button>}
      </label>

      {searchError && <Note kind="bad">{searchError}</Note>}

      {term.length >= 2 ? (
        hits && (hits.length ? (
          <div className="card2" style={{ padding: '12px 14px 2px' }}>
            <div className="ey-row ey--line"><span className="ey">LINES</span><span className="ey">{hits.length}</span></div>
            <div style={{ marginTop: 4 }}>
              {hits.map((h) => (
                <div key={`${h.transcriptionId}:${h.sentenceId}`} className="lrow lrow--click lib-hit" role="button" tabIndex={0} onClick={() => void openHit(h)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) void openHit(h); }}>
                  <div className="lrow__main">
                    <div className="lib-hit__text"><Marked text={h.rendered || h.text} q={term} /></div>
                    <div className="lrow__meta">{h.live ? 'LIVE · ' : ''}{h.linkName}{h.recordedAt ? ` · ${ago(h.recordedAt)}` : ''} · {clock(h.mediaStart)}</div>
                  </div>
                  <DashButton name={h.linkName} onClick={() => void openHit(h, true)} />
                </div>
              ))}
            </div>
          </div>
        ) : !searching && <p className="pref__sub" style={{ textAlign: 'center' }}>No line says “{term}”.</p>)
      ) : (
        <Recent own={account.reach === 'own'} onPlay={onPlay} onLive={onLive} />
      )}
    </div>
  );
}

const meetingOfName = (name: string) => MEETING_HOSTS.find((m) => name.startsWith(`${m.name} ·`))?.name ?? null;
const hostLabel = (u: string | null | undefined) => { try { const h = new URL(u ?? '').hostname.replace(/^(www|m)\./, ''); return h === 'youtu.be' ? 'YOUTUBE' : h.split('.').slice(-2, -1)[0]!.toUpperCase(); } catch { return ''; } };

/** A link's site, by the id the server gives it (`job.source.site`), as
 *  the meta line says it: the id itself, but where its name differs. */
const SITE_LABEL: Record<string, string> = { gdrive: 'GOOGLE DRIVE', archive: 'INTERNET ARCHIVE', iheart: 'IHEARTRADIO', jwplayer: 'JW PLAYER' };
/** The link fields the SDK this builds with doesn't have yet (transcribe: SourceInfo). */
type SiteSource = { site?: string | null; thumbnailUrl?: string | null };

/** A link's picture on its site (`job.source.thumbnailUrl`), once known. */
function pictureOf(t: Transcription): string | null {
  const u = (t.job?.source as SiteSource | undefined)?.thumbnailUrl;
  return u && /^https:\/\//.test(u) ? u : null;
}

/** Where it came from, as the design's meta line says it. */
function sourceOf(t: Transcription): { label: string; Icon: typeof HiDoc } {
  if ((t.broadcasts?.length ?? 0) > 0) return { label: 'BROADCAST', Icon: HiBroadcast };
  if (t.live) {
    const m = meetingOfName(t.name);
    if (m) return { label: m.toUpperCase(), Icon: HiMic };
    if (t.source.kind === 'stream') return { label: hostLabel(t.source.url) || 'STREAM', Icon: HiVideo };
    return { label: 'RECORDING', Icon: HiMic };
  }
  const src = t.job?.source;
  if (src?.kind === 'file') return { label: 'UPLOAD', Icon: HiAudio };
  if (src?.kind === 'url') {
    const site = (src as SiteSource).site;
    return { label: (site && (SITE_LABEL[site] ?? site.toUpperCase())) || hostLabel(src.url) || 'LINK', Icon: HiVideo };
  }
  return { label: 'TRANSCRIPTION', Icon: HiDoc };
}

function dayOf(iso: string): 'TODAY' | 'THIS WEEK' | 'EARLIER' {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'TODAY';
  return now.getTime() - d.getTime() < 7 * 86400_000 ? 'THIS WEEK' : 'EARLIER';
}

/** The row's way to its Dashboard page, in a new tab. */
function DashButton({ name, onClick }: { name: string; onClick: () => void }) {
  return <button type="button" className="file__x lib-dash" title="Open in Dashboard" aria-label={`Open ${name} in Dashboard`} onClick={(e) => { e.stopPropagation(); onClick(); }}><HiExternal width={14} height={14} /></button>;
}

function Recent({ own, onPlay, onLive }: { own: boolean; onPlay: (t: PlayTarget) => void; onLive: () => void }) {
  const { data, error, loading, reload } = useLoad(async () => (await (await client()).transcriptions.listPage({ limit: 30 })).transcriptions);
  const working = (data ?? []).some((t) => t.state === 'live' || (t.job && ['queued', 'fetching', 'transcribing'].includes(t.job.state)));
  // Keep the progress current while something is in progress.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [working, reload]);

  /* Row actions. What a row was just made (renamed, locked, tagged) shows
     at once, and is the list's again once the list is read anew. */
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [ask, setAsk] = useState<RowAsk | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Transcription>>>({});
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [actError, setActError] = useState('');
  const [tags, setTags] = useState<Tag[] | undefined>();
  const [casts, setCasts] = useState<Broadcast[] | undefined>();
  const rows = (data ?? []).filter((t) => !gone.has(t.id)).map((t) => (edits[t.id] ? { ...t, ...edits[t.id] } : t));
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeAsk = useCallback(() => setAsk(null), []);

  const loadTags = async () => {
    const list = await (await client()).tags.list();
    setTags([...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
    return list;
  };
  const openMenu = (at: MenuAt) => {
    setMenu(at);
    setActError('');
    void loadTags().catch(() => setTags((was) => was ?? []));
    void client().then((vs) => vs.broadcasts.list()).then(setCasts, () => setCasts((was) => was ?? []));
  };
  /** Shown at once; the list is read again once the call is done. */
  const act = async (id: string, patch: Partial<Transcription> | 'gone', call: (vs: Awaited<ReturnType<typeof client>>) => Promise<unknown>) => {
    if (patch === 'gone') setGone((was) => new Set(was).add(id));
    else setEdits((was) => ({ ...was, [id]: { ...was[id], ...patch } }));
    try {
      await call(await client());
    } catch (e) {
      setActError(errorText(e));
      if (patch === 'gone') setGone((was) => { const n = new Set(was); n.delete(id); return n; });
    }
    await reload();
    if (patch !== 'gone') setEdits((was) => { const { [id]: _, ...rest } = was; return rest; });
  };
  const toggleTag = (t: Transcription, tag: Tag) => {
    const had = !!t.tags?.some((x) => x.id === tag.id);
    const next = had ? (t.tags ?? []).filter((x) => x.id !== tag.id) : [...(t.tags ?? []), { id: tag.id, name: tag.name, color: tag.color }];
    void act(t.id, { tags: next }, (vs) => vs.tags.tagTranscriptions(tag.id, had ? { remove: [t.id] } : { add: [t.id] }));
  };
  /** A new tag, put on this transcription (one of that name: that one). */
  const newTag = async (t: Transcription, name: string) => {
    try {
      const same = (tags ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (same) { if (!t.tags?.some((x) => x.id === same.id)) toggleTag(t, same); return; }
      const made = await (await client()).tags.create({ name });
      await loadTags().catch(() => {});
      toggleTag(t, made);
    } catch (e) {
      setActError(errorText(e));
    }
  };

  if (error) return <Note kind="bad">{error} <button type="button" className="pg-link" onClick={() => void reload()}>Try again</button></Note>;
  if (!data) return loading ? <div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div> : null;
  if (!rows.length && !data.length) return (
    <div className="card2 empty2">
      <span className="round round--lg"><HiDoc /></span>
      <div className="empty2__text">No transcriptions yet. Transcribe something from the Page tab, upload a file, or record in Live.{own && <><br />This sign-in sees only what the extension made.</>}</div>
    </div>
  );
  const groups: { label: string; items: Transcription[] }[] = [];
  for (const t of rows) {
    const label = dayOf(t.startedAt ?? t.createdAt);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(t); else groups.push({ label, items: [t] });
  }
  const menuRow = menu ? rows.find((t) => t.id === menu.id) : undefined;
  const askRow = ask ? rows.find((t) => t.id === ask.id) : undefined;
  const menuPlay = menuRow ? playOf(menuRow).target : undefined;
  return (
    <>
      {actError && <Note kind="bad">{actError} <button type="button" className="pg-link" onClick={() => setActError('')}>Dismiss</button></Note>}
      {menu && menuRow && (
        <RowMenu at={menu} t={menuRow} tags={tags} broadcasts={casts} onClose={closeMenu}
          onPlay={menuPlay ? () => { setMenu(null); onPlay(menuPlay); } : undefined}
          onDashboard={() => { setMenu(null); void openApp(txPath(menuRow)); }}
          onLock={(on) => { setMenu(null); void act(menuRow.id, { locked: on }, (vs) => vs.transcriptions.update(menuRow.id, { locked: on })); }}
          onArchive={() => { setMenu(null); void act(menuRow.id, 'gone', (vs) => vs.transcriptions.archive(menuRow.id)); }}
          onAsk={(a) => { setMenu(null); setAsk(a); }}
          onToggleTag={(tag) => toggleTag(menuRow, tag)}
          onNewTag={(name) => void newTag(menuRow, name)} />
      )}
      {ask && askRow && (
        <RowAskDialog ask={ask} t={askRow} onClose={closeAsk}
          onRename={(name) => { setAsk(null); if (name && name !== askRow.name) void act(askRow.id, { name }, (vs) => vs.transcriptions.update(askRow.id, { name })); }}
          // For good: archived, then purged, as the Dashboard's "Delete now…" does.
          onDelete={() => { setAsk(null); void act(askRow.id, 'gone', async (vs) => { await vs.transcriptions.archive(askRow.id); await vs.transcriptions.purge(askRow.id); }); }}
          onBroadcast={(to) => {
            setAsk(null);
            const from = askRow.broadcasts?.[0];
            if (to) void act(askRow.id, {}, (vs) => vs.transcriptions.attachBroadcast(askRow.id, to));
            else if (from) void act(askRow.id, {}, (vs) => vs.transcriptions.detachBroadcast(askRow.id, from.id));
          }} />
      )}
      {groups.map((g) => (
        <div key={g.label} className="card2" style={{ padding: '12px 14px 2px' }}>
          <div className="ey-row ey--line"><span className="ey">{g.label}</span>{g === groups[0] && own && <span className="ey">MADE BY THE EXTENSION</span>}</div>
          <div style={{ marginTop: 4 }}>{g.items.map((t) => <LibRow key={t.id} t={t} today={g.label === 'TODAY'} menuOpen={menu?.id === t.id} onMenu={openMenu} onChanged={() => void reload()} onPlay={onPlay} onLive={onLive} />)}</div>
        </div>
      ))}
    </>
  );
}

function LibRow({ t, today, menuOpen, onMenu, onChanged, onPlay, onLive }: { t: Transcription; today: boolean; menuOpen: boolean; onMenu: (at: MenuAt) => void; onChanged: () => void; onPlay: (t: PlayTarget) => void; onLive: () => void }) {
  const retry = useAction();
  const { label, Icon } = sourceOf(t);
  // Known once the fetch has it; one that won't load, the source's icon.
  const [badPic, setBadPic] = useState<string | null>(null);
  const pic = pictureOf(t) !== badPic ? pictureOf(t) : null;
  const job = t.job;
  const cur = t.state;
  const dur = t.durationS ?? job?.source?.durationS;
  const pct = job ? jobPct(job) : null;
  const working = !!job && ['fetching', 'transcribing'].includes(job.state);
  const failed = job?.state === 'failed' || job?.state === 'stopped';
  // The link's own failure that its tab plays past: record the tab; a
  // refusal or a live stream fails again if retried, no answer may pass.
  const tabInstead = tabOffered(job);
  const refused = tabInstead && (isRefusedAccess(job?.error) || ['link_refused', 'link_live', 'link_not_found'].includes(job?.errorCode ?? ''));
  const summary = !!(t.live && meetingOfName(t.name) && cur !== 'live' && cur !== 'paused' && t.summary);
  const meta = failed ? (job?.error || jobText(job!)).toUpperCase() : [label, dur ? mmss(dur) : '', job?.state === 'queued' ? jobText(job).toUpperCase() : '', summary ? 'SUMMARY' : ''].filter(Boolean).join(' · ');
  const chip = cur === 'live' ? <span className="chip chip--live">LIVE</span>
    : cur === 'paused' ? <span className="chip chip--mute">PAUSED</span>
    : working ? <span className="chip">{pct !== null ? `${pct}%` : 'WORKING'}</span>
    : job?.state === 'queued' ? <span className="chip chip--mute">WAITING</span>
    : job?.state === 'cropping' ? <span className="chip">TO TRIM</span>
    : failed ? <span className="chip chip--bad">FAILED</span>
    : today ? <span className="chip chip--ok">READY</span> : null;
  const open = () => void openApp(txPath(t));
  // A finished one plays here; the rest say why not, and open in the Dashboard by the arrow.
  const play = playOf(t);
  const start = play.target ? () => onPlay(play.target) : undefined;
  return (
    <div className={`lib-row${menuOpen ? ' lib-row--menu' : ''}`} onContextMenu={(e) => { e.preventDefault(); onMenu({ id: t.id, x: e.clientX, y: e.clientY, above: e.clientY }); }}>
      <div className={`lrow${start ? ' lrow--click' : ''}`} {...(start ? { role: 'button', tabIndex: 0, 'aria-label': `Play ${t.name}`, onClick: start, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) start(); } } : { title: NO_PLAY_TEXT[play.why!] })}>
        <span className={`round${pic ? ' round--pic' : ''}`}>{pic ? <img src={pic} alt="" referrerPolicy="no-referrer" onError={() => setBadPic(pic)} /> : <Icon />}</span>
        <div className="lrow__main">
          <div className="lrow__title" title={t.name}>{t.locked && <HiLock className="lib-lock" width={12} height={12} aria-label="Locked" />}{t.name}</div>
          <div className="lrow__meta" style={failed ? { color: 'var(--bad)' } : undefined} title={meta}>{meta}</div>
          {!!t.tags?.length && <div className="lib-tags">{t.tags.map((x) => <span key={x.id} className="lib-tag"><i style={{ background: tagColor(x.color) }} />{x.name}</span>)}</div>}
          {working && <div className="lrow__bar"><i style={{ width: `${pct ?? 0}%` }} /></div>}
          {(failed || job?.state === 'cropping') && (
            <div className="lrow__acts" onClick={(e) => e.stopPropagation()}>
              {tabInstead && <button type="button" className="pg-link" onClick={onLive}>Record the tab instead</button>}
              {failed && job && !refused && <button type="button" className="pg-link" disabled={retry.busy} onClick={() => void retry.run(async () => { await (await client()).transcriptions.retryJob(t.id); onChanged(); })}>{retry.busy && <span className="spin" />}Try again</button>}
              {job?.state === 'cropping' && <button type="button" className="pg-link" onClick={open}>Trim in the dashboard</button>}
              {retry.error && <span className="pg-bad">{retry.error}</span>}
            </div>
          )}
        </div>
        {chip}
        <button type="button" className="file__x lib-dash lib-more" title="More actions" aria-label={`More actions for ${t.name}`} aria-haspopup="menu" aria-expanded={menuOpen}
          onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onMenu({ id: t.id, x: r.right - 232, y: r.bottom + 4, above: r.top - 4 }); }}><HiFolderCog width={16} height={16} /></button>
        <DashButton name={t.name} onClick={open} />
      </div>
    </div>
  );
}
