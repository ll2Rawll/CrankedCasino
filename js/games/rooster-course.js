// Score runs have no terminal row or chip value. Chip runs keep rrLane, which the
// server replays, unchanged. The score course draws each lane from its own hash so
// neighbouring rows are independent (rrRand moves by a fixed step from one row to the
// next, which lines whole stretches of road up in the same direction).
import { RR } from '../math.js';

const mix = (x) => {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  return x ^ (x >>> 16);
};

/** Uniform in [0, 1) for (seed, row, slot). Every input bit reaches every output bit. */
export const scoreRand = (seed, row, slot) =>
  (mix(mix(mix(seed ^ 0x2c1b3c6d) ^ row ^ 0x297a2d39) ^ slot ^ 0x1d8e4e27) >>> 0) / 4294967296;

// Cars, buses, trains and grass, with rrLane's mix and speeds. `level` sets the pace.
// `grass` is false when the two rows below are already grass: three grass rows can
// line their trees up into a wall, while any two leave a gap (each has 4+ open tiles).
function traffic(R, level, grass) {
  const f = Math.min(1, level / 60);
  const q = grass ? R(0) : 0.2 + 0.8 * R(6);
  const kind = level <= 2 ? 'road' : q < 0.2 ? 'safe' : level >= 6 && q < 0.28 ? 'train' : q < 0.45 ? 'bus' : 'road';
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
  const start = 5 + Math.floor(scoreRand(seed, Math.floor(row / 16), 81) * 4);
  return local >= start && local <= start + 2 ? local - start : -1;
}
// Keep the introduction gentle, then ramp each district towards full pace.
const level = (row) => (row < 16 ? row : 12 + (row % 16) + Math.min(40, Math.floor(row / 16) * 3));
// Would this traffic row be grass, before the limit of two in a row?
const grassDraw = (seed, row) => row > 0 && riverRow(seed, row) < 0 && level(row) > 2 && scoreRand(seed, row, 0) < 0.2;

export function scoreLane(seed, row) {
  if (row <= 0) return { kind: 'start', blocked: [] };
  const R = (slot) => scoreRand(seed, row, slot);
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
