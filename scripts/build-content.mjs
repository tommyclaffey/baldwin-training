// Builds the app's content from the Figma export in content/raw/.
// Input:  content/raw/layout0.json + layout40.json (full layout trees), content/raw/figma-content.json (nav section per page)
// Output: public/content/pages/<file>.json (one per screen), src/content/{index,svgs,sidebar}.json
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const raw = (f) => JSON.parse(fs.readFileSync(path.join(root, 'content/raw', f), 'utf8'));

// Every layout*.json export, in name order. A later export replaces a page with the same id (partial re-exports).
const parts = fs.readdirSync(path.join(root, 'content/raw')).filter((f) => /^layout.*\.json$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(raw);
const pages = [];
for (const part of parts) for (const pg of part.pages) {
  const i = pages.findIndex((x) => x.id === pg.id);
  if (i >= 0) { if (!pg.side && pages[i].side) pg.side = pages[i].side; pages[i] = pg; } else pages.push(pg);
}
const svgs = Object.assign({}, ...parts.map((p) => p.svgs));
const navById = Object.fromEntries(raw('figma-content.json').pages.map((p) => [p.id, p.nav]));

// image hash (12 chars) -> public file name
const imgDir = path.join(root, 'public/img');
const imgFile = {};
for (const f of fs.readdirSync(imgDir)) imgFile[f.slice(0, 12)] = f;

const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, 'and').replace(/[’'.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const slugById = {};
const used = new Set();
for (const p of pages) {
  let slug = p.id === '4:2' ? '' : p.name.split(' · ').map(slugify).join('/');
  while (used.has(slug)) slug += '-2';
  used.add(slug);
  slugById[p.id] = slug;
}
const fileOf = (id) => id.replace(':', '-');

// rewrite links + image refs, collect text for search
function prep(node, texts) {
  // a link to another screen becomes its address; a web link (Figma "Open URL") stays as it is
  if (node.to && !/^https?:\/\//.test(node.to)) node.to = slugById[node.to] !== undefined ? '/' + slugById[node.to] : undefined;
  if (node.f) for (const f of node.f) if (f.img) f.img = imgFile[f.img] ? '/img/' + imgFile[f.img] : undefined;
  if (node.t === 'T' && texts) texts.push(node.s);
  if (node.c) node.c.forEach((c) => prep(c, texts));
  return node;
}

const outDir = path.join(root, 'public/content/pages');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Search preview: the page's first big photo and its first real sentence.
function preview(main) {
  let thumb, blurb;
  (function walk(n) {
    if (!thumb && n.f && n.w >= 120 && n.h >= 90) { const f = n.f.find((x) => x.img); if (f) thumb = f.img; }
    if (!blurb && n.t === 'T' && n.s && n.s.length >= 40 && /[a-z]/.test(n.s) && !/sample|confirm/i.test(n.s)) blurb = n.s.replace(/\s+/g, ' ');
    (n.c || []).forEach(walk);
  })(main);
  return { thumb, blurb: blurb && (blurb.length > 110 ? blurb.slice(0, 107).replace(/\s+\S*$/, '') + '…' : blurb) };
}

// Quiz buttons point at the right quiz. (Videos and page content live in the CMS: content/cms/.)
function quizLinks(main, slug) {
  (function walk(n) {
    if (n.n === 'Button · Pre-Shift Quiz') n.to = '/quizzes?quiz=pre-shift';
    if (slug === 'recipe/short-rib' && (n.n === 'Button · Sign Off' || n.n === 'Button · Start')) n.to = '/quizzes?quiz=short-rib';
    (n.c || []).forEach(walk);
  })(main);
}

const index = [];
for (const p of pages) {
  const texts = [];
  prep(p.main, texts);
  quizLinks(p.main, slugById[p.id]);

  const { thumb, blurb } = preview(p.main);
  const bg = p.f && p.f[0] && p.f[0].c;
  fs.writeFileSync(path.join(outDir, fileOf(p.id) + '.json'), JSON.stringify({ id: p.id, name: p.name, bg, main: p.main }));
  const parts = p.name.split(' · ');
  // the big display title on the page, for search results
  const title = parts[parts.length - 1];
  index.push({
    id: p.id,
    file: fileOf(p.id),
    slug: slugById[p.id],
    name: p.name,
    title,
    section: parts.length > 1 ? parts[0] : '',
    nav: navById[p.id] || 'Home',
    thumb,
    blurb,
    text: texts.join(' ').replace(/\s+/g, ' ').slice(0, 1200),
  });
}

const ALIAS = { 'Spirit · Japanese': 'Spirit · Japanese Whisky', 'Spirit · Irish': 'Spirit · Irish Whiskey' };
// Sub-pages without a photo borrow their parent's (Vodka · Wheat uses Vodka's).
const byName = new Map(index.map((e) => [e.name, e]));
for (const e of index) {
  let parts = e.name.split(' · ');
  while (!e.thumb && parts.length > 1) { parts = parts.slice(0, -1); const n = parts.join(' · '); e.thumb = (byName.get(n) || byName.get(ALIAS[n]))?.thumb; }
}

const home = pages.find((p) => p.id === '4:2');
const sidebar = home.side.map((n) => prep(n));
for (const n of sidebar) quizLinks(n, '');


const srcDir = path.join(root, 'src/content');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(root, 'public/content/index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(srcDir, 'svgs.json'), JSON.stringify(svgs));
fs.writeFileSync(path.join(srcDir, 'sidebar.json'), JSON.stringify(sidebar));
console.log(`content: ${index.length} pages, ${Object.keys(svgs).length} icons, ${Object.keys(imgFile).length} images`);
