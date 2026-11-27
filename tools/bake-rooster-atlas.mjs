// Bake the procedural artwork at its native resolution with Playwright, Chromium and Pillow.
// Serve the checkout locally first. The printed manifest tag goes in rooster-models.js.
// BASE=http://localhost:8000/ CHROMIUM=/usr/bin/chromium node tools/bake-rooster-atlas.mjs
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
try {
  const page = await browser.newPage();
  const url = new URL('tools/bake.html', process.env.BASE || 'http://localhost:8000/');
  await page.route(url.href, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(url.href);
  const { records, shapes, png } = await page.evaluate(async () => {
    const { stamp } = await import('../js/games/rooster-models.js');
    const records = {}, shapes = {}, patches = [];
    function add(kind, variants, directions) {
      for (const variant of variants) for (const dir of directions) {
        const key = [kind, variant, dir].join('/');
        const s = stamp(kind, variant, dir), sh = s.penumbra;
        const sprite = { left: s.left, top: s.top, width: s.width, height: s.height, shadow: sh.key };
        records[key] = sprite;
        patches.push([sprite, s.image]);
        if (shapes[sh.key]) continue;
        const shape = { x: sh.x, y: sh.y, w: sh.w, h: sh.h };
        shapes[sh.key] = shape;
        patches.push([shape, sh.image]);
      }
    }
    for (const kind of ['car', 'truck', 'bus']) add(kind, [0,1,2,3,4,5,6,7], [-1,1]);
    for (const kind of ['taxi', 'engine', 'coach']) add(kind, [0], [-1,1]);
    add('hen', [0,2,4], [-2,-1,1,2]);
    add('tree', [0,1,2,3], [1]);
    for (const kind of ['pad', 'signal']) add(kind, [0,1], [1]);
    for (const kind of ['bridge', 'rock', 'fence', 'log']) add(kind, [0], [1]);
    const sheet = document.createElement('canvas');
    sheet.width = 1024;
    let x = 1, y = 1, shelf = 0;
    patches.sort((a, b) => b[1].height - a[1].height);
    for (const [record, image] of patches) {
      if (x + image.width + 1 > sheet.width) { x = 1; y += shelf + 2; shelf = 0; }
      record.rect = [x, y, image.width, image.height];
      shelf = Math.max(shelf, image.height);
      x += image.width + 2;
    }
    sheet.height = y + shelf + 1;
    const ctx = sheet.getContext('2d');
    for (const [record, image] of patches) ctx.drawImage(image, record.rect[0], record.rect[1]);
    return { records, shapes, png: sheet.toDataURL('image/png').split(',')[1] };
  });
  const image = execFileSync('python3', ['-c', [
    'import io, sys',
    'from PIL import Image',
    "Image.open(io.BytesIO(sys.stdin.buffer.read())).save(sys.stdout.buffer, format='WEBP', lossless=True, method=6)",
  ].join('\n')], { input: Buffer.from(png, 'base64'), maxBuffer: 16 * 1024 * 1024 });
  const tag = createHash('sha256').update(image).digest('hex').slice(0, 12);
  const dir = new URL('../assets/rooster/', import.meta.url);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('models.webp', dir), image);
  const manifest = JSON.stringify({ image: 'models.webp?v=' + tag, records, shapes });
  await writeFile(new URL('models.json', dir), manifest);
  console.log('Manifest version', createHash('sha256').update(manifest).digest('hex').slice(0, 12));
  console.log('Baked', Object.keys(records).length, 'sprites and', Object.keys(shapes).length, 'shadows;', image.length, 'lossless WebP bytes.');
} finally {
  await browser.close();
}
