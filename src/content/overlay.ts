/** Live captions over the page's video (or at the foot of the window
 *  when the frame has none). Lives in a closed shadow root so the page's
 *  styles cannot reach it; follows the video through scrolling, resizing
 *  and fullscreen. Fed by the background (`{caption}` messages). */

import type { LiveEvent } from '../lib/rpc';
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '../lib/live';
import { mainVideo, visibleArea } from './video';

interface Line { seq: number; text: string }
interface Said { key: number; seq: number; tr: string }

const CSS = `
:host{all:initial}
.wrap{position:fixed;z-index:2147483646;pointer-events:none;display:flex;justify-content:center;transition:opacity .2s}
.box{pointer-events:auto;max-width:min(92%,980px);background:rgba(10,12,32,.82);color:#fff;border-radius:10px;padding:8px 14px 9px;font:500 var(--fs)/1.38 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.35);position:relative;-webkit-font-smoothing:antialiased}
.orig{color:rgba(255,255,255,.62);font-size:.78em;font-weight:400}
.draft{color:rgba(255,255,255,.72)}
.x{position:absolute;top:-9px;right:-9px;width:20px;height:20px;border-radius:50%;border:0;background:#2a2a4a;color:#fff;font:600 12px/20px system-ui;cursor:pointer;opacity:0;transition:opacity .15s}
.box:hover .x{opacity:1}
.tag{position:absolute;top:-9px;left:10px;font:600 8.5px ui-monospace,Menlo,monospace;letter-spacing:.12em;background:#55abe5;color:#131326;border-radius:3px;padding:1px 5px}
.wait{color:rgba(255,255,255,.6);font-weight:400;font-size:.85em}
`;

const SIZES: Record<CaptionStyle['size'], [number, number]> = { s: [13, 18], m: [16, 24], l: [20, 30] };

export function startOverlay() {
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let sessionId: string | null = null;
  let lines: Line[] = [];
  /** Translations, newest last: a sentence's replaces any earlier version. */
  let said: Said[] = [];
  let draft = '';
  let draftTr = '';
  let lang: string | null = null;
  let style: CaptionStyle = DEFAULT_CAPTION_STYLE;
  let timer: number | undefined;

  chrome.storage.local.get('captionStyle').then((g) => { if (g.captionStyle) style = g.captionStyle as CaptionStyle; });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.captionStyle) { style = (c.captionStyle.newValue as CaptionStyle) ?? DEFAULT_CAPTION_STYLE; render(); }
  });

  const mount = () => {
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
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    root.appendChild(wrap);
    document.documentElement.appendChild(host);
    showOnTop();
    timer = window.setInterval(place, 250);
    document.addEventListener('fullscreenchange', reparent);
  };

  const unmount = () => {
    if (timer) clearInterval(timer);
    document.removeEventListener('fullscreenchange', reparent);
    host?.remove();
    host = root = null;
    sessionId = null;
    lines = [];
    said = [];
    draft = draftTr = '';
    lang = null;
  };

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

  function place() {
    const wrap = root?.querySelector<HTMLElement>('.wrap');
    if (!wrap) return;
    const v = mainVideo();
    const r = v?.getBoundingClientRect();
    const gap = 0.07;
    if (r && r.width > 0) {
      wrap.style.left = `${Math.max(0, r.left)}px`;
      wrap.style.width = `${Math.min(r.width, innerWidth)}px`;
      if (style.position === 'top') { wrap.style.top = `${Math.max(0, r.top) + r.height * gap}px`; wrap.style.bottom = ''; }
      else { wrap.style.bottom = `${Math.max(0, innerHeight - Math.min(r.bottom, innerHeight)) + r.height * gap}px`; wrap.style.top = ''; }
      const [lo, hi] = SIZES[style.size];
      wrap.style.setProperty('--fs', `${Math.round(Math.min(hi, Math.max(lo, r.width / 46)) * (style.size === 's' ? 0.9 : style.size === 'l' ? 1.15 : 1))}px`);
    } else {
      wrap.style.left = '0'; wrap.style.width = '100%';
      if (style.position === 'top') { wrap.style.top = '24px'; wrap.style.bottom = ''; } else { wrap.style.bottom = '28px'; wrap.style.top = ''; }
      wrap.style.setProperty('--fs', `${SIZES[style.size][0] + 3}px`);
    }
  }

  function render() {
    const wrap = root?.querySelector<HTMLElement>('.wrap');
    if (!wrap) return;
    wrap.textContent = '';
    const box = document.createElement('div');
    box.className = 'box';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = lang ? `VOCALSTACK · ${lang.toUpperCase()}` : 'VOCALSTACK';
    box.appendChild(tag);
    const x = document.createElement('button');
    x.className = 'x';
    x.title = 'Turn captions off';
    x.textContent = '×';
    x.onclick = () => { if (sessionId) void chrome.runtime.sendMessage({ rpc: 'live.stop', args: { id: sessionId } }); unmount(); };
    box.appendChild(x);
    const add = (text: string, cls?: string) => {
      const d = document.createElement('div');
      if (cls) d.className = cls;
      d.textContent = text;
      box.appendChild(d);
    };
    if (lang) {
      // Translated: the last two translated sentences, the newest original
      // line above them when asked, and the line being heard.
      // Two sentences, unless they would fill the picture.
      const two = said.slice(-2);
      const shown = two.reduce((n, x) => n + x.tr.length, 0) > 170 ? two.slice(-1) : two;
      const orig = lines[lines.length - 1];
      if (!shown.length && !draft && !draftTr) add('Listening…', 'wait');
      if (style.showOriginal && (draft || orig)) add(draft || orig!.text, 'orig');
      for (const x of shown) add(x.tr);
      if (draftTr) add(draftTr, 'draft');
    } else {
      // The last two finished lines and the line being heard.
      const shown = lines.slice(-2);
      if (!shown.length && !draft) add('Listening…', 'wait');
      for (const l of shown) add(l.text);
      if (draft) add(draft, 'draft');
    }
    wrap.appendChild(box);
    place();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (msg?.pick === true) {
      send({ area: visibleArea(mainVideo()) });
      return false;
    }
    if (msg?.caption === undefined) return false;
    if (msg.caption === 'off') { if (msg.id === sessionId) unmount(); return false; }
    const ev = msg.caption as LiveEvent;
    if (sessionId !== msg.id) { unmount(); sessionId = msg.id; }
    mount();
    if (ev.type === 'committed') {
      lines.push({ seq: ev.seq, text: ev.text });
      if (lines.length > 6) lines.shift();
      draft = draftTr = '';
    } else if (ev.type === 'draft') draft = ev.text;
    else if (ev.type === 'draftTranslated') { lang = ev.lang; draftTr = ev.text; }
    else if (ev.type === 'translated') {
      lang = ev.lang;
      const key = ev.sentenceId ?? -1 - ev.seq;
      said = [...said.filter((x) => x.key !== key), { key, seq: ev.seq, tr: ev.text }].sort((a, b) => a.seq - b.seq).slice(-6);
      draftTr = '';
    }
    render();
    return false;
  });
}
