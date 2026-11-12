// Archive where items live (Nov 12): the Archive marks on list rows and cards (managers only), archiving from a page or a
// list takes the item out of the book, the quizzes and search, Restore brings it back, staff are blocked, a group dish
// archived from one store's menu stays on the others, and the Archived page lists everything by type.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-arc-'));
const PORT = 5700 + Math.floor(Math.random() * 300);
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
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@arc.test', SUPERADMIN_EMAIL: 'owner@arc.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = person(), manager = person(), staff = person(), testaGm = person();
let index = [], stores = [];
const file = (slug) => index.find((e) => e.slug === slug)?.file;
/** Every archive mark on a page. */
function arcs(page) {
  const out = [];
  (function walk(n) { if (n.arc) out.push({ ...n.arc, to: n.to, n: n.n, name: n.arc.n }); (n.c || []).forEach(walk); })(page.main);
  return out;
}
const questions = async (who, topic) => Object.values((await who('/api/quiz/start', { method: 'POST', body: { topics: [topic], count: 0 } })).data.questions);

test('setup: owner (super admin), a manager, staff, and a manager at another store', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Olivia Owner', email: 'owner@arc.test', password: 'long-enough-1' } })).status, 200);
  const code = (await owner('/api/team')).data.company.joinCode;
  stores = (await person()(`/api/join/${code}`)).data.stores;
  const inv = await owner('/api/team/invite', { method: 'POST', body: { email: 'mia@arc.test', role: 'manager', storeId: stores[0].id } });
  assert.equal((await manager(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Mia Manager', password: 'long-enough-2' } })).status, 200);
  assert.equal((await staff('/api/join', { method: 'POST', body: { code, name: 'Sam Staff', pin: '4321', storeId: stores[0].id } })).status, 200);
  const inv2 = await owner('/api/team/invite', { method: 'POST', body: { email: 'tess@arc.test', role: 'manager', storeId: stores[2].id } });
  assert.equal((await testaGm(`/api/invite/${inv2.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Tess Testa', password: 'long-enough-3' } })).status, 200);
  index = (await manager('/api/index')).data;
  assert.ok(file('food-matrix') && file('the-bar/cocktails') && file('the-bar/beer-and-draft'));
});

test('list rows carry Archive for managers, never for staff', async () => {
  for (const slug of ['food-matrix', 'the-bar/cocktails', 'the-bar/back-bar', 'the-bar/beer-and-draft']) {
    const s = (await staff('/api/page/' + file(slug))).data;
    assert.equal(arcs(s).length, 0, slug + ': nothing for staff');
  }
  const fm = arcs((await manager('/api/page/' + file('food-matrix'))).data);
  assert.ok(fm.length > 5 && fm.every((a) => a.c === 'recipe' && a.e > 0 && a.name), 'Food Matrix rows: dishes');
  const ck = arcs((await manager('/api/page/' + file('the-bar/cocktails'))).data);
  assert.ok(ck.some((a) => a.c === 'house'), 'Cocktails: house cocktails');
  assert.ok(!ck.some((a) => a.c === 'classic'), 'a manager can’t archive the shared classics');
  assert.ok(arcs((await owner('/api/page/' + file('the-bar/cocktails'))).data).some((a) => a.c === 'classic'), 'the super admin can');
  const beer = arcs((await manager('/api/page/' + file('the-bar/beer-and-draft'))).data);
  assert.ok(beer.length && beer.every((a) => a.c === 'beer' && /^Row · /.test(a.n)), 'Beer & Draft: tap table rows');
  // An item's own page: its hero and its link to itself get nothing (the Edit Mode bar has Archive).
  const dishFile = index.find((e) => e.section === 'Recipe' && e.file.startsWith('e')).file;
  const dish = (await manager('/api/page/' + dishFile)).data;
  assert.ok(!arcs(dish).some((a) => a.e === dish.edit.main), 'no Archive on the page’s own item');
});

test('archive from a list → gone from the book, quizzes and search; restore brings it back', async () => {
  const fm = arcs((await manager('/api/page/' + file('food-matrix'))).data);
  const a = fm[0];
  const entry = (await manager(`/api/entries/${a.e}`)).data;
  const topic = 'course:' + entry.data.course;
  const asked = (qs) => qs.some((q) => JSON.stringify(q).includes(a.name));
  assert.ok(asked(await questions(staff, topic)), 'quizzes ask about it first');
  assert.ok((await staff('/api/index')).data.some((e) => e.title === a.name), 'search has it first');
  // Staff can't archive or restore.
  assert.equal((await staff(`/api/entries/${a.e}`, { method: 'DELETE' })).status, 403);
  assert.equal((await staff('/api/archived')).status, 403);
  assert.equal((await staff('/api/archived/restore', { method: 'POST', body: { group: 'recipe' } })).status, 403);
  assert.equal((await manager(`/api/entries/${a.e}`, { method: 'DELETE' })).status, 200);
  assert.equal((await staff('/api/page/e' + a.e)).status, 404, 'its page is out of the book');
  assert.ok(!(await staff('/api/index')).data.some((e) => e.title === a.name), 'out of search');
  assert.ok(!asked(await questions(staff, topic)), 'out of the quizzes');
  assert.ok(!arcs((await manager('/api/page/' + file('food-matrix'))).data).some((x) => x.e === a.e), 'off the Food Matrix');
  // The Archived page lists it under Dishes, with who and when.
  const groups = (await manager('/api/archived')).data.groups;
  assert.deepEqual(groups.map((g) => g.label), ['Dishes', 'House Cocktails', 'Wines', 'Bottles', 'Beers', 'Prep items', 'Videos and Photos'], 'by type; no classics for a manager (Nov 12: + Prep items)');
  const it = groups[0].items.find((x) => x.id === a.e);
  assert.ok(it && it.by === 'Mia Manager' && it.at, 'who archived it, and when');
  assert.equal(it.storeOnly?.store, 'The Baldwin', 'a group dish: off this store’s menu only');
  assert.ok((await owner('/api/archived')).data.groups.some((g) => g.id === 'classic'), 'the super admin sees classics too');
  // Restore.
  assert.equal((await manager(`/api/entries/${a.e}/restore`, { method: 'POST' })).status, 200);
  assert.equal((await staff('/api/page/e' + a.e)).status, 200, 'back in the book');
  assert.ok((await staff('/api/index')).data.some((e) => e.title === a.name), 'back in search');
  assert.ok(asked(await questions(staff, topic)), 'back in the quizzes');
});

test('archive from Edit Mode (the item’s page), then Restore All', async () => {
  const house = index.find((e) => e.section === 'Signature' && e.file.startsWith('e'));
  const wine = index.find((e) => e.section === 'Wine list' && e.file.startsWith('e'));
  for (const e of [house, wine]) {
    const p = (await manager('/api/page/' + e.file)).data;
    assert.ok(p.edit?.main, e.title + ': the page has an Edit Mode entry to archive');
    assert.equal((await manager(`/api/entries/${p.edit.main}`, { method: 'DELETE' })).status, 200);
    assert.equal((await staff('/api/page/' + e.file)).status, 404);
  }
  let groups = (await manager('/api/archived')).data.groups;
  assert.equal(groups.find((g) => g.id === 'house').items.length, 1);
  assert.equal(groups.find((g) => g.id === 'wine').items.length, 1);
  assert.equal((await manager('/api/archived/restore', { method: 'POST', body: { group: 'classic' } })).status, 403, 'classics: super admin only');
  assert.equal((await manager('/api/archived/restore', { method: 'POST', body: { group: 'nope' } })).status, 400);
  const r = await manager('/api/archived/restore', { method: 'POST', body: { group: 'house' } });
  assert.deepEqual([r.status, r.data.restored], [200, 1]);
  assert.equal((await staff('/api/page/' + house.file)).status, 200, 'Restore All brings it back');
  await manager('/api/archived/restore', { method: 'POST', body: { group: 'wine' } });
  groups = (await manager('/api/archived')).data.groups;
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), 0, 'nothing left in Archived');
});

test('a group dish archived from one store’s menu stays on the other', async () => {
  const lib = (await testaGm('/api/library?collection=recipe')).data.entries;
  const dish = lib.find((x) => !x.onMine);
  const mine = (await testaGm('/api/entries', { method: 'POST', body: { collection: 'recipe', libraryId: dish.id, data: { course: dish.data.course } } })).data;
  const mark = arcs((await testaGm('/api/page/' + file('food-matrix'))).data).find((a) => a.e === mine.id);
  assert.deepEqual([mark?.s, mark?.o], ['Testa Barra', 1], 'the row knows it’s a group dish, and who else has it');
  assert.equal((await testaGm(`/api/entries/${mine.id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!(await testaGm('/api/index')).data.some((e) => e.title === dish.data.name), 'off Testa Barra');
  assert.ok((await staff('/api/index')).data.some((e) => e.title === dish.data.name), 'still on The Baldwin');
  const it = (await testaGm('/api/archived')).data.groups[0].items.find((x) => x.id === mine.id);
  assert.deepEqual(it.storeOnly, { store: 'Testa Barra', others: 1 });
  assert.equal((await manager('/api/archived')).data.groups[0].items.length, 0, 'not in another store’s Archived');
  assert.equal((await manager(`/api/entries/${mine.id}/restore`, { method: 'POST' })).status, 404, 'another store can’t restore it');
  assert.equal((await testaGm(`/api/entries/${mine.id}/restore`, { method: 'POST' })).status, 200);
});
