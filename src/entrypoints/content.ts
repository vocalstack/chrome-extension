/** Runs in every frame of every page: answers the media scan, and draws
 *  the captions overlay and drives a dub (src/content/*). */

import { scanDocument } from '../lib/media';
import { startOverlay } from '../content/overlay';
import { startDubSync } from '../content/dub';
import { startPlayerPrompt } from '../content/playerPrompt';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, send) => {
      // The video opened on the VocalStack player in a new tab: this one stops.
      if (msg?.pauseVideo === true) {
        for (const v of document.querySelectorAll('video')) v.pause();
        return false;
      }
      if (msg?.scan === true) {
        send({ url: location.href, title: document.title, top: window.top === window, media: scanDocument() });
        return false;
      }
      return false;
    });
    startOverlay();
    startDubSync();
    if (window.top === window && /(^|\.)youtube\.com$/.test(location.hostname)) startPlayerPrompt();
    // Settings → Captions on videos: tell the background when the person
    // starts a video playing with its sound on (once per page address).
    // Muted autoplay and hover previews do not count: no recent click or
    // key, or no sound.
    let told = '';
    const audible = (v: HTMLVideoElement) => !v.paused && !v.muted && v.volume > 0 && !(Number.isFinite(v.duration) && v.duration < 20);
    const check = (e: Event) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || told === location.href || !audible(v)) return;
      if (!navigator.userActivation?.isActive) return;
      told = location.href;
      void chrome.runtime.sendMessage({ videoPlaying: { url: location.href } }).catch(() => {});
    };
    document.addEventListener('play', check, true);
    document.addEventListener('playing', check, true);
    // Unmuting a playing video (a click on its sound button) starts it too.
    document.addEventListener('volumechange', check, true);
  },
});
