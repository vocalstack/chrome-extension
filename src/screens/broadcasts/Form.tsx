/** A broadcast's name, link, access and spoken language: the create form
 *  and the detail's edit form. A taken link comes back from the API as a
 *  409 and shows under the link field with its suggestions. */

import { useState } from 'react';
import type { Access, Broadcast } from '@vocalstack/contract';
import { client } from '../../lib/client';
import { Btn, Field, LanguageSelect, Note, Seg, errorText } from '../../ui/kit';
import { NAME_MAX, PASSWORD_MIN, codeProblem, linkConflict, slugify } from './shared';

export function BroadcastForm({ existing, onDone, onCancel }: {
  existing?: Broadcast;
  onDone: (b: Broadcast) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [access, setAccess] = useState<Access>(existing?.access ?? 'public');
  const [password, setPassword] = useState('');
  const [spoken, setSpoken] = useState<string | null>(existing?.settings.spokenLanguage ?? null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [taken, setTaken] = useState<string[] | null>(null);

  const keepsPassword = existing?.access === 'private';
  const auto = slugify(name);
  const codeErr = code.trim() ? codeProblem(code) : null;
  const nameErr = !name.trim() ? 'Give the broadcast a name.' : null;
  const passErr = access === 'private' && password.length < PASSWORD_MIN && !(keepsPassword && password.length === 0)
    ? `A private broadcast needs a password of at least ${PASSWORD_MIN} characters.`
    : null;
  const ready = !nameErr && !codeErr && !passErr;

  const submit = async () => {
    setTried(true);
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    setTaken(null);
    try {
      const vs = await client();
      const link = code.trim().toLowerCase();
      let b: Broadcast;
      if (existing) {
        b = await vs.broadcasts.update(existing.id, {
          name: name.trim(),
          code: link && link !== existing.code ? link : undefined,
          access,
          password: access === 'private' ? (password || undefined) : undefined,
          settings: { spokenLanguage: spoken },
        });
      } else {
        b = await vs.broadcasts.create({
          name: name.trim(),
          code: link || null,
          access,
          password: access === 'private' ? password : null,
          settings: { spokenLanguage: spoken },
        });
      }
      onDone(b);
    } catch (e) {
      const sugg = linkConflict(e);
      if (sugg) setTaken(sugg);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Field label="Name" hint={tried && nameErr ? <span className="bc-err">{nameErr}</span> : undefined}>
        <input className="input" value={name} maxLength={NAME_MAX} autoFocus={!existing} placeholder="Sunday service" onChange={(e) => setName(e.target.value)} onKeyDown={onKey} />
      </Field>

      <Field
        label="Link"
        hint={codeErr
          ? <span className="bc-err">{codeErr}</span>
          : taken
            ? <span className="bc-err">That link is taken. Pick another.</span>
            : existing ? 'Changing the link stops the old one working.' : 'Listeners open this link. Leave it blank to use the name.'}
      >
        <div className="bc-code">
          <span className="bc-code__pre">/</span>
          <input
            className="input mono"
            value={code}
            maxLength={48}
            spellCheck={false}
            placeholder={auto || 'my-broadcast'}
            onChange={(e) => { setCode(e.target.value.toLowerCase().replace(/\s+/g, '-')); setTaken(null); }}
            onKeyDown={onKey}
          />
        </div>
      </Field>
      {taken && taken.length > 0 && (
        <div className="row row--wrap">
          {taken.map((s) => <Btn key={s} size="sm" className="mono" onClick={() => { setCode(s); setTaken(null); }}>{s}</Btn>)}
        </div>
      )}

      <Field label="Access" hint={access === 'public' ? 'Anyone with the link can listen.' : 'Listeners need the password.'}>
        <Seg<Access> label="Access" value={access} onChange={setAccess} options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]} />
      </Field>
      {access === 'private' && (
        <Field label="Password" hint={tried && passErr ? <span className="bc-err">{passErr}</span> : keepsPassword ? 'Leave blank to keep the current password.' : undefined}>
          <input className="input" type="password" autoComplete="new-password" value={password} placeholder={keepsPassword ? 'New password' : 'At least 4 characters'} onChange={(e) => setPassword(e.target.value)} onKeyDown={onKey} />
        </Field>
      )}

      <Field label="Spoken language">
        <LanguageSelect label="Spoken language" list="transcription" auto value={spoken} onChange={setSpoken} />
      </Field>

      {error && <Note kind="bad">{error}</Note>}
      <div className="row">
        <Btn type="submit" kind="primary" busy={busy} disabled={tried && !ready}>{existing ? 'Save' : 'Create broadcast'}</Btn>
        <Btn kind="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </form>
  );
}
