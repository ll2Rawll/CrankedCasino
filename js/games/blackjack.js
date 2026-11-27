// Blackjack: 6-deck shoe, dealer stands on soft 17, blackjack pays 3:2,
// double on any first two cards, one split (double after split allowed),
// insurance pays 2:1, dealer peeks for blackjack. ≈99.5% RTP with basic strategy.

import { h, fmt, round2, sleep, reducedMotion, esc } from '../util.js';
import { icon } from '../icons.js';
import { store, BetError } from '../store.js';
import { sfx, haptic } from '../sound.js';
import { burstAt, coinRain, PALETTES, shake } from '../fx.js';
import { gameFrame, betInput, toast, chipClass, chipLabel } from '../ui.js';
import { Shoe, cardEl, reveal, handValue, isBlackjack, cardValue } from './cards.js';

const shoe = new Shoe(6); // survives page switches, like a real table
globalThis.__ccShoe = shoe; // handy for testing in the console

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
    const renderShoe = () => (shoeInfo.textContent = `${shoe.decksLeft.toFixed(1)} decks in the shoe`);
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
      const hand = round && round.hands[round.active];
      const can = (a) => {
        if (busy || p !== 'player' || !hand) return false;
        const v = handValue(hand.cards).total;
        if (a === 'hit') return v < 21;
        if (a === 'stand') return true;
        if (a === 'double') return hand.cards.length === 2 && v < 21 && store.canAfford(hand.bet);
        if (a === 'split')
          return round.hands.length === 1 && hand.cards.length === 2 && cardValue(hand.cards[0]) === cardValue(hand.cards[1]) && store.canAfford(hand.bet);
        return false;
      };
      actions.querySelectorAll('[data-a]').forEach((b) => (b.disabled = !can(b.dataset.a)));
      actions.hidden = !round || p === 'done';
      insRow.hidden = p !== 'insurance';
      playBtn.hidden = !!round && p !== 'done';
      playBtn.disabled = busy;
      playBtn.querySelector('span').textContent = round?.phase === 'done' ? 'Deal again' : 'Deal';
      bet.disable(!!round && p !== 'done');
      if (p === 'insurance') insRow.querySelector('[data-ins="yes"]').textContent = `Insure · ${fmt(round.base / 2)}`;
    }

    // ---------------------------------------------------------- round flow
    async function deal() {
      if (busy || destroyed) return;
      if (round && round.phase !== 'done') return;
      const amount = bet.value;
      let t;
      try {
        t = store.placeBet('blackjack', amount);
      } catch (e) {
        if (e instanceof BetError) {
          bet.error();
          toast(store.balance < 1 && store.canRefill() ? 'Out of chips. Tap your stack to refill.' : e.message, { type: 'loss' });
          return;
        }
        throw e;
      }
      busy = true;
      sfx.bet();
      round = { t, base: t.amount, dealer: [], hands: [{ cards: [], bet: t.amount, done: false, doubled: false }], active: 0, insurance: 0, phase: 'dealing' };
      setButtons();
      msg('');
      await sweep();
      if (destroyed) return;
      spotStack.innerHTML = '';
      if (shoe.needsShuffle) {
        msg('Shuffling a fresh shoe…', 'info');
        shoeEl.classList.add('shuffling');
        sfx.shuffle();
        shoe.shuffle();
        await sleep(1100 * speed());
        shoeEl.classList.remove('shuffling');
        msg('');
      }
      const h0 = newHandEl(0);
      renderHands();
      const P = h0.querySelector('.bj-hand');
      const draw = () => shoe.draw();
      const c1 = draw();
      round.hands[0].cards.push(c1);
      await dealTo(P, c1);
      renderHands();
      const d1 = draw();
      round.dealer.push(d1);
      await dealTo(dealerHand, d1);
      renderDealer(false);
      const c2 = draw();
      round.hands[0].cards.push(c2);
      await dealTo(P, c2);
      renderHands();
      const d2 = draw();
      round.dealer.push(d2);
      round.holeEl = await dealTo(dealerHand, d2, { down: true });
      renderShoe();
      if (destroyed) return;

      const up = round.dealer[0];
      if (up.r === 'A' && store.canAfford(round.base / 2)) {
        round.phase = 'insurance';
        busy = false;
        msg('Insurance?', 'info');
        setButtons();
        return; // waits for the insurance buttons
      }
      await afterInsurance();
    }

    async function afterInsurance() {
      busy = true;
      setButtons();
      const up = round.dealer[0];
      // Dealer peeks with an ace or ten showing.
      if (up.r === 'A' || cardValue(up) === 10) {
        round.holeEl?.classList.add('peek');
        await sleep(650 * speed());
        round.holeEl?.classList.remove('peek');
        if (isBlackjack(round.dealer)) {
          await revealHole();
          msg('Dealer blackjack', 'loss');
          return settle();
        }
        if (round.insurance) {
          msg('No blackjack. Insurance lost.', 'info');
          await sleep(700 * speed());
        }
      }
      if (isBlackjack(round.hands[0].cards)) {
        await revealHole();
        return settle();
      }
      round.phase = 'player';
      busy = false;
      msg('');
      renderHands();
      setButtons();
    }

    async function revealHole() {
      if (!round.holeEl || !round.holeEl.classList.contains('is-down')) return;
      reveal(round.holeEl, round.dealer[1]);
      sfx.flip();
      renderDealer(true);
      await sleep(420 * speed());
    }

    async function act(a) {
      if (busy || !round || round.phase !== 'player') return;
      const hand = round.hands[round.active];
      const btn = actions.querySelector(`[data-a="${a}"]`);
      if (!btn || btn.disabled) return;
      busy = true;
      setButtons();
      sfx.click();
      const P = handEl(round.active).querySelector('.bj-hand');
      if (a === 'hit') {
        const c = shoe.draw();
        hand.cards.push(c);
        await dealTo(P, c);
        renderHands();
        const v = handValue(hand.cards).total;
        if (v > 21) {
          hand.done = true;
          sfx.lose();
          shake(handEl(round.active));
          stamp(round.active, 'Bust', 'loss');
          await sleep(500 * speed());
        } else if (v === 21) hand.done = true;
      } else if (a === 'stand') {
        hand.done = true;
      } else if (a === 'double') {
        try {
          store.addToBet(round.t, hand.bet);
        } catch {
          busy = false;
          return setButtons();
        }
        flyChips(document.getElementById('balanceBtn'), handEl(round.active).querySelector('.bj-bet'), hand.bet);
        hand.bet = round2(hand.bet * 2);
        hand.doubled = true;
        renderHands();
        const c = shoe.draw();
        hand.cards.push(c);
        await dealTo(P, c, { double: true });
        renderHands();
        hand.done = true;
        if (handValue(hand.cards).total > 21) {
          sfx.lose();
          stamp(round.active, 'Bust', 'loss');
          await sleep(400 * speed());
        }
      } else if (a === 'split') {
        try {
          store.addToBet(round.t, hand.bet);
        } catch {
          busy = false;
          return setButtons();
        }
        const moved = hand.cards.pop();
        const h1 = newHandEl(1);
        const movedEl = P.lastElementChild;
        const from = movedEl.getBoundingClientRect();
        movedEl.remove();
        const el = cardEl(moved);
        h1.querySelector('.bj-hand').append(el);
        const to = el.getBoundingClientRect();
        el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: 380 * speed(), easing: 'cubic-bezier(.2,.8,.2,1)' });
        round.hands.push({ cards: [moved], bet: hand.bet, done: false, doubled: false, split: true });
        hand.split = true;
        flyChips(document.getElementById('balanceBtn'), h1.querySelector('.bj-bet'), hand.bet);
        renderHands();
        sfx.chip();
        await sleep(420 * speed());
        // each split hand gets its second card
        for (const i of [0, 1]) {
          const c = shoe.draw();
          round.hands[i].cards.push(c);
          await dealTo(handEl(i).querySelector('.bj-hand'), c);
        }
        renderHands();
        if (moved.r === 'A') round.hands.forEach((x) => (x.done = true)); // split aces get one card each
        round.hands.forEach((x) => handValue(x.cards).total === 21 && (x.done = true));
      }
      renderShoe();
      // move to the next unfinished hand
      if (round.hands[round.active].done) {
        const next = round.hands.findIndex((x) => !x.done);
        if (next === -1) return dealerTurn();
        round.active = next;
      }
      busy = false;
      renderHands();
      setButtons();
    }

    async function dealerTurn() {
      round.phase = 'dealer';
      busy = true;
      renderHands();
      setButtons();
      await revealHole();
      const live = round.hands.some((x) => handValue(x.cards).total <= 21);
      if (live) {
        while (handValue(round.dealer).total < 17) {
          await sleep(320 * speed());
          if (destroyed) return;
          const c = shoe.draw();
          round.dealer.push(c);
          await dealTo(dealerHand, c);
          renderDealer(true);
        }
        renderShoe();
      }
      return settle();
    }

    function stamp(i, text, cls) {
      const el = handEl(i);
      if (!el) return;
      el.querySelector('.bj-stamp')?.remove();
      el.insertAdjacentHTML('beforeend', `<span class="bj-stamp ${cls}">${esc(text)}</span>`);
    }

    async function settle() {
      round.phase = 'settle';
      const d = handValue(round.dealer).total;
      const dealerBJ = isBlackjack(round.dealer);
      let total = 0;
      let wins = 0;
      let losses = 0;
      round.hands.forEach((hand, i) => {
        const v = handValue(hand.cards).total;
        const natural = isBlackjack(hand.cards) && round.hands.length === 1;
        let pay = 0;
        let label = '';
        let cls = '';
        if (natural && !dealerBJ) {
          pay = hand.bet * 2.5;
          label = `Blackjack +${fmt(hand.bet * 1.5)}`;
          cls = 'bj';
        } else if (natural && dealerBJ) {
          pay = hand.bet;
          label = 'Push';
          cls = 'push';
        } else if (v > 21) {
          label = 'Bust';
          cls = 'loss';
        } else if (dealerBJ) {
          label = 'Lose';
          cls = 'loss';
        } else if (d > 21 || v > d) {
          pay = hand.bet * 2;
          label = d > 21 ? `Dealer busts +${fmt(hand.bet)}` : `Win +${fmt(hand.bet)}`;
          cls = 'win';
        } else if (v === d) {
          pay = hand.bet;
          label = 'Push';
          cls = 'push';
        } else {
          label = 'Lose';
          cls = 'loss';
        }
        hand.payout = round2(pay);
        total += pay;
        if (pay > hand.bet) wins++;
        if (pay === 0) losses++;
        stamp(i, label, cls);
        const betSpot = handEl(i)?.querySelector('.bj-bet');
        if (pay === 0) flyChips(betSpot, trayEl, hand.bet, { fade: true });
        else if (pay > hand.bet) {
          flyChips(dealerHand, betSpot, pay - hand.bet);
          setTimeout(() => !destroyed && flyChips(betSpot, document.getElementById('balanceBtn'), pay, { fade: true }), 750);
        } else flyChips(betSpot, document.getElementById('balanceBtn'), pay, { fade: true });
      });
      if (round.insurance && dealerBJ) total += round.insurance * 3;
      total = round2(total);
      const t = round.t;
      round.phase = 'done';
      await sleep(250);
      store.finish(t, total, { info: `${round.hands.length > 1 ? 'split · ' : ''}dealer ${dealerBJ ? 'BJ' : d > 21 ? 'bust' : d}` });
      const naturalWin = round.hands.length === 1 && isBlackjack(round.hands[0].cards) && !dealerBJ;
      if (naturalWin) {
        msg('Blackjack!', 'bj');
        sfx.jackpot();
        coinRain(60);
        burstAt(handsEl, { count: 80, colors: PALETTES.gold, speed: [5, 14] });
        haptic([20, 40, 20]);
      } else if (wins) {
        msg(d > 21 ? 'Dealer busts!' : 'You win!', 'win');
        sfx.win(total >= t.amount * 2 ? 2 : 1);
        burstAt(handsEl, { count: 40, colors: PALETTES.win });
      } else if (total > 0 && total >= t.amount) {
        msg(round.insurance && dealerBJ ? 'Insurance paid' : 'Push', 'info');
        sfx.click();
      } else {
        msg(dealerBJ ? 'Dealer blackjack' : 'House wins', 'loss');
        sfx.lose();
      }
      busy = false;
      setButtons();
      renderHands();
    }

    // ---------------------------------------------------------- input
    playBtn.addEventListener('click', deal);
    actions.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) act(b.dataset.a);
    });
    insRow.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ins]');
      if (!b || !round || round.phase !== 'insurance') return;
      if (b.dataset.ins === 'yes') {
        const ins = round2(round.base / 2);
        try {
          store.addToBet(round.t, ins);
          round.insurance = ins;
          sfx.chip();
          flyChips(document.getElementById('balanceBtn'), dealerHand, ins);
        } catch {
          /* not enough chips: carry on without */
        }
      } else sfx.click();
      round.phase = 'peek';
      await afterInsurance();
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
    setButtons();

    return () => {
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      // Leaving mid-hand: stand everything and let the dealer finish instantly.
      if (round && round.phase !== 'done' && !round.t.done) {
        if (round.phase === 'insurance' || round.phase === 'dealing') {
          while (round.hands[0].cards.length < 2) round.hands[0].cards.push(shoe.draw());
          while (round.dealer.length < 2) round.dealer.push(shoe.draw());
        }
        const live = round.hands.some((x) => handValue(x.cards).total <= 21);
        if (live && !isBlackjack(round.dealer)) while (handValue(round.dealer).total < 17) round.dealer.push(shoe.draw());
        const d = handValue(round.dealer).total;
        const dealerBJ = isBlackjack(round.dealer);
        let total = 0;
        for (const hand of round.hands) {
          const v = handValue(hand.cards).total;
          const natural = isBlackjack(hand.cards) && round.hands.length === 1;
          if (natural && !dealerBJ) total += hand.bet * 2.5;
          else if (natural && dealerBJ) total += hand.bet;
          else if (v > 21 || dealerBJ) total += 0;
          else if (d > 21 || v > d) total += hand.bet * 2;
          else if (v === d) total += hand.bet;
        }
        if (round.insurance && dealerBJ) total += round.insurance * 3;
        store.finish(round.t, round2(total), { info: 'auto-settled' });
      }
      document.querySelectorAll('.mchip.fly').forEach((c) => c.remove());
      frame.destroy();
    };
  },
};
