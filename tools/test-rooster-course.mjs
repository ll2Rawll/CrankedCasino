// node tools/test-rooster-course.mjs
// Checks the score run's course: each seed always lays out the same road, neighbouring
// rows are independent, grass never walls the road off, every river can be crossed, and
// a pilot tapping at most 8 times a second crosses 40 random courses to row 300. Bet runs
// are settled by replaying them; the replay agrees with the game.
import assert from 'node:assert/strict';
import { RR } from '../js/math.js';
import { scoreLane, scoreRand, platformCenter, onPlatform, scoreReplay } from '../js/games/rooster-course.js';
import { pilot } from './rooster-pilot.mjs';

const ROWS = 400;
const seeds = Array.from({ length: 300 }, (_, i) => ((i + 1) * 2654435761) % 2147483640 + 1);

// The same seed always gives the same road, and the start is gentle.
for (const seed of seeds.slice(0, 20)) {
  for (let r = -4; r < ROWS; r++) assert.deepEqual(scoreLane(seed, r), scoreLane(seed, r));
  for (let r = -4; r <= 0; r++) assert.equal(scoreLane(seed, r).kind, 'start');
  assert.equal(scoreLane(seed, 1).kind, 'road');
  assert.equal(scoreLane(seed, 2).kind, 'road');
}

// The hash is uniform, and neither the next row nor the next slot follows from the last.
{
  const n = 400000;
  const deciles = new Array(10).fill(0);
  let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0;
  for (let i = 0; i < n; i++) {
    const seed = seeds[i % seeds.length], row = Math.floor(i / seeds.length), slot = i % 17;
    const x = scoreRand(seed, row, slot), y = scoreRand(seed, row + 1, slot), z = scoreRand(seed, row, slot + 1);
    deciles[Math.floor(x * 10)]++;
    sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; szz += z * z; sxy += x * y; sxz += x * z;
  }
  const corr = (sab, sa, sb, saa, sbb) => (n * sab - sa * sb) / Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb));
  for (const d of deciles) assert(Math.abs(d / n - 0.1) < 0.003, `scoreRand deciles ${deciles}`);
  assert(Math.abs(corr(sxy, sx, sy, sxx, syy)) < 0.01, 'rows are independent');
  assert(Math.abs(corr(sxz, sx, sz, sxx, szz)) < 0.01, 'slots are independent');
}

// Districts, variety and fairness.
const count = { road: 0, bus: 0, train: 0, safe: 0, logs: 0, pads: 0 };
let pairs = 0, sameWay = 0, total = 0, logChecks = 0;
for (const seed of seeds) {
  let grassRun = 0;
  for (let r = 1; r < ROWS; r++) {
    const L = scoreLane(seed, r), below = scoreLane(seed, r - 1);
    total++;
    count[L.kind === 'river' ? (L.pads ? 'pads' : 'logs') : L.kind]++;
    if (L.dir && below.dir && L.kind !== 'safe' && below.kind !== 'safe') {
      pairs++;
      if (L.dir === below.dir) sameWay++;
    }
    if (L.kind === 'safe') {
      grassRun++;
      assert(grassRun <= 2, `seed ${seed}: three grass rows in a row at ${r}`);
      assert(L.blocked.length <= 3, `seed ${seed} row ${r}: at most 3 trees`);
      if (below.kind === 'safe') {
        const open = [...Array(RR.COLS).keys()].filter((c) => !L.blocked.includes(c) && !below.blocked.includes(c));
        assert(open.length > 0, `seed ${seed}: trees wall off rows ${r - 1}–${r}`);
      }
    } else grassRun = 0;
    if (L.kind === 'river') {
      assert.deepEqual(L.blocked, []);
      if (L.pads) {
        // Pads sit still on alternate tiles, centred, so landing on one is exact.
        assert.equal(L.speed, 0);
        for (let c = 0; c < RR.COLS; c++) assert.equal(onPlatform(L, c, 0), (c - L.offset) % 2 === 0, `pad tile ${c}`);
      } else {
        // Logs drift at 0.6–1.2 tiles a second, and every tile is on a log at some point
        // in each pass, so the row beyond can always be reached.
        assert(Math.abs(L.speed) >= 0.6 && Math.abs(L.speed) <= 1.2);
        const pass = L.period / Math.abs(L.speed);
        for (let c = 0; c < RR.COLS; c++) {
          let covered = false;
          for (let t = 0; t < pass && !covered; t += pass / 40) covered = onPlatform(L, c, t) && Math.abs(c - platformCenter(L, c, t)) < 1;
          assert(covered, `seed ${seed} row ${r}: tile ${c} meets a log`);
          logChecks++;
        }
      }
    }
  }
  for (let district = 0; district * 16 + 15 < ROWS; district++) {
    const rows = Array.from({ length: 16 }, (_, local) => scoreLane(seed, district * 16 + local));
    const rivers = rows.flatMap((L, local) => (L.kind === 'river' ? [local] : []));
    assert.equal(rivers.length, 3, `seed ${seed} district ${district} has one river`);
    assert(rivers[0] >= 5 && rivers[0] <= 8 && rivers[2] === rivers[0] + 2);
    assert.deepEqual(rivers.map((local) => !!rows[local].pads), [false, true, false], 'logs, lily pads, logs');
  }
}
const share = (k) => count[k] / total;
assert(share('safe') > 0.12 && share('safe') < 0.2, `grass ${share('safe')}`);
assert(share('train') > 0.04 && share('train') < 0.09, `trains ${share('train')}`);
assert(share('bus') > 0.1 && share('bus') < 0.18, `buses ${share('bus')}`);
assert(sameWay / pairs > 0.45 && sameWay / pairs < 0.55, `neighbouring lanes share a direction ${((sameWay / pairs) * 100).toFixed(1)}% of the time`);

// Crossability: a pilot that holds still for 160 ms after each hop (120 ms where it must)
// reaches row 300 on 40 random courses. A route it finds is one the game accepts.
let quick = 0;
for (const seed of seeds.slice(0, 40)) {
  let result = pilot(seed).run(300);
  if (result.stuck) {
    quick++;
    result = pilot(seed, { hopSteps: 3 }).run(300);
  }
  assert(!result.stuck, `seed ${seed}: no way past row ${result.stuck?.row}`);
}

// Bet runs are settled by scoreReplay (the server runs the same steps in SQL). Every run the
// pilot survives replays as reaching its row, under the game's own strict checks and under
// the server's kinder tolerances; a blind dash dies, and the kinder replay never fails a
// run the strict one passes.
let replays = 0;
for (const seed of seeds.slice(0, 30)) {
  const moves = [];
  const run = pilot(seed).run(50, { onMove: (mv) => moves.push([Math.round(mv.s.tl * 1000), mv.m]) });
  if (run.stuck) continue;
  const end = moves.at(-1)[0];
  for (const tol of [{ hb: RR.HB_CLIENT, line: 0, edge: 0 }, undefined]) {
    const r = scoreReplay(seed, moves, end, 50, tol);
    assert(r.alive && r.reached && r.score === 50, `seed ${seed}: the pilot's run replays as reaching row 50 ${JSON.stringify(r)}`);
  }
  // Hopping on after reaching the target changes nothing: the replay stops there.
  assert(scoreReplay(seed, [...moves, [end + 50, 0], [end + 100, 0]], end + 100, 50).reached);
  // The same run aimed further does not count as reaching it.
  assert(!scoreReplay(seed, moves, end, 100).reached);
  replays++;
}
let dashes = 0;
for (const seed of seeds.slice(0, 200)) {
  const blind = Array.from({ length: 40 }, (_, k) => [k * 150 + 50, 0]);
  const strict = scoreReplay(seed, blind, 40 * 150 + 1000, 30, { hb: RR.HB_CLIENT, line: 0, edge: 0 });
  const kind = scoreReplay(seed, blind, 40 * 150 + 1000, 30);
  if (strict.alive) assert(kind.alive, 'the kinder replay never fails a run the game passed');
  if (!strict.alive) dashes++;
}
assert(dashes > 150, `most blind dashes die (${dashes} of 200)`);
assert.equal(scoreReplay(seeds[0], [], 60000, 10).cause, 'line', 'waiting at the curb, the red line catches up');

console.log(`course: ${seeds.length} seeds × ${ROWS} rows deterministic; grass ${(share('safe') * 100).toFixed(1)}%, ` +
  `trains ${(share('train') * 100).toFixed(1)}%, neighbours share a direction ${((sameWay / pairs) * 100).toFixed(1)}%; ` +
  `no tree walls; ${logChecks} log tiles reachable; 40 courses crossed to row 300 (${quick} needed a quicker tapper); ` +
  `${replays} pilot runs replay as reaching row 50; ${dashes} of 200 blind dashes die`);
