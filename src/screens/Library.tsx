/** Library (design 3): search every transcript, or the latest
 *  transcriptions by day, with their progress. A click on a finished one,
 *  or on a line a search found, plays it here in the panel's player
 *  (lib/play.ts, screens/Player.tsx); each row's small arrow opens it in
 *  the Dashboard instead. A failed one can be tried again, one waiting to
 *  be trimmed opens in the dashboard. */

import { useEffect, useRef, useState } from 'react';
import type { SearchHit, Transcription } from '@vocalstack/contract';
import type { PanelIntent } from '../background/panel';
import type { Account } from '../lib/auth';
import { client } from '../lib/client';
import { Note, ago, clock, errorText, openApp, useAction, useLoad } from '../ui/kit';
import { HiAudio, HiBroadcast, HiDoc, HiExternal, HiMic, HiSearch, HiVideo, HiX } from '../ui/icons';
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

export function LibraryScreen({ account, intent, onIntentDone, onPlay }: { account: Account; intent: PanelIntent | null; onIntentDone: () => void; onPlay: (t: PlayTarget) => void }) {
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
                <div key={`${h.recordingId}:${h.sentenceId}`} className="lrow lrow--click lib-hit" role="button" tabIndex={0} onClick={() => void openHit(h)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) void openHit(h); }}>
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
        <Recent own={account.reach === 'own'} onPlay={onPlay} />
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

function Recent({ own, onPlay }: { own: boolean; onPlay: (t: PlayTarget) => void }) {
  const { data, error, loading, reload } = useLoad(async () => (await (await client()).transcriptions.listPage({ limit: 30 })).transcriptions);
  const working = (data ?? []).some((t) => t.currentRecording?.state === 'live' || (t.job && ['queued', 'fetching', 'transcribing'].includes(t.job.state)));
  // Keep the progress current while something is in progress.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [working, reload]);

  if (error) return <Note kind="bad">{error} <button type="button" className="pg-link" onClick={() => void reload()}>Try again</button></Note>;
  if (!data) return loading ? <div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div> : null;
  if (!data.length) return (
    <div className="card2 empty2">
      <span className="round round--lg"><HiDoc /></span>
      <div className="empty2__text">No transcriptions yet. Transcribe something from the Page tab, upload a file, or record in Live.{own && <><br />This sign-in sees only what the extension made.</>}</div>
    </div>
  );
  const groups: { label: string; items: Transcription[] }[] = [];
  for (const t of data) {
    const label = dayOf(t.lastRecordedAt ?? t.createdAt);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(t); else groups.push({ label, items: [t] });
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.label} className="card2" style={{ padding: '12px 14px 2px' }}>
          <div className="ey-row ey--line"><span className="ey">{g.label}</span>{g === groups[0] && own && <span className="ey">MADE BY THE EXTENSION</span>}</div>
          <div style={{ marginTop: 4 }}>{g.items.map((t) => <LibRow key={t.id} t={t} today={g.label === 'TODAY'} onChanged={() => void reload()} onPlay={onPlay} />)}</div>
        </div>
      ))}
    </>
  );
}

/* Whether a meeting's recording has its summary, once per panel. */
const summaries = new Map<string, Promise<boolean>>();
function useSummary(rid: string | null | undefined): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!rid) return;
    let p = summaries.get(rid);
    if (!p) { p = client().then((vs) => vs.recordings.get(rid)).then((r) => !!r.summary, () => false); summaries.set(rid, p); }
    let on = true;
    void p.then((v) => { if (on) setHas(v); });
    return () => { on = false; };
  }, [rid]);
  return has;
}

function LibRow({ t, today, onChanged, onPlay }: { t: Transcription; today: boolean; onChanged: () => void; onPlay: (t: PlayTarget) => void }) {
  const retry = useAction();
  const { label, Icon } = sourceOf(t);
  // Known once the fetch has it; one that won't load, the source's icon.
  const [badPic, setBadPic] = useState<string | null>(null);
  const pic = pictureOf(t) !== badPic ? pictureOf(t) : null;
  const job = t.job;
  const cur = t.currentRecording?.state;
  const dur = t.lastRecording?.durationS ?? job?.source?.durationS;
  const pct = job ? jobPct(job) : null;
  const working = !!job && ['fetching', 'transcribing'].includes(job.state);
  const failed = job?.state === 'failed' || job?.state === 'stopped';
  const summary = useSummary(t.live && meetingOfName(t.name) && cur !== 'live' && cur !== 'paused' ? t.lastRecording?.recordingId : null);
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
    <div className="lib-row">
      <div className={`lrow${start ? ' lrow--click' : ''}`} {...(start ? { role: 'button', tabIndex: 0, 'aria-label': `Play ${t.name}`, onClick: start, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) start(); } } : { title: NO_PLAY_TEXT[play.why!] })}>
        <span className={`round${pic ? ' round--pic' : ''}`}>{pic ? <img src={pic} alt="" referrerPolicy="no-referrer" onError={() => setBadPic(pic)} /> : <Icon />}</span>
        <div className="lrow__main">
          <div className="lrow__title" title={t.name}>{t.name}</div>
          <div className="lrow__meta" style={failed ? { color: 'var(--bad)' } : undefined} title={meta}>{meta}</div>
          {working && <div className="lrow__bar"><i style={{ width: `${pct ?? 0}%` }} /></div>}
          {(failed || job?.state === 'cropping') && (
            <div className="lrow__acts" onClick={(e) => e.stopPropagation()}>
              {failed && job && <button type="button" className="pg-link" disabled={retry.busy} onClick={() => void retry.run(async () => { await (await client()).jobs.retry(job.recordingId); onChanged(); })}>{retry.busy && <span className="spin" />}Try again</button>}
              {job?.state === 'cropping' && <button type="button" className="pg-link" onClick={open}>Trim in the dashboard</button>}
              {retry.error && <span className="pg-bad">{retry.error}</span>}
            </div>
          )}
        </div>
        {chip}
        <DashButton name={t.name} onClick={open} />
      </div>
    </div>
  );
}
