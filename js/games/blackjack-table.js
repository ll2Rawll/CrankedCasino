// Shared Blackjack tables: up to five players, one dealer, one six-deck shoe.
//
// The server runs the table (supabase/multiplayer.sql): betting closes 15 s after the first bet
// (sooner once every seat is in), players act in seat order with 20 s per decision, then the
// dealer plays and every hand settles with the solo game's rules and payouts. This module polls
// the table about once a second, deals the new cards it sees, and sends your bet and moves.
import { h, fmt, esc, reducedMotion } from '../util.js?v=0f27056399f9';
import { engine, errorText, MODE } from '../engine.js?v=0f27056399f9';
import { store, BetError } from '../store.js?v=0f27056399f9';
import { needAccount } from '../account.js?v=0f27056399f9';
import { parseCard } from '../math.js?v=0f27056399f9';
import { sfx, haptic } from '../sound.js?v=0f27056399f9';
import { burstAt, PALETTES } from '../fx.js?v=0f27056399f9';
import { tryBet, serverRefused, toast, betError, chipClass } from '../ui.js?v=0f27056399f9';
import { cardEl, reveal, setFace } from './cards.js?v=0f27056399f9';

const POLL_MS = 900;
const LOBBY_MS = 4000;
const HIDDEN = { r: 'A', s: 'spade' };
const STAMP = { win: 'Win', bj: 'Blackjack', push: 'Push', loss: 'Lose' };
const seatLabel = (i) => `Seat ${i + 1}`;

function chips(amount) {
  if (!(amount > 0)) return '';
  const out = [];
  let left = Math.floor(amount);
  for (const v of [500, 100, 25, 10, 5, 1]) while (left >= v && out.length < 5) { out.push(v); left -= v; }
  if (!out.length) out.push(1);
  return `<span class="stack">${out.reverse().map((v, i) => `<span class="mchip ${chipClass(v)}" style="--k:${i}"></span>`).join('')}</span>`;
}

export function blackjackTable({ stage, controls, bet }) {
  const online = MODE === 'server';
  const felt = h(`<div class="felt bjt-felt" hidden>
      <div class="bjt-head"><span class="bjt-name" data-name>Blackjack tables</span><span class="bjt-shoe-info" data-shoeinfo></span></div>
      <div class="bj-shoe bjt-shoe" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="bjt-dealer"><div class="bj-hand" data-dealer></div><div class="bj-badge" data-dtotal hidden></div></div>
      <div class="bjt-banner" data-banner aria-live="polite"></div>
      <div class="bjt-dock is-off" data-dock></div>
      <div class="bjt-clock" data-clock hidden><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><circle class="bjt-arc" cx="20" cy="20" r="17" pathLength="100"/></svg><b data-clocknum></b></div>
      <div class="bjt-seats" data-seats></div>
      <div class="bjt-lobby" data-lobby hidden></div>
    </div>`);
  const panel = h(`<div class="bjt-controls" hidden>
      <div class="bjt-where"><span><small>TABLE</small><b data-where>Not seated</b></span><button type="button" class="btn btn-outline bjt-leave" data-leave hidden>Leave</button></div>
      <button type="button" class="btn btn-primary btn-play bjt-place" data-place><span>Place bet</span></button>
      <div class="bj-actions bjt-actions">
        <button type="button" class="act" data-a="hit"><b>Hit</b><small>H</small></button>
        <button type="button" class="act" data-a="stand"><b>Stand</b><small>S</small></button>
        <button type="button" class="act" data-a="double"><b>Double</b><small>D</small></button>
        <button type="button" class="act" data-a="split"><b>Split</b><small>P</small></button>
      </div>
      <p class="hint bjt-hint">Everyone plays their own hand against the dealer. Normal payouts: blackjack 3 to 2, wins 1 to 1.</p>
    </div>`);
  stage.append(felt);
  controls.append(panel);
  const $ = (s) => felt.querySelector(s);
  const nameEl = $('[data-name]'), shoeInfo = $('[data-shoeinfo]'), shoeEl = $('.bjt-shoe');
  const dealerHand = $('[data-dealer]'), dTotal = $('[data-dtotal]'), banner = $('[data-banner]'), dock = $('[data-dock]');
  const clock = $('[data-clock]'), clockNum = $('[data-clocknum]'), seatsEl = $('[data-seats]'), lobbyEl = $('[data-lobby]');
  const whereEl = panel.querySelector('[data-where]'), leaveBtn = panel.querySelector('[data-leave]');
  const placeBtn = panel.querySelector('[data-place]'), actions = panel.querySelector('.bjt-actions');

  const seatEls = Array.from({ length: 5 }, (_, i) => {
    const el = h(`<div class="bjt-seat is-empty" data-seat="${i}">
        <div class="bjt-hands"></div>
        <div class="bjt-plate"><span class="bjt-avatar"></span><span class="bjt-who"><b></b><small></small></span><span class="bjt-bet"></span></div>
      </div>`);
    seatsEl.append(el);
    return el;
  });

  let tableId = null, table = null, serverNow = Date.now(), at = performance.now();
  let pollTimer = 0, lobbyTimer = 0, clockTimer = 0, visible = false, destroyed = false, sending = false;
  let ticket = null; // { t, round } for the bet riding on this round
  let rendered = Array(5).fill(null); // per seat: { key, hands: [[card codes]] , els: [[card els]] }
  let dealerShown = []; // card codes on screen ('??' for the hole card)
  let dealerKey = '';
  let lastTurnKey = '', settledRound = -1, lastTick = -1;
  const now = () => serverNow + performance.now() - at;
  const mySeat = () => (table && table.me != null ? table.seats[table.me] : null);

  // ---------------------------------------------------------- dealing
  let stagger = 0; // ms offset for the next card flight in this batch
  function fly(container, code, { delay = 0, double = false } = {}) {
    const down = code === '??';
    const card = down ? HIDDEN : parseCard(code);
    const el = cardEl(card, { down: true });
    el.style.setProperty('--k', container.children.length);
    if (double) el.classList.add('pc-double');
    container.append(el);
    const quick = reducedMotion();
    if (quick) {
      if (!down) reveal(el, card);
      return el;
    }
    const from = shoeEl.getBoundingClientRect(), to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(-70deg) scale(.6)`, opacity: 0 },
      { transform: `translate(0, 0) rotate(${(Math.random() - 0.5) * 5 + (double ? 90 : 0)}deg) scale(1)`, opacity: 1 },
    ], { duration: 360, delay, easing: 'cubic-bezier(.18,.8,.25,1)', fill: 'backwards' });
    setTimeout(() => {
      if (destroyed) return;
      sfx.card();
      if (!down) setTimeout(() => { if (!destroyed) { reveal(el, card); sfx.flip(); } }, 250);
    }, delay);
    return el;
  }
  const next = (gap = 150) => {
    const d = stagger;
    stagger += gap;
    return d;
  };

  function clearCards() {
    for (const el of seatEls) el.querySelector('.bjt-hands').innerHTML = '';
    dealerHand.innerHTML = '';
    dTotal.hidden = true;
    rendered = Array(5).fill(null);
    dealerShown = [];
  }

  // Bring the cards on the felt up to the server's table, dealing what's new in table order.
  function syncCards(t) {
    stagger = 0;
    const key = `${t.id}:${t.round}`;
    if (dealerKey !== key) {
      clearCards();
      dealerKey = key;
    }
    const seats = t.seats;
    // the first two cards go around the table one at a time, dealer between rounds of the deal
    const maxCards = Math.max(0, ...seats.map((s) => (s ? Math.max(0, ...s.hands.map((hd) => hd.cards.length)) : 0)));
    for (let k = 0; k < Math.max(2, maxCards); k++) {
      seats.forEach((s, i) => {
        if (!s) return;
        const el = seatEls[i].querySelector('.bjt-hands');
        let r = rendered[i];
        const rkey = `${s.name}:${t.round}`;
        if (!r || r.key !== rkey || r.hands.length > s.hands.length) {
          el.innerHTML = '';
          r = rendered[i] = { key: rkey, hands: [] };
        }
        // a split: rebuild that seat's hands from what's already there, then deal the rest
        if (s.hands.length === 2 && r.hands.length === 1) {
          el.innerHTML = '';
          r.hands = [];
          s.hands.forEach((hd, j) => {
            const box = h(`<div class="bjt-hand"><div class="bj-hand"></div><span class="bjt-total"></span></div>`);
            el.append(box);
            r.hands[j] = [hd.cards[0]];
            fly(box.firstElementChild, hd.cards[0]);
          });
        }
        s.hands.forEach((hd, j) => {
          let box = el.children[j];
          if (!box) {
            box = h(`<div class="bjt-hand"><div class="bj-hand"></div><span class="bjt-total"></span></div>`);
            el.append(box);
            r.hands[j] = [];
          }
          if (k < hd.cards.length && r.hands[j].length === k) {
            r.hands[j].push(hd.cards[k]);
            fly(box.firstElementChild, hd.cards[k], { delay: next(), double: hd.doubled && k === 2 });
          }
        });
      });
      // the dealer's card for this pass
      if (k < t.dealer.length && dealerShown.length === k) {
        dealerShown.push(t.dealer[k]);
        fly(dealerHand, t.dealer[k], { delay: next() });
      }
    }
    // the hole card turns over, then the dealer draws (slower, for the drama)
    if (dealerShown[1] === '??' && t.dealer[1] && t.dealer[1] !== '??') {
      const el = dealerHand.children[1];
      const card = parseCard(t.dealer[1]);
      const d = next(420);
      setTimeout(() => {
        if (destroyed || !el?.isConnected) return;
        setFace(el, card);
        reveal(el, card);
        sfx.flip();
      }, d);
      dealerShown[1] = t.dealer[1];
    }
    for (let k = dealerShown.length; k < t.dealer.length; k++) {
      dealerShown.push(t.dealer[k]);
      fly(dealerHand, t.dealer[k], { delay: next(480) });
    }
    return stagger;
  }

  // ---------------------------------------------------------- render
  function badge(el, total, soft, cls = '') {
    el.textContent = total ? (soft && total < 21 ? `${total - 10}/${total}` : String(total)) : '';
    el.className = `bjt-total${cls ? ` ${cls}` : ''}`;
    el.hidden = !total;
  }
  function render(t, { settleDelay = 0 } = {}) {
    nameEl.textContent = t.name;
    shoeInfo.textContent = `${Number(t.decks_left || 0).toFixed(1)} decks`;
    whereEl.textContent = `${t.name} · ${seatLabel(t.me ?? 0)}`;
    t.seats.forEach((s, i) => {
      const el = seatEls[i];
      el.className = 'bjt-seat';
      if (!s) {
        el.classList.add('is-empty');
        el.querySelector('.bjt-avatar').textContent = '+';
        el.querySelector('.bjt-who b').textContent = 'Open seat';
        el.querySelector('.bjt-who small').textContent = '';
        el.querySelector('.bjt-bet').innerHTML = '';
        return;
      }
      el.classList.toggle('is-me', s.me);
      el.classList.toggle('is-turn', t.phase === 'playing' && t.turn === i);
      el.classList.toggle('is-away', s.away || s.leaving);
      el.classList.toggle('is-out', !(s.bet > 0) && t.phase !== 'idle' && t.phase !== 'betting');
      el.querySelector('.bjt-avatar').textContent = (s.name || '?')[0].toUpperCase();
      el.querySelector('.bjt-who b').textContent = s.me ? `${s.name} (you)` : s.name;
      el.querySelector('.bjt-who small').textContent = s.leaving ? 'leaving' : s.away ? 'away' : t.phase === 'betting' && !(s.bet > 0) ? 'betting…' : s.bet > 0 ? `bet ${fmt(s.wagered)}` : t.phase === 'idle' ? 'ready' : 'sitting out';
      el.querySelector('.bjt-bet').innerHTML = chips(s.wagered);
      const boxes = el.querySelectorAll('.bjt-hand');
      s.hands.forEach((hd, j) => {
        const box = boxes[j];
        if (!box) return;
        box.classList.toggle('is-active', t.phase === 'playing' && t.turn === i && s.active === j && s.hands.length > 1);
        const tot = box.querySelector('.bjt-total');
        // totals and stamps wait for their cards to land
        const show = () => {
          badge(tot, hd.total, hd.soft, hd.total > 21 ? 'bust' : hd.cards.length === 2 && hd.total === 21 && s.hands.length === 1 ? 'bj' : '');
          const res = s.result?.[j];
          let st = box.querySelector('.bj-stamp');
          if (res && t.phase === 'done') {
            if (!st) {
              st = document.createElement('span');
              box.append(st);
            }
            const label = res.cls === 'loss' && hd.total > 21 ? 'Bust' : STAMP[res.cls] || res.label;
            st.className = `bj-stamp ${res.cls}`;
            st.textContent = res.cls === 'win' || res.cls === 'bj' ? `${label} +${fmt(res.pay - res.bet)}` : label;
          } else st?.remove();
        };
        if (settleDelay) setTimeout(() => !destroyed && show(), settleDelay);
        else show();
      });
    });
    const dt = () => {
      dTotal.hidden = t.dealer_total == null;
      dTotal.textContent = t.dealer_total ?? '';
      dTotal.className = `bj-badge${t.dealer_total > 21 ? ' bust' : ''}`;
    };
    if (settleDelay) setTimeout(() => !destroyed && dt(), settleDelay);
    else dt();
    renderControls(t);
    renderBanner(t);
  }

  function renderControls(t) {
    const me = mySeat();
    const can = t?.can || {};
    const myTurn = t && t.phase === 'playing' && t.turn === t.me;
    actions.querySelectorAll('[data-a]').forEach((b) => (b.disabled = sending || !myTurn || !can[b.dataset.a]));
    actions.hidden = !t;
    const canBet = !!t && !!me && (t.phase === 'idle' || t.phase === 'betting') && !(me.bet > 0);
    placeBtn.hidden = !t;
    placeBtn.disabled = sending || !canBet;
    placeBtn.innerHTML = !t ? '' : me?.bet > 0 && (t.phase === 'idle' || t.phase === 'betting')
      ? `<span>Bet placed</span><span class="sub">${fmt(me.bet)} · waiting for the deal</span>`
      : canBet ? `<span>Place bet</span><span class="sub">${fmt(bet.value)}</span>`
      : `<span>${t.phase === 'done' ? 'Next round soon' : 'Hand in play'}</span>`;
    leaveBtn.hidden = !tableId;
    bet.disable(!canBet && !!t);
    // The same moves on the felt itself, so a phone never scrolls mid-turn.
    const moves = myTurn ? ['hit', 'stand', 'double', 'split'].filter((a) => can[a]) : [];
    const key = sending ? 'busy' : canBet ? `bet:${bet.value}` : moves.join(',');
    if (dock.dataset.key !== key) {
      dock.dataset.key = key;
      dock.classList.toggle('is-off', !canBet && !moves.length);
      dock.innerHTML = canBet ? `<button type="button" class="bjt-dock-bet" data-dockbet>Bet ${fmt(bet.value)}</button>`
        : moves.map((a) => `<button type="button" data-a="${a}">${a[0].toUpperCase()}${a.slice(1)}</button>`).join('');
    }
  }

  function renderBanner(t) {
    let text = '', cls = '';
    const me = mySeat();
    if (t.phase === 'idle') text = me ? 'Place your bet' : 'Waiting for players';
    else if (t.phase === 'betting') text = me?.bet > 0 ? 'Waiting for the other bets' : 'Bets are open';
    else if (t.phase === 'playing') {
      const s = t.seats[t.turn];
      text = t.turn === t.me ? 'Your turn' : `${s?.name ?? 'Player'}’s turn`;
      cls = t.turn === t.me ? 'is-you' : '';
    } else if (t.phase === 'done') {
      if (me?.result) {
        const pay = Number(me.payout) || 0, staked = Number(me.wagered) || 0;
        text = pay > staked ? (me.result.some((r) => r.cls === 'bj') ? 'Blackjack!' : `You win +${fmt(pay - staked)}`) : pay === staked && pay > 0 ? 'Push' : 'Dealer wins';
        cls = pay > staked ? 'is-win' : pay === staked && pay > 0 ? '' : 'is-loss';
      } else text = 'Round over';
    }
    if (banner.dataset.text !== text) {
      banner.dataset.text = text;
      banner.className = `bjt-banner ${cls}`;
      banner.innerHTML = text ? `<span>${esc(text)}</span>` : '';
    }
  }

  // The countdown ring: betting window, the turn in play, or the pause before the next round.
  function tickClock() {
    if (!table || !table.deadline || table.phase === 'idle') {
      clock.hidden = true;
      return;
    }
    const total = table.phase === 'betting' ? 15000 : table.phase === 'playing' ? 20000 : 7000;
    const left = Math.max(0, table.deadline - now());
    clock.hidden = false;
    clock.className = `bjt-clock is-${table.phase}${table.phase === 'playing' && table.turn === table.me ? ' is-you' : ''}${left < 5000 && table.phase !== 'done' ? ' is-late' : ''}`;
    clock.style.setProperty('--left', String(Math.max(0, Math.min(100, (left / total) * 100))));
    const secs = Math.ceil(left / 1000);
    clockNum.textContent = String(secs);
    // a soft tick through your last five seconds
    if (table.phase === 'playing' && table.turn === table.me && secs <= 5 && secs !== lastTick && secs > 0) {
      lastTick = secs;
      sfx.tick?.(secs);
    }
  }

  // ---------------------------------------------------------- server replies
  function apply(r) {
    if (!r?.ok || !r.table) return;
    serverNow = r.server_now;
    at = performance.now();
    const t = r.table;
    const before = table;
    table = t;
    tableId = t.id;
    felt.classList.add('is-seated');
    lobbyEl.hidden = true;
    seatsEl.hidden = false;
    const wait = syncCards(t);
    const settling = t.phase === 'done' && before?.phase !== 'done';
    render(t, { settleDelay: settling ? wait + 300 : 0 });
    // your turn: a chime, and the buttons light up
    const turnKey = `${t.round}:${t.turn}:${t.seats[t.turn]?.active ?? 0}`;
    if (t.phase === 'playing' && t.turn === t.me && turnKey !== lastTurnKey) {
      sfx.chime?.();
      haptic(12);
      lastTick = -1;
    }
    lastTurnKey = t.phase === 'playing' ? turnKey : '';
    // the round settled: pay out the ticket and celebrate
    const me = mySeat();
    if (t.phase === 'done' && settledRound !== t.round && me?.result) {
      settledRound = t.round;
      const pay = Number(me.payout) || 0, staked = Number(me.wagered) || 0;
      const tk = ticket && ticket.round === t.round ? ticket.t : null;
      ticket = null;
      if (tk) {
        store.confirm(tk, r, { debited: staked, paid: pay });
        setTimeout(() => store.finish(tk, me.entry), wait + 300);
      } else store.sync(r);
      setTimeout(() => {
        if (destroyed) return;
        const mine = seatEls[t.me];
        if (pay > staked) {
          sfx.win(pay >= staked * 2.4 ? 2 : 1);
          burstAt(mine, { count: me.result.some((x) => x.cls === 'bj') ? 70 : 36, colors: PALETTES.gold });
          haptic([18, 30, 18]);
        } else if (pay < staked) sfx.lose();
      }, wait + 300);
    } else if (!ticket) store.sync(r);
    tickClock();
  }

  async function poll() {
    clearTimeout(pollTimer);
    if (!tableId || destroyed || !visible) return;
    const r = await engine.bjmState(tableId);
    if (destroyed || !visible) return;
    if (r?.ok) apply(r);
    else if (r?.error === 'table_missing') return leftTable('That table closed.');
    pollTimer = setTimeout(poll, document.hidden ? 4000 : POLL_MS);
  }

  // ---------------------------------------------------------- lobby
  async function lobby() {
    clearTimeout(lobbyTimer);
    if (tableId || destroyed || !visible) return;
    felt.classList.remove('is-seated');
    seatsEl.hidden = true;
    lobbyEl.hidden = false;
    nameEl.textContent = 'Blackjack tables';
    renderControls(null);
    whereEl.textContent = 'Not seated';
    if (!online) {
      lobbyEl.innerHTML = '<div class="bjt-empty"><b>Tables need the online casino</b><p>Shared tables run on the casino server.</p></div>';
      return;
    }
    if (!store.signedIn) {
      lobbyEl.innerHTML = '<div class="bjt-empty"><b>Sit down with other players</b><p>Log in to join a shared table.</p><button type="button" class="btn btn-primary" data-login>Log in</button></div>';
      return;
    }
    const r = await engine.bjmLobby();
    if (destroyed || tableId || !visible) return;
    if (r?.ok && r.mine) return join(r.mine);
    const tables = r?.ok ? r.tables : [];
    lobbyEl.innerHTML = `<div class="bjt-lobby-head"><b>Shared tables</b><p>Up to five players, one dealer. Everyone plays their own hand.</p>
        <button type="button" class="btn btn-primary bjt-quick" data-join="">Quick seat</button></div>
      <ul class="bjt-tables">${tables.length ? tables.map((x) => `<li>
          <span class="bjt-tname"><b>${esc(x.name)}</b><small>${x.players}/5 seated · ${x.phase === 'playing' ? 'hand in play' : x.phase === 'betting' ? 'taking bets' : x.phase === 'done' ? 'paying out' : 'waiting'}</small></span>
          <span class="bjt-tnames">${x.names.slice(0, 5).map((n) => `<i title="${esc(n)}">${esc(n[0].toUpperCase())}</i>`).join('')}</span>
          <button type="button" class="btn btn-outline" data-join="${x.id}" ${x.players >= 5 ? 'disabled' : ''}>${x.players >= 5 ? 'Full' : 'Sit'}</button></li>`).join('')
        : '<li class="bjt-none">No tables open yet. Quick seat starts one.</li>'}</ul>`;
    if (r && !r.ok && r.error !== 'auth') lobbyEl.querySelector('.bjt-none')?.replaceChildren(errorText(r));
    lobbyTimer = setTimeout(lobby, LOBBY_MS);
  }

  async function join(id) {
    if (!needAccount() || sending) return;
    sending = true;
    const r = await engine.bjmJoin(id || null);
    sending = false;
    if (destroyed) return;
    if (!r?.ok) {
      toast(errorText(r), { type: 'loss' });
      return lobby();
    }
    clearTimeout(lobbyTimer);
    sfx.chip?.();
    apply(r);
    poll();
  }

  function leftTable(message) {
    tableId = null;
    table = null;
    ticket = null;
    clearCards();
    dealerKey = '';
    if (message) toast(message, { iconName: 'info' });
    lobby();
  }

  async function leave() {
    if (!tableId || sending) return;
    const id = tableId;
    sending = true;
    const r = await engine.bjmLeave(id);
    sending = false;
    store.sync(r);
    if (ticket && table?.phase === 'betting') {
      store.cancel(ticket.t);
      ticket = null;
    }
    clearTimeout(pollTimer);
    leftTable(table?.phase === 'playing' ? 'You left. Your hand plays out and pays as usual.' : '');
  }

  // ---------------------------------------------------------- your moves
  async function placeBet() {
    if (!table || sending) return;
    const t = tryBet('blackjack', bet);
    if (!t) return;
    sending = true;
    renderControls(table);
    const r = await engine.bjmBet(tableId, t.amount);
    sending = false;
    if (destroyed) return;
    if (!r?.ok) {
      serverRefused(t, r, bet);
      return poll();
    }
    store.confirm(t, r, { debited: t.amount });
    ticket = { t, round: r.table.round };
    apply(r);
  }

  async function act(a) {
    if (!table || sending || table.phase !== 'playing' || table.turn !== table.me || !table.can?.[a]) return;
    const me = mySeat();
    const hand = me?.hands?.[me.active];
    const extra = a === 'double' || a === 'split' ? Number(hand?.bet) || 0 : 0;
    if (extra && ticket) {
      try {
        store.addToBet(ticket.t, extra);
      } catch (e) {
        if (e instanceof BetError) return betError('Not enough chips for that.');
        throw e;
      }
    }
    sending = true;
    renderControls(table);
    sfx.click();
    const r = await engine.bjmAct(tableId, a);
    sending = false;
    if (destroyed) return;
    if (!r?.ok) {
      if (extra && ticket) ticket.t.amount -= extra;
      store.sync(r);
      if (r?.error !== 'auth' && r?.error !== 'not_your_turn') toast(errorText(r), { type: 'loss' });
      if (r?.table) apply({ ...r, ok: true });
      return poll();
    }
    if (ticket) store.confirm(ticket.t, r, { debited: Number(r.table.seats[r.table.me]?.wagered) || ticket.t.amount });
    apply(r);
  }

  placeBtn.addEventListener('click', placeBet);
  leaveBtn.addEventListener('click', leave);
  actions.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b) act(b.dataset.a);
  });
  dock.addEventListener('click', (e) => {
    if (e.target.closest('[data-dockbet]')) return void placeBet();
    const b = e.target.closest('[data-a]');
    if (b) act(b.dataset.a);
  });
  lobbyEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-login]')) return void needAccount();
    const b = e.target.closest('[data-join]');
    if (b) join(b.dataset.join);
  });
  const onKey = (e) => {
    if (!visible || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input,textarea,select')) return;
    const a = { KeyH: 'hit', KeyS: 'stand', KeyD: 'double', KeyP: 'split' }[e.code];
    if (a && table?.turn === table?.me && table?.phase === 'playing') {
      e.preventDefault();
      act(a);
    }
  };
  document.addEventListener('keydown', onKey);
  const onVisible = () => {
    if (document.hidden || !visible) return;
    if (tableId) poll();
    else lobby();
  };
  document.addEventListener('visibilitychange', onVisible);
  const offAccount = engine.on((type) => {
    if (type === 'signedin' && visible && !tableId) lobby();
    if (type === 'signedout') leftTable('');
  });
  bet.el.addEventListener('change', () => table && renderControls(table));

  return {
    felt,
    panel,
    /** Switch the page to the shared tables (true) or back to solo (false). */
    show(on) {
      visible = on;
      felt.hidden = panel.hidden = !on;
      clearInterval(clockTimer);
      if (on) {
        clockTimer = setInterval(tickClock, 250);
        if (tableId) poll();
        else lobby();
      } else {
        clearTimeout(pollTimer);
        clearTimeout(lobbyTimer);
        // Back to solo: give up the seat (a hand in play still settles on the server).
        if (tableId) leave();
      }
    },
    get busy() {
      return !!ticket;
    },
    destroy() {
      destroyed = true;
      clearTimeout(pollTimer);
      clearTimeout(lobbyTimer);
      clearInterval(clockTimer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      offAccount();
      if (tableId) engine.bjmLeave(tableId).then((r) => store.sync(r));
    },
  };
}
