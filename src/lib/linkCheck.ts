/** A web address checked before anything is made from it, as the
 *  dashboard's From URL form does (transcribe app/src/screens/
 *  Transcriptions.tsx `validate`): the server's `transcriptions.probe`
 *  says whether it opens as a recording, whether it is live, and, for a
 *  web page, which recordings are on it. A page is never sent as if it
 *  were a file: that job could only fail. */

import type { LinkProbe } from '@vocalstack/contract';

/** What to do with an address. */
export type Checked =
  /** Transcribe it: a file the server fetches, or a live stream it records. */
  | { go: true; live: boolean }
  /** Not this address: why, in plain words, the recordings found on it
   *  (a web page's), and the site when the server never fetches from it. */
  | { go: false; problem: string; media: { url: string; title?: string | null }[]; site?: Site };

/** A site the server never fetches from (a video site's page, a meeting):
 *  the probe's `site`, read as optional until the contract has it. */
export interface Site { name: string; meeting?: boolean }

export const CANT_FETCH = 'That link didn’t work. VocalStack can’t fetch a recording from it.';

/** The probe's answer, as what to do. An answer without `ok` (an API
 *  older than the check) can't say: the address is taken. */
export function verdictOf(p: LinkProbe): Checked {
  if (p.kind === 'live') return { go: true, live: true };
  if (p.ok ?? true) return { go: true, live: false };
  const media = p.media ?? [];
  if (media.length) return { go: false, problem: media.length === 1 ? 'This is a web page. One recording was found on it.' : `This is a web page. ${media.length} recordings were found on it.`, media };
  const said = p.problem?.trim();
  const site = (p as { site?: Site | null }).site ?? undefined;
  return { go: false, problem: said ? said[0]!.toUpperCase() + said.slice(1) : CANT_FETCH, media: [], ...(site ? { site } : {}) };
}

/** Checked once per address while the page (panel or worker) lives; a
 *  failed check is asked again next time. */
const checks = new Map<string, Promise<LinkProbe>>();
export function probeOnce(vs: { transcriptions: { probe(url: string): Promise<LinkProbe> } }, url: string): Promise<LinkProbe> {
  let p = checks.get(url);
  if (!p) {
    p = vs.transcriptions.probe(url);
    p.catch(() => checks.delete(url));
    checks.set(url, p);
  }
  return p;
}

/** API answers that refuse the address itself (one that can't be
 *  checked, past the limit of checks): thrown, worded where they show. */
const REFUSED = new Set(['invalid_options', 'rate_limited']);

/** Check an address. No answer at all (the network, an API without the
 *  check): taken as it is, as the dashboard does. */
export async function checkLink(vs: Parameters<typeof probeOnce>[0], url: string): Promise<Checked> {
  let p: LinkProbe;
  try {
    p = await probeOnce(vs, url);
  } catch (e) {
    if (REFUSED.has((e as { code?: string } | null)?.code ?? '')) throw e;
    return { go: true, live: false };
  }
  return verdictOf(p);
}
