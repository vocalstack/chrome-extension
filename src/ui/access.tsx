/** What a limited sign-in cannot do, said before anything is clicked, and
 *  the API's refusals worded for a person (screens/page/errors.ts). */

import type { Account } from '../lib/auth';
import { can, whyNot, type Need } from '../lib/access';
import { rpc } from '../lib/rpc';
import { problemOf } from '../screens/page/errors';
import { Btn, Note, openApp, useAction } from './kit';

/** Nothing when the sign-in may do `need`; else why not, and the way out. */
export function AccessNote({ account, need, onSettings }: { account: Account; need: Need; onSettings?: () => void }) {
  if (can(account, need)) return null;
  return <AccessWarning text={whyNot(account, need)} onSettings={onSettings} />;
}

function AccessWarning({ text, onSettings }: { text: string; onSettings?: () => void }) {
  const check = useAction();
  return (
    <Note kind="warn">
      {text}
      <div className="row row--wrap" style={{ marginTop: 8 }}>
        {onSettings && <Btn size="sm" onClick={onSettings}>Settings</Btn>}
        <Btn size="sm" kind="ghost" busy={check.busy} onClick={() => check.run(() => rpc('auth.refresh'))}>Check again</Btn>
      </div>
      {check.error && <div style={{ marginTop: 6 }}>{check.error}</div>}
    </Note>
  );
}

/** An error from the API or the background, in plain words, with the
 *  button that fixes it (Settings for permissions, Billing for credit). */
export function ProblemNote({ error, code, onSettings, children }: { error: string; code?: string; onSettings?: () => void; children?: React.ReactNode }) {
  const p = problemOf({ message: error, code });
  if (p.access) return <AccessWarning text={p.text} onSettings={onSettings} />;
  return (
    <Note kind="bad">
      {p.text}
      {p.billing && <div style={{ marginTop: 8 }}><Btn size="sm" onClick={() => openApp('/billing')}>Billing</Btn></div>}
      {children}
    </Note>
  );
}
