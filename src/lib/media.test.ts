import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MEDIA_PAGE, isRecordingUrl, loadedMedia, mediaInPage } from './media.ts';

test('a recording by its address: media, not a segment, not an ad', () => {
  assert.equal(isRecordingUrl('https://cdn.example.com/talk.mp4'), true);
  assert.equal(isRecordingUrl('https://cdn.example.com/hls/master.m3u8?token=1'), true);
  assert.equal(isRecordingUrl('https://cdn.example.com/hls/segment-12.mp4'), false);
  assert.equal(isRecordingUrl('https://cdn.example.com/v/chunk_3.m4a'), false);
  assert.equal(isRecordingUrl('https://cdn.example.com/v/init.mp4'), false);
  assert.equal(isRecordingUrl('https://cdn.example.com/v/a.mp4?range=0-1000'), false);
  assert.equal(isRecordingUrl('https://pubads.g.doubleclick.net/x/ad.mp4'), false);
  assert.equal(isRecordingUrl('https://cdn.example.com/ads/preroll.mp4'), false);
  assert.equal(isRecordingUrl('https://cdn.example.com/poster.jpg'), false);
  assert.equal(isRecordingUrl('blob:https://example.com/1'), false);
});

test('what a player loaded: its first playlist stands for the parts around it', () => {
  assert.deepEqual(loadedMedia([
    'https://cdn.example.com/app.js',
    'https://cdn.example.com/hls/master.m3u8',
    'https://cdn.example.com/hls/720p.m3u8',
    'https://cdn.example.com/hls/seg-1.mp4',
  ]), [{ url: 'https://cdn.example.com/hls/master.m3u8', kind: 'video' }]);
  assert.deepEqual(loadedMedia(['https://cdn.example.com/ep.mp3', 'https://cdn.example.com/ep.mp3']), [{ url: 'https://cdn.example.com/ep.mp3', kind: 'audio' }]);
  assert.deepEqual(loadedMedia(['https://example.com/style.css']), []);
});

test('a player’s data: an address its object marks as media, the lightest first', () => {
  const html = `<script>window.x={"assets":[
    {"type":"original","ext":"mp4","size":20143615,"url":"https:\\/\\/embed.example.com\\/deliveries\\/aa.bin"},
    {"type":"still_image","ext":"jpg","size":1000,"url":"https://embed.example.com/deliveries/img.bin"},
    {"type":"iphone_video","ext":"mp4","size":3000000,"url":"https://embed.example.com/deliveries/bb.bin"},
    {"type":"md_mp4_audio","ext":"m4a","size":900000,"url":"https://embed.example.com/deliveries/cc.bin"}]}</script>`;
  const got = mediaInPage(html, 'https://fast.example.net/embed/iframe/x');
  assert.deepEqual(got.map((m) => m.url), [
    'https://embed.example.com/deliveries/cc.bin',
    'https://embed.example.com/deliveries/bb.bin',
    'https://embed.example.com/deliveries/aa.bin',
  ]);
  assert.equal(got[0]!.kind, 'audio');
});

test('plain addresses in a page, by extension; mime types count as marks', () => {
  const html = `<video poster="https://x.example.com/p.jpg"></video>
    <script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://x.example.com/v/talk.mp4"}</script>
    {"mimeType":"application/x-mpegURL","src":"https://x.example.com/v/master"}`;
  assert.deepEqual(mediaInPage(html, 'https://x.example.com/').map((m) => m.url).sort(), ['https://x.example.com/v/master', 'https://x.example.com/v/talk.mp4']);
  assert.deepEqual(mediaInPage('<p>nothing</p>', 'https://x.example.com/'), []);
});

test('a real Wistia embed page, when saved beside the tests', { skip: !process.env.WISTIA_HTML }, () => {
  const got = mediaInPage(fs.readFileSync(process.env.WISTIA_HTML!, 'utf8'), 'https://fast.wistia.net/embed/iframe/e4a27b971d');
  assert.ok(got.length > 0);
  assert.match(got[0]!.url, /^https:\/\/embed-ssl\.wistia\.com\/deliveries\/\w+\.bin$/);
});

test('a page that is one recording, and the site pages that are not', () => {
  const yes = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD',
    'https://www.youtube.com/shorts/abcDEF12345', 'https://www.youtube.com/live/abcDEF12345', 'https://youtu.be/dQw4w9WgXcQ',
    'https://vimeo.com/76979871', 'https://vimeo.com/channels/staffpicks/76979871', 'https://vimeo.com/showcase/123/video/456', 'https://vimeo.com/groups/x/videos/456', 'https://player.vimeo.com/video/76979871',
    'https://soundcloud.com/artist/track-name', 'https://soundcloud.com/artist/sets/an-album',
    'https://open.spotify.com/episode/abc', 'https://www.dailymotion.com/video/x8abc',
    'https://www.twitch.tv/shroud', 'https://www.twitch.tv/shroud/', 'https://www.twitch.tv/videos/123456', 'https://www.twitch.tv/shroud/clip/Funny-Clip-abc', 'https://clips.twitch.tv/Funny-Clip-abc',
    'https://kick.com/xqc', 'https://kick.com/xqc/videos/1a2b-3c', 'https://kick.com/xqc/clips/clip_01',
    'https://www.loom.com/share/ce8ee1c8901649e1a79c421e9c3fcfc5',
  ];
  const no = [
    'https://www.youtube.com/', 'https://music.youtube.com/', 'https://www.youtube.com/@channel', 'https://www.youtube.com/results?search_query=x', 'https://www.youtube.com/playlist?list=PL1',
    'https://vimeo.com/', 'https://vimeo.com/channels/staffpicks', 'https://vimeo.com/showcase/123',
    'https://soundcloud.com/', 'https://soundcloud.com/discover/sets/charts-top', 'https://soundcloud.com/artist', 'https://soundcloud.com/artist/likes', 'https://soundcloud.com/artist/tracks',
    'https://www.twitch.tv/', 'https://www.twitch.tv/directory', 'https://www.twitch.tv/directory/category/just-chatting', 'https://www.twitch.tv/shroud/videos', 'https://www.twitch.tv/search?term=x', 'https://www.twitch.tv/settings/profile',
    'https://kick.com/', 'https://kick.com/browse', 'https://kick.com/categories/irl', 'https://kick.com/category/irl', 'https://kick.com/search?q=x', 'https://kick.com/following',
    'https://www.loom.com/', 'https://example.com/watch?v=1',
  ];
  for (const u of yes) assert.equal(MEDIA_PAGE.test(u), true, u);
  for (const u of no) assert.equal(MEDIA_PAGE.test(u), false, u);
});
