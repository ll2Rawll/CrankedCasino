import { RR, rrFront } from '../math.js';
import { courseMaterials } from './rooster-materials.js';
import { plane, stamp, prepareSprites, logTop, padTop } from './rooster-models.js?v=95c341414c5b';
import { meadow, variation, wildTree, rasterLayers } from './rooster-layers.js?v=3e9d4885a9a8';

export function landscape(ctx) {
  prepareSprites();
  let materials;
  let warmedHop = false;
  const layers = rasterLayers(ctx);
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
    layers.reset();
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
    touchdown,
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
    materials ??= courseMaterials(ctx);
    materials.update(t);
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
    const riverMask = new Path2D();
    const waterRows = new Set();
    let footing = 0;
    let supportDepth = -Infinity;
    function add(kind, x, r, variant = 0, dir = 1, size = 1, lift = 0, stretch = 1, minDepth = -Infinity) {
      const p = point(x, r);
      if (p.x < -4 * scale || p.x > W + 4 * scale || p.y < -2 * scale || p.y > H + 3 * scale) return;
      actors.push({ kind, x, r, p, depth: Math.max(p.y, minDepth), variant, dir, size, lift, stretch });
    }
    layers.ground({ W, H, dpr, scale, origin, lane, seed, score, materials });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const age = touchdown ? (now - touchdown.at) / 500 : 1;
    const impact = age >= 0 && age < 1;
    const span = maxX - minX;
    for (let r = first; r <= last; r++) {
      const L = lane(r),
        kind = r === -3 || r === -4 ? 'brook' : L.kind;
      const turf = meadow(kind);
      const water = kind === 'river' || kind === 'brook';
      if (turf) {
        for (let x = minX; x <= maxX; x++) {
          const h = variation(seed, r, x);
          if (!wildTree(x, r, h)) continue;
          const j = x + ((h >>> 7) % 67) / 100 - .3;
          const k = r + ((h >>> 14) % 64) / 100 - .32;
          add(h % 13 === 0 ? 'rock' : 'tree', j, k, (h >>> 8) % 4, 1, .73 + (h % 43) / 100);
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
        if (impact && touchdown.row === r) {
          for (const side of [-1, 1]) {
            ellipse(touchdown.x + side * (.13 + .22 * age), r + .10 * Math.sin(Math.PI * age),
              .048 * (1 - age), .022 * (1 - age), '#d6df91');
          }
        }
      } else if (water) {
        waterRows.add(r);
        riverMask.rect(minX,r-.5,span,1);
        strip(minX,r-.5,span,1,materials.water);
        if (impact && touchdown.row === r) {
          ctx.save();
          ctx.lineWidth = .028 * (1 - age) + .009;
          ctx.strokeStyle = `rgba(220,255,248,${.82 * (1 - age)})`;
          ctx.beginPath();
          ctx.ellipse(touchdown.x, r, .24 + .72 * age, .17 + .38 * age, 0, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.restore();
        }
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
          const responding = impact && touchdown.row === r && touchdown.platform === i;
          const dip = responding ? Math.sin(Math.PI * Math.min(1, age * 2)) * (1 - age) : 0;
          const bob = .016 * wave - dip * (L.pads ? .065 : .028);
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
    // Mirror near-bank scenery into the water. Clip before switching to screen
    // coordinates so the reflection can never spill onto a road or a platform.
    if (waterRows.size) {
      ctx.save();
      ctx.clip(riverMask);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = .23;
      const det = plane.xx * plane.yy - plane.xy * plane.yx;
      for (const a of actors) {
        if (!['tree', 'rock', 'fence', 'bridge'].includes(a.kind)) continue;
        const sprite = stamp(a.kind, a.variant, a.dir);
        const shear = .08 * Math.sin(t * 1.8 + a.r);
        // Inverse-project the reflected rectangle to find overlapping river rows.
        // Both coefficients are positive for this camera at every ripple angle.
        const dx = -plane.xy * a.size / det;
        const dy = (-.78 * plane.xx - shear * plane.xy) * a.size / det;
        const firstRow = a.r + dx * sprite.left + dy * sprite.top;
        const lastRow = firstRow + dx * sprite.width + dy * sprite.height;
        let visible = false;
        for (let r = Math.ceil(firstRow - .5); r <= lastRow + .5; r++) {
          if (waterRows.has(r)) { visible = true; break; }
        }
        if (!visible) continue;
        const u = scale * a.size;
        ctx.save();
        ctx.translate(a.p.x, a.p.y);
        ctx.transform(1, 0, shear, -.78, 0, 0);
        ctx.drawImage(sprite.image, sprite.left * u, sprite.top * u, sprite.width * u, sprite.height * u);
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const a of actors) {
      if (a.kind === 'egg' || a.kind === 'hawk') continue;
      a.sprite = stamp(a.kind, a.variant, a.dir);
      const p = point(a.x + 1.10 * a.lift, a.r - .63 * a.lift);
      layers.shadow(a.sprite.penumbra, p.x * dpr, p.y * dpr, a.size, a.stretch);
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
      if (a.kind === 'hen' && footing > 0 && !death) {
        const contact = point(vc, vr, footing);
        ctx.fillStyle = `rgba(50,40,23,${.30 / (1 + 7 * hop)})`;
        ctx.beginPath();
        ctx.ellipse(contact.x, contact.y, scale * .16, scale * .067, .27, 0, 2 * Math.PI);
        ctx.fill();
      }
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
    layers.sunlight();
    if (phase === 'countdown' && !warmedHop) {
      stamp('hen', 2, 1);
      warmedHop = true;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return { draw, reset, point };
}
