/** Runs in every frame of every page: answers the media scan, and draws
 *  the captions overlay and drives a dub (src/content/*). */

import { scanDocument } from '../lib/media';
import { startOverlay } from '../content/overlay';
import { startDubSync } from '../content/dub';
import { startPlayerPrompt } from '../content/playerPrompt';
import { startCaptionsPrompt } from '../content/captionsPrompt';
import { mainVideo, visibleArea } from '../content/video';
import type { PlayedMsg } from '../lib/sites';

/** Containers ad players put their video in (Google IMA, video.js ads, and
 *  the usual ad-slot names). */
const AD_BOX = '.ima-ad-container,.vjs-ad-playing,.vjs-ad-loading,.ad-container,.adContainer,.ad-slot,.video-ad,[id^="google_ads"],[data-ad-slot],[aria-label="Advertisement"]';

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
    if (window.top === window) startCaptionsPrompt();
    // Settings → Captions on videos: tell the background when the person
    // starts a video playing with its sound on, measured for its choice
    // (lib/sites.ts `captionPlan`): once per page address and video, so an
    // ad played first does not use up the page's turn. Muted autoplay and
    // hover previews do not count: no recent click or key, or no sound.
    const told = new Set<string>();
    /** Started by the person, its length not known yet: told once it is. */
    const armed = new WeakSet<HTMLVideoElement>();
    const ids = new WeakMap<HTMLVideoElement, number>();
    let next = 0;
    const audible = (v: HTMLVideoElement) => !v.paused && !v.muted && v.volume > 0;
    const tell = (v: HTMLVideoElement) => {
      armed.delete(v);
      if (!ids.has(v)) ids.set(v, next++);
      const key = `${location.href}|${ids.get(v)}|${v.currentSrc}`;
      if (told.has(key) || told.size > 50) return;
      told.add(key);
      const src = v.currentSrc && /^https?:/.test(v.currentSrc) ? v.currentSrc : undefined;
      const d = v.duration;
      // Infinity (live) doesn't survive the message: `live` says it.
      const played: PlayedMsg = {
        frameUrl: location.href,
        src,
        durationS: Number.isFinite(d) ? d : undefined,
        live: d === Infinity,
        area: visibleArea(v) / (v.paused ? 1 : 4),
        largest: mainVideo() === v,
        adHint: !!v.closest(AD_BOX),
      };
      void chrome.runtime.sendMessage({ videoPlaying: played }).catch(() => {});
    };
    const check = (e: Event) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement)) return;
      if (armed.has(v) && !Number.isNaN(v.duration) && audible(v)) { tell(v); return; }
      if (!audible(v) || !navigator.userActivation?.isActive) return;
      if (Number.isNaN(v.duration)) armed.add(v);
      else tell(v);
    };
    document.addEventListener('play', check, true);
    document.addEventListener('playing', check, true);
    document.addEventListener('loadedmetadata', check, true);
    document.addEventListener('durationchange', check, true);
    // Unmuting a playing video (a click on its sound button) starts it too.
    document.addEventListener('volumechange', check, true);
    // A video told about, paused or ended and playing again: captions from
    // the tab's sound wait while it does (background/tabCaptions.ts).
    const state = (e: Event) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || !ids.has(v)) return;
      void chrome.runtime.sendMessage({ videoState: { playing: !v.paused && !v.ended } }).catch(() => {});
    };
    document.addEventListener('pause', state, true);
    document.addEventListener('ended', state, true);
    document.addEventListener('playing', state, true);
  },
});
