// Night Flight's rules and physics, matched frame for frame to the classic tap-to-flap
// arcade loop as measured from the reference clone (FlapPyBird). Units are that game's
// screen pixels: a 288 × 512 screen with the quay at y = 404.48, run at 30 frames a
// second. Everything here is discrete per frame on purpose: the apex height, the tilt
// and the scoring window all come from whole-frame steps, so the browser renders between
// frames instead of changing the physics.

export const FPS = 30;
export const VIEW_W = 288;
export const VIEW_H = 512;
export const FLOOR = 404.48; // top of the quay (512 × 0.79)
export const BIRD_X = 57; // left edge of the bird (288 × 0.2)
export const BIRD_W = 32; // the kingfisher is 4:3; the reference bird is 34 × 24
export const BIRD_H = 24;
export const START_Y = 244; // (512 − 24) / 2
export const GATE_W = 52;
export const GAP = 100;
export const CAP_H = 24; // the gate's wider lip at the gap
export const SHAFT_INSET = 2; // the shaft is 2 px narrower than the lip on each side
export const SPEED = 4; // gates and quay scroll 4 px a frame
export const SPACING = VIEW_W / 2; // the first two gates are half a screen apart

const FLAP_V = -9;
const GRAVITY = 1;
const MAX_FALL = 10;
const CEILING = -2 * BIRD_H; // flaps do nothing this far above the screen
const ROT_FLAP = 45; // degrees, nose up (counter-clockwise)
const ROT_STEP = 3;
const ROT_MIN = -90;
export const ROT_SHOWN_MAX = 20; // the tilt is drawn no higher than this
const CRASH_GRAVITY = 2;
const CRASH_MAX = 15;
const CRASH_ROT = 7;
const GAP_RANGE = Math.floor(FLOOR * 0.6 - GAP); // 142 possible gap heights
const GAP_MIN = Math.floor(FLOOR * 0.2); // 80

export const MEDALS = [
  [40, 'platinum'],
  [30, 'gold'],
  [20, 'silver'],
  [10, 'bronze'],
];
export const medalFor = (score) => MEDALS.find(([at]) => score >= at)?.[1] || null;

// The wing cycle: up, middle, down, middle.
export const WINGS = [0, 1, 2, 1];

// Which pixels of the 32 × 24 bird are solid, per wing frame. Taken from the alpha
// channel of assets/flight/kingfisher.png (48 × 36 frames, 1.5 sprite pixels per cell).
// Bit i of each row is column i, counting from the bird's tail.
const MASK_HEX = [
  ['0', 'c0', '3d8', 'e03f0', '1f0ffc', '3f8ffc', '7fbff8', 'fffffc', 'ffffff8', 'fffffff8', '7ffffff0', '1fffff8', '3ffffe', '3ffff0', 'ffff0', '3fec0', 'fc10', '300', '0', '0', '0', '0', '0', '0'],
  ['0', '0', '0', 'e0000', '1f0000', '3f8000', '7f8000', 'ff8f00', 'ffffffc', 'fffffff8', '7fffffff', '1fffffc', '3fffff', '3ffff0', 'ffff0', '3fec0', 'fc10', '300', '0', '0', '0', '0', '0', '0'],
  ['0', '0', '0', 'e0000', '1f0000', '3f8000', '7f8000', 'ff8000', 'fffc000', 'fffffc00', '7fffff80', '1fffff8', '3ffffe', '3ffff0', 'ffff0', '3ffc0', 'ffd0', '3fc0', '1fe0', '1fe0', '240', '320', '100', '0'],
];
export const MASKS = MASK_HEX.map((rows) => rows.map((hex) => parseInt(hex, 16) >>> 0));
// The lowest solid row of the resting (middle) frame: where the bird meets the quay.
export const BIRD_FOOT = 1 + MASKS[1].reduce((low, bits, row) => (bits ? row : low), 0);

/** Is world point (px, py) inside a gate's solid pier or lip? */
export function gateSolid(gate, px, py) {
  if (px < gate.x || px >= gate.x + GATE_W) return false;
  const top = gate.gapTop;
  const bottom = gate.gapTop + GAP;
  if (py >= top && py < bottom) return false;
  // The lip is the full width; the shaft beyond it is inset on both sides.
  if (py >= top - CAP_H && py < bottom + CAP_H) return true;
  return px >= gate.x + SHAFT_INSET && px < gate.x + GATE_W - SHAFT_INSET;
}

/** Pixel-accurate overlap of the bird (top-left at BIRD_X, y) with a gate. */
export function birdHitsGate(y, frame, gate) {
  if (gate.x >= BIRD_X + BIRD_W || gate.x + GATE_W <= BIRD_X) return false;
  const mask = MASKS[frame];
  for (let row = 0; row < BIRD_H; row++) {
    const bits = mask[row];
    if (!bits) continue;
    const py = y + row + 0.5;
    for (let col = 0; col < BIRD_W; col++) {
      if (bits & (1 << col) && gateSolid(gate, BIRD_X + col + 0.5, py)) return true;
    }
  }
  return false;
}

export function flightCourse(random = Math.random) {
  const state = {
    mode: 'ready', // ready → flying → crashed (falling) → landed
    y: START_Y,
    vy: 0,
    rot: 0,
    wing: 0, // index into WINGS
    frame: 0, // sprite frame (WINGS[wing])
    score: 0,
    gates: [],
    distance: 0, // quay scroll, px
    ticks: 0,
    hit: null, // 'gate' | 'quay'
    shm: 0,
    shmDir: 1,
  };
  let loop = 0;
  let flapped = false;
  let pending = false;
  let nextIndex = 0;

  const makeGate = (x) => ({ index: nextIndex++, x, gapTop: GAP_MIN + Math.floor(random() * GAP_RANGE), passed: false });

  function nextWing(every) {
    if ((loop + 1) % every === 0) {
      state.wing = (state.wing + 1) % WINGS.length;
      state.frame = WINGS[state.wing];
    }
    loop = (loop + 1) % 30;
  }

  /** Get-ready screen: the bird bobs 8 px each way at 1 px a frame and the quay scrolls. */
  function idle() {
    if (Math.abs(state.shm) === 8) state.shmDir *= -1;
    state.shm += state.shmDir;
    state.y = START_Y + state.shm;
    nextWing(5);
    state.distance += SPEED;
    state.ticks++;
  }

  /** The first tap: the bird takes off from where it was bobbing. */
  function launch() {
    if (state.mode !== 'ready') return;
    state.mode = 'flying';
    state.vy = FLAP_V;
    state.rot = ROT_FLAP;
    flapped = false; // the opening kick still gets gravity on its first frame
    state.gates = [makeGate(VIEW_W + 200), makeGate(VIEW_W + 200 + SPACING)];
  }

  function flap() {
    if (state.mode === 'flying') pending = true;
  }

  function crashed(groundCrash) {
    state.mode = 'crashed';
    state.hit = groundCrash ? 'quay' : 'gate';
  }

  /** One frame of flight. Returns the sounds that frame made. */
  function fly() {
    const events = [];
    if (pending) {
      pending = false;
      if (state.y > CEILING) {
        state.vy = FLAP_V;
        flapped = true;
        events.push('flap');
      }
    }
    // Collisions are checked where the last frame left the bird.
    if (state.y + BIRD_FOOT >= FLOOR - 1) {
      crashed(true);
      events.push('hit');
      return events;
    }
    for (const gate of state.gates) {
      if (birdHitsGate(state.y, state.frame, gate)) {
        crashed(false);
        events.push('hit', 'die');
        return events;
      }
    }
    // A point when the bird's centre reaches a gate's centre.
    const mid = BIRD_X + BIRD_W / 2;
    for (const gate of state.gates) {
      const gateMid = gate.x + GATE_W / 2;
      if (!gate.passed && gateMid <= mid && mid < gateMid + SPEED) {
        gate.passed = true;
        state.score++;
        events.push('point');
      }
    }
    nextWing(3);
    state.rot = Math.max(ROT_MIN, state.rot - ROT_STEP);
    if (state.vy < MAX_FALL && !flapped) state.vy += GRAVITY;
    if (flapped) {
      flapped = false;
      state.rot = ROT_FLAP;
    }
    state.y += Math.min(state.vy, FLOOR - state.y - BIRD_FOOT);
    for (const gate of state.gates) gate.x -= SPEED;
    if (state.gates.length > 0 && state.gates.length < 3 && state.gates[0].x > 0 && state.gates[0].x < 5) state.gates.push(makeGate(VIEW_W + 10));
    if (state.gates.length && state.gates[0].x < -GATE_W) state.gates.shift();
    state.distance += SPEED;
    return events;
  }

  /** After a crash the bird drops to the quay; gates and quay stand still. */
  function fall() {
    if (state.y + BIRD_FOOT < FLOOR - 1) state.y += Math.min(state.vy, FLOOR - state.y - BIRD_FOOT);
    else state.mode = 'landed';
    if (state.vy < CRASH_MAX) state.vy += CRASH_GRAVITY;
    if (state.hit === 'gate') state.rot = Math.max(ROT_MIN, state.rot - CRASH_ROT);
    return state.mode === 'landed' ? ['land'] : [];
  }

  /** Advance one 1/30 s frame in whatever mode the run is in. */
  function tick() {
    state.ticks++;
    if (state.mode === 'ready') {
      state.ticks--;
      idle();
      return [];
    }
    if (state.mode === 'flying') return fly();
    if (state.mode === 'crashed') return fall();
    return [];
  }

  /** The tilt to draw: nose up at most 20°, all the way down to −90°. */
  const shownRot = () => Math.min(state.rot, ROT_SHOWN_MAX);

  return { state, tick, launch, flap, shownRot };
}
