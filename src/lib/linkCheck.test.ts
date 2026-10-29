import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANT_FETCH, checkLink, verdictOf } from './linkCheck.ts';

const LOOM = 'https://www.loom.com/share/ce8ee1c8901649e1a79c421e9c3fcfc5';
const probe = (p: object) => ({ kind: 'unknown', source: 'web', ok: false, ...p }) as Parameters<typeof verdictOf>[0];

test('a file that opens is transcribed', () => {
  assert.deepEqual(verdictOf(probe({ kind: 'file', ok: true })), { go: true, live: false });
});

test('a live link is transcribed live', () => {
  assert.deepEqual(verdictOf(probe({ kind: 'live', source: 'youtube', ok: true })), { go: true, live: true });
});

test('a web page with nothing on it is refused in the server’s words, never sent', () => {
  const v = verdictOf(probe({ problem: 'That’s a web page, not a recording.' }));
  assert.deepEqual(v, { go: false, problem: 'That’s a web page, not a recording.', media: [] });
  assert.equal((verdictOf(probe({})) as { problem: string }).problem, CANT_FETCH);
});

test('a web page with recordings offers them instead', () => {
  const media = [{ url: 'https://cdn.example.com/a.mp4', title: 'A' }, { url: 'https://cdn.example.com/b.mp3' }];
  const v = verdictOf(probe({ media }));
  assert.equal(v.go, false);
  assert.deepEqual(v.go ? [] : v.media, media);
  assert.match(v.go ? '' : v.problem, /2 recordings/);
});

test('an answer without ok (an older API) takes the address', () => {
  assert.deepEqual(verdictOf({ kind: 'unknown', source: 'web' } as unknown as Parameters<typeof verdictOf>[0]), { go: true, live: false });
});

test('checked once per address; a failed check is asked again', async () => {
  let n = 0;
  const vs = { transcriptions: { probe: async (u: string) => { n++; if (u.endsWith('x')) throw new Error('offline'); return probe({ problem: 'Not a recording.' }); } } };
  assert.equal((await checkLink(vs, LOOM)).go, false);
  assert.equal((await checkLink(vs, LOOM)).go, false);
  assert.equal(n, 1);
  // No answer: taken as it is (as the dashboard does).
  assert.deepEqual(await checkLink(vs, `${LOOM}x`), { go: true, live: false });
  await checkLink(vs, `${LOOM}x`);
  assert.equal(n, 3);
});

test('an address the server refuses to check is refused, its error passed on', async () => {
  for (const code of ['rate_limited', 'invalid_options']) {
    const vs = { transcriptions: { probe: async () => { throw Object.assign(new Error(code), { code }); } } };
    await assert.rejects(checkLink(vs, `https://example.com/${code}`), { code });
  }
});

test('the server’s sentence starts with a capital', () => {
  const v = verdictOf(probe({ problem: 'the link is a web page, not a media file — link to the audio or video file itself' }));
  assert.match(v.go ? '' : v.problem, /^The link is a web page/);
});

