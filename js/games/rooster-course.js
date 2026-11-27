// Road Rooster's course: free score runs and bet runs both play it. Each lane comes from
// its own hash (hash01, shared with the server); an earlier generator stepped linearly from
// one row to the next and lined whole stretches of road up in the same direction. The
// server mirrors every function here in SQL (supabase/schema.sql, cc.rs_*).
import { RR, rrHit, hash01 } from '../math.js?v=779240ffda44';

/** Uniform in [0, 1) for (seed, row, slot). */
export const scoreRand = hash01;

/** The red line: rows it has swallowed after t course seconds (8 seconds' grace). */
export const LINE_GRACE = 8;
export const LINE_SPEED = 0.5; // rows a second
export const chaseLine = (t) => Math.max(0, (t - LINE_GRACE) * LINE_SPEED);

// Cars, buses, trains and grass. `level` sets the pace. About a third of these rows are
// grass, so roads come in short runs with a rest between them.
// `grass` is false when the two rows below are already grass: three grass rows can
// line their trees up into a wall, while any two leave a gap (each has 4+ open tiles).
function traffic(R, level, grass) {
  const f = Math.min(1, level / 80);
  const q = grass ? R(0) : 0.35 + 0.65 * R(6);
  const kind = level <= 2 ? 'road' : q < 0.35 ? 'safe' : level >= 6 && q < 0.43 ? 'train' : q < 0.58 ? 'bus' : 'road';
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
    v = (1.0 + 1.0 * R(3)) * (1 + 0.5 * f);
    P = len + (4.2 - 0.8 * f) + 3.2 * R(4);
  } else {
    len = 1.0 + 0.35 * R(2);
    v = (1.3 + 1.6 * R(3)) * (1 + 0.6 * f);
    P = len + (3.8 - 0.8 * f) + 3.0 * R(4);
  }
  return { kind, dir, len, v, P, phase: R(5) * P, blocked: [] };
}

// Drifting logs, or a row of lily pads on alternate columns.
function river(R, pads) {
  const speed = pads ? 0 : (R(2) < 0.5 ? -1 : 1) * (0.6 + R(3) * 0.6);
  return { kind: 'river', pads, speed, period: pads ? 2 : 4, width: pads ? 0.88 : 2.5,
    offset: pads ? (R(4) < 0.5 ? 0 : 1) : R(4) * 4, blocked: [] };
}

// Every 16 rows is a district with one log, pad, log river somewhere in rows 5 to 10.
function riverRow(seed, row) {
  const local = row % 16;
  const start = 5 + Math.floor(hash01(seed, Math.floor(row / 16), 81) * 4);
  return local >= start && local <= start + 2 ? local - start : -1;
}
// Keep the introduction gentle, then ramp each district towards full pace.
const level = (row) => (row < 16 ? row : 12 + (row % 16) + Math.min(40, Math.floor(row / 16) * 3));
// Would this traffic row be grass, before the limit of two in a row?
const grassDraw = (seed, row) => row > 0 && riverRow(seed, row) < 0 && level(row) > 2 && hash01(seed, row, 0) < 0.35;

export function scoreLane(seed, row) {
  if (row <= 0) return { kind: 'start', blocked: [] };
  const R = (slot) => hash01(seed, row, slot);
  const water = riverRow(seed, row);
  if (water >= 0) return river(R, water === 1);
  return traffic(R, level(row), !(grassDraw(seed, row - 1) && grassDraw(seed, row - 2)));
}

// Coordinates are tile centers, with column 0 centered at x = 0.
export function platformCenter(lane, col, t) {
  const first = lane.offset + lane.speed * t;
  return first + Math.round((col - first) / lane.period) * lane.period;
}

export function onPlatform(lane, col, t) {
  return col >= -0.5 && col < RR.COLS - 0.5 && Math.abs(col - platformCenter(lane, col, t)) <= lane.width / 2;
}

/**
 * Replay a bet run: moves = [[ms, move], ...] in course milliseconds (0 forward, 1 back,
 * 2 left, 3 right), until the rooster reaches row `goal` or endMs. It applies the game's
 * rules in the game's order (dangers on the current tile, then the hop). The server's
 * tolerances are a little kinder than the game's own checks (a narrower rooster, a later
 * red line, wider logs), so a run the game saw survive never fails on rounding.
 * Returns { alive, reached, score (furthest row), row, deathMs?, cause? }.
 */
export function scoreReplay(seed, moves, endMs, goal, { hb = RR.HB_SERVER, line = 0.1, edge = 0.05 } = {}) {
  const lanes = new Map();
  const lane = (r) => {
    if (!lanes.has(r)) lanes.set(r, scoreLane(seed, r));
    return lanes.get(r);
  };
  let row = 0, col = RR.START_COL, landed = 0, best = 0, tprev = 0;
  const dead = (t, cause) => ({ alive: false, reached: false, score: best, row, deathMs: Math.round(t * 1000), cause });
  for (let i = 0; i <= moves.length; i++) {
    const t = (i < moves.length ? moves[i][0] : endMs) / 1000;
    const L = lane(row);
    let at = -1, cause = null;
    const sooner = (when, why) => {
      if (when >= 0 && when <= t && (at < 0 || when < at)) {
        at = when;
        cause = why;
      }
    };
    sooner(Math.max(tprev, LINE_GRACE + (row + 1 + line) / LINE_SPEED), 'line');
    if (L.kind === 'river') {
      // A log carries the rooster; she drowns if it takes her past the edge of the course.
      if (L.speed) sooner(Math.max(tprev, landed + ((L.speed > 0 ? RR.COLS - 0.5 + edge : -0.5 - edge) - col) / L.speed), 'river');
    } else sooner(rrHit(L, col, tprev, t, hb), L.kind);
    if (at >= 0) return dead(at, cause);
    if (i === moves.length) break;
    const m = moves[i][1];
    let nr = row;
    let nc = Math.round(col + (L.speed || 0) * (t - landed));
    if (m === 0) nr++;
    else if (m === 1) nr--;
    else if (m === 2) nc--;
    else nc++;
    if (nr >= 0 && nc >= 0 && nc < RR.COLS && !lane(nr).blocked.includes(nc)) {
      const N = lane(nr);
      row = nr;
      col = nc;
      landed = t;
      if (N.kind === 'river' && Math.abs(nc - platformCenter(N, nc, t)) > N.width / 2 + edge) return dead(t, 'river');
      best = Math.max(best, row);
      if (best >= goal) return { alive: true, reached: true, score: best, row };
    }
    tprev = t;
  }
  return { alive: true, reached: false, score: best, row };
}
