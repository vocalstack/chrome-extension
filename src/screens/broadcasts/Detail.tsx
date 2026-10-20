/** One broadcast: go live with the microphone, its listener link, share
 *  links, recent recordings, edit, archive / restore. */

import { useEffect, useState } from 'react';
import type { Broadcast, ShareLink } from '@vocalstack/contract';
import { client } from '../../lib/client';
import { rpc, RpcError } from '../../lib/rpc';
import type { LiveStatus } from '../../lib/live';
import type { Account } from '../../lib/auth';
import { can } from '../../lib/access';
import { AccessNote, ProblemNote } from '../../ui/access';
import { Badge, Btn, Empty, Field, IconBtn, LanguageSelect, Note, Section, ago, clock, copy, openApp, useAction, useLoad } from '../../ui/kit';
import { IconArchive, IconBack, IconCheck, IconClose, IconCopy, IconExternal, IconLink, IconMic, IconPause, IconPlay, IconPlus, IconRestore, IconStop, IconTrash, IconUser } from '../../ui/icons';
import { BroadcastForm } from './Form';
import { isActive, sessionOf } from './shared';

export function BroadcastDetail({ initial, account, onSettings, live, onLive, onBack, onChanged }: {
  initial: Broadcast;
  account: Account;
  onSettings: () => void;
  live: LiveStatus[];
  onLive: (s: LiveStatus) => void;
  onBack: () => void;
  /** The broadcast changed (edited, archived, restored): the list re-reads. */
  onChanged: () => void;
}) {
  const id = initial.id;
  const bc = useLoad(async () => (await client()).broadcasts.get(id), [id]);
  const b = bc.data ?? initial;
  const archived = b.lifecycle !== 'active';
  const [editing, setEditing] = useState(false);
  const life = useAction();

  const session = sessionOf(live, id);
  const here = isActive(session) ? session : undefined;
  // A take ending here adds a recording: re-read the broadcast and its recordings.
  const takeKey = `${session?.id ?? ''}:${here ? 'on' : 'off'}`;
  useEffect(() => { if (session && !here) void bc.reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [takeKey]);

  const setLifecycle = (archive: boolean) => life.run(async () => {
    const vs = await client();
    const nb = archive ? await vs.broadcasts.archive(id) : await vs.broadcasts.restore(id);
    bc.setData(nb);
    onChanged();
  });

  return (
    <div className="stack">
      <div className="row">
        <IconBtn label="Back" onClick={onBack}><IconBack /></IconBtn>
        <div className="grow">
          <div className="item__title">{b.name}</div>
          <div className="item__sub"><span className="mono">/{b.code}</span> · {b.access === 'private' ? 'Private' : 'Public'}</div>
        </div>
        {archived && <Badge>Archived</Badge>}
        {!archived && !editing && can(account, 'change') && <Btn size="sm" onClick={() => setEditing(true)}>Edit</Btn>}
      </div>
      {bc.error && <Note kind="bad">{bc.error}</Note>}

      {editing ? (
        <Section title="Edit">
          <BroadcastForm existing={b} onCancel={() => setEditing(false)} onDone={(nb) => { bc.setData(nb); setEditing(false); onChanged(); }} />
        </Section>
      ) : (
        <>
          {archived
            ? <Note kind="warn">This broadcast is archived. Its link does not open. Restore it to record or edit.</Note>
            : <GoLive b={b} account={account} onSettings={onSettings} here={here} last={session} onLive={onLive} />}
          {!archived && <ListenerLink b={b} />}
          {!archived && <ShareLinks id={id} />}
          <Recordings b={b} refreshKey={takeKey} />
        </>
      )}

      <Section title="Manage">
        <div className="row row--wrap">
          <Btn size="sm" icon={<IconExternal />} onClick={() => openApp(`/s/${id}`)}>Open in dashboard</Btn>
          {archived
            ? <Btn size="sm" icon={<IconRestore />} busy={life.busy} onClick={() => setLifecycle(false)}>Restore</Btn>
            : <Btn size="sm" kind="danger" icon={<IconArchive />} busy={life.busy} disabled={!!here} title={here ? 'Stop recording first' : undefined} onClick={() => setLifecycle(true)}>Archive</Btn>}
        </div>
        {!archived && <p className="hint">Archiving hides the broadcast and stops its link. You can restore it later.</p>}
        {life.error && <Note kind="bad">{life.error}</Note>}
      </Section>
    </div>
  );
}

/** Record this device's microphone into the broadcast. */
function GoLive({ b, account, onSettings, here, last, onLive }: { b: Broadcast; account: Account; onSettings: () => void; here: LiveStatus | undefined; last: LiveStatus | undefined; onLive: (s: LiveStatus) => void }) {
  const [lang, setLang] = useState<string | null>(b.settings.spokenLanguage ?? null);
  const [conflict, setConflict] = useState(false);
  const act = useAction();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!here) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [here]);

  const start = (takeover: boolean) => {
    setConflict(false);
    return act.run(async () => {
      try {
        const s = await rpc('live.start', {
          mode: 'broadcast',
          broadcastId: b.id,
          input: { tab: false, mic: true },
          spokenLanguage: lang,
          name: b.name,
          ...(takeover ? { takeover: true } : {}),
        });
        onLive(s);
      } catch (e) {
        if (!takeover && (e as RpcError).code === 'conflict') { setConflict(true); return; }
        throw e;
      }
    });
  };

  if (here) {
    const paused = here.state === 'paused';
    const elapsed = here.sentS ?? (Date.now() - here.startedAt) / 1000;
    const badge = here.state === 'live' ? <Badge kind="live" dot="pulse">Live</Badge>
      : paused ? <Badge kind="warn" dot>Paused</Badge>
      : <Badge><span className="spin" style={{ width: 9, height: 9, borderWidth: 1.5 }} />{here.state === 'stopping' ? 'Stopping' : 'Starting'}</Badge>;
    return (
      <div className={`card stack ${paused ? '' : 'card--live'}`}>
        <div className="row">
          {badge}
          <span className="tabular">{clock(elapsed)}</span>
          <span className="grow" />
          {(b.listenersNow ?? 0) > 0 && <span className="bc-count" title="Listening now"><IconUser />{b.listenersNow}</span>}
        </div>
        <p className="hint" style={{ margin: 0 }}>{here.state === 'live' || paused ? <>Your microphone is live on <span className="mono">/{b.code}</span>.</> : here.state === 'stopping' ? 'Ending the recording…' : 'Getting ready. Listeners see the transcript once it is live.'}</p>
        <div className="row">
          <Btn icon={paused ? <IconPlay /> : <IconPause />} busy={act.busy} disabled={here.state !== 'live' && !paused} onClick={() => act.run(() => rpc('live.pause', { id: here.id, paused: !paused }))}>{paused ? 'Resume' : 'Pause'}</Btn>
          <Btn kind="danger" icon={<IconStop />} busy={here.state === 'stopping'} onClick={() => act.run(() => rpc('live.stop', { id: here.id }))}>Stop</Btn>
        </div>
        {act.error && <ProblemNote error={act.error} onSettings={onSettings} />}
      </div>
    );
  }

  const elsewhere = b.currentRecording && (b.currentRecording.state === 'live' || b.currentRecording.state === 'paused');
  return (
    <Section title="Go live">
      {elsewhere && <Note kind="warn">Recording on another device{b.currentRecording?.state === 'paused' ? ' (paused)' : ''}.</Note>}
      <Field label="Spoken language">
        <LanguageSelect label="Spoken language" list="transcription" auto value={lang} onChange={setLang} />
      </Field>
      <AccessNote account={account} need="record" onSettings={onSettings} />
      <Btn kind="live" size="lg" block icon={<IconMic />} busy={act.busy} disabled={!can(account, 'record')} onClick={() => start(false)}>Go live</Btn>
      <p className="hint" style={{ margin: 0 }}>Records your microphone. Listeners follow the transcript on the broadcast link.</p>
      {conflict && (
        <Note kind="warn">
          Another device is recording this broadcast.
          <div className="row" style={{ marginTop: 8 }}>
            <Btn size="sm" kind="live" busy={act.busy} onClick={() => start(true)}>Record here instead</Btn>
            <Btn size="sm" kind="ghost" onClick={() => setConflict(false)}>Cancel</Btn>
          </div>
        </Note>
      )}
      {act.error && <ProblemNote error={act.error} onSettings={onSettings} />}
      {!act.error && last?.state === 'failed' && last.error && <ProblemNote error={last.error} code={last.errorCode} onSettings={onSettings} />}
    </Section>
  );
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return <Btn size="sm" icon={done ? <IconCheck /> : <IconCopy />} onClick={() => copy(text).then(() => setDone(true), () => {})}>{done ? 'Copied' : label}</Btn>;
}

function ListenerLink({ b }: { b: Broadcast }) {
  return (
    <Section title="Listener link">
      <div className="bc-url mono" title={b.shareUrl}>{b.shareUrl.replace(/^https?:\/\//, '')}</div>
      <div className="row">
        <CopyBtn text={b.shareUrl} />
        <Btn size="sm" icon={<IconExternal />} onClick={() => chrome.tabs.create({ url: b.shareUrl })}>Open</Btn>
      </div>
      {b.access === 'private' && <p className="hint" style={{ margin: 0 }}>Listeners are asked for the password.</p>}
    </Section>
  );
}

/** Named links for particular people; each can be revoked on its own. */
function ShareLinks({ id }: { id: string }) {
  const links = useLoad(async () => (await client()).broadcasts.listShareLinks(id), [id]);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const add = useAction();
  const rm = useAction();
  const active = (links.data ?? []).filter((l) => !l.revokedAt);

  const create = () => {
    if (!label.trim()) return;
    void add.run(async () => {
      const l = await (await client()).broadcasts.createShareLink(id, { label: label.trim() });
      links.setData([l, ...(links.data ?? [])]);
      setLabel('');
      setAdding(false);
    });
  };
  const revoke = (l: ShareLink) => rm.run(async () => {
    const r = await (await client()).shareLinks.revoke(l.id);
    links.setData((links.data ?? []).map((x) => (x.id === l.id ? r : x)));
  });

  return (
    <Section title="Share links" side={!adding && <Btn size="sm" kind="ghost" icon={<IconPlus />} onClick={() => setAdding(true)}>Add</Btn>}>
      {adding && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <input className="input grow" autoFocus value={label} maxLength={80} placeholder="Who it is for" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
          <Btn type="submit" size="sm" kind="primary" busy={add.busy} disabled={!label.trim()}>Create</Btn>
          <IconBtn label="Cancel" onClick={() => { setAdding(false); setLabel(''); }}><IconClose /></IconBtn>
        </form>
      )}
      {links.error && <Note kind="bad">{links.error}</Note>}
      {add.error && <Note kind="bad">{add.error}</Note>}
      {rm.error && <Note kind="bad">{rm.error}</Note>}
      {links.data && active.length === 0 && !adding && <p className="hint" style={{ margin: 0 }}>Give someone their own link, and revoke it later without changing the main one.</p>}
      {active.length > 0 && (
        <div className="list">
          {active.map((l) => (
            <div key={l.id} className="item">
              <span className="item__icon"><IconLink /></span>
              <div className="item__main">
                <div className="item__title">{l.label}</div>
                <div className="item__sub">{l.views} {l.views === 1 ? 'view' : 'views'}{l.lastViewedAt ? ` · last ${ago(l.lastViewedAt)}` : ''}</div>
              </div>
              <div className="item__side">
                <CopyBtn text={l.url} />
                <IconBtn label="Revoke" disabled={rm.busy} onClick={() => void revoke(l)}><IconTrash /></IconBtn>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Recordings({ b, refreshKey }: { b: Broadcast; refreshKey: string }) {
  const page = useLoad(async () => (await client()).broadcasts.listRecordingsPage(b.id, { limit: 5 }), [b.id, refreshKey]);
  const recs = page.data?.recordings ?? [];
  return (
    <Section title="Recent recordings" side={b.recordingCount > recs.length && <Btn size="sm" kind="ghost" onClick={() => openApp(`/s/${b.id}`)}>All {b.recordingCount}</Btn>}>
      {page.error && <Note kind="bad">{page.error}</Note>}
      {page.data && recs.length === 0 && <Empty>No recordings yet.</Empty>}
      {recs.length > 0 && (
        <div className="list">
          {recs.map((r) => {
            const dur = r.mediaDurationS ?? r.wallDurationS;
            const when = r.startedAt ?? r.createdAt;
            const onAir = r.state === 'live' || r.state === 'paused';
            return (
              <div key={r.id} className="item item--click" role="button" tabIndex={0} title="Open in dashboard" onClick={() => void openApp(`/s/${b.id}/r/${r.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') void openApp(`/s/${b.id}/r/${r.id}`); }}>
                <div className="item__main">
                  <div className="item__title">{r.title || new Date(when).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  <div className="item__sub">{ago(when)}{dur ? ` · ${clock(dur)}` : ''}{r.peakListeners ? ` · ${r.peakListeners} listening at peak` : ''}</div>
                </div>
                <div className="item__side">
                  {onAir && <Badge kind={r.state === 'live' ? 'live' : 'warn'} dot={r.state === 'live' ? 'pulse' : true}>{r.state === 'live' ? 'Live' : 'Paused'}</Badge>}
                  {r.state === 'processing' && <Badge>Processing</Badge>}
                  <IconExternal className="bc-chev" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
