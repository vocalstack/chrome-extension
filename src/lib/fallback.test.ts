import test from 'node:test';
import assert from 'node:assert/strict';
import { askAgain, browserManifest, emptyAudio, jobWay, linkWay, stalled, tabOffered } from './fallback.ts';
import { firstVariant, isManifestUrl, manifestKind, viewerBound } from './media.ts';

const TF1 = 'https://alive-tf1-hls-ssai.cdn-0.diff.tf1.fr/6a1f0c9e2b7d4e8fa3c5b1d9e7f20a4c/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaXAiOiI5MC4xMi4zNC41NiIsImV4cCI6MTc2Mzc0NDAwMCwiaXNzIjoiZGVsaXZlcnkifQ.c2lnbmF0dXJl/out/v1/TF1.m3u8';

test('where a link is bound to its viewer: query, path, or not at all', () => {
  const cases: [string, 'query' | 'path' | null][] = [
    [TF1, 'path'],
    ['https://example-vh.akamaihd.net/i/v/master.m3u8?hdnts=exp=1763218923~acl=/*~hmac=abc', 'query'],
    ['https://example-vh.akamaihd.net/hls/live/2003/news/master.m3u8?hdnea=exp=1763218923~acl=/*~hmac=abc', 'query'],
    ['https://example.akamaized.net/hdnea=exp=1763218923~acl=%2F*~hmac=0f9e8d7c/hls/live/2003/news/index.m3u8', 'path'],
    ['https://vod-progressive.akamaized.net/exp=1763218923~acl=%2Fvimeo-prod%2F*~hmac=0f9e8d7c6b5a/vimeo-prod-skyfire-std-us/01/123/7/file.mp4', 'path'],
    ['https://d111111abcdef8.cloudfront.net/v/master.m3u8?Policy=eyJTdGF0ZW1lbnQiOlt7fV19&Signature=abc&Key-Pair-Id=K2JCJMDEHXQW5F', 'query'],
    ['https://d111111abcdef8.cloudfront.net/v/talk.mp4?Expires=1763218923&Signature=abc&Key-Pair-Id=K2JCJMDEHXQW5F', 'query'],
    ['https://vz-abc123.b-cdn.net/bcdn_token=Zk9xQ2V1bHhNc2Y&expires=1763218923&token_path=%2F/0b6f2c1e/playlist.m3u8', 'path'],
    ['https://vz-abc123.b-cdn.net/0b6f2c1e/playlist.m3u8?token=Zk9xQ2V1bHhNc2Y&expires=1763218923', 'query'],
    ['https://manifest.prod.boltdns.net/manifest/v1/hls/v4/clear/6415718365001/0b6f2c1e/10s/master.m3u8?fastly_token=NjU3ZjAwMDBfYWJj', 'query'],
    ['https://house-fastly-signed-us-east-1-prod.brightcovecdn.com/media/v1/hls/v4/clear/6415718365001/master.m3u8?bcov_auth=eyJhbGciOiJSUzI1NiJ9.eyJ2aWQiOiIxIn0.c2ln', 'query'],
    ['https://cdn.jwplayer.com/manifests/AbCd1234.m3u8?exp=1763218923&sig=0f9e8d7c6b5a', 'query'],
    ['https://cdnapisec.kaltura.com/p/1234/sp/123400/playManifest/entryId/1_abcd/format/applehttp/protocol/https/ks/djJ8MTIzNHxhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk/a.m3u8', 'path'],
    ['https://ssai.example.com/v1/master/0b6f2c1e/session/master.m3u8?aws.sessionId=1&jwt=eyJhbGciOiJIUzI1NiJ9.eyJpcCI6IjEuMi4zLjQifQ.c2ln', 'query'],
    ['https://live.example.tv/hls/channel1/index.m3u8?cip=90.12.34.56&st=abc&e=1763218923', 'query'],
    ['https://wowza.example.com/live/ch1/playlist.m3u8?wowzatokenhash=abc123', 'query'],
    ['https://media.example.com/x/' + 'Ab9'.repeat(30) + '/audio.m4a', 'path'],
    ['https://cdn.example.com/podcast.mp3', null],
    ['https://cdn.example.com/a/' + 'deadbeef'.repeat(8) + '/talk.mp4', null],
    ['https://stream.mux.com/DS00Spx1CV902MCtPj5WknGlR102V5HFkDe.m3u8', null],
    ['https://bucket.s3.amazonaws.com/talk.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20261115%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261115T150200Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=abc', null],
    ['https://bucket.s3.amazonaws.com/talk.mp4?AWSAccessKeyId=AKIAEXAMPLE&Expires=1763218923&Signature=abc', null],
    ['https://storage.googleapis.com/bucket/talk.mp3?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=900&X-Goog-Signature=abc', null],
    ['https://acct.blob.core.windows.net/media/talk.mp4?sv=2022-11-02&se=2026-11-22T00%3A00%3A00Z&sr=b&sp=r&sig=abc', null],
    ['https://drive.usercontent.google.com/download/talk.mp4?id=1AbC&export=download&token=abc', null],
    ['https://dl.dropboxusercontent.com/scl/fi/abc/talk.mp4?rlkey=xyz&dl=1&token=abc', null],
    ['https://drive.google.com/file/d/1AbCdEf/view', null],
    ['https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/talks%2Fa.mp4?alt=media&token=0b6f2c1e-8a3d-4f0e-9c1a-2d5e7f9a1b3c', null],
    ['https://abcd.supabase.co/storage/v1/object/sign/media/talk.mp4?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJtZWRpYS90YWxrLm1wNCJ9.c2ln', null],
    ['https://abcd.supabase.co/functions/v1/stream/master.m3u8?token=eyJhbGciOiJIUzI1NiJ9.eyJpcCI6IjEuMi4zLjQifQ.c2ln', 'query'],
    ['https://u.pcloud.link/publink/show/talk.mp4?code=XZabc&token=1', null],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=abc', null],
    ['https://news.example.com/video/eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.c2ln', null],
  ];
  for (const [u, want] of cases) assert.equal(viewerBound(u), want, u);
});

test('a playlist says whether it is live, as the browser reads it', () => {
  assert.equal(manifestKind('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:812\n#EXTINF:6.0,\nseg812.ts\n'), 'live');
  assert.equal(manifestKind('#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:6.0,\nseg1.ts\n'), 'vod');
  assert.equal(manifestKind('#EXTM3U\n#EXTINF:6.0,\nseg1.ts\n#EXT-X-ENDLIST\n'), 'vod');
  assert.equal(manifestKind('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n'), 'master');
  assert.equal(manifestKind('<?xml version="1.0"?><MPD type="dynamic" availabilityStartTime="2026-11-21T00:00:00Z"></MPD>'), 'live');
  assert.equal(manifestKind('<MPD type="static" mediaPresentationDuration="PT1H"></MPD>'), 'vod');
  assert.equal(manifestKind('<SmoothStreamingMedia IsLive="TRUE"></SmoothStreamingMedia>'), 'live');
  assert.equal(manifestKind(''), null);
  assert.equal(manifestKind('#EXTM3U\n'), null);
  assert.equal(manifestKind('<html>not in your region</html>'), null);
  assert.equal(firstVariant('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n', 'https://cdn.example.com/hls/master.m3u8'), 'https://cdn.example.com/hls/low/index.m3u8');
  assert.equal(isManifestUrl(TF1), true);
  assert.equal(isManifestUrl('https://cdn.example.com/a.ism/Manifest'), true);
  assert.equal(isManifestUrl('https://cdn.example.com/talk.mp4'), false);
});

test('the browser reads a master playlist by its first rendition, and gives up quietly', async () => {
  const pages: Record<string, { status: number; body: string }> = {
    'https://cdn.example.com/hls/master.m3u8': { status: 200, body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n' },
    'https://cdn.example.com/hls/low.m3u8': { status: 200, body: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\na.ts\n' },
    'https://cdn.example.com/vod.m3u8': { status: 200, body: '#EXTM3U\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n' },
    'https://cdn.example.com/refused.m3u8': { status: 403, body: '' },
  };
  const asked: RequestInit[] = [];
  const get = async (u: string, init: RequestInit) => {
    asked.push(init);
    const p = pages[u];
    if (!p) throw new TypeError('Failed to fetch');
    return new Response(p.body, { status: p.status });
  };
  assert.equal(await browserManifest('https://cdn.example.com/hls/master.m3u8', get), 'live');
  assert.equal(await browserManifest('https://cdn.example.com/vod.m3u8', get), 'vod');
  assert.equal(await browserManifest('https://cdn.example.com/refused.m3u8', get), null);
  assert.equal(await browserManifest('https://cdn.example.com/gone.m3u8', get), null);
  const before = asked.length;
  assert.equal(await browserManifest('https://cdn.example.com/talk.mp4', get), null);
  assert.equal(asked.length, before, 'a file is never fetched by the browser');
  assert.equal(asked[0]!.credentials, 'include');
});

test('before anything is made: the server, the tab, or the probe says no', () => {
  const plain = 'https://cdn.example.com/talk.mp4';
  assert.equal(linkWay(TF1, { go: true, live: false }), 'tab', 'a path token is the viewer’s, whatever the probe said');
  assert.equal(linkWay(plain, { go: true, live: false }), 'server', 'a public file: fetched whole by the server');
  assert.equal(linkWay(plain, null), 'server');
  assert.equal(linkWay(plain, { go: true, live: true }), 'tab', 'live');
  assert.equal(linkWay('https://cdn.example.com/hls/index.m3u8', { go: true, live: false }, 'live'), 'tab', 'the browser reads it live');
  assert.equal(linkWay('https://cdn.example.com/hls/index.m3u8', { go: true, live: false }, 'vod'), 'server');
  assert.equal(linkWay('https://cdn.example.com/hls/master.m3u8', { go: true, live: true }, 'vod'), 'server', 'a finished video’s master playlist, read to its rendition here');
  assert.equal(linkWay(plain, { go: false, viewerOnly: true, reason: 'not_media' }), 'tab', 'a media address answering a token error');
  assert.equal(linkWay(plain, { go: false, viewerOnly: true, reason: 'forbidden' }), 'tab');
  assert.equal(linkWay(plain, { go: false, reason: 'empty' }), 'tab');
  assert.equal(linkWay(plain, { go: false, reason: 'forbidden' }), 'tab');
  assert.equal(linkWay(plain, { go: false, reason: 'unreachable' }), 'tab');
  assert.equal(linkWay(plain, { go: false, reason: 'web_page' }), 'tab');
  assert.equal(linkWay(plain, { go: false }), 'tab', 'an older server without a reason');
  assert.equal(linkWay(plain, { go: false, reason: 'meeting' }), 'refuse');
  assert.equal(linkWay(plain, { go: false, reason: 'too_long' }), 'refuse');
  assert.equal(linkWay(plain, { go: false, reason: 'not_media' }), 'refuse');
  assert.equal(linkWay('https://bucket.s3.amazonaws.com/talk.mp4?X-Amz-Signature=abc&X-Amz-Expires=60', { go: true, live: false }), 'server', 'presigned storage');
  assert.equal(linkWay('https://drive.google.com/file/d/1AbCdEf/view', { go: true, live: false }), 'server', 'a file host');
});

test('after a job: each server outcome, the tab or the job as it is', () => {
  const failed = (errorCode: string | null, error = 'x') => ({ state: 'failed', errorCode, error });
  const table: [ReturnType<typeof failed> | { state: string; error?: string | null; errorCode?: string | null }, 'tab' | 'keep'][] = [
    [failed('link_refused'), 'tab'],
    [failed('link_empty'), 'tab'],
    [failed('link_live'), 'tab'],
    [failed('link_not_found'), 'tab'],
    [failed('link_unreachable'), 'tab'],
    [failed('link_unreadable'), 'tab'],
    [failed('link_too_long'), 'keep'],
    [failed('link_not_shared'), 'keep'],
    [failed('insufficient_credit', 'Your account has no credit left. Add credit, then retry.'), 'keep'],
    [failed('usage_cap_reached'), 'keep'],
    [failed('terms_acceptance_required'), 'keep'],
    [{ state: 'stopped', errorCode: 'stopped', error: 'The transcription was stopped.' }, 'keep'],
    [failed(null, 'This link returned nothing to transcribe.'), 'tab'],
    [failed(null, 'This link refused access (error 403). It may be private or need a sign-in.'), 'tab'],
    [failed(null, 'Dailymotion does not offer that post in the region our servers are in.'), 'tab'],
    [failed(null, 'This is a live stream. Only finished videos can be transcribed as files.'), 'tab'],
    [failed(null, 'The link could not be reached. Try again later.'), 'tab'],
    [failed(null, 'Nothing is at this link anymore (error 404). Check the link.'), 'tab'],
    [failed(null, "That's a web page, not a recording."), 'tab'],
    [failed(null, 'The transcription failed because of a problem on our side. We have been notified. Press Retry to try again; you won\'t be charged twice.'), 'keep'],
    [failed(null, 'This Google Drive file isn’t shared publicly. In Drive, choose Share → General access → ‘Anyone with the link’, then try again.'), 'keep'],
    [failed(null, null as unknown as string), 'keep'],
    [{ state: 'done' }, 'keep'],
    [{ state: 'transcribing' }, 'keep'],
  ];
  for (const [job, want] of table) assert.equal(jobWay(job), want, JSON.stringify(job));
  assert.equal(jobWay(null), 'keep');
});

test('a job that keeps trying with nothing fetched is the tab’s; one fetching is not', () => {
  const slow = 'The link could not be reached. Try again later.';
  const ours = 'A problem on our side interrupted the transcription. It is being retried.';
  assert.equal(stalled({ state: 'queued', attempts: 2, error: slow, progress: { pct: 0 } }), true);
  assert.equal(stalled({ state: 'fetching', attempts: 3, error: 'This link’s server had a problem (error 503). Try again later.'.replace('’', "'"), progress: { pct: 0, fetchedBytes: 0 } }), true);
  assert.equal(stalled({ state: 'stopped', attempts: 2, error: slow, progress: { pct: 0 } }), true);
  assert.equal(stalled({ state: 'queued', attempts: 2, error: ours, progress: { pct: 0 } }), false, 'our retry (an engine closed early, a restart) is not the link’s');
  assert.equal(stalled({ state: 'fetching', attempts: 2, progress: { pct: 0 } }), false, 'claimed again after a restart, no error');
  assert.equal(stalled({ state: 'stopped', attempts: 2, errorCode: 'stopped', error: 'The transcription was stopped.', progress: { pct: 0 } }), false);
  assert.equal(stalled({ state: 'queued', attempts: 1, error: slow, progress: { pct: 0 } }), false);
  assert.equal(stalled({ state: 'fetching', attempts: 2, error: slow, progress: { pct: 0, fetchedBytes: 1024 } }), false);
  assert.equal(stalled({ state: 'transcribing', attempts: 2, progress: { pct: 10 } }), false);
  assert.equal(stalled({ state: 'failed', attempts: 3 }), false);
  assert.equal(emptyAudio({ state: 'done', hasAudio: true, source: { durationS: 0.4 } }), true);
  assert.equal(emptyAudio({ state: 'done', hasAudio: false }), true);
  assert.equal(emptyAudio({ state: 'done', hasAudio: true, source: { durationS: 6 } }), false);
  assert.equal(emptyAudio({ state: 'failed', hasAudio: false }), false);
});

test('a link that did not answer is asked again later; a refusal is not', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  assert.equal(askAgain({ state: 'failed', errorCode: 'link_unreachable', finishedAt: at(11) }, now), true);
  assert.equal(askAgain({ state: 'failed', errorCode: 'link_unreachable', finishedAt: at(2) }, now), false);
  assert.equal(askAgain({ state: 'failed', errorCode: 'link_refused', finishedAt: at(60) }, now), false);
  assert.equal(askAgain({ state: 'failed', error: 'The link could not be reached. Try again later.', finishedAt: at(30) }, now), true, 'an older server');
  assert.equal(askAgain({ state: 'failed', errorCode: 'link_unreachable' }, now), false);
});

test('a list offers the tab only for a refusal, nothing, a live stream or no answer', () => {
  for (const code of ['link_refused', 'link_empty', 'link_live', 'link_unreachable']) assert.equal(tabOffered({ state: 'failed', errorCode: code }), true, code);
  for (const code of ['link_not_found', 'link_unreadable', 'link_too_long', 'link_not_shared', 'insufficient_credit']) assert.equal(tabOffered({ state: 'failed', errorCode: code }), false, code);
  assert.equal(tabOffered({ state: 'failed', error: 'This link refused access (error 403). It may be private or need a sign-in.' }), true);
  assert.equal(tabOffered({ state: 'done' }), false);
});
