/** An embedded player's recording, found by the browser alone: its page
 *  is fetched from here (the extension may read any site) and read for
 *  the files it plays (lib/media.ts `mediaInPage`). Nothing is asked of
 *  VocalStack's server, which searches a page only when the person asks
 *  (Find recordings), its searches counted by the hour. */

import { mediaInPage, type FoundMedia } from './media';

/** The page read, at most (a player's page is small; its data near the top). */
const PAGE_BYTES = 512 * 1024;
const WAIT_MS = 6000;

/** Read once per player while this page (panel, worker) lives. */
const found = new Map<string, Promise<FoundMedia | null>>();

export function playerFile(embedUrl: string, title?: string): Promise<FoundMedia | null> {
  let p = found.get(embedUrl);
  if (!p) {
    p = read(embedUrl, title);
    found.set(embedUrl, p);
  }
  return p;
}

async function read(embedUrl: string, title?: string): Promise<FoundMedia | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), WAIT_MS);
  try {
    // No cookies: what anyone (the server too) gets from the address.
    const r = await fetch(embedUrl, { signal: ctl.signal, credentials: 'omit', redirect: 'follow' });
    if (!r.ok || !/html|json|javascript|text/i.test(r.headers.get('content-type') ?? '')) return null;
    const text = (await r.text()).slice(0, PAGE_BYTES);
    const m = mediaInPage(text, r.url || embedUrl)[0];
    return m ? { url: m.url, kind: m.kind, title, evidence: 'player' } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
