// Checks the built content: every link goes to a real page, every image exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'src/content/index.json'), 'utf8'));
const slugs = new Set(index.map((e) => '/' + e.slug));
const pages = index.map((e) => JSON.parse(fs.readFileSync(path.join(root, 'public/content/pages', e.file + '.json'), 'utf8')));

function walk(n, fn) { fn(n); (n.c || []).forEach((c) => walk(c, fn)); }

test('there is one page per Figma screen', () => {
  assert.equal(index.length, 222);
  assert.equal(new Set(index.map((e) => e.slug)).size, index.length, 'slugs are unique');
});

test('every link points to a page that exists', () => {
  const broken = [];
  for (const p of pages) walk(p.main, (n) => { if (n.to && !slugs.has(n.to)) broken.push(`${p.name} -> ${n.to}`); });
  assert.deepEqual(broken, []);
});

test('every image file exists', () => {
  const missing = [];
  for (const p of pages) walk(p.main, (n) => (n.f || []).forEach((f) => { if (f.img && !fs.existsSync(path.join(root, 'public', f.img))) missing.push(`${p.name}: ${f.img}`); }));
  assert.deepEqual(missing, []);
});

test('every page can be reached from Home', () => {
  const bySlug = new Map(index.map((e, i) => ['/' + e.slug, pages[i]]));
  const seen = new Set(['/']);
  const queue = ['/'];
  const sidebar = JSON.parse(fs.readFileSync(path.join(root, 'src/content/sidebar.json'), 'utf8'));
  sidebar.forEach((s) => walk(s, (n) => { if (n.to && !seen.has(n.to)) { seen.add(n.to); queue.push(n.to); } }));
  while (queue.length) {
    const p = bySlug.get(queue.shift());
    if (p) walk(p.main, (n) => { if (n.to && !seen.has(n.to)) { seen.add(n.to); queue.push(n.to); } });
  }
  const orphans = [...slugs].filter((s) => !seen.has(s));
  assert.deepEqual(orphans, []);
});
