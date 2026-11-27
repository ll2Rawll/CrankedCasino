// Run against a local server or Pages. Requires playwright-core and Chromium.
// BASE=http://localhost:8000/ CHROMIUM=/usr/bin/chromium node tools/test-rooster-input.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true });
  const errors = [];
  let modelsUrl;
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/rooster-models.js')) modelsUrl = request.url();
  });
  page.on('pageerror', error => errors.push(error.message));
  const base = new URL(process.env.BASE || 'http://localhost:8000/');
  base.hash = '/rooster';
  // Step the run clock explicitly so traffic and the test runner's speed cannot
  // change the landing window between gestures.
  await page.clock.install({ time: new Date('2025-01-01T00:00:00Z') });
  await page.goto(base.href);
  const start = page.locator('.rr-fab');
  await start.waitFor();

  await page.clock.pauseAt(new Date('2025-01-01T01:00:00Z'));
  // Seed 32 has an open path through the first four rows at the times below
  // (road, road, bus, road; tools/rooster-pilot.mjs can check a seed's timings).
  await page.evaluate(() => {
    document.querySelector('.rr-fab').addEventListener('click', () => {
      const random = Math.random;
      Math.random = () => 31.5 / 2147483640;
      setTimeout(() => { Math.random = random; }, 0);
    }, { capture: true, once: true });
  });
  await start.tap({ force: true });
  await page.clock.runFor(1505);
  assert.equal(await page.evaluate(() => __ccRooster().phase), 'run');

  // Observe the actual hen blit. Other animation (water, wheels, HUD) must
  // never satisfy the finger-down feedback check.
  assert(modelsUrl, 'the game loaded the model renderer');
  await page.evaluate(async url => {
    const { stamp } = await import(url);
    const images = new Set([stamp('hen', 0, 1).image, stamp('hen', 2, 1).image]);
    const ctx = document.querySelector('.rr-dialog canvas').getContext('2d');
    const original = ctx.drawImage.bind(ctx);
    ctx.drawImage = (image, ...args) => {
      original(image, ...args);
      if (images.has(image)) window.henY = ctx.getTransform().f;
    };
  }, modelsUrl);

  const input = await page.context().newCDPSession(page);
  const send = (type, x = 120, y = 400) => input.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }],
  });
  await page.clock.runFor(32);
  const restingY = await page.evaluate(() => window.henY);
  await send('touchStart');
  await page.clock.runFor(32);
  assert(await page.evaluate(y => window.henY < y - 2, restingY), 'hen must lift before release');
  assert.equal(await page.evaluate(() => __ccRooster().row), 0);
  await send('touchCancel');
  assert.equal(await page.evaluate(() => __ccRooster().best), 0);

  await send('touchStart');
  await send('touchMove', 148, 400);
  await send('touchEnd');
  assert.deepEqual(await page.evaluate(() => [__ccRooster().row, __ccRooster().col]), [0, 4]);
  await send('touchStart');
  await send('touchMove', 92, 400);
  await send('touchEnd');

  for (let row = 1; row <= 4; row++) {
    await send('touchStart');
    await page.clock.runFor(16);
    await send('touchEnd');
    await page.clock.runFor(32);
    assert.deepEqual(await page.evaluate(() => [__ccRooster().row, __ccRooster().best]), [row, row]);
  }
  await page.clock.runFor(300);
  assert.equal(await page.evaluate(() => __ccRooster().phase), 'run', 'the rooster crossed four lanes unhurt');
  assert.deepEqual(errors, []);
  console.log('Passed takeoff before release, cancellation, one move per swipe and four consecutive forward taps.');
} finally {
  await browser.close();
}
