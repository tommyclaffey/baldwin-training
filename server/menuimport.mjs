// AI menu import (Nov 14; Figma 09 · Proposals → 30, 607:812. Tommy, Nov 12: "take the food matrix, the wine bible, and the
// cocktail list … take that information and distribute it everywhere it needs to go").
//
// The flow Tommy agreed (Nov 12): upload → the AI reads it → a manager reviews it (allergens are always "Please confirm") →
// approve → it spreads to the Food Matrix, the Allergen Guide, the dish pages, the wine list, search. Quizzes stay
// rules-based (server/quizgen.mjs builds them from the approved data). The AI only drafts selling lines, say-it lines and
// talking points; those wait as DRAFT until a manager approves each one.
//
//   1. Upload   a manager picks the menu type (Food Book · Wine List · Cocktail List) and adds PDFs or photos.
//   2. Read     one call to the Claude API with every page. The answer streams in, so the loading screen shows each dish as
//               it's found (real progress, never a timer). Nothing is in the book yet.
//   3. Review   each item is matched by name to the store's book: New, Updated (with what changes) or Unchanged. Dishes in the
//               book that aren't in the file show as "Not in this file" (Keep is the default; nothing is archived on its own).
//               Approve writes one item into the book. A food item can't be approved until its allergens are confirmed,
//               and a price the reader flagged as hard to read has to be checked first.
//   4. Done     what went where, the drafts waiting on a manager, and Undo This Import (archives what it added and puts
//               updated dishes back the way they were; nothing is deleted).
//
// Decisions (Nov 14, from the lead): owners and managers import; dishes missing from a new file are never archived on their
// own; nothing is posted to Team Chat. Imports belong to one store of one company, like the rest of the book.
// The demos (/demo/brg, /demo/mise) read a sample menu with a canned reading, so they never spend API credit, and their
// imports go with the demo (server/demo.mjs drops every table with a company_id).
//
// Tables are made here with CREATE TABLE IF NOT EXISTS (like program_acks), not a numbered migration, so this branch can't
// collide with a migration added on another branch at the same time.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, now, audit } from './db.mjs';
import { COLLECTIONS, ALLERGENS, cleanEntry, listEntries, getEntry, createEntry, updateEntry, archiveEntry, restoreEntry, sharedWith } from './cms.mjs';
import { questionPool } from './quizgen.mjs';

export const IMPORT_DIR = path.join(DATA_DIR, 'imports');
const MODEL = 'claude-opus-5-5';
const API_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_FILES = 20;
const MAX_FILE = 25e6; // one file
const MAX_PDF_TOTAL = 20e6; // every PDF together: the request (base64) has to stay under the API's 32 MB
const READ_TIMEOUT_MS = 8 * 60e3;

/** The three menu types. `compare` = the fields an update can change; `drafts` = what the AI writes for a manager to approve. */
export const KINDS = {
  food: { collection: 'recipe', label: 'Food Book', one: 'dish', many: 'dishes', group: 'course', allergens: true,
    fields: ['course', 'price', 'description', 'ingredients', 'allergens', 'gfOption'],
    compare: ['course', 'price', 'description', 'ingredients', 'allergens'],
    drafts: [['sellingLine', 'Selling line'], ['say', 'Say-it line'], ['talkingPoints', 'Talking points']] },
  wine: { collection: 'wine', label: 'Wine List', one: 'wine', many: 'wines', group: 'country', allergens: false,
    fields: ['grape', 'region', 'country', 'color', 'list', 'glass', 'half', 'bottle', 'size', 'style', 'notes'],
    compare: ['grape', 'region', 'country', 'color', 'list', 'glass', 'half', 'bottle', 'size', 'style', 'notes'],
    drafts: [['say', 'Say-it line']] },
  cocktail: { collection: 'house', label: 'Cocktail List', one: 'drink', many: 'drinks', group: 'menuSection', allergens: false,
    fields: ['menuSection', 'price', 'glass', 'method', 'ice', 'garnish', 'base', 'build', 'tableLine', 'description'],
    compare: ['menuSection', 'price', 'glass', 'method', 'ice', 'garnish', 'base', 'build', 'tableLine', 'description'],
    drafts: [['say', 'Say-it line']] },
};
const LABELS = { course: 'Course', price: 'Price', description: 'Description', ingredients: 'Ingredients', allergens: 'Allergens', gfOption: 'Gluten-free option',
  grape: 'Grape', region: 'Region', country: 'Country', color: 'Colour', list: 'On the list', glass: 'Glass', half: '½ bottle', bottle: 'Bottle', size: 'Size',
  style: 'Style', notes: 'Notes', menuSection: 'Menu section', method: 'Method', ice: 'Ice', garnish: 'Garnish', base: 'Base spirit', build: 'Spec', tableLine: 'What’s in it' };
const PRICEY = new Set(['price', 'glass', 'half', 'bottle']);
const LISTY = new Set(['ingredients', 'allergens']);
/** The Baldwin group's own house-cocktail sections; a Mise-brand company doesn't get them (same rule as /api/collections). */
const BALDWIN_SECTIONS = new Set(['BRG Staples', 'Barra Cart']);

/* ------------------------------------------------------------------ tables */
export function migrateImports(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS menu_imports(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT NOT NULL,
    kind TEXT NOT NULL, title TEXT, status TEXT NOT NULL, error TEXT, files TEXT NOT NULL DEFAULT '[]', pages INT NOT NULL DEFAULT 0,
    demo INT NOT NULL DEFAULT 0, created_by INT, created_at TEXT, updated_at TEXT, read_at TEXT, finished_by INT, finished_at TEXT,
    undone_by INT, undone_at TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS menu_imports_store ON menu_imports(store_id, id)');
  db.exec(`CREATE TABLE IF NOT EXISTS menu_import_items(id INTEGER PRIMARY KEY, import_id INT NOT NULL, company_id INT NOT NULL,
    store_id INT NOT NULL, seq INT NOT NULL, page INT, grp TEXT, name TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT '{}', changes TEXT NOT NULL DEFAULT '[]', entry_id INT, allergens_ok INT NOT NULL DEFAULT 0,
    price_ok INT NOT NULL DEFAULT 1, decision TEXT NOT NULL DEFAULT 'pending', result_entry INT, created_lib INT, before TEXT,
    drafts TEXT NOT NULL DEFAULT '[]', decided_by INT, decided_at TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS menu_import_items_import ON menu_import_items(import_id, seq)');
  // A read can't survive a restart (it runs in this process): say so, and keep the files so it can be read again.
  db.prepare("UPDATE menu_imports SET status = 'failed', error = ? WHERE status = 'reading'").run('The read was interrupted. Read it again.');
}

/* ------------------------------------------------------------------ small helpers */
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const str = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Names match when they read the same: case, accents, "&"/"and" and punctuation don't count. */
export const normName = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const normPrice = (s) => String(s ?? '').replace(/[^0-9.]/g, '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
const normText = (s) => normName(s);
const listKey = (v) => (Array.isArray(v) ? v : []).map((x) => normName(typeof x === 'object' ? `${x.amount || ''} ${x.ingredient || ''}` : x)).filter(Boolean);
const empty = (v) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length);
/** Same value, as far as the book is concerned. */
function same(field, a, b) {
  if (PRICEY.has(field)) return normPrice(a) === normPrice(b);
  if (LISTY.has(field)) { const x = new Set(listKey(a)), y = new Set(listKey(b)); return x.size === y.size && [...x].every((k) => y.has(k)); }
  if (field === 'build') return JSON.stringify(listKey(a)) === JSON.stringify(listKey(b));
  return normText(a) === normText(b);
}
// The server's own error type (passed in by importRoutes) so the message reaches the screen; plain errors with a status otherwise.
let raise = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const fail = (status, message) => raise(status, message);
const pdfPages = (buf) => Math.max(1, (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length);

/* ------------------------------------------------------------------ reading: the Claude API */

/** What the reader is asked to send back: one schema per menu type (structured outputs). */
export function schemaFor(kind, opts = {}) {
  const S = { type: 'string' }, B = { type: 'boolean' }, A = (items) => ({ type: 'array', items });
  const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
  const extra = kind === 'food' ? {
    course: { type: 'string', enum: COLLECTIONS.recipe.group.values },
    ingredients: A(S),
    gfOption: B,
    allergens: A(obj({ name: { type: 'string', enum: ALLERGENS }, printed: B, quote: S })),
  } : kind === 'wine' ? {
    grape: S, region: S,
    country: { type: 'string', enum: COLLECTIONS.wine.fields.find((f) => f.key === 'country').options },
    color: { type: 'string', enum: COLLECTIONS.wine.fields.find((f) => f.key === 'color').options },
    list: { type: 'string', enum: COLLECTIONS.wine.group.values },
    glass: S, half: S, bottle: S, size: S, style: S, notes: S,
  } : {
    menuSection: { type: 'string', enum: opts.sections || COLLECTIONS.house.group.values },
    glass: S, method: S, ice: S, garnish: S, base: S, tableLine: S,
    build: A(obj({ amount: S, ingredient: S })),
  };
  const drafts = kind === 'food' ? obj({ sellingLine: S, say: S, talkingPoints: A(S) }) : obj({ say: S });
  const item = obj({ page: { type: 'integer' }, section: S, name: S, price: S, priceUnclear: B, description: S, lines: A(S), ...extra, drafts });
  return obj({ title: S, pageCount: { type: 'integer' }, items: A(item) });
}

const SYSTEM = `You read restaurant menus for Mise, a training app for restaurant staff. A manager uploads their menu; you transcribe what is printed so it can go into the staff training book after the manager checks every item.
Rules:
- Only report what is printed. Never invent a dish, a price, an ingredient or a description. If something isn't on the page, leave it empty.
- Pages are numbered from 1 across every file, in the order the files are given (each photo is one page).
- "lines" are the item's lines exactly as printed (name and price line, description, any "contains" line), so a manager can find it on the page.
- Prices: the number only, as printed ("36", "12.5"). If a price is smudged, cut off or hard to read, give your best reading and set priceUnclear to true.
- The item's "section" is the heading it sits under, as printed.`;

function instructions(kind, opts) {
  if (kind === 'food') return `This is a food menu (the "${opts.title || 'Food Book'}"). List every dish, in page order.
For each dish: course = the closest of the given courses to the printed section; ingredients = the main ingredients named on the page (short, Title Case not needed); gfOption = true only if the page offers a gluten-free version.
Allergens: use only these names: ${ALLERGENS.join(', ')}. Shellfish includes molluscs (octopus, squid, clams, mussels, oysters, scallops). Allium = onion, garlic, shallot, leek, chive, scallion. Nightshade = tomato, pepper (not black pepper), potato, eggplant, paprika, chili.
For each allergen: printed = true only when the page itself states it (a "contains …" line, an allergen key or icon); quote = those printed words. When you work it out from an ingredient instead, printed = false and quote = the ingredient words (e.g. "pickled shallot"). Include every allergen you can find either way; the manager confirms each one.
Drafts (a manager reviews these before staff see them; keep them true to the menu text, no claims about sourcing, awards or popularity): sellingLine = one sentence a server could say to sell the dish before it's ordered; say = one sentence to say when setting it down; talkingPoints = up to 3 short facts taken from the menu text.`;
  if (kind === 'wine') return `This is a wine list. List every wine, in page order. name = producer and label as printed. grape = the grape or style as printed; region as printed; country = the closest of the given options ("Around the world" for anything outside the USA, Italy and France); color: White, Red, Bubbles (sparkling, Champagne, rosé sparkling) or Sake (rosé still wines are White); list = where it sits: By the glass, By the bottle, Bubbles, or Sommelier selection if the page calls it that. glass/half/bottle = those prices; price = the glass price if there is one, else the bottle price. size = a size note if printed (375 ml, split). style = a short style word if printed. notes = tasting notes if printed.
Drafts (a manager reviews this first; true to the list text, no claims about scores or awards): say = one sentence a server could say about the wine at the table.`;
  return `This is a cocktail list or a set of cocktail specs. List every drink, in page order. menuSection = the closest of the given sections. build = each spec line as amount + ingredient (leave amount empty if none is printed). glass, method (shaken, stirred, built…), ice, garnish as printed; base = the main spirit (empty for spiritless drinks); tableLine = a short "what's in it" list if the menu gives one; description = the menu description.
Drafts (a manager reviews this first; true to the menu text): say = one sentence a server could say to sell the drink.`;
}

/** Plain-English errors for the manager. The detail goes to the server log. */
const UNAVAILABLE = 'The menu reader isn’t available right now. Your files are saved here, so you can read them later.';
const BUSY = 'The menu reader is busy right now. Your files are saved here. Try again in a few minutes.';
class ReadError extends Error { constructor(message, detail) { super(message); this.detail = detail; } }

/**
 * Items whose JSON object has fully arrived, from a partial answer (the stream so far). Lets the loading screen show each
 * dish as soon as it's read.
 */
export function partialItems(text) {
  const at = text.search(/"items"\s*:\s*\[/);
  if (at < 0) return [];
  let i = text.indexOf('[', at) + 1, depth = 0, start = -1, inStr = false, esc = false;
  const out = [];
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* not whole yet */ } start = -1; } }
    else if (ch === ']' && depth === 0) break;
  }
  return out;
}
/** The whole answer as JSON (it may come wrapped in a code fence if the JSON format was refused). */
export function parseAnswer(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

/** Reads the SSE stream from the Messages API, calling onText with the answer so far. Returns { text, stop }. */
async function readStream(res, onText) {
  const dec = new TextDecoder();
  let buf = '', text = '', stop = null, errMsg = null;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let k;
    while ((k = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, k); buf = buf.slice(k + 2);
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'fallback') { text = ''; onText(text); } // another model takes over: its answer starts fresh
      else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { text += ev.delta.text; onText(text); }
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
      else if (ev.type === 'error') errMsg = ev.error?.type || 'stream error';
    }
  }
  if (errMsg) throw new ReadError(/overload|rate/i.test(errMsg) ? BUSY : UNAVAILABLE, errMsg);
  return { text, stop };
}

/**
 * Sends the files to the Claude API and returns { title, pageCount, items }. `onItems(items)` is called as dishes arrive.
 * The key is ANTHROPIC_API_KEY (on Railway). No key, no credit, a bad key, a rate limit or a network error all come back as
 * a ReadError with a plain message; nothing is thrown past the import.
 */
export async function readWithClaude({ files, kind, title, sections, signal, onItems = () => {} }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ReadError(UNAVAILABLE, 'ANTHROPIC_API_KEY is not set');
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const content = [];
  let page = 1;
  for (const f of files) {
    const data = fs.readFileSync(f.path).toString('base64');
    const pages = f.mime === 'application/pdf' ? f.pages : 1;
    content.push({ type: 'text', text: `File: ${f.name} (page${pages > 1 ? `s ${page}–${page + pages - 1}` : ` ${page}`})` });
    content.push(f.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
    page += pages;
  }
  content.push({ type: 'text', text: instructions(kind, { title }) + '\nAnswer with the JSON only.' });
  // Server-side fallback (a declined request is re-run on another model inside the same call) and the JSON schema are both
  // asked for; if this account's API rejects either, the read retries once without it rather than failing.
  let useFallback = true, useFormat = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    const body = { model: MODEL, max_tokens: 32000, stream: true, system: SYSTEM, messages: [{ role: 'user', content }],
      output_config: { effort: 'medium', ...(useFormat ? { format: { type: 'json_schema', schema: schemaFor(kind, { sections }) } } : {}) },
      ...(useFallback ? { fallbacks: 'default' } : {}) };
    let res;
    try {
      res = await fetch(base + '/v1/messages', { method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]) : AbortSignal.timeout(READ_TIMEOUT_MS),
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION, ...(useFallback ? { 'anthropic-beta': FALLBACK_BETA } : {}) },
        body: JSON.stringify(body) });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ReadError(BUSY, 'network: ' + e.message);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const msg = (J(errText, {})?.error?.message || errText || '').slice(0, 300);
      if (res.status === 400 && useFallback && /fallback|beta/i.test(msg)) { useFallback = false; continue; }
      if (res.status === 400 && useFormat && /output_config|format|schema/i.test(msg)) { useFormat = false; continue; }
      if (res.status === 429 || res.status === 529 || res.status >= 500) throw new ReadError(BUSY, `${res.status} ${msg}`);
      throw new ReadError(UNAVAILABLE, `${res.status} ${msg}`); // 401/403 (key), 400 credit balance too low, anything else
    }
    let seen = 0;
    const { text, stop } = await readStream(res, (t) => { const items = partialItems(t); if (items.length !== seen) { seen = items.length; onItems(items); } });
    if (stop === 'refusal') throw new ReadError('The menu reader couldn’t read this file. Check it’s a menu, or try clearer photos.', 'refusal');
    const out = parseAnswer(text);
    if (!out || !Array.isArray(out.items)) {
      if (stop === 'max_tokens') throw new ReadError('That menu is too long to read in one go. Split it into smaller files and import each one.', 'max_tokens');
      throw new ReadError('We couldn’t make sense of that file. Try a PDF, or clearer photos with one page each.', 'unparseable answer');
    }
    return out;
  }
  throw new ReadError(UNAVAILABLE, 'retries used up');
}

/* ------------------------------------------------------------------ the demo's sample menu (no API call) */
// Made-up dishes added by the sample menu (both demos). Labelled as a sample on screen.
const SAMPLE_NEW = [
  { section: 'Small Plates', course: 'Snacks & Small Plates', name: 'Charred Octopus', price: '19', description: 'Grilled octopus over warm chickpeas with smoked paprika, garlic and lemon.',
    ingredients: ['Octopus', 'Chickpeas', 'Smoked paprika', 'Garlic', 'Lemon'], printed: ['Shellfish'], inferred: [['Allium', 'garlic'], ['Nightshade', 'smoked paprika']],
    drafts: { sellingLine: 'If you like something smoky to share, the octopus is tender, charred at the edges and bright with lemon.', say: 'Charred octopus over warm chickpeas, with smoked paprika and lemon.', talkingPoints: ['Grilled, then served over warm chickpeas', 'Smoked paprika and garlic', 'Finished with lemon'] } },
  { section: 'Salads', course: 'Salads', name: 'Delicata Squash Salad', price: '14', description: 'Roasted delicata squash, farro, pepitas and goat cheese with a maple vinaigrette.',
    ingredients: ['Delicata squash', 'Farro', 'Pepitas', 'Goat cheese', 'Maple vinaigrette'], printed: ['Dairy'], inferred: [['Gluten', 'farro']],
    drafts: { sellingLine: 'For something lighter, the squash salad has roasted squash, chewy farro and creamy goat cheese.', say: 'Delicata squash salad with farro, pepitas and goat cheese, and a maple vinaigrette.', talkingPoints: ['Roasted delicata squash', 'Farro and toasted pepitas', 'Maple vinaigrette'] } },
  { section: 'Mains', course: 'Mains', name: 'Roast Duck Breast', price: '38', priceUnclear: true, description: 'Roast duck breast with parsnip purée, braised greens and a cherry jus.',
    ingredients: ['Duck breast', 'Parsnip purée', 'Braised greens', 'Cherry jus'], printed: ['Dairy'], inferred: [['Allium', 'cherry jus (shallot)']],
    drafts: { sellingLine: 'The duck is roasted to order and comes with a sweet-tart cherry jus that cuts the richness.', say: 'Roast duck breast, parsnip purée and braised greens, with a cherry jus.', talkingPoints: ['Roasted duck breast', 'Silky parsnip purée', 'Cherry jus'] } },
  { section: 'Mains', course: 'Mains', name: 'Butternut Agnolotti', price: '24', description: 'Hand-pinched pasta filled with butternut squash, with brown butter, sage and parmesan.',
    ingredients: ['Fresh pasta', 'Butternut squash', 'Brown butter', 'Sage', 'Parmesan'], printed: ['Gluten', 'Dairy', 'Egg'], inferred: [],
    drafts: { sellingLine: 'If you want pasta tonight, the agnolotti are filled with squash and tossed in brown butter and sage.', say: 'Butternut agnolotti with brown butter, sage and parmesan.', talkingPoints: ['Hand-pinched pasta', 'Butternut squash filling', 'Brown butter and sage'] } },
  { section: 'Dessert', course: 'Dessert', name: 'Apple Cider Doughnuts', price: '9', description: 'Warm cider doughnuts rolled in cinnamon sugar, with salted caramel for dipping.',
    ingredients: ['Apple cider', 'Cinnamon sugar', 'Salted caramel'], printed: ['Gluten', 'Dairy'], inferred: [['Egg', 'doughnut batter']],
    drafts: { sellingLine: 'To finish, the cider doughnuts come warm, rolled in cinnamon sugar, with caramel to dip.', say: 'Apple cider doughnuts with cinnamon sugar and salted caramel.', talkingPoints: ['Served warm', 'Rolled in cinnamon sugar', 'Salted caramel to dip'] } },
];
const SECTION_OF = { 'Snacks & Small Plates': 'Small Plates', 'For the Table': 'For the Table', Salads: 'Salads', 'Soups & Salads': 'Soups & Salads', Pasta: 'Pasta', Pizza: 'Pizza', Mains: 'Mains', Entrees: 'Entrees', Dessert: 'Dessert' };
const linesFor = (d, allergens) => [`${d.name.toUpperCase()}  ${d.price}`, d.description, allergens.length ? `contains ${allergens.map((a) => a.toLowerCase()).join(', ')}` : ''].filter(Boolean);

/** The sample menu's reading for this demo store: its own dishes (three with changes), two left out, five new ones. */
export function sampleReading(db, store, kind = 'food') {
  if (kind !== 'food') return { title: 'Sample Menu', pageCount: 1, items: [] };
  const book = listEntries(db, 'recipe', store);
  const keep = book.slice(0, Math.max(0, book.length - 2)); // the last two aren't on the new menu
  const order = COLLECTIONS.recipe.group.values;
  const items = [];
  const updates = new Set(keep.filter((_, i) => i % 4 === 1).slice(0, 3).map((e) => e.id));
  for (const e of keep) {
    const d = e.data;
    const upd = updates.has(e.id);
    const price = upd ? String((Number(normPrice(d.price)) || 0) + 2) : normPrice(d.price);
    const ingredients = upd ? [...(d.ingredients || []), 'Pickled shallot'] : d.ingredients || [];
    const allergens = upd && !(d.allergens || []).includes('Allium') ? [...(d.allergens || []), 'Allium'] : d.allergens || [];
    const description = upd ? `${String(d.description || '').replace(/\.$/, '')}, with pickled shallot.` : d.description || '';
    items.push({ section: SECTION_OF[d.course] || d.course, course: d.course, name: d.name, price, description, ingredients,
      allergens: allergens.map((a) => (upd && a === 'Allium' && !(d.allergens || []).includes('Allium') ? { name: a, printed: false, quote: 'pickled shallot' } : { name: a, printed: true, quote: `contains ${(d.allergens || []).map((x) => x.toLowerCase()).join(', ')}` })),
      gfOption: !!d.gfOption, priceUnclear: false, drafts: { sellingLine: '', say: '', talkingPoints: [] } });
  }
  for (const n of SAMPLE_NEW) {
    items.push({ ...n, gfOption: false, priceUnclear: !!n.priceUnclear,
      allergens: [...n.printed.map((a) => ({ name: a, printed: true, quote: `contains ${n.printed.map((x) => x.toLowerCase()).join(', ')}` })), ...n.inferred.map(([a, q]) => ({ name: a, printed: false, quote: q }))] });
  }
  items.sort((a, b) => order.indexOf(a.course) - order.indexOf(b.course));
  const courses = [...new Set(items.map((x) => x.course))];
  for (const it of items) {
    it.page = courses.indexOf(it.course) + 1;
    it.lines = linesFor(it, it.allergens.filter((a) => a.printed).map((a) => a.name));
  }
  return { title: 'Sample Menu', pageCount: courses.length, items };
}

/* ------------------------------------------------------------------ the import's own state */
const running = new Map(); // import id → { abort, items: [], at }

function importRow(db, id, c) {
  const r = db.prepare('SELECT * FROM menu_imports WHERE id = ? AND store_id = ? AND company_id = ?').get(Number(id), c.store, c.company);
  if (!r) fail(404, 'We couldn’t find that import.');
  return r;
}
const itemRow = (db, imp, id) => {
  const r = db.prepare('SELECT * FROM menu_import_items WHERE id = ? AND import_id = ?').get(Number(id), imp.id);
  if (!r) fail(404, 'We couldn’t find that item. Reload and try again.');
  return r;
};
const touch = (db, id) => db.prepare('UPDATE menu_imports SET updated_at = ? WHERE id = ?').run(now(), id);
const filesOf = (imp) => J(imp.files, []);
const dirOf = (id) => path.join(IMPORT_DIR, String(id));
const userName = (db, id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || null : null);

/** Cleans the reader's item into the book's fields (the CMS's own cleaning, so it saves like an admin edit). */
function toData(kind, it, opts = {}) {
  const K = KINDS[kind];
  const raw = { name: str(it.name, 80), ...Object.fromEntries(K.fields.map((f) => [f, it[f]])) };
  if (kind === 'food') raw.allergens = (it.allergens || []).map((a) => (typeof a === 'string' ? a : a?.name));
  if (kind === 'cocktail' && opts.sections && !opts.sections.includes(raw.menuSection)) raw.menuSection = opts.sections[0];
  for (const f of K.fields) if (PRICEY.has(f) && raw[f] != null) raw[f] = normPrice(raw[f]);
  if (kind === 'wine' && !raw.glass && !raw.bottle && it.price) raw.bottle = normPrice(it.price);
  const clean = cleanEntry(K.collection, raw);
  const out = { name: clean.name };
  for (const f of K.fields) out[f] = clean[f];
  if (kind === 'wine' && !str(it.country)) out.country = '';
  return out;
}

/** Turns the reading into review items, matched by name against this store's book. */
export function saveReading(db, imp, reading, opts = {}) {
  const K = KINDS[imp.kind];
  const book = listEntries(db, K.collection, imp.store_id);
  const byName = new Map(book.map((e) => [normName(e.data.name), e]));
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM menu_import_items WHERE import_id = ?').run(imp.id);
    const ins = db.prepare(`INSERT INTO menu_import_items(import_id, company_id, store_id, seq, page, grp, name, status, data, source, changes, entry_id, allergens_ok, price_ok, decision, drafts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const seen = new Set(), matched = new Set();
    let seq = 0;
    for (const it of reading.items || []) {
      const data = toData(imp.kind, it, opts);
      if (!data.name) continue;
      const key = normName(data.name);
      if (seen.has(key)) continue; // the same dish twice in one file: the first one counts
      seen.add(key);
      const e = byName.get(key);
      let status = 'new', changes = [];
      if (e) {
        matched.add(e.id);
        for (const f of K.compare) {
          if (empty(data[f]) || same(f, e.data[f], data[f])) continue;
          changes.push({ field: f, label: LABELS[f], from: e.data[f] ?? '', to: data[f] });
        }
        status = changes.length ? 'updated' : 'unchanged';
      }
      const allergens = (it.allergens || []).filter((a) => a && ALLERGENS.includes(a.name)).map((a) => ({ name: a.name, printed: !!a.printed, quote: str(a.quote, 200) }));
      const source = { section: str(it.section, 80), lines: (it.lines || []).map((l) => str(l, 300)).filter(Boolean).slice(0, 12), priceText: str(it.price, 20), priceUnclear: !!it.priceUnclear, allergens };
      const d = it.drafts || {};
      const drafts = status === 'unchanged' ? [] : K.drafts.map(([field, label]) => {
        const v = field === 'talkingPoints' ? (Array.isArray(d.talkingPoints) ? d.talkingPoints.map((x) => str(x, 160)).filter(Boolean).slice(0, 3) : []) : str(d[field], 300);
        // a draft only for a field the book doesn't have yet (an updated dish keeps the lines it has)
        return !empty(v) && !(e && !empty(e.data[field])) ? { field, label, text: Array.isArray(v) ? v.join('\n') : v, state: 'draft' } : null;
      }).filter(Boolean);
      const needAllergens = K.allergens && status !== 'unchanged';
      ins.run(imp.id, imp.company_id, imp.store_id, seq++, Math.max(1, Number(it.page) || 1), str(data[K.group] || it.section, 80) || 'Other', data.name, status,
        JSON.stringify(data), JSON.stringify(source), JSON.stringify(changes), e?.id ?? null, needAllergens ? 0 : 1, source.priceUnclear && status !== 'unchanged' ? 0 : 1,
        status === 'unchanged' ? 'unchanged' : 'pending', JSON.stringify(drafts));
    }
    // In the book but not in this file: listed so the manager decides. Keep is the default; nothing is archived on its own.
    if (seq > 0) for (const e of book) if (!matched.has(e.id)) {
      ins.run(imp.id, imp.company_id, imp.store_id, seq++, null, 'Not in this file', e.data.name, 'missing', JSON.stringify({ name: e.data.name, [K.group]: e.data[K.group] ?? '' }),
        '{}', '[]', e.id, 1, 1, 'keep', '[]');
    }
    const found = db.prepare("SELECT COUNT(*) n FROM menu_import_items WHERE import_id = ? AND status != 'missing'").get(imp.id).n;
    if (!found) {
      db.prepare("UPDATE menu_imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .run(`We didn’t find any ${K.many} in that file. Check it’s a ${K.label.toLowerCase()}, then read it again.`, now(), imp.id);
    } else {
      db.prepare("UPDATE menu_imports SET status = 'review', error = NULL, title = ?, pages = MAX(pages, ?), read_at = ?, updated_at = ? WHERE id = ?")
        .run(str(opts.title || reading.title, 120) || imp.title, Math.max(...(reading.items || []).map((x) => Number(x.page) || 1), Number(reading.pageCount) || 0), now(), now(), imp.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Starts reading in the background. Real companies: the Claude API. Demos: the sample reading, paced like a real read. */
export function startRead(db, imp, { demo, brand }) {
  if (running.has(imp.id)) return;
  const files = filesOf(imp);
  db.prepare("UPDATE menu_imports SET status = 'reading', error = NULL, updated_at = ? WHERE id = ?").run(now(), imp.id);
  const ctl = new AbortController();
  const job = { abort: () => ctl.abort(), items: [], at: Date.now(), note: 'Reading the pages' };
  running.set(imp.id, job);
  const sections = imp.kind === 'cocktail' ? COLLECTIONS.house.group.values.filter((s) => brand !== 'mise' || !BALDWIN_SECTIONS.has(s)) : undefined;
  const finish = (fn) => { try { if (!ctl.signal.aborted) fn(); } catch (e) { console.error('menu import', e); setFailed(db, imp.id, 'Something went wrong while saving what we read. Read it again.'); } finally { running.delete(imp.id); } };
  if (demo) {
    const reading = sampleReading(db, imp.store_id, imp.kind);
    const step = Number(process.env.MENU_IMPORT_DEMO_MS) || 420;
    let n = 0;
    const tick = () => {
      if (ctl.signal.aborted) return;
      if (n < reading.items.length) {
        job.items = reading.items.slice(0, ++n); job.note = n < reading.items.length * 0.6 ? 'Finding dish names and prices' : 'Matching allergens to your Allergen Guide';
        setTimeout(tick, step).unref?.();
      } else { job.note = 'Checking prices'; setTimeout(() => finish(() => saveReading(db, imp, reading, { title: imp.title || reading.title })), step).unref?.(); }
    };
    setTimeout(tick, step).unref?.();
    return;
  }
  const K = KINDS[imp.kind];
  readWithClaude({ files: files.map((f) => ({ ...f, path: path.join(dirOf(imp.id), f.file) })), kind: imp.kind, title: imp.title, sections, signal: ctl.signal,
    onItems: (items) => { job.items = items; job.note = imp.kind === 'food' && items.length > 2 ? 'Matching allergens to your Allergen Guide' : `Finding ${K.one} names and prices`; } })
    .then((reading) => finish(() => saveReading(db, imp, reading, { title: imp.title, sections })))
    .catch((e) => {
      running.delete(imp.id);
      if (ctl.signal.aborted) return;
      console.error('menu import read failed:', e.detail || e.message);
      setFailed(db, imp.id, e instanceof ReadError ? e.message : 'The menu reader isn’t available right now. Your files are saved here, so you can read them later.');
    });
}
const setFailed = (db, id, msg) => db.prepare("UPDATE menu_imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'reading'").run(msg, now(), id);

export function cancelRead(db, imp) {
  running.get(imp.id)?.abort();
  running.delete(imp.id);
  db.prepare("UPDATE menu_imports SET status = 'uploaded', error = NULL, updated_at = ? WHERE id = ? AND status = 'reading'").run(now(), imp.id);
}

/* ------------------------------------------------------------------ approving into the book */
const K_OF = (imp) => KINDS[imp.kind];
/** The fields this item writes: everything read for a new one, only what changed (plus confirmed allergens) for an update. */
function writeData(imp, it) {
  const d = J(it.data, {});
  const K = K_OF(imp);
  if (it.status === 'new') return Object.fromEntries(Object.entries(d).filter(([k, v]) => k === 'name' || !empty(v) || k === 'allergens'));
  const out = {};
  for (const ch of J(it.changes, [])) out[ch.field] = d[ch.field];
  if (K.allergens) out.allergens = d.allergens;
  return out;
}
const rawData = (db, id) => { const r = db.prepare('SELECT data FROM entries WHERE id = ?').get(id); return r ? r.data : null; };

export function approveItem(db, imp, it, user) {
  if (it.status === 'missing' || it.status === 'unchanged') fail(400, 'There’s nothing to approve for that one.');
  if (it.decision !== 'pending') fail(409, it.decision === 'approved' ? 'That’s already approved.' : 'Undo the skip first.');
  if (!it.allergens_ok) fail(409, 'Confirm the allergens first.');
  if (!it.price_ok) fail(409, 'Check the price first.');
  const K = K_OF(imp);
  const data = writeData(imp, it);
  let entryId, createdLib = null, before = null;
  if (it.status === 'new') {
    if (listEntries(db, K.collection, imp.store_id).some((e) => normName(e.data.name) === normName(data.name))) fail(409, `${data.name} is already in your book. Reload to see it as an update.`);
    const e = createEntry(db, K.collection, data, user.id, imp.store_id, imp.company_id, { share: true });
    entryId = e.id; createdLib = e.library?.id ?? null;
  } else {
    const e = getEntry(db, it.entry_id);
    if (!e || e.storeId !== imp.store_id || e.archivedAt) fail(409, 'That dish isn’t in your book anymore. Read the menu again.');
    before = { menu: rawData(db, e.id), lib: e.library ? { id: e.library.id, data: rawData(db, e.library.id) } : null };
    const scope = e.library && sharedWith(db, e).length ? 'store' : 'group'; // shared with another restaurant: the change is this one's own
    const { libraryId, ...cur } = e.data; // eslint-disable-line no-unused-vars
    updateEntry(db, e.id, { ...cur, ...data }, user.id, scope);
    entryId = e.id;
  }
  db.prepare("UPDATE menu_import_items SET decision = 'approved', result_entry = ?, created_lib = ?, before = ?, decided_by = ?, decided_at = ? WHERE id = ?")
    .run(entryId, createdLib, before ? JSON.stringify(before) : null, user.id, now(), it.id);
  audit(db, user.id, (it.status === 'new' ? 'add ' : 'edit ') + K.collection, data.name || it.name, imp.company_id);
  touch(db, imp.id);
}

/** Puts one approved item back: a new one is archived, an updated one gets its old data back. Its drafts go back to drafts. */
function revertItem(db, it, userId) {
  if (it.decision === 'approved') {
    if (!it.before) {
      archiveEntry(db, it.result_entry, userId);
      if (it.created_lib) archiveEntry(db, it.created_lib, userId);
    } else {
      const b = J(it.before, {});
      if (b.menu) db.prepare('UPDATE entries SET data = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(b.menu, userId, now(), it.entry_id);
      if (b.lib?.data) db.prepare('UPDATE entries SET data = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(b.lib.data, userId, now(), b.lib.id);
    }
  }
  if (it.decision === 'archived') restoreEntry(db, it.entry_id);
  const drafts = J(it.drafts, []).map((d) => ({ ...d, state: 'draft' }));
  db.prepare(`UPDATE menu_import_items SET decision = ?, result_entry = NULL, created_lib = NULL, before = NULL, drafts = ?, decided_by = ?, decided_at = ? WHERE id = ?`)
    .run(it.status === 'missing' ? 'keep' : 'pending', JSON.stringify(drafts), userId, now(), it.id);
}

export function undoImport(db, imp, user) {
  if (imp.status === 'undone') fail(409, 'This import was already undone.');
  db.exec('BEGIN');
  try {
    for (const it of db.prepare("SELECT * FROM menu_import_items WHERE import_id = ? AND decision IN ('approved','archived')").all(imp.id)) revertItem(db, it, user.id);
    db.prepare("UPDATE menu_imports SET status = 'undone', undone_by = ?, undone_at = ?, updated_at = ? WHERE id = ?").run(user.id, now(), now(), imp.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(db, user.id, 'undo menu import', imp.title || `Import ${imp.id}`, imp.company_id);
}

/* ------------------------------------------------------------------ what the screens read */
function itemOut(db, imp, r) {
  const e = r.result_entry || r.entry_id ? db.prepare('SELECT slug, archived_at FROM entries WHERE id = ?').get(r.result_entry || r.entry_id) : null;
  return { id: r.id, seq: r.seq, page: r.page, group: r.grp, name: r.name, status: r.status, data: J(r.data, {}), source: J(r.source, {}), changes: J(r.changes, []),
    allergensOk: !!r.allergens_ok, priceOk: !!r.price_ok, decision: r.decision, decidedBy: userName(db, r.decided_by), decidedAt: r.decided_at,
    slug: e && !e.archived_at ? e.slug : null, entryId: r.result_entry || null, drafts: J(r.drafts, []) };
}

export function importOut(db, imp) {
  const K = KINDS[imp.kind];
  const items = db.prepare('SELECT * FROM menu_import_items WHERE import_id = ? ORDER BY seq').all(imp.id).map((r) => itemOut(db, imp, r));
  const job = running.get(imp.id);
  const real = items.filter((i) => i.status !== 'missing');
  const counts = {
    all: real.length, approved: real.filter((i) => i.decision === 'approved').length, skipped: real.filter((i) => i.decision === 'skipped').length,
    new: real.filter((i) => i.status === 'new').length, updated: real.filter((i) => i.status === 'updated').length, unchanged: real.filter((i) => i.status === 'unchanged').length,
    ready: real.filter((i) => i.decision === 'pending' && i.allergensOk && i.priceOk).length,
    needsYou: real.filter((i) => i.decision === 'pending' && (!i.allergensOk || !i.priceOk)).length,
    missing: items.length - real.length, archived: items.filter((i) => i.decision === 'archived').length,
  };
  const out = {
    import: { id: imp.id, kind: imp.kind, kindLabel: K.label, one: K.one, many: K.many, title: imp.title, status: imp.status, error: imp.error,
      files: filesOf(imp).map(({ n, name, mime, size, pages, sample }) => ({ n, name, mime, size, pages, sample: !!sample })), pages: imp.pages, demo: !!imp.demo,
      createdAt: imp.created_at, by: userName(db, imp.created_by), readAt: imp.read_at, finishedAt: imp.finished_at, finishedBy: userName(db, imp.finished_by),
      undoneAt: imp.undone_at, undoneBy: userName(db, imp.undone_by) },
    items, counts,
    allergenList: ALLERGENS,
    // the choices for the fields a manager can fix on the card (Course, Country, Colour, Menu section…)
    options: Object.fromEntries(COLLECTIONS[K.collection].fields.filter((f) => f.type === 'select' && K.fields.includes(f.key)).map((f) => [f.key, f.options.filter((o) => o !== '')])),
  };
  if (imp.status === 'reading') {
    const found = job?.items || [];
    out.progress = { found: found.length, page: found.length ? Math.max(...found.map((x) => Number(x.page) || 1)) : 1, pages: imp.pages, note: job?.note || 'Reading the pages',
      latest: found.slice(-12).map((x) => ({ name: str(x.name, 80), page: Number(x.page) || 1, section: str(x.section, 60), price: normPrice(x.price), description: str(x.description, 200),
        allergens: (x.allergens || []).map((a) => a?.name).filter((a) => ALLERGENS.includes(a)), lines: (x.lines || []).slice(0, 4).map((l) => str(l, 200)) })) };
  }
  if (['done', 'undone', 'review'].includes(imp.status)) {
    const made = items.filter((i) => i.decision === 'approved');
    const ids = new Set(made.map((i) => i.entryId));
    let questions = 0;
    if (imp.status !== 'undone' && ids.size) questions = questionPool(db, imp.store_id).filter((q) => ids.has(Number(String(q.ref).split(':').pop()))).length;
    out.summary = {
      added: made.filter((i) => i.status === 'new').length, updated: made.filter((i) => i.status === 'updated').length,
      unchanged: counts.unchanged, skipped: counts.skipped, archived: counts.archived, waiting: counts.ready + counts.needsYou, questions,
      groups: [...new Set(made.map((i) => i.group))], allergenDishes: K.allergens ? made.length : 0,
      newPages: made.filter((i) => i.status === 'new' && i.slug).map((i) => ({ name: i.name, slug: i.slug })),
      skippedNames: items.filter((i) => i.decision === 'skipped').map((i) => i.name),
      drafts: made.flatMap((i) => i.drafts.filter((d) => d.state === 'draft').map((d) => ({ itemId: i.id, name: i.name, ...d }))),
    };
  }
  return out;
}

/* ------------------------------------------------------------------ routes */
/**
 * /api/imports… for owners and managers of the store they're working in. `deps` come from server/index.mjs.
 * Returns false when the request isn't one of these.
 */
export function importRoutes({ db, fail: httpFail, sendJson, readJson, needEditor, isDemo, brandOf, limiter, demoLimiter }) {
  if (httpFail) raise = httpFail;
  return async (req, res, url, c) => {
    const p = url.pathname, m = req.method;
    if (p !== '/api/imports' && !p.startsWith('/api/imports/')) return false;
    const u = needEditor(c, req);
    if (!c.store || !c.company) fail(400, 'Pick a restaurant first.');
    const demo = isDemo(c.company);
    const parts = p.split('/').filter(Boolean); // api imports :id …
    const send = (imp) => sendJson(res, 200, importOut(db, db.prepare('SELECT * FROM menu_imports WHERE id = ?').get(imp.id)));

    if (p === '/api/imports' && m === 'GET') {
      const rows = db.prepare('SELECT * FROM menu_imports WHERE store_id = ? AND company_id = ? ORDER BY id DESC LIMIT 20').all(c.store, c.company);
      const open = rows.find((r) => ['uploaded', 'reading', 'failed', 'review'].includes(r.status) && (r.status !== 'uploaded' || filesOf(r).length));
      return sendJson(res, 200, { demo, open: open ? open.id : null,
        recent: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, status: r.status, createdAt: r.created_at, by: userName(db, r.created_by) })) });
    }
    if (p === '/api/imports' && m === 'POST') {
      const b = await readJson(req, 5000);
      const kind = Object.hasOwn(KINDS, String(b.kind)) ? String(b.kind) : 'food';
      if (demo && kind !== 'food') fail(400, 'The demo’s sample menu is a Food Book. Pick Food Book to try it.');
      const files = demo ? [{ n: 0, name: 'Sample Menu.pdf', mime: 'application/pdf', size: 0, pages: 0, sample: true }] : [];
      const r = db.prepare('INSERT INTO menu_imports(company_id, store_id, kind, title, status, files, demo, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(c.company, c.store, kind, demo ? 'Sample Menu' : null, 'uploaded', JSON.stringify(files), demo ? 1 : 0, u.id, now(), now());
      if (demo) { const pages = sampleReading(db, c.store).pageCount; db.prepare('UPDATE menu_imports SET pages = ?, files = ? WHERE id = ?').run(pages, JSON.stringify([{ ...files[0], pages }]), r.lastInsertRowid); }
      return send({ id: Number(r.lastInsertRowid) });
    }
    if (parts[1] !== 'imports' || !parts[2]) return false;
    const imp = importRow(db, parts[2], c);
    const rest = parts.slice(3).join('/');

    if (!rest && m === 'GET') return send(imp);
    // The menu type can change until it's read.
    if (!rest && m === 'PATCH') {
      const b = await readJson(req, 5000);
      if (!['uploaded', 'failed'].includes(imp.status)) fail(409, 'That menu has been read already. Start a new import to change the type.');
      if (b.kind !== undefined) {
        if (!Object.hasOwn(KINDS, String(b.kind))) fail(400, 'Pick a menu type.');
        if (demo && b.kind !== 'food') fail(400, 'The demo’s sample menu is a Food Book. Pick Food Book to try it.');
        db.prepare('UPDATE menu_imports SET kind = ?, updated_at = ? WHERE id = ?').run(String(b.kind), now(), imp.id);
      }
      return send(imp);
    }
    // Add a file: a PDF or a photo of a page. Photos are re-encoded (upright, metadata gone, at most 2000 px).
    if (rest === 'files' && m === 'POST') {
      if (demo) fail(403, 'The demo reads a sample menu, so it doesn’t take uploads.');
      if (!['uploaded', 'failed'].includes(imp.status)) fail(409, 'That menu has been read already. Start a new import to add files.');
      const files = filesOf(imp);
      if (files.length >= MAX_FILES) fail(400, `That’s ${MAX_FILES} files already. Put the pages in one PDF.`);
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const isPdf = mime === 'application/pdf';
      if (!isPdf && !/^image\/(jpeg|png|webp|heic|heif)$/.test(mime)) fail(415, 'Add a PDF, or photos of the pages (JPG, PNG or HEIC).');
      if (Number(req.headers['content-length'] || 0) > MAX_FILE) fail(413, 'That file is over 25 MB. Split it, or take smaller photos.');
      const chunks = []; let size = 0;
      for await (const ch of req) { size += ch.length; if (size > MAX_FILE) fail(413, 'That file is over 25 MB. Split it, or take smaller photos.'); chunks.push(ch); }
      let buf = Buffer.concat(chunks), pages = 1, outMime = 'image/jpeg', ext = '.jpg';
      if (isPdf) {
        if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') fail(415, 'That file isn’t a PDF we can open.');
        if (files.filter((f) => f.mime === 'application/pdf').reduce((n, f) => n + f.size, 0) + buf.length > MAX_PDF_TOTAL) fail(413, 'The PDFs together are over 20 MB. Import them in two goes.');
        pages = pdfPages(buf); outMime = 'application/pdf'; ext = '.pdf';
      } else {
        try { const sharp = (await import('sharp')).default; buf = await sharp(buf, { limitInputPixels: 80e6 }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); }
        catch { fail(415, 'We couldn’t open that photo. Save it as a JPG and add it again.'); }
      }
      const name = str(decodeURIComponent(String(req.headers['x-filename'] || (isPdf ? 'menu.pdf' : 'photo.jpg'))), 120) || 'menu';
      const n = files.reduce((x, f) => Math.max(x, f.n + 1), 0);
      fs.mkdirSync(dirOf(imp.id), { recursive: true });
      const file = `${n}${ext}`;
      fs.writeFileSync(path.join(dirOf(imp.id), file), buf);
      files.push({ n, name, mime: outMime, size: buf.length, pages, file });
      db.prepare("UPDATE menu_imports SET files = ?, pages = ?, status = 'uploaded', error = NULL, updated_at = ? WHERE id = ?").run(JSON.stringify(files), files.reduce((x, f) => x + f.pages, 0), now(), imp.id);
      return send(imp);
    }
    const fm = /^files\/(\d+)$/.exec(rest);
    if (fm && m === 'DELETE') {
      if (!['uploaded', 'failed'].includes(imp.status)) fail(409, 'That menu has been read already.');
      const files = filesOf(imp), f = files.find((x) => x.n === Number(fm[1]));
      if (!f || f.sample) fail(404, 'We couldn’t find that file.');
      fs.rmSync(path.join(dirOf(imp.id), f.file), { force: true });
      const left = files.filter((x) => x !== f);
      db.prepare('UPDATE menu_imports SET files = ?, pages = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(left), left.reduce((x, y) => x + y.pages, 0), now(), imp.id);
      return send(imp);
    }
    // The original file, for "Open the Original" on the review screen (this store's managers only).
    if (fm && m === 'GET') {
      const f = filesOf(imp).find((x) => x.n === Number(fm[1]));
      const fp = f && !f.sample && path.join(dirOf(imp.id), f.file);
      if (!fp || !fs.existsSync(fp)) fail(404, 'We couldn’t find that file.');
      const buf = fs.readFileSync(fp);
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': buf.length, 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${encodeURIComponent(f.name)}"`, 'X-Content-Type-Options': 'nosniff' });
      return res.end(buf);
    }
    if (rest === 'read' && m === 'POST') {
      if (imp.status === 'reading') return send(imp);
      if (!['uploaded', 'failed'].includes(imp.status)) fail(409, 'That menu has been read already.');
      if (!filesOf(imp).length) fail(400, 'Add the menu first.');
      const lim = demo ? demoLimiter : limiter, key = demo ? 'c' + c.company : 's' + c.store;
      if (!lim.check(key)) fail(429, demo ? 'This demo has read the sample menu enough times. Refresh the page for a fresh demo.' : 'That’s a lot of reads today. Try again tomorrow, or ask us to raise the limit.');
      lim.record(key);
      startRead(db, imp, { demo, brand: brandOf(c.company) });
      audit(db, u.id, 'read menu', `${KINDS[imp.kind].label} · ${filesOf(imp).map((f) => f.name).join(', ')}`.slice(0, 300), c.company);
      return send(imp);
    }
    if (rest === 'cancel' && m === 'POST') { cancelRead(db, imp); return send(imp); }

    // Review, item by item. Every change is saved as it's made, so Finish Later loses nothing.
    const im = /^items\/(\d+)(?:\/(confirm|approve|skip|undo|keep|archive|price|draft))?$/.exec(rest);
    if (im) {
      if (!['review', 'done'].includes(imp.status)) fail(409, imp.status === 'undone' ? 'This import was undone. Start a new one to bring it back.' : 'That menu isn’t ready to review yet.');
      const it = itemRow(db, imp, im[1]);
      const action = im[2] || (m === 'PATCH' ? 'edit' : null);
      const K = KINDS[imp.kind];
      const b = m === 'GET' ? {} : await readJson(req, 50_000);
      const d = J(it.data, {});
      if (action === 'edit') {
        // Fix what the reader got wrong, right on the card. Changing the allergens here counts as confirming them.
        if (it.decision !== 'pending') fail(409, 'Undo it first to make changes.');
        const changes = b.data && typeof b.data === 'object' ? b.data : {};
        const allowed = new Set(['name', ...K.fields]);
        const next = toData(imp.kind, { ...d, ...Object.fromEntries(Object.entries(changes).filter(([k]) => allowed.has(k))), allergens: (changes.allergens ?? d.allergens ?? []).map((a) => ({ name: a })) });
        if (!next.name) fail(400, 'Give it a name.');
        let status = it.status, diff = [];
        if (it.entry_id) {
          const e = getEntry(db, it.entry_id);
          for (const f of K.compare) if (e && !empty(next[f]) && !same(f, e.data[f], next[f])) diff.push({ field: f, label: LABELS[f], from: e.data[f] ?? '', to: next[f] });
          status = diff.length ? 'updated' : 'unchanged';
        }
        db.prepare('UPDATE menu_import_items SET data = ?, name = ?, changes = ?, status = ?, decision = ?, allergens_ok = CASE WHEN ? THEN 1 ELSE allergens_ok END, price_ok = CASE WHEN ? THEN 1 ELSE price_ok END WHERE id = ?')
          .run(JSON.stringify(next), next.name, JSON.stringify(diff), status, status === 'unchanged' ? 'unchanged' : 'pending', changes.allergens !== undefined ? 1 : 0, changes.price !== undefined ? 1 : 0, it.id);
      } else if (action === 'confirm') {
        if (!K.allergens) fail(400, 'There are no allergens to confirm here.');
        if (it.decision !== 'pending') fail(409, 'Undo it first to make changes.');
        const list = (Array.isArray(b.allergens) ? b.allergens : d.allergens || []).map(String).filter((a) => ALLERGENS.includes(a));
        db.prepare('UPDATE menu_import_items SET data = ?, allergens_ok = 1 WHERE id = ?').run(JSON.stringify({ ...d, allergens: [...new Set(list)] }), it.id);
      } else if (action === 'price') {
        if (it.decision !== 'pending') fail(409, 'Undo it first to make changes.');
        const price = b.price === undefined ? d.price : normPrice(b.price);
        if (!price) fail(400, 'Type the price.');
        db.prepare('UPDATE menu_import_items SET data = ?, price_ok = 1 WHERE id = ?').run(JSON.stringify({ ...d, price: String(price).slice(0, 10) }), it.id);
      } else if (action === 'approve') approveItem(db, imp, it, u);
      else if (action === 'skip') {
        if (it.decision !== 'pending') fail(409, 'Only an open item can be skipped.');
        db.prepare("UPDATE menu_import_items SET decision = 'skipped', decided_by = ?, decided_at = ? WHERE id = ?").run(u.id, now(), it.id);
      } else if (action === 'undo') {
        if (!['approved', 'skipped', 'archived'].includes(it.decision)) fail(409, 'There’s nothing to undo.');
        revertItem(db, it, u.id);
      } else if (action === 'keep' || action === 'archive') {
        if (it.status !== 'missing') fail(400, 'Only dishes that aren’t in this file can be kept or archived here.');
        if (action === 'archive' && it.decision !== 'archived') {
          const e = getEntry(db, it.entry_id);
          if (!e || e.storeId !== imp.store_id) fail(404, 'We couldn’t find that one in your book.');
          archiveEntry(db, e.id, u.id);
          db.prepare("UPDATE menu_import_items SET decision = 'archived', decided_by = ?, decided_at = ? WHERE id = ?").run(u.id, now(), it.id);
          audit(db, u.id, 'archive ' + K.collection, it.name, c.company);
        } else if (action === 'keep' && it.decision === 'archived') revertItem(db, it, u.id);
      } else if (action === 'draft') {
        // A draft line: Approve puts it on the page (Edit first if needed); Skip leaves it out. Only for an approved item.
        if (it.decision !== 'approved' || !it.result_entry) fail(409, 'Approve the dish first.');
        const drafts = J(it.drafts, []);
        const dr = drafts.find((x) => x.field === String(b.field));
        if (!dr) fail(404, 'We couldn’t find that draft.');
        if (b.action === 'skip') dr.state = 'skipped';
        else if (b.action === 'approve') {
          const text = b.text !== undefined ? String(b.text).slice(0, 600).trim() : dr.text;
          if (!text) fail(400, 'Write the line first, or skip it.');
          const e = getEntry(db, it.result_entry);
          if (!e) fail(409, 'That dish isn’t in your book anymore.');
          const { libraryId, ...cur } = e.data; // eslint-disable-line no-unused-vars
          const value = dr.field === 'talkingPoints' ? text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 3) : text;
          updateEntry(db, e.id, { ...cur, [dr.field]: value }, u.id, e.library && sharedWith(db, e).length ? 'store' : 'group');
          dr.text = text; dr.state = 'approved';
          audit(db, u.id, 'edit ' + K.collection, e.data.name, c.company);
        } else fail(400, 'Approve or skip the draft.');
        db.prepare('UPDATE menu_import_items SET drafts = ? WHERE id = ?').run(JSON.stringify(drafts), it.id);
      } else if (m !== 'GET') fail(400, 'Unknown action.');
      touch(db, imp.id);
      return send(imp);
    }
    // Approve All Confirmed: every open item whose allergens are confirmed and whose price is checked.
    if (rest === 'approve-confirmed' && m === 'POST') {
      if (imp.status !== 'review' && imp.status !== 'done') fail(409, 'That menu isn’t ready to review yet.');
      const list = db.prepare("SELECT * FROM menu_import_items WHERE import_id = ? AND decision = 'pending' AND status IN ('new','updated') AND allergens_ok = 1 AND price_ok = 1 ORDER BY seq").all(imp.id);
      let n = 0;
      for (const it of list) { try { approveItem(db, imp, it, u); n++; } catch (e) { if (!e.status || e.status >= 500) throw e; } }
      const out = importOut(db, db.prepare('SELECT * FROM menu_imports WHERE id = ?').get(imp.id));
      return sendJson(res, 200, { ...out, approvedNow: n });
    }
    if (rest === 'finish' && m === 'POST') {
      if (imp.status !== 'review' && imp.status !== 'done') fail(409, 'That menu isn’t ready to finish.');
      db.prepare("UPDATE menu_imports SET status = 'done', finished_by = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(u.id, now(), now(), imp.id);
      audit(db, u.id, 'finish menu import', imp.title || `Import ${imp.id}`, c.company);
      return send(imp);
    }
    // Back to Review from Done (Review It Again on a skipped dish).
    if (rest === 'reopen' && m === 'POST') {
      if (imp.status !== 'done') fail(409, 'That import is still open.');
      db.prepare("UPDATE menu_imports SET status = 'review', updated_at = ? WHERE id = ?").run(now(), imp.id);
      return send(imp);
    }
    if (rest === 'undo' && m === 'POST') {
      if (!['review', 'done'].includes(imp.status)) fail(409, 'There’s nothing to undo yet.');
      undoImport(db, imp, u);
      return send(imp);
    }
    return false;
  };
}
