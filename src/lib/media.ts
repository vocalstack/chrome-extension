/** What a page plays or links to, found by the content script in every
 *  frame (`scanDocument`) and gathered by the background (`page.scan`). */

export type MediaKind = 'video' | 'audio' | 'embed' | 'link' | 'page';

export interface FoundMedia {
  /** What VocalStack is given: a file, an embed's page, or the page itself. */
  url: string;
  kind: MediaKind;
  title?: string;
  /** Seconds, when the element knows it. */
  durationS?: number;
  /** The element plays from a blob: or MediaSource stream, so it has no
   *  address of its own; the page's address stands in for it. */
  streamOnly?: boolean;
  playing?: boolean;
  /** The frame it was found in, when not the top one. */
  frameUrl?: string;
  /** 'ext' = the file extension says media; 'element' = a <video>/<audio>;
   *  'network' = a file the frame's player loaded; 'player' = a file
   *  written in an embedded player's page (lib/embedFiles.ts). */
  evidence?: 'element' | 'ext' | 'embed' | 'page' | 'network' | 'player';
}

const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm|mp4|m4v|mov|mkv|m3u8|mpd)(?:$|[?#])/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)(?:$|[?#])/i;
const MANIFEST = /\.(m3u8|mpd)(?:$|[?#])/i;
/** A piece of a stream, not the recording: HLS/DASH segments and init
 *  parts, byte ranges. */
const SEGMENT = /(?:^|[/_.-])(?:seg(?:ment)?|chunk|frag(?:ment)?|init|part)[-_]?\d*[^/]*$|[?&](?:range|bytes|byterange)=/i;
/** Ads and trackers: never what the person watches. */
const AD_HOST = /(?:^|\.)(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|imasdk\.googleapis\.com|adnxs\.com|moatads\.com|springserve\.com|spotxchange\.com|innovid\.com|teads\.tv)$/i;

/** An address worth handing over as a recording: media by its extension,
 *  not a segment, not an ad. */
export function isRecordingUrl(u: string): boolean {
  let x: URL;
  try { x = new URL(u); } catch { return false; }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
  if (AD_HOST.test(x.hostname) || /\/ads?\//i.test(x.pathname)) return false;
  return MEDIA_EXT.test(x.pathname) && !SEGMENT.test(x.pathname.split('/').pop() + x.search);
}

const kindOfUrl = (u: string): 'audio' | 'video' => (AUDIO_EXT.test(new URL(u).pathname) ? 'audio' : 'video');

/** The recordings a frame's players loaded (the browser's own list of
 *  the frame's requests): the playlist a player streams, or the file it
 *  plays. A playlist stands for the files around it (its parts). */
export function loadedMedia(urls: string[]): { url: string; kind: 'audio' | 'video' }[] {
  const ok = [...new Set(urls)].filter(isRecordingUrl);
  const manifests = ok.filter((u) => MANIFEST.test(new URL(u).pathname));
  // The first playlist asked for is the main one; the others are its variants.
  const keep = manifests.length ? manifests.slice(0, 1) : ok.slice(0, 3);
  return keep.map((url) => ({ url, kind: kindOfUrl(url) }));
}

/** Media types a player's data names its files by. */
const MEDIA_MARK = /"(?:ext|extension|format|container)"\s*:\s*"(mp4|m4v|webm|mov|mp3|m4a|aac|ogg|wav|flac|m3u8|mpd|hls)"|"(?:type|mimeType|mime_type|contentType|content_type)"\s*:\s*"((?:video|audio)\/[\w.+-]+|application\/(?:x-mpegurl|vnd\.apple\.mpegurl|dash\+xml))"/i;

/** The JSON object around `at`, its own keys only (nested objects
 *  dropped), or null past a few thousand characters. */
function objectAround(t: string, at: number): string | null {
  const LIMIT = 4000;
  let start = -1;
  for (let i = at, depth = 0; i >= Math.max(0, at - LIMIT); i--) {
    const c = t[i];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) { start = i; break; } depth--; }
  }
  if (start < 0) return null;
  let out = '';
  for (let i = start + 1, depth = 0; i < Math.min(t.length, start + LIMIT); i++) {
    const c = t[i];
    if (c === '{') depth++;
    else if (c === '}') { if (depth === 0) return out; depth--; }
    else if (depth === 0) out += c;
  }
  return null;
}

/** The recordings written in an embedded player's page: addresses with a
 *  media extension, and, in the player's data, an address whose object
 *  says it is media (`{"ext":"mp4","url":"…bin"}`). One recording each
 *  object; the lightest first (audio, then the smallest), as the server
 *  keeps (transcribe src/domain/page_media.rs `lighter`). */
export function mediaInPage(text: string, base: string): { url: string; kind: 'audio' | 'video' }[] {
  const t = text.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/&amp;/g, '&');
  const found: { url: string; kind: 'audio' | 'video'; size: number }[] = [];
  const add = (raw: string, kind?: 'audio' | 'video', size = Infinity) => {
    let url: string;
    try { url = new URL(raw, base).toString(); } catch { return; }
    if (found.some((f) => f.url === url)) return;
    found.push({ url, kind: kind ?? kindOfUrl(url), size });
  };
  // The player's data: each address's own object, when it names a media type.
  for (const m of t.matchAll(/"(?:url|src|href|file|contentUrl|content_url)"\s*:\s*"(https?:\/\/[^"\s]+)"/gi)) {
    const url = m[1]!;
    if (/\.(?:jpe?g|png|gif|webp|svg|vtt|srt|js|css)(?:$|[?#])/i.test(url)) continue;
    try { if (AD_HOST.test(new URL(url).hostname)) continue; } catch { continue; }
    const o = objectAround(t, m.index!);
    const mark = o?.match(MEDIA_MARK);
    if (!o || !mark) continue;
    const type = (mark[1] ?? mark[2] ?? '').toLowerCase();
    const size = Number(o.match(/"(?:size|bitrate|bandwidth|filesize)"\s*:\s*(\d+)/i)?.[1] ?? Infinity);
    add(url, /^(?:audio\/|mp3|m4a|aac|ogg|wav|flac)/.test(type) ? 'audio' : 'video', size);
  }
  // Plain addresses with a media extension.
  for (const m of t.matchAll(/https?:\/\/[^\s"'<>()\\]+/g)) if (isRecordingUrl(m[0])) add(m[0]);
  const manifest = (u: string) => MANIFEST.test(new URL(u).pathname);
  return found
    .sort((a, b) => Number(b.kind === 'audio') - Number(a.kind === 'audio') || Number(manifest(a.url)) - Number(manifest(b.url)) || a.size - b.size)
    .map(({ url, kind }) => ({ url, kind }));
}

/** Players whose embed or watch page VocalStack can fetch from its link. */
const EMBEDS: { re: RegExp; page: (m: RegExpMatchArray) => string; name: string }[] = [
  { re: /youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/i, page: (m) => `https://www.youtube.com/watch?v=${m[1]}`, name: 'YouTube' },
  { re: /player\.vimeo\.com\/video\/(\d+)/i, page: (m) => `https://vimeo.com/${m[1]}`, name: 'Vimeo' },
  { re: /w\.soundcloud\.com\/player\/\?url=([^&]+)/i, page: (m) => decodeURIComponent(m[1] ?? ''), name: 'SoundCloud' },
  { re: /open\.spotify\.com\/embed\/(episode|show)\/(\w+)/i, page: (m) => `https://open.spotify.com/${m[1]}/${m[2]}`, name: 'Spotify' },
  { re: /(?:www\.)?dailymotion\.com\/embed\/video\/(\w+)/i, page: (m) => `https://www.dailymotion.com/video/${m[1]}`, name: 'Dailymotion' },
  { re: /fast\.wistia\.(?:net|com)\/embed\/(?:iframe|medias)\/(\w+)/i, page: (m) => `https://fast.wistia.net/embed/iframe/${m[1]}`, name: 'Wistia' },
  { re: /(?:www\.)?loom\.com\/embed\/(\w+)/i, page: (m) => `https://www.loom.com/share/${m[1]}`, name: 'Loom' },
];

function abs(u: string | null | undefined, base: string): string | null {
  if (!u) return null;
  try {
    const x = new URL(u, base);
    return x.protocol === 'http:' || x.protocol === 'https:' || x.protocol === 'blob:' ? x.toString() : null;
  } catch {
    return null;
  }
}

function labelFor(el: Element): string | undefined {
  const t = el.getAttribute('title') || el.getAttribute('aria-label') || (el as HTMLElement).dataset?.title;
  if (t) return t.trim().slice(0, 140);
  const fig = el.closest('figure');
  const cap = fig?.querySelector('figcaption')?.textContent?.trim();
  return cap ? cap.slice(0, 140) : undefined;
}

/** Everything one document plays or links to. Runs in the content script. */
export function scanDocument(doc: Document = document): FoundMedia[] {
  const base = doc.baseURI;
  const top = window.top === window;
  const out: FoundMedia[] = [];
  const seen = new Set<string>();
  const add = (m: FoundMedia) => {
    const k = `${m.kind}:${m.url}`;
    if (seen.has(k)) return;
    seen.add(k);
    if (!top) m.frameUrl = location.href;
    out.push(m);
  };

  doc.querySelectorAll<HTMLMediaElement>('video, audio').forEach((el) => {
    const kind = el.tagName === 'VIDEO' ? 'video' : 'audio';
    const sources = [el.currentSrc, el.src, ...Array.from(el.querySelectorAll('source')).map((s) => s.src)].map((u) => abs(u, base)).filter(Boolean) as string[];
    const direct = sources.find((u) => !u.startsWith('blob:'));
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined;
    // A tiny muted autoplaying loop is decoration, not content.
    if (kind === 'video' && el.muted && el.loop && (duration ?? 0) < 30) return;
    if (direct) {
      add({ url: direct, kind, title: labelFor(el), durationS: duration, playing: !el.paused, evidence: 'element' });
    } else if (sources.length || el.readyState > 0) {
      add({ url: location.href, kind, title: labelFor(el) ?? doc.title, durationS: duration, playing: !el.paused, streamOnly: true, evidence: 'element' });
    }
  });

  doc.querySelectorAll<HTMLIFrameElement>('iframe[src]').forEach((f) => {
    const src = abs(f.getAttribute('src'), base);
    if (!src) return;
    for (const e of EMBEDS) {
      const m = src.match(e.re);
      if (m) {
        add({ url: e.page(m), kind: 'embed', title: f.title || `${e.name} player`, evidence: 'embed' });
        break;
      }
    }
  });

  doc.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = abs(a.getAttribute('href'), base);
    if (!href || href.startsWith('blob:') || !MEDIA_EXT.test(new URL(href).pathname + new URL(href).search)) return;
    const text = (a.textContent ?? '').trim().replace(/\s+/g, ' ');
    add({ url: href, kind: 'link', title: text.slice(0, 140) || decodeURIComponent(new URL(href).pathname.split('/').pop() ?? ''), evidence: 'ext' });
  });

  // What this frame's player loaded: the file or playlist behind a
  // stream-only <video> (a blob: player), when it has played. Only where
  // something here plays: not a page's preloads.
  const player = Array.from(doc.querySelectorAll<HTMLMediaElement>('video, audio')).find((el) => !(el.muted && el.loop) && (el.readyState > 0 || !!el.currentSrc));
  if (player && typeof performance !== 'undefined') {
    const loaded = loadedMedia(performance.getEntriesByType('resource').map((e) => e.name));
    for (const m of loaded) {
      const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : undefined;
      add({ url: m.url, kind: m.kind, title: labelFor(player) ?? doc.title, durationS: duration, playing: !player.paused, evidence: 'network' });
    }
  }

  return out;
}

/** The scan's own words for a kind. */
export const KIND_LABEL: Record<MediaKind, string> = {
  video: 'Video',
  audio: 'Audio',
  embed: 'Embedded player',
  link: 'Media link',
  page: 'This page',
};

/** Pages that are one recording: probing them is a plain check, not a
 *  search of the page (which the server counts by the hour). */
export const MEDIA_PAGE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch|live|shorts)|youtu\.be\/|vimeo\.com\/\d|soundcloud\.com\/[^/]+\/[^/]+|open\.spotify\.com\/(?:episode|show)\/|dailymotion\.com\/video\/|twitch\.tv\/|kick\.com\/|loom\.com\/share\/)/i;
