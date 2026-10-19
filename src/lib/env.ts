/** Where the extension talks to: production by default, e2e or this Mac
 *  for testing (Settings → Environment). The choice lives in
 *  chrome.storage.local, read by every part of the extension. */

export type EnvName = 'production' | 'e2e' | 'local';

export interface Env {
  name: EnvName;
  label: string;
  /** The API (`/v1`, `/docs/key-exchange`). */
  api: string;
  /** The dashboard: the Connect consent screen, recordings, broadcasts. */
  app: string;
  /** Where listeners open a broadcast. */
  live: string;
}

export const ENVS: Record<EnvName, Env> = {
  production: { name: 'production', label: 'Production', api: 'https://api.vocalstack.com', app: 'https://app.vocalstack.com', live: 'https://live.vocalstack.com' },
  e2e: { name: 'e2e', label: 'e2e', api: 'https://api.e2e.vocalstack.com', app: 'https://app.e2e.vocalstack.com', live: 'https://app.e2e.vocalstack.com' },
  local: { name: 'local', label: 'This computer', api: 'http://localhost:8080', app: 'http://localhost:5176', live: 'http://localhost:5176' },
};

const KEY = 'env';

/** For a scratch API on another port: `chrome.storage.local.set({ localApi: 'http://localhost:8090' })`. */
const LOCAL_API = 'localApi';

export async function currentEnv(): Promise<Env> {
  const got = await chrome.storage.local.get([KEY, LOCAL_API]);
  const env = ENVS[got[KEY] as EnvName] ?? ENVS.production;
  return env.name === 'local' && typeof got[LOCAL_API] === 'string' ? { ...env, api: got[LOCAL_API] } : env;
}

export async function setEnv(name: EnvName): Promise<void> {
  await chrome.storage.local.set({ [KEY]: name });
}
