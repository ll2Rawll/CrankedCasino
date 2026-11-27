// BASE=<site root> node tools/test-rooster-run.mjs   (SHOTS=<dir> also saves screenshots)
// Plays Road Rooster's score run on a phone-sized touch screen with a fake clock. The
// pilot (rooster-pilot.mjs) plans every hop from the game's own lane maths; the test
// performs each one as a real tap or swipe, checks the game agrees where the rooster
// landed, rides logs, lands on lily pads, passes train crossings and banks with the egg.
// Then it ends a run in each other way: a car, a train, the river and the red line.
// Chromium only (touch input goes through the DevTools protocol). CHROMIUM=<executable>.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { RR, rrHit, rrFront } from '../js/math.js';
import { platformCenter } from '../js/games/rooster-course.js';
import { pilot, COURSE_SPEED, chaseLine, MOVES } from './rooster-pilot.mjs';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = new URL(process.env.BASE || 'http://localhost:8000/');
  base.hash = '/rooster';
  await page.clock.install({ time: new Date('2025-01-01T00:00:00Z') });
  await page.goto(base.href);
  await page.locator('.rr-fab').waitFor();
  await page.clock.pauseAt(new Date('2025-01-01T01:00:00Z'));
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const state = () => page.evaluate(() => window.__ccRooster());
  const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png`, scale: 'css' });
  const centerText = () => page.locator('[data-center]').innerText();

  /** Advance the page clock until the course clock reads t (course seconds). */
  async function until(t) {
    const now = (await state()).t;
    const ms = Math.round(((t - now) / COURSE_SPEED) * 1000);
    assert(ms >= 0, `the plan is behind the page by ${-ms} ms`);
    if (ms) await page.clock.runFor(ms);
  }
  /** A tap hops forward; swipes go left, right or back. */
  async function gesture(m) {
    await touch('touchStart', 195, 520);
    if (m !== MOVES.forward) {
      const [dx, dy] = { [MOVES.back]: [0, 40], [MOVES.left]: [-40, 0], [MOVES.right]: [40, 0] }[m];
      await touch('touchMove', 195 + dx, 520 + dy);
    }
    await touch('touchEnd');
  }

  /** Start a score run on a chosen course (the game seeds it from Math.random). */
  async function startRun(seed) {
    const fab = page.locator('.rr-fab');
    if ((await fab.textContent()).includes('Continue')) {
      await fab.tap({ force: true });
      assert.equal(await page.locator('.rr-dialog[open]').count(), 0, 'Continue leaves the game view');
    }
    await page.evaluate((value) => {
      document.querySelector('.rr-fab').addEventListener('click', () => {
        const random = Math.random;
        Math.random = () => value;
        setTimeout(() => (Math.random = random), 0);
      }, { capture: true, once: true });
    }, (seed - 0.5) / 2147483640);
    await fab.tap({ force: true });
    assert.equal(await page.locator('.rr-dialog[open]').count(), 1, 'a touch run opens the game view');
    await page.clock.runFor(1505);
    const st = await state();
    assert.equal(st.seed, seed);
    assert.equal(st.phase, 'run');
    return pilot(seed);
  }

  /**
   * Follow the pilot's plan until stop(st, p) is true, checking every hop against where
   * the game says the rooster landed. watch(st, p) runs after each landing; it returns
   * true when it held the rooster in place for longer than a hop, so the plan is redone.
   */
  async function drive(p, stop, watch) {
    let st = await state();
    for (;;) {
      if (await stop(st, p)) return st;
      const moves = p.next({ row: st.row, col: st.x, tl: st.t }, st.t, st.best);
      assert(moves, `the pilot found no way on from row ${st.row}`);
      if (!moves.length) {
        await until(st.t + 10 * p.dt);
        st = await state();
        continue;
      }
      let replan = false;
      for (const mv of moves) {
        await until(mv.s.tl);
        await gesture(mv.m);
        st = await state();
        assert.equal(st.phase, 'run', `still running after the hop to row ${mv.s.row}`);
        assert.deepEqual([st.row, st.col], [mv.s.row, mv.s.col], 'the game landed the rooster where the plan did');
        if (await stop(st, p)) return st;
        if (await watch?.(st, p)) {
          replan = true;
          break;
        }
      }
      if (!replan) await until(moves.at(-1).s.tl + p.hopSteps * p.dt);
      st = await state();
    }
  }
  /** Hold still from now until t, if nothing can reach the rooster before then. */
  const holdable = (st, p, t) => t >= st.t && p.safe({ row: st.row, col: st.x, tl: st.t }, st.t, t);

  // ---------------------------------------------------------------- a long run, banked
  const seen = { start: 0, log: 0, pad: 0, train: 0, road: 0, bus: 0, safe: 0, hop: 0, signal: 0 };
  const trainSoon = (L, t) => {
    // The crossing's lights, as js/games/rooster.js decides them.
    const ahead = ((L.dir === 1 ? 0 : RR.COLS) - rrFront(L, t, 0)) * L.dir;
    const distance = ((ahead % L.P) + L.P) % L.P;
    return distance < 1.6 * L.v || L.P - distance < L.len + RR.COLS;
  };
  let p = await startRun(1045);
  await shot('01-start');
  let end = await drive(p, (st) => st.best >= 40 && seen.log && seen.pad && seen.signal, async (st, p) => {
    const L = p.lane(st.row);
    const kind = L.kind === 'river' ? (L.pads ? 'pad' : 'log') : L.kind;
    seen[kind]++;
    if (st.best === 1 && !seen.hop++) {
      await page.clock.runFor(50);
      await shot('02-hop');
    }
    if (kind === 'log' && seen.log === 1) {
      const x0 = (await state()).x;
      await page.clock.runFor(120);
      const x1 = (await state()).x;
      assert(Math.abs(x1 - x0 - L.speed * 0.12 * COURSE_SPEED) < 1e-6, 'the rooster drifts with the log');
      await shot('03-log');
    }
    if (kind === 'pad' && seen.pad === 1) {
      await page.clock.runFor(70);
      await shot('04-pad');
    }
    // At the first rail crossing, wait for the lights like a careful player would.
    const rail = p.lane(st.row + 1);
    if (rail.kind === 'train' && !seen.signal && L.kind !== 'river') {
      let t = st.t;
      while (t < st.t + 12 && !trainSoon(rail, t)) t += 0.02;
      t += 0.15;
      if (t < st.t + 12 && holdable(st, p, t + 0.3)) {
        await until(t);
        const now = await page.evaluate(() => performance.now());
        if (Math.floor(now / 240) % 2 === 0) await page.clock.runFor(250 - (now % 240));
        assert(trainSoon(rail, (await state()).t), 'the signal is on');
        await shot('05-train-signal');
        seen.signal++;
        return true;
      }
    }
    return false;
  });
  assert(end.best >= 40, `reached row ${end.best}`);
  assert.equal(await page.locator('[data-score]').textContent(), String(end.best), 'the plaque shows the score');

  // Bank with the egg: press and hold the lower-right button.
  const egg = await page.locator('.rr-fab.is-cash').boundingBox();
  assert(egg.x > 390 / 2 && egg.y > 844 * 0.75, 'the bank button sits in the lower right');
  await touch('touchStart', egg.x + egg.width / 2, egg.y + egg.height / 2);
  await page.clock.runFor(200);
  assert.equal((await state()).phase, 'run', 'a short hold does not bank yet');
  await shot('06-bank-hold');
  await page.clock.runFor(300);
  await touch('touchEnd');
  assert.equal((await state()).phase, 'ending', 'the bank holds a beat before the result');
  await page.clock.runFor(320);
  end = await state();
  assert.equal(end.phase, 'over');
  assert.equal(end.record, end.best, 'the banked score becomes the best');
  assert.match(await centerText(), new RegExp(`Score banked[\\s\\S]*${end.best}`));
  await page.clock.runFor(600);
  await shot('07-banked');
  const record = end.record;

  // ---------------------------------------------------------------- the other endings
  /** Play a course until fatalAt(st, p) names a moment to hop forward into trouble. */
  async function dieBy(seed, cause, fatalAt) {
    const p = await startRun(seed);
    let at;
    await drive(p, (st, p) => {
      if (st.best < 3 || p.lane(st.row).kind === 'river') return false;
      at = fatalAt(st, p);
      return at != null && holdable(st, p, at);
    });
    await until(at);
    await gesture(MOVES.forward);
    let after = await state();
    for (let i = 0; i < 40 && after.phase === 'run'; i++) {
      await page.clock.runFor(10);
      after = await state();
    }
    assert.equal(after.phase, 'ending', `${cause}: the run ended`);
    assert.equal(after.cause, cause);
    assert.equal(await centerText(), '', `${cause}: nothing covers the rooster at first`);
    await page.clock.runFor(cause === 'river' ? 160 : 60);
    await shot(`08-${cause}-a`);
    await page.clock.runFor(260);
    await shot(`08-${cause}-b`);
    await page.clock.runFor(500);
    after = await state();
    assert.equal(after.phase, 'over', `${cause}: then the result rises`);
    await shot(`08-${cause}-c`);
    const text = await centerText();
    assert.match(text, /\b0\b/, `${cause}: dying before banking scores zero`);
    assert.equal(after.record, record, `${cause}: the best score stands`);
    return text;
  }
  /** Step out just before the next vehicle on the lane ahead reaches the rooster's tile. */
  const meet = (kind) => (st, p) => {
    const L = p.lane(st.row + 1);
    if (L.kind !== kind) return null;
    const hit = rrHit(L, st.col, st.t, st.t + 12, RR.HB_CLIENT);
    return hit < 0 ? null : Math.max(st.t, hit - 0.12);
  };
  assert.match(await dieBy(1001, 'road', meet('road')), /Hit by a car/);
  assert.match(await dieBy(1186, 'train', meet('train')), /Hit by a train/);
  assert.match(await dieBy(1000, 'river', (st, p) => {
    // Hop forward when the water, not a log, is in front.
    const L = p.lane(st.row + 1);
    if (L.kind !== 'river' || L.pads) return null;
    for (let t = st.t; t < st.t + 8; t += 0.02) if (Math.abs(st.col - platformCenter(L, st.col, t)) > L.width / 2 + 0.25) return t;
    return null;
  }), /Fell in the river/);

  // The red line: stop on a grass row and let it catch up.
  {
    const p = await startRun(1009);
    const st = await drive(p, (st, p) => st.best >= 4 && p.lane(st.row).kind === 'safe');
    const deadline = 6 + (st.row + 1) / 0.65;
    await until(deadline - 0.9);
    assert.equal((await state()).phase, 'run');
    const warning = Number(await page.locator('.rr-danger').evaluate((el) => el.style.opacity));
    assert(warning > 0.3, `the red warning glows as the line closes in (${warning})`);
    await shot('09-line-close');
    await until(deadline + 0.05);
    const after = await state();
    assert.equal(after.cause, 'line');
    assert(chaseLine(after.t) > st.row + 1);
    await page.clock.runFor(100);
    assert.equal(Number(await page.locator('.rr-danger').evaluate((el) => el.style.opacity)), 1, 'the red warning flares');
    await shot('09-line-caught');
    await page.clock.runFor(700);
    assert.equal((await state()).phase, 'over');
    assert.match(await centerText(), /Caught by the red line/);
  }

  // The best score survives a reload.
  await page.reload();
  await page.locator('.rr-fab').waitFor();
  assert.equal((await state()).record, record);
  assert.deepEqual(errors, []);
  console.log(`passed: hopped ${seen.road + seen.bus} traffic lanes, ${seen.train} rail tracks (waiting once for the signal), ${seen.log} logs and ${seen.pad} lily pads to row ${record}, banked it with the egg, then ended runs by car, train, river and the red line.`);
} finally {
  await browser.close();
}
