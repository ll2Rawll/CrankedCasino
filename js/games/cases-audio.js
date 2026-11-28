// Short, original sound identities. Shared master volume, gesture unlock and mute.
import { tone, noise } from '../sound.js?v=7ea755b2a1a3';
const bell = (freq, delay=0, gain=.07, dur=.55) => {
  tone({freq,delay,gain,dur,type:'sine',attack:.003});
  tone({freq:freq*2.76,delay,gain:gain*.18,dur:dur*.45,type:'sine'});
};
const sweep = (freq,to,dur,delay=0,gain=.055) => noise({freq,to,dur,delay,gain,type:'bandpass',attack:.025});
const notes = (base, steps, delay=0, type='sine', spacing=.085, gain=.065) => steps.forEach((step,i)=>tone({freq:base*2**(step/12),delay:delay+i*spacing,type,gain,dur:.32}));
export const ITEM_SOUND_IDS = ['chips','headphones','signet','diamond','watch','blade',...['ember','astral','tide'].flatMap(theme=>Array.from({length:6},(_,i)=>`${theme}-${i}`))];
export function caseOpeningSound(id) {
  if (id==='dragonheart') { tone({freq:84,slideTo:42,dur:.8,gain:.15}); sweep(180,1600,.7,.08,.075); [0,.14,.29].forEach(delay=>noise({freq:2600,to:500,dur:.08,gain:.06,delay})); bell(260,.44,.045); }
  else if (id==='starfall') { notes(174.61,[0,7,12,19,24],0,'sine',.1,.045); sweep(400,4200,.65,0,.025); tone({freq:130,slideTo:260,dur:.7,gain:.06}); }
  else if (id==='leviathan') { sweep(1600,280,.8,0,.08); [0,.14,.31].forEach((delay,i)=>tone({freq:380+i*120,slideTo:620+i*160,delay,dur:.12,gain:.055})); bell(698,.4,.045,.65); }
  else { const base=id==='neon-vault'?310:id==='high-roller'?180:240; [0,.13].forEach((delay,i)=>tone({freq:base+i*70,slideTo:110,dur:.12,delay,type:'triangle',gain:.09})); sweep(350,id==='neon-vault'?3200:1800,.38,.2,.045); }
}
export function itemRevealSound(id, delay=0) {
  // Every item has its own rhythm, envelope and combination of tonal/noise layers.
  switch(id) {
    case 'chips': [0,.065,.16].forEach(d=>{noise({freq:3400,dur:.045,gain:.065,delay:delay+d,type:'bandpass',q:3});bell(1800,delay+d,.025,.1)}); break;
    case 'headphones': notes(220,[0,7,3,12],delay,'triangle',.09); break;
    case 'signet': bell(988,delay); bell(1482,delay+.13,.04); break;
    case 'diamond': [0,4,9,16].forEach((n,i)=>bell(880*2**(n/12),delay+i*.06,.035,.6)); break;
    case 'watch': [0,.13,.26].forEach(d=>tone({freq:2700,delay:delay+d,dur:.018,gain:.04,type:'triangle'}));bell(523,delay+.3,.07);break;
    case 'blade': sweep(1100,6500,.22,delay,.07);bell(740,delay+.12,.09,.85);break;
    case 'ember-0': bell(350,delay,.085,.32);noise({freq:700,dur:.12,gain:.055,delay});break;
    case 'ember-1': sweep(2200,250,.25,delay,.07);tone({freq:185,slideTo:94,dur:.28,gain:.09,delay:delay+.05,type:'triangle'});break;
    case 'ember-2': sweep(600,4600,.5,delay,.05);notes(659,[0,5,12],delay+.12,'sine',.11,.045);break;
    case 'ember-3': tone({freq:120,slideTo:55,dur:.4,gain:.12,delay});bell(622,delay+.08,.07,.7);bell(1244,delay+.19,.035);break;
    case 'ember-4': notes(196,[0,4,7,12],delay,'triangle',.085,.07);bell(784,delay+.32,.06,.8);break;
    case 'ember-5': sweep(300,3800,.35,delay,.08);tone({freq:98,slideTo:49,dur:.7,gain:.13,delay});notes(293.66,[0,7,12,19],delay+.15,'triangle',.1,.05);break;
    case 'astral-0': [0,.11,.24].forEach((d,i)=>tone({freq:540+i*180,slideTo:800+i*220,dur:.09,gain:.05,delay:delay+d}));break;
    case 'astral-1': notes(440,[0,7,0,12],delay,'triangle',.075,.05);bell(1320,delay+.26,.035);break;
    case 'astral-2': bell(415,delay,.065,.8);bell(622,delay+.09,.055,.7);tone({freq:1660,slideTo:830,dur:.45,gain:.025,delay:delay+.15});break;
    case 'astral-3': notes(740,[0,3,7,15,19],delay,'sine',.065,.045);sweep(3200,6300,.4,delay,.018);break;
    case 'astral-4': tone({freq:164.81,slideTo:82.4,dur:.7,gain:.09,delay});bell(659,delay+.17,.07,.8);bell(987,delay+.3,.04,.65);break;
    case 'astral-5': tone({freq:130.81,slideTo:523.25,dur:.6,gain:.065,delay});sweep(2400,420,.55,delay,.055);notes(523.25,[0,7,12,19],delay+.18,'sine',.12,.045);break;
    case 'tide-0': bell(460,delay,.065,.35);tone({freq:240,slideTo:470,dur:.1,gain:.045,delay:delay+.09});break;
    case 'tide-1': tone({freq:293.66,slideTo:329.63,dur:.8,gain:.075,attack:.08,delay});tone({freq:587.33,dur:.6,gain:.035,attack:.1,delay:delay+.09});sweep(450,900,.5,delay,.025);break;
    case 'tide-2': notes(587.33,[0,5,9],delay,'triangle',.12,.045);bell(1174,delay+.23,.035);break;
    case 'tide-3': [0,.16,.32].forEach((d,i)=>bell(783.99*2**(i*7/12),delay+d,.055,.8));break;
    case 'tide-4': notes(261.63,[0,7,12,16],delay,'triangle',.1,.06);sweep(1200,2800,.4,delay+.2,.025);break;
    case 'tide-5': sweep(380,2300,.55,delay,.07);tone({freq:73.42,slideTo:110,dur:.75,gain:.12,delay});[440,659.25,880].forEach((f,i)=>bell(f,delay+.22+i*.13,.06,.8));break;
  }
}

let lastPreview = -Infinity;
export function previewItemSound(id) {
  const now = performance.now();
  if (now - lastPreview < 220) return;
  lastPreview = now;
  itemRevealSound(id);
}
