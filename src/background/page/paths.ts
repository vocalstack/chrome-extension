/** Dashboard addresses (transcribe: app/src/lib/router.ts) for what the
 *  page and library screens and the omnibox open. Shared by the
 *  background and the panel; no chrome.* calls here. */

import type { SearchHit, Transcription } from '@vocalstack/contract';

/** A search hit, at its line: a broadcast's own recording under /s/…, a
 *  transcription's under /transcriptions/…; a live one on its live screen.
 *  `#s=` is the sentence the reader scrolls to, `?q=` marks the words. */
export function hitPath(h: Pick<SearchHit, 'transcriptionId' | 'recordingId' | 'sentenceId' | 'live'>, ownBroadcasts: Set<string>, q?: string): string {
  const own = ownBroadcasts.has(h.transcriptionId);
  if (h.live) return own ? `/s/${h.transcriptionId}/live` : `/transcriptions/${h.transcriptionId}/live`;
  const query = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return `${own ? `/s/${h.transcriptionId}` : `/transcriptions/${h.transcriptionId}`}/r/${h.recordingId}${query}#s=${encodeURIComponent(String(h.sentenceId))}`;
}

/** A transcription: a live one opens on its live screen. */
export function txPath(t: Pick<Transcription, 'id' | 'live'>): string {
  return t.live ? `/transcriptions/${t.id}/live` : `/transcriptions/${t.id}`;
}
