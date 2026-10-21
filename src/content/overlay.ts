/** Floating Captions (design 3): live captions in a window on the page,
 *  and a video's own captions in time with it (`{vcap}` messages: cues
 *  from its transcription, background/vcap.ts). The window sits over the
 *  page's video until it is dragged or resized; then it stays where it
 *  was put (`captionWindow`, for every page). Its header has the spoken
 *  language and speaker labels of a live session (`live.settings`, from
 *  the next words on), and × hides it. Lives in a closed shadow root in
 *  the top layer, so the page's styles cannot reach it and it shows over
 *  full-screen video. Fed by the background (`{caption}` events and
 *  `{captionStatus}`). */

import type { LiveEvent } from '../lib/rpc';
import { mainVideo, visibleArea } from './video';

type Labels = 'auto' | 'on' | 'off';
interface Line { seq: number; text: string; speaker: string }
interface Said { key: number; seq: number; tr: string }
interface Cue { s: number; e: number; t: string; o?: string }
interface Status { state: string; mode: string; spokenLanguage: string | null; translateTo: string | null; speakerLabels: Labels; host?: string }
interface Lang { code: string; flag?: string; name: string; native?: string }
/** Where the person put the window: its corner as a share of the
 *  viewport, its width, and the text's height once resized. */
interface Geo { fx: number; fy: number; w: number; th: number | null }
interface Shown { key: string; who: string; color: string; text: string }

const GEO_KEY = 'captionWindow';
const LANES = ['#55abe5', '#f78472', '#7fd6b4'];
const MIN_W = 380;
const MIN_H = 120;
const EASE = 'cubic-bezier(.2,.7,.2,1)';
const LABEL_TIPS: Record<Labels, string> = { auto: 'When needed', on: 'On', off: 'Off' };

const svg = (d: string, size: number, width = 1.6) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const CHEVRON = svg('m19.5 8.25-7.5 7.5-7.5-7.5', 10, 2.2);
const GLOBE = svg('M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418', 14, 1.5);
const PEOPLE = svg('M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z', 15, 1.5);
const CLOSE = svg('M6 18 18 6M6 6l12 12', 14, 1.8);
const CHECK = svg('m4.5 12.75 6 6 9-13.5', 14, 2.2);
const GRIP = '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>';
const CORNER = '<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M9 3 3 9M9 6.5 6.5 9"/></svg>';

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.win{position:fixed;pointer-events:auto;touch-action:none;user-select:none;padding:14px 18px 16px;border-radius:16px;background:rgba(10,11,24,.82);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 16px 40px rgba(0,0,0,.45);color:#eaecfa;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;text-align:left;line-height:normal}
.rz{position:absolute;z-index:5;touch-action:none}
.rz-n,.rz-s{left:12px;right:12px;height:8px;cursor:ns-resize}.rz-n{top:-4px}.rz-s{bottom:-4px}
.rz-w,.rz-e{top:12px;bottom:12px;width:8px;cursor:ew-resize}.rz-w{left:-4px}.rz-e{right:-4px}
.rz-nw,.rz-ne,.rz-sw{width:16px;height:16px}.rz-nw{left:-4px;top:-4px;cursor:nwse-resize}.rz-ne{right:-4px;top:-4px;cursor:nesw-resize}.rz-sw{left:-4px;bottom:-4px;cursor:nesw-resize}
.rz-se{right:0;bottom:0;width:22px;height:22px;display:flex;align-items:flex-end;justify-content:flex-end;padding:0 5px 5px 0;cursor:nwse-resize;color:rgba(234,236,250,.35)}
.rz-se:hover{color:rgba(234,236,250,.7)}
.hd{display:flex;align-items:center;gap:10px;cursor:grab}
.win--drag .hd{cursor:grabbing}
.grip{flex:none;margin-left:-6px;display:flex;align-items:center;color:rgba(234,236,250,.35)}
.pill{flex:none;display:flex;align-items:center;gap:6px;height:20px;padding:0 8px;border-radius:99px;background:rgba(247,132,114,.16);font:600 9px ui-monospace,Menlo,monospace;letter-spacing:.12em;color:#f78472}
.pill i{width:6px;height:6px;border-radius:50%;background:currentColor;animation:dot 1.4s ease-in-out infinite}
.pill--paused{background:rgba(240,180,41,.14);color:#f0b429}.pill--paused i{animation:none}
.pill--wait{background:rgba(255,255,255,.08);color:rgba(234,236,250,.62)}.pill--wait i{animation:none;opacity:.6}
@keyframes dot{0%,100%{opacity:1}50%{opacity:.2}}
.btn{flex:none;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 6px 0 7px;border:0;border-radius:6px;background:rgba(255,255,255,.06);font:500 9.5px ui-monospace,Menlo,monospace;letter-spacing:.12em;color:rgba(234,236,250,.75);cursor:pointer;transition:background .15s}
.btn:hover,.btn[aria-expanded="true"]{background:rgba(255,255,255,.14)}
.btn .flag{font-size:13px;line-height:1;letter-spacing:0}
.btn--dim>svg:first-child{opacity:.4}
.rest{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 9.5px ui-monospace,Menlo,monospace;letter-spacing:.12em;color:rgba(234,236,250,.45)}
.grow{flex:1}
.x{flex:none;width:24px;height:24px;border:0;padding:0;border-radius:50%;background:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(234,236,250,.55)}
.x:hover{background:rgba(255,255,255,.1)}
.txt{margin-top:10px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}
.inner{display:flex;flex-direction:column;justify-content:flex-end;gap:6px}
.ln{font-size:19px;font-weight:400;line-height:1.4;color:#eaecfa;text-wrap:pretty;transition:color .4s ease}
.ln--prev{color:rgba(234,236,250,.55)}
.ln b{font-size:13px;font-weight:600;margin-right:8px}
.wait{font-size:15px;font-weight:300;color:rgba(234,236,250,.55)}
.pop{position:absolute;left:12px;z-index:6;width:290px;max-height:300px;overflow-y:auto;padding:6px;border-radius:12px;background:rgba(16,17,34,.96);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 16px 40px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:2px;cursor:default;scrollbar-width:none}
.pop::-webkit-scrollbar{width:0;height:0}
.pop--up{bottom:calc(100% + 8px)}.pop--down{top:calc(100% + 8px)}
.pop__title{padding:8px 10px 6px;font:500 9px ui-monospace,Menlo,monospace;letter-spacing:.14em;color:rgba(234,236,250,.4)}
.opt{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.opt:hover{background:rgba(255,255,255,.08)}
.opt[aria-checked="true"]{background:rgba(85,171,229,.12)}
.opt__flag{flex:none;width:20px;font-size:15px;line-height:1;text-align:center}
.opt__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.opt__label{font-size:13px;font-weight:500;color:#eaecfa}
.opt__sub{font-size:11.5px;font-weight:300;line-height:1.4;color:rgba(234,236,250,.5);text-wrap:pretty}
.opt svg{flex:none;color:#55abe5}
button:focus{outline:none}
button:focus-visible{outline:2px solid rgba(85,171,229,.6);outline-offset:1px}
`;

export function startOverlay() {
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let win: HTMLElement | null = null;
  let sessionId: string | null = null;
  /** A recording shown as captions: × hides them and the recording goes on. */
  let hideOnly = false;
  let status: Status | null = null;
  let lines: Line[] = [];
  /** Translations, newest last: a sentence's replaces any earlier version. */
  let said: Said[] = [];
  let draft = '';
  let draftTr = '';
  let trLang: string | null = null;
  /** Speaker names: typed by a person (outranks) and recognised from voices. */
  let typed: Record<string, string> = {};
  let voiced: Record<string, string> = {};
  /** A video's captions: its cues, and the one showing. */
  let cues: Cue[] | null = null;
  let cue = -1;
  let cueTimer: number | undefined;
  let timer: number | undefined;
  let geo: Geo | null = null;
  let menu: 'lang' | 'diar' | null = null;
  let langs: Lang[] = [];
  let shownKeys: string[] = [];

  const loadLangs = () => {
    if (langs.length) return;
    void chrome.runtime.sendMessage({ rpc: 'live.langs' }).then((r: { ok: boolean; value?: Lang[] } | undefined) => {
      if (r?.ok && r.value) { langs = r.value; renderHead(); }
    }, () => {});
  };
  const langOf = (code: string | null | undefined) => (code ? langs.find((l) => l.code === code) : undefined);

  function mount() {
    if (host) return;
    host = document.createElement('vocalstack-captions');
    // A popover sits in the top layer, so it shows above a fullscreen
    // video too (shown again after each fullscreen change to stay on top).
    host.setAttribute('popover', 'manual');
    host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;color-scheme:normal';
    root = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
    win = document.createElement('div');
    win.className = 'win';
    win.innerHTML = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw'].map((d) => `<div class="rz rz-${d}" data-rz="${d}" aria-hidden="true"></div>`).join('')
      + `<div class="rz rz-se" data-rz="se" title="Drag to resize">${CORNER}</div>`
      + '<div class="pop-slot"></div>'
      + `<div class="hd" title="Drag to move"><span class="grip">${GRIP}</span><span class="pill"></span>`
      + `<button type="button" class="btn" data-menu="lang" aria-haspopup="menu"></button>`
      + `<button type="button" class="btn" data-menu="diar" aria-haspopup="menu">${PEOPLE}${CHEVRON}</button>`
      + '<span class="rest"></span><span class="grow"></span>'
      + `<button type="button" class="x" aria-label="Hide captions" title="Hide captions">${CLOSE}</button></div>`
      + '<div class="txt"><div class="inner"></div></div>';
    root.appendChild(win);
    win.addEventListener('pointerdown', onPointerDown);
    win.querySelector<HTMLElement>('.x')!.onclick = close;
    for (const b of win.querySelectorAll<HTMLElement>('[data-menu]')) b.onclick = () => toggleMenu(b.dataset.menu as 'lang' | 'diar');
    document.documentElement.appendChild(host);
    showOnTop();
    chrome.storage.local.get(GEO_KEY).then((g) => { geo = (g[GEO_KEY] as Geo) ?? null; place(); render(); }, () => {});
    timer = window.setInterval(place, 250);
    document.addEventListener('fullscreenchange', reparent);
    window.addEventListener('pointerdown', onOutside);
    window.addEventListener('keydown', onKey, true);
    loadLangs();
  }

  function unmount() {
    if (timer) clearInterval(timer);
    if (cueTimer) clearInterval(cueTimer);
    cues = null;
    cue = -1;
    document.removeEventListener('fullscreenchange', reparent);
    window.removeEventListener('pointerdown', onOutside);
    window.removeEventListener('keydown', onKey, true);
    host?.remove();
    host = root = win = null;
    sessionId = status = null;
    lines = [];
    said = [];
    draft = draftTr = '';
    trLang = null;
    typed = {};
    voiced = {};
    menu = null;
    shownKeys = [];
  }

  function close() {
    if (cues) void chrome.runtime.sendMessage({ vcapOff: true });
    else if (sessionId) void chrome.runtime.sendMessage(hideOnly ? { rpc: 'live.overlay', args: { id: sessionId, on: false } } : { rpc: 'live.stop', args: { id: sessionId } });
    unmount();
  }

  function showOnTop() {
    if (!host) return;
    try {
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch { /* no popover support: stays a fixed element */ }
  }

  function reparent() {
    // Entering fullscreen puts the video above us: come back on top.
    setTimeout(() => { showOnTop(); place(); }, 50);
  }

  const minW = () => Math.min(MIN_W, innerWidth - 16);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  /** Over the video, low down (or at the foot of the window when the
   *  frame has none), until the person puts it somewhere. */
  function place() {
    if (!win) return;
    const h = win.offsetHeight;
    let w: number, x: number, y: number;
    if (geo) {
      w = clamp(geo.w, minW(), innerWidth - 16);
      x = clamp(geo.fx * innerWidth, 0, innerWidth - w);
      y = clamp(geo.fy * innerHeight, 0, Math.max(0, innerHeight - h));
    } else {
      const r = mainVideo()?.getBoundingClientRect();
      const box = r && r.width > 0 ? { l: Math.max(0, r.left), r: Math.min(innerWidth, r.right), b: Math.min(innerHeight, r.bottom), h: r.height } : null;
      w = clamp(box ? Math.min(620, (box.r - box.l) * 0.8) : 620, minW(), innerWidth - 16);
      x = clamp(box ? (box.l + box.r - w) / 2 : (innerWidth - w) / 2, 0, innerWidth - w);
      y = clamp(box ? box.b - h - box.h * 0.06 : innerHeight - h - 32, 0, Math.max(0, innerHeight - h));
    }
    win.style.width = `${w}px`;
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
    const pop = root?.querySelector<HTMLElement>('.pop');
    if (pop) pop.className = `pop ${y > 320 ? 'pop--up' : 'pop--down'}`;
  }

  function saveGeo(next: Geo) {
    geo = next;
    void chrome.storage.local.set({ [GEO_KEY]: next });
  }

  /** Drag by the header (not its buttons), resize by the edges. */
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !win) return;
    const t = e.target as HTMLElement;
    if (t.closest('.pop')) return;
    const dir = t.closest<HTMLElement>('[data-rz]')?.dataset.rz;
    if (!dir && (!t.closest('.hd') || t.closest('button'))) return;
    e.preventDefault();
    e.stopPropagation();
    const txt = win.querySelector<HTMLElement>('.txt')!;
    const sx = e.clientX, sy = e.clientY;
    const x0 = win.offsetLeft, y0 = win.offsetTop, w0 = win.offsetWidth, h0 = win.offsetHeight;
    const chromeH = h0 - txt.offsetHeight;
    let next: Geo = { fx: x0 / innerWidth, fy: y0 / innerHeight, w: w0, th: geo?.th ?? null };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let x = x0, y = y0, w = w0, th = next.th;
      if (!dir) {
        x = clamp(x0 + dx, 0, innerWidth - w0);
        y = clamp(y0 + dy, 0, Math.max(0, innerHeight - h0));
      } else {
        if (dir.includes('e')) w = clamp(w0 + dx, minW(), innerWidth - x0);
        if (dir.includes('w')) { w = clamp(w0 - dx, minW(), x0 + w0); x = x0 + w0 - w; }
        if (dir.includes('s')) th = clamp(h0 + dy, MIN_H, innerHeight - y0) - chromeH;
        if (dir.includes('n')) { const h = clamp(h0 - dy, MIN_H, y0 + h0); th = h - chromeH; y = y0 + h0 - h; }
      }
      next = { fx: x / innerWidth, fy: y / innerHeight, w, th };
      geo = next;
      if (th !== null) { txt.style.transition = 'none'; txt.style.height = `${th}px`; }
      place();
    };
    const up = () => {
      win?.classList.remove('win--drag');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      saveGeo(next);
    };
    if (!dir) win.classList.add('win--drag');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function onOutside(e: PointerEvent) {
    // Inside the window, events reach the page retargeted to the host.
    if (menu && e.target !== host) { menu = null; renderMenu(); }
  }
  function onKey(e: KeyboardEvent) {
    if (menu && e.key === 'Escape') { menu = null; renderMenu(); }
  }

  function toggleMenu(m: 'lang' | 'diar') {
    menu = menu === m ? null : m;
    if (menu === 'lang') loadLangs();
    renderMenu();
  }

  /** Change the session from the next words on, and keep the choice for
   *  the next recording (the panel's own settings, ui/langs.tsx). */
  function change(patch: { spokenLanguage?: string | null; speakerLabels?: Labels }) {
    menu = null;
    if (status) status = { ...status, ...patch } as Status;
    if (patch.spokenLanguage !== undefined) void chrome.storage.local.set({ liveLang: patch.spokenLanguage });
    if (patch.speakerLabels !== undefined) void chrome.storage.local.set({ speakerLabels: patch.speakerLabels });
    if (sessionId && !cues) void chrome.runtime.sendMessage({ rpc: 'live.settings', args: { id: sessionId, ...patch } }).catch(() => {});
    renderHead();
    renderMenu();
    render();
  }

  function renderMenu() {
    const slot = root?.querySelector<HTMLElement>('.pop-slot');
    if (!slot || !win) return;
    slot.textContent = '';
    for (const b of win.querySelectorAll<HTMLElement>('[data-menu]')) b.setAttribute('aria-expanded', String(b.dataset.menu === menu));
    if (!menu || !status) return;
    const pop = document.createElement('div');
    pop.setAttribute('role', 'menu');
    pop.className = `pop ${win.offsetTop > 320 ? 'pop--up' : 'pop--down'}`;
    const title = document.createElement('div');
    title.className = 'pop__title';
    title.textContent = menu === 'lang' ? 'SPOKEN LANGUAGE' : 'SPEAKER LABELS';
    pop.appendChild(title);
    const opt = (label: string, sub: string, flag: string, on: boolean, pick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(on));
      if (flag) { const f = document.createElement('span'); f.className = 'opt__flag'; f.textContent = flag; b.appendChild(f); }
      const main = document.createElement('span');
      main.className = 'opt__main';
      const l = document.createElement('span'); l.className = 'opt__label'; l.textContent = label; main.appendChild(l);
      if (sub) { const s = document.createElement('span'); s.className = 'opt__sub'; s.textContent = sub; main.appendChild(s); }
      b.appendChild(main);
      if (on) b.insertAdjacentHTML('beforeend', CHECK);
      b.onclick = pick;
      pop.appendChild(b);
    };
    if (menu === 'lang') {
      const cur = status.spokenLanguage;
      opt('Auto detect', 'Each line gets its own detected language.', '', !cur, () => change({ spokenLanguage: null }));
      for (const l of langs) opt(l.native ?? l.name, l.native ? l.name : '', l.flag ?? '', cur === l.code, () => change({ spokenLanguage: l.code }));
    } else {
      const cur = status.speakerLabels;
      opt('When needed', 'Labels appear once a second voice is heard.', '', cur === 'auto', () => change({ speakerLabels: 'auto' }));
      opt('On', 'Every line shows its speaker.', '', cur === 'on', () => change({ speakerLabels: 'on' }));
      opt('Off', 'No speaker labels.', '', cur === 'off', () => change({ speakerLabels: 'off' }));
    }
    slot.appendChild(pop);
    pop.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  /** The header: state, the session's menus, where it comes from. */
  function renderHead() {
    if (!win) return;
    const pill = win.querySelector<HTMLElement>('.pill')!;
    const langBtn = win.querySelector<HTMLElement>('[data-menu="lang"]')!;
    const diarBtn = win.querySelector<HTMLElement>('[data-menu="diar"]')!;
    const live = !cues && !!status;
    pill.hidden = langBtn.hidden = diarBtn.hidden = !live;
    if (live) {
      const st = status!.state;
      pill.className = `pill${st === 'paused' ? ' pill--paused' : st === 'live' ? '' : ' pill--wait'}`;
      pill.innerHTML = `<i></i>${st === 'paused' ? 'PAUSED' : st === 'live' ? 'LIVE' : st === 'stopping' ? 'STOPPING' : 'STARTING'}`;
      const spoken = langOf(status!.spokenLanguage);
      langBtn.innerHTML = (status!.spokenLanguage ? `<span class="flag">${spoken?.flag ?? status!.spokenLanguage.toUpperCase()}</span>` : GLOBE) + CHEVRON;
      const langTip = `Spoken language: ${status!.spokenLanguage ? (spoken?.name ?? status!.spokenLanguage) : 'Auto detect'}`;
      langBtn.title = langTip;
      langBtn.setAttribute('aria-label', langTip);
      const diarTip = `Speaker labels: ${LABEL_TIPS[status!.speakerLabels]}`;
      diarBtn.title = diarTip;
      diarBtn.setAttribute('aria-label', diarTip);
      diarBtn.classList.toggle('btn--dim', status!.speakerLabels === 'off');
    }
    const to = status && !cues ? status.translateTo : trLang;
    const site = (status?.host ?? location.host).replace(/^www\./, '').toUpperCase();
    win.querySelector<HTMLElement>('.rest')!.textContent = (to ? `→ ${(langOf(to)?.name ?? to).toUpperCase()} · ` : '') + site;
  }

  /** The two lines shown: the one before, dimmed, and the one being said. */
  function shown(): Shown[] {
    if (cues) {
      if (cue < 0) return [];
      return [cues[cue - 1], cues[cue]].filter((c): c is Cue => !!c).map((c) => ({ key: `q${c.s}`, who: '', color: '', text: c.t }));
    }
    const names: Record<string, string> = { ...Object.fromEntries(Object.entries(voiced).filter(([, v]) => v)), ...Object.fromEntries(Object.entries(typed).filter(([, v]) => v)) };
    const labels = status?.speakerLabels ?? 'auto';
    const voices = new Set(lines.map((l) => l.speaker));
    const show = labels === 'on' || (labels !== 'off' && voices.size > 1) || (labels !== 'off' && Object.keys(names).length > 0);
    const tag = (sp: string) => ({ who: show ? names[sp] || `Speaker ${Number(sp) + 1}` : '', color: LANES[(Number(sp) || 0) % LANES.length]! });
    const last = lines[lines.length - 1];
    const next = `c${(last?.seq ?? 0) + 1}`;
    const items: Shown[] = [];
    if (status ? status.translateTo : trLang) {
      const spOf = (seq: number) => lines.find((l) => l.seq === seq)?.speaker ?? last?.speaker ?? '0';
      for (const x of said) items.push({ key: `t${x.key}`, ...tag(spOf(x.seq)), text: x.tr });
      if (draftTr) items.push({ key: 'dt', ...tag(last?.speaker ?? '0'), text: draftTr });
    } else {
      for (const l of lines) items.push({ key: `c${l.seq}`, ...tag(l.speaker), text: l.text });
      if (draft) items.push({ key: next, ...tag(last?.speaker ?? '0'), text: draft });
    }
    return items.slice(-2);
  }

  function render() {
    if (!win) return;
    renderHead();
    const inner = win.querySelector<HTMLElement>('.inner')!;
    const txt = win.querySelector<HTMLElement>('.txt')!;
    const items = shown();
    // Where each line was, so a line moving up glides there.
    const before = new Map<string, number>();
    for (const el of inner.querySelectorAll<HTMLElement>('[data-k]')) before.set(el.dataset.k!, el.getBoundingClientRect().top);
    const had = new Set(shownKeys);
    inner.textContent = '';
    if (!items.length) {
      const w = document.createElement('div');
      w.className = 'wait';
      w.textContent = cues ? '' : status?.state === 'paused' ? 'Paused.' : status && status.state !== 'live' ? 'Getting ready…' : 'Listening…';
      inner.appendChild(w);
    }
    items.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = `ln${i < items.length - 1 ? ' ln--prev' : ''}`;
      d.dataset.k = it.key;
      if (it.who) { const b = document.createElement('b'); b.style.color = it.color; b.textContent = it.who; d.appendChild(b); }
      d.appendChild(document.createTextNode(it.text));
      inner.appendChild(d);
    });
    for (const el of inner.querySelectorAll<HTMLElement>('[data-k]')) {
      const k = el.dataset.k!;
      const top = before.get(k);
      if (top !== undefined) {
        const dy = top - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 0.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: EASE });
      } else if (shownKeys.length && !had.has(k)) {
        el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE });
      }
    }
    shownKeys = items.map((x) => x.key);
    // The text's height follows its lines, unless the person set it.
    if (geo?.th != null) { txt.style.transition = 'none'; txt.style.height = `${geo.th}px`; }
    else {
      const h = inner.offsetHeight;
      txt.style.transition = txt.style.height ? `height .4s ${EASE}` : 'none';
      txt.style.height = `${h}px`;
    }
    place();
  }

  /** The cue under the video's clock: the last to start at or before it,
   *  while it lasts. Nothing while the video is out of view. */
  function follow() {
    if (!cues) return;
    const v = mainVideo();
    let next = -1;
    if (v) {
      const t = v.currentTime;
      for (let i = 0; i < cues.length; i++) { if (cues[i]!.s > t) break; next = i; }
      if (next >= 0 && t >= cues[next]!.e) next = -1;
    }
    if (next !== cue) {
      cue = next;
      if (win) win.style.visibility = cue < 0 ? 'hidden' : '';
      render();
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (msg?.vcap === 'off') { if (cues) unmount(); return false; }
    if (msg?.vcap === 'on') {
      // One owner per frame: the video's captions take over from a
      // recording shown here, which the panel then shows as off.
      if (sessionId && sessionId !== 'vcap') void chrome.runtime.sendMessage({ rpc: 'live.overlay', args: { id: sessionId, on: false } });
      unmount();
      sessionId = 'vcap';
      trLang = msg.lang ?? null;
      cues = [...((msg.cues as Cue[]) ?? [])].sort((a, b) => a.s - b.s);
      mount();
      cueTimer = window.setInterval(follow, 200);
      follow();
      render();
      return false;
    }
    if (msg?.pick === true) {
      send({ area: visibleArea(mainVideo()) });
      return false;
    }
    if (msg?.captionStatus || (msg?.caption !== undefined && msg.caption !== 'off')) {
      if (sessionId !== msg.id) {
        // A recording shown here takes over from the video's captions, which
        // the panel then shows as off.
        if (cues) void chrome.runtime.sendMessage({ vcapOff: true });
        unmount();
        sessionId = msg.id;
      }
      hideOnly = msg.hide === true;
      mount();
    }
    if (msg?.captionStatus) {
      const was = status;
      status = msg.captionStatus as Status;
      if (!was || was.state !== status.state || was.translateTo !== status.translateTo || was.spokenLanguage !== status.spokenLanguage || was.speakerLabels !== status.speakerLabels || was.host !== status.host) {
        render();
        if (menu) renderMenu();
      }
      return false;
    }
    if (msg?.caption === undefined) return false;
    if (msg.caption === 'off') { if (msg.id === sessionId) unmount(); return false; }
    const ev = msg.caption as LiveEvent;
    if (ev.type === 'committed') {
      // A line sent again (a subscription reopened) replaces itself.
      lines = [...lines.filter((x) => x.seq !== ev.seq), { seq: ev.seq, text: ev.text, speaker: ev.speaker ?? '0' }].sort((a, b) => a.seq - b.seq).slice(-8);
      draft = draftTr = '';
    } else if (ev.type === 'draft') draft = ev.text;
    else if (ev.type === 'draftTranslated') { trLang = ev.lang; draftTr = ev.text; }
    else if (ev.type === 'translated') {
      trLang = ev.lang;
      const key = ev.sentenceId ?? -1 - ev.seq;
      said = [...said.filter((x) => x.key !== key), { key, seq: ev.seq, tr: ev.text }].sort((a, b) => a.seq - b.seq).slice(-6);
      draftTr = '';
    } else if (ev.type === 'speaker') (ev.by === 'person' ? typed : voiced)[ev.speaker] = ev.name;
    render();
    return false;
  });
}
