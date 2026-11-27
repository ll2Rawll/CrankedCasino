// node tools/stamp-versions.mjs
// Rewrites every `file?v=<tag>` reference to the first 12 hex digits of that file's SHA-256.
// A changed module changes its tag, which changes the files that import it, all the way up
// to index.html, so browsers fetch fresh copies after a deploy and cache the rest.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const skip = new Set(['vendor', '.git', 'node_modules', 'docs']);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(js|mjs|html|css|json)$/.test(name)) files.push(path);
  }
})(root);

const tag = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
const ref = /(["'(])([^"'()\s]+?)\?v=([0-9a-f]{4,12})/g;

let changed = new Set();
for (let pass = 0; pass < 20; pass++) {
  let any = false;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const out = text.replace(ref, (all, quote, target, old) => {
      if (/^[a-z]+:/i.test(target)) return all; // external URLs
      const base = target.startsWith('/') ? root : dirname(file);
      const path = join(base, target.split('#')[0]);
      let fresh;
      try {
        fresh = tag(path);
      } catch {
        return all; // not a local file (e.g. a URL built at runtime)
      }
      return fresh === old ? all : `${quote}${target}?v=${fresh}`;
    });
    if (out !== text) {
      writeFileSync(file, out);
      changed.add(relative(root, file));
      any = true;
    }
  }
  if (!any) break;
}
console.log(changed.size ? `updated tags in: ${[...changed].join(', ')}` : 'all version tags are current');
