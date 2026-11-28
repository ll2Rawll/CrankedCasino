// Two mobile browser sessions through real casino RPCs, never mocked game results.
// MULTIPLAYER_DB=<disposable Docker PostgreSQL container> node tools/test-shared-games-browser.mjs
// BROWSER=webkit selects Safari's engine. LIVE_QA_FILE=/absolute/private/file.json explicitly
// enables a live BASE instead; it saves temporary accounts for owner-directed cleanup.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
const { chromium, webkit } = createRequire(import.meta.url)('playwright-core');
const container = process.env.MULTIPLAYER_DB;
const credentials = process.env.LIVE_QA_FILE;
assert(container || credentials, 'Use a disposable MULTIPLAYER_DB, or explicitly supply LIVE_QA_FILE for an owner-authorized live test.');
const base = container ? 'https://casino.test/' : process.env.BASE;
assert(base, 'BASE is required for a live test');
const repo = resolve(new URL('..', import.meta.url).pathname);
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ executablePath: engine === webkit ? webkit.executablePath() : process.env.CHROMIUM || '/usr/bin/chromium' });
const accounts = credentials && existsSync(credentials) ? JSON.parse(readFileSync(credentials, 'utf8'))
  : ['Host', 'Guest'].map(role => ({ name: 'QASG' + role + crypto.randomUUID().slice(0, 5), password: crypto.randomUUID() }));
const save = () => credentials && writeFileSync(credentials, JSON.stringify(accounts), { mode: 0o600 });
save();
const pages = [], errors = [], failedRPCs = [];
let closingTable = false, holdNextHostPoll = false, heldPoll = null;
const literal = value => value == null ? 'NULL' : "'" + (typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''") + "'";
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1']);
    let out = '', err = '';
    child.stdout.on('data', c => out += c); child.stderr.on('data', c => err += c);
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(err)) : resolve(JSON.parse(out.trim())));
    child.stdin.end(query);
  });
}
async function rpc(page, name, args = {}) {
  return page.evaluate(async ({ configURL, name, args }) => {
    const { CONFIG } = await import(configURL);
    const session = JSON.parse(localStorage.getItem('cc:session'));
    const r = await fetch(CONFIG.supabaseUrl + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: session.token, ...args }),
    });
    return { status: r.status, ...await r.json() };
  }, { configURL: new URL('js/config.js', base).href, name, args });
}
async function displayedBalance(page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(r => r.name.includes('/js/store.js?v=')).name;
    return (await import(url)).store.balance;
  });
}
async function request(page, name, action) {
  const [response] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/rpc/' + name), { timeout: 20000 }),
    action(),
  ]);
  const r = await response.json();
  assert.equal(r.ok, true, `${name}: ${r.error}`);
  return r;
}
async function client(account) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  if (container) {
    await context.route('https://casino.test/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/js/config.js') return route.fulfill({ contentType: 'text/javascript', body: "export const CONFIG={supabaseUrl:'https://casino-db.test',supabaseKey:'sb_publishable_qa',ads:{}};" });
      return route.fulfill({ path: join(repo, path === '/' ? 'index.html' : path) });
    });
    await context.route('https://casino-db.test/rest/v1/rpc/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const args = route.request().postDataJSON();
      assert(/^cc_[a-z_]+$/.test(name));
      assert(Object.keys(args).every(k => /^p_[a-z_]+$/.test(k)));
      try {
        const body = await sql(`set role anon; select public.${name}(${Object.entries(args).map(([k,v]) => `${k} => ${literal(v)}`).join(',')});`);
        if (holdNextHostPoll && name === 'cc_bjm_state' && account === accounts[0]) {
          holdNextHostPoll = false;
          await new Promise(resolve => { heldPoll = { release: resolve }; });
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      } catch(e) { errors.push(e.message); await route.fulfill({ status: 500, body: '{}' }); }
    });
  }
  if (account.session) await context.addInitScript(session => localStorage.setItem('cc:session', JSON.stringify(session)), account.session);
  const page = await context.newPage(); pages.push(page);
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', async r => {
    if (r.request().method() !== 'POST' || !/\/rpc\/cc_(duel|bjm)_/.test(r.url())) return;
    try {
      const body = await r.json();
      const expectedClosedPoll = closingTable && r.url().endsWith('/cc_bjm_state') && body.error === 'table_missing';
      if (r.status() !== 200 || (!body.ok && !expectedClosedPoll)) failedRPCs.push({ name: r.url().split('/').pop(), status: r.status(), error: body.error });
    } catch {}
  });
  await page.goto(base + '#/rooster');
  await page.locator('input[name="rr-mode"][value="duel"]').check();
  if (!account.session) {
    await page.locator('[data-post]').click();
    // Let the account sheet's opening focus animation finish before typing.
    await page.waitForTimeout(300);
    await page.locator('input[name=username]').fill(account.name);
    await page.locator('input[name=password]').fill(account.password);
    await page.locator('.acct-go').click();
    await page.locator('.acct-root').waitFor({ state: 'detached' });
    account.session = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:session')));
    save();
  }
  return page;
}
async function amount(page, value) {
  const input = page.getByRole('spinbutton', { name: 'Bet amount', exact: true });
  await input.fill(value);
  await input.blur();
}
async function finishRoad(page, hop) {
  await page.waitForFunction(() => globalThis.__ccRooster?.().phase === 'run');
  if (hop) await page.locator('.rr-view canvas').tap({ position: { x: 150, y: 220 } });
  await page.waitForFunction(() => globalThis.__ccRooster?.().phase === 'over', { }, { timeout: 30000 });
  const state = await page.evaluate(() => __ccRooster());
  if (hop) assert(state.best >= 1, 'Forward tap must advance the rooster');
  else assert.equal(state.best, 0);
  assert.equal(await page.locator('.rr-dialog').evaluate(el => el.open), true);
  assert(await page.locator('.rr-dialog').evaluate(el => el.getBoundingClientRect().width > innerWidth * .9));
  return state;
}
try {
  const host = await client(accounts[0]);
  let guest, duelId = null;
  if (process.env.ONLY_BLACKJACK !== '1') {
  const initialHost = (await rpc(host, 'cc_me')).balance;
  await amount(host, '12.50');
  const created = await request(host, 'cc_duel_create', () => host.locator('[data-post]').click());
  duelId = created.duel.id;
  assert.equal(created.balance, initialHost - 12.5);
  const hostRun = await finishRoad(host, true);
  assert.match(await host.locator('[data-center]').innerText(), /Challenge posted/);
  const posted = await rpc(host, 'cc_duel_get', { p_id: duelId });
  assert.equal(posted.duel.host_score, hostRun.best, 'Server replay must match the actual mobile run');
  await host.getByRole('button', { name: 'Exit game view', exact: true }).click();
  guest = await client(accounts[1]);
  const initialGuest = (await rpc(guest, 'cc_me')).balance;
  await amount(guest, '7.25');
  const joined = await request(guest, 'cc_duel_join', () => guest.locator(`[data-accept="${duelId}"]`).click());
  assert.equal(joined.duel.seed, created.duel.seed);
  assert.equal(joined.duel.host_score, null);
  await finishRoad(guest, false);
  assert.match(await guest.locator('[data-center]').innerText(), /wins/);
  const results = await Promise.all([rpc(host, 'cc_duel_get', { p_id: duelId }), rpc(guest, 'cc_duel_get', { p_id: duelId })]);
  assert(results.every(r => r.duel.state === 'done'));
  assert.equal(results[0].balance, initialHost + 12.5);
  assert.equal(results[1].balance, initialGuest - 7.25);
  await guest.getByRole('button', { name: 'Exit game view', exact: true }).click();
  await host.locator('[data-mine]').getByText(/Won 25.00/).waitFor();
  assert.equal(await displayedBalance(host), results[0].balance);
  assert.equal(await displayedBalance(guest), results[1].balance);
  console.log('PASS Road Rooster: two mobile players, fullscreen, tap movement, matching server score, hidden score, same road, custom stakes, winner payout and synchronized balances.');
  } else guest = await client(accounts[1]);

  for (const page of [host, guest]) {
    await page.goto(base + '#/blackjack');
    await page.locator('input[name="bj-mode"][value="table"]').check();
  }
  const seated = await request(host, 'cc_bjm_join', () => host.locator('[data-join=""]').click());
  const tableId = seated.table.id;
  await request(guest, 'cc_bjm_join', () => guest.locator(`[data-join="${tableId}"]`).click());
  for (const page of [host, guest]) await page.locator('.bjt-seat:not(.is-empty)').nth(1).waitFor();
  let state = await rpc(host, 'cc_bjm_state', { p_table: tableId });
  assert.equal(state.table.seats.filter(Boolean).length, 2);
  const before = await Promise.all([rpc(host, 'cc_me'), rpc(guest, 'cc_me')]);
  await amount(host, '6.25');
  await amount(guest, '4.75');
  await request(host, 'cc_bjm_bet', () => host.locator('.bjt-controls [data-place]').click());
  const dealt = await request(guest, 'cc_bjm_bet', () => guest.locator('.bjt-controls [data-place]').click());
  state = dealt;
  let acted = 0;
  while (state.table.phase === 'playing' && acted++ < 8) {
    assert.equal(state.table.dealer[1], '??');
    const name = state.table.seats[state.table.turn].name;
    const player = name === accounts[0].name ? host : guest;
    const other = player === host ? guest : host;
    await player.locator('.bjt-dock [data-a="stand"]').waitFor();
    assert.equal(await other.locator('.bjt-controls [data-a="stand"]').isDisabled(), true);
    state = await request(player, 'cc_bjm_act', () => player.locator('.bjt-dock [data-a="stand"]').click());
  }
  assert.equal(state.table.phase, 'done');
  assert(!state.table.dealer.includes('??'));
  const views = await Promise.all([rpc(host, 'cc_bjm_state', { p_table: tableId }), rpc(guest, 'cc_bjm_state', { p_table: tableId })]);
  assert.deepEqual(views[0].table.dealer, views[1].table.dealer);
  assert.deepEqual(views[0].table.seats.map(s => s?.result), views[1].table.seats.map(s => s?.result));
  for (let i = 0; i < 2; i++) {
    const page = [host, guest][i]; const r = views[i]; const seat = r.table.seats[r.table.me];
    assert.equal(r.balance, Math.round((before[i].balance - seat.wagered + seat.payout) * 100) / 100);
    await page.waitForFunction(async expected => {
      const u = performance.getEntriesByType('resource').find(r => r.name.includes('/js/store.js?v=')).name;
      return (await import(u)).store.balance === expected;
    }, r.balance);
  }
  // Reloading rejoins the same seat without reserving another wager.
  await host.reload();
  await host.locator('.bjt-felt.is-seated').waitFor();
  assert.equal((await rpc(host, 'cc_bjm_state', { p_table: tableId })).table.id, tableId);
  await host.waitForFunction(() => !document.querySelector('.bjt-controls [data-place]').disabled);
  const refundBefore = (await rpc(host, 'cc_me')).balance;
  await amount(host, '8.25');
  await request(host, 'cc_bjm_bet', () => host.locator('.bjt-controls [data-place]').click());
  if (container) {
    holdNextHostPoll = true;
    for (let i = 0; i < 100 && !heldPoll; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert(heldPoll, 'Expected a poll to be in flight before leaving');
  }
  await request(host, 'cc_bjm_leave', () => host.locator('.bjt-controls [data-leave]').click());
  await host.locator('.bjt-felt:not(.is-seated)').waitFor();
  if (heldPoll) {
    const response = host.waitForResponse(r => r.url().endsWith('/cc_bjm_state'));
    heldPoll.release();
    await response;
    await host.waitForTimeout(250);
    assert.equal(await host.locator('.bjt-felt.is-seated').count(), 0, 'A late poll must not restore a seat after leaving');
  }
  assert.equal((await rpc(host, 'cc_me')).balance, refundBefore);
  // A seat can remain reserved until a dealt hand settles. Leaving must still
  // stay in the lobby, and its eventual payout must update that lobby's wallet.
  await request(host, 'cc_bjm_join', () => host.locator(`[data-join="${tableId}"]`).click());
  await amount(host, '6.25');
  await amount(guest, '4.75');
  const leaveBefore = (await rpc(host, 'cc_me')).balance;
  await request(host, 'cc_bjm_bet', () => host.locator('.bjt-controls [data-place]').click());
  await request(guest, 'cc_bjm_bet', () => guest.locator('.bjt-controls [data-place]').click());
  await request(host, 'cc_bjm_leave', () => host.locator('.bjt-controls [data-leave]').click());
  assert.equal((await rpc(host, 'cc_bjm_lobby')).mine, null, 'An intentionally departed hand must not auto-rejoin');
  state = await rpc(guest, 'cc_bjm_state', { p_table: tableId });
  for (let i = 0; state.table.phase === 'playing' && i < 4; i++) {
    assert.equal(state.table.seats[state.table.turn].name, accounts[1].name);
    await guest.locator('.bjt-dock [data-a="stand"]').waitFor();
    state = await request(guest, 'cc_bjm_act', () => guest.locator('.bjt-dock [data-a="stand"]').click());
  }
  assert.equal(state.table.phase, 'done');
  const departed = state.table.seats.find(s => s?.name === accounts[0].name);
  const leaveExpected = Math.round((leaveBefore - 6.25 + departed.payout) * 100) / 100;
  assert.equal((await rpc(host, 'cc_me')).balance, leaveExpected);
  await host.waitForFunction(async expected => {
    const u = performance.getEntriesByType('resource').find(r => r.name.includes('/js/store.js?v=')).name;
    return (await import(u)).store.balance === expected;
  }, leaveExpected);
  assert.equal(await host.locator('.bjt-felt.is-seated').count(), 0);
  closingTable = true;
  await request(guest, 'cc_bjm_leave', () => guest.locator('.bjt-controls [data-leave]').click());
  assert.equal((await rpc(guest, 'cc_bjm_lobby')).mine, null);
  assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRPCs, []);
  console.log(`PASS shared Blackjack: two seats, unequal bets, hidden dealer, turns, matching results, settlement, reload recovery, pre-deal refund, ${container ? 'delayed polls after leaving, ' : ''}mid-hand departure and lobby payouts.`);
  console.log(JSON.stringify({ accounts: accounts.map(a => a.name), duelId, tableId, browser: engine.name() }));
} catch (e) {
  console.error(e.stack);
  console.error('Browser errors:', errors, 'Failed RPCs:', failedRPCs);
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({ path: `/workspace/scratch/shared-games-failure-${i}.png`, fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
} finally { await browser.close(); }
