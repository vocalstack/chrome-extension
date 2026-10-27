/** Transcriptions this panel started (from the page or from local files)
 *  and their jobs, polled every 3 s while any is still working. Lives as
 *  long as the panel does; screens read it with `useTracked`. */

import { useEffect, useState } from 'react';
import type { Transcription, TranscriptionJob } from '@vocalstack/contract';
import { client } from '../../lib/client';
import type { Problem } from './errors';

export type Phase = 'uploading' | 'sending' | 'working' | 'done' | 'failed' | 'live' | 'error';

export interface Tracked {
  key: string;
  origin: 'page' | 'file';
  name: string;
  /** The address it came from (page items), to mark them as started. */
  url?: string;
  /** What it is, for Upload's list: "MP3 · 12.4 MB · 03:12". */
  meta?: string;
  phase: Phase;
  /** Uploading: bytes sent of total. */
  sent?: number;
  total?: number;
  transcription?: Transcription;
  recordingId?: string;
  job?: TranscriptionJob;
  problem?: Problem;
  /** The person closed it (toasts). */
  hidden?: boolean;
}

let items: Tracked[] = [];
const subs = new Set<() => void>();
const emit = () => { items = [...items]; subs.forEach((f) => f()); schedule(); };

let n = 0;
export function track(t: Omit<Tracked, 'key'>): string {
  const key = `t${++n}`;
  items.push({ ...t, key });
  emit();
  return key;
}

export function patch(key: string, p: Partial<Tracked>): void {
  const i = items.findIndex((x) => x.key === key);
  if (i < 0) return;
  items[i] = { ...items[i]!, ...p };
  emit();
}

/** A transcription was made: follow its job, if it has one. */
export function created(key: string, t: Transcription): void {
  const recordingId = t.job?.recordingId ?? t.lastRecording?.recordingId ?? t.currentRecording?.recordingId ?? undefined;
  const job = t.job ?? undefined;
  patch(key, { transcription: t, recordingId, job, phase: job ? phaseOf(job) : recordingId ? 'working' : 'done' });
}

export function phaseOf(job: TranscriptionJob): Phase {
  if (job.state === 'done' || job.state === 'cropping') return 'done';
  if (job.state === 'failed' || job.state === 'stopped') return 'failed';
  return 'working';
}

/** Words for where a job is. */
export function jobText(job: TranscriptionJob | undefined): string {
  if (!job) return 'Starting…';
  const p = job.progress;
  switch (job.state) {
    case 'queued': return job.queue ? `Waiting · ${ordinal(job.queue.position)} in line` : 'Waiting to start';
    case 'fetching': return p?.fetchTotalBytes && p.fetchedBytes != null ? `Fetching · ${Math.round((p.fetchedBytes / p.fetchTotalBytes) * 100)}%` : 'Fetching the media';
    case 'transcribing': return `Transcribing · ${p?.pct ?? 0}%`;
    case 'done': return 'Done';
    case 'cropping': return 'Ready to trim in the dashboard';
    case 'stopped': return 'Stopped';
    case 'failed': return job.error || 'It didn’t work.';
  }
  return job.state;
}

/** 0–100 for a progress bar, or null when it can't be told. */
export function jobPct(job: TranscriptionJob | undefined): number | null {
  if (!job) return null;
  if (job.state === 'transcribing') return job.progress?.pct ?? 0;
  if (job.state === 'fetching' && job.progress?.fetchTotalBytes) return Math.round(((job.progress.fetchedBytes ?? 0) / job.progress.fetchTotalBytes) * 100);
  return null;
}

const ordinal = (k: number) => `${k}${k % 10 === 1 && k % 100 !== 11 ? 'st' : k % 10 === 2 && k % 100 !== 12 ? 'nd' : k % 10 === 3 && k % 100 !== 13 ? 'rd' : 'th'}`;

/* Polling: one timer for all, only while something is working. */
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
function schedule() {
  if (timer || polling || !items.some((x) => x.phase === 'working' && x.recordingId)) return;
  timer = setTimeout(poll, 3000);
}
async function poll() {
  timer = null;
  polling = true;
  try {
    const vs = await client();
    const working = items.filter((x) => x.phase === 'working' && x.recordingId);
    await Promise.all(working.map(async (x) => {
      try {
        const job = await vs.jobs.get(x.recordingId!);
        patchQuiet(x.key, { job, phase: phaseOf(job) });
      } catch {
        // A blip: the next round asks again.
      }
    }));
  } finally {
    polling = false;
    emit();
  }
}
function patchQuiet(key: string, p: Partial<Tracked>) {
  const i = items.findIndex((x) => x.key === key);
  if (i >= 0) items[i] = { ...items[i]!, ...p };
}

export function useTracked(origin?: Tracked['origin']): Tracked[] {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((k) => k + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return origin ? items.filter((x) => x.origin === origin) : items;
}
