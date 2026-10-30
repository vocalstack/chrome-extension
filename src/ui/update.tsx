/** Updates in the panel (design 3, Version): a banner over the header
 *  when a newer patch is out (dismissable) or this minor is deprecated,
 *  the whole panel blocked when this major is unsupported, and the
 *  Updates card in Settings. What decides which: lib/version.ts. */

import { useEffect, useState } from 'react';
import { onPush, rpc } from '../lib/rpc';
import type { UpdateState } from '../lib/version';
import { Toggle } from './ds';
import { errorText } from './kit';
import { HiWarn, HiClose, HiDownload } from './icons';

export function useUpdate(): UpdateState | null {
  const [s, setS] = useState<UpdateState | null>(null);
  useEffect(() => {
    void rpc('update.state').then(setS, () => {});
    return onPush((p) => { if (p.push === 'update.state') setS(p.state); });
  }, []);
  return s;
}

const busy = (s: UpdateState) => s.step === 'checking' || s.step === 'downloading';

/** The update's one action: fetch it, then reload to install it. */
function useGo(s: UpdateState) {
  const [error, setError] = useState('');
  const go = () => {
    if (busy(s)) return;
    setError('');
    void rpc(s.step === 'ready' ? 'update.reload' : 'update.get').catch((e) => setError(errorText(e)));
  };
  return { go, error };
}

/** The button's words, short (banners) or long (the blocked panel). */
function label(s: UpdateState, long = false): string {
  if (s.step === 'checking') return 'Checking…';
  if (s.step === 'downloading') return 'Downloading…';
  if (s.step === 'ready') return 'Reload to Update';
  if (!s.store) return long ? `Download ${s.latest}` : 'Download';
  return long ? 'Update VocalStack' : s.state === 'deprecated' ? 'Update Now' : 'Update';
}

/** What happens after a click that the button can't say. */
function after(s: UpdateState): string | null {
  if (s.step === 'waiting') return `Version ${s.latest} is still in review at the ${import.meta.env.BROWSER === 'edge' ? 'Edge Add-ons store' : 'Chrome Web Store'}. It installs as soon as it’s out.`;
  if (s.step === 'downloaded') return `Unzip it in place of this version’s folder, then reload VocalStack in ${import.meta.env.BROWSER === 'edge' ? 'edge' : 'chrome'}://extensions.`;
  return null;
}

/** Over the header, signed in: an update out, or this version deprecated. */
export function UpdateBanner({ s }: { s: UpdateState }) {
  const [hidden, setHidden] = useState(false);
  const { go, error } = useGo(s);
  const note = error || after(s);
  if (s.state === 'available' && !hidden) {
    return (
      <div className="upd upd--avail" data-screen-label="Update available">
        <div className="upd__row">
          <HiDownload width={18} height={18} className="upd__icon" />
          <div className="upd__title">Version {s.latest} is available</div>
          <button type="button" className="upd__btn" aria-busy={busy(s) || undefined} onClick={go}>{label(s)}</button>
          <button type="button" className="upd__x" aria-label="Dismiss" title="Later" onClick={() => setHidden(true)}><HiClose width={14} height={14} /></button>
        </div>
        {note && <div className="upd__note">{note}</div>}
      </div>
    );
  }
  if (s.state === 'deprecated') {
    return (
      <div className="upd upd--dep" data-screen-label="Version deprecated">
        <div className="upd__row upd__row--top">
          <HiWarn width={18} height={18} className="upd__icon" />
          <div className="upd__main">
            <div className="upd__title upd__title--strong">Limited functionality</div>
            <div className="upd__text">You can still transcribe, but this version is missing newer features. Update to version {s.latest} to get them.</div>
          </div>
          <button type="button" className="upd__btn" aria-busy={busy(s) || undefined} onClick={go}>{label(s)}</button>
        </div>
        {note && <div className="upd__note">{note}</div>}
      </div>
    );
  }
  return null;
}

/** The whole panel, signed in or out, while this major is unsupported. */
export function UpdateBlock({ s, app }: { s: UpdateState; app: string }) {
  const { go, error } = useGo(s);
  if (s.state !== 'unsupported') return null;
  const note = error || after(s);
  return (
    <div className="upd-block" data-screen-label="Version unsupported">
      <div className="upd-block__main">
        <span className="upd-block__icon"><HiWarn width={26} height={26} /></span>
        <div className="upd-block__title">Update required</div>
        <div className="upd-block__text">Version {s.current} is no longer supported. Update to version {s.latest} to keep using VocalStack. Your transcripts stay safe in your Library.</div>
      </div>
      <div className="upd-block__actions">
        <button type="button" className="cta" aria-busy={busy(s) || undefined} onClick={go}>{label(s, true)}</button>
        <a className="cta cta--soft" href={app} target="_blank" rel="noopener">Open Dashboard</a>
        {note && <div className="upd__note upd__note--center">{note}</div>}
      </div>
      <div className="version">VERSION {s.current} · UNSUPPORTED</div>
    </div>
  );
}

/** Settings: this version, the update, and automatic updates. */
export function UpdatesCard({ s }: { s: UpdateState }) {
  const [checked, setChecked] = useState(false);
  const [ask, setAsk] = useState(false);
  const { go, error } = useGo(s);
  const cur = s.state === 'current' && s.step !== 'ready';
  const check = () => {
    if (busy(s)) return;
    void rpc('update.state', { force: true }).then(() => setChecked(true), () => {});
  };
  const sub = s.step === 'downloading' ? `Downloading version ${s.latest}…`
    : s.step === 'ready' ? `Version ${s.ready} is ready. Reload the extension to install it.`
    : s.step === 'checking' ? 'Checking for updates…'
    : after(s) ?? (cur ? (checked ? 'Up to date · checked just now' : 'Up to date')
    : s.state === 'deprecated' ? 'Limited functionality on this version'
    : s.state === 'unsupported' ? 'No longer supported'
    : `Version ${s.latest} is available`);
  const tone = s.step === 'ready' || (s.state === 'available' && !busy(s)) ? 'brand' : s.state !== 'current' && !busy(s) ? 'live' : '';
  const main = s.step === 'ready' || (!busy(s) && !cur);
  const setAuto = (on: boolean) => {
    if (on) return setAsk(true);
    setAsk(false);
    void rpc('update.auto', { on: false }).catch(() => {});
  };
  return (
    <div className="card2 card2--list" data-screen-label="Updates">
      <div className="ey" style={{ padding: '10px 0 2px' }}>Updates</div>
      <div className="pref">
        <div className="lrow__main">
          <div className="pref__label">Version {s.current}</div>
          <div className={`pref__sub${tone ? ` pref__sub--${tone}` : ''}`}>{error || sub}</div>
        </div>
        <button type="button" className={`upd__btn${main ? '' : ' upd__btn--plain'}`} disabled={busy(s)} onClick={cur ? check : go}>
          {s.step === 'checking' ? 'Checking…' : cur ? 'Check for Updates' : s.state === 'deprecated' && s.step === 'idle' && s.store ? 'Update' : label(s)}
        </button>
      </div>
      {s.store && (
        <div className="pref">
          <div className="lrow__main">
            <div className="pref__label">Install updates automatically</div>
            <div className="pref__sub">{s.auto ? 'New versions download in the background and install the next time the extension reloads.' : 'You’ll be told when a new version is available, and choose when to install it.'}</div>
          </div>
          <Toggle label="Install updates automatically" checked={s.auto || ask} onChange={setAuto} />
        </div>
      )}
      {ask && (
        <div className="upd-ask" data-screen-label="Auto update consent">
          <div className="upd__title upd__title--strong">Allow automatic updates?</div>
          <div className="upd__text">VocalStack will download new versions in the background and install them the next time the extension reloads. It never reloads on its own, and never while you’re recording.</div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="upd-ask__btn" onClick={() => { setAsk(false); void rpc('update.auto', { on: true }).catch(() => {}); }}>Allow</button>
            <button type="button" className="upd-ask__btn upd-ask__btn--plain" onClick={() => setAsk(false)}>Not Now</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The footer under Settings: the version and where it stands. */
export function versionFoot(s: UpdateState | null): { text: string; tone: string } {
  const v = s?.current ?? chrome.runtime.getManifest().version;
  if (!s) return { text: `VERSION ${v}`, tone: '' };
  if (s.step === 'downloading') return { text: `VERSION ${v} · DOWNLOADING`, tone: '' };
  if (s.step === 'ready') return { text: `VERSION ${v} · READY TO INSTALL`, tone: 'brand' };
  if (s.state === 'available') return { text: `VERSION ${v} · UPDATE AVAILABLE`, tone: 'brand' };
  if (s.state === 'deprecated') return { text: `VERSION ${v} · LIMITED FUNCTIONALITY`, tone: 'live' };
  if (s.state === 'unsupported') return { text: `VERSION ${v} · UNSUPPORTED`, tone: 'live' };
  return { text: `VERSION ${v} · UP TO DATE`, tone: '' };
}
