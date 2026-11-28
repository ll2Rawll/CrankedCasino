// Mines: 5×5 grid, pick 1–24 mines, reveal gems, cash out before you hit a bomb.
// Multiplier after k gems with m mines = 0.99 × Π (25 − i) / (25 − m − i), i < k  (1% house edge)
// The server hides the mines and checks every tile, so the board can't be peeked at.

import { h, fmt, fmtMult, round2, signed, storage, esc } from '../util.js?v=0f27056399f9';
import { icon } from '../icons.js?v=0f27056399f9';
import { store } from '../store.js?v=0f27056399f9';
import { engine, errorText } from '../engine.js?v=0f27056399f9';
import { randInt } from '../rng.js?v=0f27056399f9';
import { minesMult as multiplier } from '../math.js?v=0f27056399f9';
import { sfx, haptic } from '../sound.js?v=0f27056399f9';
import { burstAt, shake, celebrate, PALETTES, floatFrom } from '../fx.js?v=0f27056399f9';
import { gameFrame, betInput, tryBet, toast, serverRefused } from '../ui.js?v=0f27056399f9';

const N = 25;
export { multiplier };

const DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="mGemBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d9fff0"/><stop offset=".45" stop-color="#3ee6a8"/><stop offset="1" stop-color="#0b7f57"/>
    </linearGradient>
    <radialGradient id="mBomb" cx="38%" cy="34%" r="70%">
      <stop offset="0" stop-color="#6a6a76"/><stop offset=".45" stop-color="#26262d"/><stop offset="1" stop-color="#09090b"/>
    </radialGradient>
    <radialGradient id="mCore" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff1c9"/><stop offset=".35" stop-color="#ff8a4d"/><stop offset=".7" stop-color="#ff3b55"/><stop offset="1" stop-color="#ff3b55" stop-opacity="0"/>
    </radialGradient>
  </defs>
</svg>`;

const GEM = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <polygon points="50,90 7,39 22,17 78,17 93,39" fill="url(#mGemBody)"/>
  <polygon points="22,17 36,39 7,39" fill="#c9ffea" opacity=".75"/>
  <polygon points="22,17 50,17 36,39" fill="#f2fffa" opacity=".9"/>
  <polygon points="50,17 78,17 64,39" fill="#a8ffde" opacity=".75"/>
  <polygon points="78,17 93,39 64,39" fill="#5ff0b8" opacity=".7"/>
  <polygon points="36,39 64,39 50,17" fill="#ffffff" opacity=".55"/>
  <polygon points="7,39 36,39 50,90" fill="#2fd497" opacity=".7"/>
  <polygon points="36,39 64,39 50,90" fill="#18b77d" opacity=".55"/>
  <polygon points="64,39 93,39 50,90" fill="#0a7a52" opacity=".75"/>
  <path d="M80 8 L82.5 14.5 L89 17 L82.5 19.5 L80 26 L77.5 19.5 L71 17 L77.5 14.5Z" fill="#fff"/>
</svg>`;

const MINE = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <g stroke="#3a3a44" stroke-width="7" stroke-linecap="round">
    <path d="M50 14v12M50 78v12M14 52h12M74 52h12M24.5 26.5l8.5 8.5M67 69l8.5 8.5M24.5 77.5l8.5-8.5M67 35l8.5-8.5"/>
  </g>
  <circle cx="50" cy="52" r="27" fill="url(#mBomb)"/>
  <circle cx="50" cy="52" r="15" fill="url(#mCore)"/>
  <ellipse cx="40" cy="41" rx="8" ry="4.5" fill="#fff" opacity=".35" transform="rotate(-35 40 41)"/>
</svg>`;

const RULES = `
  <ol class="rules">
    <li>Set your <strong>bet</strong> and how many <strong>mines</strong> are hidden in the 25 tiles.</li>
    <li>Press <strong>Bet</strong>, then flip tiles. Every gem raises your multiplier.</li>
    <li><strong>Cash out</strong> whenever you like. Hit a mine and the bet is lost.</li>
    <li>More mines means bigger multipliers per gem. House edge is 1%.</li>
  </ol>
  <p class="dim" style="margin-top:14px;font-size:14px">Shortcuts: <kbd>Space</kbd> bet or cash out · <kbd>R</kbd> random tile.</p>`;

export default {
  title: 'Mines',
  mount(view) {
    const frame = gameFrame(view, { game: 'mines', title: 'Mines', kicker: 'Original · 5×5 grid', tags: ['99% RTP', 'Cash out anytime'], rules: RULES });
    const { stage, controls } = frame;

    let mines = storage.get('cc:mines:count', 3);
    let round = null; // { t, bet, mines, revealed:[] }  (the mines themselves stay on the server)
    let ended = false;
    let destroyed = false;

    // ---------------------------------------------------------- stage
    stage.classList.add('mines-stage');
    stage.innerHTML = `${DEFS}
      <div class="mines-top">
        <span class="pill">${icon('sparkle')}<span>Gems <b data-gems>22</b></span></span>
        <span class="pill"><span>Next</span> <b data-next>1.13×</b></span>
        <span class="pill"><span>Mines</span> <b data-mn>3</b></span>
      </div>
      <div class="mines-grid" role="group" aria-label="Mines board"></div>`;
    const grid = stage.querySelector('.mines-grid');
    const tiles = [];
    for (let i = 0; i < N; i++) {
      const t = h(`<button type="button" class="tile" aria-label="Tile ${i + 1}" data-i="${i}">
        <span class="face front"></span><span class="face back"></span></button>`);
      tiles.push(t);
      grid.append(t);
    }

    // ---------------------------------------------------------- controls
    const bet = betInput('mines');
    controls.innerHTML = '';
    controls.append(bet.el);
    const minesField = h(`
      <div class="field">
        <div class="field-label"><span>Mines <b class="tnum" data-mcount style="color:var(--text)">3</b></span><span class="dim" data-odds></span></div>
        <input class="range" type="range" min="1" max="24" step="1" aria-label="Number of mines">
        <div class="chips-row" data-quick>${[1, 3, 5, 10, 16, 24].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('')}</div>
      </div>`);
    controls.append(minesField);
    const readout = h(`<div class="readout"><div><span>Multiplier</span><strong data-mult>1.00×</strong></div><div><span>Profit on cash out</span><strong data-profit>0.00</strong></div></div>`);
    controls.append(readout);
    const playBtn = h(`<button type="button" class="btn btn-primary btn-play"><span>Bet</span></button>`);
    const randBtn = h(`<button type="button" class="btn btn-outline btn-block" disabled>${icon('dice')}<span>Pick a random tile</span></button>`);
    controls.append(playBtn, randBtn, h(`<p class="hint"><kbd>Space</kbd> to bet or cash out · <kbd>R</kbd> random tile</p>`));

    const sel = minesField.querySelector('input[type=range]');
    const mcount = minesField.querySelector('[data-mcount]');
    const quick = minesField.querySelector('[data-quick]');
    const oddsEl = minesField.querySelector('[data-odds]');
    const $ = (s) => stage.querySelector(s) || controls.querySelector(s);
    const gemsEl = $('[data-gems]');
    const nextEl = $('[data-next]');
    const mnEl = $('[data-mn]');
    const multEl = $('[data-mult]');
    const profitEl = $('[data-profit]');

    const setMines = (n) => {
      mines = Math.max(1, Math.min(24, Number(n) || 3));
      storage.set('cc:mines:count', mines);
      sel.value = String(mines);
      sel.style.setProperty('--fill', `${((mines - 1) / 23) * 100}%`);
      mcount.textContent = String(mines);
      quick.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === mines)));
      updateReadout();
    };
    sel.addEventListener('input', () => setMines(sel.value));
    quick.addEventListener('click', (e) => {
      const b = e.target.closest('[data-n]');
      if (!b || b.disabled) return;
      sfx.click();
      setMines(b.dataset.n);
    });

    function updateReadout() {
      const m = round ? round.mines : mines;
      const k = round ? round.revealed.length : 0;
      const safeLeft = N - m - k;
      const cur = round && k ? multiplier(m, k) : 1;
      const next = safeLeft > 0 ? multiplier(m, k + 1) : cur;
      gemsEl.textContent = String(Math.max(0, safeLeft));
      mnEl.textContent = String(m);
      nextEl.textContent = safeLeft > 0 ? fmtMult(next) : '—';
      multEl.textContent = fmtMult(cur);
      const b = round ? round.bet : bet.value;
      profitEl.textContent = round && k ? signed(round2(b * cur) - b) : fmt(0);
      profitEl.className = round && k ? 'win-text' : '';
      const chance = safeLeft > 0 ? (safeLeft / (N - k)) * 100 : 0;
      oddsEl.textContent = `${chance.toFixed(1)}% safe next`;
    }

    function setPlaying(on) {
      bet.disable(on);
      sel.disabled = on;
      quick.querySelectorAll('button').forEach((b) => (b.disabled = on));
      randBtn.disabled = !on;
      tiles.forEach((t) => t.classList.toggle('can', on && !t.classList.contains('is-open')));
      renderPlay();
    }

    function renderPlay() {
      playBtn.disabled = pending && !round;
      if (round) {
        const k = round.revealed.length;
        if (k) {
          const pay = round2(round.bet * multiplier(round.mines, k));
          playBtn.className = 'btn btn-play is-cash';
          playBtn.innerHTML = `<span>Cash out</span><span class="sub">${fmt(pay)}</span>`;
        } else {
          playBtn.className = 'btn btn-outline btn-play';
          playBtn.innerHTML = `<span>Pick a tile…</span>`;
        }
      } else {
        playBtn.className = 'btn btn-primary btn-play';
        playBtn.innerHTML = `<span>Bet</span>`;
      }
    }

    function resetBoard() {
      tiles.forEach((t) => {
        t.className = 'tile';
        t.querySelector('.back').innerHTML = '';
        t.setAttribute('aria-label', `Tile ${Number(t.dataset.i) + 1}`);
      });
      stage.classList.remove('is-busted', 'is-won');
      stage.querySelector('.result-pop')?.remove();
      ended = false;
    }

    function showTile(i, kind, { dim = false, fresh = false } = {}) {
      const t = tiles[i];
      t.querySelector('.back').innerHTML = kind === 'mine' ? MINE : GEM;
      t.classList.add('is-open', kind === 'mine' ? 'is-mine' : 'is-gem');
      t.classList.toggle('is-dim', dim);
      t.classList.toggle('is-fresh', fresh);
      t.classList.remove('can');
      t.setAttribute('aria-label', `Tile ${i + 1}: ${kind === 'mine' ? 'mine' : 'gem'}`);
    }

    function revealRest(set, exclude = new Set()) {
      let d = 0;
      for (let i = 0; i < N; i++) {
        if (exclude.has(i) || tiles[i].classList.contains('is-open')) continue;
        const delay = 60 + d++ * 22;
        setTimeout(() => showTile(i, set.has(i) ? 'mine' : 'gem', { dim: true }), delay);
      }
    }

    let pending = false; // a request is on its way to the server

    async function start() {
      if (round || pending) return;
      resetBoard();
      const t = tryBet('mines', bet);
      if (!t) return;
      pending = true;
      renderPlay();
      const r = await engine.minesStart(t.amount, mines);
      pending = false;
      if (!r?.ok) {
        if (r?.error === 'round_active') {
          // A round is already open on the server (another tab?): pick it up.
          store.cancel(t);
          const me = await store.refresh();
          if (me?.ok && !destroyed) restore(store.takeRound('mines'));
          return;
        }
        serverRefused(t, r, bet);
        renderPlay();
        return;
      }
      store.confirm(t, r, { debited: t.amount });
      if (destroyed) {
        // Left the page while the bet was on its way: keep the round for next time.
        store.cancel(t);
        store.state.rounds.mines = { bet: t.amount, mines, revealed: [] };
        return;
      }
      round = { t, bet: t.amount, mines, revealed: [] };
      setPlaying(true);
      updateReadout();
      grid.animate([{ transform: 'scale(.98)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    }

    async function pick(i) {
      if (!round || pending || tiles[i].classList.contains('is-open')) return;
      const t = tiles[i];
      pending = true;
      t.classList.add('is-pressed');
      const r = await engine.minesReveal(i);
      pending = false;
      t.classList.remove('is-pressed');
      if (destroyed) {
        // Left mid-reveal: the server has the truth, so reload the profile from it.
        store.sync(r);
        store.refresh();
        return;
      }
      if (!r?.ok) {
        if (r?.error === 'no_round') {
          // The round ended elsewhere (another tab). Start fresh.
          const old = round;
          round = null;
          store.cancel(old.t);
          store.refresh();
          setPlaying(false);
          updateReadout();
          toast('That round already ended on another screen.', { iconName: 'info' });
        } else if (r?.error !== 'auth') toast(errorText(r), { type: 'loss' });
        return;
      }
      if (r.mine) {
        // Boom.
        const rr = round;
        round = null;
        store.confirm(rr.t, r, { paid: 0 });
        store.finish(rr.t, r.entry);
        showTile(i, 'mine', { fresh: true });
        sfx.boom();
        haptic([30, 40, 60]);
        stage.classList.add('is-busted');
        shake(stage, true);
        burstAt(t, { count: 60, colors: PALETTES.loss, speed: [4, 13], kind: 'ember', size: [4, 9], life: [30, 60], gravity: 0.15 });
        burstAt(t, { count: 30, colors: ['#3a3a44', '#26262d', '#ff8a4d'], speed: [2, 8], size: [5, 10] });
        revealRest(new Set(r.cells), new Set([i]));
        ended = true;
        setPlaying(false);
        updateReadout();
        return;
      }
      round.revealed.push(i);
      showTile(i, 'gem', { fresh: true });
      const k = round.revealed.length;
      sfx.gem(k - 1);
      haptic(10);
      burstAt(t, { count: 14, colors: PALETTES.win, speed: [2, 6], kind: 'spark', size: [3, 6], life: [18, 34], gravity: 0.05 });
      floatFrom(t, fmtMult(multiplier(round.mines, k)), 'var(--mines)');
      updateReadout();
      renderPlay();
      // Every gem found: the server already cashed the round out.
      if (r.cleared) finishWin(r, true);
    }

    async function cashOut() {
      if (!round || pending || !round.revealed.length) return;
      pending = true;
      renderPlay();
      const r = await engine.minesCashout();
      pending = false;
      if (destroyed) {
        store.sync(r);
        store.refresh();
        return;
      }
      if (!r?.ok) {
        renderPlay();
        if (r?.error === 'no_round') {
          const old = round;
          round = null;
          store.cancel(old.t);
          store.refresh();
          setPlaying(false);
          updateReadout();
        }
        if (r?.error !== 'auth') toast(errorText(r), { type: 'loss' });
        return;
      }
      finishWin(r, false);
    }

    function finishWin(r, auto) {
      const rr = round;
      round = null;
      store.confirm(rr.t, r, { paid: r.payout });
      store.finish(rr.t, r.entry);
      if (destroyed) return;
      const m = r.mult;
      const pay = r.payout;
      sfx.cashout();
      if (m >= 2) sfx.win(m >= 10 ? 2 : 1);
      stage.classList.add('is-won');
      const pop = h(`<div class="result-pop"><div class="m">${fmtMult(m)}</div><div class="p">${signed(pay - rr.bet)}</div></div>`);
      stage.append(pop);
      celebrate(pop, m, PALETTES.win);
      revealRest(new Set(r.cells));
      ended = true;
      setPlaying(false);
      updateReadout();
      if (auto) toast('Board cleared! Every gem found.', { type: 'win', iconName: 'sparkle' });
    }

    grid.addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      if (!round) {
        if (ended || !t.classList.contains('is-open')) {
          sfx.tap();
          playBtn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 300 });
        }
        return;
      }
      pick(Number(t.dataset.i));
    });
    playBtn.addEventListener('click', () => {
      if (!round) start();
      else if (round.revealed.length) cashOut();
    });
    randBtn.addEventListener('click', () => {
      if (!round) return;
      const left = tiles.filter((t) => !t.classList.contains('is-open')).map((t) => Number(t.dataset.i));
      if (left.length) pick(left[randInt(left.length)]);
    });
    const onKey = (e) => {
      if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        playBtn.click();
      }
      if (e.key === 'r' || e.key === 'R') randBtn.click();
    };
    document.addEventListener('keydown', onKey);

    // ---------------------------------------------------------- restore a round in progress
    function restore(saved) {
      if (!saved || round) return;
      const t = store.resume('mines', saved.bet);
      resetBoard();
      round = { t, bet: saved.bet, mines: saved.mines, revealed: [...(saved.revealed || [])] };
      mines = saved.mines;
      round.revealed.forEach((i) => showTile(i, 'gem'));
      setMines(mines);
      setPlaying(true);
      sel.disabled = true;
      quick.querySelectorAll('button').forEach((b) => (b.disabled = true));
      updateReadout();
      toast('Picked up your Mines round where you left off.', { iconName: 'refresh' });
    }
    setMines(mines);
    restore(store.takeRound('mines'));
    renderPlay();
    updateReadout();
    bet.el.querySelector('input').addEventListener('change', updateReadout);

    return () => {
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      // An open round stays on the server; it comes back next time.
      if (round) {
        store.cancel(round.t);
        store.state.rounds.mines = { bet: round.bet, mines: round.mines, revealed: [...round.revealed] };
      }
      frame.destroy();
    };
  },
};
