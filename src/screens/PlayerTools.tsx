/** This tab: live captions and translation over what it plays, or a dub
 *  of its video into another language. Sits at the top of Page, always
 *  (captions work on any tab with sound; the dub needs a video). */

import { useEffect, useState } from 'react';
import type { Account } from '../lib/auth';
import { can } from '../lib/access';
import { onPush, rpc } from '../lib/rpc';
import { capturable, tabHolder, type DubStatus, type LiveStatus } from '../lib/live';
import { Btn, LanguageSelect, Note, openApp, useAction, useLangName } from '../ui/kit';
import { AccessNote, ProblemNote } from '../ui/access';
import { IconCaptions, IconDub, IconExternal, IconStop } from '../ui/icons';

/** What VocalStack transcribes to dub: the main video's own file when it
 *  has one, an embedded player's page, else the page itself. */
async function dubSource(tabId: number, pageUrl: string): Promise<string> {
  const scan = await rpc('page.scan', { tabId }).catch(() => null);
  const media = scan?.media ?? [];
  const playing = (k: string) => media.filter((m) => m.kind === k && !m.streamOnly).sort((a, b) => Number(!!b.playing) - Number(!!a.playing) || (b.durationS ?? 0) - (a.durationS ?? 0));
  return playing('video')[0]?.url ?? playing('embed')[0]?.url ?? pageUrl;
}

const DUB_STEP: Record<DubStatus['state'], string> = {
  transcribing: 'Transcribing the video',
  translating: 'Translating',
  voicing: 'Preparing the voice',
  ready: 'Ready',
  playing: 'Dubbing — play the video',
  failed: 'Stopped',
};

export function PlayerTools({ account, live, tabId, url, title, hasVideo, onSettings }: {
  account: Account;
  live: LiveStatus[];
  tabId: number;
  url: string;
  title: string;
  hasVideo: boolean;
  onSettings: () => void;
}) {
  const [dub, setDub] = useState<DubStatus | null>(null);
  const [captionLang, setCaptionLang] = useState<string | null>(null);
  const [dubLang, setDubLang] = useState<string | null>(null);
  const [open, setOpen] = useState<'captions' | 'dub' | null>(null);
  const capAct = useAction();
  const dubAct = useAction();
  const off = useAction();
  const langName = useLangName();

  useEffect(() => {
    chrome.storage.local.get(['captionLang', 'dubLang']).then((g) => {
      if (g.captionLang) setCaptionLang(g.captionLang as string);
      if (g.dubLang) setDubLang(g.dubLang as string);
    });
    rpc('dub.status', { tabId }).then(setDub, () => {});
    return onPush((p) => {
      if (p.push === 'dub.status' && p.status.tabId === tabId) setDub(p.status);
    });
  }, [tabId]);

  // The tab's captions: a captions session, or a recording of the tab
  // shown as captions on it.
  const holder = tabHolder(live, tabId);
  const captions = holder && (holder.mode === 'captions' || holder.overlay) ? holder : undefined;
  const recorded = holder && holder.mode !== 'captions' ? holder : undefined;
  // How the latest captions here ended, when they failed.
  const failed = !captions ? [...live].filter((s) => s.mode === 'captions' && s.tabId === tabId).sort((a, b) => b.startedAt - a.startedAt)[0] : undefined;
  const failure = failed?.state === 'failed' ? failed : undefined;
  const ok = capturable(url);

  const startCaptions = () => capAct.run(async () => {
    await chrome.storage.local.set({ captionLang });
    if (failure) await rpc('live.forget', { id: failure.id }).catch(() => {});
    await rpc('live.start', { mode: 'captions', tabId, input: { tab: true, mic: false }, translateTo: captionLang });
    setOpen(null);
  });
  const stopCaptions = () => off.run(() => (captions!.mode === 'captions' ? rpc('live.stop', { id: captions!.id }) : rpc('live.overlay', { id: captions!.id, on: false })));
  const startDub = () => dubAct.run(async () => {
    if (!dubLang) throw new Error('Choose a language to dub into.');
    await chrome.storage.local.set({ dubLang });
    const source = await dubSource(tabId, url);
    setDub(await rpc('dub.start', { tabId, url: source, title, lang: dubLang }));
    setOpen(null);
  });
  const dubbing = dub && dub.state !== 'failed';
  const showDub = hasVideo || !!dub;

  return (
    <div className="card stack">
      <div className="row row--wrap">
        <span className="eyebrow grow">This tab</span>
        {captions
          ? <Btn size="sm" kind="danger" busy={off.busy} icon={<IconStop />} onClick={() => void stopCaptions()}>Captions off</Btn>
          : <Btn size="sm" icon={<IconCaptions />} disabled={!ok} title={ok ? undefined : 'This page can’t be captioned'} aria-expanded={open === 'captions'} onClick={() => setOpen(open === 'captions' ? null : 'captions')}>Captions & translation</Btn>}
        {showDub && (dubbing
          ? <Btn size="sm" kind="danger" icon={<IconStop />} onClick={() => { void rpc('dub.stop', { tabId }); setDub(null); }}>Stop dub</Btn>
          : <Btn size="sm" icon={<IconDub />} aria-expanded={open === 'dub'} onClick={() => setOpen(open === 'dub' ? null : 'dub')}>Dub</Btn>)}
      </div>

      {open === 'captions' && !captions && (
        <div className="stack">
          <p className="hint" style={{ margin: 0 }}>
            {recorded ? 'This tab is being recorded: the captions come from that recording.' : 'What this tab plays, as it is said, over its video (or at the foot of the page). Nothing is saved.'}
          </p>
          <LanguageSelect label="Translate captions into" list="translation" none="Don't translate" value={captionLang} onChange={setCaptionLang} />
          <AccessNote account={account} need="change" onSettings={onSettings} />
          <Btn kind="primary" busy={capAct.busy} disabled={!can(account, 'change')} icon={<IconCaptions />} onClick={startCaptions}>
            {captionLang ? `Show captions in ${langName(captionLang)}` : 'Show captions'}
          </Btn>
        </div>
      )}
      {open === 'dub' && !dubbing && (
        <div className="stack">
          <LanguageSelect label="Dub into" list="voice" none="Choose a language…" value={dubLang} onChange={setDubLang} />
          <p className="hint" style={{ margin: 0 }}>VocalStack transcribes the whole video into your Transcriptions first, then speaks its translation as the video plays.</p>
          <AccessNote account={account} need="record" onSettings={onSettings} />
          <Btn kind="primary" busy={dubAct.busy} disabled={!dubLang || !can(account, 'record')} icon={<IconDub />} onClick={startDub}>Dub this video</Btn>
        </div>
      )}

      {captions && (
        <p className="hint row" style={{ margin: 0 }}>
          <span className="dot dot--pulse" style={{ color: 'var(--brand)' }} />
          {captions.state === 'live' || captions.state === 'paused'
            ? `Captions are on${captions.translateTo ? `, translated into ${langName(captions.translateTo)}` : ''}${captions.mode !== 'captions' ? ', from the recording' : ''}.`
            : 'Captions are starting…'}
        </p>
      )}
      {failure?.error && (
        <ProblemNote error={failure.error} code={failure.errorCode} onSettings={onSettings}>
          <div style={{ marginTop: 8 }}><Btn size="sm" kind="ghost" onClick={() => void rpc('live.forget', { id: failure.id })}>Dismiss</Btn></div>
        </ProblemNote>
      )}
      {dub && (
        <div className="stack">
          {dub.state === 'failed'
            ? <ProblemNote error={dub.error ?? 'The dub stopped.'} onSettings={onSettings} />
            : <>
                <div className="row"><span className="hint grow" style={{ margin: 0 }}>{DUB_STEP[dub.state]}{dub.state === 'transcribing' && dub.progress ? ` · ${Math.round(dub.progress * 100)}%` : ''}</span>{dub.state !== 'playing' && <span className="spin" />}</div>
                {dub.state === 'transcribing' && <div className="progress"><i style={{ width: `${Math.round((dub.progress ?? 0) * 100)}%` }} /></div>}
              </>}
          {dub.transcriptionId && <Btn size="sm" kind="ghost" icon={<IconExternal />} onClick={() => openApp(`/transcriptions/${dub.transcriptionId}`)}>Open the transcript</Btn>}
        </div>
      )}
      {/* A start that got as far as a session says why on its own (above). */}
      {capAct.error && !failure && <ProblemNote error={capAct.error} onSettings={onSettings} />}
      {dubAct.error && <ProblemNote error={dubAct.error} onSettings={onSettings} />}
      {off.error && <Note kind="bad">{off.error}</Note>}
    </div>
  );
}
