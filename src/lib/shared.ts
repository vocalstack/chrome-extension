/** VocalStack's video player and shared transcripts: which addresses are
 *  VocalStack's own, a share link's code in one, and where a shared
 *  transcription's job is, read by its code with no sign-in (the
 *  player's own call). */

import type { TranscriptionJob } from '@vocalstack/contract';
import { ENVS, type Env } from './env';

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** VocalStack's own pages: the video player, shared transcripts, the dashboard. */
const OWN_HOSTS = new Set(Object.values(ENVS).flatMap((e) => [e.app, e.live, e.video].map(host)));
export const isOwn = (u: string | undefined) => !!u && (/^https?:\/\/(?:[\w-]+\.)*vocalstack\.com(?:[:/]|$)/i.test(u) || OWN_HOSTS.has(host(u)));

/** The environment an own page belongs to (production for any other vocalstack.com). */
export const envOfPage = (u: string): Env => Object.values(ENVS).find((e) => [e.app, e.live, e.video].map(host).includes(host(u))) ?? ENVS.production;

/** A shared transcription's code in a VocalStack address: the video
 *  player's `/<code>`, or the app's `/t/<code>` and `/v/<code>`. */
export const shareCode = (u: string) => { try { return new URL(u).pathname.match(/^\/(?:[tv]\/)?([a-z0-9]{8,})\/?$/i)?.[1] ?? null; } catch { return null; } };

/** The shared transcription's job (null: none, or no longer running a
 *  job), or 'gone' once the link is revoked or the transcription removed. */
export async function sharedJob(api: string, code: string): Promise<TranscriptionJob | null | 'gone'> {
  const r = await fetch(`${api}/app/shared/${encodeURIComponent(code)}`);
  if (r.status === 404 || r.status === 410) return 'gone';
  if (!r.ok) throw new Error(`shared ${r.status}`);
  return ((await r.json()) as { job?: TranscriptionJob | null }).job ?? null;
}

/** A video's place on the player: its link, and its job in plain words. */
export interface PlayerState {
  link: string;
  phase: 'working' | 'ready' | 'failed';
  /** 0–100, or null when it can't be told (waiting, starting). */
  pct: number | null;
  /** What the job is doing: Waiting to start, Fetching the video, Transcribing. */
  step: string;
  error?: string;
}

/** 0–100 for a progress bar, or null when it can't be told. */
export function jobPct(job: TranscriptionJob | undefined): number | null {
  if (!job) return null;
  if (job.state === 'transcribing') return job.progress?.pct ?? 0;
  if (job.state === 'fetching' && job.progress?.fetchTotalBytes) return Math.round(((job.progress.fetchedBytes ?? 0) / job.progress.fetchTotalBytes) * 100);
  return null;
}

export function playerState(link: string, job: TranscriptionJob | null): PlayerState {
  if (!job || job.state === 'done' || job.state === 'cropping') return { link, phase: 'ready', pct: 100, step: 'Ready' };
  if (job.state === 'failed' || job.state === 'stopped') return { link, phase: 'failed', pct: null, step: 'Not transcribed', error: job.error || 'VocalStack could not transcribe this video.' };
  return { link, phase: 'working', pct: jobPct(job), step: job.state === 'queued' ? 'Waiting to start' : job.state === 'fetching' ? 'Fetching the video' : 'Transcribing' };
}
