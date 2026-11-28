// Road Rooster: hop across roads, rail lines and rivers ahead of a red line.
//
// It's a skill game with two modes on the same course (rooster-course.js). A score run is
// free: bank your rows with the egg. A bet run aims for a row picked before the start;
// the server hands out the seed that lays out the course, replays the moves, and pays
// bet × that target's multiplier if the rooster reached it.

import { h, esc, fmt, fmtMult, round2, storage, clamp, reducedMotion } from '../util.js?v=c5acb968c265';
import { icon } from '../icons.js?v=c5acb968c265';
import { store } from '../store.js?v=c5acb968c265';
import { engine, errorText } from '../engine.js?v=c5acb968c265';
import { RR, rrHit, rrFront, RR_TARGETS, targetMult } from '../math.js?v=c5acb968c265';
import { sfx, haptic } from '../sound.js?v=c5acb968c265';
import { burst, PALETTES, coinRain } from '../fx.js?v=c5acb968c265';
import { gameFrame, betInput, tryBet, toast, serverRefused, segmented } from '../ui.js?v=c5acb968c265';
import { duelPanel, duelOutcome } from './duels.js?v=c5acb968c265';
import { scoreLane, onPlatform, chaseLine, LINE_GRACE, HOP_AIR } from './rooster-course.js?v=c5acb968c265';
import { landscape } from './rooster-landscape.js?v=c5acb968c265';
import { loadArt } from './rooster-art.js?v=c5acb968c265';

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

const RULES = `
  <p><strong>Score run</strong> is free. Each new row earns one point. Ride logs, land on lily pads and hold the egg to bank your score. Keep ahead of the red line. Getting caught, hitting traffic or falling into water scores zero. Your best banked score stays in this browser.</p>
  <h3>Bet run</h3><ol class="rules">
    <li>Pick a <strong>bet</strong> and a <strong>target row</strong>, then press <strong>Bet</strong>.</li>
    <li><strong>Tap</strong> (or press <kbd>↑</kbd> / <kbd>Space</kbd>) to hop forward one row. <strong>Swipe</strong> or use <kbd>←</kbd> <kbd>→</kbd> <kbd>↓</kbd> to step sideways or back.</li>
    <li>Reach the target row and you’re paid on the spot: ${RR_TARGETS.map(([g, m]) => `row ${g} pays ${m}×`).join(', ')}.</li>
    <li>Get hit, fall in the river or let the red line catch you before the target, and the bet is lost.</li>
  </ol>
  <h3>1v1</h3><ol class="rules">
    <li><strong>Post a challenge</strong> with any bet and play straight away. Your score (the furthest row you reach) stays hidden.</li>
    <li>Anyone can <strong>accept</strong> it with their own bet and play the exact same road.</li>
    <li>The higher score wins <strong>2× their own bet</strong>; the other player loses theirs. A tie refunds both. Nobody accepts within 24 hours: you get your bet back.</li>
  </ol>
  <p class="dim" style="margin-top:14px;font-size:14px">A skill game: how far you get is up to you. The server lays out the course and replays every run before it pays.</p>`;

export default {
  title: 'Road Rooster',
  mount(view) {
    const frame = gameFrame(view, { game: 'rooster', title: 'Road Rooster', kicker: 'Original · skill game', tags: ['Score chase', `Bet runs up to ${RR_TARGETS.at(-1)[1]}×`], rules: RULES });
    const { stage, controls } = frame;
    const modePicker = h(`<fieldset class="rr-modes"><legend class="sr-only">Road Rooster mode</legend>
      <label><input type="radio" name="rr-mode" value="score" checked> Score run</label>
      <label><input type="radio" name="rr-mode" value="bet"> Bet run</label>
      <label><input type="radio" name="rr-mode" value="duel"> 1v1</label></fieldset>`);
    frame.el.querySelector('.game-head').append(modePicker);
    let free = true; // a free score run; false for a bet run or a 1v1
    let duelMode = false; // the 1v1 tab
    let duelRun = null; // { duel, ticket, role } while a 1v1 run is in play
    let target = Number(storage.get('cc:rooster:target', 25)) || 25;
    if (!targetMult(RR_TARGETS, target)) target = 25;
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
    const goal = h(`<div class="field"><div class="field-label"><span>Target row</span><span class="dim">reach it to win</span></div></div>`);
    const goalPicker = segmented(RR_TARGETS.map(([g, m]) => ({ value: g, label: `${g} · ${m}×` })), target, (v) => {
      target = Number(v);
      storage.set('cc:rooster:target', target);
      renderHud();
      renderControls();
    }, { label: 'Target row' });
    goalPicker.el.classList.add('rr-goals');
    goal.append(goalPicker.el);
    const readout = h(`<div class="readout"><div><span>Reach row</span><strong data-goal>25</strong></div><div><span>To win</span><strong data-value>0.00</strong></div></div>`);
    const playBtn = h(`<button type="button" class="btn btn-primary btn-play"><span>Start run</span></button>`);
    const pad = h(`<div class="rr-pad" aria-label="Move">
      <button type="button" data-m="2" aria-label="Left">${icon('arrowRight')}</button>
      <button type="button" data-m="0" aria-label="Forward" class="up">${icon('arrowRight')}</button>
      <button type="button" data-m="1" aria-label="Back">${icon('arrowRight')}</button>
      <button type="button" data-m="3" aria-label="Right">${icon('arrowRight')}</button>
    </div>`);
    const duels = duelPanel({
      game: 'rooster', bet, unit: 'rows', label: 'run',
      canStart: () => phase === 'idle' || phase === 'over',
      onStart: (active) => {
        duelRun = active;
        seed = active.duel.seed;
        goalRow = null;
        begin();
      },
    });
    duels.el.hidden = true;
    controls.append(bet.el, goal, readout, playBtn, duels.el, pad, h(`<p class="hint">Tap or <kbd>↑</kbd> hop · swipe or <kbd>←</kbd><kbd>→</kbd><kbd>↓</kbd> dodge · <kbd>C</kbd> bank a score run</p>`));
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
    const goalEl = readout.querySelector('[data-goal]');
    const valueEl = readout.querySelector('[data-value]');

    // ---------------------------------------------------------- run state
    // phase: idle → starting → countdown → run → ending → over
    let phase = 'idle';
    let ticket = null;
    let seed = 1 + Math.floor(Math.random() * 2147483640); // a demo road until the first run
    let lanes = new Map();
    const lane = (r) => {
      if (!lanes.has(r)) lanes.set(r, scoreLane(seed, r));
      return lanes.get(r);
    };
    let runT0 = performance.now() - 20000; // world clock origin (demo traffic is mid-flow)
    let goalRow = null; // the target of the bet run in play
    let moves = [];
    let row = 0;
    let col = RR.START_COL;
    let best = 0;
    let landedAt = 0;
    let lastTouchdown = null;
    // On a log she rides from the moment she lands (landedAt); in the air she holds her column.
    const ridingCol = (t) => col + (lane(row).speed || 0) * Math.max(0, t - landedAt);
    let landAt = null; // course time the hop in the air lands, or null when she's standing
    let lastCheck = 0;
    let deathAt = null; // { t, cause, at, row, col, impactAt, struck }
    let cashedAt = null; // { t, mult, pay }
    const chick = { fromRow: 0, fromCol: RR.START_COL, fromLift: 0, hopT0: -1e9, duration: HOP_MS, face: 1, bumpT0: -1e9, bumpDir: 0 };
    // Phones paint a lighter scene at a lower resolution (see resize and pace).
    const lite = matchMedia('(pointer: coarse)').matches;
    const scene = landscape(ctx, { lite });
    const particles = [];
    const floats = []; // canvas float texts
    const trainsWarned = new Set();
    // Slow the course as a whole so visible gaps, log drift and collisions agree.
    // Input and hop animations still run on the real clock.
    const worldT = (now) => (now - runT0) / 1000 * SCORE_COURSE_SPEED;

    function resetRun() {
      endT = null;
      scene.reset();
      lastTouchdown = null;
      landedAt = 0;
      landAt = null;
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
    // Canvas pixels per CSS pixel. A 3× iPhone screen drawn at 2× spent most of each
    // frame filling pixels; 1.5× looks nearly the same and costs about 40% less.
    let resolution = lite ? 1.5 : 2;
    function resize() {
      dpr = Math.min(resolution, window.devicePixelRatio || 1);
      W = viewEl.clientWidth;
      H = viewEl.clientHeight;
      const width = Math.round(W * dpr), height = Math.round(H * dpr);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      T = Math.min(W / 8, H / 9.6);
    }
    const ro = new ResizeObserver(() => resize());
    ro.observe(viewEl);
    resize();

    // ---------------------------------------------------------- HUD + controls
    const stakeMult = () => targetMult(RR_TARGETS, goalRow ?? target);
    const winValue = () => round2((ticket?.amount ?? bet.value) * stakeMult());
    function bankLabel() {
      return `${best} ${best === 1 ? 'pt' : 'pts'}`;
    }
    function renderControls() {
      // Both modes use the score plaque. A bet run shows its target and has no bank.
      viewEl.classList.add('rr-score-mode');
      viewEl.classList.toggle('rr-bet-mode', !free);
      viewEl.classList.toggle('rr-live', ['countdown', 'run', 'ending'].includes(phase));
      modePicker.disabled = phase !== 'idle' && phase !== 'over';
      bet.el.hidden = free;
      for (const field of [goal, readout]) field.hidden = free || duelMode;
      viewEl.classList.toggle('rr-result', phase === 'over');
      if (phase !== 'run') stopHold();
      const live = phase === 'run' || phase === 'countdown';
      const ready = phase === 'idle' || phase === 'over';
      playBtn.hidden = duelMode && ready;
      playBtn.disabled = phase === 'starting' || phase === 'ending' || (live && (!free || best < 1));
      if (ready) {
        playBtn.className = 'btn btn-primary btn-play';
        playBtn.innerHTML = free
          ? `<span>${phase === 'over' ? 'Run again' : 'Start run'}</span>`
          : `<span>Bet ${fmt(bet.value)}</span><span class="sub">Reach row ${target} · win ${fmt(winValue())}</span>`;
      } else if (phase === 'starting') {
        playBtn.className = 'btn btn-outline btn-play';
        playBtn.innerHTML = '<span>Starting…</span>';
      } else if (phase === 'ending') {
        playBtn.className = 'btn btn-play is-cash';
        playBtn.innerHTML = free ? '<span>Banking…</span>' : '<span>Settling…</span>';
      } else if (free) {
        playBtn.className = best >= 1 ? 'btn btn-play is-cash' : 'btn btn-outline btn-play';
        playBtn.innerHTML = best >= 1 ? `<span>Bank score</span><span class="sub">${bankLabel()}</span>` : '<span>Hop to start scoring</span>';
      } else if (duelRun) {
        playBtn.className = 'btn btn-outline btn-play';
        playBtn.innerHTML = `<span>Row ${best}</span><span class="sub">1v1 · ${duelRun.role === 'guest' ? `vs ${esc(duelRun.duel.host)}` : 'score hidden until accepted'}</span>`;
      } else {
        playBtn.className = 'btn btn-outline btn-play';
        playBtn.innerHTML = `<span>Row ${best} of ${goalRow}</span><span class="sub">Win ${fmt(winValue())}</span>`;
      }
      duels.setBusy(!ready);
      bet.disable(!ready);
      goalPicker.disable(!ready);
      goalPicker.set(target);
      pad.querySelectorAll('button').forEach((b) => (b.disabled = phase !== 'run'));
      // the same action, on the road itself (so phones never have to scroll mid-run)
      if (ready) {
        fab.hidden = false;
        fab.className = 'rr-fab';
        fab.innerHTML = phase === 'over' && gameDialog.open ? 'Continue' : free ? (phase === 'over' ? 'Run again' : 'Start run') : duelMode ? `1v1 <span>${fmt(bet.value)}</span>` : `Bet <span>${fmt(bet.value)}</span>`;
      } else if (free && live && best >= 1) {
        fab.hidden = false;
        fab.classList.add('is-cash');
        fab.innerHTML = `Hold to cash out <span>${bankLabel()}</span>`;
      } else fab.hidden = true;
    }
    function renderHud() {
      scoreEl.textContent = free || duelMode ? String(best) : `${best} / ${goalRow ?? target}`;
      multEl.textContent = free ? `Best ${record}` : duelMode ? `1v1 · ${fmt(duelRun?.ticket.amount ?? bet.value)}` : `Win ${fmt(winValue())}`;
      goalEl.textContent = String(target);
      valueEl.textContent = fmt(round2(bet.value * targetMult(RR_TARGETS, target)));
    }
    function center(html, cls = '') {
      centerEl.className = `rr-center ${cls}`;
      centerEl.innerHTML = html;
    }

    // ---------------------------------------------------------- run flow
    async function start() {
      if (phase !== 'idle' && phase !== 'over') return;
      if (duelMode) {
        // From the road itself (the FAB or a tap): post a challenge.
        if (phase === 'over' && gameDialog.open) return leaveGameView();
        return duels.start(null);
      }
      if (free) {
        seed = 1 + Math.floor(Math.random() * 2147483640);
        goalRow = null;
      } else {
        const t = tryBet('rooster', bet);
        if (!t) return;
        phase = 'starting';
        renderControls();
        const r = await engine.roosterStart(t.amount, target);
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
        goalRow = r.target;
      }
      begin();
    }

    /** Countdown, then go: the course is laid out by seed (and goalRow for a bet run). */
    function begin() {
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

    /**
     * The hop lands at t. Nothing could touch her in the air; now whatever is on the tile
     * counts: a vehicle there, open water, or the red line past her. A bet run that lands
     * on its target row wins here. Returns true when the run ended.
     */
    function touchDown(t) {
      landAt = null;
      landedAt = t;
      lastCheck = t;
      const L = lane(row);
      if (chaseLine(t) > row + 1) {
        die(t, 'line');
        return true;
      }
      if (L.kind === 'river' ? !onPlatform(L, col, t) : rrHit(L, col, t, t, RR.HB_CLIENT) >= 0) {
        die(t, L.kind === 'river' ? 'river' : L.kind);
        return true;
      }
      if (!free && goalRow != null && best >= goalRow) {
        win(t);
        return true;
      }
      return false;
    }

    /** Did anything get us between the last check and t (seconds)? */
    function checkDeath(t) {
      if (phase !== 'run') return false;
      if (landAt != null) {
        if (t < landAt) return false; // in the air: nothing can touch her
        if (touchDown(landAt)) return true;
      }
      if (t < lastCheck) return false;
      const L = lane(row);
      if (chaseLine(t) > row + 1) {
        die(t, 'line');
        return true;
      }
      if (L.kind === 'river' && !onPlatform(L, ridingCol(t), t)) {
        die(t, 'river');
        return true;
      }
      const tHit = rrHit(L, col, lastCheck, t, RR.HB_CLIENT);
      lastCheck = t;
      if (tHit < 0) return false;
      die(tHit, L.kind);
      return true;
    }

    function move(m, gesture = null) {
      if (phase !== 'run' || destroyed) return;
      const now = performance.now();
      // Whole course milliseconds, so the server's replay sees exactly this moment.
      const t = Math.round(worldT(now) * 1000) / 1000;
      // A tap before the last hop lands sets it down now, and that tile is checked.
      if (landAt != null && t < landAt && touchDown(t)) return;
      if (checkDeath(t)) return;
      let nr = row;
      let nc = Math.round(ridingCol(t));
      if (m === 0) nr += 1;
      else if (m === 1) nr -= 1;
      else if (m === 2) nc -= 1;
      else if (m === 3) nc += 1;
      chick.face = [1, -1, -2, 2][m];
      if (nr < 0 || nc < 0 || nc >= RR.COLS || lane(nr).blocked.includes(nc)) {
        chick.bumpT0 = now;
        chick.bumpDir = m;
        sfx.tap();
        return;
      }
      if (!free) moves.push([Math.round(t * 1000), m]);
      const from = pose(now, gesture);
      chick.fromRow = from.row;
      chick.fromCol = from.col;
      chick.fromLift = from.lift;
      chick.hopT0 = now;
      chick.duration = hopDuration() * (m === 0 ? 1 - from.takeoff : 1);
      row = nr;
      col = nc;
      // In the air until it lands: the landing decides what happens (see touchDown).
      landAt = t + HOP_AIR;
      landedAt = landAt;
      sfx.hop();
      // Wood or water underfoot when the hop lands.
      const ground = lane(row);
      if (ground.kind === 'river') {
        setTimeout(() => !destroyed && phase === 'run' && (ground.pads ? sfx.padLand?.() : sfx.logLand?.()), chick.duration);
      }
      if (row > best) {
        best = row;
        if (best % 64 === 0) {
          for (const cachedRow of lanes.keys()) if (cachedRow < best - 64) lanes.delete(cachedRow);
        }
        renderHud();
        if (!free || best === 1) renderControls();
        else {
          const label = bankLabel();
          fab.lastElementChild.textContent = label;
          playBtn.lastElementChild.textContent = label;
        }
        floats.push({ r: row, c: col, t0: now });
        if (best % 25 === 0) sfx.chime?.();
        // A bet run is won when this hop lands safely (touchDown).
      }
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

    /** A bet run reached its target row: it's paid on the spot. */
    function win(t) {
      phase = 'ending';
      endT = t;
      cashedAt = { at: performance.now() };
      renderControls();
      sfx.cashout();
      endRun(Math.round(t * 1000), true);
    }

    async function cashOut() {
      if (phase !== 'run' || best < 1 || !free) return;
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

    const CAUSES = { line: 'Caught by the red line', river: 'Fell in the river', road: 'Hit by a car', bus: 'Hit by a bus', train: 'Hit by a train' };
    async function endRun(endMs, cashout) {
      // Let the splash, the flattening or the bank register before the result covers it.
      const due = performance.now() + (cashout ? RESULT_BANK_MS : RESULT_DEATH_MS);
      const reveal = (show) => setTimeout(() => {
        if (destroyed || phase !== 'ending') return;
        phase = 'over';
        show();
        renderHud();
        renderControls();
      }, Math.max(0, due - performance.now()));
      const badge = (happy) => {
        const illustration = happy ? art?.happy : art?.flat;
        return illustration ? `<img class="rr-result-art" alt="" src="${illustration.src}">` : '';
      };
      if (free) {
        const points = cashout ? best : 0;
        record = Math.max(record, points, Number(storage.get('cc:rooster:score', 0)) || 0);
        storage.set('cc:rooster:score', record);
        reveal(() => center(`${badge(cashout)}<strong>${cashout ? 'Score banked' : CAUSES[deathAt?.cause] || 'Run ended'}</strong><b>${points}</b><small>Best ${record} · reached row ${best}</small>`, cashout ? 'win' : 'lose'));
        return;
      }
      if (duelRun) {
        const active = duelRun;
        duelRun = null;
        const d = await duels.finish(active, { moves: moves.slice(), end_ms: endMs });
        if (destroyed) return;
        if (!d) return reveal(() => center(`${badge(false)}<strong>Not sent</strong><b>${best}</b><small>The challenge didn’t get your run. Check your challenges.</small>`, 'lose'));
        const o = duelOutcome(d, 'rows');
        reveal(() => {
          if (o.kind === 'posted') center(`${badge(true)}<strong>${o.title}</strong><b>${o.mine} ${o.mine === 1 ? 'row' : 'rows'}</b><small>${esc(o.line)}</small>`, 'win');
          else if (o.kind === 'win') {
            center(`${badge(true)}<strong>${esc(o.title)}</strong><b>+${fmt(o.pay)}</b><small>${esc(o.line)}</small>`, 'win');
            const { x, y } = chickScreen(performance.now());
            const rc = canvas.getBoundingClientRect();
            burst(rc.left + x, rc.top + y, { count: 70, colors: PALETTES.gold, speed: [4, 12], kind: 'coin' });
            sfx.win(2);
          } else center(`${badge(o.kind === 'tie')}<strong>${esc(o.title)}</strong><b>${o.kind === 'tie' ? fmt(o.stake) : `−${fmt(o.stake)}`}</b><small>${esc(o.line)}</small>`, o.kind === 'tie' ? 'win' : 'lose');
        });
        return;
      }
      const t = ticket;
      const goalWas = goalRow;
      const r = await engine.roosterEnd(moves.slice(), endMs);
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
      if (destroyed) return;
      if (r.payout > 0) {
        reveal(() => {
          center(`${badge(true)}<strong>Row ${goalWas} reached</strong><b>+${fmt(r.payout)}</b><small>${fmtMult(r.mult)} on a ${fmt(t.amount)} bet</small>`, 'win');
          const { x, y } = chickScreen(performance.now());
          const rc = canvas.getBoundingClientRect();
          burst(rc.left + x, rc.top + y, { count: r.mult >= 2 ? 80 : 40, colors: PALETTES.gold, speed: [4, 12], kind: 'coin' });
          if (r.mult >= 5) coinRain(r.mult >= 20 ? 120 : 60);
          sfx.win(r.mult >= 3 ? 2 : 1);
        });
      } else if (cashout) {
        // The game saw the target reached, but the server's replay didn't.
        reveal(() => center(`${badge(false)}<strong>Not counted</strong><b>${fmt(0)}</b><small>The replay caught the rooster before row ${goalWas}</small>`, 'lose'));
      } else {
        reveal(() => center(`${badge(false)}<strong>${CAUSES[deathAt?.cause] || 'Run ended'}</strong><b>−${fmt(t.amount)}</b><small>Row ${best} of ${goalWas} · bet lost</small>`, 'lose'));
      }
    }

    /** Leaving mid-run (or reloading) gives the run up. */
    function forfeit() {
      if (duelRun) {
        const active = duelRun;
        duelRun = null;
        duels.finish(active, { moves: moves.slice(), end_ms: moves.length ? moves[moves.length - 1][0] + 100 : 0 });
        return;
      }
      const t = ticket;
      ticket = null;
      const endMs = moves.length ? moves[moves.length - 1][0] : 0;
      engine.roosterEnd(moves.slice(), endMs).then((r) => {
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
        canAdvance: !lane(row + 1).blocked.includes(nextCol),
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
    let dangerShown = '';
    let lastWarn = 0;
    // Traffic in the lanes beside the rooster: a whoosh as each car or bus reaches her
    // column, a rumble for a train. Only the moment a vehicle arrives counts.
    let soundT = null;
    const passed = new Map();
    function passBy(t, now) {
      if (soundT != null && t > soundT) {
        const c = Math.round(ridingCol(t));
        for (const r of [row - 1, row + 1]) {
          const L = lane(r);
          if (!L.v || now - (passed.get(r) || 0) < 350) continue;
          if (rrHit(L, c, soundT, soundT, 0.5) < 0 && rrHit(L, c, soundT, t, 0.5) >= 0) {
            passed.set(r, now);
            if (L.kind === 'train') sfx.rumble?.();
            else sfx.pass?.(L.kind === 'bus' ? 1.4 : 1);
          }
        }
      }
      soundT = t;
    }
    // If a phone still drops frames during play, step the resolution down (1.5 → 1.25 → 1).
    // Ignore a steady 30 fps cap (Low Power Mode): only act when frames that should
    // arrive every 16.7 ms keep slipping, or when they stall outright.
    const intervals = [];
    let settle = 0; // frames to skip while a new resolution repaints its ground tiles
    function pace(now, dt) {
      if (!lite || phase !== 'run' || resolution <= 1 || document.hidden || dt > 0.25) return;
      if (settle > 0) return void settle--;
      intervals.push(dt * 1000);
      if (intervals.length < 150) return;
      const sorted = intervals.splice(0).sort((a, b) => a - b);
      const at = (p) => sorted[Math.floor(sorted.length * p)];
      if ((at(0.25) < 20 && at(0.75) > 24) || at(0.9) > 45) {
        resolution = resolution > 1.25 ? 1.25 : 1;
        settle = 45;
        resize();
      }
    }
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
      const line = chaseLine(t);
      const warning = phase === 'run' && t > LINE_GRACE;
      const caught = deathAt?.cause === 'line' ? clamp(1.4 - (now - deathAt.at) / 700, 0, 1) : 0;
      const danger = Math.max(caught, warning ? clamp(1 - (row + 1 - line) / 2, 0, 1) : 0).toFixed(2);
      if (danger !== dangerShown) {
        // Style writes every frame cost a style pass; the throb only runs while visible.
        dangerShown = danger;
        dangerEl.style.opacity = danger;
        dangerEl.classList.toggle('is-on', danger !== '0.00');
      }
      pace(now, dt);
      if (phase === 'run') {
        if (danger >= '0.50' && now - lastWarn > 650) {
          lastWarn = now;
          sfx.warn?.();
        }
        passBy(t, now);
      }
      if (deathAt && !deathAt.struck && now >= deathAt.impactAt) {
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
        facing: chick.face, death: deathAt, banked: cashedAt, score: true, target: goalRow, phase, line, art, trainWarning });
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
      engine.roosterEnd([], 0).then((r) => {
        store.sync(r);
        store.refresh();
        if (r?.ok) toast('Your last run ended when you left the road.', { iconName: 'info' });
      });
    }
    // For automated play-tests (everything here is already on screen).
    modePicker.addEventListener('change', () => {
      if (modePicker.disabled) return;
      const picked = modePicker.querySelector(':checked').value;
      free = picked === 'score';
      duelMode = picked === 'duel';
      duels.show(duelMode);
      goalRow = null;
      phase = 'idle';
      resetRun();
      center(`<b>Road Rooster</b><small>${free ? 'Cross lanes and bank your points' : duelMode ? 'Post a challenge or accept one · same road, higher score wins' : 'Pick a bet and a row to reach'}</small>`, 'intro');
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
      if ((ticket || duelRun) && (phase === 'run' || phase === 'countdown')) {
        forfeit();
        toast('You left the road, so that run is over.', { iconName: 'info' });
      }
      duels.destroy();
      frame.destroy();
    };
  },
};
