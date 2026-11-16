// Nov 15 audit #6: removing a demo copy leaves nothing behind. Demos go through the same schema-driven delete as a real
// company (wipeCompany), so after a demo is replaced no row in any table points at its company, its stores or its people.
// Also: quiz history left by demos removed before the fix is cleaned at startup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-demodrop-'));
const PORT = 5300 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const boot = async () => {
  giveAccount(dir); server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
};
const stop = () => new Promise((r) => { server.once('exit', r); server.kill(); });
before(boot);
after(async () => { if (server.exitCode === null) await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

function visitor() {
  let cookie = '';
  return async (p, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', 'x-bt': '1', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie().find((x) => x.startsWith('bt_session='));
    if (set) cookie = set.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };
}
const openDb = () => new DatabaseSync(path.join(dir, 'baldwin.db'));

/** Every row, in any table, that still points at the company, one of its stores or one of its people. */
function leftovers(db, company, stores, users) {
  const out = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    const q = (col, ids) => (ids.length && cols.includes(col) ? Number(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} IN (${ids.map(() => '?').join(',')})`).get(...ids).n) : 0);
    const n = (t === 'companies' ? q('id', [company]) : q('company_id', [company])) + (t === 'stores' ? q('id', stores) : q('store_id', stores)) + (t === 'users' ? q('id', users) : q('user_id', users));
    if (n) out.push(`${t}: ${n}`);
  }
  return out;
}

for (const [kind, role] of [['baldwin', 'employee'], ['mise', 'manager']]) {
  test(`${kind} demo (${role}): replacing the copy removes every row of the old one`, async () => {
    const me = visitor();
    assert.equal((await me('/api/demo/start', { method: 'POST', body: { role, demo: kind } })).status, 200);
    // some history of their own: a quiz (quiz_seen, the table the old list missed)
    const q = await me('/api/quiz/start', { method: 'POST', body: { quiz: 't:allergens' } });
    assert.equal(q.status, 200, JSON.stringify(q.data));
    let db = openDb();
    const userId = Number(db.prepare("SELECT user_id FROM sessions ORDER BY rowid DESC LIMIT 1").get().user_id);
    const company = Number(db.prepare('SELECT company_id FROM users WHERE id = ?').get(userId).company_id);
    const stores = db.prepare('SELECT id FROM stores WHERE company_id = ?').all(company).map((r) => Number(r.id));
    const users = db.prepare('SELECT id FROM users WHERE company_id = ?').all(company).map((r) => Number(r.id));
    assert.ok(Number(db.prepare('SELECT COUNT(*) n FROM quiz_seen WHERE user_id = ?').get(userId).n) > 0, 'the quiz left history');
    assert.ok(leftovers(db, company, stores, users).length > 5, 'the demo copy has rows to remove');
    db.close();
    assert.equal((await me('/api/demo/restart', { method: 'POST' })).data?.restarted, true);
    db = openDb();
    assert.deepEqual(leftovers(db, company, stores, users), []);
    db.close();
  });
}

test('startup removes quiz history of people who no longer exist', async () => {
  await stop();
  let db = openDb();
  db.prepare('INSERT INTO quiz_seen(user_id, store_id, quiz, ref, at) VALUES (?,?,?,?,?)').run(987654, 1, 't:allergens', 'x', new Date().toISOString());
  db.close();
  await boot();
  db = openDb();
  assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM quiz_seen WHERE user_id NOT IN (SELECT id FROM users)').get().n), 0);
  db.close();
});
