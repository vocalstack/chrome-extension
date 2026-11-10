import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRACE_MS, reconnect, resubscribeDelay, retryDeadline, retryDelay, type Steps } from './reconnect.ts';

/** A fake clock: `wait` moves it on. */
function steps(over: Partial<Steps> & { log?: number[] }): Steps & { t: number } {
  const s: Steps & { t: number } = {
    t: 0,
    now: () => s.t,
    wait: async (ms: number) => { s.t += ms; over.log?.push(ms); },
    stopped: () => false,
    check: async () => ({ state: 'live' }),
    attempt: async () => true,
    final: () => false,
    ...over,
  };
  return s;
}

test('quick tries first, then every 15 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelay), [1000, 2000, 4000, 8000, 15000, 15000]);
});

test('the deadline is the grace, or the lease past it', () => {
  assert.equal(retryDeadline(1000), 1000 + GRACE_MS);
  assert.equal(retryDeadline(0, new Date(600_000).toISOString()), 615_000);
  assert.equal(retryDeadline(0, 'nonsense'), GRACE_MS);
});

test('a socket that attaches on the third try reconnects', async () => {
  let n = 0;
  const log: number[] = [];
  const r = await reconnect(0, steps({ log, attempt: async () => { if (++n < 3) throw new Error('refused'); return true; } }));
  assert.equal(r.outcome, 'reconnected');
  assert.deepEqual(log, [1000, 2000, 4000]);
});

test('an ended recording is not reconnected', async () => {
  let tried = false;
  const r = await reconnect(0, steps({ check: async () => ({ state: 'ended' }), attempt: async () => { tried = true; return true; } }));
  assert.equal(r.outcome, 'ended');
  assert.equal(tried, false);
});

test('a paused recording is still reconnected (the person paused it)', async () => {
  const r = await reconnect(0, steps({ check: async () => ({ state: 'paused' }) }));
  assert.equal(r.outcome, 'reconnected');
});

test('a final refusal stops at once', async () => {
  const r = await reconnect(0, steps({ attempt: async () => { throw Object.assign(new Error('no'), { status: 403 }); }, final: (e) => (e as { status?: number }).status === 403 }));
  assert.equal(r.outcome, 'ended');
});

test('stopped meanwhile: no more tries', async () => {
  let stop = false;
  const r = await reconnect(0, steps({ stopped: () => stop, check: async () => { stop = true; return { state: 'live' }; } }));
  assert.equal(r.outcome, 'stopped');
});

test('it gives up once the hold runs out, but not before the lease', async () => {
  const lease = new Date(GRACE_MS + 120_000).toISOString();
  const s = steps({ check: async () => ({ state: 'live', publisher: { leaseExpiresAt: lease } }), attempt: async () => { throw new Error('busy'); } });
  const r = await reconnect(0, s);
  assert.equal(r.outcome, 'timed_out');
  assert.equal(s.t, GRACE_MS + 120_000 + 15_000);
});

test('a subscription that keeps dropping waits longer each time', () => {
  assert.deepEqual([0, 1, 2, 3, 8].map(resubscribeDelay), [2000, 5000, 15000, 30000, 30000]);
});
