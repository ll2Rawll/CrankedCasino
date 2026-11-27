// Regenerates the game-card art in assets/img from the 3D scene in tools/art3d.js.
// Usage (from the repo root):  python3 -m http.server 8765 &  node tools/render-assets.mjs
// Needs Playwright (Chromium) and Python with Pillow (for WebP conversion).
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const OUT = new URL('../assets/img/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const JOBS = [
  { id: 'blackjack', ry: 0, rx: 0, zoom: 1.12 },
  { id: 'roulette', ry: -0.5, rx: 0, zoom: 1.12 },
  { id: 'slots', ry: -0.38, rx: 0.12, zoom: 1.08 },
  { id: 'crash', ry: 0.35, rx: 0.1, zoom: 1.08 },
  { id: 'plinko', ry: -0.35, rx: 0.1, zoom: 1.08 },
  { id: 'mines', ry: 0.25, rx: 0.42, zoom: 1.08 },
];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
await page.goto(`${BASE}/tools/render.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
for (const j of JOBS) {
  await page.evaluate(() => window.setSize(640, 640));
  await page.waitForTimeout(60);
  const url = await page.evaluate((j) => window.hero.still(j.id, { ry: j.ry, rx: j.rx, zoom: j.zoom }), j);
  writeFileSync(`${OUT}card-${j.id}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('rendered card', j.id);
}
await browser.close();
execFileSync('python3', ['-I', new URL('./finish-assets.py', import.meta.url).pathname, OUT], { stdio: 'inherit' });
