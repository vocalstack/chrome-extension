import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betterTitle, cleanTitle, pickTitle, placeholderTitle } from './title.ts';

test('a tab title without the site around it', () => {
  assert.equal(cleanTitle('(3) How speech recognition works - YouTube', 'https://www.youtube.com/watch?v=abc'), 'How speech recognition works');
  assert.equal(cleanTitle('Vimeo | A short film', 'https://vimeo.com/1'), 'A short film');
  assert.equal(cleanTitle('The talk · Part 2 | Example News', 'https://www.example.com/v/1', ['Example News']), 'The talk · Part 2');
  assert.equal(cleanTitle('Launch day - live - Twitch', 'https://www.twitch.tv/someone'), 'Launch day - live');
  // Only the site's name: kept, there is nothing else.
  assert.equal(cleanTitle('YouTube', 'https://www.youtube.com/'), 'YouTube');
  // A dash inside a word is not a separator.
  assert.equal(cleanTitle('Self-hosting 101', 'https://example.com/a'), 'Self-hosting 101');
  assert.equal(cleanTitle('  ', 'https://example.com/a'), '');
});

test('what the player says is playing comes first', () => {
  assert.equal(pickTitle({ url: 'https://www.youtube.com/watch?v=b', docTitle: '(1) Second video - YouTube', playing: 'Second video', metaTitles: ['First video'] }), 'Second video');
  // The site's own name as "playing" says nothing.
  assert.equal(pickTitle({ url: 'https://www.youtube.com/watch?v=b', docTitle: 'Second video - YouTube', playing: 'YouTube' }), 'Second video');
});

test('the page’s data, when it is about this address', () => {
  assert.equal(pickTitle({
    url: 'https://news.example.com/video/123?utm=x', docTitle: 'Watch | Example', dataTitles: ['The interview in full'], metaTitles: ['The interview | Example'],
    siteNames: ['Example'], canonical: ['https://news.example.com/video/123'],
  }), 'The interview in full');
  assert.equal(pickTitle({
    url: 'https://news.example.com/video/123', docTitle: 'Watch | Example', metaTitles: ['The interview | Example'], siteNames: ['Example'], canonical: ['https://news.example.com/video/123/'],
  }), 'The interview');
  // Several videos in the data: none of them names the page.
  assert.equal(pickTitle({
    url: 'https://example.com/list', docTitle: 'All talks - Example', dataTitles: ['One', 'Two'], canonical: ['https://example.com/list'],
  }), 'All talks');
});

test('data left from the page before is not used', () => {
  // YouTube after a click to another video: og:title is still the first one's.
  assert.equal(pickTitle({
    url: 'https://www.youtube.com/watch?v=second', docTitle: 'Second video - YouTube', metaTitles: ['First video'], canonical: ['https://www.youtube.com/watch?v=first'],
  }), 'Second video');
  // No canonical, but the tab's title says the same: the share title, cleaner.
  assert.equal(pickTitle({ url: 'https://example.com/v/9', docTitle: 'A long talk about sound — Example Media Group', metaTitles: ['A long talk about sound'] }), 'A long talk about sound');
});

test('placeholders give way to real titles', () => {
  assert.equal(placeholderTitle('YouTube video player'), true);
  assert.equal(placeholderTitle('Vimeo player'), true);
  assert.equal(placeholderTitle('vimeo-player'), false);
  assert.equal(placeholderTitle('The piano player'), false);
  assert.equal(betterTitle('YouTube video player', 'How it works'), 'How it works');
  assert.equal(betterTitle('How it works', 'YouTube player'), 'How it works');
  assert.equal(betterTitle('YouTube player', undefined), 'YouTube player');
});
