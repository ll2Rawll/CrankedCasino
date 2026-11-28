// Real app styles, orbital motion/landing, every case finish, phone layouts and delayed results.
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
 await page.route('https://orbit.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/js/config.js')return route.fulfill({contentType:'text/javascript',body:"export const CONFIG={supabaseUrl:'',supabaseKey:'',repoUrl:'',ads:{}};"});
   return route.fulfill({path:join(repo,path==='/'?'index.html':path)});
 });
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
 await page.goto('https://orbit.test/#/cases');
 await page.locator('[data-practice]').waitFor();
 await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
 await page.evaluate(async()=>{
   const stamp=new URL(document.querySelector('script[type="module"]').src).search;
   window.art=await import(`/js/games/cases-scene.js${stamp}`);
   await art.warmCaseArt(['dragonheart','starfall','leviathan']);
   document.querySelector('.cases-heading').hidden=true;
   window.makeScene=(cases=['dragonheart','starfall','leviathan'],pulls=[[1,2],[0,4],[5,3]])=>{
     window.scene?.destroy();
     window.battle={id:'orbit-qa',state:'running',practice:false,started:Date.now(),seat:0,players:[{name:'2Raw'},{name:'Rook',bot:true}],cases,pulls,totals:[252,223],pot:9.1,entries:[4.55,4.55],payout:9.1};
     scene=art.caseScene(document.querySelector('.cases-content'),battle,{});scene.update(battle,Date.now());
   };
   makeScene();
 });
 await page.clock.runFor(2400);
 assert.equal(await page.locator('#case-openings').getAttribute('data-phase'),'spin');
 assert.equal(await page.locator('.ca-gate').count(),2);
 const active=await page.locator('.cb-item').count();
 assert(active>0&&active<=16,'Only nearby items should enter the render tree');
 assert(await page.locator('.cb-item').first().evaluate(e=>/matrix3d/.test(getComputedStyle(e).transform)));
 assert.equal(await page.locator('.cb-item').first().evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
 await page.locator('#case-openings').screenshot({path:`/workspace/scratch/rooster-tests/orbit-spin-${engine.name()}.png`});
 await page.setViewportSize({width:320,height:844});await page.clock.runFor(300);
 await page.setViewportSize({width:390,height:844});await page.clock.runFor(1700);
 const landing=await page.locator('.cb-landed').evaluateAll(items=>items.map(item=>{
   const a=item.getBoundingClientRect(),b=item.closest('.cb-window').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2);
 }));
 assert(landing.length===2&&landing.every(x=>x<1),JSON.stringify(landing));
 await page.clock.runFor(1500);
 assert.deepEqual(await page.locator('.cb-result-name').allTextContents(),['Ember Fang','Phoenix Feather']);
 await page.locator('#case-openings').screenshot({path:`/workspace/scratch/rooster-tests/orbit-reveal-${engine.name()}.png`});
 for(const width of [320,390,1280]){
   await page.setViewportSize({width,height:900});await page.clock.runFor(40);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px overflow`);
   const overlaps=await page.locator('.cb-player-head').evaluateAll(heads=>heads.some(head=>head.querySelector('.cb-identity').getBoundingClientRect().right>head.querySelector('.cb-total').getBoundingClientRect().left));
   assert(!overlaps,`${width}px player names overlap scores`);
   const alignment=await page.locator('.cb-landed').evaluateAll(items=>items.map(item=>{
     const a=item.getBoundingClientRect(),b=item.closest('.cb-window').getBoundingClientRect();return {error:a.x+a.width/2-b.x-b.width/2,left:item.style.left,transform:item.parentElement.style.transform,width:b.width,itemWidth:a.width};
   }));
   assert(alignment.every(x=>Math.abs(x.error)<1),`${width}px resize: ${JSON.stringify(alignment)}`);
   await page.locator('#case-openings').screenshot({path:`/workspace/scratch/rooster-tests/orbit-${width}-${engine.name()}.png`});
 }
 // A delayed server response must never reveal a filler item or invent a score.
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>makeScene(['starfall','leviathan','dragonheart'],[null,null,null]));
 await page.clock.runFor(5300);
 assert.equal(await page.locator('.cb-revealed').count(),0);
 assert.match(await page.locator('.cb-case-status').textContent(),/Waiting for connection/);
 assert.deepEqual(await page.locator('.cb-total').evaluateAll(els=>els.map(e=>e.dataset.value)),['0','0']);
 await page.evaluate(()=>{battle={...battle,pulls:[[3,1],null,null]};scene.update(battle,Date.now())});
 await page.clock.runFor(600);
 assert.equal(await page.locator('.cb-revealed').count(),2);
 await page.locator('#case-openings').screenshot({path:`/workspace/scratch/rooster-tests/orbit-starfall-${engine.name()}.png`});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>makeScene(['leviathan','starfall','dragonheart']));
 await page.clock.runFor(5900);
 assert.equal(await page.locator('#case-openings').evaluate(e=>e.getAnimations({subtree:true}).length),0);
 assert.equal(await page.locator('.cb-turntable').count(),0);
 await page.locator('#case-openings').screenshot({path:`/workspace/scratch/rooster-tests/orbit-leviathan-${engine.name()}.png`});
 await page.evaluate(()=>{scene.destroy();document.querySelector('.cases-content').replaceChildren()});
 await page.clock.runFor(4000);
 assert.equal(await page.locator('.ca-gate').count(),0);
 assert.deepEqual(errors,[]);
 console.log(engine.name(),'passed orbital motion, bounded visible items, precise landing, 320/390/1280px layouts, all mythic finishes, delayed results, reduced motion and cleanup.');
}finally{await browser.close()}
