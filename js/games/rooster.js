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
import { RR, rrLane, rrHit, rrHawk, rrHawkTime, rrMult, rrFront } from '../math.js';
import { sfx, haptic } from '../sound.js';
import { burst, PALETTES, coinRain } from '../fx.js';
import { gameFrame, betInput, tryBet, toast, serverRefused } from '../ui.js';
import { scoreLane, onPlatform } from './rooster-course.js?v=c79a63fcecc8';
import { landscape } from './rooster-landscape.js?v=4d2f85abb0a0';
import { loadArt } from './rooster-art.js';

const HOP_MS = 110;
// Keep the initial toe-off inside the occupied tile until a tap or swipe resolves.
const TAKEOFF_FRACTION = .16;
const SCORE_COURSE_SPEED = 0.90;
const SWIPE_PX = 10;
const COUNTDOWN_MS = 1500;
const BANK_HOLD_MS = 450;
// How long a finished run stays on screen before the result panel rises.
const RESULT_DEATH_MS = 750;
const RESULT_BANK_MS = 300;
const MILESTONES = [10, 20, 30, 40, 50, 60, 75];

const RULES = `
  <p><strong>Score run</strong> is free. Each new row earns one point. Ride logs, land on lily pads and hold Cash out to keep your score. Keep ahead of the red warning line. Getting caught, hitting traffic or falling into water scores zero. Your best banked score stays in this browser.</p>
  <h3>Chip run</h3><ol class="rules">
    <li>Pick a <strong>bet</strong> and press <strong>Start run</strong>. Your rooster waits on the grassy verge.</li>
    <li><strong>Tap</strong> the road (or press <kbd>↑</kbd> / <kbd>Space</kbd>) to hop forward one lane. <strong>Swipe</strong> or use <kbd>←</kbd> <kbd>→</kbd> <kbd>↓</kbd> to dodge sideways or step back.</li>
    <li>Dodge the cars, buses and trains. Grass verges are safe, but trees and rocks block the way.</li>
    <li>Don’t dawdle: a hawk circles behind you and swoops if you fall too far back.</li>
    <li>Hold the <strong>Cash out</strong> button on the road to bank your run. Traffic keeps moving while you hold. You’re paid for the furthest row you reached: row 10 gives your bet back, and every row after that adds 7%, all the way to the golden egg on row 75 (81.27×).</li>
  </ol>
  <p class="dim" style="margin-top:14px;font-size:14px">A skill game: how far you get is up to you. The server lays out the traffic and checks every run before it pays.</p>`;

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
        <canvas aria-label="Road Rooster. Tap anywhere to hop forward. Swipe left, right, or down to move."></canvas>
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
    const ctx = canvas.getContext('2d', { alpha: false });
    canvas.addEventListener('animationend', () => canvas.classList.remove('is-jolted'));
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
      <div class="rr-toolbar"><button type="button" data-exit aria-label="Exit game view">Exit</button></div>
    </dialog>`);
    controls.after(gameDialog);
    const exitView = gameDialog.querySelector('[data-exit]');
    for (const type of ['gesturestart', 'gesturechange', 'wheel', 'contextmenu']) {
      gameDialog.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    }
    let returnScroll;
    function enterGameView() {
      if (gameDialog.open || !matchMedia('(any-pointer: coarse)').matches) return;
      returnScroll = { left: window.scrollX, top: window.scrollY, behavior: 'instant' };
      gameDialog.append(viewEl);
      gameDialog.showModal();
      document.documentElement.classList.add('rr-playing');
    }
    function leaveGameView() {
      if (!gameDialog.open) return;
      document.documentElement.classList.remove('rr-playing');
      gameDialog.close();
      stage.append(viewEl);
      clearGesture();
      stopHold();
      if (!destroyed) {
        renderControls();
        window.scrollTo(returnScroll);
      }
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
    let lastTouchdown = null;
    const ridingCol = (t) => col + (lane(row).speed || 0) * (t - landedAt);
    let lastCheck = 0;
    let deathAt = null; // { t, cause, at, row, col, impactAt, struck }
    let cashedAt = null; // { t, mult, pay }
    const chick = { fromRow: 0, fromCol: RR.START_COL, fromLift: 0, hopT0: -1e9, duration: HOP_MS, face: 1, bumpT0: -1e9, bumpDir: 0 };
    const scene = landscape(ctx);
    const particles = [];
    const floats = []; // canvas float texts
    const trainsWarned = new Set();
    // Slow the score course as a whole so visible gaps, log drift and collisions agree.
    // Input and hop animations still run on the real clock.
    const worldT = (now) => (now - runT0) / 1000 * (scoreMode ? SCORE_COURSE_SPEED : 1);

    function resetRun() {
      endT = null;
      scene.reset();
      lastTouchdown = null;
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
      chick.fromLift = 0;
      clearGesture();
      particles.length = 0;
      floats.length = 0;
      trainsWarned.clear();
    }

    // ---------------------------------------------------------- layout
    let W = 0;
    let H = 0;
    let dpr = 1;
    let T = 60; // tile size in px
    let pointLabel;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = viewEl.clientWidth;
      H = viewEl.clientHeight;
      const width = Math.round(W * dpr), height = Math.round(H * dpr);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      T = Math.min(W / 7.25, H / 8.8);
    }
    const ro = new ResizeObserver(() => resize());
    ro.observe(viewEl);
    resize();

    // ---------------------------------------------------------- HUD + controls
    function bankLabel() {
      return scoreMode ? `${best} ${best === 1 ? 'pt' : 'pts'}` : fmt(round2((ticket?.amount || 0) * rrMult(best)));
    }
    function renderControls() {
      viewEl.classList.toggle('rr-score-mode', scoreMode);
      modePicker.disabled = phase !== 'idle' && phase !== 'over';
      for (const field of [bet.el, ladder, readout]) field.hidden = scoreMode;
      const bankValue = bankLabel();
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

    function move(m, gesture = null) {
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
      chick.face = [1, -1, -2, 2][m];
      if (nr < 0 || (!scoreMode && nr > RR.FINISH) || nc < 0 || nc >= RR.COLS || lane(nr).blocked.includes(nc)) {
        chick.bumpT0 = now;
        chick.bumpDir = m;
        sfx.tap();
        return;
      }
      if (!scoreMode) moves.push([Math.round(t * 1000), m]);
      const from = pose(now, gesture);
      chick.fromRow = from.row;
      chick.fromCol = from.col;
      chick.fromLift = from.lift;
      chick.hopT0 = now;
      chick.duration = hopDuration() * (m === 0 ? 1 - from.takeoff : 1);
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
        if (best === 1) renderControls();
        else {
          const label = bankLabel();
          fab.lastElementChild.textContent = label;
          playBtn.lastElementChild.textContent = label;
        }
        floats.push({ r: row, c: col, t0: now });
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
      burst(r.left + x, r.top + y, { count: 40, colors: PALETTES.gold, speed: [3, 10] });
    }

    function die(t, cause) {
      phase = 'ending';
      endT = t;
      const now = performance.now();
      // A hop that ends the run still finishes its arc: the splash or the strike lands
      // with the rooster, on the tile where the run ended (see strike, called from tick).
      deathAt = { t, cause, at: now, row, col, impactAt: Math.max(now, chick.hopT0 + chick.duration) };
      const endMs = Math.max(moves.length ? moves[moves.length - 1][0] : 0, Math.round(t * 1000));
      renderControls();
      if (cause === 'hawk') {
        sfx.screech();
        center('<b>Snatched!</b><small>The hawk caught you dawdling</small>', 'lose');
      } else if (!scoreMode) {
        center(`<b>Splat!</b><small>${cause === 'train' ? 'Hit by a train' : cause === 'bus' ? 'Flattened by a bus' : 'Hit by a car'} on row ${row}</small>`, 'lose');
      }
      renderHud();
      endRun(endMs, false);
    }

    function strike(cause, now) {
      const { x, y } = chickScreen(now);
      if (cause === 'river') {
        haptic(25);
        splash(x, y);
        return;
      }
      sfx.splat();
      haptic([40, 30, 70]);
      if (!reducedMotion()) {
        canvas.classList.remove('is-jolted');
        void canvas.offsetWidth; // restart the animation
        canvas.classList.add('is-jolted');
      }
      featherBurst(x, y, cause === 'train' ? 34 : 26, cause === 'train' ? 1.5 : 1);
    }

    function featherBurst(x, y, count, power = 1) {
      for (let i = 0; i < count; i++) {
        // Burst up and out, then flutter down and settle on the ground around the rooster.
        const a = -Math.PI * (0.08 + 0.84 * Math.random());
        const v = (2 + Math.random() * 4.5) * power;
        particles.push({ kind: 'feather', x, y: y - T * 0.25, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
          sway: Math.random() * 6, floor: y + T * (Math.random() * 0.5 - 0.12), life: 150 + Math.random() * 60, c: i % 3 ? '#fff6e6' : '#e9d6b4' });
      }
    }

    function splash(x, y) {
      sfx.splash?.(); // optional: an older cached sound module may lack it
      for (let i = 0; i < 22; i++) {
        const a = -Math.PI * (0.12 + 0.76 * Math.random());
        const v = 1.6 + Math.random() * 4.2;
        particles.push({ kind: 'drop', x: x + (Math.random() - 0.5) * T * 0.3, y, vx: Math.cos(a) * v * 0.7, vy: Math.sin(a) * v,
          floor: y + T * Math.random() * 0.18, life: 70, size: 0.025 + Math.random() * 0.03, c: i % 3 ? '#e9fbff' : '#a9dfee' });
      }
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
        // Let the splash, the flattening or the bank register before the result covers it.
        setTimeout(() => {
          if (destroyed || phase !== 'ending') return;
          phase = 'over';
          const cause = { line: 'Caught by the red line', river: 'Fell in the river', road: 'Hit by a car', bus: 'Hit by a bus', train: 'Hit by a train' };
          const illustration = cashout ? art?.happy : art?.flat;
          const badge = illustration ? `<img class="rr-result-art" alt="" src="${illustration.src}">` : '';
          center(`${badge}<strong>${cashout ? 'Score banked' : cause[deathAt?.cause] || 'Run ended'}</strong><b>${points}</b><small>Best ${record} · reached row ${best}</small>`, cashout ? 'win' : 'lose');
          renderHud();
          renderControls();
        }, cashout ? RESULT_BANK_MS : RESULT_DEATH_MS);
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
        burst(rc.left + x, rc.top + y, { count: mult >= 2 ? 80 : 40, colors: PALETTES.gold, speed: [4, 12], kind: 'coin' });
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
    function clearGesture(event) {
      if (event?.pointerId == null || event.pointerId === touch?.id) touch = null;
    }
    const cancelMultiTouch = (event) => {
      if (event.pointerType === 'touch' && !event.isPrimary) {
        clearGesture();
        stopHold();
      }
    };
    view.addEventListener('pointerdown', cancelMultiTouch, true);
    // The dialog includes the safe-area margins. Inline play owns only its board.
    view.addEventListener('pointerdown', (event) => {
      if (phase !== 'run' || !event.isPrimary || event.button !== 0) return;
      const surface = gameDialog.open ? gameDialog : viewEl;
      if (!surface.contains(event.target) || event.target.closest('button')) return;
      surface.setPointerCapture(event.pointerId);
      const now = performance.now();
      // Event delivery can trail contact on a busy frame. Use its monotonic
      // timestamp for animation only. Collision checks keep their own clock.
      const at = event.timeStamp > 0 && event.timeStamp <= now ? event.timeStamp : now;
      const nextCol = Math.round(ridingCol(worldT(now)));
      touch = {
        x: event.clientX, y: event.clientY, id: event.pointerId, at,
        canAdvance: (scoreMode || row < RR.FINISH) && !lane(row + 1).blocked.includes(nextCol),
      };
    });
    function recognizeMove(event) {
      if (!touch || touch.id !== event.pointerId) return;
      const dx = event.clientX - touch.x;
      const dy = event.clientY - touch.y;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const swipe = Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_PX;
      if (!swipe && event.type !== 'pointerup') return;
      const gesture = touch;
      clearGesture();
      if (!swipe) move(0, gesture);
      else if (horizontal) move(dx > 0 ? 3 : 2, gesture);
      else move(dy > 0 ? 1 : 0, gesture);
    }
    view.addEventListener('pointermove', recognizeMove);
    view.addEventListener('pointerup', recognizeMove);
    view.addEventListener('pointercancel', clearGesture);
    view.addEventListener('lostpointercapture', clearGesture);
    window.addEventListener('blur', clearGesture);

    // ---------------------------------------------------------- chicken position (with hop easing)
    function hopDuration() {
      return reducedMotion() ? 40 : HOP_MS;
    }
    function pose(now, gesture = touch) {
      const u = clamp((now - chick.hopT0) / chick.duration, 0, 1);
      const travel = u * (2 - u);
      const arc = 4 * u * (1 - u);
      const peak = reducedMotion() ? .04 : .32;
      const lift = peak * arc + (u < .5 ? chick.fromLift * (1 - arc) : 0);
      // Ease towards the edge of the tile. Quick taps blend straight into the
      // full hop, and a slower swipe can still steer from the displayed pose.
      const held = gesture?.canAdvance && phase === 'run' ? Math.max(0, now - gesture.at) : 0;
      const takeoff = TAKEOFF_FRACTION * (1 - Math.exp(-held / 28));
      const x = ridingCol(endT ?? worldT(now));
      return {
        row: chick.fromRow + (row - chick.fromRow) * travel + takeoff * (2 - takeoff),
        col: chick.fromCol + (x - chick.fromCol) * travel,
        lift: lift + (peak - lift) * 4 * takeoff * (1 - takeoff),
        takeoff,
      };
    }
    function chickScreen(now) {
      const p = pose(now);
      return scene.point(p.col, p.row);
    }

    function trainWarning(L, r, t) {
      const edge = L.dir === 1 ? 0 : RR.COLS;
      const ahead = (edge - rrFront(L, t, 0)) * L.dir;
      const distance = ((ahead % L.P) + L.P) % L.P;
      const soon = distance < 1.6 * L.v || L.P - distance < L.len + RR.COLS;
      if (soon && !trainsWarned.has(r) && phase === 'run' && Math.abs(r - row) <= 4) {
        trainsWarned.add(r);
        sfx.honk();
      }
      if (!soon) trainsWarned.delete(r);
      return soon;
    }

    // Every point uses the same glowing glyph. Rasterize it at the board's
    // density once instead of filtering text on the playfield during every hop.
    function scoreLabel() {
      const size = Math.max(1, Math.round(T * .3));
      if (pointLabel?.size === size && pointLabel.dpr === dpr) return pointLabel;
      const image = document.createElement('canvas');
      const padding = 24; // backing pixels, including the blur
      const halfWidth = Math.ceil(size * dpr) + padding;
      const baseline = Math.ceil(size * dpr) + padding;
      image.width = 2 * halfWidth;
      image.height = baseline + padding + Math.ceil(size * dpr * .4);
      const g = image.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, halfWidth, baseline);
      g.font = `800 ${size}px Bricolage, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = g.shadowColor = '#ffd979';
      g.shadowBlur = 10;
      g.fillText('+1', 0, 0);
      pointLabel = { image, size, dpr, x: halfWidth / dpr, y: baseline / dpr };
      return pointLabel;
    }

    function drawParticles(dt) {
      const step = dt * 60;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= step;
        if (p.kind === 'drop') {
          // Spray is heavy: it arcs up and drops straight back into the river.
          p.x += p.vx * step;
          p.y += p.vy * step;
          p.vy += 0.32 * step;
          if (p.life <= 0 || (p.vy > 0 && p.y > p.floor)) {
            particles.splice(i, 1);
            continue;
          }
          ctx.globalAlpha = Math.min(1, p.life / 20);
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, T * p.size, T * p.size * (1 + Math.min(1.5, Math.abs(p.vy) * 0.12)), Math.atan2(p.vy, p.vx) - Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        if (!p.rest) {
          // Feathers burst out, then drift down slowly, rocking side to side, and settle.
          p.sway += 0.16 * step;
          p.x += (p.vx + Math.sin(p.sway) * 0.7) * step;
          p.y += p.vy * step;
          p.vx *= 0.93 ** step;
          p.vy = Math.min(0.9, p.vy * 0.93 ** step + 0.1 * step);
          p.rot += (p.vr + Math.cos(p.sway) * 0.04) * step;
          if (p.vy > 0 && p.y >= p.floor) p.rest = true;
        }
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rest ? p.rot * 0.2 + 1.2 : p.rot);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.ellipse(0, 0, T * 0.09, T * (p.rest ? 0.026 : 0.035), 0, 0, Math.PI * 2);
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
        const label = scoreLabel();
        const p = scene.point(f.c, f.r, 0.9 + k * 0.7);
        ctx.drawImage(label.image, p.x - label.x, p.y - label.y,
          label.image.width / dpr, label.image.height / dpr);
        ctx.globalAlpha = 1;
      }
    }

    let lastNow = performance.now();
    let endT = null; // world time the run ended (freezes the camera)
    function tick() {
      if (destroyed) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      // The exponential camera follow uses real elapsed time even after a slow frame.
      const dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!W || !H) return;
      const t = endT ?? worldT(now);
      if (phase === 'run') checkDeath(t);
      const line = scoreMode ? chaseLine(t) : rrHawk(t);
      const warning = phase === 'run' && (scoreMode ? t > 6 : t > 4);
      const caught = deathAt?.cause === 'line' ? clamp(1.4 - (now - deathAt.at) / 700, 0, 1) : 0;
      dangerEl.style.opacity = String(Math.max(caught, warning ? clamp(1 - (row + 1 - line) / 2, 0, 1) : 0));
      if (deathAt && deathAt.cause !== 'hawk' && !deathAt.struck && now >= deathAt.impactAt) {
        deathAt.struck = true;
        strike(deathAt.cause, now);
      }
      const bump = clamp((now - chick.bumpT0) / 160, 0, 1);
      const nudge = Math.sin(bump * Math.PI) * .12;
      const player = pose(now);
      const vr = player.row + (chick.bumpDir === 0 ? nudge : chick.bumpDir === 1 ? -nudge : 0);
      const vc = player.col + (chick.bumpDir === 3 ? nudge : chick.bumpDir === 2 ? -nudge : 0);
      const touchdownAt = chick.hopT0 + chick.duration;
      const landing = clamp((now - touchdownAt) / 75, 0, 1);
      const squash = reducedMotion() ? 0 : 0.10 * Math.sin(Math.PI * landing);
      if (phase === 'run' && !reducedMotion() && now >= touchdownAt && now - touchdownAt < 500 &&
          lastTouchdown?.at !== touchdownAt) {
        const L = lane(row);
        const x = ridingCol(worldT(touchdownAt));
        const platform = L.kind === 'river' ? Math.round((col - L.offset - L.speed * landedAt) / L.period) : null;
        lastTouchdown = { at: touchdownAt, row, x, platform };
      }
      scene.draw({ W, H, dpr, dt, seed, lane, t, now, vr, vc, hop: player.lift, squash, touchdown: phase === 'run' ? lastTouchdown : null,
        facing: chick.face, death: deathAt, banked: cashedAt, score: scoreMode, phase, line, art, trainWarning });
      if (phase === 'countdown') scoreLabel();
      drawParticles(Math.min(.05, dt));
    }
    let raf = requestAnimationFrame(tick);

    loadArt().then((a) => {
      if (destroyed) return;
      art = a;
    });
    document.fonts?.ready.then(() => {
      if (destroyed) return;
      pointLabel = null;
      resize();
    });

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
    globalThis.__ccRooster = () => {
      const t = endT ?? worldT(performance.now());
      return { seed, row, col, x: ridingCol(t), best, phase, t, cause: deathAt?.cause ?? null, record };
    };
    renderControls();
    renderHud();
    center('<b>Road Rooster</b><small>Tap to hop · swipe left, right or back</small>', 'intro');
    bet.el.addEventListener('change', () => (renderHud(), renderControls()));

    return () => {
      destroyed = true;
      delete globalThis.__ccRooster;
      view.removeEventListener('pointerdown', cancelMultiTouch, true);
      stopHold();
      leaveGameView();
      window.removeEventListener('blur', stopHold);
      window.removeEventListener('blur', clearGesture);
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
