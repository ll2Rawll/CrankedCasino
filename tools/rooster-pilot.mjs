// A route planner for Road Rooster's score run, used by the play-tests.
// It reads the same lane recipes and collision maths as the game, so any route it
// finds is one the game accepts. Time is in course seconds (the game's world clock).
import { RR, rrHit } from '../js/math.js';
import { scoreLane, platformCenter } from '../js/games/rooster-course.js';

export const COURSE_SPEED = 0.9; // SCORE_COURSE_SPEED in js/games/rooster.js
export const chaseLine = (t) => Math.max(0, (t - 6) * 0.65); // the red line, as in rooster.js
export const MOVES = { forward: 0, back: 1, left: 2, right: 3 };

/**
 * pilot(seed) plans on a grid of `stepMs` real milliseconds. After every hop the rooster
 * holds still for `hopSteps` steps, roughly a quick human's tapping rhythm. `margin`
 * keeps routes clear of knife-edge timings (in lane units).
 */
export function pilot(seed, { stepMs = 40, hopSteps = 4, margin = 0.04, course = scoreLane } = {}) {
  const dt = (stepMs / 1000) * COURSE_SPEED;
  const lanes = new Map();
  const lane = (r) => {
    let L = lanes.get(r);
    if (!L) lanes.set(r, (L = course(seed, r)));
    return L;
  };
  // A rooster state is { row, col, tl }: on a log, the column drifts from col at time tl.
  const xAt = (s, t) => s.col + (lane(s.row).speed || 0) * (t - s.tl);
  const supported = (L, x, t, m = margin) =>
    x >= -0.5 + m && x < RR.COLS - 0.5 - m && Math.abs(x - platformCenter(L, x, t)) <= L.width / 2 - m;

  /** Does a rooster standing still in state s survive from t0 to t1? */
  function safe(s, t0, t1) {
    if (chaseLine(t1) > s.row + 1 - margin) return false;
    const L = lane(s.row);
    if (L.kind === 'river') return supported(L, xAt(s, t0), t0) && supported(L, xAt(s, t1), t1);
    return rrHit(L, s.col, t0, t1, RR.HB_CLIENT + margin) < 0;
  }

  /** The game's move(): where move m at time t lands, or null for a bump or a drowning. */
  function hop(s, m, t) {
    let row = s.row;
    let col = Math.round(xAt(s, t));
    if (m === 0) row++;
    else if (m === 1) row--;
    else if (m === 2) col--;
    else col++;
    if (row < 0 || col < 0 || col >= RR.COLS || lane(row).blocked.includes(col)) return null;
    const L = lane(row);
    if (L.kind === 'river' && !supported(L, col, t)) return null;
    return { row, col, tl: t };
  }

  /**
   * The earliest route from s at time t0 to a state where goal(state, k) holds.
   * Returns [{ k, m, s }] (move m at step k, landing in s) or null.
   */
  function route(s, t0, goal, maxSteps = 600) {
    const buckets = [[{ s, k: 0, prev: null, m: -1 }]];
    const lowest = s.row - 3; // retreating further than this never helps
    for (let k = 0; k <= maxSteps; k++) {
      const bucket = buckets[k];
      if (!bucket) continue;
      const seen = new Set();
      const t = t0 + k * dt;
      for (const node of bucket) {
        const key = `${node.s.row}:${Math.round(xAt(node.s, t) * 10)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (goal(node.s, k)) {
          const moves = [];
          for (let n = node; n.prev; n = n.prev) if (n.m >= 0) moves.unshift({ k: n.prev.k, m: n.m, s: n.s });
          return moves;
        }
        const push = (j, next) => (buckets[j] ||= []).push(next);
        if (safe(node.s, t, t + dt)) push(k + 1, { s: node.s, k: k + 1, prev: node, m: -1 });
        for (const m of [0, 2, 3, 1]) {
          const next = hop(node.s, m, t);
          if (next && next.row >= lowest && safe(next, t, t + hopSteps * dt)) push(k + hopSteps, { s: next, k: k + hopSteps, prev: node, m });
        }
      }
      buckets[k] = null;
    }
    return null;
  }

  /**
   * The next stretch of a run from s at t0, where `best` is the furthest row so far.
   * Plans six rows ahead but only commits to the first two new rows, so the rooster
   * doesn't walk into a stretch with no way out. Falls back to shorter goals, and finally
   * to simply staying alive, when the road ahead is too busy.
   */
  function next(s, t0, best) {
    for (const ahead of [6, 4, 2, 1]) {
      const moves = route(s, t0, (st) => st.row >= best + ahead);
      if (!moves) continue;
      const commit = moves.findIndex((mv) => mv.s.row >= best + Math.min(2, ahead));
      return moves.slice(0, commit + 1);
    }
    // [] means "hold still for a moment"; null means every option ends the run.
    const moves = route(s, t0, (st, k) => k >= 60, 60);
    return moves && moves.slice(0, 1);
  }

  /**
   * Plays a whole run without a browser. Returns the furthest row and the course time,
   * or the state where no way forward or out was found.
   */
  function run(targetRow, { onMove } = {}) {
    let s = { row: 0, col: RR.START_COL, tl: 0 };
    let t = 0;
    let best = 0;
    while (best < targetRow) {
      const moves = next(s, t, best);
      if (!moves) return { best, t, stuck: s };
      if (!moves.length) t += 10 * dt;
      for (const mv of moves) {
        s = mv.s;
        best = Math.max(best, s.row);
        onMove?.(mv, s, best);
      }
      if (moves.length) t = s.tl + hopSteps * dt;
    }
    return { best, t };
  }

  return { lane, xAt, safe, hop, route, next, run, dt, stepMs, hopSteps };
}
