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
  /** Not this address: why, in plain words, the recordings found on it (a
   *  web page's), and the server's reason, for the advice this extension
   *  gives (`advised`). */
  | { go: false; problem: string; media: { url: string; title?: string | null }[]; reason?: Reason };

/** Why the server refused a link (the probe's `reason`, read as optional
 *  until @vocalstack/contract has it). Its sentence says what is wrong;
 *  each client says what to do. */
export type Reason = 'web_page' | 'site_not_fetched' | 'meeting' | 'not_found' | 'unreachable' | 'forbidden' | 'not_media' | 'copy_protected' | 'too_long' | 'unknown';

/** What to do instead, in this extension: what plays in the tab can be
 *  recorded from it; a meeting from Now; nothing for a link that is broken
 *  or not media (the server's sentence says it). */
const NEXT: Partial<Record<Reason, string>> = {
  web_page: 'Live Transcription can record what plays on it.',
  site_not_fetched: 'Live Transcription can record it as it plays.',
  copy_protected: 'Live Transcription can record it as it plays.',
  forbidden: 'If it plays in this tab, Live Transcription can record it.',
  too_long: 'Live Transcription can record the part you need as it plays.',
  meeting: 'Record it with Record This Meeting on Now.',
};

/** The refusal in full: the server's sentence and, by its reason, what to
 *  do here. An answer without a reason (an older server): the Live hint,
 *  unless the sentence already says how to record. */
export function advised(c: { problem: string; reason?: Reason }): string {
  const next = c.reason ? NEXT[c.reason] : /record/i.test(c.problem) ? undefined : 'Live Transcription can still record it as it plays.';
  return next ? `${c.problem} ${next}` : c.problem;
}

export const CANT_FETCH = 'That link didn’t work. VocalStack can’t fetch a recording from it.';

/** The probe's answer, as what to do. An answer without `ok` (an API
 *  older than the check) can't say: the address is taken. */
export function verdictOf(p: LinkProbe): Checked {
  if (p.kind === 'live') return { go: true, live: true };
  if (p.ok ?? true) return { go: true, live: false };
  const media = p.media ?? [];
  const reason = (p as { reason?: Reason | null }).reason ?? undefined;
  const why = reason ? { reason } : {};
  if (media.length) return { go: false, problem: media.length === 1 ? 'This is a web page. One recording was found on it.' : `This is a web page. ${media.length} recordings were found on it.`, media, ...why };
  const said = p.problem?.trim();
  return { go: false, problem: said ? said[0]!.toUpperCase() + said.slice(1) : CANT_FETCH, media: [], ...why };
}

/** Checked once per address while the page (panel or worker) lives, as
 *  the dashboard keeps them: only answers that worked (a file, a live
 *  stream, a page's recordings). A refusal may pass (a link that didn't
 *  answer in time) and is asked again next time; meanwhile the one
 *  question is shared. */
const checks = new Map<string, Promise<LinkProbe>>();
export function probeOnce(vs: { transcriptions: { probe(url: string): Promise<LinkProbe> } }, url: string): Promise<LinkProbe> {
  let p = checks.get(url);
  if (!p) {
    p = vs.transcriptions.probe(url);
    p.then((r) => { if (!(r.ok || r.kind === 'live' || r.media?.length)) checks.delete(url); }, () => checks.delete(url));
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
