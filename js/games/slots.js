// Slots: 5 reels × 3 rows, 10 fixed lines, wilds, scatter stars and free spins at ×2.
// The server spins every reel (and any free spins); this page animates the result.
// Paytable and line maths live in ../math.js (RTP ≈ 97.5%).

import { h, fmt, fmtMult, round2, signed, storage, sleep, reducedMotion, esc } from '../util.js?v=cab8bd999107';
import { icon } from '../icons.js?v=cab8bd999107';
import { store } from '../store.js?v=cab8bd999107';
import { engine } from '../engine.js?v=cab8bd999107';
import { weightedPick, randInt } from '../rng.js?v=cab8bd999107';
import { SLOT_WEIGHTS, SLOT_TOTAL_W, SLOT_PAY as PAY, WILD, SCAT, FS_MULT, LINES, slotEvaluate as evaluate, unflatGrid } from '../math.js?v=cab8bd999107';
import { sfx, haptic } from '../sound.js?v=cab8bd999107';
import { burstAt, coinRain, countTo, PALETTES, shake } from '../fx.js?v=cab8bd999107';
import { gameFrame, betInput, tryBet, toast, modal, serverRefused } from '../ui.js?v=cab8bd999107';

export const SYMBOLS = ['cherry', 'lemon', 'grape', 'bell', 'bar', 'diamond', 'seven', 'wild', 'scatter'];
const NAMES = { cherry: 'Cherry', lemon: 'Lemon', grape: 'Grapes', bell: 'Bell', bar: 'Bar', diamond: 'Diamond', seven: 'Lucky 7', wild: 'Wild', scatter: 'Bonus star' };
const LINE_COLORS = ['#ffffff', '#5ab4ff', '#ff4fae', '#45e3a0', '#f3c35f', '#b169ff', '#ff7a45', '#7df9ff', '#ffd1ea', '#c7f78d'];
const src = (i) => `assets/symbols/${SYMBOLS[i]}.svg`;

// Filler symbols that blur past while the reels spin (looks only).
const pick = () => weightedPick(SLOT_WEIGHTS, SLOT_TOTAL_W);

// ------------------------------------------------------------------ page
const RULES = `
  <ol class="rules">
    <li>Your bet is spread over <strong>10 fixed lines</strong>. Line wins pay left to right, starting on the first reel.</li>
    <li><strong>Wild</strong> stands in for every symbol except the bonus star.</li>
    <li>3+ <strong>bonus stars</strong> anywhere pay up to 50× your bet and award <strong>8, 12 or 20 free spins</strong> where every win is doubled. Free spins can retrigger.</li>
    <li>Return to player is about 97.5%.</li>
  </ol>
  <div class="paytable">
    ${[7, 6, 5, 4, 3, 2, 1, 0]
      .map(
        (i) => `<div class="pt-row"><img src="${src(i)}" alt="${NAMES[SYMBOLS[i]]}"><div><strong>${NAMES[SYMBOLS[i]]}</strong><div class="pays"><span>3× <b>${PAY[i][0]}</b></span><span>4× <b>${PAY[i][1]}</b></span><span>5× <b>${PAY[i][2]}</b></span></div></div></div>`,
      )
      .join('')}
    <div class="pt-row"><img src="${src(SCAT)}" alt="Bonus star"><div><strong>Bonus star · pays anywhere</strong><div class="pays"><span>3 → <b>2× bet + 8 FS</b></span><span>4 → <b>10× + 12 FS</b></span><span>5 → <b>50× + 20 FS</b></span></div></div></div>
  </div>
  <p class="dim" style="margin-top:12px;font-size:13px">Line pays are multiples of the line bet (total bet ÷ 10).</p>`;

export default {
  title: 'Slots',
  mount(view) {
    const frame = gameFrame(view, { game: 'slots', title: 'Slots', kicker: 'Original · 5 reels · 10 lines', tags: ['≈97.5% RTP', 'Free spins ×2'], rules: RULES });
    const { stage, controls } = frame;
    let destroyed = false;
    let spinning = false;
    let turbo = storage.get('cc:slots:turbo', false);
    let autoLeft = 0;
    let current = Array.from({ length: 5 }, () => [randInt(7), randInt(7), randInt(7)]);
    let open = null; // active ticket while a sequence plays

    // Warm the image cache so the first spin never flickers.
    SYMBOLS.forEach((_, i) => {
      const im = new Image();
      im.src = src(i);
    });

    // ---------------------------------------------------------- stage
    stage.classList.add('slots-stage');
    stage.innerHTML = `
      <div class="slots-top">
        <span class="pill" data-info>${icon('sparkle')}<span>10 lines</span></span>
        <span class="pill" data-linebet>Line bet <b>0.10</b></span>
      </div>
      <div class="cabinet">
        <div class="cab-sign" aria-hidden="true"><span class="neon">LUCKY CRANK</span></div>
        <div class="cab-lights" aria-hidden="true">${'<i></i>'.repeat(16)}</div>
        <div class="reels">
          ${Array.from({ length: 5 }, (_, c) => `<div class="reel" data-c="${c}"><div class="strip"></div><div class="reel-shine"></div></div>`).join('')}
          <svg class="paylines" viewBox="0 0 5 3" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
      </div>
      <div class="win-banner" aria-live="polite"><span class="idle">Spin to win. Three stars unlock free spins.</span></div>`;
    const reels = [...stage.querySelectorAll('.reel')];
    const strips = reels.map((r) => r.querySelector('.strip'));
    const lines = stage.querySelector('.paylines');
    const cabinet = stage.querySelector('.cabinet');
    const banner = stage.querySelector('.win-banner');
    const infoPill = stage.querySelector('[data-info]');
    const lineBetPill = stage.querySelector('[data-linebet] b');

    const cellHTML = (s, blur = false) =>
      `<div class="cell${blur ? ' blur' : ''}" data-s="${s}"><img src="${src(s)}" alt="${blur ? '' : NAMES[SYMBOLS[s]]}" draggable="false">${
        !blur && s === WILD ? '<span class="wild-tag">WILD</span>' : ''
      }</div>`;
    const paint = () =>
      strips.forEach((st, c) => {
        st.innerHTML = current[c].map((s) => cellHTML(s)).join('');
        st.style.transform = 'translateY(0)';
      });
    paint();

    // ---------------------------------------------------------- controls
    controls.innerHTML = '';
    const bet = betInput('slots', { label: 'Total bet' });
    const turboRow = h(`<label class="toggle-row"><span style="display:inline-flex;gap:8px;align-items:center">${icon('bolt').replace('<svg', '<svg width="18" height="18"')}Turbo spins</span><span class="switch"><input type="checkbox" ${turbo ? 'checked' : ''} aria-label="Turbo spins"><span></span></span></label>`);
    const autoRow = h(`<div class="field"><div class="field-label"><span>Autoplay</span><span class="dim" data-auto-left></span></div><div class="chips-row" data-auto>${[10, 25, 50, 100].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('')}</div></div>`);
    const playBtn = h(`<button type="button" class="btn btn-primary btn-play"><span>Spin</span></button>`);
    const payBtn = h(`<button type="button" class="btn btn-outline btn-block">${icon('info')}<span>Paytable</span></button>`);
    controls.append(bet.el, turboRow, autoRow, playBtn, payBtn, h(`<p class="hint"><kbd>Space</kbd> to spin</p>`));
    const autoLeftEl = autoRow.querySelector('[data-auto-left]');
    turboRow.querySelector('input').addEventListener('change', (e) => {
      turbo = e.target.checked;
      storage.set('cc:slots:turbo', turbo);
    });
    payBtn.addEventListener('click', () => modal({ title: 'Paytable', body: RULES }));
    const updateLineBet = () => (lineBetPill.textContent = fmt(bet.value / 10));
    bet.el.querySelector('input').addEventListener('change', updateLineBet);
    bet.el.addEventListener('click', () => setTimeout(updateLineBet));
    updateLineBet();

    function renderPlay() {
      if (autoLeft > 0) {
        playBtn.className = 'btn btn-danger btn-play';
        playBtn.innerHTML = `${icon('stop')}<span>Stop autoplay</span><span class="sub">${autoLeft} left</span>`;
      } else {
        playBtn.className = 'btn btn-primary btn-play';
        playBtn.innerHTML = `<span>${spinning ? 'Spinning…' : 'Spin'}</span>`;
      }
      playBtn.disabled = spinning && autoLeft === 0;
      autoRow.querySelectorAll('button').forEach((b) => (b.disabled = spinning || autoLeft > 0));
      bet.disable(spinning || autoLeft > 0);
      autoLeftEl.textContent = autoLeft > 0 ? `${autoLeft} spins left` : '';
    }

    // ---------------------------------------------------------- animation
    function clearWins() {
      lines.innerHTML = '';
      stage.querySelectorAll('.cell.win, .cell.dim').forEach((c) => c.classList.remove('win', 'dim'));
      stage.querySelector('.big-win')?.remove();
    }

    function animateReels(next, { fast = false, freeSpin = false } = {}) {
      const cell = reels[0].clientHeight / 3;
      const rm = reducedMotion();
      const base = rm ? 200 : fast ? 360 : 720;
      const gap = rm ? 60 : fast ? 85 : 165;
      let delay = base;
      let scatSoFar = 0;
      const plans = next.map((col, c) => {
        const tease = !rm && scatSoFar >= 2 && c > 0;
        delay += c === 0 ? 0 : gap + (tease ? (fast ? 450 : 900) : 0);
        scatSoFar += col.filter((s) => s === SCAT).length;
        return { c, duration: delay, tease };
      });
      sfx.whoosh();
      return Promise.all(
        plans.map(
          ({ c, duration, tease }) =>
            new Promise((resolve) => {
              const n = Math.max(8, Math.round((duration / 1000) * (fast ? 34 : 26)));
              const fillers = Array.from({ length: n }, () => cellHTML(pick(), true)).join('');
              const st = strips[c];
              st.innerHTML = next[c].map((s) => cellHTML(s)).join('') + fillers + current[c].map((s) => cellHTML(s)).join('');
              const dist = (n + 3) * cell;
              st.style.transform = `translateY(${-dist}px)`;
              if (tease) setTimeout(() => !destroyed && (reels[c].classList.add('tease'), sfx.tease()), Math.max(0, duration - (fast ? 650 : 1150)));
              const anim = st.animate(
                [
                  { transform: `translateY(${-dist}px)`, easing: 'cubic-bezier(.4,0,.6,1)' },
                  { transform: `translateY(${-dist - cell * 0.22}px)`, offset: 0.06, easing: 'cubic-bezier(.32,0,.18,1)' },
                  { transform: `translateY(${cell * 0.16}px)`, offset: 0.9, easing: 'cubic-bezier(.3,0,.4,1)' },
                  { transform: 'translateY(0px)' },
                ],
                { duration, fill: 'forwards' },
              );
              const done = () => {
                if (destroyed) return resolve();
                reels[c].classList.remove('tease');
                st.innerHTML = next[c].map((s) => cellHTML(s)).join('');
                anim.cancel();
                st.style.transform = 'translateY(0)';
                sfx.reelStop(c);
                if (next[c].includes(SCAT)) sfx.tease();
                resolve();
              };
              anim.onfinish = done;
              anim.oncancel = () => resolve();
            }),
        ),
      ).then(() => {
        current = next;
      });
    }

    function cellEl(c, r) {
      return strips[c].children[r];
    }

    async function present(ev, totalBet, { freeSpin = false } = {}) {
      if (!ev.total) {
        if (!freeSpin) banner.innerHTML = `<span class="idle">No win this time. Spin again?</span>`;
        return;
      }
      const winning = new Set();
      ev.wins.forEach((w) => w.cells.forEach(([c, r]) => winning.add(`${c}:${r}`)));
      if (ev.scatWin) ev.scat.forEach(([c, r]) => winning.add(`${c}:${r}`));
      for (let c = 0; c < 5; c++)
        for (let r = 0; r < 3; r++) {
          const el = cellEl(c, r);
          if (!el) continue;
          if (winning.has(`${c}:${r}`)) el.classList.add('win');
          else el.classList.add('dim');
        }
      ev.wins.forEach((w, i) => {
        const color = LINE_COLORS[w.li];
        const pts = LINES[w.li].map((r, c) => `${c + 0.5},${r + 0.5}`).join(' ');
        lines.insertAdjacentHTML('beforeend', `<polyline points="${pts}" stroke="${color}" style="color:${color};animation-delay:${i * 0.12}s"></polyline>`);
        w.cells.forEach(([c, r]) => cellEl(c, r)?.style.setProperty('--glow', color));
      });
      if (ev.scatWin) ev.scat.forEach(([c, r]) => cellEl(c, r)?.style.setProperty('--glow', '#ff4fae'));

      const mult = ev.total / totalBet;
      const label = freeSpin ? 'Free spin win' : ev.wins.length + (ev.scatWin ? 1 : 0) > 1 ? `${ev.wins.length + (ev.scatWin ? 1 : 0)} wins` : 'Win';
      banner.innerHTML = `<div class="wb"><span class="k">${label} · ${fmtMult(mult)}</span><span class="v tnum">0.00</span></div>`;
      countTo(banner.querySelector('.v'), 0, ev.total, { duration: Math.min(1600, 500 + mult * 60) });
      haptic(mult >= 5 ? [20, 30, 20] : 12);
      if (mult >= 10) await bigWin(ev.total, mult);
      else {
        sfx.win(mult >= 3 ? 2 : 1);
        burstAt(banner, { count: Math.min(60, 10 + mult * 6), colors: PALETTES.gold, kind: mult >= 3 ? 'confetti' : 'spark', speed: [3, 9] });
      }
    }

    function bigWin(amount, mult) {
      return new Promise((resolve) => {
        const title = mult >= 50 ? 'Mega win' : mult >= 25 ? 'Huge win' : 'Big win';
        const el = h(`<div class="big-win" role="status"><div class="t">${title}</div><div class="v tnum">0.00</div><div class="s">${fmtMult(mult)} your bet</div></div>`);
        stage.append(el);
        sfx.bigWin();
        coinRain(mult >= 50 ? 140 : mult >= 25 ? 100 : 60);
        burstAt(el, { count: 90, colors: PALETTES.gold, speed: [5, 15] });
        countTo(el.querySelector('.v'), 0, amount, { duration: 1800 });
        shake(cabinet);
        let done = false;
        const close = () => {
          if (done) return;
          done = true;
          el.classList.add('is-leaving');
          setTimeout(() => el.remove(), 380);
          resolve();
        };
        el.style.pointerEvents = 'auto';
        el.addEventListener('click', close);
        setTimeout(close, reducedMotion() ? 1200 : 2800);
      });
    }

    function overlay(title, value, sub, ms = 1700) {
      return new Promise((resolve) => {
        const el = h(`<div class="big-win" role="status"><div class="t" style="background:linear-gradient(180deg,#ffe3f3 10%,#ff4fae 60%,#b0127a);-webkit-background-clip:text;background-clip:text">${esc(title)}</div><div class="v tnum">${esc(value)}</div><div class="s">${esc(sub)}</div></div>`);
        stage.append(el);
        setTimeout(() => {
          el.classList.add('is-leaving');
          setTimeout(() => {
            el.remove();
            resolve();
          }, 380);
        }, reducedMotion() ? 900 : ms);
      });
    }

    // ---------------------------------------------------------- spin sequence
    async function spin() {
      if (spinning || destroyed) return;
      const t = tryBet('slots', bet);
      if (!t) {
        autoLeft = 0;
        renderPlay();
        return;
      }
      const totalBet = t.amount;
      open = t;
      spinning = true;
      renderPlay();
      clearWins();
      banner.innerHTML = `<span class="idle">Good luck…</span>`;
      cabinet.classList.add('is-pulling');
      const r = await engine.slots(totalBet);
      cabinet.classList.remove('is-pulling');
      if (!r?.ok) {
        serverRefused(t, r, bet);
        open = null;
        spinning = false;
        autoLeft = 0;
        if (!destroyed) {
          banner.innerHTML = `<span class="idle">Spin to win. Three stars unlock free spins.</span>`;
          renderPlay();
        }
        return;
      }
      store.confirm(t, r, { debited: totalBet, paid: r.total });
      t.entry = r.entry;
      if (destroyed) return store.finish(t, r.entry);
      // The server's grids, presented with the same line maths it used.
      const grid = unflatGrid(r.grid);
      const ev = evaluate(grid, totalBet);
      const fsList = r.fs.map((f) => {
        const g = unflatGrid(f.grid);
        return { grid: g, ev: evaluate(g, totalBet, FS_MULT) };
      });
      const total = r.total;
      const fast = turbo || autoLeft > 0;
      await animateReels(grid, { fast });
      if (destroyed) return;
      await present(ev, totalBet);
      if (ev.total) store.credit(t, ev.total);

      if (fsList.length) {
        await sleep(fast ? 500 : 900);
        sfx.bigWin();
        coinRain(40);
        await overlay('Free spins', `${ev.fs} spins`, `every win ×${FS_MULT}`);
        cabinet.classList.add('is-fs');
        let won = 0;
        let left = ev.fs;
        for (let i = 0; i < fsList.length && !destroyed; i++) {
          left--;
          infoPill.classList.add('fs');
          infoPill.innerHTML = `${icon('sparkle')}<span>Free spin <b>${i + 1}</b> · won <b>${fmt(won)}</b></span>`;
          clearWins();
          await sleep(fast ? 180 : 380);
          await animateReels(fsList[i].grid, { fast: true, freeSpin: true });
          if (destroyed) return;
          const e = fsList[i].ev;
          await present(e, totalBet, { freeSpin: true });
          if (e.total) {
            store.credit(t, e.total);
            won = round2(won + e.total);
          }
          if (e.fs) {
            left += e.fs;
            await overlay('Retrigger!', `+${e.fs} spins`, 'the party continues', 1300);
          }
          infoPill.innerHTML = `${icon('sparkle')}<span>Free spin <b>${i + 1}</b> · won <b>${fmt(won)}</b></span>`;
          await sleep(fast ? 350 : 650);
        }
        cabinet.classList.remove('is-fs');
        infoPill.classList.remove('fs');
        infoPill.innerHTML = `${icon('sparkle')}<span>10 lines</span>`;
        if (!destroyed) {
          await overlay('Free spins won', fmt(won), `${fsList.length} spins played`, 2000);
          banner.innerHTML = `<div class="wb"><span class="k">Total win · ${fmtMult(total / totalBet)}</span><span class="v tnum">${fmt(total)}</span></div>`;
        }
      }
      store.finish(t, r.entry);
      open = null;
      spinning = false;
      if (autoLeft > 0) {
        autoLeft--;
        renderPlay();
        if (autoLeft > 0 && !destroyed) {
          await sleep(ev.total ? 700 : 250);
          if (autoLeft > 0 && !destroyed) spin();
        } else renderPlay();
      } else renderPlay();
    }

    playBtn.addEventListener('click', () => {
      if (autoLeft > 0) {
        autoLeft = 0;
        renderPlay();
        return;
      }
      spin();
    });
    autoRow.querySelector('[data-auto]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-n]');
      if (!b || b.disabled || spinning) return;
      sfx.click();
      autoLeft = Number(b.dataset.n);
      renderPlay();
      spin();
    });
    const onKey = (e) => {
      if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!spinning) spin();
      }
    };
    document.addEventListener('keydown', onKey);
    renderPlay();

    return () => {
      destroyed = true;
      autoLeft = 0;
      document.removeEventListener('keydown', onKey);
      // A spin still animating is already paid on the server: show the win now.
      if (open?.entry) store.finish(open, open.entry);
      frame.destroy();
    };
  },
};
