/** The account's voices: name, colour, state, sample length, uses. */

import type { Voice } from '@vocalstack/sdk';
import { client } from '../../lib/client';
import { Btn, Empty, IconBtn, Note, Section, ago, useLoad } from '../../ui/kit';
import { IconChevron, IconPause, IconPlay, IconPlus, IconVoice } from '../../ui/icons';
import { CONSENT_FOOTER, StateBadge, VoiceAvatar, previewBlob, seconds, usePlayer, usePollWhile } from './shared';

function sub(v: Voice): string {
  if (v.state === 'failed') return v.error || 'Could not build this voice';
  if (v.draft) return v.state === 'training' ? 'Sample in · building' : 'Sample in · not created yet';
  const parts = [`${seconds(v.sampleS)} sample`, `${v.uses} ${v.uses === 1 ? 'use' : 'uses'}`];
  if (v.gender === 'male' || v.gender === 'female') parts.unshift(v.gender === 'male' ? 'Male' : 'Female');
  parts.push(ago(v.createdAt));
  return parts.join(' · ');
}

export function VoiceList({ onOpen, onNew }: { onOpen: (v: Voice) => void; onNew: () => void }) {
  const { data, error, loading, setData } = useLoad(async () => (await client()).voices.list());
  const player = usePlayer();
  const voices = data ?? [];
  // Drafts first (the dashboard's NOT COMPLETE row), then newest first.
  const sorted = [...voices].sort((a, b) => Number(b.draft) - Number(a.draft) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const building = voices.some((v) => v.state === 'training');
  usePollWhile(building, async () => {
    try { setData(await (await client()).voices.list()); } catch { /* the next poll may work */ }
  });

  return (
    <div className="stack">
      <Section title="Voices" side={<Btn size="sm" kind="primary" icon={<IconPlus />} onClick={onNew}>New voice</Btn>}>
        {error && <Note kind="bad">{error}</Note>}
        {player.error && <Note kind="bad">{player.error}</Note>}
        {loading && !data && <div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div>}
        {data && voices.length === 0 && (
          <Empty icon={<IconVoice />}>No voices yet. Record thirty seconds and the voice is built from it.</Empty>
        )}
        {sorted.length > 0 && (
          <div className="list">
            {sorted.map((v) => {
              const canPlay = v.state === 'ready' && !v.draft;
              const key = `pv:${v.id}:en`;
              const on = player.playing === key;
              return (
                <div key={v.id} className="item item--click" role="button" tabIndex={0}
                  onClick={() => { player.stop(); onOpen(v); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); player.stop(); onOpen(v); } }}>
                  <VoiceAvatar v={v} />
                  <div className="item__main">
                    <div className="row" style={{ gap: 6 }}>
                      <span className="item__title">{v.name.trim() || 'Unnamed voice'}</span>
                      <StateBadge v={v} />
                    </div>
                    <div className="item__sub" style={v.state === 'failed' ? { color: 'var(--bad)' } : undefined}>{sub(v)}</div>
                    {v.state === 'training' && <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${v.progress}%` }} /></div>}
                  </div>
                  <div className="item__side">
                    {canPlay && (
                      <IconBtn label={on ? 'Stop' : 'Hear this voice'} onClick={(e) => { e.stopPropagation(); void player.play(key, (alive) => previewBlob(v.id, 'en', 'English', alive)); }}>
                        {player.loading === key ? <span className="spin" /> : on ? <IconPause /> : <IconPlay />}
                      </IconBtn>
                    )}
                    <IconChevron className="vc-chev" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
      <p className="hint">{CONSENT_FOOTER}</p>
    </div>
  );
}
