/** One saved speaker: hear their cloned voice speak the fixed preview
 *  line in any language, hear the sample they were saved from, rename,
 *  recolour, switch their voice off, delete. A speaker saved without a
 *  clone (no consent) is recognised only: no preview, no voice to switch.
 *  A draft (a sample uploaded from the dashboard but not saved yet) is
 *  finished here with a name and the speaker's permission. */

import { useEffect, useState } from 'react';
import { deleteSpeaker, getSpeaker, updateSpeaker } from '../../lib/speakers';
import { Btn, Field, IconBtn, LanguageSelect, Note, Section, Seg, ago, openApp, useAction, useLanguages, useLoad } from '../../ui/kit';
import { IconAudio, IconBack, IconExternal, IconPause, IconPlay, IconTrash } from '../../ui/icons';
import {
  COLOR_SLOTS, ConsentCheck, DELETE_NOTE, MAX_NAME, SpeakerAvatar, StateBadge, previewBlob, sampleBlob, seconds, speakerColor, usePlayer, usePollWhile,
} from './shared';

type Sex = '' | 'male' | 'female';

export function SpeakerDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: voice, error, loading, setData } = useLoad(() => getSpeaker(id), [id]);
  const player = usePlayer();
  const save = useAction();
  const del = useAction();
  const langs = useLanguages();
  const [lang, setLang] = useState('en');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  // Finishing a draft.
  const [consent, setConsent] = useState(false);
  const [sex, setSex] = useState<Sex>('');

  useEffect(() => {
    if (!voice) return;
    setName(voice.name);
    if (voice.draft && (voice.gender === 'male' || voice.gender === 'female')) setSex(voice.gender);
    // Only when a different voice arrives, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice?.id]);

  usePollWhile(voice?.state === 'training', async () => {
    try { setData(await getSpeaker(id)); } catch { /* the next poll may work */ }
  });

  const patch = async (body: { name?: string; color?: string; enabled?: boolean }) => {
    if (!voice) return;
    const was = voice;
    setData({ ...was, ...body });
    const v = await save.run(() => updateSpeaker(id, body));
    if (v) setData(v);
    else { setData(was); setName(was.name); }
  };

  const saveName = () => {
    if (!voice || voice.draft) return;
    const n = name.trim();
    if (!n || n === voice.name) { setName(voice.name); return; }
    void patch({ name: n });
  };

  const finishDraft = async () => {
    const v = await save.run(() => updateSpeaker(id, { name: name.trim(), consent: true, draft: false, gender: sex || undefined }));
    if (v) setData(v);
  };

  const remove = async () => {
    player.stop();
    const ok = await del.run(async () => { await deleteSpeaker(id); return true; });
    if (ok) onBack();
  };

  const header = (
    <div className="row">
      <IconBtn label="Back" onClick={() => { player.stop(); onBack(); }}><IconBack /></IconBtn>
      {voice && <SpeakerAvatar v={voice} large />}
      <div className="grow">
        <div className="item__title">{voice ? voice.name.trim() || 'Unnamed speaker' : 'Speaker'}</div>
        {voice && <div className="item__sub">{[voice.gender === 'male' ? 'Male' : voice.gender === 'female' ? 'Female' : null, `created ${ago(voice.createdAt)}`].filter(Boolean).join(' · ')}</div>}
      </div>
      {voice && <StateBadge v={voice} />}
    </div>
  );

  if (!voice) {
    return (
      <div className="stack">
        {header}
        {loading && <div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div>}
        {error && <Note kind="bad">{error}</Note>}
      </div>
    );
  }

  const ready = voice.cloned && voice.state === 'ready' && !voice.draft;
  const langInfo = langs?.languages.find((l) => l.code === lang);
  const pvKey = `pv:${id}:${lang}`;
  const pvOn = player.playing === pvKey;
  const smKey = `sample:${id}`;
  const smOn = player.playing === smKey;

  const sampleRow = (
    <div className="list">
      <div className="item">
        <span className="item__icon"><IconAudio /></span>
        <div className="item__main">
          <div className="item__title">Original sample</div>
          <div className="item__sub">{seconds(voice.sampleS)}{voice.speechS != null ? ` · ${seconds(voice.speechS)} of speech` : ''}</div>
        </div>
        <div className="item__side">
          <IconBtn label={smOn ? 'Stop' : 'Play the sample'} onClick={() => void player.play(smKey, () => sampleBlob(id))}>
            {player.loading === smKey ? <span className="spin" /> : smOn ? <IconPause /> : <IconPlay />}
          </IconBtn>
        </div>
      </div>
    </div>
  );

  const deleteBlock = confirm ? (
    <div className="card">
      <div className="stack" style={{ gap: 8 }}>
        <strong>Delete “{voice.name.trim() || 'this speaker'}” permanently?</strong>
        <p className="hint" style={{ margin: 0 }}>{voice.draft ? 'Removes the sample and this unfinished speaker. Nothing is kept.' : DELETE_NOTE}</p>
        <div className="row">
          <Btn size="sm" kind="danger" icon={<IconTrash />} busy={del.busy} onClick={() => void remove()}>{voice.draft ? 'Discard' : 'Delete speaker'}</Btn>
          <Btn size="sm" kind="ghost" onClick={() => setConfirm(false)}>Cancel</Btn>
        </div>
      </div>
    </div>
  ) : (
    <Btn kind="danger" block icon={<IconTrash />} onClick={() => setConfirm(true)}>{voice.draft ? 'Discard sample' : 'Delete speaker'}</Btn>
  );

  return (
    <div className="stack">
      {header}
      {error && <Note kind="bad">{error}</Note>}
      {save.error && <Note kind="bad">{save.error}</Note>}
      {del.error && <Note kind="bad">{del.error}</Note>}
      {player.error && <Note kind="bad">{player.error}</Note>}

      {voice.state === 'training' && (
        <Section title="Building">
          <div className="progress"><i style={{ width: `${voice.progress}%` }} /></div>
          <p className="hint" style={{ margin: 0 }}>{voice.progress}% · this page updates on its own.</p>
        </Section>
      )}
      {voice.state === 'failed' && <Note kind="bad">{voice.error || 'Their voice could not be built.'} Record a new sample to try again.</Note>}

      {voice.draft ? (
        <>
          <Note kind="warn">This speaker is not saved yet. Name them and confirm permission to save them.</Note>
          <Field label="Name">
            <input className="input" value={name} maxLength={MAX_NAME} placeholder="Who is this?" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Voice" hint="Left on Detect, it is measured from the sample.">
            <Seg<Sex> label="Voice type" value={sex} onChange={setSex} options={[{ value: '', label: 'Detect' }, { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
          </Field>
          <ConsentCheck checked={consent} onChange={setConsent} />
          <Btn kind="primary" block busy={save.busy} disabled={!name.trim() || !consent || voice.state === 'failed'} onClick={() => void finishDraft()}
            title={!consent ? 'Confirm you have permission to clone this voice' : !name.trim() ? 'Name the speaker' : undefined}>
            Save speaker
          </Btn>
          {sampleRow}
        </>
      ) : (
        <>
          {voice.cloned && <Section title="Preview in any language">
            <div className="row">
              <Btn kind="primary" disabled={!ready} icon={player.loading === pvKey ? undefined : pvOn ? <IconPause /> : <IconPlay />} busy={player.loading === pvKey}
                onClick={() => void player.play(pvKey, (alive) => previewBlob(id, lang, langInfo?.name ?? lang, alive))}>
                {pvOn && player.loading !== pvKey ? 'Stop' : 'Play'}
              </Btn>
              <div className="grow">
                <LanguageSelect list="voice" label="Preview language" value={lang} onChange={(v) => { player.stop(); setLang(v ?? 'en'); }} />
              </div>
            </div>
            {langInfo?.previewLine && <p className="vc-line">{langInfo.previewLine}</p>}
            <p className="hint" style={{ margin: 0 }}>{ready ? 'Their voice speaks a preset line in the language you pick.' : 'The preview plays once their voice is ready.'}</p>
          </Section>}

          <Section title="Name">
            <input className="input" aria-label="Speaker name" value={name} maxLength={MAX_NAME} placeholder="Who is this?"
              onChange={(e) => setName(e.target.value)} onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(voice.name); e.currentTarget.blur(); } }} />
          </Section>

          <Section title="Colour">
            <p className="hint" style={{ margin: 0 }}>Used for this speaker’s name and avatar in every transcript.</p>
            <div className="vc-swatches" role="group" aria-label="Colour">
              {COLOR_SLOTS.map((c) => (
                <button key={c} type="button" className="vc-swatch" aria-label={`Colour ${c}`} aria-pressed={voice.color === c}
                  style={{ '--vc': speakerColor(c) } as React.CSSProperties} onClick={() => void patch({ color: c })}><i /></button>
              ))}
            </div>
          </Section>

          {voice.cloned && <Section title="Cloned voice">
            <label className="check">
              <input type="checkbox" checked={voice.enabled} disabled={!ready} onChange={(e) => void patch({ enabled: e.target.checked })} />
              <span>
                Voice enabled
                <span className="hint" style={{ display: 'block' }}>
                  {voice.enabled
                    ? 'Available to every live transcription in this account, and nowhere else.'
                    : 'Live transcriptions fall back to a synthetic voice until this is switched back on.'}
                </span>
              </span>
            </label>
          </Section>}

          <Section title="Sample">
            {sampleRow}
            {voice.cloned && <p className="hint" style={{ margin: 0 }}>Their voice was used {voice.uses} {voice.uses === 1 ? 'time' : 'times'} so far.</p>}
          </Section>
        </>
      )}

      <Btn size="sm" icon={<IconExternal />} onClick={() => openApp(`/speakers/${id}`)}>Open in the dashboard</Btn>
      {deleteBlock}
    </div>
  );
}

