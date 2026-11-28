// NODE_PATH=<playwright-core location> node tools/render-cases-art.mjs
// Rebuilds original, pre-lit case artwork and item turntables. Build-time WebGL only.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const repo = resolve(new URL('..', import.meta.url).pathname);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.route('http://case-art.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<script type="module" src="/art.js"></script>' });
    return route.fulfill({ contentType: 'text/javascript', body: await readFile(join(repo, path === '/three.js' ? 'vendor/three.module.min.js' : path === '/mythic.js' ? 'tools/cases-mythic-art.js' : 'tools/cases-art-scene.js'), 'utf8') });
  });
  await page.goto('http://case-art.test/');
  await page.waitForFunction(() => window.ready);
  const mythicItems = ['ember','astral','tide'].flatMap(theme=>Array.from({length:6},(_,i)=>`${theme}-${i}`));
  const items = process.env.MYTHIC_ONLY ? mythicItems : ['blade','watch','headphones','diamond','chips','signet',...mythicItems];
  let bytes = 0;
  for (const name of process.env.SHOWROOM_ONLY ? [] : [...items, ...(process.env.MYTHIC_ONLY ? [] : ['case', 'open', ...Array.from({ length: 19 }, (_, i) => `caseFrame${i}`)]), ...items.map(name => `${name}-turn`), ...items.map(name => `${name}-inspect`)]) {
    const data = await page.evaluate(name => name.endsWith('-inspect') ? window.renderTurntable(name.slice(0, -8), true) : name.endsWith('-turn') ? window.renderTurntable(name.slice(0, -5)) : window.renderAsset(name), name);
    const buffer = Buffer.from(data.split(',')[1], 'base64');
    await writeFile(join(repo, 'assets/cases', `${name}.webp`), buffer);
    bytes += buffer.length;
  }
  for (const theme of process.env.MYTHIC_ONLY ? ['dragonheart','starfall','leviathan'] : ['after-hours','neon-vault','high-roller','dragonheart','starfall','leviathan']) {
    for (const kind of ['closed', 'opened', 'atlas']) {
      const data = await page.evaluate(([theme,kind]) => window.renderShowcase(theme,kind), [theme,kind]);
      const buffer = Buffer.from(data.split(',')[1], 'base64');
      await writeFile(join(repo, 'assets/cases', `case-${theme}${kind === 'closed' ? '' : kind === 'atlas' ? '-open' : '-opened'}.webp`), buffer);
      bytes += buffer.length;
    }
  }
  console.log(`Rendered case, six items, 19 opening frames and reveal/inspection turntables: ${Math.round(bytes / 1024)} KiB total.`);
} finally { await browser.close(); }
