import { RR, rrFront } from '../math.js';
import { plane, stamp, logTop, padTop } from './rooster-models.js';

const road = (k) => k === 'road' || k === 'bus';
const meadow = (k) => k === 'start' || k === 'safe';
function variation(seed, row, column) {
  let h = Math.imul(seed ^ Math.imul(row, 65537), 0x45d9f3b) ^ Math.imul(column, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function landscape(ctx) {
  let cameraRow = 0,
    cameraCol = RR.START_COL,
    scale = 1,
    width = 1,
    height = 1;
  function point(col, row, z = 0) {
    const x = col - cameraCol,
      y = row - cameraRow;
    return {
      x: width * 0.5 + scale * (plane.xx * x + plane.yx * y),
      y: height * 0.585 + scale * (plane.xy * x + plane.yy * y - plane.height * z),
    };
  }
  function reset() {
    cameraRow = 0;
    cameraCol = RR.START_COL;
  }
  function draw({
    W,
    H,
    dpr,
    dt,
    seed,
    lane,
    t,
    now,
    vr,
    vc,
    hop,
    squash,
    facing,
    death,
    banked,
    score,
    phase,
    line,
    art,
    trainWarning,
  }) {
    width = W;
    height = H;
    scale = Math.min(W / 7.25, H / 8.8);
    if (!scale) return;
    const follow = 1 - Math.exp(-11 * dt);
    cameraRow += (vr - cameraRow) * follow;
    cameraCol += (vc - cameraCol) * follow;
    const origin = point(0, 0);
    // Invert the ground projection at all four corners, with room for crowns and roofs.
    const bounds = [];
    for (const x of [0, W])
      for (const y of [-2 * scale, H + 2 * scale]) {
        const dx = (x - W * 0.5) / scale,
          dy = (y - H * 0.585) / scale;
        const det = plane.xx * plane.yy - plane.xy * plane.yx;
        bounds.push([cameraCol + (dx * plane.yy - dy * plane.yx) / det, cameraRow + (plane.xx * dy - plane.xy * dx) / det]);
      }
    const minX = Math.floor(Math.min(...bounds.map((p) => p[0]))) - 2,
      maxX = Math.ceil(Math.max(...bounds.map((p) => p[0]))) + 2;
    const first = Math.floor(Math.min(...bounds.map((p) => p[1]))) - 1,
      last = Math.ceil(Math.max(...bounds.map((p) => p[1]))) + 1;
    const actors = [];
    let footing = 0;
    let supportDepth = -Infinity;
    function add(kind, x, r, variant = 0, dir = 1, size = 1, lift = 0, stretch = 1, minDepth = -Infinity) {
      const p = point(x, r);
      if (p.x < -4 * scale || p.x > W + 4 * scale || p.y < -2 * scale || p.y > H + 3 * scale) return;
      actors.push({ kind, x, r, p, depth: Math.max(p.y, minDepth), variant, dir, size, lift, stretch });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#9fbd50';
    ctx.fillRect(0, 0, W, H);
    ctx.transform(plane.xx * scale, plane.xy * scale, plane.yx * scale, plane.yy * scale, origin.x, origin.y);
    function strip(x, r, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x, r, w, h);
    }
    function ellipse(x, r, rx, ry, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, r, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const span = maxX - minX;
    for (let r = first; r <= last; r++) {
      const L = lane(r),
        kind = r === -3 || r === -4 ? 'brook' : L.kind;
      const salt = variation(seed, r, 19);
      const turf = meadow(kind);
      const water = kind === 'river' || kind === 'brook';
      const asphalt = road(kind);
      const tone = water
        ? ['#50b9d5', '#54c0db'][salt % 2]
        : asphalt
          ? ['#646d79', '#69717b'][salt % 2]
          : kind === 'train'
            ? '#8b8571'
            : kind === 'finish'
              ? '#d6b355'
              : ['#a8c550', '#a3c14e', '#a9c854'][salt % 3];
      strip(minX, r - 0.505, span, 1.013, tone);
      if (turf) {
        // The front edge of the raised sod shows soil above the road or water.
        if (!meadow(lane(r - 1).kind) || r === -2) {
          strip(minX, r - 0.51, span, 0.1, '#947445');
          strip(minX, r - 0.41, span, 0.06, '#82a744');
        }
        for (let x = minX; x <= maxX; x++) {
          const h = variation(seed, r, x);
          const j = x + ((h >>> 7) % 67) / 100 - 0.3,
            k = r + ((h >>> 14) % 64) / 100 - 0.32;
          if (h % 5 === 0) {
            strip(j, k, 0.086, 0.032, '#bbd465');
            strip(j + 0.1, k + 0.055, 0.045, 0.025, '#86ab45');
          }
          const outside = x < 0 || x >= RR.COLS;
          // Woods continue behind the start; leave an open patch around the rooster.
          if ((outside || r < 0) && h % 4 === 0 && !(r >= -1 && Math.abs(x - RR.START_COL) < 1.6))
            add(h % 13 === 0 ? 'rock' : 'tree', j, k, (h >>> 8) % 4, 1, 0.73 + (h % 43) / 100);
          else if (h % 29 === 0) {
            ellipse(j, k, 0.046, 0.035, '#fff3bd');
            ellipse(j + 0.07, k + 0.04, 0.035, 0.025, '#ffe7a1');
          }
        }
        if (r === -1) {
          // The fence sits behind the starting tile and leaves the playable route open.
          for (let x = 2 * Math.floor(minX / 2); x < maxX; x += 2) {
            if (Math.abs(x - RR.START_COL) > 1.6) add('fence', x, r - 0.25);
          }
        }
        for (const c of L.blocked) {
          const h = variation(seed, r, c);
          add(h % 4 === 0 ? 'rock' : 'tree', c, r, h % 4);
        }
      } else if (asphalt) {
        if (road(lane(r + 1).kind)) {
          for (let x = 2 * Math.floor(minX / 2); x < maxX; x += 2) strip(x, r + 0.47, 0.72, 0.043, '#c4c8bc');
        } else strip(minX, r + 0.46, span, 0.046, '#858c8d');
      } else if (water) {
        strip(minX, r - 0.5, span, 0.042, '#409fb9');
        for (let x = 2 * Math.floor(minX / 2); x < maxX; x += 2) {
          const h = variation(seed, r, x);
          const offset = (t * 0.16 + (h % 100) * 0.01) % 1;
          strip(x + offset, r + ((h % 6) - 3) * 0.1, 0.13 + (h % 18) * 0.01, 0.016, '#81d2e0');
        }
        if (kind === 'brook') {
          add('bridge', RR.START_COL, r);
          for (let x = minX; x < maxX; x++) {
            const hash = variation(seed, r, x);
            if (Math.abs(x - RR.START_COL) > 1 && hash % 8 === 0) add('rock', x, r + 0.3, 0, 1, 0.68);
          }
          continue;
        }
        const spacing = L.period,
          firstCenter = (L.offset || 0) + (L.speed || 0) * t;
        for (let i = Math.floor((minX - firstCenter) / spacing); i * spacing + firstCenter < maxX; i++) {
          const x = firstCenter + i * spacing;
          const wave = Math.sin(2.4 * t + i + r);
          if (!L.pads) {
            const stern = x - Math.sign(L.speed) * L.width / 2;
            for (const side of [-1, 1]) {
              strip(stern - .16, r + side * (.22 + .025 * wave), .32 + .06 * wave, .023, '#a2dfeb');
            }
          }
          const bob = .016 * wave;
          add(L.pads ? 'pad' : 'log', x, r, L.pads ? variation(seed, r, i) % 5 : 0, 1, 1, bob);
          const weight = 1 - Math.abs(vr - r);
          if (weight > 0 && Math.abs(vc - x) <= L.width / 2) {
            // Blend the two surfaces during a hop. At rest the feet follow the
            // exact top and bob of this platform, including near either end.
            footing += weight * ((L.pads ? padTop : logTop) + bob);
            supportDepth = Math.max(supportDepth, point(x, r).y);
          }
        }
      } else if (kind === 'train') {
        for (let x = 0.39 * Math.floor(minX / 0.39); x < maxX; x += 0.39) strip(x, r - 0.43, 0.15, 0.86, '#806044');
        for (const side of [-0.3, 0.3]) {
          strip(minX, r + side - 0.04, span, 0.086, '#535958');
          strip(minX, r + side + 0.005, span, 0.044, '#c4c2af');
        }
        const warning = trainWarning(L, r, t);
        for (const x of [-0.65, RR.COLS - 0.35]) add('signal', x, r + 0.38, warning && Math.floor(now / 240) % 2 ? 1 : 0);
      }
      if (L.v) {
        const base = rrFront(L, t, 0);
        const start = Math.floor((minX - L.len - base) / L.P),
          end = Math.ceil((maxX + L.len - base) / L.P);
        for (let n = start; n <= end; n++) {
          const front = base + n * L.P - 0.5;
          const center = front - L.dir * L.len * 0.5;
          const h = variation(seed, r, n);
          if (kind === 'train') {
            const len = L.len / 5;
            for (let j = 0; j < 5; j++)
              add(j ? 'coach' : 'engine', front - L.dir * (j + 0.5) * len, r, 0, L.dir, 1, 0, len / 2.75);
          } else if (kind === 'bus') {
            add(h % 3 === 0 ? 'bus' : 'truck', center, r, h % 8, L.dir, 1, 0, L.len / 2.7);
          } else add(h % 9 === 0 ? 'taxi' : 'car', center, r, h % 8, L.dir, 1, 0, L.len / 1.09);
        }
      }
    }
    if (!score && phase === 'run' && vr + 1 - line < 2.5) {
      const wing = point(vc + Math.sin(now / 600) * 1.2, vr - 1);
      if (art?.hawk) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 0.3;
        ctx.drawImage(art.hawk, wing.x - scale, wing.y, 2 * scale, 1.25 * scale);
        ctx.restore();
      }
    }
    if (score && phase === 'run' && line > 0) strip(minX, line - 1.03, span, 0.075, '#e45c4c');
    const gone = death?.cause === 'hawk';
    if (!gone) {
      const lift = footing + (death ? 0 : hop + (banked ? 0.1 : 0));
      // A long log's center may be closer to the camera than its rider. Draw
      // the hen after her support while allowing nearer traffic to cover her.
      add('hen', vc, vr, death ? 4 : hop > 0.13 ? 2 : 0, facing, 1, lift, 1, supportDepth);
    }
    if (!score && Math.abs(vr - RR.FINISH) < 20) add('egg', RR.START_COL, RR.FINISH);
    if (!score && gone) {
      const seconds = (now - death.at) / 1000;
      const approach = Math.max(0, 1 - seconds / .4);
      const lift = Math.max(0, seconds - .4) * 4;
      add('hen', vc, vr, 0, facing, 1, lift);
      add('hawk', vc + approach * 3, vr - .01, 0, 1, 1, .62 + approach * 4 + lift);
    }
    actors.sort((a, b) => a.depth - b.depth);
    for (const a of actors) {
      if (a.kind === 'egg' || a.kind === 'hawk') continue;
      a.sprite = stamp(a.kind, a.variant, a.dir);
      ctx.save();
      ctx.translate(a.x + .43 * a.lift, a.r - .36 * a.lift);
      ctx.scale(a.size * a.stretch, a.size);
      ctx.fillStyle = '#243e464a';
      ctx.fill(a.sprite.shadow);
      ctx.restore();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const a of actors) {
      const x = a.p.x,
        y = a.p.y - a.lift * plane.height * scale;
      if (a.kind === 'egg' || a.kind === 'hawk') {
        const img = art?.[a.kind];
        if (img) ctx.drawImage(img, x - scale * 0.6, y - scale, scale * 1.2, scale);
        continue;
      }
      const s = a.sprite;
      const u = scale * a.size;
      // Stretch along the projected traffic axis so the front stays on its replay hitbox.
      ctx.save();
      ctx.translate(x, y);
      if (a.kind === 'hen' && !death) ctx.scale(1 + squash, 1 - squash);
      if (a.stretch !== 1) {
        const angle = Math.atan2(plane.xy, plane.xx);
        ctx.rotate(angle);
        ctx.scale(a.stretch, 1);
        ctx.rotate(-angle);
      }
      ctx.drawImage(s.image, s.left * u, s.top * u, s.width * u, s.height * u);
      ctx.restore();
    }
  }
  return { draw, reset, point };
}
