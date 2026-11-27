// BASE=<site root> BROWSER=webkit node tools/test-night-flight.mjs
// Chromium accepts CHROMIUM=<executable>. Both use playwright-core.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium, webkit } = createRequire(import.meta.url)('playwright-core');
const engine = process.env.BROWSER === 'chromium' ? chromium : webkit;
const browser = await engine.launch({ executablePath: engine === chromium ? process.env.CHROMIUM : webkit.executablePath() });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = new URL(process.env.BASE || 'http://localhost:8000/');
  base.hash = '/flight';
  await page.clock.install({ time: new Date('2025-01-01T00:00:00Z') });
  await page.goto(base.href);
  await page.locator('.nf[data-phase="ready"]').waitFor();
  await page.clock.pauseAt(new Date('2025-01-01T00:01:00Z'));
  const phase = () => page.locator('.nf').getAttribute('data-phase');
  const birdY = () => page.locator('.nf-bird').evaluate(el => new DOMMatrix(el.style.transform).f);
  const tap = () => page.touchscreen.tap(130, 415);
  await tap();
  assert.equal(await phase(), 'flying');
  await page.clock.runFor(410);
  await tap();
  const y = await birdY();
  await page.clock.runFor(20);
  assert(await birdY() < y, 'touch lifts the bird on the next frame');
  await page.getByRole('button', { name: 'Pause flight' }).tap({ force: true });
  const frozen = await birdY();
  await page.clock.runFor(1200);
  assert.equal(await phase(), 'paused');
  assert.equal(await birdY(), frozen);
  await page.getByRole('button', { name: 'Resume flight' }).tap({ force: true });
  // Pilot from the positions on screen. Scoring and collisions use the normal game path.
  let passed = 0;
  for (let i = 0; i < 400 && passed < 3; i++) {
    const sample = await page.evaluate(() => {
      const bird = new DOMMatrix(document.querySelector('.nf-bird').style.transform);
      const h = document.querySelector('.nf').clientHeight / 500;
      const gate = [...document.querySelectorAll('.nf-gate')].find(el => el.getBoundingClientRect().right > bird.e - 10 * h);
      const mid = gate ? (gate.firstElementChild.getBoundingClientRect().bottom + gate.lastElementChild.getBoundingClientRect().top) / 2 : 225 * h;
      return [bird.f, mid + 12 * h, Number(document.querySelector('.nf-score b').textContent)];
    });
    passed = sample[2];
    if (sample[0] > sample[1]) await tap();
    await page.clock.runFor(50);
    assert.equal(await phase(), 'flying');
  }
  assert(passed >= 3, 'flight cleared three gates');
  await page.clock.runFor(2200);
  assert.equal(await phase(), 'over');
  const best = Number(await page.locator('[data-best]').textContent());
  assert(best >= 3);
  await page.getByRole('button', { name: 'Fly again' }).tap({ force: true });
  assert.equal(await page.locator('.nf-score b').textContent(), '0');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await phase(), 'paused');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.clock.runFor(50);
  await page.getByRole('button', { name: 'Resume flight' }).tap({ force: true });
  await page.keyboard.press('ArrowUp');
  const position = await birdY();
  await page.clock.runFor(50);
  assert(await birdY() < position);
  await page.reload();
  await page.locator('.nf[data-phase="ready"]').waitFor();
  assert.equal(Number(await page.locator('.nf-record b').textContent()), best);
  await page.getByRole('link', { name: 'Lobby', exact: true }).tap({ force: true });
  await page.clock.runFor(900);
  await page.getByRole('link', { name: 'Play Night Flight' }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('html.flight-open').count(), 0);
  assert.deepEqual(errors, []);
  console.log(engine.name(), 'passed touch response, three gates, pause, banking the high score, retry, rotation, keyboard and lobby return.');
} finally { await browser.close(); }
