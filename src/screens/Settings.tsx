/** Account, environment, captions, permissions. */

import { useEffect, useState } from 'react';
import type { Account } from '../lib/auth';
import { ENVS, type Env, type EnvName } from '../lib/env';
import { rpc } from '../lib/rpc';
import { accessLabel, can, whyNot } from '../lib/access';
import { DEFAULT_CAPTION_STYLE, OFFER_KEY, type CaptionStyle } from '../lib/live';
import { Btn, Field, IconBtn, Note, Section, Seg, openApp, useAction } from '../ui/kit';
import { IconBack, IconExternal, IconMic, IconSignOut, IconUser } from '../ui/icons';

export function EnvPicker({ env, compact }: { env: Env; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = async (name: EnvName) => {
    setBusy(true);
    setError('');
    try { await rpc('env.set', { name }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const select = (
    <select className="select" aria-label="Environment" value={env.name} disabled={busy} onChange={(e) => void pick(e.target.value as EnvName)}>
      {Object.values(ENVS).map((e) => <option key={e.name} value={e.name}>{e.label} · {new URL(e.api).host}</option>)}
    </select>
  );
  const note = error && <Note kind="bad">{error}</Note>;
  if (compact) return <details><summary className="hint" style={{ cursor: 'pointer' }}>Environment: {env.label}</summary><div className="stack" style={{ marginTop: 8 }}>{select}{note}</div></details>;
  return <div className="stack"><Field label="Environment" hint="Each environment has its own sign-in.">{select}</Field>{note}</div>;
}

export function Settings({ account, env, onBack }: { account: Account; env: Env | null; onBack: () => void }) {
  const out = useAction();
  const mic = useAction();
  const [micState, setMicState] = useState<PermissionState | 'unknown'>('unknown');
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  const [offerMeetings, setOfferMeetings] = useState(true);
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const check = useAction();

  useEffect(() => {
    navigator.permissions.query({ name: 'microphone' as PermissionName }).then((p) => {
      setMicState(p.state);
      p.onchange = () => setMicState(p.state);
    }, () => {});
    // What the key may do now: it can be changed in the dashboard any time.
    void check.run(() => rpc('auth.refresh'));
    chrome.commands.getAll().then((cs) => setShortcuts(Object.fromEntries(cs.map((c) => [c.name ?? '', c.shortcut ?? ''])))).catch(() => {});
    chrome.storage.local.get(['captionStyle', OFFER_KEY]).then((g) => {
      if (g.captionStyle) setStyle(g.captionStyle as CaptionStyle);
      setOfferMeetings(g[OFFER_KEY] !== false);
    });
  }, []);

  const saveStyle = (s: CaptionStyle) => { setStyle(s); void rpc('captions.style', s); };

  return (
    <div className="stack">
      <div className="row"><IconBtn label="Back" onClick={onBack}><IconBack /></IconBtn><strong>Settings</strong></div>

      <Section title="Account">
        <div className="list">
          <div className="item">
            <span className="item__icon"><IconUser /></span>
            <div className="item__main">
              <div className="item__title">{account.name}</div>
              <div className="item__sub item__sub--wrap">{account.via === 'connect' ? 'Signed in with VocalStack' : 'API key'} · {accessLabel(account)}{account.reach === 'own' ? ' · only what it creates' : account.reach === 'account' ? ' · the whole account' : ''}</div>
            </div>
            {check.busy && <span className="spin" title="Checking what this sign-in may do" />}
          </div>
        </div>
        <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{can(account, 'record') ? 'May record, transcribe pages and files, dub and go live.' : whyNot(account, 'record', true)}</li>
          {!can(account, 'change') && <li>{whyNot(account, 'change', true)}</li>}
          {account.reach === 'own' && <li>Sees only what the extension made: the Library and Broadcasts leave out everything made in the dashboard or by other apps. To see everything, sign in again and choose “Everything on this account”.</li>}
        </ul>
        {check.error && <Note kind="bad">{check.error}</Note>}
        <div className="row row--wrap">
          <Btn size="sm" icon={<IconExternal />} onClick={() => openApp('/')}>Open the dashboard</Btn>
          <Btn size="sm" icon={<IconExternal />} onClick={() => openApp('/billing')}>Billing</Btn>
          <Btn size="sm" kind="danger" icon={<IconSignOut />} busy={out.busy} onClick={() => out.run(() => rpc('auth.signOut'))}>Sign out</Btn>
        </div>
        <p className="hint">Signing out forgets the key in this browser. {account.via === 'connect' && 'The key itself stays in the dashboard under Developers → API keys as “VocalStack extension”; delete it there to revoke it.'}</p>
      </Section>

      <Section title="Microphone">
        {micState === 'granted'
          ? <Note kind="ok">The extension may use your microphone.</Note>
          : <>
              <p className="hint">Recording with your microphone needs your permission once. Chrome asks in a small tab.</p>
              <Btn icon={<IconMic />} busy={mic.busy} onClick={() => mic.run(() => rpc('mic.ask'))}>Allow the microphone</Btn>
              {micState === 'denied' && <Note kind="warn">The microphone is blocked for VocalStack. Allow it in the site settings of the tab that opens.</Note>}
            </>}
      </Section>

      <Section title="Captions">
        <Field label="Size"><Seg label="Caption size" value={style.size} onChange={(size) => saveStyle({ ...style, size })} options={[{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }]} /></Field>
        <Field label="Position"><Seg label="Caption position" value={style.position} onChange={(position) => saveStyle({ ...style, position })} options={[{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }]} /></Field>
        <label className="check"><input type="checkbox" checked={style.showOriginal} onChange={(e) => saveStyle({ ...style, showOriginal: e.target.checked })} />Show the original line above its translation</label>
      </Section>

      <Section title="Meetings">
        <label className="check"><input type="checkbox" checked={offerMeetings} onChange={(e) => { setOfferMeetings(e.target.checked); void chrome.storage.local.set({ [OFFER_KEY]: e.target.checked }); }} />Offer to record when a tab joins a meeting (Google Meet, Microsoft Teams, Zoom and others on the web)</label>
      </Section>

      <Section title="Shortcuts">
        <p className="hint">
          {shortcuts['record-tab'] ? <><span className="mono">{shortcuts['record-tab']}</span> records the tab. </> : 'Recording the tab has no shortcut. '}
          {shortcuts['captions'] ? <><span className="mono">{shortcuts['captions']}</span> turns captions on and off. </> : 'Captions have no shortcut. '}
          Type <span className="mono">vs</span> and a space in the address bar to search your transcripts.
        </p>
        <Btn size="sm" onClick={() => chrome.tabs.create({ url: import.meta.env.BROWSER === 'edge' ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' })}>Change shortcuts</Btn>
      </Section>

      {env && <Section title="Environment"><EnvPicker env={env} /></Section>}
      <p className="hint">VocalStack {chrome.runtime.getManifest().version}</p>
    </div>
  );
}
