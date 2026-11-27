// Tiny Web Audio synth. Every sound is generated on the fly, so there are no audio files.

import { storage } from './util.js';

let ctx = null;
let master = null;
let enabled = storage.get('cc:sound', true);
let noiseBuf = null;

function ac() {
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
  if (enabled) ac();
}
export const soundOn = () => enabled;
export function setSound(on) {
  enabled = !!on;
  storage.set('cc:sound', enabled);
  if (!enabled) engine.stop();
  else ac();
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
