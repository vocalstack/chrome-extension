/** Dub, page half: turns the main video down while VocalStack's voice
 *  plays in the offscreen document, and reports the video's clock to the
 *  background (`dubSync`) on every play, pause, seek and rate change, and
 *  twice a second while it plays. */

import { mainVideo } from './video';

export function startDubSync() {
  let video: HTMLVideoElement | null = null;
  let saved: { volume: number; muted: boolean } | null = null;
  let tick: number | undefined;

  const report = () => {
    if (!video) return;
    void chrome.runtime.sendMessage({ dubSync: { t: video.currentTime, paused: video.paused || video.ended, rate: video.playbackRate, at: Date.now() } }).catch(() => {});
  };
  const EVENTS = ['play', 'pause', 'seeked', 'ratechange', 'waiting', 'playing', 'ended'] as const;

  const on = () => {
    const v = mainVideo();
    if (!v || video === v) return;
    off();
    video = v;
    saved = { volume: v.volume, muted: v.muted };
    // Down, not off: the room's sound stays faintly under the voice.
    v.volume = Math.min(v.volume, 0.12);
    for (const e of EVENTS) v.addEventListener(e, report);
    tick = window.setInterval(() => { if (video && !video.paused) report(); }, 500);
    report();
  };

  const off = () => {
    if (!video) return;
    for (const e of EVENTS) video.removeEventListener(e, report);
    if (saved) { video.volume = saved.volume; video.muted = saved.muted; }
    if (tick) clearInterval(tick);
    video = null;
    saved = null;
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.dub === 'on') on();
    if (msg?.dub === 'off') off();
    return false;
  });
}
