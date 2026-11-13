/** A Library item, played in the panel: VocalStack's own player
 *  (@vocalstack/player) in its reading view, which has the transcript,
 *  the audio, subtitles, translations, the summary and exports. It is
 *  signed in as the panel is: each call asks the background for the
 *  15-minute key token (`auth.token`), exchanged there when it is about to
 *  run out; the API key never leaves the background.
 *
 *  Loaded only when something is played (ui/App.tsx), so the panel opens
 *  as fast as before.
 *
 *  In an extension page the sound, the transcript and the subtitles always
 *  play; a link's picture is its site's embed, and two kinds cannot show
 *  here: YouTube refuses a page that sends no http Referer (an extension
 *  page sends none: its "Error 153"), and the sites whose embed needs
 *  their own script (Facebook, Dailymotion, Wistia, Vidyard), which an
 *  extension may not load (wxt.config.ts, noRemoteScripts). Those show the
 *  video's still picture; "Open in Dashboard" has the moving one. */

import { useEffect, useState } from 'react';
import { VocalStackPlayer, setErrorReporter } from '@vocalstack/player';
import '@vocalstack/player/style.css';
import type { Env } from '../lib/env';
import type { PlayTarget } from '../lib/play';
import { rpc } from '../lib/rpc';
import { report } from '../lib/sentry';
import { HiBack, HiExternal } from '../ui/icons';

setErrorReporter((e) => report(e, 'player'));

const token = () => rpc('auth.token');
const NO_SHARE = { share: false };

function useDark(): boolean {
  const [dark, setDark] = useState(() => !matchMedia('(prefers-color-scheme: light)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: light)');
    const l = () => setDark(!m.matches);
    m.addEventListener('change', l);
    return () => m.removeEventListener('change', l);
  }, []);
  return dark;
}

export default function PlayerView({ target, env, onBack }: { target: PlayTarget; env: Env; onBack: () => void }) {
  const dark = useDark();
  return (
    <>
      <div className="hd">
        <button type="button" className="hd__back" aria-label="Back to Library" onClick={onBack}><HiBack /></button>
        <div className="hd__title">Library</div>
        <div className="hd__end">
          <a className="hd__link" href={new URL(target.path, env.app).toString()} target="_blank" rel="noopener" aria-label={`Open ${target.name} in Dashboard, in a new tab`}>Open in Dashboard<HiExternal /></a>
        </div>
      </div>
      <div className="pv" data-screen-label="Player">
        <VocalStackPlayer
          key={target.transcriptionId}
          id={target.transcriptionId}
          token={token}
          baseUrl={env.api}
          appUrl={env.app}
          mode="transcript"
          layout="page"
          compact
          dark={dark}
          autoplay={false}
          startAt={target.startAt}
          find={target.find}
          endCard={false}
          controls={NO_SHARE}
        />
      </div>
    </>
  );
}
