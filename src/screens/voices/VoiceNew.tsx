/** A new voice: a name, the speaker's permission, and a sample — recorded
 *  here, uploaded, or taken from a speaker in a transcription. */

import { useEffect, useRef, useState } from 'react';
import type { Voice } from '@vocalstack/js-sdk';
import { client } from '../../lib/client';
import { rpc } from '../../lib/rpc';
import { Btn, Field, IconBtn, Note, Section, Seg, clock, useAction } from '../../ui/kit';
import { IconBack, IconClose, IconFile, IconMic, IconPause, IconPlay, IconRestore, IconStop, IconUpload } from '../../ui/icons';
import { useRecorder } from './recorder';
import { FromSpeaker, type SpeakerPick } from './FromSpeaker';
import {
  ConsentCheck, MAX_NAME, MAX_RECORD_S, MAX_SAMPLE_BYTES, MIN_SAMPLE_S, PASSAGE, SAMPLE_TOLERANCE_S, audioDuration, usePlayer,
} from './shared';

type Src = 'mic' | 'file' | 'speaker';
type Sex = '' | 'male' | 'female';

function size(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function VoiceNew({ onBack, onCreated }: { onBack: () => void; onCreated: (v: Voice) => void }) {
  const [name, setName] = useState('');
  const [src, setSrc] = useState<Src>('mic');
  const [sex, setSex] = useState<Sex>('');
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState('');
  const [pick, setPick] = useState<SpeakerPick | null>(null);
  const mic = useRecorder(MAX_RECORD_S);
  const player = usePlayer();
  const ask = useAction();
  const make = useAction();
  const input = useRef<HTMLInputElement>(null);

  // A new take is a new thing to play back.
  useEffect(() => { player.stop(); player.forget('take'); }, [mic.blob]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFile = async (f: File | null) => {
    setFile(null);
    setFileErr('');
    if (!f) return;
    if (f.size > MAX_SAMPLE_BYTES) { setFileErr(`That file is ${size(f.size)}; the limit is ${MAX_SAMPLE_BYTES / (1024 * 1024)} MB.`); return; }
    const d = await audioDuration(f);
    if (d > 0 && d < MIN_SAMPLE_S - SAMPLE_TOLERANCE_S) { setFileErr(`That recording is ${Math.round(d)} s; at least ${MIN_SAMPLE_S} s is needed.`); return; }
    setFile(f);
  };

  const allowMic = async () => {
    const ok = await ask.run(() => rpc('mic.ask'));
    if (ok !== undefined) { mic.setNeedsPermission(false); void mic.start(); }
  };

  const takeOk = !!mic.blob && !mic.quiet && mic.secs >= MIN_SAMPLE_S - SAMPLE_TOLERANCE_S;
  const sampleOk = src === 'mic' ? takeOk : src === 'file' ? !!file : !!pick;
  const nameOk = !!name.trim();
  const ok = nameOk && consent && sampleOk && !make.busy && mic.state !== 'recording';
  const why = !sampleOk
    ? (src === 'speaker' ? 'Choose a speaker' : 'Add a sample')
    : !consent ? 'Confirm you have permission to clone this voice' : !nameOk ? 'Name the voice' : undefined;

  const create = async () => {
    if (!ok) return;
    player.stop();
    const v = await make.run(async () => {
      const vs = await client();
      const n = name.trim();
      const gender = sex || undefined;
      if (src === 'speaker' && pick) return vs.voices.createFromSpeaker({ recordingId: pick.recordingId, speaker: pick.speaker, name: n });
      if (src === 'file' && file) return vs.voices.create({ name: n, sample: file, fileName: file.name, gender });
      if (mic.blob) return vs.voices.create({ name: n, sample: mic.blob, fileName: 'sample.webm', gender });
      throw new Error('Add a sample first.');
    });
    if (v) onCreated(v);
  };

  const recording = mic.state === 'recording';
  const live = recording || mic.state === 'paused';
  const enough = mic.secs >= MIN_SAMPLE_S;
  const takeKey = `take:${mic.blob?.size ?? 0}`;

  const recorder = (
    <div className="stack" style={{ gap: 10 }}>
      {mic.state !== 'done' && <div className="card vc-passage">{PASSAGE}</div>}
      <div className="row">
        <div className={`meter vc-meter${recording ? '' : ' vc-meter--off'}`} aria-hidden="true">
          {mic.levels.map((l, i) => <i key={i} style={{ height: `${Math.max(12, Math.round(l * 100))}%` }} />)}
        </div>
        <span className="vc-clock tabular" style={{ color: recording ? 'var(--live)' : undefined }}>{clock(mic.secs)}</span>
      </div>
      <div className="progress" aria-label="Sample length"><i style={{ width: `${Math.min(100, (mic.secs / MIN_SAMPLE_S) * 100)}%`, background: enough ? 'var(--ready)' : undefined }} /></div>
      <p className="hint" style={{ margin: 0 }}>
        {mic.state === 'done'
          ? mic.quiet ? '' : `Recorded ${clock(mic.secs)}.`
          : enough
            ? `That is enough. Keep reading for a better voice, or finish. Stops at ${clock(MAX_RECORD_S)}.`
            : `Read the passage aloud. At least ${MIN_SAMPLE_S} seconds, up to ${clock(MAX_RECORD_S)}.`}
      </p>

      {mic.needsPermission && (
        <Note kind="warn">
          VocalStack needs your permission to use the microphone. Chrome asks in a small tab; come back here after.
          <div style={{ marginTop: 8 }}><Btn size="sm" icon={<IconMic />} busy={ask.busy} onClick={() => void allowMic()}>Allow the microphone</Btn></div>
        </Note>
      )}
      {ask.error && <Note kind="bad">{ask.error}</Note>}
      {mic.error && <Note kind="bad">{mic.error}</Note>}
      {mic.quiet && <Note kind="bad">That recording was silent. Check the microphone, then record again.</Note>}
      {mic.state === 'done' && !mic.quiet && !takeOk && <Note kind="bad">That take is shorter than {MIN_SAMPLE_S} seconds. Record again.</Note>}

      <div className="row row--wrap">
        {(mic.state === 'idle' || mic.state === 'starting') && (
          <Btn kind="live" icon={<IconMic />} busy={mic.state === 'starting'} onClick={() => void mic.start()}>Start recording</Btn>
        )}
        {recording && <Btn icon={<IconPause />} onClick={mic.pause}>Pause</Btn>}
        {mic.state === 'paused' && <Btn kind="live" icon={<IconMic />} onClick={mic.resume}>Resume</Btn>}
        {live && <Btn kind={enough ? 'primary' : undefined} icon={<IconStop />} disabled={!enough} onClick={mic.finish} title={enough ? undefined : `Keep going until ${clock(MIN_SAMPLE_S)}`}>Finish</Btn>}
        {mic.state === 'done' && mic.blob && (
          <Btn icon={player.playing === takeKey ? <IconPause /> : <IconPlay />} onClick={() => void player.play(takeKey, async () => mic.blob as Blob)}>
            {player.playing === takeKey ? 'Stop' : 'Play back'}
          </Btn>
        )}
        {(live || mic.state === 'done') && (
          <Btn kind="ghost" icon={<IconRestore />} onClick={() => { player.stop(); mic.reset(); }}>Record again</Btn>
        )}
      </div>
    </div>
  );

  const upload = (
    <div className="stack" style={{ gap: 10 }}>
      <input ref={input} type="file" accept="audio/*,video/*" hidden onChange={(e) => { void pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      {file ? (
        <div className="list">
          <div className="item">
            <span className="item__icon"><IconFile /></span>
            <div className="item__main">
              <div className="item__title">{file.name}</div>
              <div className="item__sub">{size(file.size)}</div>
            </div>
            <div className="item__side">
              <IconBtn label={player.playing === 'file' ? 'Stop' : 'Play'} onClick={() => void player.play('file', async () => file)}>{player.playing === 'file' ? <IconPause /> : <IconPlay />}</IconBtn>
              <IconBtn label="Remove" onClick={() => { player.stop(); player.forget('file'); setFile(null); }}><IconClose /></IconBtn>
            </div>
          </div>
        </div>
      ) : (
        <Btn block icon={<IconUpload />} onClick={() => input.current?.click()}>Choose an audio file</Btn>
      )}
      {fileErr && <Note kind="bad">{fileErr}</Note>}
      <p className="hint" style={{ margin: 0 }}>MP3, M4A or WAV of one person speaking. Thirty seconds is enough; a few minutes is better. Up to {MAX_SAMPLE_BYTES / (1024 * 1024)} MB.</p>
    </div>
  );

  return (
    <div className="stack">
      <div className="row">
        <IconBtn label="Back" onClick={() => { player.stop(); mic.reset(); onBack(); }}><IconBack /></IconBtn>
        <strong className="grow">{name.trim() || 'New voice'}</strong>
      </div>

      <Field label="Name">
        <input className="input" value={name} maxLength={MAX_NAME} placeholder="Whose voice is this?" onChange={(e) => setName(e.target.value)} />
      </Field>

      <Section title="Sample">
        <Seg<Src> label="Sample source" value={src}
          onChange={(v) => { if (v !== 'mic') mic.pause(); player.stop(); setSrc(v); }}
          options={[{ value: 'mic', label: 'Record' }, { value: 'file', label: 'Upload' }, { value: 'speaker', label: 'Transcription' }]} />
        {src === 'mic' && recorder}
        {src === 'file' && upload}
        {src === 'speaker' && <FromSpeaker value={pick} onChange={(p) => { setPick(p); if (p?.name && !name.trim()) setName(p.name.slice(0, MAX_NAME)); }} />}
      </Section>

      {src !== 'speaker' && (
        <Field label="Voice" hint="Left on Detect, it is measured from the sample.">
          <Seg<Sex> label="Voice type" value={sex} onChange={setSex} options={[{ value: '', label: 'Detect' }, { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
        </Field>
      )}

      <Section title="Permission">
        <ConsentCheck checked={consent} onChange={setConsent} />
      </Section>

      {make.error && <Note kind="bad">{make.error}</Note>}
      {player.error && <Note kind="bad">{player.error}</Note>}
      <Btn kind="primary" size="lg" block busy={make.busy} disabled={!ok} title={why} onClick={() => void create()}>Create voice</Btn>
      {why && !make.busy && <p className="hint" style={{ margin: 0, textAlign: 'center' }}>{why}.</p>}
    </div>
  );
}
