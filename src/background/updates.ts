/** Updates: the newest release (GitHub's Latest, which every release
 *  marks, PUBLISHING.md) against this version (lib/version.ts), and
 *  installing it. A store install asks its store (requestUpdateCheck),
 *  which downloads the update; it installs when the extension reloads,
 *  never on its own: the listener on onUpdateAvailable keeps Chrome from
 *  reloading under a recording. An unpacked install downloads the zip
 *  again. */

import { push, RpcError, type Handlers } from '../lib/rpc';
import { versionState, type UpdateState } from '../lib/version';
import { anyRunning } from './live';

const RELEASES = 'https://api.github.com/repos/vocalstack/chrome-extension/releases/latest';
const ZIP = `https://github.com/vocalstack/chrome-extension/releases/download/latest/vocalstack-${import.meta.env.BROWSER === 'edge' ? 'edge' : 'chrome'}.zip`;
/** Asked again after this long (GitHub allows 60 asks an hour per address). */
const FRESH_MS = 6 * 60 * 60 * 1000;
const LATEST_KEY = 'vs.update.latest';
const READY_KEY = 'vs.update.ready';
export const AUTO_UPDATE = 'vs.update.auto';

let step: UpdateState['step'] = 'idle';
let store: Promise<boolean> | null = null;

const current = () => chrome.runtime.getManifest().version;
const isStore = () => (store ??= chrome.management.getSelf().then((s) => s.installType !== 'development', () => false));

async function latest(force = false): Promise<string | null> {
  // A dev build (wxt dev) is the source itself.
  if (import.meta.env.DEV) return null;
  const got = (await chrome.storage.local.get(LATEST_KEY))[LATEST_KEY] as { v: string; at: number } | undefined;
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

async function state(force = false): Promise<UpdateState> {
  const [v, s, g] = await Promise.all([latest(force), isStore(), chrome.storage.local.get([READY_KEY, AUTO_UPDATE])]);
  const ready = typeof g[READY_KEY] === 'string' && versionState(current(), g[READY_KEY]) !== 'current' ? (g[READY_KEY] as string) : null;
  return { current: current(), latest: v, state: versionState(current(), v), store: s, step: ready ? 'ready' : step, ready, auto: g[AUTO_UPDATE] === true };
}

const tell = async () => push({ push: 'update.state', state: await state() });

/** Ask the store for the update: it downloads, and onUpdateAvailable says when it's ready. */
async function fromStore(): Promise<void> {
  step = 'checking';
  await tell();
  const r = await chrome.runtime.requestUpdateCheck().catch(() => ({ status: 'throttled' as const, version: undefined }));
  const now = (await chrome.storage.local.get(READY_KEY))[READY_KEY];
  if (now) return;
  // no_update: released, but still in the store's review.
  step = r.status === 'update_available' ? 'downloading' : r.status === 'no_update' ? 'waiting' : 'idle';
  await tell();
}

/** Check now (Settings, and each time the panel opens); with automatic
 *  updates on, fetch a newer version as soon as it's known. */
async function check(force: boolean): Promise<UpdateState> {
  const s = await state(force);
  if (s.auto && s.store && s.state !== 'current' && !s.ready && s.step === 'idle') void fromStore();
  return s;
}

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
      if (await isStore()) return void (await fromStore());
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
