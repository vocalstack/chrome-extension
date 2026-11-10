/** Dub, page half: turns the main video down while VocalStack's voice
 *  plays in the offscreen document (back up through the lines already
 *  spoken in the dub's language, `keep`: no voice reads those), and
 *  reports the video's clock to the background (`dubSync`) on every play,
 *  pause, seek and rate change, and twice a second while it plays. */

import { mainVideo } from './video';

export function startDubSync() {
  let video: HTMLVideoElement | null = null;
  let saved: { volume: number; muted: boolean } | null = null;
  let tick: number | undefined;
  let keep: [number, number][] = [];
  /** Down, not off: the room's sound stays faintly under the voice. */
  const DOWN = 0.12;
  /** In a kept line now; null: not set yet. Set only as it changes, so a
   *  volume the person picks meanwhile stays. */
  let inKeep: boolean | null = null;
  const level = () => {
    if (!video || !saved) return;
    const t = video.currentTime;
    const k = keep.some(([s, e]) => t >= s && t < e);
    if (k === inKeep) return;
    inKeep = k;
    video.volume = k ? saved.volume : Math.min(saved.volume, DOWN);
  };

  const report = () => {
    if (!video) return;
    level();
    void chrome.runtime.sendMessage({ dubSync: { t: video.currentTime, paused: video.paused || video.ended, rate: video.playbackRate, at: Date.now() } }).catch(() => {});
  };
  const EVENTS = ['play', 'pause', 'seeked', 'ratechange', 'waiting', 'playing', 'ended'] as const;

  const on = () => {
    const v = mainVideo();
    if (!v || video === v) return;
    off();
    video = v;
    saved = { volume: v.volume, muted: v.muted };
    level();
    for (const e of EVENTS) v.addEventListener(e, report);
    v.addEventListener('timeupdate', level);
    tick = window.setInterval(() => { if (video && !video.paused) report(); }, 500);
    report();
  };

  const off = () => {
    if (!video) return;
    for (const e of EVENTS) video.removeEventListener(e, report);
    video.removeEventListener('timeupdate', level);
    if (saved) { video.volume = saved.volume; video.muted = saved.muted; }
    if (tick) clearInterval(tick);
    video = null;
    saved = null;
    inKeep = null;
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.dub === 'on') { keep = Array.isArray(msg.keep) ? msg.keep : []; inKeep = null; on(); level(); }
    if (msg?.dub === 'off') off();
    return false;
  });
}
