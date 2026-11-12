import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceHue, workspaceInitials } from './workspaceMark.ts';

test('a two-word workspace shows the first letter of each word', () => {
  assert.equal(workspaceInitials('Acme studio'), 'AS');
  assert.equal(workspaceInitials('  north   radio  live '), 'NR');
});

test('a one-word workspace shows its first two letters', () => {
  assert.equal(workspaceInitials('Podcast'), 'PO');
  assert.equal(workspaceInitials('X'), 'X');
});

test('punctuation and emoji-only words are skipped', () => {
  assert.equal(workspaceInitials('— Church & choir'), 'CC');
  assert.equal(workspaceInitials('"Évora" talks'), 'ÉT');
  assert.equal(workspaceInitials('   '), '?');
});

test('the same workspace always gets the same colour', () => {
  assert.equal(workspaceHue('ws_1'), workspaceHue('ws_1'));
  const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(workspaceHue));
  assert.ok(seen.size > 2);
});
