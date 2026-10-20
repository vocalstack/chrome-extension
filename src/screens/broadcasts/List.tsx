/** The account's broadcasts, active or archived. */

import type { Broadcast } from '@vocalstack/contract';
import type { LiveStatus } from '../../lib/live';
import type { Account } from '../../lib/auth';
import { can } from '../../lib/access';
import { AccessNote } from '../../ui/access';
import { Badge, Btn, Empty, Note, Seg, ago } from '../../ui/kit';
import { IconBroadcast, IconChevron, IconPlus, IconUser } from '../../ui/icons';
import { isActive, sessionOf } from './shared';

export type Lifecycle = 'active' | 'archived';

export function BroadcastList({ account, onSettings, lifecycle, onLifecycle, items, loading, error, live, onOpen, onNew }: {
  account: Account;
  onSettings: () => void;
  lifecycle: Lifecycle;
  onLifecycle: (l: Lifecycle) => void;
  items: Broadcast[] | undefined;
  loading: boolean;
  error: string;
  live: LiveStatus[];
  onOpen: (b: Broadcast) => void;
  onNew: () => void;
}) {
  return (
    <div className="stack">
      <div className="row">
        <div className="grow">
          <Seg<Lifecycle> label="Show" value={lifecycle} onChange={onLifecycle} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
        </div>
        <Btn kind="primary" size="sm" icon={<IconPlus />} disabled={!can(account, 'change')} title={can(account, 'change') ? undefined : 'This sign-in may not make changes'} onClick={onNew}>New</Btn>
      </div>
      <AccessNote account={account} need="change" onSettings={onSettings} />

      {error && <Note kind="bad">{error}</Note>}
      {!items && loading && <div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div>}
      {items && items.length === 0 && (
        <Empty icon={<IconBroadcast />}>
          {lifecycle === 'active' ? 'No broadcasts yet. A broadcast is a link listeners open to follow you live.' : 'No archived broadcasts.'}
          {account.reach === 'own' && <><br />This sign-in sees only the broadcasts the extension made.</>}
        </Empty>
      )}
      {items && items.length > 0 && (
        <div className="list">
          {items.map((b) => {
            const here = isActive(sessionOf(live, b.id));
            const onAir = here || b.currentRecording?.state === 'live';
            const paused = !onAir && b.currentRecording?.state === 'paused';
            const last = b.lastRecordedAt ?? b.lastRecording?.startedAt;
            return (
              <div key={b.id} className="item item--click" role="button" tabIndex={0} onClick={() => onOpen(b)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(b); } }}>
                <span className="item__icon"><IconBroadcast /></span>
                <div className="item__main">
                  <div className="item__title">{b.name}</div>
                  <div className="item__sub">
                    <span className="mono">/{b.code}</span> · {b.access === 'private' ? 'Private' : 'Public'}
                    {last ? ` · ${ago(last)}` : b.recordingCount === 0 ? ' · Not recorded yet' : ''}
                  </div>
                </div>
                <div className="item__side">
                  {onAir && <Badge kind="live" dot="pulse">Live</Badge>}
                  {paused && <Badge kind="warn">Paused</Badge>}
                  {(b.listenersNow ?? 0) > 0 && <span className="bc-count" title="Listening now"><IconUser />{b.listenersNow}</span>}
                  <IconChevron className="bc-chev" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
