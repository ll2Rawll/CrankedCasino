// Score runs have no terminal row or chip value. Chip runs use rrLane unchanged.
import { RR, rrLane, rrRand } from '../math.js';

export function scoreLane(seed, row) {
  if (row <= 0) return rrLane(seed, row);
  const district = Math.floor(row / 16);
  const districtSeed = 1 + Math.floor(rrRand(seed, district, 81) * 2147483645);
  const local = row % 16;
  const riverStart = 5 + Math.floor(rrRand(districtSeed, 0, 2) * 4);
  if (local < riverStart || local > riverStart + 2) {
    // Vary the traffic independently in each district. Keep the introduction gentle.
    return rrLane(districtSeed, district === 0 ? row : 12 + local + Math.min(40, district * 3));
  }
  const pads = local === riverStart + 1;
  const speed = pads ? 0 : (rrRand(seed, row, 2) < 0.5 ? -1 : 1) * (0.6 + rrRand(seed, row, 3) * 0.6);
  return { kind: 'river', pads, speed, period: pads ? 2 : 4, width: pads ? 0.88 : 2.5,
    offset: pads ? (rrRand(seed, row, 4) < 0.5 ? 0 : 1) : rrRand(seed, row, 4) * 4, blocked: [] };
}

// Coordinates are tile centers, with column 0 centered at x = 0.
export function platformCenter(lane, col, t) {
  const first = lane.offset + lane.speed * t;
  return first + Math.round((col - first) / lane.period) * lane.period;
}

export function onPlatform(lane, col, t) {
  return col >= -0.5 && col < RR.COLS - 0.5 && Math.abs(col - platformCenter(lane, col, t)) <= lane.width / 2;
}
