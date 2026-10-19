/** Signed out: Sign in with VocalStack (One-click Connect), or a key. */

import { useState } from 'react';
import { rpc } from '../lib/rpc';
import type { Env } from '../lib/env';
import { Btn, Note, useAction } from '../ui/kit';
import { IconBroadcast, IconCaptions, IconDub, IconKey, IconLive, IconPage, IconVoice, Mark } from '../ui/icons';
import { EnvPicker } from './Settings';

export function SignIn({ env }: { env: Env | null }) {
  const connect = useAction();
  const key = useAction();
  const [showKey, setShowKey] = useState(false);
  const [value, setValue] = useState('');

  return (
    <div className="welcome">
      <Mark className="welcome__mark" />
      <div>
        <h1>VocalStack in your browser</h1>
        <p className="hint" style={{ marginTop: 6 }}>Sign in once, then use it on any page.</p>
      </div>
      <ul>
        <li><IconPage />Transcribe the audio and video a page plays</li>
        <li><IconCaptions />Live captions and translation over any video</li>
        <li><IconDub />Dub a video into another language</li>
        <li><IconLive />Record a tab, your microphone or a meeting</li>
        <li><IconBroadcast />Run your broadcasts</li>
        <li><IconVoice />Train a voice</li>
      </ul>
      <Btn kind="primary" size="lg" block busy={connect.busy} onClick={() => connect.run(() => rpc('auth.connect'))}>Sign in with VocalStack</Btn>
      {connect.error && <Note kind={/cancel/i.test(connect.error) ? undefined : 'bad'}>{connect.error}</Note>}
      <div className="or">or</div>
      {!showKey ? (
        <Btn kind="ghost" icon={<IconKey />} onClick={() => setShowKey(true)}>Use an API key</Btn>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void key.run(() => rpc('auth.key', { key: value })); }}>
          <input className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder="vs_key_…" value={value} onChange={(e) => setValue(e.target.value)} aria-label="API key" autoFocus />
          <span className="hint">Make one in the dashboard under Developers → API keys. It stays in this browser profile and is never shown to the pages you visit.</span>
          <Btn kind="primary" busy={key.busy} disabled={!value.trim()} onClick={() => key.run(() => rpc('auth.key', { key: value }))}>Use this key</Btn>
          {key.error && <Note kind="bad">{key.error}</Note>}
        </form>
      )}
      {env && <EnvPicker env={env} compact />}
    </div>
  );
}
