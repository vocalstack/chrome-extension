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

/** A page's own sound effects (a call's join and leave chimes), never a recording. */
const UI_SOUND = /^https:\/\/(?:www\.|ssl\.)?gstatic\.com\/(?:meet|chat|hangouts)\/sounds?\//i;
export const isPageSound = (url: string) => UI_SOUND.test(url);
/** An <audio> shorter than this is a page sound (a chime, a click), not a recording. */
const MIN_AUDIO_S = 5;

/** An address worth handing over as a recording: media by its extension,
 *  not a segment, not an ad. */
export function isRecordingUrl(u: string): boolean {
  let x: URL;
  try { x = new URL(u); } catch { return false; }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
  if (AD_HOST.test(x.hostname) || /\/ads?\//i.test(x.pathname) || isPageSound(u)) return false;
  return MEDIA_EXT.test(x.pathname) && !SEGMENT.test(x.pathname.split('/').pop() + x.search);
}

/** Query names that make a media address work only for the viewer who
 *  loaded it (a CDN token, a signed policy): our server gets 403 there.
 *  S3, GCS and Azure presigned links are not among them: the server
 *  fetches those. */
const VIEWER_TOKEN = new Set([
  'hdnts', 'hdntl', 'hdnea', '__token__', '__gda__', 'token', 'tok', 'sig', 'signature', 'hmac', 'jwt', 'access_token', 'auth_token', 'authtoken',
  'bcdn_token', 'cdn_token', 'wowzatokenhash', 'wmsauthsign', 'bcov_auth', 'fastly_token', 'akamai_token', 'edgeauth', 'ks', 'cip', 'clientip',
]);
const EXPIRY = new Set(['e', 'exp', 'expires', 'expiry', 'expire', 'validto', 'ttl', 'nva']);
const SIGNED = new Set(['s', 'g', 'h', 'md5', 'hash', 'sig', 'signature', 'st', 'nvb']);
/** Presigned storage, made for anyone holding the link: fetched by the server. */
const PRESIGNED = new Set(['x-amz-signature', 'x-amz-credential', 'awsaccesskeyid', 'x-goog-signature', 'x-goog-credential', 'googleaccessid']);
/** File hosts the server fetches as the file itself (transcribe src/stream_source/file_hosts.rs). */
const FILE_HOST = /(?:^|\.)(?:drive\.google\.com|drive\.usercontent\.google\.com|docs\.google\.com|photos\.google\.com|photos\.app\.goo\.gl|dropbox\.com|dropboxusercontent\.com|onedrive\.live\.com|1drv\.ms|sharepoint\.com|box\.com|boxcloud\.com|mega\.nz|wetransfer\.com|we\.tl|pcloud\.com|pcloud\.link|zoom\.us|icloud\.com|frame\.io|f\.io|firebasestorage\.googleapis\.com|firebasestorage\.app)$/i;
/** Storage links signed for anyone holding them (Supabase's signed URLs). */
const SIGNED_STORAGE = /\.supabase\.co$/i;
/** A JSON Web Token: a viewer's signed claims (an IP address, an expiry). */
const JWT = /^eyJ[\w-]{2,}\.[\w-]{2,}\.[\w-]*$/;
/** A token written as a path part: Akamai's hdnea=/hdnts=, Bunny's bcdn_token=, Wowza's and Nimble's hashes. */
const PATH_TOKEN = /^(?:hdnea|hdnts|__token__|bcdn_token|token|tok|wmsauthsign|wowzatokenhash|auth|authtoken|jwt)=|(?:^|[~&])(?:exp|expires)=\d+.*(?:[~&])(?:hmac|sig|signature|hash)=|(?:^|[~&])(?:hmac|sig)=[\w%-]+.*(?:[~&])(?:exp|expires)=\d+/i;
/** Addresses a player streams that end in no media extension: Smooth Streaming and HLS/DASH by name. */
const STREAM_PATH = /\.ism\/manifest|\/(?:manifest|playlist|master|index)(?:\.(?:m3u8|mpd))?$/i;

const isJwt = (v: string) => JWT.test(v) && v.length >= 20;
/** An opaque token of its own: long, base64url, mixed case and digits (a content hash is hex, an id short). */
const isOpaqueToken = (v: string) => v.length >= 80 && /^[A-Za-z0-9_-]+$/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v);

/** Why a media address works only for the viewer who loaded it, or null:
 *  a signed or expiring token in its query, its path (a JWT part, as a
 *  live TV channel's SSAI playlist carries, a CDN's token path) or an
 *  opaque token part. Only the tab's sound can be transcribed from it,
 *  never its address. */
export function viewerBound(u: string): 'query' | 'path' | null {
  let x: URL;
  try { x = new URL(u); } catch { return null; }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return null;
  if (!MEDIA_EXT.test(x.pathname) && !STREAM_PATH.test(x.pathname)) return null;
  if (FILE_HOST.test(x.hostname)) return null;
  if (SIGNED_STORAGE.test(x.hostname) && /^\/storage\/v1\/object\/(?:sign|public)\//.test(x.pathname)) return null;
  const names = new Set([...x.searchParams.keys()].map((k) => k.toLowerCase()));
  if ([...names].some((k) => PRESIGNED.has(k))) return null;
  if (/\.blob\.core\.windows\.net$/i.test(x.hostname) && names.has('sv') && names.has('sig')) return null;
  if ([...names].some((k) => VIEWER_TOKEN.has(k))) return 'query';
  if (names.has('policy') && names.has('key-pair-id')) return 'query';
  if ([...names].some((k) => EXPIRY.has(k)) && [...names].some((k) => SIGNED.has(k))) return 'query';
  if ([...x.searchParams.values()].some(isJwt)) return 'query';
  const parts = x.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  if (parts.some((p) => isJwt(p) || PATH_TOKEN.test(p) || isOpaqueToken(p))) return 'path';
  const ks = parts.findIndex((p) => p.toLowerCase() === 'ks');
  if (ks >= 0 && (parts[ks + 1]?.length ?? 0) >= 24) return 'path';
  return null;
}

/** A media file or playlist tied to the viewer's session (`viewerBound`). */
export const isSessionBound = (u: string): boolean => viewerBound(u) !== null;

/** A playlist or manifest by its address: HLS, DASH, Smooth Streaming. */
export function isManifestUrl(u: string): boolean {
  try {
    const p = new URL(u).pathname;
    return MANIFEST.test(p) || /\.ism\/manifest/i.test(p);
  } catch { return false; }
}

/** What a playlist's text says it is: `live` (HLS with no end, DASH
 *  `type="dynamic"`), `vod` (HLS `#EXT-X-ENDLIST` or `PLAYLIST-TYPE:VOD`,
 *  DASH `static`), `master` (HLS naming its renditions only: its first
 *  one says), or null (not a playlist, or empty). */
export function manifestKind(text: string): 'live' | 'vod' | 'master' | null {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('#EXTM3U')) {
    const u = t.toUpperCase();
    if (u.includes('#EXT-X-ENDLIST') || u.includes('#EXT-X-PLAYLIST-TYPE:VOD')) return 'vod';
    if (u.includes('#EXT-X-STREAM-INF') && !u.includes('#EXTINF')) return 'master';
    return u.includes('#EXTINF') || u.includes('#EXT-X-TARGETDURATION') ? 'live' : null;
  }
  if (/<MPD[\s>]/i.test(t)) {
    if (/\btype\s*=\s*["']dynamic["']/i.test(t)) return 'live';
    return 'vod';
  }
  if (/<SmoothStreamingMedia[\s>]/i.test(t)) return /IsLive\s*=\s*["']true["']/i.test(t) ? 'live' : 'vod';
  return null;
}

/** A master playlist's first rendition, by its address. */
export function firstVariant(text: string, base: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const at = lines.findIndex((l) => l.toUpperCase().startsWith('#EXT-X-STREAM-INF'));
  const uri = at >= 0 ? lines.slice(at + 1).find((l) => l && !l.startsWith('#')) : undefined;
  if (!uri) return null;
  try { return new URL(uri, base).toString(); } catch { return null; }
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

/** A known player's page for an embed's address (null: not a known one). */
export function embedOf(src: string): { url: string; name: string } | null {
  for (const e of EMBEDS) {
    const m = src.match(e.re);
    if (m) return { url: e.page(m), name: e.name };
  }
  return null;
}

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
    if (isPageSound(m.url)) return;
    const k = `${m.kind}:${m.url}`;
    if (seen.has(k)) return;
    seen.add(k);
    if (!top) m.frameUrl = location.href;
    out.push(m);
  };

  // Inside a known player's frame (a YouTube embed): the player is the
  // embed's own page, one row with the page's iframe row, not a second,
  // stream-only one for its <video>.
  const self = top ? null : embedOf(location.href);
  if (self) add({ url: self.url, kind: 'embed', title: doc.title || `${self.name} player`, evidence: 'embed' });

  doc.querySelectorAll<HTMLMediaElement>('video, audio').forEach((el) => {
    if (self) return;
    const kind = el.tagName === 'VIDEO' ? 'video' : 'audio';
    const sources = [el.currentSrc, el.src, ...Array.from(el.querySelectorAll('source')).map((s) => s.src)].map((u) => abs(u, base)).filter(Boolean) as string[];
    const direct = sources.find((u) => !u.startsWith('blob:'));
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined;
    // A tiny muted autoplaying loop is decoration, not content.
    if (kind === 'video' && el.muted && el.loop && (duration ?? 0) < 30) return;
    if (kind === 'audio' && duration !== undefined && duration < MIN_AUDIO_S) return;
    if (direct) {
      add({ url: direct, kind, title: labelFor(el), durationS: duration, playing: !el.paused, evidence: 'element' });
    } else if (sources.length || el.readyState > 0) {
      add({ url: location.href, kind, title: labelFor(el) ?? doc.title, durationS: duration, playing: !el.paused, streamOnly: true, evidence: 'element' });
    }
  });

  // Players, also lazy ones not loaded yet: an iframe's address waiting in
  // data-src, and the facades that stand in for a YouTube or Vimeo player
  // until clicked (lite-youtube, data-youtube-id…).
  doc.querySelectorAll<HTMLIFrameElement>('iframe[src], iframe[data-src], iframe[data-lazy-src]').forEach((f) => {
    const src = abs(f.getAttribute('src'), base) ?? abs(f.dataset.src, base) ?? abs(f.dataset.lazySrc, base);
    const e = src ? embedOf(src) : null;
    if (e) add({ url: e.url, kind: 'embed', title: f.title || `${e.name} player`, evidence: 'embed' });
  });
  doc.querySelectorAll<HTMLElement>('lite-youtube[videoid], lite-vimeo[videoid], [data-youtube-id], [data-ytid], [data-vimeo-id]').forEach((el) => {
    const yt = el.getAttribute('data-youtube-id') ?? el.getAttribute('data-ytid') ?? (el.tagName === 'LITE-YOUTUBE' ? el.getAttribute('videoid') : null);
    const vm = el.getAttribute('data-vimeo-id') ?? (el.tagName === 'LITE-VIMEO' ? el.getAttribute('videoid') : null);
    const title = el.getAttribute('title') ?? el.getAttribute('playlabel') ?? el.getAttribute('aria-label') ?? undefined;
    if (yt && /^[\w-]{11}$/.test(yt)) add({ url: `https://www.youtube.com/watch?v=${yt}`, kind: 'embed', title: title ?? 'YouTube player', evidence: 'embed' });
    else if (vm && /^\d+$/.test(vm)) add({ url: `https://vimeo.com/${vm}`, kind: 'embed', title: title ?? 'Vimeo player', evidence: 'embed' });
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
  embed: 'Player',
  link: 'Media link',
  page: 'This page',
};

/** Twitch and Kick pages that aren't a channel: the site's own sections. */
const NOT_CHANNEL = '(?:directory|browse|search|settings|subscriptions|inventory|wallet|drops|downloads|jobs|p|store|turbo|prime|friends|messages|following|videos|categories|category|login|signup|dashboard|u|team|moderator|popout|embed|help|privacy|terms|community-guidelines|dmca)';

/** Pages that are one recording: probing them is a plain check, not a
 *  search of the page (which the server counts by the hour). A channel,
 *  playlist, listing or a site's home page is not one. */
export const MEDIA_PAGE = new RegExp([
  // YouTube, YouTube Music: a video, a live, a Short.
  String.raw`^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?|live\/[\w-]|shorts\/[\w-])`,
  String.raw`^https?:\/\/youtu\.be\/[\w-]`,
  // Vimeo: a video, also in a channel, showcase or group, and its player.
  String.raw`^https?:\/\/(?:www\.)?vimeo\.com\/(?:\d+|channels\/[^/]+\/\d+|showcase\/\d+\/video\/\d+|groups\/[^/]+\/videos\/\d+)(?:[/?#]|$)`,
  String.raw`^https?:\/\/player\.vimeo\.com\/video\/\d+`,
  // SoundCloud: a track or a set, not a person's lists or the site's pages.
  String.raw`^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/(?!(?:discover|search|stream|you|charts|upload|settings|messages|notifications|pages|terms-of-use|feed)(?:[/?#]|$))[^/?#]+\/(?!(?:likes|followers|following|reposts|albums|tracks|popular-tracks|comments|spotlight)(?:[/?#]|$))[^/?#]+`,
  String.raw`^https?:\/\/open\.spotify\.com\/(?:episode|show)\/`,
  String.raw`^https?:\/\/(?:www\.)?dailymotion\.com\/video\/`,
  // Twitch: a channel (live), a past broadcast, a clip.
  String.raw`^https?:\/\/(?:www\.|m\.)?twitch\.tv\/(?:videos\/\d+|(?!${NOT_CHANNEL}(?:[/?#]|$))\w+(?:\/(?:clip\/[\w-]+|video\/\d+))?(?:[?#]|\/?$))`,
  String.raw`^https?:\/\/clips\.twitch\.tv\/[\w-]+`,
  // Kick: a channel (live), its past broadcasts and clips.
  String.raw`^https?:\/\/(?:www\.)?kick\.com\/(?!${NOT_CHANNEL}(?:[/?#]|$))[\w-]+(?:\/(?:videos|clips)\/[\w-]+)?(?:[?#]|\/?$)`,
  String.raw`^https?:\/\/(?:www\.)?loom\.com\/share\/`,
  String.raw`^https?:\/\/dai\.ly\/\w`,
  // The posts the server reads from a feed site: a TikTok video, an X
  // post, an Instagram reel or post, a Facebook video or reel.
  String.raw`^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/?#]+\/video\/\d+`,
  String.raw`^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w+\/status\/\d+`,
  String.raw`^https?:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/[\w-]+`,
  String.raw`^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:watch\/?\?(?:.*&)?v=\d|reel\/\d|(?:groups\/)?[^/?#]+\/videos\/(?:[^/?#]+\/)?\d)`,
  String.raw`^https?:\/\/fb\.watch\/\w`,
  // A Bandcamp track or album, a TED talk, a Streamable or Archive.org
  // item, a Google Drive or Dropbox file (fetched as the file itself).
  String.raw`^https?:\/\/[\w-]+\.bandcamp\.com\/(?:track|album)\/[\w-]+`,
  String.raw`^https?:\/\/(?:www\.)?ted\.com\/talks\/\w`,
  String.raw`^https?:\/\/(?:www\.)?streamable\.com\/(?:e\/)?(?!(?:login|signup|settings|documentation|pricing|terms|privacy|about|blog|upload|videos|clipper|community|help|careers|features|api)\/?(?:[?#]|$))[a-z0-9]{4,10}\/?(?:[?#]|$)`,
  // An item, not a person's page (@name) or one of the site's collections.
  String.raw`^https?:\/\/(?:www\.)?archive\.org\/details\/(?!@|(?:movies|audio|texts|software|image|etree|opensource|opensource_movies|opensource_audio|feature_films|prelinger|tv|podcasts|radioprograms|oldtimeradio|librivoxaudio|audio_music|audio_bookspoetry|78rpm|georgeblood|internetarcade|softwarelibrary|classic_tv|ephemera|community|communityvideo|communityaudio)(?:[/?#]|$))[^/?#]+`,
  String.raw`^https?:\/\/drive\.google\.com\/(?:file\/d\/[\w-]+|open\?(?:.*&)?id=[\w-])`,
  String.raw`^https?:\/\/(?:www\.)?dropbox\.com\/(?:scl\/fi\/[\w-]+\/|s\/[\w-]+\/)[^/?#]`,
].join('|'), 'i');
