// Short, original sound identities. Shared master volume, gesture unlock and mute.
import { tone, noise } from '../sound.js?v=c5acb968c265';
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

export function caseVictorySound() {
  tone({freq:110,slideTo:45,dur:.7,gain:.14});
  sweep(500,4200,.55,.05,.045);
  notes(261.63,[0,7,12,16,19],.18,'triangle',.11,.055);
  [523.25,659.25,783.99].forEach((freq,i)=>bell(freq,.83+i*.055,.05,.95));
}

// Arena cues: the battle's announcer, tension and payoff layers. Original synth sketches
// built from the shared tone/noise voices, so they follow the master volume and mute.
const semi = (base, steps) => base * 2 ** (steps / 12);
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
export const caseCue = {
  count(n) {
    const freq = n <= 1 ? 880 : n === 2 ? 740 : 660;
    tone({freq,dur:.16,gain:.07,type:'triangle'});
    tone({freq:freq*2,dur:.09,gain:.022,delay:.012});
    tone({freq:120,slideTo:62,dur:.2,gain:.11});
  },
  round(final) {
    sweep(280,3600,.48,0,.06);
    tone({freq:final?73.42:98,slideTo:final?36.7:49,dur:.75,gain:.17});
    [0,7,12,final?15:16].forEach((step,i)=>tone({freq:semi(final?220:261.63,step),dur:.5,gain:.042,type:'triangle',delay:.04+i*.014}));
    if (final) { bell(880,.1,.045,1.1); bell(1318.5,.22,.03,.9); }
  },
  // Three rising swells across the spin, the last one braking into the stop.
  riser() {
    [[0,1.1,240,620,.018],[1.1,1.1,520,1300,.026],[2.2,1.25,1100,3600,.04]].forEach(([delay,dur,freq,to,gain])=>noise({freq,to,dur,gain,delay,type:'bandpass',q:1.8,attack:dur*.9}));
    tone({freq:110,slideTo:233,dur:3.4,gain:.022,type:'triangle',attack:3.1});
  },
  heartbeat(delay=0) {
    tone({freq:72,slideTo:42,dur:.17,gain:.22,delay});
    tone({freq:66,slideTo:40,dur:.22,gain:.16,delay:delay+.19});
  },
  stinger(tier, delay=0) {
    if (tier === 0) { tone({freq:660,dur:.12,gain:.03,type:'triangle',delay}); return; }
    if (tier === 1) {
      [0,4,7,12].forEach((step,i)=>tone({freq:semi(784,step),dur:.24,gain:.03,delay:delay+i*.04}));
      noise({freq:6000,dur:.35,gain:.022,type:'highpass',delay});
      return;
    }
    if (tier <= 3) {
      tone({freq:82,slideTo:41,dur:.45,gain:.17,delay});
      [0,4,7,11,14].forEach((step,i)=>tone({freq:semi(523.25,step),dur:.42,gain:.034,type:'triangle',delay:delay+.03+i*.045}));
      noise({freq:5000,to:9000,dur:.5,gain:.03,type:'highpass',delay:delay+.05});
      return;
    }
    if (tier === 4) {
      tone({freq:65.4,slideTo:32.7,dur:.95,gain:.22,delay});
      [0,4,7,12].forEach(step=>{ tone({freq:semi(261.63,step),dur:1.15,gain:.02,type:'sawtooth',attack:.02,delay:delay+.02}); tone({freq:semi(261.63,step),dur:1.25,gain:.04,type:'triangle',delay:delay+.02}); });
      noise({freq:7000,dur:1.2,gain:.05,type:'highpass',delay});
      [0,7,12,16,19,24].forEach((step,i)=>bell(semi(1046.5,step),delay+.25+i*.06,.024,.5));
      return;
    }
    tone({freq:110,slideTo:27.5,dur:1.4,gain:.24,delay});
    sweep(5200,300,.9,delay,.06);
    [0,7,12,16,19].forEach(step=>tone({freq:semi(196,step),dur:1.8,gain:.03,attack:.12,delay:delay+.05}));
    [0,4,7,12,16,19,24,28].forEach((step,i)=>bell(semi(1318.5,step),delay+.2+i*.05,.02,.45));
  },
  orb(i) { tone({freq:semi(1046.5,PENTA[i%PENTA.length]),dur:.07,gain:.022}); },
  steal() {
    sweep(3200,380,.42,0,.07);
    tone({freq:1500,slideTo:190,dur:.3,gain:.026,type:'square'});
    [0,5,10].forEach((step,i)=>tone({freq:semi(587.33,step),dur:.2,gain:.04,type:'triangle',delay:.18+i*.06}));
  },
  burst() {
    noise({freq:2400,to:300,dur:.3,gain:.07});
    tone({freq:160,slideTo:60,dur:.3,gain:.14});
    bell(1174.66,.05,.03,.6);
  },
  victory() {
    tone({freq:98,slideTo:49,dur:.8,gain:.18});
    [0,4,7,12].forEach((step,i)=>{ tone({freq:semi(392,step),dur:.3,gain:.05,type:'triangle',delay:i*.12}); tone({freq:semi(392,step),dur:.24,gain:.016,type:'sawtooth',delay:i*.12}); });
    [0,4,7,12].forEach(step=>tone({freq:semi(523.25,step),dur:1.4,gain:.034,type:'triangle',delay:.5}));
    noise({freq:8000,dur:1.2,gain:.04,type:'highpass',delay:.5});
    [0,7,12].forEach((step,i)=>bell(semi(1567.98,step),.62+i*.08,.025,.7));
  },
  defeat() {
    [0,-3,-7,-12].forEach((step,i)=>tone({freq:semi(392,step),dur:.42,gain:.05,type:'triangle',delay:i*.17}));
    tone({freq:98,slideTo:46,dur:.9,gain:.12,delay:.55});
  },
  draw() { bell(659.25,0,.05,.7); bell(659.25,.22,.04,.8); tone({freq:329.63,dur:.9,gain:.04,type:'triangle',delay:.1}); },
};
