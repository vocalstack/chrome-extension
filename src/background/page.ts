/** The page's media (`page.scan`), the "Transcribe this …" context
 *  menus, and the `vs` omnibox keyword over the person's transcripts. */

import { VocalStack, type SearchHit } from '@vocalstack/sdk';
import type { Handlers } from '../lib/rpc';
import type { FoundMedia } from '../lib/media';
import { accessToken } from '../lib/auth';
import { currentEnv } from '../lib/env';
import { showInPanel } from './panel';
import { hitPath } from './page/paths';

/* ── page.scan ─────────────────────────────────────────────────────── */

interface FrameAnswer { url: string; title: string; top: boolean; media: FoundMedia[] }

class ScanError extends Error {
  constructor(message: string, readonly code = 'restricted') { super(message); }
}

/** Pages no extension may read, or nothing VocalStack could fetch. */
function restricted(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return 'This tab has no page to read.'; }
  if (u.protocol === 'file:') return 'Files on this computer can’t be read from a tab. Drop the file on this panel instead.';
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Browser and extension pages can’t be read. Open a web page with audio or video.';
  const h = u.hostname;
  if (h === 'chromewebstore.google.com' || (h === 'chrome.google.com' && u.pathname.startsWith('/webstore')) || h === 'microsoftedge.microsoft.com') {
    return 'The browser’s extension store can’t be read. Open a web page with audio or video.';
  }
  return null;
}

function ask(tabId: number, frameId: number, timeoutMs = 1500): Promise<FrameAnswer | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    chrome.tabs.sendMessage(tabId, { scan: true }, { frameId }).then(
      (a: FrameAnswer | undefined) => { clearTimeout(t); resolve(a && Array.isArray(a.media) ? a : null); },
      () => { clearTimeout(t); resolve(null); },
    );
  });
}

/** Tabs the content script was injected into by hand (opened before the
 *  extension was installed or updated): once each. */
const injected = new Set<string>();

async function askAll(tabId: number): Promise<FrameAnswer[]> {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) ?? [{ frameId: 0 }];
  const answers = await Promise.all(frames.map((f) => ask(tabId, f.frameId)));
  return answers.filter((a): a is FrameAnswer => !!a);
}

/** Merge what the frames found: one item per address, the richest kept. */
export function mergeMedia(pageUrl: string, pageTitle: string, found: FoundMedia[]): FoundMedia[] {
  const rank: Record<FoundMedia['kind'], number> = { video: 4, audio: 4, embed: 3, link: 2, page: 1 };
  const byUrl = new Map<string, FoundMedia>();
  for (const m of found) {
    const was = byUrl.get(m.url);
    if (!was) { byUrl.set(m.url, { ...m }); continue; }
    const keep = rank[m.kind] > rank[was.kind] ? { ...m } : was;
    keep.playing = !!(was.playing || m.playing) || undefined;
    keep.durationS = Math.max(was.durationS ?? 0, m.durationS ?? 0) || undefined;
    // An element with an address of its own beats one that only streams.
    keep.streamOnly = ([was, m].some((x) => x.streamOnly) && ![was, m].some((x) => (x.kind === 'video' || x.kind === 'audio') && !x.streamOnly)) || undefined;
    keep.title ??= was.title ?? m.title;
    byUrl.set(m.url, keep);
  }
  // The page itself is always there: what plays without an address of its
  // own is the page's, and the server may find recordings on it.
  const page = byUrl.get(pageUrl);
  if (!page) byUrl.set(pageUrl, { url: pageUrl, kind: 'page', title: pageTitle, evidence: 'page' });
  else page.title ||= pageTitle;
  const all = [...byUrl.values()];
  // Playing first, then the page, then the order found.
  return all.sort((a, b) => Number(!!b.playing) - Number(!!a.playing) || Number(b.url === pageUrl) - Number(a.url === pageUrl));
}

async function scan(tabId?: number) {
  const tab = tabId !== undefined
    ? await chrome.tabs.get(tabId)
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab?.id) throw new ScanError('No tab is open.', 'no_tab');
  const url = tab.url ?? tab.pendingUrl ?? '';
  const title = tab.title ?? '';
  const why = restricted(url);
  if (why) throw new ScanError(why);

  let answers = await askAll(tab.id);
  if (!answers.some((a) => a.top) && !injected.has(`${tab.id}:${url}`)) {
    // No content script in this tab yet: put it in, then ask again.
    injected.add(`${tab.id}:${url}`);
    const ok = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content-scripts/content.js'] }).then(() => true, () => false);
    if (ok) answers = await askAll(tab.id);
  }
  const top = answers.find((a) => a.top);
  const pageUrl = top?.url ?? url;
  const pageTitle = top?.title || title;
  return { tabId: tab.id, url: pageUrl, title: pageTitle, media: mergeMedia(pageUrl, pageTitle, answers.flatMap((a) => a.media)) };
}

/* ── Context menus ─────────────────────────────────────────────────── */

const MENU = { link: 'vs.page.link', media: 'vs.page.media', page: 'vs.page.page' } as const;

function onMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  const pageUrl = info.pageUrl ?? tab?.url ?? '';
  let url = pageUrl;
  let title = tab?.title;
  if (info.menuItemId === MENU.link && info.linkUrl) { url = info.linkUrl; title = info.selectionText || undefined; }
  else if (info.menuItemId === MENU.media) {
    const src = info.srcUrl ?? '';
    url = src && !src.startsWith('blob:') && !src.startsWith('data:') ? src : (info.frameUrl && info.frameId ? info.frameUrl : pageUrl);
  } else if (info.menuItemId !== MENU.page) return;
  // First, inside the click's user gesture: the panel may only open from it.
  void showInPanel({ view: 'page', url, title, tabId: tab?.id }, tab?.windowId);
}

/* ── Omnibox ───────────────────────────────────────────────────────── */

let sdk: { env: string; vs: VocalStack } | null = null;
async function bgClient(): Promise<VocalStack> {
  const env = await currentEnv();
  if (sdk?.env !== env.name) sdk = { env: env.name, vs: new VocalStack({ baseUrl: env.api, token: () => accessToken() }) };
  return sdk.vs;
}

let ownBroadcasts: { at: number; env: string; ids: Set<string> } | null = null;
async function broadcastIds(vs: VocalStack, env: string): Promise<Set<string>> {
  if (ownBroadcasts && ownBroadcasts.env === env && Date.now() - ownBroadcasts.at < 5 * 60_000) return ownBroadcasts.ids;
  const ids = new Set((await vs.broadcasts.list().catch(() => [])).map((b) => b.id));
  ownBroadcasts = { at: Date.now(), env, ids };
  return ids;
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** The hit's text with the query marked, as omnibox XML. */
function described(h: SearchHit, q: string): string {
  const text = h.text.replace(/\s+/g, ' ').trim();
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  const start = at > 60 ? at - 40 : 0;
  const cut = text.slice(start, start + 110);
  const i = cut.toLowerCase().indexOf(q.toLowerCase());
  const body = i < 0 ? xml(cut) : `${xml(cut.slice(0, i))}<match>${xml(cut.slice(i, i + q.length))}</match>${xml(cut.slice(i + q.length))}`;
  const m = Math.floor(h.mediaStart / 60), s = String(Math.floor(h.mediaStart % 60)).padStart(2, '0');
  return `${start ? '…' : ''}${body}${start + 110 < text.length ? '…' : ''} <dim>· ${xml(h.linkName)} · ${m}:${s}</dim>`;
}

let typed = '';
let lastWindowId: number | undefined;

async function suggest(text: string, send: (s: chrome.omnibox.SuggestResult[]) => void) {
  chrome.windows.getLastFocused().then((w) => { lastWindowId = w.id; }, () => {});
  typed = text;
  const q = text.trim();
  if (q.length < 2) return;
  await new Promise((r) => setTimeout(r, 250));
  if (typed !== text) return;
  try {
    const env = await currentEnv();
    const vs = await bgClient();
    const [res, own] = await Promise.all([vs.search.query(q, { limit: 6 }), broadcastIds(vs, env.name)]);
    if (typed !== text) return;
    send(res.hits.slice(0, 6).map((h) => ({ content: new URL(hitPath(h, own, q), env.app).toString(), description: described(h, q) })));
    chrome.omnibox.setDefaultSuggestion({ description: res.hits.length ? `Search your transcripts for <match>${xml(q)}</match> in VocalStack` : `No lines match <match>${xml(q)}</match> yet. Enter to search in VocalStack` });
  } catch {
    chrome.omnibox.setDefaultSuggestion({ description: 'Sign in to VocalStack (open its side panel) to search your transcripts' });
  }
}

function entered(text: string, disposition: `${chrome.omnibox.OnInputEnteredDisposition}`) {
  const t = text.trim();
  if (/^https?:\/\//.test(t)) {
    // A suggestion: its content is the dashboard address of the hit.
    void currentEnv().then((env) => {
      if (!t.startsWith(env.app)) return;
      if (disposition === 'currentTab') void chrome.tabs.update({ url: t });
      else void chrome.tabs.create({ url: t, active: disposition === 'newForegroundTab' });
    });
    return;
  }
  void showInPanel({ view: 'library', query: t }, lastWindowId);
}

/* ── Registration ──────────────────────────────────────────────────── */

export function registerPage(): Handlers {
  chrome.runtime.onInstalled.addListener(() => {
    const made = () => void chrome.runtime.lastError;
    chrome.contextMenus.create({ id: MENU.link, title: 'Transcribe this link', contexts: ['link'] }, made);
    chrome.contextMenus.create({ id: MENU.media, title: 'Transcribe this video or audio', contexts: ['video', 'audio'] }, made);
    chrome.contextMenus.create({ id: MENU.page, title: 'Transcribe this page', contexts: ['page'] }, made);
  });
  chrome.contextMenus.onClicked.addListener(onMenu);

  chrome.omnibox.setDefaultSuggestion({ description: 'Search your VocalStack transcripts' });
  chrome.omnibox.onInputStarted.addListener(() => { chrome.windows.getLastFocused().then((w) => { lastWindowId = w.id; }, () => {}); });
  chrome.omnibox.onInputChanged.addListener((text, send) => { void suggest(text, send); });
  chrome.omnibox.onInputEntered.addListener(entered);

  return {
    'page.scan': ({ tabId } = {}) => scan(tabId),
  };
}
