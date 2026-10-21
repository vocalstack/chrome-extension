/** Broadcasts: the links listeners open to follow a talk live. A list
 *  of the active ones (archived ones are in the dashboard), a create form, and one broadcast's detail, where
 *  this device's microphone can go live in it. */

import { useState } from 'react';
import type { Account } from '../lib/auth';
import type { Broadcast } from '@vocalstack/contract';
import { client } from '../lib/client';
import { IconBtn, Section, useLoad } from '../ui/kit';
import { IconBack } from '../ui/icons';
import { BroadcastList } from './broadcasts/List';
import { BroadcastForm } from './broadcasts/Form';
import { BroadcastDetail } from './broadcasts/Detail';
import { useLiveSessions } from './broadcasts/shared';

type View = { name: 'list' } | { name: 'new' } | { name: 'detail'; b: Broadcast };

export function BroadcastsScreen({ account, onSettings }: { account: Account; onSettings: () => void }) {
  const [view, setView] = useState<View>({ name: 'list' });
  const list = useLoad(async () => (await client()).broadcasts.list());
  const [live, onLive] = useLiveSessions();

  if (view.name === 'new') {
    return (
      <div className="stack">
        <div className="row"><IconBtn label="Back" onClick={() => setView({ name: 'list' })}><IconBack /></IconBtn><strong>New broadcast</strong></div>
        <Section title="Broadcast">
          <BroadcastForm
            onCancel={() => setView({ name: 'list' })}
            onDone={(b) => { void list.reload(); setView({ name: 'detail', b }); }}
          />
        </Section>
      </div>
    );
  }

  if (view.name === 'detail') {
    return (
      <BroadcastDetail
        key={view.b.id}
        initial={view.b}
        account={account}
        onSettings={onSettings}
        live={live}
        onLive={onLive}
        onBack={() => { setView({ name: 'list' }); void list.reload(); }}
        onChanged={() => void list.reload()}
      />
    );
  }

  return (
    <BroadcastList
      account={account}
      onSettings={onSettings}
      items={list.loading && list.data === undefined ? undefined : list.data}
      loading={list.loading}
      error={list.error}
      live={live}
      onOpen={(b) => setView({ name: 'detail', b })}
      onNew={() => setView({ name: 'new' })}
    />
  );
}
