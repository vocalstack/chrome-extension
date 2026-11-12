/** A workspace's mark, as the Dashboard draws it (transcribe:
 *  app/src/screens/Workspaces.tsx, WorkspaceMark): its own icon when it
 *  has one, a person for the personal workspace, else its initials on a
 *  tile tinted with its colour. */

import { useEffect, useState, type CSSProperties } from 'react';
import { WORKSPACE_ICON, type StoredIcon } from '../lib/auth';
import { iconVersion, type Workspace } from '../lib/workspace';
import { workspaceHue, workspaceInitials } from '../lib/workspaceMark';
import { HiUser } from './icons';

/** The workspace's own icon as the background keeps it (a data: link),
 *  or null: it has none, or it is not fetched yet. */
export function useWorkspaceIcon(w: Workspace | undefined, env: string | undefined): string | null {
  const [kept, setKept] = useState<StoredIcon | null>(null);
  useEffect(() => {
    let on = true;
    chrome.storage.local.get(WORKSPACE_ICON).then((g) => { if (on) setKept((g[WORKSPACE_ICON] as StoredIcon | undefined) ?? null); }, () => {});
    const l = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[WORKSPACE_ICON]) setKept((changes[WORKSPACE_ICON].newValue as StoredIcon | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(l);
    return () => { on = false; chrome.storage.onChanged.removeListener(l); };
  }, []);
  const version = iconVersion(w?.iconUrl);
  return version && kept && kept.version === version && (!env || kept.env === env) ? kept.data : null;
}

export function WorkspaceMark({ w, env, size = 28 }: { w: Workspace; env?: string; size?: number }) {
  const icon = useWorkspaceIcon(w, env);
  const style: CSSProperties = { width: size, height: size, borderRadius: Math.round(size * 0.29), fontSize: Math.round(size * 0.39) };
  if (icon) return <span className="wsmark wsmark--img" style={style} aria-hidden="true"><img src={icon} alt="" draggable={false} /></span>;
  if (w.personal) { const g = Math.round(size * 0.55); return <span className="wsmark wsmark--me" style={style} aria-hidden="true"><HiUser width={g} height={g} /></span>; }
  return <span className="wsmark" style={{ ...style, '--ws-h': workspaceHue(w.id) } as CSSProperties} aria-hidden="true">{workspaceInitials(w.name)}</span>;
}
