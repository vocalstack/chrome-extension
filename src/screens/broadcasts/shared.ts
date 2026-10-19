/** Broadcasts: the link rules the API applies (transcribe:
 *  src/domain/codes.rs, src/domain/broadcasts.rs), and the panel's view of
 *  this browser's live sessions. */

import { useEffect, useState } from 'react';
import { onPush, rpc } from '../../lib/rpc';
import type { LiveStatus } from '../../lib/live';

export const CODE_MIN = 3;
export const CODE_MAX = 48;
export const PASSWORD_MIN = 4;
export const NAME_MAX = 120;

/** `codes::RESERVED`: links the dashboard and the API keep for themselves. */
const RESERVED = new Set([
  'api', 'docs', 'admin', 'www', 'health', 'v1', 'v2', 'internal', 'static', 'assets',
  'login', 'logout', 'signup', 'auth', 'callback', 'settings', 'account', 'sessions',
  'session', 'recordings', 'recording', 'search', 'join', 'new', 'about', 'pricing',
  'support', 'help', 'terms', 'privacy', 'app', 'mobile', 'ios', 'android', 'live',
  'vocalstack', 'null', 'undefined', 'root', 'system', 'status', 'metrics',
  'broadcasts', 'transcriptions', 'voices', 'developers', 'billing',
  'notifications', 'profile', 'dashboard', 'connect',
]);

/** What is wrong with a link, in the API's words (`codes::normalize`), or null. */
export function codeProblem(raw: string): string | null {
  const code = raw.trim().toLowerCase();
  if (code.length < CODE_MIN) return `Use at least ${CODE_MIN} characters.`;
  if (code.length > CODE_MAX) return `Use at most ${CODE_MAX} characters.`;
  if (!/^[a-z0-9-]+$/.test(code) || code.startsWith('-') || code.endsWith('-') || code.includes('--')) {
    return 'Use lowercase letters, digits and single hyphens, not at the start or end.';
  }
  if (RESERVED.has(code)) return 'That link is reserved. Choose another.';
  return null;
}

/** The link the API makes from a name when none is given (`codes::slugify`). */
export function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s/._-]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
    .slice(0, CODE_MAX)
    .replace(/-+$/, '');
}

/** A 409 on a link: the API's suggestions (possibly none). null when `e` is something else. */
export function linkConflict(e: unknown): string[] | null {
  const x = e as { code?: string; status?: number; details?: { suggestions?: unknown } } | null;
  if (!x || (x.code !== 'conflict' && x.status !== 409)) return null;
  const s = x.details?.suggestions;
  return Array.isArray(s) ? s.filter((v): v is string => typeof v === 'string') : [];
}

const ACTIVE: LiveStatus['state'][] = ['starting', 'warming', 'live', 'paused', 'stopping'];

export function isActive(s: LiveStatus | undefined): s is LiveStatus {
  return !!s && ACTIVE.includes(s.state);
}

/** This browser's live sessions, kept current from `live.status` pushes. */
export function useLiveSessions(): [LiveStatus[], (s: LiveStatus) => void] {
  const [all, setAll] = useState<LiveStatus[]>([]);
  const merge = (s: LiveStatus) => setAll((xs) => [...xs.filter((x) => x.id !== s.id), s]);
  useEffect(() => {
    rpc('live.list').then((xs) => setAll((cur) => {
      const seen = new Set(cur.map((c) => c.id));
      return [...cur, ...xs.filter((x) => !seen.has(x.id))];
    }), () => {});
    return onPush((p) => { if (p.push === 'live.status') merge(p.status); });
  }, []);
  return [all, merge];
}

/** The latest session of this browser in a broadcast. */
export function sessionOf(all: LiveStatus[], broadcastId: string): LiveStatus | undefined {
  return all
    .filter((s) => s.mode === 'broadcast' && s.broadcastId === broadcastId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}
