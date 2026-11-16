// Nov 15 audit fixes (round A): Home never links to a page that doesn't exist; the Allergen Guide has a column for every
// allergen a dish can carry (Pork too), every dish row has one cell per column, and a tagged cell carries its column's name
// so a phone can show it as a chip. Runs the real server on a temp database, both demos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALLERGENS } from '../server/cms.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-audit15-'));
const PORT = 5100 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };

async function demo(kind, role) {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ role, demo: kind }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
  const get = async (p) => { const x = await fetch(BASE + p, { headers: { cookie, 'x-bt': '1' } }); assert.equal(x.status, 200, p); return x.json(); };
  return { get, index: await get('/api/index') };
}
// Pages the app draws itself (not from the book's index).
const APP = /^\/(admin|import|prep|team-chat|my-path|certificate|demo)(\/|$)/;

for (const kind of ['baldwin', 'mise']) {
  for (const role of ['employee', 'manager']) {
    test(`${kind} demo, ${role}: every link on Home opens a real page`, async () => {
      const { get, index } = await demo(kind, role);
      const slugs = new Set(index.map((e) => e.slug));
      const home = index.find((e) => e.slug === '');
      const page = await get('/api/page/' + home.file);
      const links = all(page.main, (n) => typeof n.to === 'string' && n.to.startsWith('/')).map((n) => n.to.split(/[?#]/)[0]);
      assert.ok(links.length > 10, 'Home has links: ' + links.length);
      const dead = [...new Set(links.filter((to) => to !== '/' && !APP.test(to) && !slugs.has(to.slice(1))))];
      assert.deepEqual(dead, []);
      // the focus photo and Open Spec Sheet go to the same dish
      const hero = all(page.main, (n) => (n.n || '').startsWith('Hero · '))[0];
      const photo = all(hero, (n) => n.n === 'Photo')[0], spec = all(hero, (n) => n.n === 'Button · Spec')[0];
      if (photo?.to && spec?.to) assert.equal(photo.to, spec.to);
    });
  }

  test(`${kind} demo: the Allergen Guide has every allergen column, Pork included, and labels its marks`, async () => {
    const { get, index } = await demo(kind, 'employee');
    const page = await get('/api/page/' + index.find((e) => e.slug === 'allergen-guide').file);
    const grid = all(page.main, (n) => n.n === 'Allergen grid')[0];
    const head = grid.c.find((c) => c.n === 'Header');
    const cols = head.c.slice(1).map((c) => c.n);
    assert.deepEqual([...cols].sort(), [...ALLERGENS].sort());
    assert.ok(cols.includes('Pork'));
    const rows = grid.c.filter((c) => /^Row · /.test(c.n));
    assert.ok(rows.length > 5);
    let tagged = 0;
    for (const r of rows) {
      assert.equal(r.c.length, head.c.length, r.n);
      for (const c of r.c.slice(1)) {
        const marked = all(c, (n) => n.n === 'Contains').length > 0;
        if (marked) { tagged++; assert.ok(c.lab, `${r.n} · ${c.n} has a mark but no label`); assert.ok(!c.empty); }
        else assert.ok(c.empty && !c.lab, `${r.n} · ${c.n} has no mark, so it hides on a phone`);
      }
      // the dish name wraps instead of being cut off
      assert.equal(r.c[0].sh, 'L');
    }
    assert.ok(tagged > 10, 'dishes carry allergens: ' + tagged);
  });
}

// Code review, Nov 15: a malformed address answers 400 (it threw in decodeURIComponent: a 500 and a false-alarm error row).
test('a malformed address answers 400, not a server error', async () => {
  for (const p of ['/%E0%A4%A', '/media/%zz', '/img/%']) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 400, p);
  }
  assert.equal((await fetch(BASE + '/allergen-guide')).status, 200, 'normal addresses still load');
});

test('the error log keeps 90 days', async () => {
  process.env.DATA_DIR = dir;
  const { DatabaseSync } = await import('node:sqlite');
  const { pruneErrors } = await import('../server/ops.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE errors(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, path TEXT, message TEXT NOT NULL,
    stack TEXT, user_id INT, count INT NOT NULL DEFAULT 1, first_at TEXT NOT NULL, last_at TEXT NOT NULL)`);
  const at = (days) => new Date(Date.now() - days * 864e5).toISOString();
  for (const d of [1, 89, 91, 400]) db.prepare("INSERT INTO errors(kind, message, first_at, last_at) VALUES ('server', ?, ?, ?)").run('e' + d, at(d), at(d));
  assert.equal(pruneErrors(db), 2);
  assert.deepEqual(db.prepare('SELECT message FROM errors ORDER BY id').all().map((r) => r.message), ['e1', 'e89']);
});
