/** Signed out (design 3): the logo, Sign in with VocalStack (One-click
 *  Connect), or Use an API Key (a field, then Connect). */

import { useState } from 'react';
import { rpc } from '../lib/rpc';
import type { Env } from '../lib/env';
import { Note, useAction } from '../ui/kit';
import logoUrl from '../styles/vocalstack-logo.svg';
import logoDarkUrl from '../styles/vocalstack-logo-dark.svg';
import { EnvPicker } from './Settings';

export function SignIn({ env }: { env: Env | null }) {
  const connect = useAction();
  const key = useAction();
  const [showKey, setShowKey] = useState(false);
  const [value, setValue] = useState('');
  const [bad, setBad] = useState(false);
  const submit = () => {
    const k = value.trim();
    if (!k) return;
    if (!/^vs_key_/.test(k)) { setBad(true); return; }
    void key.run(() => rpc('auth.key', { key: k }));
  };

  return (
    <div className="welcome2" data-screen-label="Sign in">
      <div className="welcome2__top">
        <picture><source srcSet={logoDarkUrl} media="(prefers-color-scheme: dark)" /><img src={logoUrl} alt="VocalStack" className="welcome2__logo" /></picture>
        <div className="welcome2__head">Speech made simple</div>
        <div className="welcome2__text">Transcribe, translate and record any tab. Your transcripts sync with your VocalStack account.</div>
      </div>
      {!showKey ? (
        <div className="welcome2__acts">
          <button type="button" className="cta" aria-busy={connect.busy || undefined} disabled={connect.busy} onClick={() => connect.run(() => rpc('auth.connect'))}>{connect.busy && <span className="spin" />}Sign in with VocalStack</button>
          <button type="button" className="cta cta--soft" onClick={() => { setShowKey(true); connect.setError(''); }}>Use an API Key</button>
          {connect.error && <Note kind={/cancel/i.test(connect.error) ? undefined : 'bad'}>{connect.error}</Note>}
        </div>
      ) : (
        <form className="welcome2__acts" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="keybox">
            <div className="ey" style={{ color: 'var(--ink-30)', letterSpacing: '.14em' }}>API KEY</div>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input className={`keybox__input${bad || key.error ? ' keybox__input--bad' : ''}`} type="password" autoComplete="off" spellCheck={false} placeholder="vs_key_…" value={value} onChange={(e) => { setValue(e.target.value); setBad(false); key.setError(''); }} aria-label="API key" autoFocus />
            {bad && <div className="keybox__err">That doesn’t look like a VocalStack key. Keys start with vs_key_.</div>}
            {key.error && <div className="keybox__err">{key.error}</div>}
            <div className="keybox__note">Create a key under Developers in your {env ? <a href={new URL('/developers', env.app).toString()} target="_blank" rel="noopener">Dashboard</a> : 'Dashboard'}. It’s stored only in this browser.</div>
          </div>
          <button type="submit" className="cta" disabled={!value.trim() || key.busy} aria-busy={key.busy || undefined}>{key.busy && <span className="spin" />}Connect</button>
          <button type="button" className="cta cta--text" onClick={() => { setShowKey(false); setValue(''); setBad(false); key.setError(''); }}>Back</button>
        </form>
      )}
      {env && <div className="welcome2__env"><EnvPicker env={env} compact /></div>}
    </div>
  );
}
