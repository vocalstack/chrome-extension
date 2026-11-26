/** A video's own title, where the page gives one, in place of the tab's:
 *  what the player says is playing, then the page's video data and its
 *  share title, then the tab's title without the site's name around it. */

const SEP = /\s+(?:[-|·•—–»]|::)\s+/g;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const tidy = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** The names a site goes by: the ones its page gives, and its address's
 *  (youtube.com: "youtube", "youtubecom"). */
function siteKeys(url: string | undefined, siteNames: readonly string[] = []): Set<string> {
  const keys = new Set(siteNames.map(norm).filter(Boolean));
  try {
    const host = new URL(url ?? '').hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
    const labels = host.split('.');
    keys.add(norm(host));
    for (const l of labels.slice(0, -1)) if (l.length > 2) keys.add(norm(l));
  } catch { /* no address: only the given names */ }
  return keys;
}

/** A title without the unread count in front ("(3) …") and without the
 *  site's name at either end ("… - YouTube", "Site | …"). */
export function cleanTitle(title: string | null | undefined, url?: string, siteNames: readonly string[] = []): string {
  const whole = tidy(title).replace(/^\(\d+\+?\)\s+/, '');
  if (!whole) return '';
  const keys = siteKeys(url, siteNames);
  const parts: string[] = [];
  const seps: string[] = [];
  let at = 0;
  for (const m of whole.matchAll(SEP)) {
    parts.push(whole.slice(at, m.index));
    seps.push(m[0]);
    at = m.index + m[0].length;
  }
  parts.push(whole.slice(at));
  let from = 0;
  let to = parts.length;
  while (to - from > 1 && keys.has(norm(parts[to - 1] ?? ''))) to--;
  while (to - from > 1 && keys.has(norm(parts[from] ?? ''))) from++;
  let out = parts[from] ?? '';
  for (let i = from + 1; i < to; i++) out += (seps[i - 1] ?? ' ') + (parts[i] ?? '');
  return out.trim() || whole;
}

/** A stand-in where a player has no title of its own ("YouTube video
 *  player", "Vimeo player"): any real title is better. */
export function placeholderTitle(title: string | null | undefined): boolean {
  const t = tidy(title);
  return !t || /^(?:[\w.-]+ )?(?:video |audio |media )?player$/i.test(t);
}

/** Of two titles for one thing, the one that says more. */
export function betterTitle(a: string | undefined, b: string | undefined): string | undefined {
  if (a && !placeholderTitle(a)) return a;
  if (b && !placeholderTitle(b)) return b;
  return a ?? b;
}

export interface TitleFacts {
  /** The page's address now. */
  url: string;
  /** `document.title`. */
  docTitle: string;
  /** What the player says is playing (Media Session). */
  playing?: string | null;
  /** The page's video data names (JSON-LD VideoObject and the like). */
  dataTitles?: readonly string[];
  /** og:title, twitter:title. */
  metaTitles?: readonly string[];
  /** og:site_name, application-name. */
  siteNames?: readonly string[];
  /** The address the page's data is about: canonical, og:url. */
  canonical?: readonly string[];
}

/** Does the page's data speak of this address? A site that changes pages
 *  without loading (YouTube) keeps the first page's data: then it is the
 *  last video's, and not used. */
function aboutThisPage(url: string, canonical: readonly string[]): boolean {
  let here: URL;
  try { here = new URL(url); } catch { return false; }
  const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
  const pathOf = (u: URL) => u.pathname.replace(/\/+$/, '');
  return canonical.some((c) => {
    try {
      const u = new URL(c, here);
      if (hostOf(u) !== hostOf(here) || pathOf(u) !== pathOf(here)) return false;
      for (const [k, v] of u.searchParams) if (here.searchParams.get(k) !== v) return false;
      return true;
    } catch {
      return false;
    }
  });
}

/** The best title the page gives for what it plays. */
export function pickTitle(f: TitleFacts): string {
  const sites = f.siteNames ?? [];
  const keys = siteKeys(f.url, sites);
  const clean = (t: string | null | undefined) => cleanTitle(t, f.url, sites);
  /** A title that is only the site's name says nothing. */
  const says = (t: string) => !!t && !keys.has(norm(t)) && !placeholderTitle(t);
  const fromTab = clean(f.docTitle);

  const playing = clean(f.playing);
  if (says(playing)) return playing.slice(0, 200);

  const fresh = aboutThisPage(f.url, f.canonical ?? []);
  const tabKey = norm(f.docTitle);
  // One video's data only: a page listing several names none of them.
  const data = (f.dataTitles ?? []).map(clean).filter(says);
  const given = [...(new Set(data).size === 1 ? data.slice(0, 1) : []), ...(f.metaTitles ?? []).map(clean).filter(says)];
  for (const t of given) {
    // The page's now (its data is about this address), or the tab's title
    // says the same and more.
    if (fresh || (norm(t).length > 3 && tabKey.includes(norm(t)))) return t.slice(0, 200);
  }
  return fromTab.slice(0, 200);
}

const VIDEO_TYPES = /^(?:VideoObject|AudioObject|Clip|Movie|TVEpisode|PodcastEpisode|RadioEpisode|Episode|MusicRecording|BroadcastEvent)$/;

function dataNames(node: unknown, out: string[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 6 || out.length > 20) return;
  if (Array.isArray(node)) { for (const n of node) dataNames(n, out, depth + 1); return; }
  const o = node as Record<string, unknown>;
  const types = Array.isArray(o['@type']) ? o['@type'] : [o['@type']];
  if (types.some((t) => typeof t === 'string' && VIDEO_TYPES.test(t))) {
    const name = typeof o.name === 'string' ? o.name : typeof o.headline === 'string' ? o.headline : '';
    if (name.trim()) out.push(name);
    return;
  }
  for (const k of ['@graph', 'mainEntity', 'video', 'audio', 'subjectOf', 'itemListElement', 'item']) if (k in o) dataNames(o[k], out, depth + 1);
}

/** What a document says of itself. Runs in the content script. */
export function titleFacts(doc: Document = document): TitleFacts {
  const meta = (sel: string) => Array.from(doc.querySelectorAll<HTMLMetaElement>(sel)).map((m) => tidy(m.content)).filter(Boolean);
  const dataTitles: string[] = [];
  doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]').forEach((s) => {
    const text = s.textContent ?? '';
    if (!text || text.length > 300_000) return;
    try { dataNames(JSON.parse(text), dataTitles); } catch { /* not JSON: nothing from it */ }
  });
  let playing: string | null = null;
  try { playing = navigator.mediaSession?.metadata?.title ?? null; } catch { /* not readable here */ }
  const canonical = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="canonical"]')).map((l) => l.href).filter(Boolean);
  return {
    url: doc.location?.href ?? '',
    docTitle: doc.title,
    playing,
    dataTitles,
    metaTitles: [...meta('meta[property="og:title"]'), ...meta('meta[name="twitter:title"]')],
    siteNames: [...meta('meta[property="og:site_name"]'), ...meta('meta[name="application-name"]')],
    canonical: [...canonical, ...meta('meta[property="og:url"]')],
  };
}

/** The document's best title. Runs in the content script. */
export function readTitle(doc: Document = document): string {
  try { return pickTitle(titleFacts(doc)); } catch { return cleanTitle(doc.title, doc.location?.href); }
}
