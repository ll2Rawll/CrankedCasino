// Blackjack: 6-deck shoe, dealer stands on soft 17, blackjack pays 3:2,
// double on any first two cards, one split (double after split allowed),
// insurance pays 2:1, dealer peeks for blackjack. ≈99.5% RTP with basic strategy.
//
// The server holds the shoe and the dealer's hole card and plays the dealer's hand;
// this page deals out the events it sends back, card by card.

import { h, fmt, round2, sleep, reducedMotion, esc } from '../util.js?v=a65f52998e3f';
import { icon } from '../icons.js?v=a65f52998e3f';
import { store, BetError } from '../store.js?v=a65f52998e3f';
import { engine, errorText } from '../engine.js?v=a65f52998e3f';
import { needAccount } from '../account.js?v=a65f52998e3f';
import { parseCard } from '../math.js?v=a65f52998e3f';
import { sfx, haptic } from '../sound.js?v=a65f52998e3f';
import { burstAt, coinRain, PALETTES, shake } from '../fx.js?v=a65f52998e3f';
import { gameFrame, betInput, toast, betError, serverRefused, chipClass, chipLabel } from '../ui.js?v=a65f52998e3f';
import { cardEl, reveal, setFace, handValue, isBlackjack } from './cards.js?v=a65f52998e3f';

const HIDDEN = { r: 'A', s: 'spade' }; // placeholder face for the dealer's hole card (never shown)

const RULES = `
  <ol class="rules">
    <li>Stack chips with the rack (or type an amount) and press <strong>Deal</strong>.</li>
    <li>Get closer to 21 than the dealer without going over. Picture cards count 10, aces 1 or 11.</li>
    <li><strong>Hit</strong> for another card, <strong>Stand</strong> to stop, <strong>Double</strong> to double your bet for exactly one more card, <strong>Split</strong> a pair into two hands.</li>
    <li>Dealer draws to 16 and stands on all 17s. Blackjack pays <strong>3 to 2</strong>, insurance pays 2 to 1 when the dealer shows an ace.</li>
  </ol>
  <p class="dim" style="margin-top:14px;font-size:14px">Six-deck shoe, reshuffled at the cut card. Shortcuts: <kbd>Space</kbd> deal · <kbd>H</kbd> hit · <kbd>S</kbd> stand · <kbd>D</kbd> double · <kbd>P</kbd> split.</p>`;

function breakdown(amount) {
  const out = [];
  let left = Math.floor(amount);
  for (const v of [500, 100, 25, 10, 5, 1]) {
    while (left >= v && out.length < 7) {
      out.push(v);
      left -= v;
    }
  }
  if (!out.length && amount > 0) out.push(1);
  return out;
}
function stackHTML(amount, { label = true } = {}) {
  if (!(amount > 0)) return '';
  const chips = breakdown(amount)
    .reverse()
    .map((v, i) => `<span class="mchip ${chipClass(v)}" style="--k:${i}"></span>`)
    .join('');
  return `<span class="stack">${chips}</span>${label ? `<span class="stack-amt tnum">${fmt(amount)}</span>` : ''}`;
}

export default {
  title: 'Blackjack',
  mount(view) {
    const frame = gameFrame(view, { game: 'blackjack', title: 'Blackjack', kicker: 'Six-deck shoe · 3 to 2', tags: ['≈99.5% RTP', 'S17 · DAS'], rules: RULES });
    const { stage, controls } = frame;
    let destroyed = false;
    let busy = false; // animations in flight
    let round = null;

    // ---------------------------------------------------------- table
    stage.classList.add('bj-stage');
    stage.innerHTML = `
      <div class="felt bj-felt">
        <svg class="felt-print" viewBox="0 0 400 220" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
          <defs><path id="bj-arc" d="M30 112 Q200 200 370 112"/><path id="bj-arc2" d="M18 136 Q200 226 382 136"/></defs>
          <text class="fp-big"><textPath href="#bj-arc" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
          <text class="fp-small"><textPath href="#bj-arc2" startOffset="50%" text-anchor="middle">Dealer stands on all 17s · Insurance pays 2 to 1</textPath></text>
        </svg>
        <div class="bj-shoe" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="bj-tray" aria-hidden="true"></div>
        <div class="bj-dealer">
          <div class="bj-hand" data-dealer></div>
          <div class="bj-badge" data-dtotal hidden></div>
        </div>
        <div class="bj-msg" aria-live="polite"></div>
        <div class="bj-hands" data-hands></div>
        <div class="bj-spot" data-spot><span class="spot-ring"></span><span class="spot-label">BET</span><span class="spot-stack" data-spotstack></span></div>
        <div class="bj-shoe-info dim" data-shoeinfo></div>
      </div>`;
    const felt = stage.querySelector('.bj-felt');
    const shoeEl = stage.querySelector('.bj-shoe');
    const trayEl = stage.querySelector('.bj-tray');
    const dealerHand = stage.querySelector('[data-dealer]');
    const dTotal = stage.querySelector('[data-dtotal]');
    const msgEl = stage.querySelector('.bj-msg');
    const handsEl = stage.querySelector('[data-hands]');
    const spot = stage.querySelector('[data-spot]');
    const spotStack = stage.querySelector('[data-spotstack]');
    const shoeInfo = stage.querySelector('[data-shoeinfo]');

    // ---------------------------------------------------------- controls
    controls.innerHTML = '';
    const bet = betInput('blackjack');
    const actions = h(`
      <div class="bj-actions">
        <button type="button" class="act" data-a="hit"><b>Hit</b><small>H</small></button>
        <button type="button" class="act" data-a="stand"><b>Stand</b><small>S</small></button>
        <button type="button" class="act" data-a="double"><b>Double</b><small>D</small></button>
        <button type="button" class="act" data-a="split"><b>Split</b><small>P</small></button>
      </div>`);
    const playBtn = h(`<button type="button" class="btn btn-primary btn-play">${icon('cards')}<span>Deal</span></button>`);
    const insRow = h(`<div class="bj-ins" hidden><p>Dealer shows an ace. <strong>Insurance?</strong></p><div class="row2"><button type="button" class="btn btn-primary" data-ins="yes">Yes</button><button type="button" class="btn btn-outline" data-ins="no">No thanks</button></div></div>`);
    controls.append(bet.el, playBtn, insRow, actions, h(`<p class="hint"><kbd>Space</kbd> deal · <kbd>H</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>P</kbd></p>`));

    const renderSpot = () => {
      spotStack.innerHTML = round ? '' : stackHTML(bet.value);
    };
    bet.el.addEventListener('change', renderSpot);
    bet.el.querySelector('input').addEventListener('input', renderSpot);
    renderSpot();
    let decksLeft = 6;
    const renderShoe = () => (shoeInfo.textContent = `${Number(decksLeft).toFixed(1)} decks in the shoe`);
    renderShoe();

    const msg = (text, cls = '') => {
      msgEl.className = `bj-msg ${cls}`;
      msgEl.innerHTML = text ? `<span>${text}</span>` : '';
    };

    // ---------------------------------------------------------- card motion
    const speed = () => (reducedMotion() ? 0.3 : 1);
    async function dealTo(container, card, { down = false, double = false } = {}) {
      const el = cardEl(card, { down: true });
      const k = container.children.length;
      el.style.setProperty('--k', k);
      const rot = (Math.random() - 0.5) * 5;
      if (double) el.classList.add('pc-double');
      container.append(el);
      const from = shoeEl.getBoundingClientRect();
      const to = el.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      sfx.card();
      const dur = 430 * speed();
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) rotate(-75deg) scale(.7)`, opacity: 0.6 },
          { transform: `translate(0, 0) rotate(${rot + (double ? 90 : 0)}deg) scale(1)`, opacity: 1 },
        ],
        { duration: dur, easing: 'cubic-bezier(.18,.8,.25,1)', fill: 'forwards' },
      );
      await sleep(dur * 0.75);
      if (!down) {
        reveal(el, card);
        sfx.flip();
      }
      await sleep(180 * speed());
      return el;
    }

    async function sweep() {
      const cards = [...stage.querySelectorAll('.pcard')];
      if (!cards.length) return;
      const to = trayEl.getBoundingClientRect();
      sfx.whoosh();
      cards.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        el.animate([{ transform: getComputedStyle(el).transform === 'none' ? 'none' : getComputedStyle(el).transform, opacity: 1 }, { transform: `translate(${to.left - r.left}px, ${to.top - r.top}px) rotate(${120 + i * 9}deg) scale(.6)`, opacity: 0 }], {
          duration: 420 * speed(),
          delay: i * 25,
          easing: 'cubic-bezier(.6,0,.4,1)',
          fill: 'forwards',
        });
      });
      await sleep((460 + cards.length * 25) * speed());
      dealerHand.innerHTML = '';
      handsEl.innerHTML = '';
      dTotal.hidden = true;
    }

    // Chips travelling between the hands, the dealer and your stack.
    function flyChips(fromEl, toEl, amount, { fade = false } = {}) {
      if (!fromEl || !toEl || !(amount > 0)) return;
      const a = fromEl.getBoundingClientRect();
      const b = toEl.getBoundingClientRect();
      breakdown(amount)
        .slice(0, 6)
        .forEach((v, i) => {
          const c = document.createElement('span');
          c.className = `mchip fly ${chipClass(v)}`;
          c.style.left = `${a.left + a.width / 2 - 13}px`;
          c.style.top = `${a.top + a.height / 2 - 13}px`;
          document.body.append(c);
          c.animate(
            [
              { transform: 'translate(0,0) scale(1)', opacity: 1 },
              { transform: `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2) - 20}px) scale(1.1)`, opacity: 1, offset: 0.6 },
              { transform: `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${fade ? 0.5 : 0.9})`, opacity: fade ? 0 : 0.9 },
            ],
            { duration: 650 * speed() + i * 60, delay: i * 70, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' },
          ).onfinish = () => c.remove();
          setTimeout(() => sfx.chip(), i * 70 + 300);
        });
    }

    // ---------------------------------------------------------- rendering
    function handEl(i) {
      return handsEl.querySelector(`[data-h="${i}"]`);
    }
    function renderHands() {
      if (!round) return;
      round.hands.forEach((hand, i) => {
        const el = handEl(i);
        if (!el) return;
        el.classList.toggle('is-active', round.phase === 'player' && round.active === i && round.hands.length > 1);
        const v = handValue(hand.cards);
        const badge = el.querySelector('.bj-badge');
        if (hand.cards.length) {
          badge.hidden = false;
          const bj = isBlackjack(hand.cards) && round.hands.length === 1;
          badge.className = `bj-badge ${v.total > 21 ? 'bust' : bj ? 'bj' : v.total === 21 ? 'gold' : ''}`;
          badge.textContent = bj ? 'BJ' : v.total > 21 ? `${v.total}` : v.soft && v.total < 21 ? `${v.total - 10} / ${v.total}` : `${v.total}`;
        }
        el.querySelector('.bj-bet').innerHTML = stackHTML(hand.bet);
      });
    }
    function renderDealer(showAll) {
      if (!round) return;
      const cards = showAll ? round.dealer : round.dealer.slice(0, 1);
      if (!cards.length) return;
      const v = handValue(cards);
      dTotal.hidden = false;
      dTotal.className = `bj-badge ${v.total > 21 ? 'bust' : showAll && isBlackjack(round.dealer) ? 'bj' : ''}`;
      dTotal.textContent = showAll && isBlackjack(round.dealer) ? 'BJ' : v.soft && v.total < 21 && showAll ? `${v.total - 10} / ${v.total}` : `${v.total}`;
    }
    function newHandEl(i) {
      const el = h(`<div class="bj-phand" data-h="${i}"><div class="bj-hand"></div><div class="bj-badge" hidden></div><div class="bj-bet"></div></div>`);
      handsEl.append(el);
      return el;
    }

    function setButtons() {
      const p = round?.phase;
      // The server says which moves are legal for the hand in play.
      const can = (a) => !busy && p === 'player' && !!round.can?.[a];
      actions.querySelectorAll('[data-a]').forEach((b) => (b.disabled = !can(b.dataset.a)));
      actions.hidden = !round || p === 'done';
      insRow.hidden = p !== 'insurance';
      insRow.querySelectorAll('button').forEach((b) => (b.disabled = busy));
      playBtn.hidden = !!round && p !== 'done';
      playBtn.disabled = busy;
      playBtn.querySelector('span').textContent = round?.phase === 'done' ? 'Deal again' : 'Deal';
      bet.disable(!!round && p !== 'done');
      if (p === 'insurance') insRow.querySelector('[data-ins="yes"]').textContent = `Insure · ${fmt(round.base / 2)}`;
    }

    // ---------------------------------------------------------- round flow
    const balanceEl = () => document.getElementById('balanceBtn');
    let lastView = null;

    /** Deal out what the server did, one card at a time. */
    async function play(events = []) {
      for (const ev of events) {
        if (destroyed) return;
        if (ev.t === 'shuffle') {
          msg('Shuffling a fresh shoe…', 'info');
          shoeEl.classList.add('shuffling');
          sfx.shuffle();
          await sleep(1100 * speed());
          shoeEl.classList.remove('shuffling');
          msg('');
        } else if (ev.t === 'p') {
          const i = ev.h - 1;
          const hand = round.hands[i];
          const el = handEl(i);
          if (!hand || !el) continue;
          const c = parseCard(ev.c);
          if (ev.x) {
            flyChips(balanceEl(), el.querySelector('.bj-bet'), hand.bet);
            hand.bet = round2(hand.bet * 2);
            hand.doubled = true;
            renderHands();
          }
          hand.cards.push(c);
          await dealTo(el.querySelector('.bj-hand'), c, { double: !!ev.x });
          renderHands();
          if (handValue(hand.cards).total > 21) {
            sfx.lose();
            shake(el);
            stamp(i, 'Bust', 'loss');
            await sleep(450 * speed());
          }
        } else if (ev.t === 'd') {
          if (ev.c === '??') {
            round.dealer.push(HIDDEN);
            round.holeEl = await dealTo(dealerHand, HIDDEN, { down: true });
          } else {
            if (round.revealed) await sleep(320 * speed());
            const c = parseCard(ev.c);
            round.dealer.push(c);
            await dealTo(dealerHand, c);
            renderDealer(round.revealed);
          }
        } else if (ev.t === 'peek') {
          round.holeEl?.classList.add('peek');
          await sleep(650 * speed());
          round.holeEl?.classList.remove('peek');
        } else if (ev.t === 'reveal') {
          const c = parseCard(ev.c);
          round.dealer[1] = c;
          round.revealed = true;
          if (round.holeEl) {
            setFace(round.holeEl, c);
            reveal(round.holeEl, c);
            sfx.flip();
          }
          renderDealer(true);
          await sleep(420 * speed());
        } else if (ev.t === 'split') {
          const hand = round.hands[0];
          const moved = hand.cards.pop();
          const P = handEl(0).querySelector('.bj-hand');
          const movedEl = P.lastElementChild;
          const from = movedEl.getBoundingClientRect();
          movedEl.remove();
          const h1 = newHandEl(1);
          const el = cardEl(moved);
          h1.querySelector('.bj-hand').append(el);
          const to = el.getBoundingClientRect();
          el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: 380 * speed(), easing: 'cubic-bezier(.2,.8,.2,1)' });
          round.hands.push({ cards: [moved], bet: hand.bet, done: false, doubled: false });
          flyChips(balanceEl(), h1.querySelector('.bj-bet'), hand.bet);
          renderHands();
          sfx.chip();
          await sleep(420 * speed());
        }
      }
    }

    /** Take the server's view of the table as the truth. */
    function syncView(v) {
      lastView = v;
      round.phase = v.phase;
      round.active = Math.max(0, (v.active || 1) - 1);
      round.can = v.can || {};
      round.base = v.base;
      round.insurance = v.insurance || 0;
      v.hands.forEach((hv, i) => {
        const hand = round.hands[i];
        if (!hand) return;
        hand.bet = hv.bet;
        hand.done = hv.done;
        hand.doubled = hv.doubled;
      });
      if (v.decks_left != null) decksLeft = v.decks_left;
      renderShoe();
    }

    /** The page went away while a reply was playing: settle up or keep the hand for later. */
    function leaveWith(v) {
      if (!round || round.t.done) return;
      if (v?.ok && v.phase === 'done') store.finish(round.t, v.entry);
      else {
        store.cancel(round.t);
        if (v?.ok) store.state.rounds.blackjack = v;
      }
    }

    async function after(v) {
      syncView(v);
      if (v.phase === 'done') return finishRound(v);
      busy = false;
      if (v.phase === 'insurance') msg('Insurance?', 'info');
      else msg('');
      renderHands();
      setButtons();
    }

    async function deal() {
      if (busy || destroyed) return;
      if (round && round.phase !== 'done') return;
      if (!needAccount()) return;
      let t;
      try {
        t = store.placeBet('blackjack', bet.value);
      } catch (e) {
        if (e instanceof BetError) {
          bet.error();
          betError(e.message);
          return;
        }
        throw e;
      }
      busy = true;
      sfx.bet();
      round = { t, base: t.amount, dealer: [], revealed: false, hands: [{ cards: [], bet: t.amount, done: false, doubled: false }], active: 0, insurance: 0, phase: 'dealing', can: {}, holeEl: null };
      setButtons();
      msg('');
      const req = engine.bjDeal(t.amount);
      await sweep();
      const v = await req;
      if (!v?.ok) {
        round = null;
        busy = false;
        if (v?.error === 'round_active' && v.round) {
          store.cancel(t);
          if (!destroyed) restore(v.round);
          return;
        }
        serverRefused(t, v, bet);
        if (!destroyed) {
          setButtons();
          renderSpot();
        }
        return;
      }
      store.confirm(t, v, { debited: v.wagered ?? t.amount, paid: v.phase === 'done' ? v.payout : undefined });
      if (destroyed) return leaveWith(v);
      spotStack.innerHTML = '';
      newHandEl(0);
      renderHands();
      await play(v.events);
      if (destroyed) return leaveWith(v);
      await after(v);
    }

    async function act(a) {
      if (busy || !round || round.phase !== 'player' || !round.can?.[a]) return;
      const btn = actions.querySelector(`[data-a="${a}"]`);
      if (!btn || btn.disabled) return;
      busy = true;
      setButtons();
      sfx.click();
      const before = round.t.amount;
      if (a === 'double' || a === 'split') {
        try {
          store.addToBet(round.t, round.hands[round.active].bet);
        } catch {
          busy = false;
          betError('Not enough chips for that.');
          return setButtons();
        }
      }
      const v = await engine.bjAct(a);
      if (!v?.ok) {
        round.t.amount = before;
        store.sync(v);
        busy = false;
        if (v?.error === 'no_round') {
          store.cancel(round.t);
          round = null;
          store.refresh();
          toast('That hand already finished on another screen.', { iconName: 'info' });
        } else if (v?.error !== 'auth') toast(errorText(v), { type: 'loss' });
        if (!destroyed) setButtons();
        return;
      }
      store.confirm(round.t, v, { debited: v.wagered, paid: v.phase === 'done' ? v.payout : undefined });
      if (destroyed) return leaveWith(v);
      await play(v.events);
      if (destroyed) return leaveWith(v);
      await after(v);
    }

    async function insure(yes) {
      if (busy || !round || round.phase !== 'insurance') return;
      busy = true;
      setButtons();
      let added = 0;
      if (yes) {
        const ins = round2(round.base / 2);
        try {
          store.addToBet(round.t, ins);
          added = ins;
          sfx.chip();
          flyChips(balanceEl(), dealerHand, ins);
        } catch {
          yes = false; // not enough chips: carry on without
        }
      } else sfx.click();
      const v = await engine.bjAct(yes ? 'insure' : 'noinsure');
      if (!v?.ok) {
        if (added) round.t.amount = round2(round.t.amount - added);
        store.sync(v);
        busy = false;
        if (v?.error !== 'auth') toast(errorText(v), { type: 'loss' });
        if (!destroyed) setButtons();
        return;
      }
      store.confirm(round.t, v, { debited: v.wagered, paid: v.phase === 'done' ? v.payout : undefined });
      round.insurance = v.insurance || 0;
      if (destroyed) return leaveWith(v);
      await play(v.events);
      if (destroyed) return leaveWith(v);
      if (v.phase === 'player' && round.insurance > 0) {
        msg('No blackjack. Insurance lost.', 'info');
        await sleep(700 * speed());
      }
      await after(v);
    }

    function stamp(i, text, cls) {
      const el = handEl(i);
      if (!el) return;
      el.querySelector('.bj-stamp')?.remove();
      el.insertAdjacentHTML('beforeend', `<span class="bj-stamp ${cls}">${esc(text)}</span>`);
    }

    async function finishRound(v) {
      round.phase = 'done';
      const d = handValue(round.dealer).total;
      const dealerBJ = !!v.dealer_bj;
      let wins = 0;
      (v.results || []).forEach((res, i) => {
        const label = res.cls === 'bj' ? `Blackjack +${fmt(res.bet * 1.5)}` : res.cls === 'win' ? `${d > 21 ? 'Dealer busts' : 'Win'} +${fmt(res.bet)}` : res.label;
        stamp(i, label, res.cls);
        if (res.pay > res.bet) wins++;
        const betSpot = handEl(i)?.querySelector('.bj-bet');
        if (res.pay === 0) flyChips(betSpot, trayEl, res.bet, { fade: true });
        else if (res.pay > res.bet) {
          flyChips(dealerHand, betSpot, res.pay - res.bet);
          setTimeout(() => !destroyed && flyChips(betSpot, balanceEl(), res.pay, { fade: true }), 750);
        } else flyChips(betSpot, balanceEl(), res.pay, { fade: true });
      });
      const total = v.payout;
      const t = round.t;
      await sleep(250);
      store.finish(t, v.entry);
      if (destroyed) return;
      const naturalWin = round.hands.length === 1 && v.results?.[0]?.cls === 'bj';
      if (naturalWin) {
        msg('Blackjack!', 'bj');
        sfx.jackpot();
        coinRain(60);
        burstAt(handsEl, { count: 80, colors: PALETTES.gold, speed: [5, 14] });
        haptic([20, 40, 20]);
      } else if (wins) {
        msg(d > 21 ? 'Dealer busts!' : 'You win!', 'win');
        sfx.win(total >= v.wagered * 2 ? 2 : 1);
        burstAt(handsEl, { count: 40, colors: PALETTES.win });
      } else if (total > 0 && total >= v.wagered) {
        msg(v.insurance_paid ? 'Insurance paid' : 'Push', 'info');
        sfx.click();
      } else {
        msg(dealerBJ ? 'Dealer blackjack' : 'House wins', 'loss');
        sfx.lose();
      }
      busy = false;
      setButtons();
      renderHands();
    }

    /** Lay out a hand still open on the server (after a reload or a trip to another game). */
    function restore(v) {
      if (!v || !v.ok || v.phase === 'done') return;
      const t = store.resume('blackjack', v.wagered ?? v.base);
      round = { t, base: v.base, dealer: [], revealed: v.dealer[1] !== '??', hands: [], active: 0, insurance: 0, phase: v.phase, can: {}, holeEl: null };
      dealerHand.innerHTML = '';
      handsEl.innerHTML = '';
      v.dealer.forEach((c, i) => {
        const card = c === '??' ? HIDDEN : parseCard(c);
        round.dealer.push(card);
        const el = cardEl(card, { down: c === '??' });
        el.style.setProperty('--k', i);
        dealerHand.append(el);
        if (c === '??') round.holeEl = el;
      });
      v.hands.forEach((hv, i) => {
        const el = newHandEl(i);
        const hand = { cards: hv.cards.map(parseCard), bet: hv.bet, done: hv.done, doubled: hv.doubled };
        round.hands.push(hand);
        hand.cards.forEach((c, k) => {
          const ce = cardEl(c);
          ce.style.setProperty('--k', k);
          if (hv.doubled && k === hand.cards.length - 1) {
            ce.classList.add('pc-double');
            ce.style.transform = 'rotate(90deg)';
          }
          el.querySelector('.bj-hand').append(ce);
        });
      });
      spotStack.innerHTML = '';
      syncView(v);
      renderDealer(round.revealed);
      renderHands();
      msg(v.phase === 'insurance' ? 'Insurance?' : '', 'info');
      setButtons();
      toast('Picked up your hand where you left off.', { iconName: 'refresh' });
    }

    // ---------------------------------------------------------- input
    playBtn.addEventListener('click', deal);
    actions.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) act(b.dataset.a);
    });
    insRow.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ins]');
      if (b) insure(b.dataset.ins === 'yes');
    });
    const onKey = (e) => {
      if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        if (!round || round.phase === 'done') deal();
        else if (round.phase === 'player') act('stand');
      }
      if (k === 'h') act('hit');
      if (k === 's') act('stand');
      if (k === 'd') act('double');
      if (k === 'p') act('split');
    };
    document.addEventListener('keydown', onKey);
    restore(store.takeRound('blackjack'));
    setButtons();

    return () => {
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      // Leaving mid-hand: the hand waits on the server and comes back next visit.
      if (round && round.phase !== 'done' && !round.t.done && !busy) {
        store.cancel(round.t);
        if (lastView) store.state.rounds.blackjack = lastView;
        toast('Your hand is saved. Come back to Blackjack to finish it.', { iconName: 'cards', timeout: 4200 });
      }
      document.querySelectorAll('.mchip.fly').forEach((c) => c.remove());
      frame.destroy();
    };
  },
};
