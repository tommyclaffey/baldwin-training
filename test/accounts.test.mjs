// Accounts: companies kept apart, staff PINs, two-step sign-in, the super admin, "sign in as", soft deletes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { totpAt } from '../server/auth.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-acct-'));
const PORT = 5000 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

/** A person with their own cookie jar. */
function person() {
  let jar = '';
  const call = async (p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return call;
}
const code = (secret) => totpAt(secret, Math.floor(Date.now() / 30000));

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@baldwin.test', SUPERADMIN_EMAIL: 'tommy@super.test' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = person(), tommy = person();
let superSecret = '';

test('first accounts: the Baldwin owner and the primary super admin', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Jeff', email: 'owner@baldwin.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await person()('/api/me')).data.superSetupNeeded, true);
  const s = await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@super.test', password: 'long-enough-1' } });
  assert.equal(s.status, 200);
  assert.equal(s.data.user.role, 'superadmin');
  assert.equal(s.data.user.superPrimary, true);
  assert.equal((await person()('/api/setup', { method: 'POST', body: { name: 'X', email: 'tommy@super.test', password: 'long-enough-1' } })).status, 409);
});

test('the super admin area is hidden from everyone else, and needs two-step sign-in', async () => {
  assert.equal((await owner('/api/super/overview')).status, 404, 'an owner gets not found');
  assert.equal((await person()('/api/super/overview')).status, 404, 'so does a stranger');
  assert.equal((await tommy('/api/super/overview')).status, 403, 'super admin without two-step: blocked with a reason');
  const start = await tommy('/api/2fa/start', { method: 'POST' });
  assert.equal(start.status, 200);
  assert.match(start.data.qr, /^<svg/);
  superSecret = start.data.secret;
  assert.equal((await tommy('/api/2fa/enable', { method: 'POST', body: { code: '000000' } })).status, 400);
  assert.equal((await tommy('/api/2fa/enable', { method: 'POST', body: { code: code(superSecret) } })).status, 200);
  assert.equal((await tommy('/api/super/overview')).status, 200);
  assert.equal((await tommy('/api/2fa/disable', { method: 'POST', body: { password: 'long-enough-1' } })).status, 400, 'super admins can’t turn it off');
});

test('signing in with two-step asks for the code', async () => {
  const fresh = person();
  const first = await fresh('/api/login', { method: 'POST', body: { email: 'tommy@super.test', password: 'long-enough-1' } });
  assert.equal(first.data.needCode, true);
  assert.equal((await fresh('/api/super/overview')).status, 404, 'no session until the code');
  assert.equal((await fresh('/api/login/code', { method: 'POST', body: { ticket: first.data.ticket, code: '123456' } })).status, 401);
  assert.equal((await fresh('/api/login/code', { method: 'POST', body: { ticket: first.data.ticket, code: code(superSecret) } })).status, 200);
  assert.equal((await fresh('/api/super/overview')).status, 200);
});

const owner2 = person(), staff1 = person(), staff2 = person();
let company2 = 0, code1 = '', code2 = '';

test('companies are kept apart', async () => {
  const add = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Second Group', ownerEmail: 'owner@second.test' } });
  assert.equal(add.status, 200);
  company2 = add.data.id;
  assert.equal((await owner2(`/api/invite/${add.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Olive', password: 'long-enough-3' } })).status, 200);
  code1 = (await owner('/api/team')).data.company.joinCode;
  code2 = (await owner2('/api/team')).data.company.joinCode;
  assert.notEqual(code1, code2);
  await staff1('/api/join', { method: 'POST', body: { code: code1, name: 'Bea Baldwin', pin: '1111', storeId: 1 } });
  await staff2('/api/join', { method: 'POST', body: { code: code2, name: 'Sid Second', pin: '2222' } });
  const t1 = (await owner('/api/team')).data.people.map((p) => p.name);
  const t2 = (await owner2('/api/team')).data.people.map((p) => p.name);
  assert.ok(t1.includes('Bea Baldwin') && !t1.includes('Sid Second') && !t1.includes('Olive'));
  assert.ok(t2.includes('Sid Second') && !t2.includes('Bea Baldwin') && !t2.includes('Jeff'));
  assert.deepEqual((await person()(`/api/join/${code2}`)).data.staff.map((s) => s.name), ['Sid Second'], 'a join code lists only its own staff');
  // Another company's people can't be touched by id.
  const bea = (await owner('/api/team')).data.people.find((p) => p.name === 'Bea Baldwin');
  assert.equal((await owner2(`/api/team/${bea.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await owner2(`/api/team/${bea.id}/reset-pin`, { method: 'POST' })).status, 404);
  // Quiz scores and sections stay in their company.
  await staff1('/api/quiz/attempt', { method: 'POST', body: { quiz: 'short-rib', items: ['short-rib#0'], answers: [1] } });
  assert.ok((await owner('/api/quiz/results')).data.people.some((p) => p.name === 'Bea Baldwin'));
  assert.ok(!(await owner2('/api/quiz/results')).data.people.some((p) => p.name === 'Bea Baldwin'));
  await owner('/api/sections', { method: 'PUT', body: { slot: 'Servers 1', name: 'Bea' } });
  assert.equal((await owner2('/api/sections')).data.names['Servers 1'], undefined);
  // The book is Baldwin's for now: another company's people don't see it.
  assert.equal((await staff1('/api/index')).status, 200);
  assert.equal((await staff2('/api/index')).status, 404);
  assert.equal((await owner2('/api/media')).data.media.length, 0);
});

test('staff: read and take quizzes, never edit', async () => {
  assert.equal((await staff1('/api/entries', { method: 'POST', body: { collection: 'classic', data: { name: 'X' } } })).status, 403);
  assert.equal((await staff1('/api/team')).status, 403);
  assert.equal((await staff1('/api/media')).status, 403);
  assert.equal((await staff1('/api/collections')).status, 403);
  assert.equal((await staff1('/api/login', { method: 'POST', body: { email: '', password: '1111' } })).status, 401);
  assert.equal((await person()('/api/join', { method: 'POST', body: { code: code1, name: 'bea baldwin', pin: '9999', storeId: 1 } })).status, 409, 'names are unique in a company');
});

test('PINs: wrong ones lock for 15 minutes, a manager reset lets the person pick a new one', async () => {
  const bea = (await person()(`/api/join/${code1}`)).data.staff.find((s) => s.name === 'Bea Baldwin');
  const phone = person();
  assert.equal((await phone('/api/staff-login', { method: 'POST', body: { code: code1, id: bea.id, pin: '1111' } })).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await person()('/api/staff-login', { method: 'POST', body: { code: code1, id: bea.id, pin: '0000' } })).status, 401);
  assert.equal((await person()('/api/staff-login', { method: 'POST', body: { code: code1, id: bea.id, pin: '1111' } })).status, 429, 'locked, even with the right PIN');
  assert.equal((await owner(`/api/team/${bea.id}/reset-pin`, { method: 'POST' })).status, 200);
  assert.equal((await phone('/api/me')).data.user, null, 'a reset signs them out');
  assert.equal((await person()(`/api/join/${code1}`)).data.staff.find((s) => s.id === bea.id).needsPin, true);
});

test('sign in as: logged, no super admin while in it, and back again', async () => {
  const sid = (await tommy('/api/super/users?q=Sid')).data.users[0];
  const as = await tommy(`/api/super/users/${sid.id}/sign-in-as`, { method: 'POST' });
  assert.equal(as.status, 200);
  const me = (await tommy('/api/me')).data.user;
  assert.equal(me.name, 'Sid Second');
  assert.ok(me.impersonatedBy);
  assert.equal((await tommy('/api/super/overview')).status, 404, 'the super admin is closed while signed in as someone');
  assert.equal((await tommy('/api/super/return', { method: 'POST' })).status, 200);
  assert.equal((await tommy('/api/me')).data.user.role, 'superadmin');
  const log = (await tommy('/api/super/log')).data.log.map((l) => l.action);
  assert.ok(log.includes('sign in as') && log.includes('back from signing in as'));
});

test('deletes are soft: the person can’t sign in, and a super admin can restore them', async () => {
  const olive = (await tommy('/api/super/users?q=Olive')).data.users[0];
  assert.equal((await tommy(`/api/super/users/${olive.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await person()('/api/login', { method: 'POST', body: { email: 'owner@second.test', password: 'long-enough-3' } })).status, 401);
  assert.equal((await tommy(`/api/super/users/${olive.id}/restore`, { method: 'POST' })).status, 200);
  assert.equal((await person()('/api/login', { method: 'POST', body: { email: 'owner@second.test', password: 'long-enough-3' } })).status, 200);
  assert.equal((await tommy(`/api/super/companies/${company2}`, { method: 'DELETE', body: { confirm: 'wrong' } })).status, 400, 'deleting a company needs its name typed');
  assert.equal((await tommy(`/api/super/companies/${company2}`, { method: 'DELETE', body: { confirm: 'Second Group' } })).status, 200);
  assert.equal((await owner2('/api/team')).status, 401, 'its people are signed out');
});

test('only the primary super admin adds or removes super admins', async () => {
  const inv = await tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'mate@super.test' } });
  assert.equal(inv.status, 200);
  const mate = person();
  assert.equal((await mate(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Mate', password: 'long-enough-4' } })).status, 200);
  assert.equal((await mate('/api/me')).data.user.role, 'superadmin');
  const s = (await mate('/api/2fa/start', { method: 'POST' })).data.secret;
  await mate('/api/2fa/enable', { method: 'POST', body: { code: code(s) } });
  await mate('/api/login', { method: 'POST', body: { email: 'mate@super.test', password: 'long-enough-4' } }).then(async (r) => mate('/api/login/code', { method: 'POST', body: { ticket: r.data.ticket, code: code(s) } }));
  assert.equal((await mate('/api/super/overview')).status, 200);
  assert.equal((await mate('/api/super/admins/invite', { method: 'POST', body: { email: 'x@super.test' } })).status, 403);
  const me = (await tommy('/api/me')).data.user;
  assert.equal((await mate(`/api/super/users/${me.id}`, { method: 'DELETE' })).status, 403, 'a teammate can’t remove the primary');
  assert.equal((await mate(`/api/super/users/${me.id}`, { method: 'PATCH', body: { name: 'Nope' } })).status, 403);
});

test('stores: staff pick their store; each store has its own book, records and sections', async () => {
  const j = (await person()(`/api/join/${code1}`)).data;
  assert.deepEqual(j.stores.map((s) => s.name), ['The Baldwin', 'J.Baldwin’s'.replace('’', "'"), 'Testa Barra']);
  assert.equal((await person()('/api/join', { method: 'POST', body: { code: code1, name: 'No Store', pin: '1234' } })).status, 400, 'a store is required');
  const jb = j.stores[1].id;
  const jay = person();
  assert.equal((await jay('/api/join', { method: 'POST', body: { code: code1, name: 'Jay Jbs', pin: '5555', storeId: jb } })).status, 200);
  const me = (await jay('/api/me')).data.user;
  assert.equal(me.store.name, "J.Baldwin's");
  assert.equal(me.canSwitchStore, false);
  const r = await jay('/api/index');
  assert.equal(r.status, 404, 'J.Baldwin’s book isn’t built yet');
  assert.match(r.data.error, /J\.Baldwin's/);
  // Quiz records and sections stay in their store.
  await jay('/api/quiz/attempt', { method: 'POST', body: { quiz: 'short-rib', items: ['short-rib#0'], answers: [1] } });
  const baldwin = (await owner('/api/quiz/results')).data;
  assert.equal(baldwin.store, 'The Baldwin');
  assert.ok(!baldwin.people.some((p) => p.name === 'Jay Jbs'));
  assert.equal((await owner('/api/store', { method: 'POST', body: { storeId: jb } })).status, 200, 'owners switch stores');
  assert.ok((await owner('/api/quiz/results')).data.people.some((p) => p.name === 'Jay Jbs'));
  assert.equal((await owner('/api/collections')).status, 404, 'nothing to edit in a store without a book');
  await owner('/api/sections', { method: 'PUT', body: { slot: 'Bar 1', name: 'Jay' } });
  assert.equal((await jay('/api/sections')).data.names['Bar 1'], 'Jay');
  const bo = person();
  await bo('/api/join', { method: 'POST', body: { code: code1, name: 'Bo Baldwin', pin: '7777', storeId: 1 } });
  assert.equal((await bo('/api/sections')).data.names['Bar 1'], undefined, 'The Baldwin has its own sections');
  assert.equal((await jay('/api/store', { method: 'POST', body: { storeId: 1 } })).status, 403, 'staff can’t switch stores');
  await owner('/api/store', { method: 'POST', body: { storeId: 1 } });
});

test('stores: a store manager manages only their store; the owner moves people between stores', async () => {
  const jb = (await person()(`/api/join/${code1}`)).data.stores[1].id;
  const inv = await owner('/api/team/invite', { method: 'POST', body: { email: 'gm@jbaldwins.test', role: 'manager', storeId: jb } });
  const gm = person();
  assert.equal((await gm(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Gina GM', password: 'long-enough-5' } })).status, 200);
  const team = (await gm('/api/team')).data;
  const names = team.people.map((p) => p.name);
  assert.ok(names.includes('Jay Jbs') && !names.includes('Bea Baldwin'), 'only their store’s staff (plus the owners)');
  const bea = (await owner('/api/team')).data.people.find((p) => p.name === 'Bea Baldwin');
  assert.equal((await gm(`/api/team/${bea.id}/reset-pin`, { method: 'POST' })).status, 404, 'another store’s staff are out of reach');
  assert.equal((await gm('/api/store', { method: 'POST', body: { storeId: 1 } })).status, 403, 'a store manager stays in their store');
  assert.equal((await owner(`/api/team/${bea.id}`, { method: 'PATCH', body: { storeId: jb } })).status, 200, 'the owner moves Bea to J.Baldwin’s');
  assert.ok((await gm('/api/team')).data.people.some((p) => p.name === 'Bea Baldwin'));
});
