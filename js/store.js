// Player state: balance, stats, history. Saved to localStorage, and mirrored to the
// cloud (GitHub sign-in) by cloud.js via the 'persist' event.
//
// Money flow for every game:
//   const t = store.placeBet('plinko', 10, { payout: 26 })  // chips leave the balance now
//   ...animation...
//   store.finish(t)                                         // payout lands when the player sees it
// If the payout is already known at bet time it is counted in the *saved* balance
// immediately, so a reload mid-animation never loses a win.

import { storage, round2 } from './util.js';

export const START_BALANCE = 1000;
export const DAILY_BONUS = 1000;
export const DAILY_MS = 24 * 60 * 60 * 1000;
export const REFILL_BELOW = 1;
export const GAMES = ['mines', 'plinko', 'slots', 'crash'];
const HISTORY_MAX = 40;
const VERSION = 1;

const GUEST_KEY = 'cc:v1:guest';
const userKey = (id) => `cc:v1:user:${id}`;

export class BetError extends Error {}

function freshState() {
  const now = Date.now();
  return {
    v: VERSION,
    balance: START_BALANCE,
    stats: { bets: 0, wins: 0, wagered: 0, profit: 0, biggestWin: 0, bestMulti: 0, games: {} },
    history: [],
    dailyAt: 0,
    refills: 0,
    createdAt: now,
    savedAt: now,
    mines: null,
  };
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Merge anything we load (local or cloud) onto safe defaults. */
export function sanitize(raw) {
  const base = freshState();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  s.balance = Math.max(0, round2(num(raw.balance, START_BALANCE)));
  const st = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  s.stats = {
    bets: num(st.bets),
    wins: num(st.wins),
    wagered: round2(num(st.wagered)),
    profit: round2(num(st.profit)),
    biggestWin: round2(num(st.biggestWin)),
    bestMulti: num(st.bestMulti),
    games: st.games && typeof st.games === 'object' ? st.games : {},
  };
  s.history = Array.isArray(raw.history) ? raw.history.slice(0, HISTORY_MAX) : [];
  s.dailyAt = num(raw.dailyAt);
  s.refills = num(raw.refills);
  s.createdAt = num(raw.createdAt, base.createdAt);
  s.savedAt = num(raw.savedAt, 0);
  s.mines = raw.mines && typeof raw.mines === 'object' ? raw.mines : null;
  return s;
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
let owner = null; // null = guest, otherwise the signed-in user's id
let state = sanitize(storage.get(GUEST_KEY));
const open = new Map(); // live tickets
let seq = 0;

const storageKey = () => (owner ? userKey(owner) : GUEST_KEY);

function pendingTotal() {
  let sum = 0;
  for (const t of open.values()) if (t.payout != null) sum += t.payout - t.credited;
  return round2(sum);
}

/** The state as it should be saved: includes wins that are still animating. */
export function snapshot() {
  return { ...state, balance: round2(state.balance + pendingTotal()) };
}

function persist() {
  state.savedAt = Date.now();
  const snap = snapshot();
  storage.set(storageKey(), snap);
  emit('persist', snap);
}

function gameStats(game) {
  const g = (state.stats.games[game] ||= { bets: 0, wins: 0, wagered: 0, profit: 0, bestMulti: 0, biggestWin: 0 });
  return g;
}

export const store = {
  get state() {
    return state;
  },
  /** Balance the player should currently *see*. */
  get balance() {
    return state.balance;
  },
  get owner() {
    return owner;
  },
  get busy() {
    return open.size > 0;
  },

  snapshot,

  canAfford(amount) {
    return round2(amount) <= state.balance + 1e-9;
  },

  placeBet(game, amount, { payout = null } = {}) {
    amount = round2(amount);
    if (!(amount > 0)) throw new BetError('Enter a bet amount above zero.');
    if (amount > state.balance + 1e-9) throw new BetError('Not enough chips for that bet.');
    state.balance = round2(state.balance - amount);
    const t = { id: ++seq, game, amount, payout: payout == null ? null : round2(payout), credited: 0, done: false };
    open.set(t.id, t);
    emit('balance', { delta: -amount, balance: state.balance });
    persist();
    return t;
  },

  /** Re-attach to a bet whose chips were already taken (e.g. a Mines round restored after reload). */
  resume(game, amount) {
    const t = { id: ++seq, game, amount: round2(amount), payout: null, credited: 0, done: false };
    open.set(t.id, t);
    return t;
  },

  /** Tell the store the final payout early (keeps the saved balance safe). */
  setPayout(t, payout) {
    t.payout = round2(payout);
    persist();
  },

  /** Pay part of a ticket now (e.g. a slot's base win before free spins play out). */
  credit(t, amount) {
    amount = round2(amount);
    if (t.done || !(amount > 0)) return;
    t.credited = round2(t.credited + amount);
    state.balance = round2(state.balance + amount);
    emit('balance', { delta: amount, balance: state.balance });
    persist();
  },

  /** Settle a ticket. Records stats + history and credits whatever is still owed. */
  finish(t, payout = t.payout, extra = {}) {
    if (!t || t.done) return null;
    t.done = true;
    open.delete(t.id);
    payout = round2(payout ?? 0);
    const owed = round2(payout - t.credited);
    if (owed) state.balance = round2(state.balance + owed);

    const profit = round2(payout - t.amount);
    const mult = t.amount > 0 ? payout / t.amount : 0;
    const st = state.stats;
    const g = gameStats(t.game);
    st.bets++;
    g.bets++;
    st.wagered = round2(st.wagered + t.amount);
    g.wagered = round2(g.wagered + t.amount);
    st.profit = round2(st.profit + profit);
    g.profit = round2(g.profit + profit);
    if (payout > t.amount) {
      st.wins++;
      g.wins++;
    }
    st.biggestWin = Math.max(st.biggestWin, payout);
    g.biggestWin = Math.max(g.biggestWin, payout);
    st.bestMulti = Math.max(st.bestMulti, round2(mult));
    g.bestMulti = Math.max(g.bestMulti, round2(mult));

    const entry = { g: t.game, a: t.amount, m: Math.round(mult * 10000) / 10000, p: payout, t: Date.now(), ...extra };
    state.history.unshift(entry);
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;

    if (owed) emit('balance', { delta: owed, balance: state.balance });
    emit('bet', entry);
    persist();
    return entry;
  },

  /** Give the chips back without recording a bet (e.g. a Crash bet cancelled before take-off). */
  refund(t) {
    if (!t || t.done) return;
    t.done = true;
    open.delete(t.id);
    const back = round2(t.amount - t.credited);
    state.balance = round2(state.balance + back);
    emit('balance', { delta: back, balance: state.balance });
    persist();
  },

  /** Settle everything still in flight for a game (used when leaving a page). */
  finishAll(game) {
    for (const t of [...open.values()]) if (!game || t.game === game) if (t.payout != null) this.finish(t);
  },

  setMinesRound(round) {
    state.mines = round;
    persist();
  },

  dailyReadyIn() {
    return Math.max(0, state.dailyAt + DAILY_MS - Date.now());
  },

  claimDaily() {
    if (this.dailyReadyIn() > 0) return false;
    state.dailyAt = Date.now();
    state.balance = round2(state.balance + DAILY_BONUS);
    emit('balance', { delta: DAILY_BONUS, balance: state.balance });
    persist();
    return true;
  },

  canRefill() {
    return state.balance < REFILL_BELOW && open.size === 0 && !state.mines;
  },

  refill() {
    if (!this.canRefill()) return false;
    const delta = round2(START_BALANCE - state.balance);
    state.balance = START_BALANCE;
    state.refills++;
    emit('balance', { delta, balance: state.balance });
    persist();
    return true;
  },

  reset() {
    open.clear();
    state = freshState();
    emit('reset', state);
    emit('balance', { delta: 0, balance: state.balance });
    persist();
  },

  /** Switch to the guest profile or a signed-in user's profile. */
  useProfile(userId, initial) {
    // Anything still animating gets paid out to the profile that bet it.
    this.finishAll();
    open.clear();
    owner = userId || null;
    state = sanitize(initial ?? storage.get(storageKey()));
    storage.set(storageKey(), state);
    emit('reset', state);
    emit('balance', { delta: 0, balance: state.balance, silent: true });
  },

  /** Replace the current profile's state with a newer copy (from the cloud). */
  adopt(remote) {
    if (open.size) return false;
    state = sanitize(remote);
    storage.set(storageKey(), state);
    emit('reset', state);
    emit('balance', { delta: 0, balance: state.balance, silent: true });
    return true;
  },

  /** Local copy for a user (used to compare against the cloud copy). */
  localFor(userId) {
    const raw = storage.get(userKey(userId));
    return raw ? sanitize(raw) : null;
  },

  guestState() {
    return sanitize(storage.get(GUEST_KEY));
  },

  clearGuest() {
    storage.set(GUEST_KEY, freshState());
  },

  save: persist,
};

// Keep two tabs in sync for guests and signed-in users alike.
window.addEventListener('storage', (e) => {
  if (e.key !== storageKey() || !e.newValue || open.size) return;
  try {
    const remote = sanitize(JSON.parse(e.newValue));
    if (remote.savedAt > state.savedAt) {
      state = remote;
      emit('reset', state);
      emit('balance', { delta: 0, balance: state.balance, silent: true });
    }
  } catch {
    /* ignore */
  }
});
