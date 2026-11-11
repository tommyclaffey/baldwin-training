// Wrenfield, the Mise demo restaurant (Nov 11): the parts of its own pages that The Baldwin's design drew with The Baldwin's
// photos. Home's Browse the Book tiles and photo strip, and the Photo Library, are filled from Wrenfield's own dishes,
// drinks and a few room and kitchen shots (all Unsplash stand-ins, credited in content/demo-mise/photos.json).
import fs from 'node:fs';
import path from 'node:path';
import { clone, find, findAll, byName, startsWith, texts, setText } from './templates.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let photos;
/** Every stand-in photo, by its file: size, credit, and the room shots with their captions. */
function stock() {
  if (!photos) { try { photos = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/demo-mise/photos.json'), 'utf8')); } catch { photos = {}; } }
  return photos;
}
const byFile = (file) => Object.values(stock()).find((p) => p.file === file) || null;
const credit = (file) => (byFile(file)?.credit || 'Unsplash (stand-in)').replace(/ · Unsplash \(stand-in\)$/, ', Unsplash');
const ratio = (file) => { const p = byFile(file); return p?.w && p?.h ? p.h / p.w : 1; };
const fill = (node, file, label) => { node.f = [{ img: file, m: 'FILL' }]; node.n = `IMG/${label} · ${credit(file)} (stand-in)`; };

// The room, the bar and the kitchen: what a new hire sees on day one. Captions say what's in the picture.
const ROOM = [
  ['dining-room', 'The dining room', 'Before service'], ['bar-counter', 'The bar', 'Back bar, set for service'],
  ['chef-plating', 'On the pass', 'Plating reference'], ['table-service', 'Wine service', 'Pouring at the table'],
  ['kitchen-line', 'The line', 'Tickets on the rail'], ['herbs-prep', 'Herbs', 'Prep · picked and washed'],
];

/** What the photo pages show, in order: every dish, every drink, then the room. */
function gallery(recipes, house) {
  const dishes = recipes.filter((e) => e.data.photo).map((e, i) => ({ title: e.data.name, cap: i % 3 === 1 ? 'Plating reference' : 'Final plate', file: e.data.photo }));
  const drinks = house.filter((e) => e.data.photo).map((e) => ({ title: e.data.name, cap: [e.data.glass, e.data.garnish && e.data.garnish.toLowerCase()].filter(Boolean).join(', '), file: e.data.photo }));
  const room = ROOM.map(([k, title, cap]) => ({ title, cap, file: stock()[k]?.file })).filter((x) => x.file);
  // Mixed so the strip and the top of the library show food, drinks and the room together.
  const out = [];
  for (let i = 0; out.length < dishes.length + drinks.length + room.length; i++) for (const list of [dishes, drinks, room]) if (list[i]) out.push(list[i]);
  return out;
}

function photoCard(proto, it, width, tall = true) {
  const card = clone(proto);
  card.n = `Photo · ${it.title} · ${it.cap}`;
  const im = find(card, startsWith('IMG/'));
  const frame = find(card, byName('Image'));
  if (im) {
    fill(im, it.file, it.title);
    if (tall) { const h = Math.round(Math.min(Math.max(width * ratio(it.file), 200), 360)); im.h = h; if (frame) frame.h = h; card.h = h + 40; }
  }
  const [name, cap] = texts(find(card, byName('Meta')) || card);
  if (name) { setText(name, it.title); name.n = it.title; }
  if (cap) { setText(cap, it.cap); cap.n = it.cap; }
  return card;
}

/** Fill the Mise demo's own pages before they're wired. `slug` is the page ('' = Home). */
export function fillSample(page, slug, { recipes, house, wines }) {
  const m = page.main;
  const items = gallery(recipes, house);
  if (slug === '') {
    // Browse the Book: Wrenfield's own courses, each tile with one of its dishes.
    const n = (...cs) => recipes.filter((e) => cs.includes(e.data.course)).length;
    const first = (...cs) => recipes.find((e) => cs.includes(e.data.course) && e.data.photo && !e.data.signature)?.data.photo;
    const TILES = {
      'Small Plates': ['Small Plates', `${n('Snacks & Small Plates')} items`, first('Snacks & Small Plates')],
      Mains: ['Mains', `${n('Mains')} items`, first('Mains')],
      'Pizza & Pasta': ['Salads & Dessert', `${n('Salads', 'Dessert')} items`, first('Salads', 'Dessert')],
      Cocktails: ['Cocktails', `${house.length} drinks`, house.find((e) => e.data.photo)?.data.photo],
      Wine: ['Wine', `${wines.length} on our list`, stock()['table-service']?.file],
    };
    for (const [was, [name, label, file]] of Object.entries(TILES)) {
      const t = find(m, byName('Tile · ' + was));
      if (!t) continue;
      t.n = 'Tile · ' + name;
      const [a, b] = texts(t); if (a) { setText(a, name); a.n = name; } if (b) { setText(b, label); b.n = label; }
      const im = find(t, startsWith('IMG/')); if (im && file) fill(im, file, name);
    }
    // The Food Matrix preview's chips name Wrenfield's own courses.
    const course = new Map(recipes.map((e) => ['Row · ' + e.data.name, e.data.course]));
    for (const r of findAll(find(m, byName('Section · Food Matrix')) || { c: [] }, startsWith('Row · '))) if (course.has(r.n)) r.course = course.get(r.n);
    // The photo strip: the first six from the library.
    const row = find(find(m, byName('Section · Photo Library')) || { c: [] }, byName('Photos'));
    const proto = row && row.c.find(startsWith('Photo · '));
    if (proto) row.c = items.slice(0, row.c.filter(startsWith('Photo · ')).length || 6).map((it) => photoCard(proto, it, proto.w, false));
  }
  if (slug === 'photo-library') {
    const masonry = find(m, byName('Masonry'));
    const cols = masonry?.c?.filter((c) => (c.c || []).some(startsWith('Photo · '))) || [];
    const proto = cols[0] && cols[0].c.find(startsWith('Photo · '));
    if (proto) {
      const heights = cols.map(() => 0);
      const lists = cols.map(() => []);
      for (const it of items) {
        const card = photoCard(proto, it, proto.w);
        const i = heights.indexOf(Math.min(...heights)); // shortest column next, so the columns end level
        lists[i].push(card); heights[i] += (card.h || 300) + 16;
      }
      cols.forEach((col, i) => { col.c = [...col.c.filter((c) => !startsWith('Photo · ')(c)), ...lists[i]]; });
    }
    // Any counts drawn into the page header follow the real number.
    for (const t of findAll(m, (x) => x.t === 'T' && /^\d+ photos$/i.test(x.s || ''))) setText(t, `${items.length} photos`);
  }
  return page;
}
