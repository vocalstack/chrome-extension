/** Getting a dropped live connection back, as the dashboard does
 *  (transcribe: app/src/lib/publisherRetry.ts).
 *
 *  A server deploy closes every live socket (1012), a crash drops them with
 *  no close at all (1006), a network blip the same. The server holds a
 *  dropped publisher's place on its recording for a while (its
 *  `publisher.leaseExpiresAt`, at least 300 s), so the recording carries on
 *  once a new socket attaches. Pure: the steps and the clock are passed in. */

/** Quick tries first (a restart is back in seconds), then steady ones. */
export const FAST_STEPS_MS = [1000, 2000, 4000, 8000];
export const STEADY_MS = 15_000;
/** How long a dropped publisher is waited for at least. */
export const GRACE_MS = 300_000;
/** A little past the lease, for clocks that differ. */
export const LEASE_SLACK_MS = 15_000;

export function retryDelay(n: number): number {
  return n < FAST_STEPS_MS.length ? FAST_STEPS_MS[n]! : STEADY_MS;
}

export function retryDeadline(lostAt: number, leaseExpiresAt?: string | null): number {
  const lease = leaseExpiresAt ? Date.parse(leaseExpiresAt) : NaN;
  return Math.max(lostAt + GRACE_MS, Number.isFinite(lease) ? lease + LEASE_SLACK_MS : 0);
}

export interface RecordingCheck { state: string; publisher?: { leaseExpiresAt?: string | null } | null }

export type Outcome = 'reconnected' | 'ended' | 'stopped' | 'timed_out';

export interface Steps {
  now(): number;
  wait(ms: number): Promise<void>;
  /** The person stopped it meanwhile. */
  stopped(): boolean;
  /** The recording as the server has it now. */
  check(): Promise<RecordingCheck>;
  /** One try at a new socket: true once it is attached; throws if not. */
  attempt(): Promise<boolean>;
  /** An error no later try can get past (refused, not found). */
  final(e: unknown): boolean;
}

/** Tries until a socket attaches, the recording ends, the person stops,
 *  or the server's hold on the publisher runs out. */
export async function reconnect(lostAt: number, s: Steps): Promise<{ outcome: Outcome; last: unknown }> {
  let deadline = retryDeadline(lostAt);
  let last: unknown = null;
  for (let n = 0; ; n++) {
    if (s.stopped()) return { outcome: 'stopped', last };
    const left = deadline - s.now();
    if (left <= 0) return { outcome: 'timed_out', last };
    await s.wait(Math.min(retryDelay(n), left));
    if (s.stopped()) return { outcome: 'stopped', last };
    let rec: RecordingCheck;
    try {
      rec = await s.check();
    } catch (e) {
      last = e;
      if (s.final(e)) return { outcome: 'ended', last };
      continue;
    }
    if (!['live', 'pending', 'paused'].includes(rec.state)) return { outcome: 'ended', last };
    deadline = Math.max(deadline, retryDeadline(lostAt, rec.publisher?.leaseExpiresAt));
    if (s.stopped()) return { outcome: 'stopped', last };
    try {
      if (await s.attempt()) return { outcome: 'reconnected', last: null };
    } catch (e) {
      last = e;
      if (s.final(e)) return { outcome: 'ended', last };
    }
  }
}

/** A transcript subscription that dropped is opened again after this many
 *  ms: quick at first, slower when it keeps dropping (a device that can't
 *  keep up is closed by the server again and again). */
export function resubscribeDelay(dropsInARow: number): number {
  return [2000, 5000, 15_000][dropsInARow] ?? 30_000;
}
