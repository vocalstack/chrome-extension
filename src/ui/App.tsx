/** The side panel (design 3): sign-in, then a header (the spoken and
 *  reading languages, Dashboard, Settings) over six areas in an icon tab
 *  strip, whose Live tab turns red while a session runs. Header controls
 *  and tabs explain themselves in tooltips. */

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Account } from '../lib/auth';
import { movedWorkspace, settingsMark } from '../lib/workspace';
import type { PlayTarget } from '../lib/play';
import { WorkspaceMark } from './workspace';
import type { UpdateState } from '../lib/version';
import { onPush, rpc } from '../lib/rpc';
import { currentEnv, type Env } from '../lib/env';
import { capturable, isRunning, type LiveStatus } from '../lib/live';
import { useActiveTab } from './useTab';
import { useInvoked } from '../screens/Live';
import type { View } from '../background/panel';
import { usePanelIntent } from './intent';
import { HiBack, HiBroadcast, HiCursor, HiDoc, HiExternal, HiGear, HiMic, HiUpload, HiSpeakers } from './icons';
import { LangBar } from './langs';
import { TipRow, useTip } from './tip';
import { SignIn } from '../screens/SignIn';
import { Settings } from '../screens/Settings';
import { PageScreen } from '../screens/Page';
import { LiveScreen } from '../screens/Live';
import { UploadScreen } from '../screens/Upload';
import { BroadcastsScreen } from '../screens/Broadcasts';
import { SpeakersScreen } from '../screens/Speakers';
import { LibraryScreen } from '../screens/Library';
import { FileDrop } from '../screens/FileDrop';
import { UpdateBanner, UpdateBlock, useUpdate } from './update';
import { ENVS } from '../lib/env';

/** The player and its styles come only when something is played. */
const PlayerView = lazy(() => import('../screens/Player'));

type Area = Exclude<View, 'settings'>;
const TABS: { view: Area; label: string; tip: string; Icon: typeof HiCursor }[] = [
  { view: 'page', label: 'Now', tip: 'What’s playing on this tab, ready to transcribe.', Icon: HiCursor },
  { view: 'live', label: 'Live', tip: 'Record or caption this tab as it plays.', Icon: HiMic },
  { view: 'upload', label: 'Upload', tip: 'Transcribe audio and video files.', Icon: HiUpload },
  { view: 'broadcasts', label: 'Broadcasts', tip: 'Live sessions read on each listener’s device.', Icon: HiBroadcast },
  { view: 'speakers', label: 'Speakers', tip: 'People VocalStack recognises by their voice.', Icon: HiSpeakers },
  { view: 'library', label: 'Library', tip: 'Every transcript, synced to your account.', Icon: HiDoc },
];

const on = (s: LiveStatus) => s.state === 'live' || s.state === 'warming' || s.state === 'paused';

export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  /** Counts workspace changes: each one loads every screen again. */
  const [epoch, setEpoch] = useState(0);
  const shown = useRef<Account | null>(null);
  const [env, setEnvState] = useState<Env | null>(null);
  const [view, setViewState] = useState<View>('page');
  /** Where Settings goes back to. */
  const [lastArea, setLastArea] = useState<Area>('page');
  const setView = (v: View) => { if (v !== 'settings') setLastArea(v); setViewState(v); };
  const [live, setLive] = useState<LiveStatus[]>([]);
  const [intent, clearIntent] = usePanelIntent();
  const update = useUpdate();

  useEffect(() => {
    rpc('auth.account').then((a) => {
      shown.current = a;
      setAccount(a);
      // A sign-in from before workspaces were named: ask now, so the corner
      // shows the workspace without Settings being opened first (the answer
      // comes as `auth.changed`). Later renames and icons come with each
      // new token, as they do for Settings.
      if (a && !a.workspace) void rpc('auth.refresh').catch(() => {});
    }, () => setAccount(null));
    currentEnv().then(setEnvState);
    rpc('live.list').then(setLive, () => {});
    return onPush((p) => {
      if (p.push === 'auth.changed') {
        // Another workspace: nothing loaded for the old one stays on screen.
        if (movedWorkspace(shown.current, p.account)) setEpoch((n) => n + 1);
        shown.current = p.account;
        setAccount(p.account);
        currentEnv().then(setEnvState);
      }
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
  // An unsupported version: nothing works until it's updated (lib/version.ts).
  const block = update && <UpdateBlock s={update} app={(env ?? ENVS.production).app} />;
  if (!account) return <div className="shell"><SignIn env={env} />{block}</div>;

  /** A session running: the Live tab shows it. */
  const rec = live.some((s) => on(s) && isRunning(s));
  return <Panel key={epoch} account={account} env={env} view={view} setView={setView} lastArea={lastArea} live={live} rec={rec} intent={intent} clearIntent={clearIntent} update={update} block={block} />;
}

/** The toolbar icon's "!" on the active tab while the extension still
 *  needs a click there before it may record it. */
function useInvokeBadge(live: LiveStatus[]) {
  const tab = useActiveTab();
  const invoked = useInvoked(tab?.id, live);
  const need = !!tab?.id && capturable(tab.url) && invoked === false;
  useEffect(() => {
    if (!tab?.id) return;
    void rpc('tab.badge', { tabId: tab.id, on: need }).catch(() => {});
  }, [tab?.id, need]);
}

function Panel({ account, env, view, setView, lastArea, live, rec, intent, clearIntent, update, block }: {
  account: Account; env: Env | null; view: View; setView: (v: View) => void; lastArea: Area; live: LiveStatus[]; rec: boolean;
  intent: ReturnType<typeof usePanelIntent>[0]; clearIntent: () => void; update: UpdateState | null; block: React.ReactNode;
}) {
  useInvokeBadge(live);
  /** The Library item being played, over the Library it came from. */
  const [playing, setPlaying] = useState<PlayTarget | null>(null);
  // A menu, the omnibox or a notification asked for a screen: show it.
  useEffect(() => { if (intent) setPlaying(null); }, [intent]);
  const play = view === 'library' ? playing : null;
  return (
    <div className="shell">
      {update && <UpdateBanner s={update} />}
      {play && (
        <Suspense fallback={<div className="empty"><span className="spin" style={{ margin: '0 auto' }} /></div>}>
          <PlayerView target={play} env={env ?? ENVS.production} onBack={() => setPlaying(null)} />
        </Suspense>
      )}
      {/* The Library stays as it was (its search, its list) under the player. */}
      <div style={{ display: play ? 'none' : 'contents' }}>
        <TipRow>
          <Header view={view} env={env} rec={rec} account={account} onView={(v) => { setPlaying(null); setView(v); }} onBack={() => setView(lastArea)} />
        </TipRow>
        <main className="body2">
          {view === 'page' && <PageScreen account={account} live={live} intent={intent?.view === 'page' ? intent : null} onIntentDone={clearIntent} onSettings={() => setView('settings')} onLive={() => setView('live')} onLibrary={() => setView('library')} onUpload={() => setView('upload')} />}
          {view === 'live' && <LiveScreen account={account} live={live} intent={intent?.view === 'live' ? intent : null} onIntentDone={clearIntent} onSettings={() => setView('settings')} />}
          {view === 'upload' && <UploadScreen account={account} onSettings={() => setView('settings')} onLibrary={() => setView('library')} />}
          {view === 'broadcasts' && <BroadcastsScreen account={account} onSettings={() => setView('settings')} />}
          {view === 'speakers' && <SpeakersScreen />}
          {view === 'library' && <LibraryScreen account={account} intent={intent?.view === 'library' ? intent : null} onIntentDone={clearIntent} onPlay={setPlaying} />}
          {view === 'settings' && <Settings account={account} env={env} update={update} onBack={() => setView(lastArea)} />}
        </main>
        <FileDrop account={account} onSettings={() => setView('settings')} onDropped={() => setView('upload')} quiet={view === 'upload'} />
      </div>
      {block}
    </div>
  );
}

function Header({ view, env, rec, account, onView, onBack }: { view: View; env: Env | null; rec: boolean; account: Account; onView: (v: View) => void; onBack: () => void }) {
  const tip = useTip();
  // The workspace the extension works in, once known; else the gear.
  const mark = settingsMark(account);
  return (
    <>
      <div className="hd">
        {view === 'settings' ? (
          <>
            <button type="button" className="hd__back" aria-label="Back" onClick={onBack}><HiBack /></button>
            <div className="hd__title">Settings</div>
          </>
        ) : (
          <>
            <LangBar />
            {env && env.name !== 'production' && <span className="env-pill" title={`Environment: ${env.label}`}>{env.name === 'local' ? 'Local' : env.label}</span>}
            <div className="hd__end">
              {env && <a className="hd__icon hd__icon--sm" href={env.app} target="_blank" rel="noopener" aria-label="Open Dashboard in a new tab" {...tip('Open Dashboard', `Opens ${new URL(env.app).host} in a new tab.`, { right: true })}><HiExternal /></a>}
              <button type="button" className={`hd__icon${mark.workspace ? ' hd__icon--ws' : ''}`} aria-label={mark.label} onClick={() => onView('settings')} {...tip('Settings', mark.workspace ? `Workspace: ${mark.workspace.name}` : undefined, { right: true })}>
                {mark.workspace ? <WorkspaceMark w={mark.workspace} env={env?.name} size={24} /> : <HiGear />}
              </button>
            </div>
          </>
        )}
      </div>
      {view !== 'settings' && (
        <div className="tabs2-wrap">
          <nav className="tabs2" role="tablist" aria-label="Areas">
            {TABS.map(({ view: v, label, tip: about, Icon }, i) => (
              <button key={v} type="button" role="tab" className={`tab2${v === 'live' && rec ? ' tab2--rec' : ''}`} aria-selected={view === v} aria-label={v === 'live' && rec ? `${label} (recording)` : label}
                {...(view === v ? {} : tip(label, about, { up: true, right: i >= 3 }))} onClick={() => onView(v)}>
                <span className="tab2__icon"><Icon />{v === 'live' && rec && view !== v && <i className="tab2__dot tab2__dot--corner" />}</span>
                {view === v && <span className="tab2__label">{label}</span>}
              </button>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
