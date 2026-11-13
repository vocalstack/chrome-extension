import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitPlay, playOf } from './play.ts';

const file = (state: string, over: object = {}) => ({ id: 'tx1', name: 'Talk.mp4', live: false, job: { state, transcriptionId: 'tx1' }, ...over });
const live = (over: object = {}) => ({ id: 'tx2', name: 'Meet · standup', live: true, job: null, ...over });

test('a finished file or link plays its transcription', () => {
  assert.deepEqual(playOf(file('done')), { target: { transcriptionId: 'tx1', name: 'Talk.mp4', path: '/transcriptions/tx1' } });
});

test('a file still on its way has nothing to play yet', () => {
  for (const s of ['queued', 'fetching', 'transcribing']) assert.deepEqual(playOf(file(s)), { why: 'working' });
});

test('a failed or stopped file, and one waiting to be trimmed, do not play', () => {
  assert.deepEqual(playOf(file('failed')), { why: 'failed' });
  assert.deepEqual(playOf(file('stopped')), { why: 'failed' });
  assert.deepEqual(playOf(file('cropping')), { why: 'trim' });
});

test('a finished live transcription plays, on its transcription page', () => {
  assert.deepEqual(playOf(live({ state: 'finalized' })), { target: { transcriptionId: 'tx2', name: 'Meet · standup', path: '/transcriptions/tx2' } });
  assert.equal(playOf(live({ state: 'ended' })).target?.transcriptionId, 'tx2');
});

test('one being recorded now does not play', () => {
  for (const s of ['pending', 'live', 'paused']) assert.deepEqual(playOf(live({ state: s })), { why: 'live' });
});

test('one still being finished is working; a live transcription never started is empty', () => {
  assert.deepEqual(playOf(live({ state: 'processing' })), { why: 'working' });
  assert.deepEqual(playOf(live({ state: 'idle' })), { why: 'empty' });
  assert.deepEqual(playOf(live()), { why: 'empty' });
  assert.deepEqual(playOf(live({ state: null })), { why: 'empty' });
});

test('a disabled transcription does not play', () => {
  assert.deepEqual(playOf(file('done', { blocked: { reason: 'x' } })), { why: 'blocked' });
});

test('a search hit plays at its line, with the words marked', () => {
  const h = { transcriptionId: 'tx1', mediaStart: 42.5, live: false, linkName: 'Talk.mp4' };
  assert.deepEqual(hitPlay(h, new Set(), ' budget ', '/transcriptions/tx1?q=budget#s=7'), { transcriptionId: 'tx1', name: 'Talk.mp4', startAt: 42.5, find: 'budget', path: '/transcriptions/tx1?q=budget#s=7' });
  assert.equal(hitPlay({ ...h, mediaStart: -1 }, new Set(), '', '/p')?.startAt, 0);
  assert.equal('find' in hitPlay(h, new Set(), '  ', '/p')!, false);
});

test('a hit in a transcription still going, or in a broadcast’s own, opens in the Dashboard', () => {
  const h = { transcriptionId: 'tx1', mediaStart: 3, live: false, linkName: 'x' };
  assert.equal(hitPlay({ ...h, live: true }, new Set(), 'q', '/p'), null);
  assert.equal(hitPlay(h, new Set(['tx1']), 'q', '/p'), null);
});
