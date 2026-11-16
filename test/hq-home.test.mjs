// The Mise HQ home (Nov 16, Figma 09 · Proposals → 32: 699:880, 708:920, 714:961, 716:1016). Tommy: "there's nothing for
// me to interact with. There's no page or anything." A super admin working in Mise Academy (HQ) lands on a home of real
// data: what's waiting on them, health (errors, backups, storage), every company, the Log, new companies, the Mise team.
// Plus the Sign In As picker, the Error Log, and the off-site copies the server now records.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { totpAt } from '../server/auth.mjs';
import { giveAccount } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-hqhome-'));
const PORT = 7800 + Math.floor(Math.random() * 200); // clear of the other files' ranges (files.test 7100, selfserve 7500)
const BASE = `http://127.0.0.1:${PORT}`;
const OPS_TOKEN = 'ops-token-for-the-hq-home-test-1234';
const BACKUP_KEY = 'backup-key-for-the-hq-home-test-5678';
let server;

before(async () => {
  giveAccount(dir);
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@hqhome.test', SUPERADMIN_EMAIL: 'tommy@hqhome.test', OPS_TOKEN, BACKUP_KEY,
      RESEND_API_KEY: '', MAIL_FROM: '', PREP_WEEKLY: 'off' } });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

function person(ip = '127.0.0.1') {
  let jar = '';
  return async (p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(jar ? { Cookie: jar } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const token = (link) => link.split('/').pop();
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const twoStep = async (call) => {
  const secret = (await call('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await call('/api/2fa/enable', { method: 'POST', body: { code: totpAt(secret, Math.floor(Date.now() / 30000)) } })).status, 200);
};
const ops = (p, auth = true) => fetch(BASE + p, { headers: auth ? { authorization: `Bearer ${OPS_TOKEN}` } : {} });

const tommy = person('10.9.0.1'), owner = person('10.9.0.2'), harborOwner = person('10.9.0.3'), mgr = person('10.9.0.4'), sup = person('10.9.0.5');
const staff = [person('10.9.1.1'), person('10.9.1.2'), person('10.9.1.3')], harborMgr = [person('10.9.2.1'), person('10.9.2.2')];
let hq = 0, harbor = 0, quiet = 0, harborCode = '', harborStores = [];

test('setup: The Baldwin’s owner, the super admin (two-step on, in HQ), two Mise teammates', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Bram Owner', email: 'owner@hqhome.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy Claffey', email: 'tommy@hqhome.test', password: 'long-enough-1' } })).status, 200);
  await twoStep(tommy);
  const a = await tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'mia@hqhome.test', teamRole: 'manager' } });
  const b = await tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'sol@hqhome.test', teamRole: 'support' } });
  assert.equal((await mgr(`/api/invite/${token(a.data.link)}`, { method: 'POST', body: { name: 'Maren Manager', password: 'mia-pass-001' } })).status, 200);
  assert.equal((await sup(`/api/invite/${token(b.data.link)}`, { method: 'POST', body: { name: 'Sol Support', password: 'sol-pass-001' } })).status, 200);
  await twoStep(mgr); await twoStep(sup);
});

test('landing: a super admin in HQ is told so by /api/me, and Admin’s home is the HQ home (two-step first, as before)', async () => {
  const me = (await tommy('/api/me')).data.user;
  assert.equal(me.hq, true);
  assert.equal(me.workingInName, 'Mise Academy (HQ)');
  hq = me.workingIn;
  // The screens: /admin's index is the HQ home for a super admin in HQ; a customer's admin keeps the manager home.
  const app = fs.readFileSync(path.join(root, 'src/admin/AdminApp.tsx'), 'utf8');
  assert.match(app, /<Route index element=\{hqMode \? <HqHome \/> : <ManagerHome \/>\} \/>/);
  assert.match(app, /const hqMode = isSuper && !!user\.hq/);
  // Sign-in still sends a super admin without two-step to Your Account first
  const two = fs.readFileSync(path.join(root, 'src/lib/twostep.ts'), 'utf8');
  assert.match(two, /landingFor = \(u: Person\) => \(needsTwoStep\(u\) \? TWO_STEP_HOME : '\/admin'\)/);
  // Without two-step the home isn't open
  const fresh = person('10.9.3.1');
  const inv = await tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'new@hqhome.test', teamRole: 'support' } });
  assert.equal((await fresh(`/api/invite/${token(inv.data.link)}`, { method: 'POST', body: { name: 'Nova New', password: 'nova-pass-001' } })).status, 200);
  assert.equal((await fresh('/api/super/home')).status, 403);
  const d = db(); d.prepare("UPDATE users SET deleted_at = ? WHERE email = 'new@hqhome.test'").run(new Date().toISOString()); d.close();
});

test('nothing made up: a quiet app shows empty sections, honest health lines, and only real companies', async () => {
  const h = (await tommy('/api/super/home')).data;
  assert.equal(h.you.role, 'owner');
  assert.equal(h.waiting.length, 0, 'nothing waiting');
  assert.equal(h.health.errors.total, 0);
  assert.equal(h.health.backups.allGood, false, 'nothing recorded yet, so not "all good"');
  assert.ok(h.health.backups.lines.every((l) => l.at === null), 'no backup times until they happen');
  assert.deepEqual(h.companies.map((c) => c.name), ['Mise Academy (HQ)', 'Baldwin Restaurant Group']);
  assert.equal(h.companies[0].hq, true);
  assert.equal(h.companies[0].workingHere, true);
  assert.equal(h.companies[0].team, 3);
  assert.deepEqual(h.demos.map((d) => [d.path, d.open]), [['/demo', 0], ['/demo/mise', 0]]);
  assert.ok(h.newThisWeek.every((x) => h.companies.some((c) => c.id === x.id && !c.hq && c.isNew)), 'New This Week: companies made in the last 7 days, never HQ');
  assert.deepEqual(h.team.map((t) => [t.name, t.role, t.totpOn, t.you]), [['Tommy Claffey', 'owner', true, true], ['Maren Manager', 'manager', true, false], ['Sol Support', 'support', true, false]]);
  assert.ok(!JSON.stringify(h).includes('Example'), 'no Example rows');
});

test('Waiting on you: an owner invite nobody used, a deletion request past its 7 days (not one still waiting), repeating errors', async () => {
  // A new company with an owner invite nobody has used
  const a = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Quiet Fork', ownerEmail: 'chef@quietfork.test' } });
  assert.equal(a.status, 200); quiet = a.data.id;
  // A company whose owner signed up, with two stores, staff and managers, that asks for its data to be deleted
  const b = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Harbor Hall', ownerEmail: 'owner@harbor.test', stores: ['Dockside', 'Market Street'] } });
  harbor = b.data.id;
  assert.equal((await harborOwner(`/api/invite/${token(b.data.link)}`, { method: 'POST', body: { name: 'Hana Harbor', password: 'harbor-pass-1' } })).status, 200);
  harborStores = (await harborOwner('/api/me')).data.user.stores;
  const tm = await harborOwner('/api/team'); harborCode = tm.data?.company?.joinCode; assert.ok(harborCode, JSON.stringify(tm).slice(0, 300));
  for (const [i, n] of ['Zed Zimmer', 'Amy Abbot', 'Cal Cole'].entries()) {
    assert.equal((await staff[i]('/api/join', { method: 'POST', body: { code: harborCode, name: n, pin: '4321', storeId: harborStores[i === 2 ? 1 : 0].id } })).status, 200);
  }
  for (const [i, [n, e]] of [['Wes Market', 'wes@harbor.test'], ['Ann Dock', 'ann@harbor.test']].entries()) {
    const inv = await harborOwner('/api/team/invite', { method: 'POST', body: { email: e, role: 'manager', storeId: harborStores[i === 0 ? 1 : 0].id } });
    assert.equal(inv.status, 200, JSON.stringify(inv.data));
    assert.equal((await harborMgr[i](`/api/invite/${token(inv.data.link)}`, { method: 'POST', body: { name: n, password: 'manager-pass-1' } })).status, 200);
  }
  assert.equal((await harborOwner('/api/company/delete-request', { method: 'POST', body: { confirm: 'Harbor Hall' } })).status, 200);
  let h = (await tommy('/api/super/home')).data;
  assert.deepEqual(h.waiting.map((w) => w.type), ['invite'], 'the deletion is still in its 7 days');
  const inv = h.waiting[0];
  assert.deepEqual([inv.companyName, inv.email, inv.expired, inv.isNew, inv.planName], ['Quiet Fork', 'chef@quietfork.test', false, true, 'Foundation']);
  // 7 days pass for the request; and errors come in
  const d = db();
  d.prepare("UPDATE company_deletions SET ends_at = ? WHERE company_id = ?").run(new Date(Date.now() - 3600e3).toISOString(), harbor);
  const t = new Date().toISOString();
  d.prepare("INSERT INTO errors(kind, path, message, count, first_at, last_at) VALUES ('server', '/api/prep/report', 'Cannot read properties of undefined', 14, ?, ?)").run(t, t);
  d.prepare("INSERT INTO errors(kind, path, message, count, first_at, last_at, user_id) VALUES ('client', '/admin/people', 'Failed to fetch', 2, ?, ?, (SELECT id FROM users WHERE email = 'owner@harbor.test'))").run(t, t);
  d.prepare("INSERT INTO errors(kind, path, message, count, first_at, last_at) VALUES ('server', '/api/old', 'Old one', 9, ?, ?)").run(new Date(Date.now() - 3 * 864e5).toISOString(), new Date(Date.now() - 3 * 864e5).toISOString());
  d.close();
  h = (await tommy('/api/super/home')).data;
  assert.deepEqual(h.waiting.map((w) => w.type), ['deletion', 'invite', 'error']);
  assert.deepEqual([h.waiting[0].companyName, h.waiting[0].requestedBy], ['Harbor Hall', 'Hana Harbor']);
  assert.deepEqual([h.waiting[2].path, h.waiting[2].count], ['/api/prep/report', 14], 'only the one that repeats (×2 doesn’t), and not the old one');
  assert.equal(h.health.errors.total, 16);
  assert.equal(h.health.errors.kinds, 2);
  assert.deepEqual(h.health.errors.top.map((e) => [e.kind, e.count]), [['server', 14], ['client', 2]]);
  // Once someone who runs Quiet Fork... (nobody has): its invite stays. Harbor Hall's owner signed in, so it has no invite line.
  assert.ok(!h.waiting.some((w) => w.type === 'invite' && w.companyId === harbor));
});

test('Companies: real ones only (demo copies grouped), plan and look, stores, people, storage, last active; New This Week', async () => {
  // a demo visitor makes a copy; it shows as a count, not a row
  assert.equal((await person('10.9.4.1')('/api/demo/start', { method: 'POST', body: { role: 'manager', demo: 'mise' } })).status, 200);
  // an upload of Harbor Hall's, 3 KB
  const d = db();
  fs.writeFileSync(path.join(dir, 'media', 'harbor-photo.jpg'), Buffer.alloc(3000, 1));
  d.prepare("INSERT INTO media(kind, title, file, mime, size, created_at, company_id, store_id) VALUES ('file', 'Dock', 'harbor-photo.jpg', 'image/jpeg', 3000, ?, ?, ?)").run(new Date().toISOString(), harbor, harborStores[0].id);
  d.close();
  const h = (await tommy('/api/super/home')).data;
  assert.deepEqual(h.companies.map((c) => c.name), ['Mise Academy (HQ)', 'Baldwin Restaurant Group', 'Harbor Hall', 'Quiet Fork']);
  const hh = h.companies.find((c) => c.id === harbor);
  assert.deepEqual([hh.planName, hh.lookName, hh.stores, hh.owners, hh.managers, hh.staff, hh.storage, hh.isNew], ['Foundation', 'Mise Academy', ['Dockside', 'Market Street'], 1, 2, 3, 3000, true]);
  assert.ok(hh.lastActiveAt);
  assert.equal(hh.deletion.ready, true);
  const b = h.companies.find((c) => c.id === 1);
  assert.deepEqual([b.planName, b.lookName], ['Custom Brand', 'The Baldwin']);
  assert.equal(h.companies.find((c) => c.id === quiet).lastActiveAt, null, 'never: nobody has signed in');
  assert.deepEqual(h.demos.map((x) => [x.name, x.open]), [['The Baldwin · Demo', 0], ['Wrenfield · Demo', 1]]);
  assert.deepEqual(h.newThisWeek.map((x) => x.name).sort(), h.companies.filter((c) => !c.hq && c.isNew).map((c) => c.name).sort());
  assert.ok(h.newThisWeek.some((x) => x.name === 'Harbor Hall' && x.stores === 2 && x.planName === 'Foundation'));
  // storage: per company against the cap, and the volume against its floor
  assert.equal(h.health.storage.capBytes, 2048 * 1024 * 1024);
  assert.equal(h.health.storage.floorBytes, 500 * 1024 * 1024);
  assert.equal(h.health.storage.companies[0].name, 'Harbor Hall');
  assert.ok(h.health.storage.freeBytes > 0);
  // the sidebar's counts
  const n = (await tommy('/api/super/counts')).data;
  assert.deepEqual(n, { companies: 4, team: 3, deletions: 1 });
});

test('Recent Activity: from the Log, with who did it and their role', async () => {
  assert.equal((await tommy('/api/super/act', { method: 'POST', body: { companyId: 1 } })).status, 200);
  assert.equal((await tommy('/api/super/act', { method: 'POST', body: { companyId: hq } })).status, 200);
  const h = (await tommy('/api/super/home')).data;
  assert.ok(h.activity.length <= 6);
  assert.deepEqual([h.activity[0].name, h.activity[0].role, h.activity[0].what, h.activity[0].company], ['Tommy Claffey', 'Owner · Mise team', 'Worked here', 'Mise Academy (HQ)']);
  const asked = h.activity.find((a) => a.what === 'Asked to delete company data');
  assert.deepEqual([asked?.name, asked?.role, asked?.company], ['Hana Harbor', 'Company owner', 'Harbor Hall']);
});

test('off-site copies and the hourly check are recorded; Backups goes "all good" when every line is fresh', async () => {
  // the hourly check sends OPS_TOKEN; a visit without it isn't counted
  assert.equal((await ops('/api/health', false)).status, 200);
  let h = (await tommy('/api/super/home')).data;
  assert.equal(h.health.backups.lines.find((l) => l.key === 'health').at, null);
  assert.equal((await ops('/api/health')).status, 200);
  const bk = await ops('/api/ops/backup'); assert.equal(bk.status, 200); const bytes = (await bk.arrayBuffer()).byteLength;
  const fl = await ops('/api/ops/files?since=' + new Date(Date.now() - 864e5).toISOString()); assert.equal(fl.status, 200); await fl.arrayBuffer();
  const wrong = await fetch(BASE + '/api/ops/backup', { headers: { authorization: 'Bearer nope-nope-nope-nope-nope-nope-nope' } });
  assert.equal(wrong.status, 404);
  await new Promise((r) => setTimeout(r, 150));
  const d = db();
  const rows = d.prepare('SELECT kind, ok, bytes, detail FROM ops_runs ORDER BY id').all(); d.close();
  assert.deepEqual(rows.map((r) => [r.kind, r.ok]), [['health', 1], ['backup', 1], ['files', 1]], 'one row each, and none for the wrong token');
  assert.equal(rows[1].bytes, bytes);
  assert.match(rows[2].detail, /^changes · \d+ of \d+ files$/);
  h = (await tommy('/api/super/home')).data;
  const line = (k) => h.health.backups.lines.find((l) => l.key === k);
  assert.ok(line('backup').ok && line('files').ok && line('health').ok);
  assert.equal(line('snapshot').ok, false, 'no daily snapshot on the volume yet');
  assert.equal(h.health.backups.allGood, false);
  // the daily snapshot appears
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backups', `daily-${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' })}.db`), 'x');
  h = (await tommy('/api/super/home')).data;
  assert.equal(h.health.backups.allGood, true);
  // migration 22 is a numbered migration
  const v = db(); assert.ok(v.prepare('PRAGMA user_version').get().user_version >= 22); v.close();
});

test('Sign In As picker: the owner first, then managers, then staff by store; HQ and demos refused', async () => {
  const r = (await tommy(`/api/super/companies/${harbor}/people`)).data;
  assert.equal(r.company.name, 'Harbor Hall');
  assert.equal(r.total, 6);
  assert.deepEqual(r.owners.map((p) => [p.name, p.roleLabel, p.storeName, p.initials]), [['Hana Harbor', 'Owner', 'All stores', 'HH']]);
  assert.deepEqual(r.managers.map((p) => [p.name, p.storeName]), [['Ann Dock', 'Dockside'], ['Wes Market', 'Market Street']]);
  assert.deepEqual(r.staff.map((g) => [g.storeName, g.people.map((p) => p.name)]), [['Dockside', ['Amy Abbot', 'Zed Zimmer']], ['Market Street', ['Cal Cole']]]);
  assert.equal(r.staff[0].people[0].roleLabel, 'Staff');
  assert.equal((await tommy(`/api/super/companies/${hq}/people`)).status, 400);
  const demo = db().prepare('SELECT id FROM companies WHERE demo = 1').get().id;
  assert.equal((await tommy(`/api/super/companies/${demo}/people`)).status, 400);
  // picking someone uses the Sign In As that's already there (banner, Back to Your Account, logged)
  const pick = r.staff[0].people[0];
  const as = await sup(`/api/super/users/${pick.id}/sign-in-as`, { method: 'POST' });
  assert.equal(as.status, 200);
  assert.equal(as.data.user.impersonatedBy > 0, true);
  assert.equal((await sup('/api/super/return', { method: 'POST' })).status, 200);
  const log = (await tommy('/api/super/log')).data.log;
  assert.ok(log.some((l) => l.action === 'sign in as' && l.name === 'Sol Support' && l.teamRole === 'support'));
});

test('Error Log: newest first, filter by kind, words and days, the person when there is one; read only', async () => {
  let r = (await tommy('/api/super/errors?days=1')).data;
  assert.deepEqual(r.errors.map((e) => e.path).sort(), ['/admin/people', '/api/prep/report']);
  assert.equal(r.errors.length, 2, 'the 3-day-old one is outside a day');
  assert.ok(r.errors[0].lastAt >= r.errors[1].lastAt, 'newest first');
  r = (await tommy('/api/super/errors?days=7')).data;
  assert.equal(r.errors.length, 3);
  assert.deepEqual(r.totals, { server: 2, client: 1 });
  r = (await tommy('/api/super/errors?days=7&kind=client')).data;
  assert.deepEqual(r.errors.map((e) => [e.kind, e.message, e.user?.name, e.user?.company]), [['client', 'Failed to fetch', 'Hana Harbor', 'Harbor Hall']]);
  r = (await tommy('/api/super/errors?days=90&q=prep')).data;
  assert.deepEqual(r.errors.map((e) => e.path), ['/api/prep/report']);
  assert.equal((await tommy('/api/super/errors', { method: 'POST', body: {} })).status, 404, 'nothing to change');
});

test('roles: Owner does everything; a Mise Manager everything but confirming deletions; Support looks, the server refuses changes', async () => {
  const home = { owner: (await tommy('/api/super/home')).data, manager: (await mgr('/api/super/home')).data, support: (await sup('/api/super/home')).data };
  assert.deepEqual(Object.values(home).map((h) => h.you.role), ['owner', 'manager', 'support']);
  for (const h of Object.values(home)) assert.equal(h.waiting.length, 3, 'everyone sees what’s waiting');
  assert.deepEqual(Object.values(home).map((h) => [h.can.deletions, h.can.inviteOwner, h.can.addCompany, h.can.work, h.can.signInAs]),
    [[true, true, true, true, true], [false, true, true, true, true], [false, false, false, true, true]]);
  // the picker and the error log open for every role
  for (const t of [mgr, sup]) { assert.equal((await t(`/api/super/companies/${harbor}/people`)).status, 200); assert.equal((await t('/api/super/errors')).status, 200); }
  // the buttons' own routes refuse what the role can't do
  const del = home.owner.waiting.find((w) => w.type === 'deletion');
  for (const t of [mgr, sup]) {
    assert.equal((await t(`/api/super/deletions/${del.id}/cancel`, { method: 'POST' })).status, 403);
    assert.equal((await t(`/api/super/deletions/${del.id}/confirm`, { method: 'POST', body: { confirm: 'Harbor Hall' } })).status, 403);
  }
  assert.equal((await sup(`/api/super/companies/${quiet}/owner-invite`, { method: 'POST', body: { email: 'chef@quietfork.test' } })).status, 403);
  assert.equal((await sup('/api/super/companies', { method: 'POST', body: { name: 'Nope Co' } })).status, 403);
  // New Invite Link (a Manager may): a fresh link for the same email
  const again = await mgr(`/api/super/companies/${quiet}/owner-invite`, { method: 'POST', body: { email: 'chef@quietfork.test' } });
  assert.equal(again.status, 200);
  assert.match(again.data.link, /^\/admin\/invite\//);
  // Work Here from the home (Support too: it changes nothing in the company)
  assert.equal((await sup('/api/super/act', { method: 'POST', body: { companyId: harbor } })).status, 200);
  assert.equal((await sup('/api/super/act', { method: 'POST', body: { companyId: hq } })).status, 200);
  // the Owner cancels the request from the home; the line goes
  assert.equal((await tommy(`/api/super/deletions/${del.id}/cancel`, { method: 'POST' })).status, 200);
  assert.ok(!(await tommy('/api/super/home')).data.waiting.some((w) => w.type === 'deletion'));
});

test('customers never reach any of it: owners, managers, staff and signed-out visitors get "not found"', async () => {
  const routes = ['/api/super/home', '/api/super/counts', `/api/super/companies/${harbor}/people`, '/api/super/errors'];
  for (const t of [owner, harborOwner, harborMgr[0], staff[0], person('10.9.5.1')]) {
    for (const r of routes) assert.equal((await t(r)).status, 404, r);
  }
  // nor while a super admin is signed in as one of them
  const amy = (await tommy(`/api/super/companies/${harbor}/people`)).data.staff[0].people[0];
  assert.equal((await tommy(`/api/super/users/${amy.id}/sign-in-as`, { method: 'POST' })).status, 200);
  assert.equal((await tommy('/api/super/home')).status, 404);
  assert.equal((await tommy('/api/super/return', { method: 'POST' })).status, 200);
  assert.equal((await tommy('/api/super/home')).status, 200);
});
