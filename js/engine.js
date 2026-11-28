// Talks to the casino server.
//
// With a Supabase project in js/config.js, every account, balance and game result
// lives on the server (supabase/schema.sql), so it follows the player to any browser
// and can't be reset or edited. Without one, engine-local.js stands in and keeps
// accounts on this device only.
//
// Calls run one at a time, in order, so balance updates always arrive in sequence.

import { CONFIG } from './config.js?v=0f27056399f9';

const url = String(CONFIG.supabaseUrl || '').trim().replace(/\/+$/, '');
const key = String(CONFIG.supabaseKey || '').trim();
export const MODE = url && key ? 'server' : 'device';

const SESSION_KEY = 'cc:session';
let session = null;
try {
  const s = JSON.parse(localStorage.getItem(SESSION_KEY));
  if (s && typeof s.token === 'string' && s.mode === MODE) session = s;
} catch {
  /* no session */
}
function saveSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: the session lasts until the tab closes */
  }
}

const listeners = new Set();
const emit = (type, data) => listeners.forEach((fn) => fn(type, data));

let localApi = null;
async function rpc(fn, args) {
  if (MODE === 'device') {
    localApi ||= await import('./engine-local.js?v=0f27056399f9');
    return localApi.call(fn, args);
  }
  const headers = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
  // Legacy anon keys are JWTs and also go in Authorization; new publishable keys don't.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      console.warn(`[casino] ${fn} → HTTP ${res.status}`, body || text);
      // 404 = the SQL hasn't been run on this project yet.
      return { ok: false, error: res.status === 404 ? 'not_installed' : 'server', status: res.status, message: body?.message || text };
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

let chain = Promise.resolve();
function call(fn, args = {}, { token = true, queue = true } = {}) {
  const run = async () => {
    const a = token ? { p_token: session?.token ?? null, ...args } : args;
    let r;
    try {
      r = await rpc(fn, a);
    } catch (e) {
      console.warn(`[casino] ${fn} failed`, e);
      r = { ok: false, error: 'network' };
    }
    if (r == null) r = { ok: false, error: 'server' };
    if (token && r && r.ok === false && r.error === 'auth' && session) {
      saveSession(null);
      emit('signedout', { expired: true });
    }
    if (r && r.ok === false && (r.error === 'network' || r.error === 'server' || r.error === 'not_installed')) emit('offline', r);
    else emit('online');
    return r;
  };
  if (!queue) return run();
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

export const engine = {
  mode: MODE,
  get signedIn() {
    return !!session;
  },
  get username() {
    return session?.username ?? null;
  },
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // ---------------------------------------------------------------- accounts
  async signup(username, password) {
    const r = await call('cc_signup', { p_username: username, p_password: password }, { token: false });
    if (r?.ok) {
      saveSession({ token: r.token, username: r.me.username, mode: MODE });
      emit('signedin', r.me);
    }
    return r;
  },
  async login(username, password) {
    const r = await call('cc_login', { p_username: username, p_password: password }, { token: false });
    if (r?.ok) {
      saveSession({ token: r.token, username: r.me.username, mode: MODE });
      emit('signedin', r.me);
    }
    return r;
  },
  async logout() {
    const t = session?.token;
    saveSession(null);
    emit('signedout', { expired: false });
    if (t) await call('cc_logout', { p_token: t }, { token: false });
  },
  me: () => call('cc_me'),

  // ---------------------------------------------------------------- chips
  redeem: (code) => call('cc_redeem', { p_code: code }),
  adReward: () => call('cc_ad_reward'),
  leaderboard: (limit = 50) => call('cc_leaderboard', { p_limit: limit }, { token: false, queue: false }),
  rank: () => call('cc_rank', {}, { queue: false }),

  // ---------------------------------------------------------------- games
  casesList: () => call('cc_cases_list'),
  casesGet: (id) => call('cc_cases_get', { p_id: id }),
  casesCreate: (requestId, cases, visibility, bet = 50) => call('cc_cases_create', { p_request_id: requestId, p_cases: cases, p_visibility: visibility, p_bet: bet }),
  casesJoin: (id, bet = 50) => call('cc_cases_join', { p_id: id, p_bet: bet }),
  casesCancel: (id) => call('cc_cases_cancel', { p_id: id }),
  plinko: (bet, risk, rows) => call('cc_plinko', { p_bet: bet, p_risk: risk, p_rows: rows }),
  roulette: (bets) => call('cc_roulette', { p_bets: bets }),
  slots: (bet) => call('cc_slots', { p_bet: bet }),
  minesStart: (bet, mines) => call('cc_mines_start', { p_bet: bet, p_mines: mines }),
  minesReveal: (tile) => call('cc_mines_reveal', { p_tile: tile }),
  minesCashout: () => call('cc_mines_cashout'),
  crashStart: (bet, auto, delayMs) => call('cc_crash_start', { p_bet: bet, p_auto: auto ?? null, p_delay_ms: Math.round(delayMs || 0) }),
  crashCashout: (at) => call('cc_crash_cashout', { p_at: at ?? null }),
  crashPoll: () => call('cc_crash_poll'),
  bjDeal: (bet) => call('cc_bj_deal', { p_bet: bet }),
  bjAct: (action) => call('cc_bj_act', { p_action: action }),
  roosterStart: (bet, target) => call('cc_rooster_start', { p_bet: bet, p_target: target }),
  roosterEnd: (moves, endMs) => call('cc_rooster_end', { p_moves: moves, p_end_ms: Math.round(endMs) }),
  flightStart: (bet, target) => call('cc_flight_start', { p_bet: bet, p_target: target }),
  flightEnd: (start, flaps, frames) => call('cc_flight_end', { p_start: start, p_flaps: flaps, p_frames: frames }),

  // ---------------------------------------------------------------- multiplayer (server only)
  // 1v1 challenges for 'rooster' and 'flight'; a run is {moves, end_ms} or {start, flaps, frames}.
  duelList: (game) => call('cc_duel_list', { p_game: game }, { queue: false }),
  duelGet: (id) => call('cc_duel_get', { p_id: id }, { queue: false }),
  duelCreate: (game, bet) => call('cc_duel_create', { p_game: game, p_bet: bet }),
  duelJoin: (id, bet) => call('cc_duel_join', { p_id: id, p_bet: bet }),
  duelFinish: (id, run) => call('cc_duel_finish', { p_id: id, p_run: run }),
  // Shared Blackjack tables.
  bjmLobby: () => call('cc_bjm_lobby', {}, { queue: false }),
  bjmJoin: (table = null) => call('cc_bjm_join', { p_table: table }),
  bjmState: (table) => call('cc_bjm_state', { p_table: table }, { queue: false }),
  bjmBet: (table, bet) => call('cc_bjm_bet', { p_table: table, p_bet: bet }),
  bjmAct: (table, action) => call('cc_bjm_act', { p_table: table, p_action: action }),
  bjmLeave: (table) => call('cc_bjm_leave', { p_table: table }),
};

/** Friendly text for the error codes the server sends back. */
export function errorText(r, fallback = 'Something went wrong. Try again.') {
  switch (r?.error) {
    case 'battle_missing':
      return 'This battle is unavailable. Check the invite or return to the lobby.';
    case 'battle_full':
      return 'That battle has already started or closed.';
    case 'battle_started':
      return 'The battle has started. Your result will be saved when it finishes.';
    case 'battle_active':
      return 'Finish or cancel your current case battle first.';
    case 'bad_cases':
      return 'Choose three cases for this battle.';
    case 'multiplayer_unavailable':
      return 'Online battles become available when the casino server is connected.';
    case 'funds':
      return 'Not enough chips for that bet.';
    case 'bad_bet':
      return 'Bets go from 0.01 up, in whole cents.';
    case 'network':
      return 'Can’t reach the casino. Check your connection and try again.';
    case 'server':
      return 'The casino server hiccuped. Try again in a moment.';
    case 'not_installed':
      return 'The casino server isn’t set up yet (run supabase/schema.sql).';
    case 'auth':
      return 'Your session ended. Log in again.';
    case 'round_active':
      return 'Finish the round you already have going first.';
    case 'no_round':
      return 'That round already ended.';
    case 'duel_missing':
      return 'That challenge is no longer available.';
    case 'duel_taken':
      return 'Someone already took that challenge (or it expired).';
    case 'duel_own':
      return 'That’s your own challenge. Share the game so someone can accept it.';
    case 'duel_limit':
      return 'You already have five open challenges. Wait for one to be accepted.';
    case 'table_missing':
      return 'That table closed. Pick another one.';
    case 'table_full':
      return 'That table is full. Try another one.';
    case 'tables_full':
      return 'Every table is busy right now. Try again in a moment.';
    case 'table_active':
      return 'Finish your hand at your current table first.';
    case 'not_seated':
      return 'Take a seat at the table first.';
    case 'not_your_turn':
      return 'Hold on, it’s not your turn.';
    case 'bad_action':
      return 'That move isn’t available for this hand.';
    default:
      return fallback;
  }
}
