// Seamless material maps in ground space. Bake the grain, ripples and sun
// highlights once; during play their cost is a patterned lane fill.
export function courseMaterials(ctx) {
  const size = 256;
  function noise(x, y, cells) {
    const X = x * cells,
      Y = y * cells;
    const ix = Math.floor(X),
      iy = Math.floor(Y);
    function corner(a, b) {
      let n = Math.imul((a % cells) + 17, 374761393) ^ Math.imul((b % cells) + 59, 668265263);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    }
    const fx = X - ix,
      fy = Y - iy;
    const u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy);
    const top = corner(ix, iy) * (1 - u) + corner(ix + 1, iy) * u;
    const bottom = corner(ix, iy + 1) * (1 - u) + corner(ix + 1, iy + 1) * u;
    return top * (1 - v) + bottom * v;
  }
  function tile(material, extent) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    const image = g.createImageData(size, size);
    const tau = 2 * Math.PI;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const x = i / size,
          y = j / size,
          p = 4 * (j * size + i);
        const broad = noise(x, y, 4),
          detail = noise(x, y, 24);
        const grit = noise(x, y, 128);
        let value, opacity;
        if (material === 'water') {
          const bend = broad * 7 + detail * 0.48;
          const crest = 0.5 + 0.5 * Math.cos(tau * (9 * y + 2 * x) + bend);
          const facets = 0.5 + 0.5 * Math.cos(tau * (6 * x - 4 * y) + 4 * broad);
          value = 206;
          opacity = (Math.pow(crest, 14) * (0.08 + 0.92 * facets) * 0.54 + broad * 0.09) * 255;
        } else {
          value = (broad * 0.53 + detail * 0.27 + grit * 0.2) * 255;
          opacity = material === 'grass' ? 120 : 90;
        }
        image.data[p] = material === 'water' ? value : value * 1.06;
        image.data[p + 1] = material === 'water' ? 241 : value;
        image.data[p + 2] = material === 'water' ? 235 : value * 0.89;
        image.data[p + 3] = opacity;
      }
    g.putImageData(image, 0, 0);
    const pattern = ctx.createPattern(canvas, 'repeat');
    const transform = new DOMMatrix().scaleSelf(extent / size);
    pattern.setTransform(transform);
    return { pattern, transform };
  }
  const grass = tile('grass', 3.3);
  const road = tile('road', 3.1);
  const water = tile('water', 4.2);
  return {
    grass: grass.pattern,
    road: road.pattern,
    water: water.pattern,
    update(t) {
      water.transform.e = (t * 0.1) % 4.2;
      water.transform.f = (t * 0.032) % 4.2;
      water.pattern.setTransform(water.transform);
    },
  };
}
