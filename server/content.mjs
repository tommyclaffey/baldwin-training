// Assembles a page: the designed page (from Figma) + recipes/cocktails added in the admin + saved edits.
import fs from 'node:fs';
import path from 'node:path';
import { clone, cocktailPage, dishPage, find, byName, startsWith, injectCocktailRows, injectDishRows, repeat, setText, texts } from './templates.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CONTENT = fs.existsSync(path.join(ROOT, 'dist/content/index.json')) ? path.join(ROOT, 'dist/content') : path.join(ROOT, 'public/content');

const baseCache = new Map();
export function basePage(file) {
  if (!/^[0-9]+-[0-9]+$/.test(file)) return null;
  if (!baseCache.has(file)) {
    const f = path.join(CONTENT, 'pages', file + '.json');
    if (!fs.existsSync(f)) return null;
    baseCache.set(file, JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  return clone(baseCache.get(file));
}
export const baseIndex = () => JSON.parse(fs.readFileSync(path.join(CONTENT, 'index.json'), 'utf8'));

const COCKTAIL_TEMPLATE = '87-12';
const DISH_TEMPLATE = '9-2';
const BASE_SIGNATURES = [
  { name: 'Fuschia Satin', slug: 'signature/fuschia-satin', file: '87-12' },
  { name: 'Cozy Blankets', slug: 'signature/cozy-blankets', file: '87-440' },
];

/* ---- override paths: names, not positions, so inserted rows don't shift other edits ---- */
export function nodePath(parent, child) {
  const name = child.n || '';
  const k = (parent.c || []).filter((c) => (c.n || '') === name).indexOf(child);
  return `${name}#${k}`;
}
function walkPaths(node, prefix, fn) {
  fn(node, prefix);
  for (const c of node.c || []) walkPaths(c, prefix + '/' + nodePath(node, c), fn);
}
export function applyOverrides(page, rows) {
  if (!rows.length) return page;
  const map = new Map(rows.map((r) => [r.path, JSON.parse(r.value)]));
  walkPaths(page.main, '', (n, p) => {
    const v = map.get(p);
    if (!v) return;
    if (v.s !== undefined && n.t === 'T') { n.s = v.s; delete n.segs; }
    if (v.img) n.f = [{ img: v.img, m: 'FILL' }];
    if (v.video) n.vid = v.video;
    if (v.video === null) delete n.vid;
  });
  dropAddVideoNotes(page.main);
  shareLibraryVideos(page.main);
  page.edited = map.size;
  return page;
}

/** Video Library: the small "Item · X" rows play the same video as the "Video · X" card. */
function shareLibraryVideos(main) {
  const vids = new Map();
  walkPaths(main, '', (n) => { if (n.vid && n.n?.startsWith('Video · ')) vids.set(n.n.slice(8), n.vid); });
  if (!vids.size) return;
  walkPaths(main, '', (n) => { if (n.n?.startsWith('Item · ') && vids.has(n.n.slice(7))) n.vid = vids.get(n.n.slice(7)); });
}

/** Once a slot has a video, the "Add video" note next to it goes away. Bottom-up, so it only clears its own section. */
function dropAddVideoNotes(node) {
  let pending = !!node.vid;
  for (const c of node.c || []) if (dropAddVideoNotes(c)) pending = true;
  if (!pending) return false;
  const hasNote = (n) => (n.c || []).some((c) => c.n === 'Add video' || hasNote(c));
  if (!hasNote(node)) return true;
  const strip = (n) => { if (n.c) { n.c = n.c.filter((c) => c.n !== 'Add video'); n.c.forEach(strip); } };
  strip(node);
  return false;
}

/* ---- items ---- */
export function itemEntry(it) {
  const d = JSON.parse(it.data);
  return { id: it.id, type: it.type, slug: it.slug, data: d, updated_at: it.updated_at };
}
export function listItems(db, type) {
  const rows = type ? db.prepare('SELECT * FROM items WHERE type = ? ORDER BY id').all(type) : db.prepare('SELECT * FROM items ORDER BY id').all();
  return rows.map(itemEntry);
}

function signatureList(db) {
  const photos = { 'Fuschia Satin': '/img/48ca851d7531.jpg', 'Cozy Blankets': '/img/6a38e5b20321.jpg' };
  return [
    ...BASE_SIGNATURES.map((s) => ({ ...s, photo: photos[s.name] })),
    ...listItems(db, 'cocktail').map((it) => ({ name: it.data.name, slug: it.slug, photo: it.data.photo })),
  ];
}

let glassCards;
function glassCard(glass) {
  if (!glassCards) {
    glassCards = [];
    for (const e of baseIndex().filter((x) => x.slug.startsWith('classic/'))) {
      const card = find(basePage(e.file).main, byName('The glass'));
      if (!card) continue;
      const names = (find(card, byName('Art'))?.c || []).map((c) => (c.n || '').replace('Glass · ', '').toLowerCase());
      glassCards.push({ names, card });
    }
    glassCards.sort((a, b) => a.names.length - b.names.length);
  }
  const g = String(glass || '').toLowerCase();
  if (!g) return null;
  const hit = glassCards.find((c) => c.names.some((n) => g.startsWith(n) || g.startsWith(n.split(' ')[0])));
  return hit ? hit.card : null;
}

function rebuildSignatureStrip(page, all, currentSlug) {
  const strip = find(page.main, byName('Our cocktails'));
  if (!strip) return;
  repeat(strip, startsWith('Signature · '), all, (chip, s) => {
    chip.n = 'Signature · ' + s.name;
    const active = s.slug === currentSlug;
    chip.to = active ? undefined : '/' + s.slug;
    chip.f = [{ c: active ? '#1E1C1A' : '#F3EEE6' }];
    chip.st = active ? undefined : '#E4DCCF';
    const dot = find(chip, (n) => n.t === 'E');
    if (dot) dot.f = s.photo ? [{ img: s.photo, m: 'FILL' }] : [{ c: '#C49A6C' }];
    const t = texts(chip)[0];
    setText(t, s.name);
    t.f = [{ c: active ? '#F2EEE7' : '#1E1C1A' }];
  });
}

export function assemble(db, file) {
  let page;
  if (/^i\d+$/.test(file)) {
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(file.slice(1)));
    if (!row) return null;
    const it = itemEntry(row);
    if (it.type === 'cocktail') page = cocktailPage(basePage(COCKTAIL_TEMPLATE), it, { signatures: signatureList(db), glassCard });
    else page = dishPage(basePage(DISH_TEMPLATE), it);
  } else {
    page = basePage(file);
    if (!page) return null;
    if (file === '14-2') injectCocktailRows(page, listItems(db, 'cocktail'));
    if (file === '13-2') injectDishRows(page, listItems(db, 'dish'));
    const sig = BASE_SIGNATURES.find((s) => s.file === file);
    if (sig) {
      const all = signatureList(db);
      if (all.length > BASE_SIGNATURES.length) rebuildSignatureStrip(page, all, sig.slug);
    }
  }
  const rows = db.prepare('SELECT path, value FROM overrides WHERE page_id = ?').all(page.id);
  return applyOverrides(page, rows);
}

/** Every page, for routes and search: the designed pages plus admin-added items. */
export function fullIndex(db) {
  const base = baseIndex();
  const items = listItems(db).map((it) => ({
    id: 'i' + it.id,
    file: 'i' + it.id,
    slug: it.slug,
    name: (it.type === 'cocktail' ? 'Signature · ' : 'Recipe · ') + it.data.name,
    title: it.data.name,
    section: it.type === 'cocktail' ? 'Signature' : 'Recipe',
    nav: it.type === 'cocktail' ? 'The Bar' : 'Food Matrix',
    text: [it.data.tagline, it.data.description, ...(it.data.build || []).map((b) => b.ingredient), ...(it.data.allergens || [])].filter(Boolean).join(' '),
  }));
  return [...base, ...items];
}
