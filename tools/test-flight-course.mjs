// node tools/test-flight-course.mjs
// Pins Night Flight to the reference tap-to-flap loop (FlapPyBird, 30 frames a second).
import assert from 'node:assert/strict';
import {
  flightCourse, flightReplay, FLOOR, START_Y, BIRD_X, BIRD_W, BIRD_FOOT, GATE_W, GAP, SPEED, VIEW_W, MASKS, WINGS, SHAFT_INSET,
  gateSolid, birdHitsGate, medalFor,
} from '../js/games/flight-course.js';

function seeded(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const run = (seed = 1) => flightCourse(seeded(seed));
const clear = (f) => (f.state.gates.length = 0); // physics checks without gates in the way

// A teleporting pilot for long runs: put the bird in the next gap's centre every frame.
function pilot(f) {
  const s = f.state;
  const g = s.gates.find((gate) => gate.x + GATE_W > BIRD_X - 1);
  if (!g) return;
  s.y = g.gapTop + (GAP - BIRD_FOOT) / 2;
  s.vy = 0;
}

// Collisions depend only on the gate's offset from the bird and the bird's height relative
// to the gap, so precompute them once: hits[frame][dx][rel].
const REL = 260;
const DX0 = -GATE_W + 1;
const DX1 = BIRD_W - 1;
const hits = [0, 1, 2].map((frame) =>
  Array.from({ length: DX1 - DX0 + 1 }, (_, i) => {
    const row = new Uint8Array(2 * REL);
    for (let rel = -REL; rel < REL; rel++) row[rel + REL] = birdHitsGate(200 + rel, frame, { x: BIRD_X + DX0 + i, gapTop: 200 }) ? 1 : 0;
    return row;
  }),
);
const hitAt = (y, frame, g) => {
  const dx = g.x - BIRD_X;
  if (dx < DX0 || dx > DX1) return false;
  const rel = Math.max(-REL, Math.min(REL - 1, Math.round(y - g.gapTop)));
  return hits[frame][dx - DX0][rel + REL] === 1;
};

/**
 * Prove a course is flyable: track every (height, speed) the bird could have after each
 * frame, given that gates move on a fixed schedule whatever the bird does. If the set ever
 * empties, no sequence of taps survives. Returns the number of gates an ideal flyer clears.
 */
function provable(seed, gatesWanted) {
  const f = flightCourse(seeded(seed));
  f.launch();
  const gates = f.state.gates.map((g) => ({ ...g }));
  const random = seeded(seed);
  random();
  random(); // the two opening gates used these
  const Y0 = -120;
  const YN = 420;
  const V = 20; // vy from -9 to 10
  let reach = new Uint8Array((YN - Y0) * V);
  reach[(START_Y - Y0) * V + 0] = 1; // y = 244, vy = -9 (the opening kick)
  const wings = [0, 1, 2, 1];
  let wing = 0;
  let frame = 0;
  let loop = 0;
  let cleared = 0;
  for (let t = 0; t < 30 * 3600; t++) {
    const next = new Uint8Array(reach.length);
    let any = false;
    for (let yi = 0; yi < YN - Y0; yi++) {
      const y0 = yi + Y0;
      for (let vi = 0; vi < V; vi++) {
        if (!reach[yi * V + vi]) continue;
        for (const tap of t === 0 ? [false] : [false, true]) {
          let y = y0;
          let vy = vi - 9;
          let flapped = false;
          if (tap) {
            if (y <= -48) continue;
            vy = -9;
            flapped = true;
          }
          if (y + BIRD_FOOT >= FLOOR - 1) continue;
          if (gates.some((g) => hitAt(y, frame, g))) continue;
          if (vy < 10 && !flapped) vy += 1;
          y += Math.min(vy, FLOOR - y - BIRD_FOOT);
          if (y !== Math.round(y)) continue; // only the quay clamp makes fractions; that's a crash next frame
          next[(y - Y0) * V + vy + 9] = 1;
          any = true;
        }
      }
    }
    if ((loop + 1) % 3 === 0) wing = (wing + 1) % 4;
    loop = (loop + 1) % 30;
    frame = wings[wing];
    const mid = BIRD_X + BIRD_W / 2;
    for (const g of gates) if (!g.passed && g.x + GATE_W / 2 <= mid) (g.passed = true), cleared++;
    for (const g of gates) g.x -= SPEED;
    if (gates.length > 0 && gates.length < 3 && gates[0].x > 0 && gates[0].x < 5) gates.push({ x: VIEW_W + 10, gapTop: 80 + Math.floor(random() * 142), passed: false });
    if (gates.length && gates[0].x < -GATE_W) gates.shift();
    reach = next;
    if (!any || cleared >= gatesWanted) break;
  }
  return cleared;
}

// ---------------------------------------------------------------- get ready
{
  const f = run();
  const ys = [];
  for (let i = 0; i < 64; i++) {
    f.tick();
    ys.push(f.state.y - START_Y);
  }
  assert.equal(Math.max(...ys), 8, 'bob reaches 8 px below');
  assert.equal(Math.min(...ys), -8, 'bob reaches 8 px above');
  assert.equal(new Set(ys.slice(0, 32)).size, 17, 'bob moves 1 px a frame');
  assert.equal(f.state.gates.length, 0, 'no gates before the first tap');
  assert.equal(f.state.distance, 64 * SPEED, 'the quay scrolls while waiting');
}

// ---------------------------------------------------------------- launch and flap arcs
{
  const f = run();
  f.launch();
  clear(f);
  const y0 = f.state.y;
  let top = y0;
  let frames = 0;
  for (let i = 0; i < 12; i++) {
    f.tick();
    if (f.state.y < top) {
      top = f.state.y;
      frames = i + 1;
    }
  }
  assert.equal(y0 - top, 36, 'the opening kick rises 8+7+…+1 px');
  assert.equal(frames, 8);

  // a normal flap: 9+8+…+1 = 45 px, apex after 9 frames
  for (let i = 0; i < 3; i++) f.tick();
  assert.equal(f.state.mode, 'flying');
  const before = f.state.y;
  f.flap();
  const path = [];
  for (let i = 0; i < 10; i++) {
    f.tick();
    path.push(before - f.state.y);
  }
  assert.deepEqual(path, [9, 17, 24, 30, 35, 39, 42, 44, 45, 45], 'flap arc frame by frame');
  assert.equal(f.shownRot(), 18, 'tilt is drawn capped at 20° and starts dropping after 8 frames');
}

// ---------------------------------------------------------------- terminal velocity and dive
{
  const f = run();
  f.launch();
  clear(f);
  const speeds = [];
  for (let i = 0; i < 24 && f.state.mode === 'flying'; i++) {
    f.tick();
    speeds.push(f.state.vy);
  }
  assert.equal(Math.max(...speeds), 10, 'falls no faster than 10 px a frame');
  const g = run();
  g.launch();
  clear(g);
  g.state.y = -40; // high enough to fall for 1.5 s without reaching the quay
  for (let i = 0; i < 45; i++) g.tick();
  assert.equal(g.state.mode, 'flying');
  assert.equal(g.shownRot(), -90, 'a long fall points the bird straight down');
}

// ---------------------------------------------------------------- ceiling
{
  const f = run();
  f.launch();
  clear(f);
  let highest = Infinity;
  for (let i = 0; i < 200; i++) {
    f.flap();
    f.tick();
    highest = Math.min(highest, f.state.y);
  }
  assert.equal(f.state.mode, 'flying', 'flying off the top is not a crash');
  // Flaps stop working two bird-heights above the screen; the last one still coasts up to 45 px higher.
  assert(highest >= -48 - 9 - 45 && highest <= -48, `the bird can't climb away above the screen (${highest})`);
}

// ---------------------------------------------------------------- gates
{
  const f = run(7);
  f.launch();
  const xs = f.state.gates.map((g) => g.x);
  assert.deepEqual(xs, [VIEW_W + 200, VIEW_W + 200 + 144], 'first two gates');
  const spacing = new Set();
  const gaps = [];
  let lastSpawned = f.state.gates[1];
  for (let i = 0; i < 30 * 120 && f.state.mode === 'flying'; i++) {
    pilot(f);
    f.tick();
    const tail = f.state.gates[f.state.gates.length - 1];
    if (tail !== lastSpawned) {
      spacing.add(tail.x - f.state.gates[f.state.gates.length - 2].x);
      gaps.push(tail.gapTop);
      lastSpawned = tail;
    }
  }
  // Gates spawn at x = 298 when the leader is 1–4 px from the left edge, stepping 4 px a frame.
  assert([...spacing].every((d) => d >= 144 && d <= 152), `gates are 144–152 px apart (${[...spacing]})`);
  assert(Math.min(...gaps) >= 80 && Math.max(...gaps) <= 221, 'gap tops stay within 80–221 px');
  assert(f.state.score >= 60, `the course keeps coming (${f.state.score} gates)`);
}

// ---------------------------------------------------------------- scoring happens once, at the centre
{
  const f = run(3);
  f.launch();
  f.state.gates = [{ index: 0, x: 60, gapTop: 0, passed: false }];
  f.state.gates[0].gapTop = Math.round(f.state.y) - 38; // a wide-open line through the gap
  const mid = BIRD_X + BIRD_W / 2;
  let scoredAt = null;
  for (let i = 0; i < 20; i++) {
    const before = f.state.score;
    const x = f.state.gates[0].x;
    f.state.vy = 0; // fly level
    f.tick();
    if (f.state.score > before) scoredAt = x;
  }
  assert.equal(f.state.score, 1);
  assert(scoredAt + GATE_W / 2 <= mid && mid < scoredAt + GATE_W / 2 + SPEED, 'point when the centres meet');
}

// ---------------------------------------------------------------- pixel-accurate collisions
{
  const gate = { x: 100, gapTop: 200 };
  assert(gateSolid(gate, 101, 150) === false, 'the shaft is 2 px narrower than the lip');
  assert(gateSolid(gate, 101, 190) === true, 'the lip is full width');
  assert(gateSolid(gate, 125, 250) === false, 'the gap is open');
  assert(gateSolid(gate, 125, 300) === true, 'lower lip');
  // a bird whose empty sprite corner overlaps a gate is not a hit
  const lowest = MASKS[1].reduce((low, bits, row) => (bits ? row : low), 0);
  assert.equal(BIRD_FOOT, lowest + 1);
  // A shaft whose inset edge covers only the bird's last column (the beak tip).
  const beakRows = MASKS[1].map((bits, row) => (bits >>> 31 ? row : -1)).filter((r) => r >= 0);
  assert(beakRows.length > 0, 'the beak reaches the last column');
  const shaft = { x: BIRD_X + BIRD_W - 1 - SHAFT_INSET, gapTop: 900 };
  assert(birdHitsGate(200, 1, shaft), 'one solid pixel of beak is enough to hit');
  const brushing = { x: BIRD_X + BIRD_W - SHAFT_INSET, gapTop: 900 };
  assert(!birdHitsGate(200, 1, brushing), 'the lip-only margin of a shaft is empty');
}

// ---------------------------------------------------------------- crashes
{
  const f = run();
  f.launch();
  clear(f);
  let events = [];
  for (let i = 0; i < 200 && f.state.mode === 'flying'; i++) events = f.tick();
  assert.equal(f.state.hit, 'quay');
  assert.deepEqual(events, ['hit']);
  const rot = f.state.rot;
  for (let i = 0; i < 30; i++) f.tick();
  assert.equal(f.state.mode, 'landed');
  assert.equal(f.state.rot, rot, 'a quay crash does not spin the bird');

  const g = run(5);
  g.launch();
  g.state.gates = [{ index: 0, x: BIRD_X + 4, gapTop: 0, passed: false }];
  events = g.tick();
  assert.deepEqual(events, ['hit', 'die'], 'flying into a gate');
  assert.equal(g.state.hit, 'gate');
  const ticks = [];
  while (g.state.mode !== 'landed' && ticks.length < 200) ticks.push(g.tick());
  assert.equal(g.state.rot, -90, 'the bird noses down as it drops');
  assert(g.state.y + BIRD_FOOT >= FLOOR - 1 && g.state.y + BIRD_FOOT <= FLOOR, 'it comes to rest on the quay');
}

// ---------------------------------------------------------------- determinism and the wing cycle
{
  const a = run(42);
  const b = run(42);
  a.launch();
  b.launch();
  for (let i = 0; i < 300; i++) {
    if (i % 11 === 0) {
      a.flap();
      b.flap();
    }
    a.tick();
    b.tick();
  }
  assert.deepEqual(JSON.stringify(a.state), JSON.stringify(b.state));
  const w = run();
  w.launch();
  clear(w);
  const frames = [];
  for (let i = 0; i < 12; i++) {
    w.tick();
    frames.push(w.state.frame);
  }
  assert.deepEqual(frames, [0, 0, 1, 1, 1, 2, 2, 2, 1, 1, 1, 0], 'the wings change every third frame');
  assert.deepEqual(WINGS, [0, 1, 2, 1]);
}

// ---------------------------------------------------------------- medals
assert.equal(medalFor(9), null);
assert.equal(medalFor(10), 'bronze');
assert.equal(medalFor(20), 'silver');
assert.equal(medalFor(30), 'gold');
assert.equal(medalFor(40), 'platinum');
assert.equal(medalFor(999), 'platinum');

// ---------------------------------------------------------------- every course is flyable
{
  let worst = Infinity;
  for (let seed = 1; seed <= 12; seed++) worst = Math.min(worst, provable(seed, 120));
  assert(worst >= 120, `an ideal flyer clears 120 gates on every course (worst ${worst})`);
  console.log('reachability: 12 courses × 120 gates, all provably flyable');
}

// Bet flights: a seeded course lays the same gates every time, and replaying the flaps a
// flight recorded reproduces it frame for frame (the server replays them the same way).
{
  const gaps = (seed) => {
    const f = flightCourse(seed);
    f.launch();
    const seen = [];
    for (let i = 0; i < 2000 && seen.length < 12; i++) {
      f.tick();
      for (const g of f.state.gates) if (!seen.includes(g.gapTop + ':' + g.index)) seen.push(g.gapTop + ':' + g.index);
      f.state.y = 200; // keep the bird aloft so the course keeps coming
      f.state.vy = 0;
    }
    return seen.join();
  };
  assert.equal(gaps(4242), gaps(4242), 'a seed always lays the same gates');
  assert.notEqual(gaps(4242), gaps(4243), 'another seed lays different gates');
  let same = 0, wins = 0, crashes = 0;
  for (let i = 1; i <= 60; i++) {
    const seed = i * 104729 + 7, goal = [5, 10, 25, 50][i % 4];
    const live = flightCourse(seed);
    const start = (i % 17) - 8;
    live.state.shm = start;
    live.state.y = START_Y + start;
    live.launch();
    let k = 0;
    while (live.state.mode === 'flying' && live.state.score < goal && k < 20000) {
      const s = live.state;
      const ahead = s.gates.filter((g) => g.x + GATE_W > BIRD_X);
      const g = ahead[0];
      const lo = g ? g.gapTop + 2 : 120, hi = g ? g.gapTop + GAP - 20 : 300;
      let target = ahead[1] ? ahead[1].gapTop + 61 : hi - 10;
      target = Math.max(lo + 56, Math.min(hi - 4, target));
      const next = s.y + s.vy + 1;
      // a deliberately sloppy flyer on every third course, so some flights crash
      if (next > target && (next - 45 >= lo || next > hi - 2) && (i % 3 || (k * 7919) % 13 !== 0)) live.flap();
      live.tick();
      k++;
    }
    const r = flightReplay(seed, start, live.state.flaps, goal, k);
    assert.equal(r.score, live.state.score, `seed ${seed}: the replay scores what the flight scored`);
    assert.equal(r.reached, live.state.score >= goal);
    assert.equal(r.crashed, live.state.mode !== 'flying' && live.state.score < goal);
    assert.equal(r.frames, k);
    same++;
    if (r.reached) wins++;
    if (r.crashed) crashes++;
  }
  assert(wins > 10 && crashes > 3, `the flights cover wins and crashes (${wins} won, ${crashes} crashed)`);
  // A flap above the ceiling does nothing, in the game and in the replay.
  const high = flightCourse(9);
  high.launch();
  high.state.y = -60;
  high.flap();
  high.tick();
  assert.deepEqual(high.state.flaps, [], 'a flap above the ceiling is not recorded');
  console.log(`bet flights: ${same} flights replayed frame for frame (${wins} cleared their gates, ${crashes} crashed)`);
}

console.log('flight course: all checks passed');
