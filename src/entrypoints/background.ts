/** The service worker: sign-in, the side panel, and the router every
 *  other part of the extension calls (`lib/rpc.ts`). Features live in
 *  src/background/*: each `register()` returns its handlers. */

import { serve, push, type Handlers } from '../lib/rpc';
import * as auth from '../lib/auth';
import { setEnv } from '../lib/env';
import { registerPage } from '../background/page';
import { registerLive } from '../background/live';
import { registerDub } from '../background/dub';
import { registerMeetings } from '../background/meetings';
import { showInPanel } from '../background/panel';

export default defineBackground(() => {
  // The toolbar icon opens the panel. Handled here rather than with
  // openPanelOnActionClick so the click also counts as invoking the
  // extension on the tab, which tab capture requires.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  });

  const signedIn = async (a: auth.Account | null) => {
    push({ push: 'auth.changed', account: a });
    return a;
  };

  const handlers: Handlers = {
    'auth.account': () => auth.account(),
    'auth.connect': async () => (await signedIn(await auth.signInWithConnect()))!,
    'auth.key': async ({ key }) => (await signedIn(await auth.signInWithKey(key)))!,
    'auth.signOut': async () => { await auth.signOut(); await signedIn(null); },
    'auth.token': () => auth.accessToken(),
    'env.set': async ({ name }) => { await setEnv(name); await signedIn(await auth.account()); },
    'panel.open': async ({ tabId, view }, sender) => {
      const windowId = sender.tab?.windowId ?? (tabId !== undefined ? (await chrome.tabs.get(tabId)).windowId : undefined);
      await showInPanel({ view: (view as never) ?? 'page', tabId }, windowId);
    },
    ...registerPage(),
    ...registerLive(),
    ...registerDub(),
    ...registerMeetings(),
  };
  serve(handlers);
});
