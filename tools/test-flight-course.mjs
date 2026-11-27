import assert from 'node:assert/strict';
import { flightCourse, FLOOR, GATE_WIDTH } from '../js/games/flight-course.js';

function random(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const dt = 1 / 120;
function fresh(seed = 1) {
  const run = flightCourse(random(seed));
  run.extend(300);
  return run;
}

const freefall = fresh();
freefall.flap();
freefall.step(dt, 300, 100);
assert(freefall.state.y < 225);
for (let i = 0; i < 300; i++) freefall.step(dt, 300, 100);
assert(freefall.state.hit);
assert(freefall.state.y < FLOOR);
const stopped = { ...freefall.state };
freefall.flap();
freefall.step(dt, 300, 100);
assert.deepEqual(freefall.state, stopped);

function cross(y) {
  const run = fresh();
  const gate = run.state.gates[0];
  run.state.distance = gate.x;
  run.state.y = y(gate);
  run.step(dt, 300, 100);
  return run;
}
assert(cross(g => g.center + g.gap / 2 - 6).state.hit);
assert(cross(g => g.center - g.gap / 2 + 6).state.hit);
const safe = cross(g => g.center + g.gap / 2 - 8);
assert.equal(safe.state.hit, false);
const gate = safe.state.gates[0];
safe.state.distance = gate.x + GATE_WIDTH / 2 + 11;
safe.step(dt, 300, 100);
safe.step(dt, 300, 100);
assert.equal(safe.state.score, 1);

for (let seed = 1; seed <= 32; seed++) {
  const run = fresh(seed);
  const { state } = run;
  for (let i = 0; state.score < 75 && !state.hit && i < 22000; i++) {
    const target = state.gates.find(g => !g.passed);
    if (state.velocity >= -4 && state.y > target.center + 12) run.flap();
    run.step(dt, 300, 100);
    assert(state.gates.length <= 6);
  }
  assert.equal(state.score, 75, 'reachable course, seed ' + seed);
}
console.log('Passed flap, collisions, near misses, single scoring and 2,400 gates across 32 seeded flights.');
