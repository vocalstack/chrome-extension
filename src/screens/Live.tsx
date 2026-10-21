/** Live (design 3): record this tab, the tab and the microphone, or the
 *  microphone alone — every session a saved live transcription. On a
 *  meeting tab, Tab + mic is the default and the start records the
 *  meeting (a summary when it ends). While one runs, the screen is its
 *  recording card: time, source, Show on the page (the transcript as
 *  captions on the tab), the transcript in the reading language, Pause
 *  and Stop. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelIntent } from '../background/panel';
import type { Account } from '../lib/auth';
import { can, whyNot } from '../lib/access';
import { onPush, rpc, type LiveEvent } from '../lib/rpc';
import { capturable, isRunning, meetingHost, tabHolder, RECORDING_MODES, type LiveStatus } from '../lib/live';
import { errorText, Note, openApp, useAction } from '../ui/kit';
import { AccessNote, ProblemNote } from '../ui/access';
import { Eyebrow, Switch, Toggle } from '../ui/ds';
import { HiCursor, HiExternal, HiPause, HiPlayStroke, MeetingLogo } from '../ui/icons';
import { SpeakerLabelsCard, SpokenLanguageCard, useLang, useReadLang, useSpeakerLabels, useSpokenLang } from '../ui/langs';
import { problemOf } from './page/errors';
import { useActiveTab } from '../ui/useTab';

type Source = 'tab' | 'tabmic' | 'mic';

/** 04:12, 1:02:09: the design's clock. */
export function mmss(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const INVOKE_HINT = 'To record or caption this tab, click the VocalStack icon in Chrome’s toolbar once while on this tab.';
const BROWSER_PAGE = 'Chrome doesn’t let extensions record its own pages or the extension store. Open a web page, or use the microphone.';
const SOURCE_NOTE: Record<Source, string> = {
  tab: 'Only sound from this tab is recorded.',
  tabmic: 'This tab and your microphone are recorded together, so your own voice is included.',
  mic: 'Only your microphone is recorded.',
};
/** Stored choice (`liveInput`), as the earlier panel saved it too. */
const fromStored = (v: unknown): Source | null => (v === 'tab' ? 'tab' : v === 'mic' ? 'mic' : v === 'both' || v === 'tabmic' ? 'tabmic' : null);

/** A start, with its busy state and its error (and the error's code). */
function useStart() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string; at: number } | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    const at = Date.now();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError({ text: errorText(e), code: (e as { code?: string }).code, at });
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(null) };
}

/** Whether the person invoked the extension on the tab (null: not known yet). */
export function useInvoked(tabId: number | undefined, live: LiveStatus[]): boolean | null {
  const [invoked, setInvoked] = useState<boolean | null>(null);
  const runningKey = live.filter((s) => s.state === 'live').map((s) => s.id).join(',');
  useEffect(() => {
    if (tabId === undefined) { setInvoked(null); return; }
    let on = true;
    rpc('tab.invoked', { tabId }).then((v) => { if (on) setInvoked(v); }, () => { if (on) setInvoked(null); });
    // Clicking the toolbar icon keeps the panel open: look again on focus.
    const again = () => { rpc('tab.invoked', { tabId }).then((v) => { if (on) setInvoked(v); }, () => {}); };
    window.addEventListener('focus', again);
    const t = setInterval(again, 2000);
    return () => { on = false; window.removeEventListener('focus', again); clearInterval(t); };
  }, [tabId, runningKey]);
  return invoked;
}

export function InvokeNotice() {
  return <div className="notice" role="status"><HiCursor /><div>{INVOKE_HINT}</div></div>;
}

export function LiveScreen({ account, live, intent, onIntentDone, onSettings }: {
  account: Account;
  live: LiveStatus[];
  intent: PanelIntent | null;
  onIntentDone: () => void;
  onSettings: () => void;
}) {
  const tab = useActiveTab();
  const meeting = meetingHost(tab?.url);
  const [stored, setStored] = useState<Source>('tab');
  /** This tab's own pick (a meeting tab starts on Tab + mic). */
  const [picked, setPicked] = useState<{ tabId?: number; v: Source } | null>(null);
  const [readLang, , readReady] = useReadLang();
  const [spoken, , spokenReady] = useSpokenLang();
  const [labels, , labelsReady] = useSpeakerLabels();
  const prefsReady = readReady && spokenReady && labelsReady;
  const start = useStart();
  const invoked = useInvoked(tab?.id, live);

  useEffect(() => {
    chrome.storage.local.get('liveInput').then((g) => { const v = fromStored(g.liveInput); if (v) setStored(v); });
  }, []);
  useEffect(() => {
    if (!intent) return;
    if (intent.mode === 'meeting') setPicked({ tabId: tab?.id, v: 'tabmic' });
    onIntentDone();
  }, [intent, onIntentDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const src: Source = picked && picked.tabId === tab?.id ? picked.v : meeting ? 'tabmic' : stored;
  const setSrc = (v: Source) => { setPicked({ tabId: tab?.id, v }); if (!meeting) { setStored(v); void chrome.storage.local.set({ liveInput: v }); } start.clear(); };
  const tabOk = capturable(tab?.url);
  const needsTab = src !== 'mic';
  const holder = tabHolder(live, tab?.id);
  const mayRecord = can(account, 'record');
  const isMeeting = !!meeting && needsTab;

  const sessions = [...live].sort((a, b) => b.startedAt - a.startedAt);
  const running = sessions.filter(isRunning);
  const ended = sessions.filter((s) => !isRunning(s));

  const go = () => start.run(() => rpc('live.start', {
    mode: isMeeting ? 'meeting' : 'record',
    input: { tab: needsTab, mic: src !== 'tab' },
    tabId: tab?.id,
    spokenLanguage: spoken,
    translateTo: readLang,
    speakerLabels: labels,
  }));
  /** The click's error, unless the session it made already shows it. */
  const startError = start.error && !live.some((s) => s.state === 'failed' && s.startedAt >= start.error!.at - 50)
    ? <ProblemNote error={start.error.text} code={start.error.code} onSettings={onSettings} /> : null;

  return (
    <div className="screen" data-screen-label="Live" style={running.length ? { flex: 1, minHeight: 0 } : undefined}>
      {running.map((s) => <RecordingCard key={s.id} s={s} account={account} onSettings={onSettings} only={running.length === 1} />)}
      {ended.map((s) => <EndedCard key={s.id} s={s} account={account} onSettings={onSettings} />)}
      {!running.length && (
        <>
          <AccessNote account={account} need="record" onSettings={onSettings} />
          {needsTab && tab && tabOk && invoked === false && <InvokeNotice />}
          {needsTab && tab && !tabOk && <Note>{BROWSER_PAGE}</Note>}
          {needsTab && holder && <Note>This tab is already being recorded (“{holder.name}”).</Note>}
          <div className="card2">
            <Eyebrow>AUDIO SOURCE</Eyebrow>
            <div className="card2__row">
              <Switch<Source> size="sm" label="Audio source" value={src} onChange={setSrc} options={[
                { value: 'tab', label: 'This tab', disabled: !tabOk, title: !tabOk ? 'This page can’t be recorded' : undefined },
                { value: 'tabmic', label: 'Tab + mic', disabled: !tabOk, title: !tabOk ? 'This page can’t be recorded' : undefined },
                { value: 'mic', label: 'Mic only' },
              ]} />
            </div>
            <p className="card2__note" style={{ fontSize: 11.5 }}>{SOURCE_NOTE[src]}</p>
          </div>
          <SpokenLanguageCard />
          <SpeakerLabelsCard />
          <button type="button" className="cta cta--live" disabled={!prefsReady || !mayRecord || (needsTab && (!tabOk || !!holder))} aria-busy={start.busy || undefined}
            title={!mayRecord ? whyNot(account, 'record') : undefined} onClick={() => void go()}>
            {start.busy ? <span className="spin" /> : <span className="cta__dot" />}{isMeeting ? 'Record Meeting' : 'Start Recording'}
          </button>
          {startError}
        </>
      )}
    </div>
  );
}

interface Line { seq: number; text: string; tr?: string; speaker?: string | null; startS: number; endS: number; lang?: string | null }
const LANES = ['var(--lane-a)', 'var(--lane-b)', 'var(--lane-c)'];

/** A running session's transcript: lines, the draft, who said them. */
function useTranscript(id: string) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [draftTr, setDraftTr] = useState('');
  /** Names typed by a person, and names recognised from voices. */
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [voiced, setVoiced] = useState<Record<string, string>>({});
  useEffect(() => {
    const apply = (e: LiveEvent) => {
      if (e.type === 'committed') {
        setLines((l) => {
          const was = l.find((x) => x.seq === e.seq);
          return [...l.filter((x) => x.seq !== e.seq), { seq: e.seq, text: e.text, tr: was?.tr, speaker: e.speaker, startS: e.startS, endS: e.endS, lang: e.lang }].sort((a, b) => a.seq - b.seq).slice(-200);
        });
        setDraft('');
        setDraftTr('');
      } else if (e.type === 'draft') setDraft(e.text);
      else if (e.type === 'draftTranslated') setDraftTr(e.text);
      else if (e.type === 'translated') setLines((l) => l.map((x) => (x.seq === e.seq ? { ...x, tr: e.text } : e.seqs?.includes(x.seq) ? { ...x, tr: undefined } : x)));
      else if (e.type === 'speaker') (e.by === 'person' ? setTyped : setVoiced)((n) => ({ ...n, [e.speaker]: e.name }));
    };
    rpc('live.history', { id }).then((h) => h.forEach(apply), () => {});
    return onPush((p) => { if (p.push === 'live.event' && p.id === id) apply(p.event); });
  }, [id]);
  // A typed name outranks a recognised one; a recognition taken back
  // leaves the typed name, if any.
  const names: Record<string, string> = { ...Object.fromEntries(Object.entries(voiced).filter(([, v]) => v)), ...Object.fromEntries(Object.entries(typed).filter(([, v]) => v)) };
  return { lines, draft, draftTr, names };
}

function RecordingCard({ s, account, onSettings, only }: { s: LiveStatus; account: Account; onSettings: () => void; only: boolean }) {
  const { lines, draft, draftTr, names } = useTranscript(s.id);
  const [confirmStop, setConfirmStop] = useState(false);
  const [, tick] = useState(0);
  const act = useAction();
  const stop = useAction();
  const lang = useLang();
  const end = useRef<HTMLDivElement>(null);
  const recording = RECORDING_MODES.includes(s.mode);

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [lines.length, draft]);
  useEffect(() => { act.setError(''); setConfirmStop(false); }, [s.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!confirmStop) return;
    const t = setTimeout(() => setConfirmStop(false), 4000);
    return () => clearTimeout(t);
  }, [confirmStop]);
  useEffect(() => {
    if (s.state !== 'live') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [s.state]);

  const elapsed = s.sentS ?? (Date.now() - s.startedAt) / 1000;
  const source = `${s.input.tab && s.input.mic ? 'TAB + MIC' : s.input.tab ? 'TAB' : 'MIC'}${s.host && s.input.tab ? ` · ${s.host.toUpperCase()}` : ''}`;
  const tr = s.translateTo ? lang(s.translateTo) : null;
  const detected = s.spokenLanguage ?? [...lines].reverse().find((l) => l.lang)?.lang ?? null;
  const recLang = tr ? (detected ? `${(lang(detected)?.name ?? detected).toUpperCase()} → ${tr.name.toUpperCase()}` : `→ ${tr.name.toUpperCase()}`) : 'AS SPOKEN';
  const speakers = new Set(lines.map((l) => l.speaker ?? '0'));
  const showWho = s.speakerLabels === 'on' || (s.speakerLabels !== 'off' && speakers.size > 1) || Object.keys(names).length > 0;
  const lastSpeaker = lines.length ? lines[lines.length - 1]!.speaker : null;
  const who = (sp: string | null | undefined) => names[sp ?? '0'] || `Speaker ${Number(sp ?? 0) + 1}`;
  const live = s.state === 'live' || s.state === 'paused';
  const pill = s.state === 'live' ? <span className="lpill"><i />LIVE</span>
    : s.state === 'paused' ? <span className="lpill lpill--paused">PAUSED</span>
    : <span className="lpill lpill--wait"><span className="spin" style={{ width: 9, height: 9, borderWidth: 1.5 }} />{s.state === 'stopping' ? 'STOPPING' : 'STARTING'}</span>;
  const onStop = () => {
    if (recording && !confirmStop) { setConfirmStop(true); return; }
    setConfirmStop(false);
    void stop.run(() => rpc('live.stop', { id: s.id }));
  };
  const reading = tr ? tr.name : 'the spoken language';

  return (
    <>
      <div className="card2 rec-head">
        <div className="row" style={{ gap: 8 }}>{pill}<span className="rec-head__time">{mmss(elapsed)}</span></div>
        <div className="rec-head__title">{s.meeting && <MeetingLogo k={s.meeting} size={18} />}<span title={s.name}>{s.name}</span></div>
        <div className="rec-head__src">{source}</div>
      </div>
      {s.tabId !== undefined && s.mode !== 'broadcast' && (
        <div className="card2 onpage">
          <div className="lrow__main">
            <div className="pref__label">Show on the page</div>
            <div className="pref__sub">{s.overlay ? `Captions in ${reading} over this tab’s video, or at the foot of the page.` : `Show the live transcript as captions in ${reading} over this tab’s video, or at the foot of the page.`}</div>
          </div>
          <Toggle label="Show on the page" checked={!!s.overlay} busy={act.busy} disabled={!live} onChange={(v) => void act.run(() => rpc('live.overlay', { id: s.id, on: v }))} />
        </div>
      )}
      <div className={`card2 txcard${only ? ' txcard--grow' : ''}`}>
        <Eyebrow side={recLang}>TRANSCRIPT</Eyebrow>
        <div className="txcard__lines">
          {!lines.length && !draft && <p className="hint" style={{ margin: 0 }}>{s.state === 'live' ? 'Listening…' : s.state === 'paused' ? 'Paused.' : 'Getting ready…'}</p>}
          {lines.slice(-60).map((l) => (
            <div key={l.seq}>
              {showWho && <div className="txl__who"><span style={{ color: LANES[Number(l.speaker ?? 0) % 3] }}>{who(l.speaker)}</span><span className="txl__at">{mmss(l.startS)}</span></div>}
              <div className="txl__text">{tr ? (l.tr ?? <span className="tx__draft">{l.text}</span>) : l.text}</div>
            </div>
          ))}
          {(draft || draftTr) && (
            <div>
              {showWho && <div className="txl__who"><span style={{ color: LANES[Number(lastSpeaker ?? 0) % 3] }}>{who(lastSpeaker)}</span><span className="txl__at">{mmss(lines.length ? lines[lines.length - 1]!.endS : 0)}</span></div>}
              <div className="txl__text">{tr ? (draftTr || <span className="tx__draft">{draft}</span>) : draft}<span className="caret" /></div>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      {(act.error || stop.error) && <ProblemNote error={act.error || stop.error} onSettings={onSettings} />}
      {s.error && s.state !== 'failed' && <Note kind="warn">{s.error}</Note>}
      <div className="row" style={{ gap: 10 }}>
        {s.mode !== 'captions' && (s.state === 'paused'
          ? <button type="button" className="sq-btn" aria-label="Resume" title="Resume" disabled={act.busy} onClick={() => void act.run(() => rpc('live.pause', { id: s.id, paused: false }))}><HiPlayStroke /></button>
          : <button type="button" className="sq-btn" aria-label="Pause" title="Pause" disabled={act.busy || s.state !== 'live'} onClick={() => void act.run(() => rpc('live.pause', { id: s.id, paused: true }))}><HiPause /></button>)}
        <button type="button" className="cta cta--stop" style={{ flex: 1 }} aria-busy={stop.busy || s.state === 'stopping' || undefined} disabled={s.state === 'stopping'} onClick={onStop}>
          {stop.busy || s.state === 'stopping' ? <span className="spin" /> : <span className="cta__sq" />}
          {s.state === 'stopping' ? 'Stopping' : confirmStop ? 'Stop recording?' : recording ? 'Stop recording' : 'Turn off'}
        </button>
      </div>
      {!can(account, 'record') && <AccessNote account={account} need="record" onSettings={onSettings} />}
    </>
  );
}

/** A finished or failed session: how it ended, a meeting's summary, a
 *  way to open it, Try again, Dismiss. */
function EndedCard({ s, account, onSettings }: { s: LiveStatus; account: Account; onSettings: () => void }) {
  const retry = useAction();
  const tryAgain = () => retry.run(async () => {
    await rpc('live.forget', { id: s.id });
    await rpc('live.start', {
      mode: s.mode, input: s.input, tabId: s.tabId, spokenLanguage: s.spokenLanguage ?? null, translateTo: s.translateTo ?? null,
      name: s.name, broadcastId: s.broadcastId, overlay: s.overlay, speakerLabels: s.speakerLabels,
    });
  });
  const failed = s.state === 'failed';
  return (
    <div className="card2 stack" style={{ gap: 10 }}>
      <div className="row">
        <div className="lrow__main">
          <div className="rec-head__title" style={{ marginTop: 0 }}>{s.meeting && <MeetingLogo k={s.meeting} size={16} />}<span title={s.name}>{s.name}</span></div>
          <div className="rec-head__src">{s.input.tab && s.input.mic ? 'TAB + MIC' : s.input.tab ? 'TAB' : 'MIC'}{s.sentS ? ` · ${mmss(s.sentS)}` : ''}</div>
        </div>
        <span className={`chip${failed ? ' chip--bad' : ' chip--ok'}`}>{failed ? 'STOPPED' : 'DONE'}</span>
      </div>
      {failed && s.error && (problemOf({ message: s.error, code: s.errorCode }).access && can(account, 'record')
        ? <Note>This failed because the sign-in wasn’t allowed to record at the time. It is now: try again.</Note>
        : <ProblemNote error={s.error} code={s.errorCode} onSettings={onSettings} />)}
      {s.mode === 'meeting' && s.state === 'done' && (
        s.summary
          ? <div className="stack" style={{ gap: 6 }}><Eyebrow>SUMMARY</Eyebrow><p className="txl__text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s.summary}</p></div>
          : <p className="hint row" style={{ margin: 0 }}><span className="spin" />Writing the summary…</p>
      )}
      {retry.error && <ProblemNote error={retry.error} onSettings={onSettings} />}
      <div className="row row--wrap" style={{ gap: 6 }}>
        {s.transcriptionId && <button type="button" className="hd__link" style={{ height: 30, paddingLeft: 0 }} onClick={() => void openApp(`/transcriptions/${s.transcriptionId}`)}>Open in VocalStack<HiExternal /></button>}
        <span className="grow" />
        {failed && <button type="button" className="hd__link" style={{ height: 30 }} disabled={retry.busy} onClick={() => void tryAgain()}>{retry.busy ? <span className="spin" /> : null}Try again</button>}
        <button type="button" className="hd__link" style={{ height: 30 }} onClick={() => void rpc('live.forget', { id: s.id })}>Dismiss</button>
      </div>
    </div>
  );
}
