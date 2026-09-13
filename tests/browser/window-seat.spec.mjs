// The recorded window-seat journey on the Explore tab: a real creator's film through YouTube's
// own embed. Nothing is loaded until asked; then the player is driven and its playback is
// checked in the player's own frame. No location and no live collector are needed.
//
// The playback check talks to YouTube for real: it is a live external dependency, and the test
// says so when it cannot reach it.
import {test, expect} from '@playwright/test';
import {serveLive, unavailableState} from './fixtures.mjs';

test.use({permissions: []});

async function openExplore(page) {
  await serveLive(page, [() => unavailableState()]);
  await page.goto('/');
  await page.getByRole('tab', {name: 'Explore'}).click();
  const card = page.locator('.ws-card');
  await expect(card).toBeVisible({timeout: 20_000});
  return card;
}

test('the recorded journey is labelled, sourced and separate from anything live', async ({page}) => {
  const requests = [];
  page.on('request', r => { if (/youtube|ytimg|googlevideo/.test(r.url())) requests.push(r.url()); });
  const card = await openExplore(page);
  await expect(card).toContainText('RECORDED JOURNEY');
  await expect(card).toContainText('Filmed 3 June 2022, 18:35, as stated by the creator');
  await expect(card).toContainText('Piccadilly Gardens → East Didsbury');
  await expect(card).toContainText('Travel wow');
  await expect(card).toContainText('not stated by the creator');
  await expect(card).toContainText('The map is not moved with the film');
  await expect(page.locator('.window-seat')).toContainText('not live');
  await expect(card.locator('.ws-original')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=Iu-gz9CUq4U');
  await expect(card.locator('.ws-frame')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-player', 'idle');
  await page.waitForTimeout(500);
  expect(requests, 'nothing is fetched from the video service until asked').toEqual([]);
  // Today's timetable for the same line is shown apart, and says it is not the film's route.
  await card.locator('.ws-today summary').click();
  await expect(card.locator('.ws-today')).toContainText('not the route recorded in 2022');
  await page.screenshot({path: test.info().outputPath(`${test.info().project.name}-window-seat.png`), fullPage: false});
});

test('the player loads on request and actually plays, pauses and offers the original', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop', 'one real playback check is enough');
  test.setTimeout(120_000);
  const card = await openExplore(page);
  await card.getByRole('button', {name: 'Play on this page'}).click();
  await expect(card.locator('.ws-frame')).toHaveCount(1);
  const src = await card.locator('.ws-frame').getAttribute('src');
  expect(src).toContain('https://www.youtube-nocookie.com/embed/Iu-gz9CUq4U');
  expect(src).toContain('enablejsapi=1');
  expect(src).toContain(`origin=${encodeURIComponent(new URL(page.url()).origin)}`);
  await expect(card).toHaveAttribute('data-player', /ready|paused|playing|error|timeout/, {timeout: 30_000});
  const state = await card.getAttribute('data-player');
  if (state === 'error' || state === 'timeout') {
    // The service refused or never answered from this machine: the fallback must stand.
    await expect(card.locator('.ws-fallback')).toBeVisible();
    await expect(card.locator('.ws-original')).toBeVisible();
    test.info().annotations.push({type: 'external', description: `YouTube did not play here: ${state}; the fallback was shown`});
    return;
  }
  await card.getByRole('button', {name: 'Play'}).click();
  await expect(card).toHaveAttribute('data-player', 'playing', {timeout: 20_000});
  await page.waitForTimeout(4000);
  const frame = page.frames().find(f => f.url().includes('youtube-nocookie.com/embed/'));
  expect(frame, 'the player frame').toBeTruthy();
  const video = await frame.evaluate(() => {
    const v = document.querySelector('video');
    return v ? {currentTime: v.currentTime, paused: v.paused, readyState: v.readyState, width: v.videoWidth} : null;
  });
  expect(video, 'a video element in the player').toBeTruthy();
  expect(video.currentTime, 'the film is actually advancing').toBeGreaterThan(1);
  expect(video.paused).toBe(false);
  await card.getByRole('button', {name: 'Pause'}).click();
  await expect(card).toHaveAttribute('data-player', 'paused', {timeout: 10_000});
  const paused = await frame.evaluate(() => document.querySelector('video').paused);
  expect(paused).toBe(true);
  await page.screenshot({path: info.outputPath('desktop-window-seat-playing.png')});
});

test('when the player cannot be reached, the original video is offered instead', async ({page}) => {
  test.setTimeout(60_000);
  await page.route('**/*.youtube-nocookie.com/**', route => route.abort());
  const card = await openExplore(page);
  await card.getByRole('button', {name: 'Play on this page'}).click();
  await expect(card).toHaveAttribute('data-player', /timeout|error/, {timeout: 20_000});
  await expect(card.locator('.ws-fallback')).toContainText('Open the original on YouTube');
  await expect(card.locator('.ws-original')).toBeVisible();
  await expect(card.getByRole('button', {name: 'Play'})).toBeDisabled();
});
