/** Captions on videos, from the tab's sound: for the sites VocalStack
 *  can't fetch a video from (Vimeo, Twitch, Dailymotion, Facebook, X,
 *  Instagram, TikTok, Kick, Loom…; lib/sites.ts), for live streams, and
 *  for players with no file address. The same capture and Floating
 *  Captions as Live → Captions (`startLive`, mode `captions`): realtime,
 *  nothing stored, translated into the reading language.
 *
 *  Chrome lets an extension hear a tab only after the person invoked it on
 *  that tab (the toolbar icon, a shortcut, a context menu), until the tab
 *  goes to another site. So on a tab already invoked there, the captions
 *  just start; otherwise the page shows an offer (content/captionsPrompt.ts)
 *  and the toolbar icon its "!", and that one click turns them on
 *  (`takeOffer`, from the icon's click in entrypoints/background.ts).
 *
 *  Said no to, they stay off: × on the offer, for that site for the rest
 *  of the browser session; × on the captions, for that tab on that site.
 *  A failure shows on the page in plain words. While the video stays
 *  paused they pause too (nothing is sent), and go on when it plays. */

import { RpcError, type Push } from '../lib/rpc';
import { GENERIC, userText } from '../lib/errors';
import { report } from '../lib/sentry';
import { capturable, tabHolder } from '../lib/live';
import { tabStep } from '../lib/sites';
import type { PromptMsg } from '../content/captionsPrompt';
import { invokeBadge, listLive, livePrefs, off, startLive, wasInvoked } from './live';

const OFFERS = 'tcap.offers';
const DECLINED = 'tcap.declined';
const AUTO = 'tcap.auto';
/** Sessions paused here because their video was: resumed when it plays. */
const PAUSED = 'tcap.paused';
/** A video paused this long pauses its captions (a short pause doesn't). */
const PAUSE_AFTER_MS = 15_000;

interface Offer { tabId: number; origin: string; site: string | null }
/** `tabId` absent: the whole site. */
interface Declined { origin: string; tabId?: number }
interface Started { id: string; tabId: number; origin: string }

const originOf = (url: string | undefined) => { try { return new URL(url ?? '').origin; } catch { return ''; } };

async function list<T>(key: string): Promise<T[]> {
  return ((await chrome.storage.session.get(key))[key] as T[] | undefined) ?? [];
}
async function save<T>(key: string, v: T[]) {
  await chrome.storage.session.set({ [key]: v.slice(-200) });
}

/** The card on the page (its top frame). */
export function tellPage(tabId: number, m: PromptMsg) {
  void chrome.tabs.sendMessage(tabId, m, { frameId: 0 }).catch(() => {});
}

/** A video started playing with its sound on, and its plan is the tab's
 *  sound (lib/sites.ts `captionPlan`). */
export async function autoTab(tab: chrome.tabs.Tab, site: string | null) {
  if (tab.id === undefined || !capturable(tab.url)) return;
  const origin = originOf(tab.url);
  const busy = !!tabHolder(await listLive().catch(() => []), tab.id);
  const declined = (await list<Declined>(DECLINED)).some((d) => d.origin === origin && (d.tabId === undefined || d.tabId === tab.id));
  const step = tabStep({ busy, declined, invoked: await wasInvoked(tab.id) });
  if (step === 'start') await startFor(tab, site);
  else if (step === 'offer') await offer(tab, site);
}

async function offer(tab: chrome.tabs.Tab, site: string | null) {
  const offers = (await list<Offer>(OFFERS)).filter((o) => o.tabId !== tab.id);
  await save(OFFERS, [...offers, { tabId: tab.id!, origin: originOf(tab.url), site }]);
  await invokeBadge(tab.id!, true);
  tellPage(tab.id!, { ccPrompt: 'offer', site });
}

async function dropOffer(tabId: number): Promise<Offer | null> {
  const offers = await list<Offer>(OFFERS);
  const o = offers.find((x) => x.tabId === tabId) ?? null;
  if (o) await save(OFFERS, offers.filter((x) => x.tabId !== tabId));
  return o;
}

/** The toolbar icon was clicked on this tab (it now counts as invoked):
 *  an offer there is taken. */
export async function takeOffer(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return;
  const o = await dropOffer(tab.id);
  if (!o) return;
  tellPage(tab.id, { ccPrompt: 'hide' });
  // Gone to another site meanwhile: that offer was for the other one.
  if (o.origin !== originOf(tab.url)) return;
  if (tabHolder(await listLive().catch(() => []), tab.id)) return;
  await startFor(tab, o.site);
}

async function startFor(tab: chrome.tabs.Tab, site: string | null) {
  try {
    const s = await startLive({ mode: 'captions', input: { tab: true, mic: false }, tabId: tab.id, ...(await livePrefs()) });
    await save(AUTO, [...(await list<Started>(AUTO)), { id: s.id, tabId: tab.id!, origin: originOf(tab.url) }]);
    tellPage(tab.id!, { ccPrompt: 'hide' });
  } catch (e) {
    // Noted as invoked, but Chrome no longer agrees (the extension was
    // reloaded): the click is asked for again.
    if (e instanceof RpcError && e.code === 'invoke') { await offer(tab, site); return; }
    report(e, 'tab captions');
    tellPage(tab.id!, { ccPrompt: 'failed', text: userText(e) || GENERIC });
  }
}

const waits = new Map<number, ReturnType<typeof setTimeout>>();

/** The tab's video paused or played: its captions from the tab's sound
 *  follow, once paused a while. Never ones the person paused in Live. */
async function videoState(tabId: number, playing: boolean) {
  clearTimeout(waits.get(tabId));
  waits.delete(tabId);
  const mine = (await list<Started>(AUTO)).find((x) => x.tabId === tabId);
  if (!mine) return;
  const ours = await list<string>(PAUSED);
  if (playing) {
    if (!ours.includes(mine.id)) return;
    await save(PAUSED, ours.filter((x) => x !== mine.id));
    await off({ off: 'live.pause', id: mine.id, paused: false }).catch((e) => report(e, 'tab captions resume'));
    return;
  }
  waits.set(tabId, setTimeout(() => {
    waits.delete(tabId);
    void (async () => {
      const s = (await listLive().catch(() => [])).find((x) => x.id === mine.id);
      if (s?.state !== 'live') return;
      await save(PAUSED, [...(await list<string>(PAUSED)), mine.id]);
      await off({ off: 'live.pause', id: mine.id, paused: true }).catch((e) => report(e, 'tab captions pause'));
    })();
  }, PAUSE_AFTER_MS));
}

async function decline(d: Declined) {
  const all = (await list<Declined>(DECLINED)).filter((x) => !(x.origin === d.origin && x.tabId === d.tabId));
  await save(DECLINED, [...all, d]);
}

export function registerTabCaptions() {
  chrome.runtime.onMessage.addListener((msg: Push | { ccDecline?: boolean; videoState?: { playing: boolean } }, sender) => {
    const vs = (msg as { videoState?: { playing: boolean } })?.videoState;
    if (vs && sender.tab?.id !== undefined) { void videoState(sender.tab.id, vs.playing); return false; }
    // × on the offer: not on this site, this browser session.
    if ((msg as { ccDecline?: boolean })?.ccDecline && sender.tab?.id !== undefined) {
      const tabId = sender.tab.id;
      void dropOffer(tabId).then(() => decline({ origin: originOf(sender.tab!.url) })).then(() => invokeBadge(tabId, false));
      return false;
    }
    const p = msg as Push;
    if (p?.push !== 'live.status') return false;
    const st = p.status;
    if (st.tabId === undefined) return false;
    const tabId = st.tabId;
    if (st.input.tab && ['starting', 'warming', 'live'].includes(st.state)) {
      // The tab's sound is in use another way (Live, the shortcut): no offer.
      void dropOffer(tabId).then((o) => { if (o) { tellPage(tabId, { ccPrompt: 'hide' }); void invokeBadge(tabId, false); } });
    }
    if (st.state === 'done' || st.state === 'failed') {
      void list<Started>(AUTO).then(async (all) => {
        const mine = all.find((x) => x.id === st.id);
        if (!mine) return;
        await save(AUTO, all.filter((x) => x.id !== st.id));
        await save(PAUSED, (await list<string>(PAUSED)).filter((x) => x !== st.id));
        // Stopped by the person (× on the captions): off on this tab, on this site.
        if (st.state === 'done') await decline({ origin: mine.origin, tabId });
        else tellPage(tabId, { ccPrompt: 'failed', text: st.error || GENERIC });
      });
    }
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void dropOffer(tabId);
    void list<Declined>(DECLINED).then((all) => { if (all.some((d) => d.tabId === tabId)) void save(DECLINED, all.filter((d) => d.tabId !== tabId)); });
  });
  // To another site: an offer made for the last one goes.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (!info.url) return;
    void list<Offer>(OFFERS).then((all) => {
      const o = all.find((x) => x.tabId === tabId);
      if (o && o.origin !== originOf(info.url)) void dropOffer(tabId).then(() => { tellPage(tabId, { ccPrompt: 'hide' }); void invokeBadge(tabId, false); });
    });
  });
}
