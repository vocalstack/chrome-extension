/** Page (design 3): the active tab, what it plays or links to (ticked,
 *  then Transcribe N Items), Captions and Dub for its video in the
 *  reading language, and — with nothing to transcribe — a way to record
 *  the tab (or the meeting) in Live. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LinkProbe } from '@vocalstack/contract';
import type { PanelIntent } from '../background/panel';
import type { Account } from '../lib/auth';
import { can, whyNot } from '../lib/access';
import { capturable, meetingHost, tabHolder, type DubStatus, type LiveStatus, type VcapStatus } from '../lib/live';
import { AccessNote, ProblemNote } from '../ui/access';
import { client } from '../lib/client';
import { onPush, rpc, type Answer } from '../lib/rpc';
import type { FoundMedia } from '../lib/media';
import { Note, clock, errorText, openApp, useAction } from '../ui/kit';
import { Eyebrow, Toggle } from '../ui/ds';
import { HiAudio, HiCheck, HiChevronRight, HiDoc, HiGlobe, HiLang, HiMic, HiNone, HiVideo, HiVoices, MeetingLogo } from '../ui/icons';
import { IconRestore } from '../ui/icons';
import { ReadInPicker, useLang, useReadLang } from '../ui/langs';
import { InvokeNotice, useInvoked } from './Live';
import { problemOf } from './page/errors';
import { created, patch, track, useTracked } from './page/tracker';

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
const KIND_META: Record<FoundMedia['kind'], string> = { video: 'VIDEO', audio: 'AUDIO', embed: 'EMBEDDED PLAYER', link: 'LINK', page: 'PAGE' };

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const w = await chrome.windows.getCurrent().catch(() => null);
  const [t] = await chrome.tabs.query(w?.id !== undefined ? { active: true, windowId: w.id } : { active: true, lastFocusedWindow: true });
  return t;
}

export function PageScreen({ account, live, intent, onIntentDone, onSettings, onLive, onLibrary }: {
  account: Account;
  live: LiveStatus[];
  intent: PanelIntent | null;
  onIntentDone: () => void;
  onSettings: () => void;
  onLive: () => void;
  onLibrary: () => void;
  onUpload: () => void;
}) {
  const mayRecord = can(account, 'record');
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(true);
  const [pinned, setPinned] = useState<Row | null>(null);
  const [probed, setProbed] = useState<Record<string, ProbeState>>({});
  /** The ticked rows; null until the person ticks one (the main item is). */
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [starting, setStarting] = useState(false);
  const [liveBusy, setLiveBusy] = useState<string | null>(null);
  const tracked = useTracked('page');
  const seq = useRef(0);
  const tabRef = useRef<number | null>(null);
  const scanUrl = useRef('');
  const invoked = useInvoked(scan?.tabId, live);

  const rescan = useCallback(async () => {
    const n = ++seq.current;
    setScanning(true);
    try {
      const tab = await activeTab();
      tabRef.current = tab?.id ?? null;
      const s = await rpc('page.scan', tab?.id !== undefined ? { tabId: tab.id } : {});
      if (n !== seq.current) return;
      if (scanUrl.current !== s.url) setSel(null);
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
    if (intent.url) { setPinned({ url: intent.url, kind: 'link', title: intent.title || host(intent.url), from: 'click' }); setSel(new Set([intent.url])); }
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
  const started = new Set(tracked.filter((t) => t.phase !== 'error').map((t) => t.url));
  const main = rows.find((r) => selectable(r) && !started.has(r.url) && (r.from === 'click' || r.playing)) ?? rows.find((r) => selectable(r) && !started.has(r.url));
  const ticked = (r: Row) => selectable(r) && (sel ? sel.has(r.url) : r === main);
  const chosen = rows.filter(ticked);
  const toggle = (r: Row) => {
    if (!selectable(r)) return;
    const n = new Set(chosen.map((x) => x.url));
    if (n.has(r.url)) n.delete(r.url); else n.add(r.url);
    setSel(n);
  };

  const transcribe = async () => {
    if (!chosen.length || !mayRecord) return;
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
      setSel(new Set());
      onLibrary();
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
      onLibrary();
    } catch (e) {
      patch(key, { phase: 'error', problem: problemOf(e) });
    } finally {
      setLiveBusy(null);
    }
  };

  const meeting = meetingHost(scan?.url);
  const hasVideo = !meeting && rows.some((r) => r.kind === 'video' || r.kind === 'embed' || !!r.streamOnly);
  const liveStream = rows.find(isLive);
  const tabOk = capturable(scan?.url);
  const failed = tracked.filter((t) => t.phase === 'error' && !t.hidden).slice(-2);
  const empty = !rows.length && !scanning && !scanError;

  return (
    <div className="screen" data-screen-label="Page">
      <div className="card2 site">
        <span className="round">{meeting ? <MeetingLogo k={meeting.key} size={20} /> : <span className="sitedot" style={{ background: scan ? 'var(--live)' : 'var(--ink-45)' }} />}</span>
        <div className="lrow__main">
          <div className="lrow__title" title={scan?.title}>{scan?.title || (scanning ? 'Reading this tab…' : 'This tab')}</div>
          {scan && <div className="site__host">{host(scan.url)}</div>}
        </div>
        <button type="button" className="hd__icon" style={{ width: 30, height: 30 }} title="Scan again" aria-label="Scan again" onClick={() => void rescan()} disabled={scanning}>{scanning ? <span className="spin" /> : <IconRestore width={15} height={15} />}</button>
      </div>

      {tabOk && invoked === false && (empty || !!liveStream) && <InvokeNotice />}
      <AccessNote account={account} need="record" onSettings={onSettings} />
      {scanError && <Note kind="warn">{scanError}</Note>}

      {rows.length > 0 && (
        <>
          <div className="card2" style={{ padding: '14px 14px 6px' }}>
            <Eyebrow side={`${rows.length} ${rows.length === 1 ? 'ITEM' : 'ITEMS'}`}>FOUND ON THIS PAGE</Eyebrow>
            <div className="found">
              {rows.map((r) => (
                <FoundRow key={r.url} r={r} page={isPage(r)} probe={probed[r.url]} selectable={selectable(r)} ticked={ticked(r)} started={started.has(r.url)}
                  onToggle={() => toggle(r)} onProbe={() => runProbe(r.url)}
                  onLive={isLive(r) && mayRecord ? () => void transcribeLive(r) : undefined} liveBusy={liveBusy === r.url} />
              ))}
            </div>
          </div>
          <button type="button" className="cta" disabled={!chosen.length || !mayRecord} aria-busy={starting || undefined} title={!mayRecord ? whyNot(account, 'record') : undefined} onClick={() => void transcribe()}>
            {starting && <span className="spin" />}{chosen.length > 1 ? `Transcribe ${chosen.length} Items` : chosen.length ? 'Transcribe' : 'Select Something to Transcribe'}
          </button>
          {failed.map((t) => <ProblemNote key={t.key} error={t.problem?.text ?? 'That could not be started.'} onSettings={onSettings}><div style={{ marginTop: 6 }}><button type="button" className="pg-link" onClick={() => patch(t.key, { hidden: true })}>Dismiss</button></div></ProblemNote>)}
        </>
      )}

      {scan && hasVideo && <MediaCards account={account} live={live} tabId={scan.tabId} url={scan.url} title={scan.title} liveStream={liveStream} onSettings={onSettings} onLive={onLive} />}

      {empty && (
        <>
          <div className="card2 empty2">
            <span className="round round--lg">{meeting ? <HiMic /> : <HiNone />}</span>
            <div className="empty2__head">{meeting ? `You’re in a ${meeting.name} call` : 'Nothing to transcribe here'}</div>
            <div className="empty2__text">{meeting
              ? 'Record the call to get a live transcript, and a summary with action items when it ends.'
              : 'No audio or video was found on this page. Record the tab from Live, or upload a file.'}</div>
          </div>
          <button type="button" className="cta" onClick={onLive}><HiMic />{meeting ? 'Record This Meeting' : 'Record This Tab'}</button>
        </>
      )}
    </div>
  );
}

function FoundRow({ r, page, probe: p, selectable, ticked, started, onToggle, onProbe, onLive, liveBusy }: {
  r: Row; page: boolean; probe?: ProbeState; selectable: boolean; ticked: boolean; started: boolean;
  onToggle: () => void; onProbe: () => void; onLive?: () => void; liveBusy: boolean;
}) {
  const v = p?.state === 'done' ? p.probe : null;
  const live = v?.kind === 'live';
  const meta = [
    live ? 'LIVE STREAM' : KIND_META[r.kind],
    r.durationS && !live ? clock(r.durationS) : '',
    r.from === 'click' ? 'YOU PICKED THIS' : r.from === 'server' ? 'FOUND ON THE PAGE' : r.playing ? 'MAIN PLAYER' : r.frameUrl ? 'EMBEDDED' : '',
    started ? 'STARTED' : '',
  ].filter(Boolean).join(' · ');
  const cantFetch = (r.streamOnly && (!v || !v.ok)) || (v && !v.ok && /fetch|download|reach|open/i.test(v.problem ?? ''));

  let foot: React.ReactNode = null;
  if (p?.state === 'loading') foot = <><span className="spin" />Checking…</>;
  else if (p?.state === 'error') foot = <span className="pg-bad">{p.text}</span>;
  else if (live) foot = <><span>Live now: transcribe it as it plays.</span><button type="button" className="pg-link" disabled={!onLive || liveBusy} onClick={onLive}>{liveBusy ? <span className="spin" /> : null}Transcribe live</button></>;
  else if (v && !v.ok && v.media?.length) foot = <span>{v.media.length === 1 ? 'One recording found on it, listed below.' : `${v.media.length} recordings found on it, listed below.`}</span>;
  else if (v && !v.ok && !r.streamOnly) foot = <span className="pg-bad">{v.problem || 'VocalStack can’t fetch this.'}</span>;
  else if (!p && page && !r.streamOnly) foot = <><span>VocalStack can look for recordings on this page.</span><button type="button" className="pg-link" onClick={onProbe}>Find recordings</button></>;

  const Icon = r.kind === 'audio' ? HiAudio : r.kind === 'video' || r.kind === 'embed' ? HiVideo : r.kind === 'page' ? HiGlobe : HiDoc;
  return (
    <div className="found__item">
      <div className={`lrow${selectable ? ' lrow--click' : ''}`} onClick={onToggle} role="checkbox" aria-checked={ticked} aria-disabled={!selectable} tabIndex={selectable ? 0 : -1}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); } }}>
        <span className="box" aria-checked={ticked} aria-disabled={!selectable}><HiCheck /></span>
        <span className="round"><Icon /></span>
        <div className="lrow__main">
          <div className="lrow__title" title={r.title || r.url}>{r.title || r.url}</div>
          <div className="lrow__meta" title={r.url}>{meta}</div>
        </div>
      </div>
      {(foot || cantFetch) && (
        <div className="found__foot">
          {foot}
          {cantFetch && (
            <span className="pg-hint">Can’t be fetched. Play it and record the tab in Live.
              {page && !p && <> <button type="button" className="pg-link" onClick={onProbe}>Look for recordings anyway</button></>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** What VocalStack transcribes for this tab's video: the main video's own
 *  file when it has one, an embedded player's page, else the page. */
async function videoSource(tabId: number, pageUrl: string): Promise<string> {
  const scan = await rpc('page.scan', { tabId }).catch(() => null);
  const media = scan?.media ?? [];
  const playing = (k: string) => media.filter((m) => m.kind === k && !m.streamOnly).sort((a, b) => Number(!!b.playing) - Number(!!a.playing) || (b.durationS ?? 0) - (a.durationS ?? 0));
  return playing('video')[0]?.url ?? playing('embed')[0]?.url ?? pageUrl;
}

/** Captions and Dub for the tab's video, in the reading language. On a
 *  live stream, Captions records it (a live transcription) shown on the
 *  page. */
function MediaCards({ account, live, tabId, url, title, liveStream, onSettings, onLive }: {
  account: Account; live: LiveStatus[]; tabId: number; url: string; title: string; liveStream?: Row; onSettings: () => void; onLive: () => void;
}) {
  const [readLang] = useReadLang();
  const lang = useLang();
  const read = lang(readLang)?.name ?? 'the spoken language';
  const [cap, setCap] = useState<VcapStatus | null>(null);
  const [dub, setDub] = useState<DubStatus | null>(null);
  const [dubWant, setDubWant] = useState(false);
  const [picking, setPicking] = useState(false);
  const capAct = useAction();
  const dubAct = useAction();
  const mayRecord = can(account, 'record');

  useEffect(() => {
    rpc('vcap.status', { tabId }).then(setCap, () => {});
    rpc('dub.status', { tabId }).then(setDub, () => {});
    return onPush((p) => {
      if (p.push === 'vcap.status' && p.status.tabId === tabId) setCap(p.status);
      if (p.push === 'vcap.gone' && p.tabId === tabId) setCap(null);
      if (p.push === 'dub.status' && p.status.tabId === tabId) setDub(p.status);
    });
  }, [tabId]);

  const startDub = (l: string) => dubAct.run(async () => {
    setDubWant(false);
    const source = await videoSource(tabId, url);
    setDub(await rpc('dub.start', { tabId, url: source, title, lang: l }));
  });
  const capOn = (v: boolean) => capAct.run(async () => {
    if (!v) { await rpc('vcap.stop', { tabId }); setCap(null); return; }
    const source = await videoSource(tabId, url);
    setCap(await rpc('vcap.start', { tabId, url: source, title, lang: readLang }));
  });
  const dubOn = (v: boolean) => {
    if (!v) { setDubWant(false); void dubAct.run(async () => { await rpc('dub.stop', { tabId }); setDub(null); }); return; }
    if (!readLang) { setDubWant(true); setPicking(true); return; }
    void startDub(readLang);
  };

  if (liveStream) {
    // Captions of a stream: a recording of the tab, shown on the page.
    const holder = tabHolder(live, tabId);
    const on = !!holder?.overlay;
    const liveCaps = (v: boolean) => capAct.run(async () => {
      if (!v) { if (holder) await rpc('live.overlay', { id: holder.id, on: false }); return; }
      if (holder) { await rpc('live.overlay', { id: holder.id, on: true }); return; }
      const g = await chrome.storage.local.get(['liveLang', 'speakerLabels']);
      await rpc('live.start', { mode: 'record', input: { tab: true, mic: false }, tabId, overlay: true, translateTo: readLang, spokenLanguage: (g.liveLang as string) || null, speakerLabels: (g.speakerLabels as 'auto' | 'on' | 'off') ?? 'auto' });
      onLive();
    });
    return (
      <div className="screen">
        <MediaCard label="Captions" sub={`Starts a live transcription and shows it on the page as the stream plays, in ${read}.`} icon={<HiLang />} on={on} busy={capAct.busy} disabled={!mayRecord} onChange={(v) => void liveCaps(v)}
          ready={on ? 'LIVE CAPTIONS ON' : undefined} />
        {capAct.error && <ProblemNote error={capAct.error} onSettings={onSettings} />}
      </div>
    );
  }

  const capSteps = ['Transcribing', ...(cap?.lang ? ['Translating'] : [])];
  const capStage = !cap ? 0 : cap.state === 'transcribing' ? 0 : cap.state === 'translating' ? 1 : capSteps.length;
  const dubSteps = ['Transcribing', 'Translating', 'Preparing the voice'];
  const dubStage = !dub ? 0 : dub.state === 'transcribing' ? 0 : dub.state === 'translating' ? 1 : dub.state === 'voicing' ? 2 : 3;
  const capLive = !!cap && cap.state !== 'failed';
  const dubLive = !!dub && dub.state !== 'failed';
  const dubLang = dub ? lang(dub.lang)?.name : readLang ? read : null;
  return (
    <div className="screen">
      <MediaCard label="Captions" sub={`Subtitles in sync with the video, in ${read}.`} icon={<HiLang />} on={capLive} busy={capAct.busy} disabled={!mayRecord} onChange={(v) => void capOn(v)}
        steps={capLive && cap!.state !== 'on' ? capSteps : undefined} stage={capStage} pct={cap?.state === 'transcribing' ? cap.progress : cap?.state === 'translating' ? cap.progress : undefined}
        ready={cap?.state === 'on' ? `CAPTIONS ON · ${cap.lang ? (lang(cap.lang)?.name ?? cap.lang).toUpperCase() : 'AS SPOKEN'}` : undefined} />
      {cap?.state === 'failed' && <ProblemNote error={cap.error ?? 'The captions stopped.'} onSettings={onSettings} />}
      {capAct.error && <ProblemNote error={capAct.error} onSettings={onSettings} />}
      <MediaCard label="Dub" sub={dubLang ? `Hear the video spoken in ${dubLang}, in sync with the picture.` : 'Hear the video spoken in your reading language.'} icon={<HiVoices />} on={dubLive || dubWant} busy={dubAct.busy} disabled={!mayRecord} onChange={dubOn}
        steps={dubLive && dub!.state !== 'playing' && dub!.state !== 'ready' ? dubSteps : undefined} stage={dubStage} pct={dub?.state === 'transcribing' ? dub.progress : undefined}
        waiting={dubWant && !dubLive ? () => setPicking(true) : undefined}
        ready={dub && (dub.state === 'playing' || dub.state === 'ready') ? `DUBBING IN ${(lang(dub.lang)?.name ?? dub.lang).toUpperCase()}` : undefined} />
      {dub?.state === 'failed' && <ProblemNote error={dub.error ?? 'The dub stopped.'} onSettings={onSettings} />}
      {dubAct.error && <ProblemNote error={dubAct.error} onSettings={onSettings} />}
      {(cap?.transcriptionId || dub?.transcriptionId) && (
        <button type="button" className="hd__link" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => void openApp(`/transcriptions/${cap?.transcriptionId ?? dub?.transcriptionId}`)}>Open the transcript<HiChevronRight width={13} height={13} /></button>
      )}
      <ReadInPicker open={picking} onClose={() => { setPicking(false); }} onPicked={(c) => { if (c && dubWant) void startDub(c); else if (!c) setDubWant(false); }} />
    </div>
  );
}

function MediaCard({ label, sub, icon, on, busy, disabled, onChange, steps, stage = 0, pct, waiting, ready }: {
  label: string; sub: string; icon: React.ReactNode; on: boolean; busy?: boolean; disabled?: boolean; onChange: (v: boolean) => void;
  steps?: string[]; stage?: number; pct?: number; waiting?: () => void; ready?: string;
}) {
  const n = steps?.length ?? 1;
  const width = steps ? `${Math.round(((stage + (pct ?? 0.5)) / n) * 100)}%` : '0%';
  return (
    <div className="card2 mcard">
      <div className="row" style={{ gap: 12 }}>
        <span className={`round${on ? ' round--brand' : ''}`}>{icon}</span>
        <div className="lrow__main"><div className="mcard__label">{label}</div><div className="pref__sub">{sub}</div></div>
        <Toggle label={label} checked={on} busy={busy} disabled={disabled} onChange={onChange} />
      </div>
      {steps && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="lrow__bar" style={{ marginTop: 0 }}><i style={{ width }} /></div>
          <div className="steps">
            {steps.map((st, i) => (
              <span key={st} className="steps__st" style={{ color: i < stage ? 'var(--brand)' : i === stage ? 'var(--ink-96)' : 'var(--ink-30)' }}>
                <i />{(i === stage ? `${st}…` : st).toUpperCase()}{i < steps.length - 1 && <span className="steps__sep">→</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {waiting && <button type="button" className="mcard__pick" onClick={waiting}><span>Choose a language to dub into</span><HiChevronRight width={13} height={13} /></button>}
      {ready && <div className="mcard__ready"><i />{ready}<span>· IN YOUR LIBRARY</span></div>}
    </div>
  );
}
