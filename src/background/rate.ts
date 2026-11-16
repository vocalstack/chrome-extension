/** What the rating card (lib/rate.ts) learns from live sessions: how long
 *  each took to its first line, which ended well, which failed, and
 *  captions watched long enough to count as a result used. */

import type { Push } from '../lib/rpc';
import type { LiveStatus } from '../lib/live';
import { noteDone, noteFailed, noteFirstLine, noteUsed, updateRate } from '../lib/rate';

/** Captions watched this long count as a result used. */
const WATCHED_S = 120;

interface Seen { startedAt: number; firstMs?: number; video: boolean }
const sessions = new Map<string, Seen>();

/** A tab's sound captioned or recorded (not a meeting, a broadcast or the microphone). */
const isVideo = (s: LiveStatus) => !!s.input.tab && (s.mode === 'captions' || s.mode === 'record');

export function registerRate(): void {
  // Kept from the install (or the update that brought it): "3 days" counts from here.
  chrome.runtime.onInstalled.addListener(() => { void updateRate(() => {}); });

  chrome.runtime.onMessage.addListener((msg: Push) => {
    if (msg?.push === 'live.status') {
      const st = msg.status;
      let s = sessions.get(st.id);
      if (!s) { s = { startedAt: st.startedAt, video: isVideo(st) }; sessions.set(st.id, s); }
      if (st.state === 'failed') { void noteFailed(st.id); sessions.delete(st.id); }
      if (st.state === 'done') {
        if (s.video && s.firstMs !== undefined) void noteDone(st.id, 'video', s.firstMs);
        if (st.mode === 'captions' && (st.sentS ?? 0) >= WATCHED_S) void noteUsed();
        sessions.delete(st.id);
      }
    }
    if (msg?.push === 'live.event' && msg.event.type === 'committed') {
      const s = sessions.get(msg.id);
      if (s && s.firstMs === undefined) {
        s.firstMs = Date.now() - s.startedAt;
        if (s.video) void noteFirstLine(s.firstMs);
      }
    }
    return false;
  });
}
