// Exercises two browser sessions through the real PostgreSQL RPCs.
// NODE_PATH=<playwright-core location> CASES_DB=CONTAINER node tools/test-case-battles-multiplayer.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const container = process.env.CASES_DB;
assert(container, 'CASES_DB must name a disposable PostgreSQL container');
const repo = resolve(new URL('..', import.meta.url).pathname);
const literal = (value) => Array.isArray(value) ? `ARRAY[${value.map(literal).join(',')}]` : value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec','-i',container,'psql','-U','postgres','-Atq','-v','ON_ERROR_STOP=1']);
    let out = '', error = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code ? reject(new Error(error)) : resolve(JSON.parse(out.trim())));
    child.stdin.end(query);
  });
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium' });
const pages=[];
const errors=[];
try {
  let failNextJoin = false;
  async function client(width) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('https://casino.test/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/js/config.js') return route.fulfill({ contentType:'text/javascript', body:"export const CONFIG={supabaseUrl:'https://case-db.test',supabaseKey:'sb_publishable_qa',repoUrl:'https://github.com/ll2rawll/CrankedCasino',ads:{}};" });
      return route.fulfill({ path: join(repo, path === '/' ? 'index.html' : path) });
    });
    await context.route('https://case-db.test/rest/v1/rpc/**', async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const args = route.request().postDataJSON();
      if (name === 'cc_cases_join' && failNextJoin) { failNextJoin = false; return route.fulfill({status:503,contentType:'application/json',body:'{}'}); }
      assert(/^cc_[a-z_]+$/.test(name));
      assert(Object.keys(args).every((key) => /^p_[a-z_]+$/.test(key)));
      try {
        const response = await sql(`set role anon; select public.${name}(${Object.entries(args).map(([key,value]) => `${key} => ${literal(value)}`).join(',')});`);
        await route.fulfill({ contentType:'application/json', body:JSON.stringify(response), headers:{'access-control-allow-origin':'*'} });
      } catch (error) {
        errors.push(error.message);
        await route.fulfill({ status:500, contentType:'application/json', body:JSON.stringify({message:error.message}) });
      }
    });
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('https://casino.test/#/cases');
    await page.locator('[data-create]').click();
    const name = `Battle${crypto.randomUUID().slice(0,8)}`;
    await page.locator('input[name=username]').fill(name);
    await page.locator('input[name=password]').fill('multiplayer-case-123');
    await page.locator('.acct-go').click();
    await page.locator('.acct-root').waitFor({state:'detached'});
    return page;
  }
  const host = await client(1100);
  const guest = await client(390);
  for(const [i,id] of ['dragonheart','starfall','leviathan'].entries()){
    await host.locator(`[data-edit-round="${i}"]`).click();
    await host.locator(`[data-case-choice="${id}"]`).click();
  }
  await host.locator('[data-battle-mode="private"]').click();
  await host.getByRole('spinbutton',{name:'Your bet',exact:true}).fill('125.75');
  await host.locator('[data-create]').click();
  await host.locator('.cases-invite input').waitFor();
  const invite = await host.locator('.cases-invite input').inputValue();
  await guest.goto(invite);
  const guestWager = guest.getByRole('spinbutton',{name:'Your bet',exact:true});
  await guestWager.fill('20.25');
  assert.equal(await guest.locator('[data-join-pot]').textContent(),'146.00');
  failNextJoin = true;
  await guest.locator('[data-join]').click();
  await guest.getByRole('button',{name:'Retry join · 20.25 chips',exact:true}).waitFor();
  await guest.locator('.cases-error').filter({hasText:'server hiccuped'}).waitFor();
  assert(await guestWager.isDisabled());
  await guest.evaluate(()=>localStorage.setItem('cc:bet:cases','800'));
  await guest.reload();
  await guest.getByRole('button',{name:'Retry join · 20.25 chips',exact:true}).waitFor();
  assert.equal(await guestWager.inputValue(),'20.25');
  assert(await guestWager.isDisabled());
  await guest.locator('[data-join]').click();
  await Promise.all([host.locator('#case-openings').waitFor(),guest.locator('#case-openings').waitFor()]);
  if (process.env.VICTORY === '1') {
    const battleId = new URL(invite).hash.split('battle=')[1];
    assert(/^[a-f0-9-]{36}$/.test(battleId));
    await sql(`with updated as (update cc.case_battles set pulls='[[5,0],[4,0],[3,0]]'::jsonb where id=${literal(battleId)} returning id) select to_json(count(*)) from updated;`);
    await Promise.all([host.locator('.cv-takeover').waitFor({timeout:35000}),guest.locator('.cv-takeover').waitFor({timeout:35000})]);
    assert.equal(await host.locator('.cv-name').textContent(),await guest.locator('.cv-name').textContent());
    assert.deepEqual(await guest.locator('.cv-score span').allTextContents(),['395','24']);
    assert.equal(await guest.locator('.cv-margin').textContent(),'+371 POINT VICTORY');
    await guest.screenshot({path:'/workspace/scratch/rooster-tests/cases-multiplayer-victory.png',animations:'disabled'});
    await Promise.all([host.getByRole('button',{name:'View results'}).click(),guest.getByRole('button',{name:'View results'}).click()]);
    console.log('Both multiplayer clients displayed the same confirmed winner, score, margin and fullscreen celebration.');
  }
  await Promise.all([host.getByRole('button',{name:'Battle again',exact:true}).waitFor({timeout:35000}),guest.getByRole('button',{name:'Battle again',exact:true}).waitFor({timeout:35000})]);
  assert.equal(await guest.locator('.cb-pot').textContent(),'146.00 CHIP POT');
  assert.deepEqual(await guest.locator('.cb-player-wager strong').allTextContents(),['125.75','20.25']);
  assert(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await guest.screenshot({path:'/workspace/scratch/rooster-tests/cases-unequal-stakes.png',fullPage:true});
  assert.deepEqual(await host.locator('.cb-result-name').allTextContents(),await guest.locator('.cb-result-name').allTextContents());
  assert.deepEqual(await host.locator('.cb-total').allTextContents(),await guest.locator('.cb-total').allTextContents());
  assert.equal(await host.locator('.cb-history img').count(),6);
  assert.equal(await guest.locator('.cb-history img').count(),6);
  assert.match(await host.locator('.cb-verdict').textContent(), /chips returned/);
  assert.match(await guest.locator('.cb-verdict').textContent(), /chips returned/);
  assert.deepEqual(errors,[]);
  console.log('Two authenticated browser sessions passed private-room creation, invite navigation, unequal decimal bets, join failure/reload recovery, joining, synchronized reveals, matching scores and settlement against the real PostgreSQL RPCs as anon.');
} catch(error) {
  console.error('Browser errors',errors);
  for(const page of pages) console.error(await page.locator('.cases-page').innerText());
  throw error;
} finally { await browser.close(); }
