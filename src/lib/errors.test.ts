import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC, OFFLINE, failure, isFault, userText } from './errors.ts';

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
