// Assembles a page: either a CMS page (collection template + entry), or a designed page with its lists
// (tables, strips) filled from the CMS.
import fs from 'node:fs';
import path from 'node:path';
import { clone, cocktailPage, dishPage, find, byName, startsWith, repeat, setText, texts } from './templates.mjs';
import { classicPage, classicOrder, classicTable } from './classic.mjs';
import { COLLECTIONS, listEntries, getEntry } from './cms.mjs';
import { BANK } from './quiz.mjs';
import { wineKind, wineVideos, learnMore, wineCards } from './wine.mjs';

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
  return g.values.flatMap((v) => list.filter((e) => e.data[g.key] === v));
}

/** A CMS page, or null if it has no page (e.g. a dish that only lives in the Food Matrix). */
function entryPage(db, e) {
  const c = COLLECTIONS[e.collection];
  if (c.hasPage && !c.hasPage(e.data)) return null;
  const tpl = basePage(c.template);
  if (e.collection === 'classic') return classicPage(tpl, e, { all: ordered(db, 'classic'), glassCard, protos: classicProtos() });
  if (e.collection === 'house') {
    const signatures = ordered(db, 'house').map((x) => ({ name: x.data.name, slug: x.slug, photo: x.data.photo }));
    return cocktailPage(tpl, e, { signatures, glassCard });
  }
  if (e.collection === 'recipe') return dishPage(tpl, { ...e, quiz: quizFor(e.data.name) });
  return null;
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
    [d.name, d.tableLine || rest || d.tagline || '', base ? base.ingredient : '—', d.glass || '—', d.tableIce || d.ice || '—', d.garnish || 'To confirm', d.pairs || 'Ask the bar', d.status || 'New', d.score || '—']
      .forEach((v, i) => t[i] && setText(t[i], v));
    return r;
  });
  const rest = matrix.c.filter((c) => !(startsWith('Row · ')(c)) || c === zero);
  const at = zero ? rest.indexOf(zero) : rest.length - 1;
  matrix.c = [...rest.slice(0, at), ...made, ...rest.slice(at)];
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

export function assemble(db, file) {
  if (/^e\d+$/.test(file)) {
    const e = getEntry(db, Number(file.slice(1)));
    return e ? entryPage(db, e) : null;
  }
  const page = basePage(file);
  if (!page) return null;
  if (file === '14-2') { classicTable(page, ordered(db, 'classic')); houseRows(page, ordered(db, 'house')); }
  if (file === '13-2') foodMatrix(page, ordered(db, 'recipe'));
  const entry = baseIndex().find((x) => x.file === file);
  if (entry && wineKind(entry.slug)) learnMore(page, entry, wineVideos(db).get(entry.slug), basePage);
  if (file === '25-2') wineCards(page, wineVideos(db));
  return page;
}

/* ---- index: designed pages, minus the ones the CMS now owns, plus every CMS page ---- */
const PREFIXES = Object.values(COLLECTIONS).map((c) => c.prefix);
export function fullIndex(db) {
  const base = baseIndex().filter((e) => !PREFIXES.some((p) => e.slug.startsWith(p)));
  const entries = [];
  for (const [id, c] of Object.entries(COLLECTIONS)) {
    for (const e of ordered(db, id)) {
      if (c.hasPage && !c.hasPage(e.data)) continue;
      const d = e.data;
      entries.push({
        id: 'e' + e.id, file: 'e' + e.id, slug: e.slug,
        name: `${c.section} · ${d.name}`, title: d.name, section: c.section, nav: c.nav,
        text: [d.tagline, d.description, ...(d.build || []).map((b) => b.ingredient), ...(d.flavors || []), ...(d.allergens || []), d.spiritName, d.story].filter(Boolean).join(' ').slice(0, 1200),
        thumb: d.photo || undefined, blurb: d.description || d.tagline || undefined,
      });
    }
  }
  return [...base, ...entries];
}
