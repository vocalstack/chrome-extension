/** Meeting mode: when a tab opens a meeting (Meet, Teams, Zoom on the
 *  web…), the toolbar icon is marked on that tab and, once per meeting, a
 *  notification offers to record it. Recording itself starts from the
 *  panel (or Alt+Shift+R), because tab capture needs the person to invoke
 *  the extension on the tab. Settings → "Offer to record meetings". */

import type { Handlers } from '../lib/rpc';
import { meetingOf, OFFER_KEY } from '../lib/live';
import { showInPanel } from './panel';

const offered = new Set<string>();

async function offering(): Promise<boolean> {
  const g = await chrome.storage.local.get(OFFER_KEY);
  return g[OFFER_KEY] !== false;
}

async function onTab(tabId: number, url: string | undefined, title: string | undefined) {
  const name = meetingOf(url);
  if (!name) {
    await chrome.action.setTitle({ tabId, title: 'VocalStack' }).catch(() => {});
    return;
  }
  await chrome.action.setTitle({ tabId, title: `VocalStack: record this ${name} meeting` }).catch(() => {});
  if (!(await offering())) return;
  const key = `${tabId}:${new URL(url!).pathname}`;
  if (offered.has(key)) return;
  offered.add(key);
  chrome.notifications.create(`meeting:${tabId}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('/icon/128.png'),
    title: `Record this ${name} meeting?`,
    message: `${title ? `${title}\n` : ''}Click the VocalStack icon on the meeting tab, then Record meeting. You get the transcript and a summary when it ends.`,
    buttons: [{ title: 'Open VocalStack' }],
    requireInteraction: false,
  });
}

export function registerMeetings(): Handlers {
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === 'complete' || info.url) void onTab(tabId, tab.url, tab.title);
  });
  const open = async (id: string) => {
    if (!id.startsWith('meeting:')) return;
    const tabId = Number(id.slice(8));
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await showInPanel({ view: 'live', mode: 'meeting', tabId }, tab.windowId);
    chrome.notifications.clear(id);
  };
  chrome.notifications.onClicked.addListener((id) => void open(id));
  chrome.notifications.onButtonClicked.addListener((id) => void open(id));
  return {};
}
