/** What a person reads when something fails: never the backend's or the
 *  browser's technical text. Every part of the extension words its
 *  errors here, where they happen (the background, the audio page) and
 *  where they show (the panel).
 *
 *  - The extension's own errors (`RpcError`, the audio page's `Coded`,
 *    `AuthError`) are already worded for a person: their text is kept.
 *  - An API error (`VocalStackError`) is worded by its `code`: the API's
 *    `message` only for codes about what the person sent or may do, and
 *    fixed copy for the rest (an outage, a timeout, a code this build
 *    does not know).
 *  - A network failure says so; anything else is a fault in the
 *    extension (lib/sentry.ts reports it), and says only that it failed. */

export const OFFLINE = 'Can’t reach VocalStack. Check your connection.';
export const GENERIC = 'Something went wrong. Try again.';

/** The extension's own error classes, by `name` (it survives bundling). */
const OWN = new Set(['RpcError', 'Coded', 'AuthError']);

/** API codes whose `message` is about the person's own request or
 *  permissions, in plain words: shown as the API says it. */
const SAID = new Set([
  'invalid_audio', 'invalid_options', 'invalid_body', 'not_found', 'conflict', 'invalid_state',
  'password_required', 'forbidden', 'broadcast_archived', 'language_unavailable', 'preview_pending',
  'promo_code_invalid', 'range_too_long', 'quota_exceeded', 'payload_too_large', 'unsupported_media_type',
  'payment_method_in_use', 'auto_top_up_off', 'terms_acceptance_required',
  'insufficient_credit', 'usage_cap_reached', 'payment_method_required', 'billing_details_required',
]);

/** API codes with copy of their own. */
const FIXED: Record<string, string> = {
  internal: 'Something went wrong at VocalStack. Try again in a minute.',
  unavailable: 'VocalStack is busy right now. Try again in a minute.',
  engine_unavailable: 'VocalStack is busy right now. Try again in a minute.',
  capacity_exceeded: 'VocalStack is busy right now. Try again in a minute.',
  timeout: 'VocalStack took too long to answer. Try again.',
  slow_consumer: 'The connection was too slow to keep up. Try again.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  invalid_token: 'Your sign-in has expired. Sign in again in Settings.',
  session_expired: 'Your sign-in has expired. Sign in again in Settings.',
  key_expired: 'This API key has expired. Sign in again with a new one.',
  key_revoked: 'This API key was revoked. Sign in again with a new one.',
  suspended: 'This account is suspended. Contact support from the dashboard.',
};

/** An error from the VocalStack API (the SDK's `VocalStackError`). */
export function isApiError(e: unknown): e is Error & { code: string; status?: number; requestId?: string } {
  return e instanceof Error && e.name === 'VocalStackError' && typeof (e as { code?: unknown }).code === 'string';
}

/** fetch() could not reach the server (offline, DNS, blocked). */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError && /failed to fetch|networkerror|load failed|network request failed/i.test(e.message);
}

/** The extension's own, already worded error. */
export function isOwnError(e: unknown): e is Error {
  return e instanceof Error && OWN.has(e.name);
}

/** A fault in the extension: not the API's answer, not the network, not
 *  one of its own worded errors. */
export function isFault(e: unknown): boolean {
  return !!e && !isApiError(e) && !isNetworkError(e) && !isOwnError(e);
}

/** An API error's words, by its code. */
export function apiText(code: string, message: string): string {
  if (FIXED[code]) return FIXED[code];
  if (SAID.has(code) && message) return message;
  return GENERIC;
}

/** An error, worded for a person. */
export function userText(e: unknown): string {
  if (!e) return '';
  if (isApiError(e)) return apiText(e.code, e.message);
  if (isNetworkError(e)) return OFFLINE;
  if (isOwnError(e)) return e.message;
  return GENERIC;
}

/** A failure sent between the extension's parts (an rpc reply, the audio
 *  page's answer): already worded, with what the panel maps on. */
export interface Failure { ok: false; error: string; code?: string; status?: number; requestId?: string }

export function failure(e: unknown): Failure {
  const x = (e ?? {}) as { code?: unknown; status?: unknown; requestId?: unknown };
  return {
    ok: false,
    error: userText(e) || GENERIC,
    code: typeof x.code === 'string' ? x.code : undefined,
    status: typeof x.status === 'number' ? x.status : undefined,
    requestId: typeof x.requestId === 'string' ? x.requestId : undefined,
  };
}
