// Arena effects for case battles: sparks, shards, embers, stars, coins, confetti, shockwave
// rings, light flares, beams, score orbs and announcer slams. Every sprite is a plain DOM
// element animated with the Web Animations API on transform and opacity only, so the
// compositor moves it and nothing runs per frame on the main thread (no canvas). Bursts
// are precomputed ballistic paths sampled into a few keyframes. The layer is bounded: a
// cap on live sprites, tracked timers, and destroy() cancels and removes everything.
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const px = (n) => `${n.toFixed(1)}px`;

export const GOLD = '#ffd98a';
export const PRISM = ['#ff8fc0', '#ffd479', '#8ff0c8', '#8fc8ff', '#c9a0ff'];

export function arenaFx(root) {
  const layer = document.createElement('div');
  layer.className = 'cbx-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<b class="cbx-vignette"></b>';
  root.append(layer);
  const live = new Set(), timers = new Set(), moves = new Set();
  const small = matchMedia('(max-width: 640px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
  const scale = small ? .6 : 1;
  const MAX = small ? 120 : 200;
  let dead = false;
  const count = (n) => Math.max(1, Math.round(n * scale));

  function spawn(kind, color) {
    if (dead || live.size >= MAX) return null;
    const el = document.createElement('i');
    el.className = `cbx cbx-${kind}`;
    if (color) el.style.setProperty('--c', color);
    layer.append(el);
    live.add(el);
    return el;
  }
  // fill: backwards holds a delayed sprite at its first keyframe instead of the layer corner.
  function run(el, frames, timing) {
    const animation = el.animate(frames, { fill: 'backwards', easing: 'linear', ...timing });
    const done = () => { live.delete(el); el.remove(); };
    animation.onfinish = done;
    animation.oncancel = done;
    return animation;
  }
  function move(el, frames, timing) {
    if (dead || !el?.isConnected) return;
    const animation = el.animate(frames, timing);
    moves.add(animation);
    animation.onfinish = animation.oncancel = () => moves.delete(animation);
  }
  function later(ms, fn) {
    if (dead) return;
    const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms);
    timers.add(id);
  }
  // A point on an element (fractions across it), in layer coordinates. One layout read.
  function at(el, fx = .5, fy = .5) {
    const r = el.getBoundingClientRect(), o = layer.getBoundingClientRect();
    return { x: r.left - o.left + r.width * fx, y: r.top - o.top + r.height * fy, w: r.width, h: r.height };
  }

  /** Drag-damped launch under gravity. Sparks point along their velocity; coins and confetti flutter. */
  function burst(x, y, { color, colors, count: n = 20, speed = 200, kinds = ['spark', 'ember'], gravity = 320, life = 950, angle = -Math.PI / 2, spread = TAU, size = 1, delay = 0 } = {}) {
    const drag = 2.4;
    for (let i = 0; i < count(n); i++) {
      const kind = kinds[i % kinds.length];
      const el = spawn(kind, colors ? colors[i % colors.length] : color);
      if (!el) return;
      const a = angle + (Math.random() - .5) * spread, v = speed * rnd(.35, 1);
      const vx = Math.cos(a) * v, vy = Math.sin(a) * v;
      const t1 = (life / 1000) * rnd(.7, 1.15), s = size * rnd(.6, 1.25), spin = rnd(-600, 600), flips = rnd(2, 5);
      const frames = [];
      for (let f = 0; f <= 6; f++) {
        const p = f / 6, t = p * t1, damp = (1 - Math.exp(-drag * t)) / drag;
        const x1 = x + vx * damp, y1 = y + vy * damp + .5 * gravity * t * t;
        let shape;
        if (kind === 'spark') {
          const dx = vx * Math.exp(-drag * t), dy = vy * Math.exp(-drag * t) + gravity * t;
          shape = `rotate(${(Math.atan2(dy, dx) * 180 / Math.PI + 90).toFixed(0)}deg) scale(${s.toFixed(2)},${(s * (1.3 - p * .8)).toFixed(2)})`;
        } else if (kind === 'coin') shape = `rotate(${(spin * p * .3).toFixed(0)}deg) scale(${(s * Math.cos(p * TAU * flips)).toFixed(2)},${s.toFixed(2)})`;
        else if (kind === 'confetti') shape = `rotate(${(spin * p).toFixed(0)}deg) scale(${s.toFixed(2)},${(s * Math.cos(p * TAU * flips)).toFixed(2)})`;
        else shape = `rotate(${(spin * p).toFixed(0)}deg) scale(${(s * (1 - p * .6)).toFixed(2)})`;
        frames.push({ transform: `translate(${px(x1)},${px(y1)}) ${shape}`, opacity: f === 0 ? 1 : +Math.max(0, 1 - p ** 1.8).toFixed(2) });
      }
      run(el, frames, { duration: t1 * 1000, delay: delay + rnd(0, 70) });
    }
  }
  /** Motes drawn in from a ring towards a point: energy gathering before a release. */
  function implode(x, y, { color, count: n = 16, radius = 130, life = 480 } = {}) {
    for (let i = 0; i < count(n); i++) {
      const el = spawn('ember', color);
      if (!el) return;
      const a = rnd(0, TAU), r = radius * rnd(.6, 1.15);
      const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r * .7;
      run(el, [
        { transform: `translate(${px(sx)},${px(sy)}) scale(.3)`, opacity: 0 },
        { transform: `translate(${px((sx * 2 + x) / 3)},${px((sy * 2 + y) / 3)}) scale(1.1)`, opacity: 1, offset: .4 },
        { transform: `translate(${px(x)},${px(y)}) scale(.2)`, opacity: .8 },
      ], { duration: life * rnd(.75, 1), delay: rnd(0, 110), easing: 'cubic-bezier(.5,0,.9,.5)' });
    }
  }
  function centered(kind, x, y, sizePx, color, frames, timing) {
    const el = spawn(kind, color);
    if (!el) return;
    el.style.width = el.style.height = `${sizePx}px`;
    const base = `translate(${px(x - sizePx / 2)},${px(y - sizePx / 2)})`;
    run(el, frames.map(({ s, o, offset }) => ({ transform: `${base} scale(${s})`, opacity: o, ...(offset == null ? {} : { offset }) })), timing);
  }
  /** Shockwave ring. */
  function ring(x, y, { color, size = 150, life = 650, delay = 0, thick = false } = {}) {
    centered(thick ? 'ring cbx-thick' : 'ring', x, y, size, color, [{ s: .12, o: .95 }, { s: .7, o: .6, offset: .45 }, { s: 1, o: 0 }], { duration: life, delay, easing: 'cubic-bezier(.12,.7,.3,1)' });
  }
  /** Soft light bloom. */
  function flare(x, y, { color, size = 260, life = 700, delay = 0, peak = .85 } = {}) {
    centered('flare', x, y, size, color, [{ s: .25, o: 0 }, { s: .9, o: peak, offset: .16 }, { s: 1.25, o: 0 }], { duration: life, delay, easing: 'ease-out' });
  }
  /** A pillar of light rising from a point. */
  function beam(x, y, { color, width = 96, height = 420, life = 1250, delay = 0 } = {}) {
    const el = spawn('beam', color);
    if (!el) return;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    const base = `translate(${px(x - width / 2)},${px(y - height)})`;
    run(el, [
      { transform: `${base} scaleX(.05)`, opacity: 0 },
      { transform: `${base} scaleX(1)`, opacity: 1, offset: .14 },
      { transform: `${base} scaleX(.65)`, opacity: .7, offset: .6 },
      { transform: `${base} scaleX(.1)`, opacity: 0 },
    ], { duration: life, delay, easing: 'ease-out' });
  }
  /** Four-point stars twinkling around a point. */
  function twinkle(x, y, { color, colors, count: n = 8, radius = 90, life = 900, delay = 0 } = {}) {
    for (let i = 0; i < count(n); i++) {
      const el = spawn('star', colors ? colors[i % colors.length] : color);
      if (!el) return;
      const a = rnd(0, TAU), r = radius * Math.sqrt(Math.random());
      const p = `translate(${px(x + Math.cos(a) * r)},${px(y + Math.sin(a) * r * .8)})`, s = rnd(.6, 1.4);
      run(el, [
        { transform: `${p} rotate(0deg) scale(0)`, opacity: 1 },
        { transform: `${p} rotate(45deg) scale(${s.toFixed(2)})`, opacity: 1, offset: .35 },
        { transform: `${p} rotate(90deg) scale(0)`, opacity: 0 },
      ], { duration: life * rnd(.6, 1), delay: delay + rnd(0, life * .5), easing: 'ease-in-out' });
    }
  }
  /** Repeated upward bursts for a sustained fountain. */
  function fountain(x, y, options, { every = 120, duration = 1100 } = {}) {
    for (let t = 0; t < duration; t += every) later(t, () => burst(x, y, { angle: -Math.PI / 2, spread: 1.1, speed: 240, gravity: 420, count: 4, ...options }));
  }
  /**
   * Score orbs curving from a drop into a player's total. onEach(i) runs as each lands, so
   * the counter and its sound keep time with the light.
   */
  function orbs(from, to, { color, count: n = 8, life = 620, delay = 0, onEach } = {}) {
    for (let i = 0; i < n; i++) {
      const d = delay + i * 48 + rnd(0, 30), dur = life * rnd(.85, 1.1);
      const el = spawn('orb', color);
      if (!el) { later(d + dur, () => onEach?.(i)); continue; }
      const sx = from.x + rnd(-26, 26), sy = from.y + rnd(-26, 26);
      const cx = (sx + to.x) / 2 + rnd(-110, 110), cy = Math.min(sy, to.y) - rnd(20, 120);
      const frames = [];
      for (let f = 0; f <= 7; f++) {
        const t = f / 7, u = 1 - t;
        frames.push({ transform: `translate(${px(u * u * sx + 2 * u * t * cx + t * t * to.x)},${px(u * u * sy + 2 * u * t * cy + t * t * to.y)}) scale(${(1.25 - t * .6).toFixed(2)})`, opacity: f === 0 ? 0 : 1 });
      }
      run(el, frames, { duration: dur, delay: d, easing: 'cubic-bezier(.45,0,.8,.55)' }).addEventListener('finish', () => onEach?.(i));
    }
  }
  /** Announcer text slammed onto the arena. */
  function slam(x, y, text, { color = GOLD, kind = '', life = 1050, delay = 0 } = {}) {
    const el = spawn(`text${kind ? ` cbx-${kind}` : ''}`, color);
    if (!el) return;
    el.textContent = text;
    const p = `translate(${px(x)},${px(y)}) translate(-50%,-50%)`;
    // Easing per segment, so the hold lasts as long as its offsets say.
    run(el, [
      { transform: `${p} scale(2.3)`, opacity: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: `${p} scale(.94)`, opacity: 1, offset: .16, easing: 'ease-out' },
      { transform: `${p} scale(1)`, opacity: 1, offset: .26 },
      { transform: `${p} scale(1.04)`, opacity: 1, offset: .78, easing: 'ease-in' },
      { transform: `${p} scale(1.16)`, opacity: 0 },
    ], { duration: life, delay });
  }
  /** A bolt of light drawn from one point to another. */
  function streak(x1, y1, x2, y2, { color, life = 520, delay = 0 } = {}) {
    const el = spawn('streak', color);
    if (!el) return;
    const length = Math.hypot(x2 - x1, y2 - y1), angle = Math.atan2(y2 - y1, x2 - x1);
    el.style.width = `${length}px`;
    const base = `translate(${px(x1)},${px(y1)}) rotate(${angle.toFixed(3)}rad)`;
    run(el, [
      { transform: `${base} scaleX(0)`, opacity: 1 },
      { transform: `${base} scaleX(1)`, opacity: 1, offset: .45 },
      { transform: `${base} scaleX(1) scaleY(.3)`, opacity: 0 },
    ], { duration: life, delay, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
  /** Full-arena flash of colour. */
  function flash(color, { strength = .5, life = 480, delay = 0 } = {}) {
    const el = spawn('flash', color);
    if (el) run(el, [{ opacity: 0 }, { opacity: strength, offset: .1 }, { opacity: 0 }], { duration: life, delay, easing: 'ease-out' });
  }
  /** Decaying jitter on an element, through the independent translate property. */
  function shake(el, power = 6, life = 440) {
    const frames = [];
    for (let i = 0; i <= 9; i++) {
      const f = (1 - i / 9) ** 1.4 * power;
      frames.push({ translate: i === 9 ? '0 0' : `${rnd(-f, f).toFixed(1)}px ${rnd(-f, f).toFixed(1)}px` });
    }
    move(el, frames, { duration: life, easing: 'linear' });
  }
  function pulse(el, amount = 1.16, life = 170) {
    move(el, [{ scale: amount }, { scale: 1 }], { duration: life, easing: 'ease-out' });
  }

  /** The drop reveal, scaled by tier (0 common, 1 rare, 2–3 epic, 4 legendary, 5 special). */
  function reveal(p, tier, color) {
    if (tier === 0) {
      burst(p.x, p.y, { color, count: 10, speed: 120, kinds: ['ember'], gravity: 90, life: 800 });
      ring(p.x, p.y, { color, size: 130, life: 520 });
      return;
    }
    if (tier === 1) {
      flare(p.x, p.y, { color, size: 200, peak: .55 });
      burst(p.x, p.y, { color, count: 18, speed: 200, kinds: ['spark', 'ember', 'ember'] });
      ring(p.x, p.y, { color, size: 180 });
      twinkle(p.x, p.y, { color, count: 4, radius: 80 });
      return;
    }
    if (tier <= 3) {
      flare(p.x, p.y, { color, size: 280 });
      burst(p.x, p.y, { colors: [color, '#ffffff', color], count: 28, speed: 270, kinds: ['spark', 'shard', 'ember'] });
      ring(p.x, p.y, { color, size: 220, thick: true });
      ring(p.x, p.y, { color: '#ffffff', size: 150, delay: 110 });
      twinkle(p.x, p.y, { color, count: 6, radius: 100 });
      return;
    }
    const legendary = tier === 4;
    const colors = legendary ? [GOLD, color, '#fff6dc'] : [...PRISM, color];
    flare(p.x, p.y, { color: legendary ? GOLD : '#ffffff', size: legendary ? 360 : 440, peak: 1, life: 900 });
    beam(p.x, p.y + 70, { color: legendary ? GOLD : color, width: legendary ? 92 : 120 });
    burst(p.x, p.y, { colors, count: legendary ? 36 : 46, speed: legendary ? 320 : 380, kinds: ['spark', 'shard', 'star', 'ember'], life: 1150 });
    [0, 140, 280].forEach((delay, i) => ring(p.x, p.y, { color: colors[i % colors.length], size: 200 + i * 70, delay, thick: i === 0, life: 760 }));
    twinkle(p.x, p.y, { colors, count: legendary ? 10 : 14, radius: 130, life: 1300, delay: 150 });
    if (legendary) later(220, () => burst(p.x, p.y - 10, { colors: [GOLD, '#f4b860'], kinds: ['coin'], count: 12, speed: 300, gravity: 760, spread: 1.7, life: 1350 }));
    else fountain(p.x, p.y + 30, { colors, kinds: ['ember', 'star', 'shard'] }, { every: 110, duration: 1200 });
  }
  /** Confetti cannons fired from two points. */
  function cannons(left, right, colors) {
    [[left, -Math.PI / 2 + .55], [right, -Math.PI / 2 - .55]].forEach(([p, angle]) => {
      burst(p.x, p.y, { colors, kinds: ['confetti', 'confetti', 'spark'], count: 34, speed: 560, angle, spread: .75, gravity: 520, life: 2100 });
    });
  }

  return {
    at, later, burst, implode, ring, flare, beam, twinkle, fountain, orbs, slam, streak, flash, shake, pulse, reveal, cannons,
    small,
    tension(on) { root.classList.toggle('cb-tension', on); },
    destroy() {
      dead = true;
      timers.forEach(clearTimeout);
      timers.clear();
      [...moves].forEach((animation) => animation.cancel());
      [...live].forEach((el) => el.getAnimations().forEach((animation) => animation.cancel()));
      live.clear();
      root.classList.remove('cb-tension');
      layer.remove();
    },
  };
}
