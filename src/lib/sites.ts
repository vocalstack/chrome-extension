/** Captions on videos (Settings, off by default): which way a video that
 *  just started playing with its sound on gets its captions.
 *
 *  - `server`: VocalStack fetches the video from its address and
 *    transcribes it (background/vcap.ts): a YouTube video, or a page's own
 *    media file. Only addresses the server opens as a recording, so the
 *    link check never searches a web page (an hourly allowance).
 *  - `tab`: the tab's own sound, captioned live in Floating Captions
 *    (background/tabCaptions.ts): every site the server refuses to fetch
 *    (transcribe: src/stream_source/mod.rs `PAGE_HOSTS`), live streams,
 *    and players with no file address of their own.
 *  - `none`: an ad, a small or secondary video, or a clip too short to be
 *    the page's video.
 *
 *  Pure: the content script measures the video (`Played`), the
 *  background decides here. */

export type CaptionRoute = 'server' | 'tab';

export interface VideoSite {
  name: string;
  route: CaptionRoute;
  /** A feed of short clips (reels, posts): any length counts. */
  clips?: boolean;
}

/** By host (and its subdomains: player.vimeo.com, clips.twitch.tv…). */
const SITES: [string, VideoSite][] = [
  ['youtube.com', { name: 'YouTube', route: 'server' }],
  ['youtube-nocookie.com', { name: 'YouTube', route: 'server' }],
  ['youtu.be', { name: 'YouTube', route: 'server' }],
  ['vimeo.com', { name: 'Vimeo', route: 'tab' }],
  ['twitch.tv', { name: 'Twitch', route: 'tab' }],
  ['dailymotion.com', { name: 'Dailymotion', route: 'tab' }],
  ['dai.ly', { name: 'Dailymotion', route: 'tab' }],
  ['facebook.com', { name: 'Facebook', route: 'tab', clips: true }],
  ['fb.watch', { name: 'Facebook', route: 'tab', clips: true }],
  ['x.com', { name: 'X', route: 'tab', clips: true }],
  ['twitter.com', { name: 'X', route: 'tab', clips: true }],
  ['instagram.com', { name: 'Instagram', route: 'tab', clips: true }],
  ['tiktok.com', { name: 'TikTok', route: 'tab', clips: true }],
  ['kick.com', { name: 'Kick', route: 'tab' }],
  ['loom.com', { name: 'Loom', route: 'tab' }],
  ['wistia.com', { name: 'Wistia', route: 'tab' }],
  ['wistia.net', { name: 'Wistia', route: 'tab' }],
  ['soundcloud.com', { name: 'SoundCloud', route: 'tab' }],
  ['spotify.com', { name: 'Spotify', route: 'tab' }],
];

/** Hosts that serve ads (and the frames ads play in). */
const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'imasdk.googleapis.com', '2mdn.net',
  'adnxs.com', 'amazon-adsystem.com', 'teads.tv', 'innovid.com', 'springserve.com', 'spotxchange.com', 'spotx.tv',
  'tremorhub.com', 'moatads.com', 'adsrvr.org', 'smartadserver.com', 'pubmatic.com', 'rubiconproject.com',
  'fwmrm.net', 'serving-sys.com', 'flashtalking.com', 'criteo.com', 'criteo.net', 'outbrain.com', 'taboola.com',
  'aniview.com', 'vidazoo.com', 'primis.tech', 'sekindo.com', 'adform.net', 'yieldmo.com', 'undertone.com',
];

/** A media file or playlist, by its address's extension: what the server
 *  opens as a recording (lib/media.ts keeps the same list for the scan). */
const FILE_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm|mp4|m4v|mov|mkv|m3u8|mpd)$/i;

/** Smallest visible size (px²) of a page's main video: 240×135. */
export const MIN_AREA = 240 * 135;
/** Shortest page video worth transcribing from its file: shorter, it is
 *  most likely an ad or a promo clip. */
export const MIN_FILE_S = 45;
/** Shortest video captioned from the tab on a site of longer videos, or
 *  on any other site. */
export const MIN_TAB_S = 20;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase().replace(/\.$/, '') : null;
  } catch {
    return null;
  }
}

const onHost = (host: string, h: string) => host === h || host.endsWith(`.${h}`);

/** The known video site an address is on, or null. */
export function siteOf(url: string | undefined): VideoSite | null {
  const host = hostOf(url);
  if (!host) return null;
  return SITES.find(([h]) => onHost(host, h))?.[1] ?? null;
}

/** An ad server's address. */
export function isAdUrl(url: string | undefined): boolean {
  const host = hostOf(url);
  return !!host && AD_HOSTS.some((h) => onHost(host, h));
}

/** A YouTube video's watch address, from any address of it (watch,
 *  shorts, live, embed, youtu.be), or null. */
export function youtubeWatch(url: string | undefined): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const u = new URL(url!);
  let id: string | null = null;
  if (onHost(host, 'youtu.be')) id = u.pathname.split('/')[1] ?? null;
  else if (onHost(host, 'youtube.com') || onHost(host, 'youtube-nocookie.com')) {
    id = u.pathname === '/watch' ? u.searchParams.get('v') : (u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]+)/)?.[1] ?? null);
  }
  return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** A media file's own address (not a blob, not a page). */
export function isFileUrl(url: string | undefined): boolean {
  if (!hostOf(url)) return false;
  return FILE_EXT.test(new URL(url!).pathname);
}

/** The video that just started playing with its sound on, as the content
 *  script measured it in its frame. */
export interface Played {
  /** The tab's address. */
  pageUrl: string;
  /** The address of the frame the video plays in (the page's, at the top). */
  frameUrl: string;
  /** The video's own address, when it has one (not a blob: stream). */
  src?: string;
  /** Seconds; Infinity: live; undefined: not known yet. */
  durationS?: number;
  /** Visible size, px². */
  area: number;
  /** The largest video on screen in its frame. */
  largest: boolean;
  /** Inside an ad's container on the page (the content script looks). */
  adHint?: boolean;
}

/** `Played` as the content script sends it (`{videoPlaying}`): without
 *  the tab's address, which the background knows, and with a live
 *  stream's endless length as `live` (Infinity doesn't survive a message). */
export type PlayedMsg = Omit<Played, 'pageUrl' | 'durationS'> & { durationS?: number; live?: boolean };

/** The background's `Played` from the message and the tab's address. */
export function playedOf(m: PlayedMsg, pageUrl: string): Played {
  const { live, durationS, ...rest } = m;
  return { ...rest, pageUrl, frameUrl: m.frameUrl || pageUrl, durationS: live ? Infinity : durationS };
}

export type CaptionPlan =
  | { path: 'server'; url: string; site: string | null }
  | { path: 'tab'; site: string | null }
  | { path: 'none'; why: 'ad' | 'small' | 'short' | 'preview' };

/** Which way the played video gets its captions. */
export function captionPlan(p: Played): CaptionPlan {
  if (p.adHint || isAdUrl(p.src) || isAdUrl(p.frameUrl)) return { path: 'none', why: 'ad' };
  if (!p.largest || p.area < MIN_AREA) return { path: 'none', why: 'small' };
  const d = p.durationS;
  const known = d !== undefined && Number.isFinite(d) && d > 0;
  const live = d === Infinity;
  // The frame first: a YouTube or Vimeo player embedded in a news page is
  // that site's video.
  const site = siteOf(p.frameUrl) ?? siteOf(p.pageUrl);
  if (site?.name === 'YouTube') {
    const watch = youtubeWatch(p.frameUrl) ?? youtubeWatch(p.pageUrl);
    // Off a video's own page (home, search, a channel), what plays is a
    // preview under the pointer, not a video the person chose.
    if (!watch) return { path: 'none', why: 'preview' };
    // A live broadcast has no end to transcribe: its sound, as it plays.
    if (watch && !live) return { path: 'server', url: watch, site: site.name };
    return { path: 'tab', site: site.name };
  }
  if (site) {
    if (known && !site.clips && d! < MIN_TAB_S) return { path: 'none', why: 'short' };
    return { path: 'tab', site: site.name };
  }
  // Any other page: its own media file, transcribed whole, only when it is
  // long enough to be the page's video, not an ad.
  if (known && d! < MIN_FILE_S) return { path: 'none', why: 'short' };
  if (known && isFileUrl(p.src)) return { path: 'server', url: p.src!, site: null };
  // A stream with no file address (a blob: player), a live one, or an
  // address the server would take for a web page: the tab's sound.
  return { path: 'tab', site: null };
}

/** A tab-captions start, once the plan says `tab`. Chrome lets an
 *  extension hear a tab only after the person invoked it there (the
 *  toolbar icon, a shortcut, a menu), so without that it is offered, one
 *  click away; never again on a site the person said no to, nor on a tab
 *  whose sound is already in use (captions on, or a recording). */
export function tabStep(s: { busy: boolean; declined: boolean; invoked: boolean }): 'skip' | 'start' | 'offer' {
  if (s.busy || s.declined) return 'skip';
  return s.invoked ? 'start' : 'offer';
}
