// Prep tracker (Nov 12, Tommy: "a garnish, syrup, and juice tracker in the app that works day over day, week over week,
// year over year and can give you clear reports"). Figma 09 · Proposals → 31 (632:802): Today / Prep list (632:803),
// Item detail (632:894), Reports (632:985). Tommy, Nov 12, before bed: "You can do whatever you think you need to", so the
// open questions on the note (641:1348) were answered with these defaults:
//   • Who logs: bartenders, managers and owners (Tommy, Nov 12: "actually just bar … for right now"). Everyone else at the
//     store reads Today. LOG_JOBS below is the one place to add a kitchen job later.
//   • Who edits: managers and owners (items, pars, shelf life, accepting a suggested par).
//   • Units: each item has one unit (qt, pt, oz, each, bottles); batches are logged in it; "to make" rounds up to whole
//     batches; different units are never added together.
//   • No cost tracking in v1.
//   • Days are the store's Detroit date, like Tonight's sections on the Floor Plan.
//   • Archive, never delete.
//
// The model:
//   prep_items    a store's juices, syrups and garnishes: unit, batch size, a par for each weekday (Sun…Sat), shelf life
//                 in days (0 = one shift: toss at close; null = not set, so batches have no use-by).
//   prep_batches  every batch made: amount, what's left (remaining), the day it was made and its use-by day.
//   prep_events   where it went: 'used', 'waste' (with a reason) and 'ranout'. Used and wasted point at their batch, so a
//                 report can say, for the batches made in a period, how much was used, wasted and is still in use.
// Clearing a batch (Used Up, or logging what's left as waste once it's past its use-by) closes it: what isn't wasted was used.
import { audit, now } from './db.mjs';
import { listEntries } from './cms.mjs';
import { chatCtx, resolveRoom, postMessage, ChatError, addCardSource } from './chat.mjs';

/* ------------------------------------------------------------------ days (the restaurant's date, Metro Detroit) */
const TZ = 'America/Detroit';
const DAY = 864e5;
export const dayOf = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const dowOf = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
export const weekStart = (iso) => addDays(iso, -((dowOf(iso) + 6) % 7)); // Monday
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);
const tzOff = (t) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
};
/** The instant a Detroit wall-clock time happens on a given day. */
export function detroitAt(iso, h, m = 0) {
  const [y, mo, d] = iso.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  return new Date(guess - tzOff(guess - tzOff(guess))).toISOString();
}
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
/** "Nov 2–8", "Oct 26–Nov 1". */
export const rangeLabel = (a, b) => (a === b ? md(a) : a.slice(0, 7) === b.slice(0, 7) ? `${md(a)}–${+b.slice(8, 10)}` : `${md(a)}–${md(b)}`);

/* ------------------------------------------------------------------ numbers and units */
export const UNITS = ['qt', 'pt', 'oz', 'each', 'bottles'];
export const KINDS = ['juice', 'syrup', 'garnish'];
const KIND_LABEL = { juice: 'Juices', syrup: 'Syrups', garnish: 'Garnishes' };
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const EPS = 1e-9;
/** "3 qt", "0.5 qt", "45" (pieces have no unit word), "2 bottles". */
export function amt(n, unit) {
  const v = r2(n);
  const s = Number.isInteger(v) ? String(v) : String(v);
  return unit === 'each' ? s : `${s} ${unit === 'bottles' && v === 1 ? 'bottle' : unit}`;
}
/** The step a par moves in: half a quart, a pint, 4 oz, 5 pieces (1 when batches are smaller than 5). */
export const stepFor = (unit, batch) => (unit === 'each' ? (batch >= 5 ? 5 : 1) : unit === 'oz' ? 4 : unit === 'bottles' ? 1 : 0.5);
const ceilStep = (v, step) => r2(Math.ceil(v / step - EPS) * step);
/** Today's amount: par minus what's on hand, rounded up to whole batches (Figma note 641:1348, decision 1). */
export function toMake(par, onHand, batch) {
  const need = (Number(par) || 0) - (Number(onHand) || 0);
  if (need <= EPS || !(batch > 0)) return 0;
  return r2(Math.ceil(need / batch - EPS) * batch);
}
/** A batch's use-by day: the day it was made plus the item's shelf life in days (0 = toss at close the same day). */
export const useByFor = (shelfDays, day) => (shelfDays == null ? null : addDays(day, shelfDays));

/* ------------------------------------------------------------------ who can do what */
const MANAGERS = new Set(['owner', 'manager', 'superadmin']);
const jobsOf = (j) => { try { const a = JSON.parse(j || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
/** The jobs that log prep, besides managers and owners. The only place this is decided: add a kitchen job here later. */
export const LOG_JOBS = ['bartender'];
/** Logs batches, waste, counts: bartenders, managers and owners. */
export const canLog = (u) => !!u && (MANAGERS.has(u.role) || jobsOf(u.jobs).some((j) => LOG_JOBS.includes(j)));
/** Edits items, pars and shelf life, accepts suggestions: managers and owners. */
export const canManage = (u) => !!u && MANAGERS.has(u.role);

/* ------------------------------------------------------------------ starting items */
// Shelf lives the Cocktail Program already states (Level 3). Anything the lessons don't give a number for is marked
// "House standard · to confirm" (shelf_source null) for the bar lead.
const DILUTION = { lesson: '/cocktail-program/level-3/bar-dilution', source: 'From Level 3 · Water, ice and citrus. Source: Dave Arnold, “Fresh Lime Juice: WTF?”, Cooking Issues, Oct 1, 2010.',
  note: 'Lime juice tastes best a few hours after pressing, and by the next day it has gone dull and bitter. Juice at the start of the shift, keep it cold, and don’t carry it over.' };
const BATCHING = { lesson: '/cocktail-program/level-3/bar-batching', source: 'From Level 3 · Batching (“What not to batch”). Source: Dave Arnold, “Fresh Lime Juice: WTF?”, Cooking Issues, Oct 1, 2010.',
  note: 'Citrus fades within the day, so it’s juiced fresh for the shift and not carried over.' };
const SYRUPS = '/cocktail-program/level-3/bar-syrups';
const GARNISH = '/cocktail-program/level-1/bar-glass-ice-garnish';
const COLD_JUICE = 'Cold. Squeeze bottles in the well cooler, labelled with the time and your initials.';
const COLD_SYRUP = 'Cold. Labelled deli or bottle in the reach-in, with the date and your initials.';
const GARNISH_TRAY = 'Covered garnish tray in the well cooler, on a damp towel.';
const juiceSteps = (fruit) => [`Wash the ${fruit} and roll them on the board.`, 'Halve and press: hand press or the juicer.', 'Fine-strain into a quart deli.', `Label it: ${fruit === 'limes' ? 'Lime' : fruit === 'lemons' ? 'Lemon' : 'Grapefruit'} juice, the time, your initials.`, 'Into the well cooler. Log the batch.'];

/** Things a bar preps, matched against house specs: `ing` against a spec's non-spirit ingredients, `garnish` against its
 *  garnish line. base = Thursday's par; the other days follow WEEK. */
const CATALOG = [
  { key: 'lime-juice', name: 'Lime juice', kind: 'juice', unit: 'qt', batch: 1, base: 3, shelf: 0, cite: DILUTION, storage: COLD_JUICE, ing: '^lime( juice)?$', recipe: juiceSteps('limes') },
  { key: 'lemon-juice', name: 'Lemon juice', kind: 'juice', unit: 'qt', batch: 1, base: 2, shelf: 0, cite: BATCHING, storage: COLD_JUICE, ing: '^lemon( juice)?$', recipe: juiceSteps('lemons') },
  { key: 'grapefruit-juice', name: 'Grapefruit juice', kind: 'juice', unit: 'qt', batch: 1, base: 1, shelf: 0, cite: BATCHING, storage: COLD_JUICE, ing: '^grapefruit( juice)?$', recipe: juiceSteps('grapefruit') },
  { key: 'orange-juice', name: 'Orange juice', kind: 'juice', unit: 'qt', batch: 1, base: 1, shelf: 0, cite: BATCHING, storage: COLD_JUICE, ing: '^orange juice$' },
  { key: 'demerara-syrup', name: 'Demerara syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1.5, shelf: 7, ratio: '2:1', storage: COLD_SYRUP, ing: '^demerara syrup$', lesson: SYRUPS,
    recipe: ['Weigh 2 parts demerara sugar to 1 part hot water.', 'Stir until every crystal is gone.', 'Cool, bottle and label it with the date and your initials.'] },
  { key: 'simple-syrup', name: 'Simple syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1.5, shelf: 7, ratio: '1:1', storage: COLD_SYRUP, ing: '^simple syrup$', lesson: SYRUPS,
    recipe: ['Weigh equal parts sugar and hot water.', 'Stir until the sugar is gone.', 'Cool, bottle and label it with the date and your initials.'] },
  { key: 'ginger-honey-syrup', name: 'Ginger honey syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1, shelf: 7, storage: COLD_SYRUP, ing: '^(ginger[ -]honey|honey[ -]ginger) syrup$' },
  { key: 'spiced-hibiscus-syrup', name: 'Spiced hibiscus syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1, shelf: 7, storage: COLD_SYRUP, ing: '^spiced hibiscus syrup$' },
  { key: 'hibiscus-syrup', name: 'Hibiscus syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1, shelf: 7, storage: COLD_SYRUP, ing: '^hibiscus syrup$' },
  { key: 'honey-syrup', name: 'Honey syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1, shelf: 7, storage: COLD_SYRUP, ing: '^honey syrup$' },
  { key: 'orange-oleo', name: 'Orange oleo saccharum', kind: 'syrup', unit: 'qt', batch: 0.5, base: 0.5, shelf: 3, storage: COLD_SYRUP, ing: 'oleo saccharum', lesson: SYRUPS,
    recipe: ['Peel the oranges with as little white pith as you can.', 'Toss the peels with sugar and let it sit.', 'Strain the oily syrup off the peels, bottle and label it.'] },
  { key: 'rosemary-syrup', name: 'Rosemary syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1, shelf: 7, storage: COLD_SYRUP, ing: '^rosemary syrup$' },
  { key: 'spiced-apple-syrup', name: 'Spiced apple syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1, shelf: 7, storage: COLD_SYRUP, ing: '^spiced apple syrup$' },
  { key: 'cucumber-syrup', name: 'Cucumber syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1, shelf: 3, storage: COLD_SYRUP, ing: '^cucumber syrup$' },
  { key: 'ginger-apple-shrub', name: 'Ginger-apple shrub', kind: 'syrup', unit: 'qt', batch: 1, base: 1, shelf: 14, storage: COLD_SYRUP, ing: '^ginger-apple shrub$' },
  { key: 'jalapeno-syrup', name: 'Jalapeño syrup', kind: 'syrup', unit: 'qt', batch: 1, base: 1, shelf: 7, storage: COLD_SYRUP, ing: '^jalape(ñ|n)o syrup$' },
  { key: 'orange-twists', name: 'Orange twists', kind: 'garnish', unit: 'each', batch: 5, base: 60, shelf: 1, storage: GARNISH_TRAY, garnish: 'orange (peel|twist)', lesson: GARNISH },
  { key: 'lemon-twists', name: 'Lemon twists', kind: 'garnish', unit: 'each', batch: 5, base: 40, shelf: 1, storage: GARNISH_TRAY, garnish: 'lemon (peel|twist)', lesson: GARNISH },
  { key: 'lime-wedges', name: 'Lime wedges', kind: 'garnish', unit: 'each', batch: 5, base: 50, shelf: 0, storage: GARNISH_TRAY, garnish: '(lime wedge|^lime(;|$))', lesson: GARNISH },
  { key: 'lime-wheels', name: 'Lime wheels', kind: 'garnish', unit: 'each', batch: 5, base: 30, shelf: 0, storage: GARNISH_TRAY, garnish: 'lime wheel', lesson: GARNISH },
  { key: 'grapefruit-peels', name: 'Grapefruit peels', kind: 'garnish', unit: 'each', batch: 5, base: 20, shelf: 1, storage: GARNISH_TRAY, garnish: 'grapefruit (peel|twist)', lesson: GARNISH },
  { key: 'cucumber-ribbons', name: 'Cucumber ribbons', kind: 'garnish', unit: 'each', batch: 5, base: 30, shelf: 0, storage: GARNISH_TRAY, garnish: 'cucumber ribbon', lesson: GARNISH },
  { key: 'rosemary-sprigs', name: 'Rosemary sprigs', kind: 'garnish', unit: 'each', batch: 1, base: 12, shelf: 2, storage: 'Stems in a cup of water in the well cooler.', garnish: 'rosemary' },
];
const BY_KEY = new Map(CATALOG.map((c) => [c.key, c]));
// The Baldwin's list (Figma 632:803), every item drawn from its house cocktail specs (content/cms/house.json).
const BALDWIN_LIST = ['lime-juice', 'lemon-juice', 'grapefruit-juice', 'demerara-syrup', 'simple-syrup', 'ginger-honey-syrup', 'spiced-hibiscus-syrup', 'orange-oleo', 'orange-twists', 'lemon-twists', 'lime-wedges', 'rosemary-sprigs'];
// Wrenfield's (the Mise demo), from its own house specs (content/demo-mise/house.json).
const WRENFIELD_LIST = ['lime-juice', 'lemon-juice', 'grapefruit-juice', 'honey-ginger-syrup', 'hibiscus-syrup', 'rosemary-syrup', 'spiced-apple-syrup', 'cucumber-syrup', 'cucumber-ribbons', 'lime-wheels', 'lemon-twists', 'grapefruit-peels'];
BY_KEY.set('honey-ginger-syrup', { ...BY_KEY.get('ginger-honey-syrup'), key: 'honey-ginger-syrup', name: 'Honey-ginger syrup' });
BY_KEY.set('lemon-peels', { ...BY_KEY.get('lemon-twists'), key: 'lemon-peels', name: 'Lemon peels' });
WRENFIELD_LIST[10] = 'lemon-peels';

// Busier at the weekend: the weekday's share of Thursday's par (Sun…Sat).
const WEEK = [1, 0.67, 0.67, 0.83, 1, 1.33, 1.5];
export function parsFor(base, unit, batch) {
  const step = stepFor(unit, batch);
  return WEEK.map((f) => Math.max(step, r2(Math.round((base * f) / step) * step)));
}

const plain = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').trim();
/** Which catalog items a set of house specs uses, most-used first within each kind (3 juices, 5 syrups, 4 garnishes). */
export function deriveList(specs) {
  const uses = new Map();
  for (const d of specs) {
    const ings = (d.build || []).filter((b) => !b.spirit).map((b) => plain(b.ingredient));
    for (const c of CATALOG) {
      const hit = (c.ing && ings.some((i) => new RegExp(c.ing, 'i').test(i))) || (c.garnish && new RegExp(c.garnish, 'i').test(plain(d.garnish)));
      if (hit) uses.set(c.key, (uses.get(c.key) || 0) + 1);
    }
  }
  const out = [];
  for (const [kind, max] of [['juice', 3], ['syrup', 5], ['garnish', 4]]) {
    out.push(...CATALOG.filter((c) => c.kind === kind && uses.has(c.key)).sort((a, b) => uses.get(b.key) - uses.get(a.key)).slice(0, max).map((c) => c.key));
  }
  return out;
}

/** Which starting list a store gets: The Baldwin (and its demo copies) the drawn list, Wrenfield its own, any other
 *  store the items its own house specs use. */
function startingKeys(db, storeRow) {
  const co = db.prepare('SELECT brand, demo FROM companies WHERE id = ?').get(storeRow.company_id) || {};
  if (co.brand === 'mise' && co.demo) return WRENFIELD_LIST;
  if (storeRow.slug === 'the-baldwin' && co.brand !== 'mise') return BALDWIN_LIST;
  return deriveList(listEntries(db, 'house', storeRow.id).map((e) => e.data));
}
const matchOf = (c) => JSON.stringify({ ing: c.ing || null, garnish: c.garnish || null });
const nameMatch = (name) => JSON.stringify({ ing: '^' + plain(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', garnish: null });

/** A store's items, made the first time anyone opens Prep there. Never re-made: archived items stay archived. */
export function ensureItems(db, storeRow) {
  if (!storeRow) return;
  if (db.prepare('SELECT 1 FROM prep_items WHERE store_id = ? LIMIT 1').get(storeRow.id)) return;
  const ins = db.prepare(`INSERT INTO prep_items(company_id, store_id, name, kind, unit, batch, pars, shelf_days, storage, shelf_note, shelf_source, shelf_lesson,
    ratio, recipe, recipe_lesson, yield_note, match, sort, seed_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const t = now();
  startingKeys(db, storeRow).forEach((key, i) => {
    const c = BY_KEY.get(key); if (!c) return;
    ins.run(storeRow.company_id, storeRow.id, c.name, c.kind, c.unit, c.batch, JSON.stringify(parsFor(c.base, c.unit, c.batch)), c.shelf, c.storage || null,
      c.cite?.note || null, c.cite?.source || null, c.cite?.lesson || null, c.ratio || null, c.recipe ? JSON.stringify(c.recipe) : null, c.lesson || c.cite?.lesson || null,
      c.yield || null, matchOf(c), i, key, t, t);
  });
}

/* ------------------------------------------------------------------ reading items */
const parseJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const person = (id, name) => (name ? { id, name, initials: initials(name) } : null);
const KIND_ORDER = "CASE kind WHEN 'juice' THEN 0 WHEN 'syrup' THEN 1 ELSE 2 END";
const itemsOf = (db, store) => db.prepare(`SELECT * FROM prep_items WHERE store_id = ? AND archived_at IS NULL ORDER BY ${KIND_ORDER}, sort, id`).all(store);
const itemRow = (db, store, id) => db.prepare('SELECT * FROM prep_items WHERE id = ? AND store_id = ?').get(Number(id), store);
const shelfWords = (d) => (d == null ? 'Shelf life not set' : d === 0 ? 'Keeps 1 shift' : d === 7 ? 'Keeps 1 week' : d === 1 ? 'Keeps 1 day' : `Keeps ${d} days`);
const useByWords = (useBy, today) => {
  if (!useBy) return 'no use-by';
  const d = daysBetween(today, useBy);
  return d < 0 ? 'past its use-by' : d === 0 ? 'use by tonight' : d === 1 ? 'use by tomorrow' : `use by ${WEEKDAYS[dowOf(useBy)]}`;
};
const timeOf = (at) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).toLowerCase();
const dayWord = (day, today) => (day === today ? 'today' : day === addDays(today, -1) ? 'last night' : SHORT[dowOf(day)]);

/** Open batches with something left, by item. */
function openBatches(db, store) {
  const by = new Map();
  for (const b of db.prepare(`SELECT b.*, u.name maker FROM prep_batches b LEFT JOIN users u ON u.id = b.made_by
    WHERE b.store_id = ? AND b.closed_at IS NULL AND b.remaining > 0 ORDER BY b.made_at`).all(store)) {
    if (!by.has(b.item_id)) by.set(b.item_id, []);
    by.get(b.item_id).push(b);
  }
  return by;
}
const onHandOf = (list, today) => r2((list || []).filter((b) => !b.use_by || b.use_by >= today).reduce((n, b) => n + b.remaining, 0));
/** Batches made before today that are past their use-by, due tonight or due tomorrow: clear these first. */
const isUseFirst = (b, today) => b.day < today && !!b.use_by && b.use_by <= addDays(today, 1);

/** Today: the Use First card, the prep list, and this week so far. */
export function today(db, storeRow, user) {
  ensureItems(db, storeRow);
  const store = storeRow.id;
  const day = dayOf();
  const dow = dowOf(day);
  const items = itemsOf(db, store);
  const open = openBatches(db, store);
  const made = db.prepare(`SELECT b.*, u.name maker FROM prep_batches b LEFT JOIN users u ON u.id = b.made_by WHERE b.store_id = ? AND b.day = ? ORDER BY b.made_at`).all(store, day);
  const usual = db.prepare(`SELECT b.made_by id, u.name, COUNT(*) n FROM prep_batches b JOIN users u ON u.id = b.made_by AND u.deleted_at IS NULL
    WHERE b.item_id = ? AND b.day >= ? AND b.day < ? AND CAST(strftime('%w', b.day) AS INT) = ? GROUP BY b.made_by ORDER BY n DESC, b.made_by LIMIT 1`);
  const rows = items.map((it) => {
    const pars = parseJson(it.pars, []);
    const par = Number(pars[dow]) || 0;
    const list = open.get(it.id) || [];
    const onHand = onHandOf(list, day);
    const mine = made.filter((b) => b.item_id === it.id);
    const last = mine[mine.length - 1];
    const u = !last ? usual.get(it.id, addDays(day, -28), day, dow) : null;
    const need = toMake(par, onHand, it.batch);
    const useFirst = list.some((b) => isUseFirst(b, day));
    return {
      id: it.id, name: it.name, kind: it.kind, unit: it.unit, batch: it.batch, par, onHand, toMake: need, batches: need ? r2(need / it.batch) : 0,
      made: last ? { amount: r2(mine.reduce((n, b) => n + b.amount, 0)), at: last.made_at, by: person(last.made_by, last.maker) } : null,
      who: last ? person(last.made_by, last.maker) : u ? { ...person(u.id, u.name), usual: true } : null,
      useFirst, ratio: it.ratio, hasRecipe: !!parseJson(it.recipe, []).length, lesson: it.recipe_lesson,
      shelfDays: it.shelf_days, useByIfMadeNow: useByFor(it.shelf_days, day),
      status: need > 0 ? 'make' : last ? 'made' : useFirst ? 'use-first' : 'at-par',
    };
  });
  const useFirst = [];
  for (const it of items) for (const b of open.get(it.id) || []) {
    if (!isUseFirst(b, day)) continue;
    const d = daysBetween(day, b.use_by);
    useFirst.push({ batchId: b.id, itemId: it.id, name: it.name, kind: it.kind, unit: it.unit, amount: b.amount, remaining: r2(b.remaining),
      day: b.day, madeAt: b.made_at, by: person(b.made_by, b.maker), useBy: b.use_by, state: d < 0 ? 'expired' : d === 0 ? 'today' : 'tomorrow',
      line: `${amt(b.remaining, it.unit)} left from ${dayWord(b.day, day)} · made ${timeOf(b.made_at)}${b.maker ? ' by ' + b.maker : ''} · ${useByWords(b.use_by, day)}` });
  }
  useFirst.sort((a, b) => (a.useBy < b.useBy ? -1 : a.useBy > b.useBy ? 1 : a.madeAt < b.madeAt ? -1 : 1));
  return {
    store: storeRow.name, day, weekday: WEEKDAYS[dow], can: { log: canLog(user), edit: canManage(user) },
    useFirst, items: rows, people: loggers(db, storeRow, user), week: weekSoFar(db, store, day), started: firstDay(db, store),
  };
}

/** Everyone who can log at this store, for "Made by" (the person logging first). */
export function loggers(db, storeRow, me) {
  const rows = db.prepare(`SELECT id, name, role, jobs FROM users WHERE company_id = ? AND deleted_at IS NULL AND (
      (role = 'staff' AND store_id = ?) OR (role = 'manager' AND (store_id = ? OR store_id IS NULL)) OR role = 'owner') ORDER BY name COLLATE NOCASE`)
    .all(storeRow.company_id, storeRow.id, storeRow.id).filter(canLog);
  const out = rows.map((u) => person(u.id, u.name));
  if (me && !out.some((p) => p.id === me.id)) out.unshift(person(me.id, me.name));
  return out.sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : 0));
}
const firstDay = (db, store) => db.prepare('SELECT MIN(day) d FROM prep_batches WHERE store_id = ?').get(store).d || null;

/** Monday to today: made and wasted per unit, and how many times something ran out. */
function weekSoFar(db, store, day) {
  const from = weekStart(day);
  const made = db.prepare(`SELECT i.unit, SUM(b.amount) n FROM prep_batches b JOIN prep_items i ON i.id = b.item_id WHERE b.store_id = ? AND b.day BETWEEN ? AND ? GROUP BY i.unit`).all(store, from, day);
  const wasted = db.prepare(`SELECT i.unit, SUM(e.amount) n FROM prep_events e JOIN prep_batches b ON b.id = e.batch_id JOIN prep_items i ON i.id = e.item_id
    WHERE e.store_id = ? AND e.kind = 'waste' AND b.day BETWEEN ? AND ? GROUP BY i.unit`).all(store, from, day);
  const ran = db.prepare("SELECT COUNT(*) n FROM prep_events WHERE store_id = ? AND kind = 'ranout' AND day BETWEEN ? AND ?").get(store, from, day).n;
  const m = Object.fromEntries(made.map((r) => [r.unit, r2(r.n)])), w = Object.fromEntries(wasted.map((r) => [r.unit, r2(r.n)]));
  return { from, to: day, made: m, wasted: w, ranOut: ran };
}

/* ------------------------------------------------------------------ the item page */
/** Per weekday over the last 4 weeks (not today): days with batches, average used and wasted (by the day the batch was
 *  made), and how many of those days it ran out. */
export function weekdayStats(db, itemId, day) {
  const from = addDays(day, -28);
  const per = Array.from({ length: 7 }, () => ({ days: 0, used: 0, wasted: 0, ranOut: 0 }));
  const rows = db.prepare(`SELECT b.day, SUM(b.amount) made,
      (SELECT IFNULL(SUM(e.amount),0) FROM prep_events e WHERE e.batch_id IN (SELECT id FROM prep_batches x WHERE x.item_id = b.item_id AND x.day = b.day) AND e.kind = 'used') used,
      (SELECT IFNULL(SUM(e.amount),0) FROM prep_events e WHERE e.batch_id IN (SELECT id FROM prep_batches x WHERE x.item_id = b.item_id AND x.day = b.day) AND e.kind = 'waste') wasted
    FROM prep_batches b WHERE b.item_id = ? AND b.day >= ? AND b.day < ? GROUP BY b.day`).all(itemId, from, day);
  for (const r of rows) { const p = per[dowOf(r.day)]; p.days++; p.used += r.used; p.wasted += r.wasted; }
  for (const r of db.prepare("SELECT DISTINCT day FROM prep_events WHERE item_id = ? AND kind = 'ranout' AND day >= ? AND day < ?").all(itemId, from, day)) per[dowOf(r.day)].ranOut++;
  return per.map((p) => ({ days: p.days, used: p.days ? r2(p.used / p.days) : null, wasted: p.days ? r2(p.wasted / p.days) : null, ranOut: p.ranOut }));
}

/**
 * Suggested pars from the logs (Figma 632:894, "From your logs"). Never applied on their own: a manager taps to accept.
 *   Runs short: it ran out on that weekday in the last 4 weeks, or average use is 95% of the par or more →
 *     raise to 110% of the average use, rounded up to the par step, and at least one step above today's par.
 *   Runs long: average waste is 20% of the par or more and average use is under 85% of it →
 *     lower to 110% of the average use, rounded up to the step (never below one step), if that's below today's par.
 *   Only weekdays with at least 2 days of logs. A weekday someone tapped Keep on stays quiet for 14 days.
 */
export function suggestions(item, stats, day = dayOf()) {
  const pars = parseJson(item.pars, []);
  const kept = parseJson(item.kept, {});
  const step = stepFor(item.unit, item.batch);
  const out = [];
  stats.forEach((s, dow) => {
    if (s.days < 2 || s.used == null) return;
    if (kept[dow] && daysBetween(kept[dow], day) < 14) return;
    const par = Number(pars[dow]) || 0;
    const plural = WEEKDAYS[dow] + 's';
    if (s.ranOut > 0 || (par > 0 && s.used >= par * 0.95)) {
      const to = Math.max(ceilStep(s.used * 1.1, step), r2(par + step));
      out.push({ dow, kind: 'raise', from: par, to, text: `${plural} run short. You used ${amt(s.used, item.unit)} on average${s.ranOut ? ` and ran out ${s.ranOut === 1 ? 'once' : s.ranOut + ' times'} in the last ${s.days}` : ''}. Raise ${WEEKDAYS[dow]} to ${amt(to, item.unit)}?` });
    } else if (par > 0 && s.wasted >= par * 0.2 && s.used < par * 0.85) {
      const to = Math.max(step, ceilStep(s.used * 1.1, step));
      if (to < par) out.push({ dow, kind: 'lower', from: par, to, text: `${plural} run long. You tossed ${amt(s.wasted, item.unit)} on average over the last ${s.days} ${plural}. Lower ${WEEKDAYS[dow]} to ${amt(to, item.unit)}?` });
    }
  });
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The store's house cocktails that list this item in their spec (or as their garnish), most of it first. */
export function drinksFor(db, store, item) {
  const m = parseJson(item.match, null) || parseJson(nameMatch(item.name), {});
  const ing = m.ing ? new RegExp(m.ing, 'i') : new RegExp('^' + escapeRe(plain(item.name)) + '$', 'i');
  const gar = m.garnish ? new RegExp(m.garnish, 'i') : null;
  const toOz = (a) => { const x = /^(\d*\.?\d+)\s*oz/.exec(String(a || '').trim()); return x ? Number(x[1]) : 0; };
  const out = [];
  for (const e of listEntries(db, 'house', store)) {
    const d = e.data || {};
    const b = (d.build || []).find((x) => !x.spirit && ing.test(plain(x.ingredient)));
    if (b) out.push({ name: d.name, slug: e.slug, amount: String(b.amount || '').trim(), oz: toOz(b.amount) });
    else if (gar && gar.test(plain(d.garnish))) out.push({ name: d.name, slug: e.slug, amount: 'Garnish', oz: -1 });
  }
  return out.sort((a, b) => b.oz - a.oz || a.name.localeCompare(b.name)).map(({ oz, ...x }) => x);
}

/** A batch, with where it went. */
function batchOut(db, b, unit, today) {
  const ev = db.prepare('SELECT kind, amount, reason, at FROM prep_events WHERE batch_id = ? ORDER BY at').all(b.id);
  const used = r2(ev.filter((e) => e.kind === 'used').reduce((n, e) => n + e.amount, 0));
  const waste = ev.filter((e) => e.kind === 'waste');
  const ran = db.prepare("SELECT at FROM prep_events WHERE item_id = ? AND kind = 'ranout' AND day = ? ORDER BY at LIMIT 1").get(b.item_id, b.day);
  return { id: b.id, day: b.day, madeAt: b.made_at, by: person(b.made_by, b.maker), amount: b.amount, remaining: r2(b.remaining), useBy: b.use_by,
    open: !b.closed_at && b.remaining > 0, expired: !b.closed_at && b.remaining > 0 && !!b.use_by && b.use_by < today,
    used, wasted: waste.map((w) => ({ amount: r2(w.amount), reason: w.reason || 'other' })), ranOutAt: ran?.at || null, unit };
}

export function itemDetail(db, storeRow, user, id) {
  ensureItems(db, storeRow);
  const it = itemRow(db, storeRow.id, id);
  if (!it) return null;
  const day = dayOf(), dow = dowOf(day);
  const pars = parseJson(it.pars, []);
  const stats = weekdayStats(db, it.id, day);
  const list = openBatches(db, storeRow.id).get(it.id) || [];
  const batches = db.prepare(`SELECT b.*, u.name maker FROM prep_batches b LEFT JOIN users u ON u.id = b.made_by WHERE b.item_id = ? ORDER BY b.made_at DESC LIMIT 60`).all(it.id);
  const from = weekStart(day);
  const wk = db.prepare(`SELECT IFNULL(SUM(amount),0) made, IFNULL(SUM(CASE WHEN closed_at IS NULL THEN remaining ELSE 0 END),0) inUse FROM prep_batches WHERE item_id = ? AND day BETWEEN ? AND ?`).get(it.id, from, day);
  const wkEv = db.prepare(`SELECT e.kind, IFNULL(SUM(e.amount),0) n FROM prep_events e JOIN prep_batches b ON b.id = e.batch_id WHERE e.item_id = ? AND b.day BETWEEN ? AND ? GROUP BY e.kind`).all(it.id, from, day);
  const ev = Object.fromEntries(wkEv.map((r) => [r.kind, r2(r.n)]));
  const makers = db.prepare(`SELECT b.made_by id, u.name, GROUP_CONCAT(DISTINCT CAST(strftime('%w', b.day) AS INT)) dows, COUNT(*) n FROM prep_batches b JOIN users u ON u.id = b.made_by AND u.deleted_at IS NULL
    WHERE b.item_id = ? AND b.day >= ? GROUP BY b.made_by ORDER BY n DESC LIMIT 4`).all(it.id, addDays(day, -28))
    .map((r) => ({ ...person(r.id, r.name), days: String(r.dows || '').split(',').map(Number).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => SHORT[d]) }));
  return {
    id: it.id, name: it.name, kind: it.kind, kindLabel: KIND_LABEL[it.kind], unit: it.unit, batch: it.batch, pars, today: dow, day,
    parToday: Number(pars[dow]) || 0, onHand: onHandOf(list, day), step: stepFor(it.unit, it.batch),
    stats, suggestions: suggestions(it, stats, day),
    shelf: { days: it.shelf_days, words: shelfWords(it.shelf_days), storage: it.storage || '', note: it.shelf_note || '', source: it.shelf_source || '', lesson: it.shelf_lesson || '', confirmed: !!it.shelf_source },
    recipe: { ratio: it.ratio || '', steps: parseJson(it.recipe, []), yield: it.yield_note || '', lesson: it.recipe_lesson || '' },
    drinks: drinksFor(db, storeRow.id, it),
    batches: batches.map((b) => batchOut(db, b, it.unit, day)),
    week: { from, made: r2(wk.made), used: ev.used || 0, wasted: ev.waste || 0, inUse: r2(wk.inUse) },
    makers, archived: !!it.archived_at, can: { log: canLog(user), edit: canManage(user) },
  };
}

/* ------------------------------------------------------------------ writes */
class PrepError extends Error { constructor(status, message) { super(message); this.status = status; } }
export { PrepError };
const bad = (status, message) => { throw new PrepError(status, message); };
const num = (v, { min = 0, max = 100000, name = 'amount' } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) bad(400, `That ${name} doesn’t look right.`);
  return r2(n);
};
const cleanText = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const itemOr404 = (db, store, id) => itemRow(db, store, id) || bad(404, 'That prep item isn’t here.');

function addEvent(db, x, { item, batch = null, kind, amount = 0, reason = null, note = null, at = now(), by }) {
  db.prepare('INSERT INTO prep_events(company_id, store_id, item_id, batch_id, kind, amount, reason, note, day, at, by_user) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(x.company, x.store, item, batch, kind, r2(amount), reason, note, dayOf(at), at, by);
}

/** Log a batch. madeAt (optional) can be earlier today or yesterday, never the future. */
export function logBatch(db, x, u, b) {
  const it = itemOr404(db, x.store, b.itemId);
  if (it.archived_at) bad(409, 'This item is archived. Restore it from Archived first.');
  const amount = num(b.amount, { min: 0.01, max: 10000 });
  let madeBy = u.id;
  if (b.madeBy != null && Number(b.madeBy) !== u.id) {
    const ok = loggers(db, x.storeRow, u).some((p) => p.id === Number(b.madeBy));
    if (!ok) bad(400, 'Pick someone on this store’s team who preps.');
    madeBy = Number(b.madeBy);
  }
  let at = now();
  if (b.madeAt) {
    const t = Date.parse(b.madeAt);
    if (!Number.isFinite(t) || t > Date.now() + 5 * 60e3 || t < Date.now() - 36 * 3600e3) bad(400, 'Pick a time from today or yesterday.');
    at = new Date(t).toISOString();
  }
  const day = dayOf(at);
  const useBy = useByFor(it.shelf_days, day);
  db.exec('BEGIN');
  try {
    if (b.ranOut) addEvent(db, x, { item: it.id, kind: 'ranout', at: new Date(Date.parse(at) - 60e3).toISOString(), note: cleanText(b.note, 200) || null, by: u.id });
    const id = Number(db.prepare('INSERT INTO prep_batches(company_id, store_id, item_id, amount, remaining, day, made_at, use_by, made_by, by_user) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(x.company, x.store, it.id, amount, amount, day, at, useBy, madeBy, u.id).lastInsertRowid);
    db.exec('COMMIT');
    return { id, useBy, day };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const REASONS = ['expired', 'spilled', 'quality', 'other'];
const batchOr404 = (db, store, id) => db.prepare('SELECT * FROM prep_batches WHERE id = ? AND store_id = ?').get(Number(id), store) || bad(404, 'That batch isn’t here.');
/** Close a batch: whatever's left (after the waste just logged) was used. */
function close(db, x, bt, by) {
  if (bt.remaining > EPS) addEvent(db, x, { item: bt.item_id, batch: bt.id, kind: 'used', amount: bt.remaining, by });
  db.prepare('UPDATE prep_batches SET remaining = 0, closed_at = ? WHERE id = ?').run(now(), bt.id);
}
/**
 * Log waste from a batch. Past its use-by (or reason Expired), logging what's left clears the batch: the rest was used.
 * Otherwise (a spill, a bad batch) it only comes off what's left.
 */
export function logWaste(db, x, u, b) {
  const bt = batchOr404(db, x.store, b.batchId);
  if (bt.closed_at) bad(409, 'That batch is already cleared.');
  const amount = num(b.amount, { min: 0.01, max: 10000 });
  if (amount > bt.remaining + EPS) bad(400, `Only ${amt(bt.remaining, itemRow(db, x.store, bt.item_id).unit)} of that batch is left.`);
  const reason = REASONS.includes(b.reason) ? b.reason : bad(400, 'Pick a reason: Expired, Spilled, Quality or Other.');
  const note = cleanText(b.note, 200) || null;
  if (reason === 'other' && !note) bad(400, 'Say what happened.');
  db.exec('BEGIN');
  try {
    addEvent(db, x, { item: bt.item_id, batch: bt.id, kind: 'waste', amount, reason, note, by: u.id });
    const left = r2(bt.remaining - amount);
    const past = !!bt.use_by && bt.use_by < dayOf();
    if (past || reason === 'expired' || left <= EPS) close(db, x, { ...bt, remaining: left }, u.id);
    else db.prepare('UPDATE prep_batches SET remaining = ? WHERE id = ?').run(left, bt.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
/** Used Up: the whole of what's left was used. */
export function usedUp(db, x, u, id) {
  const bt = batchOr404(db, x.store, id);
  if (bt.closed_at) bad(409, 'That batch is already cleared.');
  db.exec('BEGIN');
  try { close(db, x, bt, u.id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}
/** A count of what's on hand: the drop since the last count was used, oldest batch first. */
export function count(db, x, u, itemId, value) {
  const it = itemOr404(db, x.store, itemId);
  const day = dayOf();
  const list = (openBatches(db, x.store).get(it.id) || []).filter((b) => !b.use_by || b.use_by >= day);
  const have = onHandOf(list, day);
  const v = num(value, { min: 0, max: 100000, name: 'count' });
  if (v > have + EPS) bad(400, `That’s more than the ${amt(have, it.unit)} logged. Log a batch for the rest.`);
  let drop = r2(have - v);
  db.exec('BEGIN');
  try {
    for (const b of list) {
      if (drop <= EPS) break;
      const take = Math.min(drop, b.remaining);
      addEvent(db, x, { item: it.id, batch: b.id, kind: 'used', amount: take, by: u.id });
      const left = r2(b.remaining - take);
      db.prepare('UPDATE prep_batches SET remaining = ?, closed_at = ? WHERE id = ?').run(left, left <= EPS ? now() : null, b.id);
      drop = r2(drop - take);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { onHand: v };
}
export function ranOut(db, x, u, itemId, note) {
  const it = itemOr404(db, x.store, itemId);
  addEvent(db, x, { item: it.id, kind: 'ranout', note: cleanText(note, 200) || null, by: u.id });
}

/** Add or change an item (managers). Every field is optional on a change. */
export function saveItem(db, x, u, id, b) {
  const old = id ? itemOr404(db, x.store, id) : null;
  const f = {};
  if (!old || b.name !== undefined) { f.name = cleanText(b.name, 60); if (!f.name) bad(400, 'Give it a name.'); }
  if (!old || b.kind !== undefined) { f.kind = KINDS.includes(b.kind) ? b.kind : bad(400, 'Pick juice, syrup or garnish.'); }
  if (!old || b.unit !== undefined) { f.unit = UNITS.includes(b.unit) ? b.unit : bad(400, 'Pick a unit: qt, pt, oz, each or bottles.'); }
  if (!old || b.batch !== undefined) f.batch = num(b.batch, { min: 0.01, max: 10000, name: 'batch size' });
  const unit = f.unit || old?.unit, batch = f.batch || old?.batch;
  if (!old || b.pars !== undefined) {
    if (!Array.isArray(b.pars) && old) bad(400, 'Pars need a number for each day.');
    f.pars = JSON.stringify(Array.isArray(b.pars) && b.pars.length === 7 ? b.pars.map((p) => num(p, { min: 0, max: 100000, name: 'par' })) : parsFor(batch, unit, batch));
  }
  if (b.shelfDays !== undefined) {
    const d = b.shelfDays === null || b.shelfDays === '' ? null : Number(b.shelfDays);
    if (d !== null && !(Number.isInteger(d) && d >= 0 && d <= 90)) bad(400, 'Shelf life is 0 (one shift) to 90 days.');
    if (!old || d !== old.shelf_days) {
      f.shelf_days = d;
      f.shelf_source = d == null ? null : `Set by ${u.name}, ${md(dayOf())}`;
    }
  } else if (!old) f.shelf_days = null;
  if (b.storage !== undefined) f.storage = cleanText(b.storage, 200) || null;
  if (b.ratio !== undefined) f.ratio = cleanText(b.ratio, 20) || null;
  if (b.yield !== undefined) f.yield_note = cleanText(b.yield, 120) || null;
  if (b.steps !== undefined) f.recipe = JSON.stringify((Array.isArray(b.steps) ? b.steps : []).map((s) => cleanText(s, 200)).filter(Boolean).slice(0, 20));
  if (f.name && (!old || f.name !== old.name)) {
    if (db.prepare('SELECT 1 FROM prep_items WHERE store_id = ? AND archived_at IS NULL AND name = ? COLLATE NOCASE AND id <> ?').get(x.store, f.name, old?.id ?? 0)) bad(409, `${f.name} is already on the list.`);
    if (!old || !old.seed_key) f.match = nameMatch(f.name);
  }
  const t = now();
  if (!old) {
    const sort = (db.prepare('SELECT MAX(sort) s FROM prep_items WHERE store_id = ?').get(x.store).s ?? -1) + 1;
    const cols = { company_id: x.company, store_id: x.store, ...f, sort, created_by: u.id, created_at: t, updated_by: u.id, updated_at: t };
    const keys = Object.keys(cols);
    const nid = Number(db.prepare(`INSERT INTO prep_items(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => cols[k])).lastInsertRowid);
    audit(db, u.id, 'add prep item', f.name, x.company);
    return nid;
  }
  const keys = Object.keys(f);
  if (keys.length) db.prepare(`UPDATE prep_items SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`).run(...keys.map((k) => f[k]), u.id, t, old.id);
  audit(db, u.id, 'edit prep item', f.name || old.name, x.company);
  return old.id;
}
/** Accept a suggested par (it's set), or Keep (that weekday's suggestion stays quiet for 14 days). */
export function answerSuggestion(db, x, u, id, b) {
  const it = itemOr404(db, x.store, id);
  const dow = Number(b.dow);
  if (!(Number.isInteger(dow) && dow >= 0 && dow <= 6)) bad(400, 'Pick a day.');
  if (b.action === 'accept') {
    const pars = parseJson(it.pars, []);
    pars[dow] = num(b.to, { min: 0, max: 100000, name: 'par' });
    db.prepare('UPDATE prep_items SET pars = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(pars), u.id, now(), it.id);
    audit(db, u.id, 'set prep par', `${it.name} · ${WEEKDAYS[dow]} · ${amt(pars[dow], it.unit)}`, x.company);
  } else if (b.action === 'keep') {
    const kept = parseJson(it.kept, {}); kept[dow] = dayOf();
    db.prepare('UPDATE prep_items SET kept = ? WHERE id = ?').run(JSON.stringify(kept), it.id);
  } else bad(400, 'Accept or Keep.');
}
export function archiveItem(db, x, u, id, on) {
  const it = itemOr404(db, x.store, id);
  if (on) {
    if (it.archived_at) return;
    db.prepare('UPDATE prep_items SET archived_at = ?, archived_by = ? WHERE id = ?').run(now(), u.id, it.id);
  } else {
    if (!it.archived_at) return;
    if (db.prepare('SELECT 1 FROM prep_items WHERE store_id = ? AND archived_at IS NULL AND name = ? COLLATE NOCASE').get(x.store, it.name)) bad(409, `There’s already a ${it.name} on the list.`);
    db.prepare('UPDATE prep_items SET archived_at = NULL, archived_by = NULL WHERE id = ?').run(it.id);
  }
  audit(db, u.id, (on ? 'archive' : 'restore') + ' prep item', it.name, x.company);
}
/** The Archived page's "Prep items" group. */
export function archivedItems(db, store) {
  return db.prepare('SELECT p.*, u.name by_name FROM prep_items p LEFT JOIN users u ON u.id = p.archived_by WHERE p.store_id = ? AND p.archived_at IS NOT NULL ORDER BY p.archived_at DESC').all(store)
    .map((p) => ({ id: p.id, name: p.name, at: p.archived_at, by: p.by_name || null, auto: false, kind: KIND_LABEL[p.kind].replace(/s$/, '') }));
}

/* ------------------------------------------------------------------ reports */
export const RANGES = ['day', 'week', 'year'];
/** The period a report covers, the one it's compared with, and the chart's buckets. */
export function periodFor(range, at = dayOf()) {
  if (range === 'day') {
    const prev = addDays(at, -1);
    return { from: at, to: at, prevFrom: prev, prevTo: prev, label: md(at), prevLabel: md(prev),
      buckets: Array.from({ length: 7 }, (_, i) => { const d = addDays(at, i - 6); return { key: d, from: d, to: d, label: SHORT[dowOf(d)], sub: md(d), prevFrom: addDays(d, -7), prevTo: addDays(d, -7), on: d === at }; }) };
  }
  if (range === 'year') {
    const y = +at.slice(0, 4);
    return { from: `${y}-01-01`, to: `${y}-12-31`, prevFrom: `${y - 1}-01-01`, prevTo: `${y - 1}-12-31`, label: String(y), prevLabel: String(y - 1),
      buckets: MONTHS.map((m, i) => { const mm = String(i + 1).padStart(2, '0'); const end = addDays(`${i === 11 ? y + 1 : y}-${i === 11 ? '01' : String(i + 2).padStart(2, '0')}-01`, -1);
        return { key: `${y}-${mm}`, from: `${y}-${mm}-01`, to: end, label: m, sub: String(y), prevFrom: `${y - 1}-${mm}-01`, prevTo: `${y - 1}${end.slice(4)}`.replace(`${y - 1}-02-29`, `${y - 1}-02-28`) }; }) };
  }
  const from = weekStart(at), to = addDays(from, 6), pf = addDays(from, -7), pt = addDays(from, -1);
  return { from, to, prevFrom: pf, prevTo: pt, label: rangeLabel(from, to), prevLabel: rangeLabel(pf, pt),
    buckets: Array.from({ length: 7 }, (_, i) => { const d = addDays(from, i); return { key: d, from: d, to: d, label: SHORT[dowOf(d)], sub: md(d), prevFrom: addDays(d, -7), prevTo: addDays(d, -7) }; }) };
}

/** Every batch made in [from, to] with what it went to. */
function batchesIn(db, store, from, to) {
  return db.prepare(`SELECT b.id, b.item_id, b.amount, b.remaining, b.day, b.closed_at,
      IFNULL((SELECT SUM(amount) FROM prep_events e WHERE e.batch_id = b.id AND e.kind = 'used'), 0) used,
      IFNULL((SELECT SUM(amount) FROM prep_events e WHERE e.batch_id = b.id AND e.kind = 'waste'), 0) wasted
    FROM prep_batches b WHERE b.store_id = ? AND b.day BETWEEN ? AND ?`).all(store, from, to);
}
const sumBy = (rows) => {
  const o = { made: 0, used: 0, wasted: 0, inUse: 0, batches: 0 };
  for (const r of rows) { o.made += r.amount; o.used += r.used; o.wasted += r.wasted; if (!r.closed_at) o.inUse += r.remaining; o.batches++; }
  for (const k of Object.keys(o)) o[k] = r2(o[k]);
  return o;
};
/** Waste as a whole percent of what was made (null when nothing was). */
export const pct = (wasted, made) => (made > 0 ? Math.round((wasted / made) * 100) : null);

/**
 * The report for a range (day | week | year) around `at`, for the chart's `series` (an item id, 'liquid' for juices and
 * syrups in quarts, or 'garnish' for garnishes in pieces). Every number is counted by the day a batch was made.
 */
export function report(db, storeRow, { range = 'week', at = '', series = '' } = {}) {
  ensureItems(db, storeRow);
  const store = storeRow.id;
  if (!RANGES.includes(range)) range = 'week';
  // No day picked: today, last full week (Week over Week compares whole weeks), this year.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) at = range === 'week' ? addDays(weekStart(dayOf()), -7) : dayOf();
  const P = periodFor(range, at);
  const items = db.prepare(`SELECT * FROM prep_items WHERE store_id = ? ORDER BY ${KIND_ORDER}, sort, id`).all(store);
  const cur = batchesIn(db, store, P.from, P.to), prev = batchesIn(db, store, P.prevFrom, P.prevTo);
  const ranCur = db.prepare(`SELECT e.*, i.name, u.name who FROM prep_events e JOIN prep_items i ON i.id = e.item_id LEFT JOIN users u ON u.id = e.by_user
    WHERE e.store_id = ? AND e.kind = 'ranout' AND e.day BETWEEN ? AND ? ORDER BY e.at DESC`).all(store, P.from, P.to);
  const ranPrev = db.prepare("SELECT COUNT(*) n FROM prep_events WHERE store_id = ? AND kind = 'ranout' AND day BETWEEN ? AND ?").get(store, P.prevFrom, P.prevTo).n;
  const shown = items.filter((i) => !i.archived_at || cur.some((b) => b.item_id === i.id));
  const rows = shown.map((i) => {
    const c = sumBy(cur.filter((b) => b.item_id === i.id)), p = sumBy(prev.filter((b) => b.item_id === i.id));
    const ran = ranCur.filter((e) => e.item_id === i.id);
    const w = pct(c.wasted, c.made), pw = pct(p.wasted, p.made);
    return { id: i.id, name: i.name, kind: i.kind, unit: i.unit, archived: !!i.archived_at, ...c, wastePct: w, prevWastePct: pw,
      vsPrev: w == null || pw == null ? null : w - pw, ranOut: ran.length, ranOutDays: [...new Set(ran.map((e) => SHORT[dowOf(e.day)]))] };
  });
  // Tiles: juices + syrups in quarts, garnishes in pieces. Other units only show in the table (never added together).
  const group = (pred) => {
    const ids = new Set(items.filter(pred).map((i) => i.id));
    const c = sumBy(cur.filter((b) => ids.has(b.item_id))), p = sumBy(prev.filter((b) => ids.has(b.item_id)));
    return { made: c.made, wasted: c.wasted, pct: pct(c.wasted, c.made), prevPct: pct(p.wasted, p.made), items: ids.size };
  };
  const liquid = group((i) => i.kind !== 'garnish' && i.unit === 'qt');
  const garnish = group((i) => i.kind === 'garnish' && i.unit === 'each');
  // The chart
  const pick = series === 'liquid' || series === 'garnish' ? series : items.find((i) => String(i.id) === String(series) && !i.archived_at) ? Number(series) : (items.find((i) => !i.archived_at)?.id ?? 'liquid');
  const inSeries = typeof pick === 'number' ? (b) => b.item_id === pick
    : pick === 'liquid' ? ((ids) => (b) => ids.has(b.item_id))(new Set(items.filter((i) => i.kind !== 'garnish' && i.unit === 'qt').map((i) => i.id)))
      : ((ids) => (b) => ids.has(b.item_id))(new Set(items.filter((i) => i.kind === 'garnish' && i.unit === 'each').map((i) => i.id)));
  const seriesUnit = typeof pick === 'number' ? items.find((i) => i.id === pick).unit : pick === 'liquid' ? 'qt' : 'each';
  const wide = batchesIn(db, store, P.buckets[0].prevFrom < P.prevFrom ? P.buckets[0].prevFrom : P.prevFrom, P.buckets[P.buckets.length - 1].to).filter(inSeries);
  const ranAll = db.prepare(`SELECT item_id, day, at FROM prep_events WHERE store_id = ? AND kind = 'ranout' AND day BETWEEN ? AND ? ORDER BY at`).all(store, P.buckets[0].from, P.buckets[P.buckets.length - 1].to);
  const chart = P.buckets.map((k) => {
    const s = sumBy(wide.filter((b) => b.day >= k.from && b.day <= k.to));
    const ps = sumBy(wide.filter((b) => b.day >= k.prevFrom && b.day <= k.prevTo));
    const ro = ranAll.filter((e) => e.day >= k.from && e.day <= k.to && (typeof pick === 'number' ? e.item_id === pick : inSeries({ item_id: e.item_id })));
    return { key: k.key, label: k.label, sub: k.sub, on: !!k.on, made: s.made, used: s.used, wasted: s.wasted, inUse: s.inUse, prevUsed: ps.batches ? ps.used : null,
      ranOutAt: ro.length ? ro[0].at : null, ranOut: ro.length };
  });
  // Busiest days: batches made per weekday, the 4 weeks to the end of this period (all items).
  const end = P.to > dayOf() ? dayOf() : P.to;
  const busy = Array(7).fill(0);
  for (const r of db.prepare('SELECT day, COUNT(*) n FROM prep_batches WHERE store_id = ? AND day > ? AND day <= ? GROUP BY day').all(store, addDays(end, -28), end)) busy[dowOf(r.day)] += r.n;
  const busiest = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ dow: d, label: SHORT[d], batches: r2(busy[d] / 4) }));
  const first = firstDay(db, store);
  const out = {
    store: storeRow.name, range, at, today: dayOf(), period: { from: P.from, to: P.to, label: P.label, prevFrom: P.prevFrom, prevTo: P.prevTo, prevLabel: P.prevLabel },
    tiles: { liquid, garnish, ranOut: { count: ranCur.length, prev: ranPrev }, batches: { count: cur.length, prev: prev.length } },
    ranOut: ranCur.map((e) => ({ item: e.name, itemId: e.item_id, at: e.at, day: e.day, note: e.note || '', by: e.who || null })),
    rows, series: { id: pick, unit: seriesUnit, options: [...items.filter((i) => !i.archived_at).map((i) => ({ id: i.id, label: i.name })), { id: 'liquid', label: 'All juices and syrups (qt)' }, { id: 'garnish', label: 'All garnishes (pieces)' }] },
    chart, busiest, started: first,
    // Year over year needs logs from a year before this period started (no made-up history).
    lastYear: !!first && first <= (range === 'year' ? P.prevTo : addDays(P.from, -364)),
    periods: periodList(range, at, first),
  };
  out.summary = summaryText(out);
  return out;
}
/** The periods to pick from: back to the first log (at most 14 days, 12 weeks, every year). */
function periodList(range, at, first) {
  const today = dayOf(), out = [];
  const start = first || today;
  if (range === 'day') for (let i = 0; i < 14; i++) { const d = addDays(today, -i); if (d < start && i) break; out.push({ at: d, label: i === 0 ? `Today · ${md(d)}` : `${SHORT[dowOf(d)]} ${md(d)}` }); }
  else if (range === 'week') for (let i = 0; i < 12; i++) { const f = addDays(weekStart(today), -7 * i); if (addDays(f, 6) < start && i) break; out.push({ at: f, label: `${i === 0 ? 'This week so far · ' : ''}${rangeLabel(f, addDays(f, 6))} vs ${rangeLabel(addDays(f, -7), addDays(f, -1))}` }); }
  else for (let y = +today.slice(0, 4); y >= +start.slice(0, 4); y--) out.push({ at: `${y}-01-01`, label: `${y} vs ${y - 1}` });
  return out;
}
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** The words the summary card in Team Chat starts with (a manager can edit them before sending). */
export function summaryText(r) {
  const parts = [];
  const t = r.tiles;
  const change = (g) => (g.prevPct == null || g.pct == null ? '' : g.pct === g.prevPct ? ', same as before' : ` (${g.pct < g.prevPct ? 'down' : 'up'} from ${g.prevPct}%)`);
  if (t.liquid.made) parts.push(`juices and syrups ${t.liquid.pct}% wasted${change(t.liquid)}`);
  if (t.garnish.made) parts.push(`garnishes ${t.garnish.pct}%${change(t.garnish)}`);
  let s = `Prep, ${r.period.label}: ${parts.length ? parts.join(', ') + '.' : 'nothing logged yet.'}`;
  if (r.ranOut.length) {
    const byDay = new Map();
    for (const e of r.ranOut) { const d = WEEKDAYS[dowOf(e.day)]; if (!byDay.has(d)) byDay.set(d, new Set()); byDay.get(d).add(e.item.toLowerCase()); }
    s += ` We ran out ${r.ranOut.length === 1 ? 'once' : r.ranOut.length + ' times'}: ${list([...byDay].map(([d, xs]) => `${list([...xs])} on ${d}`))}.`;
  } else if (parts.length) s += ' Nothing ran out.';
  return s;
}

/** Post the summary to #Bar as a card that opens the report. Managers only; they have to be on the store's chat. */
export function sendSummary(db, c, u, b) {
  const x = chatCtx(db, c);
  if (!x) bad(403, 'Team Chat is for the people who work at this store.');
  const range = RANGES.includes(b.range) ? b.range : 'week';
  const r = report(db, c.storeRow, { range, at: b.at });
  const body = cleanText(b.body, 1500) || r.summary;
  try {
    const room = resolveRoom(x, 'bar', { create: true });
    const id = postMessage(x, room, { body, page: `prep/reports?range=${range}&at=${r.period.from}` });
    audit(db, u.id, 'send prep report', r.period.label, c.company);
    return { id, room: 'bar' };
  } catch (e) { if (e instanceof ChatError) bad(e.status, e.message); throw e; }
}

/* Send to Team: prep pages as chat cards ("prep", "prep/reports?…", "prep/item/12"). */
addCardSource((db, storeRow, slug) => {
  if (!/^prep(\/|\?|$)/.test(slug)) return undefined;
  if (!storeRow) return null;
  const [p, q = ''] = slug.split('?');
  const qs = new URLSearchParams(q);
  if (p === 'prep') return { slug: 'prep', title: 'Bar Prep', kicker: 'Prep', kind: 'Prep list', thumb: null, line: 'Today’s prep list: what to make, what to use first.' };
  if (p === 'prep/reports') {
    const r = report(db, storeRow, { range: qs.get('range') || 'week', at: qs.get('at') || undefined });
    const line = r.summary.replace(/^Prep, [^:]+: /, '');
    return { slug, title: `Prep report · ${r.period.label}`, kicker: 'Prep', kind: 'Prep report', thumb: null, line: line.length > 90 ? line.slice(0, 88).replace(/\s+\S*$/, '') + '…' : line };
  }
  const m = /^prep\/item\/(\d+)$/.exec(p);
  const it = m && itemRow(db, storeRow.id, m[1]);
  if (!it || it.archived_at) return null;
  const pars = parseJson(it.pars, []);
  return { slug: p, title: it.name, kicker: 'Prep', kind: 'Prep item', thumb: null, line: `${shelfWords(it.shelf_days)} · par today ${amt(pars[dowOf(dayOf())] || 0, it.unit)}` };
});

/* ------------------------------------------------------------------ the demo's 8 weeks */
// A small deterministic random, so every demo copy shows the same believable weeks.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/**
 * Eight weeks of logs for a demo store (labelled demo data on screen). Bartenders make each item's batch in the
 * afternoon; the night uses most of it (Saturdays sometimes more than the par, so it runs out; Wednesdays less, so juice
 * gets tossed); yesterday's leftovers are cleared the next afternoon, as waste if past the use-by. A spill now and then.
 */
export function seedDemoPrep(db, { company, storeRow, bartenders = [], lead = null, days = 56 }) {
  ensureItems(db, storeRow);
  const store = storeRow.id;
  const items = itemsOf(db, store);
  const makers = [...bartenders, ...(lead ? [lead] : [])];
  if (!items.length || !makers.length) return;
  const rand = rng(store * 7919 + 17);
  const today = dayOf();
  const hourNow = +new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
  const insB = db.prepare('INSERT INTO prep_batches(company_id, store_id, item_id, amount, remaining, day, made_at, use_by, made_by, by_user, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const insE = db.prepare('INSERT INTO prep_events(company_id, store_id, item_id, batch_id, kind, amount, reason, note, day, at, by_user) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const setB = db.prepare('UPDATE prep_batches SET remaining = ?, closed_at = ? WHERE id = ?');
  const ev = (it, bid, kind, amount, at, by, reason = null, note = null) => insE.run(company, store, it.id, bid, kind, r2(amount), reason, note, dayOf(at), at, by);
  // The opener by weekday: two bartenders split the week (Mon · Thu · Sun and Tue · Wed · Fri · Sat); the manager covers
  // now and then.
  const opener = (dow) => makers[[0, 0, 1, 1, 0, 1, 1][dow] % Math.max(1, bartenders.length || makers.length)];
  const maker = (dow, n, i) => (lead && (n + i) % 9 === 4 ? lead : opener(dow));
  // Amounts as people log them: whole pieces, quarter quarts.
  const real = (v, unit) => (unit === 'each' || unit === 'bottles' ? Math.round(v) : Math.round(v * 4) / 4);
  const open = new Map(items.map((i) => [i.id, []]));
  const notes = ['out for the last hour of service', 'a big party at the bar', 'cut more mid-shift'];
  let keptOne = 0;
  const stamp = (day, h, m) => { const t = detroitAt(day, h, m); return Date.parse(t) > Date.now() ? null : t; };
  for (let i = days; i >= 0; i--) {
    const day = addDays(today, -i), dow = dowOf(day), isToday = i === 0;
    const by = opener(dow);
    items.forEach((it, n) => {
      const pars = parseJson(it.pars, []);
      const par = Number(pars[dow]) || 0;
      const list = open.get(it.id);
      // 1. Clear what's past its use-by (today: leave the first juice and one garnish for the Use First card).
      const clearAt = stamp(day, 15, 5 + n * 2) || (isToday ? new Date(Date.now() - (75 - n) * 60e3).toISOString() : detroitAt(day, 15, 5));
      for (const b of [...list]) {
        if (b.use_by >= day) continue;
        if (isToday && (n === 0 || (it.kind === 'garnish' && it.shelf_days === 0 && !keptOne++))) continue;
        const at = clearAt;
        if (b.remaining > EPS) {
          ev(it, b.id, 'waste', b.remaining, at, by, 'expired');
          setB.run(0, at, b.id);
        } else setB.run(0, at, b.id);
        list.splice(list.indexOf(b), 1);
      }
      // 2. Make today's batch: par minus what's on hand, rounded up to whole batches.
      const have = r2(list.filter((b) => b.use_by >= day).reduce((s, b) => s + b.remaining, 0));
      const need = toMake(par, have, it.batch);
      const madeAt = isToday ? (hourNow >= 15 ? stamp(day, 14, 40 + n) : (n === 1 || n === 3) && hourNow >= 1 ? new Date(Date.now() - (50 - n * 10) * 60e3).toISOString() : null) : detroitAt(day, 14, 30 + n * 3);
      if (need > 0 && madeAt) {
        const who = maker(dow, n, i);
        const id = Number(insB.run(company, store, it.id, need, need, day, madeAt, useByFor(it.shelf_days, day), who, who, null).lastInsertRowid);
        list.push({ id, amount: need, remaining: need, day, use_by: useByFor(it.shelf_days, day) ?? '9999-12-31', made_at: madeAt });
      }
      if (isToday && hourNow < 18) return; // tonight hasn't happened yet
      // 3. The night: Saturdays run hot, Wednesdays slow.
      const lean = dow === 6 ? 0.98 + rand() * 0.16 : dow === 3 ? 0.5 + rand() * 0.18 : 0.74 + rand() * 0.22;
      const share = it.kind === 'syrup' ? 0.45 : 1; // a syrup batch lasts a few nights
      let demand = real(par * lean * share, it.unit);
      const usable = list.filter((b) => b.use_by >= day && b.remaining > EPS);
      const onHand = usable.reduce((s, b) => s + b.remaining, 0);
      // A spill now and then (2 in 100 batches), off the newest batch.
      const fresh = usable[usable.length - 1];
      const garn = it.kind === 'garnish';
      if (fresh && rand() < (garn ? 0.18 : 0.03)) {
        const sp = r2(Math.min(fresh.remaining, garn ? 2 + Math.floor(rand() * 5) : 0.25));
        ev(it, fresh.id, 'waste', sp, detroitAt(day, 19, 10), by, garn || rand() < 0.5 ? 'quality' : 'spilled', null);
        fresh.remaining = r2(fresh.remaining - sp); setB.run(fresh.remaining, fresh.remaining <= EPS ? detroitAt(day, 19, 10) : null, fresh.id);
      }
      if (demand > onHand + EPS && it.kind !== 'syrup' && par > 0) {
        const late = dow === 6 || dow === 5;
        if (late && rand() < 0.75) ev(it, null, 'ranout', 0, detroitAt(day, 20 + Math.floor(rand() * 2), Math.floor(rand() * 50)), by, null, notes[Math.floor(rand() * notes.length)]);
        demand = onHand;
      }
      // Use it up oldest first. A batch that runs dry is closed as Used Up.
      for (const b of usable) {
        if (demand <= EPS) break;
        const take = r2(Math.min(b.remaining, demand));
        demand = r2(demand - take);
        b.remaining = r2(b.remaining - take);
        if (b.remaining <= EPS) {
          const at = detroitAt(day, 22, 30);
          ev(it, b.id, 'used', b.amount - sumWaste(db, b.id), at, by);
          setB.run(0, at, b.id);
          list.splice(list.indexOf(b), 1);
        } else setB.run(b.remaining, null, b.id);
      }
    });
  }
  // Batches cleared as waste: the part that wasn't wasted was used.
  for (const b of db.prepare(`SELECT b.* FROM prep_batches b WHERE b.store_id = ? AND b.closed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prep_events e WHERE e.batch_id = b.id AND e.kind = 'used')`).all(store)) {
    const used = r2(b.amount - sumWaste(db, b.id));
    if (used > EPS) insE.run(company, store, b.item_id, b.id, 'used', used, null, null, dayOf(b.closed_at), b.closed_at, b.made_by);
  }
}
const sumWaste = (db, id) => db.prepare("SELECT IFNULL(SUM(amount),0) n FROM prep_events WHERE batch_id = ? AND kind = 'waste'").get(id).n;
