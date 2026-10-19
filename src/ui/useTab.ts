import { useEffect, useState } from 'react';

/** The active tab of the panel's window, kept current. */
export function useActiveTab(): chrome.tabs.Tab | null {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  useEffect(() => {
    let windowId: number | undefined;
    const read = () => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => { windowId = t?.windowId; setTab(t ?? null); });
    void read();
    const onActivated = (i: { windowId: number }) => { if (windowId === undefined || i.windowId === windowId) void read(); };
    const onUpdated = (_id: number, info: { status?: string; url?: string; title?: string }, t: chrome.tabs.Tab) => {
      if (t.active && (windowId === undefined || t.windowId === windowId) && (info.status === 'complete' || info.url || info.title)) setTab(t);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return tab;
}
