// Builds the app's content from the Figma export in content/raw/.
// Input:  content/raw/layout0.json + layout40.json (full layout trees), content/raw/figma-content.json (nav section per page)
// Output: public/content/pages/<file>.json (one per screen), src/content/{index,svgs,sidebar}.json
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const raw = (f) => JSON.parse(fs.readFileSync(path.join(root, 'content/raw', f), 'utf8'));

const parts = [raw('layout0.json'), raw('layout40.json')];
const pages = parts.flatMap((p) => p.pages);
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
  if (node.to) node.to = slugById[node.to] !== undefined ? '/' + slugById[node.to] : undefined;
  if (node.f) for (const f of node.f) if (f.img) f.img = imgFile[f.img] ? '/img/' + imgFile[f.img] : undefined;
  if (node.t === 'T' && texts) texts.push(node.s);
  if (node.c) node.c.forEach((c) => prep(c, texts));
  return node;
}

const outDir = path.join(root, 'public/content/pages');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const index = [];
for (const p of pages) {
  const texts = [];
  prep(p.main, texts);
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
    text: texts.join(' ').replace(/\s+/g, ' ').slice(0, 1200),
  });
}

const home = pages.find((p) => p.id === '4:2');
const sidebar = home.side.map((n) => prep(n));

const srcDir = path.join(root, 'src/content');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(root, 'public/content/index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(srcDir, 'svgs.json'), JSON.stringify(svgs));
fs.writeFileSync(path.join(srcDir, 'sidebar.json'), JSON.stringify(sidebar));
console.log(`content: ${index.length} pages, ${Object.keys(svgs).length} icons, ${Object.keys(imgFile).length} images`);
