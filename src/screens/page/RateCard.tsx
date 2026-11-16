/** Now's rating card: a waveform that settles into a heart, the person's
 *  own numbers, and Rate beside Tell us. Who sees it and when: lib/rate.ts.
 *
 *  It waits until the panel has been still for 1.5 s, shows at most once
 *  per panel, and counts as an ask only once it has been on screen for
 *  2 s; closed sooner (Esc, or something started), it doesn't count.
 *  Rate opens the store's reviews in a tab beside this one; Tell us opens
 *  the Dashboard's support form. */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { currentEnv } from '../../lib/env';
import { MAX_ASKS, RATE_KEY, eligible, readRate, storeUrl, summaryParts, updateRate, type RateState } from '../../lib/rate';

const IDLE_MS = 1500;
const SEEN_MS = 2000;
const CLOSE_MS = 300;

/** Shown in this panel already (once per panel, whatever came of it). */
let shownHere = false;

type Phase = 'ask' | 'thanks' | 'fail' | 'sent';

const HEART = 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z';
/** The waveform's bars, drawn in the shape of a heart: x, y, height, and how each rises. */
const BARS: [number, number, number, number, number][] = [
  [3.31, 7.17, 12.98, 2, 8.34], [7.13, 4.12, 20.52, 0.6, 7.62], [10.95, 3.06, 25.02, 0.95, 6.44], [14.76, 3.29, 28.08, 0.35, 4.67],
  [18.58, 5.12, 29.94, 0.8, 1.91], [22.4, 10.51, 30.47, 0.45, -3.75], [26.22, 5.12, 29.94, 1.1, 1.91], [30.04, 3.29, 28.08, 0.5, 4.67],
  [33.85, 3.06, 25.02, 0.85, 6.44], [37.67, 4.12, 20.52, 0.4, 7.62], [41.49, 7.17, 12.98, 1.3, 8.34],
];
const SOLID = 'M24 12.1 24 11.9 24.1 11.3 24.4 10.4 24.8 9.2 25.6 7.9 26.6 6.5 28 5.3 29.6 4.2 31.4 3.4 33.4 3.1 35.5 3.1 37.6 3.6 39.6 4.5 41.4 5.8 42.9 7.4 44.1 9.2 44.8 11.3 45 13.4 44.8 15.6 44.1 17.8 42.9 19.9 41.4 22 39.6 24 37.6 25.9 35.5 27.7 33.4 29.5 31.4 31.3 29.6 33 28 34.6 26.6 36.1 25.6 37.4 24.8 38.6 24.4 39.6 24.1 40.4 24 40.8 24 41 24 40.8 23.9 40.4 23.6 39.6 23.2 38.6 22.4 37.4 21.4 36.1 20 34.6 18.4 33 16.6 31.3 14.6 29.5 12.5 27.7 10.4 25.9 8.4 24 6.6 22 5.1 19.9 3.9 17.8 3.2 15.6 3 13.4 3.2 11.3 3.9 9.2 5.1 7.4 6.6 5.8 8.4 4.5 10.4 3.6 12.5 3.1 14.6 3.1 16.6 3.4 18.4 4.2 20 5.3 21.4 6.5 22.4 7.9 23.2 9.2 23.6 10.4 23.9 11.3 24 11.9Z';

function Stops({ id }: { id: string }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="4" y1="6" x2="44" y2="34">
      <stop offset="0" style={{ stopColor: 'var(--brand)' }} />
      <stop offset=".5" style={{ stopColor: 'color-mix(in oklch,var(--brand) 45%,var(--live))' }} />
      <stop offset="1" style={{ stopColor: 'var(--live)' }} />
    </linearGradient>
  );
}

const Bars = ({ rise }: { rise: boolean }) => (
  <>{BARS.map(([x, y, h, s, dy], i) => <rect key={i} x={x} y={y} width="3.2" height={h} rx="1.6" style={{ '--i': i, ...(rise ? { '--s': s, '--dy': `${dy}px` } : {}) } as CSSProperties} />)}</>
);

const Tick = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 12.75 6 6 9-13.5" /></svg>;

/** `quiet`: something is going on in Now (recording, a job working, a
 *  problem shown): the card doesn't come, and goes if it came unseen. */
export function RateCard({ quiet }: { quiet: boolean }) {
  const [state, setState] = useState<RateState | null>(null);
  const [prod, setProd] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [final, setFinal] = useState(false);
  const counted = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const store = storeUrl(chrome.runtime.id, (chrome.runtime.getManifest() as { update_url?: string }).update_url);

  useEffect(() => {
    void currentEnv().then((e) => setProd(e.name === 'production'));
    void readRate().then(setState);
    const l = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' && RATE_KEY in c) void readRate().then(setState); };
    chrome.storage.onChanged.addListener(l);
    return () => chrome.storage.onChanged.removeListener(l);
  }, []);

  // Comes once the panel has been still for a moment.
  const ready = !!state && !!store && prod && !quiet && !shownHere && phase === null && eligible(state, Date.now()) === 'ok';
  useEffect(() => {
    if (!ready) return;
    let t: ReturnType<typeof setTimeout>;
    const show = () => {
      if (document.visibilityState !== 'visible') { t = setTimeout(show, IDLE_MS); return; }
      shownHere = true;
      setFinal(state!.asks >= MAX_ASKS - 1);
      setPhase('ask');
      requestAnimationFrame(() => setOpen(true));
    };
    const reset = () => { clearTimeout(t); t = setTimeout(show, IDLE_MS); };
    reset();
    document.addEventListener('pointerdown', reset, true);
    document.addEventListener('keydown', reset, true);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', reset, true); document.removeEventListener('keydown', reset, true); };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = () => {
    if (counted.current) return;
    counted.current = true;
    void updateRate((s) => { s.asks++; s.lastAskAt = Date.now(); s.askedAt = s.videos + s.files; });
  };

  // An ask, once it has been half on screen for 2 s.
  useEffect(() => {
    if (phase !== 'ask' || !card.current) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(t);
      if (e?.isIntersecting) t = setTimeout(count, SEEN_MS);
    }, { threshold: 0.5 });
    io.observe(card.current);
    return () => { clearTimeout(t); io.disconnect(); };
  }, [phase]);

  const close = (focusTab = true) => {
    setOpen(false);
    setTimeout(() => setPhase(null), CLOSE_MS);
    if (focusTab) (document.querySelector('.tab[aria-selected="true"]') as HTMLElement | null)?.focus();
  };

  // Something started before it was seen: it goes, uncounted.
  useEffect(() => { if (quiet && phase === 'ask' && !counted.current) close(false); }, [quiet]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // The thank-you and the support note take focus, so they are read out.
  useEffect(() => { if (phase && phase !== 'ask') card.current?.focus(); }, [phase]);

  const beside = async (url: string) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.create({ url, active: true, ...(tab ? { index: tab.index + 1 } : {}) });
  };

  const rate = async () => {
    setPhase('thanks');
    try {
      await beside(store!);
      count();
      void updateRate((s) => { s.done = true; });
    } catch {
      setPhase('fail');
    }
  };
  const later = () => {
    count();
    if (final) void updateRate((s) => { s.done = true; });
    setToast(final ? 'OK. We won’t ask again.' : 'OK. We’ll check back in a month.');
    close();
  };
  const tellUs = async () => {
    count();
    setPhase('sent');
    await beside(new URL('/support/new', (await currentEnv()).app).toString()).catch(() => {});
  };

  const toastEl = toast && <div className="toasts" aria-live="polite"><div className="toast" role="status"><span className="toast__main"><span className="toast__title">{toast}</span></span></div></div>;
  if (!phase || !state) return toastEl || null;

  const parts = summaryParts(state);
  return (
    <>
      <div className={`rate-slot${open ? ' rate-slot--open' : ''}`}>
        <div>
          {phase === 'ask' && (
            <section ref={card} className="rate rate--in" aria-labelledby="rate-h" onKeyDown={(e) => { if (e.key === 'Escape' && !counted.current) close(); }}>
              <div className="rate__top">
                <svg className="rate__mark" viewBox="0 0 48 44" aria-hidden="true">
                  <defs><Stops id="rate-g1" /></defs>
                  <g fill="url(#rate-g1)"><Bars rise /></g>
                </svg>
                <h2 id="rate-h" className="rate__head">
                  You’ve transcribed {parts.map((p, i) => <span key={p.word}>{i > 0 && ' and '}<b className="rate__n">{p.n}</b> {p.word}</span>)}
                </h2>
              </div>
              <p className="rate__text">If you have a moment, a rating in the store helps other people find VocalStack.</p>
              <div className="rate__acts">
                <button type="button" className="cta rate__go" aria-label="Rate VocalStack in the store, opens in a new tab" onClick={() => void rate()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={HEART} /></svg>Rate VocalStack
                </button>
                <button type="button" className="cta cta--text rate__later" onClick={later}>{final ? 'Don’t ask again' : 'Not now'}</button>
              </div>
              <div className="rate__foot">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                <span>Something not right? <button type="button" className="pg-link" onClick={() => void tellUs()}>Tell us</button></span>
              </div>
            </section>
          )}
          {phase === 'thanks' && (
            <div ref={card} className="rate" role="status" tabIndex={-1}>
              <div className="rate__done">
                <span className="rate__heart" aria-hidden="true">
                  <svg viewBox="0 0 48 44">
                    <defs>
                      <Stops id="rate-g2" />
                      <linearGradient id="rate-g3" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="40" y2="40">
                        <stop offset="0" style={{ stopColor: 'color-mix(in oklch,var(--brand) 35%,var(--live))' }} />
                        <stop offset=".6" style={{ stopColor: 'var(--live)' }} />
                        <stop offset="1" style={{ stopColor: 'var(--live)' }} />
                      </linearGradient>
                    </defs>
                    <g className="rate__bars" fill="url(#rate-g2)"><Bars rise={false} /></g>
                    <path className="rate__solid" fill="url(#rate-g3)" stroke="url(#rate-g3)" strokeWidth="2.4" strokeLinejoin="round" d={SOLID} />
                  </svg>
                </span>
                <div><b>Thank you.</b> Pick a star rating under Reviews in the new tab. Writing a review is optional. We won’t ask again.</div>
                <button type="button" className="icon-btn rate__x" aria-label="Close" onClick={() => close()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
              </div>
            </div>
          )}
          {phase === 'fail' && (
            <div ref={card} className="rate rate--quiet" role="status" tabIndex={-1}>
              <div className="rate__fail">
                <span className="round" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v3.75m0 3.75h.008M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg></span>
                <span>Couldn’t open the store. <button type="button" className="pg-link" onClick={() => void rate()}>Try again</button></span>
              </div>
            </div>
          )}
          {phase === 'sent' && (
            <div ref={card} className="rate rate--quiet" role="status" tabIndex={-1}>
              <div className="rate__sent">
                <span className="round" aria-hidden="true"><Tick /></span>
                <div><b>Thanks.</b> Our support page opened in a new tab. Tell us what went wrong there.</div>
                <button type="button" className="cta cta--text rate__close" onClick={() => close()}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {toastEl}
    </>
  );
}
