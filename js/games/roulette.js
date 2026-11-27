// Roulette: single-zero European wheel (RTP 97.3%).
// Bets: straight 35:1, dozens & columns 2:1, red/black/odd/even/low/high 1:1.
// The winning pocket is drawn first; the ball's flight is then solved so it
// rolls, drops, rattles and comes to rest in exactly that pocket.

import { h, fmt, round2, storage, reducedMotion, sleep, clamp, esc } from '../util.js';
import { icon } from '../icons.js';
import { store, BetError } from '../store.js';
import { randInt } from '../rng.js';
import { sfx, roll, haptic } from '../sound.js';
import { burstAt, coinRain, floatFrom, PALETTES } from '../fx.js';
import { gameFrame, toast, CHIP_VALUES, chipClass, chipLabel } from '../ui.js';

export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
const STEP = 360 / 37;

const OUTSIDE = {
  low: { label: '1–18', pays: 2, test: (n) => n >= 1 && n <= 18 },
  even: { label: 'Even', pays: 2, test: (n) => n > 0 && n % 2 === 0 },
  red: { label: 'Red', pays: 2, test: (n) => REDS.has(n) },
  black: { label: 'Black', pays: 2, test: (n) => n > 0 && !REDS.has(n) },
  odd: { label: 'Odd', pays: 2, test: (n) => n % 2 === 1 },
  high: { label: '19–36', pays: 2, test: (n) => n >= 19 },
  'dozen:1': { label: '1st 12', pays: 3, test: (n) => n >= 1 && n <= 12 },
  'dozen:2': { label: '2nd 12', pays: 3, test: (n) => n >= 13 && n <= 24 },
  'dozen:3': { label: '3rd 12', pays: 3, test: (n) => n >= 25 },
  'col:1': { label: '2 to 1', pays: 3, test: (n) => n > 0 && n % 3 === 1 },
  'col:2': { label: '2 to 1', pays: 3, test: (n) => n > 0 && n % 3 === 2 },
  'col:3': { label: '2 to 1', pays: 3, test: (n) => n > 0 && n % 3 === 0 },
};
export function payoutFor(key, n) {
  if (key.startsWith('n:')) return Number(key.slice(2)) === n ? 36 : 0;
  const o = OUTSIDE[key];
  return o && o.test(n) ? o.pays : 0;
}
const covers = (key) => (key.startsWith('n:') ? [Number(key.slice(2))] : Array.from({ length: 37 }, (_, n) => n).filter((n) => OUTSIDE[key].test(n)));

const RULES = `
  <ol class="rules">
    <li>Pick a chip from the rack, then tap the table to place it. Tap again to stack more.</li>
    <li>Bet on single numbers (pays <strong>35 to 1</strong>), dozens or columns (<strong>2 to 1</strong>), or red/black, odd/even, 1–18/19–36 (<strong>even money</strong>).</li>
    <li>Press <strong>Spin</strong>. Zero is green: it pays straight-up bets only.</li>
    <li>Single-zero European wheel, return to player 97.3%.</li>
  </ol>
  <p class="dim" style="margin-top:14px;font-size:14px">Shortcuts: <kbd>Space</kbd> spin · <kbd>Z</kbd> undo · <kbd>X</kbd> clear.</p>`;

// ------------------------------------------------------------------ wheel SVG
function wheelSVG() {
  const sectors = [];
  const pockets = [];
  const nums = [];
  const frets = [];
  const arc = (r0, r1, a0, a1) => {
    const p = (r, a) => `${(r * Math.cos((a * Math.PI) / 180)).toFixed(2)} ${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`;
    return `M${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
  };
  WHEEL.forEach((n, i) => {
    const c = -90 + i * STEP;
    const a0 = c - STEP / 2;
    const a1 = c + STEP / 2;
    const col = colorOf(n);
    sectors.push(`<path d="${arc(128, 160, a0, a1)}" class="rs ${col}"/>`);
    pockets.push(`<path d="${arc(98, 128, a0, a1)}" class="rp ${col}" data-p="${i}"/>`);
    nums.push(`<text transform="rotate(${c + 90}) translate(0 -142)" class="rn">${n}</text>`);
    const fa = (a0 * Math.PI) / 180;
    frets.push(`<line x1="${(98 * Math.cos(fa)).toFixed(2)}" y1="${(98 * Math.sin(fa)).toFixed(2)}" x2="${(160 * Math.cos(fa)).toFixed(2)}" y2="${(160 * Math.sin(fa)).toFixed(2)}"/>`);
  });
  const diamonds = Array.from({ length: 8 }, (_, i) => `<path transform="rotate(${i * 45 + 22.5}) translate(0 -174)" d="M0 -6 4 0 0 6 -4 0Z" class="rd"/>`).join('');
  return `
  <svg class="rl-wheel" viewBox="-200 -200 400 400" aria-hidden="true">
    <defs>
      <radialGradient id="rlWood" r="1"><stop offset=".78" stop-color="#2a0c05"/><stop offset=".86" stop-color="#6b2a12"/><stop offset=".93" stop-color="#3a1208"/><stop offset="1" stop-color="#1a0603"/></radialGradient>
      <radialGradient id="rlTrack" r="1"><stop offset=".8" stop-color="#140604"/><stop offset=".86" stop-color="#4a1a0b"/><stop offset=".93" stop-color="#2a0e06"/></radialGradient>
      <radialGradient id="rlCone" r="1"><stop offset="0" stop-color="#8a4a1f"/><stop offset=".55" stop-color="#4a1a0b"/><stop offset="1" stop-color="#2a0c05"/></radialGradient>
      <linearGradient id="rlGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c1"/><stop offset=".4" stop-color="#d1921f"/><stop offset=".7" stop-color="#ffe39a"/><stop offset="1" stop-color="#9c6510"/></linearGradient>
      <radialGradient id="rlBall" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#e8e2d4"/><stop offset="1" stop-color="#9a9285"/></radialGradient>
      <radialGradient id="rlShade" r="1"><stop offset=".6" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,.55)"/></radialGradient>
    </defs>
    <circle r="199" fill="url(#rlWood)"/>
    <circle r="190" fill="none" stroke="url(#rlGold)" stroke-width="3"/>
    <circle r="186" fill="url(#rlTrack)"/>
    <circle r="162" fill="none" stroke="rgba(255,220,150,.18)" stroke-width="1"/>
    ${diamonds}
    <g class="rl-rotor">
      ${sectors.join('')}
      ${pockets.join('')}
      <path class="rl-hit" d=""/>
      <g class="rf">${frets.join('')}</g>
      <circle r="160" fill="none" stroke="url(#rlGold)" stroke-width="2.5"/>
      <circle r="128" fill="none" stroke="url(#rlGold)" stroke-width="1.5"/>
      <circle r="98" fill="none" stroke="url(#rlGold)" stroke-width="2.5"/>
      ${nums.join('')}
      <circle r="96" fill="url(#rlCone)"/>
      <circle r="96" fill="url(#rlShade)"/>
      <g class="rl-turret">
        <circle r="30" fill="url(#rlGold)"/>
        <rect x="-62" y="-5" width="124" height="10" rx="5" fill="url(#rlGold)"/>
        <rect x="-5" y="-62" width="10" height="124" rx="5" fill="url(#rlGold)"/>
        <circle cx="-62" r="10" fill="url(#rlGold)"/><circle cx="62" r="10" fill="url(#rlGold)"/><circle cy="-62" r="10" fill="url(#rlGold)"/><circle cy="62" r="10" fill="url(#rlGold)"/>
        <circle r="16" fill="#2a0c05" opacity=".35"/><circle r="11" fill="url(#rlGold)"/>
      </g>
    </g>
    <circle r="199" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="2"/>
    <g class="rl-ballg"><ellipse class="rl-ballshadow" rx="7" ry="4" fill="rgba(0,0,0,.45)"/><circle class="rl-ball" r="7" fill="url(#rlBall)"/></g>
  </svg>`;
}

// ------------------------------------------------------------------ board
function boardHTML() {
  const cells = [];
  cells.push(`<button type="button" class="rl-cell green zero" data-bet="n:0" style="--hr:1/4;--hc:1;--vr:1;--vc:3/6"><span>0</span></button>`);
  for (let n = 1; n <= 36; n++) {
    const hc = Math.ceil(n / 3) + 1;
    const hr = 3 - ((n - 1) % 3);
    const vr = Math.ceil(n / 3) + 1;
    const vc = ((n - 1) % 3) + 3;
    cells.push(`<button type="button" class="rl-cell ${colorOf(n)}" data-bet="n:${n}" style="--hr:${hr};--hc:${hc};--vr:${vr};--vc:${vc}"><span>${n}</span></button>`);
  }
  [
    ['col:3', 1, 14, 14, 5],
    ['col:2', 2, 14, 14, 4],
    ['col:1', 3, 14, 14, 3],
  ].forEach(([k, hr, hc, vr, vc]) => cells.push(`<button type="button" class="rl-cell out col" data-bet="${k}" style="--hr:${hr};--hc:${hc};--vr:${vr};--vc:${vc}"><span>2:1</span></button>`));
  [
    ['dozen:1', '2/6', '2/6'],
    ['dozen:2', '6/10', '6/10'],
    ['dozen:3', '10/14', '10/14'],
  ].forEach(([k, hc, vr]) => cells.push(`<button type="button" class="rl-cell out dozen" data-bet="${k}" style="--hr:4;--hc:${hc};--vr:${vr};--vc:2"><span>${OUTSIDE[k].label}</span></button>`));
  [
    ['low', '2/4', '2/4'],
    ['even', '4/6', '4/6'],
    ['red', '6/8', '6/8'],
    ['black', '8/10', '8/10'],
    ['odd', '10/12', '10/12'],
    ['high', '12/14', '12/14'],
  ].forEach(([k, hc, vr]) =>
    cells.push(
      `<button type="button" class="rl-cell out even-money ${k === 'red' ? 'is-red' : k === 'black' ? 'is-black' : ''}" data-bet="${k}" style="--hr:5;--hc:${hc};--vr:${vr};--vc:1"><span>${k === 'red' || k === 'black' ? '<i class="dia"></i>' : OUTSIDE[k].label}</span></button>`,
    ),
  );
  return `<div class="rl-board" role="group" aria-label="Betting table">${cells.join('')}</div>`;
}

export default {
  title: 'Roulette',
  mount(view) {
    const frame = gameFrame(view, { game: 'roulette', title: 'Roulette', kicker: 'Single zero · European', tags: ['97.3% RTP', '35 to 1'], rules: RULES });
    const { stage, controls } = frame;
    let destroyed = false;
    let spinning = false;
    let chip = storage.get('cc:rl:chip', 5);
    if (!CHIP_VALUES.includes(chip)) chip = 5;
    let bets = new Map();
    let undo = [];
    let lastBets = storage.get('cc:rl:last', null);
    const hist = storage.get('cc:rl:hist', []).slice(0, 18);
    let quick = storage.get('cc:rl:quick', false);
    let open = null;
    let rotor = randInt(360);
    let raf = 0;

    // ---------------------------------------------------------- stage
    stage.classList.add('rl-stage');
    stage.innerHTML = `
      <div class="felt rl-felt">
        <div class="rl-top">
          <div class="rl-wheel-wrap">${wheelSVG()}<div class="rl-result" aria-live="polite"></div></div>
          <div class="rl-side">
            <div class="rl-hist-title kicker">Last spins</div>
            <div class="rl-hist" data-hist></div>
          </div>
        </div>
        ${boardHTML()}
        <div class="rl-boardinfo"><span>Total bet <b class="tnum" data-total>0.00</b></span><span class="dim" data-hint>Tap the table to place chips</span></div>
      </div>`;
    const wheel = stage.querySelector('.rl-wheel');
    const rotorEl = wheel.querySelector('.rl-rotor');
    const hitEl = wheel.querySelector('.rl-hit');
    const ballG = wheel.querySelector('.rl-ballg');
    const resultEl = stage.querySelector('.rl-result');
    const board = stage.querySelector('.rl-board');
    const histEl = stage.querySelector('[data-hist]');
    const totalEl = stage.querySelector('[data-total]');
    const hintEl = stage.querySelector('[data-hint]');

    const setRotor = (deg) => rotorEl.setAttribute('transform', `rotate(${deg.toFixed(3)})`);
    const setBall = (deg, r) => {
      const a = (deg * Math.PI) / 180;
      ballG.setAttribute('transform', `translate(${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)})`);
    };
    setRotor(rotor);
    ballG.style.opacity = '0';

    // ---------------------------------------------------------- controls
    controls.innerHTML = '';
    const rack = h(`
      <div class="field">
        <div class="field-label"><span>Chip value</span><span class="dim tnum" data-chipv></span></div>
        <div class="rack">${CHIP_VALUES.map((v) => `<button type="button" class="rack-chip ${chipClass(v)}" data-chip="${v}" aria-pressed="${v === chip}" aria-label="Chip ${v}"><span>${chipLabel(v)}</span></button>`).join('')}</div>
      </div>`);
    const tools = h(`
      <div class="rl-tools">
        <button type="button" class="btn btn-outline btn-sm" data-t="undo">${icon('undo')}<span>Undo</span></button>
        <button type="button" class="btn btn-outline btn-sm" data-t="clear">${icon('trash')}<span>Clear</span></button>
        <button type="button" class="btn btn-outline btn-sm" data-t="double">${icon('x2')}<span>Double</span></button>
        <button type="button" class="btn btn-outline btn-sm" data-t="rebet">${icon('repeat')}<span>Rebet</span></button>
      </div>`);
    const quickRow = h(`<label class="toggle-row"><span style="display:inline-flex;gap:8px;align-items:center">${icon('bolt').replace('<svg', '<svg width="18" height="18"')}Quick spin</span><span class="switch"><input type="checkbox" ${quick ? 'checked' : ''} aria-label="Quick spin"><span></span></span></label>`);
    const playBtn = h(`<button type="button" class="btn btn-primary btn-play">${icon('wheel')}<span>Spin</span></button>`);
    controls.append(rack, tools, quickRow, playBtn, h(`<p class="hint"><kbd>Space</kbd> spin · <kbd>Z</kbd> undo · <kbd>X</kbd> clear</p>`));
    quickRow.querySelector('input').addEventListener('change', (e) => {
      quick = e.target.checked;
      storage.set('cc:rl:quick', quick);
    });

    const total = () => round2([...bets.values()].reduce((a, b) => a + b, 0));
    function renderChipSel() {
      rack.querySelectorAll('[data-chip]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.chip) === chip)));
      rack.querySelector('[data-chipv]').textContent = `${fmt(chip)} per tap`;
    }
    function renderBets() {
      board.querySelectorAll('.rl-cell').forEach((cell) => {
        const amt = bets.get(cell.dataset.bet) || 0;
        let c = cell.querySelector('.bchip');
        if (amt > 0) {
          if (!c) {
            c = document.createElement('span');
            cell.append(c);
          }
          const top = [...CHIP_VALUES].reverse().find((v) => amt >= v) || 1;
          c.className = `bchip ${chipClass(top)}`;
          c.textContent = amt >= 1000 ? `${+(amt / 1000).toFixed(1)}K` : amt % 1 ? amt.toFixed(1) : String(amt);
        } else c?.remove();
      });
      const t = total();
      totalEl.textContent = fmt(t);
      hintEl.textContent = t ? `${bets.size} bet${bets.size > 1 ? 's' : ''} on the table` : 'Tap the table to place chips';
      playBtn.disabled = spinning || t <= 0;
      tools.querySelector('[data-t="undo"]').disabled = spinning || !undo.length;
      tools.querySelector('[data-t="clear"]').disabled = spinning || !bets.size;
      tools.querySelector('[data-t="double"]').disabled = spinning || !bets.size;
      tools.querySelector('[data-t="rebet"]').disabled = spinning || !lastBets || !!bets.size;
    }
    function renderHist() {
      histEl.innerHTML = hist.map((n, i) => `<span class="rh ${colorOf(n)}${i === 0 ? ' latest' : ''}">${n}</span>`).join('');
    }
    renderChipSel();
    renderBets();
    renderHist();

    rack.addEventListener('click', (e) => {
      const b = e.target.closest('[data-chip]');
      if (!b) return;
      chip = Number(b.dataset.chip);
      storage.set('cc:rl:chip', chip);
      sfx.chip();
      renderChipSel();
    });

    function place(key, cell) {
      if (spinning) return;
      const after = round2(total() + chip);
      if (after > store.balance + 1e-9) {
        toast(store.balance < 1 && store.canRefill() ? 'Out of chips. Tap your stack to refill.' : 'Not enough chips for that bet.', { type: 'loss' });
        cell.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 250 });
        return;
      }
      bets.set(key, round2((bets.get(key) || 0) + chip));
      undo.push([key, chip]);
      sfx.chip();
      // chip flies from the rack to the table
      const from = rack.querySelector(`[data-chip="${chip}"]`).getBoundingClientRect();
      const to = cell.getBoundingClientRect();
      const fly = document.createElement('span');
      fly.className = `mchip fly ${chipClass(chip)}`;
      fly.style.left = `${from.left + from.width / 2 - 13}px`;
      fly.style.top = `${from.top + from.height / 2 - 13}px`;
      document.body.append(fly);
      fly.animate(
        [
          { transform: 'translate(0,0) scale(1.2)' },
          { transform: `translate(${to.left + to.width / 2 - from.left - from.width / 2}px, ${to.top + to.height / 2 - from.top - from.height / 2}px) scale(.9)` },
        ],
        { duration: reducedMotion() ? 1 : 330, easing: 'cubic-bezier(.3,.7,.3,1)' },
      ).onfinish = () => {
        fly.remove();
        renderBets();
        const c = cell.querySelector('.bchip');
        c?.animate([{ transform: 'translate(-50%, -50%) scale(1.35)' }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      };
    }

    board.addEventListener('click', (e) => {
      const cell = e.target.closest('.rl-cell');
      if (cell) place(cell.dataset.bet, cell);
    });
    // Hovering an outside bet lights up the numbers it covers.
    board.addEventListener('pointerover', (e) => {
      const cell = e.target.closest('.rl-cell');
      board.querySelectorAll('.cover').forEach((x) => x.classList.remove('cover'));
      if (!cell || e.pointerType === 'touch' || spinning) return;
      covers(cell.dataset.bet).forEach((n) => board.querySelector(`[data-bet="n:${n}"]`)?.classList.add('cover'));
    });
    board.addEventListener('pointerleave', () => board.querySelectorAll('.cover').forEach((x) => x.classList.remove('cover')));

    tools.addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]')?.dataset.t;
      if (!t || spinning) return;
      sfx.click();
      if (t === 'undo' && undo.length) {
        const [k, v] = undo.pop();
        const left = round2((bets.get(k) || 0) - v);
        left > 0 ? bets.set(k, left) : bets.delete(k);
      }
      if (t === 'clear') {
        bets.clear();
        undo = [];
      }
      if (t === 'double') {
        if (total() * 2 > store.balance + 1e-9) return toast('Not enough chips to double.', { type: 'loss' });
        for (const [k, v] of bets) {
          bets.set(k, round2(v * 2));
          undo.push([k, v]);
        }
        sfx.chip();
      }
      if (t === 'rebet' && lastBets) {
        const sum = round2(lastBets.reduce((a, [, v]) => a + v, 0));
        if (sum > store.balance + 1e-9) return toast('Not enough chips to repeat that bet.', { type: 'loss' });
        bets = new Map(lastBets);
        undo = lastBets.map(([k, v]) => [k, v]);
        sfx.chip();
      }
      renderBets();
    });

    // ---------------------------------------------------------- spin
    function clearResult() {
      board.querySelectorAll('.rl-cell.win, .rl-cell.lose').forEach((c) => c.classList.remove('win', 'lose'));
      board.querySelectorAll('.pay').forEach((p) => p.remove());
      hitEl.setAttribute('d', '');
      hitEl.classList.remove('on');
      resultEl.className = 'rl-result';
      resultEl.innerHTML = '';
    }

    async function spin() {
      if (spinning || destroyed) return;
      const amount = total();
      if (!(amount > 0)) {
        toast('Place a chip on the table first.', { iconName: 'info' });
        return;
      }
      const k = randInt(37);
      const n = WHEEL[k];
      const payout = round2([...bets].reduce((a, [key, v]) => a + v * payoutFor(key, n), 0));
      let t;
      try {
        t = store.placeBet('roulette', amount, { payout });
      } catch (e) {
        if (e instanceof BetError) return toast(e.message, { type: 'loss' });
        throw e;
      }
      open = t;
      spinning = true;
      lastBets = [...bets];
      storage.set('cc:rl:last', lastBets);
      clearResult();
      renderBets();
      sfx.bet();
      await animate(k);
      if (destroyed) return;
      // result
      const col = colorOf(n);
      hist.unshift(n);
      hist.length = Math.min(hist.length, 18);
      storage.set('cc:rl:hist', hist);
      renderHist();
      resultEl.className = `rl-result on ${col}`;
      resultEl.innerHTML = `<b>${n}</b><small>${col}</small>`;
      const c = -90 + k * STEP;
      const p = (r, a) => `${(r * Math.cos((a * Math.PI) / 180)).toFixed(2)} ${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`;
      hitEl.setAttribute('d', `M${p(160, c - STEP / 2)} A160 160 0 0 1 ${p(160, c + STEP / 2)} L${p(98, c + STEP / 2)} A98 98 0 0 0 ${p(98, c - STEP / 2)}Z`);
      hitEl.classList.add('on');
      board.querySelector(`[data-bet="n:${n}"]`)?.classList.add('win');
      for (const key of Object.keys(OUTSIDE)) if (OUTSIDE[key].test(n)) board.querySelector(`[data-bet="${key}"]`)?.classList.add('win');
      // settle bets visually
      let anyWin = false;
      for (const [key, v] of bets) {
        const cell = board.querySelector(`[data-bet="${key}"]`);
        const mult = payoutFor(key, n);
        if (mult) {
          anyWin = true;
          cell.insertAdjacentHTML('beforeend', `<span class="pay">+${fmt(v * mult - v)}</span>`);
        } else {
          cell.classList.add('lose');
          const bc = cell.querySelector('.bchip');
          bc?.animate([{ opacity: 1, transform: 'translate(-50%, -50%)' }, { opacity: 0, transform: 'translate(-50%, -160%) scale(.6)' }], { duration: 500, delay: 300, fill: 'forwards', easing: 'ease-in' });
        }
      }
      store.finish(t, payout, { info: `${n} ${col}` });
      open = null;
      const mult = payout / amount;
      if (payout > 0) {
        if (mult >= 10) {
          sfx.jackpot();
          coinRain(mult >= 30 ? 120 : 60);
        } else sfx.win(mult >= 2 ? 2 : 1);
        burstAt(resultEl, { count: Math.min(100, 20 + mult * 6), colors: PALETTES.gold, speed: [4, 12] });
        floatFrom(resultEl, `+${fmt(payout - amount > 0 ? payout - amount : payout)}`, 'var(--win)');
        haptic([20, 30, 20]);
      } else {
        sfx.lose();
      }
      await sleep(reducedMotion() ? 200 : 1300);
      if (destroyed) return;
      // chips are collected; winners are paid into your stack
      bets.clear();
      undo = [];
      spinning = false;
      renderBets();
      if (!anyWin) hintEl.textContent = 'No luck. Rebet or try new numbers.';
    }

    function animate(k) {
      return new Promise((resolve) => {
        const fast = quick || reducedMotion();
        const S = fast ? 0.55 : 1;
        const T1 = (3.1 + Math.random() * 0.6) * S;
        const D = (2.0 + Math.random() * 0.4) * S;
        const T2 = T1 + D;
        const END = T2 + (fast ? 0.6 : 1.6);
        const wR0 = 70 / S; // rotor deg/s (clockwise)
        const tauR = 7;
        const wB0 = 560 / S; // ball deg/s (counter-clockwise)
        const tauB = 2.4 * S;
        const r0 = rotor;
        const b0 = randInt(360);
        const rotorAt = (t) => r0 + wR0 * tauR * (1 - Math.exp(-t / tauR));
        const rotorV = (t) => wR0 * Math.exp(-t / tauR);
        const ballA = (t) => b0 - wB0 * tauB * (1 - Math.exp(-t / tauB));
        const ballV = (t) => -wB0 * Math.exp(-t / tauB);
        // Solve phase B so the ball lands in pocket k (relative to the rotor).
        const psi1 = ballA(T1) - rotorAt(T1);
        const v1 = ballV(T1) - rotorV(T1); // negative
        const target = -90 + k * STEP;
        let base = ((target - psi1) % 360) - 360;
        base %= 360;
        if (base > 0) base -= 360;
        const ideal = (Math.abs(v1) * D) / 2.3;
        const extra = Math.max(0, Math.round((ideal - Math.abs(base)) / 360));
        const delta = base - 360 * extra;
        const pw = clamp((Math.abs(v1) * D) / Math.abs(delta), 1.3, 4.5);
        const R_TRACK = 174;
        const R_POCKET = 113;
        let lastBounce = 0;
        ballG.style.opacity = '1';
        roll.start();
        const start = performance.now();
        const frameFn = (now) => {
          if (destroyed) return resolve();
          const t = (now - start) / 1000;
          const rot = rotorAt(Math.min(t, END + 3));
          setRotor(rot);
          let ang;
          let r;
          if (t < T1) {
            ang = ballA(t);
            r = R_TRACK + Math.sin(t * 9) * 0.8;
            roll.set(Math.abs(ballV(t)) / wB0);
          } else if (t < T2) {
            const u = (t - T1) / D;
            const e = 1 - Math.pow(1 - u, pw);
            const rattle = Math.sin(u * Math.PI * 6) * (1 - u) * (1 - u) * u * STEP * 2.2;
            ang = rot + psi1 + delta * e + rattle;
            const drop = Math.max(0, 1 - u * 1.7);
            const hop = u > 0.25 ? Math.abs(Math.sin(u * Math.PI * 5)) * 11 * Math.pow(1 - u, 1.4) : 0;
            r = R_POCKET + (R_TRACK - R_POCKET) * drop * drop + hop;
            const b = Math.floor(u * 5);
            if (u > 0.25 && b !== lastBounce) {
              lastBounce = b;
              sfx.clack();
            }
            roll.set(Math.max(0, 0.35 - u * 0.35));
            if (u > 0.55) roll.stop();
          } else {
            ang = rot + target;
            r = R_POCKET;
            roll.stop();
          }
          setBall(ang, r);
          if (t < END) raf = requestAnimationFrame(frameFn);
          else {
            rotor = rot % 360;
            resolve();
          }
          if (t >= T2 && !frameFn.landed) {
            frameFn.landed = true;
            sfx.clack();
            haptic(15);
          }
        };
        raf = requestAnimationFrame(frameFn);
      });
    }

    playBtn.addEventListener('click', spin);
    const onKey = (e) => {
      if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        spin();
      }
      if (e.key === 'z' || e.key === 'Z') tools.querySelector('[data-t="undo"]').click();
      if (e.key === 'x' || e.key === 'X') tools.querySelector('[data-t="clear"]').click();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      roll.stop();
      document.removeEventListener('keydown', onKey);
      if (open) store.finish(open);
      document.querySelectorAll('.mchip.fly').forEach((c) => c.remove());
      frame.destroy();
    };
  },
};
