// Assembles a page: either a CMS page (collection template + entry), or a designed page with its lists
// (tables, strips) filled from the CMS.
import fs from 'node:fs';
import path from 'node:path';
import { clone, cocktailPage, dishPage, photoToCome, find, findAll, byName, startsWith, repeat, setText, texts } from './templates.mjs';
import { classicPage, classicOrder, classicTable } from './classic.mjs';
import { COLLECTIONS, COURSES, SHARED, listEntries, getEntry, wineDescription } from './cms.mjs';
import { classify, emptyPage, baldwinTerms, snapshotShelves, genericize, indexText } from './generic.mjs';
import { BANK } from './quiz.mjs';
import { wineKind, wineVideos, learnMore, wineCards } from './wine.mjs';
import { fillShelf, fillBeerPage, fillBeerStyle, shelfSearchText } from './shelf.mjs';
import { fillWinePage, fillWineShelf, wineSearchText, wineEntryPage } from './winelist.mjs';
import { wire } from './interact.mjs';
import { fillHome } from './home.mjs';

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
let baseIdx;
export const baseIndex = () => (baseIdx ||= JSON.parse(fs.readFileSync(path.join(CONTENT, 'index.json'), 'utf8')));

const img = (url) => (url ? [{ img: url, m: 'FILL' }] : [{ c: '#2A2724' }]);
const quizFor = (name) => BANK.quizzes.find((q) => q.title === name)?.id;

/* ---- glass cards, taken from the designed classic pages ---- */
let glassCards;
function cards() {
  if (!glassCards) {
    glassCards = [];
    for (const e of baseIndex().filter((x) => x.slug.startsWith('classic/'))) {
      const card = find(basePage(e.file).main, byName('The glass'));
      if (!card) continue;
      const names = (find(card, byName('Art'))?.c || []).map((c) => (c.n || '').replace('Glass · ', '').toLowerCase());
      glassCards.push({ slug: e.slug, title: texts(find(card, byName('Top')))[0]?.s || '', names, card });
    }
    glassCards.sort((a, b) => a.names.length - b.names.length);
  }
  return glassCards;
}
/** The names of the glass cards in the design, for the admin form. */
export const glassTitles = () => [...new Set(cards().map((c) => c.title))].sort();
/** Picks the glass card: the page's own card first, then one with that title, then one showing that glass. */
function glassCard(glass, slug) {
  const g = String(glass || '').toLowerCase();
  if (!g) return null;
  const all = cards();
  const hit = all.find((c) => c.slug === slug && c.title.toLowerCase() === g) || all.find((c) => c.title.toLowerCase() === g)
    || all.find((c) => c.names.some((n) => g.startsWith(n) || g.startsWith(n.split(' ')[0])));
  return hit ? hit.card : null;
}

/* ---- parts that look different on other classic pages ---- */
let protos;
function classicProtos() {
  if (protos) return protos;
  const of = basePage('76-2');
  const tiles = find(of.main, byName('Ingredients'))?.c || [];
  const riffs = (find(of.main, byName('Riffs'))?.c || []).filter(startsWith('Riff · '));
  const ws = basePage(baseIndex().find((x) => x.slug === 'classic/whiskey-sour').file).main;
  protos = {
    learnTile: tiles.find((t, i) => i > 0 && find(t, byName('Learn'))), linkedRiff: riffs.find((r) => r.to), plainRiff: riffs.find((r) => !r.to),
    allergyPill: find(ws, (n) => (n.n || '').startsWith('Pill · Contains')), allergyNote: find(ws, byName('Allergen note')),
  };
  return protos;
}

/* ---- Which store a request is for. Assembly is synchronous, so the scope is set around each call. ---- */
let SCOPE = { store: 1, row: null, user: null, generic: false };
/** Run `fn` for one store: its own entries, and The Baldwin's full book or the shared library. */
export function withStore(row, fn, user = null) {
  const prev = SCOPE;
  SCOPE = { store: row?.id ?? 1, row, user, generic: !!row && !row.book_ready };
  try { return fn(); } finally { SCOPE = prev; }
}
const isGeneric = () => SCOPE.generic;

export function ordered(db, col) {
  let list = listEntries(db, col, SHARED.has(col) ? null : SCOPE.store);
  // Classics are shared; "On our menu" prices are The Baldwin's.
  if (col === 'classic' && isGeneric()) list = list.map((e) => ({ ...e, data: { ...e.data, menuPrice: '' } }));
  if (col === 'classic') return classicOrder(list);
  const g = COLLECTIONS[col].group;
  if (!g) return list;
  return [...g.values.flatMap((v) => list.filter((e) => e.data[g.key] === v)), ...list.filter((e) => !g.values.includes(e.data[g.key]))];
}

/** A CMS page, or null if it has no page (e.g. a dish that only lives in the Food Matrix). */
function entryPage(db, e) {
  const c = COLLECTIONS[e.collection];
  if ((c.hasPage && !c.hasPage(e.data)) || !c.template) return null;
  const tpl = basePage(c.template);
  if (e.collection === 'classic' && isGeneric()) e = { ...e, data: { ...e.data, menuPrice: '' } };
  if (e.collection === 'classic') return classicPage(tpl, e, { all: ordered(db, 'classic'), glassCard, protos: classicProtos() });
  if (e.collection === 'house') {
    const signatures = ordered(db, 'house').map((x) => ({ name: x.data.name, slug: x.slug, photo: x.data.photo }));
    return cocktailPage(tpl, e, { signatures, glassCard, glassShape });
  }
  if (e.collection === 'recipe') return dishPage(tpl, { ...e, quiz: quizFor(e.data.name) }, pairingLinks(db));
  if (e.collection === 'wine') return wineEntryPage(tpl, e, { all: ordered(db, 'wine'), index: baseIndex(), recipes: ordered(db, 'recipe') });
  return null;
}

/** Only show what this person can use (Tommy, Oct 29: "if it's not an account that's supposed to add, don't give them
 *  the option"). Links into the admin go unless the person can open that screen: shared-library screens (classics,
 *  grape and region videos) are for super admins, the rest for managers and owners. Staff see none. */
const MANAGERS = new Set(['manager', 'owner', 'superadmin']);
export function canOpen(user, to) {
  if (!user || !MANAGERS.has(user.role)) return false;
  if (/^\/admin\/(wine-videos|pages\/classic)/.test(to)) return user.role === 'superadmin';
  return true;
}
function forViewer(page, user) {
  if (!page?.main) return page;
  const words = (n) => (n.t === 'T' ? 1 : (n.c || []).reduce((k, c) => k + words(c), 0));
  // Returns true when the node lost something and is left as a bare label (a column heading, a tier name): it goes too.
  const prune = (n) => {
    if (!n.c) return false;
    const before = n.c.length;
    n.c = n.c.filter((c) => !(c.to && c.to.startsWith('/admin') && !canOpen(user, c.to)));
    let lost = n.c.length < before;
    n.c = n.c.filter((c) => { const empty = prune(c); if (empty) lost = true; return !empty; });
    return lost && n !== page.main && words(n) <= 1;
  };
  prune(page.main);
  return page;
}

/** Dish names written into the design before the Food Book (Oct 28) renamed them. */
const OLD_DISH = { 'Short Rib': 'Braised Short Rib', Cauliflower: 'Roasted Cauliflower', Agnolotti: 'Squash Agnolotti', 'Beet Confit': 'Beet Salad', 'Scallop Rockefeller': 'Scallops Rockefeller', 'Mike’s Vegas Pie': 'Mike’s Vegas Winner', "Mike's Vegas Pie": 'Mike’s Vegas Winner' };
/** "Pairs with" cards on wine, beer and spirit pages: each dish opens its own page, under its menu name.
 *  A dish that's no longer on the menu (archived) leaves the card; an empty card goes. */
function linkDishPairs(page, recipes) {
  const byName = new Map(recipes.map((e) => [squash(e.data.name), e]));
  for (const card of findAll(page.main, (n) => n.n === 'Pairs with' && (n.c || []).some(startsWith('Pair · ')))) {
    card.c = card.c.filter((c) => {
      if (!startsWith('Pair · ')(c)) return true;
      const old = c.n.slice(7);
      const e = byName.get(squash(OLD_DISH[old] || old));
      if (!e) return false;
      c.to = '/' + e.slug; c.n = 'Pair · ' + e.data.name;
      const t = texts(c)[0]; if (t && t.s === old) setText(t, e.data.name);
      return true;
    });
    if (!card.c.some(startsWith('Pair · '))) { const p = parentOf(page.main, card); if (p) p.c = p.c.filter((x) => x !== card); }
  }
}

/** Food Book pairings name a wine ("Thomas Schmitt Riesling") or a cocktail ("Side Car"); find its page in the book. */
const squash = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
/** The drawn bowl from the Food Matrix design (no photo yet). */
const bowlSvg = () => find(basePage('13-2')?.main || {}, byName('Shape · Bowl'))?.svg || null;
function pairingLinks(db) {
  const wines = ordered(db, 'wine').map((w) => {
    const name = w.data.name || '';
    const nick = (name.match(/['‘’]([^'‘’]+)['‘’]/) || [])[1];
    return { slug: w.slug, photo: w.data.bottle_img, keys: [squash(name.replace(/['‘’][^'‘’]*['‘’]/g, '')), squash(name.replace(/['‘’][^'‘’]*['‘’]/g, '').replace(/^(ch[aâ]teau|domaine)\s+/i, '')), nick && squash(nick)].filter((k) => k && k.length >= 4) };
  });
  const drinks = [...ordered(db, 'classic'), ...ordered(db, 'house')].map((c) => ({ slug: c.slug, photo: c.data.photo, key: squash(c.data.name) }));
  return {
    bowl: bowlSvg(),
    wine: (nm) => { const q = squash(nm); return wines.find((w) => w.keys.some((k) => q.includes(k))) || null; },
    cocktail: (nm) => { const q = squash(nm); return drinks.find((c) => c.key === q) || drinks.find((c) => q.length >= 5 && c.key.length >= 5 && (c.key.includes(q) || q.includes(c.key))) || null; },
  };
}

/** Allergen Guide grid: one row per dish from the Recipes collection, a mark in every column the dish is tagged with. */
const MAJOR = new Set(['Finfish', 'Shellfish', 'Tree Nut', 'Peanut']);
function allergenGrid(page, recipes, clear = false) {
  const grid = find(page.main, byName('Allergen grid'));
  if (!grid) return;
  // A store with no dishes yet: headers and legend only, none of The Baldwin's rows.
  if (!recipes.length) { if (clear) grid.c = grid.c.filter((c) => !startsWith('Row · ')(c) && !startsWith('Group · ')(c)); return; }
  const rows = grid.c.filter(startsWith('Row · '));
  const cells = rows.flatMap((r) => r.c);
  const mark = cells.find((c) => find(c, byName('Contains'))?.f?.[0]?.c === '#1E1C1A');
  const major = cells.find((c) => { const k = find(c, byName('Contains')); return k && k.f?.[0]?.c !== '#1E1C1A'; });
  const none = cells.find((c) => find(c, byName('None')));
  const proto = rows.find((r) => !find(r, startsWith('Pill · '))) || rows[0];
  const groupProto = grid.c.find(startsWith('Group · '));
  const head = grid.c.filter((c) => c.n === 'Header');
  const tail = grid.c.filter((c) => c.n === 'Legend' || c.n === 'Definitions');
  const out = [...head, ...courseGroups(groupProto, recipes, (e) => {
    const d = e.data;
    const r = clone(proto);
    r.n = 'Row · ' + d.name;
    r.to = '/' + e.slug;
    const tags = new Set(d.allergens || []);
    r.c = r.c.map((c) => {
      if (c.n === 'Dish') { const t = clone(c); setText(texts(t)[0], d.name); return t; }
      const src = tags.has(c.n) ? (MAJOR.has(c.n) ? major || mark : mark) : none;
      const cell = clone(src || c); cell.n = c.n; cell.w = c.w;
      return cell;
    });
    return r;
  })];
  grid.c = [...out, ...tail];
}

/* ---- lists on designed pages ---- */
function houseRows(page, house) {
  const matrix = find(page.main, byName('Cocktail matrix'));
  if (!matrix) return;
  const proto = find(matrix, startsWith('Row · Fuschia')) || matrix.c.find(startsWith('Row · '));
  const zero = matrix.c.find((n) => n.n === 'Row · Zero-proof drink');
  const made = house.map((it) => {
    const d = it.data;
    const r = clone(proto);
    r.n = 'Row · ' + d.name; r.to = '/' + it.slug;
    const im = find(r, startsWith('IMG/'));
    if (im && d.photo) im.f = img(d.photo);
    else if (im) {
      // No photo yet: a beige thumbnail with the drink's glass drawn in it.
      const g = glassShape(d.glass);
      photoToCome(im, false);
      if (g.svg) im.c = [{ t: 'S', n: 'Shape · ' + g.name, w: Math.round(im.w * 0.5), h: Math.round(im.h * 0.62), sh: 'F', sv: 'F', svg: g.svg }];
    }
    const t = texts(r);
    const build = (d.build || []).filter((b) => b && b.ingredient);
    const base = build.find((b) => b.spirit) || build[0];
    const rest = build.filter((b) => b !== base).map((b) => b.ingredient).join(', ');
    [d.name, d.tableLine || rest || d.tagline || '', base ? base.ingredient : '—', d.glass || '—', d.tableIce || d.ice || '—', d.garnish || 'To confirm', d.pairs || 'Ask the bar']
      .forEach((v, i) => t[i] && setText(t[i], v));
    return r;
  });
  // Our own spiritless drinks replace the zero-proof placeholder row.
  const hasZero = house.some((it) => it.data.menuSection === 'Spiritless & Bubbles');
  const rest = matrix.c.filter((c) => !(startsWith('Row · ')(c)) || (c === zero && !hasZero));
  const at = zero && !hasZero ? rest.indexOf(zero) : rest.length - 1;
  matrix.c = [...rest.slice(0, at), ...made, ...rest.slice(at)];
}

/** A stand-in for a missing photo: the glass it's served in, drawn like the Glassware page, and "photo to come". */
let shapes;
/** The drawn glass for a glass name ("Short rocks, large ice" → the Rocks drawing), from the Glassware page. */
function glassShape(glass) {
  glassFiller({ c: [] }, glass); // loads the drawings
  const name = String(glass || '').split(/ · | or |\(|,/)[0].trim() || 'Coupe';
  const low = name.toLowerCase().replace(/ and /g, ' & ').replace(/mule mug/, 'copper mug');
  return { name, svg: shapes.get(low) || [...shapes].filter(([k]) => low.includes(k)).sort((a, b) => b[0].length - a[0].length)[0]?.[1] || null };
}
function glassFiller(proto, glass) {
  if (!shapes) {
    shapes = new Map();
    const gw = baseIndex().find((e) => e.slug === 'bar-basics/glassware');
    for (const g of gw ? findAll(basePage(gw.file).main, startsWith('Glass · ')) : []) {
      const sh = find(g, startsWith('Shape · '));
      if (sh) shapes.set(g.n.slice(8).toLowerCase(), sh.svg);
    }
  }
  const name = String(glass || '').split(/ · | or |\(|,/)[0].trim() || 'Coupe';
  const f = clone(proto);
  const shape = find(f, startsWith('Shape · '));
  // Book wording ("Short rocks", "Small Nick and Nora", "Fancy highball") finds the longest glass name inside it.
  const low = name.toLowerCase().replace(/ and /g, ' & ').replace(/mule mug/, 'copper mug');
  const svg = shapes.get(low) || [...shapes].filter(([k]) => low.includes(k)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  if (shape && svg) { shape.svg = svg; shape.n = 'Shape · ' + name; }
  const cap = find(f, byName('Caption'));
  // Two short lines, centred, never wider than the panel.
  if (cap) { setText(cap, `${name.toUpperCase()}\nPHOTO TO COME`); cap.ar = 'H'; cap.ta = 'C'; cap.w = Math.max(120, f.w - 24); cap.lh = '160%'; }
  f.n = 'Glass filler · ' + name;
  return f;
}

/** Our signatures (Cocktails page): one spec card per drink on our menu, in menu order, each linking to its page. */
const SECTION_NAME = { 'Specialty Cocktails': 'Specialty', 'BRG Staples': 'BRG staple', Martinis: 'Martini', 'Spiritless & Bubbles': 'Spiritless' };
function signatureCards(page, house) {
  const row = find(page.main, startsWith('Carousel · '));
  if (!row || !house.length) return;
  const cards = row.c.filter(startsWith('Spec · '));
  const filler = find(row, byName('Glass filler'));
  const proto = cards[0];
  // Drinks with a photo lead; the rest follow in menu order.
  const lead = [...house.filter((e) => e.data.photo), ...house.filter((e) => !e.data.photo)];
  row.c = lead.map((e) => {
    const d = e.data;
    const card = clone(proto);
    card.n = 'Spec · ' + d.name; card.to = '/' + e.slug;
    const im = find(card, startsWith('IMG/'));
    if (im && d.photo) { im.f = img(d.photo); im.n = 'IMG/' + d.name; }
    else if (im && filler) Object.assign(im, glassFiller(filler, d.glass), { sh: im.sh, sv: im.sv });
    const pill = find(card, startsWith('Pill · '));
    const pillText = [SECTION_NAME[d.menuSection] || 'On the menu', d.price && '$' + d.price].filter(Boolean).join(' · ');
    if (pill) { pill.n = 'Pill · ' + pillText; setText(texts(pill)[0], pillText); }
    const name = find(card, byName('Name'));
    const nt = texts(name);
    setText(nt[0], d.tagline || (SECTION_NAME[d.menuSection] ? SECTION_NAME[d.menuSection] + (d.menuSection === 'Martinis' ? '' : ' cocktail') : 'Our signature'));
    setText(nt[1], (d.name || '').toUpperCase());
    // Long names and ingredients wrap inside the card instead of being cut off.
    const spec = find(card, byName('Spec'));
    const col = spec ? spec.w - (spec.pd ? spec.pd[1] + spec.pd[3] : 0) : name.w;
    name.w = col; name.sh = 'F';
    for (const t of nt) { t.ar = 'H'; t.w = col; t.sh = 'F'; }
    if ((d.name || '').length > 13) nt[1].z = Math.round((nt[1].z || 28) * 0.86); // long names stay on one line
    // Cards stay one size: up to 4 ingredients, then "+ N more" (the card opens the full spec).
    const all = (d.build || []).filter((b) => b && b.ingredient);
    const build = all.length > 4 ? [...all.slice(0, 3), { amount: '', ingredient: `+ ${all.length - 3} more on the full spec`, more: true }] : all;
    repeat(find(card, byName('Build')), startsWith('Line · '), build, (l, b) => {
      l.n = b.more ? 'Line · More' : 'Line · ' + b.ingredient;
      const t = texts(l); setText(t[0], b.amount || ''); setText(t[1], b.ingredient); t[1].ar = 'H'; t[1].sh = 'L';
      if (b.more) { t[1].f = [{ c: '#C49A6C' }]; t[1].fs = 'SemiBold'; t[1].z = Math.min(t[1].z || 15, 14); }
    });
    const det = find(card, byName('Details'));
    for (const [label, v] of [['Glass', d.glass], ['Ice', d.ice], ['Method', d.method], ['Pairs with', d.pairs]]) {
      const r = find(det, byName(label)); if (r) { const t = texts(r)[1]; setText(t, v || (label === 'Pairs with' ? 'Ask the bar' : 'To confirm')); t.ar = 'H'; t.sh = 'L'; r.sh = 'L'; }
    }
    return card;
  });
  const count = find(page.main, byName('Carousel count'));
  if (count) setText(count, `1–2 of ${house.length}`);
}

const parentOf = (root, node) => (root.c || []).includes(node) ? root : (root.c || []).reduce((hit, c) => hit || parentOf(c, node), null);
/** Group headers for the courses with dishes, cloned from the drawn one ("SNACKS & SMALL PLATES  12"). */
function courseGroups(proto, dishes, fill) {
  const out = [];
  for (const course of COURSES) {
    const list = dishes.filter((e) => e.data.course === course);
    if (!list.length) continue;
    const g = clone(proto);
    g.n = 'Group · ' + course.toUpperCase();
    const t = texts(g);
    setText(t[0], course.toUpperCase());
    if (t[1]) setText(t[1], list.length);
    out.push(g, ...list.map(fill));
  }
  return out;
}
const FOOD_GROUPS = new Set(['Group · PASSED BITES', 'Group · PLATES', 'Group · DESSERT']);
function foodMatrix(page, dishes) {
  const table = find(page.main, byName('Matrix table'));
  if (!table) return;
  const rows = table.c.filter(startsWith('Row · '));
  const normal = rows.find((r) => r.n === 'Row · Short Rib') || rows[0];
  const proto = table.c.find(startsWith('Group · '));
  const noPhoto = find(table, byName('Thumb · Photo to come')); // the drawn bowl, for dishes without a photo
  const fill = (e) => {
    const d = e.data;
    const r = clone(normal);
    r.n = 'Row · ' + d.name;
    r.to = '/' + e.slug; // every dish opens its full page
    const im = find(r, startsWith('IMG/'));
    if (im && d.photo) im.f = img(d.photo);
    else if (im && noPhoto) { const p = parentOf(r, im); p.c = p.c.map((c) => (c === im ? clone(noPhoto) : c)); }
    const dish = find(r, byName('Dish'));
    const dt = texts(dish);
    setText(dt[0], d.name); if (dt[1]) setText(dt[1], d.description || 'Chef to add description');
    // Long names wrap instead of being cut off.
    const tr = find(dish, byName('Title row'));
    if (tr) tr.sh = 'L';
    dt[0].sh = 'L'; dt[0].ar = 'H';
    const st = find(r, byName('Station')); if (st) { setText(texts(st)[0], d.station || '—'); if (!d.station) st.n = 'Station · none'; }
    repeat(find(r, byName('Allergens')), startsWith('Pill · '), d.allergens?.length ? d.allergens : ['None listed'], (p, a) => { p.n = 'Pill · ' + a; setText(texts(p)[0], a.toUpperCase()); });
    const pr = find(r, byName('Pairing')); if (pr) { setText(texts(pr)[0], d.pairing || '—'); if (!d.pairing) pr.n = 'Pairing · none'; }
    return r;
  };
  // The drawn course groups (and their rows) give way to the menu's courses; the Bar group stays as drawn.
  const out = [];
  let skip = false, placed = false;
  for (const c of table.c) {
    if (startsWith('Group · ')(c)) {
      skip = FOOD_GROUPS.has(c.n);
      if (skip && !placed) { out.push(...courseGroups(proto, dishes, fill)); placed = true; }
      if (skip) continue;
    } else if (skip && startsWith('Row · ')(c)) continue;
    else if (!startsWith('Row · ')(c)) skip = false;
    out.push(c);
  }
  table.c = out;
}

/** Two-column bodies even out their columns in the browser (see Balanced in FigmaNode). */
function balance(page) {
  if (!page) return page;
  for (const b of findAll(page.main, (n) => n.n === 'Body' && n.lm === 'H' && (n.c || []).length === 2 && n.c.every((c) => c.lm === 'V'))) b.bal = 1;
  return page;
}

/** The tick drawn in Figma (Food Matrix filters), reused by every checkbox. */
let tick;
const tickIcon = () => (tick ??= find(find(basePage('13-2')?.main || {}, (n) => n.n === 'Checkbox' && (n.c || []).length) || {}, (n) => n.t === 'S') || null);

export function assemble(db, file) {
  const entry = /^e\d+$/.test(file) ? getEntry(db, Number(file.slice(1))) : null;
  // A page from another store's entries doesn't exist here (shared collections are everyone's).
  if (entry && !SHARED.has(entry.collection) && entry.storeId !== SCOPE.store) return null;
  if (entry?.archivedAt) return null; // archived: out of the book until restored
  const page = assembleRaw(db, file);
  if (page?.empty) return page;
  if (page) wire(page, { entry, icon: tickIcon(), recipes: ordered(db, 'recipe'), house: ordered(db, 'house'), wines: ordered(db, 'wine') });
  return balance(forViewer(page, SCOPE.user));
}

function assembleRaw(db, file) {
  if (/^e\d+$/.test(file)) {
    const e = getEntry(db, Number(file.slice(1)));
    return e ? entryPage(db, e) : null;
  }
  const page = basePage(file);
  if (!page) return null;
  const slug = baseIndex().find((x) => x.file === file)?.slug ?? '';
  if (isGeneric()) return genericPage(db, file, slug, page);
  if (file === '23-2') {
    const SITES = { 'Restaurant · J.Baldwin’s': 'https://www.jbaldwins.com', 'Restaurant · Testa Barra': 'https://www.testabarra.com', 'Restaurant · The Baldwin': 'https://thebaldwinshelby.com' };
    for (const [n, url] of Object.entries(SITES)) { const card = find(page.main, byName(n)); if (card) card.to = url; }
  }
  linkDishPairs(page, ordered(db, 'recipe'));
  if (file === '4-2') fillHome(db, page, { store: SCOPE.row, user: SCOPE.user, recipes: ordered(db, 'recipe'), house: ordered(db, 'house'), wines: ordered(db, 'wine'), bowl: bowlSvg() });
  if (file === '14-2') { classicTable(page, ordered(db, 'classic')); houseRows(page, ordered(db, 'house')); signatureCards(page, ordered(db, 'house')); }
  if (file === '13-2') foodMatrix(page, ordered(db, 'recipe'));
  if (file === '17-2') allergenGrid(page, ordered(db, 'recipe'));
  const entry = baseIndex().find((x) => x.file === file);
  if (entry && wineKind(entry.slug)) learnMore(page, entry, wineVideos(db).get(entry.slug), basePage);
  if (file === '25-2') wineCards(page, wineVideos(db));
  if (entry && entry.slug.startsWith('spirit/')) fillShelf(page, entry.slug, baseIndex(), ordered(db, 'shelf'), basePage);
  if (file === '25-2') fillWinePage(page, ordered(db, 'wine'), basePage);
  if (entry && wineKind(entry.slug)) fillWineShelf(page, entry.slug, entry.title, ordered(db, 'wine'), basePage);
  if (file === '26-2') fillBeerPage(page, baseIndex(), ordered(db, 'beer'), basePage);
  if (entry && entry.slug.startsWith('beer/')) fillBeerStyle(page, entry.slug, baseIndex(), ordered(db, 'beer'), basePage);
  return page;
}

/** A store without its own designed book: the shared library, its own lists, and empty states for its own pages. */
function genericPage(db, file, slug, page) {
  const kind = classify(slug);
  const recipes = ordered(db, 'recipe'), house = ordered(db, 'house'), wines = ordered(db, 'wine'), shelf = ordered(db, 'shelf'), beers = ordered(db, 'beer');
  if (kind === 'own' || (slug === 'food-matrix' && !recipes.length)) return emptyPage(file, slug, SCOPE.row);
  const statics = snapshotShelves(page);
  if (file === '14-2') { classicTable(page, ordered(db, 'classic')); if (house.length) { houseRows(page, house); signatureCards(page, house); } }
  if (file === '13-2') {
    foodMatrix(page, recipes);
    // Only this store's dishes, and no group left without one.
    const table = find(page.main, byName('Matrix table')), mine = new Set(recipes.map((e) => 'Row · ' + e.data.name));
    if (table) {
      table.c = table.c.filter((c) => !startsWith('Row · ')(c) || mine.has(c.n));
      table.c = table.c.filter((c, i, a) => !startsWith('Group · ')(c) || startsWith('Row · ')(a[i + 1] || {}));
    }
  }
  if (file === '17-2') allergenGrid(page, recipes, true);
  const entry = baseIndex().find((x) => x.file === file);
  if (entry && wineKind(entry.slug)) learnMore(page, entry, wineVideos(db).get(entry.slug), basePage);
  if (entry && entry.slug.startsWith('spirit/') && shelf.length) fillShelf(page, entry.slug, baseIndex(), shelf, basePage);
  if (file === '25-2' && wines.length) fillWinePage(page, wines, basePage);
  if (entry && wineKind(entry.slug) && wines.length) fillWineShelf(page, entry.slug, entry.title, wines, basePage);
  if (file === '26-2' && beers.length) fillBeerPage(page, baseIndex(), beers, basePage);
  if (entry && entry.slug.startsWith('beer/') && beers.length) fillBeerStyle(page, entry.slug, baseIndex(), beers, basePage);
  return genericize(page, slug, { store: SCOPE.row, statics, terms: baldwinNames(db, [...recipes, ...house].map((e) => e.data.name)), has: { house: house.length, wine: wines.length, beer: beers.length } });
}
/** Baldwin's own dish and drink names, so they're written out of the shared pages. */
function baldwinNames(db, ours = []) {
  // A store that names a dish or drink the same as one of Baldwin's keeps its own.
  const mine = new Set(ours);
  const names = ['recipe', 'house'].flatMap((col) => listEntries(db, col, 1).map((e) => e.data.name)).filter((n) => !mine.has(n));
  return baldwinTerms(names, listEntries(db, 'classic').map((e) => e.data.name));
}

/** Search text for the shared library, read from the pages as other stores see them. Rebuilt when Baldwin's names change. */
let lib = { key: null, text: null };
function libraryEntry(db, e) {
  if (classify(e.slug) === 'own') return indexText(e);
  const terms = baldwinNames(db);
  if (lib.key !== terms.source) {
    const text = new Map();
    withStore({ id: -1, name: '', book_ready: 0 }, () => {
      for (const x of baseIndex()) {
        if (classify(x.slug) === 'own') continue;
        const p = assemble(db, x.file);
        if (p?.main) text.set(x.slug, texts(p.main).map((t) => t.s).join(' ').replace(/\s+/g, ' ').slice(0, 1200));
      }
    });
    lib = { key: terms.source, text };
  }
  return { ...e, text: lib.text.get(e.slug) || '', blurb: terms.test(e.blurb || '') ? undefined : e.blurb };
}

/* ---- index: designed pages, minus the ones the CMS now owns, plus every CMS page ---- */
const PREFIXES = Object.values(COLLECTIONS).map((c) => c.prefix);
export function fullIndex(db) {
  const extra = shelfSearchText(baseIndex(), ordered(db, 'shelf'), ordered(db, 'beer'));
  for (const [k, v] of wineSearchText(baseIndex(), ordered(db, 'wine'))) extra.set(k, ((extra.get(k) || '') + ' ' + v).trim());
  const base = baseIndex().filter((e) => !PREFIXES.some((p) => e.slug.startsWith(p)))
    .map((e) => (isGeneric() ? libraryEntry(db, e) : e))
    .map((e) => (extra.has(e.slug) ? { ...e, text: (extra.get(e.slug) + ' ' + (e.text || '')).slice(0, 2400) } : e));
  const entries = [];
  for (const [id, c] of Object.entries(COLLECTIONS)) {
    for (const e of ordered(db, id)) {
      if (c.hasPage && !c.hasPage(e.data)) continue;
      const d = e.data;
      entries.push({
        id: 'e' + e.id, file: 'e' + e.id, slug: e.slug,
        name: `${c.section} · ${d.name}`, title: d.name, section: c.section, nav: c.nav,
        text: [d.tagline, d.description, ...(d.build || []).map((b) => b.ingredient), ...(d.flavors || []), ...(d.allergens || []), d.spiritName, d.story, d.grape, d.region, e.collection === 'wine' ? wineDescription(d) : d.notes, d.pairs].filter(Boolean).join(' ').slice(0, 1200),
        thumb: d.photo || d.bottle_img || undefined, blurb: d.description || d.tagline || (e.collection === 'wine' ? wineDescription(d) : d.notes) || undefined,
      });
    }
  }
  return [...base, ...entries];
}

/** Sidebar badges, counted from the pages themselves (Food Matrix dishes, videos, photos). */
export function sidebarCounts(db) {
  const file = (slug) => baseIndex().find((x) => x.slug === slug)?.file;
  const count = (slug, pred) => { const f = file(slug); const p = f && assemble(db, f); return p?.main ? findAll(p.main, pred).length : 0; };
  return {
    'Food Matrix': count('food-matrix', (n) => n.meta?.inGroup && n.meta.inGroup !== 'Bar'),
    'Video Library': count('video-library', (n) => (n.n || '').startsWith('Video · ')),
    'Photo Library': count('photo-library', (n) => (n.n || '').startsWith('Photo · ')),
  };
}
