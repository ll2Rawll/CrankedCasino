// Plinko: drop balls through a peg triangle onto multiplier bins.
// Each row is a fair 50/50 bounce, so bin k is hit with probability C(n,k)/2^n.
// The server decides every bounce; the ball waits at the top until its path arrives.
// Multiplier tables live in ../math.js (≈99% return on every setting).

import { h, fmt, fmtMult, round2, signed, storage, clamp, cssVar } from '../util.js?v=cab8bd999107';
import { icon } from '../icons.js?v=cab8bd999107';
import { store } from '../store.js?v=cab8bd999107';
import { engine } from '../engine.js?v=cab8bd999107';
import { PLINKO } from '../math.js?v=cab8bd999107';
import { sfx, haptic } from '../sound.js?v=cab8bd999107';
import { burst, PALETTES, coinRain } from '../fx.js?v=cab8bd999107';
import { gameFrame, betInput, tryBet, segmented, toast, serverRefused } from '../ui.js?v=cab8bd999107';

export const TABLES = PLINKO;

const STOPS = [
  [0, [124, 92, 255]],
  [0.35, [200, 77, 255]],
  [0.6, [255, 79, 174]],
  [0.82, [255, 122, 69]],
  [1, [255, 201, 74]],
];
function binColor(d) {
  for (let i = 1; i < STOPS.length; i++) {
    if (d <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1];
      const [b, cb] = STOPS[i];
      const t = (d - a) / (b - a);
      return ca.map((v, j) => Math.round(v + (cb[j] - v) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ctx.roundRect is missing on older Safari (iOS 15), so fall back to arcs.
function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) return ctx.roundRect(x, y, w, h, r);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function label(m, wide) {
  let s;
  if (m >= 1000) s = m / 1000 + 'K';
  else if (m >= 100) s = String(Math.round(m));
  else if (m < 1) s = String(m).replace(/^0/, '');
  else s = String(m);
  return wide ? s + '×' : s;
}

const RULES = `
  <ol class="rules">
    <li>Choose your <strong>bet</strong>, a <strong>risk</strong> level and how many <strong>rows</strong> of pegs.</li>
    <li>Drop a ball. At every peg it bounces left or right, 50/50.</li>
    <li>Wherever it lands, your bet is multiplied by that bin. Edges pay the most and are the hardest to reach.</li>
    <li>Drop as many balls as you like at once, or switch to <strong>Auto</strong>. Every setting returns about 99%.</li>
  </ol>`;

export default {
  title: 'Plinko',
  mount(view) {
    const frame = gameFrame(view, { game: 'plinko', title: 'Plinko', kicker: 'Original · 8–16 rows', tags: ['≈99% RTP', 'Up to 1,000×'], rules: RULES });
    const { stage, controls } = frame;

    let rows = clamp(storage.get('cc:plinko:rows', 12), 8, 16);
    let risk = storage.get('cc:plinko:risk', 'medium');
    if (!TABLES[risk]) risk = 'medium';
    let mode = 'manual';
    const balls = [];
    const pegHits = new Map(); // "r:j" -> time
    const binHits = []; // per bin: time
    let raf = 0;
    let destroyed = false;
    let L = null; // layout
    let auto = null;

    // ---------------------------------------------------------- stage
    stage.classList.add('plinko-stage');
    stage.innerHTML = `<div class="plinko-board"><canvas></canvas><div class="plinko-last" aria-live="polite"></div></div>`;
    const board = stage.querySelector('.plinko-board');
    const canvas = board.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const lastEl = board.querySelector('.plinko-last');

    // ---------------------------------------------------------- controls
    controls.innerHTML = '';
    const tabs = h(`<div class="tabs" role="group" aria-label="Mode"><button type="button" aria-pressed="true" data-m="manual">Manual</button><button type="button" aria-pressed="false" data-m="auto">Auto</button></div>`);
    const bet = betInput('plinko');
    const riskSeg = segmented(
      [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
      risk,
      (v) => {
        risk = v;
        storage.set('cc:plinko:risk', v);
        draw(true);
      },
      { label: 'Risk' },
    );
    const riskField = h(`<div class="field"><div class="field-label"><span>Risk</span></div></div>`);
    riskField.append(riskSeg.el);
    const rowsField = h(`
      <div class="field">
        <div class="field-label"><span>Rows <b class="tnum" style="color:var(--text)" data-rows>${rows}</b></span><span class="dim" data-max></span></div>
        <input class="range" type="range" min="8" max="16" step="1" value="${rows}" aria-label="Rows">
      </div>`);
    const rowsInput = rowsField.querySelector('input');
    const rowsLabel = rowsField.querySelector('[data-rows]');
    const maxLabel = rowsField.querySelector('[data-max]');
    const autoField = h(`
      <div class="field" hidden>
        <div class="field-label"><span>Number of balls</span><span class="dim" data-left></span></div>
        <div class="chips-row" data-count>${[10, 25, 50, 100].map((n, i) => `<button type="button" data-n="${n}" aria-pressed="${i === 0}">${n}</button>`).join('')}</div>
      </div>`);
    const playBtn = h(`<button type="button" class="btn btn-primary btn-play"><span>Drop ball</span></button>`);
    const hint = h(`<p class="hint"><kbd>Space</kbd> drops a ball. Tap fast for more.</p>`);
    controls.append(tabs, bet.el, riskField, rowsField, autoField, playBtn, hint);
    let autoCount = 10;

    const setRowsUI = () => {
      rowsLabel.textContent = rows;
      rowsInput.value = rows;
      rowsInput.style.setProperty('--fill', `${((rows - 8) / 8) * 100}%`);
      const max = Math.max(...TABLES[risk][rows]);
      maxLabel.textContent = `Max ${fmtMult(max)}`;
    };
    rowsInput.addEventListener('input', () => {
      rows = Number(rowsInput.value);
      storage.set('cc:plinko:rows', rows);
      setRowsUI();
      relayout();
    });
    riskSeg.el.addEventListener('click', () => setTimeout(setRowsUI));
    setRowsUI();

    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      sfx.click();
      stopAuto();
      mode = b.dataset.m;
      tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      autoField.hidden = mode !== 'auto';
      hint.hidden = mode === 'auto';
      renderPlay();
    });
    autoField.querySelector('[data-count]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-n]');
      if (!b || b.disabled) return;
      sfx.click();
      autoCount = Number(b.dataset.n);
      autoField.querySelectorAll('[data-n]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });

    function lockSettings() {
      const busy = balls.length > 0 || !!auto;
      riskSeg.disable(busy);
      rowsInput.disabled = busy;
    }

    function renderPlay() {
      if (mode === 'auto') {
        playBtn.className = auto ? 'btn btn-danger btn-play' : 'btn btn-primary btn-play';
        playBtn.innerHTML = auto ? `${icon('stop')}<span>Stop</span><span class="sub">${auto.left} left</span>` : `${icon('repeat')}<span>Start autodrop</span>`;
      } else {
        playBtn.className = 'btn btn-primary btn-play';
        playBtn.innerHTML = `<span>Drop ball</span>`;
      }
    }

    // ---------------------------------------------------------- layout
    function relayout() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = board.clientWidth;
      const H = board.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const n = rows;
      const padTop = H * 0.06;
      const binH = clamp(H * 0.07, 22, 40);
      const bottomPad = 8;
      const avail = H - padTop - binH - bottomPad;
      const sW = (W * 0.94) / (n + 1);
      const gapH = avail / (n - 1 + 1.05);
      const s = Math.min(sW, gapH * 1.25);
      const rowGap = Math.min(gapH, s * 0.95);
      const used = rowGap * (n - 1 + 1.05);
      const top = padTop + (avail - used) / 2 + rowGap * 0.2;
      L = {
        W,
        H,
        dpr,
        n,
        s,
        rowGap,
        top,
        cx: W / 2,
        pegR: clamp(s * 0.1, 2.2, 6),
        ballR: clamp(s * 0.25, 4.5, 12),
        binsY: top + (n - 1) * rowGap + rowGap * 0.85,
        binH,
        mults: TABLES[risk][n],
      };
      draw(true);
    }
    const pegX = (r, j) => L.cx + (j - (r + 2) / 2) * L.s;
    const pegY = (r) => L.top + r * L.rowGap;
    const binX = (k) => L.cx + (k - L.n / 2) * L.s;

    // ---------------------------------------------------------- balls
    function makeBall(t, n, riskAt) {
      // Per-segment timing and bounce heights, slightly randomised for a natural feel.
      const durs = [];
      const hops = [];
      for (let i = 0; i <= n; i++) {
        durs.push((i === 0 ? 300 : 128) * (0.9 + Math.random() * 0.22));
        hops.push(0.18 + Math.random() * 0.16);
      }
      // path/k/mult arrive from the server; until then the ball hovers at the top.
      return { path: null, k: 0, mult: 0, entry: null, risk: riskAt, durs, hops, t0: 0, seg: -1, ticket: t, n, landed: false, trail: [], jitter: (Math.random() - 0.5) * 0.12, born: performance.now() };
    }

    function ballPos(b, now) {
      if (!b.path) {
        // waiting for the server: hover just above the board
        const y0 = L.top - L.rowGap * 1.4;
        return { x: L.cx + b.jitter * L.s, y: y0 + Math.sin((now - b.born) / 90) * 1.5, seg: -1, waiting: true };
      }
      let el = now - b.t0;
      let i = 0;
      while (i <= b.n && el > b.durs[i]) {
        el -= b.durs[i];
        i++;
      }
      if (i > b.n) return { done: true, seg: b.n + 1 };
      const u = el / b.durs[i];
      const contactY = (r) => pegY(r) - L.pegR - L.ballR * 0.92;
      // x before segment i: after i-1 decisions (segment 0 is the drop onto row 0)
      let rights = 0;
      for (let q = 0; q < i - 1; q++) rights += b.path[q];
      if (i === 0) {
        const x = L.cx + b.jitter * L.s;
        const y0 = L.top - L.rowGap * 1.4;
        const y1 = contactY(0);
        return { x, y: y0 + (y1 - y0) * u * u, seg: 0 };
      }
      const r = i - 1; // contact on row r, then bounce
      const xa = pegX(r, 1 + rights) + (r === 0 ? b.jitter * L.s * (1 - u) : 0);
      const dir = b.path[r] ? 1 : -1;
      const xb = xa + (dir * L.s) / 2;
      const ya = contactY(r);
      const yb = r < b.n - 1 ? contactY(r + 1) : L.binsY + L.binH * 0.35;
      const dy = yb - ya;
      const Hh = b.hops[i] * L.rowGap;
      const B = 2 * Hh + 2 * Math.sqrt(Hh * Hh + Hh * Math.max(1, dy));
      const A = dy + B;
      return { x: xa + (xb - xa) * u, y: ya + A * u * u - B * u, seg: i };
    }

    function drop() {
      if (destroyed) return false;
      const t = tryBet('plinko', bet);
      if (!t) return false;
      const b = makeBall(t, rows, risk);
      balls.push(b);
      lockSettings();
      start();
      engine.plinko(t.amount, risk, rows).then((r) => {
        if (!r?.ok) {
          const i = balls.indexOf(b);
          if (i >= 0) balls.splice(i, 1);
          serverRefused(t, r, bet);
          if (auto) stopAuto();
          lockSettings();
          return;
        }
        store.confirm(t, r, { debited: t.amount, paid: r.payout });
        b.path = r.path;
        b.k = r.k;
        b.mult = r.mult;
        b.entry = r.entry;
        b.t0 = performance.now();
        if (destroyed) land(b);
        else start();
      });
      return true;
    }

    function land(b) {
      if (b.landed) return;
      b.landed = true;
      store.finish(b.ticket, b.entry);
      if (destroyed) return;
      binHits[b.k] = performance.now();
      sfx.land(b.mult);
      if (b.mult >= 1) haptic(8);
      const r = board.getBoundingClientRect();
      const x = r.left + binX(b.k);
      const y = r.top + L.binsY;
      if (b.mult >= 2) burst(x, y, { count: b.mult >= 10 ? 60 : 24, colors: PALETTES.plinko, angle: -Math.PI / 2, spread: 1.6, speed: [3, 10] });
      if (b.mult >= 100) {
        coinRain(80);
        sfx.bigWin();
        toast(`${fmtMult(b.mult)} hit! +${fmt(round2(b.ticket.amount * b.mult) - b.ticket.amount)}`, { type: 'win', iconName: 'sparkle' });
      }
      const c = binColor(Math.abs(b.k - b.n / 2) / (b.n / 2));
      const chip = h(`<span style="--c:${rgb(c)}">${fmtMult(b.mult)}</span>`);
      lastEl.prepend(chip);
      while (lastEl.children.length > 6) lastEl.lastElementChild.remove();
    }

    // ---------------------------------------------------------- render
    let pegLayer = null;
    function buildPegLayer() {
      pegLayer = document.createElement('canvas');
      pegLayer.width = canvas.width;
      pegLayer.height = canvas.height;
      const g = pegLayer.getContext('2d');
      g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
      const light = document.documentElement.dataset.theme === 'light';
      for (let r = 0; r < L.n; r++) {
        for (let j = 0; j < r + 3; j++) {
          const x = pegX(r, j);
          const y = pegY(r);
          const grad = g.createRadialGradient(x - L.pegR * 0.35, y - L.pegR * 0.35, 0.5, x, y, L.pegR);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(1, light ? '#b9bcc4' : '#9a9ca6');
          g.fillStyle = grad;
          g.beginPath();
          g.arc(x, y, L.pegR, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    function drawBall(p) {
      const g = ctx.createRadialGradient(p.x - L.ballR * 0.35, p.y - L.ballR * 0.4, 0.5, p.x, p.y, L.ballR);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, '#ffb3dd');
      g.addColorStop(1, '#e0268b');
      ctx.shadowColor = 'rgba(255,79,174,0.8)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, L.ballR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    function draw(full = false) {
      if (!L) return;
      if (full || !pegLayer) buildPegLayer();
      const now = performance.now();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(pegLayer, 0, 0);
      ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);

      // peg flashes
      let active = false;
      ctx.globalCompositeOperation = 'lighter';
      for (const [key, t] of pegHits) {
        const age = now - t;
        if (age > 420) {
          pegHits.delete(key);
          continue;
        }
        active = true;
        const [r, j] = key.split(':').map(Number);
        const x = pegX(r, j);
        const y = pegY(r);
        const a = 1 - age / 420;
        const rad = L.pegR * (2.2 + (1 - a) * 2.2);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(255,140,210,${0.9 * a})`);
        g.addColorStop(1, 'rgba(255,79,174,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // bins
      const mults = TABLES[risk][L.n];
      const bw = L.s * 0.9;
      const wide = bw > 40;
      const fs = clamp(bw * (wide ? 0.27 : 0.34), 7, 14);
      ctx.font = `800 ${fs}px Bricolage, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let k = 0; k <= L.n; k++) {
        const d = Math.abs(k - L.n / 2) / (L.n / 2);
        const c = binColor(d);
        const hitAge = binHits[k] != null ? now - binHits[k] : 1e9;
        let off = 0;
        let glow = 0;
        if (hitAge < 500) {
          active = true;
          const p = hitAge / 500;
          off = Math.sin(p * Math.PI) * L.binH * 0.28 * (1 - p * 0.5);
          glow = 1 - p;
        }
        const x = binX(k) - bw / 2;
        const y = L.binsY + off;
        const rr = Math.min(8, bw * 0.22);
        if (glow > 0) {
          ctx.shadowColor = rgb(c, 0.9);
          ctx.shadowBlur = 22 * glow;
        }
        const grad = ctx.createLinearGradient(0, y, 0, y + L.binH);
        grad.addColorStop(0, rgb(c.map((v) => Math.min(255, v + 40))));
        grad.addColorStop(1, rgb(c.map((v) => v * 0.72)));
        ctx.fillStyle = grad;
        ctx.beginPath();
        roundRect(ctx, x, y, bw, L.binH, rr);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x + rr, y + 1, bw - rr * 2, 1);
        ctx.fillStyle = d > 0.55 ? '#1a0d05' : '#ffffff';
        ctx.fillText(label(mults[k], wide), x + bw / 2, y + L.binH / 2 + 0.5);
      }

      // balls
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        const p = ballPos(b, now);
        if (p.done) {
          if (!b.landed) land(b);
          balls.splice(i, 1);
          continue;
        }
        active = true;
        if (p.waiting) {
          drawBall(p);
          continue;
        }
        if (p.seg !== b.seg) {
          // contact with a new peg
          if (p.seg >= 1) {
            let rights = 0;
            for (let q = 0; q < p.seg - 1; q++) rights += b.path[q];
            pegHits.set(`${p.seg - 1}:${1 + rights}`, now);
            sfx.tick(p.seg);
          }
          b.seg = p.seg;
        }
        b.trail.push([p.x, p.y]);
        if (b.trail.length > 7) b.trail.shift();
        for (let q = 0; q < b.trail.length - 1; q++) {
          const [tx, ty] = b.trail[q];
          ctx.fillStyle = `rgba(255,79,174,${(q / b.trail.length) * 0.28})`;
          ctx.beginPath();
          ctx.arc(tx, ty, L.ballR * (0.45 + (q / b.trail.length) * 0.45), 0, Math.PI * 2);
          ctx.fill();
        }
        drawBall(p);
      }
      if (!balls.length && !auto) lockSettings();
      return active;
    }

    function start() {
      if (raf) return;
      const step = () => {
        raf = 0;
        if (destroyed) return;
        const active = draw();
        if (active || balls.length) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    // ---------------------------------------------------------- auto
    function stopAuto() {
      if (!auto) return;
      clearInterval(auto.timer);
      auto = null;
      renderPlay();
      lockSettings();
    }
    function startAuto() {
      auto = { left: autoCount, timer: 0 };
      const tick = () => {
        if (!auto) return;
        if (auto.left <= 0 || !drop()) return stopAuto();
        auto.left--;
        renderPlay();
        if (auto.left <= 0) stopAuto();
      };
      auto.timer = setInterval(tick, 320);
      tick();
      renderPlay();
      lockSettings();
    }

    playBtn.addEventListener('click', () => {
      if (mode === 'auto') auto ? stopAuto() : startAuto();
      else drop();
    });
    const onKey = (e) => {
      if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (mode === 'manual') drop();
        else playBtn.click();
      }
    };
    document.addEventListener('keydown', onKey);

    const ro = new ResizeObserver(() => relayout());
    ro.observe(board);
    const onTheme = () => draw(true);
    window.addEventListener('themechange', onTheme);
    document.fonts?.ready.then(() => !destroyed && draw(true));
    relayout();
    renderPlay();

    return () => {
      destroyed = true;
      stopAuto();
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('themechange', onTheme);
      document.removeEventListener('keydown', onKey);
      // Balls still bouncing are already settled on the server: show their wins now.
      // (Balls still waiting for the server land as soon as their answer arrives.)
      for (const b of balls) if (b.path && !b.landed) land(b);
      balls.length = 0;
      frame.destroy();
    };
  },
};
