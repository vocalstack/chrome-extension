/** Runs in every frame of every page: answers the media scan, and draws
 *  the captions overlay and drives a dub (src/content/*). */

import { scanDocument } from '../lib/media';
import { startOverlay } from '../content/overlay';
import { startDubSync } from '../content/dub';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, send) => {
      if (msg?.scan === true) {
        send({ url: location.href, title: document.title, top: window.top === window, media: scanDocument() });
        return false;
      }
      return false;
    });
    startOverlay();
    startDubSync();
    // Settings → Captions on videos: tell the background a video started
    // playing here (once per page address).
    let told = '';
    document.addEventListener('play', (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || told === location.href) return;
      if (Number.isFinite(v.duration) && v.duration < 20) return;
      told = location.href;
      void chrome.runtime.sendMessage({ videoPlaying: true }).catch(() => {});
    }, true);
  },
});
