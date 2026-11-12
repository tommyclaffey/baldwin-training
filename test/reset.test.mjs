// Password reset (Nov 11): one-time links from an owner or a super admin, Forgot Password? by email (Resend), the demo.
// Two servers: A has no email set up, B has RESEND_API_KEY + MAIL_FROM pointed at a fake Resend in this process.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { totpAt, sha256 } from '../server/auth.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-reset-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-reset-b-'));
const PORT_A = 5400 + Math.floor(Math.random() * 300), PORT_B = PORT_A + 300;
const servers = [];

// The fake Resend: records every email the app tries to send.
const mails = [];
const resend = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => { mails.push({ auth: req.headers.authorization, ...JSON.parse(body || '{}') }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"fake"}'); });
});
let RESEND_URL = '';

async function start(port, dir, extra) {
  const s = spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, OWNER_EMAIL: 'owner@reset.test', SUPERADMIN_EMAIL: 'tommy@reset.test', RESEND_API_URL: RESEND_URL,
      RESEND_API_KEY: '', MAIL_FROM: '', ...extra } });
  servers.push(s);
  for (let i = 0; i < 300; i++) { try { await fetch(`http://127.0.0.1:${port}/api/me`); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
}

before(async () => {
  await new Promise((r) => resend.listen(0, '127.0.0.1', r));
  RESEND_URL = `http://127.0.0.1:${resend.address().port}/emails`;
  await start(PORT_A, dirA, {});
  await start(PORT_B, dirB, { RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Mise Academy <hello@mise.test>', APP_URL: 'https://app.mise.test' });
});
after(() => { for (const s of servers) s.kill(); resend.close(); for (const d of [dirA, dirB]) fs.rmSync(d, { recursive: true, force: true }); });

/** A person with their own cookie jar, on server A or B, from an address of their own. */
function person(port = PORT_A, ip = '127.0.0.1') {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const token = (link) => link.split('/').pop();
const login = (email, password, port = PORT_A) => person(port)('/api/login', { method: 'POST', body: { email, password } });
const code = (secret) => totpAt(secret, Math.floor(Date.now() / 30000));
const waitFor = async (fn, ms = 3000) => { for (let t = 0; t < ms; t += 50) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return fn(); };

const owner = person(), tommy = person(), gm = person(), boss = person(), staff = person(), owner2 = person();
let superSecret = '', gmId = 0, bossId = 0, staffId = 0, ownerId = 0;

test('setup: an owner, a super admin with two-step, a store manager, an all-store manager, staff, a second company', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Odette Owner', email: 'owner@reset.test', password: 'owner-pass-1' } })).status, 200);
  assert.equal((await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@reset.test', password: 'super-pass-1' } })).status, 200);
  superSecret = (await tommy('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await tommy('/api/2fa/enable', { method: 'POST', body: { code: code(superSecret) } })).status, 200);
  ownerId = (await owner('/api/me')).data.user.id;
  const team = (await owner('/api/team')).data;
  const store = team.stores[0].id;
  const i1 = await owner('/api/team/invite', { method: 'POST', body: { email: 'gm@reset.test', role: 'manager', storeId: store } });
  assert.equal((await gm(`/api/invite/${token(i1.data.link)}`, { method: 'POST', body: { name: 'Greer Manager', password: 'gm-pass-001' } })).status, 200);
  const i2 = await owner('/api/team/invite', { method: 'POST', body: { email: 'boss@reset.test', role: 'manager' } });
  assert.equal((await boss(`/api/invite/${token(i2.data.link)}`, { method: 'POST', body: { name: 'Bram Allstores', password: 'boss-pass-01' } })).status, 200);
  assert.equal((await staff('/api/join', { method: 'POST', body: { code: team.company.joinCode, name: 'Suki Staff', pin: '4321', storeId: store } })).status, 200);
  gmId = (await gm('/api/me')).data.user.id; bossId = (await boss('/api/me')).data.user.id; staffId = (await staff('/api/me')).data.user.id;
  const co = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Other Group', ownerEmail: 'owner@other.test' } });
  assert.equal((await owner2(`/api/invite/${token(co.data.link)}`, { method: 'POST', body: { name: 'Otto Other', password: 'other-pass-1' } })).status, 200);
});

test('an owner’s reset link works once: new password, signed in, other sessions ended, then refused', async () => {
  const r = await owner(`/api/team/${gmId}/reset-password`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.match(r.data.link, /^\/admin\/reset\/[A-Za-z0-9_-]{40,}$/);
  assert.equal(r.data.hours, 24);
  const hrs = (Date.parse(r.data.expiresAt) - Date.now()) / 3600e3;
  assert.ok(hrs > 23.9 && hrs <= 24, 'expires in 24 hours');
  assert.equal((await login('gm@reset.test', 'gm-pass-001')).status, 200, 'the old password works until the link is used');
  const t = token(r.data.link);
  const info = (await person()(`/api/reset/${t}`)).data;
  assert.deepEqual([info.valid, info.email], [true, 'gm@reset.test']);
  const phone = person();
  assert.equal((await phone(`/api/reset/${t}`, { method: 'POST', body: { password: 'short' } })).status, 400, 'same password rule as invites');
  const used = await phone(`/api/reset/${t}`, { method: 'POST', body: { password: 'gm-new-pass-2' } });
  assert.equal(used.status, 200);
  assert.equal(used.data.user.email, 'gm@reset.test');
  assert.equal((await phone('/api/me')).data.user.id, gmId, 'signed in as them');
  assert.equal((await gm('/api/me')).data.user, null, 'their other sessions are signed out');
  assert.equal((await login('gm@reset.test', 'gm-pass-001')).status, 401, 'the old password stops working');
  assert.equal((await login('gm@reset.test', 'gm-new-pass-2')).status, 200);
  assert.equal((await person()(`/api/reset/${t}`, { method: 'POST', body: { password: 'another-pass-3' } })).status, 410, 'a second use is refused');
  assert.equal((await person()(`/api/reset/${t}`)).data.valid, false);
  // the hash is stored, never the token
  const db = new DatabaseSync(path.join(dirA, 'baldwin.db'));
  assert.ok(db.prepare('SELECT 1 FROM password_resets WHERE token_hash = ?').get(sha256(t)));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets WHERE token_hash = ?').get(t).n, 0);
  db.close();
  // written to the owner's Activity
  const acts = (await owner('/api/audit')).data.audit.map((a) => a.action);
  assert.ok(acts.includes('reset link') && acts.includes('reset password'));
  await gm('/api/login', { method: 'POST', body: { email: 'gm@reset.test', password: 'gm-new-pass-2' } });
});

test('expired links and replaced links are refused', async () => {
  const first = token((await owner(`/api/team/${bossId}/reset-password`, { method: 'POST' })).data.link);
  const second = token((await owner(`/api/team/${bossId}/reset-password`, { method: 'POST' })).data.link);
  assert.equal((await person()(`/api/reset/${first}`)).data.valid, false, 'a newer link replaces the older one');
  assert.equal((await person()(`/api/reset/${first}`, { method: 'POST', body: { password: 'boss-new-pass-1' } })).status, 410);
  const db = new DatabaseSync(path.join(dirA, 'baldwin.db'));
  db.prepare('UPDATE password_resets SET expires_at = ? WHERE token_hash = ?').run(new Date(Date.now() - 60e3).toISOString(), sha256(second));
  db.close();
  assert.equal((await person()(`/api/reset/${second}`)).data.valid, false);
  assert.equal((await person()(`/api/reset/${second}`, { method: 'POST', body: { password: 'boss-new-pass-1' } })).status, 410, 'expired');
  assert.equal((await login('boss@reset.test', 'boss-pass-01')).status, 200, 'their password is unchanged');
});

test('who can reset whom: owners only (not managers, not staff), never across companies, not staff or yourself', async () => {
  const ownerRow = (await gm('/api/team')).data.people.find((p) => p.role === 'owner');
  assert.equal((await gm(`/api/team/${ownerRow.id}/reset-password`, { method: 'POST' })).status, 404, 'a store manager can’t reach an owner');
  assert.equal((await boss(`/api/team/${gmId}/reset-password`, { method: 'POST' })).status, 403, 'an all-store manager can’t reset a manager');
  assert.equal((await boss(`/api/team/${ownerId}/reset-password`, { method: 'POST' })).status, 403, 'or an owner');
  assert.equal((await staff(`/api/team/${gmId}/reset-password`, { method: 'POST' })).status, 403, 'staff can’t');
  assert.equal((await person()(`/api/team/${gmId}/reset-password`, { method: 'POST' })).status, 401, 'signed out can’t');
  assert.equal((await owner(`/api/team/${staffId}/reset-password`, { method: 'POST' })).status, 400, 'staff use Reset PIN');
  assert.equal((await owner(`/api/team/${ownerId}/reset-password`, { method: 'POST' })).status, 400, 'not your own: use Your Account');
  assert.equal((await owner2(`/api/team/${gmId}/reset-password`, { method: 'POST' })).status, 404, 'another company’s people are out of reach');
  assert.equal((await owner2(`/api/super/users/${gmId}/reset-password`, { method: 'POST' })).status, 404, 'the super admin route doesn’t exist for owners');
});

test('super admins reset anyone with email; another super admin only from the primary; two-step still asks for the code', async () => {
  const r = await tommy(`/api/super/users/${ownerId}/reset-password`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal((await tommy(`/api/super/users/${staffId}/reset-password`, { method: 'POST' })).status, 400, 'staff use Reset PIN');
  const fresh = person();
  assert.equal((await fresh(`/api/reset/${token(r.data.link)}`, { method: 'POST', body: { password: 'owner-new-pass-1' } })).status, 200);
  assert.equal((await owner('/api/me')).data.user, null);
  await owner('/api/login', { method: 'POST', body: { email: 'owner@reset.test', password: 'owner-new-pass-1' } });
  let log = (await tommy('/api/super/log')).data.log.map((l) => l.action);
  assert.ok(log.includes('reset password link') && log.includes('reset password'), 'creating and using it are in the Super Admin log');
  // a teammate super admin with two-step
  const inv = await tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'mate@reset.test' } });
  const mate = person();
  await mate(`/api/invite/${token(inv.data.link)}`, { method: 'POST', body: { name: 'Mika Mate', password: 'mate-pass-001' } });
  const mateSecret = (await mate('/api/2fa/start', { method: 'POST' })).data.secret;
  await mate('/api/2fa/enable', { method: 'POST', body: { code: code(mateSecret) } });
  const me = (await tommy('/api/me')).data.user;
  assert.equal((await mate(`/api/super/users/${me.id}/reset-password`, { method: 'POST' })).status, 403, 'a teammate can’t reset the primary');
  const mateId = (await mate('/api/me')).data.user.id;
  const link = await tommy(`/api/super/users/${mateId}/reset-password`, { method: 'POST' });
  assert.equal(link.status, 200);
  const phone = person();
  const used = await phone(`/api/reset/${token(link.data.link)}`, { method: 'POST', body: { password: 'mate-new-pass-2' } });
  assert.equal(used.status, 200);
  assert.equal(used.data.needCode, true, 'two-step still needs the code');
  assert.equal((await phone('/api/me')).data.user, null, 'no session until the code');
  assert.equal((await phone('/api/login/code', { method: 'POST', body: { ticket: used.data.ticket, code: code(mateSecret) } })).status, 200);
  assert.equal((await phone('/api/me')).data.user.id, mateId);
  log = (await tommy('/api/super/log')).data.log.map((l) => l.action);
  assert.ok(log.filter((a) => a === 'reset password').length >= 2);
});

test('Forgot Password? without email set up: the same answer for real and unknown emails, nothing sent', async () => {
  const before = mails.length;
  const real = await person(PORT_A, '10.0.0.1')('/api/password/forgot', { method: 'POST', body: { email: 'GM@reset.test ' } });
  const unknown = await person(PORT_A, '10.0.0.1')('/api/password/forgot', { method: 'POST', body: { email: 'nobody@reset.test' } });
  const other = await person(PORT_A, '10.0.0.1')('/api/password/forgot', { method: 'POST', body: { email: 'owner@other.test' } });
  assert.equal(real.status, 200);
  assert.deepEqual(real, unknown);
  assert.deepEqual(real, other, "another company’s owner: same answer");
  assert.match(real.data.message, /^If that email has an account, we’ve sent a reset link\./);
  assert.equal((await person(PORT_A, '10.0.0.1')('/api/password/forgot', { method: 'POST', body: { email: 'not an email' } })).status, 400);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(mails.length, before, 'no email without RESEND_API_KEY and MAIL_FROM');
  const db = new DatabaseSync(path.join(dirA, 'baldwin.db'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM password_resets WHERE via = 'email'").get().n, 0, 'and no link made');
  db.close();
  assert.ok((await owner('/api/audit')).data.audit.some((a) => a.action === 'reset asked'), 'the ask shows in Activity');
});

test('Forgot Password? is rate limited by address', async () => {
  const from = person(PORT_A, '10.0.0.77');
  for (let i = 0; i < 10; i++) assert.equal((await from('/api/password/forgot', { method: 'POST', body: { email: `x${i}@reset.test` } })).status, 200);
  assert.equal((await from('/api/password/forgot', { method: 'POST', body: { email: 'y@reset.test' } })).status, 429);
  assert.equal((await person(PORT_A, '10.0.0.78')('/api/password/forgot', { method: 'POST', body: { email: 'y@reset.test' } })).status, 200, 'another address is fine');
});

test('Forgot Password? with Resend set up: emails a working link; unknown emails get nothing; 3 an hour per email', async () => {
  const bOwner = person(PORT_B);
  assert.equal((await bOwner('/api/setup', { method: 'POST', body: { name: 'Bea Owner', email: 'owner@reset.test', password: 'owner-b-pass-1' } })).status, 200);
  const before = mails.length;
  const unknown = await person(PORT_B, '10.1.0.1')('/api/password/forgot', { method: 'POST', body: { email: 'nobody@reset.test' } });
  const real = await person(PORT_B, '10.1.0.1')('/api/password/forgot', { method: 'POST', body: { email: 'owner@reset.test' } });
  assert.deepEqual(real, unknown, 'the same answer either way');
  assert.ok(await waitFor(() => mails.length === before + 1), 'one email sent');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(mails.length, before + 1, 'nothing for the unknown email');
  const mail = mails.at(-1);
  assert.equal(mail.auth, 'Bearer re_test_key');
  assert.equal(mail.from, 'Mise Academy <hello@mise.test>');
  assert.deepEqual(mail.to, ['owner@reset.test']);
  assert.match(mail.subject, /Mise Academy/);
  assert.match(mail.text, /expires in 24 hours/);
  const url = mail.text.match(/https:\/\/app\.mise\.test\/admin\/reset\/[A-Za-z0-9_-]+/)?.[0];
  assert.ok(url, 'the link uses APP_URL');
  assert.ok(mail.html.includes(url));
  const phone = person(PORT_B);
  assert.equal((await phone(`/api/reset/${token(url)}`, { method: 'POST', body: { password: 'owner-b-new-1' } })).status, 200);
  assert.equal((await login('owner@reset.test', 'owner-b-new-1', PORT_B)).status, 200);
  // per email: 3 an hour, then the same answer and nothing sent (one already used above)
  const n = mails.length;
  for (let i = 0; i < 3; i++) assert.equal((await person(PORT_B, `10.1.1.${i}`)('/api/password/forgot', { method: 'POST', body: { email: 'owner@reset.test' } })).status, 200);
  assert.ok(await waitFor(() => mails.length === n + 2));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(mails.length, n + 2, 'the 4th ask in an hour sends nothing');
});

test('the demo: reset and forgot password are switched off', async () => {
  const visitor = person(PORT_A, '10.2.0.1');
  assert.equal((await visitor('/api/demo/start', { method: 'POST', body: { role: 'manager' } })).status, 200);
  const team = await visitor('/api/manager/team');
  assert.equal(team.status, 200);
  for (const [p, body] of [[`/api/team/${team.data.people[0]?.id || 1}/reset-password`, undefined], ['/api/password/forgot', { email: 'owner@reset.test' }], ['/api/reset/abc', { password: 'whatever-123' }]]) {
    const r = await visitor(p, { method: 'POST', body });
    assert.equal(r.status, 403, p);
    assert.equal(r.data.error, 'That’s switched off in the demo.');
  }
});
