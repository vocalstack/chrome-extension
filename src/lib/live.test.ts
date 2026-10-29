import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMeeting, meetingOf } from './live.ts';

test('meeting tabs are recognised by their address', () => {
  assert.equal(meetingOf('https://meet.google.com/abc-defg-hij'), 'Google Meet');
  assert.equal(meetingOf('https://meet.google.com/'), null, 'the Meet home page is not a meeting');
  assert.equal(meetingOf('https://teams.microsoft.com/v2/'), 'Microsoft Teams');
  assert.equal(meetingOf('https://us02web.zoom.us/wc/123456789/join'), 'Zoom');
  assert.equal(meetingOf('https://app.zoom.us/wc/123/start'), 'Zoom');
  assert.equal(meetingOf('https://zoom.us/pricing'), null);
  assert.equal(meetingOf('https://us02web.zoom.us/j/123456789'), null, 'the launcher of the Zoom app');
  assert.equal(meetingOf('https://teams.cloud.microsoft/v2/'), 'Microsoft Teams');
  assert.equal(meetingOf('https://example.com/meet.google.com/abc-defg-hij'), null);
  assert.equal(meetingOf(undefined), null);
});

test('a meeting going on: not every page of a meeting app', () => {
  assert.equal(inMeeting('https://meet.google.com/abc-defg-hij', 'Meet – Weekly sync'), true);
  assert.equal(inMeeting('https://teams.microsoft.com/v2/', 'Chat | Ana Lopes | Microsoft Teams'), false);
  assert.equal(inMeeting('https://teams.microsoft.com/v2/', '(3) Activity | Microsoft Teams'), false);
  assert.equal(inMeeting('https://teams.microsoft.com/v2/', 'Calendar | Calendar | Microsoft Teams'), false);
  assert.equal(inMeeting('https://teams.microsoft.com/v2/', 'Microsoft Teams'), false);
  assert.equal(inMeeting('https://teams.microsoft.com/v2/', 'Weekly product sync | Microsoft Teams'), true);
  assert.equal(inMeeting('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0', 'Microsoft Teams'), true);
  assert.equal(inMeeting('https://teams.live.com/meet/9381234567', ''), true);
  assert.equal(inMeeting('https://example.com/', 'x'), false);
});
