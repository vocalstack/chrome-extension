/** Instant start pings for a screen that offers a live Start (lib/warm.ts
 *  has the timing): canStart=true while the screen is open and in use,
 *  canStart=false when it closes or stops offering Start (a recording
 *  started). Never under browser automation; errors are ignored. */

import { useEffect, useRef } from 'react';
import { currentEnv } from '../lib/env';
import { rpc } from '../lib/rpc';
import { Warmer, type WarmBody } from '../lib/warm';

/** The last address and token a ping used: the closing ping goes out at
 *  once with them, while the panel's page is still there to send it. */
let last: { url: string; token: string } | null = null;

function post(url: string, token: string, b: WarmBody) {
  fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(b),
    keepalive: true,
  }).catch(() => {});
}

function send(b: WarmBody) {
  if (!b.canStart && last) { post(last.url, last.token, b); return; }
  void Promise.all([currentEnv(), rpc('auth.token')]).then(([env, token]) => {
    last = { url: `${env.api}/v1/realtime/warm`, token };
    post(last.url, token, b);
  }, () => {});
}

const automated = () => typeof navigator !== 'undefined' && navigator.webdriver === true;
const visible = () => document.visibilityState === 'visible';

/** `offering`: the screen shows a Start right now (and may use it). */
export function useWarm(offering: boolean, spokenLanguage: string | null | undefined) {
  const w = useRef<Warmer | null>(null);
  if (!w.current) w.current = new Warmer(send);
  const lang = spokenLanguage ?? null;
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    if (!offering || automated()) return;
    const warmer = w.current!;
    warmer.offer(langRef.current, visible());
    const used = () => warmer.used();
    const shown = () => { if (visible()) warmer.used(); };
    const gone = () => warmer.withdraw();
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', used, opts);
    window.addEventListener('keydown', used, opts);
    window.addEventListener('pointermove', used, opts);
    window.addEventListener('focus', used);
    document.addEventListener('visibilitychange', shown);
    window.addEventListener('pagehide', gone);
    return () => {
      window.removeEventListener('pointerdown', used, opts);
      window.removeEventListener('keydown', used, opts);
      window.removeEventListener('pointermove', used, opts);
      window.removeEventListener('focus', used);
      document.removeEventListener('visibilitychange', shown);
      window.removeEventListener('pagehide', gone);
      warmer.withdraw();
    };
  }, [offering]);

  useEffect(() => {
    if (automated()) return;
    w.current!.language(lang, visible());
  }, [lang]);
}
