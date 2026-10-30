import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionState } from './version.ts';

test('a newer patch is an update', () => {
  assert.equal(versionState('0.1.41', '0.1.42'), 'available');
  assert.equal(versionState('0.1.9', '0.1.10'), 'available');
});

test('a newer minor deprecates, a newer major unsupports', () => {
  assert.equal(versionState('0.1.41', '0.2.43'), 'deprecated');
  assert.equal(versionState('0.1.41', '1.0.43'), 'unsupported');
  assert.equal(versionState('0.9.50', '1.0.51'), 'unsupported');
});

test('the same, or newer than the release, is current', () => {
  assert.equal(versionState('0.1.41', '0.1.41'), 'current');
  assert.equal(versionState('0.1.45', '0.1.41'), 'current');
  assert.equal(versionState('0.2.45', '0.1.50'), 'current');
  assert.equal(versionState('1.0.1', '0.9.9'), 'current');
  assert.equal(versionState('0.1.41', null), 'current');
});

test('a tag with a v reads the same', () => {
  assert.equal(versionState('0.1.41', 'v0.1.42'), 'available');
});
