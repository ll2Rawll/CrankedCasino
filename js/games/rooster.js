// Road Rooster: hop across a neon highway, dodging cars, buses and trains.
//
// It's a skill game. The server hands out a seed at the start of every run; the seed
// lays out every lane and every vehicle (see ../math.js), so the browser and the server
// see the same traffic. Cash out any time: the server replays your moves and pays for the
// furthest row you reached. Dawdle and the hawk swoops in.

import { h, fmt, fmtMult, round2, storage, clamp, reducedMotion } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { engine, errorText } from '../engine.js';
import { RR, rrLane, rrHit, rrHawk, rrHawkTime, rrMult, rrFront, rrRand } from '../math.js';
import { sfx, haptic } from '../sound.js';
import { burst, PALETTES, coinRain, shake } from '../fx.js';
import { gameFrame, betInput, tryBet, toast, serverRefused } from '../ui.js';
import { scoreLane, platformCenter, onPlatform } from './rooster-course.js';
import { loadArt } from './rooster-art.js';

const HOP_MS = 120;
const COUNTDOWN_MS = 1500;
const BANK_HOLD_MS = 450;
const ROAD_SLOPE = Math.tan(16 * Math.PI / 180);
const MILESTONES = [10, 20, 30, 40, 50, 60, 75];

const RULES = `
  <p><strong>Score run</strong> is free. Each new row earns one point. Ride logs, land on lily pads and hold Cash out to keep your score. Keep ahead of the red warning line. Getting caught, hitting traffic or falling into water scores zero. Your best banked score stays in this browser.</p>
  <h3>Chip run</h3><ol class="rules">
    <li>Pick a <strong>bet</strong> and press <strong>Start run</strong>. Your rooster waits on the casino steps.</li>
    <li><strong>Tap</strong> the road (or press <kbd>↑</kbd> / <kbd>Space</kbd>) to hop forward one lane. <strong>Swipe</strong> or use <kbd>←</kbd> <kbd>→</kbd> <kbd>↓</kbd> to dodge sideways or step back.</li>
    <li>Dodge the cars, buses and trains. Sidewalks are safe, but planters, cones and hydrants block the way.</li>
    <li>Don’t dawdle: a hawk circles behind you and swoops if you fall too far back.</li>
    <li>Hold the <strong>Cash out</strong> button on the road to bank your run. Traffic keeps moving while you hold. You’re paid for the furthest row you reached: row 10 gives your bet back, and every row after that adds 7%, all the way to the golden egg on row 75 (81.27×).</li>
  </ol>
  <p class="dim" style="margin-top:14px;font-size:14px">A skill game: how far you get is up to you. The server lays out the traffic and checks every run before it pays.</p>`;

// ------------------------------------------------------------------ textures
function noiseTile(size, base, dots) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (const [n, colors, rmax] of dots) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[i % colors.length];
      const r = Math.random() * rmax;
      g.beginPath();
      g.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}
function tileTile(size) {
  const c = noiseTile(size, '#3b3340', [[260, ['rgba(255,255,255,.05)', 'rgba(0,0,0,.12)'], 1.4]]);
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(10,4,8,.55)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);
  g.strokeStyle = 'rgba(255,240,220,.07)';
  g.lineWidth = 1;
  g.strokeRect(3, 3, size - 6, size - 6);
  return c;
}

export default {
  title: 'Road Rooster',
  mount(view) {
    const frame = gameFrame(view, { game: 'rooster', title: 'Road Rooster', kicker: 'Original · skill game', tags: ['Score chase', 'Chip run up to 81×'], rules: RULES });
    const { stage, controls } = frame;
    const modePicker = h(`<fieldset class="rr-modes"><legend class="sr-only">Road Rooster mode</legend>
      <label><input type="radio" name="rr-mode" value="score" checked> Score run</label>
      <label><input type="radio" name="rr-mode" value="chips"> Chip run</label></fieldset>`);
    frame.el.querySelector('.game-head').append(modePicker);
    let scoreMode = true;
    let record = Number(storage.get('cc:rooster:score', 0)) || 0;
    let destroyed = false;
    let art = null;

    // ---------------------------------------------------------- stage
    stage.classList.add('rr-stage');
    stage.innerHTML = `
      <div class="rr-view">
        <canvas aria-label="Road Rooster. Tap to hop forward, swipe to dodge."></canvas>
        <div class="rr-hud">
          <div class="rr-score"><b class="tnum" data-score>0</b><span>rows</span></div>
          <div class="rr-mult tnum" data-mult>×0.00</div>
        </div>
        <div class="rr-center" data-center aria-live="polite"></div>
        <div class="rr-danger" aria-hidden="true"></div>
        <button type="button" class="rr-fab" data-fab></button>
      </div>`;
    const viewEl = stage.querySelector('.rr-view');
    const canvas = viewEl.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const scoreEl = stage.querySelector('[data-score]');
    const multEl = stage.querySelector('[data-mult]');
    const centerEl = stage.querySelector('[data-center]');
    const dangerEl = stage.querySelector('.rr-danger');
    const fab = stage.querySelector('[data-fab]');

    // ---------------------------------------------------------- controls
    controls.innerHTML = '';
    const bet = betInput('rooster');
    const ladder = h(`<div class="field"><div class="field-label"><span>Pay table</span><span class="dim">furthest row × bet</span></div>
      <div class="rr-ladder">${MILESTONES.map((m) => `<div data-m="${m}"><span>Row ${m}</span><b>${fmtMult(rrMult(m))}</b></div>`).join('')}</div></div>`);
    const readout = h(`<div class="readout"><div><span>Furthest row</span><strong data-best>0</strong></div><div><span>Cash out value</span><strong data-value>0.00</strong></div></div>`);
    const playBtn = h(`<button type="button" class="btn btn-primary btn-play"><span>Start run</span></button>`);
    const pad = h(`<div class="rr-pad" aria-label="Move">
      <button type="button" data-m="2" aria-label="Left">${icon('arrowRight')}</button>
      <button type="button" data-m="0" aria-label="Forward" class="up">${icon('arrowRight')}</button>
      <button type="button" data-m="1" aria-label="Back">${icon('arrowRight')}</button>
      <button type="button" data-m="3" aria-label="Right">${icon('arrowRight')}</button>
    </div>`);
    controls.append(bet.el, ladder, readout, playBtn, pad, h(`<p class="hint">Tap or <kbd>↑</kbd> hop · swipe or <kbd>←</kbd><kbd>→</kbd><kbd>↓</kbd> dodge · <kbd>C</kbd> cash out</p>`));
    const gameDialog = h(`<dialog class="rr-dialog" aria-label="Road Rooster game view">
      <div class="rr-toolbar"><span>Road Rooster</span><button type="button" data-exit>Exit game view</button></div>
    </dialog>`);
    controls.after(gameDialog);
    const exitView = gameDialog.querySelector('[data-exit]');
    for (const type of ['gesturestart', 'gesturechange', 'wheel', 'contextmenu']) {
      gameDialog.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    }
    function enterGameView() {
      if (gameDialog.open || !matchMedia('(any-pointer: coarse)').matches) return;
      gameDialog.append(viewEl, pad);
      gameDialog.showModal();
      document.documentElement.classList.add('rr-playing');
    }
    function leaveGameView() {
      if (!gameDialog.open) return;
      gameDialog.close();
      stage.append(viewEl);
      playBtn.after(pad);
      document.documentElement.classList.remove('rr-playing');
      stopHold();
      if (!destroyed) renderControls();
    }
    exitView.addEventListener('click', leaveGameView);
    gameDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      leaveGameView();
    });
    const bestEl = readout.querySelector('[data-best]');
    const valueEl = readout.querySelector('[data-value]');

    // ---------------------------------------------------------- run state
    // phase: idle → starting → countdown → run → ending → over
    let phase = 'idle';
    let ticket = null;
    let seed = 1 + Math.floor(Math.random() * 2147483640); // a demo road until the first run
    let lanes = new Map();
    const lane = (r) => {
      if (!lanes.has(r)) lanes.set(r, scoreMode ? scoreLane(seed, r) : rrLane(seed, r));
      return lanes.get(r);
    };
    let runT0 = performance.now() - 20000; // world clock origin (demo traffic is mid-flow)
    let moves = [];
    let row = 0;
    let col = RR.START_COL;
    let best = 0;
    let landedAt = 0;
    const ridingCol = (t) => col + (lane(row).speed || 0) * (t - landedAt);
    let lastCheck = 0;
    let deathAt = null; // { t, cause, x, y }
    let cashedAt = null; // { t, mult, pay }
    const chick = { fromRow: 0, fromCol: RR.START_COL, hopT0: -1e9, face: 1, bumpT0: -1e9, bumpDir: 0 };
    let cam = -1.6;
    let shakeT0 = -1e9;
    let shakeAmp = 0;
    const particles = [];
    const floats = []; // canvas float texts
    const trainsWarned = new Set();
    const worldT = (now) => (now - runT0) / 1000;

    function resetRun() {
      endT = null;
      cam = -1.6;
      landedAt = 0;
      lanes = new Map();
      moves = [];
      row = 0;
      col = RR.START_COL;
      best = 0;
      lastCheck = 0;
      deathAt = null;
      cashedAt = null;
      chick.fromRow = 0;
      chick.fromCol = RR.START_COL;
      chick.hopT0 = -1e9;
      chick.face = 1;
      particles.length = 0;
      floats.length = 0;
      trainsWarned.clear();
    }

    // ---------------------------------------------------------- layout
    let W = 0;
    let H = 0;
    let dpr = 1;
    let T = 60; // tile size in px
    let boardLeft = 0;
    let pats = null;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = viewEl.clientWidth;
      H = viewEl.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      T = Math.min(W / RR.COLS, H / 7.4);
      boardLeft = (W - RR.COLS * T) / 2;
      glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, T);
      glowGrad.addColorStop(0, 'rgba(255,246,210,.26)');
      glowGrad.addColorStop(0.6, 'rgba(255,240,200,.08)');
      glowGrad.addColorStop(1, 'rgba(255,240,200,0)');
      const ts = Math.max(16, Math.round(T / 2));
      pats = {
        asphalt: ctx.createPattern(noiseTile(160, '#424756', [[1400, ['rgba(255,255,255,.045)', 'rgba(0,0,0,.18)', 'rgba(140,120,160,.05)'], 1.3], [14, ['rgba(0,0,0,.18)'], 9]]), 'repeat'),
        grass: ctx.createPattern(noiseTile(80, '#77a64b', [[90, ['#87b557', '#689742'], 1.7]]), 'repeat'),
        walk: ctx.createPattern(tileTile(ts), 'repeat'),
        gravel: ctx.createPattern(noiseTile(96, '#2a211e', [[900, ['rgba(160,140,120,.14)', 'rgba(0,0,0,.25)', 'rgba(90,80,70,.2)'], 1.6]]), 'repeat'),
        gold: ctx.createPattern(noiseTile(64, '#6b4a10', [[300, ['rgba(255,220,120,.18)', 'rgba(60,30,0,.2)'], 1.4]]), 'repeat'),
      };
    }
    let glowGrad = null;
    const ro = new ResizeObserver(() => resize());
    ro.observe(viewEl);
    resize();

    // world → screen
    const sx = (c) => boardLeft + c * T; // column units → px
    const rowTop = (r) => H - (r - cam + 1) * T;
    const rowMid = (r) => H - (r - cam + 0.5) * T;

    // ---------------------------------------------------------- HUD + controls
    function renderControls() {
      viewEl.classList.toggle('rr-score-mode', scoreMode);
      modePicker.disabled = phase !== 'idle' && phase !== 'over';
      for (const field of [bet.el, ladder, readout]) field.hidden = scoreMode;
      const bankValue = scoreMode ? `${best} pts` : fmt(round2((ticket?.amount || 0) * rrMult(best)));
      viewEl.classList.toggle('rr-result', phase === 'over');
      if (phase !== 'run') stopHold();
      const live = phase === 'run' || phase === 'countdown';
      playBtn.disabled = phase === 'starting' || phase === 'ending' || (live && best < 1);
      if (phase === 'idle' || phase === 'over') {
        playBtn.className = 'btn btn-primary btn-play';
        playBtn.innerHTML = `<span>${phase === 'over' ? 'Run again' : 'Start run'}</span>`;
      } else if (phase === 'starting') {
        playBtn.className = 'btn btn-outline btn-play';
        playBtn.innerHTML = '<span>Starting…</span>';
      } else if (phase === 'ending') {
        playBtn.className = 'btn btn-play is-cash';
        playBtn.innerHTML = '<span>Banking…</span>';
      } else {
        playBtn.className = best >= 1 ? 'btn btn-play is-cash' : 'btn btn-outline btn-play';
        playBtn.innerHTML = best >= 1 ? `<span>Cash out</span><span class="sub">${bankValue}</span>` : '<span>Hop to start earning</span>';
      }
      bet.disable(phase !== 'idle' && phase !== 'over');
      pad.querySelectorAll('button').forEach((b) => (b.disabled = phase !== 'run'));
      // the same action, on the road itself (so phones never have to scroll mid-run)
      if (phase === 'idle' || phase === 'over') {
        fab.hidden = false;
        fab.className = 'rr-fab';
        fab.innerHTML = phase === 'over' && gameDialog.open ? 'Continue' : `${phase === 'over' ? 'Run again' : 'Start run'} ${scoreMode ? '' : `<span>${fmt(bet.value)}</span>`}`;
      } else if ((phase === 'run' || phase === 'countdown') && best >= 1) {
        fab.hidden = false;
        fab.classList.add('is-cash');
        fab.innerHTML = `Hold to cash out <span>${bankValue}</span>`;
      } else fab.hidden = true;
    }
    function renderHud() {
      scoreEl.textContent = String(best);
      if (scoreMode) {
        multEl.textContent = `Best ${record}`;
        multEl.classList.remove('is-up');
        return;
      }
      const m = rrMult(best);
      multEl.textContent = `×${m.toFixed(2)}`;
      multEl.classList.toggle('is-up', m >= 1);
      bestEl.textContent = String(best);
      valueEl.textContent = deathAt ? 'Lost' : fmt(round2((ticket?.amount || bet.value) * m));
      ladder.querySelectorAll('[data-m]').forEach((el) => el.classList.toggle('hit', best >= Number(el.dataset.m)));
    }
    function center(html, cls = '') {
      centerEl.className = `rr-center ${cls}`;
      centerEl.innerHTML = html;
    }

    // ---------------------------------------------------------- run flow
    async function start() {
      if (phase !== 'idle' && phase !== 'over') return;
      if (scoreMode) {
        seed = 1 + Math.floor(Math.random() * 2147483640);
      } else {
        const t = tryBet('rooster', bet);
        if (!t) return;
        phase = 'starting';
        renderControls();
        const r = await engine.roosterStart(t.amount);
        if (!r?.ok) {
          serverRefused(t, r, bet);
          phase = 'idle';
          if (!destroyed) renderControls();
          return;
        }
        store.confirm(t, r, { debited: t.amount });
        ticket = t;
        if (destroyed) return forfeit();
        seed = r.seed;
      }
      resetRun();
      runT0 = performance.now() + COUNTDOWN_MS;
      phase = 'countdown';
      enterGameView();
      const vr = viewEl.getBoundingClientRect();
      if (!gameDialog.open && (vr.top < 0 || vr.bottom > window.innerHeight)) viewEl.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      center('<b>Ready…</b>', 'big');
      sfx.cluck();
      renderControls();
      renderHud();
      setTimeout(() => {
        if (destroyed || phase !== 'countdown') return;
        phase = 'run';
        center('<b>Go!</b>', 'big go');
        sfx.bet();
        renderControls();
        setTimeout(() => centerEl.classList.contains('go') && center(''), 650);
      }, COUNTDOWN_MS);
    }

    const chaseLine = (t) => Math.max(0, (t - 6) * 0.65);
    /** Did anything get us between the last check and t (seconds)? */
    function checkDeath(t) {
      if (phase !== 'run' || t < lastCheck) return false;
      const L = lane(row);
      if (scoreMode && chaseLine(t) > row + 1) {
        die(t, 'line');
        return true;
      }
      if (L.kind === 'river' && !onPlatform(L, ridingCol(t), t)) {
        die(t, 'river');
        return true;
      }
      let tHit = rrHit(L, col, lastCheck, t, RR.HB_CLIENT);
      let cause = L.kind;
      if (!scoreMode && row < RR.FINISH) {
        const th = Math.max(lastCheck, rrHawkTime(row, RR.HAWK_CLIENT));
        if (th <= t && (tHit < 0 || th < tHit)) {
          tHit = th;
          cause = 'hawk';
        }
      }
      lastCheck = t;
      if (tHit < 0) return false;
      die(tHit, cause);
      return true;
    }

    function move(m) {
      if (phase !== 'run' || destroyed) return;
      const now = performance.now();
      const t = worldT(now);
      if (checkDeath(t)) return;
      let nr = row;
      let nc = Math.round(ridingCol(t));
      if (m === 0) nr += 1;
      else if (m === 1) nr -= 1;
      else if (m === 2) nc -= 1;
      else if (m === 3) nc += 1;
      if (m === 2) chick.face = -1;
      if (m === 3) chick.face = 1;
      if (nr < 0 || (!scoreMode && nr > RR.FINISH) || nc < 0 || nc >= RR.COLS || lane(nr).blocked.includes(nc)) {
        chick.bumpT0 = now;
        chick.bumpDir = m;
        sfx.tap();
        return;
      }
      if (!scoreMode) moves.push([Math.round(t * 1000), m]);
      chick.fromRow = visRow(now);
      chick.fromCol = visCol(now);
      chick.hopT0 = now;
      row = nr;
      col = nc;
      landedAt = t;
      if (lane(nr).kind === 'river' && !onPlatform(lane(nr), nc, t)) {
        die(t, 'river');
        return;
      }
      sfx.hop();
      if (row > best) {
        best = row;
        if (scoreMode && best % 64 === 0) {
          for (const cachedRow of lanes.keys()) if (cachedRow < best - 64) lanes.delete(cachedRow);
        }
        renderHud();
        renderControls();
        floats.push({ text: '+1', r: row, c: col, t0: now, color: '#ffd979' });
        if (!scoreMode && MILESTONES.includes(best)) milestone(best);
      }
      if (!scoreMode && row >= RR.FINISH) finish();
    }

    function milestone(k) {
      const m = rrMult(k);
      sfx.win(k >= 30 ? 2 : 1);
      center(`<b>${fmtMult(m)}</b><small>Row ${k}${k === 10 ? ' · bet back!' : ''}</small>`, 'mile');
      setTimeout(() => phase === 'run' && centerEl.classList.contains('mile') && center(''), 1300);
      const { x, y } = chickScreen(performance.now());
      const r = canvas.getBoundingClientRect();
      burst(r.left + x, r.top + y + ROAD_SLOPE * (x - W / 2), { count: 40, colors: PALETTES.gold, speed: [3, 10] });
    }

    function die(t, cause) {
      phase = 'ending';
      endT = t;
      const now = performance.now();
      deathAt = { t, cause, at: now, row, col };
      const endMs = Math.max(moves.length ? moves[moves.length - 1][0] : 0, Math.round(t * 1000));
      renderControls();
      if (cause === 'hawk') {
        sfx.screech();
        center('<b>Snatched!</b><small>The hawk caught you dawdling</small>', 'lose');
      } else {
        sfx.splat();
        haptic([40, 30, 70]);
        shakeT0 = now;
        shakeAmp = 14;
        shake(stage, true);
        const { x, y } = chickScreen(now);
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = 1.5 + Math.random() * 5;
          particles.push({ kind: 'feather', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, life: 70 + Math.random() * 50, max: 120, c: i % 3 ? '#fff6e6' : '#e9d6b4' });
        }
        center(`<b>Splat!</b><small>${cause === 'train' ? 'Hit by a train' : cause === 'bus' ? 'Flattened by a bus' : 'Hit by a car'} on row ${row}</small>`, 'lose');
      }
      renderHud();
      endRun(endMs, false);
    }

    function finish() {
      phase = 'ending';
      endT = worldT(performance.now());
      renderControls();
      sfx.jackpot();
      coinRain(140);
      center(`<b>Golden egg!</b><small>Row 75 · ${fmtMult(rrMult(75))}</small>`, 'win');
      endRun(moves[moves.length - 1][0], true);
    }

    async function cashOut() {
      if (phase !== 'run' || best < 1) return;
      const now = performance.now();
      const t = worldT(now);
      if (checkDeath(t)) return;
      phase = 'ending';
      endT = t;
      cashedAt = { at: now };
      renderControls();
      sfx.cashout();
      endRun(Math.round(t * 1000), true);
    }

    async function endRun(endMs, cashout) {
      if (scoreMode) {
        const points = cashout ? best : 0;
        record = Math.max(record, points, Number(storage.get('cc:rooster:score', 0)) || 0);
        storage.set('cc:rooster:score', record);
        phase = 'over';
        const cause = { line: 'Caught by the red line', river: 'Fell in the river', road: 'Hit by a car', bus: 'Hit by a bus', train: 'Hit by a train' };
        const illustration = cashout ? art?.happy : art?.flat;
        const badge = illustration ? `<img class="rr-result-art" alt="" src="${illustration.src}">` : '';
        center(`${badge}<strong>${cashout ? 'Score banked' : cause[deathAt?.cause] || 'Run ended'}</strong><b>${points}</b><small>Best ${record} · reached row ${best}</small>`, cashout ? 'win' : 'lose');
        renderHud();
        renderControls();
        return;
      }
      const t = ticket;
      const r = await engine.roosterEnd(moves.slice(), endMs, cashout);
      ticket = null;
      if (!r?.ok) {
        // The run is still open on the server; it settles when the next one starts.
        store.cancel(t);
        if (r?.error !== 'auth') toast(errorText(r), { type: 'loss' });
        phase = 'over';
        if (!destroyed) renderControls();
        return;
      }
      store.confirm(t, r, { paid: r.payout });
      store.finish(t, r.entry);
      phase = 'over';
      if (destroyed) return;
      renderControls();
      if (r.payout > 0) {
        const mult = r.mult;
        const won = r.payout - t.amount;
        center(`<strong>${r.finished ? 'Golden egg' : 'Score banked'}</strong><b>${r.score}</b><small>${fmtMult(mult)} · ${fmt(r.payout)} chips${won > 0 ? ` · +${fmt(won)}` : ''}</small>`, 'win');
        const { x, y } = chickScreen(performance.now());
        const rc = canvas.getBoundingClientRect();
        burst(rc.left + x, rc.top + y + ROAD_SLOPE * (x - W / 2), { count: mult >= 2 ? 80 : 40, colors: PALETTES.gold, speed: [4, 12], kind: 'coin' });
        if (mult >= 5) coinRain(mult >= 20 ? 120 : 60);
        if (mult >= 1) sfx.win(mult >= 3 ? 2 : 1);
      } else if (cashout && !r.alive) {
        center('<b>Too late!</b><small>The replay caught you on the road</small>', 'lose');
      }
    }

    /** Leaving mid-run (or reloading) gives the run up. */
    function forfeit() {
      const t = ticket;
      ticket = null;
      const endMs = moves.length ? moves[moves.length - 1][0] : 0;
      engine.roosterEnd(moves.slice(), endMs, false).then((r) => {
        if (!t) return store.sync(r);
        if (r?.ok) {
          store.confirm(t, r, { paid: 0 });
          store.finish(t, r.entry);
        } else store.cancel(t);
      });
    }

    // ---------------------------------------------------------- input
    const act = () => {
      if (phase === 'run' || phase === 'countdown') cashOut();
      else start();
    };
    playBtn.addEventListener('click', act);
    let holdTimer = null;
    let bankPointer = null;
    function stopHold() {
      clearTimeout(holdTimer);
      holdTimer = null;
      bankPointer = null;
      fab.classList.remove('is-holding');
    }
    fab.style.setProperty('--hold-duration', `${BANK_HOLD_MS}ms`);
    fab.addEventListener('pointerdown', (event) => {
      if (phase !== 'run' || best < 1 || !event.isPrimary || event.button !== 0) return;
      fab.setPointerCapture(event.pointerId);
      bankPointer = event.pointerId;
      fab.classList.add('is-holding');
      holdTimer = setTimeout(() => {
        stopHold();
        cashOut();
      }, BANK_HOLD_MS);
    });
    fab.addEventListener('pointermove', (event) => {
      if (event.pointerId !== bankPointer) return;
      const rect = fab.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) stopHold();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      fab.addEventListener(type, (event) => {
        if (event.pointerId === bankPointer) stopHold();
      });
    }
    window.addEventListener('blur', stopHold);
    // A completed hold can settle before the finger lifts. Only a press begun
    // on Start/Run again may start a new wager when its click arrives.
    let startPress = false;
    fab.addEventListener('pointerdown', () => { startPress = phase === 'idle' || phase === 'over'; });
    fab.addEventListener('click', (event) => {
      if (event.detail === 0 || startPress) {
        if (phase === 'over' && gameDialog.open) {
          leaveGameView();
        } else act();
      }
      startPress = false;
    });
    pad.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) move(Number(b.dataset.m));
    });
    const KEYS = { ArrowUp: 0, KeyW: 0, Space: 0, ArrowDown: 1, KeyS: 1, ArrowLeft: 2, KeyA: 2, ArrowRight: 3, KeyD: 3 };
    const onKey = (e) => {
      if (document.querySelector('.modal-root, .drawer.is-open')) return;
      if (e.target.closest?.('button, a') && ['Space', 'Enter'].includes(e.code)) return;
      if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyC' || e.code === 'Enter') {
        if (phase === 'run') {
          e.preventDefault();
          cashOut();
        }
        return;
      }
      if (!(e.code in KEYS)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (phase === 'idle' || phase === 'over') {
        if (e.code === 'Space') start();
        return;
      }
      move(KEYS[e.code]);
    };
    document.addEventListener('keydown', onKey);
    let touch = null;
    const cancelMultiTouch = (event) => {
      if (event.pointerType === 'touch' && !event.isPrimary) {
        touch = null;
        stopHold();
      }
    };
    view.addEventListener('pointerdown', cancelMultiTouch, true);
    canvas.addEventListener('pointerdown', (e) => {
      if (phase !== 'run' || !e.isPrimary || e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      touch = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!touch || touch.id !== e.pointerId) return;
      const dx = e.clientX - touch.x;
      const dy = e.clientY - touch.y;
      touch = null;
      if (phase === 'idle' || phase === 'over') return;
      if (Math.hypot(dx, dy) < 22) return move(0);
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 3 : 2);
      else move(dy < 0 ? 0 : 1);
    });
    canvas.addEventListener('lostpointercapture', (event) => {
      if (touch?.id === event.pointerId) touch = null;
    });

    // ---------------------------------------------------------- chicken position (with hop easing)
    function hopU(now) {
      return clamp((now - chick.hopT0) / (reducedMotion() ? 40 : HOP_MS), 0, 1);
    }
    function visRow(now) {
      const u = hopU(now);
      return chick.fromRow + (row - chick.fromRow) * u;
    }
    function visCol(now) {
      const u = hopU(now);
      return chick.fromCol + (ridingCol(endT ?? worldT(now)) - chick.fromCol) * u;
    }
    function chickScreen(now) {
      return { x: sx(visCol(now) + 0.5), y: H - (visRow(now) - cam + 0.5) * T };
    }

    // ---------------------------------------------------------- drawing
    const carIdx = (r, n) => Math.floor(rrRand(seed, r, 1000 + (((n % 997) + 997) % 997)) * art.cars.length);

    function drawGround(r, t, now) {
      const top = rowTop(r);
      const L = lane(r);
      const k = L.kind;
      const off = H + cam * T; // keeps textures glued to the road while the camera moves
      const glue = (pat) => {
        pat.setTransform?.(new DOMMatrix([1, 0, 0, 1, 0, off]));
        return pat;
      };
      if (r < 0) {
        // the casino: facade, neon and bulbs
        ctx.fillStyle = '#12050a';
        ctx.fillRect(0, top, W, T + 1);
        if (r === -1) {
          ctx.fillStyle = '#2a0a12';
          ctx.fillRect(0, top + T * 0.55, W, T * 0.45);
          for (let i = 0; i < Math.ceil(W / 18); i++) {
            const on = (Math.floor(now / 160) + i) % 3 !== 0;
            ctx.fillStyle = on ? '#ffd979' : '#5a3a10';
            ctx.shadowColor = '#ffc94d';
            ctx.shadowBlur = on ? 8 : 0;
            ctx.beginPath();
            ctx.arc(i * 18 + 9, top + T * 0.62, 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.shadowBlur = 0;
          ctx.font = `400 ${Math.round(T * 0.42)}px "Tilt Neon", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffd6de';
          ctx.shadowColor = '#ff4d6d';
          ctx.shadowBlur = 16;
          ctx.fillText('CRANKED CASINO', W / 2, top + T * 0.28);
          ctx.shadowBlur = 0;
        }
        return;
      }
      if (k === 'start' || k === 'safe') {
        ctx.fillStyle = glue(k === 'safe' ? pats.grass : pats.walk);
        ctx.fillRect(0, top, W, T + 1);
        ctx.fillStyle = 'rgba(255,240,220,.12)';
        ctx.fillRect(0, top, W, 3);
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(0, top + T - 3, W, 3);
        if (k === 'start') {
          ctx.font = `800 ${Math.round(T * 0.3)}px Bricolage, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255,201,77,.35)';
          ctx.fillText('START', sx(0.9), top + T / 2);
          ctx.fillText('START', sx(RR.COLS - 0.9), top + T / 2);
        }
        // lamp pools at the kerb
        for (const lx of [sx(-0.6), sx(RR.COLS + 0.6)]) {
          const g = ctx.createRadialGradient(lx, top + T / 2, 0, lx, top + T / 2, T * 1.2);
          g.addColorStop(0, 'rgba(255,214,140,.2)');
          g.addColorStop(1, 'rgba(255,214,140,0)');
          ctx.fillStyle = g;
          ctx.fillRect(lx - T * 1.2, top, T * 2.4, T);
        }
        return;
      }
      if (k === 'finish') {
        ctx.fillStyle = glue(pats.gold);
        ctx.fillRect(0, top, W, T + 1);
        const g = ctx.createLinearGradient(0, top, 0, top + T);
        g.addColorStop(0, 'rgba(255,240,180,.25)');
        g.addColorStop(1, 'rgba(255,201,77,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, top, W, T);
        return;
      }
      if (k === 'river') {
        ctx.fillStyle = '#4299bc';
        ctx.fillRect(0, top, W, T + 1);
        ctx.fillStyle = '#67b6cc';
        ctx.fillRect(0, top + 0.08 * T, W, 0.04 * T);
        const mid = top + T / 2;
        const spacing = L.period * T;
        for (let x = sx(platformCenter(L, -boardLeft / T - L.period, t) + 0.5); x < W + spacing; x += spacing) {
          const half = T * L.width / 2;
          if (L.pads) {
            ctx.fillStyle = '#8fca57';
            ctx.beginPath();
            ctx.moveTo(x, mid);
            ctx.ellipse(x, mid, half, T * 0.31, 0, 0.4, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = '#a85c36';
            ctx.fillRect(x - half, mid - 0.25 * T, 2 * half, T * 0.5);
            ctx.fillStyle = '#cf8751';
            ctx.fillRect(x - half, mid - 0.25 * T, 2 * half, T * 0.11);
            ctx.beginPath();
            ctx.ellipse(x + half, mid, T * 0.10, T * 0.25, 0, 0, 2 * Math.PI);
            ctx.fill();
          }
        }
        return;
      }
      if (k === 'train') {
        ctx.fillStyle = glue(pats.gravel);
        ctx.fillRect(0, top, W, T + 1);
        ctx.fillStyle = '#3a2a1e';
        for (let x = ((sx(0) % (T * 0.45)) + T * 0.45) % (T * 0.45) - T * 0.45; x < W; x += T * 0.45) ctx.fillRect(x, top + T * 0.14, T * 0.16, T * 0.72);
        for (const yy of [0.3, 0.7]) {
          ctx.fillStyle = '#8d8f99';
          ctx.fillRect(0, top + T * yy - 2, W, 4);
          ctx.fillStyle = 'rgba(255,255,255,.35)';
          ctx.fillRect(0, top + T * yy - 2, W, 1);
        }
        // warning lights at both ends of the crossing
        const L2 = L;
        const base = L2.phase + L2.dir * L2.v * t;
        // time until the next train reaches the board
        const edge = L2.dir === 1 ? -0.5 : RR.COLS + 0.5;
        let soon = false;
        const n0 = Math.round((edge - base) / L2.P);
        for (let n = n0 - 1; n <= n0 + 1; n++) {
          const front = base + n * L2.P;
          const lo = L2.dir === 1 ? front - L2.len : front;
          const hi = L2.dir === 1 ? front : front + L2.len;
          const dist = L2.dir === 1 ? edge - front : front - edge;
          if ((dist > 0 && dist / L2.v < 1.6) || (lo < RR.COLS + 1 && hi > -1)) soon = true;
        }
        for (const px of [Math.max(12, sx(-0.35)), Math.min(W - 12, sx(RR.COLS + 0.35))]) {
          ctx.fillStyle = '#2a2230';
          ctx.fillRect(px - 2, top + T * 0.12, 4, T * 0.76);
          const flash = soon && Math.floor(now / 220) % 2;
          for (const [i, on] of [[0, flash], [1, soon && !flash]]) {
            ctx.fillStyle = on ? '#ff3b55' : '#3a1018';
            ctx.shadowColor = '#ff3b55';
            ctx.shadowBlur = on ? 16 : 0;
            ctx.beginPath();
            ctx.arc(px + (i ? 6 : -6), top + T * 0.2, T * 0.08, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.shadowBlur = 0;
        }
        if (soon && !trainsWarned.has(r) && phase === 'run' && Math.abs(r - row) <= 4) {
          trainsWarned.add(r);
          sfx.honk();
        }
        if (!soon) trainsWarned.delete(r);
        return;
      }
      // road / bus lane
      ctx.fillStyle = glue(pats.asphalt);
      ctx.fillRect(0, top, W, T + 1);
      if (k === 'bus') {
        ctx.fillStyle = 'rgba(200,30,60,.16)';
        ctx.fillRect(0, top, W, T);
        ctx.font = `800 ${Math.round(T * 0.34)}px Bricolage, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,240,220,.14)';
        for (let c = 1; c < RR.COLS; c += 3) ctx.fillText('BUS', sx(c + 0.5), top + T / 2);
      }
      const above = lane(r + 1).kind;
      const below = lane(r - 1).kind;
      const isRoad = (x) => x === 'road' || x === 'bus';
      // lane edges: dashed between two roads, solid kerb otherwise
      if (isRoad(above)) {
        ctx.fillStyle = 'rgba(255,245,225,.42)';
        const dash = T * 0.42;
        for (let x = ((sx(0) % (dash * 2)) + dash * 2) % (dash * 2) - dash * 2; x < W; x += dash * 2) ctx.fillRect(x, top - 1.5, dash, 3);
      } else {
        ctx.fillStyle = 'rgba(255,201,77,.55)';
        ctx.fillRect(0, top, W, 3);
      }
      if (!isRoad(below)) {
        ctx.fillStyle = 'rgba(255,201,77,.55)';
        ctx.fillRect(0, top + T - 3, W, 3);
      }
    }

    function drawObstacles(r) {
      const L = lane(r);
      if (!L.blocked.length) return;
      const top = rowTop(r);
      for (const c of L.blocked) {
        const img = scoreMode ? art.tree : art.obstacles[Math.floor(rrRand(seed, r, 50 + c) * art.obstacles.length)];
        if (img) ctx.drawImage(img, sx(c) + T * 0.06, top - T * 0.08, T * 0.88, T * 0.88);
      }
    }

    function drawVehicles(r, t) {
      const L = lane(r);
      if (!L.v) return;
      const mid = rowMid(r);
      const base = L.phase + L.dir * L.v * t;
      const cMin = -boardLeft / T - 1;
      const cMax = (W - boardLeft) / T + 1;
      const nMin = Math.ceil((cMin - L.len - base) / L.P) - 1;
      const nMax = Math.floor((cMax + L.len - base) / L.P) + 1;
      for (let n = nMin; n <= nMax; n++) {
        const front = rrFront(L, t, n);
        const lo = L.dir === 1 ? front - L.len : front;
        const hi = lo + L.len;
        if (hi < cMin || lo > cMax) continue;
        const cx = sx((lo + hi) / 2);
        const len = L.len * T;
        const wid = L.kind === 'train' ? T * 0.78 : L.kind === 'bus' ? T * 0.74 : T * 0.6;
        // headlights spill onto the road ahead
        const fx = sx(front);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(fx + L.dir * T * 0.75, mid);
        ctx.scale(1.7, 0.5);
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, T, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // shadow
        ctx.fillStyle = 'rgba(0,0,0,.4)';
        ctx.beginPath();
        ctx.ellipse(cx + 3, mid + 5, len / 2, wid / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(cx, mid);
        ctx.rotate(L.dir === 1 ? -Math.PI / 2 : Math.PI / 2);
        if (L.kind === 'train') {
          // locomotive at the front, coaches behind (sprite y grows towards the front)
          const locoLen = T * 3;
          ctx.drawImage(art.loco, -wid / 2, len / 2 - locoLen, wid, locoLen);
          const coachLen = (len - locoLen) / 4;
          for (let i = 0; i < 4; i++) ctx.drawImage(art.coach, -wid / 2, len / 2 - locoLen - (i + 1) * coachLen + 2, wid, coachLen - 4);
        } else if (L.kind === 'bus') {
          ctx.drawImage(art.bus, -wid / 2, -len / 2, wid, len);
        } else {
          ctx.drawImage(art.cars[carIdx(r, n)].img, -wid / 2, -len / 2, wid, len);
        }
        ctx.restore();
      }
    }

    function drawEgg(now) {
      const r = RR.FINISH;
      const y = rowMid(r);
      if (y < -T || y > H + T) return;
      const x = sx(RR.START_COL + 0.5);
      const pulse = 1 + Math.sin(now / 300) * 0.05;
      const g = ctx.createRadialGradient(x, y, 0, x, y, T * 1.8);
      g.addColorStop(0, 'rgba(255,220,120,.55)');
      g.addColorStop(1, 'rgba(255,201,77,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - T * 2, y - T * 2, T * 4, T * 4);
      const s = T * 1.15 * pulse;
      ctx.drawImage(art.egg, x - s / 2, y - s * 0.72, s, s * 1.25);
    }

    function drawChicken(now) {
      if (!art) return;
      let { x, y } = chickScreen(now);
      const u = hopU(now);
      const lift = Math.sin(u * Math.PI) * T * 0.32;
      let sprite = art.rooster;
      let sxScale = 1;
      let syScale = 1;
      let alpha = 1;
      let rot = 0;
      if (deathAt && deathAt.cause !== 'hawk') {
        // flattened, a little rotated along the traffic
        const s = T * 1.05;
        ctx.save();
        ctx.translate(x, y + T * 0.05);
        ctx.rotate(((deathAt.row * 37) % 20 - 10) * 0.02);
        ctx.drawImage(art.flat, -s / 2, -s / 2, s, s);
        ctx.restore();
        return;
      }
      if (deathAt && deathAt.cause === 'hawk') return; // drawn by the hawk
      if (cashedAt) {
        const k = (now - cashedAt.at) / 1000;
        sprite = art.happy;
        y -= Math.abs(Math.sin(k * 6)) * T * 0.35 + Math.min(1, k) * T * 0.1;
      } else if (u < 1) {
        sprite = art.flap;
        syScale = 1 + Math.sin(u * Math.PI) * 0.12;
        sxScale = 1 - Math.sin(u * Math.PI) * 0.08;
      } else {
        // idle: breathe, blink, little landing squash
        const since = now - chick.hopT0 - HOP_MS;
        const squash = since < 140 ? Math.sin((since / 140) * Math.PI) * 0.1 : 0;
        syScale = 1 - squash + Math.sin(now / 420) * 0.015;
        sxScale = 1 + squash;
        if (Math.floor(now / 2400) % 3 === 0 && now % 2400 < 140) sprite = art.blink;
        // nervous when traffic is close or the hawk is near
        if (phase === 'run' && rrHawk(worldT(now)) > row - 0.2) rot = Math.sin(now / 30) * 0.05;
      }
      const bump = now - chick.bumpT0;
      if (bump < 160) {
        const k = Math.sin((bump / 160) * Math.PI) * T * 0.12;
        if (chick.bumpDir === 0) y -= k;
        if (chick.bumpDir === 1) y += k;
        if (chick.bumpDir === 2) x -= k;
        if (chick.bumpDir === 3) x += k;
      }
      // shadow
      ctx.fillStyle = `rgba(0,0,0,${0.42 - lift / T * 0.5})`;
      ctx.beginPath();
      ctx.ellipse(x, y + T * 0.32, T * 0.3 * (1 - lift / T * 0.6), T * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      // spotlight
      const g = ctx.createRadialGradient(x, y, 0, x, y, T * 1.3);
      g.addColorStop(0, 'rgba(255,236,200,.16)');
      g.addColorStop(1, 'rgba(255,236,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - T * 1.3, y - T * 1.3, T * 2.6, T * 2.6);
      if (scoreMode) sprite = art.runner;
      const s = T * (scoreMode ? 0.70 : 0.98);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y + T * 0.34 - lift);
      ctx.rotate(rot);
      ctx.scale(chick.face * sxScale, syScale);
      ctx.drawImage(sprite, -s / 2, -s * 0.93, s, s);
      ctx.restore();
    }

    function drawHawk(now) {
      if (!art) return;
      const t = worldT(now);
      if (deathAt?.cause === 'hawk') {
        // swoop in, grab, carry off
        const k = (now - deathAt.at) / 1000;
        const target = { x: sx(deathAt.col + 0.5), y: rowMid(deathAt.row) };
        let x;
        let y;
        if (k < 0.45) {
          const e = k / 0.45;
          x = target.x + (1 - e) * W * 0.4;
          y = -T * 2 + (target.y + T * 2) * (1 - (1 - e) * (1 - e));
        } else {
          const e = k - 0.45;
          x = target.x - e * W * 0.15;
          y = target.y - e * e * H * 2.2 - e * T * 2;
          const s = T * 0.9;
          ctx.save();
          ctx.translate(x, y + T * 0.45);
          ctx.rotate(Math.sin(now / 60) * 0.2);
          ctx.drawImage(art.flap, -s / 2, -s / 2, s, s);
          ctx.restore();
        }
        const hw = T * 2.2;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI);
        ctx.drawImage(art.hawk, -hw / 2, -hw * 0.35, hw, hw * 0.7);
        ctx.restore();
        return;
      }
      if (phase !== 'run') return;
      // circling shadow when it's getting close
      const gap = row + 1 - rrHawk(t);
      dangerEl.style.opacity = String(clamp(1 - gap / 2.5, 0, 1));
      if (gap > 2.5) return;
      const a = now / 700;
      const cx = sx(col + 0.5) + Math.cos(a) * T * 1.6;
      const cy = H - T * 0.5 + Math.sin(a) * T * 0.5;
      const hw = T * 2;
      ctx.save();
      ctx.globalAlpha = 0.35 * clamp(1 - gap / 2.5, 0.2, 1);
      ctx.translate(cx, cy);
      ctx.rotate(a + Math.PI / 2);
      ctx.drawImage(art.hawk, -hw / 2, -hw * 0.35, hw, hw * 0.7);
      ctx.restore();
    }

    function drawParticles() {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy = p.vy * 0.96 + 0.12;
        p.rot += p.vr;
        p.life--;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life / 30);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.ellipse(0, 0, T * 0.09, T * 0.035, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        const k = (performance.now() - f.t0) / 700;
        if (k >= 1) {
          floats.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - k;
        ctx.font = `800 ${Math.round(T * 0.3)}px Bricolage, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = f.color;
        ctx.shadowColor = f.color;
        ctx.shadowBlur = 10;
        ctx.fillText(f.text, sx(f.c + 0.5), rowMid(f.r) - T * 0.7 - k * T * 0.6);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }

    let lastNow = performance.now();
    let endT = null; // world time the run ended (freezes the camera)
    function tick(now) {
      if (destroyed) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      if (!art || !W) return;
      const t = endT ?? worldT(now);
      if (phase === 'run') checkDeath(t);
      // camera: keep the rooster in the lower third, never let the hawk line off the bottom
      const vr = visRow(now);
      let target = scoreMode ? vr + 0.5 - 0.42 * H / T : vr - 2.2;
      if (scoreMode && phase === 'run' && t > 6) dangerEl.style.opacity = String(clamp(1 - (row + 1 - chaseLine(t)) / 2, 0, 1));
      if (!scoreMode && phase === 'run') target = Math.max(target, rrHawk(Math.max(0, t)) - 1.3, best - 4.6);
      else if (!scoreMode && endT != null && (phase === 'ending' || phase === 'over')) target = Math.max(target, rrHawk(Math.max(0, endT)) - 1.3, best - 4.6);
      if (phase !== 'run') dangerEl.style.opacity = '0';
      target = Math.max(-1.6, target);
      cam += (target - cam) * Math.min(1, dt * 5);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const sk = now - shakeT0 < 400 ? shakeAmp * (1 - (now - shakeT0) / 400) : 0;
      if (sk) ctx.translate((Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk);
      // Project every lane and actor together so the visible gap matches its hitbox.
      const edgeOffset = ROAD_SLOPE * W / 2;
      ctx.transform(1, ROAD_SLOPE, 0, 1, 0, -edgeOffset);
      const r0 = Math.floor(cam - edgeOffset / T) - 1;
      const r1 = Math.ceil(cam + (H + edgeOffset) / T) + 1;
      for (let r = r0; r <= r1; r++) drawGround(r, t, now);
      // the playfield: side margins sit in shadow
      if (scoreMode && phase === 'run' && chaseLine(t) > 0) {
        const lineY = rowTop(chaseLine(t) - 1);
        ctx.fillStyle = '#ed4a55';
        ctx.fillRect(0, lineY, W, 3);
        ctx.fillStyle = 'rgba(154,22,44,.34)';
        ctx.fillRect(0, lineY + 3, W, Math.max(0, H - lineY + edgeOffset));
      }
      ctx.fillStyle = 'rgba(6,2,4,.42)';
      ctx.fillRect(0, 0, boardLeft, H);
      ctx.fillRect(boardLeft + RR.COLS * T, 0, W - boardLeft - RR.COLS * T, H);
      ctx.fillStyle = 'rgba(255,159,67,.22)';
      ctx.fillRect(boardLeft - 1, 0, 2, H);
      ctx.fillRect(boardLeft + RR.COLS * T - 1, 0, 2, H);
      for (let r = r0; r <= r1; r++) drawObstacles(r);
      if (!scoreMode) drawEgg(now);
      // vehicles below the rooster first, then the rooster, then vehicles above (overlap reads right)
      const cr = Math.round(vr);
      for (let r = r0; r <= r1; r++) if (r <= cr) drawVehicles(r, t);
      drawChicken(now);
      for (let r = r0; r <= r1; r++) if (r > cr) drawVehicles(r, t);
      drawParticles();
      if (!scoreMode) drawHawk(now);
      // night vignette
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(10,4,16,0)');
      v.addColorStop(1, 'rgba(10,4,16,.55)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    let raf = requestAnimationFrame(tick);

    loadArt().then((a) => {
      if (destroyed) return;
      art = a;
    });
    document.fonts?.ready.then(() => !destroyed && resize());

    // A run left open by a reload can't be resumed: settle it.
    const left = store.takeRound('rooster');
    if (left) {
      engine.roosterEnd([], 0, false).then((r) => {
        store.sync(r);
        store.refresh();
        if (r?.ok) toast('Your last run ended when you left the road.', { iconName: 'info' });
      });
    }
    // For automated play-tests (everything here is already on screen).
    modePicker.addEventListener('change', () => {
      if (modePicker.disabled) return;
      scoreMode = modePicker.querySelector(':checked').value === 'score';
      phase = 'idle';
      resetRun();
      center(`<b>Road Rooster</b><small>${scoreMode ? 'Cross lanes and bank your points' : 'Set your bet and start a run'}</small>`, 'intro');
      renderControls();
      renderHud();
    });
    globalThis.__ccRooster = () => ({ seed, row, col, best, phase, t: worldT(performance.now()) });
    renderControls();
    renderHud();
    center('<b>Road Rooster</b><small>Tap Start run, then tap the road to hop</small>', 'intro');
    bet.el.addEventListener('change', () => (renderHud(), renderControls()));

    return () => {
      destroyed = true;
      delete globalThis.__ccRooster;
      view.removeEventListener('pointerdown', cancelMultiTouch, true);
      stopHold();
      leaveGameView();
      window.removeEventListener('blur', stopHold);
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('keydown', onKey);
      if (ticket && (phase === 'run' || phase === 'countdown')) {
        forfeit();
        toast('You left the road, so that run is over.', { iconName: 'info' });
      }
      frame.destroy();
    };
  },
};
