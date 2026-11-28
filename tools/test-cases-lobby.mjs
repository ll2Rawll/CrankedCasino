// NODE_PATH=<playwright-core location> [BROWSER=webkit] node tools/test-cases-lobby.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
const { chromium, webkit } = createRequire(import.meta.url)('playwright-core');
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
const repo = resolve(new URL('..', import.meta.url).pathname);
const browser = await engine.launch({ executablePath: engine === chromium ? '/usr/bin/chromium' : webkit.executablePath() });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://casino.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ path: join(repo, path === '/' ? 'index.html' : path) });
  });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('https://casino.test/#/cases');
  await page.locator('.cs-showroom').waitFor();
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.cs-builder img')].map(img => img.decode())));
  await page.screenshot({ path: `/workspace/scratch/rooster-tests/cases-lobby-${engine.name()}.png`, fullPage: true, animations: 'disabled' });
  assert.equal(await page.locator('.cs-round').count(), 3);
  assert.equal(await page.locator('.cs-builder select').count(), 0);
  await page.locator('[data-edit-round="1"]').click({ force: true });
  assert(await page.getByRole('dialog', { name: 'Choose your case' }).isVisible());
  await page.screenshot({ path: `/workspace/scratch/rooster-tests/cases-picker-${engine.name()}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Use High Roller for round 2' }).click({ force: true });
  assert.equal(await page.locator('.cs-picker-dialog').getAttribute('open'), null);
  assert.equal(await page.locator('.cs-showroom h2').textContent(), 'High Roller');
  assert.match(await page.locator('.cs-cover').getAttribute('src'), /case-high-roller.webp/);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('cc:cases:lineup'))), ['after-hours', 'high-roller', 'high-roller']);
  await page.locator('[data-peek]').click({ force: true });
  await page.locator('.cs-is-open').waitFor();
  await page.clock.runFor(900);
  assert.match(await page.locator('.cs-cover').getAttribute('src'), /case-high-roller-opened.webp/);
  assert.equal(await page.locator('.cs-treasures img').count(), 6);
  assert.match(await page.locator('.cs-preview-caption').textContent(), /preview only/);
  assert.equal(await page.evaluate(() => localStorage.getItem('cc:device:db')), null);
  await page.screenshot({ path: `/workspace/scratch/rooster-tests/cases-peek-${engine.name()}.png`, animations: 'disabled' });
  await page.locator('[data-edit-round="0"]').click({ force: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.cs-picker-dialog').getAttribute('open'), null);
  // A new selection must cancel a pending preview, even before its decode resolves.
  await page.evaluate(() => {
    document.querySelector('[data-peek]').click();
    document.querySelector('[data-edit-round="2"]').click();
  });
  await page.clock.runFor(1000);
  assert.equal(await page.locator('.cs-is-open').count(), 0);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('.cs-showroom').waitFor();
  assert.match(await page.locator('[data-edit-round="1"]').getAttribute('aria-label'), /High Roller/);
  await page.locator('[data-shuffle]').click({ force: true });
  const lineup = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:cases:lineup')));
  assert.equal(lineup.length, 3);
  assert(lineup.every(id => ['after-hours','neon-vault','high-roller'].includes(id)));
  for (const width of [320,390,1280]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
    await page.clock.runFor(100);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px overflow`);
    await page.screenshot({ path: `/workspace/scratch/rooster-tests/cases-lobby-${width}-${engine.name()}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-peek]').click({ force: true });
  await page.locator('.cs-is-open').waitFor();
  await page.clock.runFor(100);
  assert.equal(await page.locator('.cs-builder').evaluate(root => root.getAnimations({ subtree: true }).length), 0);
  await page.locator('[data-practice]').click({ force: true });
  await page.clock.runFor(24000);
  assert.match(await page.locator('.cb-verdict').textContent(), /practice complete/);
  assert.equal(await page.locator('.cs-showroom').count(), 0);
  // Exercise the server-mode controls without making requests to a live service.
  const online = await browser.newPage({ viewport: { width: 390, height: 844 } });
  online.on('pageerror', error => errors.push(error.message));
  await online.route('https://casino.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/js/config.js') return route.fulfill({ contentType: 'text/javascript', body: "export const CONFIG={supabaseUrl:'https://case-db.test',supabaseKey:'sb_publishable_qa',repoUrl:'https://github.com/ll2rawll/CrankedCasino',ads:{}};" });
    return route.fulfill({ path: join(repo, path === '/' ? 'index.html' : path) });
  });
  await online.route('https://case-db.test/**', route => route.abort());
  await online.goto('https://casino.test/#/cases');
  assert.equal(await online.locator('[data-battle-mode]').count(), 3);
  await online.locator('[data-battle-mode="private"]').click();
  assert.equal(await online.locator('[data-battle-mode="private"]').getAttribute('aria-pressed'), 'true');
  await online.locator('[data-battle-mode="bot"]').click();
  assert.equal(await online.locator('[data-battle-mode="private"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await online.locator('[data-battle-mode="bot"]').getAttribute('aria-pressed'), 'true');
  await online.close();
  assert.deepEqual(errors, []);
  console.log(engine.name(), 'passed visual picker, saved lineup, shuffle, free case preview, 320/390/1280px layouts, reduced motion and a complete practice battle.');
} finally { await browser.close(); }
