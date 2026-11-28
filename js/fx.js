// Screen-wide particle layer (confetti, coins, sparks) + small DOM effects.

import { reducedMotion, fmt } from './util.js?v=9f4a3c573590';

const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');
let W = 0;
let H = 0;
let dpr = 1;
let parts = [];
let raf = 0;

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}
resize();
window.addEventListener('resize', resize);

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export const PALETTES = {
  win: ['#45e3a0', '#b6ffd9', '#ffffff', '#f3c35f'],
  gold: ['#f3c35f', '#ffe7a3', '#fff6d8', '#e0a13a'],
  chrome: ['#ffffff', '#d9dbe2', '#9aa0ab', '#eef1f6'],
  plinko: ['#ff4fae', '#ff9ad2', '#ffd1ea', '#ffffff'],
  crash: ['#5ab4ff', '#a8d8ff', '#ffffff', '#7a7cff'],
  loss: ['#ff5468', '#ff9a6b', '#ffd08a', '#5a1a20'],
};

/**
 * Emit particles.
 * kind: 'confetti' | 'spark' | 'coin' | 'ember'
 */
export function burst(x, y, opts = {}) {
  const {
    count = 40,
    colors = PALETTES.win,
    speed = [3, 11],
    angle = -Math.PI / 2,
    spread = Math.PI * 2,
    gravity = 0.32,
    drag = 0.985,
    size = [4, 9],
    life = [45, 90],
    kind = 'confetti',
  } = opts;
  const n = reducedMotion() ? Math.ceil(count * 0.25) : count;
  for (let i = 0; i < n; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const v = rnd(speed[0], speed[1]);
    const l = rnd(life[0], life[1]);
    parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      g: gravity,
      drag,
      s: rnd(size[0], size[1]),
      r: Math.random() * Math.PI * 2,
      vr: rnd(-0.3, 0.3),
      flip: Math.random() * Math.PI * 2,
      vf: rnd(0.08, 0.25),
      c: pick(colors),
      life: l,
      max: l,
      kind,
    });
  }
  if (parts.length > 900) parts.splice(0, parts.length - 900);
  if (!raf) raf = requestAnimationFrame(frame);
}

/** Burst from the centre of an element. */
export function burstAt(el, opts) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, opts);
}

/** Coins raining from the top of the screen — for big wins. */
export function coinRain(amount = 70) {
  const n = reducedMotion() ? 12 : amount;
  for (let i = 0; i < n; i++) {
    const l = rnd(110, 170);
    parts.push({
      x: rnd(0, W),
      y: rnd(-H * 0.6, -20),
      vx: rnd(-1, 1),
      vy: rnd(2, 6),
      g: 0.12,
      drag: 0.995,
      s: rnd(9, 15),
      r: 0,
      vr: 0,
      flip: Math.random() * Math.PI * 2,
      vf: rnd(0.1, 0.22),
      c: '#f3c35f',
      life: l,
      max: l,
      kind: 'coin',
    });
  }
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const next = [];
  for (const p of parts) {
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    p.flip += p.vf;
    p.life--;
    if (p.life <= 0 || p.y > H + 40) continue;
    next.push(p);
    const fade = Math.min(1, p.life / (p.max * 0.35));
    ctx.globalAlpha = fade;
    if (p.kind === 'spark' || p.kind === 'ember') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = p.c;
      ctx.lineWidth = p.kind === 'ember' ? p.s * 0.5 : Math.max(1, p.s * 0.3);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    } else if (p.kind === 'coin') {
      const sx = Math.abs(Math.cos(p.flip));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(Math.max(0.12, sx), 1);
      const g = ctx.createRadialGradient(-p.s * 0.3, -p.s * 0.3, 1, 0, 0, p.s);
      g.addColorStop(0, '#fff3c4');
      g.addColorStop(0.5, '#f3c35f');
      g.addColorStop(1, '#a8711a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, p.s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,70,10,.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, p.s * 0.68, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  parts = next;
  if (parts.length) raf = requestAnimationFrame(frame);
  else {
    raf = 0;
    ctx.clearRect(0, 0, W, H);
  }
}

export function shake(el, strong = false) {
  if (!el || reducedMotion()) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  if (strong) el.style.animationDuration = '0.6s';
  setTimeout(() => {
    el.classList.remove('shake');
    el.style.animationDuration = '';
  }, 650);
}

/** "+12.50" floating up from a point. */
export function floatText(x, y, text, color = 'var(--win)') {
  const el = document.createElement('div');
  el.className = 'float-text';
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.color = color;
  document.body.append(el);
  el.animate(
    [
      { opacity: 0, transform: 'translate(-50%, -30%) scale(.8)' },
      { opacity: 1, transform: 'translate(-50%, -90%) scale(1.05)', offset: 0.2 },
      { opacity: 0, transform: 'translate(-50%, -260%) scale(1)' },
    ],
    { duration: 1300, easing: 'cubic-bezier(.22,1,.36,1)' },
  ).onfinish = () => el.remove();
}

export function floatFrom(target, text, color) {
  if (!target) return;
  const r = target.getBoundingClientRect();
  floatText(r.left + r.width / 2, r.top + r.height / 2, text, color);
}

/** Animate a number inside an element. */
export function countTo(el, from, to, { duration = 700, format = fmt, onDone } = {}) {
  if (!el) return () => {};
  if (reducedMotion() || from === to) {
    el.textContent = format(to);
    onDone?.();
    return () => {};
  }
  const start = performance.now();
  let id = 0;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (to - from) * e);
    if (t < 1) id = requestAnimationFrame(step);
    else onDone?.();
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}

/** Celebrate a win proportionally to its size. */
export function celebrate(el, mult, palette = PALETTES.win) {
  if (mult >= 50) {
    coinRain(110);
    burstAt(el, { count: 120, colors: PALETTES.gold, speed: [6, 16] });
  } else if (mult >= 10) {
    coinRain(50);
    burstAt(el, { count: 80, colors: palette, speed: [5, 13] });
  } else if (mult >= 2) {
    burstAt(el, { count: 46, colors: palette });
  } else if (mult > 1) {
    burstAt(el, { count: 16, colors: palette, speed: [2, 7], kind: 'spark', size: [3, 6], life: [25, 45] });
  }
}
