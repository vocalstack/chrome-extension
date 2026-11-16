import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOLDOWN_MS, CHROME_ID, EDGE_ID, FRESH, MIN_AGE_MS, eligible, storeUrl, summaryParts, type RateState } from './rate.ts';

const NOW = 1_800_000_000_000;
const good = (p: Partial<RateState> = {}): RateState => ({ ...FRESH(NOW - MIN_AGE_MS - 1), videos: 3, slowMs: 9_000, usedAt: NOW - 60_000, ...p });

test('a happy, recent user is asked', () => {
  assert.equal(eligible(good(), NOW), 'ok');
});

test('any failure, a slow first line, or too few videos: never asked', () => {
  assert.equal(eligible(good({ failed: 1 }), NOW), 'failed');
  assert.equal(eligible(good({ slowMs: 45_000 }), NOW), 'slow');
  assert.equal(eligible(good({ slowMs: 44_999 }), NOW), 'ok');
  assert.equal(eligible(good({ videos: 2, files: 9 }), NOW), 'few');
});

test('not in the first 3 days, nor long after using a result', () => {
  assert.equal(eligible(good({ since: NOW - 1000 }), NOW), 'young');
  assert.equal(eligible(good({ usedAt: NOW - 11 * 60_000 }), NOW), 'unused');
});

test('at most 2 asks, 30 days apart, with new work between; never after Rate', () => {
  assert.equal(eligible(good({ asks: 1, lastAskAt: NOW - 1000, askedAt: 2 }), NOW), 'cooldown');
  assert.equal(eligible(good({ asks: 1, lastAskAt: NOW - COOLDOWN_MS - 1, askedAt: 3 }), NOW), 'unchanged');
  assert.equal(eligible(good({ asks: 1, lastAskAt: NOW - COOLDOWN_MS - 1, askedAt: 2 }), NOW), 'ok');
  assert.equal(eligible(good({ asks: 2 }), NOW), 'done');
  assert.equal(eligible(good({ done: true }), NOW), 'done');
});

test('the summary drops zero counts and says one in the singular', () => {
  assert.deepEqual(summaryParts({ videos: 14, files: 3 }), [{ n: 14, word: 'videos' }, { n: 3, word: 'files' }]);
  assert.deepEqual(summaryParts({ videos: 1, files: 0 }), [{ n: 1, word: 'video' }]);
});

test('the store comes from the install, and an unpacked copy has none', () => {
  assert.equal(storeUrl(CHROME_ID, 'https://clients2.google.com/service/update2/crx'), `https://chromewebstore.google.com/detail/${CHROME_ID}/reviews`);
  assert.equal(storeUrl(EDGE_ID, 'https://edge.microsoft.com/extensionwebstorebase/v1/crx'), `https://microsoftedge.microsoft.com/addons/detail/${EDGE_ID}`);
  assert.equal(storeUrl(CHROME_ID, undefined), null);
});
