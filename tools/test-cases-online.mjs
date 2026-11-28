// Real Supabase integration. BASE_URL uses deployed assets; otherwise serve local files via routes.
// Test account credentials are kept only in the execution workspace for post-deploy login checks.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {CONFIG} from '../js/config.js';
const {chromium,webkit}=createRequire(import.meta.url)('playwright-core');
const engine=process.env.BROWSER==='webkit'?webkit:chromium;
const repo=resolve(new URL('..',import.meta.url).pathname);
const base=process.env.BASE_URL || 'https://online-casino.test/';
const qaFile=`/workspace/scratch/rooster-tests/cases-online-qa-${new URL(CONFIG.supabaseUrl).hostname.split('.')[0]}.json`;
let accounts;
try {accounts=JSON.parse(await readFile(qaFile,'utf8'))}catch{accounts=['Host','Guest'].map(role=>({name:`Qa${role}${crypto.randomUUID().slice(0,6)}`,password:crypto.randomUUID(),created:false}));}
const browser=await engine.launch({executablePath:engine===chromium?'/usr/bin/chromium':webkit.executablePath()});
const pages=[],errors=[];
try {
 async function rpc(page,fn,args={}) {
   return page.evaluate(async({url,key,fn,args})=>{
     const token=JSON.parse(localStorage.getItem('cc:session'))?.token;
     const res=await fetch(`${url}/rest/v1/rpc/${fn}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({p_token:token,...args})});
     return res.json();
   },{url:CONFIG.supabaseUrl,key:CONFIG.supabaseKey,fn,args});
 }
 async function client(i,width) {
   const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:2,isMobile:width<500,hasTouch:width<500});
   if(!process.env.BASE_URL) await context.route('https://online-casino.test/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({path:join(repo,path==='/'?'index.html':path)});});
   const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`${base}#/cases`);
   await page.locator('[data-create]').click();
   if(accounts[i].created) await page.getByRole('tab',{name:'I have an account'}).click();
   await page.locator('input[name=username]').fill(accounts[i].name);
   await page.locator('input[name=password]').fill(accounts[i].password);
   await page.locator('.acct-go').click();
   await page.locator('.acct-root').waitFor({state:'detached',timeout:20000});
   accounts[i].created=true;await writeFile(qaFile,JSON.stringify(accounts),{mode:0o600});
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('cc:session')).mode),'server');
   assert.equal((await rpc(page,'cc_me')).ok,true);
   return page;
 }
 const host=await client(0,1100), guest=await client(1,390);
 // The actual public REST API must reject a fabricated player token.
 assert.equal((await rpc(guest,'cc_cases_list',{p_token:'invalid-qa-token'})).error,'auth');
 const before=[(await rpc(host,'cc_me')).balance,(await rpc(guest,'cc_me')).balance];
 await host.locator('[data-battle-mode="public"]').click();
 await host.getByRole('spinbutton',{name:'Your bet',exact:true}).fill('25.50');
 await Promise.all([
   host.waitForResponse(r=>r.url().endsWith('/rpc/cc_cases_create')&&r.status()===200,{timeout:15000}),
   host.locator('[data-create]').click(),
 ]);
 await host.locator('[data-cancel]').waitFor();
 const publicId=new URL(host.url()).hash.split('battle=')[1];
 await guest.locator(`[data-room="${publicId}"]`).waitFor({timeout:15000});
 await host.locator('[data-cancel]').click();await host.getByRole('heading',{name:'Battle closed'}).waitFor();
 assert.equal((await rpc(host,'cc_me')).balance,before[0]);
 await host.locator('[data-back]').click();
 await host.locator('[data-battle-mode="private"]').click();
 await host.getByRole('spinbutton',{name:'Your bet',exact:true}).fill('125.75');await host.locator('[data-create]').click();
 await host.locator('.cases-invite input').waitFor();
 const invite=await host.locator('.cases-invite input').inputValue();
 const battleId=new URL(invite).hash.split('battle=')[1];
 assert(!(await rpc(guest,'cc_cases_list')).rooms.some(room=>room.id===battleId));
 await guest.goto(invite);
 await guest.locator('[data-join]').waitFor();
 await guest.getByRole('spinbutton',{name:'Your bet',exact:true}).fill('20.25');
 assert.equal(await guest.locator('[data-join]').textContent(),'Join battle · 20.25 chips');
 // One click directly from the focused wager must submit, including Safari's blur/change path.
 await Promise.all([
   guest.waitForResponse(r=>r.url().endsWith('/rpc/cc_cases_join')&&r.status()===200,{timeout:15000}),
   guest.locator('[data-join]').click(),
 ]);
 await Promise.all([host.locator('#case-openings').waitFor(),guest.locator('#case-openings').waitFor()]);
 assert.equal(await guest.locator('.cb-pot').textContent(),'146.00 CHIP POT');
 await guest.reload();await guest.locator('#case-openings').waitFor();
 await Promise.all(pages.map(page=>page.getByRole('button',{name:'Battle again',exact:true}).waitFor({timeout:35000})));
 const results=await Promise.all(pages.map(page=>rpc(page,'cc_cases_get',{p_id:battleId})));
 assert(results.every(r=>r.ok&&r.battle.state==='complete'));
 assert.deepEqual(results[0].battle.pulls,results[1].battle.pulls);
 assert.deepEqual(results[0].battle.totals,results[1].battle.totals);
 assert.deepEqual(results[0].battle.entries,[125.75,20.25]);
 assert.equal(results[0].balance+results[1].balance,before[0]+before[1]);
 for(let i=0;i<2;i++) {
   assert.equal(results[i].battle.receipt.a,[125.75,20.25][i]);
   assert.equal((await rpc(pages[i],'cc_cases_get',{p_id:battleId})).balance,results[i].balance);
 }
 assert.deepEqual(errors,[]);
 await guest.screenshot({path:`/workspace/scratch/rooster-tests/cases-online-${process.env.BASE_URL?'live':'preview'}.png`,fullPage:true});
 console.log(`${engine.name()} real online test passed: shared accounts, public lobby, exact cancellation refund, private invite, unequal wagers, reload recovery, identical outcomes and conserved balances.`);
 console.log('QA usernames for scoped cleanup:',accounts.map(a=>a.name).join(', '));
} catch(error) {
 console.error('Page errors',errors);
 for(const page of pages) console.error(await page.locator('main').innerText().catch(()=>''));
 throw error;
} finally {await browser.close()}
