// NODE_PATH=<playwright-core location> node tools/test-case-battles-browser.mjs
// Set BROWSER=webkit to exercise Safari's browser engine.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const { chromium, webkit } = createRequire(import.meta.url)('playwright-core');
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
const mythic = process.env.MYTHIC === '1';
const testCases = mythic ? ['dragonheart','starfall','leviathan'] : ['after-hours','neon-vault','high-roller'];
const specialName = mythic ? 'Leviathan Trident' : 'Prism Edge';
const repo = resolve(new URL('..', import.meta.url).pathname);
const browser = await engine.launch({ executablePath: engine === chromium ? process.env.CHROMIUM || '/usr/bin/chromium' : webkit.executablePath() });
let page;
const errors = [];
try {
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://casino.test/**', (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    return route.fulfill({ path: join(repo, pathname === '/' ? 'index.html' : pathname) });
  });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('https://casino.test/#/cases');
  await page.locator('[data-practice]').waitFor();
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('[data-practice]').click({ force: true });
  await page.clock.runFor(23000);
  assert.match(await page.locator('.cb-verdict').textContent(), /practice complete/);
  assert.equal(await page.locator('.cb-history img').count(), 6);
  assert.equal(await page.evaluate(() => localStorage.getItem('cc:device:db')), null);
  await page.locator('.cb-start').click({ force: true });
  await page.locator('[data-create]').click({ force: true });
  await page.locator('input[name=username]').fill('CaseBrowser');
  await page.locator('input[name=password]').fill('case-browser-123');
  await page.locator('.acct-go').click({ force: true });
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('cc:session'))?.token);
  await page.getByRole('button', { name: 'Battle bot · 50 chips' }).waitFor();
  await page.clock.runFor(400);
  await page.locator('.acct-root').waitFor({ state: 'detached' });
  await page.locator('[data-edit-round="1"]').click();
  await page.locator('[data-case-choice="neon-vault"]').click();
  await page.locator('[data-edit-round="2"]').click();
  await page.locator('[data-case-choice="high-roller"]').click();
  // A retry must show and lock its original lineup, even if saved preferences differ.
  await page.evaluate(cases => {
    localStorage.setItem('cc:cases:pending:CaseBrowser', JSON.stringify({ id: crypto.randomUUID(), cases, visibility: 'bot' }));
    localStorage.setItem('cc:cases:lineup', JSON.stringify(['high-roller','high-roller','high-roller']));
  }, testCases);
  await page.reload();
  await page.locator('.cs-builder').waitFor();
  await page.clock.runFor(200);
  await page.getByRole('button', { name: 'Retry pending battle', exact: true }).waitFor();
  assert.deepEqual(await page.locator('.cs-round strong').allTextContents(), mythic ? ['Dragonheart','Starfall','Leviathan'] : ['After Hours','Neon Vault','High Roller']);
  assert.equal(await page.locator('[data-edit-round]:disabled').count(), 3);
  assert(await page.locator('[data-shuffle]').isDisabled());
  await page.locator('[data-create]').click({ force: true });
  await page.locator('#case-openings').waitFor();
  assert.match(page.url(), /battle=[a-f0-9-]{36}/);
  await page.clock.runFor(1600);
  assert.equal(await page.locator('#balanceNum').textContent(), '950.00');
  // A fixed QA fixture exercises the special-item reveal and comeback every run.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('cc:device:db'));
    Object.values(db.players)[0].caseBattles[0].pulls = [[1,2],[0,4],[5,3]];
    localStorage.setItem('cc:device:db', JSON.stringify(db));
  });
  const battleId = new URLSearchParams(page.url().split('?')[1]).get('battle');
  await page.clock.runFor(3200);
  await page.reload();
  await page.locator('.cases-content').waitFor();
  await page.clock.runFor(200);
  await page.locator('#case-openings').waitFor();
  await page.clock.runFor(19000);
  await page.waitForFunction(() => document.querySelector('.cb-start')?.textContent === 'Battle again');
  const state = await page.evaluate(() => {
    const player = Object.values(JSON.parse(localStorage.getItem('cc:device:db')).players)[0];
    return { balance: player.balance, stats: player.stats, battles: player.caseBattles, history: player.history };
  });
  assert.equal(state.battles.length, 1);
  assert.equal(state.battles[0].id, battleId);
  assert.equal(state.battles[0].state, 'complete');
  assert.equal(state.balance, 950 + state.battles[0].payout);
  assert.equal(state.stats.games.cases.bets, 1);
  assert.equal(await page.locator('.cb-rare').count(), 1);
  assert.match(await page.locator('.cb-momentum').textContent(), /Lead stolen! CaseBrowser \+29 pts/);
  assert.equal(await page.locator('.cb-finale strong').textContent(), 'CaseBrowser');
  assert.equal(await page.locator('.cb-past:enabled').count(), 6);
  // The accelerated clock can finish three rounds before deferred image decoding.
  await page.evaluate(async cases => {
    const version = new URL(document.querySelector('script[type="module"]').src).search;
    await (await import(`/js/games/cases-scene.js${version}`)).warmCaseArt(cases);
  }, testCases);
  await page.getByRole('button', { name: `Inspect ${specialName}, 220 points, round 3` }).click({ force: true });
  await page.getByRole('dialog', { name: specialName }).waitFor();
  assert.match(await page.locator('.cb-inspect-stats').textContent(), mythic ? /1% drop chance/ : /3% drop chance/);
  const rotation = page.getByRole('slider', { name: 'Rotate item' });
  await rotation.fill('6');
  const rotationPosition = await page.locator('.cb-inspect-turn').evaluate(el => el.style.backgroundPosition.split(' ').map(parseFloat));
  assert.equal(rotationPosition[0], 0);
  assert(Math.abs(rotationPosition[1] - 100 / 3) < .001);
  await page.keyboard.press('Escape');
  await page.locator('.cb-inspect').waitFor({ state: 'detached' });
  assert.match(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), /Inspect (Prism Edge|Leviathan Trident)/);
  assert.equal(state.history.filter((row) => row.g === 'cases').length, 1);
  assert.deepEqual(await page.locator('.cb-result-name').allTextContents(), state.battles[0].pulls[2].map((index) => (mythic ? ['Abyss Doubloon','Siren Conch','Coral Signet','Tidal Pearl','Sovereign Crest','Leviathan Trident'] : ['House Stack','Violet Audio','Emerald Signet','Ice Cut','Midnight Dial','Prism Edge'])[index]));
  await page.screenshot({ path: `/workspace/scratch/rooster-tests/cases-app-${mythic ? 'mythic-' : ''}${engine.name()}.png`, fullPage: true });
  const alignment = await page.locator('.cb-landed').evaluateAll((cards) => cards.map((card) => {
    const box = card.getBoundingClientRect(), window = card.closest('.cb-window').getBoundingClientRect();
    const track = card.parentElement;
    return { error: box.x + box.width / 2 - window.x - window.width / 2, width: box.width, transform: track.style.transform, computed: getComputedStyle(track).transform, gap:getComputedStyle(track).gap, offset:card.offsetLeft, windowWidth:window.width, clientWidth:track.parentElement.clientWidth };
  }));
  assert(alignment.every((item) => Math.abs(item.error) < 1), JSON.stringify(alignment));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.runFor(80);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.cb-start').click({ force: true });
  await page.clock.runFor(1200);
  await page.locator('[data-recent-section]').waitFor();
  assert.equal(await page.locator('.cases-recent').count(), 1);
  await page.locator('[data-rules]').click({ force: true });
  assert.equal(await page.locator('.case-odds tbody tr').count(), 6);
  await page.locator('.modal-root .close-x').click({force:true});
  await page.clock.runFor(400);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-practice]').click({force:true});
  await page.clock.runFor(24000);
  assert.match(await page.locator('.cb-verdict').textContent(), /practice complete/);
  assert.equal(await page.locator('#case-openings').evaluate(el=>el.getAnimations({subtree:true}).length),0);
  assert.deepEqual(errors, []);
  console.log(engine.name(), 'passed free practice, account creation, case selection, paid entry, reload recovery, complete battle, exact reel landing, single payout, history, odds and 320px layout.');
} catch (error) {
  console.error('Page errors', errors);
  console.error('Game state', await page.locator('.cases-page').innerText());
  console.error('Input state', await page.evaluate(async () => {
    const button = document.querySelector('[data-create]');
    const box = button?.getBoundingClientRect();
    return { disabled:button?.disabled, hit:box?document.elementsFromPoint(box.x+box.width/2,box.y+box.height/2).slice(0,4).map(el=>el.className):[], pending:JSON.parse(localStorage.getItem('cc:cases:pending:CaseBrowser')), battles:Object.values(JSON.parse(localStorage.getItem('cc:device:db'))?.players||{})[0]?.caseBattles?.length, locks:await navigator.locks?.query() };
  }));
  throw error;
} finally {
  await browser.close();
}
