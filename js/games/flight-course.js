// World units are independent of the viewport and refresh rate. Gates are
// measured relative to the bird, which stays at x = 0 in course coordinates.
export const FLOOR = 468;
export const HEIGHT = 500;
export const START_Y = 225;
export const GATE_WIDTH = 40;
export const SPACING = 158;
// A tap kicks upwards immediately. It reaches its 43-unit apex in 0.20 s.
const RISE_GRAVITY = 2150;
const FALL_GRAVITY = 1150;
const FLAP = -430;
const MAX_FALL = 365;
const RADIUS_X = 10;
const RADIUS_Y = 7;

export function flightCourse(random = Math.random) {
  const state = { y: START_Y, velocity: 0, distance: 0, score: 0, gates: [], hit: null };
  let nextIndex = 0, nextCenter = START_Y;

  function extend(right) {
    while (225 + nextIndex * SPACING <= state.distance + right + SPACING) {
      const difficulty = Math.min(1, nextIndex / 16);
      if (nextIndex > 0) {
        const direction = random() < .5 ? -1 : 1;
        const shift = direction * (32 + random() * 34);
        // Turn back toward the middle at the edge. Clamping here would give
        // the player several level gates after a run of climbs or descents.
        const proposed = nextCenter + shift;
        nextCenter = proposed < 120 || proposed > 340 ? nextCenter - shift : proposed;
      }
      state.gates.push({ index: nextIndex, x: 225 + nextIndex * SPACING,
        center: nextCenter, gap: 116 - difficulty * 26, passed: false });
      nextIndex++;
    }
  }

  function flap() {
    if (!state.hit) state.velocity = FLAP;
  }

  function step(dt, right, left) {
    if (state.hit) return;
    extend(right);
    const speed = 115 + Math.min(30, state.score * 2);
    state.distance += speed * dt;
    // Split a step that crosses the apex so the flap feels the same at every
    // refresh rate. The softer downward pull starts only once the bird crests.
    let fallTime = dt;
    if (state.velocity < 0) {
      const rising = Math.min(dt, -state.velocity / RISE_GRAVITY);
      state.y += (state.velocity + RISE_GRAVITY * rising / 2) * rising;
      state.velocity += RISE_GRAVITY * rising;
      fallTime -= rising;
    }
    if (fallTime > 0) {
      const accelerating = Math.min(fallTime, (MAX_FALL - state.velocity) / FALL_GRAVITY);
      state.y += (state.velocity + FALL_GRAVITY * accelerating / 2) * accelerating;
      state.y += MAX_FALL * (fallTime - accelerating);
      state.velocity = Math.min(MAX_FALL, state.velocity + FALL_GRAVITY * fallTime);
    }
    if (state.y - RADIUS_Y <= 0) state.hit = 'ceiling';
    else if (state.y + RADIUS_Y >= FLOOR) state.hit = 'quay';
    for (const gate of state.gates) {
      const dx = gate.x - state.distance;
      // Rounded hitbox leaves wingtips and beak free to brush a gate.
      const edge = Math.max(0, Math.abs(dx) - GATE_WIDTH / 2);
      if (edge <= RADIUS_X) {
        const reach = RADIUS_Y * Math.sqrt(1 - (edge / RADIUS_X) ** 2);
        if (!state.hit && Math.abs(state.y - gate.center) + reach >= gate.gap / 2) state.hit = 'gate';
      }
      if (!state.hit && !gate.passed && dx < -GATE_WIDTH / 2 - RADIUS_X) {
        gate.passed = true;
        state.score++;
      }
    }
    while (state.gates.length && state.gates[0].x + GATE_WIDTH < state.distance - left) state.gates.shift();
  }
  return { state, flap, step, extend };
}
