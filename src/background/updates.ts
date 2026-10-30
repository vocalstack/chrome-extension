/** Updates: the newest version this install can get against this
 *  version (lib/version.ts), and installing it. A store install asks its
 *  store (requestUpdateCheck), whose answer is the version it serves now,
 *  past its review; asking also downloads it, which installs when the
 *  extension reloads, never on its own: the listener on onUpdateAvailable
 *  keeps Chrome from reloading under a recording. An unpacked install has
 *  no store: GitHub's Latest release (PUBLISHING.md), and the zip again. */

import { push, RpcError, type Handlers } from '../lib/rpc';
import { versionState, type UpdateState } from '../lib/version';
import { anyRunning } from './live';

const RELEASES = 'https://api.github.com/repos/vocalstack/chrome-extension/releases/latest';
const ZIP = `https://github.com/vocalstack/chrome-extension/releases/download/latest/vocalstack-${import.meta.env.BROWSER === 'edge' ? 'edge' : 'chrome'}.zip`;
/** GitHub asked again after this long (it allows 60 asks an hour per address). */
const FRESH_MS = 6 * 60 * 60 * 1000;
/** The store asked again after this long (Chrome throttles asking often). */
const STORE_FRESH_MS = 30 * 60 * 1000;
const LATEST_KEY = 'vs.update.latest';
const STORE_KEY = 'vs.update.store';
const READY_KEY = 'vs.update.ready';
export const AUTO_UPDATE = 'vs.update.auto';

let step: UpdateState['step'] = 'idle';
let store: Promise<boolean> | null = null;

const current = () => chrome.runtime.getManifest().version;
const isStore = () => (store ??= chrome.management.getSelf().then((s) => s.installType !== 'development', () => false));

type Seen = { v: string; at: number };
const seen = async (key: string) => (await chrome.storage.local.get(key))[key] as Seen | undefined;
const newest = (a: string | null, b: string | null) => (!a ? b : !b ? a : versionState(a, b) === 'current' ? a : b);

async function fromGitHub(force: boolean): Promise<string | null> {
  const got = await seen(LATEST_KEY);
  if (got && !force && Date.now() - got.at < FRESH_MS) return got.v;
  try {
    const r = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json' }, credentials: 'omit' });
    if (!r.ok) return got?.v ?? null;
    const v = String(((await r.json()) as { tag_name?: string }).tag_name ?? '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(v)) return got?.v ?? null;
    await chrome.storage.local.set({ [LATEST_KEY]: { v, at: Date.now() } });
    return v;
  } catch {
    return got?.v ?? null;
  }
}

let asking: Promise<string | null> | null = null;

/** The store's newest version: update_available names it (and starts its
 *  download), no_update means this one; throttled keeps the last answer. */
function fromStore(force: boolean): Promise<string | null> {
  return (asking ??= (async () => {
    const got = await seen(STORE_KEY);
    if (got && !force && Date.now() - got.at < STORE_FRESH_MS) return got.v;
    if (step === 'idle') { step = 'checking'; void tell(); }
    const r = await chrome.runtime.requestUpdateCheck().catch(() => ({ status: 'throttled' as const, version: undefined }));
    const v = r.status === 'update_available' && r.version ? r.version : r.status === 'no_update' ? current() : got?.v ?? null;
    if (r.status !== 'throttled' && v) await chrome.storage.local.set({ [STORE_KEY]: { v, at: Date.now() } });
    if (step === 'checking') step = r.status === 'update_available' ? 'downloading' : 'idle';
    return v;
  })().finally(() => { asking = null; }));
}

async function latest(force = false): Promise<string | null> {
  // A dev build (wxt dev) is the source itself.
  if (import.meta.env.DEV) return null;
  if (!(await isStore())) return fromGitHub(force);
  // A version already downloaded is out, whatever the last answer said.
  const ready = (await chrome.storage.local.get(READY_KEY))[READY_KEY];
  return newest(await fromStore(force), typeof ready === 'string' ? ready : null);
}

async function state(force = false): Promise<UpdateState> {
  const [v, s, g] = await Promise.all([latest(force), isStore(), chrome.storage.local.get([READY_KEY, AUTO_UPDATE])]);
  const ready = typeof g[READY_KEY] === 'string' && versionState(current(), g[READY_KEY]) !== 'current' ? (g[READY_KEY] as string) : null;
  return { current: current(), latest: v, state: versionState(current(), v), store: s, step: ready ? 'ready' : step, ready, auto: g[AUTO_UPDATE] === true };
}

const tell = async () => push({ push: 'update.state', state: await state() });

/** Check now (Settings, and each time the panel opens). */
const check = (force: boolean): Promise<UpdateState> => state(force);

export function registerUpdates(): Handlers {
  // Registered once, at the worker's start: Chrome then waits for a reload.
  chrome.runtime.onUpdateAvailable.addListener(({ version }) => {
    step = 'ready';
    void chrome.storage.local.set({ [READY_KEY]: version }).then(tell);
  });
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'update') { step = 'idle'; void chrome.storage.local.remove(READY_KEY); }
  });
  return {
    'update.state': ({ force } = {}) => check(!!force),
    'update.get': async () => {
      // The store's answer started the download already; asked again, it
      // resumes one that stopped.
      if (await isStore()) { await fromStore(true); return void (await tell()); }
      await chrome.tabs.create({ url: ZIP });
      step = 'downloaded';
      await tell();
    },
    'update.reload': async () => {
      if (await anyRunning()) throw new RpcError('Stop the recording or captions first, then reload to update.');
      chrome.runtime.reload();
    },
    'update.auto': async ({ on }) => {
      await chrome.storage.local.set({ [AUTO_UPDATE]: on });
      return check(false);
    },
  };
}
