// Makes the drawn controls work. Each control gets a `meta` the app reads (see src/components/interact.tsx):
//   k / mode / val / def   state key; 'toggle' (checkbox) or 'pick' (one of a set: tabs, chips, view switch)
//   on / off               the control as drawn in each state (cut from the Figma design)
//   save                   'day' | 'week': ticks stay on this device until the day / week ends
//   show                   when to show a layer: req (keys on), forbid (keys off), pick [key, values, default]
//   group / inGroup        a group header hides when every row in its group is hidden
//   act                    'print' | 'reset' (keys starting with `reset`) | 'zoom' (photo viewer)
//   cls                    [key, { value: className }] adds a class while the key has that value
import { addHref } from './editinplace.mjs';
import { clone, find, findAll, byName, startsWith, texts, setText } from './templates.mjs';
import { fillVideoLibrary, fillHomeVideos, emptyVideoFrames } from './videos.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ALLERGENS, COURSES } from './cms.mjs';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, 'and');
// Same order as the Allergen Guide's columns.
const ORDER = ['Gluten', 'Dairy', 'Egg', 'Finfish', 'Shellfish', 'Tree Nut', 'Peanut', 'Soy', 'Sesame', 'Allium', 'Nightshade'];
const DARK = '#1E1C1A', PAPER = '#FBF9F5', RING = '#BFB5A8';

/** A checkbox in its ticked and empty looks. `icon` is the tick drawn in Figma. */
function checkStates(node, icon) {
  const box = (n) => find(n, byName('Checkbox'));
  const on = clone(node), off = clone(node);
  const bOn = box(on), bOff = box(off);
  if (bOn) { bOn.f = [{ c: DARK }]; bOn.st = undefined; bOn.c = icon ? [clone(icon)] : bOn.c; bOn.lm = 'H'; bOn.pa = 'C'; bOn.ca = 'C'; }
  if (bOff) { bOff.f = [{ c: PAPER }]; bOff.st = RING; bOff.sw = 1; bOff.c = undefined; }
  return { on, off };
}

/** A tab or chip in its selected and plain looks, from a drawn selected one and a drawn plain one. */
function pickStates(node, selected, plain, label) {
  const make = (proto) => {
    const n = clone(proto);
    n.n = node.n; n.sh = node.sh; n.sv = node.sv; n.w = node.w;
    setText(texts(n)[0], label);
    return n;
  };
  return { on: make(selected), off: make(plain) };
}

const parentOf = (root, node) => (root.c || []).includes(node) ? root : (root.c || []).reduce((hit, c) => hit || parentOf(c, node), null);

/* ---- Food Matrix: filters, reset, table / cards ---- */
function foodMatrix(page, icon) {
  const table = find(page.main, byName('Matrix table'));
  const filters = find(page.main, byName('Filters'));
  if (!table || !filters) return;
  // Rows learn their course, station and allergens from what's printed on them.
  let course = '';
  const courses = new Map(), stations = new Map();
  for (const c of table.c) {
    if (startsWith('Group · ')(c)) { const g = c.n.slice(8).toLowerCase(); course = COURSES.find((x) => x.toLowerCase() === g) || title(g); c.meta = { group: course }; continue; }
    if (!startsWith('Row · ')(c)) continue;
    const station = texts(find(c, byName('Station')) || { c: [] })[0]?.s || '—';
    const allergens = (find(c, byName('Allergens'))?.c || []).filter(startsWith('Pill · ')).map((p) => p.n.slice(7)).filter((a) => a !== 'None listed');
    // A dish without a station yet only answers to the course filter (no "—" option).
    const hasStation = station !== '—';
    c.meta = { inGroup: course, show: { req: ['course:' + course, ...(hasStation ? ['station:' + station] : [])], forbid: allergens.map((a) => 'hide:' + a) } };
    courses.set(course, (courses.get(course) || 0) + 1);
    if (hasStation) stations.set(station, (stations.get(station) || 0) + 1);
  }
  // Options are rebuilt from the dishes, so the counts and the allergen list stay true.
  const groups = filters.c.filter(startsWith('Filter · '));
  const counted = find(groups.find((g) => /COURSE|STATION/.test(g.n)) || filters, startsWith('Option · '));
  const plainOpt = find(groups.find((g) => /HIDE/.test(g.n)) || filters, startsWith('Option · ')) || counted;
  const option = (proto, key, label, count) => {
    const o = clone(proto);
    o.n = 'Option · ' + label;
    const [lab, num] = o.c.filter((c) => c.t === 'T');
    if (lab) setText(lab, label);
    if (num) { if (count === undefined) o.c = o.c.filter((c) => c !== num); else setText(num, String(count)); }
    const { on, off } = checkStates(o, icon);
    o.meta = { k: key, mode: 'toggle', def: !key.startsWith('hide:'), on, off };
    return o;
  };
  // Stations keep the design's order; any new ones follow.
  const drawnOrder = (groups.find((g) => /STATION/.test(g.n))?.c || []).filter(startsWith('Option · ')).map((o) => o.n.slice(9));
  const stationList = [...stations].sort((a, b) => ((drawnOrder.indexOf(a[0]) + 1) || 99) - ((drawnOrder.indexOf(b[0]) + 1) || 99));
  for (const g of groups) {
    const head = g.c.filter((c) => c.t === 'T');
    if (/COURSE/.test(g.n)) g.c = [...head, ...[...courses].map(([v, n]) => option(counted, 'course:' + v, v, n))];
    else if (/STATION/.test(g.n)) g.c = [...head, ...stationList.map(([v, n]) => option(counted, 'station:' + v, v, n))];
    else g.c = [...head, ...ORDER.filter((a) => ALLERGENS.includes(a)).concat(ALLERGENS.filter((a) => !ORDER.includes(a))).map((a) => option(plainOpt, 'hide:' + a, a))];
  }
  const reset = find(filters, byName('Button · Reset'));
  if (reset) reset.meta = { act: 'reset', reset: ['course:', 'station:', 'hide:'] };
  // Table / Cards
  const tOpt = find(page.main, byName('Option · Table')), cOpt = find(page.main, byName('Option · Cards'));
  if (tOpt && cOpt) {
    for (const [o, val, label] of [[tOpt, 'table', 'Table'], [cOpt, 'cards', 'Cards']]) o.meta = { k: 'view', mode: 'pick', val, def: 'table', ...pickStates(o, tOpt, cOpt, label) };
    table.meta = { cls: ['view', { cards: 'matrix-cards' }] };
  }
}

/* ---- Cleaning board: tick tasks off; ticks last the shift's day (weekly tasks: the week) ---- */
function cleaningBoard(page, icon) {
  const board = find(page.main, byName('Cleaning board'));
  if (!board) return;
  for (const row of board.c.filter(startsWith('Row · '))) {
    const area = row.n.slice(6);
    for (const col of row.c.filter((c) => c.lm)) {
      for (const t of findAll(col, byName('Task'))) {
        const label = texts(t).map((x) => x.s).join(' ');
        const { on, off } = checkStates(t, icon);
        for (const v of [on, off]) v.n = 'Task · ' + label;
        t.meta = { k: `clean:${norm(area)}:${norm(col.n)}:${norm(label)}`, mode: 'toggle', def: false, save: /week/i.test(col.n) ? 'week' : 'day', on, off };
      }
    }
  }
}

/* ---- Video Library: tabs filter the grid ---- */
function videoLibrary(page) {
  const tabs = find(page.main, byName('Tabs'));
  const grid = findAll(page.main, startsWith('Video · '));
  if (!tabs || !grid.length) return;
  const cat = (v) => (texts(find(v, byName('Meta')) || v)[1]?.s || '').split(' · ')[0];
  const counts = new Map();
  for (const v of grid) { const c = cat(v); counts.set(c, (counts.get(c) || 0) + 1); v.meta = { show: { pick: ['vtab', ['All', c], 'All'] } }; }
  const list = tabs.c.filter(startsWith('Tab · '));
  const selected = list[0], plain = list[1] || list[0];
  tabs.c = [['All', grid.length], ...counts].map(([c, n]) => {
    const t = clone(plain); t.n = 'Tab · ' + c;
    t.meta = { k: 'vtab', mode: 'pick', val: c, def: 'All', ...pickStates(t, selected, plain, `${c} ${n}`) };
    return t;
  });
}

/* ---- Photo Library: chips filter, photos open large, upload goes to the media admin ---- */
function photoLibrary(page, ctx) {
  const chips = find(page.main, (n) => n.n === 'Filters' && (n.c || []).some(startsWith('Chip · ')));
  const photos = findAll(page.main, startsWith('Photo · '));
  // Only the Photo Library page (Home has a photo strip and its own chips).
  if (!chips || !photos.length || !find(page.main, byName('Masonry'))) return;
  const house = new Set(ctx.house.map((e) => norm(e.data.name)));
  const wines = new Set([...ctx.wines.map((e) => norm(e.data.name)), 'bolgherirosso', 'tenutaspinellipecorino']);
  const courseOf = new Map(ctx.recipes.map((e) => [norm(e.data.name), e.data.course]));
  const cats = (p) => {
    const [dish, ...rest] = p.n.slice(8).split(' · ');
    const cap = rest.join(' ');
    const out = [];
    const course = courseOf.get(norm(dish));
    if (course) out.push(course);
    if (house.has(norm(dish))) out.push('Cocktails');
    if (wines.has(norm(dish)) || [...wines].some((w) => w && norm(dish).includes(w))) out.push('Wine');
    if (/prep/i.test(cap)) out.push('Prep');
    if (/plat/i.test(cap)) out.push('Plating References');
    return out;
  };
  const counts = new Map();
  for (const p of photos) { const c = cats(p); c.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1)); p.meta = { ...(p.meta || {}), show: { pick: ['ptab', ['All', ...c], 'All'] } }; }
  const list = chips.c.filter(startsWith('Chip · '));
  const selected = list[0], plain = list[1] || list[0];
  const names = list.slice(1).map((c) => c.n.slice(7)).filter((c) => counts.get(c));
  chips.c = chips.c.filter((c) => !startsWith('Chip · ')(c)).concat([['All', photos.length], ...names.map((c) => [c])].map(([c, n]) => {
    const t = clone(c === 'All' ? selected : plain); t.n = 'Chip · ' + c;
    t.meta = { k: 'ptab', mode: 'pick', val: c, def: 'All', ...pickStates(t, selected, plain, n ? `${c} ${n}` : c) };
    return t;
  }));
  // Every photo is already on the page, so there's nothing more to load.
  const more = find(page.main, byName('Load more'));
  if (more) { const parent = parentOf(page.main, more); parent.c = parent.c.filter((c) => c !== more); }
  const up = find(page.main, byName('Button · Upload'));
  if (up) up.to = '/admin/media';
  // The drawn "•••" on each photo has no menu behind it.
  for (const p of photos) { const meta = find(p, byName('Meta')); if (meta) meta.c = (meta.c || []).filter((c) => c.t !== 'S'); }
}

/** Photos anywhere open large when tapped. */
function zoomPhotos(page) {
  for (const p of findAll(page.main, startsWith('Photo · '))) {
    if (p.to) continue;
    const im = find(p, (n) => n.f?.some((f) => f.img));
    const src = im?.f.find((f) => f.img)?.img;
    if (!src) continue;
    p.meta = { ...(p.meta || {}), act: 'zoom', img: src, caption: p.n.slice(8) };
  }
}


/* ---- The Back Bar and Cocktail Specs: list chips and the find box filter the page ---- */
function backBar(page) {
  const filter = find(page.main, byName('Filter'));
  if (!filter?._protos) return;
  const { on, off, keys = ['bbar', 'bfind'] } = filter._protos; delete filter._protos;
  const [pick, text] = keys;
  for (const c of filter.c) {
    const [l, n] = texts(c).map((t) => t.s);
    const st = pickStates(c, on, off, l);
    setText(texts(st.on)[1], n); setText(texts(st.off)[1], n);
    c.meta = { k: pick, mode: 'pick', val: c._val, def: 'All', ...st };
    delete c._val;
  }
  for (const card of findAll(page.main, (n) => n._g)) { card.meta = { show: { pick: [pick, ['All', card._g], 'All'], text: [text, card._find] } }; delete card._g; delete card._find; }
  for (const r of findAll(page.main, (n) => typeof n._find === 'string')) { r.meta = { ...(r.meta || {}), show: { text: [text, r._find] } }; delete r._find; }
  const box = find(page.main, (n) => n.n === 'Find a bottle' || n.n === 'Find a spec');
  if (box) box.meta = { find: text, label: texts(box)[0]?.s || 'Find' };
}

/* ---- Home: the Food Matrix preview's course chips ---- */
function homeMatrix(page) {
  const sec = find(page.main, byName('Section · Food Matrix'));
  const chips = sec && find(sec, byName('Filters'));
  if (!chips) return;
  const COURSE = { 'For the Table': 'For the Table', 'From the Oven': 'From the Oven', Soup: 'Soups & Salads', Salad: 'Soups & Salads', Entree: 'Entrees', 'Social Hour': 'Social Hour', 'Small Plate': 'Snacks & Small Plates', Pizza: 'Pizza', Pasta: 'Pasta', Main: 'Mains', Dessert: 'Dessert', Bar: 'Bar' };
  const rows = findAll(sec, startsWith('Row · '));
  const counts = new Map();
  for (const r of rows) {
    // r.course: the dish's real course, when the page builder knows it (the Mise demo's "Salads" isn't "Soups & Salads")
    const c = r.course || COURSE[texts(r).map((t) => t.s).find((x) => COURSE[x])] || ''; delete r.course;
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
    r.meta = { show: { pick: ['hchip', ['All', c], 'All'] } };
  }
  const list = chips.c.filter(startsWith('Chip · '));
  const selected = list[0], plain = list[1] || list[0];
  const order = [...COURSES, 'Bar'].filter((c) => counts.get(c));
  chips.c = [['All', `All ${rows.length}`], ...order.map((c) => [c, c])].map(([val, label]) => {
    const t = clone(val === 'All' ? selected : plain); t.n = 'Chip · ' + val;
    t.meta = { k: 'hchip', mode: 'pick', val, def: 'All', ...pickStates(t, selected, plain, label) };
    return t;
  });
}

/* ---- Floor Plan: find a table, tonight's sections ---- */
let PLAN;
const planTables = () => (PLAN ??= JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'content', 'floorplan.json'), 'utf8')).tables);
function floorPlan(page) {
  const finder = find(page.main, byName('Find a table'));
  if (!finder) return;
  const tables = planTables();
  finder.meta = { finder: 1, list: Object.keys(tables) };
  const plan = find(page.main, (n) => (n.n || '').startsWith('IMG/floorplan'));
  if (plan) plan.meta = { tables };
  for (const a of findAll(page.main, startsWith('Area · '))) {
    const m = texts(a).map((t) => t.s).join(' ').match(/(\d+)\s*[–-]\s*(\d+)/);
    if (m) a.meta = { range: [Number(m[1]), Number(m[2])] };
  }
  const team = find(page.main, (n) => n.n === 'Tonight’s team' || n.n === "Tonight's team");
  if (!team) return;
  for (const row of findAll(team, (n) => /^(Servers|Bar|Support) \d$/.test(n.n || ''))) row.meta = { assign: row.n };
}

/* ---- Recipe video: chapters jump to that point once a video is attached ---- */
function chapters(page) {
  for (const v of findAll(page.main, (n) => (n.c || []).some((c) => c.n === 'Chapters'))) {
    const player = find(v, (n) => (n.n === 'Player' || (n.n || '').startsWith('Video slot')) && n.vid);
    if (!player) continue;
    for (const ch of find(v, byName('Chapters')).c.filter(startsWith('Chapter · '))) {
      const [mm, ss] = (texts(ch)[0]?.s || '0:00').split(':').map(Number);
      ch.meta = { k: 'chapter', mode: 'pick', val: String((mm || 0) * 60 + (ss || 0)), def: '' };
    }
  }
}

/**
 * @param page   assembled page
 * @param ctx    { slug, entry (CMS entry or null), icon (the Figma tick), recipes, house, wines }
 */
/** Tables: each cell learns its column's label, and the header row is marked, so a phone can stack rows
 *  and still say what each value is (the header row hides there). Allergen cells with no allergen are marked empty. */
function labelTables(page) {
  const isRow = (c) => /^(Row|Classic row) · /.test(c.n || '');
  const label = (h) => texts(h).map((t) => t.s).join(' ').trim();
  const walk = (n) => {
    const kids = n.c || [];
    const rows = kids.filter(isRow);
    if (rows.length >= 2) {
      const cells = (rows[0].c || []).length;
      const head = kids.find((c) => /^(Column headers|Header|Headers|Head cells|Table head)$/.test(c.n || '') && (c.c || []).length === cells);
      if (head && n.n !== 'Matrix table') {
        head.hdr = 1;
        const labels = head.c.map(label);
        for (const r of rows) (r.c || []).forEach((c, i) => {
          // An empty cell gets no label (it hides on a phone).
          if (i > 0 && labels[i] && c.t !== 'S' && !texts(c).every((t) => !String(t.s || '').trim() || t.s.trim() === '—')) c.lab = labels[i];
          else if (i > 0 && labels[i] && c.t !== 'S') c.empty = 1;
          if (n.n === 'Allergen grid' && i > 0 && find(c, byName('None'))) c.empty = 1;
        });
      }
    }
    kids.forEach(walk);
  };
  walk(page.main);
}

export function wire(page, ctx) {
  if (!page) return page;
  const m = page.main;
  labelTables(page);
  for (const chip of findAll(m, byName('Menu chip'))) chip.to = '/food-matrix';
  for (const b of findAll(m, byName('Button · Print'))) b.meta = { act: 'print' };
  foodMatrix(page, ctx.icon);
  cleaningBoard(page, ctx.icon);
  // Real videos only (Nov 8): the library and Home's row list what the book has; empty frames go (videos.mjs).
  if (ctx.videos && ctx.slug === 'video-library') fillVideoLibrary(page, ctx.videos());
  if (ctx.videos && ctx.slug === '') fillHomeVideos(page, ctx.videos());
  emptyVideoFrames(page, ctx.slug, ctx.file);
  videoLibrary(page);
  photoLibrary(page, ctx);
  zoomPhotos(page);
  homeMatrix(page);
  backBar(page);
  floorPlan(page);
  chapters(page);
  // Home: "Watch Plating Video" → the dish page with its video; "View Changes" → the Food Matrix.
  const watch = find(m, byName('Button · Watch'));
  if (watch) watch.to = find(m, byName('Button · Spec'))?.to || '/video-library';
  for (const l of findAll(m, (n) => n.n === 'Link' && texts(n).some((t) => t.s === 'View Changes'))) l.to = '/food-matrix';
  // "All 4 Photos" on a recipe → the Photo Library
  for (const l of findAll(m, (n) => n.n === 'Link' && texts(n).some((t) => /^All \d+ Photos$/.test(t.s || '')))) l.to = '/photo-library';
  // Empty slots a manager fills in: straight to the right admin screen.
  const admin = ctx.entry ? `/admin/pages/${ctx.entry.collection}/${ctx.entry.id}` : null;
  for (const a of findAll(m, byName('Add video'))) {
    a.to = admin ? admin + '#video' : '/admin/wine-videos';
    // Wine pages: the chip opens the video picker on the page (upload, YouTube link, or the library).
    if (!admin && /^wine\//.test(ctx.slug || '')) {
      const name = (texts(find(m, byName('Hero')) || { c: [] }).find((t) => (t.z || 0) >= 36)?.s || '').toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());
      a.meta = { addVideo: { key: ctx.slug, title: name ? `A video for ${name}` : 'Add a video' } };
      const t = texts(a); if (t[1]) { t[1].s = 'Upload a file or paste a YouTube link'; delete t[1].segs; }
    }
  }
  for (const a of findAll(m, byName('Add bottle'))) a.to = addHref('shelf');
  const COLOR = { Sparkling: 'Bubbles', White: 'White', Red: 'Red' };
  for (const a of findAll(m, (n) => /^Add (Sparkling|White|Rosé|Red)$/.test(n.n || ''))) a.to = addHref('wine', { color: COLOR[a.n.slice(4)] });
  return page;
}
