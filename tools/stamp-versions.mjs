// node tools/stamp-versions.mjs
// Cache tags for GitHub Pages, which lets browsers keep any file for ten minutes.
//
// Scripts: every relative import of a .js module, and every <script src> of one, carries
// ?v=<build>, a single tag for the whole site: the SHA-256 of every module with its tags
// blanked. After a deploy that changes any script, every module URL changes together, so
// a browser can't pair a fresh game with a stale engine. (Per-file hashes can't work for
// scripts: account.js, ui.js and ads.js import each other, so their tags would never settle.)
// Missing tags are added, so a new import is covered the next time this runs.
//
// Everything else (stylesheets, JSON, images) keeps the first 12 hex digits of its own
// SHA-256, so unchanged art stays cached across deploys.
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
    else if (/\.(js|html|css|json)$/.test(name)) files.push(path);
  }
})(root);

const sha = (data) => createHash('sha256').update(data).digest('hex').slice(0, 12);
const changed = new Set();
const save = (file, text) => {
  if (readFileSync(file, 'utf8') === text) return;
  writeFileSync(file, text);
  changed.add(relative(root, file));
};

// 1. Tag every relative script import (static, dynamic and <script src>) that lacks a tag.
const untagged = [
  /(\bfrom\s*['"])(\.{1,2}\/[^'"?#]+\.js)(['"])/g,
  /(\bimport\(\s*['"])(\.{1,2}\/[^'"?#]+\.js)(['"])/g,
  /(<script[^>]*\bsrc=["'])((?![a-z]+:)[^"'?#]+\.js)(["'])/g,
];
// Local stylesheets get a content tag too (step 2 fills it in).
const untaggedCss = /(<link[^>]*\bhref=["'])((?![a-z]+:)[^"'?#]+\.css)(["'])/g;
for (const file of files) {
  if (!/\.(js|html)$/.test(file)) continue;
  let text = readFileSync(file, 'utf8');
  for (const re of untagged) text = text.replace(re, (all, a, path, b) => `${a}${path}?v=0${b}`);
  if (file.endsWith('.html')) text = text.replace(untaggedCss, (all, a, path, b) => `${a}${path}?v=0${b}`);
  save(file, text);
}

// 2. Per-file content tags for everything that isn't a script, repeated until stable
//    (a JSON file's tag changes when an image it names changes).
const ref = /(["'(])([^"'()\s]+?)\?v=([0-9a-f]{1,12})/g;
const target = (file, path) => join(path.startsWith('/') ? root : dirname(file), path.split('#')[0]);
for (let pass = 0; pass < 20; pass++) {
  let any = false;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const out = text.replace(ref, (all, quote, path, old) => {
      if (/^[a-z]+:/i.test(path) || path.endsWith('.js')) return all;
      let fresh;
      try {
        fresh = sha(readFileSync(target(file, path)));
      } catch {
        return all; // not a local file (e.g. a URL built at runtime)
      }
      return fresh === old ? all : `${quote}${path}?v=${fresh}`;
    });
    if (out !== text) {
      save(file, out);
      any = true;
    }
  }
  if (!any) break;
}

// 3. One build tag for every script reference.
const scripts = files.filter((f) => f.endsWith('.js')).sort();
const blank = (text) => text.replace(/(\.js\?v=)[0-9a-f]+/g, '$1');
const build = sha(scripts.map((f) => `${relative(root, f)}\0${blank(readFileSync(f, 'utf8'))}`).join('\0'));
for (const file of files) {
  if (!/\.(js|html)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  save(file, text.replace(/(\.js\?v=)[0-9a-f]+/g, `$1${build}`));
}

console.log(`build ${build}; ${changed.size ? `updated tags in: ${[...changed].join(', ')}` : 'all version tags are current'}`);
