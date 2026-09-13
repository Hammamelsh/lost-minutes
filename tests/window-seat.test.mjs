// The recorded window-seat journey: its facts are validated, sourced and never invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseWindowSeat, playerUrl, recordingWords} from '../lib/window-seat.ts';

const published = JSON.parse(readFileSync(new URL('../public/data/window-seat.json', import.meta.url), 'utf8'));

test('the published journeys validate, with the embed naming the same video as the link', () => {
 const data = parseWindowSeat(published);
 assert.ok(data.journeys.length >= 1);
 for (const journey of data.journeys) {
  assert.ok(journey.video.url.includes(journey.video.id));
  assert.ok(journey.video.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/'));
  assert.ok(journey.stopsAsListedByCreator.length > 0);
  assert.ok(journey.video.licence.length > 20);
 }
});

test('a moment is tied to a place only when someone has verified it', () => {
 const journey = structuredClone(published.journeys[0]);
 journey.chapters = [{seconds: 120, label: 'Oxford Road', stopId: null, lat: 53.47, lon: -2.24, verified: false, basis: 'a guess'}];
 assert.throws(() => parseWindowSeat({...published, journeys: [journey]}));
 journey.chapters[0].verified = true;
 assert.doesNotThrow(() => parseWindowSeat({...published, journeys: [journey]}));
});

test('a date stated by the creator must be present; otherwise the words say what is known', () => {
 const journey = structuredClone(published.journeys[0]);
 journey.recording = {date: null, timeLocal: null, dateCertainty: 'stated_by_creator', basis: 'x'};
 assert.throws(() => parseWindowSeat({...published, journeys: [journey]}));
 assert.equal(recordingWords({date: '2022-06-03', timeLocal: '18:35', dateCertainty: 'stated_by_creator', basis: ''}, '2022-06-12'),
  'Filmed 3 June 2022, 18:35, as stated by the creator');
 assert.match(recordingWords({date: null, timeLocal: null, dateCertainty: 'published_date_only', basis: ''}, '2022-06-12'),
  /Published 12 June 2022; the filming date is not stated/);
 assert.match(recordingWords({date: null, timeLocal: null, dateCertainty: 'unknown', basis: ''}, '2022-06-12'), /unknown/);
});

test('the player URL uses the privacy-enhanced host, the message API, and names this page as origin', () => {
 const journey = parseWindowSeat(published).journeys[0];
 const url = new URL(playerUrl(journey, 'https://example.test'));
 assert.equal(url.host, 'www.youtube-nocookie.com');
 assert.equal(url.pathname, `/embed/${journey.video.id}`);
 assert.equal(url.searchParams.get('enablejsapi'), '1');
 assert.equal(url.searchParams.get('origin'), 'https://example.test');
});
