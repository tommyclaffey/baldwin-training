// Edit Mode (Nov 11): who gets fields on a page, and PATCH /api/entries/:id — permissions, validation, archive,
// and "all restaurants or only this one" for the group's shared dishes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-edit-'));
const PORT = 5400 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

/** A person with their own cookie jar. */
function person() {
  let jar = '';
  return async (p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

before(async () => {
  // The owner is also the super admin here (like production), so classics can be edited by someone.
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@edit.test', SUPERADMIN_EMAIL: 'owner@edit.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = person(), manager = person(), staff = person(), testaGm = person();
let index = [], stores = [];
const file = (slug) => index.find((e) => e.slug === slug)?.file;
const entryOf = (section) => index.find((e) => e.section === section && e.file.startsWith('e'));
/** Every Edit Mode mark on a page: fields, cards, editing-only parts. */
function marks(page) {
  const out = { ed: [], edc: 0, eo: 0 };
  (function walk(n) { if (n.ed) out.ed.push(n.ed); if (n.edc) out.edc++; if (n.eo) out.eo++; (n.c || []).forEach(walk); })(page.main);
  return out;
}

test('setup: owner, a manager, staff, and a manager at another store', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Olivia Owner', email: 'owner@edit.test', password: 'long-enough-1' } })).status, 200);
  const code = (await owner('/api/team')).data.company.joinCode;
  stores = (await person()(`/api/join/${code}`)).data.stores;
  const inv = await owner('/api/team/invite', { method: 'POST', body: { email: 'mia@edit.test', role: 'manager', storeId: stores[0].id } });
  assert.equal((await manager(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Mia Manager', password: 'long-enough-2' } })).status, 200);
  assert.equal((await staff('/api/join', { method: 'POST', body: { code, name: 'Sam Staff', pin: '4321', storeId: stores[0].id } })).status, 200);
  const inv2 = await owner('/api/team/invite', { method: 'POST', body: { email: 'tess@edit.test', role: 'manager', storeId: stores[2].id } });
  assert.equal((await testaGm(`/api/invite/${inv2.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Tess Testa', password: 'long-enough-3' } })).status, 200);
  index = (await owner('/api/index')).data;
  assert.ok(entryOf('Signature') && entryOf('Recipe') && entryOf('Classic') && entryOf('Wine list') && entryOf('Back bar'));
});

test('staff never get fields, cards or editing-only parts; managers do', async () => {
  for (const section of ['Signature', 'Recipe', 'Wine list', 'Back bar', 'Classic']) {
    const f = entryOf(section).file;
    const s = (await staff('/api/page/' + f)).data;
    const m = marks(s);
    assert.deepEqual([m.ed.length, m.edc, m.eo, s.edit], [0, 0, 0, undefined], section + ': nothing for staff');
  }
  const beer = (await staff('/api/page/' + file('the-bar/beer-and-draft'))).data;
  assert.equal(beer.edit, undefined, 'beer list: nothing for staff');
  // A manager gets the house cocktail's fields, with the saved values (not the staff wording).
  const house = entryOf('Signature');
  const p = (await manager('/api/page/' + house.file)).data;
  const keys = marks(p).ed.map((e) => e.k);
  for (const k of ['photo', 'name', 'tagline', 'description', 'glass', 'garnish', 'build', 'tags', 'tasteLine', 'say', 'story']) assert.ok(keys.includes(k), 'house cocktail: ' + k);
  assert.equal(p.edit.main, Number(house.file.slice(1)));
  assert.equal(p.edit.entries[p.edit.main].col, 'house');
  assert.equal(marks(p).ed.find((e) => e.k === 'build').t, 'spec', 'the spec is an inline editor');
  // Dishes: names, prices, allergens, the build cell by cell.
  const dish = (await manager('/api/page/' + entryOf('Recipe').file)).data;
  const dk = marks(dish).ed.map((e) => e.k);
  for (const k of ['name', 'price', 'station', 'allergens', 'ingredients', 'components.0.component', 'steps.0.title', 'sellingLine']) assert.ok(dk.includes(k), 'dish: ' + k);
  assert.deepEqual(marks(dish).ed.find((e) => e.k === 'allergens').opts.slice(0, 2), ['Dairy', 'Egg']);
  // Wine and back bar bottles.
  assert.ok(marks((await manager('/api/page/' + entryOf('Wine list').file)).data).ed.some((e) => e.k === 'notes'));
  assert.ok(marks((await manager('/api/page/' + entryOf('Back bar').file)).data).ed.some((e) => e.k === 'name'));
  // Beers on tap: cells of the tap table.
  const bp = (await manager('/api/page/' + file('the-bar/beer-and-draft'))).data;
  assert.ok(bp.edit && Object.values(bp.edit.entries).every((x) => x.col === 'beer') && marks(bp).ed.some((e) => e.k === 'abv'));
  // Classics are the shared library: a manager gets no fields, the super admin does.
  const classic = entryOf('Classic').file;
  assert.equal(marks((await manager('/api/page/' + classic)).data).ed.length, 0, 'no classic fields for a manager');
  assert.ok(marks((await owner('/api/page/' + classic)).data).ed.length > 5, 'the super admin edits classics');
});

test('PATCH: who can save', async () => {
  const id = Number(entryOf('Signature').file.slice(1));
  const body = { changes: { tagline: 'Bright and pink' } };
  assert.equal((await person()(`/api/entries/${id}`, { method: 'PATCH', body })).status, 401, 'signed out');
  assert.equal((await manager(`/api/entries/${id}`, { method: 'PATCH', body, headers: { 'X-BT': '' } })).status, 403, 'no X-BT header');
  assert.equal((await staff(`/api/entries/${id}`, { method: 'PATCH', body })).status, 403, 'staff');
  assert.equal((await testaGm(`/api/entries/${id}`, { method: 'PATCH', body })).status, 404, 'another store’s drink doesn’t exist there');
  const classic = Number(entryOf('Classic').file.slice(1));
  assert.equal((await manager(`/api/entries/${classic}`, { method: 'PATCH', body: { changes: { tagline: 'x' } } })).status, 403, 'classics: managers can’t');
  const ok = await owner(`/api/entries/${classic}`, { method: 'PATCH', body: { changes: { tagline: 'The original' } } });
  assert.equal(ok.status, 200, 'classics: the super admin can');
  assert.equal(ok.data.data.tagline, 'The original');
  const saved = await manager(`/api/entries/${id}`, { method: 'PATCH', body });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.data.tagline, 'Bright and pink');
});

test('PATCH: only real fields, cleaned like the form, and nothing else touched', async () => {
  const id = Number(entryOf('Signature').file.slice(1));
  const before = (await manager(`/api/entries/${id}`)).data;
  assert.equal((await manager(`/api/entries/${id}`, { method: 'PATCH', body: { changes: {} } })).status, 400, 'nothing to save');
  assert.equal((await manager(`/api/entries/${id}`, { method: 'PATCH', body: { changes: 'name' } })).status, 400, 'not an object');
  assert.equal((await manager(`/api/entries/${id}`, { method: 'PATCH', body: { changes: { libraryId: 3 } } })).status, 400, 'not a field');
  assert.equal((await manager(`/api/entries/${id}`, { method: 'PATCH', body: { changes: { name: '   ' } } })).status, 400, 'a name is required');
  const build = [{ amount: '1.25 oz', ingredient: 'Blanco Tequila', link: '/spirit/tequila', spirit: true }, { amount: '', ingredient: '' }, { amount: '.5 oz', ingredient: 'Lime', link: 'https://evil.test' }];
  const r = await manager(`/api/entries/${id}`, { method: 'PATCH', body: { changes: { build, photo: 'https://evil.test/x.jpg', menuSection: 'Not a section', tags: ['Floral', '', 'Tart'] } } });
  assert.equal(r.status, 200);
  const d = r.data.data;
  assert.equal(d.build.length, 2, 'empty rows go');
  assert.equal(d.build[1].link, '', 'outside links aren’t kept');
  assert.equal(d.photo, '', 'photos only from our own library');
  assert.equal(d.menuSection, 'Specialty Cocktails', 'a select falls back to its first option');
  assert.deepEqual(d.tags, ['Floral', 'Tart']);
  assert.equal(d.say, before.data.say, 'fields not sent stay as they were');
  assert.equal(d.name, before.data.name);
  // The change reaches the page, and Cocktail Specs (which the quizzes read).
  const page = JSON.stringify((await staff('/api/page/' + entryOf('Signature').file)).data);
  assert.ok(page.includes('Bright and pink'), 'staff see the saved tagline');
  assert.ok(JSON.stringify((await staff('/api/page/' + file('the-bar/cocktail-specs'))).data).includes('1.25 oz'), 'Cocktail Specs follows the build');
});

test('PATCH: an archived page can’t be edited until it’s restored', async () => {
  const id = Number(entryOf('Back bar').file.slice(1));
  assert.equal((await manager(`/api/entries/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await manager('/api/page/e' + id)).status, 404, 'archived: out of the book');
  const r = await manager(`/api/entries/${id}`, { method: 'PATCH', body: { changes: { notes: 'x' } } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /archived/i);
  assert.equal((await manager(`/api/entries/${id}/restore`, { method: 'POST' })).status, 200);
  assert.equal((await manager(`/api/entries/${id}`, { method: 'PATCH', body: { changes: { notes: 'Our well vodka.' } } })).status, 200);
  assert.ok(JSON.stringify((await staff('/api/page/e' + id)).data).includes('Our well vodka.'));
});

test('a shared dish: save for every restaurant, or only this one', async () => {
  // Testa Barra puts a group dish on its menu.
  const lib = (await testaGm('/api/library?collection=recipe')).data.entries;
  const dish = lib.find((x) => !x.onMine);
  const mine = (await testaGm('/api/entries', { method: 'POST', body: { collection: 'recipe', libraryId: dish.id, data: { course: dish.data.course } } })).data;
  const page = (await testaGm('/api/page/e' + mine.id)).data;
  assert.deepEqual(page.edit.entries[mine.id].shared, { others: 1, store: 'Testa Barra' }, 'the page says who else has it');
  assert.ok(page.edit.entries[mine.id].local.includes('price'), 'and which fields are always this store’s own');
  const baldwinOf = async () => (await owner('/api/entries?collection=recipe')).data.entries.find((e) => e.data.name === dish.data.name);
  await owner('/api/store', { method: 'POST', body: { storeId: stores[0].id } });
  const baldwin0 = await baldwinOf();
  // Only this store.
  assert.equal((await testaGm(`/api/entries/${mine.id}`, { method: 'PATCH', body: { changes: { tagline: 'Testa’s own line', price: '21' }, scope: 'store' } })).status, 200);
  let b = await baldwinOf();
  assert.equal(b.data.tagline, baldwin0.data.tagline, 'The Baldwin keeps its line');
  assert.equal((await testaGm(`/api/entries/${mine.id}`)).data.data.tagline, 'Testa’s own line');
  // Every restaurant.
  assert.equal((await testaGm(`/api/entries/${mine.id}`, { method: 'PATCH', body: { changes: { description: 'Shared everywhere now.' }, scope: 'group' } })).status, 200);
  b = await baldwinOf();
  assert.equal(b.data.description, 'Shared everywhere now.', 'a group save reaches The Baldwin');
  assert.equal(b.data.price, baldwin0.data.price, 'prices stay each store’s own');
  assert.equal((await testaGm(`/api/entries/${mine.id}`)).data.data.tagline, 'Testa’s own line', 'the store-only line stays');
});
