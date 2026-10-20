/** API failures, worded for a person: plan and quota limits above all. */

import { errorText } from '../../ui/kit';

export interface Problem {
  text: string;
  /** The fix is in Billing (credit, plan, payment method). */
  billing?: boolean;
  /** The fix is the sign-in's permissions (Settings). */
  access?: boolean;
}

/** What each API scope lets the extension do, in plain words. */
const SCOPE_WORDS: Record<string, string> = {
  'recordings:publish': 'record or transcribe',
  write: 'create or change things',
  read: 'see your account',
};

/** "API key lacks the recordings:publish scope" (the API's 403), in plain
 *  words, or null when `said` is something else. */
export function scopeProblem(said: string): Problem | null {
  const m = /lacks the "?([\w:*]+)"?(?:,\s*"?([\w:*]+)"?)? scopes?/i.exec(said);
  if (!m) return null;
  const words = [m[1], m[2]].filter(Boolean).map((sc) => SCOPE_WORDS[sc!] ?? sc).join(' or ');
  return {
    text: `This sign-in isn’t allowed to ${words}. Open Settings to see what it may do and how to change it.`,
    access: true,
  };
}

export function problemOf(e: unknown): Problem {
  const err = e as { code?: string; status?: number; message?: string } | null;
  const code = err?.code;
  const said = errorText(e);
  const scope = scopeProblem(said);
  if (scope) return scope;
  switch (code) {
    case 'insufficient_credit': return { text: 'Not enough credit left for this. Top up or change your plan in Billing.', billing: true };
    case 'usage_cap_reached': return { text: 'Your usage cap for this period is reached. Raise it in Billing, or wait for the next period.', billing: true };
    case 'payment_method_required': return { text: 'Add a payment method in Billing first.', billing: true };
    case 'billing_details_required': return { text: 'Add your billing details in Billing first.', billing: true };
    case 'quota_exceeded': return { text: said || 'Your plan’s limit is reached.', billing: true };
    case 'rate_limited': return { text: said || 'Too many requests. Wait a minute and try again.' };
    case 'capacity_exceeded':
    case 'engine_unavailable':
    case 'unavailable': return { text: 'VocalStack is busy right now. Try again in a minute.' };
    case 'payload_too_large': return { text: 'This file is over the upload limit.' };
    case 'unsupported_media_type':
    case 'invalid_audio': return { text: said || 'This isn’t an audio or video file VocalStack can read.' };
    case 'suspended': return { text: 'This account is suspended. Contact support from the dashboard.' };
  }
  if (err?.status === 402) return { text: said || 'Your plan doesn’t cover this. See Billing.', billing: true };
  if (err?.status === 429) return { text: said || 'Too many at once. Wait a moment and try again.' };
  return { text: said || 'Something went wrong.' };
}
