/** How old this version is next to the newest release, by which part of
 *  the version moved (`<major>.<minor>.<patch>`, the patch being the
 *  count of commits on main, PUBLISHING.md):
 *  - a newer patch: an update is available;
 *  - a newer minor: this version is deprecated (it works, with less);
 *  - a newer major: this version is unsupported (the panel is blocked).
 *  To retire old versions, raise package.json's minor or major. */

export type VersionState = 'current' | 'available' | 'deprecated' | 'unsupported';

/** The update's own state in the panel (background/updates.ts). The
 *  newest version is the store's (what it serves now), or GitHub's Latest
 *  release for an unpacked install. */
export interface UpdateState {
  /** This extension's version. */
  current: string;
  /** The newest release, when known. */
  latest: string | null;
  state: VersionState;
  /** Installed from a store, which updates it (Chrome Web Store, Edge
   *  Add-ons); else unpacked, updated by downloading the release again. */
  store: boolean;
  /** Where the update stands. `downloaded`: an unpacked install's zip. */
  step: 'idle' | 'checking' | 'downloading' | 'ready' | 'downloaded';
  /** The version downloaded and installed at the next reload. */
  ready: string | null;
  /** Install updates automatically (Settings). */
  auto: boolean;
}

const parts = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);

export function versionState(current: string, latest: string | null | undefined): VersionState {
  if (!latest) return 'current';
  const [a = 0, b = 0, c = 0] = parts(current);
  const [x = 0, y = 0, z = 0] = parts(latest);
  if (x !== a) return x > a ? 'unsupported' : 'current';
  if (y !== b) return y > b ? 'deprecated' : 'current';
  return z > c ? 'available' : 'current';
}
