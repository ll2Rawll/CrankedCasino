// Full-resolution raster caches for the stationary ground, sunlight and cast
// shadows. All destinations in this module are expressed in backing pixels.
import { plane } from './rooster-models.js';

const grass = ['#98af49', '#94ab47', '#a0b451'];
const asphalt = ['#505961', '#586269'];
export const road = kind => kind === 'road' || kind === 'bus';
export const meadow = kind => kind === 'start' || kind === 'safe';

export function variation(seed, row, column) {
  let h = Math.imul(seed ^ Math.imul(row, 65537), 0x45d9f3b) ^ Math.imul(column, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

function surface(w, h) {
  const image = document.createElement('canvas');
  image.width = w;
  image.height = h;
  return image;
}

function paintGround(g, ox, oy, unit, lane, seed, materials, first, last, left, right) {
  g.save();
  g.setTransform(plane.xx * unit, plane.xy * unit, plane.yx * unit, plane.yy * unit, ox, oy);
  const water = r => r === -3 || r === -4 || lane(r).kind === 'river';
  for (let r = first; r <= last; r++) {
    const kind = lane(r).kind;
    if (water(r)) {
      const shore = g.createLinearGradient(0, r - .5, 0, r + .5);
      shore.addColorStop(0, water(r - 1) ? '#277791' : '#8bcead');
      shore.addColorStop(.45, '#329ca8');
      shore.addColorStop(1, water(r + 1) ? '#277791' : '#8bcead');
      g.fillStyle = shore;
    } else if (meadow(kind) || road(kind)) {
      const turf = meadow(kind);
      const colors = turf ? grass : asphalt;
      g.fillStyle = materials.ground(colors[variation(seed, r, 19) % colors.length], turf);
    } else {
      g.fillStyle = kind === 'train' ? '#8b8571' : '#d6b355';
    }
    g.fillRect(left, r - .505, right - left, 1.013);
  }
  g.restore();
}

function paintLight(g, w, h) {
  const sun = g.createLinearGradient(0, 0, w, h * .54);
  sun.addColorStop(0, 'rgba(255,218,149,.25)');
  sun.addColorStop(.28, 'rgba(251,210,136,.065)');
  sun.addColorStop(.45, 'rgba(255,235,177,.14)');
  sun.addColorStop(.66, 'rgba(253,222,161,.018)');
  sun.addColorStop(1, 'rgba(35,66,99,.10)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
}

export function rasterLayers(ctx) {
  let terrain, light;
  let frame = 0, unit = 0, width = 0, height = 0;
  const shadows = new Map();
  let pixels = 0, additions = 0;

  function reset() {
    terrain = null;
    shadows.clear();
    pixels = 0;
  }

  function ground({ W, H, dpr, scale, origin, lane, seed, score, materials, minX, maxX, first, last }) {
    frame++;
    additions = 0;
    width = Math.round(W * dpr);
    height = Math.round(H * dpr);
    if (unit !== scale * dpr) reset();
    unit = scale * dpr;
    const ox = origin.x * dpr, oy = origin.y * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Show the first frame before spending time on overscan and reusable layers.
    if (frame === 1) {
      ctx.fillStyle = '#9fbd50';
      ctx.fillRect(0, 0, width, height);
      paintGround(ctx, ox, oy, unit, lane, seed, materials, first, last, minX, maxX);
      return;
    }
    const pad = Math.ceil(1.5 * unit);
    const w = width + 2 * pad, h = height + 2 * pad;
    if (!terrain || terrain.image.width !== w || terrain.image.height !== h ||
        terrain.seed !== seed || terrain.score !== score ||
        Math.abs(terrain.ox - ox) >= pad || Math.abs(terrain.oy - oy) >= pad) {
      const image = terrain?.image.width === w && terrain.image.height === h ? terrain.image : surface(w, h);
      const g = image.getContext('2d', { alpha: false });
      g.fillStyle = '#9fbd50';
      g.fillRect(0, 0, w, h);
      // Six extra rows and columns cover the rotated corners of the overscan.
      paintGround(g, ox + pad, oy + pad, unit, lane, seed, materials, first - 6, last + 6, minX - 6, maxX + 6);
      terrain = { image, ox, oy, seed, score };
    }
    ctx.drawImage(terrain.image, Math.round(ox - terrain.ox) - pad, Math.round(oy - terrain.oy) - pad);
  }

  function shadow(sh, x, y, size, stretch) {
    const u = unit * size;
    const xx = plane.xx * u * stretch, xy = plane.xy * u * stretch;
    const yx = plane.yx * u, yy = plane.yy * u;
    const key = `${sh.key}/${size}/${stretch}`;
    let entry = shadows.get(key);
    if (!entry) {
      const left = Math.floor(xx * sh.x + yx * sh.y) - 1;
      const top = Math.floor(xy * sh.x + yy * (sh.y + sh.h)) - 1;
      const right = Math.ceil(xx * (sh.x + sh.w) + yx * (sh.y + sh.h)) + 1;
      const bottom = Math.ceil(xy * (sh.x + sh.w) + yy * sh.y) + 1;
      if (x + right < 0 || x + left >= width || y + bottom < 0 || y + top >= height) return;
      const area = (right - left) * (bottom - top);
      // Spread new shadows across frames. Keep at most two viewports of stamps.
      if (frame <= 2 || additions >= 3 || area + pixels > width * height * 2) {
        ctx.setTransform(xx, xy, yx, yy, x, y);
        ctx.drawImage(sh.image, sh.x, sh.y, sh.w, sh.h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        return;
      }
      const image = surface(right - left, bottom - top);
      const g = image.getContext('2d');
      g.setTransform(xx, xy, yx, yy, -left, -top);
      g.drawImage(sh.image, sh.x, sh.y, sh.w, sh.h);
      entry = { image, left, top, used: frame };
      shadows.set(key, entry);
      pixels += area;
      additions++;
    }
    entry.used = frame;
    ctx.drawImage(entry.image, Math.round(x) + entry.left, Math.round(y) + entry.top);
  }

  function sunlight() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (frame < 3) {
      paintLight(ctx, width, height);
      return;
    }
    if (!light || light.width !== width || light.height !== height) {
      light = surface(width, height);
      paintLight(light.getContext('2d'), width, height);
    }
    ctx.drawImage(light, 0, 0);
    // Traffic lengths vary by lane. Discard stamps that went out of view.
    if (frame % 30 === 0) {
      for (const [key, entry] of shadows) {
        if (frame - entry.used < 30) continue;
        pixels -= entry.image.width * entry.image.height;
        shadows.delete(key);
      }
    }
  }
  return { ground, shadow, sunlight, reset };
}
