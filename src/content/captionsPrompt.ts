/** Captions on videos, on the page (top frame): a small card, top right,
 *  under Chrome's toolbar, for what the person would otherwise not see.
 *
 *  - `offer`: a site whose video VocalStack can't fetch is captioned from
 *    the tab's sound, and Chrome lets an extension hear a tab only after
 *    one click on its toolbar icon there (background/tabCaptions.ts). The
 *    card says so; that click turns the captions on. × is "not on this
 *    site" for the rest of the browser session.
 *  - `working`: a page's video file being transcribed for its captions.
 *  - `failed`: why captions didn't start, in plain words.
 *
 *  Closed shadow root, as content/playerPrompt.ts; never over a
 *  full-screen video. Shown by the background's `{ccPrompt}` messages. */

import markSvg from '../styles/vocalstack-mark.svg?raw';

export type PromptMsg =
  | { ccPrompt: 'offer'; site?: string | null }
  | { ccPrompt: 'working'; pct: number | null }
  | { ccPrompt: 'failed'; text: string }
  | { ccPrompt: 'hide' };

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
[hidden]{display:none!important}
.card{position:fixed;right:20px;top:16px;z-index:2147483646;width:336px;padding:14px 14px 14px 16px;border-radius:16px;background:rgba(19,19,38,.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 18px 48px rgba(0,0,0,.5);color:#eaecfa;font:400 13px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;text-align:left;animation:in .32s cubic-bezier(.2,.8,.2,1)}
@keyframes in{from{opacity:0;transform:translateY(-10px)}}
@media (prefers-reduced-motion:reduce){.card{animation:none}}
.top{display:flex;gap:12px;align-items:flex-start}
.mark{flex:none;width:36px;height:36px;border-radius:10px;background:rgba(85,171,229,.14);display:flex;align-items:center;justify-content:center}
.mark svg{width:20px;height:auto}
.card--failed .mark{background:rgba(247,132,114,.14)}
.main{flex:1;min-width:0;padding-top:1px}
.head{font-size:14px;font-weight:600;letter-spacing:-.01em}
.sub{margin-top:3px;font-size:12.5px;font-weight:400;color:rgba(234,236,250,.78);text-wrap:pretty}
.sub b{font-weight:600;color:#eaecfa}
.note{margin-top:6px;font-size:11.5px;font-weight:300;color:rgba(234,236,250,.55);text-wrap:pretty}
.up{display:inline-flex;vertical-align:-2px;margin-left:2px;color:#55abe5}
.x{flex:none;width:28px;height:28px;margin:-4px -4px 0 0;border:0;border-radius:8px;background:transparent;color:rgba(234,236,250,.5);display:flex;align-items:center;justify-content:center;cursor:pointer}
.x:hover{background:rgba(255,255,255,.08);color:#eaecfa}
.bar{height:4px;margin:12px 0 0 48px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden}
.bar i{display:block;height:100%;border-radius:2px;background:#55abe5;transition:width .4s ease}
button:focus-visible{outline:2px solid #55abe5;outline-offset:2px}
`;

const CLOSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 18 18 6M6 6l12 12"/></svg>';
const UP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25"/></svg>';

/** A failure stays this long, unless closed first. */
const FAILED_MS = 14_000;

export function startCaptionsPrompt() {
  let host: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let shown: PromptMsg['ccPrompt'] | null = null;
  let timer = 0;
  /** The progress card was closed: it stays closed for this video. */
  let quiet = false;

  function mount() {
    if (host) return;
    host = document.createElement('vocalstack-captions-prompt');
    const root = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
    card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'VocalStack captions');
    card.innerHTML = `<div class="top"><span class="mark">${markSvg.replace(/<\?xml[^>]*>/, '')}</span>`
      + '<div class="main"><div class="head"></div><div class="sub" aria-live="polite"></div><div class="note" hidden></div></div>'
      + `<button type="button" class="x">${CLOSE}</button></div>`
      + '<div class="bar" hidden><i></i></div>';
    root.appendChild(card);
    card.querySelector<HTMLElement>('.x')!.onclick = () => {
      // No captions offered on this site again this session; a progress
      // card or a failure just goes.
      if (shown === 'offer') void chrome.runtime.sendMessage({ ccDecline: true }).catch(() => {});
      if (shown === 'working') quiet = true;
      hide();
    };
    host.style.display = document.fullscreenElement ? 'none' : '';
    document.documentElement.appendChild(host);
  }

  function hide() {
    clearTimeout(timer);
    host?.remove();
    host = card = null;
    shown = null;
  }

  function show(m: PromptMsg) {
    if (m.ccPrompt === 'working' && quiet) return;
    if (m.ccPrompt !== 'working') quiet = false;
    if (m.ccPrompt === 'hide') { hide(); return; }
    mount();
    clearTimeout(timer);
    shown = m.ccPrompt;
    const $ = <T extends HTMLElement>(s: string) => card!.querySelector<T>(s)!;
    card!.classList.toggle('card--failed', m.ccPrompt === 'failed');
    const note = $('.note');
    const bar = $('.bar');
    const x = $('.x');
    note.hidden = m.ccPrompt !== 'offer';
    bar.hidden = m.ccPrompt !== 'working' || m.pct === null;
    if (m.ccPrompt === 'offer') {
      $('.head').textContent = 'Captions for this video?';
      $('.sub').innerHTML = `Click the <b>VocalStack</b> icon in Chrome’s toolbar to turn them on.<span class="up">${UP}</span>`;
      note.textContent = 'Chrome asks for this click once per tab on each site before VocalStack can hear it. Not in the toolbar? It’s under the puzzle-piece icon.';
      x.setAttribute('aria-label', 'Not on this site');
      x.title = 'Not on this site';
    } else if (m.ccPrompt === 'working') {
      $('.head').textContent = 'Preparing captions';
      $('.sub').textContent = m.pct !== null ? `Transcribing this video · ${m.pct}%` : 'Transcribing this video…';
      bar.querySelector('i')!.setAttribute('style', `width:${m.pct ?? 0}%`);
      x.setAttribute('aria-label', 'Close');
      x.title = 'Close';
    } else {
      $('.head').textContent = 'Captions didn’t start';
      $('.sub').textContent = m.text;
      x.setAttribute('aria-label', 'Close');
      x.title = 'Close';
      timer = window.setTimeout(hide, FAILED_MS);
    }
  }

  chrome.runtime.onMessage.addListener((m: PromptMsg) => {
    if (m && typeof m === 'object' && 'ccPrompt' in m) show(m);
    return false;
  });
  // Out of the way of a full-screen video.
  document.addEventListener('fullscreenchange', () => { if (host) host.style.display = document.fullscreenElement ? 'none' : ''; });
}
