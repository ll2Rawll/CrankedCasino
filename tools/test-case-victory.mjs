// Full-screen celebration behavior, viewport coverage, motion preferences and cleanup.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
const {chromium,webkit}=createRequire(import.meta.url)('playwright-core');
const engine=process.env.BROWSER==='webkit'?webkit:chromium;
const repo=resolve(new URL('..',import.meta.url).pathname);
const browser=await engine.launch({executablePath:engine===chromium?'/usr/bin/chromium':webkit.executablePath()});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://victory.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/') return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/cases.css"><link rel="stylesheet" href="/css/cases-lobby.css"><main id="app"></main>'});
   return route.fulfill({path:join(repo,path)});
 });
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
 await page.goto('https://victory.test/');
 await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
 await page.evaluate(async()=>{
   window.victory=await import('/js/games/cases-victory.js');
   window.art=await import('/js/games/cases-scene.js');
   // Match the module URL stamp used by the scene to share functions/audio state.
   const source=await (await fetch('/js/games/cases-scene.js')).text();
   const version=source.match(/cases-victory\.js(\?v=[a-f0-9]+)/)[1];
   window.victory=await import(`/js/games/cases-victory.js${version}`);
   window.fixture={id:'domination',practice:false,state:'running',started:Date.now(),seat:0,players:[{name:'CrownedChampion',bot:false},{name:'Rook',bot:true}],cases:['dragonheart','starfall','leviathan'],entries:[125.75,20.25],pot:146,pulls:[[5,0],[4,0],[3,0]],totals:[395,24],payout:146};
   window.scene=art.caseScene(document.querySelector('#app'),fixture,{});
   scene.update(fixture,fixture.started);
 });
 assert.equal(await page.evaluate(()=>victory.dominantWin([252,223])),null);
 assert.equal(await page.evaluate(()=>victory.dominantWin([300,300])),null);
 assert.equal(await page.evaluate(()=>victory.dominantWin([500,350])),null);
 assert.deepEqual(await page.evaluate(()=>victory.dominantWin([200,350])),{winner:1,margin:150});
 await page.clock.runFor(18600);
 assert.equal(await page.locator('.cv-takeover').count(),0,'No celebration before confirmed settlement');
 await page.evaluate(()=>{fixture={...fixture,state:'complete'};scene.update(fixture,fixture.started+18600)});
 await page.clock.runFor(1250);
 await page.getByRole('dialog',{name:'CrownedChampion wins by 371 points'}).waitFor();
 assert.equal(await page.locator('.cv-name').textContent(),'CrownedChampion');
 assert.equal(await page.locator('.cv-margin').textContent(),'+371 POINT VICTORY');
 assert.match(await page.locator('.cv-relic').textContent(),/146.00 chip pot awarded/);
 assert.equal(await page.locator('.cv-confetti i').count(),36);
 const bounds=await page.locator('.cv-takeover').boundingBox();
 assert.deepEqual([bounds.x,bounds.y,bounds.width,bounds.height],[0,0,390,844]);
 assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'hidden');
 assert(await page.getByRole('button',{name:'View results'}).isVisible());
 await page.screenshot({path:`/workspace/scratch/rooster-tests/case-victory-${engine.name()}.png`,animations:'disabled'});
 await page.getByRole('button',{name:'View results'}).click({force:true});
 assert.equal(await page.locator('.cv-takeover').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');
 // Reopening the same completed battle must not interrupt the user again.
 assert.equal(await page.evaluate(()=>victory.caseVictory(fixture,{clock:fixture.started+19000})),null);
 await page.evaluate(()=>{scene.destroy();document.querySelector('#app').replaceChildren();});
 await page.clock.runFor(8000);
 assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
 // Small phones, a long name, keyboard dismissal, and each viewer's outcome.
 await page.setViewportSize({width:320,height:568});
 await page.evaluate(()=>{fixture={...fixture,id:'long-name',seat:1,players:[{name:'TwentyFourCharChampionXX',bot:false},{name:'Opponent',bot:false}]};window.closeVictory=victory.caseVictory(fixture,{clock:fixture.started+19000})});
 await page.clock.runFor(1400);
 assert(await page.evaluate(()=>document.querySelector('.cv-takeover').scrollWidth<=innerWidth));
 await page.screenshot({path:`/workspace/scratch/rooster-tests/case-victory-small-${engine.name()}.png`,animations:'disabled'});
 assert(await page.evaluate(()=>document.querySelector('.cv-relic').getBoundingClientRect().bottom <= document.querySelector('.cv-bottom').getBoundingClientRect().top));
 await page.keyboard.press('Escape');await page.clock.runFor(50);
 assert.equal(await page.locator('.cv-takeover').count(),0);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>{fixture={...fixture,id:'reduced'};window.closeVictory=victory.caseVictory(fixture,{clock:fixture.started+19000})});
 assert.equal(await page.locator('.cv-takeover').evaluate(el=>el.getAnimations({subtree:true}).length),0);
 assert.equal(await page.locator('.cv-name').textContent(),'TwentyFourCharChampionXX');
 await page.clock.runFor(7300);
 assert.equal(await page.locator('.cv-takeover').count(),0,'Auto-close must clean up');
 // Navigation destroys an active takeover and restores document scroll.
 await page.evaluate(()=>{
   fixture={...fixture,id:'navigation',started:Date.now()-18600,state:'complete'};
   scene=art.caseScene(document.querySelector('#app'),fixture,{});scene.update(fixture,Date.now());
 });
 await page.clock.runFor(40);
 assert.equal(await page.locator('.cv-takeover').count(),1);
 await page.evaluate(()=>{scene.destroy();document.querySelector('#app').replaceChildren();});
 assert.equal(await page.locator('.cv-takeover').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');
 await page.clock.runFor(8000);
 assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
 assert.equal(await page.evaluate(()=>victory.caseVictory({...fixture,id:'old-result'},{clock:fixture.started+100000})),null);
 assert.deepEqual(errors,[]);
 console.log(engine.name(),'passed big-win thresholds, confirmed results only, winner identity, full-screen coverage, skip/Escape, deduplication, reduced motion, auto-close and navigation cleanup.');
} finally {await browser.close()}
