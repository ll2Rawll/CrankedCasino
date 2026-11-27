// World units are independent of the viewport and refresh rate. Gates are
// measured relative to the bird, which stays at x = 0 in course coordinates.
export const FLOOR = 468;
export const HEIGHT = 500;
export const START_Y = 225;
export const GATE_WIDTH = 40;
export const SPACING = 174;
const GRAVITY = 700;
const FLAP = -223;
const RADIUS_X = 10;
const RADIUS_Y = 7;

export function flightCourse(random = Math.random) {
  const state = { y: START_Y, velocity: 0, distance: 0, score: 0, gates: [], hit: false };
  let nextIndex = 0, nextCenter = START_Y;

  function extend(right) {
    while (225 + nextIndex * SPACING <= state.distance + right + SPACING) {
      const difficulty = Math.min(1, nextIndex / 25);
      if (nextIndex > 0) {
        const shift = (random() * 2 - 1) * (45 + difficulty * 32);
        nextCenter = Math.max(131, Math.min(332, nextCenter + shift));
      }
      state.gates.push({ index: nextIndex, x: 225 + nextIndex * SPACING,
        center: nextCenter, gap: 158 - difficulty * 39, passed: false });
      nextIndex++;
    }
  }

  function flap() {
    if (!state.hit) state.velocity = FLAP;
  }

  function step(dt, right, left) {
    if (state.hit) return;
    extend(right);
    const speed = 93 + Math.min(28, state.score * 1.25);
    state.distance += speed * dt;
    state.y += (state.velocity + GRAVITY * dt / 2) * dt;
    state.velocity += GRAVITY * dt;
    state.hit = state.y - RADIUS_Y <= 0 || state.y + RADIUS_Y >= FLOOR;
    for (const gate of state.gates) {
      const dx = gate.x - state.distance;
      // Rounded hitbox leaves wingtips and beak free to brush a gate.
      const edge = Math.max(0, Math.abs(dx) - GATE_WIDTH / 2);
      if (edge <= RADIUS_X) {
        const reach = RADIUS_Y * Math.sqrt(1 - (edge / RADIUS_X) ** 2);
        if (Math.abs(state.y - gate.center) + reach >= gate.gap / 2) state.hit = true;
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
