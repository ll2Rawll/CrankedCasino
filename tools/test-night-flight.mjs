// BASE=<site root> node tools/test-night-flight.mjs   (BROWSER=webkit for Safari's engine)
// Chromium accepts CHROMIUM=<executable>. Uses playwright-core with a fake clock, so the
// 30-frame-a-second flight runs the same however fast the test machine is.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium, webkit } = createRequire(import.meta.url)('playwright-core');
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ executablePath: engine === chromium ? process.env.CHROMIUM : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = new URL(process.env.BASE || 'http://localhost:8000/');
  base.hash = '/flight';
  await page.clock.install({ time: new Date('2025-01-01T00:00:00Z') });
  await page.goto(base.href);
  await page.locator('.nf[data-phase="title"]').waitFor();
  await page.clock.pauseAt(new Date('2025-01-01T00:01:00Z'));
  const phase = () => page.locator('.nf').getAttribute('data-phase');
  const state = () => page.evaluate(() => window.__ccFlight());
  const birdY = () => page.locator('.nf-bird').evaluate((el) => new DOMMatrix(el.style.transform).f);
  const pitch = () => page.locator('.nf-bird').evaluate((el) => {
    const m = new DOMMatrix(el.style.transform);
    return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
  });
  const tap = () => page.touchscreen.tap(200, 600);

  // Title → get ready: the bird bobs in place and no gates have arrived.
  await tap();
  assert.equal(await phase(), 'ready');
  const bob = [];
  for (let i = 0; i < 12; i++) {
    await page.clock.runFor(100);
    bob.push((await state()).y);
  }
  assert(Math.max(...bob) - Math.min(...bob) >= 8, 'the bird bobs while waiting');
  assert.equal((await state()).gates.length, 0);

  // The first tap takes off; the bird rises 36 px (in game pixels) over the next 8 frames.
  await tap();
  assert.equal(await phase(), 'flying');
  const y0 = (await state()).y;
  await page.clock.runFor(34);
  assert((await state()).y < y0, 'the take-off lifts the bird on the next frame');
  assert.equal(await pitch(), -20, 'nose up at 20°');
  let peak = 0;
  for (let i = 0; i < 12; i++) {
    await page.clock.runFor(34);
    peak = Math.max(peak, y0 - (await state()).y);
  }
  assert.equal(peak, 36, 'take-off apex');
  await page.clock.runFor(500);
  assert.equal(await phase(), 'flying');
  assert(await pitch() >= 30, 'the nose drops as the bird falls');

  // A flap mid-dive kicks straight back up and tilts the nose up again.
  await tap();
  const y1 = (await state()).y;
  await page.clock.runFor(34);
  assert((await state()).y < y1);
  assert.equal(await pitch(), -20);

  // Pause freezes everything.
  await page.getByRole('button', { name: 'Pause flight' }).tap({ force: true });
  const frozen = await birdY();
  await page.clock.runFor(1200);
  assert.equal(await phase(), 'paused');
  assert.equal(await birdY(), frozen);
  await page.getByRole('button', { name: 'Resume flight' }).tap({ force: true });

  // Pilot from the course state; scoring and collisions use the real game path.
  let s = await state();
  for (let i = 0; i < 2000 && s.phase === 'flying' && s.score < 3; i++) {
    const ahead = s.gates.filter((g) => g.x + 52 > 57);
    const g = ahead[0];
    const lo = g ? g.gapTop + 2 : 120;
    const hi = g ? g.gapTop + 100 - 18 - 2 : 300;
    let target = ahead[1] ? ahead[1].gapTop + 61 : hi - 10;
    target = Math.max(lo + 56, Math.min(hi - 4, target));
    const next = s.y + s.vy + 1;
    if (next > target && (next - 45 >= lo || next > hi - 2)) await tap();
    await page.clock.runFor(34);
    s = await state();
  }
  assert(s.score >= 3, `flight cleared three gates (${s.score})`);
  assert.equal(await page.locator('.nf-score b').textContent(), String(s.score));

  // Stop flapping: the bird hits something, falls to the quay and the board rises.
  await page.clock.runFor(6000);
  assert.equal(await phase(), 'over');
  const best = Number(await page.locator('[data-best]').textContent());
  assert(best >= 3);
  await page.clock.runFor(2000);
  assert.equal(Number(await page.locator('[data-total]').textContent()), (await state()).score, 'the score has counted up');
  await page.getByRole('button', { name: 'Fly again' }).tap({ force: true });
  assert.equal(await phase(), 'ready');
  assert.equal(await page.locator('.nf-score b').textContent(), '0');

  // Losing focus pauses; the keyboard flaps.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await phase(), 'paused');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.clock.runFor(50);
  await page.getByRole('button', { name: 'Resume flight' }).tap({ force: true });
  await page.keyboard.press('ArrowUp');
  assert.equal(await phase(), 'flying');
  const position = (await state()).y;
  await page.clock.runFor(50); // the next 30 Hz frame after a resume
  assert((await state()).y < position);
  assert(await page.locator('.nf.is-windowed').count(), 'a wide screen gets the portrait window');

  // The best score survives a reload, and the lobby link leaves the full-screen mode.
  await page.reload();
  await page.locator('.nf[data-phase="title"]').waitFor();
  assert.equal(Number(await page.locator('.nf-record b').textContent()), best);
  await page.getByRole('link', { name: 'Lobby', exact: true }).first().tap({ force: true });
  await page.clock.runFor(900);
  await page.getByRole('link', { name: 'Play Night Flight' }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('html.flight-open').count(), 0);
  assert.deepEqual(errors, []);
  console.log(engine.name(), 'passed: get ready bob, take-off arc, tilt, pause, three gates, crash and board, retry, focus pause, keyboard, window, best score, lobby.');
} finally {
  await browser.close();
}
