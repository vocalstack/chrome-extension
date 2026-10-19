/** Opening the side panel, and telling it what to show.
 *
 *  An intent (`PanelIntent`) is left in chrome.storage.session; the panel
 *  reads it when it opens and whenever it changes (`usePanelIntent`), then
 *  clears it. That way a context-menu click or a meeting notification can
 *  open the panel on the right screen whether or not it is already open. */

export type View = 'page' | 'live' | 'broadcasts' | 'voices' | 'library' | 'settings';

export interface PanelIntent {
  view: View;
  /** Page: transcribe this address (a link or media the person clicked). */
  url?: string;
  title?: string;
  /** Library: run this search. */
  query?: string;
  /** Live: preselect a mode for this tab. */
  mode?: 'record' | 'meeting' | 'captions';
  tabId?: number;
  /** Unique, so the same intent twice is still seen as new. */
  at: number;
}

export const INTENT = 'panel.intent';

export async function showInPanel(intent: Omit<PanelIntent, 'at'>, windowId?: number): Promise<void> {
  await chrome.storage.session.set({ [INTENT]: { ...intent, at: Date.now() } satisfies PanelIntent });
  // Must run inside the user gesture (a click, a menu, a command): no
  // await may come before it in the caller.
  if (windowId !== undefined) await chrome.sidePanel.open({ windowId }).catch(() => {});
}
