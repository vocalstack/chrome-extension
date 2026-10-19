import { useEffect, useState } from 'react';
import { INTENT, type PanelIntent } from '../background/panel';

/** The latest intent the background left for the panel (background/panel.ts). */
export function usePanelIntent(): [PanelIntent | null, () => void] {
  const [intent, setIntent] = useState<PanelIntent | null>(null);
  useEffect(() => {
    chrome.storage.session.get(INTENT).then((g) => setIntent((g[INTENT] as PanelIntent) ?? null));
    const l = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && INTENT in changes) setIntent((changes[INTENT].newValue as PanelIntent) ?? null);
    };
    chrome.storage.onChanged.addListener(l);
    return () => chrome.storage.onChanged.removeListener(l);
  }, []);
  const clear = () => { void chrome.storage.session.remove(INTENT); };
  return [intent, clear];
}
