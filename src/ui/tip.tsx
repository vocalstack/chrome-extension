/** The header's and tab strip's tooltips (design 3): a bold head and a
 *  lighter line, in a raised bubble with an arrow, under a header control
 *  or over a tab. `TipRow` holds them; `useTip()` gives a control its
 *  hover and keyboard-focus handlers. */

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Where the control is, in the row's coordinates. */
interface Tip { head: string; sub?: string; right: boolean; up: boolean; left: number; width: number; top: number; bottom: number }
type Show = (el: HTMLElement, head: string, sub: string | undefined, right: boolean, up: boolean) => void;
const Ctx = createContext<{ show: Show; hide: () => void } | null>(null);
const EDGE = 10;

export function TipRow({ children }: { children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  /** The bubble's left edge, kept inside the row once it is measured. */
  const [left, setLeft] = useState<number | null>(null);
  const show: Show = (el, head, sub, right, up) => {
    const r = row.current?.getBoundingClientRect();
    if (!r) return;
    const e = el.getBoundingClientRect();
    setLeft(null);
    setTip({ head, sub, right, up, left: e.left - r.left, width: e.width, top: e.top - r.top, bottom: e.bottom - r.top });
  };
  const hide = () => setTip(null);
  useLayoutEffect(() => {
    if (!tip || !bubble.current || !row.current) return;
    const w = bubble.current.offsetWidth;
    const rowW = row.current.offsetWidth;
    // Aligned with the control's left (or right) edge, then kept in the row.
    const want = tip.right ? tip.left + tip.width - w : tip.left;
    setLeft(Math.max(EDGE, Math.min(want, rowW - EDGE - w)));
  }, [tip]);
  const arrow = tip && left !== null ? Math.round(tip.left + tip.width / 2 - left - 5.5) : 0;
  return (
    <Ctx.Provider value={{ show, hide }}>
      <div className="tiprow" ref={row} onMouseLeave={hide}>
        {children}
        {tip && (
          <div ref={bubble} role="tooltip" className={`tip${tip.up ? ' tip--up' : ''}`}
            style={{ top: Math.round(tip.up ? tip.top - 7 : tip.bottom + 7), left: left ?? 0, visibility: left === null ? 'hidden' : undefined, textAlign: tip.right ? 'right' : 'left' }}>
            <span className="tip__arrow" style={{ left: arrow }} />
            <span className="tip__head">{tip.head}</span>
            {tip.sub && <><br /><span className="tip__sub">{tip.sub}</span></>}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

/** Hover and keyboard-focus handlers that show `head` (and `sub`) for a
 *  control: under it, or over it with `up`; text aligned right with
 *  `right`. A press hides it. */
export function useTip() {
  const c = useContext(Ctx);
  return (head: string, sub?: string, opts: { right?: boolean; up?: boolean } = {}) => {
    if (!c) return {};
    const on = (e: { currentTarget: HTMLElement }) => c.show(e.currentTarget, head, sub, !!opts.right, !!opts.up);
    // A click focuses the control too: only keyboard focus shows the tip.
    const focus = (e: { currentTarget: HTMLElement }) => { if (e.currentTarget.matches(':focus-visible')) on(e); };
    return { onMouseEnter: on, onFocus: focus, onBlur: c.hide, onMouseDown: c.hide };
  };
}
