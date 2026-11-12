import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitPlay, playOf } from './play.ts';

const file = (state: string, over: object = {}) => ({ id: 'tx1', name: 'Talk.mp4', live: false, job: { state, recordingId: 'rec1' }, ...over });
const live = (over: object = {}) => ({ id: 'tx2', name: 'Meet · standup', live: true, job: null, ...over });

test('a finished file or link plays its job’s recording', () => {
  assert.deepEqual(playOf(file('done')), { target: { transcriptionId: 'tx1', recordingId: 'rec1', name: 'Talk.mp4', path: '/transcriptions/tx1' } });
});

test('a file still on its way has nothing to play yet', () => {
  for (const s of ['queued', 'fetching', 'transcribing']) assert.deepEqual(playOf(file(s)), { why: 'working' });
});

test('a failed or stopped file, and one waiting to be trimmed, do not play', () => {
  assert.deepEqual(playOf(file('failed')), { why: 'failed' });
  assert.deepEqual(playOf(file('stopped')), { why: 'failed' });
  assert.deepEqual(playOf(file('cropping')), { why: 'trim' });
});

test('a live transcription plays its newest finished take', () => {
  const t = live({ lastRecording: { state: 'finalized', recordingId: 'rec9' } });
  assert.deepEqual(playOf(t), { target: { transcriptionId: 'tx2', recordingId: 'rec9', name: 'Meet · standup', path: '/transcriptions/tx2/r/rec9' } });
  assert.equal(playOf(live({ lastRecording: { state: 'ended', recordingId: 'rec9' } })).target?.recordingId, 'rec9');
});

test('one being recorded now does not play, whatever it recorded before', () => {
  for (const s of ['pending', 'live', 'paused']) {
    assert.deepEqual(playOf(live({ currentRecording: { state: s, recordingId: 'rec10' }, lastRecording: { state: s, recordingId: 'rec10' } })), { why: 'live' });
  }
});

test('a take still being finished is working; a live transcription never recorded is empty', () => {
  assert.deepEqual(playOf(live({ currentRecording: { state: 'processing', recordingId: 'r' }, lastRecording: { state: 'processing', recordingId: 'r' } })), { why: 'working' });
  assert.deepEqual(playOf(live({ lastRecording: { state: 'processing', recordingId: 'r' } })), { why: 'working' });
  assert.deepEqual(playOf(live()), { why: 'empty' });
  assert.deepEqual(playOf(live({ lastRecording: null })), { why: 'empty' });
});

test('a disabled transcription does not play', () => {
  assert.deepEqual(playOf(file('done', { blocked: { reason: 'x' } })), { why: 'blocked' });
});

test('a search hit plays at its line, with the words marked', () => {
  const h = { transcriptionId: 'tx1', recordingId: 'rec1', mediaStart: 42.5, live: false, linkName: 'Talk.mp4' };
  assert.deepEqual(hitPlay(h, new Set(), ' budget ', '/transcriptions/tx1/r/rec1?q=budget#s=7'), { transcriptionId: 'tx1', recordingId: 'rec1', name: 'Talk.mp4', startAt: 42.5, find: 'budget', path: '/transcriptions/tx1/r/rec1?q=budget#s=7' });
  assert.equal(hitPlay({ ...h, mediaStart: -1 }, new Set(), '', '/p')?.startAt, 0);
  assert.equal('find' in hitPlay(h, new Set(), '  ', '/p')!, false);
});

test('a hit in a recording still going, or in a broadcast’s own, opens in the Dashboard', () => {
  const h = { transcriptionId: 'tx1', recordingId: 'rec1', mediaStart: 3, live: false, linkName: 'x' };
  assert.equal(hitPlay({ ...h, live: true }, new Set(), 'q', '/p'), null);
  assert.equal(hitPlay(h, new Set(['tx1']), 'q', '/p'), null);
});
