import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectUrl } from './connect.ts';

const ask = { redirectUri: 'https://oaenfiioponhlnnemllhgdmgdmaceilk.chromiumapp.org/connect', state: 'st4te', challenge: 'ch4llenge' };

test('the consent screen is asked as before when no workspace is known', () => {
  const u = new URL(connectUrl('https://app.vocalstack.com', ask));
  assert.equal(u.origin + u.pathname, 'https://app.vocalstack.com/connect');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    response_type: 'code',
    client_name: 'VocalStack extension',
    redirect_uri: ask.redirectUri,
    state: 'st4te',
    code_challenge: 'ch4llenge',
    code_challenge_method: 'S256',
    scope: 'read write recordings:publish',
    reach: 'account',
  });
  assert.equal(new URL(connectUrl('https://app.vocalstack.com', { ...ask, workspaceId: null })).searchParams.has('workspace'), false);
  assert.equal(new URL(connectUrl('https://app.vocalstack.com', { ...ask, workspaceId: '' })).searchParams.has('workspace'), false);
});

test('a known workspace is named, so the picker starts on it', () => {
  const id = '0190a0c2-7d1e-7c55-9a41-5f3d2b6e8c10';
  const u = new URL(connectUrl('http://localhost:5176', { ...ask, workspaceId: id }));
  assert.equal(u.origin + u.pathname, 'http://localhost:5176/connect');
  assert.equal(u.searchParams.get('workspace'), id);
  assert.equal(u.searchParams.get('state'), 'st4te');
  assert.equal(u.searchParams.getAll('workspace').length, 1);
});
