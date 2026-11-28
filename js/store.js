// The player's chips and stats, as the player sees them.
//
// The casino server (engine.js) owns the real balance. This keeps the copy on
// screen, which trails the server while animations play so a win isn't spoiled
// before the ball lands:
//
//   const t = store.placeBet('plinko', 10)          // chips leave the shown balance at once
//   const r = await engine.plinko(10, 'low', 8)     // the server settles the bet
//   store.confirm(t, r, { paid: r.payout })         // server balance known; the win stays hidden
//   ...animation...
//   store.finish(t, r.entry)                        // the win lands as the player sees it
//
// Shown balance = server balance − chips the server hasn't taken yet − wins not yet revealed.

import { round2 } from './util.js?v=cab8bd999107';
import { engine } from './engine.js?v=cab8bd999107';

export const GAMES = ['blackjack', 'roulette', 'slots', 'crash', 'plinko', 'mines', 'rooster', 'flight', 'cases'];
const HISTORY_MAX = 40;

export class BetError extends Error {}

const blankStats = () => ({ bets: 0, wins: 0, wagered: 0, profit: 0, biggestWin: 0, bestMulti: 0, games: {} });
const blank = () => ({ username: null, balance: 0, stats: blankStats(), history: [], promos: [], ads: null, created: 0, rounds: {} });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function normStats(raw) {
  const st = raw && typeof raw === 'object' ? raw : {};
  const one = (o = {}) => ({ bets: num(o.bets), wins: num(o.wins), wagered: num(o.wagered), profit: num(o.profit), bestMulti: num(o.bestMulti), biggestWin: num(o.biggestWin) });
  const games = {};
  for (const [g, v] of Object.entries(st.games && typeof st.games === 'object' ? st.games : {})) games[g] = one(v);
  return { ...one(st), games };
}

// ---------------------------------------------------------------- events
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}
function emit(evt, data) {
  listeners.get(evt)?.forEach((fn) => {
    try {
      fn(data);
    } catch (e) {
      console.error(e);
    }
  });
}

// ---------------------------------------------------------------- state
let state = blank();
let serverBal = 0;
let seq = -1;
const open = new Map(); // live tickets
let tid = 0;
let profileWaiting = false; // a fresh profile arrived mid-animation

function unseen() {
  let s = 0;
  for (const t of open.values()) s += t.amount - t.debited + (t.paid - t.shown);
  return s;
}
function show(silent = false) {
  const prev = state.balance;
  state.balance = Math.max(0, round2(serverBal - unseen()));
  const delta = round2(state.balance - prev);
  if (delta || silent) emit('balance', { delta, balance: state.balance, silent });
}
function syncFrom(r) {
  if (!r) return;
  if (typeof r.balance === 'number' && typeof r.seq === 'number' && r.seq >= seq) {
    serverBal = r.balance;
    seq = r.seq;
  }
  if (r.ads && typeof r.ads === 'object') {
    state.ads = { ...r.ads, at: Date.now() };
    emit('ads', state.ads);
  }
}
function applyEntry(e) {
  state.history.unshift(e);
  if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
  const st = state.stats;
  const g = (st.games[e.g] ||= { bets: 0, wins: 0, wagered: 0, profit: 0, bestMulti: 0, biggestWin: 0 });
  const won = e.p > e.a ? 1 : 0;
  for (const o of [st, g]) {
    o.bets += 1;
    o.wins += won;
    o.wagered = round2(o.wagered + e.a);
    o.profit = round2(o.profit + e.p - e.a);
    o.bestMulti = Math.max(o.bestMulti, round2(e.m));
    o.biggestWin = Math.max(o.biggestWin, e.p);
  }
}

export const store = {
  get state() {
    return state;
  },
  /** Balance the player should currently *see*. */
  get balance() {
    return state.balance;
  },
  get username() {
    return state.username;
  },
  get signedIn() {
    return !!state.username;
  },
  get busy() {
    return open.size > 0;
  },
  get ads() {
    return state.ads;
  },

  canAfford(amount) {
    return round2(amount) <= state.balance + 1e-9;
  },

  /** Take chips off the shown balance for a bet that's about to go to the server. */
  placeBet(game, amount) {
    amount = round2(amount);
    if (!state.username) throw new BetError('Make a username to start playing.');
    if (!(amount > 0)) throw new BetError('Enter a bet amount above zero.');
    if (amount > state.balance + 1e-9) throw new BetError('Not enough chips for that bet.');
    const t = { id: ++tid, game, amount, debited: 0, paid: 0, shown: 0, done: false };
    open.set(t.id, t);
    show();
    return t;
  },

  /** More chips on a live bet (Blackjack double, split, insurance). */
  addToBet(t, amount) {
    amount = round2(amount);
    if (!t || t.done || !(amount > 0)) return false;
    if (amount > state.balance + 1e-9) throw new BetError('Not enough chips for that.');
    t.amount = round2(t.amount + amount);
    show();
    return true;
  },

  /** A round the server already took the chips for (restored after a reload). */
  resume(game, amount) {
    amount = round2(amount);
    const t = { id: ++tid, game, amount, debited: amount, paid: 0, shown: 0, done: false };
    open.set(t.id, t);
    return t;
  },

  /** The server answered: record what it took and paid for this ticket, and its new balance. */
  confirm(t, r, { debited, paid } = {}) {
    if (t && !t.done) {
      if (debited != null) t.debited = round2(debited);
      if (paid != null) t.paid = round2(paid);
    }
    syncFrom(r);
    show();
  },

  /** A server reply that moved chips outside any bet (promo code, ad reward). */
  sync(r) {
    syncFrom(r);
    show();
  },

  /** Reveal part of a win early (e.g. a slot's base win before free spins play out). */
  credit(t, amount) {
    amount = round2(amount);
    if (!t || t.done || !(amount > 0)) return;
    t.shown = round2(Math.min(t.paid, t.shown + amount));
    show();
  },

  /** Close a ticket: whatever it won lands, and the bet goes into stats and history. */
  finish(t, entry) {
    if (!t || t.done) return;
    t.done = true;
    open.delete(t.id);
    if (entry) {
      applyEntry(entry);
      emit('bet', entry);
    }
    show();
    if (!open.size && profileWaiting) {
      profileWaiting = false;
      this.refresh();
    }
  },

  /** Close a ticket the server refused or refunded. */
  cancel(t) {
    if (!t || t.done) return;
    t.done = true;
    open.delete(t.id);
    show();
  },

  /** Load a full profile from the server (sign-in, reload, coming back to the tab). */
  load(me, { silent = false } = {}) {
    if (!me || !me.ok) return;
    const fresh = state.username !== me.username;
    if (fresh) {
      open.clear();
      seq = -1;
    }
    if (me.seq >= seq) {
      serverBal = num(me.balance);
      seq = me.seq;
    }
    state.username = me.username;
    state.promos = Array.isArray(me.promos) ? me.promos : [];
    state.created = num(me.created);
    state.rounds = me.rounds && typeof me.rounds === 'object' ? { ...me.rounds } : {};
    if (me.ads) state.ads = { ...me.ads, at: Date.now() };
    // Mid-animation the server's history already includes bets still playing out on screen.
    if (fresh || !open.size) {
      state.stats = normStats(me.stats);
      state.history = Array.isArray(me.history) ? me.history.slice(0, HISTORY_MAX) : [];
    } else profileWaiting = true;
    show(silent);
    if (fresh) emit('account', state);
    emit('reset', state);
    if (me.ads) emit('ads', state.ads);
  },

  async refresh() {
    if (!engine.signedIn) return null;
    const r = await engine.me();
    if (r?.ok) this.load(r);
    return r;
  },

  signOut() {
    open.clear();
    state = blank();
    serverBal = 0;
    seq = -1;
    show(true);
    emit('account', state);
    emit('reset', state);
  },

  hasPromo(code) {
    return state.promos.includes(String(code).toUpperCase());
  },

  /** Redeem a promo code on the server. Each code works once per account, ever. */
  async redeem(input) {
    const code = String(input || '').replace(/\s+/g, '').toUpperCase();
    if (!code) return { ok: false, error: 'empty' };
    const r = await engine.redeem(code);
    if (r?.ok) {
      syncFrom(r);
      if (!state.promos.includes(r.code)) state.promos.push(r.code);
      show();
      emit('promo', r);
    } else if (r?.error === 'used' && !state.promos.includes(code)) {
      state.promos.push(code);
      emit('promo', r);
    }
    return r;
  },

  /** Hand an unfinished round from the last profile load to its game (once). */
  takeRound(game) {
    const r = state.rounds?.[game] || null;
    if (state.rounds) state.rounds[game] = null;
    return r;
  },

  /** Seconds until the next rewarded ad, and how many are left today. */
  adStatus() {
    const a = state.ads;
    if (!a) return { reward: 250, left: 1, wait: 0 };
    const wait = Math.max(0, Math.ceil(a.wait - (Date.now() - (a.at || 0)) / 1000));
    return { reward: a.reward, left: a.left, wait, cooldown: a.cooldown };
  },
};
