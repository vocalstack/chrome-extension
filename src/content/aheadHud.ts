/** Read-ahead debug (Settings): a small panel on the page, top left, of
 *  how far ahead of the video each stage is (content/ahead.ts fills it).
 *  In a closed shadow root in the top layer, like the captions, so the
 *  page's styles cannot reach it and it shows over full-screen video. */

export interface HudRow { k: string; v: string; tone?: 'good' | 'bad' }

const CSS = `
:host{all:initial}
.hud{position:fixed;top:12px;left:12px;width:330px;padding:10px 12px;border-radius:10px;background:#0b0c1a;box-shadow:0 0 0 1px rgba(255,255,255,.14),0 10px 30px rgba(0,0,0,.5);color:#eaecfa;font:500 11.5px/1.55 ui-monospace,"SF Mono",Menlo,monospace;pointer-events:none}
.t{margin-bottom:6px;font-weight:700;letter-spacing:.08em;color:#55abe5}
.r{display:flex;justify-content:space-between;gap:12px}
.k{color:#848eae;white-space:nowrap}
.v{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.good{color:#7fd6b4}.bad{color:#f78472}
`;

export function makeHud() {
  let host: HTMLElement | null = null;
  let body: HTMLElement | null = null;

  function mount() {
    host = document.createElement('vocalstack-ahead-debug');
    host.setAttribute('popover', 'manual');
    host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style><div class="hud"></div>`;
    body = root.querySelector('.hud');
    document.documentElement.appendChild(host);
    onTop();
    document.addEventListener('fullscreenchange', later);
  }
  const later = () => setTimeout(onTop, 50);
  function onTop() {
    try { if (host?.matches(':popover-open')) host.hidePopover(); host?.showPopover(); } catch { /* stays a fixed element */ }
  }

  return {
    show(title: string, rows: HudRow[]) {
      if (!host) mount();
      const row = (r: HudRow) => {
        const d = document.createElement('div');
        d.className = 'r';
        const k = document.createElement('span'); k.className = 'k'; k.textContent = r.k;
        const v = document.createElement('span'); v.className = `v${r.tone ? ` ${r.tone}` : ''}`; v.textContent = r.v;
        d.append(k, v);
        return d;
      };
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = title;
      body!.replaceChildren(t, ...rows.map(row));
    },
    hide() {
      document.removeEventListener('fullscreenchange', later);
      host?.remove();
      host = body = null;
    },
  };
}
