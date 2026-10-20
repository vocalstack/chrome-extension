/** Live: record this tab, the microphone or both; record a meeting; live
 *  captions and translation. Running sessions show their transcript as it
 *  comes, with pause, stop, translation, captions on the tab and a link to
 *  the recording; finished ones stay until dismissed. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelIntent } from '../background/panel';
import type { Account } from '../lib/auth';
import { can } from '../lib/access';
import { onPush, rpc, type LiveEvent } from '../lib/rpc';
import { capturable, meetingOf, tabHolder, RECORDING_MODES, type LiveMode, type LiveStart, type LiveStatus } from '../lib/live';
import { Badge, Btn, Field, LanguageSelect, Note, Section, Seg, clock, errorText, openApp, useAction, useLangName } from '../ui/kit';
import { AccessNote, ProblemNote } from '../ui/access';
import { problemOf } from './page/errors';
import { IconCaptions, IconClose, IconExternal, IconMeeting, IconMic, IconPause, IconPlay, IconRestore, IconStop, IconTab } from '../ui/icons';
import { useActiveTab } from '../ui/useTab';

type Input = 'tab' | 'mic' | 'both';
type CaptionInput = 'tab' | 'mic';

const MODE_LABEL: Record<LiveMode, string> = { record: 'Recording', meeting: 'Meeting', captions: 'Captions', broadcast: 'Broadcast' };

const INVOKE_HINT = 'To record or caption this tab, Chrome asks for one click first: click the VocalStack icon in the toolbar while on this tab.';
const BROWSER_PAGE = 'Chrome doesn’t let extensions record its own pages or the extension store. Open a web page, or use the microphone.';

/** A start, with its busy state, its error (and the error's code), and
 *  when it was clicked: a start that got as far as a session shows its
 *  error on that session's card instead, once. */
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
function useInvoked(tabId: number | undefined, live: LiveStatus[]): boolean | null {
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

export function LiveScreen({ account, live, intent, onIntentDone, onSettings }: {
  account: Account;
  live: LiveStatus[];
  intent: PanelIntent | null;
  onIntentDone: () => void;
  onSettings: () => void;
}) {
  const tab = useActiveTab();
  const meeting = meetingOf(tab?.url);
  const [input, setInput] = useState<Input>('tab');
  const [lang, setLang] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [recordLang, setRecordLang] = useState<string | null>(null);
  const [captionLang, setCaptionLang] = useState<string | null>(null);
  const [captionInput, setCaptionInput] = useState<CaptionInput>('tab');
  const meetingStart = useStart();
  const recordStart = useStart();
  const captionsStart = useStart();
  const invoked = useInvoked(tab?.id, live);

  useEffect(() => {
    chrome.storage.local.get(['liveLang', 'captionLang', 'liveInput', 'liveTranslate', 'captionInput']).then((g) => {
      if (g.liveLang) setLang(g.liveLang as string);
      if (g.captionLang) setCaptionLang(g.captionLang as string);
      if (g.liveInput) setInput(g.liveInput as Input);
      if (g.liveTranslate) setRecordLang(g.liveTranslate as string);
      if (g.captionInput) setCaptionInput(g.captionInput as CaptionInput);
    });
  }, []);
  useEffect(() => {
    if (!intent) return;
    if (intent.mode === 'meeting') setInput('both');
    onIntentDone();
  }, [intent, onIntentDone]);

  const remember = (k: string, v: unknown) => { void chrome.storage.local.set({ [k]: v }); };
  const sessions = [...live].sort((a, b) => b.startedAt - a.startedAt);
  const holder = tabHolder(live, tab?.id);
  const recordedHere = holder && holder.mode !== 'captions' ? holder : undefined;
  const captionsHere = holder?.mode === 'captions' ? holder : sessions.find((s) => s.mode === 'captions' && !s.input.tab && s.tabId === tab?.id && !['done', 'failed', 'stopping'].includes(s.state));
  const tabOk = capturable(tab?.url);
  const mayRecord = can(account, 'record');
  const mayCaption = can(account, 'change');

  const go = (st: ReturnType<typeof useStart>, start: Omit<LiveStart, 'tabId' | 'spokenLanguage'>) => st.run(() => rpc('live.start', {
    ...start,
    tabId: tab?.id,
    spokenLanguage: lang,
  }));
  /** The click's error, unless the session it made already shows it. */
  const errorOf = (st: ReturnType<typeof useStart>) => {
    const e = st.error;
    if (!e) return null;
    if (live.some((s) => s.state === 'failed' && s.startedAt >= e.at - 50)) return null;
    return <ProblemNote error={e.text} code={e.code} onSettings={onSettings} />;
  };
  const tabNote = (needsTab: boolean) => (needsTab && tab && !tabOk ? <p className="hint" style={{ margin: 0 }}>{BROWSER_PAGE}</p> : null);

  const recordNeedsTab = input !== 'mic';
  const recordBlocked = !mayRecord || (recordNeedsTab && (!tabOk || !!recordedHere));

  return (
    <div className="stack">
      {sessions.map((s) => <Session key={s.id} s={s} account={account} onSettings={onSettings} />)}

      <AccessNote account={account} need="record" onSettings={onSettings} />
      {/* Said once, before a start fails on it. */}
      {tab && tabOk && invoked === false && !holder && <Note>{INVOKE_HINT}</Note>}

      <Field label="Spoken language" hint="Used for recordings and captions.">
        <LanguageSelect label="Spoken language" list="transcription" auto value={lang} onChange={(v) => { setLang(v); remember('liveLang', v); }} />
      </Field>

      {meeting && !recordedHere && (
        <div className="card card--tint stack">
          <div className="row"><IconMeeting width={18} height={18} /><strong className="grow">{meeting} meeting</strong></div>
          <p className="hint" style={{ margin: 0 }}>Records the meeting and your microphone. You get the transcript and a summary when it ends. Use headphones so the meeting is not picked up twice.</p>
          {tabNote(true)}
          <Btn kind="live" busy={meetingStart.busy} disabled={!mayRecord} icon={<IconMeeting />} onClick={() => go(meetingStart, { mode: 'meeting', input: { tab: true, mic: true }, translateTo: recordLang, name: name.trim() || undefined })}>Record meeting</Btn>
          {errorOf(meetingStart)}
        </div>
      )}

      <Section title="Record">
        <div className="card stack">
          <Seg<Input> label="What to record" value={input} onChange={(v) => { setInput(v); remember('liveInput', v); recordStart.clear(); }} options={[
            { value: 'tab', label: 'This tab', icon: <IconTab />, disabled: !!recordedHere || !tabOk, title: recordedHere ? 'This tab is already being recorded' : !tabOk ? 'This page can’t be recorded' : undefined },
            { value: 'mic', label: 'Microphone', icon: <IconMic /> },
            { value: 'both', label: 'Both', disabled: !!recordedHere || !tabOk, title: recordedHere ? 'This tab is already being recorded' : undefined },
          ]} />
          {recordNeedsTab && recordedHere && (
            <Note>This tab is already being recorded (“{recordedHere.name}”, above). To record something else at the same time, choose Microphone.</Note>
          )}
          {recordNeedsTab && !recordedHere && tab && tabOk && <p className="hint" style={{ margin: 0 }}>{tab.title || tab.url}</p>}
          {recordNeedsTab && !recordedHere && tabNote(true)}
          {recordNeedsTab && captionsHere?.input.tab && (
            <p className="hint" style={{ margin: 0 }}>Captions are on for this tab. Recording takes them over: they keep showing, now from the recording.</p>
          )}
          <Field label="Name"><input className="input" placeholder={input === 'mic' ? 'Microphone' : (tab?.title ?? '')} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Field label="Translate into" hint="The translation shows under each line, here and on the recording.">
            <LanguageSelect label="Translate the recording into" list="translation" none="Don't translate" value={recordLang} onChange={(v) => { setRecordLang(v); remember('liveTranslate', v); }} />
          </Field>
          <Btn kind="live" size="lg" block busy={recordStart.busy} disabled={recordBlocked} icon={<span className="dot" />}
            onClick={() => go(recordStart, { mode: 'record', input: { tab: input !== 'mic', mic: input !== 'tab' }, translateTo: recordLang, name: name.trim() || undefined })}>
            Start recording
          </Btn>
          <p className="hint" style={{ margin: 0 }}>Saved to your Transcriptions as it is recorded.</p>
          {errorOf(recordStart)}
        </div>
      </Section>

      <Section title="Captions & translation">
        <div className="card stack">
          <p className="hint" style={{ margin: 0 }}>
            {captionInput === 'mic'
              ? 'What you say into the microphone, as you say it, over this tab and here. Nothing is saved.'
              : 'What this tab plays, as it is said, over its video (or at the foot of the page). Nothing is saved.'}
          </p>
          <Seg<CaptionInput> label="Captions of" value={captionInput} onChange={(v) => { setCaptionInput(v); remember('captionInput', v); captionsStart.clear(); }} options={[
            { value: 'tab', label: 'This tab', icon: <IconTab />, disabled: !tabOk && !recordedHere },
            { value: 'mic', label: 'Microphone', icon: <IconMic /> },
          ]} />
          <Field label="Translate into">
            <LanguageSelect label="Translate captions into" list="translation" none="Don't translate" value={captionLang}
              onChange={(v) => {
                setCaptionLang(v);
                remember('captionLang', v);
                // Captions already on: they switch language at once.
                const on = captionInput === 'tab' ? (recordedHere?.overlay ? recordedHere : captionsHere?.input.tab ? captionsHere : undefined) : (captionsHere && !captionsHere.input.tab ? captionsHere : undefined);
                if (on && ['live', 'paused'].includes(on.state)) void captionsStart.run(() => rpc('live.translate', { id: on.id, lang: v }));
              }} />
          </Field>
          {captionInput === 'tab' && recordedHere ? (
            recordedHere.overlay
              ? <Btn kind="danger" block busy={captionsStart.busy} icon={<IconStop />} onClick={() => captionsStart.run(() => rpc('live.overlay', { id: recordedHere.id, on: false }))}>Hide captions of the recording</Btn>
              : <>
                  <p className="hint" style={{ margin: 0 }}>This tab is being recorded: the captions come from that recording.</p>
                  <Btn kind="primary" block busy={captionsStart.busy} icon={<IconCaptions />} onClick={() => go(captionsStart, { mode: 'captions', input: { tab: true, mic: false }, translateTo: captionLang })}>Show captions of the recording</Btn>
                </>
          ) : (captionInput === 'tab' ? captionsHere?.input.tab : captionsHere && !captionsHere.input.tab) ? (
            <Btn kind="danger" block busy={captionsStart.busy} icon={<IconStop />} onClick={() => captionsStart.run(() => rpc('live.stop', { id: captionsHere!.id }))}>Turn captions off</Btn>
          ) : (
            <>
              {tabNote(captionInput === 'tab')}
              <Btn kind="primary" block busy={captionsStart.busy} disabled={!mayCaption || (captionInput === 'tab' && !tabOk)} icon={<IconCaptions />}
                onClick={() => go(captionsStart, { mode: 'captions', input: { tab: captionInput === 'tab', mic: captionInput === 'mic' }, translateTo: captionLang })}>
                {captionLang ? 'Show translated captions' : 'Show captions'}
              </Btn>
            </>
          )}
          {!mayCaption && <AccessNote account={account} need="change" onSettings={onSettings} />}
          {errorOf(captionsStart)}
        </div>
      </Section>
    </div>
  );
}

function Session({ s, account, onSettings }: { s: LiveStatus; account: Account; onSettings: () => void }) {
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<{ seq: number; text: string; tr?: string }[]>([]);
  const [draft, setDraft] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const act = useAction();
  const stop = useAction();
  const retry = useAction();
  const langName = useLangName();
  const end = useRef<HTMLDivElement>(null);
  const running = ['starting', 'warming', 'live', 'paused', 'stopping'].includes(s.state);
  const recording = RECORDING_MODES.includes(s.mode);

  useEffect(() => {
    const apply = (e: LiveEvent) => {
      if (e.type === 'committed') {
        setLines((l) => {
          const was = l.find((x) => x.seq === e.seq);
          return [...l.filter((x) => x.seq !== e.seq), { seq: e.seq, text: e.text, tr: was?.tr }].sort((a, b) => a.seq - b.seq).slice(-200);
        });
        setDraft('');
      } else if (e.type === 'draft') setDraft(e.text);
      else if (e.type === 'translated') setLines((l) => l.map((x) => (x.seq === e.seq ? { ...x, tr: e.text } : e.seqs?.includes(x.seq) ? { ...x, tr: undefined } : x)));
    };
    rpc('live.history', { id: s.id }).then((h) => h.forEach(apply), () => {});
    return onPush((p) => {
      if (p.push === 'live.level' && p.id === s.id) setLevel(p.level);
      if (p.push === 'live.event' && p.id === s.id) apply(p.event);
    });
  }, [s.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [lines.length, draft]);
  // An error from an earlier pause or stop is old news once the state moves on.
  useEffect(() => { act.setError(''); setConfirmStop(false); }, [s.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!confirmStop) return;
    const t = setTimeout(() => setConfirmStop(false), 4000);
    return () => clearTimeout(t);
  }, [confirmStop]);

  const elapsed = s.sentS ?? (Date.now() - s.startedAt) / 1000;
  const stateBadge =
    s.state === 'live' ? (recording ? <Badge kind="live" dot="pulse">Live</Badge> : <Badge kind="brand" dot>On</Badge>)
    : s.state === 'paused' ? <Badge kind="warn">Paused</Badge>
    : s.state === 'warming' || s.state === 'starting' ? <Badge><span className="spin" style={{ width: 9, height: 9, borderWidth: 1.5 }} />Starting</Badge>
    : s.state === 'stopping' ? <Badge><span className="spin" style={{ width: 9, height: 9, borderWidth: 1.5 }} />Stopping</Badge>
    : s.state === 'failed' ? <Badge kind="bad">Stopped</Badge>
    : <Badge kind="ok">Done</Badge>;
  const inputText = s.input.tab && s.input.mic ? 'tab and microphone' : s.input.tab ? 'tab' : 'microphone';

  const onStop = () => {
    // A recording ends for good: ask once. Captions just go away.
    if (recording && !confirmStop) { setConfirmStop(true); return; }
    setConfirmStop(false);
    void stop.run(() => rpc('live.stop', { id: s.id }));
  };
  const tryAgain = () => retry.run(async () => {
    await rpc('live.forget', { id: s.id });
    await rpc('live.start', {
      mode: s.mode, input: s.input, tabId: s.tabId, spokenLanguage: s.spokenLanguage ?? null, translateTo: s.translateTo ?? null,
      name: s.name, broadcastId: s.broadcastId, overlay: s.overlay,
    });
  });
  const live = s.state === 'live' || s.state === 'paused';

  return (
    // Red is for recording; captions record nothing.
    <div className={`card stack${running ? (recording ? ' card--live' : ' card--tint') : ''}`}>
      <div className="row">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="item__title" title={s.name}>{s.name}</div>
          <div className="item__sub item__sub--wrap">{MODE_LABEL[s.mode]} · {inputText}{s.translateTo ? ` · translated into ${langName(s.translateTo)}` : ''}{s.overlay && s.mode !== 'captions' ? ' · captions on the tab' : ''}</div>
        </div>
        {stateBadge}
        {!running && <button type="button" className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => void rpc('live.forget', { id: s.id })}><IconClose /></button>}
      </div>
      {running && (
        <div className="row">
          <span className="mono tabular" style={{ fontSize: 15, fontWeight: 600 }}>{clock(elapsed)}</span>
          <Meter level={s.state === 'live' ? level : 0} />
          <span className="grow" />
          {s.mode !== 'captions' && (s.state === 'paused'
            ? <Btn size="sm" icon={<IconPlay />} busy={act.busy} onClick={() => act.run(() => rpc('live.pause', { id: s.id, paused: false }))}>Resume</Btn>
            : <Btn size="sm" icon={<IconPause />} busy={act.busy} disabled={s.state !== 'live'} onClick={() => act.run(() => rpc('live.pause', { id: s.id, paused: true }))}>Pause</Btn>)}
          <Btn size="sm" kind="danger" icon={<IconStop />} busy={stop.busy || s.state === 'stopping'} onClick={onStop}>
            {s.state === 'stopping' ? 'Stopping' : confirmStop ? 'Stop recording?' : s.mode === 'captions' ? 'Turn off' : 'Stop'}
          </Btn>
        </div>
      )}
      {live && (
        <div className="row row--wrap">
          <div className="grow" style={{ minWidth: 150 }}>
            <LanguageSelect label="Translate into" list="translation" none="Don't translate" value={s.translateTo ?? null} disabled={act.busy}
              onChange={(v) => void act.run(() => rpc('live.translate', { id: s.id, lang: v }))} />
          </div>
          {s.mode !== 'captions' && s.mode !== 'broadcast' && s.input.tab && (
            <Btn size="sm" icon={<IconCaptions />} busy={act.busy} aria-pressed={!!s.overlay} onClick={() => act.run(() => rpc('live.overlay', { id: s.id, on: !s.overlay }))}>
              {s.overlay ? 'Hide captions on the tab' : 'Show as captions on the tab'}
            </Btn>
          )}
        </div>
      )}
      {s.state === 'failed' && s.error && problemOf({ message: s.error, code: s.errorCode }).access && can(account, s.mode === 'captions' ? 'change' : 'record') ? (
        // Refused for a permission the sign-in has since been given.
        <Note>This failed because the sign-in wasn’t allowed to {s.mode === 'captions' ? 'show captions' : 'record'} at the time. It is now: try again.</Note>
      ) : s.state === 'failed' && s.error && (
        <ProblemNote error={s.error} code={s.errorCode} onSettings={onSettings} />
      )}
      {s.state === 'failed' && (
        <div className="row row--wrap">
          <Btn size="sm" icon={<IconRestore />} busy={retry.busy} onClick={() => void tryAgain()}>Try again</Btn>
          <Btn size="sm" kind="ghost" onClick={() => void rpc('live.forget', { id: s.id })}>Dismiss</Btn>
        </div>
      )}
      {retry.error && <ProblemNote error={retry.error} onSettings={onSettings} />}
      {(act.error || stop.error) && <ProblemNote error={act.error || stop.error} onSettings={onSettings} />}
      {(lines.length > 0 || draft) && (
        <div className="tx" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {lines.slice(-30).map((l) => <p key={l.seq}>{l.text}{l.tr && <span className="tx__tr">{l.tr}</span>}</p>)}
          {draft && <p className="tx__draft">{draft}</p>}
          <div ref={end} />
        </div>
      )}
      {s.mode === 'meeting' && s.state === 'done' && (
        s.summary
          ? <div className="stack"><span className="eyebrow">Summary</span><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s.summary}</p></div>
          : <p className="hint row" style={{ margin: 0 }}><span className="spin" />Writing the summary…</p>
      )}
      {s.transcriptionId && (
        <Btn size="sm" kind="ghost" icon={<IconExternal />} onClick={() => openApp(`/transcriptions/${s.transcriptionId}`)}>Open in VocalStack</Btn>
      )}
      {s.broadcastId && <Btn size="sm" kind="ghost" icon={<IconExternal />} onClick={() => openApp(`/s/${s.broadcastId}`)}>Open the broadcast</Btn>}
    </div>
  );
}

function Meter({ level }: { level: number }) {
  const bars = [0.55, 0.8, 1, 0.8, 0.55];
  return <span className="meter" aria-hidden="true">{bars.map((b, i) => <i key={i} style={{ height: `${Math.max(3, Math.round(level * b * 18))}px` }} />)}</span>;
}
