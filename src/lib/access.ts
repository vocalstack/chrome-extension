/** What the signed-in key may do, from the scopes its last key exchange
 *  reported (lib/auth.ts keeps them current). The API decides in the
 *  end; this only lets the panel say so before a click fails.
 *
 *  - `change`: create and change things (`write`);
 *  - `record`: record, transcribe a page or a file, go live in a
 *    broadcast (`write` and `recordings:publish`: `POST /v1/transcriptions`
 *    and every recording start, pause and stop need both). */

import type { Account } from './auth';

export type Need = 'change' | 'record';

function has(a: Account, scope: string): boolean {
  // No scopes known yet (a credential saved before they were kept): let
  // the API answer.
  if (!a.scopes.length) return true;
  return a.scopes.includes('*') || a.scopes.includes(scope);
}

export function can(a: Account | null | undefined, need: Need): boolean {
  if (!a) return false;
  if (need === 'change') return has(a, 'write');
  return has(a, 'write') && has(a, 'recordings:publish');
}

/** Why the key cannot do `need`, and how to change that, in plain words. */
export function whyNot(a: Account, need: Need, inSettings = false): string {
  const what = need === 'record' ? 'record, transcribe or go live' : 'make changes';
  if (a.via === 'connect') {
    return `This sign-in may not ${what}: you gave the extension ${!has(a, 'write') ? 'see-only' : 'see-and-change'} access. ${inSettings ? 'Sign out below' : 'Sign out in Settings'} and sign in again, choosing “See, change and record”.`;
  }
  return need === 'record'
    ? `This API key may not ${what}. Turn on “Stream audio” and “Write” for it in the dashboard under Developers → API keys, or sign in with another key.`
    : `This API key may not ${what}. Turn on “Write” for it in the dashboard under Developers → API keys, or sign in with another key.`;
}

/** The access, in the words of the consent screen. */
export function accessLabel(a: Account): string {
  if (a.scopes.includes('*')) return 'Full access';
  if (!a.scopes.length) return 'See, change and record';
  if (can(a, 'record')) return 'See, change and record';
  if (can(a, 'change')) return 'See and change';
  return 'See only';
}
