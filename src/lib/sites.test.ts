import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionPlan, isAdUrl, isFileUrl, playedOf, siteOf, tabStep, youtubeWatch, type Played } from './sites.ts';

const big = { area: 1280 * 720, largest: true };
const played = (p: Partial<Played> & { pageUrl: string }): Played => ({ frameUrl: p.pageUrl, ...big, ...p });

test('the ten sites are known, each by its subdomains too', () => {
  const cases: [string, string, 'server' | 'tab'][] = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YouTube', 'server'],
    ['https://vimeo.com/76979871', 'Vimeo', 'tab'],
    ['https://player.vimeo.com/video/76979871', 'Vimeo', 'tab'],
    ['https://www.twitch.tv/somechannel', 'Twitch', 'tab'],
    ['https://clips.twitch.tv/SomeClip', 'Twitch', 'tab'],
    ['https://www.dailymotion.com/video/x8abcd', 'Dailymotion', 'tab'],
    ['https://www.facebook.com/watch/?v=123', 'Facebook', 'tab'],
    ['https://fb.watch/abc/', 'Facebook', 'tab'],
    ['https://x.com/someone/status/1', 'X', 'tab'],
    ['https://twitter.com/someone/status/1', 'X', 'tab'],
    ['https://www.instagram.com/reel/abc/', 'Instagram', 'tab'],
    ['https://www.tiktok.com/@someone/video/1', 'TikTok', 'tab'],
    ['https://kick.com/somechannel', 'Kick', 'tab'],
    ['https://www.loom.com/share/ce8ee1c8901649e1a79c421e9c3fcfc5', 'Loom', 'tab'],
  ];
  for (const [url, name, route] of cases) assert.deepEqual([siteOf(url)?.name, siteOf(url)?.route], [name, route], url);
});

test('look-alike hosts are not the sites', () => {
  assert.equal(siteOf('https://notyoutube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(siteOf('https://max.com/video/1'), null);
  assert.equal(siteOf('https://box.com/x'), null);
  assert.equal(siteOf('chrome://newtab'), null);
  assert.equal(siteOf('not a url'), null);
});

test('YouTube videos by any address of theirs', () => {
  const w = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.equal(youtubeWatch('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s'), w);
  assert.equal(youtubeWatch('https://m.youtube.com/shorts/dQw4w9WgXcQ'), w);
  assert.equal(youtubeWatch('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1'), w);
  assert.equal(youtubeWatch('https://youtu.be/dQw4w9WgXcQ'), w);
  assert.equal(youtubeWatch('https://www.youtube.com/'), null);
  assert.equal(youtubeWatch('https://www.youtube.com/@channel'), null);
});

test('ads and files by address', () => {
  assert.ok(isAdUrl('https://imasdk.googleapis.com/js/core/bridge3.html'));
  assert.ok(isAdUrl('https://redirector.gvt1.com.2mdn.net/videoplayback/x.mp4'));
  assert.ok(!isAdUrl('https://cdn.example-news.com/clip.mp4'));
  assert.ok(isFileUrl('https://cdn.news.com/v/clip.mp4?sig=1'));
  assert.ok(isFileUrl('https://cdn.news.com/v/master.m3u8'));
  assert.ok(!isFileUrl('https://cdn.news.com/v/clip?id=1'));
  assert.ok(!isFileUrl('blob:https://news.com/1234'));
});

test('YouTube: transcribed from its watch address, also when embedded', () => {
  assert.deepEqual(captionPlan(played({ pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationS: 212 })), { path: 'server', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', site: 'YouTube' });
  assert.deepEqual(captionPlan(played({ pageUrl: 'https://news.com/story', frameUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', durationS: 212 })), { path: 'server', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', site: 'YouTube' });
});

test('YouTube live: from the tab, as it plays', () => {
  assert.deepEqual(captionPlan(played({ pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationS: Infinity })), { path: 'tab', site: 'YouTube' });
});

test('sites the server cannot fetch: from the tab, never from their address', () => {
  for (const pageUrl of ['https://vimeo.com/76979871', 'https://www.twitch.tv/somechannel', 'https://www.dailymotion.com/video/x8abcd', 'https://kick.com/somechannel', 'https://www.loom.com/share/ce8ee1c8901649e1a79c421e9c3fcfc5']) {
    const plan = captionPlan(played({ pageUrl, durationS: Infinity }));
    assert.equal(plan.path, 'tab', pageUrl);
  }
  // Twitch VOD, a Vimeo video with an mp4 source: still the tab.
  assert.equal(captionPlan(played({ pageUrl: 'https://www.twitch.tv/videos/1', durationS: 3600 })).path, 'tab');
  assert.equal(captionPlan(played({ pageUrl: 'https://vimeo.com/1', src: 'https://vod-progressive.akamaized.net/x.mp4', durationS: 300 })).path, 'tab');
});

test('an embedded Vimeo or Loom player on another page: the tab, not a page search', () => {
  assert.deepEqual(captionPlan(played({ pageUrl: 'https://blog.example.com/post', frameUrl: 'https://player.vimeo.com/video/1', durationS: 300 })), { path: 'tab', site: 'Vimeo' });
  assert.deepEqual(captionPlan(played({ pageUrl: 'https://blog.example.com/post', frameUrl: 'https://www.loom.com/embed/abc', durationS: 300 })), { path: 'tab', site: 'Loom' });
});

test('clip feeds count short clips; long-video sites do not', () => {
  assert.equal(captionPlan(played({ pageUrl: 'https://www.instagram.com/reels/abc/', durationS: 12 })).path, 'tab');
  assert.equal(captionPlan(played({ pageUrl: 'https://www.tiktok.com/foryou', durationS: 9 })).path, 'tab');
  assert.equal(captionPlan(played({ pageUrl: 'https://x.com/home', durationS: 15 })).path, 'tab');
  assert.deepEqual(captionPlan(played({ pageUrl: 'https://vimeo.com/1', durationS: 8 })), { path: 'none', why: 'short' });
});

test('a news page: its main mp4 from the server; ads and small or short videos never', () => {
  const page = 'https://news.example.com/2026/10/story';
  assert.deepEqual(captionPlan(played({ pageUrl: page, src: 'https://cdn.news.example.com/v/story.mp4', durationS: 180 })), { path: 'server', url: 'https://cdn.news.example.com/v/story.mp4', site: null });
  // An ad's file, its frame, its container.
  assert.deepEqual(captionPlan(played({ pageUrl: page, src: 'https://gcdn.2mdn.net/videoplayback/ad.mp4', durationS: 180 })), { path: 'none', why: 'ad' });
  assert.deepEqual(captionPlan(played({ pageUrl: page, frameUrl: 'https://imasdk.googleapis.com/js/core/bridge3.html', src: 'https://cdn.x.com/a.mp4', durationS: 180 })), { path: 'none', why: 'ad' });
  assert.deepEqual(captionPlan(played({ pageUrl: page, src: 'https://cdn.news.example.com/v/a.mp4', durationS: 180, adHint: true })), { path: 'none', why: 'ad' });
  // A 30-second pre-roll from the site's own CDN.
  assert.deepEqual(captionPlan(played({ pageUrl: page, src: 'https://cdn.news.example.com/v/promo.mp4', durationS: 30 })), { path: 'none', why: 'short' });
  // A small or secondary player.
  assert.deepEqual(captionPlan(played({ pageUrl: page, src: 'https://cdn.news.example.com/v/story.mp4', durationS: 180, area: 200 * 112 })), { path: 'none', why: 'small' });
  assert.deepEqual(captionPlan(played({ pageUrl: page, src: 'https://cdn.news.example.com/v/story.mp4', durationS: 180, largest: false })), { path: 'none', why: 'small' });
});

test('a page video the server would take for a web page: the tab, never sent', () => {
  const page = 'https://news.example.com/story';
  // A blob: stream, an address with no media extension, a live stream, an unknown length.
  assert.deepEqual(captionPlan(played({ pageUrl: page, durationS: 600 })), { path: 'tab', site: null });
  assert.deepEqual(captionPlan(played({ pageUrl: page, src: 'https://cdn.news.example.com/play?id=1', durationS: 600 })), { path: 'tab', site: null });
  assert.deepEqual(captionPlan(played({ pageUrl: page, src: 'https://cdn.news.example.com/live.m3u8', durationS: Infinity })), { path: 'tab', site: null });
  assert.deepEqual(captionPlan(played({ pageUrl: page, src: 'https://cdn.news.example.com/v.mp4' })), { path: 'tab', site: null });
});

test('tab captions: started where Chrome allows it, else offered, never forced', () => {
  assert.equal(tabStep({ busy: false, declined: false, invoked: true }), 'start');
  assert.equal(tabStep({ busy: false, declined: false, invoked: false }), 'offer');
  assert.equal(tabStep({ busy: false, declined: true, invoked: true }), 'skip');
  assert.equal(tabStep({ busy: true, declined: false, invoked: true }), 'skip');
});

test('a live stream survives the message as live', () => {
  const p = playedOf({ frameUrl: '', live: true, area: 1, largest: true }, 'https://kick.com/x');
  assert.equal(p.durationS, Infinity);
  assert.equal(p.frameUrl, 'https://kick.com/x');
  assert.equal(playedOf({ frameUrl: 'https://f/', durationS: 12, area: 1, largest: true }, 'https://p/').durationS, 12);
  // A message from an older content script: nothing to go on, nothing done.
  assert.deepEqual(captionPlan(playedOf({} as never, 'https://news.example.com/')), { path: 'none', why: 'small' });
});
