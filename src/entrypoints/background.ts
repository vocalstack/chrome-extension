/** The service worker: sign-in, the side panel, and the router every
 *  other part of the extension calls (`lib/rpc.ts`). Features live in
 *  src/background/*: each `register()` returns its handlers. */

import { serve, push, RpcError, type Handlers } from '../lib/rpc';
import * as auth from '../lib/auth';
import { setEnv } from '../lib/env';
import { registerPage } from '../background/page';
import { anyRunning, listLive, markInvoked, registerLive } from '../background/live';
import { registerDub } from '../background/dub';
import { registerVcap } from '../background/vcap';
import { registerTabCaptions, takeOffer } from '../background/tabCaptions';
import { forgetVideos, registerVideo } from '../background/video';
import { registerMeetings } from '../background/meetings';
import { registerUpdates } from '../background/updates';
import { showInPanel } from '../background/panel';
import { initSentry } from '../lib/sentry';

export default defineBackground(() => {
  initSentry('background');
  // The toolbar icon opens the panel. Handled here rather than with
  // openPanelOnActionClick so the click also counts as invoking the
  // extension on the tab, which tab capture requires.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    // Captions offered on this tab's video (Captions on videos): that's
    // the click they asked for.
    void markInvoked(tab).then(() => takeOffer(tab));
  });
  registerTabCaptions();

  const signedIn = async (a: auth.Account | null) => {
    push({ push: 'auth.changed', account: a });
    return a;
  };

  const handlers: Handlers = {
    'auth.account': () => auth.account(),
    'auth.connect': async () => (await signedIn(await auth.signInWithConnect()))!,
    'auth.key': async ({ key }) => (await signedIn(await auth.signInWithKey(key)))!,
    'auth.signOut': async () => { await auth.signOut(); await signedIn(null); },
    'auth.workspace': async () => {
      const was = await auth.account();
      if (!was) throw new auth.AuthError('Sign in to VocalStack first.', 'signed_out');
      if (was.via !== 'connect') throw new RpcError('An API key works in one workspace. Sign out, then sign in with a key from the other workspace.');
      // A running session keeps writing to the workspace it started in.
      if (await anyRunning()) throw new RpcError('Stop the recording or captions first, then change the workspace.');
      const now = await auth.signInWithConnect(async () => {
        if (await anyRunning()) throw new RpcError('The workspace was not changed: a recording or captions started meanwhile. Stop them, then change the workspace.');
      });
      // Nothing of the old workspace stays: finished sessions, remembered videos.
      for (const s of (await listLive().catch(() => [])).filter((x) => ['done', 'failed'].includes(x.state))) await handlers['live.forget']?.({ id: s.id }, {} as chrome.runtime.MessageSender);
      await forgetVideos().catch(() => {});
      return (await signedIn(now))!;
    },
    'auth.token': () => auth.accessToken(),
    'auth.refresh': async () => {
      try {
        return await auth.refresh();
      } catch (e) {
        if (!(await auth.account())) await signedIn(null);
        throw e;
      }
    },
    'env.set': async ({ name }) => {
      // A running session keeps calling the environment it started in.
      if (await anyRunning()) throw new RpcError('Stop the recording or captions first, then change the environment.');
      await setEnv(name);
      await signedIn(await auth.account());
    },
    'panel.open': async ({ tabId, view }, sender) => {
      const windowId = sender.tab?.windowId ?? (tabId !== undefined ? (await chrome.tabs.get(tabId)).windowId : undefined);
      await showInPanel({ view: (view as never) ?? 'page', tabId }, windowId);
    },
    ...registerPage(),
    ...registerLive(),
    ...registerDub(),
    ...registerVcap(),
    ...registerVideo(),
    ...registerMeetings(),
    ...registerUpdates(),
  };
  serve(handlers);
});
