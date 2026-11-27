// Generate the three seamless material maps from a shared noise field. Keep
// the source pixels between runs and give each scene its own moving pattern.
const size = 256;
let tiles;

function noiseSampler(cells) {
  // Include a wrapped final row and column, so interpolation has no seam.
  const stride = cells + 1;
  const corners = new Float64Array(stride * stride);
  for (let y = 0; y <= cells; y++) {
    for (let x = 0; x <= cells; x++) {
      let n = Math.imul((x % cells) + 17, 374761393) ^ Math.imul((y % cells) + 59, 668265263);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      corners[y * stride + x] = ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    }
  }
  const cell = new Uint16Array(size);
  const weight = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const v = i * cells / size;
    cell[i] = Math.floor(v);
    const f = v - cell[i];
    weight[i] = f * f * (3 - 2 * f);
  }
  return (x, y) => {
    const at = cell[y] * stride + cell[x];
    const u = weight[x], v = weight[y];
    const top = corners[at] * (1 - u) + corners[at + 1] * u;
    const bottom = corners[at + stride] * (1 - u) + corners[at + stride + 1] * u;
    return top * (1 - v) + bottom * v;
  };
}

function tileContext() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas.getContext('2d');
}

function bakeMaterials() {
  const grass = tileContext(), road = tileContext(), water = tileContext();
  const groundMap = grass.createImageData(size, size);
  const waterMap = water.createImageData(size, size);
  const broadAt = noiseSampler(4), detailAt = noiseSampler(24), gritAt = noiseSampler(128);
  const tau = 2 * Math.PI;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const p = 4 * (j * size + i);
      const broad = broadAt(i, j), detail = detailAt(i, j);
      const value = (broad * .53 + detail * .27 + gritAt(i, j) * .2) * 255;
      groundMap.data[p] = value * 1.06;
      groundMap.data[p + 1] = value;
      groundMap.data[p + 2] = value * .89;
      groundMap.data[p + 3] = 120;

      const x = i / size, y = j / size;
      const crest = .5 + .5 * Math.cos(tau * (9 * y + 2 * x) + (broad * 7 + detail * .48));
      const facets = .5 + .5 * Math.cos(tau * (6 * x - 4 * y) + 4 * broad);
      waterMap.data[p] = 206;
      waterMap.data[p + 1] = 241;
      waterMap.data[p + 2] = 235;
      waterMap.data[p + 3] = (Math.pow(crest, 14) * (.08 + .92 * facets) * .54 + broad * .09) * 255;
    }
  }
  grass.putImageData(groundMap, 0, 0);
  for (let p = 3; p < groundMap.data.length; p += 4) groundMap.data[p] = 90;
  road.putImageData(groundMap, 0, 0);
  water.putImageData(waterMap, 0, 0);
  return { grass: grass.canvas, road: road.canvas, water: water.canvas };
}

export function courseMaterials(ctx) {
  tiles ??= bakeMaterials();
  const water = ctx.createPattern(tiles.water, 'repeat');
  const drift = new DOMMatrix().scaleSelf(4.2 / size);
  const surfaces = new Map();
  return {
    ground(color, turf) {
      if (surfaces.has(color)) return surfaces.get(color);
      const g = tileContext();
      g.fillStyle = color;
      g.fillRect(0, 0, size, size);
      g.globalCompositeOperation = 'soft-light';
      g.drawImage(turf ? tiles.grass : tiles.road, 0, 0);
      const pattern = ctx.createPattern(g.canvas, 'repeat');
      pattern.setTransform(new DOMMatrix().scaleSelf((turf ? 3.3 : 3.1) / size));
      surfaces.set(color, pattern);
      return pattern;
    },
    water,
    update(t) {
      drift.e = (t * .1) % 4.2;
      drift.f = (t * .032) % 4.2;
      water.setTransform(drift);
    },
  };
}
