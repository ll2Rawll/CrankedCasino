// Game maths shared by the game screens and the on-device server (engine-local.js).
// The real server, supabase/schema.sql, implements exactly the same rules in SQL.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ------------------------------------------------------------------ plinko
// Bin k of n rows is hit with probability C(n,k)/2^n. Every table returns ≈99%.
export const PLINKO = {
  low: {
    8: [5.6, 2.8, 1.3, 0.8, 0.5, 0.8, 1.3, 2.8, 5.6],
    9: [6.8, 3.4, 1.8, 0.9, 0.6, 0.6, 0.9, 1.8, 3.4, 6.8],
    10: [7.4, 4.2, 2.3, 1.2, 0.7, 0.5, 0.7, 1.2, 2.3, 4.2, 7.4],
    11: [8.4, 4.7, 2.7, 1.4, 0.9, 0.6, 0.6, 0.9, 1.4, 2.7, 4.7, 8.4],
    12: [9, 5.5, 3.1, 1.9, 1.1, 0.7, 0.5, 0.7, 1.1, 1.9, 3.1, 5.5, 9],
    13: [11, 6.2, 3.7, 2.4, 1.3, 0.8, 0.6, 0.6, 0.8, 1.3, 2.4, 3.7, 6.2, 11],
    14: [12, 7.5, 4.2, 2.6, 1.7, 1, 0.7, 0.5, 0.7, 1, 1.7, 2.6, 4.2, 7.5, 12],
    15: [14, 8.8, 5.3, 3.2, 1.9, 1.2, 0.8, 0.6, 0.6, 0.8, 1.2, 1.9, 3.2, 5.3, 8.8, 14],
    16: [16, 9.6, 6, 3.6, 2.3, 1.4, 1, 0.7, 0.5, 0.7, 1, 1.4, 2.3, 3.6, 6, 9.6, 16],
  },
  medium: {
    8: [13, 3.7, 1.3, 0.6, 0.4, 0.6, 1.3, 3.7, 13],
    9: [17, 5.6, 1.9, 0.8, 0.4, 0.4, 0.8, 1.9, 5.6, 17],
    10: [22, 7.1, 2.8, 1.1, 0.5, 0.4, 0.5, 1.1, 2.8, 7.1, 22],
    11: [29, 10, 3.8, 1.5, 0.7, 0.4, 0.4, 0.7, 1.5, 3.8, 10, 29],
    12: [38, 13, 4.9, 2.2, 0.9, 0.5, 0.4, 0.5, 0.9, 2.2, 4.9, 13, 38],
    13: [49, 18, 7.1, 2.9, 1.3, 0.6, 0.4, 0.4, 0.6, 1.3, 2.9, 7.1, 18, 49],
    14: [64, 24, 9.2, 3.8, 1.7, 0.8, 0.5, 0.4, 0.5, 0.8, 1.7, 3.8, 9.2, 24, 64],
    15: [84, 32, 12, 5.2, 2.3, 1.1, 0.6, 0.4, 0.4, 0.6, 1.1, 2.3, 5.2, 12, 32, 84],
    16: [110, 43, 17, 7.4, 3.3, 1.5, 0.8, 0.4, 0.3, 0.4, 0.8, 1.5, 3.3, 7.4, 17, 43, 110],
  },
  high: {
    8: [29, 4.7, 1.1, 0.4, 0.2, 0.4, 1.1, 4.7, 29],
    9: [45, 8.1, 1.9, 0.5, 0.2, 0.2, 0.5, 1.9, 8.1, 45],
    10: [70, 12, 2.9, 0.8, 0.3, 0.2, 0.3, 0.8, 2.9, 12, 70],
    11: [110, 20, 4.4, 1.3, 0.4, 0.2, 0.2, 0.4, 1.3, 4.4, 20, 110],
    12: [170, 31, 7, 1.8, 0.6, 0.3, 0.2, 0.3, 0.6, 1.8, 7, 31, 170],
    13: [270, 48, 11, 2.8, 0.9, 0.4, 0.2, 0.2, 0.4, 0.9, 2.8, 11, 48, 270],
    14: [410, 75, 16, 4.2, 1.4, 0.5, 0.3, 0.2, 0.3, 0.5, 1.4, 4.2, 16, 75, 410],
    15: [640, 120, 25, 6.7, 2, 0.7, 0.4, 0.2, 0.2, 0.4, 0.7, 2, 6.7, 25, 120, 640],
    16: [1000, 180, 39, 9.8, 2.9, 1, 0.5, 0.3, 0.2, 0.3, 0.5, 1, 2.9, 9.8, 39, 180, 1000],
  },
};

// ------------------------------------------------------------------ slots
// 5 reels × 3 rows, 10 fixed lines. Every cell is drawn independently with these
// weights: line pays ≈ 84%, scatter pays ≈ 2%, free spins ≈ 11.4% → RTP ≈ 97.5%.
export const SLOT_WEIGHTS = [19, 18, 16, 12, 9, 6, 4, 4.2, 2.5];
export const SLOT_TOTAL_W = SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
export const WILD = 7;
export const SCAT = 8;
// pays × line bet for 3, 4, 5 in a row (from the leftmost reel)
export const SLOT_PAY = [
  [6, 20, 50],
  [7, 20, 60],
  [8, 25, 80],
  [12, 40, 125],
  [20, 60, 200],
  [30, 100, 400],
  [50, 200, 750],
  [80, 300, 1500],
];
export const SCAT_PAY = { 3: 2, 4: 10, 5: 50 }; // × total bet, anywhere
export const FS_AWARD = { 3: 8, 4: 12, 5: 20 };
export const FS_MULT = 2;
export const LINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [1, 0, 1, 2, 1],
];

function linePay(syms) {
  let target = -1;
  let count = 0;
  for (let i = 0; i < 5; i++) {
    const s = syms[i];
    if (s === SCAT) break;
    if (s === WILD) {
      count++;
      continue;
    }
    if (target < 0) {
      target = s;
      count++;
      continue;
    }
    if (s === target) {
      count++;
      continue;
    }
    break;
  }
  let wr = 0;
  while (wr < 5 && syms[wr] === WILD) wr++;
  const pt = target >= 0 && count >= 3 ? SLOT_PAY[target][count - 3] : 0;
  const pw = wr >= 3 ? SLOT_PAY[WILD][wr - 3] : 0;
  if (pw > pt) return { pay: pw, count: wr, sym: WILD };
  return { pay: pt, count, sym: target };
}

/** grid[c][r]: 5 columns of 3 symbols. */
export function slotEvaluate(grid, totalBet, mult = 1) {
  const lineBet = totalBet / LINES.length;
  const wins = [];
  LINES.forEach((line, li) => {
    const syms = line.map((r, c) => grid[c][r]);
    const { pay, count, sym } = linePay(syms);
    if (pay > 0) wins.push({ li, count, sym, amount: round2(pay * lineBet * mult), cells: line.slice(0, count).map((r, c) => [c, r]) });
  });
  const scat = [];
  grid.forEach((col, c) => col.forEach((s, r) => s === SCAT && scat.push([c, r])));
  const n = Math.min(scat.length, 5);
  const scatWin = n >= 3 ? round2(SCAT_PAY[n] * totalBet * mult) : 0;
  const fs = n >= 3 ? FS_AWARD[n] : 0;
  const total = round2(wins.reduce((a, w) => a + w.amount, 0) + scatWin);
  return { wins, scat, scatWin, fs, total };
}

/** The server sends grids flat (index = reel × 3 + row). */
export const unflatGrid = (flat) => Array.from({ length: 5 }, (_, c) => [flat[c * 3], flat[c * 3 + 1], flat[c * 3 + 2]]);

// ------------------------------------------------------------------ roulette
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
export const ROULETTE_TESTS = {
  red: (n) => REDS.has(n),
  black: (n) => n > 0 && !REDS.has(n),
  odd: (n) => n % 2 === 1,
  even: (n) => n > 0 && n % 2 === 0,
  low: (n) => n >= 1 && n <= 18,
  high: (n) => n >= 19,
  'dozen:1': (n) => n >= 1 && n <= 12,
  'dozen:2': (n) => n >= 13 && n <= 24,
  'dozen:3': (n) => n >= 25,
  'col:1': (n) => n > 0 && n % 3 === 1,
  'col:2': (n) => n > 0 && n % 3 === 2,
  'col:3': (n) => n > 0 && n % 3 === 0,
};
/** Chips returned per chip staked (stake included): 36 straight up, 3 dozens/columns, 2 even money. */
export function rouletteMult(key, n) {
  if (key.startsWith('n:')) return Number(key.slice(2)) === n ? 36 : 0;
  const test = ROULETTE_TESTS[key];
  if (!test) return 0;
  return test(n) ? (key.startsWith('dozen') || key.startsWith('col') ? 3 : 2) : 0;
}
export const ROULETTE_KEY = /^(n:([0-9]|[12][0-9]|3[0-6])|red|black|odd|even|low|high|dozen:[123]|col:[123])$/;

// ------------------------------------------------------------------ mines
// Multiplier after k gems with m mines = 0.99 × Π (25 − i) / (25 − m − i), i < k.
export function minesMult(mines, k) {
  let m = 0.99;
  for (let i = 0; i < k; i++) m *= (25 - i) / (25 - mines - i);
  return m;
}

// ------------------------------------------------------------------ crash
// Multiplier after t ms = e^(K·t). Crash point = 0.99 / (1 − U), floored to 2 decimals,
// so P(crash ≥ x) = 0.99 / x and every cash-out target keeps a 1% house edge.
export const CRASH_K = 0.00009;
export const crashAt = (ms) => Math.floor(Math.exp(CRASH_K * Math.max(0, ms)) * 100) / 100;
export const crashTimeFor = (m) => Math.log(m) / CRASH_K;
export const crashPoint = (u) => Math.min(10000, Math.max(1, Math.floor((0.99 / (1 - u)) * 100) / 100));

// ------------------------------------------------------------------ blackjack
// The server writes cards as rank + suit letter: 'AS', '10H', 'KD', 'QC'.
const SUIT_OF = { S: 'spade', H: 'heart', D: 'diamond', C: 'club' };
export const parseCard = (s) => ({ r: s.slice(0, -1), s: SUIT_OF[s.slice(-1)] || 'spade' });
export const cardText = (c) => c.r + { spade: 'S', heart: 'H', diamond: 'D', club: 'C' }[c.s];

// ------------------------------------------------------------------ road rooster (skill game)
// Hop across a highway one lane at a time, dodging cars, buses and trains. The server
// hands out a seed, the same seed lays out the traffic here and in supabase/schema.sql,
// and the server replays your moves before it pays. Everything below must match the
// SQL step for step (same numbers, same order of operations), so don't "tidy" it.
export const RR = { COLS: 7, START_COL: 3, FINISH: 75, HB_CLIENT: 0.3, HB_SERVER: 0.27, HAWK_CLIENT: 1, HAWK_SERVER: 1.1 };
const M31 = 2147483647;

/** Deterministic random number in [0, 1) for (seed, row, slot). */
export function rrRand(seed, row, slot) {
  let x = (seed * 31 + row * 7919 + slot * 104729 + 12345) % M31;
  if (x <= 0) x += M31 - 1;
  for (let i = 0; i < 3; i++) x = (x * 48271) % M31;
  return x / M31;
}

/** What's on row r: start, finish, safe (sidewalk with obstacles), road, bus or train. */
export function rrLane(seed, r) {
  if (r <= 0) return { kind: 'start', blocked: [] };
  if (r >= RR.FINISH) return { kind: 'finish', blocked: [] };
  const R = (slot) => rrRand(seed, r, slot);
  const f = Math.min(1, r / 60);
  const q = R(0);
  const kind = r <= 2 ? 'road' : q < 0.2 ? 'safe' : r >= 6 && q < 0.28 ? 'train' : q < 0.45 ? 'bus' : 'road';
  const dir = R(1) < 0.5 ? 1 : -1;
  if (kind === 'safe') {
    const blocked = [];
    for (let c = 0; c < RR.COLS; c++) if (blocked.length < 3 && R(10 + c) < 0.22) blocked.push(c);
    return { kind, dir, blocked };
  }
  let len, v, P;
  if (kind === 'train') {
    len = 14;
    v = 16 + 6 * R(3);
    P = v * (6 + 5 * R(4));
  } else if (kind === 'bus') {
    len = 2.6 + 0.6 * R(2);
    v = (1.1 + 1.2 * R(3)) * (1 + 0.7 * f);
    P = len + (3.6 - 1.0 * f) + 3.0 * R(4);
  } else {
    len = 1.0 + 0.35 * R(2);
    v = (1.5 + 2.0 * R(3)) * (1 + 0.9 * f);
    P = len + (3.2 - 1.0 * f) + 2.6 * R(4);
  }
  const phase = R(5) * P;
  return { kind, dir, len, v, P, phase, blocked: [] };
}

/** Front of every vehicle on lane L at time t (seconds): phase + dir·v·t + n·P, in column units. */
export const rrFront = (L, t, n) => L.phase + L.dir * L.v * t + n * L.P;

/**
 * First moment in [t0, t1] (seconds) that a vehicle on lane L touches a rooster standing in
 * column c (half-width hb), or -1. Vehicles move at a constant speed with constant gaps, so
 * this is exact: no frame-rate tunnelling, and the server gets the same answer.
 */
export function rrHit(L, c, t0, t1, hb) {
  if (!L.v) return -1;
  const A = L.dir === 1 ? c + 0.5 - hb : c + 0.5 - hb - L.len;
  const Lw = 2 * hb + L.len;
  const x0 = L.phase + L.dir * L.v * t0;
  const a = x0 - A;
  const u0 = a - L.P * Math.floor(a / L.P);
  if (u0 < Lw) return t0;
  const dt = t1 - t0;
  if (L.dir === 1) {
    if (u0 + L.v * dt >= L.P) return t0 + (L.P - u0) / L.v;
  } else if (u0 - L.v * dt < Lw) return t0 + (u0 - Lw) / L.v;
  return -1;
}

/** The hawk line creeps up the road: rows covered after t seconds (4 s head start). */
export const rrHawk = (t) => (t <= 4 ? 0 : 0.4 * (t - 4) + 0.004 * (t - 4) * (t - 4));
/** When the hawk line passes row r + margin. */
export const rrHawkTime = (r, margin) => 4 + (-0.4 + Math.sqrt(0.16 + 0.016 * (r + margin))) / 0.008;

/**
 * Replay a run: moves = [[ms, move], ...] with move 0 forward, 1 back, 2 left, 3 right.
 * Returns { alive, score (furthest row), row, deathMs?, cause?, finished? }.
 */
export function rrReplay(seed, moves, endMs, hb = RR.HB_SERVER, margin = RR.HAWK_SERVER) {
  let row = 0;
  let col = RR.START_COL;
  let best = 0;
  let tPrev = 0;
  const cache = new Map();
  const lane = (r) => {
    if (!cache.has(r)) cache.set(r, rrLane(seed, r));
    return cache.get(r);
  };
  const dwell = (t1) => {
    const L = lane(row);
    let tHit = rrHit(L, col, tPrev, t1, hb);
    let cause = L.kind;
    if (row < RR.FINISH) {
      const th = Math.max(tPrev, rrHawkTime(row, margin));
      if (th <= t1 && (tHit < 0 || th < tHit)) {
        tHit = th;
        cause = 'hawk';
      }
    }
    return tHit >= 0 ? { alive: false, score: best, row, deathMs: Math.round(tHit * 1000), cause } : null;
  };
  for (const [ms, m] of moves) {
    const t = ms / 1000;
    const d = dwell(t);
    if (d) return d;
    let nr = row;
    let nc = col;
    if (m === 0) nr += 1;
    else if (m === 1) nr -= 1;
    else if (m === 2) nc -= 1;
    else if (m === 3) nc += 1;
    if (nr >= 0 && nr <= RR.FINISH && nc >= 0 && nc < RR.COLS && !lane(nr).blocked.includes(nc)) {
      row = nr;
      col = nc;
      best = Math.max(best, row);
    }
    tPrev = t;
    if (row >= RR.FINISH) return { alive: true, score: best, row, finished: true };
  }
  return dwell(endMs / 1000) || { alive: true, score: best, row };
}

/** Payout multiplier for the furthest row reached: row/10 up to row 10, then ×1.07 a row. */
export function rrMult(k) {
  if (k <= 0) return 0;
  if (k <= 10) return k / 10;
  const n = BigInt(k - 10);
  return Number((107n ** n * 100n) / 100n ** n) / 100;
}
