/** The side panel: sign-in, then five areas in a tab strip. */

import { useEffect, useState } from 'react';
import type { Account } from '../lib/auth';
import { onPush, rpc } from '../lib/rpc';
import { currentEnv, type Env } from '../lib/env';
import type { LiveStatus } from '../lib/live';
import type { View } from '../background/panel';
import { usePanelIntent } from './intent';
import { IconBroadcast, IconLibrary, IconLive, IconPage, IconSettings, IconVoice, Mark } from './icons';
import { IconBtn } from './kit';
import { SignIn } from '../screens/SignIn';
import { Settings } from '../screens/Settings';
import { PageScreen } from '../screens/Page';
import { LiveScreen } from '../screens/Live';
import { BroadcastsScreen } from '../screens/Broadcasts';
import { VoicesScreen } from '../screens/Voices';
import { LibraryScreen } from '../screens/Library';
import { FileDrop } from '../screens/FileDrop';

const TABS: { view: Exclude<View, 'settings'>; label: string; Icon: typeof IconPage }[] = [
  { view: 'page', label: 'This page', Icon: IconPage },
  { view: 'live', label: 'Live', Icon: IconLive },
  { view: 'broadcasts', label: 'Broadcasts', Icon: IconBroadcast },
  { view: 'voices', label: 'Voices', Icon: IconVoice },
  { view: 'library', label: 'Library', Icon: IconLibrary },
];

export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [env, setEnvState] = useState<Env | null>(null);
  const [view, setView] = useState<View>('page');
  const [live, setLive] = useState<LiveStatus[]>([]);
  const [intent, clearIntent] = usePanelIntent();

  useEffect(() => {
    rpc('auth.account').then(setAccount, () => setAccount(null));
    currentEnv().then(setEnvState);
    rpc('live.list').then(setLive, () => {});
    return onPush((p) => {
      if (p.push === 'auth.changed') { setAccount(p.account); currentEnv().then(setEnvState); }
      if (p.push === 'live.status') setLive((all) => [...all.filter((s) => s.id !== p.status.id), p.status].filter((s) => s.state !== 'done' || s.id === p.status.id));
    });
  }, []);

  useEffect(() => {
    if (intent) setView(intent.view);
  }, [intent]);

  if (account === undefined) return null;
  if (!account) return <SignIn env={env} />;

  const anyLive = live.some((s) => s.state === 'live' || s.state === 'warming' || s.state === 'paused');
  return (
    <div className="shell">
      <header className="top">
        <Mark className="top__mark" />
        <span className="top__name">VocalStack</span>
        {env && env.name !== 'production' && <span className="top__env">{env.label}</span>}
        <span className="top__sp" />
        <IconBtn label="Settings" onClick={() => setView('settings')} aria-pressed={view === 'settings'}><IconSettings /></IconBtn>
      </header>
      <nav className="tabs" role="tablist" aria-label="Areas">
        {TABS.map(({ view: v, label, Icon }) => (
          <button key={v} type="button" role="tab" className="tab" aria-selected={view === v} onClick={() => setView(v)}>
            <Icon />{label}{v === 'live' && anyLive && <i className="tab__dot" aria-label="recording" />}
          </button>
        ))}
      </nav>
      <main className="body">
        {view === 'page' && <PageScreen intent={intent?.view === 'page' ? intent : null} onIntentDone={clearIntent} />}
        {view === 'live' && <LiveScreen live={live} intent={intent?.view === 'live' ? intent : null} onIntentDone={clearIntent} />}
        {view === 'broadcasts' && <BroadcastsScreen />}
        {view === 'voices' && <VoicesScreen />}
        {view === 'library' && <LibraryScreen intent={intent?.view === 'library' ? intent : null} onIntentDone={clearIntent} />}
        {view === 'settings' && <Settings account={account} env={env} onBack={() => setView('page')} />}
      </main>
      <FileDrop />
    </div>
  );
}
