/** Floating Captions (design 3): live captions in a window on the page,
 *  and a video's own captions in time with it (`{vcap}` messages: cues
 *  from its transcription, background/vcap.ts). The window sits over the
 *  page's video until it is dragged or resized; then it stays where it
 *  was put (`captionWindow`, for every page). Its header has a live
 *  session's spoken language (`live.settings`, from the next words on) and
 *  reading language (`readLang`, which every session follows), each a menu
 *  with a search box, and × hides it. Lives in a closed shadow root in
 *  the top layer, so the page's styles cannot reach it and it shows over
 *  full-screen video. Fed by the background (`{caption}` events and
 *  `{captionStatus}`). A session reading ahead (YouTube, lib/ahead.ts)
 *  sends its lines before they are said, on the video's clock: they wait,
 *  then show whole, greyed, and light up word by word as each is said. */

import type { LiveEvent } from '../lib/rpc';
import { AHEAD_LEAD, videoIdOf } from '../lib/ahead';
import { mainVideo, visibleArea } from './video';

type Labels = 'auto' | 'on' | 'off';
type Menu = 'lang' | 'tr';
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
interface Line { seq: number; text: string; speaker: string }
interface Said { key: number; seq: number; tr: string }
interface Cue { s: number; e: number; t: string; o?: string; tr?: boolean; w?: { s: number; e: number; t: string }[] }
interface Status { state: string; mode: string; spokenLanguage: string | null; translateTo: string | null; speakerLabels: Labels; host?: string; ahead?: boolean }
/** A line read ahead: its times (and its words') on video `vid`'s clock. */
interface Timed { seq: number; s: number; e: number; text: string; speaker: string; vid?: string; words?: { s: number; e: number; t: string }[] }
/** What can show read ahead: a line, or a sentence's translation. */
interface Unit { key: string; s: number; e: number; text: string; speaker: string; words?: Timed['words']; translated?: boolean }
interface Lang { code: string; flag?: string; name: string; native?: string }
/** Where the person put the window: its corner as a share of the
 *  viewport, its width, and the text's height once resized. */
interface Geo { fx: number; fy: number; w: number; th: number | null }
/** `said`: how much of the text has been said (the rest is greyed). */
interface Shown { key: string; who: string; color: string; text: string; said?: number }

const GEO_KEY = 'captionWindow';
const LANES = ['#55abe5', '#f78472', '#7fd6b4'];
const MIN_W = 380;
const MIN_H = 120;
const EASE = 'cubic-bezier(.2,.7,.2,1)';
/** Read ahead: a line stays this long after its last word, unless the next starts. */
const HOLD_S = 3;
/** Read ahead: how many lines and translations are kept. */
const KEEP_TIMED = 2000;
/** The most lines a window set tall shows. */
const KEEP_SHOWN = 30;

const svg = (d: string, size: number, width = 1.6) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const CHEVRON = svg('m19.5 8.25-7.5 7.5-7.5-7.5', 10, 2.2);
const LANG = svg('m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802', 14);
const ARROW = svg('M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3', 11, 1.8);
const SEARCH = svg('m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z', 16, 1.8);
const CLOSE = svg('M6 18 18 6M6 6l12 12', 14, 1.8);
const CHECK = svg('m4.5 12.75 6 6 9-13.5', 16, 2.2);
const GRIP = '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>';
const CORNER = '<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M9 3 3 9M9 6.5 6.5 9"/></svg>';

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
[hidden]{display:none!important}
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
.langs{flex:0 1 auto;min-width:0;display:flex;align-items:center;gap:2px}
.btn{flex:none;display:inline-flex;align-items:center;gap:4px;height:26px;max-width:100%;padding:0 6px 0 7px;border:0;border-radius:8px;background:rgba(255,255,255,.06);font:600 11.5px Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:rgba(234,236,250,.8);cursor:pointer;transition:background .15s}
.btn[data-menu="tr"]{flex:0 1 auto;min-width:0}
.btn:hover,.btn[aria-expanded="true"]{background:rgba(255,255,255,.14)}
.btn svg{flex:none}
.btn .chev{display:flex;opacity:.6}
.btn .name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn .flag{font-size:13px;line-height:1}
.arrow{flex:none;display:flex;color:rgba(234,236,250,.45)}
.buf{flex:none;display:flex;align-items:center;gap:7px;font:500 9.5px ui-monospace,Menlo,monospace;letter-spacing:.12em;color:rgba(234,236,250,.62)}
.buf i{width:11px;height:11px;border:1.5px solid rgba(234,236,250,.22);border-top-color:#55abe5;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.grow{flex:1}
.x{flex:none;width:24px;height:24px;border:0;padding:0;border-radius:50%;background:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(234,236,250,.55)}
.x:hover{background:rgba(255,255,255,.1)}
.txt{margin-top:10px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}
.inner{display:flex;flex-direction:column;justify-content:flex-end;gap:6px}
.ln{font-size:19px;font-weight:400;line-height:1.4;color:#eaecfa;text-wrap:pretty;transition:color .4s ease}
.ln--prev{color:rgba(234,236,250,.55)}
.ln .todo{color:rgba(234,236,250,.32)}
.ln b{font-size:13px;font-weight:600;margin-right:8px}
.wait{font-size:15px;font-weight:300;color:rgba(234,236,250,.55)}
.scrim{position:fixed;inset:0;z-index:10;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,6,21,.7);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;line-height:normal;text-align:left}
.sheet{width:min(400px,100%);max-height:min(560px,86vh);display:flex;flex-direction:column;padding:16px 0 12px;border-radius:20px;background:#1b1b33;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 24px 60px rgba(0,0,0,.6);color:#eaecfa;overflow:hidden}
.sheet__head{flex:none;padding:0 20px;display:flex;align-items:baseline;justify-content:space-between}
.sheet__title{font:600 11px ui-monospace,"SF Mono",Menlo,Monaco,Consolas,monospace;letter-spacing:.12em;color:#848eae}
.sheet__done{border:0;padding:0;background:none;cursor:pointer;font:500 13px Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#85b4e0}
.sheet__note{flex:none;padding:8px 20px 0;font-size:11.5px;line-height:1.45;color:#848eae;text-wrap:pretty}
.sheet__search{flex:none;margin:12px 20px 0;padding:11px 13px;border-radius:12px;background:rgba(255,255,255,.04);display:flex;align-items:center;gap:9px;color:#848eae}
.sheet__search input{flex:1;min-width:0;height:22px;padding:0;border:0;outline:none;background:transparent;color:#eaecfa;font:400 14px Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;user-select:text}
.sheet__search input::placeholder{color:#848eae}
.sheet__body{flex:1 1 0%;min-height:120px;overflow-y:auto;overscroll-behavior:contain;margin-top:8px;padding:0 20px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
.row{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:11px 6px;border:0;border-radius:12px;background:none;color:inherit;text-align:left;cursor:pointer;font-family:inherit}
.row:hover{background:rgba(255,255,255,.05)}
.row[aria-selected="true"]{background:rgba(255,255,255,.1)}
.row__flag{flex:none;width:24px;display:flex;justify-content:center;font-size:19px;line-height:1;color:rgba(234,236,250,.62)}
.row__main{flex:1;min-width:0}
.row__label{display:block;font-size:15.5px;font-weight:400;color:#eaecfa}
.row[aria-selected="true"] .row__label{font-weight:600}
.row__native{display:block;margin-top:2px;font-size:11.5px;color:#848eae}
.row__check{flex:none;width:16px;display:flex;justify-content:center;color:#3382cc}
.cc{display:inline-flex;align-items:center;justify-content:center;height:15px;padding:0 3px;border:1.5px solid currentColor;border-radius:4px;font:700 8.5px ui-monospace,Menlo,monospace;letter-spacing:.04em;box-sizing:border-box}
.more{padding:12px 6px 6px;font:500 10.5px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.06em;color:#848eae}
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
  /** Read ahead: the lines to come and gone, and sentences' translations. */
  let timed: Timed[] = [];
  let timedTr = new Map<number, { seqs: number[]; text: string }>();
  /** Read ahead: the API's sentences, which the captions show whole. */
  let timedSent = new Map<number, { seqs: number[]; text: string; speaker: string }>();
  let aheadTimer: number | undefined;
  /** Read ahead: how far past the playhead the transcript reaches (null:
   *  nothing yet), from content/ahead.ts in this frame. */
  let lead: number | null = null;
  let aheadShown = '';
  let timer: number | undefined;
  let geo: Geo | null = null;
  let menu: Menu | null = null;
  /** The open menu's search. */
  let query = '';
  let langs: Lang[] = [];
  let trLangs: Lang[] = [];
  let shownKeys: string[] = [];

  const loadLangs = () => {
    for (const list of ['transcription', 'translation'] as const) {
      if ((list === 'transcription' ? langs : trLangs).length) continue;
      void chrome.runtime.sendMessage({ rpc: 'live.langs', args: { list } }).then((r: { ok: boolean; value?: Lang[] } | undefined) => {
        if (!r?.ok || !r.value) return;
        if (list === 'transcription') langs = r.value; else trLangs = r.value;
        renderHead();
        if (menu) renderMenu();
      }, () => {});
    }
  };
  const langOf = (code: string | null | undefined) => (code ? langs.find((l) => l.code === code) ?? trLangs.find((l) => l.code === code) : undefined);

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
      + `<div class="hd" title="Drag to move"><span class="grip">${GRIP}</span><span class="pill"></span>`
      + `<span class="langs"><button type="button" class="btn" data-menu="lang" aria-haspopup="dialog"></button>`
      + `<span class="arrow">${ARROW}</span><button type="button" class="btn" data-menu="tr" aria-haspopup="dialog"></button></span>`
      + '<span class="buf" hidden><i></i>BUFFERING</span><span class="grow"></span>'
      + `<button type="button" class="x" aria-label="Hide captions" title="Hide captions">${CLOSE}</button></div>`
      + '<div class="txt"><div class="inner"></div></div>';
    root.appendChild(win);
    win.addEventListener('pointerdown', onPointerDown);
    win.querySelector<HTMLElement>('.x')!.onclick = close;
    for (const b of win.querySelectorAll<HTMLElement>('[data-menu]')) b.onclick = () => toggleMenu(b.dataset.menu as Menu);
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
    if (aheadTimer) clearInterval(aheadTimer);
    aheadTimer = undefined;
    timed = [];
    timedTr = new Map();
    timedSent = new Map();
    aheadShown = '';
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
  }

  function saveGeo(next: Geo) {
    geo = next;
    void chrome.storage.local.set({ [GEO_KEY]: next });
  }

  /** Drag by the header (not its buttons), resize by the edges. */
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !win) return;
    const t = e.target as HTMLElement;
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
      // Resized: as many lines as now fit.
      if (dir) render();
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

  function toggleMenu(m: Menu) {
    menu = menu === m ? null : m;
    query = '';
    loadLangs();
    renderMenu();
  }

  /** Change the session from the next words on, and keep the choice for
   *  the next recording (the panel's own settings, ui/langs.tsx). The
   *  reading language is the panel's too: the background moves every
   *  running session to it. */
  function change(patch: { spokenLanguage?: string | null; translateTo?: string | null }) {
    menu = null;
    if (status) status = { ...status, ...patch } as Status;
    if (patch.spokenLanguage !== undefined) {
      void chrome.storage.local.set({ liveLang: patch.spokenLanguage });
      if (sessionId && !cues) void chrome.runtime.sendMessage({ rpc: 'live.settings', args: { id: sessionId, spokenLanguage: patch.spokenLanguage } }).catch(() => {});
    }
    if (patch.translateTo !== undefined) void chrome.storage.local.set({ readLang: patch.translateTo });
    renderHead();
    renderMenu();
    render();
  }

  /** The language picker, as the side panel's (ui/ds.tsx LanguagePicker):
   *  a sheet over the darkened page, its search, flagged rows with each
   *  language's own name, a check on the one in use. */
  function renderMenu() {
    if (!root || !win) return;
    // Languages arriving redraw the picker: the search keeps its focus.
    const typing = root.activeElement?.tagName === 'INPUT';
    root.querySelector('.scrim')?.remove();
    for (const b of win.querySelectorAll<HTMLElement>('[data-menu]')) b.setAttribute('aria-expanded', String(b.dataset.menu === menu));
    if (!menu || !status) return;
    const spoken = menu === 'lang';
    const title = spoken ? 'SPOKEN LANGUAGE' : 'READ IN';
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-label', title);
    scrim.onclick = (e) => { if (e.target === scrim) { menu = null; renderMenu(); } };
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `<div class="sheet__head"><span class="sheet__title">${title}</span><button type="button" class="sheet__done">Done</button></div>`
      + `<div class="sheet__note">${spoken ? 'The language spoken in this video. A change applies from the next words on.' : 'Transcripts, captions and dubs show in this language. Change it any time.'}</div>`
      + `<label class="sheet__search">${SEARCH}</label><div class="sheet__body" role="listbox"></div>`;
    sheet.querySelector<HTMLElement>('.sheet__done')!.onclick = () => { menu = null; renderMenu(); };
    const pool = spoken ? langs : trLangs;
    const input = document.createElement('input');
    const placeholder = pool.length ? `Search ${pool.length} languages` : 'Search languages';
    Object.assign(input, { type: 'text', value: query, placeholder, autocomplete: 'off', spellcheck: false });
    input.setAttribute('aria-label', placeholder);
    // Typing here is not the page's: keep its shortcuts (YouTube's k, f, m…) out.
    for (const t of ['keydown', 'keyup', 'keypress'] as const) input.addEventListener(t, (e) => { if ((e as KeyboardEvent).key !== 'Escape') e.stopPropagation(); });
    input.oninput = () => { query = input.value; fill(); };
    sheet.querySelector('.sheet__search')!.appendChild(input);
    const body = sheet.querySelector<HTMLElement>('.sheet__body')!;
    const cur = spoken ? status.spokenLanguage : status.translateTo;
    const rows: { flag: string; label: string; native?: string; on: boolean; pick: () => void }[] = [
      spoken
        ? { flag: LANG.replace(/width="14" height="14"/, 'width="19" height="19"'), label: 'Auto detect', on: !cur, pick: () => change({ spokenLanguage: null }) }
        : { flag: '<span class="cc">CC</span>', label: 'No translation', on: !cur, pick: () => change({ translateTo: null }) },
      ...pool.map((l) => ({ flag: esc(l.flag ?? ''), label: l.name, native: l.native, on: cur === l.code, pick: () => change(spoken ? { spokenLanguage: l.code } : { translateTo: l.code }) })),
    ];
    const fill = () => {
      body.textContent = '';
      const q = query.trim().toLowerCase();
      const shown = q ? rows.filter((r) => `${r.label} ${r.native ?? ''}`.toLowerCase().includes(q)) : rows;
      for (const r of shown) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'row';
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(r.on));
        b.innerHTML = `<span class="row__flag">${r.flag}</span><span class="row__main"><span class="row__label"></span>${r.native ? '<span class="row__native"></span>' : ''}</span><span class="row__check">${r.on ? CHECK : ''}</span>`;
        b.querySelector('.row__label')!.textContent = r.label;
        if (r.native) b.querySelector('.row__native')!.textContent = r.native;
        b.onclick = r.pick;
        body.appendChild(b);
      }
      if (!shown.length) { const n = document.createElement('div'); n.className = 'more'; n.textContent = `No match for “${query.trim()}”`; body.appendChild(n); }
    };
    fill();
    scrim.appendChild(sheet);
    root.appendChild(scrim);
    if (typing || !query) input.focus();
    body.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  /** The header: state, the session's languages, where it comes from. */
  function renderHead() {
    if (!win) return;
    const pill = win.querySelector<HTMLElement>('.pill')!;
    const langsEl = win.querySelector<HTMLElement>('.langs')!;
    const langBtn = win.querySelector<HTMLElement>('[data-menu="lang"]')!;
    const trBtn = win.querySelector<HTMLElement>('[data-menu="tr"]')!;
    const live = !cues && !!status;
    pill.hidden = langsEl.hidden = !live;
    if (live) {
      const st = status!.state;
      pill.className = `pill${st === 'paused' ? ' pill--paused' : st === 'live' ? '' : ' pill--wait'}`;
      pill.innerHTML = `<i></i>${st === 'paused' ? 'PAUSED' : st === 'live' ? 'LIVE' : st === 'stopping' ? 'STOPPING' : 'STARTING'}`;
      const chev = `<span class="chev">${CHEVRON}</span>`;
      const label = (code: string | null, none: string) => {
        const l = langOf(code);
        return code ? `<span class="flag">${esc(l?.flag ?? '')}</span><span class="name">${esc(l?.name ?? code.toUpperCase())}</span>` : `${LANG}<span class="name">${none}</span>`;
      };
      langBtn.innerHTML = label(status!.spokenLanguage, 'Auto') + chev;
      const langTip = `Spoken language: ${status!.spokenLanguage ? (langOf(status!.spokenLanguage)?.name ?? status!.spokenLanguage) : 'auto detect'}`;
      langBtn.title = langTip;
      langBtn.setAttribute('aria-label', langTip);
      trBtn.innerHTML = label(status!.translateTo, 'No translation') + chev;
      const trTip = status!.translateTo ? `Translating into ${langOf(status!.translateTo)?.name ?? status!.translateTo}` : 'No translation';
      trBtn.title = trTip;
      trBtn.setAttribute('aria-label', trTip);
    }
    win.querySelector<HTMLElement>('.buf')!.hidden = !buffering();
  }

  /** Lines shown: the one being said and, dimmed, the ones before it: one
   *  at the window's own height, as many as fit once the person sets it
   *  (render drops those that don't). */
  const depth = () => (geo?.th != null ? KEEP_SHOWN : 2);

  function shown(): Shown[] {
    if (cues) {
      if (cue < 0) return [];
      return cues.slice(Math.max(0, cue - depth() + 1), cue + 1).map((c, i, all) => ({ key: `q${c.s}`, who: '', color: '', text: c.t,
        ...(i === all.length - 1 ? { said: reached({ key: '', s: c.s, e: c.e, text: c.t, speaker: '', words: c.w, translated: c.tr }) } : {}) }));
    }
    const names: Record<string, string> = { ...Object.fromEntries(Object.entries(voiced).filter(([, v]) => v)), ...Object.fromEntries(Object.entries(typed).filter(([, v]) => v)) };
    const labels = status?.speakerLabels ?? 'auto';
    const voices = new Set((status?.ahead ? timed : lines).map((l) => l.speaker));
    const show = labels === 'on' || (labels !== 'off' && voices.size > 1) || (labels !== 'off' && Object.keys(names).length > 0);
    const tag = (sp: string) => ({ who: show ? names[sp] || `Speaker ${Number(sp) + 1}` : '', color: LANES[(Number(sp) || 0) % LANES.length]! });
    if (status?.ahead) return due().map((u, i, all) => ({ key: u.key, ...tag(u.speaker), text: u.text, ...(i === all.length - 1 ? { said: reached(u) } : {}) }));
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
    return items.slice(-depth());
  }

  /** Read ahead: the units of this video, in time order: the API's
   *  sentences (in the reading language, their translation), timed by the
   *  lines they group; a line no sentence holds yet shows alone. */
  function units(): Unit[] {
    const vid = videoIdOf(location.href);
    const mine = timed.filter((l) => !l.vid || l.vid === vid);
    const bySeq = new Map(mine.map((l) => [l.seq, l]));
    const covered = new Set<number>();
    const out: Unit[] = [];
    const group = (key: string, seqs: number[], text: string, translated: boolean) => {
      const ls = seqs.map((q) => bySeq.get(q)).filter((l): l is Timed => !!l).sort((a, b) => a.seq - b.seq);
      if (!ls.length || ls.some((l) => covered.has(l.seq))) return;
      for (const l of ls) covered.add(l.seq);
      out.push({ key, s: Math.min(...ls.map((l) => l.s)), e: Math.max(...ls.map((l) => l.e)), text, speaker: ls[0]!.speaker, words: ls.flatMap((l) => l.words ?? []), translated });
    };
    if (status?.translateTo) for (const [key, tr] of timedTr) group(`t${key}`, tr.seqs, tr.text, true);
    for (const [id, st] of timedSent) group(`s${id}`, st.seqs, st.text, false);
    for (const l of mine) if (!covered.has(l.seq)) out.push({ key: `c${l.seq}`, s: l.s, e: l.e, text: l.text, speaker: l.speaker, words: l.words });
    return out.sort((a, b) => a.s - b.s);
  }

  /** Read ahead: what the video has reached. The unit under its clock
   *  (until HOLD_S after it ends) and the one before, if just said. */
  function due(): Unit[] {
    const v = mainVideo();
    if (!v) return [];
    const t = v.currentTime;
    const all = units();
    let i = -1;
    for (let k = 0; k < all.length; k++) { if (all[k]!.s > t) break; i = k; }
    const cur = all[i];
    if (!cur) return [];
    // Set taller by the person: what has been said so far, as fits.
    if (depth() > 2) return all.slice(Math.max(0, i - depth() + 1), i + 1);
    if (t > cur.e + HOLD_S) return [];
    const prev = all[i - 1];
    return prev && cur.s - prev.e < HOLD_S ? [prev, cur] : [cur];
  }

  /** A unit as far as the video has reached: up to its last word begun. */
  /** How much of a unit has been said: up to the end of its last word
   *  begun, as a length of its text. A translation (or a text worded
   *  otherwise than its words) goes by the share of words begun, to the
   *  end of a word. */
  function reached(u: Unit): number {
    const t = mainVideo()?.currentTime ?? Infinity;
    const ws = u.words ?? [];
    if (!ws.length) return u.text.length;
    if (!u.translated) {
      let end = 0;
      let from = 0;
      let matched = true;
      for (const [i, w] of ws.entries()) {
        const word = w.t.trim();
        const at = u.text.indexOf(word, from);
        if (at < 0) { matched = false; break; }
        from = at + word.length;
        if (w.s > t) return i ? end : from;
        end = from;
      }
      if (matched) return u.text.length;
    }
    const begun = ws.filter((w) => w.s <= t).length;
    if (begun >= ws.length) return u.text.length;
    const cut = Math.ceil((u.text.length * Math.max(begun, 1)) / ws.length);
    // To the end of that word; a text written without spaces, as it is.
    if (!/\s/.test(u.text)) return cut;
    const space = u.text.slice(cut).search(/\s/);
    return space < 0 ? u.text.length : cut + space;
  }

  /** Read ahead and live: the transcript is under a second ahead of the
   *  video, so the captions may not keep up. */
  function buffering(): boolean {
    return !!status?.ahead && status.state === 'live' && !cues && (lead === null || lead < 1);
  }

  /** Read ahead: draw again when what is due changes. */
  function tickAhead() {
    const sig = `${buffering()}|${shown().map((x) => `${x.key}:${x.said ?? ''}:${x.text}`).join('|')}`;
    if (sig !== aheadShown) { aheadShown = sig; render(); }
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
      w.textContent = cues ? '' : status?.state === 'paused' ? 'Paused.' : status && status.state !== 'live' ? 'Getting ready…' : status?.ahead ? (timed.length ? '' : 'Reading ahead…') : 'Listening…';
      inner.appendChild(w);
    }
    items.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = `ln${i < items.length - 1 ? ' ln--prev' : ''}`;
      d.dataset.k = it.key;
      if (it.who) { const b = document.createElement('b'); b.style.color = it.color; b.textContent = it.who; d.appendChild(b); }
      if (it.said === undefined || it.said >= it.text.length) d.appendChild(document.createTextNode(it.text));
      else {
        // Read ahead: the whole line, greyed past what has been said.
        const todo = document.createElement('span');
        todo.className = 'todo';
        todo.textContent = it.text.slice(it.said);
        d.append(document.createTextNode(it.text.slice(0, it.said)), todo);
      }
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
    // The text's height follows its lines, unless the person set it: then
    // the oldest lines that don't fit go.
    if (geo?.th != null) {
      txt.style.transition = 'none';
      txt.style.height = `${geo.th}px`;
      while (inner.children.length > 1 && inner.offsetHeight > geo.th) inner.firstElementChild!.remove();
    }
    else {
      const h = inner.offsetHeight;
      txt.style.transition = txt.style.height ? `height .4s ${EASE}` : 'none';
      txt.style.height = `${h}px`;
    }
    shownKeys = [...inner.querySelectorAll<HTMLElement>('[data-k]')].map((el) => el.dataset.k!);
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
    } else tickAhead();
  }

  document.addEventListener(AHEAD_LEAD, (e) => { lead = (e as CustomEvent<number | null>).detail; });

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
      cueTimer = window.setInterval(follow, 100);
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
      if (status.ahead && !aheadTimer) aheadTimer = window.setInterval(tickAhead, 100);
      if (!was || was.state !== status.state || was.translateTo !== status.translateTo || was.spokenLanguage !== status.spokenLanguage || was.speakerLabels !== status.speakerLabels || was.host !== status.host) {
        render();
        if (menu) renderMenu();
      }
      return false;
    }
    if (msg?.caption === undefined) return false;
    if (msg.caption === 'off') { if (msg.id === sessionId) unmount(); return false; }
    const ev = msg.caption as LiveEvent;
    if (status?.ahead && ev.type === 'sentence') {
      if (ev.dropped) timedSent.delete(ev.sentenceId);
      else timedSent.set(ev.sentenceId, { seqs: ev.seqs, text: ev.text, speaker: ev.speaker });
      if (timedSent.size > KEEP_TIMED) timedSent.delete(timedSent.keys().next().value!);
      return false;
    }
    if (status?.ahead && (ev.type === 'committed' || ev.type === 'translated')) {
      // Kept until the video gets there (tickAhead draws it then).
      if (ev.type === 'committed') timed = [...timed.filter((x) => x.seq !== ev.seq), { seq: ev.seq, s: ev.startS, e: ev.endS, text: ev.text, speaker: ev.speaker ?? '0', vid: ev.vid, words: ev.words }].sort((a, b) => a.s - b.s).slice(-KEEP_TIMED);
      else {
        timedTr.set(ev.sentenceId ?? -1 - ev.seq, { seqs: ev.seqs ?? [ev.seq], text: ev.text });
        if (timedTr.size > KEEP_TIMED) timedTr.delete(timedTr.keys().next().value!);
      }
      return false;
    }
    if (ev.type === 'committed') {
      // A line sent again (a subscription reopened) replaces itself.
      lines = [...lines.filter((x) => x.seq !== ev.seq), { seq: ev.seq, text: ev.text, speaker: ev.speaker ?? '0' }].sort((a, b) => a.seq - b.seq).slice(-KEEP_SHOWN);
      draft = draftTr = '';
    } else if (ev.type === 'draft') draft = ev.text;
    else if (ev.type === 'draftTranslated') { trLang = ev.lang; draftTr = ev.text; }
    else if (ev.type === 'translated') {
      trLang = ev.lang;
      const key = ev.sentenceId ?? -1 - ev.seq;
      said = [...said.filter((x) => x.key !== key), { key, seq: ev.seq, tr: ev.text }].sort((a, b) => a.seq - b.seq).slice(-KEEP_SHOWN);
      draftTr = '';
    } else if (ev.type === 'speaker') (ev.by === 'person' ? typed : voiced)[ev.speaker] = ev.name;
    render();
    return false;
  });
}
