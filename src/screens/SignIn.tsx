/** Signed out (design 3): the logo, what the extension does (the words
 *  of vocalstack.com/live-transcription-browser-extension, nothing it
 *  doesn't claim), Sign in with VocalStack (One-click
 *  Connect), or More ways to sign in, as the iPhone app's: with your
 *  company (the same Connect, whose sign-in page has SSO) or with an API
 *  key (a field, then Connect). The environment
 *  switch is not in the design: Shift-click the logo to show it (it shows
 *  by itself outside production, so the way back is always there). */

import { useState } from 'react';
import { rpc } from '../lib/rpc';
import { ENVS, type Env, type EnvName } from '../lib/env';
import { Note, useAction } from '../ui/kit';
import { HiBuilding, HiChevronDown, HiKey, HiLock, HiSpeaker, IconCaptions, IconCheck, IconFile, IconMeeting, IconMic, IconPause, IconPlay, IconTab, IconUpload, MeetingLogo } from '../ui/icons';
import logoUrl from '../styles/vocalstack-logo.svg';
import logoDarkUrl from '../styles/vocalstack-logo-dark.svg';

/** `update`: the same banner as signed in (a newer version out, or this
 *  one deprecated), here over the sign-in button. */
export function SignIn({ env, update }: { env: Env | null; update?: React.ReactNode }) {
  const connect = useAction();
  const key = useAction();
  const [showKey, setShowKey] = useState(false);
  const [more, setMore] = useState(false);
  const [value, setValue] = useState('');
  const [bad, setBad] = useState(false);
  const [showEnv, setShowEnv] = useState(false);
  const [scene, setScene] = useState(0);
  const [held, setHeld] = useState(false); // a feature was clicked: stay on it
  const submit = () => {
    const k = value.trim();
    if (!k) return;
    if (!/^vs_key_/.test(k)) { setBad(true); return; }
    void key.run(() => rpc('auth.key', { key: k }));
  };

  const back = () => { setShowKey(false); setValue(''); setBad(false); key.setError(''); };

  return (
    <div className={`welcome2${more ? ' welcome2--more' : ''}${showKey ? ' welcome2--key' : ''}`} data-screen-label="Sign in">
      <div className="welcome2__top">
        <div className="welcome2__brand">
          <picture onClick={(e) => { if (e.shiftKey) setShowEnv((v) => !v); }}><source srcSet={logoDarkUrl} media="(prefers-color-scheme: dark)" /><img src={logoUrl} alt="VocalStack" className="welcome2__logo" /></picture>
        </div>
        {!showKey ? (
          <>
            <Demo scene={scene} />
            <h1 className="welcome2__head">Transcribe anything you hear</h1>
            <p className="welcome2__text">Files, tabs and calls, transcribed and translated in over 100 languages, and kept in your Library.</p>
            <Features scene={scene} held={held} onNext={setScene} onPick={(i) => { setScene(i); setHeld(true); }} />
          </>
        ) : (
          <>
            <h1 className="welcome2__head">Sign in with an API key</h1>
            <p className="welcome2__text">For developers. Create a key under Developers in your {env ? <a href={new URL('/developers', env.app).toString()} target="_blank" rel="noopener">Dashboard</a> : 'Dashboard'}; it’s stored only in this browser.</p>
          </>
        )}
      </div>
      {!showKey ? (
        <div className="welcome2__acts">
          {update}
          <button type="button" className="cta" aria-busy={connect.busy || undefined} disabled={connect.busy} onClick={() => connect.run(() => rpc('auth.connect'))}>{connect.busy && <span className="spin" />}Sign in with VocalStack</button>
          <button type="button" className="cta cta--text signin-more__toggle" aria-expanded={more} aria-controls="signin-more" onClick={() => setMore((v) => !v)}>More ways to sign in<HiChevronDown /></button>
          {more && (
            <div className="signin-more" id="signin-more" role="group" aria-label="More ways to sign in">
              <button type="button" className="signin-more__row" disabled={connect.busy} onClick={() => connect.run(() => rpc('auth.connect'))}><HiBuilding /><span>With your company<small>Single sign-on (SSO)</small></span></button>
              <button type="button" className="signin-more__row" onClick={() => { setShowKey(true); connect.setError(''); }}><HiKey /><span>With an API key<small>For developers</small></span></button>
            </div>
          )}
          {connect.error && <Note kind={/cancel/i.test(connect.error) ? undefined : 'bad'}>{connect.error}</Note>}
        </div>
      ) : (
        <form className="welcome2__acts welcome2__acts--key" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="keybox">
            <label className="keybox__label" htmlFor="signin-key">API key</label>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input id="signin-key" className={`keybox__input${bad || key.error ? ' keybox__input--bad' : ''}`} type="password" autoComplete="off" spellCheck={false} placeholder="vs_key_…" value={value} onChange={(e) => { setValue(e.target.value); setBad(false); key.setError(''); }} aria-invalid={bad || !!key.error || undefined} aria-describedby={bad || key.error ? 'signin-key-err' : undefined} autoFocus />
            {(bad || key.error) && <div className="keybox__err" id="signin-key-err" role="alert">{bad ? 'That doesn’t look like a VocalStack key. Keys start with vs_key_.' : key.error}</div>}
          </div>
          <button type="submit" className="cta" disabled={!value.trim() || key.busy} aria-busy={key.busy || undefined}>{key.busy && <span className="spin" />}Sign in</button>
          <button type="button" className="cta cta--text" onClick={back}>Other ways to sign in</button>
        </form>
      )}
      {env && (showEnv || env.name !== 'production') && <EnvSwitch env={env} />}
    </div>
  );
}

/** The hero: what the extension does, shown rather than told. One card,
 *  four scenes, one per feature below it: a call, a video, an uploaded
 *  file, a recording. Every scene has the same parts (a bar, a strip, who
 *  is speaking, their words arriving word by word, then a second line),
 *  so the card never changes size and only its contents move.
 *  Decorative: the heading and the features say it in words. */
type Scene = { view?: 'video' | 'tab'; bar: React.ReactNode; status: React.ReactNode; strip: React.ReactNode; who: string; said: string; tag: string; second: string };
const SCENES: Scene[] = [
  {
    bar: <><MeetingLogo k="meet" size={14} /><span className="vcap__title">Launch sync</span></>,
    status: <span className="vcap__live"><i />Live captions</span>,
    strip: (
      <div className="vcall">
        <div className="vcall__tile vcall__tile--on"><span className="vcall__av" style={{ '--h': 205 } as React.CSSProperties}>M</span><Wave /></div>
        <div className="vcall__tile"><span className="vcall__av" style={{ '--h': 28 } as React.CSSProperties}>D</span></div>
        <div className="vcall__tile"><span className="vcall__av" style={{ '--h': 150 } as React.CSSProperties}>S</span></div>
      </div>
    ),
    who: 'Maya',
    said: 'Let’s move the launch to Thursday and share the notes after the call.',
    tag: 'Spanish',
    second: 'Pasemos el lanzamiento al jueves y compartamos las notas después de la llamada.',
  },
  {
    view: 'video',
    bar: null,
    status: null,
    strip: null,
    who: 'Field notes: the Atlantic ridge',
    said: 'A dos kilómetros de profundidad, el agua está tan caliente que hierve un huevo.',
    tag: 'Spanish',
    second: '',
  },
  {
    bar: <><span className="vcap__ico"><IconUpload /></span><span className="vcap__title">Upload</span></>,
    status: <span className="vcap__live vcap__live--calm"><IconCheck />Transcribed</span>,
    strip: (
      <div className="vfile">
        <span className="vfile__ico"><IconFile /></span>
        <span className="vfile__meta"><b>Interview.mp3</b><small>42 min · 2 speakers</small></span>
        <span className="vfile__bar"><i /></span>
      </div>
    ),
    who: 'Speaker 2 · 03:14',
    said: 'We started with two laptops and a borrowed microphone.',
    tag: 'French',
    second: 'Nous avons commencé avec deux ordinateurs portables et un micro emprunté.',
  },
  {
    view: 'tab',
    bar: null,
    status: null,
    strip: null,
    who: '',
    said: '',
    tag: '',
    second: '',
  },
];

function Demo({ scene }: { scene: number }) {
  // Every scene sits in the same grid cell, the others hidden, so the card
  // is always as tall as its tallest scene at this width and never jumps.
  // The one showing is keyed afresh, so it arrives anew and its words replay.
  return (
    <figure className="vcap" aria-hidden="true">
      {SCENES.map((c, i) => <SceneView key={i === scene ? `on${i}` : i} c={c} on={i === scene} />)}
    </figure>
  );
}

const Words = ({ text }: { text: string }) => {
  const words = text.split(' ');
  return <>{words.map((w, i) => <span key={i} style={{ '--i': i } as React.CSSProperties}>{w}{i < words.length - 1 ? ' ' : ''}</span>)}</>;
};

function SceneView({ c, on }: { c: Scene; on: boolean }) {
  const n = c.said.split(' ').length;
  const cls = `vcap__scene${on ? ' is-on' : ''}`;
  // A video playing: the picture (deep water, light from above, specks
  // drifting up), its title, the dubbed track, and the subtitle on the
  // picture where subtitles go, over the player's controls.
  if (c.view === 'video') return (
    <div className={`${cls} vcap__scene--fill`}>
      <div className="vvid">
        <div className="vvid__pic"><i className="vvid__ray" /><i className="vvid__ray vvid__ray--b" /><i className="vvid__ray vvid__ray--c" />{[0, 1, 2, 3, 4, 5].map((k) => <b key={k} className="vvid__dot" style={{ '--k': k } as React.CSSProperties} />)}<svg className="vvid__ridge" viewBox="0 0 320 60" preserveAspectRatio="none"><path d="M0 60V38l28-6 22 9 30-17 26 12 24-20 30 15 22-8 34 18 26-10 30 13 20-6 28 12V60z" /></svg></div>
        <div className="vvid__top"><span className="vvid__title">{c.who}</span><span className="vvid__dub"><HiSpeaker />Dubbed · {c.tag}</span></div>
        <p className="vvid__sub"><span><Words text={c.said} /></span></p>
        <div className="vvid__ctl"><IconPlay /><span className="vvid__track"><i /></span><span className="vvid__time">12:48</span></div>
      </div>
    </div>
  );
  // A browser window, its one tab playing audio (a podcast's player),
  // and along its foot the recorder: what it is taking (this tab and your
  // microphone) and for how long.
  if (c.view === 'tab') return (
    <div className={`${cls} vcap__scene--fill`}>
      <div className="vtab">
        <div className="vtab__strip">
          <span className="vtab__dots"><i /><i /><i /></span>
          <span className="vtab__tab"><i className="vtab__fav" /><span className="vtab__name">The Long Game</span><HiSpeaker /></span>
        </div>
        <div className="vtab__url"><HiLock /><span>thelonggame.fm/episodes/42</span></div>
        <div className="vtab__page">
          <div className="vaud">
            <span className="vaud__art" />
            <div className="vaud__body">
              <b>The Long Game · Ep. 42</b>
              <span>Building a company that lasts</span>
              <div className="vaud__ctl"><span className="vaud__btn"><IconPause /></span><span className="vaud__track"><i /></span><span className="vaud__time">18:06</span></div>
            </div>
          </div>
          <div className="vrec"><i className="vrec__dot" /><span className="vrec__what">Recording this tab and your mic</span><span className="vrec__time">00:42</span></div>
        </div>
      </div>
    </div>
  );
  return (
    <div className={cls}>
      <div className="vcap__bar">{c.bar}{c.status}</div>
      {c.strip}
      <div className="vcap__who">{c.who}</div>
      <p className="vcap__said"><Words text={c.said} /></p>
      <p className="vcap__tr" style={{ '--i': n } as React.CSSProperties}><b>{c.tag}</b>{c.second}</p>
    </div>
  );
}

/** Sound as three soft lines drifting past, in the logo's blue and red
 *  (still under reduced motion). Each path runs one period past the view
 *  and slides by that period, so the loop has no seam. Decorative. */
const WAVES = [
  { amp: 9, per: 150, cls: 'a' },
  { amp: 6, per: 110, cls: 'b' },
  { amp: 3.5, per: 80, cls: 'c' },
];
const sine = (amp: number, per: number) => {
  let d = '';
  for (let x = 0; x <= 320 + per; x += 2) d += `${x ? 'L' : 'M'}${x} ${(20 + amp * Math.sin((2 * Math.PI * x) / per)).toFixed(2)}`;
  return d;
};
function Wave() {
  return (
    <div className="vwave" aria-hidden="true"><svg viewBox="0 0 320 40" preserveAspectRatio="none">
      {WAVES.map((w) => <path key={w.cls} className={`vwave__${w.cls}`} d={sine(w.amp, w.per)} style={{ '--per': `${-w.per}px` } as React.CSSProperties} />)}
    </svg></div>
  );
}

const MEETINGS = ['meet', 'teams', 'zoom', 'webex', 'whereby', 'gather', 'discord'];

/** The features double as the card's chapters: the one showing is lit,
 *  a hairline fills under it, and when it is full the next one shows.
 *  Hovering the card or the list holds it; a click shows that one and stays
 *  there (no more turning by itself). Under
 *  reduced motion the line does not run, so nothing moves by itself. */
const FEATS = [
  { icon: <IconMeeting />, label: 'Captions on your calls', extra: <span className="feats__logos">{MEETINGS.slice(0, 4).map((k) => <MeetingLogo key={k} k={k} size={14} />)}</span> },
  { icon: <IconCaptions />, label: 'Subtitles and dubbing for any video' },
  { icon: <IconUpload />, label: 'Upload audio and video' },
  { icon: <IconMic />, label: 'Record a tab, your microphone or both' },
];

function Features({ scene, held, onNext, onPick }: { scene: number; held: boolean; onNext: (i: number) => void; onPick: (i: number) => void }) {
  return (
    <ul className="feats">
      {FEATS.map((f, i) => (
        <li key={i} className={i === scene ? 'is-on' : undefined}>
          <button type="button" aria-pressed={i === scene} onClick={() => onPick(i)}>{f.icon}<b>{f.label}</b>{f.extra}</button>
          {i === scene && !held && <i key={scene} className="feats__timer" onAnimationEnd={() => onNext((scene + 1) % FEATS.length)} />}
        </li>
      ))}
    </ul>
  );
}

function EnvSwitch({ env }: { env: Env }) {
  const pick = useAction();
  return (
    <div className="welcome2__env">
      <select className="select" aria-label="Environment" value={env.name} disabled={pick.busy} onChange={(e) => { const name = e.target.value as EnvName; void pick.run(() => rpc('env.set', { name })); }}>
        {Object.values(ENVS).map((e) => <option key={e.name} value={e.name}>{e.label} · {new URL(e.api).host}</option>)}
      </select>
      {pick.error && <Note kind="bad">{pick.error}</Note>}
    </div>
  );
}
