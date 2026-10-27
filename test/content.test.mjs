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
  assert.equal(index.length, 224);
  assert.equal(new Set(index.map((e) => e.slug)).size, index.length, 'slugs are unique');
});

test('every link points to a page that exists', () => {
  const broken = [];
  const quizIds = new Set(JSON.parse(fs.readFileSync(path.join(root, 'content/quizzes.json'), 'utf8')).quizzes.map((q) => q.id).concat('pre-shift'));
  for (const p of pages) walk(p.main, (n) => {
    if (!n.to) return;
    const [to, query] = n.to.split('?');
    const quiz = query && new URLSearchParams(query).get('quiz');
    if (!slugs.has(to) || (query && !quizIds.has(quiz))) broken.push(`${p.name} -> ${n.to}`);
  });
  assert.deepEqual(broken, []);
});

test('every quiz question has 4 options and a valid answer', () => {
  const bank = JSON.parse(fs.readFileSync(path.join(root, 'content/quizzes.json'), 'utf8'));
  const bad = [];
  for (const q of bank.quizzes) {
    if (!slugs.has(q.page)) bad.push(`${q.id}: page ${q.page}`);
    if (q.questions.length < 5) bad.push(`${q.id}: only ${q.questions.length} questions`);
    q.questions.forEach((x, i) => { if (x.options.length !== 4 || !(x.answer >= 0 && x.answer < 4) || new Set(x.options).size !== 4 || !x.why) bad.push(`${q.id}#${i}`); });
  }
  assert.deepEqual(bad, []);
});

test('the classic cocktail videos are on their pages', () => {
  const vids = JSON.parse(fs.readFileSync(path.join(root, 'content/videos.json'), 'utf8')).videos;
  const bySlug = new Map(index.map((e, i) => [e.slug, pages[i]]));
  const missing = [];
  for (const [slug, v] of Object.entries(vids)) {
    const page = bySlug.get(slug);
    if (!page) { missing.push(slug + ' (no page)'); continue; }
    let found = false;
    walk(page.main, (n) => { if (n.vid?.youtubeId === v.youtubeId) found = true; });
    if (!found) missing.push(slug);
  }
  assert.deepEqual(missing, []);
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
