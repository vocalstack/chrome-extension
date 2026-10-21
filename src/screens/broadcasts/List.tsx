/** The account's broadcasts (design 3): New Broadcast, then one row each —
 *  a date tile, the name, what it is doing (live now, or its last
 *  recording's peak audience and length), a LIVE chip. Archived ones are
 *  in the dashboard. */

import { useEffect, useState } from 'react';
import type { Broadcast } from '@vocalstack/contract';
import type { LiveStatus } from '../../lib/live';
import type { Account } from '../../lib/auth';
import { can } from '../../lib/access';
import { client } from '../../lib/client';
import { AccessNote } from '../../ui/access';
import { Note } from '../../ui/kit';
import { HiBroadcast, HiChevronRight, HiPlus } from '../../ui/icons';
import { isActive, sessionOf } from './shared';

/* Each last recording's peak audience, once per panel. */
const peaks = new Map<string, Promise<number | null>>();
function peakOf(rid: string): Promise<number | null> {
  let p = peaks.get(rid);
  if (!p) {
    p = client().then((vs) => vs.recordings.get(rid)).then((r) => (r as { peakListeners?: number | null }).peakListeners ?? null, () => null);
    peaks.set(rid, p);
  }
  return p;
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);

export function BroadcastList({ account, onSettings, items, loading, error, live, onOpen, onNew }: {
  account: Account;
  onSettings: () => void;
  items: Broadcast[] | undefined;
  loading: boolean;
  error: string;
  live: LiveStatus[];
  onOpen: (b: Broadcast) => void;
  onNew: () => void;
}) {
  const [peak, setPeak] = useState<Record<string, number | null>>({});
  useEffect(() => {
    for (const b of (items ?? []).slice(0, 20)) {
      const rid = b.lastRecording?.recordingId;
      if (rid && b.lastRecording?.state === 'ended' && !(rid in peak)) void peakOf(rid).then((n) => setPeak((p) => ({ ...p, [rid]: n })));
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const mayChange = can(account, 'change');
  return (
    <div className="screen" data-screen-label="Broadcasts">
      <button type="button" className="cta" disabled={!mayChange} title={mayChange ? undefined : 'This sign-in may not make changes'} onClick={onNew}><HiPlus />New Broadcast</button>
      <AccessNote account={account} need="change" onSettings={onSettings} />
      {error && <Note kind="bad">{error}</Note>}
      {!items && loading && <div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div>}
      {items && items.length === 0 && (
        <div className="card2 empty2">
          <span className="round round--lg"><HiBroadcast /></span>
          <div className="empty2__text">No broadcasts yet. A broadcast is a link listeners open to follow you live.
            {account.reach === 'own' && <><br />This sign-in sees only the broadcasts the extension made.</>}</div>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="card2 card2--list">
          {items.map((b) => {
            const here = isActive(sessionOf(live, b.id));
            const onAir = here || b.currentRecording?.state === 'live';
            const paused = !onAir && b.currentRecording?.state === 'paused';
            const whenIso = b.currentRecording?.startedAt ?? b.lastRecordedAt ?? b.lastRecording?.startedAt ?? b.createdAt;
            const when = new Date(whenIso);
            const last = b.lastRecording;
            const p = last ? peak[last.recordingId] : null;
            const meta = onAir || paused
              ? [when.toDateString() === new Date().toDateString() ? 'Today' : when.toLocaleDateString(undefined, { weekday: 'short' }), when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })].join(' · ')
              : last
                ? [p ? `${p} at peak` : '', last.durationS ? dur(last.durationS) : '', !p && !last.durationS ? `/${b.code}` : ''].filter(Boolean).join(' · ')
                : b.recordingCount === 0 ? 'Not recorded yet' : `/${b.code}`;
            return (
              <div key={b.id} className="lrow lrow--click" role="button" tabIndex={0} onClick={() => onOpen(b)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(b); } }}>
                <div className="dtile"><div className="dtile__mon">{MON[when.getMonth()]}</div><div className="dtile__day">{String(when.getDate()).padStart(2, '0')}</div></div>
                <div className="lrow__main">
                  <div className="lrow__title">{b.name}</div>
                  <div className="lrow__sub">{meta}{b.access === 'private' ? ' · Private' : ''}</div>
                </div>
                {onAir && <span className="chip chip--live">LIVE</span>}
                {paused && <span className="chip chip--mute">PAUSED</span>}
                <HiChevronRight className="lrow__chev" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
