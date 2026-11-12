// Edit Mode (Nov 11, Figma 09 · Proposals → 24: 533:274). Tommy, Nov 10: "I want the adding editing and stuff to feel
// more front end interaction verse a backend matrix."
// For someone who can edit a page, this marks what on it can be changed in place. The browser draws those parts as fields
// while Edit Mode is on (src/edit/), and saves them with PATCH /api/entries/:id, the same records the admin forms write.
//   node.ed  = { e: entry id, k: field (or a path into a list: "steps.0.title"), v: the saved value, ...how to draw it }
//   node.edc = 1   a card that holds editable parts (drawn with a dashed copper edge)
//   node.eo  = 1   only shown in Edit Mode (an empty card or tag, so there's somewhere to type)
//   page.edit = { main: entry id | null, title, entries: { id: { col, name, kind, shared?, local? } } }
// Staff never get any of it: it's only added for people who can open that entry's admin form (canOpen).
import { COLLECTIONS, ALLERGENS, LOCAL_KEYS, sharedWith } from './cms.mjs';
import { find, findAll, byName, startsWith, texts, clone } from './templates.mjs';

const KIND = { recipe: 'Dish', house: 'House cocktail', classic: 'Classic cocktail', wine: 'Wine', shelf: 'Bottle', beer: 'Beer' };
const options = (col, key) => COLLECTIONS[col]?.fields.find((f) => f.key === key)?.options || [];

/** The value at a path ("steps.0.title") in an entry's data. */
export function valueAt(d, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
}
/** The field's top-level key: "steps.0.title" → "steps". */
export const topKey = (path) => String(path).split('.')[0];

const kids = (n) => (n?.c || []).filter((c) => c.t === 'T');
function bind(node, e, k, opts = {}) {
  if (!node) return null;
  const v = valueAt(e.data, k);
  node.ed = { e: e.id, k, v: v == null ? '' : v, ...opts };
  return node;
}
const card = (n) => { if (n) n.edc = 1; return n; };

/** Puts a card the page left out (nothing in it yet) back in, from the template, for Edit Mode only. */
function restore(main, tpl, name, under) {
  if (find(main, byName(name))) return find(main, byName(name));
  const src = find(tpl.main, byName(name));
  const home = src && find(tpl.main, (n) => (n.c || []).includes(src));
  const parent = home && find(main, (n) => n.n === home.n && n.lm === home.lm && (!under || n.n === under));
  if (!src || !parent) return null;
  const c = clone(src);
  c.eo = 1;
  const at = Math.min(home.c.indexOf(src), (parent.c || []).length);
  parent.c = [...(parent.c || []).slice(0, at), c, ...(parent.c || []).slice(at)];
  return c;
}
/** A placeholder text: blank until typed in, so Edit Mode shows the hint. */
const blank = (t) => { if (t) { t.s = ''; delete t.segs; } return t; };

/* ------------------------------ cocktails ------------------------------ */
function bindCocktail(page, e, tpl, classic) {
  const main = page.main, d = e.data;
  const hero = find(main, byName('Hero'));
  const photo = hero && find(hero, startsWith('IMG/'));
  if (photo) photo.ed = { e: e.id, k: 'photo', t: 'photo', v: d.photo || '' };
  const copy = hero && find(hero, byName('Copy'));
  const ct = kids(copy);
  bind(ct[0], e, 'tagline', { ph: classic ? 'A line under the name' : 'Our signature cocktail' });
  bind(ct[1], e, 'name', { u: 1, req: 1 });
  bind(ct[2], e, 'description', { m: 1, ph: 'What’s in it, in a sentence' });
  // The menu price sits in the pill after the menu section ("Specialty cocktail · $15"): it gets a field of its own.
  const pill = !classic && copy && find(copy, byName('Pill · Signature'));
  if (pill && d.menuSection) {
    const t = texts(pill)[0];
    const label = t.s.replace(/\s·\s\$.*$/, '');
    const price = clone(t);
    const sep = clone(t);
    t.s = label; sep.s = '\u00A0·\u00A0'; delete sep.ed; // no-break spaces: phones collapse the spaces at a text's ends
    bind(price, e, 'price', { pre: '$', ph: 'Price', n: 1 });
    price.s = d.price ? '$' + d.price : '';
    if (!d.price) { sep.eo = 1; price.eo = 1; }
    pill.gap = 0;
    pill.c = [...pill.c.filter((x) => x !== t), t, sep, price];
  }
  const stats = copy && find(copy, byName('Stats'));
  for (const [label, key] of [['Glass', 'glass'], ['Garnish', 'garnish']]) {
    const cell = stats && find(stats, byName(label));
    if (cell) bind(texts(cell)[1], e, key, { ph: label === 'Glass' ? 'Glass' : 'Garnish' });
  }
  // The spec: an inline editor of the build, method, glass and garnish (the card links to Cocktail Specs otherwise).
  const spec = find(main, byName('The spec'));
  if (spec) {
    spec.ed = { e: e.id, k: 'build', t: 'spec', v: { build: d.build || [], method: d.method || '', glass: d.glass || '', garnish: d.garnish || '' }, glasses: options(e.collection, 'glass'), past: classic };
    card(spec);
  }
  // Taste: words as pills, then the line.
  const taste = restore(main, tpl, 'Taste');
  if (taste) {
    card(taste);
    const flav = find(taste, byName('Flavors'));
    if (flav) {
      flav.ed = { e: e.id, k: classic ? 'flavors' : 'tags', t: 'tags', v: (classic ? d.flavors : d.tags) || [] };
      if (taste.eo) flav.c = (flav.c || []).slice(0, 1);
    }
    const tl = kids(taste);
    const line = tl[tl.length - 1];
    if (taste.eo) blank(line);
    bind(line, e, 'tasteLine', { m: 1, ph: 'How it tastes, in a sentence' });
  }
  // The spirit
  const fs = restore(main, tpl, 'Featured spirit');
  if (fs) {
    card(fs);
    const t = kids(fs);
    if (fs.eo) { blank(t[1]); blank(t[2]); fs.c = fs.c.filter((c) => c.n !== 'Button · Learn spirit' && c.n !== 'Our pour'); }
    bind(t[1], e, 'spiritName', { ph: 'The spirit' });
    bind(t[2], e, 'spiritLine', { m: 1, ph: 'Why this spirit' });
    const pour = find(fs, byName('Our pour'));
    if (classic && pour) bind(texts(pour)[1], e, 'pour', { ph: 'Our bottle' });
  }
  // Say it at the table
  const say = restore(main, tpl, 'Say it');
  if (say) {
    card(say);
    const t = texts(say);
    if (say.eo) blank(t[1]);
    bind(t[1], e, 'say', { m: 1, ph: 'What you say at the table' });
  }
  // The story
  const story = find(main, byName('The story'));
  const sc = story && kids(find(story, byName('Copy')));
  if (sc?.length) { card(story); bind(sc[sc.length - 1], e, 'story', { m: 1, ph: classic ? 'Where it came from' : 'Who created it and the idea behind it' }); }
}

/* ------------------------------ dishes ------------------------------ */
function bindDish(page, e) {
  const main = page.main, d = e.data;
  const header = find(main, byName('Header'));
  if (!header) return;
  const photo = find(header, startsWith('IMG/'));
  if (photo) photo.ed = { e: e.id, k: 'photo', t: 'photo', v: d.photo || '' };
  // Tags: course, station, price. Station and price are fields; when empty, Edit Mode shows a blank tag to fill.
  const tags = find(header, byName('Tags'));
  const proto = tags && (tags.c || []).find(startsWith('Tag · '));
  if (tags && proto) {
    const tag = (key, shown, opts) => {
      let t = shown ? (tags.c || []).find((c) => c.n === 'Tag · ' + shown) : null;
      if (!t) { t = clone(proto); t.n = 'Tag · ' + key; t.eo = 1; blank(texts(t)[0]); const sig = tags.c.findIndex((c) => c.n === 'Tag · Signature'); tags.c.splice(sig < 0 ? tags.c.length : sig, 0, t); }
      bind(texts(t)[0], e, key, opts);
    };
    tag('station', d.station ? `${d.station} Station` : null, { suf: ' Station', ph: 'Station' });
    tag('price', d.price ? `$${d.price}` : null, { pre: '$', ph: 'Price', n: 1 });
  }
  const titles = find(header, byName('Titles'));
  const tt = texts(titles);
  bind(tt[0], e, 'tagline', { ph: 'Line above the name' });
  bind(tt[1], e, 'name', { u: 1, req: 1 });
  const info = find(header, byName('Info'));
  bind((info?.c || []).find((c) => c.t === 'T'), e, 'description', { m: 1, ph: 'One or two lines about the dish' });
  bind(find(header, byName('Ingredient list')), e, 'ingredients', { t: 'list', sep: ' · ', ph: 'Ingredients, separated by commas' });
  const allergens = find(header, byName('Allergens'));
  if (allergens) allergens.ed = { e: e.id, k: 'allergens', t: 'chips', v: d.allergens || [], opts: ALLERGENS };

  // At the table
  const sell = find(main, byName('Selling line'));
  if (sell) { card(sell); bind(find(sell, byName('Line')), e, 'sellingLine', { m: 1, ph: 'What you say to sell the dish' }); }
  const drop = find(main, byName('Drop band'));
  if (drop) {
    card(drop);
    for (const [n, k] of [['Drop · Main', 'dropMain'], ['Drop · Side', 'dropSide'], ['Drop · Sauce', 'dropSauce']]) {
      const tile = find(drop, byName(n));
      if (tile) bind(texts(tile)[1], e, k, { ph: 'To come' });
    }
    bind(find(drop, byName('Say it')), e, 'say', { m: 1, ph: 'The drop as one sentence' });
  }
  const tp = find(main, byName('Talking points'));
  if (tp) {
    card(tp);
    findAll(tp, startsWith('Point ')).forEach((row, i) => bind(texts(row)[1], e, `talkingPoints.${i}`, { m: 1, ph: 'A short line a server can say' }));
  }
  // The build: components and steps, cell by cell.
  const build = find(main, byName('The Build'));
  if (build) {
    card(build);
    const comps = find(build, byName('Components'));
    (comps?.c || []).filter(startsWith('Row · ')).forEach((row, i) => {
      const t = texts(row);
      ['component', 'portion', 'hold'].forEach((k, j) => bind(t[j], e, `components.${i}.${k}`, { ph: j ? '—' : 'Component' }));
    });
    findAll(build, (n) => /^Step \d+$/.test(n.n || '')).forEach((row, i) => {
      const copy = find(row, byName('Copy'));
      const t = texts(copy);
      bind(t[0], e, `steps.${i}.title`, { ph: 'Step' });
      bind(t[1], e, `steps.${i}.detail`, { m: 1, ph: 'What to do' });
      const time = find(row, byName('Time'));
      if (time) bind(texts(time)[0], e, `steps.${i}.time`, { ph: 'Time' });
    });
  }
  const story = find(main, (n) => n.n === 'The story' && !!find(n, byName('Inspiration')));
  if (story) {
    card(story);
    bind(find(story, byName('Inspiration')), e, 'inspiration', { m: 1, ph: 'Where the dish comes from' });
    findAll(story, startsWith('Point ')).forEach((row, i) => bind(texts(row)[0], e, `sellingPoints.${i}`, { m: 1, ph: 'What makes it worth ordering' }));
  }
}

/* ------------------------------ wine and the back bar ------------------------------ */
function bindWine(page, e) {
  const main = page.main, d = e.data;
  const bottle = find(main, startsWith('IMG/Bottle'));
  if (bottle && !bottle.meta?.spin) bottle.ed = { e: e.id, k: 'bottle_img', t: 'photo', v: d.bottle_img || '', fit: 1 };
  bind(find(main, byName('Title')), e, 'name', { u: 1, req: 1 });
  const origin = find(main, byName('Origin'));
  for (const [n, k] of [['Varietal', 'grape'], ['Region', 'region']]) { const c = origin && find(origin, byName(n)); if (c) bind(texts(c)[1], e, k, { ph: n }); }
  const stats = find(main, byName('Stats'));
  for (const [n, k] of [['Glass', 'glass'], ['Half', 'half'], ['Bottle', 'bottle']]) { const c = stats && find(stats, byName(n)); if (c) bind(texts(c)[1], e, k, { pre: '$', ph: '—', n: 1 }); }
  const notes = find(main, byName('Tasting notes'));
  if (notes) { card(notes); const t = find(notes, byName('Notes')); bind(t, e, 'notes', { m: 1, ph: t?.s || 'Tasting notes' }); }
  const say = find(main, byName('Say it'));
  if (say) { card(say); bind(texts(say)[1], e, 'say', { m: 1, ph: 'What you say at the table' }); }
}

function bindBottle(page, e) {
  const main = page.main, d = e.data;
  const hero = find(main, byName('Hero'));
  const copy = hero && find(hero, byName('Copy'));
  const [, title, line] = kids(copy);
  bind(title, e, 'name', { u: 1, req: 1 });
  bind(line, e, 'notes', { m: 1, ph: line?.s || 'About this bottle' });
  const stats = copy && find(copy, byName('Stats'));
  const price = stats?.c?.[2];
  if (price) bind(texts(price)[1], e, 'price', { pre: '$', ph: 'Bar lead to add', n: 1 });
  void d;
  const say = find(main, byName('Say it'));
  if (say) { card(say); bind(texts(say).pop(), e, 'say', { m: 1, ph: 'What you say at the table' }); }
}

/* ------------------------------ lists ------------------------------ */
/** Beer & Draft: each beer on tap is a row of the tap table; its cells are fields. */
function bindBeers(page, beers, add) {
  const table = find(page.main, byName('Tap table'));
  if (!table) return;
  for (const row of (table.c || []).filter(startsWith('Row · '))) {
    const b = beers.find((x) => x.data.serve === 'Draft' && 'Row · ' + x.data.name === row.n);
    if (!b) continue;
    const t = texts(row);
    card(row);
    bind(t[0], b, 'tap', { ph: '#', cell: 1 });
    bind(t[1], b, 'name', { req: 1, cell: 1 });
    bind(t[4], b, 'abv', { ph: '—', cell: 1 });
    bind(t[5], b, 'glass', { ph: '—', cell: 1 });
    bind(t[6], b, 'pour', { ph: '—', cell: 1 });
    bind(t[8], b, 'price', { pre: '$', ph: '—', cell: 1, n: 1 });
    add(b);
  }
}

/** One entry's line in page.edit. */
function info(db, e) {
  const out = { col: e.collection, name: e.data.name || '', kind: KIND[e.collection] || 'Page', data: e.data };
  if (e.library) {
    const others = sharedWith(db, e);
    if (others.length) out.shared = { others: others.length, store: db.prepare('SELECT name FROM stores WHERE id = ?').get(e.storeId)?.name || '' };
    out.local = LOCAL_KEYS[e.collection] || [];
  }
  return out;
}

/** Each entry's data, cut down to the fields the page shows as fields (the browser needs the saved values to compare). */
function trimData(page) {
  const used = {};
  (function walk(n) {
    if (n.ed) {
      const s = (used[n.ed.e] ||= new Set(['name']));
      s.add(topKey(n.ed.k));
      if (n.ed.t === 'spec') for (const k of ['build', 'method', 'glass', 'garnish']) s.add(k);
    }
    (n.c || []).forEach(walk);
  })(page.main);
  for (const [id, info] of Object.entries(page.edit?.entries || {})) {
    const keys = used[id] || new Set(['name']);
    info.data = Object.fromEntries(Object.entries(info.data || {}).filter(([k]) => keys.has(k)));
  }
}

/**
 * Marks what on `page` the viewer can change in place. `entry` is the page's own entry (a dish, drink, wine or bottle page);
 * `can(col, id)` says whether the viewer may edit that entry; `lists` gives the entries a list page shows.
 */
export function bindEdits(db, page, { entry, slug, title, tpl, can, lists }) {
  if (!page?.main) return page;
  const entries = {};
  if (entry) {
    if (!can(entry.collection, entry.id)) return page;
    const c = entry.collection;
    if (c === 'house' || c === 'classic') bindCocktail(page, entry, tpl, c === 'classic');
    else if (c === 'recipe') bindDish(page, entry);
    else if (c === 'wine') bindWine(page, entry);
    else if (c === 'shelf') bindBottle(page, entry);
    entries[entry.id] = info(db, entry);
    page.edit = { main: entry.id, title: entry.data.name || '', entries };
    trimData(page);
    return page;
  }
  if (slug === 'the-bar/beer-and-draft' && can('beer', 0)) bindBeers(page, lists.beer(), (b) => { entries[b.id] = info(db, b); });
  if (Object.keys(entries).length) { page.edit = { main: null, title: title || page.name || '', entries }; trimData(page); }
  return page;
}
