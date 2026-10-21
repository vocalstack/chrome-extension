/** What the background tells the offscreen document (entrypoints/offscreen).
 *  The offscreen document has no chrome.storage: everything it needs (the
 *  API's address, the tab's capture stream id) comes in the command. */

import type { LiveStart, LiveStatus } from './live';

export interface DubSentence {
  id: number;
  start: number;
  end: number;
}

export type OffCmd =
  | { off: 'live.start'; id: string; api: string; start: LiveStart; name: string; streamId?: string; tabTitle?: string }
  | { off: 'live.stop'; id: string }
  | { off: 'live.pause'; id: string; paused: boolean }
  | { off: 'live.list' }
  | { off: 'live.history'; id: string }
  | { off: 'live.set'; id: string; translateTo?: string | null; overlay?: boolean; spokenLanguage?: string | null; speakerLabels?: 'auto' | 'on' | 'off' }
  | { off: 'live.forget'; id: string }
  | { off: 'dub.load'; tabId: number; api: string; recordingId: string; lang: string; voice?: string | null; sentences: DubSentence[] }
  /** The page video's clock: `t` media seconds at `at` (ms since epoch). */
  | { off: 'dub.sync'; tabId: number; t: number; paused: boolean; rate: number; at: number }
  | { off: 'dub.stop'; tabId: number };

export type OffAnswer = { ok: true; value?: unknown; statuses?: LiveStatus[] } | { ok: false; error: string; code?: string };

export function isOffCmd(m: unknown): m is OffCmd {
  return !!m && typeof (m as { off?: unknown }).off === 'string';
}
