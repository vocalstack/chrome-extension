/** Error tracking (Sentry), in the background worker, the audio page and
 *  the panel. It reports the extension's own faults only: an exception,
 *  a capture or audio-page failure, a state that should not happen. An
 *  API answer is never reported (a 4xx is the person's, and the API
 *  reports its own 5xx with the request id), nor a network failure.
 *
 *  It uses the web app's Sentry project (`web`; the DSN is public, it
 *  ships in app.vocalstack.com's bundle too), tagged `app: extension`,
 *  with the environment the extension talks to (production or e2e). A
 *  dev build (`wxt`), the local environment and a browser driven by tests
 *  (`navigator.webdriver`) never report.
 *
 *  A client of its own, not `Sentry.init`: an extension shares no globals
 *  with the pages it runs beside, and has no use for the default
 *  integrations. Nothing a person said or typed leaves: no breadcrumbs,
 *  no request data, URLs without their query strings, and keys, tokens
 *  and addresses replaced. */

import { BrowserClient, Scope, defaultStackParser, dedupeIntegration, linkedErrorsIntegration, makeFetchTransport } from '@sentry/browser';
import { currentEnv } from './env';
import { isFault } from './errors';

const DSN = 'https://d2bad28df6506ee82a25bce3845db09a@o4512244247035904.ingest.de.sentry.io/4512244284260433';

const SECRET = /\b(?:vs_(?:key|kt|bt|rtmp|refresh)_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_QUERY = /(\bhttps?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g;

/** A string with keys, tokens, addresses and URL query strings removed. */
export function scrub(s: string): string {
  return s.replace(URL_QUERY, '$1').replace(SECRET, '[secret]').replace(EMAIL, '[email]');
}

/** Which part of the extension reports: background, offscreen, panel. */
let part = 'unknown';
let scope: Promise<Scope | null> | null = null;

function client(): Promise<Scope | null> {
  scope ??= (async () => {
    if (import.meta.env.DEV) return null;
    if (typeof navigator !== 'undefined' && navigator.webdriver) return null;
    const env = await currentEnv().catch(() => null);
    if (!env || env.name === 'local') return null;
    const c = new BrowserClient({
      dsn: DSN,
      environment: env.name,
      release: `vocalstack-extension@${chrome.runtime.getManifest().version}`,
      transport: makeFetchTransport,
      stackParser: defaultStackParser,
      integrations: [dedupeIntegration(), linkedErrorsIntegration()],
      maxBreadcrumbs: 0,
      // No user fields, and no IP address inferred from the request.
      dataCollection: { userInfo: false },
      beforeSend(event) {
        delete event.request;
        delete event.user;
        if (event.message) event.message = scrub(event.message);
        for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrub(ex.value);
        for (const ex of event.exception?.values ?? []) for (const f of ex.stacktrace?.frames ?? []) if (f.filename) f.filename = scrub(f.filename);
        return event;
      },
    });
    const s = new Scope();
    s.setClient(c);
    c.init();
    s.setTags({ app: 'extension', part, browser: import.meta.env.BROWSER ?? 'chrome' });
    return s;
  })();
  return scope;
}

/** Report a fault (only that: an API answer, a network failure and the
 *  extension's own worded errors are left out). `what` names the case,
 *  for grouping: 'rpc auth.connect', 'capture tab', … */
export function report(e: unknown, what: string, extra?: Record<string, unknown>) {
  if (!isFault(e)) return;
  void client().then((s) => {
    if (!s) return;
    s.captureException(e instanceof Error ? e : new Error(scrub(String(e))), { captureContext: { tags: { what }, extra } });
  }).catch(() => {});
}

/** Report a state that should not happen, which threw nothing. */
export function reportState(message: string, what: string, extra?: Record<string, unknown>) {
  void client().then((s) => s?.captureMessage(scrub(message), 'warning', { captureContext: { tags: { what }, extra } })).catch(() => {});
}

/** Report this part's uncaught exceptions and unhandled rejections. */
export function initSentry(name: 'background' | 'offscreen' | 'panel') {
  part = name;
  self.addEventListener('error', (ev) => report((ev as ErrorEvent).error ?? (ev as ErrorEvent).message, 'uncaught'));
  self.addEventListener('unhandledrejection', (ev) => report((ev as PromiseRejectionEvent).reason, 'unhandled rejection'));
}
