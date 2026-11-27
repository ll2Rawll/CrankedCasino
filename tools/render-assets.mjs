// Regenerates the PNG/WebP art in assets/img from the live 3D scene.
// Usage: python3 -m http.server 8765 (in repo root) & node tools/render-assets.mjs
// Requires Playwright (Chromium) and Python with Pillow for the WebP/icon steps.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const OUT = new URL('../assets/img/', import.meta.url).pathname;
const TMP = new URL('./.render-tmp/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const IDS = ['logo', 'mines', 'plinko', 'slots', 'crash'];
const POSE = {
  logo: { ry: -0.42, rx: 0.16 },
  mines: { ry: 0.25, rx: 0.42 },
  plinko: { ry: -0.35, rx: 0.1 },
  slots: { ry: -0.38, rx: 0.12 },
  crash: { ry: 0.35, rx: 0.1 },
};
const jobs = [];
for (const id of IDS) {
  jobs.push({ file: `hero-${id}.png`, w: 480, h: 600, zoom: 1, ...POSE[id], id });
  jobs.push({ file: `thumb-${id}.png`, w: 180, h: 225, zoom: 1.45, ...POSE[id], id });
  if (id !== 'logo') jobs.push({ file: `card-${id}.png`, w: 640, h: 640, zoom: 1.08, ...POSE[id], id });
}
jobs.push({ file: 'logo-tile.png', w: 132, h: 132, zoom: 1.5, id: 'logo', ry: -0.42, rx: 0.16, tmp: true });
jobs.push({ file: 'logo-512.png', w: 512, h: 512, zoom: 1.35, id: 'logo', ry: -0.42, rx: 0.16, tmp: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
await page.goto(`${BASE}/tools/render.html`);
await page.waitForFunction(() => window.ready === true);
for (const j of jobs) {
  await page.evaluate(([w, h]) => window.setSize(w, h), [j.w, j.h]);
  await page.waitForTimeout(60);
  const url = await page.evaluate((j) => window.hero.still(j.id, { ry: j.ry, rx: j.rx, zoom: j.zoom }), j);
  const dest = (j.tmp ? TMP : OUT) + j.file;
  writeFileSync(dest, Buffer.from(url.split(',')[1], 'base64'));
  console.log('rendered', j.file);
}
await browser.close();
execFileSync('python3', ['-I', new URL('./finish-assets.py', import.meta.url).pathname, OUT, TMP], { stdio: 'inherit' });
