/** Settings (design 3): the account, Captions on videos, Offer to record
 *  meetings; then access, microphone, captions, shortcuts, environment. */

import { useEffect, useState } from 'react';
import type { Account } from '../lib/auth';
import { ENVS, type Env, type EnvName } from '../lib/env';
import { rpc } from '../lib/rpc';
import { accessLabel, can, whyNot } from '../lib/access';
import { AUTO_CAPTIONS, DEFAULT_CAPTION_STYLE, OFFER_KEY, type CaptionStyle } from '../lib/live';
import { Field, Note, openApp, useAction } from '../ui/kit';
import { HiExternal, HiKey } from '../ui/icons';
import { Eyebrow, Switch, Toggle } from '../ui/ds';
import { client } from '../lib/client';

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

export function Settings({ account, env }: { account: Account; env: Env | null; onBack: () => void }) {
  const out = useAction();
  const mic = useAction();
  const [micState, setMicState] = useState<PermissionState | 'unknown'>('unknown');
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  const [offerMeetings, setOfferMeetings] = useState(true);
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [plan, setPlan] = useState<string | null>(null);
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
    chrome.storage.local.get(['captionStyle', OFFER_KEY, AUTO_CAPTIONS]).then((g) => {
      if (g.captionStyle) setStyle(g.captionStyle as CaptionStyle);
      setOfferMeetings(g[OFFER_KEY] !== false);
      setAutoCaptions(g[AUTO_CAPTIONS] !== false);
    });
    // The plan, when this sign-in may read billing (a key may not).
    if (account.via === 'connect') client().then((vs) => vs.billing.get()).then((b) => setPlan(b.enabled && b.plan ? b.plan.name : null), () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveStyle = (s: CaptionStyle) => { setStyle(s); void rpc('captions.style', s); };
  const initials = account.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'VS';
  const isKey = account.via === 'key';
  const prefs: { label: string; sub: string; on: boolean; set: (v: boolean) => void }[] = [
    { label: 'Captions on videos', sub: 'Turn captions on by themselves on every video you play. Each one is transcribed and uses credit.', on: autoCaptions, set: (v) => { setAutoCaptions(v); void chrome.storage.local.set({ [AUTO_CAPTIONS]: v }); } },
    { label: 'Offer to record meetings', sub: 'Offer to record when you join a call in a supported meeting app. Click the notification to open this panel.', on: offerMeetings, set: (v) => { setOfferMeetings(v); void chrome.storage.local.set({ [OFFER_KEY]: v }); } },
  ];

  return (
    <div className="screen" data-screen-label="Settings">
      <div className="card2 acct">
        <span className="acct__av">{isKey ? <HiKey width={18} height={18} /> : initials}</span>
        <div className="lrow__main">
          <div className="lrow__title" style={{ fontWeight: 600 }}>{account.name}</div>
          <div className="rec-head__src" style={{ marginTop: 3 }}>{isKey ? (account.keyTail ? `vs_••••${account.keyTail}` : 'API key') : 'Signed in with VocalStack'}</div>
        </div>
        {check.busy && <span className="spin" title="Checking what this sign-in may do" />}
        {!isKey && plan && <span className="chip">{plan}</span>}
        {isKey && <span className="chip chip--mute">API KEY</span>}
      </div>

      <div className="card2 card2--list">
        {prefs.map((p) => (
          <div key={p.label} className="pref">
            <div className="lrow__main"><div className="pref__label">{p.label}</div><div className="pref__sub">{p.sub}</div></div>
            <Toggle label={p.label} checked={p.on} onChange={p.set} />
          </div>
        ))}
      </div>

      <div className="card2 stack" style={{ gap: 8 }}>
        <Eyebrow>ACCESS</Eyebrow>
        <p className="pref__sub" style={{ margin: 0 }}>{accessLabel(account)}{account.reach === 'own' ? ' · only what it creates' : account.reach === 'account' ? ' · the whole account' : ''}</p>
        <ul className="pref__sub" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{can(account, 'record') ? 'May record, transcribe pages and files, dub and go live.' : whyNot(account, 'record', true)}</li>
          {!can(account, 'change') && <li>{whyNot(account, 'change', true)}</li>}
          {account.reach === 'own' && <li>Sees only what the extension made: the Library and Broadcasts leave out everything made in the dashboard or by other apps. To see everything, sign in again and choose “Everything on this account”.</li>}
        </ul>
        {check.error && <Note kind="bad">{check.error}</Note>}
        <div className="row row--wrap" style={{ gap: 4 }}>
          <button type="button" className="hd__link" style={{ paddingLeft: 0 }} onClick={() => void openApp('/billing')}>Billing<HiExternal /></button>
          <button type="button" className="hd__link" onClick={() => void openApp('/developers')}>API keys<HiExternal /></button>
        </div>
      </div>

      <div className="card2 stack" style={{ gap: 10 }}>
        <Eyebrow>MICROPHONE</Eyebrow>
        {micState === 'granted'
          ? <p className="pref__sub" style={{ margin: 0 }}>The extension may use your microphone.</p>
          : <>
              <p className="pref__sub" style={{ margin: 0 }}>Recording with your microphone needs your permission once. Chrome asks in a small tab.</p>
              <button type="button" className="cta cta--soft" style={{ height: 38, fontSize: 13 }} disabled={mic.busy} onClick={() => mic.run(() => rpc('mic.ask'))}>{mic.busy && <span className="spin" />}Allow the Microphone</button>
              {micState === 'denied' && <Note kind="warn">The microphone is blocked for VocalStack. Allow it in the site settings of the tab that opens.</Note>}
            </>}
      </div>

      <div className="card2 stack" style={{ gap: 12 }}>
        <Eyebrow>CAPTIONS</Eyebrow>
        <div className="row"><span className="pref__label grow">Size</span><Switch size="sm" label="Caption size" value={style.size} onChange={(size) => saveStyle({ ...style, size })} options={[{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }]} /></div>
        <div className="row"><span className="pref__label grow">Position</span><Switch size="sm" label="Caption position" value={style.position} onChange={(position) => saveStyle({ ...style, position })} options={[{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }]} /></div>
        <div className="row"><span className="pref__label grow" style={{ fontWeight: 400 }}>Show the original line above its translation</span><Toggle label="Show the original line above its translation" checked={style.showOriginal} onChange={(v) => saveStyle({ ...style, showOriginal: v })} /></div>
      </div>

      <div className="card2 stack" style={{ gap: 8 }}>
        <Eyebrow>SHORTCUTS</Eyebrow>
        <p className="pref__sub" style={{ margin: 0 }}>
          {shortcuts['record-tab'] ? <><span className="mono">{shortcuts['record-tab']}</span> records the tab. </> : 'Recording the tab has no shortcut. '}
          {shortcuts['captions'] ? <><span className="mono">{shortcuts['captions']}</span> shows the tab’s recording on the page. </> : 'Captions have no shortcut. '}
          Type <span className="mono">vs</span> and a space in the address bar to search your transcripts.
        </p>
        <button type="button" className="hd__link" style={{ paddingLeft: 0, alignSelf: 'flex-start' }} onClick={() => chrome.tabs.create({ url: import.meta.env.BROWSER === 'edge' ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' })}>Change shortcuts<HiExternal /></button>
      </div>

      {env && <div className="card2"><EnvPicker env={env} /></div>}

      <button type="button" className="cta cta--signout" disabled={out.busy} onClick={() => out.run(() => rpc('auth.signOut'))}>{out.busy && <span className="spin" />}Sign Out</button>
      <p className="pref__sub" style={{ margin: 0, textAlign: 'center' }}>Signing out forgets the key in this browser.{account.via === 'connect' && ' The key itself stays in the dashboard under Developers → API keys as “VocalStack extension”; delete it there to revoke it.'}</p>
      <div className="version">VOCALSTACK FOR {import.meta.env.BROWSER === 'edge' ? 'EDGE' : 'CHROME'} · {chrome.runtime.getManifest().version}</div>
    </div>
  );
}
