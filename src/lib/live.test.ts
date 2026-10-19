import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meetingOf } from './live.ts';

test('meeting tabs are recognised by their address', () => {
  assert.equal(meetingOf('https://meet.google.com/abc-defg-hij'), 'Google Meet');
  assert.equal(meetingOf('https://meet.google.com/'), null, 'the Meet home page is not a meeting');
  assert.equal(meetingOf('https://teams.microsoft.com/v2/'), 'Microsoft Teams');
  assert.equal(meetingOf('https://us02web.zoom.us/wc/123456789/join'), 'Zoom');
  assert.equal(meetingOf('https://app.zoom.us/wc/123/start'), 'Zoom');
  assert.equal(meetingOf('https://zoom.us/pricing'), null);
  assert.equal(meetingOf('https://example.com/meet.google.com/abc-defg-hij'), null);
  assert.equal(meetingOf(undefined), null);
});
