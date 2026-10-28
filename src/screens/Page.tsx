/** Now (design 3): the active tab, and what to do with it.
 *
 *  - A video page (YouTube and the like): TRANSCRIBE THIS VIDEO, as Live
 *    Transcription (the tab recorded as it plays, Floating Captions over
 *    the video) or, but on YouTube, File Upload (the whole video fetched,
 *    in Upload's list). YouTube's Live Transcription reads the video's
 *    audio ahead of playback (lib/ahead.ts): no File Upload there, but
 *    the Embedded Video Player (transcribed on the server, opened on
 *    video.vocalstack.com in a new tab);
 *  - another page with media: what it plays or links to, ticked, then
 *    Transcribe N Items;
 *  - nothing to transcribe: record the tab in Live, or, in a meeting,
 *    record the meeting at once;
 *  - VocalStack's own page (the video player, a shared transcript): it is
 *    transcribed already, nothing on offer.
 *
 *  While the tab is recorded, its card and a button lead to Live. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LinkProbe } from '@vocalstack/contract';
import type { PanelIntent } from '../background/panel';
import type { Account } from '../lib/auth';
import { isOwn, type PlayerState } from '../lib/shared';
import { videoIdOf } from '../lib/ahead';
import { can, whyNot } from '../lib/access';
import { capturable, isRunning, meetingHost, tabHolder, type LiveStatus } from '../lib/live';
import { AccessNote, ProblemNote } from '../ui/access';
import { client } from '../lib/client';
import { rpc, type Answer } from '../lib/rpc';
import { MEDIA_PAGE, type FoundMedia } from '../lib/media';
import { Note, errorText, useAction } from '../ui/kit';
import { Eyebrow, Switch, Toggle } from '../ui/ds';
import { HiArrowRight, HiAudio, HiCaptions, HiCheck, HiChevronRight, HiDoc, HiExternal, HiPlay, HiGlobe, HiMic, HiNone, HiUpload, HiVideo, Mark, MeetingLogo, YouTubeLogo } from '../ui/icons';
import { useLang, useReadLang, useSpeakerLabels, useSpokenLang } from '../ui/langs';
import { useWarm } from '../ui/useWarm';
import { InvokeNotice, MEETING_SHORT, mmss, useInvoked } from './Live';
import { problemOf } from './page/errors';
import { patch, useTracked } from './page/tracker';
import { transcribeLinks } from './FileDrop';
import { queueLink } from './Upload';

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

const AUTO_PROBES = 10;

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const KIND_META: Record<FoundMedia['kind'], string> = { video: 'VIDEO', audio: 'AUDIO', embed: 'EMBEDDED PLAYER', link: 'LINK', page: 'PAGE' };

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const w = await chrome.windows.getCurrent().catch(() => null);
  const [t] = await chrome.tabs.query(w?.id !== undefined ? { active: true, windowId: w.id } : { active: true, lastFocusedWindow: true });
  return t;
}

const isYouTube = (u: string | undefined) => /^https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|youtu\.be)\//i.test(u ?? '');

export function PageScreen({ account, live, intent, onIntentDone, onSettings, onLive, onLibrary, onUpload }: {
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
    // The design has no Scan again button: media a page adds after it
    // loaded is found when the person comes back to the panel.
    const focused = () => void rescan();
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    window.addEventListener('focus', focused);
    return () => { chrome.tabs.onActivated.removeListener(activated); chrome.tabs.onUpdated.removeListener(updated); window.removeEventListener('focus', focused); };
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
  const own = isOwn(pageUrl);
  /** YouTube, but not a video (home, search, a channel): pick one first. */
  const ytBrowse = !own && isYouTube(pageUrl) && !MEDIA_PAGE.test(pageUrl);
  const base: Row[] = [];
  if (own || ytBrowse) { /* nothing listed */ } else if (pinned) base.push({ ...(scan?.media.find((m) => m.url === pinned.url) ?? pinned), from: 'click' });
  if (!own && !ytBrowse) for (const m of scan?.media ?? []) if (m.url !== pinned?.url) base.push(m);
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
    if (v) return v.ok || v.kind === 'live';
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

  const linkOf = (r: Row) => ({ url: r.url, name: (r.title || host(r.url) || 'From the web').slice(0, 120), live: isLive(r) });
  const transcribe = async () => {
    if (!chosen.length || !mayRecord) return;
    setStarting(true);
    try {
      await transcribeLinks(chosen.map(linkOf));
      setSel(new Set());
      onLibrary();
    } finally {
      setStarting(false);
    }
  };

  const meeting = meetingHost(scan?.url);
  const videoPage = !meeting && !own && !!scan && MEDIA_PAGE.test(scan.url);
  const tabOk = capturable(scan?.url);
  const failed = tracked.filter((t) => t.phase === 'error' && !t.hidden).slice(-2);
  // A scan again (the panel focused) keeps what the last one showed.
  const empty = !own && !ytBrowse && !videoPage && !rows.length && !scanError && (!scanning || !!scan);
  /** This tab's recording, while it runs: the card and a button lead to Live. */
  const holder = scan ? tabHolder(live, scan.tabId) : undefined;
  const recording = !!holder && isRunning(holder);
  const startMeeting = useStartTab(scan?.tabId, onLive);

  return (
    <div className="screen screen--fill" data-screen-label="Now">
      <div className={`card2 site${recording ? ' site--go' : ''}`} {...(recording ? { role: 'button', tabIndex: 0, title: 'Go to Live', onClick: onLive, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLive(); } } } : {})}>
        <span className="round">{meeting ? <MeetingLogo k={meeting.key} size={20} /> : isYouTube(scan?.url) ? <YouTubeLogo size={20} /> : own ? <Mark width={18} height={18} alt="" /> : <HiGlobe width={18} height={18} style={{ color: 'var(--ink-62)' }} />}</span>
        <div className="lrow__main">
          <div className="lrow__title" title={scan?.title}>{scan?.title || (scanning ? 'Reading this tab…' : 'This tab')}</div>
          {scan && (
            <div className="site__sub">
              <i className={`site__dot${recording ? ' site__dot--rec' : ''}`} style={recording ? undefined : { background: videoPage ? 'var(--live)' : 'var(--ink-45)' }} />
              <span className="site__app">{recording ? 'Recording' : meeting ? meeting.name : isYouTube(scan.url) ? 'YouTube' : own ? 'VocalStack' : 'Web page'}</span>
              <span className="site__sep">·</span>
              <span className="site__host">{recording ? 'Go to Live' : meeting ? 'Meeting in progress' : host(scan.url)}</span>
            </div>
          )}
        </div>
        {recording && <HiChevronRight width={14} height={14} style={{ flex: 'none', color: 'var(--ink-45)' }} />}
        {meeting && !recording && <p className="site__call">Record it for a live transcript, and a summary when it ends. {MEETING_SHORT[meeting.key] ?? meeting.name} and your microphone are both recorded.</p>}
      </div>

      {/* As the design: wherever this tab could be recorded from here — a
          video page, or nothing to transcribe (Record This Tab). */}
      {tabOk && invoked === false && (empty || videoPage) && !recording && <InvokeNotice tabId={scan?.tabId} />}
      <AccessNote account={account} need="record" onSettings={onSettings} />
      {scanError && <Note kind="warn">{scanError}</Note>}

      {own && !recording && <OwnPage url={pageUrl} />}
      {ytBrowse && !recording && <PickVideo />}

      {videoPage && scan && (
        <VideoPick account={account} live={live} tabId={scan.tabId} url={scan.url} title={scan.title} durationS={rows.find((r) => r.playing)?.durationS ?? rows.find((r) => r.kind === 'video')?.durationS}
          stream={rows.some(isLive)} recording={recording} onLive={onLive} onUpload={onUpload} onSettings={onSettings} />
      )}

      {!videoPage && rows.length > 0 && (
        <>
          <div className="card2" style={{ padding: '14px 14px 6px' }}>
            <Eyebrow side={`${rows.length} ${rows.length === 1 ? 'ITEM' : 'ITEMS'}`}>FOUND ON THIS PAGE</Eyebrow>
            <div className="found">
              {rows.map((r) => (
                <FoundRow key={r.url} r={r} page={isPage(r)} probe={probed[r.url]} selectable={selectable(r)} ticked={ticked(r)} started={started.has(r.url)}
                  onToggle={() => toggle(r)} onProbe={() => runProbe(r.url)} />
              ))}
            </div>
          </div>
          <button type="button" className="cta" disabled={!chosen.length || !mayRecord} aria-busy={starting || undefined} title={!mayRecord ? whyNot(account, 'record') : undefined} onClick={() => void transcribe()}>
            {starting && <span className="spin" />}{chosen.length > 1 ? `Transcribe ${chosen.length} Items` : chosen.length ? 'Transcribe' : 'Select Something to Transcribe'}
          </button>
        </>
      )}
      {failed.map((t) => <ProblemNote key={t.key} error={t.problem?.text ?? 'That could not be started.'} onSettings={onSettings}><div style={{ marginTop: 6 }}><button type="button" className="pg-link" onClick={() => patch(t.key, { hidden: true })}>Dismiss</button></div></ProblemNote>)}

      {empty && (
        <>
          {!meeting && (
            <div className="card2 empty2">
              <span className="round round--lg"><HiNone /></span>
              <div className="empty2__head">Nothing to transcribe here</div>
              <div className="empty2__text">No audio or video was found on this page. Record the tab from Live, or upload a file.</div>
            </div>
          )}
          {startMeeting.error && <ProblemNote error={startMeeting.error} onSettings={onSettings} />}
          {recording
            ? <GoLive onLive={onLive} />
            : <button type="button" className="cta cta--end" disabled={!!meeting && !mayRecord} aria-busy={startMeeting.busy || undefined} onClick={meeting ? () => void startMeeting.run('meeting') : onLive}>
                {startMeeting.busy ? <span className="spin" /> : <HiMic />}{meeting ? 'Record This Meeting' : 'Record This Tab'}
              </button>}
        </>
      )}
    </div>
  );
}

/** A video's place on the player (undefined while first checked), read
 *  again every few seconds while its job runs. */
function usePlayer(url: string) {
  const [state, setState] = useState<PlayerState | null | undefined>(undefined);
  const [n, setN] = useState(0);
  useEffect(() => {
    let stop = false;
    let timer = 0;
    const read = async () => {
      const st = await rpc('video.known', { url }).catch(() => null);
      if (stop) return;
      setState(st);
      if (st?.phase === 'working') timer = window.setTimeout(() => void read(), 3000);
    };
    void read();
    return () => { stop = true; clearTimeout(timer); };
  }, [url, n]);
  useEffect(() => { setState(undefined); }, [url]);
  return { state, refresh: () => setN((x) => x + 1) };
}

/** A transcription on the player: a big percentage, its step and a bar
 *  while the job runs; then ready (or why not). */
function PlayerCard({ state, note, ready }: { state: PlayerState | null | undefined; note: string; ready: { head: string; text: string } }) {
  if (state === undefined || state?.phase === 'working') {
    const pct = state?.pct ?? null;
    return (
      <div className="card2 own">
        {pct === null ? <span className="spin own__spin" /> : <div className="own__pct">{pct}<small>%</small></div>}
        <div className="own__step">{state ? state.step : 'Checking this video…'}</div>
        {pct !== null && <div className="progress own__bar"><i style={{ width: `${pct}%` }} /></div>}
        {state && <div className="own__note">{note}</div>}
      </div>
    );
  }
  const failed = state?.phase === 'failed';
  return (
    <div className="card2 empty2">
      <span className={`own__icon${failed ? ' own__icon--bad' : ' own__icon--done'}`}>{failed ? <HiNone /> : <HiCheck />}</span>
      <div className="empty2__head">{failed ? 'This video wasn’t transcribed' : ready.head}</div>
      <div className="empty2__text">{failed ? state!.error : ready.text}</div>
    </div>
  );
}

/** A YouTube video ready on the player, as one big button: its picture
 *  (the sharpest YouTube has), READY, and where it opens. */
function ReadyCard({ videoId, title, busy, onOpen }: { videoId: string | null; title: string; busy: boolean; onOpen: () => void }) {
  const [res, setRes] = useState<'maxresdefault' | 'hqdefault'>('maxresdefault');
  useEffect(() => { setRes('maxresdefault'); }, [videoId]);
  return (
    <button type="button" className="card2 ready" onClick={onOpen} disabled={busy} aria-busy={busy || undefined} aria-label={`Watch ${title || 'this video'} on VocalStack`}>
      <span className="ready__thumb">
        {/* A video without a large picture answers with a small grey one: that one is not taken. */}
        {videoId && <img src={`https://i.ytimg.com/vi/${videoId}/${res}.jpg`} alt="" onError={() => setRes('hqdefault')}
          onLoad={(e) => { if (res === 'maxresdefault' && e.currentTarget.naturalWidth < 400) setRes('hqdefault'); }} />}
        <span className="ready__badge"><HiCheck width={12} height={12} />READY</span>
        <span className="ready__play">{busy ? <span className="spin" /> : <HiPlay width={22} height={22} />}</span>
        <span className="ready__brand"><Mark width={14} height={14} />VocalStack Player</span>
      </span>
      <span className="ready__body">
        <span className="ready__main">
          <span className="ready__head">Watch on VocalStack</span>
          <span className="ready__text">The transcript beside the video, in any language.</span>
        </span>
        <span className="ready__go"><HiArrowRight width={16} height={16} /></span>
      </span>
    </button>
  );
}

/** VocalStack's own page: its transcription's progress while the job
 *  runs, then that it is transcribed. */
function OwnPage({ url }: { url: string }) {
  const { state } = usePlayer(url);
  return <PlayerCard state={state} note="The transcript fills in on the page as it goes." ready={{ head: 'This video is transcribed', text: 'Its transcript plays along on this page.' }} />;
}

/** YouTube, but not on a video: what opening one offers. */
function PickVideo() {
  return (
    <div className="card2 ytpick">
      <div className="ytpick__logo"><YouTubeLogo size={44} /></div>
      <div className="empty2__head">Open a video to get started</div>
      <div className="empty2__text">Pick any video on YouTube, and VocalStack is ready for it here.</div>
      <div className="ytpick__list">
        <div className="ytpick__row"><span className="ytpick__icon"><HiCaptions width={16} height={16} /></span><span><b>Live captions</b> over the video as it plays, in your language</span></div>
        <div className="ytpick__row"><span className="ytpick__icon"><HiVideo width={16} height={16} /></span><span><b>The VocalStack player</b>, with the full transcript beside the video</span></div>
      </div>
    </div>
  );
}

/** Go to Live Transcript: the button while this tab is recorded. */
function GoLive({ onLive }: { onLive: () => void }) {
  return <button type="button" className="cta cta--soft cta--end" onClick={onLive}><i className="cta__live" />Go to Live Transcript<HiArrowRight width={15} height={15} /></button>;
}

/** Start recording the tab from Now: a meeting (tab and microphone) or a
 *  video (the tab alone, with or without Floating Captions), in the
 *  header's languages; then Live shows it. */
function useStartTab(tabId: number | undefined, onLive: () => void) {
  const act = useAction();
  const [spoken] = useSpokenLang();
  const [read] = useReadLang();
  const [labels] = useSpeakerLabels();
  const run = (kind: 'meeting' | 'video', overlay = true) => act.run(async () => {
    await rpc('live.start', { mode: kind === 'meeting' ? 'meeting' : 'record', input: { tab: true, mic: kind === 'meeting' }, tabId, spokenLanguage: spoken, translateTo: read, speakerLabels: labels, overlay });
    onLive();
  });
  return { run, busy: act.busy, error: act.error };
}

type VideoMode = 'live' | 'upload';

/** TRANSCRIBE THIS VIDEO: Live Transcription or File Upload (not on
 *  YouTube), then the chosen one's view (a switch to change it, what
 *  happens, Floating Captions for Live) and its button at the bottom. */
function VideoPick({ account, live, tabId, url, title, durationS, stream, recording, onLive, onUpload, onSettings }: {
  account: Account; live: LiveStatus[]; tabId: number; url: string; title: string; durationS?: number; stream: boolean; recording: boolean;
  onLive: () => void; onUpload: () => void; onSettings: () => void;
}) {
  const [mode, setMode] = useState<VideoMode | null>(null);
  const [floating, setFloating] = useState(true);
  const [read] = useReadLang();
  const readName = useLang()(read)?.name;
  const [spoken, , spokenReady] = useSpokenLang();
  const mayRecord = can(account, 'record');
  const start = useStartTab(tabId, onLive);
  const upload = !isYouTube(url);
  const player = useAction();
  /** Given a player link from here before (YouTube): watched there, not transcribed again. */
  const known = usePlayer(url);
  const onPlayer = !upload && !!known.state && known.state.phase !== 'failed';
  const openPlayer = () => void player.run(async () => {
    // Watched there instead of here: Open in VocalStack takes this tab; the
    // first open (Embedded Video Player) a new one beside it.
    await rpc('video.player', { tabId, url, title: (title || '').replace(/ - YouTube$/, '').slice(0, 120) || undefined, here: onPlayer });
    if (!onPlayer) known.refresh();
  });
  // Instant start: while Live Transcription is on offer, an engine stays loaded.
  useWarm(spokenReady && mayRecord && !recording && mode !== 'upload' && !tabHolder(live, tabId), spoken);
  useEffect(() => { setMode(null); }, [url]);

  const toUpload = () => {
    queueLink({ url, name: (title || host(url) || 'From the web').slice(0, 120), host: isYouTube(url) ? 'YouTube' : host(url), durationS, live: stream });
    onUpload();
  };

  // While the first check runs, nothing: no options that then vanish.
  if (!upload && !recording && known.state === undefined) return null;

  if (onPlayer && !recording) {
    return (
      <>
        <Eyebrow>WATCH ON VOCALSTACK</Eyebrow>
        {known.state!.phase === 'ready'
          ? <ReadyCard videoId={videoIdOf(url)} title={title.replace(/ - YouTube$/, '')} busy={player.busy} onOpen={openPlayer} />
          : <PlayerCard state={known.state} note="Open it now: the transcript fills in as it goes." ready={{ head: 'Ready on VocalStack', text: '' }} />}
        {player.error && <ProblemNote error={player.error} onSettings={onSettings} />}
        {known.state!.phase !== 'ready' && (
          <button type="button" className="cta cta--end" aria-busy={player.busy || undefined} onClick={openPlayer}>
            {player.busy ? <span className="spin" /> : <HiExternal width={15} height={15} />}Open in VocalStack
          </button>
        )}
      </>
    );
  }

  if (!mode || recording) {
    return (
      <>
        <Eyebrow>TRANSCRIBE THIS VIDEO</Eyebrow>
        <div className="stack" style={{ gap: 10 }}>
          {recording
            ? <PickCard icon={<HiMic />} live head="Live Transcription" badge text="Go to the live transcript." onClick={onLive} />
            : <PickCard icon={<HiMic />} head="Live Transcription" text="Transcribe the audio as it plays, with floating captions over the video." onClick={() => setMode('live')} />}
          {upload && <PickCard icon={<HiUpload />} head="File Upload" text="The whole video is fetched and transcribed at once, with a full transcript in your Library." onClick={toUpload} />}
          {!upload && (
            <PickCard icon={<HiVideo />} head="Embedded Video Player" text="Open the video on VocalStack, with its transcript beside it, in a new tab."
              busy={player.busy} disabled={!mayRecord} title={!mayRecord ? whyNot(account, 'record') : undefined} onClick={openPlayer} />
          )}
        </div>
        {player.error && <ProblemNote error={player.error} onSettings={onSettings} />}
      </>
    );
  }

  const isLiveMode = mode === 'live';
  return (
    <>
      {upload && (
        <Switch<VideoMode> label="How to transcribe" value={mode} onChange={setMode} options={[
          { value: 'live', label: 'Live Transcription', icon: <HiMic width={15} height={15} /> },
          { value: 'upload', label: 'File Upload', icon: <HiUpload width={15} height={15} /> },
        ]} />
      )}
      <div className="card2 empty2">
        <span className="round round--lg">{isLiveMode ? <HiMic /> : <HiUpload />}</span>
        <div className="empty2__head">{isLiveMode ? 'Ready to caption this video' : 'Ready to transcribe this video'}</div>
        <div className="empty2__text" style={{ maxWidth: 290 }}>{isLiveMode
          ? 'The audio from this tab is transcribed as it plays, with floating captions over the video.'
          : 'The whole video is fetched and transcribed at once, with a full transcript in your Library.'}</div>
      </div>
      {isLiveMode && (
        <div className="card2 onpage row" style={{ gap: 12 }}>
          <span className={`onpage__icon${floating ? ' onpage__icon--on' : ''}`}><HiCaptions width={16} height={16} /></span>
          <div className="lrow__main">
            <div className="mcard__label">Floating Captions</div>
            <div className="pref__sub">Subtitles in a floating window over the video, in {readName ?? 'the spoken language'}.</div>
          </div>
          <Toggle label="Floating Captions" checked={floating} onChange={setFloating} />
        </div>
      )}
      {start.error && <ProblemNote error={start.error} onSettings={onSettings} />}
      <button type="button" className="cta cta--end" disabled={!mayRecord} aria-busy={start.busy || undefined} title={!mayRecord ? whyNot(account, 'record') : undefined}
        onClick={isLiveMode ? () => void start.run('video', floating) : toUpload}>
        {start.busy ? <span className="spin" /> : isLiveMode ? <HiMic /> : <HiUpload />}{isLiveMode ? 'Start Live Transcription' : 'Transcribe Video'}
      </button>
    </>
  );
}

function PickCard({ icon, head, text, live, badge, busy, disabled, title, onClick }: {
  icon: React.ReactNode; head: string; text: string; live?: boolean; badge?: boolean; busy?: boolean; disabled?: boolean; title?: string; onClick: () => void;
}) {
  return (
    <button type="button" className="card2 pick" onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined} title={title}>
      <span className={`round ${live ? 'round--live' : 'round--brand'}`}>{icon}</span>
      <span className="lrow__main">
        <span className="pick__head">{head}{badge && <span className="pick__badge"><i />IN PROGRESS</span>}</span>
        <span className="pick__text">{text}</span>
      </span>
      {busy ? <span className="spin" /> : <HiChevronRight width={14} height={14} style={{ flex: 'none', color: 'var(--ink-45)' }} />}
    </button>
  );
}

function FoundRow({ r, page, probe: p, selectable, ticked, started, onToggle, onProbe }: {
  r: Row; page: boolean; probe?: ProbeState; selectable: boolean; ticked: boolean; started: boolean;
  onToggle: () => void; onProbe: () => void;
}) {
  const v = p?.state === 'done' ? p.probe : null;
  const live = v?.kind === 'live';
  const meta = [
    live ? 'LIVE STREAM' : KIND_META[r.kind],
    r.durationS && !live ? mmss(r.durationS) : '',
    r.from === 'click' ? 'YOU PICKED THIS' : r.from === 'server' ? 'FOUND ON THE PAGE' : r.playing ? 'MAIN PLAYER' : r.frameUrl ? 'EMBEDDED' : '',
    started ? 'STARTED' : '',
  ].filter(Boolean).join(' · ');
  const cantFetch = (r.streamOnly && (!v || !v.ok)) || (v && !v.ok && /fetch|download|reach|open/i.test(v.problem ?? ''));

  let foot: React.ReactNode = null;
  if (p?.state === 'loading') foot = <><span className="spin" />Checking…</>;
  else if (p?.state === 'error') foot = <span className="pg-bad">{p.text}</span>;
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
