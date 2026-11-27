import assert from 'node:assert/strict';
import { flightCourse, FLOOR, GATE_WIDTH, START_Y } from '../js/games/flight-course.js';

function random(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const dt = 1 / 120;
function fresh(seed = 1) {
  const run = flightCourse(random(seed));
  run.extend(300);
  return run;
}

// Sample the same tap at several update rates. At 200 ms the bird should
// turn down, at 400 ms it should cross launch height, then reach a steady dive.
for (const hz of [60, 120, 144]) {
  const flight = fresh();
  const { state } = flight;
  function advance(seconds) {
    const steps = Math.ceil(seconds * hz);
    for (let i = 0; i < steps; i++) flight.step(seconds / steps, 300, 100);
  }
  flight.flap();
  const kick = state.velocity;
  advance(.2);
  assert(Math.abs(state.velocity) < .01);
  assert(Math.abs(state.y - (START_Y - 43)) < .01);
  advance(.2);
  assert(Math.abs(state.y - START_Y) < .01);
  advance(.13);
  const dive = state.velocity;
  assert(dive > 500 && dive < 600);
  advance(.04);
  assert.equal(state.velocity, dive);
  const beforeTap = state.y;
  flight.flap();
  flight.flap();
  assert.equal(state.y, beforeTap);
  assert.equal(state.velocity, kick);
  advance(.01);
  assert(state.y < beforeTap);
}

const freefall = fresh();
freefall.flap();
freefall.step(dt, 300, 100);
assert(freefall.state.y < 225);
for (let i = 0; i < 300; i++) freefall.step(dt, 300, 100);
assert.equal(freefall.state.hit, 'quay');
assert(freefall.state.y < FLOOR);
const stopped = { ...freefall.state };
freefall.flap();
freefall.step(dt, 300, 100);
assert.deepEqual(freefall.state, stopped);

const climb = fresh();
climb.state.y = 7.1;
climb.flap();
climb.step(dt, 300, 100);
assert.equal(climb.state.hit, 'ceiling');

function cross(y) {
  const run = fresh();
  const gate = run.state.gates[0];
  run.state.distance = gate.x;
  run.state.y = y(gate);
  run.step(dt, 300, 100);
  return run;
}
assert.equal(cross(g => g.center + g.gap / 2 - 6).state.hit, 'gate');
assert(cross(g => g.center - g.gap / 2 + 6).state.hit);
const safe = cross(g => g.center + g.gap / 2 - 8);
assert.equal(safe.state.hit, null);
const gate = safe.state.gates[0];
safe.state.distance = gate.x + GATE_WIDTH / 2 + 11;
safe.step(dt, 300, 100);
safe.step(dt, 300, 100);
assert.equal(safe.state.score, 1);

// A sustained run of requested climbs or dives must still turn at each edge.
for (const roll of [0, .999999]) {
  const run = flightCourse(() => roll);
  run.extend(5000);
  const { gates } = run.state;
  assert(gates[0].gap > gates.at(-1).gap);
  for (let i = 1; i < gates.length; i++) {
    const change = Math.abs(gates[i].center - gates[i - 1].center);
    assert(change >= 32 && change <= 66);
    assert(gates[i].center - gates[i].gap / 2 > 0);
    assert(gates[i].center + gates[i].gap / 2 < FLOOR);
  }
}

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
