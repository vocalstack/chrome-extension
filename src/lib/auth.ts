/** Signing in — runs in the background service worker only.
 *
 *  Two ways in, one credential: an API key, kept in chrome.storage.local
 *  (never synced, never shown to a page).
 *
 *  1. Sign in with VocalStack: One-click Connect (transcribe: docs/connect.md),
 *     OAuth 2.0 authorization code + PKCE where the token is an API key.
 *     chrome.identity.launchWebAuthFlow opens the dashboard's /connect
 *     screen in a browser window; the person signs in there if needed and
 *     clicks Authenticate; the dashboard redirects to
 *     https://<extension id>.chromiumapp.org/connect?code=…&state=…, which
 *     the browser hands back to us instead of loading. We redeem the code
 *     with the verifier at POST /v1/connect/token.
 *  2. Paste an API key (Developers → API keys).
 *
 *  The key itself is never sent to /v1: a browser's key is refused there
 *  (auth::key_origin_check). We exchange it at POST /docs/key-exchange,
 *  which trusts this extension's Origin, for a 15-minute key token that
 *  carries the key's account and scopes, and call /v1 with that. */

import { currentEnv, type Env } from './env';

export interface Account {
  /** The account's display name, as Connect or the key exchange named it. */
  name: string;
  keyId: string;
  via: 'connect' | 'key';
  scopes: string[];
}

interface Stored {
  key: string;
  account: Account;
  /** The environment the key belongs to: a key never crosses environments. */
  env: string;
}

interface KeyToken {
  token: string;
  /** ms since epoch */
  expiresAt: number;
  env: string;
}

const CRED = 'credential';
const TOKEN = 'keyToken';
/** Exchange again this long before the token runs out. */
const MARGIN_MS = 90_000;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge: b64url(digest) };
}

export class AuthError extends Error {
  constructor(message: string, readonly code = 'auth') {
    super(message);
  }
}

async function stored(): Promise<Stored | null> {
  const got = await chrome.storage.local.get(CRED);
  const s = got[CRED] as Stored | undefined;
  const env = await currentEnv();
  return s && s.env === env.name ? s : null;
}

export async function account(): Promise<Account | null> {
  return (await stored())?.account ?? null;
}

/** Sign in with VocalStack (One-click Connect). */
export async function signInWithConnect(): Promise<Account> {
  const env = await currentEnv();
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const redirectUri = chrome.identity.getRedirectURL('connect');
  const url = new URL('/connect', env.app);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_name: 'VocalStack extension',
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'read write',
  }).toString();

  let back: string | undefined;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  } catch (e) {
    // The window was closed, or the dashboard could not be reached.
    throw new AuthError(/did not approve|closed|canceled|cancelled/i.test(String(e)) ? 'Sign-in was cancelled.' : `Sign-in did not finish: ${String((e as Error)?.message ?? e)}`, 'cancelled');
  }
  if (!back) throw new AuthError('Sign-in was cancelled.', 'cancelled');
  const answer = new URL(back).searchParams;
  if (answer.get('state') !== state) throw new AuthError('The sign-in answer did not match this request. Try again.');
  if (answer.get('error') === 'access_denied') throw new AuthError('You cancelled on the VocalStack screen.', 'cancelled');
  const code = answer.get('code');
  if (!code) throw new AuthError(answer.get('error_description') ?? 'Sign-in did not return a code.');

  const res = await fetch(`${env.api}/v1/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new AuthError(body.error_description ?? body.error?.message ?? `Sign-in failed (${res.status}).`);
  }
  const acct: Account = { name: body.account?.name ?? 'VocalStack', keyId: body.key_id ?? '', via: 'connect', scopes: String(body.scope ?? '').split(/\s+/).filter(Boolean) };
  await save(env, body.access_token, acct);
  // Prove the key works now, and hold the first token.
  await exchange(env, body.access_token);
  return acct;
}

/** Sign in with a pasted API key. */
export async function signInWithKey(key: string): Promise<Account> {
  const env = await currentEnv();
  key = key.trim();
  if (!/^vs_key_/.test(key)) throw new AuthError('That is not a VocalStack API key: keys start with vs_key_.');
  const t = await exchange(env, key);
  const acct: Account = { name: t.keyName || 'API key', keyId: t.apiKeyId, via: 'key', scopes: t.scopes };
  await save(env, key, acct);
  return acct;
}

export async function signOut(): Promise<void> {
  await chrome.storage.local.remove(CRED);
  await chrome.storage.session.remove(TOKEN);
}

async function save(env: Env, key: string, account: Account) {
  const s: Stored = { key, account, env: env.name };
  await chrome.storage.local.set({ [CRED]: s });
}

interface Exchanged {
  token: string;
  expiresAt: string;
  apiKeyId: string;
  keyName: string;
  scopes: string[];
}

async function exchange(env: Env, key: string): Promise<Exchanged> {
  const res = await fetch(`${env.api}/docs/key-exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.message ?? `The key could not be checked (${res.status}).`;
    throw new AuthError(msg, res.status === 401 ? 'invalid_key' : 'auth');
  }
  const kt: KeyToken = { token: body.token, expiresAt: Date.parse(body.expiresAt), env: env.name };
  await chrome.storage.session.set({ [TOKEN]: kt });
  return body as Exchanged;
}

let pending: Promise<string> | null = null;

/** A key token for /v1, exchanged again when it is about to run out.
 *  Throws AuthError('signed_out') when there is no key. */
export async function accessToken(): Promise<string> {
  const env = await currentEnv();
  const got = await chrome.storage.session.get(TOKEN);
  const kt = got[TOKEN] as KeyToken | undefined;
  if (kt && kt.env === env.name && kt.expiresAt - Date.now() > MARGIN_MS) return kt.token;
  // One exchange at a time, however many calls ask at once.
  pending ??= (async () => {
    try {
      const s = await stored();
      if (!s) throw new AuthError('Sign in to VocalStack first.', 'signed_out');
      try {
        return (await exchange(env, s.key)).token;
      } catch (e) {
        // A revoked or deleted key: forget it, so the panel asks to sign in.
        if (e instanceof AuthError && e.code === 'invalid_key') await signOut();
        throw e;
      }
    } finally {
      pending = null;
    }
  })();
  return pending;
}
