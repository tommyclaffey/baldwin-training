// Promote to Manager / Change to Staff, and the Mise team's roles in Super Admin (Nov 16).
// One server, one email-less setup. Since Nov 16's second pass promotion is instant (no link); links made before then still work. The database is read alongside it to check
// that a promoted person is the same row, with their history.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { totpAt, sha256 } from '../server/auth.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-roles-'));
const PORT = 6100 + Math.floor(Math.random() * 400);
let server;

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@roles.test', SUPERADMIN_EMAIL: 'tommy@roles.test', RESEND_API_KEY: '', MAIL_FROM: '' } });
  for (let i = 0; i < 300; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/me`); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

/** A person with their own cookie jar. `call(path, { method, body })` → { status, data }. */
function person(ip = '127.0.0.1') {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const token = (link) => link.split('/').pop();
const code = (secret) => totpAt(secret, Math.floor(Date.now() / 30000));
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const twoStep = async (call) => {
  const secret = (await call('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await call('/api/2fa/enable', { method: 'POST', body: { code: code(secret) } })).status, 200);
};

const owner = person(), tommy = person(), gm = person(), suki = person(), theo = person(), owner2 = person();
let joinCode = '', storeId = 0, sukiId = 0, theoId = 0, ownerId = 0, gmId = 0, otherCompany = 0;

test('setup: an owner, a store manager, two staff with PINs, a super admin (two-step), a second company', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Orla Owner', email: 'owner@roles.test', password: 'owner-pass-1' } })).status, 200);
  assert.equal((await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@roles.test', password: 'super-pass-1' } })).status, 200);
  await twoStep(tommy);
  const team = (await owner('/api/team')).data;
  joinCode = team.company.joinCode; storeId = team.stores[0].id; ownerId = team.you;
  const i = await owner('/api/team/invite', { method: 'POST', body: { email: 'gm@roles.test', role: 'manager', storeId } });
  assert.equal((await gm(`/api/invite/${token(i.data.link)}`, { method: 'POST', body: { name: 'Gale Manager', password: 'gm-pass-001' } })).status, 200);
  gmId = (await gm('/api/me')).data.user.id;
  assert.equal((await suki('/api/join', { method: 'POST', body: { code: joinCode, name: 'Suki Server', pin: '4321', storeId } })).status, 200);
  assert.equal((await theo('/api/join', { method: 'POST', body: { code: joinCode, name: 'Theo Tables', pin: '8765', storeId } })).status, 200);
  sukiId = (await suki('/api/me')).data.user.id; theoId = (await theo('/api/me')).data.user.id;
  const co = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Other Group', ownerEmail: 'owner@other.test' } });
  otherCompany = co.data.id;
  assert.equal((await owner2(`/api/invite/${token(co.data.link)}`, { method: 'POST', body: { name: 'Otto Other', password: 'other-pass-1' } })).status, 200);
  // Suki's history: a quiz attempt, a sign-off and a chat message, all keyed to her person.
  const d = db();
  d.prepare("INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at,company_id,user_id,store_id) VALUES (?,?,?,?,?,?,?,?,?,?)").run('u' + sukiId, 'Suki Server', 't:test', 9, 10, '{}', new Date().toISOString(), 1, sukiId, storeId);
  d.prepare("INSERT INTO signoffs(device,quiz,by_user,at,company_id,store_id) VALUES (?,?,?,?,?,?)").run('u' + sukiId, 't:test', gmId, new Date().toISOString(), 1, storeId);
  d.close();
});

test('Promote to Manager: staff are refused; other companies can’t reach the person; a store manager stays in their store', async () => {
  assert.equal((await suki(`/api/team/${theoId}/promote`, { method: 'POST', body: {} })).status, 403, 'staff');
  assert.equal((await owner2(`/api/team/${sukiId}/promote`, { method: 'POST', body: {} })).status, 404, 'another company');
  assert.equal((await owner2(`/api/team/${gmId}/demote`, { method: 'POST', body: {} })).status, 404);
  assert.equal((await owner(`/api/team/${gmId}/promote`, { method: 'POST', body: {} })).status, 400, 'already a manager');
  // Gale manages the first store: not every store, not another store
  const stores = (await owner('/api/team')).data.stores;
  const every = await gm(`/api/team/${sukiId}/promote`, { method: 'POST', body: { storeId: null } });
  assert.equal(every.status, 403);
  assert.match(every.data.error, /every store/);
  assert.equal((await gm(`/api/team/${sukiId}/promote`, { method: 'POST', body: { storeId: stores[1].id } })).status, 403, 'another store');
  // nor anyone outside their store
  const pia = person();
  assert.equal((await pia('/api/join', { method: 'POST', body: { code: joinCode, name: 'Pia Patio', pin: '1357', storeId: stores[1].id } })).status, 200);
  const piaId = (await pia('/api/me')).data.user.id;
  assert.equal((await gm(`/api/team/${piaId}/promote`, { method: 'POST', body: { storeId } })).status, 404);
  assert.equal((await gm('/api/team')).data.people.find((p) => p.id === sukiId).canPromote, true, 'Gale sees the button for her own staff');
  assert.equal((await suki('/api/me')).data.user.role, 'staff', 'nothing changed');
});

/** A promotion link the way the app made them before Nov 16's change (an invite row with the person's id). */
const legacyLink = (userId, email, { expired = false } = {}) => {
  const t = 'legacy' + Math.random().toString(36).slice(2) + Date.now();
  const d = db();
  d.prepare('INSERT INTO invites(token_hash,company_id,email,role,created_by,created_at,expires_at,store_id,super_role,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(sha256(t), 1, email, 'manager', ownerId, new Date().toISOString(), new Date(Date.now() + (expired ? -1000 : 14 * 864e5)).toISOString(), storeId, null, userId);
  d.close();
  return `/admin/invite/${t}`;
};
let link2 = '';
test('a promotion link made before the change still works; People shows it waiting; the person keeps their PIN until they use it', async () => {
  link2 = legacyLink(sukiId, 'suki@roles.test');
  const g = (await owner(`/api/invite/${token(link2)}`)).data;
  assert.deepEqual([g.valid, g.promotion, g.name, g.email, g.role], [true, true, 'Suki Server', 'suki@roles.test', 'manager']);
  const row = (await owner('/api/team')).data.people.find((p) => p.id === sukiId);
  assert.equal(row.promotion.email, 'suki@roles.test');
  assert.ok(!(await owner('/api/team')).data.invites.some((i) => i.email === 'suki@roles.test'), 'not listed as an open invite');
  assert.equal((await owner(`/api/path/person/${sukiId}`)).data.promotion.email, 'suki@roles.test');
  assert.equal((await suki('/api/me')).data.user.role, 'staff');
});

test('accepting: same person (id, name, history), now a manager with that email; other sessions end; the link works once', async () => {
  const fresh = person();
  assert.equal((await fresh(`/api/invite/${token(link2)}`, { method: 'POST', body: { password: 'short' } })).status, 400);
  const r = await fresh(`/api/invite/${token(link2)}`, { method: 'POST', body: { password: 'suki-manager-1' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.user.id, r.data.user.name, r.data.user.role, r.data.user.email], [sukiId, 'Suki Server', 'manager', 'suki@roles.test']);
  assert.equal((await suki('/api/me')).data.user, null, 'her phone’s PIN session ended');
  assert.equal((await person()(`/api/invite/${token(link2)}`, { method: 'POST', body: { password: 'suki-manager-2' } })).status, 410, 'single use');
  const login = await person()('/api/login', { method: 'POST', body: { email: 'suki@roles.test', password: 'suki-manager-1' } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, sukiId);
  const d = db();
  assert.equal(d.prepare('SELECT COUNT(*) n FROM users WHERE name = ?').get('Suki Server').n, 1, 'no second account');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM quiz_attempts WHERE user_id = ?').get(sukiId).n, 1);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM signoffs WHERE device = ?").get('u' + sukiId).n, 1);
  assert.ok(d.prepare('SELECT pin_hash FROM users WHERE id = ?').get(sukiId).pin_hash, 'her PIN is kept for later');
  assert.equal(d.prepare('SELECT store_id FROM users WHERE id = ?').get(sukiId).store_id, storeId);
  d.close();
  const acts = (await owner('/api/audit')).data.audit.map((a) => a.action);
  assert.ok(acts.includes('promoted to manager'), 'in Activity');
});

test('expired and cancelled promotion links are refused; only an owner cancels one', async () => {
  const a = legacyLink(theoId, 'theo@roles.test', { expired: true });
  assert.equal((await person()(`/api/invite/${token(a)}`)).data.valid, false);
  assert.equal((await person()(`/api/invite/${token(a)}`, { method: 'POST', body: { password: 'theo-manager-1' } })).status, 410);
  const b = legacyLink(theoId, 'theo@roles.test');
  assert.equal((await gm(`/api/team/${theoId}/promote`, { method: 'DELETE' })).status, 403, 'a manager can’t cancel it');
  assert.equal((await owner(`/api/team/${theoId}/promote`, { method: 'DELETE' })).status, 200);
  assert.equal((await person()(`/api/invite/${token(b)}`)).data.valid, false);
  assert.equal((await owner(`/api/team/${theoId}/promote`, { method: 'DELETE' })).status, 404);
});

test('Change to Staff: owners only; keeps the person and their PIN; signs them out; not yourself, not the last owner', async () => {
  const sukiMgr = person();
  assert.equal((await sukiMgr('/api/login', { method: 'POST', body: { email: 'suki@roles.test', password: 'suki-manager-1' } })).status, 200);
  assert.equal((await gm(`/api/team/${sukiId}/demote`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await owner(`/api/team/${ownerId}/demote`, { method: 'POST', body: {} })).status, 400, 'not yourself');
  const s = person();
  assert.equal((await s('/api/login', { method: 'POST', body: { email: 'tommy@roles.test', password: 'super-pass-1' } })).data.needCode, true);
  const r = await owner(`/api/team/${sukiId}/demote`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.hasPin, true);
  assert.equal((await sukiMgr('/api/me')).data.user, null, 'signed out');
  assert.equal((await person()('/api/login', { method: 'POST', body: { email: 'suki@roles.test', password: 'suki-manager-1' } })).status, 401, 'no more email sign-in');
  const back = person();
  const pin = await back('/api/staff-login', { method: 'POST', body: { code: joinCode, id: sukiId, pin: '4321' } });
  assert.equal(pin.status, 200);
  assert.deepEqual([pin.data.user.id, pin.data.user.role], [sukiId, 'staff']);
  assert.ok((await owner('/api/audit')).data.audit.some((a) => a.action === 'change to staff' && /Suki Server/.test(a.detail)));
  // The last owner: a super admin working in the company can't change the only owner to staff.
  const t = person();
  const ticket = (await t('/api/login', { method: 'POST', body: { email: 'tommy@roles.test', password: 'super-pass-1' } })).data.ticket;
  const secret = db().prepare('SELECT totp_secret FROM users WHERE email = ?').get('tommy@roles.test').totp_secret;
  assert.equal((await t('/api/login/code', { method: 'POST', body: { ticket, code: code(secret) } })).status, 200);
  assert.equal((await t('/api/super/act', { method: 'POST', body: { companyId: 1 } })).status, 200);
  const last = await t(`/api/team/${ownerId}/demote`, { method: 'POST', body: {} });
  assert.equal(last.status, 400);
  assert.match(last.data.error, /at least one owner/);
  // …and the Mise owner can promote, like an owner (straight away), and change them back
  const pr = await t(`/api/team/${theoId}/promote`, { method: 'POST', body: { storeId } });
  assert.equal(pr.status, 200);
  assert.equal(pr.data.instant, true);
  assert.equal((await t(`/api/team/${theoId}/demote`, { method: 'POST', body: { storeId } })).status, 200);
});

test('Promote to Manager is instant: an owner or a store manager promotes; the person keeps their PIN and reaches the manager pages', async () => {
  const nell = person(), ned = person();
  assert.equal((await nell('/api/join', { method: 'POST', body: { code: joinCode, name: 'Nell Night', pin: '2580', storeId } })).status, 200);
  assert.equal((await ned('/api/join', { method: 'POST', body: { code: joinCode, name: 'Ned Noon', pin: '3690', storeId } })).status, 200);
  const nellId = (await nell('/api/me')).data.user.id, nedId = (await ned('/api/me')).data.user.id;
  assert.equal((await nell('/api/team')).status, 403, 'staff can’t open the team yet');
  // Gale (a store manager) promotes Nell to manager of her own store: no email, no link
  const r = await gm(`/api/team/${nellId}/promote`, { method: 'POST', body: { storeId } });
  assert.equal(r.status, 200);
  assert.equal(r.data.instant, true);
  assert.equal(r.data.link, undefined);
  // Nell's phone session carries on, with the new access on her next request
  const me = (await nell('/api/me')).data.user;
  assert.deepEqual([me.id, me.role, me.storeId], [nellId, 'manager', storeId]);
  assert.equal((await nell('/api/team')).status, 200, 'the manager pages open');
  assert.equal((await nell('/api/audit')).status, 403, 'Activity stays an owner’s page');
  // signed out, she signs back in with her PIN, as a manager
  const back = person();
  const list = (await back(`/api/join/${joinCode}`)).data.staff;
  assert.ok(list.some((x) => x.id === nellId), 'her name is on the PIN list');
  const pin = await back('/api/staff-login', { method: 'POST', body: { code: joinCode, id: nellId, pin: '2580' } });
  assert.equal(pin.status, 200);
  assert.equal(pin.data.user.role, 'manager');
  assert.equal((await back('/api/team')).status, 200);
  // a manager invited by email never signs in with a PIN
  assert.ok(!list.some((x) => x.id === gmId));
  assert.equal((await person()('/api/staff-login', { method: 'POST', body: { code: joinCode, id: gmId, pin: '0000' } })).status, 404);
  // an owner promotes to every store
  const o = await owner(`/api/team/${nedId}/promote`, { method: 'POST', body: { storeId: null } });
  assert.equal(o.status, 200);
  const d = db();
  assert.deepEqual({ ...d.prepare('SELECT role, store_id FROM users WHERE id = ?').get(nedId) }, { role: 'manager', store_id: null });
  assert.equal(d.prepare('SELECT COUNT(*) n FROM users WHERE name = ?').get('Nell Night').n, 1, 'the same account');
  d.close();
  assert.equal((await ned('/api/me')).data.user.canSwitchStore, true, 'an every-store manager switches stores');
  const log = (await owner('/api/audit')).data.audit.filter((a) => a.action === 'promote to manager');
  assert.ok(log.some((a) => a.name === 'Gale Manager' && /Nell Night/.test(a.detail)), 'logged with who did it');
  assert.ok(log.some((a) => a.name === 'Orla Owner' && /Ned Noon · every store/.test(a.detail)));
  // Change to Staff stays an owner's call
  assert.equal((await gm(`/api/team/${nellId}/demote`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await owner(`/api/team/${nellId}/demote`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await owner(`/api/team/${nedId}/demote`, { method: 'POST', body: { storeId } })).status, 200);
});

test('a manager changed to staff without a PIN picks one with the join code and their name', async () => {
  const r = await owner(`/api/team/${gmId}/demote`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.hasPin, false);
  const p = person();
  const s = await p('/api/staff-login', { method: 'POST', body: { code: joinCode, id: gmId, pin: '2468' } });
  assert.equal(s.status, 200);
  assert.equal(s.data.user.id, gmId);
});

test('the demo: promotion and Change to Staff happen straight away, no link', async () => {
  const v = person('10.9.0.1');
  assert.equal((await v('/api/demo/start', { method: 'POST', body: { role: 'manager' } })).status, 200);
  const staff = (await v('/api/team')).data.people.filter((x) => x.role === 'staff');
  const one = staff[0];
  assert.equal(one.canPromote, true);
  const r = await v(`/api/team/${one.id}/promote`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.instant, true);
  assert.equal(r.data.link, undefined);
  assert.equal((await v('/api/team')).data.people.find((x) => x.id === one.id).role, 'manager');
  assert.equal((await v(`/api/team/${one.id}/demote`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await v('/api/team')).data.people.find((x) => x.id === one.id).role, 'staff');
  // other team changes stay off in the demo
  assert.equal((await v('/api/team/invite', { method: 'POST', body: { email: 'a@b.test' } })).status, 403);
});

/* ---------------- the Mise team ---------------- */
const mgr = person('10.8.0.1'), sup = person('10.8.0.2');
let mgrId = 0, supId = 0;
test('the Owner invites a Manager and a Support teammate; nothing opens until their two-step is on; they land in HQ', async () => {
  const ov = (await tommy('/api/super/overview')).data;
  assert.equal(ov.youRole, 'owner');
  assert.equal(ov.can.team, true);
  const a = await tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'mia@mise.test', teamRole: 'manager' } });
  const b = await tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'sol@mise.test', teamRole: 'support' } });
  assert.equal((await tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'x@mise.test', teamRole: 'owner' } })).status, 400, 'there’s one Owner');
  assert.equal((await person()(`/api/invite/${token(b.data.link)}`)).data.teamRole, 'support');
  assert.equal((await mgr(`/api/invite/${token(a.data.link)}`, { method: 'POST', body: { name: 'Maren Manager', password: 'mia-pass-001' } })).status, 200);
  assert.equal((await sup(`/api/invite/${token(b.data.link)}`, { method: 'POST', body: { name: 'Sol Support', password: 'sol-pass-001' } })).status, 200);
  for (const t of [mgr, sup]) {
    assert.equal((await t('/api/super/users')).status, 403, 'two-step first');
    assert.equal((await t('/api/team')).status, 403);
    await twoStep(t);
  }
  mgrId = (await mgr('/api/me')).data.user.id; supId = (await sup('/api/me')).data.user.id;
  const me = (await sup('/api/me')).data.user;
  assert.equal(me.teamRole, 'support');
  assert.equal(me.workingInName, 'Mise Academy (HQ)');
  assert.equal((await mgr('/api/me')).data.user.workingInName, 'Mise Academy (HQ)');
  const team = (await tommy('/api/super/overview')).data.admins;
  assert.deepEqual(team.map((x) => [x.name, x.teamRole]).sort(), [['Maren Manager', 'manager'], ['Sol Support', 'support'], ['Tommy', 'owner']]);
  // HQ's people are the team
  const hq = (await tommy('/api/super/overview')).data.companies.find((c) => c.hq);
  assert.equal(hq.leads, 3);
  assert.equal((await tommy(`/api/super/users?company=${hq.id}`)).data.users.length, 3);
});

test('a Mise Manager: accounts, plans and looks, passwords and PINs, owner invites; not the team, deleting companies or confirming deletions', async () => {
  const ov = (await mgr('/api/super/overview'));
  assert.equal(ov.status, 200);
  assert.equal(ov.data.youRole, 'manager');
  const yes = [
    ['/api/super/users', 'GET'],
    [`/api/super/companies/${otherCompany}`, 'PATCH', { plan: 'foundation' }],
    [`/api/super/companies/${otherCompany}/owner-invite`, 'POST', { email: 'second@other.test' }],
    [`/api/super/users/${theoId}/reset-pin`, 'POST'],
    [`/api/super/users/${ownerId}/reset-password`, 'POST'],
    ['/api/super/log', 'GET'],
    ['/api/super/deletions', 'GET'],
  ];
  for (const [p, method, body] of yes) assert.equal((await mgr(p, { method, body })).status, 200, `${method} ${p}`);
  const no = [
    [`/api/super/companies/${otherCompany}`, 'DELETE', { confirm: 'Other Group' }],
    ['/api/super/deletions/1/confirm', 'POST', { confirm: 'x' }],
    ['/api/super/deletions/1/cancel', 'POST'],
    ['/api/super/admins/invite', 'POST', { email: 'y@mise.test', teamRole: 'support' }],
    [`/api/super/users/${supId}`, 'PATCH', { teamRole: 'manager' }],
    [`/api/super/users/${supId}`, 'DELETE'],
    [`/api/super/users/${supId}/reset-password`, 'POST'],
  ];
  for (const [p, method, body] of no) assert.equal((await mgr(p, { method, body })).status, 403, `${method} ${p}`);
  // working in a company, a Mise Manager can change things there (like an owner)
  assert.equal((await mgr('/api/super/act', { method: 'POST', body: { companyId: 1 } })).status, 200);
  assert.equal((await mgr(`/api/team/${theoId}/reset-pin`, { method: 'POST' })).status, 200);
});

test('Mise Support: looks up accounts, Work Here, Sign In As and the log; changes nothing, in Super Admin or in a company', async () => {
  const ov = await sup('/api/super/overview');
  assert.equal(ov.status, 200);
  assert.equal(ov.data.can.planLook, false);
  assert.equal(ov.data.teamInvites.length, 0);
  for (const p of ['/api/super/users', `/api/super/users?company=${otherCompany}`, '/api/super/log', '/api/super/deletions']) assert.equal((await sup(p)).status, 200, p);
  const no = [
    ['/api/super/companies', 'POST', { name: 'Nope Group' }],
    [`/api/super/companies/${otherCompany}`, 'PATCH', { plan: 'foundation' }],
    [`/api/super/companies/${otherCompany}`, 'PATCH', { name: 'Renamed' }],
    [`/api/super/companies/${otherCompany}/owner-invite`, 'POST', { email: 'z@other.test' }],
    [`/api/super/companies/${otherCompany}/join-code`, 'POST'],
    [`/api/super/users/${theoId}/reset-pin`, 'POST'],
    [`/api/super/users/${ownerId}/reset-password`, 'POST'],
    [`/api/super/users/${theoId}`, 'PATCH', { name: 'Theo T' }],
    [`/api/super/users/${theoId}`, 'DELETE'],
    ['/api/super/admins/invite', 'POST', { email: 'q@mise.test' }],
  ];
  for (const [p, method, body] of no) assert.equal((await sup(p, { method, body })).status, 403, `${method} ${p}`);
  // Work Here: they look; every change is refused
  assert.equal((await sup('/api/super/act', { method: 'POST', body: { companyId: 1 } })).status, 200);
  assert.equal((await sup('/api/team')).status, 200);
  assert.equal((await sup('/api/audit')).status, 200);
  for (const [p, method, body] of [[`/api/team/${theoId}/reset-pin`, 'POST'], ['/api/team/invite', 'POST', { email: 'w@x.test' }], [`/api/team/${theoId}/promote`, 'POST', { storeId: null }], [`/api/path/person/${theoId}`, 'PATCH', { startedOn: '2026-11-01' }]]) {
    const r = await sup(p, { method, body });
    assert.equal(r.status, 403, `${method} ${p}`);
    assert.match(r.data.error, /Support can look/);
  }
  assert.equal((await sup(`/api/path/person/${theoId}`)).data.canPromote, false);
  // Sign In As: they see what the person sees, still view only, and come back
  const as = await sup(`/api/super/users/${ownerId}/sign-in-as`, { method: 'POST' });
  assert.equal(as.status, 200);
  assert.equal((await sup('/api/me')).data.user.viewOnly, true);
  assert.equal((await sup('/api/team')).status, 200);
  assert.equal((await sup(`/api/team/${theoId}/reset-pin`, { method: 'POST' })).status, 403);
  assert.equal((await sup('/api/super/return', { method: 'POST' })).status, 200);
  assert.equal((await sup('/api/me')).data.user.id, supId);
  // and the shared library isn't theirs to change
  assert.equal((await sup('/api/entries', { method: 'POST', body: { collection: 'classic', data: { name: 'X' } } })).status, 403);
});

test('a Mise Manager signed in as someone acts as them; the log names who did it and their team role', async () => {
  assert.equal((await mgr(`/api/super/users/${ownerId}/sign-in-as`, { method: 'POST' })).status, 200);
  assert.equal((await mgr('/api/me')).data.user.viewOnly, false);
  assert.equal((await mgr('/api/super/return', { method: 'POST' })).status, 200);
  const log = (await tommy('/api/super/log')).data.log;
  const pin = log.find((r) => r.action === 'reset PIN' && r.name === 'Maren Manager');
  assert.ok(pin, 'the Manager’s reset is logged');
  assert.equal(pin.teamRole, 'manager');
  const look = log.find((r) => r.action === 'sign in as' && r.name === 'Sol Support');
  assert.equal(look.teamRole, 'support');
  assert.ok(log.some((r) => r.action === 'invite to the Mise team' && r.name === 'Tommy' && r.teamRole === 'owner'));
});

test('only the Owner changes roles and removes teammates; a changed teammate is signed out', async () => {
  assert.equal((await tommy(`/api/super/users/${supId}`, { method: 'PATCH', body: { teamRole: 'owner' } })).status, 400);
  assert.equal((await tommy(`/api/super/users/${supId}`, { method: 'PATCH', body: { teamRole: 'manager' } })).status, 200);
  assert.equal((await sup('/api/me')).data.user, null, 'signed out on a role change');
  const tommyId = (await tommy('/api/me')).data.user.id;
  assert.equal((await mgr(`/api/super/users/${tommyId}`, { method: 'PATCH', body: { teamRole: 'support' } })).status, 403);
  assert.equal((await tommy(`/api/super/users/${tommyId}`, { method: 'PATCH', body: { teamRole: 'support' } })).status, 400, 'the Owner stays the Owner');
  const inv = await tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'temp@mise.test', teamRole: 'support' } });
  const open = (await tommy('/api/super/overview')).data.teamInvites;
  assert.equal(open.length, 1);
  assert.equal((await tommy(`/api/super/admins/invites/${open[0].id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await person()(`/api/invite/${token(inv.data.link)}`)).data.valid, false);
  assert.equal((await tommy(`/api/super/users/${mgrId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await mgr('/api/me')).data.user, null);
});
