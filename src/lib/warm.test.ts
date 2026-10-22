import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Warmer, WARM_EVERY_MS, warmBody, type WarmBody } from './warm.ts';

function rig() {
  let t = 1_000_000;
  const sent: WarmBody[] = [];
  const w = new Warmer((b) => sent.push(b), () => t);
  return { w, sent, advance: (ms: number) => { t += ms; } };
}

test('the body omits the language for auto detect', () => {
  assert.deepEqual(warmBody(true, null), { clientKind: 'chrome_extension', canStart: true });
  assert.deepEqual(warmBody(false, 'ro'), { clientKind: 'chrome_extension', canStart: false, spokenLanguage: 'ro' });
});

test('opening a visible Start screen pings at once; a hidden one does not', () => {
  const a = rig();
  a.w.offer('en', true);
  assert.deepEqual(a.sent, [{ clientKind: 'chrome_extension', canStart: true, spokenLanguage: 'en' }]);
  const b = rig();
  b.w.offer(null, false);
  assert.equal(b.sent.length, 0);
  b.w.used();
  assert.equal(b.sent.length, 1, 'the first use pings');
});

test('use pings at most once per 30 s', () => {
  const { w, sent, advance } = rig();
  w.offer(null, true);
  for (let i = 0; i < 10; i++) { advance(1000); w.used(); }
  assert.equal(sent.length, 1);
  advance(WARM_EVERY_MS - 10_000);
  w.used();
  assert.equal(sent.length, 2);
  w.used();
  assert.equal(sent.length, 2);
});

test('an untouched screen sends nothing after the first ping', () => {
  const { w, sent, advance } = rig();
  w.offer(null, true);
  advance(10 * 60_000);
  assert.equal(sent.length, 1);
});

test('a language change pings at once, inside the throttle', () => {
  const { w, sent } = rig();
  w.offer(null, true);
  w.language('fr', true);
  w.language('fr', true);
  w.language(null, true);
  assert.deepEqual(sent.map((b) => b.spokenLanguage), [undefined, 'fr', undefined]);
});

test('closing or starting withdraws once, and only after a ping', () => {
  const { w, sent } = rig();
  w.offer('de', true);
  w.withdraw();
  w.withdraw();
  assert.deepEqual(sent.at(-1), { clientKind: 'chrome_extension', canStart: false, spokenLanguage: 'de' });
  assert.equal(sent.length, 2);
  w.used();
  assert.equal(sent.length, 2, 'no pings once Start is not offered');
  const quiet = rig();
  quiet.w.offer(null, false);
  quiet.w.withdraw();
  assert.equal(quiet.sent.length, 0, 'nothing to take back');
});
