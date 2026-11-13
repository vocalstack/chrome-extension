/** Pick a speaker out of a finished transcription: the transcription, then
 *  one of its speakers with enough audio (the server cuts the best stretch
 *  of them out of the recording itself). */

import { useEffect, useMemo, useState } from 'react';
import type { Transcription, TranscriptSnapshot } from '@vocalstack/js-sdk';
import { client } from '../../lib/client';
import { Field, Note, useLoad } from '../../ui/kit';
import { MIN_SAMPLE_S, SAMPLE_TOLERANCE_S, seconds } from './shared';

/** `appearance`: the speaker's number in the transcript (its `speaker` index). */
export interface AppearancePick { transcriptionId: string; appearance: number; name: string; seconds: number }

interface Cand { speaker: number; name: string; seconds: number; saved: boolean }

function candidates(t: TranscriptSnapshot): Cand[] {
  const secs = new Map<number, number>();
  for (const s of t.segments) {
    if (s.suppressed) continue;
    secs.set(s.speaker, (secs.get(s.speaker) ?? 0) + Math.max(0, s.end - s.start));
  }
  return [...secs.entries()]
    .map(([speaker, lines]) => {
      const info = t.speakers.find((x) => x.speaker === speaker) as (TranscriptSnapshot['speakers'][number] & { speechS?: number | null }) | undefined;
      // What the server counts (their diarized turns added up), else their lines' length.
      const seconds = info?.speechS ?? lines;
      return { speaker, seconds, name: info?.name || `Speaker ${speaker + 1}`, saved: !!info?.speakerId };
    })
    .sort((a, b) => b.seconds - a.seconds);
}

/** A transcription that is still running has no sealed audio to cut from. */
function usable(t: Transcription): string | null {
  return t.state === 'ended' || t.state === 'finalized' || t.job?.state === 'done' ? t.id : null;
}

export function FromAppearance({ value, onChange }: { value: AppearancePick | null; onChange: (p: AppearancePick | null) => void }) {
  const list = useLoad(async () => {
    const page = await (await client()).transcriptions.listPage({ limit: 30 });
    return page.transcriptions.filter((t) => usable(t));
  });
  const [txId, setTxId] = useState('');
  const tx = list.data?.find((t) => t.id === txId) ?? null;
  const usableId = tx ? usable(tx) : null;
  const snap = useLoad(async () => (usableId ? (await client()).transcriptions.transcript(usableId) : null), [usableId]);
  const cands = useMemo(() => (snap.data ? candidates(snap.data) : []), [snap.data]);

  useEffect(() => { onChange(null); /* a new transcription, a new choice */ }, [usableId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack" style={{ gap: 10 }}>
      <Field label="Transcription">
        <select className="select" value={txId} onChange={(e) => setTxId(e.target.value)} disabled={!list.data}>
          <option value="">{list.loading ? 'Loading…' : list.data?.length ? 'Choose a transcription' : 'No finished transcriptions'}</option>
          {list.data?.map((t) => <option key={t.id} value={t.id}>{t.name || 'Untitled'}</option>)}
        </select>
      </Field>
      {list.error && <Note kind="bad">{list.error}</Note>}
      {usableId && snap.loading && <div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div>}
      {snap.error && <Note kind="bad">{snap.error}</Note>}
      {usableId && snap.data && (
        cands.length === 0
          ? <Note>No one speaks in this transcription.</Note>
          : (
            <div className="list" role="radiogroup" aria-label="Speaker">
              {cands.map((c) => {
                const short = c.seconds < MIN_SAMPLE_S - SAMPLE_TOLERANCE_S;
                const on = value?.appearance === c.speaker && value.transcriptionId === usableId;
                return (
                  <label key={c.speaker} className={`item${short ? '' : ' item--click'}`} style={short ? { opacity: 0.55 } : undefined}>
                    <input type="radio" name="vc-speaker" checked={on} disabled={short}
                      onChange={() => onChange({ transcriptionId: tx!.id, appearance: c.speaker, name: /^Speaker \d+$/.test(c.name) ? '' : c.name, seconds: c.seconds })} />
                    <div className="item__main">
                      <div className="item__title">{c.name}</div>
                      <div className="item__sub">
                        {seconds(c.seconds)} of speech{short ? ` · needs ${MIN_SAMPLE_S} s` : ''}{c.saved ? ' · already saved' : ''}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )
      )}
      <p className="hint" style={{ margin: 0 }}>Only finished transcriptions are listed. A speaker needs at least {MIN_SAMPLE_S} seconds of speech.</p>
    </div>
  );
}
