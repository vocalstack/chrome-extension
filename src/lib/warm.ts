/** Instant start: while a screen that offers a live Start is open and in
 *  use, `POST /v1/realtime/warm` says so (canStart), and the platform
 *  keeps an engine loaded for the next Start. The ping starts and bills
 *  nothing; errors (an older API answers 404) are ignored.
 *
 *  This file is the timing alone, with no browser or extension calls, so
 *  the tests drive it with a fake clock (warm.test.ts). The panel's hook
 *  is ui/useWarm.ts. */

export interface WarmBody {
  clientKind: 'chrome_extension';
  canStart: boolean;
  /** Omitted for auto detect. */
  spokenLanguage?: string;
}

/** At most one canStart=true ping per this many ms (a language change aside). */
export const WARM_EVERY_MS = 30_000;

export function warmBody(canStart: boolean, spokenLanguage: string | null | undefined): WarmBody {
  return spokenLanguage ? { clientKind: 'chrome_extension', canStart, spokenLanguage } : { clientKind: 'chrome_extension', canStart };
}

/** One Start screen's pings. `offer` when it opens (or offers Start
 *  again), `used` on real input, focus or becoming visible, `language`
 *  when the spoken language changes, `withdraw` when it closes or a
 *  recording starts. */
export class Warmer {
  private lastTrue = -Infinity;
  /** A canStart=true went out since the last withdraw. */
  private warm = false;
  private offering = false;
  private lang: string | null = null;

  private readonly send: (b: WarmBody) => void;
  private readonly now: () => number;

  constructor(send: (b: WarmBody) => void, now: () => number = Date.now) {
    this.send = send;
    this.now = now;
  }

  private ping() {
    this.lastTrue = this.now();
    this.warm = true;
    this.send(warmBody(true, this.lang));
  }

  /** The screen offers Start; `visible`: its document is shown. */
  offer(lang: string | null, visible: boolean) {
    this.offering = true;
    this.lang = lang || null;
    if (visible) this.ping();
  }

  used() {
    if (this.offering && this.now() - this.lastTrue >= WARM_EVERY_MS) this.ping();
  }

  language(lang: string | null, visible: boolean) {
    const next = lang || null;
    if (next === this.lang) return;
    this.lang = next;
    if (this.offering && visible) this.ping();
  }

  withdraw() {
    if (!this.offering) return;
    this.offering = false;
    if (this.warm) this.send(warmBody(false, this.lang));
    this.warm = false;
    this.lastTrue = -Infinity;
  }
}
