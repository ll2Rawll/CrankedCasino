// Crash: the multiplier climbs as e^(k·t) until a hidden crash point.
// Crash point = 0.99 / (1 − U), floored to 2 decimals, so P(crash ≥ x) = 0.99 / x
// and every cash-out target has the same 1% house edge.
//
// Rounds you bet on are run by the server: it picks the crash point, keeps it secret
// and decides every cash-out by its own clock, so it can't be predicted or replayed.
// Rounds without a bet are just for show and run in the browser.
//
// The engine lives outside the page so a live bet still resolves (and auto cash-out
// still fires) if you wander off to another game mid-flight.

import { h, fmt, fmtMult, round2, signed, storage, clamp, reducedMotion } from '../util.js?v=8bbe697797bd';
import { icon } from '../icons.js?v=8bbe697797bd';
import { store, BetError } from '../store.js?v=8bbe697797bd';
import { engine, errorText } from '../engine.js?v=8bbe697797bd';
import { needAccount } from '../account.js?v=8bbe697797bd';
import { random } from '../rng.js?v=8bbe697797bd';
import { CRASH_K as K, crashAt as at, crashTimeFor as timeFor, crashPoint } from '../math.js?v=8bbe697797bd';
import { sfx, engine as hum, haptic } from '../sound.js?v=8bbe697797bd';
import { burstAt, celebrate, PALETTES, shake } from '../fx.js?v=8bbe697797bd';
import { gameFrame, betInput, toast, betError, serverRefused } from '../ui.js?v=8bbe697797bd';

const BETTING_MS = 5000;
const CRASHED_MS = 3200;
const POLL_MS = 220;

// ------------------------------------------------------------------ engine
const E = {
  phase: 'idle',
  start: 0,
  crashAt: 1,
  known: true, // is the crash point known yet? (not while a real bet is in the air)
  history: storage.get('cc:crash:hist', []).slice(0, 24),
  bet: null, // { t, amount, auto, cashed, state: 'sending' | 'live' | 'cashing' | 'cancelling' | 'done', runAt }
  queued: null, // { amount, auto }
  viewers: 0,
  timer: 0,
  lastPoll: 0,
  polling: false,
  subs: new Set(),
};

function emit(type, data) {
  E.subs.forEach((fn) => fn(type, data));
}

/** Place a bet on the round that's counting down. */
async function placeNow(amount, auto) {
  if (!needAccount()) return false;
  let t;
  try {
    t = store.placeBet('crash', amount);
  } catch (e) {
    if (e instanceof BetError) betError(e.message);
    else throw e;
    return false;
  }
  sfx.bet();
  const b = { t, amount: t.amount, auto, cashed: null, state: 'sending', runAt: null };
  E.bet = b;
  emit('bet');
  const left = Math.max(0, BETTING_MS - (performance.now() - E.start));
  const t0 = performance.now();
  const r = await engine.crashStart(t.amount, auto, left);
  const t1 = performance.now();
  if (!r?.ok) {
    if (E.bet === b) E.bet = null;
    serverRefused(t, r);
    emit('bet');
    return false;
  }
  store.confirm(t, r, { debited: t.amount });
  // Line our clock up with the server's: it launches at started_at on its clock.
  b.runAt = t1 - (t1 - t0) / 2 + (r.started_at - r.server_now);
  b.state = 'live';
  emit('bet');
  if (b.cancel) cancelBet();
  return true;
}

/** Take back a bet before take-off. */
async function cancelBet() {
  const b = E.bet;
  if (!b) return;
  if (b.state === 'sending') {
    b.cancel = true; // as soon as the server confirms it
    return;
  }
  if (b.state !== 'live' || E.phase !== 'betting') return;
  b.state = 'cancelling';
  emit('bet');
  const r = await engine.crashCashout(null);
  if (r?.ok && r.state === 'cancelled') {
    store.confirm(b.t, r, { debited: 0 });
    store.cancel(b.t);
  } else if (r?.ok && r.state === 'cashed') {
    // It had just taken off: cashed at about 1.00×.
    store.confirm(b.t, r, { paid: r.payout });
    store.finish(b.t, r.entry);
  } else if (r?.ok && r.state === 'crashed') {
    store.confirm(b.t, r, { paid: 0 });
    store.finish(b.t, r.entry);
  } else {
    b.state = 'live';
    if (r?.error !== 'auth') toast(errorText(r), { type: 'loss' });
    emit('bet');
    return;
  }
  if (E.bet === b) E.bet = null;
  emit('bet');
}

function startBetting() {
  E.phase = 'betting';
  E.start = performance.now();
  E.bet = null;
  E.known = true;
  if (E.queued) {
    const q = E.queued;
    E.queued = null;
    placeNow(q.amount, q.auto);
  }
  emit('phase');
}

function startRun() {
  E.phase = 'running';
  const live = E.bet && E.bet.state === 'live';
  E.start = live ? E.bet.runAt : performance.now();
  E.known = !live;
  E.crashAt = live ? Infinity : crashPoint(random());
  E.lastPoll = 0;
  emit('phase');
}

function crash() {
  E.phase = 'crashed';
  E.start = performance.now();
  E.known = true;
  E.history.unshift(E.crashAt);
  E.history.length = Math.min(E.history.length, 24);
  storage.set('cc:crash:hist', E.history);
  emit('crash');
}

/** Apply the server's word on the live bet: cashed out, or crashed. */
function settle(r) {
  const b = E.bet;
  if (!b || b.state === 'done') return;
  if (r.state === 'cashed') {
    b.state = 'done';
    b.cashed = r.mult;
    store.confirm(b.t, r, { paid: r.payout });
    store.finish(b.t, r.entry);
    E.crashAt = r.crash_point;
    E.known = true;
    emit('cashout', { m: r.mult, pay: r.payout });
    if (Math.exp(K * (performance.now() - E.start)) >= E.crashAt) crash();
  } else if (r.state === 'crashed') {
    b.state = 'done';
    store.confirm(b.t, r, { paid: 0 });
    store.finish(b.t, r.entry);
    E.crashAt = r.crash_point;
    E.known = true;
    if (E.phase === 'running') crash();
  } else if (r.state === 'none') {
    // Settled somewhere else (another tab): reload the truth.
    b.state = 'done';
    store.cancel(b.t);
    store.refresh();
    E.crashAt = Math.max(1, at(performance.now() - E.start));
    E.known = true;
    if (E.phase === 'running') crash();
  }
}

async function poll() {
  const b = E.bet;
  if (E.polling || !b || b.state !== 'live') return;
  E.polling = true;
  const r = await engine.crashPoll();
  E.polling = false;
  if (E.bet !== b || b.state !== 'live' || !r?.ok) return;
  settle(r);
}

export async function cashOut() {
  const b = E.bet;
  if (E.phase !== 'running' || !b || b.state !== 'live') return false;
  b.state = 'cashing';
  const m = at(performance.now() - E.start);
  emit('bet');
  const r = await engine.crashCashout(m);
  if (E.bet !== b) return false;
  if (!r?.ok) {
    if (r?.error === 'no_round') settle({ state: 'none' });
    else {
      b.state = 'live';
      if (r?.error !== 'auth') toast(errorText(r), { type: 'loss' });
    }
    emit('bet');
    return false;
  }
  b.state = 'live';
  settle(r);
  return r.state === 'cashed';
}

function tick() {
  const now = performance.now();
  const el = now - E.start;
  const b = E.bet;
  if (E.phase === 'betting') {
    // Hold the launch while the server is still answering.
    if (b && (b.state === 'sending' || b.state === 'cancelling')) return;
    if (b && b.state === 'live' ? now >= b.runAt : el >= BETTING_MS) startRun();
  } else if (E.phase === 'running') {
    const m = Math.exp(K * el);
    if (b && b.state === 'live') {
      // Ask the server often; ask right away when the auto cash-out target is reached.
      if (b.auto && m >= b.auto && !b.autoAsked) {
        b.autoAsked = true;
        E.lastPoll = now;
        poll();
      } else if (now - E.lastPoll >= POLL_MS) {
        E.lastPoll = now;
        poll();
      }
    }
    if (E.known && m >= E.crashAt) crash();
  } else if (E.phase === 'crashed' && el >= CRASHED_MS) {
    if (E.viewers > 0 || E.queued) startBetting();
    else stopEngine();
  }
}

function ensureEngine() {
  if (!E.timer) E.timer = setInterval(tick, 40);
  if (E.phase === 'idle') startBetting();
}
function stopEngine() {
  clearInterval(E.timer);
  E.timer = 0;
  E.phase = 'idle';
  emit('phase');
}

/** A round still in the air after a reload: rejoin it. */
function resumeRound(rd) {
  if (!rd || E.bet) return;
  const t = store.resume('crash', rd.wager);
  const runAt = performance.now() - rd.elapsed;
  E.bet = { t, amount: rd.wager, auto: rd.auto, cashed: null, state: 'live', runAt };
  if (rd.state === 'waiting') {
    E.phase = 'betting';
    E.start = runAt - BETTING_MS;
    E.known = true;
  } else {
    E.phase = 'running';
    E.start = runAt;
    E.known = false;
    E.crashAt = Infinity;
    E.lastPoll = 0;
  }
  if (!E.timer) E.timer = setInterval(tick, 40);
  emit('phase');
}

// ------------------------------------------------------------------ page
const RULES = `
  <ol class="rules">
    <li>Place a bet while the countdown runs. When the round starts, the multiplier climbs from 1.00×.</li>
    <li>Hit <strong>Cash out</strong> any time to win your bet × the current multiplier.</li>
    <li>The rocket explodes at a random point. If you haven't cashed out by then, the bet is lost.</li>
    <li>Set <strong>Auto cash-out</strong> to bail out at a target automatically. Every target has a 1% house edge.</li>
  </ol>
  <p class="dim" style="margin-top:14px;font-size:14px">Shortcut: <kbd>Space</kbd> bets, cashes out, or queues a bet for the next round.</p>`;

export default {
  title: 'Crash',
  mount(view) {
    const frame = gameFrame(view, { game: 'crash', title: 'Crash', kicker: 'Original · ride the rocket', tags: ['99% RTP', 'Up to 10,000×'], rules: RULES });
    const { stage, controls } = frame;
    let destroyed = false;
    let lastLoss = 0;
    E.viewers++;
    resumeRound(store.takeRound('crash'));
    ensureEngine();

    // ---------------------------------------------------------- stage
    stage.classList.add('crash-stage');
    stage.innerHTML = `
      <div class="crash-hist" aria-label="Previous crash points"></div>
      <div class="crash-view">
        <canvas></canvas>
        <div class="crash-center">
          <div class="crash-mult tnum">1.00×</div>
          <div class="crash-sub">Starting soon</div>
          <div class="crash-bar"><i></i></div>
        </div>
      </div>`;
    const histEl = stage.querySelector('.crash-hist');
    const viewEl = stage.querySelector('.crash-view');
    const canvas = viewEl.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const multEl = stage.querySelector('.crash-mult');
    const subEl = stage.querySelector('.crash-sub');
    const barEl = stage.querySelector('.crash-bar');
    const barFill = barEl.querySelector('i');

    // ---------------------------------------------------------- controls
    controls.innerHTML = '';
    const bet = betInput('crash');
    let autoOn = storage.get('cc:crash:autoOn', false);
    let autoVal = storage.get('cc:crash:auto', 2);
    const autoField = h(`
      <div class="field">
        <div class="field-label"><span>Auto cash-out</span><span class="switch"><input type="checkbox" aria-label="Enable auto cash-out" ${autoOn ? 'checked' : ''}><span></span></span></div>
        <div class="input-group"><input type="number" inputmode="decimal" min="1.01" step="0.01" value="${Number(autoVal).toFixed(2)}" aria-label="Auto cash-out multiplier"><span class="suffix">×</span>
          <button type="button" class="mini" data-a="1.5">1.5</button><button type="button" class="mini" data-a="2">2</button><button type="button" class="mini" data-a="10">10</button></div>
      </div>`);
    const autoToggle = autoField.querySelector('input[type=checkbox]');
    const autoInput = autoField.querySelector('input[type=number]');
    const chance = h(`<div class="readout"><div><span>Win chance</span><strong data-ch>49.50%</strong></div><div><span>Profit at target</span><strong data-pt>+10.00</strong></div></div>`);
    const playBtn = h(`<button type="button" class="btn btn-primary btn-play"><span>Place bet</span></button>`);
    const myBet = h(`<div class="my-bet" hidden></div>`);
    controls.append(bet.el, autoField, chance, playBtn, myBet, h(`<p class="hint"><kbd>Space</kbd> bet · cash out</p>`));

    const readAuto = () => {
      autoVal = Math.max(1.01, round2(Number(autoInput.value) || 2));
      autoInput.value = autoVal.toFixed(2);
      storage.set('cc:crash:auto', autoVal);
      return autoOn ? autoVal : null;
    };
    const renderChance = () => {
      const target = autoOn ? autoVal : 2;
      chance.querySelector('[data-ch]').textContent = `${Math.min(99, (99 / target)).toFixed(2)}%`;
      chance.querySelector('[data-pt]').textContent = signed(round2(bet.value * target) - bet.value);
      chance.querySelector('[data-pt]').className = 'win-text';
      autoField.querySelector('.input-group').style.opacity = autoOn ? '1' : '.5';
    };
    autoToggle.addEventListener('change', () => {
      autoOn = autoToggle.checked;
      storage.set('cc:crash:autoOn', autoOn);
      readAuto();
      renderChance();
    });
    autoInput.addEventListener('change', () => {
      readAuto();
      renderChance();
    });
    autoField.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || b.disabled) return;
      sfx.click();
      autoInput.value = b.dataset.a;
      autoOn = true;
      autoToggle.checked = true;
      storage.set('cc:crash:autoOn', true);
      readAuto();
      renderChance();
    });
    bet.el.querySelector('input').addEventListener('change', renderChance);
    bet.el.addEventListener('click', () => setTimeout(renderChance));
    renderChance();

    function act() {
      const b = E.bet;
      if (E.phase === 'running' && b && b.state === 'live') {
        cashOut().then((ok) => !ok && E.bet === b && b.state === 'done' && !b.cashed && sfx.lose());
        return;
      }
      if (b && (b.state === 'sending' || b.state === 'cashing' || b.state === 'cancelling')) return;
      if (E.phase === 'betting' && !b) {
        readAuto();
        placeNow(bet.value, autoOn ? autoVal : null);
        renderControls();
        return;
      }
      if (E.phase === 'betting' && b && b.state === 'live') {
        // Cancel before take-off: refund.
        sfx.click();
        cancelBet();
        renderControls();
        return;
      }
      // Running/crashed without a live bet: queue for next round.
      if (E.queued) E.queued = null;
      else {
        if (!needAccount()) return;
        if (!store.canAfford(bet.value) || !(bet.value > 0)) {
          bet.error();
          if (bet.value > 0) betError();
          else toast('Enter a bet amount above zero.', { type: 'loss' });
          return;
        }
        readAuto();
        E.queued = { amount: bet.value, auto: autoOn ? autoVal : null };
        sfx.bet();
      }
      renderControls();
    }
    playBtn.addEventListener('click', act);

    function renderControls() {
      const p = E.phase;
      const b = E.bet;
      const live = b && !b.cashed && b.state !== 'done';
      let cls = 'btn btn-primary btn-play';
      let html = '<span>Place bet</span>';
      if (b && b.state === 'sending') {
        cls = 'btn btn-outline btn-play';
        html = `<span>Placing bet…</span><span class="sub">${fmt(b.amount)}</span>`;
      } else if (b && b.state === 'cashing') {
        cls = 'btn btn-play is-cash';
        html = '<span>Cashing out…</span>';
      } else if (b && b.state === 'cancelling') {
        cls = 'btn btn-outline btn-play';
        html = '<span>Cancelling…</span>';
      } else if (p === 'running' && live) {
        cls = 'btn btn-play is-cash';
        html = `<span>Cash out</span><span class="sub" data-live>${fmt(b.amount)}</span>`;
      } else if (p === 'betting' && live) {
        cls = 'btn btn-outline btn-play';
        html = `<span>Cancel bet</span><span class="sub">${fmt(b.amount)}</span>`;
      } else if (p !== 'betting') {
        cls = E.queued ? 'btn btn-outline btn-play' : 'btn btn-primary btn-play';
        html = E.queued ? `<span>Cancel next bet</span><span class="sub">${fmt(E.queued.amount)}</span>` : '<span>Bet next round</span>';
      } else if (b && b.cashed) {
        cls = 'btn btn-outline btn-play';
        html = '<span>Waiting…</span>';
      }
      playBtn.className = cls;
      playBtn.innerHTML = html;
      bet.disable(!!live || !!E.queued);
      // The server holds the auto target once a bet is placed.
      autoField.querySelectorAll('input, button').forEach((x) => (x.disabled = !!live));
      // status line
      const liveBet = E.bet && !E.bet.cashed && E.bet.state !== 'done' ? E.bet : null;
      if (E.bet?.cashed) {
        myBet.hidden = false;
        myBet.className = 'my-bet win';
        myBet.innerHTML = `<span>Cashed out @ ${fmtMult(E.bet.cashed)}</span><strong>${signed(round2(E.bet.amount * E.bet.cashed) - E.bet.amount)}</strong>`;
      } else if (liveBet) {
        myBet.hidden = false;
        myBet.className = 'my-bet';
        myBet.innerHTML = `<span>In play${liveBet.auto ? ` · auto @ ${fmtMult(liveBet.auto)}` : ''}</span><strong>${fmt(liveBet.amount)}</strong>`;
      } else if (p === 'crashed' && lastLoss) {
        myBet.hidden = false;
        myBet.className = 'my-bet loss';
        myBet.innerHTML = `<span>Crashed before cash-out</span><strong>−${fmt(lastLoss)}</strong>`;
      } else if (E.queued) {
        myBet.hidden = false;
        myBet.className = 'my-bet';
        myBet.innerHTML = `<span>Queued for next round</span><strong>${fmt(E.queued.amount)}</strong>`;
      } else myBet.hidden = true;
    }

    function renderHist() {
      histEl.innerHTML = E.history
        .slice(0, 14)
        .map((m) => `<span class="${m >= 10 ? 'hi' : m >= 2 ? 'mid' : 'lo'}">${fmtMult(m)}</span>`)
        .join('');
    }
    renderHist();

    // ---------------------------------------------------------- canvas
    let W = 0;
    let H = 0;
    let dpr = 1;
    const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7 }));
    const smoke = [];
    const sparks = [];
    let xMax = 10000;
    let yMax = 2;
    let lastTip = null;

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = viewEl.clientWidth;
      H = viewEl.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(viewEl);

    const pad = () => ({ l: 46, r: 22, t: 26, b: 30 });
    const niceStep = (range, target) => {
      const raw = range / target;
      const p = Math.pow(10, Math.floor(Math.log10(raw)));
      const n = raw / p;
      return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
    };

    function drawRocket(x, y, ang, t) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      const s = clamp(W / 420, 0.8, 1.25);
      ctx.scale(s, s);
      // flame
      const f = 1 + Math.sin(t / 30) * 0.15 + Math.random() * 0.15;
      const fg = ctx.createLinearGradient(-34 * f, 0, -10, 0);
      fg.addColorStop(0, 'rgba(255,90,60,0)');
      fg.addColorStop(0.5, 'rgba(255,150,70,0.9)');
      fg.addColorStop(1, 'rgba(255,240,200,1)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-10, -6);
      ctx.quadraticCurveTo(-34 * f, 0, -10, 6);
      ctx.closePath();
      ctx.fill();
      // fins
      ctx.fillStyle = '#5ab4ff';
      ctx.beginPath();
      ctx.moveTo(-6, -6);
      ctx.lineTo(-16, -15);
      ctx.lineTo(-12, -5);
      ctx.closePath();
      ctx.moveTo(-6, 6);
      ctx.lineTo(-16, 15);
      ctx.lineTo(-12, 5);
      ctx.closePath();
      ctx.fill();
      // body
      const bg = ctx.createLinearGradient(0, -8, 0, 8);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(0.45, '#c9ced8');
      bg.addColorStop(1, '#6c727e');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.bezierCurveTo(12, -9, -4, -8, -11, -6.5);
      ctx.lineTo(-11, 6.5);
      ctx.bezierCurveTo(-4, 8, 12, 9, 18, 0);
      ctx.fill();
      // window
      ctx.fillStyle = '#2f8bff';
      ctx.beginPath();
      ctx.arc(4, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(3, -1, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function frameDraw(now) {
      const P = pad();
      const gw = W - P.l - P.r;
      const gh = H - P.t - P.b;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const phase = E.phase;
      const el = now - E.start;
      let tMs = 0;
      let m = 1;
      if (phase === 'running') {
        tMs = el;
        m = Math.min(E.crashAt, Math.exp(K * el));
      } else if (phase === 'crashed') {
        m = E.crashAt;
        tMs = timeFor(Math.max(1.0001, E.crashAt));
      }
      // smooth axes
      const txMax = Math.max(10000, tMs * 1.18);
      const tyMax = Math.max(2, 1 + (m - 1) * 1.25);
      xMax += (txMax - xMax) * 0.12;
      yMax += (tyMax - yMax) * 0.12;
      if (phase === 'betting') {
        xMax += (10000 - xMax) * 0.2;
        yMax += (2 - yMax) * 0.2;
      }

      // stars (parallax speeds up with the multiplier)
      const speed = phase === 'running' ? 0.00004 + Math.log(m) * 0.00012 : 0.00001;
      ctx.fillStyle = '#ffffff';
      for (const st of stars) {
        if (phase === 'running') {
          st.x -= speed * st.z * 16;
          st.y += speed * st.z * 9;
          if (st.x < 0) st.x += 1;
          if (st.y > 1) st.y -= 1;
        }
        ctx.globalAlpha = 0.15 + st.z * 0.35;
        ctx.fillRect(st.x * W, st.y * H, st.z * 1.6, st.z * 1.6);
      }
      ctx.globalAlpha = 1;

      // grid
      ctx.font = '700 11px Bricolage, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      const yStep = niceStep(yMax - 1, 4);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let v = 1; v <= yMax + 1e-9; v += yStep) {
        const y = P.t + gh - ((v - 1) / (yMax - 1)) * gh;
        ctx.beginPath();
        ctx.moveTo(P.l, y);
        ctx.lineTo(W - P.r, y);
        ctx.stroke();
        ctx.fillText(fmtMult(v).replace('.00', ''), P.l - 8, y);
      }
      const xStep = niceStep(xMax / 1000, 5);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let s = 0; s <= xMax / 1000 + 1e-9; s += xStep) {
        const x = P.l + ((s * 1000) / xMax) * gw;
        ctx.fillText(`${Math.round(s)}s`, x, H - P.b + 9);
      }

      const X = (ms) => P.l + (ms / xMax) * gw;
      const Y = (mm) => P.t + gh - ((mm - 1) / (yMax - 1)) * gh;

      if (phase === 'running' || phase === 'crashed') {
        const crashed = phase === 'crashed';
        const N = 80;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const tt = (tMs * i) / N;
          const x = X(tt);
          const y = Y(Math.exp(K * tt));
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        const tipX = X(tMs);
        const tipY = Y(m);
        // area
        ctx.save();
        ctx.lineTo(tipX, P.t + gh);
        ctx.lineTo(P.l, P.t + gh);
        ctx.closePath();
        const ag = ctx.createLinearGradient(0, tipY, 0, P.t + gh);
        ag.addColorStop(0, crashed ? 'rgba(255,77,109,0.28)' : 'rgba(77,255,195,0.24)');
        ag.addColorStop(1, 'rgba(77,255,195,0)');
        ctx.fillStyle = ag;
        ctx.fill();
        ctx.restore();
        // line
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const tt = (tMs * i) / N;
          const x = X(tt);
          const y = Y(Math.exp(K * tt));
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        const lg = ctx.createLinearGradient(P.l, 0, tipX, 0);
        if (crashed) {
          lg.addColorStop(0, '#ff8a95');
          lg.addColorStop(1, '#ff3b55');
        } else {
          lg.addColorStop(0, '#4dd2ff');
          lg.addColorStop(0.55, '#4dffc3');
          lg.addColorStop(1, '#ffc94d');
        }
        ctx.strokeStyle = lg;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = crashed ? 'rgba(255,77,109,0.85)' : 'rgba(77,255,195,0.9)';
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;

        const back = Math.max(0, tMs - 400);
        const ang = Math.atan2(tipY - Y(Math.exp(K * back)), tipX - X(back));
        lastTip = { x: tipX, y: tipY, ang };
        if (!crashed) {
          // exhaust
          if (!reducedMotion() && Math.random() < 0.9) smoke.push({ x: tipX - Math.cos(ang) * 14, y: tipY - Math.sin(ang) * 14, vx: -Math.cos(ang) * 0.8 + (Math.random() - 0.5) * 0.6, vy: -Math.sin(ang) * 0.8 + (Math.random() - 0.5) * 0.6, life: 40, r: 2 + Math.random() * 3 });
          drawRocket(tipX, tipY, ang, now);
        }
      } else {
        // parked rocket at the origin
        drawRocket(P.l + 14, P.t + gh - 6, -Math.PI / 4, now);
      }

      // particles
      for (let i = smoke.length - 1; i >= 0; i--) {
        const p = smoke[i];
        p.x += p.vx;
        p.y += p.vy;
        p.r *= 1.03;
        p.life--;
        if (p.life <= 0) {
          smoke.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `rgba(200,210,255,${(p.life / 40) * 0.18})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy = p.vy * 0.96 + 0.08;
        p.life--;
        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = p.c;
        ctx.globalAlpha = p.life / p.max;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // centre readout
      if (phase === 'running') {
        multEl.textContent = fmtMult(Math.min(at(el), E.crashAt));
        multEl.className = 'crash-mult tnum';
        multEl.style.setProperty('--neon', m >= 10 ? '#ffc94d' : m >= 2 ? '#4dffc3' : '#4dd2ff');
        subEl.className = 'crash-sub';
        const b = E.bet;
        const inAir = b && !b.cashed && b.state !== 'done';
        subEl.textContent = b?.state === 'cashing' ? 'Cashing out…' : inAir ? `Cash out ${fmt(round2(b.amount * at(el)))}` : b?.cashed ? `Cashed @ ${fmtMult(b.cashed)}` : 'In flight';
        if (b?.cashed) subEl.className = 'crash-sub win';
        barEl.hidden = true;
        const live = playBtn.querySelector('[data-live]');
        if (live && inAir) live.textContent = fmt(round2(b.amount * at(el)));
        hum.set(m);
      } else if (phase === 'betting') {
        const left = Math.max(0, BETTING_MS - el);
        multEl.textContent = `${(left / 1000).toFixed(1)}s`;
        multEl.className = 'crash-mult tnum';
        multEl.style.setProperty('--neon', '#ffc94d');
        subEl.className = 'crash-sub';
        subEl.textContent = E.bet ? (E.bet.state === 'sending' ? 'Placing your bet…' : 'You’re in. Get ready…') : 'Place your bets';
        barEl.hidden = false;
        barFill.style.transform = `scaleX(${left / BETTING_MS})`;
      }
    }

    let raf = 0;
    let lastCount = -1;
    const loopFn = (now) => {
      if (destroyed) return;
      raf = requestAnimationFrame(loopFn);
      if (E.phase === 'betting') {
        const left = Math.ceil((BETTING_MS - (now - E.start)) / 1000);
        if (left !== lastCount && left <= 3 && left > 0) sfx.countdown();
        lastCount = left;
      }
      frameDraw(now);
    };
    raf = requestAnimationFrame(loopFn);

    // ---------------------------------------------------------- engine events
    const onEngine = (type, data) => {
      if (destroyed) return;
      if (type === 'phase') {
        if (E.phase === 'running') {
          lastLoss = 0;
          hum.start();
          multEl.classList.remove('is-crashed', 'is-cashed');
        }
        if (E.phase === 'betting') {
          lastLoss = 0;
        }
        renderControls();
      }
      if (type === 'crash') {
        hum.stop();
        sfx.boom();
        multEl.textContent = fmtMult(E.crashAt);
        multEl.className = 'crash-mult tnum is-crashed';
        multEl.style.removeProperty('--neon');
        const lostBet = E.bet && !E.bet.cashed;
        subEl.textContent = lostBet ? `Crashed! −${fmt(E.bet.amount)}` : 'Crashed';
        subEl.className = 'crash-sub loss';
        if (lostBet) {
          lastLoss = E.bet.amount;
          haptic([40, 30, 60]);
        }
        shake(stage, true);
        if (lastTip) {
          for (let i = 0; i < 70; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 2 + Math.random() * 7;
            const c = ['#ff5468', '#ff9a6b', '#ffd08a', '#ffffff'][i % 4];
            sparks.push({ x: lastTip.x, y: lastTip.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 40 + Math.random() * 30, max: 70, c });
          }
        }
        renderHist();
        renderControls();
      }
      if (type === 'cashout') {
        sfx.cashout();
        multEl.classList.add('is-cashed');
        celebrate(multEl, data.m, PALETTES.crash);
        renderControls();
        setTimeout(() => !destroyed && multEl.classList.remove('is-cashed'), 900);
      }
      if (type === 'bet') renderControls();
    };
    E.subs.add(onEngine);
    renderControls();
    if (E.phase === 'running') hum.start();

    const onKey = (e) => {
      if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        act();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      hum.stop();
      E.subs.delete(onEngine);
      E.viewers = Math.max(0, E.viewers - 1);
      // Bets that haven't taken off yet are refunded; a bet already flying keeps the
      // engine running in the background so it can still be cashed out or auto-cash.
      E.queued = null;
      const b = E.bet;
      if (E.phase === 'betting' && b && (b.state === 'live' || b.state === 'sending')) cancelBet();
      if (E.phase === 'betting' && !b) stopEngine();
      if (E.phase === 'running' && b && !b.cashed && b.state !== 'done') toast('Your Crash bet is still flying. Head back to cash out.', { iconName: 'rocket', timeout: 4500 });
      document.removeEventListener('keydown', onKey);
      frame.destroy();
    };
  },
};
