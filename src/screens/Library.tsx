/** Library: search every transcript, or the latest transcriptions. */

import { useEffect, useRef, useState } from 'react';
import type { SearchHit, Transcription } from '@vocalstack/contract';
import type { PanelIntent } from '../background/panel';
import { client } from '../lib/client';
import { Badge, Btn, Empty, Note, Section, ago, clock, errorText, openApp, useLoad } from '../ui/kit';
import { IconClose, IconExternal, IconFile, IconLibrary, IconLive, IconSearch } from '../ui/icons';
import { hitPath, txPath } from '../background/page/paths';
import { jobPct, jobText } from './page/tracker';

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

export function LibraryScreen({ intent, onIntentDone }: { intent: PanelIntent | null; onIntentDone: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // The omnibox's free text: run it here.
  useEffect(() => {
    if (!intent) return;
    if (intent.query !== undefined) setQ(intent.query);
    onIntentDone();
  }, [intent?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { field.current?.focus(); }, []);

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

  const openHit = async (h: SearchHit) => openApp(hitPath(h, await broadcastIds(), q));
  const term = q.trim();

  return (
    <div className="stack">
      <div className="lib-search">
        <IconSearch />
        <input
          ref={field}
          className="input"
          type="search"
          placeholder="Search your transcripts"
          aria-label="Search your transcripts"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }}
        />
        {searching ? <span className="spin" /> : q && <button type="button" className="lib-clear" aria-label="Clear" onClick={() => setQ('')}><IconClose /></button>}
      </div>

      {searchError && <Note kind="bad">{searchError}</Note>}

      {term.length >= 2 ? (
        hits && (hits.length ? (
          <Section title="Lines" side={<span className="hint">{hits.length}</span>}>
            <div className="list">
              {hits.map((h) => (
                <div key={`${h.recordingId}:${h.sentenceId}`} className="item item--click lib-hit" role="link" tabIndex={0} onClick={() => void openHit(h)} onKeyDown={(e) => { if (e.key === 'Enter') void openHit(h); }}>
                  <div className="item__main">
                    <div className="lib-hit__text"><Marked text={h.rendered || h.text} q={term} /></div>
                    <div className="item__sub">
                      {h.live && <><Badge kind="live" dot>Live</Badge> </>}
                      {h.linkName}{h.recordedAt ? ` · ${ago(h.recordedAt)}` : ''} · <span className="tabular">{clock(h.mediaStart)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : !searching && <Empty icon={<IconSearch />}>No line says “{term}”.</Empty>)
      ) : (
        <Recent />
      )}
    </div>
  );
}

function state(t: Transcription): React.ReactNode {
  const cur = t.currentRecording?.state;
  if (cur === 'live') return <Badge kind="live" dot="pulse">Live</Badge>;
  if (cur === 'paused') return <Badge kind="warn">Paused</Badge>;
  const job = t.job;
  if (job) {
    if (job.state === 'failed') return <Badge kind="bad">Failed</Badge>;
    if (job.state === 'queued') return <Badge>Waiting</Badge>;
    if (job.state === 'fetching' || job.state === 'transcribing') {
      const pct = jobPct(job);
      return <Badge kind="brand">{pct !== null ? `${pct}%` : 'Working'}</Badge>;
    }
    if (job.state === 'cropping') return <Badge kind="warn">To trim</Badge>;
  }
  return null;
}

function Recent() {
  const { data, error, loading, reload } = useLoad(async () => (await (await client()).transcriptions.listPage({ limit: 20 })).transcriptions);
  const working = (data ?? []).some((t) => t.currentRecording?.state === 'live' || (t.job && ['queued', 'fetching', 'transcribing'].includes(t.job.state)));
  // Keep the badges current while something is in progress.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [working, reload]);

  if (error) return <Note kind="bad">{error} <Btn size="sm" onClick={() => void reload()}>Try again</Btn></Note>;
  if (!data) return loading ? <Empty><span className="spin" style={{ margin: '0 auto' }} /></Empty> : null;
  if (!data.length) return <Empty icon={<IconLibrary />}>No transcriptions yet. Transcribe something on the This page tab.</Empty>;
  return (
    <Section title="Recent" side={<Btn size="sm" kind="ghost" icon={<IconExternal />} onClick={() => openApp('/transcriptions')}>All</Btn>}>
      <div className="list">
        {data.map((t) => {
          const when = t.lastRecordedAt ?? t.createdAt;
          const dur = t.lastRecording?.durationS;
          const failed = t.job?.state === 'failed';
          return (
            <div key={t.id} className="item item--click" role="link" tabIndex={0} onClick={() => void openApp(txPath(t))} onKeyDown={(e) => { if (e.key === 'Enter') void openApp(txPath(t)); }}>
              <span className="item__icon">{t.live ? <IconLive /> : <IconFile />}</span>
              <div className="item__main">
                <div className="item__title" title={t.name}>{t.name}</div>
                <div className="item__sub">{failed ? (t.job?.error || jobText(t.job!)) : [ago(when), dur ? clock(dur) : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="item__side">{state(t)}</div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
