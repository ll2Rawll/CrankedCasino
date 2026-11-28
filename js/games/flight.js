// Night Flight: tap to flap through the harbor gates.
//
// The rules and physics live in flight-course.js and follow the classic tap-to-flap
// arcade loop frame for frame (30 frames a second). This module draws those frames,
// smoothing between them for 60/120 Hz screens, and runs the screens around a flight:
// title → get ready → flight → crash and fall → scoreboard.
//
// A free flight chases a personal best. A bet flight picks a number of gates to clear:
// the server hands out the seed that lays out the gates, replays the flaps, and pays
// bet × that target's multiplier the moment the bird clears the last one.

import {
  flightCourse, FPS, VIEW_W, VIEW_H, FLOOR, BIRD_X, BIRD_W, BIRD_H, GATE_W, GAP, medalFor,
} from './flight-course.js?v=cab8bd999107';
import { icon } from '../icons.js?v=cab8bd999107';
import { engine, errorText } from '../engine.js?v=cab8bd999107';
import { store, on } from '../store.js?v=cab8bd999107';
import { betInput, tryBet, toast, serverRefused, segmented } from '../ui.js?v=cab8bd999107';
import { NF_TARGETS, targetMult } from '../math.js?v=cab8bd999107';
import { soundOn, setSound, sfx, unlockAudio } from '../sound.js?v=cab8bd999107';
import { storage, reducedMotion, fmt, fmtFull, fmtMult, round2, esc } from '../util.js?v=cab8bd999107';
import { countTo } from '../fx.js?v=cab8bd999107';
import { duelPanel, duelOutcome } from './duels.js?v=cab8bd999107';

const BEST = 'cc:flight:best';
const STEP = 1000 / FPS;
const pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
const anchor = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V21M7.5 11h9M4.5 14.5a7.5 7.5 0 0 0 15 0M4.5 14.5l-1.6 1.7M19.5 14.5l1.6 1.7"/></svg>';
const MEDAL_NAMES = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

export default {
  title: 'Night Flight',
  mount(view) {
    document.documentElement.classList.add('flight-open');
    view.innerHTML = `<section class="nf" data-phase="title" aria-label="Night Flight arcade game" tabindex="-1">
      <div class="nf-sky" aria-hidden="true"></div>
      <div class="nf-window" aria-hidden="true"><div class="nf-course"></div></div>
      <div class="nf-quay" aria-hidden="true"></div>
      <div class="nf-bird" aria-hidden="true"><i></i></div>
      <div class="nf-ready" aria-hidden="true">
        <b>Get ready</b>
        <span class="nf-tap"><i></i><em>Tap</em></span>
      </div>
      <div class="nf-flash" aria-hidden="true"></div>
      <nav class="nf-nav" aria-label="Game controls">
        <a href="#/" class="nf-pill">${icon('cards')}<span>Lobby</span></a>
        <div class="nf-balance" data-balance hidden><span class="chip-ico" aria-hidden="true"></span><b class="tnum"></b></div>
        <div class="nf-actions">
          <button type="button" class="nf-icon" data-sound></button>
          <button type="button" class="nf-icon" data-pause aria-label="Pause flight" hidden>${pauseIcon}</button>
        </div>
      </nav>
      <div class="nf-score" aria-label="Score" hidden><b>0</b><small class="nf-goal" hidden></small></div>
      <div class="nf-panel"><div class="nf-panel-inner">
        <div class="nf-record">${icon('trophy')}<span>Personal best</span> <b></b></div>
        <h1></h1><p class="nf-note"></p>
        <div class="nf-bet"></div>
        <button class="nf-play" type="button" data-start>${icon('play')}<span></span></button>
        <span class="nf-keys"><kbd>Space</kbd> to flap</span>
      </div></div>
      <div class="nf-board" hidden>
        <h2>Flight over</h2>
        <p class="nf-result" hidden></p>
        <div class="nf-card">
          <div class="nf-medal" data-medal><span class="nf-medal-slot"></span></div>
          <dl>
            <div><dt>Gates</dt><dd data-total>0</dd></div>
            <div><dt>Best <span class="nf-new" hidden>New</span></dt><dd data-best>0</dd></div>
          </dl>
        </div>
        <div class="nf-board-actions">
          <button class="nf-play" type="button" data-again>${icon('play')}<span>Fly again</span></button>
          <button class="nf-pill" type="button" data-change hidden><span>Change bet</span></button>
          <a class="nf-pill" href="#/" data-board-lobby>${icon('cards')}<span>Lobby</span></a>
        </div>
      </div>
      <span class="sr-only nf-status" role="status" aria-live="polite"></span>
    </section>`;
    const $ = (s) => view.querySelector(s);
    const field = $('.nf');
    const win = $('.nf-window');
    const world = $('.nf-course');
    const bird = $('.nf-bird');
    const birdArt = bird.firstElementChild;
    const quay = $('.nf-quay');
    const flash = $('.nf-flash');
    const pause = $('[data-pause]');
    const sound = $('[data-sound]');
    const panel = $('.nf-panel');
    const heading = $('h1');
    const note = $('.nf-note');
    const startBtn = $('[data-start]');
    const score = $('.nf-score');
    const record = $('.nf-record');
    const board = $('.nf-board');
    const status = $('.nf-status');
    const goalEl = $('.nf-goal');
    const result = $('.nf-result');
    const againBtn = $('[data-again]');
    const changeBtn = $('[data-change]');
    const boardLobby = $('[data-board-lobby]');
    let best = Math.max(0, Number(storage.get(BEST, 0)) || 0);
    let phase = 'title'; // title → ready → flying → falling → over (and paused)
    let resumeTo = 'flying';
    let course = flightCourse();
    // Betting: a free flight, or a bet on clearing a number of gates.
    let mode = ['bet', 'duel'].includes(storage.get('cc:flight:mode', 'free')) ? storage.get('cc:flight:mode', 'free') : 'free';
    let target = Number(storage.get('cc:flight:target', 10)) || 10;
    if (!targetMult(NF_TARGETS, target)) target = 10;
    let ticket = null; // the bet riding on this flight, until it settles
    let goal = null; // gates the bet flight in play must clear
    let settlement = null; // the server's answer for that flight
    let duelRun = null; // { duel, ticket, role } while a 1v1 flight is in the air
    let duelSettlement = null; // the challenge once that flight is in
    let busy = false;
    let destroyed = false;
    let winTimer = 0;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let quiet = reducedMotion();
    let prev = { y: course.state.y, rot: 0, distance: 0 };
    let boardTimer = 0;
    let countTimer = 0;
    // layout
    let W = 1;
    let H = 1;
    let scale = 1;
    let colLeft = 0;
    let worldTop = 0;
    const gates = new Map();
    const pool = [];
    const events = new AbortController();
    const listen = (target, name, handler, options = {}) => target.addEventListener(name, handler, { ...options, signal: events.signal });

    const sy = (y) => (y - worldTop) * scale;

    // ---------------------------------------------------------- the player's balance
    // The site header is hidden while the harbor is open, so the stack shows here, in full.
    const balPill = $('[data-balance]');
    const balNum = balPill.querySelector('b');
    const nav = $('.nf-nav');
    // Every digit stays: on a narrow screen the Lobby button drops its label instead.
    function fitNav() {
      nav.classList.remove('is-tight');
      if (!balPill.hidden && nav.scrollWidth > nav.clientWidth + 1) nav.classList.add('is-tight');
    }
    let shownBal = store.balance;
    let stopBal = () => {};
    function renderBalance({ animate = false, delta = 0 } = {}) {
      balPill.hidden = !store.signedIn;
      if (!store.signedIn) return;
      const to = store.balance;
      stopBal();
      // Size the bar for the final number, then count up to it.
      balNum.textContent = fmtFull(to);
      fitNav();
      if (animate && !quiet) stopBal = countTo(balNum, shownBal, to, { duration: 600, format: fmtFull });
      shownBal = to;
      balPill.setAttribute('aria-label', `Balance ${fmtFull(to)} chips`);
      if (delta && animate) {
        balPill.classList.remove('is-up', 'is-down');
        void balPill.offsetWidth;
        balPill.classList.add(delta > 0 ? 'is-up' : 'is-down');
      }
    }
    const offBalance = on('balance', ({ delta, silent }) => renderBalance({ animate: !silent, delta }));
    const offAccount = on('account', () => renderBalance());
    renderBalance();

    // ---------------------------------------------------------- the bet panel
    const betBox = $('.nf-bet');
    const modes = segmented([{ value: 'free', label: 'Free' }, { value: 'bet', label: 'Bet flight' }, { value: 'duel', label: '1v1' }], mode, (v) => {
      mode = v;
      storage.set('cc:flight:mode', v);
      show(phase);
    }, { label: 'Flight mode' });
    const bet = betInput('flight', { rack: false });
    const goals = segmented(NF_TARGETS.map(([g, m]) => ({ value: g, label: `${g} · ${m}×` })), target, (v) => {
      target = Number(v);
      storage.set('cc:flight:target', target);
      show(phase);
    }, { label: 'Gates to clear' });
    const goalField = document.createElement('div');
    goalField.className = 'field';
    goalField.innerHTML = '<div class="field-label"><span>Gates to clear</span><span class="dim">clear them all to win</span></div>';
    goalField.append(goals.el);
    modes.el.classList.add('nf-modes');
    const duels = duelPanel({
      game: 'flight', bet, unit: 'gates', label: 'fly',
      canStart: () => !busy && (phase === 'title' || phase === 'over'),
      onStart: (active) => {
        duelRun = active;
        ticket = null;
        goal = null;
        getReady(active.duel.seed);
      },
    });
    betBox.append(modes.el, bet.el, goalField, duels.el);
    const winFor = (amount, gates) => round2(amount * targetMult(NF_TARGETS, gates));
    listen(bet.el, 'change', () => show(phase));

    function updateSound() {
      sound.innerHTML = icon(soundOn() ? 'volume' : 'volumeOff');
      sound.setAttribute('aria-label', soundOn() ? 'Mute sound' : 'Enable sound');
    }

    function show(next) {
      phase = next;
      field.dataset.phase = phase;
      const playing = phase === 'flying' || phase === 'falling' || phase === 'over';
      panel.hidden = phase !== 'title' && phase !== 'paused';
      score.hidden = !(phase === 'flying' || phase === 'falling' || phase === 'won');
      pause.hidden = phase !== 'flying';
      board.hidden = phase !== 'over';
      const betting = mode === 'bet', dueling = mode === 'duel';
      field.classList.toggle('is-betting', betting || dueling);
      field.classList.toggle('is-dueling', dueling);
      betBox.hidden = phase !== 'title';
      bet.el.hidden = !betting && !dueling;
      goalField.hidden = !betting;
      duels.show(dueling && phase === 'title');
      startBtn.hidden = dueling && phase === 'title';
      modes.set(mode);
      goals.set(target);
      field.classList.toggle('is-playing', playing);
      if (phase === 'title') {
        record.hidden = false;
        record.lastElementChild.textContent = best;
        heading.innerHTML = 'Night<br><em>Flight</em>';
        note.textContent = dueling ? 'Same harbor, hidden scores: more gates wins 2× its own bet.' : betting ? `Clear ${target} gates to win ${fmt(winFor(bet.value, target))}.` : 'Tap to flap. Slip through the harbor gates.';
        startBtn.lastElementChild.textContent = betting ? `Bet ${fmt(bet.value)}` : 'Start flight';
        startBtn.disabled = busy;
      } else if (phase === 'paused') {
        record.hidden = true;
        heading.textContent = 'Paused';
        note.textContent = 'Your flight is on hold.';
        startBtn.lastElementChild.textContent = 'Resume flight';
      }
      status.textContent = phase === 'ready' ? 'Get ready. Tap to flap.' : phase === 'paused' ? 'Paused' : '';
    }

    // ---------------------------------------------------------- layout
    function resize() {
      W = field.clientWidth;
      H = field.clientHeight;
      if (!W || !H) return;
      if (W / H <= VIEW_W / VIEW_H) {
        // phones: the reference screen's full width, extra sky above and quay below
        scale = W / VIEW_W;
        colLeft = 0;
      } else {
        // wide screens: a portrait window the shape of the original game
        scale = H / VIEW_H;
        colLeft = (W - VIEW_W * scale) / 2;
      }
      // the quay sits 79% of the way down, as in the original
      worldTop = FLOOR - (0.79 * H) / scale;
      field.classList.toggle('is-windowed', colLeft > 1);
      field.style.setProperty('--col-left', `${colLeft}px`);
      field.style.setProperty('--col-w', `${VIEW_W * scale}px`);
      field.style.setProperty('--bird-w', `${BIRD_W * scale}px`);
      field.style.setProperty('--floor', `${sy(FLOOR)}px`);
      field.style.setProperty('--gate-w', `${GATE_W * scale}px`);
      for (const [index, el] of gates) {
        const gate = course.state.gates.find((g) => g.index === index);
        if (gate) positionGate(el, gate);
      }
      draw(1);
    }

    // ---------------------------------------------------------- gates
    function gateNode() {
      const el = pool.pop() || document.createElement('div');
      if (!el.firstChild) {
        el.className = 'nf-gate';
        el.innerHTML = '<i class="nf-pier top"></i><i class="nf-pier bottom"></i>';
      }
      world.append(el);
      return el;
    }
    function release(el) {
      el.remove();
      pool.push(el);
    }
    function positionGate(el, gate) {
      el.firstElementChild.style.height = `${sy(gate.gapTop)}px`;
      el.lastElementChild.style.top = `${sy(gate.gapTop + GAP)}px`;
    }

    // ---------------------------------------------------------- drawing
    const lerp = (a, b, t) => a + (b - a) * t;
    function draw(alpha) {
      const s = course.state;
      const live = new Set();
      for (const gate of s.gates) {
        const gx = lerp(gate.px ?? gate.x, gate.x, alpha);
        const x = gx * scale;
        if (x > VIEW_W * scale || x < -GATE_W * scale) continue;
        live.add(gate.index);
        let el = gates.get(gate.index);
        if (!el) {
          el = gateNode();
          gates.set(gate.index, el);
          positionGate(el, gate);
        }
        el.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      }
      for (const [index, el] of gates) {
        if (!live.has(index)) {
          release(el);
          gates.delete(index);
        }
      }
      if (phase === 'title') {
        // the title card: the bird hovers beside the name (the bob is CSS)
        // On a portrait screen the bet panel fills the middle, so the bird hovers higher.
        const high = W <= H && mode === 'bet';
        bird.style.transform = `translate3d(${(W * (W > H ? 0.67 : 0.76)).toFixed(2)}px,${(H * (high ? 0.17 : 0.49)).toFixed(2)}px,0)`;
      } else {
        const y = lerp(prev.y, s.y, alpha);
        const rot = quiet ? 0 : lerp(prev.rot, course.shownRot(), alpha);
        const bx = colLeft + (BIRD_X + BIRD_W / 2) * scale;
        const by = sy(y + BIRD_H / 2);
        bird.style.transform = `translate3d(${bx.toFixed(2)}px,${by.toFixed(2)}px,0) rotate(${(-rot).toFixed(1)}deg)`;
      }
      birdArt.style.backgroundPositionX = `${s.frame * 50}%`;
      const scroll = lerp(prev.distance, s.distance, alpha) * scale;
      quay.style.transform = `translate3d(${(-(scroll % 320)).toFixed(2)}px,0,0)`;
    }

    // ---------------------------------------------------------- the frame loop
    function snapshot() {
      prev = { y: course.state.y, rot: course.shownRot(), distance: course.state.distance };
      for (const g of course.state.gates) g.px = g.x;
    }
    function step() {
      snapshot();
      const happened = course.tick();
      for (const e of happened) {
        if (e === 'point') {
          score.firstElementChild.textContent = course.state.score;
          if (!quiet) score.firstElementChild.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
          sfx.point?.();
          if (goal && course.state.score >= goal) return reached();
        } else if (e === 'hit') crash();
        else if (e === 'die') setTimeout(() => phase === 'falling' && sfx.plunge?.(), 260);
        else if (e === 'land') landed();
      }
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      acc += Math.min(250, Math.max(0, now - last));
      last = now;
      while (acc >= STEP) {
        acc -= STEP;
        if (phase === 'title' || phase === 'ready' || phase === 'flying' || phase === 'falling') step();
        if (phase === 'over' || phase === 'paused' || phase === 'won') {
          acc = 0;
          break;
        }
      }
      draw(acc / STEP);
    }
    function run() {
      cancelAnimationFrame(raf);
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    }

    // ---------------------------------------------------------- flow
    function getReady(seed) {
      clearTimeout(boardTimer);
      clearTimeout(winTimer);
      clearInterval(countTimer);
      for (const el of gates.values()) release(el);
      gates.clear();
      if (seed == null) {
        // a free flight
        ticket = null;
        goal = null;
      }
      settlement = null;
      duelSettlement = null;
      course = flightCourse(seed ?? 1 + Math.floor(Math.random() * 2147483640));
      prev = { y: course.state.y, rot: 0, distance: 0 };
      score.firstElementChild.textContent = '0';
      goalEl.hidden = !goal && !duelRun;
      if (goal) goalEl.textContent = `of ${goal} · win ${fmt(winFor(ticket.amount, goal))}`;
      else if (duelRun) goalEl.textContent = `1v1 · ${fmt(duelRun.ticket.amount)}${duelRun.role === 'guest' ? ` vs ${duelRun.duel.host}` : ''}`;
      quiet = reducedMotion();
      unlockAudio();
      show('ready');
      field.focus({ preventScroll: true });
      run();
    }
    function takeOff() {
      course.launch();
      show('flying');
      sfx.wing?.();
    }
    function flap() {
      const s = course.state;
      if (s.y > -48) sfx.wing?.();
      course.flap();
    }
    function crash() {
      show('falling');
      if (ticket) settle();
      else if (duelRun) settleDuel();
      sfx.smack?.();
      if (!quiet) {
        flash.classList.remove('on');
        void flash.offsetWidth;
        flash.classList.add('on');
        field.animate(
          [{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,3px)' }, { transform: 'translate(5px,-3px)' }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(0,0)' }],
          { duration: 260, easing: 'ease-out' },
        );
      }
    }
    function landed() {
      const total = course.state.score;
      const isBest = total > best;
      best = Math.max(best, total, Number(storage.get(BEST, 0)) || 0);
      storage.set(BEST, best);
      boardTimer = setTimeout(() => showBoard(total, isBest, false), quiet ? 120 : 420);
    }
    /** The bet flight cleared its last gate: freeze the harbor and pay at once. */
    function reached() {
      show('won');
      settle();
      sfx.cashout?.();
      if (!quiet) {
        flash.classList.remove('on', 'is-gold');
        void flash.offsetWidth;
        flash.classList.add('on', 'is-gold');
      }
      const total = course.state.score;
      const isBest = total > best;
      best = Math.max(best, total, Number(storage.get(BEST, 0)) || 0);
      storage.set(BEST, best);
      winTimer = setTimeout(() => showBoard(total, isBest, true), quiet ? 120 : 650);
    }
    /** Send the flight to the server; the board shows what it paid. */
    function settle() {
      const t = ticket;
      ticket = null;
      const s = course.state;
      settlement = engine.flightEnd(s.start, s.flaps.slice(), s.flown).then((r) => {
        if (!r?.ok) {
          store.cancel(t);
          if (r?.error !== 'auth') toast(errorText(r), { type: 'loss' });
          return null;
        }
        store.confirm(t, r, { paid: r.payout });
        store.finish(t, r.entry);
        return { ...r, amount: t.amount };
      });
      return settlement;
    }
    /** A 1v1 flight is in: hand it to the challenge. */
    function settleDuel() {
      const active = duelRun;
      duelRun = null;
      const s = course.state;
      duelSettlement = duels.finish(active, { start: s.start, flaps: s.flaps.slice(), frames: s.flown });
    }
    function showBoard(total, isBest, won) {
      show('over');
      cancelAnimationFrame(raf);
      board.querySelector('h2').textContent = won ? 'Cleared!' : duelSettlement ? '1v1 flight' : 'Flight over';
      const betting = !!settlement || !!duelSettlement;
      result.hidden = !betting;
      result.className = 'nf-result';
      if (duelSettlement) {
        result.textContent = 'Sending your flight…';
        duelSettlement.then((d) => {
          if (destroyed || phase !== 'over') return;
          if (!d) return void (result.textContent = 'Flight not counted');
          const o = duelOutcome(d, 'gates');
          if (o.kind === 'posted') result.innerHTML = `Challenge posted <small>${esc(o.line)}</small>`;
          else {
            result.classList.add(o.kind === 'loss' ? 'is-loss' : 'is-win');
            result.innerHTML = `${o.kind === 'win' ? `+${fmt(o.pay)}` : o.kind === 'tie' ? `${fmt(o.stake)} back` : `−${fmt(o.stake)}`} <small>${esc(o.title)} · ${esc(o.line)}</small>`;
            if (o.kind === 'win') sfx.win?.(2);
          }
          status.textContent += o.kind === 'posted' ? ' Challenge posted.' : ` ${o.title}.`;
        });
      }
      if (settlement) {
        result.textContent = 'Settling…';
        settlement.then((r) => {
          if (destroyed || phase !== 'over') return;
          if (!r) result.textContent = 'Bet not settled';
          else if (r.payout > 0) {
            result.classList.add('is-win');
            result.innerHTML = `+${fmt(r.payout)} <small>${fmtMult(r.mult)} on ${fmt(r.amount)}</small>`;
            sfx.win?.(r.mult >= 5 ? 2 : 1);
          } else {
            result.classList.add('is-loss');
            result.innerHTML = `Bet lost <small>${r.score} of ${r.target} gates</small>`;
          }
          status.textContent += r ? (r.payout > 0 ? ` Won ${fmt(r.payout)}.` : ' Bet lost.') : '';
        });
      }
      againBtn.lastElementChild.textContent = duelSettlement ? 'Challenges' : betting ? `Bet again · ${fmt(bet.value)}` : 'Fly again';
      changeBtn.hidden = !betting || !!duelSettlement;
      boardLobby.hidden = betting;
      const medal = medalFor(total);
      const medalEl = board.querySelector('[data-medal]');
      medalEl.className = `nf-medal ${medal || ''}`;
      medalEl.innerHTML = medal ? `<span class="nf-medal-face">${anchor}</span><span class="sr-only">${MEDAL_NAMES[medal]} medal</span>` : '<span class="nf-medal-slot"></span>';
      board.querySelector('[data-best]').textContent = best;
      board.querySelector('.nf-new').hidden = !isBest;
      const totalEl = board.querySelector('[data-total]');
      // the score counts up on the card
      let shown = 0;
      totalEl.textContent = '0';
      if (quiet || total === 0) totalEl.textContent = String(total);
      else {
        const every = Math.max(16, Math.min(60, 900 / total));
        countTimer = setInterval(() => {
          shown = Math.min(total, shown + Math.max(1, Math.ceil(total / 40)));
          totalEl.textContent = String(shown);
          if (shown >= total) clearInterval(countTimer);
        }, every);
      }
      status.textContent = `${won ? 'Cleared' : 'Flight over'}. ${total} gates. Best ${best}.${medal ? ` ${MEDAL_NAMES[medal]} medal.` : ''}`;
      againBtn.focus({ preventScroll: true });
    }
    /** Place a bet and get the bird ready over the gates it lays out. */
    async function startBet() {
      if (busy || (phase !== 'title' && phase !== 'over')) return;
      const t = tryBet('flight', bet);
      if (!t) return;
      busy = true;
      startBtn.disabled = againBtn.disabled = true;
      const r = await engine.flightStart(t.amount, target);
      busy = false;
      startBtn.disabled = againBtn.disabled = false;
      if (!r?.ok) {
        serverRefused(t, r, bet);
        return;
      }
      store.confirm(t, r, { debited: t.amount });
      ticket = t;
      goal = r.target;
      if (destroyed) return forfeit();
      getReady(r.seed);
    }
    /** Leaving (or reloading) mid-flight gives the bet up. */
    function forfeit() {
      if (duelRun) {
        settleDuel();
        return;
      }
      const t = ticket;
      if (!t) return;
      ticket = null;
      const s = course.state;
      engine.flightEnd(s.start, s.flaps.slice(), s.flown).then((r) => {
        if (r?.ok) {
          store.confirm(t, r, { paid: r.payout });
          store.finish(t, r.entry);
        } else store.cancel(t);
      });
    }
    function hold() {
      if (phase !== 'flying' && phase !== 'ready') return;
      resumeTo = phase;
      cancelAnimationFrame(raf);
      show('paused');
      startBtn.focus({ preventScroll: true });
    }
    function resume() {
      show(resumeTo);
      field.focus({ preventScroll: true });
      run();
    }
    function primary() {
      if (phase === 'title' || phase === 'over') {
        if (mode === 'duel') return; // a challenge is posted or accepted from its buttons only
        mode === 'bet' ? startBet() : getReady();
      }
      else if (phase === 'paused') resume();
      else if (phase === 'ready') takeOff();
      else if (phase === 'flying') flap();
    }

    listen(startBtn, 'click', () => (phase === 'paused' ? resume() : mode === 'bet' ? startBet() : mode === 'duel' ? undefined : getReady()));
    listen(againBtn, 'click', () => (mode === 'duel' ? (clearInterval(countTimer), show('title')) : mode === 'bet' ? startBet() : getReady()));
    listen(changeBtn, 'click', () => {
      clearInterval(countTimer);
      show('title');
    });
    listen(pause, 'click', hold);
    listen(sound, 'click', () => {
      setSound(!soundOn());
      updateSound();
    });
    listen(field, 'pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary || e.target.closest('button,a,input,label,.nf-bet')) return;
      if (phase === 'ready' || phase === 'flying') {
        e.preventDefault();
        primary();
      } else if (phase === 'title' && mode === 'free') {
        e.preventDefault();
        getReady();
      }
    });
    for (const name of ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick']) listen(field, name, (e) => e.preventDefault(), { passive: false });
    listen(document, 'keydown', (e) => {
      if (e.metaKey || e.altKey || e.ctrlKey || document.querySelector('.modal-root, .drawer.is-open')) return;
      if ((e.code === 'KeyP' || e.code === 'Escape') && (phase === 'flying' || phase === 'ready')) {
        e.preventDefault();
        hold();
        return;
      }
      if (e.code !== 'Space' && e.code !== 'ArrowUp') return;
      if (e.target.closest?.('input,select,textarea')) return;
      if (e.target.closest?.('button,a') && e.code === 'Space') return;
      e.preventDefault();
      if (!e.repeat && phase !== 'falling') primary();
    });
    listen(document, 'visibilitychange', () => document.hidden && hold());
    listen(window, 'blur', hold);
    const observer = new ResizeObserver(() => (resize(), fitNav()));
    observer.observe(field);
    updateSound();
    show('title');
    resize();
    // the title screen keeps the quay rolling and the bird's wings beating
    run();

    // For automated play-tests.
    globalThis.__ccFlight = () => ({ phase, mode, goal, betting: !!ticket, ...course.state, gates: course.state.gates.map((g) => ({ ...g })), flaps: course.state.flaps.slice(), scale, worldTop, colLeft });

    // A bet flight left open by a reload can't be resumed: settle it.
    const left = store.takeRound('flight');
    if (left) {
      engine.flightEnd(0, [], 0).then((r) => {
        store.sync(r);
        store.refresh();
        if (r?.ok) toast('Your last bet flight ended when you left the harbor.', { iconName: 'info' });
      });
    }

    return () => {
      destroyed = true;
      if (ticket || duelRun) {
        forfeit();
        toast('You left the harbor, so that flight is over.', { iconName: 'info' });
      }
      duels.destroy();
      offBalance();
      offAccount();
      stopBal();
      clearTimeout(winTimer);
      clearTimeout(boardTimer);
      clearInterval(countTimer);
      cancelAnimationFrame(raf);
      observer.disconnect();
      events.abort();
      document.documentElement.classList.remove('flight-open');
    };
  },
};
