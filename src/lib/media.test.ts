import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isRecordingUrl, loadedMedia, mediaInPage } from './media.ts';

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
