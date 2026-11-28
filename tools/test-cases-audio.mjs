// Render every original cue offline. Verifies output, headroom, bounded tails and mute.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const repo=resolve(new URL('..',import.meta.url).pathname);
const source=await readFile(join(repo,'js/games/cases-audio.js'),'utf8');
const version=source.match(/sound\.js(\?v=[a-f0-9]+)/)[1];
const { ALL_CASE_ITEMS, CASES }=await import('../js/games/cases-data.js');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium'});
try {
  const page=await browser.newPage();
  await page.route('https://audio.test/**',route=>{
    const path=new URL(route.request().url()).pathname;
    return path==='/'?route.fulfill({contentType:'text/html',body:'Audio test'}):route.fulfill({path:join(repo,path)});
  });
  const results=[];
  for(const cue of [...ALL_CASE_ITEMS.map(item=>({id:item.id,kind:'item'})),...CASES.map(type=>({id:type.id,kind:'case'})),{id:'victory',kind:'victory'},{id:'ember-5',kind:'mute'}]){
    await page.goto('https://audio.test/');
    const result=await page.evaluate(async ({cue,version})=>{
      window.AudioContext=class { constructor(){window.offline=new OfflineAudioContext(1,96000,48000);return offline;} };
      const sound=await import(`/js/sound.js${version}`);
      const cues=await import('/js/games/cases-audio.js');
      sound.setSound(true);sound.unlockAudio();
      if(cue.kind==='mute') sound.setSound(false);
      if(cue.kind==='case') cues.caseOpeningSound(cue.id); else if(cue.kind==='victory') cues.caseVictorySound(); else cues.itemRevealSound(cue.id);
      const buffer=await offline.startRendering();const samples=buffer.getChannelData(0);
      let peak=0,energy=0,tail=0,hash=0;
      samples.forEach((x,i)=>{peak=Math.max(peak,Math.abs(x));energy+=x*x;if(i>94000)tail=Math.max(tail,Math.abs(x));hash=(hash*31+Math.round(x*100000))|0;});
      return {...cue,peak,rms:Math.sqrt(energy/samples.length),tail,hash};
    },{cue,version});
    if(cue.kind==='mute') assert.equal(result.peak,0);
    else { assert(result.rms>.00005,JSON.stringify(result));assert(result.peak<.85,JSON.stringify(result));assert(result.tail<.0001,JSON.stringify(result)); }
    results.push(result);
  }
  assert.equal(new Set(results.filter(r=>r.kind==='item').map(r=>r.hash)).size,24);
  console.log(`Audio passed 24 item signatures, six case openings, victory fanfare, bounded tails and mute. Highest rendered peak: ${Math.max(...results.map(r=>r.peak)).toFixed(3)}.`);
} finally { await browser.close(); }
