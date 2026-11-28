import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
const {chromium}=createRequire(import.meta.url)('playwright-core');
const repo=resolve(new URL('..',import.meta.url).pathname);
const browser=await chromium.launch({executablePath:'/usr/bin/chromium'});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://victory.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   return path==='/'?route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/cases-lobby.css"><link rel="stylesheet" href="/css/cases-arena.css">'}):route.fulfill({path:join(repo,path)});
 });
 await page.goto('https://victory.test/');
 await page.evaluate(async()=>{window.victory=await import('/js/games/cases-victory.js');const img=new Image();img.src='/assets/cases/ember-5.webp?v=2';await img.decode();});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.evaluate(()=>{
   window.frameTimes=[];window.longTasks=[];
   new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
   const started=performance.now();let last=started;
   const sample=now=>{frameTimes.push(now-last);last=now;if(now-started<8000)requestAnimationFrame(sample);else window.sampleDone=true;};
   requestAnimationFrame(sample);
   victory.caseVictory({id:'performance',state:'complete',started:Date.now()-18600,seat:0,players:[{name:'CrankedChampion'},{name:'Rook',bot:true}],cases:['dragonheart','starfall','leviathan'],pulls:[[5,0],[4,0],[3,0]],totals:[395,24],pot:146});
 });
 await page.waitForTimeout(1800);
 await page.screenshot({path:'/workspace/scratch/rooster-tests/case-victory-motion.png'});
 await page.waitForFunction(()=>window.sampleDone,{},{timeout:12000});
 const stats=await page.evaluate(()=>{const a=frameTimes.slice(5).sort((a,b)=>a-b);return{frames:a.length,p95Ms:a[Math.floor(a.length*.95)],over50ms:a.filter(ms=>ms>50).length,longTasks:longTasks.length,maxLongTaskMs:Math.max(0,...longTasks),remainingOverlays:document.querySelectorAll('.cv-takeover').length,animations:document.getAnimations().length};});
 assert(stats.p95Ms<40,JSON.stringify(stats));assert.equal(stats.remainingOverlays,0);assert.equal(stats.animations,0);assert.deepEqual(errors,[]);
 console.log('Victory at 4x CPU, 390px, DPR2:',JSON.stringify(stats));
} finally {await browser.close()}
