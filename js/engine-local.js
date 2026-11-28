import { caseApi } from './cases-local.js?v=7dd2455b7c8d';
// On-device casino server.
//
// Used only when js/config.js has no Supabase project. It answers the same calls as
// supabase/schema.sql with the same JSON, so the games behave identically, but the
// accounts live in this browser's localStorage. Connect Supabase for accounts that
// follow players to any browser and can't be reset by clearing site data.

import { random, randInt, sample, weightedPick } from './rng.js?v=7dd2455b7c8d';
import { PLINKO, SLOT_WEIGHTS, SLOT_TOTAL_W, slotEvaluate, unflatGrid, ROULETTE_KEY, rouletteMult, colorOf, minesMult, CRASH_K, crashPoint, FS_MULT, RR_TARGETS, NF_TARGETS, targetMult } from './math.js?v=7dd2455b7c8d';
import { scoreReplay } from './games/rooster-course.js?v=7dd2455b7c8d';
import { flightReplay, FPS } from './games/flight-course.js?v=7dd2455b7c8d';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const err = (error, extra = {}) => ({ ok: false, error, ...extra });
const validBet = (b) => typeof b === 'number' && Number.isFinite(b) && b >= 0.01 && b <= 1e12 && Math.abs(r2(b) - b) < 1e-9;

const SETTINGS = { start_balance: 1000, ad_reward: 250, ad_cooldown_seconds: 120, ad_daily_cap: 20, login_attempts: 8, lockout_minutes: 10 };
const PROMOS = { MAXWIN: 1000 };

// ------------------------------------------------------------------ storage
const DB_KEY = 'cc:device:db';
function readDb() {
  try {
    const raw = JSON.parse(localStorage.getItem(DB_KEY));
    if (raw && typeof raw === 'object' && raw.players && raw.sessions) return raw;
  } catch {
    /* fall through */
  }
  return { players: {}, sessions: {} };
}
function writeDb(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* storage full or blocked */
  }
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
async function hashPw(salt, pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pw}`));
  return hex(new Uint8Array(buf));
}
const today = () => new Date().toISOString().slice(0, 10);

function auth(db, token) {
  if (typeof token !== 'string' || token.length < 32) return null;
  const key = db.sessions[token];
  return key && db.players[key] ? db.players[key] : null;
}
function newSession(db, key) {
  const t = randomHex(32);
  db.sessions[t] = key;
  const mine = Object.keys(db.sessions).filter((k) => db.sessions[k] === key);
  while (mine.length > 10) delete db.sessions[mine.shift()];
  return t;
}
function move(p, delta) {
  p.balance = r2(p.balance + delta);
  p.seq += 1;
  p.updated = Date.now();
}
function record(p, game, wager, payout, info) {
  const mult = wager > 0 ? Math.round((payout / wager) * 10000) / 10000 : 0;
  const profit = r2(payout - wager);
  const won = payout > wager ? 1 : 0;
  const st = p.stats;
  const g = (st.games[game] ||= { bets: 0, wins: 0, wagered: 0, profit: 0, bestMulti: 0, biggestWin: 0 });
  for (const o of [st, g]) {
    o.bets += 1;
    o.wins += won;
    o.wagered = r2(o.wagered + wager);
    o.profit = r2(o.profit + profit);
    o.bestMulti = Math.max(o.bestMulti, r2(mult));
    o.biggestWin = Math.max(o.biggestWin, payout);
  }
  const entry = { g: game, a: wager, m: mult, p: payout, t: Date.now(), info };
  p.history.unshift(entry);
  p.history.length = Math.min(p.history.length, 60);
  return entry;
}
function adsState(p) {
  const used = p.ad_day === today() ? p.ad_count : 0;
  const wait = p.ad_last ? Math.max(0, Math.ceil(SETTINGS.ad_cooldown_seconds - (Date.now() - p.ad_last) / 1000)) : 0;
  return { reward: SETTINGS.ad_reward, left: Math.max(0, SETTINGS.ad_daily_cap - used), wait, cooldown: SETTINGS.ad_cooldown_seconds };
}
const money = (p, extra = {}) => ({ ...extra, balance: p.balance, seq: p.seq });

// ------------------------------------------------------------------ crash
function crashResolve(p) {
  const r = p.crash;
  if (!r) return { state: 'none' };
  const el = Date.now() - r.started_at;
  if (r.auto != null && r.auto <= r.crash_point && el >= Math.log(r.auto) / CRASH_K) {
    const pay = r2(r.bet * r.auto);
    const entry = record(p, 'crash', r.bet, pay, `auto @ ${r.auto.toFixed(2)}×`);
    move(p, pay);
    p.crash = null;
    return money(p, { state: 'cashed', mult: r.auto, payout: pay, crash_point: r.crash_point, entry });
  }
  if (el >= Math.log(r.crash_point) / CRASH_K) {
    const entry = record(p, 'crash', r.bet, 0, `crashed @ ${r.crash_point.toFixed(2)}×`);
    p.crash = null;
    return money(p, { state: 'crashed', crash_point: r.crash_point, payout: 0, entry });
  }
  return { state: el < 0 ? 'waiting' : 'running', elapsed: el, wager: r.bet, auto: r.auto, started_at: r.started_at };
}

// ------------------------------------------------------------------ blackjack
const bjVal = (c) => {
  const r = c.slice(0, -1);
  return r === 'A' ? 11 : r === 'K' || r === 'Q' || r === 'J' ? 10 : Number(r);
};
function bjTotal(cards) {
  let t = 0;
  let a = 0;
  for (const c of cards) {
    t += bjVal(c);
    if (c.slice(0, -1) === 'A') a++;
  }
  while (t > 21 && a > 0) {
    t -= 10;
    a--;
  }
  return { total: t, soft: a > 0 };
}
const bjIsBJ = (cards) => cards.length === 2 && bjTotal(cards).total === 21;
function bjShuffle(p) {
  const deck = [];
  for (let d = 0; d < 6; d++) for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) for (const s of 'SHDC') deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  p.shoe = { cards: deck, cut: Math.floor(312 * (0.2 + randInt(1000) / 10000)) };
}
function bjDraw(p) {
  if (!p.shoe || !p.shoe.cards.length) bjShuffle(p);
  return p.shoe.cards.pop();
}
function bjView(p, ev = [], extra = {}) {
  const r = p.bj;
  const hands = [];
  const push = (cards, bet, done, doubled) => {
    const v = bjTotal(cards);
    hands.push({ cards: [...cards], bet, total: v.total, soft: v.soft, done, doubled });
  };
  push(r.h1, r.b1, r.d1, r.x1);
  if (r.nhands === 2) push(r.h2, r.b2, r.d2, r.x2);
  let can = { hit: false, stand: false, double: false, split: false };
  if (r.phase === 'player') {
    const cur = r.active === 1 ? r.h1 : r.h2;
    const curBet = r.active === 1 ? r.b1 : r.b2;
    const ct = bjTotal(cur).total;
    can = {
      hit: ct < 21,
      stand: true,
      double: cur.length === 2 && ct < 21 && p.balance >= curBet,
      split: r.nhands === 1 && cur.length === 2 && bjVal(cur[0]) === bjVal(cur[1]) && p.balance >= curBet,
    };
  }
  return {
    ok: true,
    phase: r.phase,
    dealer: r.revealed ? [...r.dealer] : [r.dealer[0], '??'],
    dealer_total: r.revealed ? bjTotal(r.dealer).total : bjVal(r.dealer[0]),
    hands,
    active: r.active,
    base: r.base,
    wagered: r.wagered,
    insurance: r.insurance,
    can,
    events: ev,
    decks_left: Math.round(((p.shoe?.cards.length || 0) / 52) * 10) / 10,
    ...extra,
  };
}
function bjSettle(p, ev) {
  const r = p.bj;
  if (!r.revealed) {
    ev.push({ t: 'reveal', c: r.dealer[1] });
    r.revealed = true;
  }
  const d = bjTotal(r.dealer).total;
  const dbj = bjIsBJ(r.dealer);
  let total = 0;
  const results = [];
  for (let i = 1; i <= r.nhands; i++) {
    const cards = i === 1 ? r.h1 : r.h2;
    const bet = i === 1 ? r.b1 : r.b2;
    const v = bjTotal(cards).total;
    const nat = r.nhands === 1 && bjIsBJ(cards);
    let pay = 0;
    let label;
    let cls;
    if (nat && !dbj) {
      pay = bet * 2.5;
      label = `Blackjack +${(bet * 1.5).toFixed(2)}`;
      cls = 'bj';
    } else if (nat && dbj) {
      pay = bet;
      label = 'Push';
      cls = 'push';
    } else if (v > 21) {
      label = 'Bust';
      cls = 'loss';
    } else if (dbj) {
      label = 'Lose';
      cls = 'loss';
    } else if (d > 21 || v > d) {
      pay = bet * 2;
      cls = 'win';
      label = `${d > 21 ? 'Dealer busts +' : 'Win +'}${bet.toFixed(2)}`;
    } else if (v === d) {
      pay = bet;
      label = 'Push';
      cls = 'push';
    } else {
      label = 'Lose';
      cls = 'loss';
    }
    pay = r2(pay);
    total += pay;
    results.push({ label, cls, pay, bet });
  }
  if (r.insurance > 0 && dbj) total += r.insurance * 3;
  total = r2(total);
  const info = `${r.nhands > 1 ? 'split · ' : ''}dealer ${dbj ? 'BJ' : d > 21 ? 'bust' : d}`;
  const entry = record(p, 'blackjack', r.wagered, total, info);
  move(p, total);
  r.phase = 'done';
  const view = bjView(p, ev, { results, payout: total, wagered: r.wagered, dealer_bj: dbj, insurance_paid: r.insurance > 0 && dbj, entry });
  p.bj = null;
  return { ...view, balance: p.balance, seq: p.seq };
}
function bjAfterInsurance(p, ev) {
  const r = p.bj;
  if (bjVal(r.dealer[0]) >= 10) {
    ev.push({ t: 'peek' });
    if (bjIsBJ(r.dealer)) return bjSettle(p, ev);
  }
  if (bjIsBJ(r.h1)) return bjSettle(p, ev);
  r.phase = 'player';
  return bjView(p, ev, money(p));
}
function bjDealerTurn(p, ev) {
  const r = p.bj;
  ev.push({ t: 'reveal', c: r.dealer[1] });
  r.revealed = true;
  r.phase = 'dealer';
  if (bjTotal(r.h1).total <= 21 || (r.nhands === 2 && bjTotal(r.h2).total <= 21)) {
    while (bjTotal(r.dealer).total < 17) {
      const c = bjDraw(p);
      r.dealer.push(c);
      ev.push({ t: 'd', c });
    }
  }
  return bjSettle(p, ev);
}

// ------------------------------------------------------------------ the API
const blankPlayer = (username, salt, hash) => ({
  username,
  salt,
  hash,
  balance: SETTINGS.start_balance,
  seq: 0,
  stats: { bets: 0, wins: 0, wagered: 0, profit: 0, bestMulti: 0, biggestWin: 0, games: {} },
  history: [],
  promos: [],
  ad_day: null,
  ad_count: 0,
  ad_last: 0,
  failed: 0,
  locked_until: 0,
  created: Date.now(),
  updated: Date.now(),
  mines: null,
  crash: null,
  shoe: null,
  bj: null,
  rooster: null,
  flight: null,
});

function meOf(db, p) {
  localCases.reconcile(p);
  const crash = crashResolve(p);
  if (p.rooster && Date.now() - p.rooster.started > 600000) roosterSettle(p, false, 0, 'abandoned');
  if (p.flight && Date.now() - p.flight.started > 600000) flightSettle(p, false, 0, 'abandoned');
  return {
    ok: true,
    username: p.username,
    balance: p.balance,
    seq: p.seq,
    stats: p.stats,
    created: p.created,
    history: p.history.slice(0, 40),
    promos: p.promos.map((x) => x.code),
    ads: adsState(p),
    rounds: {
      mines: p.mines ? { bet: p.mines.bet, mines: p.mines.mines, revealed: [...p.mines.revealed] } : null,
      crash: crash.state === 'running' || crash.state === 'waiting' ? crash : null,
      blackjack: p.bj ? bjView(p) : null,
      rooster: p.rooster ? { bet: p.rooster.bet, target: p.rooster.target, started: p.rooster.started } : null,
      flight: p.flight ? { bet: p.flight.bet, target: p.flight.target, started: p.flight.started } : null,
    },
  };
}

const API = {
  async cc_signup({ p_username, p_password }) {
    const name = String(p_username ?? '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return err('bad_username');
    const pw = String(p_password ?? '');
    if (pw.length < 6 || pw.length > 72) return err('bad_password');
    const db = readDb();
    const key = name.toLowerCase();
    if (db.players[key]) return err('taken');
    const salt = randomHex(16);
    db.players[key] = blankPlayer(name, salt, await hashPw(salt, pw));
    const token = newSession(db, key);
    const me = meOf(db, db.players[key]);
    writeDb(db);
    return { ok: true, token, me };
  },

  async cc_login({ p_username, p_password }) {
    const db = readDb();
    const key = String(p_username ?? '').trim().toLowerCase();
    const p = db.players[key];
    if (!p) return err('bad_login');
    if (p.locked_until > Date.now()) return err('locked', { wait: Math.ceil((p.locked_until - Date.now()) / 1000) });
    if ((await hashPw(p.salt, String(p_password ?? ''))) !== p.hash) {
      p.failed += 1;
      if (p.failed >= SETTINGS.login_attempts) {
        p.failed = 0;
        p.locked_until = Date.now() + SETTINGS.lockout_minutes * 60000;
      }
      writeDb(db);
      return err('bad_login');
    }
    p.failed = 0;
    p.locked_until = 0;
    const token = newSession(db, key);
    const me = meOf(db, p);
    writeDb(db);
    return { ok: true, token, me };
  },

  cc_logout({ p_token }) {
    const db = readDb();
    delete db.sessions[p_token];
    writeDb(db);
    return { ok: true };
  },

  cc_me(_, db, p) {
    return meOf(db, p);
  },

  cc_redeem({ p_code }, db, p) {
    const code = String(p_code ?? '').replace(/\s/g, '').toUpperCase();
    if (!code) return err('empty');
    if (!PROMOS[code]) return err('invalid', { code });
    if (p.promos.some((x) => x.code === code)) return err('used', { code });
    p.promos.push({ code, at: Date.now() });
    move(p, PROMOS[code]);
    return money(p, { ok: true, code, chips: PROMOS[code] });
  },

  cc_ad_reward(_, db, p) {
    const used = p.ad_day === today() ? p.ad_count : 0;
    if (used >= SETTINGS.ad_daily_cap) return err('daily_cap', { ads: adsState(p) });
    if (p.ad_last && Date.now() - p.ad_last < SETTINGS.ad_cooldown_seconds * 1000) return err('cooldown', { ads: adsState(p) });
    p.ad_day = today();
    p.ad_count = used + 1;
    p.ad_last = Date.now();
    move(p, SETTINGS.ad_reward);
    return money(p, { ok: true, chips: SETTINGS.ad_reward, ads: adsState(p) });
  },

  cc_leaderboard({ p_limit }) {
    const db = readDb();
    const n = Math.max(1, Math.min(Number(p_limit) || 50, 100));
    return Object.values(db.players)
      .sort((a, b) => b.balance - a.balance || a.updated - b.updated)
      .slice(0, n)
      .map((p, i) => ({ rank: i + 1, username: p.username, balance: p.balance, biggest_win: p.stats.biggestWin, bets: p.stats.bets }));
  },

  cc_rank(_, db, p) {
    const all = Object.values(db.players);
    return { ok: true, rank: 1 + all.filter((x) => x.balance > p.balance || (x.balance === p.balance && x.updated < p.updated)).length, players: all.length };
  },

  cc_plinko({ p_bet, p_risk, p_rows }, db, p) {
    if (!PLINKO[p_risk] || !(p_rows >= 8 && p_rows <= 16)) return err('bad_args');
    if (!validBet(p_bet)) return err('bad_bet');
    if (p.balance < p_bet) return err('funds');
    const path = Array.from({ length: p_rows }, () => (random() < 0.5 ? 0 : 1));
    const k = path.reduce((a, b) => a + b, 0);
    const mult = PLINKO[p_risk][p_rows][k];
    const pay = r2(p_bet * mult);
    const entry = record(p, 'plinko', p_bet, pay, `${p_risk} · ${p_rows} rows`);
    move(p, pay - p_bet);
    return money(p, { ok: true, path, k, mult, payout: pay, entry });
  },

  cc_roulette({ p_bets }, db, p) {
    if (!p_bets || typeof p_bets !== 'object' || Array.isArray(p_bets)) return err('bad_args');
    const keys = Object.keys(p_bets);
    if (!keys.length || keys.length > 60) return err('bad_args');
    let total = 0;
    for (const k of keys) {
      if (!ROULETTE_KEY.test(k)) return err('bad_args');
      if (!validBet(p_bets[k])) return err('bad_bet');
      total += p_bets[k];
    }
    total = r2(total);
    if (p.balance < total) return err('funds');
    const n = randInt(37);
    const pay = r2(keys.reduce((a, k) => a + p_bets[k] * rouletteMult(k, n), 0));
    const entry = record(p, 'roulette', total, pay, `${n} ${colorOf(n)}`);
    move(p, pay - total);
    return money(p, { ok: true, number: n, payout: pay, wager: total, entry });
  },

  cc_slots({ p_bet }, db, p) {
    if (!validBet(p_bet)) return err('bad_bet');
    if (p.balance < p_bet) return err('funds');
    const grid = () => Array.from({ length: 15 }, () => weightedPick(SLOT_WEIGHTS, SLOT_TOTAL_W));
    const g = grid();
    const ev = slotEvaluate(unflatGrid(g), p_bet, 1);
    let total = ev.total;
    let queue = ev.fs;
    const fs = [];
    while (queue > 0 && fs.length < 300) {
      queue--;
      const fg = grid();
      const fe = slotEvaluate(unflatGrid(fg), p_bet, FS_MULT);
      total += fe.total;
      queue += fe.fs;
      fs.push({ grid: fg, total: fe.total, fs: fe.fs });
    }
    total = r2(total);
    const entry = record(p, 'slots', p_bet, total, fs.length ? `${fs.length} free spins` : '');
    move(p, total - p_bet);
    return money(p, { ok: true, grid: g, base: ev.total, fs_award: ev.fs, fs, total, entry });
  },

  cc_mines_start({ p_bet, p_mines }, db, p) {
    if (!(Number.isInteger(p_mines) && p_mines >= 1 && p_mines <= 24)) return err('bad_args');
    if (!validBet(p_bet)) return err('bad_bet');
    if (p.mines) return err('round_active');
    if (p.balance < p_bet) return err('funds');
    p.mines = { bet: p_bet, mines: p_mines, cells: sample(25, p_mines), revealed: [] };
    move(p, -p_bet);
    return money(p, { ok: true, bet: p_bet, mines: p_mines, next: Math.round(minesMult(p_mines, 1) * 10000) / 10000 });
  },

  cc_mines_reveal({ p_tile }, db, p) {
    const r = p.mines;
    if (!r) return err('no_round');
    if (!(Number.isInteger(p_tile) && p_tile >= 0 && p_tile <= 24) || r.revealed.includes(p_tile)) return err('bad_args');
    if (r.cells.includes(p_tile)) return { ...minesFinish(p, false), mine: true, tile: p_tile };
    r.revealed.push(p_tile);
    const k = r.revealed.length;
    if (k >= 25 - r.mines) return { ...minesFinish(p, true), mine: false, tile: p_tile, cleared: true };
    return { ok: true, mine: false, tile: p_tile, k, mult: Math.round(minesMult(r.mines, k) * 10000) / 10000, next: Math.round(minesMult(r.mines, k + 1) * 10000) / 10000 };
  },

  cc_mines_cashout(_, db, p) {
    if (!p.mines) return err('no_round');
    if (!p.mines.revealed.length) return err('no_gems');
    return minesFinish(p, true);
  },

  cc_crash_start({ p_bet, p_auto, p_delay_ms }, db, p) {
    if (!validBet(p_bet)) return err('bad_bet');
    if (p_auto != null && !(p_auto >= 1.01 && p_auto <= 10000 && Math.abs(r2(p_auto) - p_auto) < 1e-9)) return err('bad_args');
    const st = crashResolve(p);
    if (st.state === 'running' || st.state === 'waiting') return err('round_active');
    if (p.balance < p_bet) return err('funds');
    const now = Date.now();
    const starts = now + Math.min(6000, Math.max(0, Number(p_delay_ms) || 0));
    p.crash = { bet: p_bet, auto: p_auto ?? null, crash_point: crashPoint(random()), started_at: starts };
    move(p, -p_bet);
    return money(p, { ok: true, state: 'waiting', bet: p_bet, auto: p_auto ?? null, started_at: starts, server_now: now });
  },

  cc_crash_cashout({ p_at }, db, p) {
    const st = crashResolve(p);
    if (st.state === 'none') return err('no_round');
    if (st.state === 'cashed' || st.state === 'crashed') return { ok: true, ...st };
    const r = p.crash;
    const el = Date.now() - r.started_at;
    if (el < 0) {
      move(p, r.bet);
      p.crash = null;
      return money(p, { ok: true, state: 'cancelled' });
    }
    let m = Math.floor(Math.exp(CRASH_K * el) * 100) / 100;
    if (p_at != null && p_at >= 1) m = Math.min(m, Math.floor(p_at * 100) / 100);
    m = Math.max(1, m);
    const pay = r2(r.bet * m);
    const entry = record(p, 'crash', r.bet, pay, `cashed @ ${m.toFixed(2)}×`);
    move(p, pay);
    p.crash = null;
    return money(p, { ok: true, state: 'cashed', mult: m, payout: pay, crash_point: r.crash_point, entry });
  },

  cc_crash_poll(_, db, p) {
    return { ok: true, server_now: Date.now(), ...crashResolve(p) };
  },

  // Road Rooster bet runs: pick a row to reach. The run is replayed on the score course
  // before it pays; reaching the row pays bet × that target's multiplier, anything else loses.
  cc_rooster_start({ p_bet, p_target }, db, p) {
    if (!validBet(p_bet)) return err('bad_bet');
    if (!targetMult(RR_TARGETS, p_target)) return err('bad_target');
    roosterSettle(p, false, 0, 'abandoned');
    if (p.balance < p_bet) return err('funds');
    const seed = 1 + Math.floor(random() * 2147483645);
    p.rooster = { bet: p_bet, target: p_target, seed, started: Date.now() };
    move(p, -p_bet);
    return money(p, { ok: true, seed, bet: p_bet, target: p_target });
  },

  cc_rooster_end({ p_moves, p_end_ms }, db, p) {
    const r = p.rooster;
    if (!r) return err('no_round');
    const el = Date.now() - r.started;
    const invalid = () => ({ ...roosterSettle(p, false, 0, 'invalid run'), alive: false, cause: 'invalid' });
    if (!Array.isArray(p_moves) || p_moves.length > 6000 || !Number.isInteger(p_end_ms)) return invalid();
    let prev = 0;
    for (const mv of p_moves) {
      if (!Array.isArray(mv) || !Number.isInteger(mv[0]) || !Number.isInteger(mv[1]) || mv[0] < prev || mv[0] > el + 2000 || mv[1] < 0 || mv[1] > 3) return invalid();
      prev = mv[0];
    }
    if (p_end_ms < prev || p_end_ms > el + 2000) return invalid();
    const res = scoreReplay(r.seed, p_moves, p_end_ms, r.target);
    const causeText = { line: 'caught by the red line', river: 'fell in the river', train: 'hit by a train', bus: 'hit by a bus', road: 'hit by a car' };
    const out = res.reached
      ? roosterSettle(p, true, res.score, `reached row ${r.target}`)
      : roosterSettle(p, false, res.score, `row ${res.score} of ${r.target} · ${causeText[res.cause] || 'run ended'}`);
    return { ...out, alive: res.alive, reached: res.reached, cause: res.cause ?? null, death_ms: res.deathMs ?? null };
  },

  // Night Flight bet flights: pick a number of gates. The flaps are replayed frame by frame.
  cc_flight_start({ p_bet, p_target }, db, p) {
    if (!validBet(p_bet)) return err('bad_bet');
    if (!targetMult(NF_TARGETS, p_target)) return err('bad_target');
    flightSettle(p, false, 0, 'abandoned');
    if (p.balance < p_bet) return err('funds');
    const seed = 1 + Math.floor(random() * 2147483645);
    p.flight = { bet: p_bet, target: p_target, seed, started: Date.now() };
    move(p, -p_bet);
    return money(p, { ok: true, seed, bet: p_bet, target: p_target });
  },

  cc_flight_end({ p_start, p_flaps, p_frames }, db, p) {
    const r = p.flight;
    if (!r) return err('no_round');
    const el = Date.now() - r.started;
    const invalid = () => ({ ...flightSettle(p, false, 0, 'invalid flight'), cause: 'invalid' });
    // Frames can't outrun the server's clock (30 a second, plus slack); flaps run forward.
    if (!Number.isInteger(p_start) || p_start < -8 || p_start > 8 || !Number.isInteger(p_frames) || p_frames < 0 || p_frames > (el / 1000) * FPS + 90) return invalid();
    if (!Array.isArray(p_flaps) || p_flaps.length > p_frames + 1) return invalid();
    let prev = -1;
    for (const f of p_flaps) {
      if (!Number.isInteger(f) || f <= prev || f >= p_frames) return invalid();
      prev = f;
    }
    const res = flightReplay(r.seed, p_start, p_flaps, r.target, p_frames);
    const out = res.reached
      ? flightSettle(p, true, res.score, `cleared ${r.target} gates`)
      : flightSettle(p, false, res.score, `${res.score} of ${r.target} gates`);
    return { ...out, reached: res.reached, crashed: res.crashed };
  },

  cc_bj_deal({ p_bet }, db, p) {
    if (!validBet(p_bet)) return err('bad_bet');
    if (p.bj) return err('round_active', { round: bjView(p) });
    if (p.balance < p_bet) return err('funds');
    move(p, -p_bet);
    const ev = [];
    if (!p.shoe || p.shoe.cards.length <= p.shoe.cut) {
      bjShuffle(p);
      ev.push({ t: 'shuffle' });
    }
    const c1 = bjDraw(p);
    const d1 = bjDraw(p);
    const c2 = bjDraw(p);
    const d2 = bjDraw(p);
    ev.push({ t: 'p', h: 1, c: c1 }, { t: 'd', c: d1 }, { t: 'p', h: 1, c: c2 }, { t: 'd', c: '??' });
    p.bj = { base: p_bet, wagered: p_bet, dealer: [d1, d2], h1: [c1, c2], h2: [], b1: p_bet, b2: 0, d1: false, d2: false, x1: false, x2: false, nhands: 1, active: 1, insurance: 0, phase: 'dealing', revealed: false };
    const half = r2(p_bet / 2);
    if (d1.slice(0, -1) === 'A' && p.balance >= half && half >= 0.01) {
      p.bj.phase = 'insurance';
      return bjView(p, ev, money(p));
    }
    return bjAfterInsurance(p, ev);
  },

  cc_bj_act({ p_action }, db, p) {
    const r = p.bj;
    if (!r) return err('no_round');
    const ev = [];
    if (r.phase === 'insurance') {
      if (p_action === 'insure') {
        const ins = r2(r.base / 2);
        if (p.balance >= ins) {
          move(p, -ins);
          r.insurance = ins;
          r.wagered = r2(r.wagered + ins);
        }
      } else if (p_action !== 'noinsure') return err('bad_action');
      r.phase = 'peek';
      return bjAfterInsurance(p, ev);
    }
    if (r.phase !== 'player') return err('bad_action');
    if (!bjView(p).can[p_action]) return err('bad_action');
    const h = r.active;
    const hand = h === 1 ? 'h1' : 'h2';
    const done = h === 1 ? 'd1' : 'd2';
    const betK = h === 1 ? 'b1' : 'b2';
    if (p_action === 'hit') {
      const c = bjDraw(p);
      r[hand].push(c);
      ev.push({ t: 'p', h, c });
      if (bjTotal(r[hand]).total >= 21) r[done] = true;
    } else if (p_action === 'stand') {
      r[done] = true;
    } else if (p_action === 'double') {
      move(p, -r[betK]);
      r.wagered = r2(r.wagered + r[betK]);
      r[betK] = r2(r[betK] * 2);
      r[h === 1 ? 'x1' : 'x2'] = true;
      r[done] = true;
      const c = bjDraw(p);
      r[hand].push(c);
      ev.push({ t: 'p', h, c, x: true });
    } else if (p_action === 'split') {
      move(p, -r.b1);
      const moved = r.h1[1];
      r.wagered = r2(r.wagered + r.b1);
      r.h1 = [r.h1[0]];
      r.h2 = [moved];
      r.b2 = r.b1;
      r.nhands = 2;
      ev.push({ t: 'split', c: moved });
      let c = bjDraw(p);
      r.h1.push(c);
      ev.push({ t: 'p', h: 1, c });
      c = bjDraw(p);
      r.h2.push(c);
      ev.push({ t: 'p', h: 2, c });
      if (moved.slice(0, -1) === 'A') r.d1 = r.d2 = true;
      else {
        r.d1 = bjTotal(r.h1).total === 21;
        r.d2 = bjTotal(r.h2).total === 21;
      }
    }
    if ((r.active === 1 && r.d1) || (r.active === 2 && r.d2)) {
      const nxt = !r.d1 ? 1 : r.nhands === 2 && !r.d2 ? 2 : 0;
      if (nxt === 0) return bjDealerTurn(p, ev);
      r.active = nxt;
    }
    return bjView(p, ev, money(p));
  },
};

function roosterSettle(p, won, score, info) {
  const r = p.rooster;
  if (!r) return null;
  const mult = won ? targetMult(RR_TARGETS, r.target) : 0;
  const pay = r2(r.bet * mult);
  const entry = record(p, 'rooster', r.bet, pay, info);
  move(p, pay);
  p.rooster = null;
  return money(p, { ok: true, mult, payout: pay, score, target: r.target, entry });
}

function flightSettle(p, won, score, info) {
  const r = p.flight;
  if (!r) return null;
  const mult = won ? targetMult(NF_TARGETS, r.target) : 0;
  const pay = r2(r.bet * mult);
  const entry = record(p, 'flight', r.bet, pay, info);
  move(p, pay);
  p.flight = null;
  return money(p, { ok: true, mult, payout: pay, score, target: r.target, entry });
}

function minesFinish(p, won) {
  const r = p.mines;
  const k = r.revealed.length;
  const mult = won ? minesMult(r.mines, k) : 0;
  const pay = won ? r2(r.bet * mult) : 0;
  const entry = record(p, 'mines', r.bet, pay, `${r.mines} ${r.mines === 1 ? 'mine' : 'mines'}`);
  move(p, pay);
  p.mines = null;
  return money(p, { ok: true, mult: Math.round(mult * 10000) / 10000, payout: pay, cells: [...r.cells], revealed: [...r.revealed], entry });
}

const localCases = caseApi({ move, record, money, err });
Object.assign(API, localCases.api);

const NO_AUTH = new Set(['cc_signup', 'cc_login', 'cc_logout', 'cc_leaderboard']);

/** Same shape as a call to the real server: call('cc_plinko', { p_token, p_bet, ... }). */
async function callLocked(fn, args = {}) {
  const impl = API[fn];
  if (!impl) return err('unknown_function');
  if (NO_AUTH.has(fn)) return impl(args);
  const db = readDb();
  const p = auth(db, args.p_token);
  if (!p) return err('auth');
  // Each call reads a fresh copy and saves only if it finished, so an error can't leave half a bet behind.
  const res = impl(args, db, p);
  writeDb(db);
  return res;
}

// Serialize device transactions across tabs, including asynchronous account writes.
export function call(fn, args = {}) {
  const run = () => callLocked(fn, args);
  return globalThis.navigator?.locks ? navigator.locks.request(DB_KEY, run) : run();
}
