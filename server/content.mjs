// Assembles a page: either a CMS page (collection template + entry), or a designed page with its lists
// (tables, strips) filled from the CMS.
import fs from 'node:fs';
import path from 'node:path';
import { clone, cocktailPage, dishPage, find, findAll, byName, startsWith, repeat, setText, texts } from './templates.mjs';
import { classicPage, classicOrder, classicTable } from './classic.mjs';
import { COLLECTIONS, listEntries, getEntry } from './cms.mjs';
import { BANK } from './quiz.mjs';
import { wineKind, wineVideos, learnMore, wineCards } from './wine.mjs';
import { fillShelf, fillBeerPage, fillBeerStyle, shelfSearchText } from './shelf.mjs';
import { fillWinePage, fillWineShelf, wineSearchText, wineEntryPage } from './winelist.mjs';
import { wire } from './interact.mjs';

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

export function ordered(db, col) {
  const list = listEntries(db, col);
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
  if (e.collection === 'classic') return classicPage(tpl, e, { all: ordered(db, 'classic'), glassCard, protos: classicProtos() });
  if (e.collection === 'house') {
    const signatures = ordered(db, 'house').map((x) => ({ name: x.data.name, slug: x.slug, photo: x.data.photo }));
    return cocktailPage(tpl, e, { signatures, glassCard });
  }
  if (e.collection === 'recipe') return dishPage(tpl, { ...e, quiz: quizFor(e.data.name) });
  if (e.collection === 'wine') return wineEntryPage(tpl, e, { all: ordered(db, 'wine'), index: baseIndex(), recipes: ordered(db, 'recipe') });
  return null;
}

/** Allergen Guide grid: one row per dish from the Recipes collection, a mark in every column the dish is tagged with. */
const MAJOR = new Set(['Finfish', 'Shellfish', 'Tree Nut', 'Peanut']);
function allergenGrid(page, recipes) {
  const grid = find(page.main, byName('Allergen grid'));
  if (!grid || !recipes.length) return;
  const rows = grid.c.filter(startsWith('Row · '));
  const cells = rows.flatMap((r) => r.c);
  const mark = cells.find((c) => find(c, byName('Contains'))?.f?.[0]?.c === '#1E1C1A');
  const major = cells.find((c) => { const k = find(c, byName('Contains')); return k && k.f?.[0]?.c !== '#1E1C1A'; });
  const none = cells.find((c) => find(c, byName('None')));
  const proto = rows.find((r) => !find(r, startsWith('Pill · '))) || rows[0];
  const groups = grid.c.filter(startsWith('Group · '));
  const head = grid.c.filter((c) => c.n === 'Header');
  const tail = grid.c.filter((c) => c.n === 'Legend' || c.n === 'Definitions');
  const out = [...head];
  for (const g of groups) {
    const course = g.n.slice(8).toLowerCase();
    const list = recipes.filter((e) => String(e.data.course || '').toLowerCase() === course);
    if (!list.length) continue;
    out.push(g);
    for (const e of list) {
      const d = e.data;
      const r = clone(proto);
      r.n = 'Row · ' + d.name;
      if (d.fullPage) r.to = '/' + e.slug;
      const tags = new Set(d.allergens || []);
      r.c = r.c.map((c) => {
        if (c.n === 'Dish') { const t = clone(c); setText(texts(t)[0], d.name); return t; }
        const src = tags.has(c.n) ? (MAJOR.has(c.n) ? major || mark : mark) : none;
        const cell = clone(src || c); cell.n = c.n; cell.w = c.w;
        return cell;
      });
      out.push(r);
    }
  }
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
    if (im) im.f = img(d.photo);
    const t = texts(r);
    const build = (d.build || []).filter((b) => b && b.ingredient);
    const base = build.find((b) => b.spirit) || build[0];
    const rest = build.filter((b) => b !== base).map((b) => b.ingredient).join(', ');
    [d.name, d.tableLine || rest || d.tagline || '', base ? base.ingredient : '—', d.glass || '—', d.tableIce || d.ice || '—', d.garnish || 'To confirm', d.pairs || 'Ask the bar', d.status || (d.menuSection ? 'On the menu' : 'New'), d.score || '—']
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
  if (cap) setText(cap, `${name.toUpperCase()} · PHOTO TO COME`);
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
  const adjusting = cards.find((c) => find(c, byName('Pill · Adjusting'))) || cards[0];
  const keep = cards.find((c) => find(c, byName('Pill · Keep'))) || cards[1] || cards[0];
  // Drinks with a photo lead (they're the ones guests have tasted); the rest follow in menu order.
  const lead = [...house.filter((e) => e.data.photo), ...house.filter((e) => !e.data.photo)];
  row.c = lead.map((e) => {
    const d = e.data;
    const card = clone(d.status === 'Adjusting' ? adjusting : keep);
    card.n = 'Spec · ' + d.name; card.to = '/' + e.slug;
    const im = find(card, startsWith('IMG/'));
    if (im && d.photo) { im.f = img(d.photo); im.n = 'IMG/' + d.name; }
    else if (im && filler) Object.assign(im, glassFiller(filler, d.glass), { sh: im.sh, sv: im.sv });
    const pill = find(card, startsWith('Pill · '));
    const pillText = d.status || [SECTION_NAME[d.menuSection] || 'On the menu', d.price && '$' + d.price].filter(Boolean).join(' · ');
    if (pill) { pill.n = 'Pill · ' + pillText; setText(texts(pill)[0], pillText); }
    const score = find(card, byName('Score'));
    if (score && d.score) setText(texts(score)[0], d.score);
    else if (score) score.c = [{ ...texts(score)[0], s: d.status && d.price ? '$' + d.price : '', n: 'Price' }];
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
    const note = find(card, byName('Tasting note'));
    if (note) setText(texts(note)[0], d.note || d.description || '');
    return card;
  });
  const count = find(page.main, byName('Carousel count'));
  if (count) setText(count, `1–2 of ${house.length}`);
}

const GROUP = { 'Passed Bites': 'Group · PASSED BITES', Plates: 'Group · PLATES', Dessert: 'Group · DESSERT' };
function foodMatrix(page, dishes) {
  const table = find(page.main, byName('Matrix table'));
  if (!table) return;
  const rows = table.c.filter(startsWith('Row · '));
  const normal = rows.find((r) => r.n === 'Row · Short Rib') || rows[0];
  const refining = rows.find((r) => texts(r).some((t) => t.s === 'Being refined'));
  const out = [];
  let skip = false;
  for (const c of table.c) {
    const course = Object.keys(GROUP).find((k) => GROUP[k] === c.n);
    if ((c.n || '').startsWith('Group · ')) skip = !!course;
    if (startsWith('Row · ')(c) && skip) continue;
    out.push(c);
    if (!course) continue;
    const list = dishes.filter((d) => d.data.course === course);
    const count = texts(c)[1];
    if (count) setText(count, list.length);
    for (const e of list) {
      const d = e.data;
      const r = clone(d.refining && refining ? refining : normal);
      r.n = 'Row · ' + d.name;
      r.to = d.fullPage ? '/' + e.slug : undefined;
      const im = find(r, startsWith('IMG/'));
      if (im) im.f = img(d.photo);
      const dish = find(r, byName('Dish'));
      const dt = texts(dish).filter((t) => t.s !== 'Being refined');
      setText(dt[0], d.name); if (dt[1]) setText(dt[1], d.description || 'Chef to add description');
      const st = find(r, byName('Station')); if (st) setText(texts(st)[0], d.station || '—');
      repeat(find(r, byName('Allergens')), startsWith('Pill · '), d.allergens?.length ? d.allergens : ['None listed'], (p, a) => { p.n = 'Pill · ' + a; setText(texts(p)[0], a); });
      const pr = find(r, byName('Pairing')); if (pr) setText(texts(pr)[0], d.pairing || '—');
      const tp = find(r, byName('Tasting')); if (tp) setText(texts(tp)[0], d.score || '—');
      out.push(r);
    }
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
  const page = assembleRaw(db, file);
  if (page) wire(page, { entry, icon: tickIcon(), recipes: ordered(db, 'recipe'), house: ordered(db, 'house'), wines: ordered(db, 'wine') });
  return balance(page);
}

function assembleRaw(db, file) {
  if (/^e\d+$/.test(file)) {
    const e = getEntry(db, Number(file.slice(1)));
    return e ? entryPage(db, e) : null;
  }
  const page = basePage(file);
  if (!page) return null;
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

/* ---- index: designed pages, minus the ones the CMS now owns, plus every CMS page ---- */
const PREFIXES = Object.values(COLLECTIONS).map((c) => c.prefix);
export function fullIndex(db) {
  const extra = shelfSearchText(baseIndex(), ordered(db, 'shelf'), ordered(db, 'beer'));
  for (const [k, v] of wineSearchText(baseIndex(), ordered(db, 'wine'))) extra.set(k, ((extra.get(k) || '') + ' ' + v).trim());
  const base = baseIndex().filter((e) => !PREFIXES.some((p) => e.slug.startsWith(p))).map((e) => (extra.has(e.slug) ? { ...e, text: (extra.get(e.slug) + ' ' + (e.text || '')).slice(0, 2400) } : e));
  const entries = [];
  for (const [id, c] of Object.entries(COLLECTIONS)) {
    for (const e of ordered(db, id)) {
      if (c.hasPage && !c.hasPage(e.data)) continue;
      const d = e.data;
      entries.push({
        id: 'e' + e.id, file: 'e' + e.id, slug: e.slug,
        name: `${c.section} · ${d.name}`, title: d.name, section: c.section, nav: c.nav,
        text: [d.tagline, d.description, ...(d.build || []).map((b) => b.ingredient), ...(d.flavors || []), ...(d.allergens || []), d.spiritName, d.story, d.grape, d.region, d.notes, d.pairs].filter(Boolean).join(' ').slice(0, 1200),
        thumb: d.photo || d.bottle_img || undefined, blurb: d.description || d.tagline || d.notes || undefined,
      });
    }
  }
  return [...base, ...entries];
}

/** Sidebar badges, counted from the pages themselves (Food Matrix dishes, videos, photos). */
export function sidebarCounts(db) {
  const file = (slug) => baseIndex().find((x) => x.slug === slug)?.file;
  const count = (slug, pred) => { const f = file(slug); const p = f && assemble(db, f); return p ? findAll(p.main, pred).length : 0; };
  return {
    'Food Matrix': count('food-matrix', (n) => n.meta?.inGroup),
    'Video Library': count('video-library', (n) => (n.n || '').startsWith('Video · ')),
    'Photo Library': count('photo-library', (n) => (n.n || '').startsWith('Photo · ')),
  };
}
