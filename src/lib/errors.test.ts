import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC, OFFLINE, failure, isFault, isRefusedAccess, userText } from './errors.ts';

const api = (code: string, message: string) => Object.assign(new Error(message), { name: 'VocalStackError', code, status: 500 });
const own = (message: string) => Object.assign(new Error(message), { name: 'RpcError' });

test('an API error is worded by its code, never with its technical text', () => {
  assert.equal(userText(api('internal', 'panicked at src/worker.rs:42')), 'Something went wrong at VocalStack. Try again in a minute.');
  assert.equal(userText(api('engine_unavailable', 'no engine on gpu-3')), 'VocalStack is busy right now. Try again in a minute.');
  assert.equal(userText(api('some_new_code', 'detail')), GENERIC);
  assert.equal(userText(api('invalid_options', 'Pick a language this plan includes.')), 'Pick a language this plan includes.');
});

test('a network failure says so; a fault says only that it failed', () => {
  assert.equal(userText(new TypeError('Failed to fetch')), OFFLINE);
  assert.equal(userText(new TypeError('Cannot read properties of undefined (reading "id")')), GENERIC);
  assert.equal(isFault(new TypeError('x is undefined')), true);
  assert.equal(isFault(api('internal', '')), false);
  assert.equal(isFault(new TypeError('Failed to fetch')), false);
});

test('the extension’s own errors keep their words, and carry the code across a reply', () => {
  assert.equal(userText(own('Click the VocalStack icon first.')), 'Click the VocalStack icon first.');
  const f = failure(Object.assign(api('insufficient_credit', 'Not enough credit.'), { status: 402, requestId: 'req_1' }));
  assert.deepEqual(f, { ok: false, error: 'Not enough credit.', code: 'insufficient_credit', status: 402, requestId: 'req_1' });
});

test('an error not named as the extension\'s own is worded generically, so worded ones must be', () => {
  const store = 'The browser’s extension store can’t be read. Open a web page with audio or video.';
  assert.equal(userText(new Error(store)), GENERIC);
  assert.equal(failure(own(store)).error, store);
});

test('a job the site refused is told apart from other failures', () => {
  assert.equal(isRefusedAccess('This link refused access (error 403). It may be private or need a sign-in.'), true);
  assert.equal(isRefusedAccess('This link refused access (error 401).'), true);
  assert.equal(isRefusedAccess('Vimeo asks for a sign-in to play that post. Only public posts can be transcribed.'), true);
  assert.equal(isRefusedAccess('That Vimeo post is private. Only public posts can be transcribed.'), true);
  assert.equal(isRefusedAccess('YouTube needs a sign-in to play this video. It may be private or age-restricted.'), true);
  assert.equal(isRefusedAccess('This Loom video is private. Only its owner, or the people it is shared with, can watch it.'), true);
  assert.equal(isRefusedAccess('Vimeo plays that video only on the websites its owner chose. Only public posts can be transcribed.'), true);
  assert.equal(isRefusedAccess('Dailymotion does not offer that post in the region our servers are in.'), true);
  assert.equal(isRefusedAccess('This Google Drive file isn’t shared publicly. In Drive, choose Share → General access → ‘Anyone with the link’, then try again.'), false);
  assert.equal(isRefusedAccess("This Google Drive file isn't shared publicly. In Drive, choose Share → General access → 'Anyone with the link', then try again."), false);
  assert.equal(isRefusedAccess('Vimeo is refusing requests from our servers for now. Try again later.'), false);
  assert.equal(isRefusedAccess('No speech was found in this video.'), false);
  assert.equal(isRefusedAccess(null), false);
  assert.equal(isRefusedAccess(undefined), false);
});
