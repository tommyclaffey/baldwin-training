// Assembles a page: either a CMS page (collection template + entry), or a designed page with its lists
// (tables, strips) filled from the CMS.
import fs from 'node:fs';
import path from 'node:path';
import { addRows } from './editinplace.mjs';
import { bindEdits } from './editmode.mjs';
import { chapters, allChapters, levelChapters, chapterBySlug, chapterSlug, chapterPage, guideIndex, progress, markRead, GUIDE, LEVELS, PROGRAMS, chaptersOf, programDef, isProgram, progLevel } from './manual.mjs';
import { certificatesFor } from './certs.mjs';
import { regionPage, regionData } from './region.mjs';
import { lessonPage, level1Page, level2Page, level2OnLevel1, hubPage, barPage, programHub, sectionsDone, lessonSlug, lessonFile, wholeChapterSlug, HUB, L1, L2 } from './study.mjs';
import { passFor } from './quizgen.mjs';
import { clone, cocktailPage, dishPage, photoToCome, find, findAll, byName, startsWith, repeat, setText, texts } from './templates.mjs';
import { classicPage, classicOrder, classicTable } from './classic.mjs';
import { COLLECTIONS, COURSES, SHARED, listEntries, getEntry, wineDescription } from './cms.mjs';
import { classify, emptyPage, baldwinTerms, snapshotShelves, genericize, indexText } from './generic.mjs';
import { wineKind, wineVideos, learnMore, wineCards, wineFollyLink } from './wine.mjs';
import { fillShelf, fillBeerPage, fillBeerStyle, shelfSearchText } from './shelf.mjs';
import { fillBackBar, bottlePage, SPIRIT_FILLER } from './backbar.mjs';
import { fillSpecs, SPECS_PATH } from './specs.mjs';
import { WINE_FILLER } from './winelist.mjs';
import { fillWinePage, fillWineShelf, wineSearchText, wineEntryPage } from './winelist.mjs';
import { wire } from './interact.mjs';
import { libraryVideos } from './videos.mjs';
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
/** A dish's sign-off quiz: its course's built-in quiz. */
const quizFor = (course) => (course ? 't:course:' + course : null);

/* ---- glass cards, taken from the designed classic pages ---- */
let glassCards;
function cards() {
  if (!glassCards) {
    glassCards = [];
    for (const e of baseIndex().filter((x) => x.slug.startsWith('classic/'))) {
      // a classic page has one glass card; "Classic · Glass cards" in Figma holds the extra ones (Julep cup, Hurricane…)
      for (const card of findAll(basePage(e.file).main, byName('The glass'))) {
        const names = (find(card, byName('Art'))?.c || []).map((c) => (c.n || '').replace('Glass · ', '').toLowerCase());
        glassCards.push({ slug: e.slug, title: texts(find(card, byName('Top')))[0]?.s || '', names, card });
      }
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
  if (col === 'classic' && isGeneric()) list = list.map((e) => ({ ...e, data: { ...e.data, menuPrice: '', onMenu: false } }));
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
  if (e.collection === 'classic' && isGeneric()) e = { ...e, data: { ...e.data, menuPrice: '', onMenu: false } };
  if (e.collection === 'classic') return classicPage(tpl, e, { all: ordered(db, 'classic'), glassCard, protos: classicProtos() });
  if (e.collection === 'house') {
    // The strip shows this drink's own menu section (the Drink Book has 58 drinks).
    const signatures = ordered(db, 'house').filter((x) => x.data.menuSection === e.data.menuSection).map((x) => ({ name: x.data.name, slug: x.slug, photo: x.data.photo }));
    return cocktailPage(tpl, e, { signatures, glassCard, glassShape });
  }
  if (e.collection === 'recipe') return dishPage(tpl, { ...e, quiz: quizFor(e.data.course) }, pairingLinks(db));
  if (e.collection === 'shelf') return bottlePage(tpl, e, { shelf: ordered(db, 'shelf'), house: ordered(db, 'house'), index: baseIndex(), basePage });
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
/* Notes to the team that fills the book in ("Bar lead to add our bottle", "confirm with chef", "Sample spec"). Managers see
 * them; staff don't (Nov 8, Tommy: "Keep adding / to confirm for managers only"). A note is a whole text, or one part of
 * one ("Gin · bar lead to confirm" reads "Gin" to staff). */
const NOTES = [
  /\b(bar lead|lead|chef|managers?)\s+(to|must)\s+(add|confirm|check)\b/i, /\bstill to confirm\b/i, /^to confirm\.?$/i,
  /\bconfirm with (the )?(chef|bar|macomb)/i, /\btap order to confirm\b/i, /\bneed full list from chef\b/i,
  /\b(date|address|locations?|price) to add\b/i, /^address to add$/i,
  /\bsample (data|spec|script|standards|schedule|pour sizes)\b/i, /\bis a sample\b/i, /^sample$/i, /\bfiller spec\b/i,
];
const isNote = (seg) => NOTES.some((r) => r.test(seg.trim()));
/** The text with its note parts taken out: '' when it was all note, null when there was none. */
export function withoutNotes(s) {
  const str = String(s || '');
  const parts = str.split(/(\s·\s|;\s+|\.\s+)/);
  if (!parts.some((p, i) => i % 2 === 0 && isNote(p))) return null;
  let out = '';
  for (let i = 0; i < parts.length; i += 2) if (!isNote(parts[i])) out += parts[i] + (parts[i + 1] || '');
  out = out.trim().replace(/(\s·|;|:|,)$/, '').trim();
  if (out && /[.!?]$/.test(str.trim()) && !/[.!?]$/.test(out)) out += '.';
  return out === str ? null : out;
}
function forViewer(page, user) {
  if (!page?.main) return page;
  // Nov 10 (audit): demo managers don't see the team's working notes either; a prospect only sees the finished book.
  const staff = !user || !MANAGERS.has(user.role) || !!user.demo;
  const words = (n) => (n.t === 'T' ? 1 : (n.c || []).reduce((k, c) => k + words(c), 0));
  // Returns why the node goes, or false. A node that lost an admin link and is left as a bare label (a column heading, a tier
  // name) goes too. Notes: a label whose value was a note goes with it ("GLASS · To confirm"); a box left with no words goes
  // (the dashed "Confirm with chef" chip); a list that only lost a chip stays.
  const prune = (n) => {
    if (!n.c) return false;
    const before = n.c.length;
    n.c = n.c.filter((c) => !(c.to && c.to.startsWith('/admin') && !canOpen(user, c.to)));
    let lost = n.c.length < before, noteText = false, noteKid = false;
    if (staff) n.c = n.c.filter((c) => { if (c.t !== 'T') return true; const s = withoutNotes(c.s); if (s === null) return true; if (s) { setText(c, s); return true; } noteText = true; return false; });
    n.c = n.c.filter((c) => { const why = prune(c); if (why === 'admin') lost = true; if (why === 'note') noteKid = true; return !why; });
    if (n === page.main) return false;
    if (lost && words(n) <= 1) return 'admin';
    if (noteText && words(n) <= 1) return 'note';
    if (noteKid && words(n) === 0) return 'note';
    return false;
  };
  prune(page.main);
  // A story band left with only its headings (its words were a note to the bar lead) goes.
  if (staff) for (const st of findAll(page.main, byName('The story'))) {
    const copy = find(st, byName('Copy'));
    if (copy && !find(st, (x) => x.vid) && texts(copy).length <= 2) { const p = parentOf(page.main, st); if (p) p.c = p.c.filter((x) => x !== st); }
  }
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

/** "Classic cocktails" lists on spirit pages: each drink is a row with its photo and an arrow, and opens its page. */
let arrowSvg;
function linkClassicLists(page, classics) {
  arrowSvg ??= (() => { const f = baseIndex().find((x) => x.slug === 'spirit/liqueurs')?.file; const row = f && find(basePage(f).main, startsWith('Sub · ')); return row ? find(row, (n) => n.t === 'S')?.svg : null; })();
  const bySq = new Map(classics.map((e) => [squash(e.data.name), e]));
  for (const card of findAll(page.main, (n) => n.n === 'Classic cocktails' && (n.c || []).some(startsWith('Classic · ')))) {
    card.c = card.c.map((c) => {
      if (!startsWith('Classic · ')(c)) return c;
      const e = bySq.get(squash(c.n.slice(10)));
      if (!e) return c;
      const [name, desc] = texts(c);
      const thumb = { t: 'R', n: 'IMG/' + e.data.name, w: 48, h: 48, sh: 'F', sv: 'F', r: 10, f: e.data.photo ? [{ img: e.data.photo, m: 'FILL' }] : [{ c: '#E7DECF' }] };
      const copy = { t: 'F', n: 'Copy', w: c.w - 90, h: c.h, sh: 'L', sv: 'H', lm: 'V', gap: 3, c: [name, desc].filter(Boolean).map((t) => ({ ...t, sh: 'L', ar: 'H' })) };
      const arrow = arrowSvg ? [{ t: 'S', n: 'icon', w: 18, h: 18, sh: 'F', sv: 'F', svg: arrowSvg }] : [];
      return { ...c, to: '/' + e.slug, lm: 'H', gap: 14, ca: 'C', c: [thumb, copy, ...arrow] };
    });
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
    // The base is the spirit line, never just the first line (Nov 5: "the sugar cube cannot be a base spirit").
    const base = build.find((b) => b.spirit) || (d.base ? { ingredient: d.base } : null);
    const rest = build.filter((b) => b !== base).map((b) => b.ingredient).join(', ');
    [d.name, d.tableLine || rest || d.tagline || '', base ? base.ingredient : '—', d.glass || '—', d.garnish || 'To confirm', d.pairs || 'Ask the bar'] // no ice: Cocktail Specs (Nov 5)
      .forEach((v, i) => t[i] && setText(t[i], v));
    // The design drew garnish as a grey placeholder ("To confirm"); real garnishes read like the other columns.
    if (d.garnish && t[4] && t[3]) t[4].f = t[3].f;
    return r;
  });
  // Our own spiritless drinks replace the zero-proof placeholder row.
  const hasZero = house.some((it) => /^Spiritless/.test(it.data.menuSection || ''));
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
  house = house.filter((e) => e.data.onMenu !== false); // off-menu drinks: in the table, not the carousel
  if (!row || !house.length) return;
  // Nov 5: the amounts moved to Cocktail Specs; the head links there.
  const specLink = find(page.main, byName('Link · Cocktail Specs'));
  if (specLink) specLink.to = SPECS_PATH;
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
    // Cards stay one size: up to 4 ingredients, then "+ N more" (the card opens the drink). No amounts (Nov 5): those are
    // on Cocktail Specs, for the bartenders.
    const all = (d.build || []).filter((b) => b && b.ingredient);
    const build = all.length > 4 ? [...all.slice(0, 3), { ingredient: `+ ${all.length - 3} more`, more: true }] : all;
    repeat(find(card, byName('Build')), startsWith('Line · '), build, (l, b) => {
      l.n = b.more ? 'Line · More' : 'Line · ' + b.ingredient;
      const t = texts(l); setText(t[0], b.ingredient); t[0].ar = 'H'; t[0].sh = 'L';
      if (b.more) { t[0].f = [{ c: '#C49A6C' }]; t[0].fs = 'SemiBold'; t[0].z = Math.min(t[0].z || 15, 14); }
    });
    const det = find(card, byName('Details'));
    for (const [label, v] of [['Glass', d.glass], ['Garnish', d.garnish], ['Pairs with', d.pairs]]) {
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
  if (page) wire(page, { entry, file, slug: baseIndex().find((x) => x.file === file)?.slug, icon: tickIcon(), recipes: ordered(db, 'recipe'), house: ordered(db, 'house'), wines: ordered(db, 'wine'),
    videos: () => libraryVideos({ recipes: ordered(db, 'recipe'), house: ordered(db, 'house'), classics: ordered(db, 'classic'), db }) });
  // Managers get an Add row after every list of dishes, cocktails, wines and bottles (staff never see them).
  if (page && !entry && canOpen(SCOPE.user, '/admin/pages/recipe/new')) addRows(page, baseIndex().find((x) => x.file === file)?.slug, db, SCOPE.store);
  // Edit Mode (Nov 11): what this person can change in place on the page (nothing, for staff).
  if (page && canOpen(SCOPE.user, '/admin')) bindEdits(db, page, { entry, slug: baseIndex().find((x) => x.file === file)?.slug, title: baseIndex().find((x) => x.file === file)?.title,
    tpl: entry && COLLECTIONS[entry.collection]?.template ? basePage(COLLECTIONS[entry.collection].template) : null,
    can: (col, id) => canOpen(SCOPE.user, `/admin/pages/${col}/${id || 'new'}`), lists: { beer: () => ordered(db, 'beer') } });
  return balance(forViewer(page, SCOPE.user));
}

/** Where the signed-in person stands on a level's final and practical (Nov 8). */
function levelStatus(db, file) {
  const L = LEVELS.find((x) => x.file === file); const uid = SCOPE.user?.id;
  if (!L || !uid) return { passedAt: null, practical: null };
  const passed = db.prepare('SELECT score, total, at FROM quiz_attempts WHERE user_id = ? AND quiz = ? ORDER BY at').all(uid, 't:' + L.final).find((r) => r.score >= passFor(r.total));
  const pr = L.practical ? db.prepare('SELECT s.at, u.name by_name FROM signoffs s LEFT JOIN users u ON u.id = s.by_user WHERE s.device = ? AND s.quiz = ? AND s.store_id = ?').get('u' + uid, L.practical, SCOPE.store) : null;
  return { passedAt: passed?.at || null, practical: pr ? { at: pr.at, by: pr.by_name } : null };
}
function assembleRaw(db, file) {
  // Study Guide chapters: drawn from the France chapter's design (Figma 362:2), one per content/manual/<slug>.json
  if (/^m-/.test(file)) {
    const ch = chapterBySlug(file.slice(2)); const tpl = basePage('362-2');
    if (!ch || !tpl) return null;
    if (SCOPE.user) markRead(db, SCOPE.user.id, ch.slug);
    return chapterPage(tpl, ch, { all: levelChapters(ch), prog: progress(db, SCOPE.user?.id, SCOPE.store), slugs: new Set(baseIndex().map((x) => x.slug)) });
  }
  // The Cocktail Program (Nov 8): a course page per level, drawn from the Sommelier Level 1 page (Figma 392:31)
  // Program hubs (Nov 8): drawn from the Sommelier Program hub (Figma 391:32)
  const hubOf = PROGRAMS.find((p) => file === p.key + '-hub' && chaptersOf(p.key).length);
  if (hubOf) {
    const tpl = basePage('391-32'); if (!tpl) return null;
    const certified = new Set(SCOPE.user ? certificatesFor(db, SCOPE.user, SCOPE.store, null).map((c) => c.key) : []);
    return programHub({ ...tpl, name: hubOf.name }, { program: hubOf.key, done: sectionsDone(db, SCOPE.user?.id), certified });
  }
  const bl = LEVELS.find((x) => x.file === file && chaptersOf(x.program, x.level).length);
  if (bl) {
    const tpl = basePage('392-31'); if (!tpl) return null;
    const uid = SCOPE.user?.id;
    const passed = uid && db.prepare('SELECT score, total, at FROM quiz_attempts WHERE user_id = ? AND quiz = ? ORDER BY at').all(uid, 't:' + bl.final).find((r) => r.score >= passFor(r.total));
    const practical = uid && bl.practical ? db.prepare('SELECT s.at, u.name by_name FROM signoffs s LEFT JOIN users u ON u.id = s.by_user WHERE s.device = ? AND s.quiz = ? AND s.store_id = ?').get('u' + uid, bl.practical, SCOPE.store) : null;
    return barPage({ ...tpl, name: `${programDef(bl.program).name} · Level ${bl.level}` }, { L: bl, level: bl.level, done: sectionsDone(db, uid), passedAt: passed?.at || null, practical: practical ? { at: practical.at, by: practical.by_name } : null });
  }
  // v3 lessons (Nov 1): one per chapter section, drawn from Figma 403:45
  const lm = /^l-(.+)~(\d+)$/.exec(file);
  if (lm) {
    const ch = chapterBySlug(lm[1]); const i = Number(lm[2]); const tpl = basePage('403-45'); const chTpl = basePage('362-2');
    if (!ch || !tpl || !chTpl || !ch.sections[i]) return null;
    if (SCOPE.user) markRead(db, SCOPE.user.id, ch.slug);
    return lessonPage(tpl, chTpl, ch, i, { done: sectionsDone(db, SCOPE.user?.id) });
  }
  if (/^e\d+$/.test(file)) {
    const e = getEntry(db, Number(file.slice(1)));
    return e ? entryPage(db, e) : null;
  }
  let page = basePage(file);
  if (!page) return null;
  const slug = baseIndex().find((x) => x.file === file)?.slug ?? '';
  // wine regions and countries in the approved layout (Nov 1, Figma 377:2): photo, what they make, style dots, profile
  // REGION_V2: on (Nov 2, research in). REGION_V2=0 switches back to the old layout.
  if (process.env.REGION_V2 !== '0' && regionData(slug) && wineKind(slug)) { const v2 = regionPage(basePage(regionData(slug).isGrape ? '111-4' : '377-2'), page, slug, { video: wineVideos(db).get(slug) }); if (v2) page = v2; }
  // the Sommelier Program, video first (Nov 1): the Study Guide index is now the Level 1 course
  if (slug === HUB) return hubPage(page, { done: sectionsDone(db, SCOPE.user?.id), demo: !!SCOPE.user?.demo });
  if (slug === L1) return level1Page(page, { done: sectionsDone(db, SCOPE.user?.id), ...levelStatus(db, 'somm-1') });
  if (slug === GUIDE) { const l1 = baseIndex().find((x) => x.slug === L1); const p1 = l1 && basePage(l1.file); if (p1) return level1Page(p1, { done: sectionsDone(db, SCOPE.user?.id), ...levelStatus(db, 'somm-1') }); return guideIndex(page, { prog: progress(db, SCOPE.user?.id, SCOPE.store) }); }
  if (slug === L2) {
    const l1 = baseIndex().find((x) => x.slug === L1); const p1 = l1 && basePage(l1.file); const done = sectionsDone(db, SCOPE.user?.id);
    const old = level2Page(page, { done, course: p1 && find(p1.main, byName('The course')) });
    // Nov 8: Level 2 on the Level 1 layout, like the Cocktail and Beer levels (Tommy: "Yes")
    const p2 = l1 && basePage(l1.file);
    return p2 ? { ...level2OnLevel1(p2, old, { done, ...levelStatus(db, 'somm-2') }), name: page.name } : old;
  }
  if (isGeneric()) return genericPage(db, file, slug, page);
  if (file === '23-2') {
    const SITES = { 'Restaurant · J.Baldwin’s': 'https://www.jbaldwins.com', 'Restaurant · Testa Barra': 'https://www.testabarra.com', 'Restaurant · The Baldwin': 'https://thebaldwinshelby.com' };
    for (const [n, url] of Object.entries(SITES)) { const card = find(page.main, byName(n)); if (card) card.to = url; }
  }
  linkDishPairs(page, ordered(db, 'recipe'));
  linkClassicLists(page, ordered(db, 'classic'));
  if (file === '4-2') fillHome(db, page, { store: SCOPE.row, user: SCOPE.user, recipes: ordered(db, 'recipe'), house: ordered(db, 'house'), wines: ordered(db, 'wine'), bowl: bowlSvg() });
  if (file === '14-2') { classicTable(page, ordered(db, 'classic')); houseRows(page, ordered(db, 'house')); signatureCards(page, ordered(db, 'house')); }
  if (file === '13-2') foodMatrix(page, ordered(db, 'recipe'));
  if (file === '17-2') allergenGrid(page, ordered(db, 'recipe'));
  const entry = baseIndex().find((x) => x.file === file);
  if (entry && wineKind(entry.slug)) { if (!page.v2) learnMore(page, entry, wineVideos(db).get(entry.slug), basePage); wineFollyLink(page, entry.slug, basePage); }
  if (file === '25-2') wineCards(page, wineVideos(db));
  if (entry && entry.slug.startsWith('spirit/')) fillShelf(page, entry.slug, baseIndex(), ordered(db, 'shelf'), basePage);
  if (file === '25-2') fillWinePage(page, ordered(db, 'wine'), basePage);
  if (entry && wineKind(entry.slug)) fillWineShelf(page, entry.slug, entry.title, ordered(db, 'wine'), basePage);
  if (file === '26-2') fillBeerPage(page, baseIndex(), ordered(db, 'beer'), basePage);
  if (entry && entry.slug.startsWith('beer/')) fillBeerStyle(page, entry.slug, baseIndex(), ordered(db, 'beer'), basePage);
  if (file === '294-2') fillBackBar(page, ordered(db, 'shelf'), ordered(db, 'house'));
  if (file === '430-17') fillSpecs(page, ordered(db, 'house'), ordered(db, 'classic'));
  return page;
}

/** A store without its own designed book: the shared library, its own lists, and empty states for its own pages. */
function genericPage(db, file, slug, page) {
  const kind = classify(slug);
  const recipes = ordered(db, 'recipe'), house = ordered(db, 'house'), wines = ordered(db, 'wine'), shelf = ordered(db, 'shelf'), beers = ordered(db, 'beer');
  if (kind === 'own' || (slug === 'food-matrix' && !recipes.length) || (slug === 'the-bar/back-bar' && !shelf.length)) return emptyPage(file, slug, SCOPE.row);
  const statics = snapshotShelves(page);
  if (file === '14-2') { classicTable(page, ordered(db, 'classic')); if (house.length) { houseRows(page, house); signatureCards(page, house); } }
  linkClassicLists(page, ordered(db, 'classic'));
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
  if (entry && wineKind(entry.slug)) { learnMore(page, entry, wineVideos(db).get(entry.slug), basePage); wineFollyLink(page, entry.slug, basePage); }
  if (entry && entry.slug.startsWith('spirit/') && shelf.length) fillShelf(page, entry.slug, baseIndex(), shelf, basePage);
  if (file === '25-2' && wines.length) fillWinePage(page, wines, basePage);
  if (entry && wineKind(entry.slug) && wines.length) fillWineShelf(page, entry.slug, entry.title, wines, basePage);
  if (file === '26-2' && beers.length) fillBeerPage(page, baseIndex(), beers, basePage);
  if (entry && entry.slug.startsWith('beer/') && beers.length) fillBeerStyle(page, entry.slug, baseIndex(), beers, basePage);
  if (file === '294-2' && shelf.length) fillBackBar(page, shelf, house);
  if (file === '430-17') fillSpecs(page, house, ordered(db, 'classic'));
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
const PREFIXES = [...Object.values(COLLECTIONS).map((c) => c.prefix), GUIDE + '/'];
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
        thumb: d.photo || d.bottle_img || (e.collection === 'wine' ? WINE_FILLER : e.collection === 'shelf' ? SPIRIT_FILLER : undefined), blurb: d.description || d.tagline || (e.collection === 'wine' ? wineDescription(d) : d.notes) || undefined,
      });
    }
  }
  // Study Guide chapters (content/manual), searchable like any page
  // The Cocktail Program (Nov 8): its course page, and its lessons below
  for (const P of PROGRAMS) {
    if (!chaptersOf(P.key).length) continue;
    entries.push({ id: P.key + '-hub', file: P.key + '-hub', slug: P.slug, name: `The Bar · ${P.name}`, title: P.name, section: 'The Bar', nav: P.name,
      text: `${P.name} levels certificates ${P.ladder.join(' ')}`, blurb: `${P.name}: every level, its final and its certificate.` });
  }
  for (const L of LEVELS) {
    const P = programDef(L.program); const chs = chaptersOf(L.program, L.level); const n = chs.length;
    if (!n) continue;
    entries.push({ id: L.file, file: L.file, slug: L.slug, name: `The Bar · ${P.name} · Level ${L.level}`, title: `${P.name} · Level ${L.level}`, section: 'The Bar', nav: P.name,
      text: `${P.name} Level ${L.level} ${L.title} lessons final exam ${chs.map((c) => c.title).join(' ')}`,
      blurb: `Level ${L.level}: ${L.title}. ${n} lessons, then a ${L.len}-question final${L.practical ? ' and a practical' : ''}.` });
  }
  for (const ch of allChapters()) {
    const bar = isProgram(ch); const PN = bar && programDef(ch.program).name;
    if (!bar) entries.push({ id: 'm-' + ch.slug, file: 'm-' + ch.slug, slug: wholeChapterSlug(ch), name: (ch.level === 2 ? 'Level 2 · ' : 'Study Guide · ') + ch.title + ' · Whole Chapter', title: ch.title, section: ch.level === 2 ? 'Level 2' : 'Study Guide', nav: 'Sommelier Program',
      text: [ch.lead, ...ch.sections.flatMap((x) => [x.name, ...(x.know || []), ...(x.chips?.items || [])])].filter(Boolean).join(' ').slice(0, 1200), blurb: ch.lead });
    // one lesson per section (the first one is the chapter's own address)
    ch.sections.forEach((sec, i) => {
      const v = (ch.v3?.sections || []).find((x) => x.name === sec.name) || {};
      entries.push({ id: lessonFile(ch, i), file: lessonFile(ch, i), slug: lessonSlug(ch, i), name: `${bar ? `${PN} L${progLevel(ch)}` : ch.level === 2 ? 'Level 2' : 'Study Guide'} · ${ch.title} · ${sec.name}`, title: i === 0 ? ch.title : sec.name, section: bar ? PN : ch.level === 2 ? 'Level 2' : 'Study Guide', nav: bar ? PN : 'Sommelier Program',
        text: [sec.name, v.read?.bigIdea, v.read?.where, ...(v.read?.stops || []).map((x) => x.name + ' ' + x.text), ...(v.keyPoints || []).map((k) => k.big + ' ' + k.line)].filter(Boolean).join(' ').replace(/\*\*/g, '').slice(0, 1200),
        thumb: v.video?.youtubeId ? `https://i.ytimg.com/vi/${v.video.youtubeId}/mqdefault.jpg` : undefined, blurb: v.read?.bigIdea || ch.lead });
    });
  }
  // The Video Library is searched by the videos it really has (the design's sample titles were made up).
  const vids = libraryVideos({ recipes: ordered(db, 'recipe'), house: ordered(db, 'house'), classics: ordered(db, 'classic'), db });
  const lib = base.find((e) => e.slug === 'video-library');
  if (lib) lib.text = ['Video Library', ...vids.map((v) => `${v.title} ${v.by}`)].join(' ').slice(0, 2400);
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
