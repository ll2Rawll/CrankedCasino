// Raster caches for the stationary ground and cast shadows.
// All destinations in this module are expressed in backing pixels.
import { RR } from '../math.js?v=a65f52998e3f';
import { plane } from './rooster-models.js?v=a65f52998e3f';

const grass = ['#98af49', '#94ab47', '#a0b451'];
const asphalt = ['#505961', '#586269'];
const road = kind => kind === 'road' || kind === 'bus';
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

const TILE = 384;

// The camera only translates. Keep painted tiles fixed in projected world
// pixels so a hop uncovers a strip of new terrain and reuses the overlap.
function paintTile(image, tx, ty, unit, lane, seed, materials, lite) {
  const g = image.getContext('2d', { alpha: false });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#9fbd50';
  g.fillRect(0, 0, TILE, TILE);
  const x0 = tx * TILE, y0 = ty * TILE;
  g.setTransform(plane.xx * unit, plane.xy * unit, plane.yx * unit, plane.yy * unit, -x0, -y0);
  const det = unit * (plane.xx * plane.yy - plane.xy * plane.yx);
  let left = Infinity, right = -Infinity, first = Infinity, last = -Infinity;
  for (const x of [x0, x0 + TILE]) {
    for (const y of [y0, y0 + TILE]) {
      const col = (plane.yy * x - plane.yx * y) / det;
      const row = (plane.xx * y - plane.xy * x) / det;
      left = Math.min(left, col); right = Math.max(right, col);
      first = Math.min(first, row); last = Math.max(last, row);
    }
  }
  left = Math.floor(left) - 1; right = Math.ceil(right) + 1;
  first = Math.floor(first) - 1; last = Math.ceil(last) + 1;
  const span = right - left;
  const water = r => r === -3 || r === -4 || lane(r).kind === 'river';
  function strip(x, y, w, h, color) {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  }
  for (let r = first; r <= last; r++) {
    const kind = lane(r).kind;
    if (water(r)) {
      const shore = g.createLinearGradient(0, r - .5, 0, r + .5);
      shore.addColorStop(0, water(r - 1) ? '#277791' : '#8bcead');
      shore.addColorStop(.45, '#329ca8');
      shore.addColorStop(1, water(r + 1) ? '#277791' : '#8bcead');
      g.fillStyle = shore;
      g.fillRect(left, r - .505, span, 1.013);
      g.fillStyle = materials.water(g);
    } else if (meadow(kind) || road(kind)) {
      const turf = meadow(kind);
      const colors = turf ? grass : asphalt;
      const color = colors[variation(seed, r, 19) % colors.length];
      // Phones get flat grass and asphalt: the noise textures made each new tile slow.
      g.fillStyle = lite ? color : materials.ground(color, turf);
    } else {
      g.fillStyle = kind === 'train' ? '#8b8571' : '#d6b355';
    }
    g.fillRect(left, r - .505, span, 1.013);
  }
  // Paint permanent features after the lane fills to preserve their edges.
  for (let r = first; r <= last; r++) {
    const kind = lane(r).kind;
    if (water(r)) continue;
    if (meadow(kind)) {
      if (!meadow(lane(r - 1).kind) || r === -2) {
        strip(left, r - .51, span, .1, '#947445');
        strip(left, r - .41, span, .06, '#82a744');
      }
      for (let x = left; x <= right; x++) {
        const h = variation(seed, r, x);
        const j = x + ((h >>> 7) % 67) / 100 - .3, k = r + ((h >>> 14) % 64) / 100 - .32;
        if (h % 5 === 0) {
          strip(j, k, .086, .032, '#bbd465');
          strip(j + .1, k + .055, .045, .025, '#86ab45');
        }
        if (h % 29 === 0 && !wildTree(x, r, h)) {
          g.fillStyle = '#fff3bd';
          g.beginPath(); g.ellipse(j, k, .046, .035, 0, 0, 2 * Math.PI); g.fill();
          g.fillStyle = '#ffe7a1';
          g.beginPath(); g.ellipse(j + .07, k + .04, .035, .025, 0, 0, 2 * Math.PI); g.fill();
        }
      }
    } else if (road(kind)) {
      if (road(lane(r + 1).kind)) {
        for (let x = 2 * Math.floor(left / 2); x < right; x += 2) strip(x, r + .47, .72, .043, '#c4c8bc');
      } else strip(left, r + .46, span, .046, '#858c8d');
    } else if (kind === 'train') {
      for (let i = Math.floor(left / .39); i * .39 < right; i++) strip(i * .39, r - .43, .15, .86, '#806044');
      for (const side of [-.3, .3]) {
        strip(left, r + side - .04, span, .086, '#535958');
        strip(left, r + side + .005, span, .044, '#c4c2af');
      }
    }
  }
  // Outside the playable columns the ground is shaded, so the course edge reads at a glance.
  g.fillStyle = 'rgba(16, 26, 38, .3)';
  if (left < -.5) g.fillRect(left, first, -.5 - left, last - first + 1);
  if (right > RR.COLS - .5) g.fillRect(RR.COLS - .5, first, right - (RR.COLS - .5), last - first + 1);
}

export function wildTree(x, row, hash) {
  return (x < 0 || x >= RR.COLS || row < 0) && hash % 4 === 0 &&
    !(row >= -1 && Math.abs(x - RR.START_COL) < 1.6);
}

export function rasterLayers(ctx, { lite = false } = {}) {
  const tiles = new Map();
  const recycled = [];
  let terrainSeed, terrainMode;
  let frame = 0, unit = 0, width = 0, height = 0;
  const shadows = new Map();
  let pixels = 0, additions = 0;

  function reset() {
    for (const { image } of tiles.values()) image.width = 0;
    for (const image of recycled) image.width = 0;
    for (const { image } of shadows.values()) image.width = 0;
    tiles.clear();
    recycled.length = 0;
    shadows.clear();
    pixels = 0;
  }

  function ground({ W, H, dpr, scale, origin, lane, seed, score, materials }) {
    frame++;
    additions = 0;
    width = Math.round(W * dpr);
    height = Math.round(H * dpr);
    if (unit !== scale * dpr || terrainSeed !== seed || terrainMode !== score) reset();
    unit = scale * dpr;
    terrainSeed = seed;
    terrainMode = score;
    const ox = Math.round(origin.x * dpr), oy = Math.round(origin.y * dpr);
    const left = Math.floor(-ox / TILE), right = Math.floor((width - 1 - ox) / TILE);
    const top = Math.floor(-oy / TILE), bottom = Math.floor((height - 1 - oy) / TILE);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const spareLimit = Math.max(right - left, bottom - top) + 3;
    for (const [key, tile] of tiles) {
      if (tile.x < left - 1 || tile.x > right + 1 || tile.y < top - 1 || tile.y > bottom + 1) {
        tiles.delete(key);
        if (recycled.length < spareLimit) recycled.push(tile.image);
        else tile.image.width = 0;
      }
    }
    function addTile(x, y, key) {
      const image = recycled.pop() ?? surface(TILE, TILE);
      paintTile(image, x, y, unit, lane, seed, materials, lite);
      const tile = { x, y, image };
      tiles.set(key, tile);
      return tile;
    }
    let missed = false;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const key = x + ',' + y;
        let tile = tiles.get(key);
        if (!tile) {
          missed = true;
          tile = addTile(x, y, key);
        }
        ctx.drawImage(tile.image, ox + x * TILE, oy + y * TILE);
      }
    }
    // Prepare at most one neighboring tile on a warm frame. Crossing a tile
    // boundary then usually just changes which images are drawn.
    if (!missed) {
      for (let y = top - 1; y <= bottom + 1; y++) {
        for (let x = left - 1; x <= right + 1; x++) {
          if (x >= left && x <= right && y >= top && y <= bottom) continue;
          const key = x + ',' + y;
          if (!tiles.has(key)) {
            addTile(x, y, key);
            return;
          }
        }
      }
    }
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

  // Traffic lengths vary by lane. Discard shadow stamps that went out of view.
  function tidy() {
    if (frame % 30 !== 0) return;
    for (const [key, entry] of shadows) {
      if (frame - entry.used < 30) continue;
      pixels -= entry.image.width * entry.image.height;
      entry.image.width = 0;
      shadows.delete(key);
    }
  }
  return { ground, shadow, tidy, reset };
}
