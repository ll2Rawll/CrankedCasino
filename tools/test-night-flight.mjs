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

  // Bet flights: make an account on this device, bet on clearing 5 gates, fly them.
  await page.setViewportSize({ width: 390, height: 844 });
  const tag = await page.evaluate(() => new URL(document.querySelector('script[src*="main.js"]').src).search);
  await page.evaluate(async (tag) => {
    const { engine } = await import(`/js/engine.js${tag}`);
    const r = await engine.signup(`flyer${Math.floor(Math.random() * 1e6)}`, 'correct horse');
    if (!r.ok) throw new Error(r.error);
  }, tag);
  await page.reload();
  await page.locator('.nf[data-phase="title"]').waitFor();
  const balance = () => page.evaluate(async (tag) => (await import(`/js/store.js${tag}`)).store.balance, tag);
  await page.getByRole('button', { name: 'Bet flight' }).tap();
  await page.getByRole('button', { name: /^5 · 1\.5×/ }).tap();
  assert.equal(await page.getByRole('button', { name: /^5 · 1\.5×/ }).getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('.nf-note').textContent(), /Clear 5 gates to win 15\.00/);
  const b0 = await balance();
  await page.locator('[data-start]').tap();
  await page.clock.runFor(100);
  assert.equal(await phase(), 'ready');
  assert.equal(await balance(), b0 - 10, 'the bet leaves the balance');
  assert.equal((await state()).goal, 5);
  await tap();
  s = await state();
  for (let i = 0; i < 4000 && s.phase === 'flying'; i++) {
    const ahead = s.gates.filter((g) => g.x + 52 > 57);
    const g = ahead[0];
    const lo = g ? g.gapTop + 2 : 120;
    const hi = g ? g.gapTop + 100 - 18 - 2 : 300;
    let target = ahead[1] ? ahead[1].gapTop + 61 : hi - 10;
    target = Math.max(lo + 56, Math.min(hi - 4, target));
    const next = s.y + s.vy + 1;
    if (next > target && (next - 45 >= lo || next > hi - 2)) await tap();
    if (s.score === 3) assert.match(await page.locator('.nf-goal').textContent(), /of 5 · win 15\.00/);
    await page.clock.runFor(34);
    s = await state();
  }
  assert.equal(s.phase, 'won', 'the fifth gate ends the flight at once');
  assert.equal(s.score, 5);
  await page.clock.runFor(1500);
  assert.equal(await phase(), 'over');
  assert.match(await page.locator('.nf-board h2').textContent(), /Cleared/);
  assert.match(await page.locator('.nf-result').textContent(), /\+15\.00/);
  assert.equal(await balance(), b0 + 5, 'clearing 5 gates pays 1.5×');
  // Bet again on the same terms and fall straight into the harbor.
  await page.getByRole('button', { name: /Bet again/ }).tap({ force: true });
  await page.clock.runFor(100);
  await tap();
  await page.clock.runFor(4000);
  assert.equal(await phase(), 'over');
  assert.match(await page.locator('.nf-result').textContent(), /Bet lost/);
  assert.equal(await balance(), b0 - 5, 'a crash before the target loses the bet');
  await page.getByRole('button', { name: 'Change bet' }).tap({ force: true });
  assert.equal(await phase(), 'title');

  await page.getByRole('link', { name: 'Lobby', exact: true }).first().tap({ force: true });
  await page.clock.runFor(900);
  await page.getByRole('link', { name: 'Play Night Flight' }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('html.flight-open').count(), 0);
  assert.deepEqual(errors, []);
  console.log(engine.name(), 'passed: get ready bob, take-off arc, tilt, pause, three gates, crash and board, retry, focus pause, keyboard, window, best score, a bet flight paid at 5 gates, a lost bet, lobby.');
} finally {
  await browser.close();
}
