/** This page: what the active tab plays or links to, whether VocalStack
 *  can fetch each, and transcribing them (or a live stream, live). */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LinkProbe } from '@vocalstack/contract';
import type { PanelIntent } from '../background/panel';
import { client } from '../lib/client';
import { rpc, type Answer } from '../lib/rpc';
import { KIND_LABEL, type FoundMedia } from '../lib/media';
import { Badge, Btn, Empty, IconBtn, Note, Section, clock, errorText, openApp } from '../ui/kit';
import { IconAudio, IconExternal, IconFile, IconGlobe, IconLink, IconLive, IconPage, IconRestore, IconSearch, IconUpload, IconVideo } from '../ui/icons';
import { PlayerTools } from './PlayerTools';
import { uploadFiles } from './FileDrop';
import { problemOf } from './page/errors';
import { created, jobPct, jobText, patch, track, useTracked, type Tracked } from './page/tracker';
import { txPath } from '../background/page/paths';

type Scan = Answer<'page.scan'>;

/** A row: something found, clicked, or listed by the server on a page. */
interface Row extends FoundMedia {
  /** 'click' = from the context menu; 'server' = found on the page by VocalStack. */
  from?: 'click' | 'server';
  /** The page the server found it on. */
  parent?: string;
}

/* Probes, once per address for as long as the panel is open. */
const probes = new Map<string, Promise<LinkProbe>>();
function probe(url: string): Promise<LinkProbe> {
  let p = probes.get(url);
  if (!p) {
    p = client().then((vs) => vs.transcriptions.probe(url));
    p.catch(() => probes.delete(url));
    probes.set(url, p);
  }
  return p;
}
type ProbeState = { state: 'loading' } | { state: 'done'; probe: LinkProbe } | { state: 'error'; text: string };

/** Pages that are one recording: probing them is a plain check, not a
 *  search of the page (which the server counts by the hour). */
const MEDIA_PAGE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch|live|shorts)|youtu\.be\/|vimeo\.com\/\d|soundcloud\.com\/[^/]+\/[^/]+|open\.spotify\.com\/(?:episode|show)\/|dailymotion\.com\/video\/|twitch\.tv\/|kick\.com\/|loom\.com\/share\/)/i;
const AUTO_PROBES = 10;

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function KindIcon({ kind }: { kind: FoundMedia['kind'] }) {
  if (kind === 'video') return <IconVideo />;
  if (kind === 'audio') return <IconAudio />;
  if (kind === 'embed') return <IconPage />;
  if (kind === 'link') return <IconLink />;
  return <IconGlobe />;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const w = await chrome.windows.getCurrent().catch(() => null);
  const [t] = await chrome.tabs.query(w?.id !== undefined ? { active: true, windowId: w.id } : { active: true, lastFocusedWindow: true });
  return t;
}

export function PageScreen({ intent, onIntentDone }: { intent: PanelIntent | null; onIntentDone: () => void }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(true);
  const [pinned, setPinned] = useState<Row | null>(null);
  const [probed, setProbed] = useState<Record<string, ProbeState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [liveBusy, setLiveBusy] = useState<string | null>(null);
  const tracked = useTracked('page');
  const seq = useRef(0);
  const tabRef = useRef<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const scanUrl = useRef('');
  const pinnedUrl = useRef<string | undefined>(undefined);
  pinnedUrl.current = pinned?.url;

  const rescan = useCallback(async () => {
    const n = ++seq.current;
    setScanning(true);
    try {
      const tab = await activeTab();
      tabRef.current = tab?.id ?? null;
      const s = await rpc('page.scan', tab?.id !== undefined ? { tabId: tab.id } : {});
      if (n !== seq.current) return;
      // Another page: what was ticked on the last one is not on this one.
      if (scanUrl.current !== s.url) setSelected((sel) => new Set([...sel].filter((u) => u === pinnedUrl.current)));
      scanUrl.current = s.url;
      setScan(s);
      setScanError('');
    } catch (e) {
      if (n !== seq.current) return;
      setScan(null);
      setScanError(errorText(e));
    } finally {
      if (n === seq.current) setScanning(false);
    }
  }, []);

  useEffect(() => { void rescan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the active tab: another tab, or this one done loading a new page.
  useEffect(() => {
    let windowId: number | undefined;
    chrome.windows.getCurrent().then((w) => { windowId = w.id; }, () => {});
    const activated = (a: { tabId: number; windowId: number }) => { if (windowId === undefined || a.windowId === windowId) void rescan(); };
    const updated = (tabId: number, info: { status?: string }) => { if (tabId === tabRef.current && info.status === 'complete') void rescan(); };
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    return () => { chrome.tabs.onActivated.removeListener(activated); chrome.tabs.onUpdated.removeListener(updated); };
  }, [rescan]);

  // A context-menu click: that address on top, ready to go.
  useEffect(() => {
    if (!intent) return;
    if (intent.url) {
      setPinned({ url: intent.url, kind: 'link', title: intent.title || host(intent.url), from: 'click' });
      setSelected((s) => new Set([...s, intent.url!]));
    }
    onIntentDone();
  }, [intent?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const runProbe = useCallback((url: string) => {
    setProbed((p) => (p[url]?.state === 'done' ? p : { ...p, [url]: { state: 'loading' } }));
    probe(url).then(
      (r) => setProbed((p) => ({ ...p, [url]: { state: 'done', probe: r } })),
      (e) => setProbed((p) => ({ ...p, [url]: { state: 'error', text: problemOf(e).text } })),
    );
  }, []);

  // The rows: the click first, then what the tab has, then what the
  // server found on a page.
  const pageUrl = scan?.url ?? '';
  const base: Row[] = [];
  if (pinned) base.push({ ...(scan?.media.find((m) => m.url === pinned.url) ?? pinned), from: 'click' });
  for (const m of scan?.media ?? []) if (m.url !== pinned?.url) base.push(m);
  const rows: Row[] = [];
  for (const r of base) {
    rows.push(r);
    const p = probed[r.url];
    if (p?.state === 'done') {
      for (const m of p.probe.media ?? []) {
        if (!base.some((b) => b.url === m.url) && !rows.some((x) => x.url === m.url)) rows.push({ url: m.url, kind: 'link', title: m.title ?? host(m.url), from: 'server', parent: r.url });
      }
    }
  }

  const isPage = (r: Row) => r.url === pageUrl || r.kind === 'page' || (!!r.streamOnly && !MEDIA_PAGE.test(r.url));
  const autoProbe = (r: Row) => r.from === 'click' || !isPage(r) || MEDIA_PAGE.test(r.url);

  // Check each address once; a page is searched only when asked.
  const autoKey = rows.filter(autoProbe).slice(0, AUTO_PROBES).map((r) => r.url).join('\n');
  useEffect(() => {
    for (const url of autoKey.split('\n')) if (url && !probed[url]) runProbe(url);
  }, [autoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const verdict = (r: Row) => {
    const p = probed[r.url];
    return p?.state === 'done' ? p.probe : null;
  };
  const isLive = (r: Row) => verdict(r)?.kind === 'live';
  const selectable = (r: Row) => {
    const v = verdict(r);
    if (v) return v.ok && v.kind !== 'live';
    return !isPage(r) && !r.streamOnly && probed[r.url]?.state !== 'error';
  };
  const chosen = rows.filter((r) => selected.has(r.url) && selectable(r));

  const toggle = (url: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(url)) n.delete(url); else n.add(url);
    return n;
  });

  const transcribe = async () => {
    setStarting(true);
    try {
      const vs = await client();
      await Promise.all(chosen.map(async (r) => {
        const name = (r.title || host(r.url) || 'From the web').slice(0, 120);
        const key = track({ origin: 'page', name, url: r.url, phase: 'sending' });
        try {
          created(key, await vs.transcriptions.createFromUrl(r.url, { name, crop: false }));
        } catch (e) {
          patch(key, { phase: 'error', problem: problemOf(e) });
        }
      }));
      setSelected(new Set());
    } finally {
      setStarting(false);
    }
  };

  // A live stream: a live transcription the server pulls, started at once
  // (the dashboard's New live transcription does the same).
  const transcribeLive = async (r: Row) => {
    setLiveBusy(r.url);
    const name = (r.title || host(r.url) || 'Live stream').slice(0, 120);
    const key = track({ origin: 'page', name, url: r.url, phase: 'sending' });
    try {
      const vs = await client();
      const t = await vs.transcriptions.createLive({ name, source: { kind: 'stream', url: r.url } });
      patch(key, { transcription: t });
      await vs.transcriptions.startRecording(t.id);
      patch(key, { phase: 'live' });
    } catch (e) {
      patch(key, { phase: 'error', problem: problemOf(e) });
    } finally {
      setLiveBusy(null);
    }
  };

  const hasVideo = rows.some((r) => r.kind === 'video' || r.kind === 'embed' || !!r.streamOnly);
  const started = new Set(tracked.filter((t) => t.phase !== 'error').map((t) => t.url));

  return (
    <div className="stack">
      {scan && <PlayerTools tabId={scan.tabId} url={scan.url} title={scan.title} hasVideo={hasVideo} />}

      <div className="row">
        <div className="grow">
          <div className="item__title">{scan?.title || (scanning ? 'Reading this tab…' : 'This tab')}</div>
          {scan && <div className="item__sub">{host(scan.url)}</div>}
        </div>
        <IconBtn label="Scan again" onClick={() => void rescan()} disabled={scanning}>{scanning ? <span className="spin" /> : <IconRestore />}</IconBtn>
      </div>

      {scanError && <Note kind="warn">{scanError}</Note>}

      {rows.length > 0 && (
        <Section title="Found on this page" side={<span className="hint">{rows.length}</span>}>
          <div className="list">
            {rows.map((r) => (
              <MediaRow
                key={r.url}
                r={r}
                page={isPage(r)}
                probe={probed[r.url]}
                selectable={selectable(r)}
                selected={selected.has(r.url)}
                started={started.has(r.url)}
                onToggle={() => toggle(r.url)}
                onProbe={() => runProbe(r.url)}
                onLive={isLive(r) ? () => void transcribeLive(r) : undefined}
                liveBusy={liveBusy === r.url}
              />
            ))}
          </div>
          <Btn kind="primary" block disabled={!chosen.length} busy={starting} onClick={() => void transcribe()}>
            {chosen.length > 1 ? `Transcribe ${chosen.length}` : 'Transcribe'}
          </Btn>
        </Section>
      )}
      {!rows.length && !scanning && !scanError && <Empty icon={<IconSearch />}>Nothing playing or linked here.</Empty>}

      {tracked.length > 0 && (
        <Section title="Started here">
          <div className="list">{[...tracked].reverse().map((t) => <StartedRow key={t.key} t={t} />)}</div>
        </Section>
      )}

      <div className="pg-upload">
        <input ref={picker} type="file" accept="audio/*,video/*" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void uploadFiles(f); }} />
        <Btn block icon={<IconUpload />} onClick={() => picker.current?.click()}>Upload a file</Btn>
        <p className="hint">Or drop audio and video files anywhere on this panel.</p>
      </div>
    </div>
  );
}

function MediaRow({ r, page, probe: p, selectable, selected, started, onToggle, onProbe, onLive, liveBusy }: {
  r: Row; page: boolean; probe?: ProbeState; selectable: boolean; selected: boolean; started: boolean;
  onToggle: () => void; onProbe: () => void; onLive?: () => void; liveBusy: boolean;
}) {
  const v = p?.state === 'done' ? p.probe : null;
  const sub = [
    r.from === 'click' ? 'You picked this' : r.from === 'server' ? 'Found on the page' : KIND_LABEL[r.kind],
    host(r.url),
    r.durationS ? clock(r.durationS) : '',
  ].filter(Boolean).join(' · ');
  const cantFetch = (r.streamOnly && (!v || !v.ok)) || (v && !v.ok && /fetch|download|reach|open/i.test(v.problem ?? ''));

  let status: React.ReactNode = null;
  if (p?.state === 'loading') status = <><span className="spin" />Checking…</>;
  else if (p?.state === 'error') status = <span className="pg-bad">{p.text}</span>;
  else if (v?.kind === 'live') status = <><Badge kind="live" dot="pulse">Live</Badge><span>Live now: transcribe it as it plays.</span><Btn size="sm" kind="live" icon={<IconLive />} busy={liveBusy} onClick={onLive}>Transcribe live</Btn></>;
  else if (v?.ok) status = <Badge kind="ok">Can transcribe</Badge>;
  else if (v && v.media?.length) status = <span>{v.media.length === 1 ? 'One recording found on it, listed below.' : `${v.media.length} recordings found on it, listed below.`}</span>;
  else if (v && !r.streamOnly) status = <span className="pg-bad">{v.problem || 'VocalStack can’t fetch this.'}</span>;
  else if (!p && page && !r.streamOnly) status = <><span>VocalStack can look for recordings on this page.</span><Btn size="sm" icon={<IconSearch />} onClick={onProbe}>Find recordings</Btn></>;

  return (
    <div className="pg-row">
      <label className={`item${selectable ? ' item--click' : ''}`}>
        <input type="checkbox" className="pg-check" checked={selectable && selected} disabled={!selectable} onChange={onToggle} aria-label={`Select ${r.title || r.url}`} />
        <span className="item__icon"><KindIcon kind={r.kind} /></span>
        <span className="item__main">
          <span className="item__title" title={r.title || r.url}>{r.title || r.url}</span>
          <span className="item__sub" title={r.url}>{sub}</span>
        </span>
        <span className="item__side">
          {started && <Badge kind="brand">Started</Badge>}
          {r.playing && <Badge kind="live" dot>Playing</Badge>}
        </span>
      </label>
      {(status || cantFetch) && (
        <div className="pg-row__foot">
          {status}
          {cantFetch && (
            <span className="pg-hint">Can’t be fetched. Play it and use Live → Record this tab.
              {page && !p && <> <button type="button" className="pg-link" onClick={onProbe}>Look for recordings anyway</button></>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function StartedRow({ t }: { t: Tracked }) {
  const tx = t.transcription;
  let line: React.ReactNode;
  let pct: number | null = null;
  if (t.phase === 'sending') line = <><span className="spin" />Starting…</>;
  else if (t.phase === 'live') line = <><Badge kind="live" dot="pulse">Live</Badge> Recording the stream</>;
  else if (t.phase === 'working') { line = jobText(t.job); pct = jobPct(t.job); }
  else if (t.phase === 'done') line = <Badge kind="ok">{t.job?.state === 'cropping' ? 'Ready to trim' : 'Done'}</Badge>;
  else line = <span className="pg-bad">{t.problem?.text ?? jobText(t.job)}</span>;
  return (
    <div className="pg-row">
      <div className="item">
        <span className="item__icon">{t.origin === 'file' ? <IconFile /> : <IconLink />}</span>
        <div className="item__main">
          <div className="item__title" title={t.name}>{t.name}</div>
          <div className="item__sub pg-status">{line}</div>
          {pct !== null && <div className="progress pg-progress"><i style={{ width: `${pct}%` }} /></div>}
        </div>
        <div className="item__side">
          {t.problem?.billing && <Btn size="sm" onClick={() => openApp('/billing')}>Billing</Btn>}
          {tx && <IconBtn label="Open in the dashboard" onClick={() => openApp(txPath(t.phase === 'live' ? { ...tx, live: true } : tx))}><IconExternal /></IconBtn>}
        </div>
      </div>
    </div>
  );
}
