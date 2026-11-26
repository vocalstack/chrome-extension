/** A tab's video title for a name: asked of the page (lib/title.ts), or
 *  else the tab's title without the site's name around it. */

import { cleanTitle } from '../lib/title';

export async function videoTitle(tab: chrome.tabs.Tab, timeoutMs = 400): Promise<string | undefined> {
  const fromTab = cleanTitle(tab.title, tab.url) || tab.title || undefined;
  if (tab.id === undefined) return fromTab;
  const asked = await new Promise<string | undefined>((resolve) => {
    const t = setTimeout(() => resolve(undefined), timeoutMs);
    chrome.tabs.sendMessage(tab.id!, { videoTitle: true }, { frameId: 0 }).then(
      (a: { name?: string } | undefined) => { clearTimeout(t); resolve(a?.name?.trim() || undefined); },
      () => { clearTimeout(t); resolve(undefined); },
    );
  });
  return asked ?? fromTab;
}
