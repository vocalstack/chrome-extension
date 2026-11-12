/** The workspace a sign-in works in. An API key belongs to one workspace:
 *  what it creates lands there and is billed there. `GET /v1/me` and the
 *  answer of `POST /v1/connect/token` name it (API contract
 *  1.0.0-alpha.12); an older API leaves it out, and then nothing here is
 *  known and Settings shows what sign-in gave. */

export interface Workspace {
  id: string;
  /** As the Dashboard shows it ("Personal workspace" for an unnamed personal one). */
  name: string;
  personal: boolean;
  /** Its own icon (a PNG), a link relative to the API's address, fetched
   *  with no Authorization header. Null: it has none. */
  iconUrl: string | null;
}

/** The `workspace` of an API answer, or undefined when the API sent none
 *  (or something that isn't one). */
export function readWorkspace(raw: unknown): Workspace | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== 'string' || !w.id || typeof w.name !== 'string') return undefined;
  const iconUrl = typeof w.iconUrl === 'string' && w.iconUrl ? w.iconUrl : null;
  return { id: w.id, name: w.name.trim() || (w.personal === true ? 'Personal workspace' : 'Workspace'), personal: w.personal === true, iconUrl };
}

/** What tells one icon from another: the link's path and its `v`. The
 *  `exp` and `sig` parts are signed again every month for the same picture. */
export function iconVersion(iconUrl: string | null | undefined): string | null {
  if (!iconUrl) return null;
  try {
    const u = new URL(iconUrl, 'https://api.invalid');
    return `${u.pathname}?v=${u.searchParams.get('v') ?? ''}`;
  } catch {
    return null;
  }
}

export function sameWorkspace(a: Workspace | undefined, b: Workspace | undefined): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.name === b.name && a.personal === b.personal && iconVersion(a.iconUrl) === iconVersion(b.iconUrl);
}

/** The stored account with the workspace the API names now, or null when
 *  nothing changed. An answer without a workspace (an older API, a failed
 *  call) keeps what is stored. A link signed again for the same icon is
 *  kept as the newer link, without counting as a change. */
export function withWorkspace<A extends { workspace?: Workspace }>(account: A, now: Workspace | undefined): A | null {
  if (!now || sameWorkspace(account.workspace, now)) return null;
  return { ...account, workspace: now };
}

/** The name Settings shows: the workspace's, else what sign-in gave. */
export function workspaceName(account: { name: string; workspace?: Workspace }): string {
  return account.workspace?.name || account.name;
}

/** Whether the sign-in moved to another key or workspace, so everything
 *  loaded for the old one must go. */
export function movedWorkspace(a: { keyId: string; workspace?: Workspace } | null | undefined, b: { keyId: string; workspace?: Workspace } | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.keyId !== b.keyId) return true;
  return !!a.workspace && !!b.workspace && a.workspace.id !== b.workspace.id;
}
