/** YouTube: a video given a VocalStack player link from the side panel
 *  (Now → Embedded Video Player) offers it on the page too: a card in the
 *  corner, its transcription's progress while the job runs, Open in
 *  VocalStack, and a close button that keeps it closed for that video
 *  for the rest of the visit. Never over a full-screen video. */

import markSvg from '../styles/vocalstack-mark.svg?raw';
import { videoIdOf } from '../lib/ahead';
import type { PlayerState } from '../lib/shared';

const CLOSED = 'vocalstack.player.closed';

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
[hidden]{display:none!important}
.card{position:fixed;right:24px;bottom:24px;z-index:2147483646;width:340px;padding:16px 16px 14px;border-radius:16px;background:rgba(19,19,38,.94);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 18px 48px rgba(0,0,0,.5);color:#eaecfa;font:400 13px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;animation:in .32s cubic-bezier(.2,.8,.2,1)}
@keyframes in{from{opacity:0;transform:translateY(12px)}}
@media (prefers-reduced-motion:reduce){.card{animation:none}}
.top{display:flex;gap:12px;align-items:flex-start}
.mark{flex:none;width:36px;height:36px;border-radius:10px;background:rgba(85,171,229,.14);display:flex;align-items:center;justify-content:center}
.mark svg{width:20px;height:auto}
.main{flex:1;min-width:0;padding-top:1px}
.head{font-size:14px;font-weight:600;letter-spacing:-.01em}
.sub{margin-top:2px;font-size:12.5px;font-weight:300;color:rgba(234,236,250,.6)}
.x{flex:none;width:28px;height:28px;margin:-4px -6px 0 0;border:0;border-radius:8px;background:transparent;color:rgba(234,236,250,.5);display:flex;align-items:center;justify-content:center;cursor:pointer}
.x:hover{background:rgba(255,255,255,.08);color:#eaecfa}
.bar{height:4px;margin:12px 0 0 48px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden}
.bar i{display:block;height:100%;border-radius:2px;background:#55abe5;transition:width .4s ease}
.go{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:38px;margin-top:14px;border:0;border-radius:10px;background:#55abe5;color:#0a0b1d;font:600 13.5px Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer}
.go:hover{filter:brightness(1.08)}
.go:disabled{opacity:.7;cursor:progress}
button:focus-visible{outline:2px solid #55abe5;outline-offset:2px}
.go:focus-visible{outline-color:#eaecfa}
`;

const CLOSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 18 18 6M6 6l12 12"/></svg>';
const OPEN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>';

type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
const ask = <T>(rpc: string, args: unknown) => chrome.runtime.sendMessage({ rpc, args }) as Promise<Reply<T> | undefined>;

function closedIds(): string[] {
  try { return JSON.parse(sessionStorage.getItem(CLOSED) ?? '[]') as string[]; } catch { return []; }
}

export function startPlayerPrompt() {
  let host: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let shownFor = '';
  let checked = '';
  let timer = 0;
  let seq = 0;

  function mount() {
    if (host) return;
    host = document.createElement('vocalstack-player');
    const root = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
    card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'VocalStack');
    card.innerHTML = `<div class="top"><span class="mark">${markSvg.replace(/<\?xml[^>]*>/, '')}</span>`
      + '<div class="main"><div class="head"></div><div class="sub" aria-live="polite"></div></div>'
      + `<button type="button" class="x" aria-label="Close" title="Close">${CLOSE}</button></div>`
      + '<div class="bar" hidden><i></i></div>'
      + `<button type="button" class="go">${OPEN}Open in VocalStack</button>`;
    root.appendChild(card);
    card.querySelector<HTMLElement>('.x')!.onclick = () => {
      try { sessionStorage.setItem(CLOSED, JSON.stringify([...closedIds(), shownFor].slice(-50))); } catch { /* private mode: closed until the next video */ }
      hide();
    };
    const go = card.querySelector<HTMLButtonElement>('.go')!;
    go.onclick = () => {
      go.disabled = true;
      void ask('video.player', { url: location.href, title: document.title.replace(/ - YouTube$/, '').slice(0, 120), here: true })
        .finally(() => { go.disabled = false; });
    };
    document.documentElement.appendChild(host);
  }

  function hide() {
    host?.remove();
    host = card = null;
    shownFor = '';
  }

  function render(id: string, s: PlayerState) {
    mount();
    shownFor = id;
    const working = s.phase === 'working';
    card!.querySelector('.head')!.textContent = 'Watch this on VocalStack';
    card!.querySelector('.sub')!.textContent = working
      ? (s.pct !== null ? `${s.step} · ${s.pct}%` : `${s.step}…`)
      : 'With its transcript beside the video.';
    const bar = card!.querySelector<HTMLElement>('.bar')!;
    bar.hidden = !working || s.pct === null;
    bar.querySelector('i')!.setAttribute('style', `width:${s.pct ?? 0}%`);
  }

  async function check(force = false) {
    const id = /\/(?:watch|shorts|live)\b/.test(location.pathname) ? videoIdOf(location.href) : null;
    if (!force && id === checked) return;
    checked = id ?? '';
    clearTimeout(timer);
    const n = ++seq;
    if (!id || closedIds().includes(id)) { hide(); return; }
    const r = await ask<PlayerState | null>('video.known', { url: location.href }).catch(() => undefined);
    if (n !== seq) return;
    const s = r?.ok ? r.value : null;
    if (!s || s.phase === 'failed') { hide(); return; }
    render(id, s);
    if (s.phase === 'working') timer = window.setTimeout(() => void check(true), 4000);
  }

  // YouTube moves between videos without loading a page.
  document.addEventListener('yt-navigate-finish', () => void check());
  window.addEventListener('popstate', () => void check());
  window.setInterval(() => void check(), 1500);
  // Given a link from the side panel just now.
  chrome.runtime.onMessage.addListener((m: { playerKnown?: boolean }) => {
    if (m?.playerKnown) void check(true);
    return false;
  });
  // Out of the way of a full-screen video.
  document.addEventListener('fullscreenchange', () => { if (host) host.style.display = document.fullscreenElement ? 'none' : ''; });
  void check(true);
}
