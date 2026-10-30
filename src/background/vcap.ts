/** Captions on a page's video (design 3, Page → Captions): VocalStack
 *  transcribes the video from its address (the one transcription the dub
 *  shares, background/video.ts), then the content script shows its
 *  sentences in time with the video, in the reading language. A new
 *  reading language translates the same transcription again.
 *
 *  With Settings → Captions on videos (off until turned on), this starts by
 *  itself when the person starts a video playing with its sound on, for a
 *  video VocalStack can fetch: a YouTube video, or a page's own media file
 *  when it is the page's video (not an ad, not a small or short one), once
 *  per address while the browser runs. Every other video (Vimeo, Twitch…,
 *  live streams, players with no file) is captioned from the tab's sound
 *  instead (background/tabCaptions.ts; lib/sites.ts decides). Started by
 *  itself, its progress (but on YouTube, where content/playerPrompt.ts
 *  shows it) and a failure show on the page (content/captionsPrompt.ts). */

import { push, RpcError, type Handlers } from '../lib/rpc';
import { GENERIC, userText } from '../lib/errors';
import { report } from '../lib/sentry';
import { account } from '../lib/auth';
import { AUTO_CAPTIONS, tabHolder, type VcapStart, type VcapStatus } from '../lib/live';
import { captionPlan, playedOf, siteOf, type PlayedMsg } from '../lib/sites';
import { listLive, videoFrame } from './live';
import { LINK_REFUSED, sleep, tabStore, transcribeVideo, vsClient } from './video';
import { autoTab, tellPage } from './tabCaptions';

const AUTO_SEEN = 'vcap.autoSeen';
interface TabCap { status: VcapStatus; frameId: number; run: number }
const store = tabStore<TabCap>('vcap.state');
const get = store.get;
const put = store.put;
const all = store.all;

async function current(tabId: number, run: number): Promise<boolean> {
  return (await get(tabId))?.run === run;
}
async function set(s: VcapStatus, run: number) {
  const ok = await store.update(s.tabId, (d) => (d && d.run === run ? [{ ...d, status: s }, true] : [d, false]));
  if (!ok) return;
  push({ push: 'vcap.status', status: s });
  // Started by itself: on the page, how far along it is (YouTube's own
  // card says so there), then nothing once the captions show.
  if (s.auto && s.state !== 'failed') {
    if (s.state === 'on') tellPage(s.tabId, { ccPrompt: 'hide' });
    else if (siteOf(s.url)?.name !== 'YouTube') tellPage(s.tabId, { ccPrompt: 'working', pct: s.progress !== undefined ? Math.round(s.progress * 100) : null });
  }
}

/** A sentence on the video: shown `t` (`o`: as said, when `t` is its
 *  translation, `tr`), and the words said, which light up one by one. */
export interface Cue { s: number; e: number; t: string; o?: string; tr?: boolean; w?: { s: number; e: number; t: string }[] }

async function run(req: VcapStart, runId: number) {
  const { tabId } = req;
  const lang = req.lang ?? null;
  const base: VcapStatus = { tabId, lang, url: req.url, title: req.title, state: 'transcribing', progress: 0, auto: req.auto };
  await set(base, runId);
  const vs = await vsClient();
  const ids = await transcribeVideo(vs, { url: req.url, title: req.title }, (p) => set({ ...base, ...p }, runId), () => current(tabId, runId));
  if (!ids) return;
  const withIds = { ...base, transcriptionId: ids.transcriptionId, recordingId: ids.recordingId };
  const snap = await vs.recordings.transcript(ids.recordingId, lang ? { lang } : {});
  const sentences = snap.sentences.filter((x) => !x.suppressed && x.text.trim());
  if (!sentences.length) throw new RpcError('No speech was found in this video.');
  const tr: Record<number, string> = {};
  if (lang) {
    await set({ ...withIds, state: 'translating', progress: 0 }, runId);
    for (const x of sentences) { const t = x.translations?.[lang]; if (t) tr[x.sentenceId] = t; }
    const missing = sentences.filter((x) => !tr[x.sentenceId]).map((x) => x.sentenceId);
    for (let i = 0; i < missing.length; i += 40) {
      if (!(await current(tabId, runId))) return;
      const got = await vs.recordings.translation(ids.recordingId, lang, missing.slice(i, i + 40));
      for (const [k, v] of Object.entries(got.translations)) tr[Number(k)] = v;
      await set({ ...withIds, state: 'translating', progress: Math.min(1, (i + 40) / missing.length) }, runId);
      await sleep(50);
    }
  }
  if (!(await current(tabId, runId))) return;
  const bySeq = new Map(snap.segments.map((g) => [g.seq, g]));
  const wordsOf = (seqs: number[]) => seqs.flatMap((q) => bySeq.get(q)?.words ?? []).map((w) => ({ s: w.start, e: w.end, t: w.text }));
  const cues: Cue[] = sentences.map((x) => ({
    s: x.start, e: x.end, w: wordsOf(x.seqs),
    ...(lang && tr[x.sentenceId] ? { t: tr[x.sentenceId]!, o: x.text, tr: true } : { t: x.text }),
  }));
  const frameId = await videoFrame(tabId);
  await store.update(tabId, (d) => [d && d.run === runId ? { ...d, frameId } : d, undefined]);
  await chrome.tabs.sendMessage(tabId, { vcap: 'on', lang, cues }, { frameId }).catch(() => {});
  await set({ ...withIds, state: 'on', progress: undefined }, runId);
}

async function start(req: VcapStart): Promise<VcapStatus> {
  const prev = await get(req.tabId);
  if (prev) await hide(req.tabId, prev);
  const runId = Date.now();
  const first: VcapStatus = { tabId: req.tabId, lang: req.lang ?? null, url: req.url, title: req.title, state: 'transcribing', progress: 0, auto: req.auto };
  await put(req.tabId, { status: first, frameId: 0, run: runId });
  run(req, runId).catch(async (e) => {
    // Started by itself, on an address the link check refused (nothing
    // was made): the tab's sound instead.
    if (req.auto && e instanceof RpcError && e.code === LINK_REFUSED && (await current(req.tabId, runId))) {
      await put(req.tabId, null);
      push({ push: 'vcap.gone', tabId: req.tabId });
      const tab = await chrome.tabs.get(req.tabId).catch(() => null);
      if (tab) await autoTab(tab, null);
      return;
    }
    report(e, 'video captions');
    await set({ ...first, state: 'failed', error: userText(e) }, runId);
    if (req.auto && (await current(req.tabId, runId))) tellPage(req.tabId, { ccPrompt: 'failed', text: userText(e) || GENERIC });
  });
  return first;
}

async function hide(tabId: number, d: TabCap | null) {
  await chrome.tabs.sendMessage(tabId, { vcap: 'off' }, { frameId: d?.frameId ?? 0 }).catch(() => {});
}

async function stop(tabId: number) {
  const d = await get(tabId);
  await put(tabId, null);
  await hide(tabId, d);
  if (d?.status.auto && d.status.state !== 'failed') tellPage(tabId, { ccPrompt: 'hide' });
  push({ push: 'vcap.gone', tabId });
}

export function registerVcap(): Handlers {
  chrome.runtime.onMessage.addListener((m: { vcapOff?: boolean; videoPlaying?: PlayedMsg }, sender) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    // × on the captions, or the tab's recording took the captions over.
    if (m?.vcapOff) void stop(tabId);
    // The person started a video with its sound on: Captions on videos.
    if (m?.videoPlaying) void auto(sender.tab!, m.videoPlaying).catch((e) => report(e, 'auto captions'));
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => { void put(tabId, null); });
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url) void get(tabId).then((d) => d && stop(tabId)); });
  // The reading language changed: running captions follow it (the same
  // transcription, translated).
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !('readLang' in c)) return;
    const lang = (c.readLang!.newValue as string | null) || null;
    void all().then((caps) => {
      for (const d of caps) if (d.status.state !== 'failed' && d.status.lang !== lang) void start({ tabId: d.status.tabId, url: d.status.url, title: d.status.title, lang, auto: d.status.auto });
    });
  });
  return {
    'vcap.start': (req) => start(req),
    'vcap.stop': ({ tabId }) => stop(tabId),
    'vcap.status': async ({ tabId }) => (await get(tabId))?.status ?? null,
  };
}

async function auto(tab: chrome.tabs.Tab, played: PlayedMsg) {
  if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) return;
  const g = await chrome.storage.local.get([AUTO_CAPTIONS, 'readLang']);
  if (g[AUTO_CAPTIONS] !== true || !(await account())) return;
  // Captions already on this tab: from its video, or from its sound.
  if (await get(tab.id)) return;
  const plan = captionPlan(playedOf(played, tab.url));
  if (plan.path === 'none') return;
  if (plan.path === 'tab') { await autoTab(tab, plan.site); return; }
  if (tabHolder(await listLive().catch(() => []), tab.id)) return;
  // Once per video address while the browser runs: turned off, it stays off.
  const seen = ((await chrome.storage.session.get(AUTO_SEEN))[AUTO_SEEN] as string[] | undefined) ?? [];
  if (seen.includes(plan.url)) return;
  await chrome.storage.session.set({ [AUTO_SEEN]: [...seen.slice(-200), plan.url] });
  await start({ tabId: tab.id, url: plan.url, title: tab.title, lang: (g.readLang as string) || null, auto: true });
}
