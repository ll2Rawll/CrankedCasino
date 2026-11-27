// Tiny Web Audio synth. Every sound is generated on the fly, so there are no audio files.

import { storage } from './util.js?v=5f2ed3b0f3fc';

let ctx = null;
let master = null;
let enabled = storage.get('cc:sound', true);
let noiseBuf = null;
let gestured = false; // browsers only allow audio after the first tap/keypress

function ac() {
  if (!gestured) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function unlockAudio() {
  gestured = true;
  if (enabled) ac();
}
export const soundOn = () => enabled;
export function setSound(on) {
  enabled = !!on;
  storage.set('cc:sound', enabled);
  if (!enabled) {
    engine.stop();
    roll.stop();
  } else ac();
}

function tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.2, attack = 0.004, slideTo, delay = 0, detune = 0 }) {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (detune) o.detune.setValueAtTime(detune, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.3, gain = 0.25, freq = 1500, to = 0, type = 'lowpass', q = 0.8, delay = 0, attack = 0.005 }) {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
const note = (base, semis) => base * Math.pow(2, semis / 12);

export const sfx = {
  click() {
    tone({ freq: 1100, type: 'triangle', dur: 0.045, gain: 0.06 });
  },
  tap() {
    tone({ freq: 680, type: 'sine', dur: 0.06, gain: 0.07, slideTo: 520 });
  },
  bet() {
    tone({ freq: 520, type: 'triangle', dur: 0.08, gain: 0.09 });
    tone({ freq: 780, type: 'triangle', dur: 0.08, gain: 0.07, delay: 0.05 });
  },
  tick(i = 0) {
    tone({ freq: 1500 + (i % 7) * 120 + Math.random() * 200, type: 'sine', dur: 0.045, gain: 0.035 });
  },
  gem(step = 0) {
    const f = note(660, PENTA[Math.min(step, PENTA.length - 1)]);
    tone({ freq: f, type: 'sine', dur: 0.32, gain: 0.13 });
    tone({ freq: f * 2, type: 'sine', dur: 0.2, gain: 0.04, delay: 0.03 });
    tone({ freq: f * 1.5, type: 'triangle', dur: 0.28, gain: 0.05, delay: 0.06 });
  },
  boom() {
    noise({ dur: 0.9, gain: 0.55, freq: 2400, to: 90, attack: 0.002 });
    tone({ freq: 140, slideTo: 36, type: 'sine', dur: 0.6, gain: 0.6 });
    tone({ freq: 70, slideTo: 30, type: 'square', dur: 0.25, gain: 0.08 });
  },
  cashout() {
    [1318.5, 1760, 2349, 2637].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.2, gain: 0.09, delay: i * 0.055 }));
    noise({ dur: 0.25, gain: 0.05, freq: 6000, type: 'highpass', delay: 0.02 });
  },
  win(level = 1) {
    const base = 523.25;
    const seq = level >= 2 ? [0, 4, 7, 12, 16, 19, 24] : [0, 4, 7, 12];
    seq.forEach((s, i) => {
      tone({ freq: note(base, s), type: 'triangle', dur: 0.22, gain: 0.08, delay: i * 0.07 });
      tone({ freq: note(base, s) * 2, type: 'sine', dur: 0.16, gain: 0.03, delay: i * 0.07 + 0.01 });
    });
  },
  bigWin() {
    const base = 392;
    [0, 4, 7, 12, 7, 12, 16, 19, 24].forEach((s, i) => {
      tone({ freq: note(base, s), type: 'sawtooth', dur: 0.2, gain: 0.035, delay: i * 0.09 });
      tone({ freq: note(base, s), type: 'triangle', dur: 0.28, gain: 0.08, delay: i * 0.09 });
    });
    noise({ dur: 1.4, gain: 0.04, freq: 7000, type: 'highpass', delay: 0.2 });
  },
  lose() {
    tone({ freq: 330, slideTo: 150, type: 'triangle', dur: 0.4, gain: 0.08 });
  },
  whoosh() {
    noise({ dur: 0.45, gain: 0.12, freq: 400, to: 3200, type: 'bandpass', q: 1.2, attack: 0.08 });
  },
  reelStop(i = 0) {
    tone({ freq: 190 - i * 10, slideTo: 70, type: 'sine', dur: 0.14, gain: 0.22 });
    tone({ freq: 2600, type: 'square', dur: 0.012, gain: 0.025 });
  },
  tease() {
    tone({ freq: 880, type: 'sine', dur: 0.5, gain: 0.05 });
    tone({ freq: 1320, type: 'sine', dur: 0.5, gain: 0.03, delay: 0.1 });
  },
  land(mult = 1) {
    const semis = Math.max(-12, Math.min(24, Math.round(Math.log2(Math.max(0.1, mult)) * 5)));
    tone({ freq: note(660, semis), type: 'triangle', dur: 0.18, gain: mult >= 1 ? 0.09 : 0.05 });
    if (mult >= 2) tone({ freq: note(660, semis + 7), type: 'sine', dur: 0.2, gain: 0.05, delay: 0.05 });
  },
  countdown() {
    tone({ freq: 1200, type: 'sine', dur: 0.06, gain: 0.04 });
  },
  chip() {
    // two ceramic chips clacking
    noise({ dur: 0.05, gain: 0.22, freq: 3200, type: 'bandpass', q: 3 });
    tone({ freq: 2100 + Math.random() * 300, type: 'triangle', dur: 0.04, gain: 0.05 });
    noise({ dur: 0.04, gain: 0.14, freq: 4200, type: 'bandpass', q: 4, delay: 0.045 });
  },
  card() {
    // card sliding off the shoe
    noise({ dur: 0.16, gain: 0.16, freq: 2600, to: 5200, type: 'highpass', q: 0.5, attack: 0.01 });
  },
  flip() {
    noise({ dur: 0.06, gain: 0.18, freq: 1800, type: 'bandpass', q: 1.5 });
    tone({ freq: 420, type: 'sine', dur: 0.05, gain: 0.04 });
  },
  shuffle() {
    for (let i = 0; i < 14; i++) noise({ dur: 0.03, gain: 0.08, freq: 2400 + Math.random() * 1600, type: 'bandpass', q: 2, delay: i * 0.045 });
  },
  clack() {
    tone({ freq: 2600 + Math.random() * 600, type: 'square', dur: 0.02, gain: 0.03 });
    noise({ dur: 0.03, gain: 0.1, freq: 3500, type: 'bandpass', q: 5 });
  },
  // ---- Road Rooster
  cluck() {
    const f = 560 + Math.random() * 80;
    [0, 0.1].forEach((d, i) => {
      tone({ freq: f * (i ? 1.12 : 1), slideTo: f * 0.6, type: 'square', dur: 0.075, gain: 0.04, delay: d });
      noise({ dur: 0.06, gain: 0.05, freq: 1500, type: 'bandpass', q: 3, delay: d });
    });
  },
  hop() {
    tone({ freq: 320, slideTo: 820, type: 'sine', dur: 0.16, gain: 0.08 });
    noise({ dur: 0.07, gain: 0.05, freq: 2400, type: 'bandpass', q: 1, delay: 0.02 });
  },
  // ---- Night Flight
  wing() {
    // a quick feathered whip
    noise({ dur: 0.09, gain: 0.11, freq: 2200, to: 700, type: 'bandpass', q: 1.4, attack: 0.004 });
    tone({ freq: 520, slideTo: 380, type: 'triangle', dur: 0.05, gain: 0.025 });
  },
  point() {
    tone({ freq: 988, type: 'square', dur: 0.06, gain: 0.035 });
    tone({ freq: 1319, type: 'square', dur: 0.11, gain: 0.035, delay: 0.055 });
    tone({ freq: 1319, type: 'sine', dur: 0.16, gain: 0.05, delay: 0.055 });
  },
  smack() {
    noise({ dur: 0.16, gain: 0.32, freq: 1600, to: 220, type: 'lowpass', attack: 0.001 });
    tone({ freq: 150, slideTo: 60, type: 'sine', dur: 0.16, gain: 0.4 });
  },
  plunge() {
    tone({ freq: 760, slideTo: 140, type: 'triangle', dur: 0.5, gain: 0.07 });
    noise({ dur: 0.45, gain: 0.04, freq: 1800, to: 300, type: 'bandpass', q: 0.8, attack: 0.05 });
  },
  thud() {
    noise({ dur: 0.09, gain: 0.08, freq: 700, type: 'lowpass' });
    tone({ freq: 160, slideTo: 90, type: 'sine', dur: 0.08, gain: 0.08 });
  },
  pass(level = 1) {
    // a car rushing past, pitch dropping like a doppler
    noise({ dur: 0.42, gain: 0.05 * level, freq: 1100, to: 260, type: 'bandpass', q: 0.9, attack: 0.09 });
  },
  screech() {
    tone({ freq: 2100, slideTo: 1300, type: 'sawtooth', dur: 0.5, gain: 0.022 });
    tone({ freq: 2350, slideTo: 1500, type: 'sawtooth', dur: 0.45, gain: 0.016, delay: 0.03 });
    noise({ dur: 0.55, gain: 0.07, freq: 3200, type: 'bandpass', q: 5 });
  },
  honk() {
    tone({ freq: 392, type: 'square', dur: 0.2, gain: 0.03 });
    tone({ freq: 494, type: 'square', dur: 0.2, gain: 0.025 });
  },
  barrier() {
    tone({ freq: 880, type: 'triangle', dur: 0.05, gain: 0.05 });
    tone({ freq: 660, type: 'triangle', dur: 0.08, gain: 0.05, delay: 0.06 });
  },
  splash() {
    // a body hitting water: a bright spray, a hollow bloop as it goes under, a bubble
    noise({ dur: 0.34, gain: 0.3, freq: 3400, to: 480, type: 'bandpass', q: 0.7, attack: 0.003 });
    tone({ freq: 330, slideTo: 115, type: 'sine', dur: 0.24, gain: 0.18, delay: 0.05 });
    tone({ freq: 560, slideTo: 920, type: 'sine', dur: 0.08, gain: 0.05, delay: 0.27 });
  },
  splat() {
    noise({ dur: 0.55, gain: 0.5, freq: 2200, to: 110, attack: 0.002 });
    tone({ freq: 170, slideTo: 38, type: 'sine', dur: 0.5, gain: 0.55 });
    tone({ freq: 980, slideTo: 340, type: 'square', dur: 0.14, gain: 0.05, delay: 0.04 });
  },
  jackpot() {
    const base = 523.25;
    [0, 7, 12, 16, 19, 24, 28, 31].forEach((s2, i) => {
      tone({ freq: note(base, s2), type: 'triangle', dur: 0.3, gain: 0.08, delay: i * 0.065 });
      tone({ freq: note(base, s2) * 2, type: 'sine', dur: 0.25, gain: 0.03, delay: i * 0.065 + 0.02 });
    });
    for (let i = 0; i < 10; i++) tone({ freq: 2600 + Math.random() * 1800, type: 'sine', dur: 0.12, gain: 0.025, delay: 0.5 + i * 0.07 });
  },
};

// Continuous rolling noise for the roulette ball.
export const roll = {
  src: null,
  gain: null,
  filter: null,
  start() {
    if (!enabled || this.src) return;
    const c = ac();
    if (!c) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    this.src = c.createBufferSource();
    this.src.buffer = noiseBuf;
    this.src.loop = true;
    this.filter = c.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.Q.value = 0.9;
    this.filter.frequency.value = 900;
    this.gain = c.createGain();
    this.gain.gain.setValueAtTime(0.0001, c.currentTime);
    this.gain.gain.exponentialRampToValueAtTime(0.09, c.currentTime + 0.3);
    this.src.connect(this.filter).connect(this.gain).connect(master);
    this.src.start();
  },
  set(speed) {
    if (!this.src || !ctx) return;
    const t = ctx.currentTime;
    this.filter.frequency.setTargetAtTime(300 + speed * 900, t, 0.1);
    this.gain.gain.setTargetAtTime(Math.max(0.0001, 0.02 + speed * 0.08), t, 0.1);
  },
  stop() {
    if (!this.src || !ctx) return;
    const t = ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(Math.max(0.0001, this.gain.gain.value), t);
    this.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    this.src.stop(t + 0.3);
    this.src = this.gain = this.filter = null;
  },
};

// Continuous rising hum for Crash.
export const engine = {
  osc: null,
  osc2: null,
  gain: null,
  filter: null,
  start() {
    if (!enabled || this.osc) return;
    const c = ac();
    if (!c) return;
    this.osc = c.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc2 = c.createOscillator();
    this.osc2.type = 'sine';
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 500;
    this.gain = c.createGain();
    this.gain.gain.setValueAtTime(0.0001, c.currentTime);
    this.gain.gain.exponentialRampToValueAtTime(0.035, c.currentTime + 0.4);
    this.osc.connect(this.filter);
    this.osc2.connect(this.filter);
    this.filter.connect(this.gain).connect(master);
    this.set(1);
    this.osc.start();
    this.osc2.start();
  },
  set(m) {
    if (!this.osc || !ctx) return;
    const f = 90 + Math.log2(Math.max(1, m)) * 70;
    const t = ctx.currentTime;
    this.osc.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.05);
    this.filter.frequency.setTargetAtTime(400 + Math.log2(Math.max(1, m)) * 500, t, 0.05);
  },
  stop() {
    if (!this.osc || !ctx) return;
    const t = ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(Math.max(0.0001, this.gain.gain.value), t);
    this.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    const o1 = this.osc;
    const o2 = this.osc2;
    o1.stop(t + 0.2);
    o2.stop(t + 0.2);
    this.osc = this.osc2 = this.gain = this.filter = null;
  },
};

export function haptic(pattern = 12) {
  try {
    if (enabled && navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
