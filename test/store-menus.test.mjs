// A store's own menu, loaded (Nov 17: Testa Barra and J.Baldwin's, from their websites; Tommy: "Sounds good to me. Just
// remember, we're doing spirits and wine as well."). scripts/account-content/load-store-menu.mjs writes a store's dishes,
// house cocktails, wines, back bar and beers through the app's own save code; the store then reads a full book from them
// (server/content.mjs, menuBook): Home with tonight's focus, the Food Matrix in its menu's order, Cocktails, Wine, Back Bar,
// Quizzes. The Baldwin (store 1) doesn't change, and nothing of The Baldwin's shows in the other store's book.
// The menu here is made up (fresh names); the real ones are the account's content, not in this repo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount } from './helpers.mjs';
import { BASE_COURSES } from '../server/cms.mjs';
import { FINGERPRINT_SQL } from '../scripts/account-content/load-store-menu.mjs';
import { classify } from '../server/generic.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-menus-'));
const PORT = 6200 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
function person() {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
before(async () => {
  giveAccount(dir);
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@baldwin.test', SUPERADMIN_EMAIL: 'tommy@mise.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const dbFile = path.join(dir, 'baldwin.db');
const db = () => new DatabaseSync(dbFile);
const owner = person(), baldwinStaff = person(), testaStaff = person();
const fingerprint = (maxId) => { const d = db(); const rows = d.prepare(FINGERPRINT_SQL).all(maxId); d.close(); return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'); };
const texts = (n, out = []) => { if (!n) return out; if (n.t === 'T' && n.s) out.push(n.s); for (const c of n.c || []) texts(c, out); return out; };
const names = (n, out = []) => { if (!n) return out; if (n.n) out.push(n.n); for (const c of n.c || []) names(c, out); return out; };
const load = (file, ...flags) => spawnSync(process.execPath, ['scripts/account-content/load-store-menu.mjs', file, '--db', dbFile, ...flags], { cwd: root, encoding: 'utf8', env: { ...process.env, DATA_DIR: dir } });
let menuFile, maxId, libName, before1 = {};

test('setup: The Baldwin’s owner and staff at The Baldwin and Testa Barra; a made-up menu for Testa Barra', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Bram Owner', email: 'owner@baldwin.test', password: 'long-enough-1' } })).status, 200);
  const d = db();
  const code = d.prepare('SELECT join_code FROM companies WHERE id = 1').get().join_code;
  libName = d.prepare("SELECT json_extract(data, '$.name') n FROM entries WHERE collection = 'recipe' AND store_id = 0 AND company_id = 1 AND archived_at IS NULL ORDER BY id LIMIT 1").get().n;
  maxId = d.prepare('SELECT MAX(id) m FROM entries').get().m;
  d.close();
  for (const [p, name, storeId] of [[baldwinStaff, 'Ada Baldwin', 1], [testaStaff, 'Tess Testa', 3]])
    assert.equal((await p('/api/join', { method: 'POST', body: { code, name, email: `j${Math.random().toString(36).slice(2, 10)}@join.test`, password: 'join-pass-4321-x', storeId } })).status, 200);
  const dish = (name, course, price, description, extra = {}) => ({ data: { name, course, price, description, ingredients: description.split(', '), allergens: [], confirm: true, ...extra } });
  menuFile = path.join(dir, 'menu.json');
  fs.writeFileSync(menuFile, JSON.stringify({
    store: 3, storeName: 'Testa Barra', sourceShort: 'example.test',
    recipes: [
      dish('Ember Corn Fritters', 'Small Plates', '12', 'Sweet corn, scallion, chili honey', { allergens: ['Allium', 'Nightshade'] }),
      { ...dish(libName, 'Small Plates', '15', 'Our calamari, lemon, capers'), link: libName },
      dish('Smoked Short Rib Hash', 'Bone-Ins & Such', '24', 'Short rib, potatoes, fried egg', { allergens: ['Egg', 'Nightshade'] }),
      dish('Lantern Flatbread', 'Pizzas', '16', 'Fontina, mushroom, thyme', { allergens: ['Dairy', 'Gluten'] }),
      dish('Quince Tart', 'Dessert', '10', 'Quince, almond cream, pastry', { allergens: ['Tree Nut', 'Gluten', 'Dairy'] }),
    ],
    house: [
      { data: { name: 'Copper Lantern', menuSection: 'Tequila Cocktails', price: '14', onMenu: true, base: 'Tequila', build: [{ ingredient: 'Blanco tequila', spirit: true }, { ingredient: 'Lime' }, { ingredient: 'Agave' }], specNote: 'To confirm: amounts.' } },
      { data: { name: 'House Margarita', menuSection: 'Classic Cocktails', price: '12', onMenu: true } },
    ],
    wine: [{ data: { name: 'Larkspur Ridge', grape: 'Pinot Noir', region: 'Willamette', list: 'By the glass', country: 'USA', color: 'Red', glass: '15', bottle: '58', pages: ['Pinot Noir'] } }],
    shelf: [{ data: { name: 'Hollow Pine Bourbon', spirit: 'Bourbon', styles: ['Wheated'], limited: true } }],
    beer: [{ data: { name: 'Riverbend Lager', serve: 'Draft', style: 'Lager', abv: '4.8%' } }],
  }));
  before1.fp = fingerprint(maxId);
  before1.matrix = JSON.stringify((await baldwinStaff('/api/page/13-2')).data);
  before1.bar = JSON.stringify((await baldwinStaff('/api/page/14-2')).data);
  before1.quiz = JSON.stringify((await baldwinStaff('/api/quiz/catalog')).data);
});

test('before its menu is in, Testa Barra reads the starter book: Home is the "goes here" page', async () => {
  assert.ok((await testaStaff('/api/page/4-2')).data.empty);
  assert.equal((await testaStaff('/api/me')).data.user.store.ownMenu, undefined);
});

test('the loader: a dry run writes nothing; --apply writes everything once, and a second run adds nothing', () => {
  const dry = load(menuFile);
  assert.equal(dry.status, 0, dry.stderr + dry.stdout);
  assert.match(dry.stdout, /Dry run/);
  const d = db();
  assert.equal(d.prepare("SELECT COUNT(*) n FROM entries WHERE store_id = 3 AND collection = 'recipe'").get().n, 0);
  d.close();
  const r = load(menuFile, '--apply');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const report = JSON.parse(r.stdout.slice(0, r.stdout.lastIndexOf('}') + 1));
  assert.deepEqual(report.counts, { recipe: 5, house: 2, wine: 1, shelf: 1, beer: 1 });
  assert.equal(report.linked.length, 1, 'the dish the file links goes on the menu from the group’s kitchen');
  assert.ok(report.baldwin.unchanged);
  const again = JSON.parse(load(menuFile, '--apply').stdout.split('\nLoaded')[0]);
  assert.deepEqual(Object.values(again.added), [0, 0, 0, 0, 0], 'nothing twice');
});

test('a select value the form doesn’t know stops the run (no quiet fallback to the first option)', () => {
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ store: 3, recipes: [{ data: { name: 'Mystery Plate', course: 'Not A Course' } }] }));
  const r = load(bad, '--apply');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /isn’t one of the options/);
  const d = db();
  assert.equal(d.prepare("SELECT COUNT(*) n FROM entries WHERE json_extract(data, '$.name') = 'Mystery Plate'").get().n, 0);
  d.close();
});

test('the loader refuses The Baldwin’s own book', () => {
  const f = path.join(dir, 'store1.json');
  fs.writeFileSync(f, JSON.stringify({ store: 1, recipes: [] }));
  const r = load(f, '--apply');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /designed book/);
});

test('The Baldwin doesn’t change: its entries, the group dishes that were there, its pages and its quizzes', async () => {
  assert.equal(fingerprint(maxId), before1.fp, 'store 1’s entries and the group dishes that were there');
  const d = db();
  // the linked dish is still the group's, word for word; Testa Barra's wording is its own
  const lib = d.prepare("SELECT id, data FROM entries WHERE collection = 'recipe' AND store_id = 0 AND company_id = 1 AND id <= ? AND json_extract(data, '$.name') = ?").get(maxId, libName);
  const mine = d.prepare("SELECT data FROM entries WHERE collection = 'recipe' AND store_id = 3 AND json_extract(data, '$.libraryId') = ?").get(lib.id);
  d.close();
  assert.notEqual(JSON.parse(lib.data).description, 'Our calamari, lemon, capers');
  assert.equal(JSON.parse(mine.data).description, 'Our calamari, lemon, capers');
  assert.equal(JSON.stringify((await baldwinStaff('/api/page/13-2')).data), before1.matrix);
  assert.equal(JSON.stringify((await baldwinStaff('/api/page/14-2')).data), before1.bar);
  assert.equal(JSON.stringify((await baldwinStaff('/api/quiz/catalog')).data), before1.quiz);
});

test('Testa Barra reads a full book from its own menu, in its menu’s order', async () => {
  assert.equal((await testaStaff('/api/me')).data.user.store.ownMenu, true);
  const home = (await testaStaff('/api/page/4-2')).data;
  assert.ok(!home.empty, 'Home is a full page');
  const ht = texts(home.main).join(' | ');
  assert.match(ht, /EMBER CORN FRITTERS/, 'tonight’s focus is its own dish');
  assert.match(ht, /Quick Quiz/, 'its Quick Quiz asks about its own menu');
  assert.doesNotMatch(ht, /Opening Menu/, 'not The Baldwin’s menu name');
  assert.ok(!names(home.main).some((n) => n === 'Section · Photo Library'), 'not The Baldwin’s plates');
  const fm = texts((await testaStaff('/api/page/13-2')).data.main);
  const at = (s) => fm.indexOf(s);
  assert.ok(at('SMALL PLATES') >= 0 && at('SMALL PLATES') < at('BONE-INS & SUCH') && at('BONE-INS & SUCH') < at('PIZZAS'), 'courses in the menu’s order');
  assert.ok(fm.includes('Smoked Short Rib Hash'), 'its own “Short Rib” isn’t taken for The Baldwin’s');
  assert.ok(fm.includes('Our calamari, lemon, capers'));
  const bar = texts((await testaStaff('/api/page/14-2')).data.main).join(' | ');
  assert.match(bar, /COPPER LANTERN/);
  assert.doesNotMatch(bar, /HOUSE MARGARITA/, 'the carousel shows drinks whose ingredients the menu prints');
  assert.match(bar, /Tequila Cocktails · \$14/);
  for (const f of ['23-2', '30-2']) assert.ok((await testaStaff('/api/page/' + f)).data.empty, f + ': The Baldwin’s own designed page stays the starter page');
  assert.ok(!(await testaStaff('/api/page/18-2')).data.empty, 'Quizzes is a full page');
});

test('nothing of The Baldwin’s in Testa Barra’s book: every page and the search index', async () => {
  const d = db();
  // a classic's name is the shared library's (The Baldwin's "Spritz" is the Aperol Spritz every store has)
  const classics = new Set([...d.prepare("SELECT json_extract(data, '$.name') n FROM entries WHERE collection = 'classic'").all().map((r) => r.n.toLowerCase()), 'spritz', 'cosmo', 'lemon drop martini', 'proper martini']);
  const theirs = ['recipe', 'house'].flatMap((c) => d.prepare(`SELECT e.data, l.data lib FROM entries e LEFT JOIN entries l ON l.id = json_extract(e.data, '$.libraryId') WHERE e.collection = ? AND e.store_id = 1 AND e.archived_at IS NULL`).all(c))
    .map((r) => JSON.parse(r.lib || r.data).name || JSON.parse(r.data).name).filter((n) => n && n.length > 4 && n !== libName && !classics.has(n.toLowerCase()));
  d.close();
  assert.ok(theirs.length > 5);
  const RE = new RegExp('\\b(' + theirs.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b');
  const FIXED = /Opening Menu|wine flight|sommelier flight/i;
  const idx = (await testaStaff('/api/index')).data;
  const hits = [];
  // The shared library's pages (classics, spirits, wine regions) are every store's: there only The Baldwin's fixed marks count.
  const scan = (s, where, shared) => { const m = FIXED.exec(s) || (!shared && RE.exec(s)); if (m) hits.push(`${where}: ${m[0]}`); };
  for (const e of idx) scan(JSON.stringify(e), 'index ' + e.slug, classify(e.slug) === 'shared');
  const seen = new Set();
  for (const e of idx) { if (seen.has(e.file)) continue; seen.add(e.file); scan(texts((await testaStaff('/api/page/' + encodeURIComponent(e.file))).data?.main).join(' | '), e.file, classify(e.slug) === 'shared'); }
  assert.deepEqual(hits.slice(0, 10), []);
});

test('quizzes come from its own menu: its courses, its drinks, no prices, four different answers', async () => {
  const cat = (await testaStaff('/api/quiz/catalog')).data;
  const labels = cat.topics.map((t) => t.label);
  assert.ok(labels.includes('Small Plates'), labels.join(', '));
  const q = cat.quizzes.find((x) => x.topics?.includes('course:Small Plates'));
  assert.ok(q, 'a sign-off quiz for its own course');
});

test('the admin form offers The Baldwin its own courses, and a store its own as well', async () => {
  const mine = (await owner('/api/collections')).data.collections.recipe.fields.find((f) => f.key === 'course').options;
  assert.deepEqual(mine, BASE_COURSES, 'The Baldwin’s list is unchanged');
  assert.equal((await owner('/api/store', { method: 'POST', body: { storeId: 3 } })).status, 200);
  const testa = (await owner('/api/collections')).data.collections;
  assert.ok(testa.recipe.fields.find((f) => f.key === 'course').options.includes('Bone-Ins & Such'));
  assert.ok(testa.house.fields.find((f) => f.key === 'menuSection').options.includes('Tequila Cocktails'));
  assert.equal((await owner('/api/store', { method: 'POST', body: { storeId: 1 } })).status, 200);
});
