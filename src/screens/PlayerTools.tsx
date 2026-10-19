/** The page's video: live captions over it, or a dub into another
 *  language. Sits at the top of "This page" when the tab plays a video. */

import { useEffect, useState } from 'react';
import { onPush, rpc } from '../lib/rpc';
import type { DubStatus, LiveStatus } from '../lib/live';
import { Btn, LanguageSelect, Note, openApp, useAction } from '../ui/kit';
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

export function PlayerTools({ tabId, url, title, hasVideo }: { tabId: number; url: string; title: string; hasVideo: boolean }) {
  const [captions, setCaptions] = useState<LiveStatus | null>(null);
  const [dub, setDub] = useState<DubStatus | null>(null);
  const [captionLang, setCaptionLang] = useState<string | null>(null);
  const [dubLang, setDubLang] = useState<string | null>(null);
  const [open, setOpen] = useState<'captions' | 'dub' | null>(null);
  const act = useAction();

  useEffect(() => {
    chrome.storage.local.get(['captionLang', 'dubLang']).then((g) => {
      if (g.captionLang) setCaptionLang(g.captionLang as string);
      if (g.dubLang) setDubLang(g.dubLang as string);
    });
    rpc('live.list').then((all) => setCaptions(all.find((s) => s.mode === 'captions' && s.tabId === tabId && !['done', 'failed'].includes(s.state)) ?? null), () => {});
    rpc('dub.status', { tabId }).then(setDub, () => {});
    return onPush((p) => {
      if (p.push === 'live.status' && p.status.mode === 'captions' && p.status.tabId === tabId) setCaptions(['done', 'failed'].includes(p.status.state) ? null : p.status);
      if (p.push === 'dub.status' && p.status.tabId === tabId) setDub(p.status);
    });
  }, [tabId]);

  if (!hasVideo && !captions && !dub) return null;

  const startCaptions = () => act.run(async () => {
    await chrome.storage.local.set({ captionLang });
    setCaptions(await rpc('live.start', { mode: 'captions', tabId, input: { tab: true, mic: false }, translateTo: captionLang }));
    setOpen(null);
  });
  const startDub = () => act.run(async () => {
    if (!dubLang) throw new Error('Choose a language to dub into.');
    await chrome.storage.local.set({ dubLang });
    const source = await dubSource(tabId, url);
    setDub(await rpc('dub.start', { tabId, url: source, title, lang: dubLang }));
    setOpen(null);
  });
  const dubbing = dub && dub.state !== 'failed';

  return (
    <div className="card stack">
      <div className="row">
        <span className="eyebrow grow">This video</span>
        {captions
          ? <Btn size="sm" kind="danger" icon={<IconStop />} onClick={() => rpc('live.stop', { id: captions.id })}>Captions off</Btn>
          : <Btn size="sm" icon={<IconCaptions />} aria-expanded={open === 'captions'} onClick={() => setOpen(open === 'captions' ? null : 'captions')}>Captions</Btn>}
        {dubbing
          ? <Btn size="sm" kind="danger" icon={<IconStop />} onClick={() => { void rpc('dub.stop', { tabId }); setDub(null); }}>Stop dub</Btn>
          : <Btn size="sm" icon={<IconDub />} aria-expanded={open === 'dub'} onClick={() => setOpen(open === 'dub' ? null : 'dub')}>Dub</Btn>}
      </div>

      {open === 'captions' && !captions && (
        <div className="stack">
          <LanguageSelect label="Translate captions into" list="translation" none="Captions in the spoken language" value={captionLang} onChange={setCaptionLang} />
          <Btn kind="primary" busy={act.busy} icon={<IconCaptions />} onClick={startCaptions}>Show captions</Btn>
        </div>
      )}
      {open === 'dub' && !dubbing && (
        <div className="stack">
          <LanguageSelect label="Dub into" list="voice" none="Choose a language…" value={dubLang} onChange={setDubLang} />
          <p className="hint" style={{ margin: 0 }}>VocalStack transcribes the whole video into your Transcriptions first, then speaks its translation as the video plays.</p>
          <Btn kind="primary" busy={act.busy} disabled={!dubLang} icon={<IconDub />} onClick={startDub}>Dub this video</Btn>
        </div>
      )}

      {captions && <p className="hint row" style={{ margin: 0 }}><span className="dot dot--pulse" style={{ color: 'var(--live)' }} />Captions are on{captions.translateTo ? `, in ${captions.translateTo}` : ''}.</p>}
      {dub && (
        <div className="stack">
          {dub.state === 'failed'
            ? <Note kind="bad">{dub.error ?? 'The dub stopped.'}</Note>
            : <>
                <div className="row"><span className="hint grow" style={{ margin: 0 }}>{DUB_STEP[dub.state]}{dub.state === 'transcribing' && dub.progress ? ` · ${Math.round(dub.progress * 100)}%` : ''}</span>{dub.state !== 'playing' && <span className="spin" />}</div>
                {dub.state === 'transcribing' && <div className="progress"><i style={{ width: `${Math.round((dub.progress ?? 0) * 100)}%` }} /></div>}
              </>}
          {dub.transcriptionId && <Btn size="sm" kind="ghost" icon={<IconExternal />} onClick={() => openApp(`/transcriptions/${dub.transcriptionId}`)}>Open the transcript</Btn>}
        </div>
      )}
      {act.error && <Note kind="bad">{act.error}</Note>}
    </div>
  );
}
