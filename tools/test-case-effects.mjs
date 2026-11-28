// NODE_PATH=<playwright-core location> node tools/test-case-effects.mjs
// PERF=1 measures a real-time battle under 4x CPU throttling in Chromium.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
const { chromium, webkit } = createRequire(import.meta.url)('playwright-core');
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
const perf = process.env.PERF === '1';
const repo = resolve(new URL('..', import.meta.url).pathname);
const browser = await engine.launch({ executablePath: engine === chromium ? '/usr/bin/chromium' : webkit.executablePath() });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://effects.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/cases.css"><style>body{margin:12px;background:#0d090f}#app{max-width:960px;margin:auto}</style><main id="app"></main>' });
    return route.fulfill({ path: join(repo, pathname) });
  });
  if (!perf) await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('https://effects.test/');
  if (!perf) await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.evaluate(async () => {
    window.art = await import('/js/games/cases-scene.js');
    await art.warmCaseArt();
    // Observe only work after assets have been decoded.
    window.longTasks = [];
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' });
    }
  });
  if (perf && engine === chromium) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.evaluate(perf => {
    window.frameTimes = [];
    window.runAt = performance.now();
    let previous = runAt;
    function sample(now) {
      frameTimes.push(now - previous);
      previous = now;
      if (now - runAt < 19000) requestAnimationFrame(sample);
    }
    if (perf) requestAnimationFrame(sample);
    window.battle = { practice: true, state: 'complete', started: Date.now(), seat: 0, players: [{ name: 'You' }, { name: 'Rook', bot: true }], cases: ['after-hours','neon-vault','high-roller'], pulls: [[1,2],[0,4],[5,3]], totals: [252,223] };
    window.scene = art.caseScene(document.querySelector('#app'), battle, {});
    scene.update(battle, battle.started);
  }, perf);
  if (perf) {
    await page.getByRole('button', { name: 'Battle again', exact: true }).waitFor({ timeout: 25000 });
    const stats = await page.evaluate(() => {
      const samples = frameTimes.slice(5).sort((a, b) => a - b);
      return { frames: samples.length, medianMs: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)], framesOver50ms: samples.filter(ms => ms > 50).length, longTasks: longTasks.length, maxLongTaskMs: Math.max(0, ...longTasks), canvases: document.querySelectorAll('canvas').length };
    });
    console.log('4x CPU, 390px, DPR 2:', JSON.stringify(stats));
    assert.equal(stats.canvases, 0);
    assert(stats.p95Ms < 40, 'Animation frame budget regressed on the test machine');
  } else {
    await page.clock.runFor(4900);
    assert.equal(await page.locator('.cb-turntable').count(), 2);
    assert.equal(await page.locator('.cb-has-turntable>img').first().evaluate(el => getComputedStyle(el).visibility), 'hidden');
    const pose = await page.locator('.cb-turntable').first().getAttribute('style');
    await page.clock.runFor(300);
    assert.notEqual(await page.locator('.cb-turntable').first().getAttribute('style'), pose);
    await page.clock.runFor(600);
    assert.equal(await page.locator('.cb-turntable').count(), 0);
    assert.equal(await page.locator('.cb-revealed>img').first().evaluate(el => getComputedStyle(el).visibility), 'visible');
    await page.clock.runFor(11400);
    assert.equal(await page.locator('.cb-rare').count(), 1);
    assert.match(await page.locator('.cb-momentum').textContent(), /Lead stolen/);
    await page.screenshot({ path: `/workspace/scratch/rooster-tests/cases-reveal-${engine.name()}.png` });
    await page.clock.runFor(2400);
    assert.equal(await page.locator('.cb-turntable').count(), 0);
    assert.equal(await page.locator('.cb-track').first().evaluate(el => getComputedStyle(el).willChange), 'auto');
    await page.getByRole('button', { name: 'Inspect Prism Edge, 220 points, round 3' }).click({ force: true });
    await page.getByRole('slider', { name: 'Rotate item' }).fill('9');
    await page.locator('.cb-inspect-turn[data-detail="ready"]').waitFor();
    await page.screenshot({ path: `/workspace/scratch/rooster-tests/cases-inspect-${engine.name()}.png` });
    await page.evaluate(() => { scene.destroy(); document.querySelector('#app').replaceChildren(); });
    await page.clock.runFor(3000);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    console.log(engine.name(), 'passed rotating reveals, still-art fallback, comeback, final cleanup and navigation with an open inspector.');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
