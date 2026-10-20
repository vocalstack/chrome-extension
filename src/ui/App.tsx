/** The side panel: sign-in, then five areas in a tab strip. */

import { useEffect, useState } from 'react';
import type { Account } from '../lib/auth';
import { onPush, rpc } from '../lib/rpc';
import { currentEnv, type Env } from '../lib/env';
import { RECORDING_MODES, type LiveStatus } from '../lib/live';
import type { View } from '../background/panel';
import { usePanelIntent } from './intent';
import { IconBroadcast, IconLibrary, IconLive, IconPage, IconSettings, IconVoice } from './icons';
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
  { view: 'page', label: 'Page', Icon: IconPage },
  { view: 'live', label: 'Live', Icon: IconLive },
  { view: 'broadcasts', label: 'Broadcasts', Icon: IconBroadcast },
  { view: 'voices', label: 'Voices', Icon: IconVoice },
  { view: 'library', label: 'Library', Icon: IconLibrary },
];

export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [env, setEnvState] = useState<Env | null>(null);
  const [view, setViewState] = useState<View>('page');
  /** Where Settings goes back to. */
  const [lastArea, setLastArea] = useState<Exclude<View, 'settings'>>('page');
  const setView = (v: View) => { if (v !== 'settings') setLastArea(v); setViewState(v); };
  const [live, setLive] = useState<LiveStatus[]>([]);
  const [intent, clearIntent] = usePanelIntent();

  useEffect(() => {
    rpc('auth.account').then(setAccount, () => setAccount(null));
    currentEnv().then(setEnvState);
    rpc('live.list').then(setLive, () => {});
    return onPush((p) => {
      if (p.push === 'auth.changed') { setAccount(p.account); currentEnv().then(setEnvState); }
      // Finished sessions stay until dismissed (live.gone), so how each ended,
      // and a meeting's summary, stay readable while others run.
      if (p.push === 'live.status') setLive((all) => [...all.filter((s) => s.id !== p.status.id), p.status]);
      if (p.push === 'live.gone') setLive((all) => all.filter((s) => s.id !== p.id));
    });
  }, []);

  useEffect(() => {
    if (intent) setView(intent.view);
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (account === undefined) return null;
  if (!account) return <SignIn env={env} />;

  const on = (s: LiveStatus) => s.state === 'live' || s.state === 'warming' || s.state === 'paused';
  const recording = live.some((s) => on(s) && RECORDING_MODES.includes(s.mode));
  const captioning = !recording && live.some((s) => on(s) && s.mode === 'captions');
  return (
    <div className="shell">
      {/* The browser's side panel header already shows the logo and name:
          the areas start at the top, settings at their right. */}
      <div className="bar">
        <nav className="tabs" role="tablist" aria-label="Areas">
          {TABS.map(({ view: v, label, Icon }) => (
            <button key={v} type="button" role="tab" className="tab" aria-selected={view === v} onClick={() => setView(v)}>
              <Icon />{label}
              {v === 'live' && recording && <i className="tab__dot" role="img" aria-label="recording" title="Recording" />}
              {v === 'live' && captioning && <i className="tab__dot tab__dot--cc" role="img" aria-label="captions on" title="Captions on" />}
            </button>
          ))}
        </nav>
        {env && env.name !== 'production' && <span className="top__env" title={`Environment: ${env.label}`}>{env.name === 'local' ? 'Local' : env.label}</span>}
        <IconBtn label="Settings" onClick={() => setView('settings')} aria-pressed={view === 'settings'}><IconSettings /></IconBtn>
      </div>
      <main className="body">
        {view === 'page' && <PageScreen account={account} live={live} intent={intent?.view === 'page' ? intent : null} onIntentDone={clearIntent} onSettings={() => setView('settings')} />}
        {view === 'live' && <LiveScreen account={account} live={live} intent={intent?.view === 'live' ? intent : null} onIntentDone={clearIntent} onSettings={() => setView('settings')} />}
        {view === 'broadcasts' && <BroadcastsScreen account={account} onSettings={() => setView('settings')} />}
        {view === 'voices' && <VoicesScreen />}
        {view === 'library' && <LibraryScreen account={account} intent={intent?.view === 'library' ? intent : null} onIntentDone={clearIntent} />}
        {view === 'settings' && <Settings account={account} env={env} onBack={() => setView(lastArea)} />}
      </main>
      <FileDrop account={account} onSettings={() => setView('settings')} />
    </div>
  );
}
