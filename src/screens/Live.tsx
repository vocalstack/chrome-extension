/** Live: record this tab, the microphone or both; record a meeting; live
 *  captions on the tab. Running sessions show their transcript as it
 *  comes, with pause, stop and a link to the recording. */

import { useEffect, useRef, useState } from 'react';
import type { PanelIntent } from '../background/panel';
import { onPush, rpc, type LiveEvent } from '../lib/rpc';
import { meetingOf, type LiveMode, type LiveStatus } from '../lib/live';
import { Badge, Btn, Field, LanguageSelect, Note, Section, Seg, clock, openApp, useAction } from '../ui/kit';
import { IconCaptions, IconExternal, IconMeeting, IconMic, IconPause, IconPlay, IconStop, IconTab } from '../ui/icons';
import { useActiveTab } from '../ui/useTab';

type Input = 'tab' | 'mic' | 'both';

const MODE_LABEL: Record<LiveMode, string> = { record: 'Recording', meeting: 'Meeting', captions: 'Captions', broadcast: 'Broadcast' };

export function LiveScreen({ live, intent, onIntentDone }: { live: LiveStatus[]; intent: PanelIntent | null; onIntentDone: () => void }) {
  const tab = useActiveTab();
  const meeting = meetingOf(tab?.url);
  const [input, setInput] = useState<Input>('tab');
  const [lang, setLang] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [captionLang, setCaptionLang] = useState<string | null>(null);
  const start = useAction();

  useEffect(() => {
    chrome.storage.local.get(['liveLang', 'captionLang', 'liveInput']).then((g) => {
      if (g.liveLang) setLang(g.liveLang as string);
      if (g.captionLang) setCaptionLang(g.captionLang as string);
      if (g.liveInput) setInput(g.liveInput as Input);
    });
  }, []);
  useEffect(() => {
    if (!intent) return;
    if (intent.mode === 'meeting') setInput('both');
    onIntentDone();
  }, [intent, onIntentDone]);

  const remember = (k: string, v: unknown) => { void chrome.storage.local.set({ [k]: v }); };
  const running = [...live].filter((s) => s.mode !== 'broadcast' || s.state !== 'done').sort((a, b) => b.startedAt - a.startedAt);
  const busyOnTab = (mode: LiveMode) => running.find((s) => s.mode === mode && s.tabId === tab?.id && !['done', 'failed'].includes(s.state));
  const captionsHere = busyOnTab('captions');

  const go = (mode: LiveMode, inp: Input) => start.run(() => rpc('live.start', {
    mode,
    tabId: tab?.id,
    input: { tab: inp !== 'mic', mic: inp !== 'tab' },
    spokenLanguage: lang,
    translateTo: mode === 'captions' ? captionLang : null,
    name: name.trim() || undefined,
  }));

  return (
    <div className="stack">
      {running.map((s) => <Session key={s.id} s={s} />)}

      {meeting && !busyOnTab('meeting') && (
        <div className="card card--tint stack">
          <div className="row"><IconMeeting width={18} height={18} /><strong className="grow">{meeting} meeting</strong></div>
          <p className="hint" style={{ margin: 0 }}>Records the meeting and your microphone. You get the transcript and a summary when it ends. Use headphones so the meeting is not picked up twice.</p>
          <Btn kind="live" busy={start.busy} icon={<IconMeeting />} onClick={() => go('meeting', 'both')}>Record meeting</Btn>
        </div>
      )}

      <Section title="Record">
        <div className="card stack">
          <Seg<Input> label="What to record" value={input} onChange={(v) => { setInput(v); remember('liveInput', v); }} options={[
            { value: 'tab', label: 'This tab', icon: <IconTab /> },
            { value: 'mic', label: 'Microphone', icon: <IconMic /> },
            { value: 'both', label: 'Both' },
          ]} />
          {input !== 'mic' && tab && <p className="hint" style={{ margin: 0 }}>{tab.title || tab.url}</p>}
          <Field label="Spoken language"><LanguageSelect label="Spoken language" list="transcription" auto value={lang} onChange={(v) => { setLang(v); remember('liveLang', v); }} /></Field>
          <Field label="Name"><input className="input" placeholder={input === 'mic' ? 'Microphone' : (tab?.title ?? '')} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Btn kind="live" size="lg" block busy={start.busy} icon={<span className="dot" />} onClick={() => go('record', input)}>Start recording</Btn>
          <p className="hint" style={{ margin: 0 }}>Saved to your Transcriptions as it is recorded.</p>
        </div>
      </Section>

      <Section title="Live captions">
        <div className="card stack">
          <p className="hint" style={{ margin: 0 }}>Captions over the video playing in this tab, as it is spoken. Nothing is saved.</p>
          <Field label="Translate into"><LanguageSelect label="Translate captions into" list="translation" none="Don't translate" value={captionLang} onChange={(v) => { setCaptionLang(v); remember('captionLang', v); }} /></Field>
          {captionsHere
            ? <Btn kind="danger" block icon={<IconStop />} onClick={() => rpc('live.stop', { id: captionsHere.id })}>Turn captions off</Btn>
            : <Btn kind="primary" block busy={start.busy} icon={<IconCaptions />} onClick={() => go('captions', 'tab')}>Show captions</Btn>}
        </div>
      </Section>

      {start.error && <StartError error={start.error} />}
    </div>
  );
}

function StartError({ error }: { error: string }) {
  const mic = /microphone/i.test(error) && /allow/i.test(error);
  const ask = useAction();
  return (
    <Note kind="bad">
      {error}
      {mic && <div style={{ marginTop: 8 }}><Btn size="sm" busy={ask.busy} icon={<IconMic />} onClick={() => ask.run(() => rpc('mic.ask'))}>Allow the microphone</Btn></div>}
    </Note>
  );
}

function Session({ s }: { s: LiveStatus }) {
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<{ seq: number; text: string; tr?: string }[]>([]);
  const [draft, setDraft] = useState('');
  const act = useAction();
  const end = useRef<HTMLDivElement>(null);
  const active = !['done', 'failed', 'stopping'].includes(s.state);

  useEffect(() => {
    const apply = (e: LiveEvent) => {
      if (e.type === 'committed') { setLines((l) => [...l.filter((x) => x.seq !== e.seq), { seq: e.seq, text: e.text }].slice(-200)); setDraft(''); }
      else if (e.type === 'draft') setDraft(e.text);
      else if (e.type === 'translated') setLines((l) => l.map((x) => (x.seq === e.seq ? { ...x, tr: e.text } : e.seqs?.includes(x.seq) ? { ...x, tr: undefined } : x)));
    };
    rpc('live.history', { id: s.id }).then((h) => h.forEach(apply), () => {});
    return onPush((p) => {
      if (p.push === 'live.level' && p.id === s.id) setLevel(p.level);
      if (p.push === 'live.event' && p.id === s.id) apply(p.event);
    });
  }, [s.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [lines.length, draft]);

  const elapsed = s.sentS ?? (Date.now() - s.startedAt) / 1000;
  const stateBadge =
    s.state === 'live' ? <Badge kind="live" dot="pulse">Live</Badge>
    : s.state === 'paused' ? <Badge kind="warn">Paused</Badge>
    : s.state === 'warming' || s.state === 'starting' ? <Badge><span className="spin" style={{ width: 9, height: 9, borderWidth: 1.5 }} />Starting</Badge>
    : s.state === 'stopping' ? <Badge>Stopping</Badge>
    : s.state === 'failed' ? <Badge kind="bad">Stopped</Badge>
    : <Badge kind="ok">Done</Badge>;

  return (
    <div className={`card stack${active ? ' card--live' : ''}`}>
      <div className="row">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="item__title">{s.name}</div>
          <div className="item__sub">{MODE_LABEL[s.mode]}{s.input.tab && s.input.mic ? ' · tab and microphone' : s.input.tab ? ' · tab' : ' · microphone'}{s.translateTo ? ` · into ${s.translateTo}` : ''}</div>
        </div>
        {stateBadge}
      </div>
      {active && (
        <div className="row">
          <span className="mono tabular" style={{ fontSize: 15, fontWeight: 600 }}>{clock(elapsed)}</span>
          <Meter level={s.state === 'paused' ? 0 : level} />
          <span className="grow" />
          {s.mode !== 'captions' && (s.state === 'paused'
            ? <Btn size="sm" icon={<IconPlay />} busy={act.busy} onClick={() => act.run(() => rpc('live.pause', { id: s.id, paused: false }))}>Resume</Btn>
            : <Btn size="sm" icon={<IconPause />} busy={act.busy} disabled={s.state !== 'live'} onClick={() => act.run(() => rpc('live.pause', { id: s.id, paused: true }))}>Pause</Btn>)}
          <Btn size="sm" kind="danger" icon={<IconStop />} onClick={() => act.run(() => rpc('live.stop', { id: s.id }))}>Stop</Btn>
        </div>
      )}
      {s.error && s.state === 'failed' && <StartError error={s.error} />}
      {act.error && <Note kind="bad">{act.error}</Note>}
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
