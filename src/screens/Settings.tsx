/** Settings (design 3): the account, Captions on videos, Offer to record
 *  meetings, Speaker labels (for Live and Upload), Sign Out. The environment is picked on the sign-in screen
 *  (EnvPicker). */

import { useEffect, useState } from 'react';
import type { Account } from '../lib/auth';
import { ENVS, type Env, type EnvName } from '../lib/env';
import { rpc } from '../lib/rpc';
import { AUTO_CAPTIONS, OFFER_KEY } from '../lib/live';
import { errorText, Field, Note, useAction } from '../ui/kit';
import { HiKey } from '../ui/icons';
import { Toggle } from '../ui/ds';
import { SpeakerLabelsCard } from '../ui/langs';
import { client } from '../lib/client';

export function EnvPicker({ env, compact }: { env: Env; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = async (name: EnvName) => {
    setBusy(true);
    setError('');
    try { await rpc('env.set', { name }); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
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

export function Settings({ account }: { account: Account; env: Env | null; onBack: () => void }) {
  const out = useAction();
  const [offerMeetings, setOfferMeetings] = useState(true);
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    // What the key may do now: it can be changed in the dashboard any time.
    void rpc('auth.refresh').catch(() => {});
    chrome.storage.local.get([OFFER_KEY, AUTO_CAPTIONS]).then((g) => {
      setOfferMeetings(g[OFFER_KEY] !== false);
      setAutoCaptions(g[AUTO_CAPTIONS] !== false);
    });
    // The plan, when this sign-in may read billing (a key may not).
    if (account.via === 'connect') client().then((vs) => vs.billing.get()).then((b) => setPlan(b.enabled && b.plan ? b.plan.name : null), () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

      <SpeakerLabelsCard />

      <button type="button" className="cta cta--signout" disabled={out.busy} onClick={() => out.run(() => rpc('auth.signOut'))}>{out.busy && <span className="spin" />}Sign Out</button>
      {out.error && <Note kind="bad">{out.error}</Note>}
      <div className="version">VOCALSTACK FOR {import.meta.env.BROWSER === 'edge' ? 'EDGE' : 'CHROME'} · {chrome.runtime.getManifest().version}</div>
    </div>
  );
}
