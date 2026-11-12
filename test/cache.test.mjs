// Speed (Nov 11, Tommy: "why is it taking so long to load?"): the search index and quiz questions are kept per store and
// dropped the moment the book changes (server/cache.mjs), and JSON goes compressed. These check that a save shows at once,
// for everyone in that store; that two stores, companies or demos never get each other's copy; and that the compressed
// answer is the same answer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-cache-'));
const PORT = 6200 + Math.floor(Math.random() * 300); // clear of the other test files' ranges (reset.test uses up to 5999)
const BASE = `http://127.0.0.1:${PORT}`;
let server;

/** A person with their own cookie jar. */
function person() {
  const me = async (p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(me.jar ? { Cookie: me.jar } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie().find((c) => c.startsWith('bt_session='));
    if (set) me.jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  me.jar = '';
  return me;
}
/** The raw bytes and headers, with a chosen Accept-Encoding (fetch would decode them for us). */
function raw(p, jar, encoding) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, { headers: { Cookie: jar, 'Accept-Encoding': encoding } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@cache.test', SUPERADMIN_EMAIL: 'owner@cache.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = person(), manager = person(), staff = person(), testaGm = person();
let stores = [];
const index = async (who) => (await who('/api/index')).data;
const entryIn = (idx, section) => idx.find((e) => e.section === section && e.file.startsWith('e'));
/** Every question a topic has (a custom quiz of "every question"). */
const questions = async (who, topic) => Object.values((await who('/api/quiz/start', { method: 'POST', body: { topics: [topic], count: 0 } })).data.questions);

test('setup: owner, a manager and staff at The Baldwin, a manager at Testa Barra', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Olive Owner', email: 'owner@cache.test', password: 'long-enough-1' } })).status, 200);
  const code = (await owner('/api/team')).data.company.joinCode;
  stores = (await person()(`/api/join/${code}`)).data.stores;
  const inv = await owner('/api/team/invite', { method: 'POST', body: { email: 'mara@cache.test', role: 'manager', storeId: stores[0].id } });
  assert.equal((await manager(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Mara Manager', password: 'long-enough-2' } })).status, 200);
  assert.equal((await staff('/api/join', { method: 'POST', body: { code, name: 'Stan Staff', pin: '4321', storeId: stores[0].id } })).status, 200);
  const inv2 = await owner('/api/team/invite', { method: 'POST', body: { email: 'tia@cache.test', role: 'manager', storeId: stores[2].id } });
  assert.equal((await testaGm(`/api/invite/${inv2.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Tia Testa', password: 'long-enough-3' } })).status, 200);
});

test('a save shows at once, for everyone in the store: the index, the page and the quiz questions', async () => {
  // Read everything first, so the caches are full before the save.
  const idx = await index(manager);
  await index(staff);
  const dish = entryIn(idx, 'Recipe');
  const id = Number(dish.file.slice(1));
  const course = (await manager(`/api/entries/${id}`)).data.data.course;
  assert.ok(course, 'the dish has a course');
  await questions(staff, 'course:' + course);
  // Edit Mode save
  const words = 'Charred over cherry wood with a zebra-stripe glaze';
  assert.equal((await manager(`/api/entries/${id}`, { method: 'PATCH', body: { changes: { description: words } } })).status, 200);
  for (const who of [manager, staff]) assert.match(JSON.stringify((await index(who)).find((e) => e.file === dish.file)), /zebra-stripe glaze/, 'the search index has the new words');
  assert.match(JSON.stringify((await staff('/api/page/' + dish.file)).data), /zebra-stripe glaze/, 'the page has them');
  assert.ok((await questions(staff, 'course:' + course)).some((q) => q.q.includes('zebra-stripe glaze')), 'the quiz asks about the new description');
  // A new name
  assert.equal((await manager(`/api/entries/${id}`, { method: 'PATCH', body: { changes: { name: 'Zebra Glazed Chop' } } })).status, 200);
  assert.equal((await index(staff)).find((e) => e.file === dish.file).title, 'Zebra Glazed Chop');
  // Archive and restore
  assert.equal((await manager(`/api/entries/${id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!(await index(staff)).some((e) => e.file === dish.file), 'archived: out of the index');
  assert.ok(!(await questions(staff, 'course:' + course)).some((q) => q.q.includes('zebra-stripe glaze')), 'and out of the quizzes');
  assert.equal((await manager(`/api/entries/${id}/restore`, { method: 'POST' })).status, 200);
  assert.ok((await index(staff)).some((e) => e.file === dish.file), 'restored: back in');
  // A new drink from the admin form
  const made = await manager('/api/entries', { method: 'POST', body: { collection: 'house', data: { name: 'Cache Buster Sour', menuSection: 'Specialty Cocktails' } } });
  assert.equal(made.status, 200);
  assert.ok((await index(staff)).some((e) => e.title === 'Cache Buster Sour'), 'a new drink is in the index right away');
});

test('two stores never get each other’s index', async () => {
  const theBaldwin = await index(manager);
  const testa0 = await index(testaGm);
  assert.ok(entryIn(theBaldwin, 'Signature'), 'The Baldwin has its house cocktails');
  assert.ok(!testa0.some((e) => e.file === entryIn(theBaldwin, 'Signature').file), 'Testa Barra doesn’t get them');
  const made = await testaGm('/api/entries', { method: 'POST', body: { collection: 'house', data: { name: 'Testa Only Spritz', menuSection: 'Specialty Cocktails' } } });
  assert.equal(made.status, 200);
  assert.ok((await index(testaGm)).some((e) => e.title === 'Testa Only Spritz'), 'Testa Barra sees its new drink');
  for (let i = 0; i < 2; i++) assert.ok(!(await index(manager)).some((e) => e.title === 'Testa Only Spritz'), 'The Baldwin never does');
  assert.ok(!(await index(testaGm)).some((e) => e.title === 'Cache Buster Sour'), 'and Testa Barra never gets The Baldwin’s');
});

test('two demos (two brands) never get each other’s index, and a restart starts clean', async () => {
  const demo = async (role, which) => {
    const who = person();
    assert.equal((await who('/api/demo/start', { method: 'POST', body: { role, demo: which } })).status, 200);
    return who;
  };
  const BALDWIN = /Baldwin|Testa Barra|Jeffrey(?! Ong)|\bBRG\b|Macomb|Shelby|Opening Menu|Paloma Verde|Lobster Tagliatelle|Cacio e Pepe/i;
  const b = await demo('manager', 'baldwin');
  const bIdx = JSON.stringify(await index(b));
  assert.match(bIdx, /Paloma Verde/, 'The Baldwin’s demo has its own drinks');
  for (const role of ['manager', 'employee']) {
    const m = await demo(role, 'mise');
    for (let i = 0; i < 2; i++) {
      const hit = JSON.stringify(await index(m)).match(new RegExp('.{0,40}(' + BALDWIN.source + ').{0,40}', 'i'));
      assert.equal(hit, null, 'no Baldwin text in the Mise demo’s index: ' + hit?.[0]);
    }
    // a refresh makes a new copy; its index is Wrenfield's again
    assert.equal((await m('/api/demo/restart', { method: 'POST' })).data.restarted, true);
    const again = JSON.stringify(await index(m));
    assert.doesNotMatch(again, BALDWIN);
    assert.match(again, /Smoke Signal/);
  }
  assert.equal(JSON.stringify(await index(b)), bIdx, 'The Baldwin’s demo reads the same as before');
  // The Mise demo's own pages are read for the person asking (Home greets them by name)
  const m = await demo('manager', 'mise');
  assert.match(JSON.stringify((await index(m)).find((e) => e.slug === '')), /Rosalind/);
});

test('a change written by another program (a script on the live file) shows too', async () => {
  const idx = await index(manager);
  const drink = entryIn(idx, 'Signature');
  const db = new DatabaseSync(path.join(dir, 'baldwin.db'));
  try {
    db.prepare("UPDATE entries SET data = json_set(data, '$.tagline', 'Written from outside the server') WHERE id = ?").run(Number(drink.file.slice(1)));
  } finally { db.close(); }
  assert.match(JSON.stringify((await index(manager)).find((e) => e.file === drink.file)), /Written from outside the server/);
});

test('JSON goes compressed when the browser takes it, and decodes to the same answer', async () => {
  const plain = await raw('/api/index', manager.jar, 'identity');
  assert.equal(plain.headers['content-encoding'], undefined);
  const list = JSON.parse(plain.body);
  assert.ok(list.length > 500);
  const br = await raw('/api/index', manager.jar, 'gzip, deflate, br');
  assert.equal(br.headers['content-encoding'], 'br');
  assert.match(br.headers.vary || '', /Accept-Encoding/i);
  assert.ok(br.body.length < 300_000, 'the index is under 300 KB on the wire: ' + br.body.length);
  assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(br.body)), list);
  const gz = await raw('/api/index', manager.jar, 'gzip');
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.deepEqual(JSON.parse(zlib.gunzipSync(gz.body)), list);
  assert.equal((await raw('/api/index', manager.jar, 'br;q=0, gzip')).headers['content-encoding'], 'gzip', 'q=0 means no');
  // a page, compressed per request
  const page = await raw('/api/page/4-2', manager.jar, 'br');
  assert.equal(page.headers['content-encoding'], 'br');
  assert.ok(JSON.parse(zlib.brotliDecompressSync(page.body)).main);
  // small answers go as they are
  assert.equal((await raw('/api/health', '', 'br')).headers['content-encoding'], undefined);
});
