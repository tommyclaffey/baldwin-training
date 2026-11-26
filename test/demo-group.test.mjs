// Demo copies in the super admin lists (Nov 17, Tommy: "we have so many duplicate companies"). Every /demo visit makes a
// throwaway company, and a Baldwin demo copy is even called Baldwin Restaurant Group. Super Admin → Companies, People,
// Work Here and the HQ home list real companies only, with one row per demo (its open copies counted), and demo copies are
// never counted as customers. Exit Demo takes the visitor's own copy with it (the nightly smoke test ends every demo it
// starts that way), and idle copies nobody can get back into go at the hourly sweep. Real companies are never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, turnOnTwoStep, startServer } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-demogroup-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;

before(async () => {
  giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@demogroup.test', SUPERADMIN_EMAIL: 'tommy@demogroup.test', RESEND_API_KEY: '', MAIL_FROM: '', PREP_WEEKLY: 'off' }));
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

function person(ip) {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const owner = person('10.7.0.1'), tommy = person('10.7.0.2');
const visitors = [0, 1, 2].map((i) => person('10.7.1.' + i)), figandfire = person('10.7.2.1');
const realCompanies = () => { const d = db(); const r = d.prepare('SELECT id, name, deleted_at FROM companies WHERE demo = 0 ORDER BY id').all(); d.close(); return JSON.stringify(r); };
let real = '';

test('setup: The Baldwin’s owner, the super admin, a second customer, and four demo visitors', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Bram Owner', email: 'owner@demogroup.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy Claffey', email: 'tommy@demogroup.test', password: 'long-enough-1' } })).status, 200);
  await turnOnTwoStep(tommy, { workIn: null });
  assert.equal((await tommy('/api/super/companies', { method: 'POST', body: { name: 'Larkspur Tavern' } })).status, 200);
  for (const [i, v] of visitors.entries()) assert.equal((await v('/api/demo/start', { method: 'POST', body: { role: i ? 'employee' : 'manager', demo: 'baldwin' } })).status, 200);
  assert.equal((await figandfire('/api/demo/start', { method: 'POST', body: { role: 'manager', demo: 'mise' } })).status, 200);
  const d = db();
  assert.equal(d.prepare("SELECT COUNT(*) n FROM companies WHERE demo = 1 AND name = 'Baldwin Restaurant Group'").get().n, 3, 'the copies share the real customer’s name');
  d.close();
  real = realCompanies();
});

test('Super Admin → Companies: real companies once each, then one row per demo with its open copies', async () => {
  const ov = (await tommy('/api/super/overview')).data;
  assert.deepEqual(ov.companies.map((c) => c.name), ['Mise Academy (HQ)', 'Baldwin Restaurant Group', 'Larkspur Tavern']);
  assert.ok(ov.companies.every((c) => !c.demo));
  assert.equal(ov.companies.filter((c) => c.name === 'Baldwin Restaurant Group').length, 1, 'the real customer is never confusable with a demo copy');
  assert.deepEqual(ov.demos.map((x) => [x.kind, x.name, x.path, x.open]), [['baldwin', 'The Baldwin (demo)', '/demo/brg', 3], ['mise', 'Fig & Fire', '/demo/mise', 1]]);
  assert.deepEqual(ov.demos.map((x) => x.lookName), ['The Baldwin', 'Mise Academy']);
  // the HQ home groups them the same way, and the sidebar's count is customers + HQ only
  const home = (await tommy('/api/super/home')).data;
  assert.deepEqual(home.demos.map((x) => [x.name, x.open]), ov.demos.map((x) => [x.name, x.open]));
  assert.deepEqual(home.companies.map((c) => c.name), ov.companies.map((c) => c.name));
  assert.equal((await tommy('/api/super/counts')).data.companies, 3);
});

test('People, Edit Person and Work Here never offer a demo copy or its made-up people', async () => {
  const users = (await tommy('/api/super/users?q=&company=')).data.users;
  assert.ok(users.length >= 2);
  for (const n of ['Gideon Ambrose', 'Rosalind Hart', 'Marisol Vega', 'Hollis Grant']) assert.ok(!users.some((u) => u.name === n), `${n} is a demo person`);
  const d = db();
  const copy = d.prepare('SELECT id FROM companies WHERE demo = 1 LIMIT 1').get().id;
  const bram = d.prepare("SELECT id FROM users WHERE email = 'owner@demogroup.test'").get().id;
  d.close();
  assert.equal((await tommy('/api/super/act', { method: 'POST', body: { companyId: copy } })).status, 400);
  assert.equal((await tommy(`/api/super/users/${bram}`, { method: 'PATCH', body: { companyId: copy } })).status, 400);
  assert.equal((await tommy(`/api/super/users?q=&company=${copy}`)).data.users.length, 0);
});

test('a customer sees none of it: the super admin lists answer “not found”', async () => {
  for (const p of ['/api/super/overview', '/api/super/home', '/api/super/counts']) assert.equal((await owner(p)).status, 404, p);
  const me = (await owner('/api/me')).data;
  assert.equal(JSON.stringify(me).includes('The Baldwin (demo)'), false);
});

test('Exit Demo removes only that visitor’s own copy; real companies are untouched', async () => {
  const d = db();
  const before = d.prepare('SELECT COUNT(*) n FROM companies WHERE demo = 1').get().n;
  d.close();
  assert.equal((await visitors[0]('/api/demo/exit', { method: 'POST' })).status, 200);
  assert.equal((await visitors[0]('/api/me')).data?.user ?? null, null, 'signed out');
  const ov = (await tommy('/api/super/overview')).data;
  assert.deepEqual(ov.demos.map((x) => x.open), [2, 1]);
  const d2 = db();
  assert.equal(d2.prepare('SELECT COUNT(*) n FROM companies WHERE demo = 1').get().n, before - 1);
  d2.close();
  // a real person pressing Exit (no demo) changes nothing
  assert.equal((await owner('/api/demo/exit', { method: 'POST' })).status, 200);
  assert.equal(realCompanies(), real);
  assert.equal((await owner('/api/super/overview')).status, 404);
});

test('the smoke test’s cleanup: each run that exits leaves no copies behind', async () => {
  for (const v of [...visitors.slice(1), figandfire]) assert.equal((await v('/api/demo/exit', { method: 'POST' })).status, 200);
  const d = db();
  assert.equal(d.prepare('SELECT COUNT(*) n FROM companies WHERE demo = 1').get().n, 0);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM users WHERE company_id NOT IN (SELECT id FROM companies)').get().n, 0, 'no people left behind');
  d.close();
  assert.equal(realCompanies(), real);
  assert.deepEqual((await tommy('/api/super/overview')).data.demos.map((x) => x.open), [0, 0]);
});

test('the hourly sweep: an idle copy with no sign-in left goes; a copy in use stays; real companies never', async () => {
  process.env.DATA_DIR = dir; // before the server modules load, so nothing lands in the repo
  const { purgeDemos, IDLE_MS } = await import('../server/demo.mjs');
  const busy = person('10.7.3.1'), gone = person('10.7.3.2'), quiet = person('10.7.3.3');
  for (const v of [busy, gone, quiet]) assert.equal((await v('/api/demo/start', { method: 'POST', body: { role: 'manager', demo: 'baldwin' } })).status, 200);
  const d = db();
  const [a, b, c] = d.prepare('SELECT id FROM companies WHERE demo = 1 ORDER BY id').all().map((r) => r.id);
  const old = new Date(Date.now() - IDLE_MS - 60e3).toISOString();
  // b: made over two hours ago, nobody seen since, and its sign-in has ended → idle
  d.prepare('UPDATE companies SET created_at = ? WHERE id IN (?, ?, ?)').run(old, a, b, c);
  d.prepare('UPDATE users SET last_seen_at = ? WHERE company_id IN (?, ?)').run(old, b, c);
  d.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)').run(b);
  // c: just as old and quiet, but its visitor can still come back (signed in) → stays
  // a: in use (seen just now) → stays
  // a real company with a long-quiet owner and no session is never a demo
  d.prepare('UPDATE companies SET created_at = ? WHERE demo = 0').run(old);
  assert.equal(purgeDemos(d), 1);
  assert.deepEqual(d.prepare('SELECT id FROM companies WHERE demo = 1 ORDER BY id').all().map((r) => r.id), [a, c]);
  d.close();
  assert.deepEqual(JSON.parse(realCompanies()).map((r) => r.name), JSON.parse(real).map((r) => r.name));
  for (const v of [busy, quiet]) await v('/api/demo/exit', { method: 'POST' });
});
