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
  /** 'ext' = the file extension says media; 'element' = a <video>/<audio>. */
  evidence?: 'element' | 'ext' | 'embed' | 'page';
}

const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm|mp4|m4v|mov|mkv|m3u8|mpd)(?:$|[?#])/i;

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
