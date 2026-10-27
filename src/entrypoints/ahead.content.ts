/** YouTube, from the start of every frame: keeps the player's buffered
 *  audio, and feeds it to a live session that reads ahead on this tab
 *  (src/content/ahead.ts; the page-world half is buffer.content.ts). */

import { startAhead } from '../content/ahead';

export default defineContentScript({
  matches: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'],
  allFrames: true,
  runAt: 'document_start',
  main() {
    startAhead();
  },
});
