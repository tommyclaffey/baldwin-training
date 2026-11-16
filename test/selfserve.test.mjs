// Self-serve setup (Nov 16): owners add and rename their own stores; every invite link also goes by email
// once email is set up; /privacy, /terms and /help stay hidden until content/legal.md's four blanks are filled.
// Two servers: A has no email and the legal page's blanks empty (and a small store cap); B has RESEND_API_KEY + MAIL_FROM
// pointed at a fake Resend in this process, and a filled-in legal file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { totpAt } from '../server/auth.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-self-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-self-b-'));
const PORT_A = 7500 + Math.floor(Math.random() * 300), PORT_B = PORT_A + 800; // clear of the other files' ranges
const servers = [];

// The legal file: the repo's own words, with three blanks emptied (A: a draft) or filled with test values (B).
const LEGAL = fs.readFileSync(path.join(root, 'content/legal.md'), 'utf8');
const fill = (src, v) => src.replace(/^company:.*$/m, `company: ${v.company}`).replace(/^state:.*$/m, `state: ${v.state}`)
  .replace(/^supportEmail:.*$/m, `supportEmail: ${v.supportEmail}`).replace(/^date:.*$/m, `date: ${v.date}`);
const legalA = path.join(dirA, 'legal.md'), legalB = path.join(dirB, 'legal.md');
fs.writeFileSync(legalA, fill(LEGAL, { company: '12 Tribes Media LLC', state: '', supportEmail: '', date: '' }));
fs.writeFileSync(legalB, fill(LEGAL, { company: 'Testco LLC', state: 'Michigan', supportEmail: 'help@mise.test', date: 'November 20, 2026' }));

// The fake Resend: records every email; an address with "bounce" in it gets a 500.
const mails = [];
const resend = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const m = JSON.parse(body || '{}');
    if (String(m.to).includes('bounce')) { res.writeHead(500); return res.end('{"message":"boom"}'); }
    mails.push({ auth: req.headers.authorization, ...m }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"fake"}');
  });
});

async function start(port, dir, extra) {
  const s = spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, OWNER_EMAIL: 'owner@self.test', SUPERADMIN_EMAIL: 'tommy@self.test',
      RESEND_API_KEY: '', MAIL_FROM: '', ...extra } });
  servers.push(s);
  for (let i = 0; i < 300; i++) { try { await fetch(`http://127.0.0.1:${port}/api/me`); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
}
before(async () => {
  await new Promise((r) => resend.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${resend.address().port}/emails`;
  await start(PORT_A, dirA, { LEGAL_FILE: legalA, STORE_CAP: '5', RESEND_API_URL: url });
  await start(PORT_B, dirB, { LEGAL_FILE: legalB, RESEND_API_URL: url, RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Mise Academy <hello@mise.test>', APP_URL: 'https://app.mise.test' });
});
after(() => { for (const s of servers) s.kill(); resend.close(); for (const d of [dirA, dirB]) fs.rmSync(d, { recursive: true, force: true }); });

function person(port = PORT_A) {
  let jar = '';
  const call = async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return call;
}
const token = (link) => link.split('/').pop();
const code = (secret) => totpAt(secret, Math.floor(Date.now() / 30000));
const dbOf = (dir) => new DatabaseSync(path.join(dir, 'baldwin.db'), { readOnly: true });

/** On one server: an owner (company 1), a super admin with two-step working in company 1, a store manager, staff, and a
 *  second company's owner. */
async function cast(port) {
  const owner = person(port), tommy = person(port), gm = person(port), staff = person(port), owner2 = person(port);
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Odette Owner', email: 'owner@self.test', password: 'owner-pass-1' } })).status, 200);
  assert.equal((await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@self.test', password: 'super-pass-1' } })).status, 200);
  const secret = (await tommy('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await tommy('/api/2fa/enable', { method: 'POST', body: { code: code(secret) } })).status, 200);
  assert.equal((await tommy('/api/super/act', { method: 'POST', body: { companyId: 1 } })).status, 200);
  const team = (await owner('/api/team')).data;
  const i = await owner('/api/team/invite', { method: 'POST', body: { email: 'gm@self.test', role: 'manager', storeId: team.stores[0].id } });
  assert.equal((await gm(`/api/invite/${token(i.data.link)}`, { method: 'POST', body: { name: 'Greer Manager', password: 'gm-pass-001' } })).status, 200);
  assert.equal((await staff('/api/join', { method: 'POST', body: { code: team.company.joinCode, name: 'Suki Staff', pin: '4321', storeId: team.stores[0].id } })).status, 200);
  const co = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Other Group', ownerEmail: 'owner@other.test' } });
  assert.equal((await owner2(`/api/invite/${token(co.data.link)}`, { method: 'POST', body: { name: 'Otto Other', password: 'other-pass-1' } })).status, 200);
  return { owner, tommy, gm, staff, owner2, joinCode: team.company.joinCode };
}
let A, B;
test('setup: the same cast on both servers', async () => {
  A = await cast(PORT_A);
  const before = mails.length;
  B = await cast(PORT_B);
  // on B, the manager invite and the second company's owner invite went by email
  assert.deepEqual(mails.slice(before).map((m) => m.to[0]).sort(), ['gm@self.test', 'owner@other.test']);
});

/* ------------------------------------------------ stores ------------------------------------------------ */

test('stores: owners see and add them; managers, staff and strangers can’t', async () => {
  const list = await A.owner('/api/team/stores');
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.stores.map((s) => s.name), ['The Baldwin', 'J.Baldwin\'s', 'Testa Barra']);
  assert.equal(list.data.cap, 5);
  assert.equal(list.data.stores[0].staff, 1, 'Suki works at the first store');
  assert.equal(list.data.stores[0].managers, 1, 'Greer manages it');
  assert.equal((await A.gm('/api/team/stores')).status, 403, 'a manager can’t open it');
  assert.equal((await A.gm('/api/team/stores', { method: 'POST', body: { name: 'Sneaky Store' } })).status, 403);
  assert.equal((await A.staff('/api/team/stores', { method: 'POST', body: { name: 'Sneaky Store' } })).status, 403, 'staff can’t');
  assert.equal((await person(PORT_A)('/api/team/stores', { method: 'POST', body: { name: 'Sneaky Store' } })).status, 401);
  assert.equal((await A.owner('/api/team/stores', { method: 'POST', body: { name: 'x' } })).status, 400, 'a name is needed');
  assert.equal((await A.owner('/api/team/stores', { method: 'POST', body: { name: 'testa barra' } })).status, 409, 'no two stores with one name');

  const add = await A.owner('/api/team/stores', { method: 'POST', body: { name: '  The   Corner  ' } });
  assert.equal(add.status, 200);
  assert.equal(add.data.store.name, 'The Corner');
  assert.equal(add.data.store.bookReady, false, 'it starts on the shared library');
  const me = (await A.owner('/api/me')).data.user;
  assert.ok(me.stores.some((s) => s.name === 'The Corner'), 'the Store menu lists it');
  // the other company can't see or rename it
  assert.equal((await A.owner2(`/api/team/stores/${add.data.store.id}`, { method: 'PATCH', body: { name: 'Mine Now' } })).status, 404);
  assert.ok(!(await A.owner2('/api/team/stores')).data.stores.some((s) => s.name === 'The Corner'));
  const db = dbOf(dirA);
  const row = db.prepare('SELECT * FROM stores WHERE id = ?').get(add.data.store.id);
  assert.equal(row.company_id, 1); assert.equal(row.book_ready, 0);
  assert.ok(db.prepare("SELECT 1 FROM audit WHERE action = 'add store' AND detail = 'The Corner' AND company_id = 1").get(), 'logged in Activity');
  db.close();
});

test('stores: a new store reads the shared library, like J.Baldwin’s', async () => {
  const me = (await A.owner('/api/me')).data.user;
  const index = async (name) => {
    assert.equal((await A.owner('/api/store', { method: 'POST', body: { storeId: me.stores.find((s) => s.name === name).id } })).status, 200);
    return (await A.owner('/api/index')).data.map((e) => e.id || e.file).sort();
  };
  const jb = await index('J.Baldwin\'s');
  const corner = await index('The Corner');
  assert.ok(corner.length > 100, `the new store has the library (${corner.length} pages)`);
  assert.deepEqual(corner, jb, 'the same pages as J.Baldwin’s');
  await index('The Baldwin');
});

test('stores: owners rename them; managers can’t; the log says so', async () => {
  const id = (await A.owner('/api/team/stores')).data.stores.find((s) => s.name === 'The Corner').id;
  assert.equal((await A.gm(`/api/team/stores/${id}`, { method: 'PATCH', body: { name: 'Manager Pick' } })).status, 403);
  assert.equal((await A.owner(`/api/team/stores/${id}`, { method: 'PATCH', body: { name: 'The Baldwin' } })).status, 409);
  const r = await A.owner(`/api/team/stores/${id}`, { method: 'PATCH', body: { name: 'The Corner Bar' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.store.name, 'The Corner Bar');
  const db = dbOf(dirA);
  assert.ok(db.prepare("SELECT 1 FROM audit WHERE action = 'rename store' AND detail = 'The Corner → The Corner Bar'").get());
  db.close();
});

test('stores: a cap per company (STORE_CAP); the Mise team can go past it', async () => {
  assert.equal((await A.owner('/api/team/stores', { method: 'POST', body: { name: 'Fifth Store' } })).status, 200);
  const full = await A.owner('/api/team/stores', { method: 'POST', body: { name: 'Sixth Store' } });
  assert.equal(full.status, 400);
  assert.match(full.data.error, /5 stores/);
  assert.equal((await A.owner('/api/team/stores')).data.canAdd, false);
  const sup = await A.tommy('/api/team/stores', { method: 'POST', body: { name: 'Sixth Store' } });
  assert.equal(sup.status, 200, 'a super admin working in the company adds past the cap');
});

test('stores: in a demo the manager adds up to 3, switches between them, and they go with the demo', async () => {
  const demo = person(PORT_A);
  assert.equal((await demo('/api/demo/start', { method: 'POST', body: { role: 'manager', demo: 'mise' } })).status, 200);
  const co = (await demo('/api/me')).data.user.companyId;
  const list = await demo('/api/team/stores');
  assert.equal(list.status, 200);
  assert.equal(list.data.demo, true);
  assert.equal(list.data.cap, 3);
  const a = await demo('/api/team/stores', { method: 'POST', body: { name: 'Wrenfield Uptown' } });
  assert.equal(a.status, 200);
  assert.equal((await demo('/api/team/stores', { method: 'POST', body: { name: 'Wrenfield Lake' } })).status, 200);
  const third = await demo('/api/team/stores', { method: 'POST', body: { name: 'Wrenfield Four' } });
  assert.equal(third.status, 400);
  assert.match(third.data.error, /demo can have up to 3/);
  assert.equal((await demo(`/api/team/stores/${a.data.store.id}`, { method: 'PATCH', body: { name: 'Wrenfield Midtown' } })).status, 200, 'rename works too');
  assert.equal((await demo('/api/store', { method: 'POST', body: { storeId: a.data.store.id } })).status, 200, 'switching stores works in a demo');
  assert.equal((await demo('/api/me')).data.user.store.name, 'Wrenfield Midtown');
  assert.equal((await demo('/api/store', { method: 'POST', body: { storeId: 1 } })).status, 404, 'but never to a real company’s store');
  // the employee demo can't
  const emp = person(PORT_A);
  assert.equal((await emp('/api/demo/start', { method: 'POST', body: { role: 'employee', demo: 'mise' } })).status, 200);
  assert.equal((await emp('/api/team/stores', { method: 'POST', body: { name: 'Staff Store' } })).status, 403);
  // a refresh drops the copy, stores included
  assert.equal((await demo('/api/demo/restart', { method: 'POST' })).status, 200);
  const db = dbOf(dirA);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stores WHERE company_id = ?').get(co).n, 0, 'the demo’s stores are gone with it');
  db.close();
});

/* ------------------------------------------------ invite emails ------------------------------------------------ */

const waitFor = async (fn, ms = 3000) => { for (let t = 0; t < ms; t += 50) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return fn(); };

test('invites without email set up: the link to copy, and "email isn’t set up"', async () => {
  const before = mails.length;
  const r = await A.owner('/api/team/invite', { method: 'POST', body: { email: 'new@self.test', role: 'manager' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.mail, { on: false, sent: false, reason: 'off' });
  assert.match(r.data.link, /^\/admin\/invite\//);
  assert.equal((await A.owner('/api/me')).data.mailOn, false);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(mails.length, before, 'nothing sent');
});

test('invites with email set up: the owner’s invite goes by email, naming the restaurant', async () => {
  assert.equal((await B.owner('/api/me')).data.mailOn, true);
  const stores = (await B.owner('/api/team')).data.stores;
  const before = mails.length;
  const r = await B.owner('/api/team/invite', { method: 'POST', body: { email: 'Nina@Self.test', role: 'manager', storeId: stores[1].id } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.mail, { on: true, sent: true, reason: null });
  assert.equal(mails.length, before + 1);
  const m = mails.at(-1);
  assert.deepEqual(m.to, ['nina@self.test']);
  assert.equal(m.from, 'Mise Academy <hello@mise.test>');
  assert.equal(m.auth, 'Bearer re_test_key');
  assert.equal(m.subject, "You’re invited to J.Baldwin's on Mise Academy");
  assert.ok(m.text.includes('https://app.mise.test' + r.data.link), 'the link, on APP_URL');
  assert.match(m.text, /Odette Owner invited you to join J\.Baldwin's on Mise Academy as a manager/);
  assert.ok(m.html.includes('Accept Invite'));
  // the link in the email works
  const joiner = person(PORT_B);
  assert.equal((await joiner(`/api/invite/${token(r.data.link)}`, { method: 'POST', body: { name: 'Nina Newhire', password: 'nina-pass-01' } })).status, 200);
  const db = dbOf(dirB);
  assert.ok(db.prepare("SELECT 1 FROM audit WHERE action = 'invite' AND detail = 'nina@self.test · manager · emailed'").get(), 'the log says it was emailed');
  db.close();
});

test('invite emails: 3 an hour per address, then the link only', async () => {
  const before = mails.length;
  const go = () => B.owner('/api/team/invite', { method: 'POST', body: { email: 'limit@self.test', role: 'owner' } });
  for (let i = 0; i < 3; i++) assert.equal((await go()).data.mail.sent, true);
  const fourth = await go();
  assert.equal(fourth.status, 200, 'the link is still made');
  assert.deepEqual(fourth.data.mail, { on: true, sent: false, reason: 'limit' });
  assert.equal(mails.length, before + 3);
  assert.match(mails.at(-1).subject, /You’re invited to Baldwin Restaurant Group on Mise Academy/, 'an owner invite names the company');
});

test('invite emails: a failed send goes to the errors table, and says so', async () => {
  const r = await B.owner('/api/team/invite', { method: 'POST', body: { email: 'bounce@self.test', role: 'manager' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.mail, { on: true, sent: false, reason: 'failed' });
  const db = dbOf(dirB);
  assert.ok(db.prepare("SELECT 1 FROM errors WHERE path = '/api/team/invite' AND message LIKE '%Resend answered 500%'").get(), 'logged for the ops check');
  db.close();
});

test('invite emails: the super admin’s owner invites and Mise team invites go too', async () => {
  const before = mails.length;
  const co = await B.tommy('/api/super/companies', { method: 'POST', body: { name: 'Harbor Hall', ownerEmail: 'owner@harbor.test' } });
  assert.equal(co.status, 200);
  assert.equal(co.data.mail.sent, true);
  const inv = await B.tommy(`/api/super/companies/${co.data.id}/owner-invite`, { method: 'POST', body: { email: 'second@harbor.test' } });
  assert.equal(inv.data.mail.sent, true);
  const team = await B.tommy('/api/super/admins/invite', { method: 'POST', body: { email: 'mate@mise.test', teamRole: 'support' } });
  assert.equal(team.data.mail.sent, true);
  assert.equal(mails.length, before + 3);
  const [a, b, c] = mails.slice(-3);
  assert.equal(a.subject, 'You’re invited to Harbor Hall on Mise Academy');
  assert.match(a.text, /Tommy invited you to join Harbor Hall on Mise Academy as an owner/);
  assert.deepEqual(b.to, ['second@harbor.test']);
  assert.equal(c.subject, 'You’re invited to the Mise Academy team');
  assert.ok(!c.text.includes('Harbor'), 'a team invite names no restaurant');
});

test('Promote to Manager sends no email (Nov 16: it’s instant now), even with email set up', async () => {
  const sukiB = (await B.owner('/api/team')).data.people.find((p) => p.name === 'Suki Staff').id;
  const before = mails.length;
  const r = await B.owner(`/api/team/${sukiB}/promote`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.instant, true);
  assert.equal(r.data.link, undefined);
  assert.equal(r.data.mail, undefined);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(mails.length, before, 'nothing sent');
  assert.equal((await B.staff('/api/me')).data.user.role, 'manager', 'her session carries on with the new access');
});

test('demos never send: promotion is instant, invites are switched off', async () => {
  const demo = person(PORT_B);
  assert.equal((await demo('/api/demo/start', { method: 'POST', body: { role: 'manager' } })).status, 200);
  assert.equal((await demo('/api/me')).data.mailOn, false, 'the demo’s buttons don’t say Send');
  const before = mails.length;
  assert.equal((await demo('/api/team/invite', { method: 'POST', body: { email: 'x@self.test', role: 'manager' } })).status, 403);
  const someone = (await demo('/api/team')).data.people.find((p) => p.role === 'staff');
  const r = await demo(`/api/team/${someone.id}/promote`, { method: 'POST', body: { email: 'demo@self.test' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.instant, true);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(mails.length, before, 'nothing sent from a demo');
});

/* ------------------------------------------------ privacy, terms, help ------------------------------------------------ */

test('legal pages with blanks empty: not found for the public and customers; a draft preview for super admins', async () => {
  const anon = person(PORT_A);
  for (const kind of ['privacy', 'terms', 'help']) {
    assert.equal((await anon(`/api/legal/${kind}`)).status, 404, kind);
    assert.equal((await A.owner(`/api/legal/${kind}`)).status, 404, `${kind}: an owner`);
    assert.equal((await A.staff(`/api/legal/${kind}`)).status, 404, `${kind}: staff`);
  }
  const me = (await anon('/api/me')).data;
  assert.deepEqual(me.legal, { public: false, supportEmail: null }, 'no links');
  const draft = await A.tommy('/api/legal/privacy');
  assert.equal(draft.status, 200);
  assert.equal(draft.data.draft, true);
  assert.deepEqual(draft.data.missing, ['state', 'supportEmail', 'date']);
  const text = JSON.stringify(draft.data.blocks);
  assert.ok(text.includes('"t":"[Support email]","blank":true'), 'blanks show as blanks in the preview');
  const words = draft.data.blocks.flatMap((b) => b.p || []).map((r) => r.t).join('');
  assert.ok(words.includes('run by 12 Tribes Media LLC, doing business as Mise Academy'), 'the company is filled in');
  // the address itself serves the app like any unknown address (which shows the sign-in screen or "not found")
  const page = await fetch(`http://127.0.0.1:${PORT_A}/privacy`).then((r) => r.text());
  const unknown = await fetch(`http://127.0.0.1:${PORT_A}/no-such-page`).then((r) => r.text());
  assert.equal(page, unknown);
});

test('legal pages with every blank filled: public, blanks filled in, links on', async () => {
  const anon = person(PORT_B);
  const me = (await anon('/api/me')).data;
  assert.deepEqual(me.legal, { public: true, supportEmail: 'help@mise.test' });
  const privacy = await anon('/api/legal/privacy');
  assert.equal(privacy.status, 200);
  assert.equal(privacy.data.draft, false);
  assert.equal(privacy.data.title, 'Privacy Policy');
  const text = JSON.stringify(privacy.data.blocks);
  assert.ok(!/\[(Company|State|Support email|Date)\]/.test(text), 'no blanks left');
  assert.ok(text.includes('Testco LLC') && text.includes('November 20, 2026'));
  assert.ok(text.includes('"t":"help@mise.test","mail":true'), 'the support email is a link');
  assert.ok(privacy.data.blocks.some((b) => b.h && b.h[0].t === 'What we keep'));
  const terms = (await anon('/api/legal/terms')).data;
  assert.equal(terms.blocks.find((b) => b.ol).ol.length, 10, 'the 10 terms');
  assert.ok(JSON.stringify(terms.blocks).includes('Michigan'));
  const help = (await anon('/api/legal/help')).data;
  assert.match(JSON.stringify(help.blocks), /one business day/);
  assert.equal((await anon('/api/legal/cookies')).status, 404);
});

test('legal: three of four blanks is still a draft; the repo’s file is filled in and public', async () => {
  const { parse } = await import('../server/legal.mjs');
  const repo = parse(LEGAL);
  // Nov 16 (Tommy: "Fill it all in"): Mise Academy is a DBA of 12 Tribes Media LLC; Michigan law; support@miseacademy.app
  assert.deepEqual(repo.values, { company: '12 Tribes Media LLC', state: 'Michigan', supportEmail: 'support@miseacademy.app', date: 'November 16, 2026' });
  assert.deepEqual(Object.keys(repo.pages).sort(), ['help', 'privacy', 'terms']);
  assert.match(repo.pages.privacy.join(' '), /run by \[Company\], doing business as Mise Academy/);
  assert.match(repo.pages.terms.join(' '), /between \[Company\], doing business as Mise Academy, and/);
  const file = path.join(dirA, 'three.md');
  fs.writeFileSync(file, fill(LEGAL, { company: 'Testco LLC', state: 'Michigan', supportEmail: '', date: 'Today' }));
  process.env.LEGAL_FILE = file;
  const { legalState, legalPage } = await import('../server/legal.mjs');
  assert.deepEqual(legalState().missing, ['supportEmail']);
  assert.equal(legalPage('terms').draft, true);
  fs.writeFileSync(file, fill(LEGAL, { company: 'Testco LLC', state: 'Michigan', supportEmail: 'not-an-email', date: 'Today' }));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(legalState().filled, false, 'the support email has to be an email');
  delete process.env.LEGAL_FILE;
  // the repo's own file: every blank filled, so the pages are public, with no bracketed placeholders left
  assert.equal(legalState().filled, true);
  for (const kind of ['privacy', 'terms', 'help']) {
    const page = legalPage(kind);
    assert.equal(page.draft, false, kind);
    assert.ok(!/\[(Company|State|Support email|Date)\]/.test(JSON.stringify(page.blocks)), `${kind}: no placeholders`);
  }
  assert.ok(legalPage('terms').blocks.flatMap((b) => b.ol || []).flat().map((r) => r.t).join('').includes('Michigan law applies'));
});
