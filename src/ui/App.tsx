/** The side panel (design 3): sign-in, then a header (the reading
 *  language, Dashboard, Settings) over six areas in an icon tab strip,
 *  whose Live tab turns red while a session runs. */

import { useEffect, useState } from 'react';
import type { Account } from '../lib/auth';
import { onPush, rpc } from '../lib/rpc';
import { currentEnv, type Env } from '../lib/env';
import { isRunning, type LiveStatus } from '../lib/live';
import type { View } from '../background/panel';
import { usePanelIntent } from './intent';
import { HiBack, HiBroadcast, HiDoc, HiExternal, HiGear, HiGlobe, HiMic, HiUpload, HiVoices } from './icons';
import { ReadInChip } from './langs';
import { SignIn } from '../screens/SignIn';
import { Settings } from '../screens/Settings';
import { PageScreen } from '../screens/Page';
import { LiveScreen } from '../screens/Live';
import { UploadScreen } from '../screens/Upload';
import { BroadcastsScreen } from '../screens/Broadcasts';
import { VoicesScreen } from '../screens/Voices';
import { LibraryScreen } from '../screens/Library';
import { FileDrop } from '../screens/FileDrop';

type Area = Exclude<View, 'settings'>;
const TABS: { view: Area; label: string; Icon: typeof HiGlobe }[] = [
  { view: 'page', label: 'Page', Icon: HiGlobe },
  { view: 'live', label: 'Live', Icon: HiMic },
  { view: 'upload', label: 'Upload', Icon: HiUpload },
  { view: 'broadcasts', label: 'Broadcasts', Icon: HiBroadcast },
  { view: 'voices', label: 'Voices', Icon: HiVoices },
  { view: 'library', label: 'Library', Icon: HiDoc },
];

const on = (s: LiveStatus) => s.state === 'live' || s.state === 'warming' || s.state === 'paused';

export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [env, setEnvState] = useState<Env | null>(null);
  const [view, setViewState] = useState<View>('page');
  /** Where Settings goes back to. */
  const [lastArea, setLastArea] = useState<Area>('page');
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
  if (!account) return <div className="shell"><SignIn env={env} /></div>;

  /** A session running: the Live tab shows it. */
  const rec = live.some((s) => on(s) && isRunning(s));
  return (
    <div className="shell">
      <div className="hd">
        {view === 'settings' ? (
          <>
            <button type="button" className="hd__back" aria-label="Back" onClick={() => setView(lastArea)}><HiBack /></button>
            <div className="hd__title">Settings</div>
          </>
        ) : (
          <>
            <ReadInChip />
            {env && env.name !== 'production' && <span className="env-pill" title={`Environment: ${env.label}`}>{env.name === 'local' ? 'Local' : env.label}</span>}
            <div className="hd__end">
              {env && <a className="hd__link" href={env.app} target="_blank" rel="noopener" title="Open Dashboard in a new tab">Dashboard<HiExternal /></a>}
              <button type="button" className="hd__icon" aria-label="Settings" title="Settings" onClick={() => setView('settings')}><HiGear /></button>
            </div>
          </>
        )}
      </div>
      {view !== 'settings' && (
        <div className="tabs2-wrap">
          <nav className="tabs2" role="tablist" aria-label="Areas">
            {TABS.map(({ view: v, label, Icon }) => (
              <button key={v} type="button" role="tab" className={`tab2${v === 'live' && rec ? ' tab2--rec' : ''}`} aria-selected={view === v} title={label} aria-label={v === 'live' && rec ? `${label} (recording)` : label} onClick={() => setView(v)}>
                {v === 'live' && rec && view === v && <i className="tab2__dot" />}
                <span className="tab2__icon"><Icon />{v === 'live' && rec && view !== v && <i className="tab2__dot tab2__dot--corner" />}</span>
                {view === v && <span className="tab2__label">{label}</span>}
              </button>
            ))}
          </nav>
        </div>
      )}
      <main className="body2">
        {view === 'page' && <PageScreen account={account} live={live} intent={intent?.view === 'page' ? intent : null} onIntentDone={clearIntent} onSettings={() => setView('settings')} onLive={() => setView('live')} onLibrary={() => setView('library')} onUpload={() => setView('upload')} />}
        {view === 'live' && <LiveScreen account={account} live={live} intent={intent?.view === 'live' ? intent : null} onIntentDone={clearIntent} onSettings={() => setView('settings')} />}
        {view === 'upload' && <UploadScreen account={account} onSettings={() => setView('settings')} onLibrary={() => setView('library')} />}
        {view === 'broadcasts' && <BroadcastsScreen account={account} onSettings={() => setView('settings')} />}
        {view === 'voices' && <VoicesScreen />}
        {view === 'library' && <LibraryScreen account={account} intent={intent?.view === 'library' ? intent : null} onIntentDone={clearIntent} />}
        {view === 'settings' && <Settings account={account} env={env} onBack={() => setView(lastArea)} />}
      </main>
      <FileDrop account={account} onSettings={() => setView('settings')} onDropped={() => setView('upload')} />
    </div>
  );
}
