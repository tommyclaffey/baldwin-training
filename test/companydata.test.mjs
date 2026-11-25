// Company data (Nov 14): an owner downloads everything, or asks for it to be deleted; the super admin confirms. Real server,
// temp database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { turnOnTwoStep, giveAccount } from './helpers.mjs';
import { unzip, zip } from '../server/zip.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-cdata-'));
const PORT = 5700 + Math.floor(Math.random() * 250);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

function person(ip = '10.8.0.1') {
  let jar = '';
  const call = async (p, { method = 'GET', body, headers = {}, raw = false } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(jar ? { Cookie: jar } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
    const set = res.headers.getSetCookie().find((c) => c.startsWith('bt_session='));
    if (set && !/^bt_session=;/.test(set)) jar = set.split(';')[0];
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return call;
}
const openDb = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const download = async (who) => { const r = await who('/api/company/export', { raw: true }); return { status: r.status, type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), buf: Buffer.from(await r.arrayBuffer()) }; };
const take = async (who, quiz) => { const q = (await who('/api/quiz/start', { method: 'POST', body: { quiz } })).data; return who('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: q.items, answers: q.items.map((r) => q.questions[r].answer) } }); };

before(async () => {
  giveAccount(dir); server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@cd.test', SUPERADMIN_EMAIL: 'boss@cd.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const baldwin = person(), boss = person(), bea = person();
/** A company with an owner, a manager, a staff member who took a quiz, a chat message and an upload. */
async function company(name, slug) {
  const add = await boss('/api/super/companies', { method: 'POST', body: { name, ownerEmail: `owner@${slug}.test` } });
  assert.equal(add.status, 200);
  const owner = person(), manager = person(), staff = person();
  assert.equal((await owner(`/api/invite/${add.data.link.split('/').pop()}`, { method: 'POST', body: { name: `${name} Owner`, password: 'long-enough-2' } })).status, 200);
  const inv = await owner('/api/team/invite', { method: 'POST', body: { email: `gm@${slug}.test`, role: 'manager' } });
  assert.equal((await manager(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name: `${name} Manager`, password: 'long-enough-3' } })).status, 200);
  const code = (await owner('/api/team')).data.company.joinCode;
  assert.equal((await staff('/api/join', { method: 'POST', body: { code, name: `${name} Server`, email: `j${Math.random().toString(36).slice(2, 10)}@join.test`, password: 'join-pass-2468-x' } })).status, 200);
  const topic = (await staff('/api/quiz/catalog')).data.topics[0].key;
  const q = (await staff('/api/quiz/start', { method: 'POST', body: { topics: [topic], count: 5 } })).data;
  assert.equal((await staff('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: q.items, answers: q.items.map((r) => q.questions[r].answer) } })).status, 200);
  assert.equal((await owner('/api/chat/room/everyone/messages', { method: 'POST', body: { body: `Lineup at 4 · ${name}` } })).status, 200);
  const up = await owner('/api/media/upload', { method: 'POST', body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), headers: { 'Content-Type': 'video/mp4', 'X-Filename': `${slug}-lineup.mp4` } });
  assert.equal(up.status, 200);
  const cap = await owner(`/api/media/${up.data.id}/captions`, { method: 'PUT', body: new TextEncoder().encode('WEBVTT\n\n00:00.000 --> 00:01.000\nLineup\n'), headers: { 'Content-Type': 'text/plain', 'X-Filename': 'lineup.vtt' } });
  assert.equal(cap.status, 200);
  return { id: add.data.id, name, owner, manager, staff, file: up.data.url.slice(7), captions: cap.data.captions.slice(7) };
}
let harbor, copper;

test('setup: The Baldwin, the super admin, two more companies', async () => {
  assert.equal((await baldwin('/api/setup', { method: 'POST', body: { name: 'Bram Baldwin', email: 'owner@cd.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await boss('/api/setup', { method: 'POST', body: { name: 'Boss', email: 'boss@cd.test', password: 'long-enough-1' } })).status, 200);
  await turnOnTwoStep(boss);
  const code = (await baldwin('/api/team')).data.company.joinCode;
  assert.equal((await bea('/api/join', { method: 'POST', body: { code, name: 'Bea Baldwin', email: `j${Math.random().toString(36).slice(2, 10)}@join.test`, password: 'join-pass-1111-x', storeId: 1 } })).status, 200);
  assert.equal((await take(bea, 't:allergens')).status, 200);
  harbor = await company('Harbor Table', 'harbor');
  copper = await company('Copper Pot', 'copper');
});

test('the zip writer makes files any unzip tool opens', () => {
  const buf = zip([{ name: 'a.txt', data: 'hello' }, { name: 'raw/b.json', data: JSON.stringify({ x: 'é'.repeat(500) }) }]);
  const back = unzip(buf);
  assert.equal(back.get('a.txt').toString(), 'hello');
  assert.equal(JSON.parse(back.get('raw/b.json')).x.length, 500);
  const f = path.join(dir, 't.zip'); fs.writeFileSync(f, buf);
  const t = spawnSync('unzip', ['-t', f], { encoding: 'utf8' });
  if (!t.error) assert.equal(t.status, 0, t.stdout + t.stderr);
});

test('export: owners only', async () => {
  assert.equal((await download(harbor.staff)).status, 403, 'staff');
  assert.equal((await download(harbor.manager)).status, 403, 'a manager');
  assert.equal((await download(person())).status, 401, 'signed out');
  assert.equal((await download(boss)).status, 403, 'a super admin works through "sign in as"');
  assert.equal((await harbor.manager('/api/company/data')).status, 403);
  const ok = await download(harbor.owner);
  assert.equal(ok.status, 200);
  assert.equal(ok.type, 'application/zip');
  assert.match(ok.disp, /attachment; filename="mise-harbor-table-\d{4}-\d\d-\d\d\.zip"/);
});

test('export: only this company’s data, every part of it, and no secrets', async () => {
  const files = unzip((await download(harbor.owner)).buf);
  for (const f of ['README.txt', 'people.csv', 'quiz_results.csv', 'signoffs.csv', 'certificates.csv', 'chat_messages.csv', 'prep_items.csv', 'content.csv', 'uploads.csv', 'activity.csv', 'company.json', 'raw/users.json'])
    assert.ok(files.has(f), f);
  const people = files.get('people.csv').toString();
  assert.match(people, /Harbor Table Owner/); assert.match(people, /Harbor Table Manager/); assert.match(people, /Harbor Table Server/);
  assert.match(files.get('quiz_results.csv').toString(), /Harbor Table Server/);
  assert.match(files.get('chat_messages.csv').toString(), /Lineup at 4 · Harbor Table/);
  assert.match(files.get('uploads.csv').toString(), new RegExp(harbor.file));
  const all = [...files.values()].map((b) => b.toString()).join('\n');
  for (const other of ['Bea Baldwin', 'Bram Baldwin', 'Copper Pot', 'copper-lineup', 'Boss']) assert.ok(!all.includes(other), `nothing of ${other}`);
  for (const secret of ['password_hash', 'pin_hash', 'totp_secret', 'token_hash', 'scrypt$']) assert.ok(!all.includes(secret), `no ${secret}`);
  const ids = new Set(JSON.parse(files.get('raw/users.json')).map((u) => u.id));
  assert.equal(ids.size, 3);
  // logged in the company's Activity, and only there
  assert.ok((await harbor.owner('/api/audit')).data.audit.some((r) => r.action === 'export company data'));
  assert.ok(!(await baldwin('/api/audit')).data.audit.some((r) => r.action === 'export company data'));
  const page = (await harbor.owner('/api/company/data')).data;
  assert.equal(page.company.name, 'Harbor Table');
  assert.equal(page.counts.people, 3);
  assert.equal(page.lastExport.name, 'Harbor Table Owner');
});

test('delete: the owner asks (typing the name), the super admin confirms after 7 days or twice now', async () => {
  const ask = (who, confirm) => who('/api/company/delete-request', { method: 'POST', body: { confirm } });
  assert.equal((await ask(harbor.manager, 'Harbor Table')).status, 403, 'owners only');
  assert.equal((await ask(harbor.owner, 'Harbor')).status, 400, 'the whole name');
  const r = await ask(harbor.owner, '  harbor table ');
  assert.equal(r.status, 200);
  assert.equal(r.data.request.status, 'pending');
  assert.equal(r.data.request.daysLeft, 7);
  assert.equal((await ask(harbor.owner, 'Harbor Table')).status, 409, 'one at a time');
  assert.equal((await harbor.owner('/api/company/data')).data.request.status, 'pending');
  // nothing is gone yet
  assert.equal((await harbor.staff('/api/me')).data.user.name, 'Harbor Table Server');
  // the owner can take it back, and ask again
  assert.equal((await harbor.owner('/api/company/delete-request', { method: 'DELETE' })).status, 200);
  assert.equal((await harbor.owner('/api/company/data')).data.request, null);
  assert.equal((await ask(harbor.owner, 'Harbor Table')).status, 200);

  // the super admin side
  assert.equal((await harbor.owner('/api/super/deletions')).status, 404, 'hidden from owners');
  const list = (await boss('/api/super/deletions')).data.requests;
  const req = list.find((x) => x.companyId === harbor.id && x.status === 'pending');
  assert.ok(req);
  assert.equal(req.requestedBy, 'Harbor Table Owner');
  assert.ok(list.some((x) => x.companyId === harbor.id && x.status === 'cancelled'));
  const confirm = (body) => boss(`/api/super/deletions/${req.id}/confirm`, { method: 'POST', body });
  assert.equal((await confirm({ confirm: 'Harbor Table' })).status, 400, 'before 7 days it needs the second confirmation');
  assert.equal((await confirm({ confirm: 'Harbor Table', now: true, confirmNow: 'yes' })).status, 400);
  assert.equal((await confirm({ confirm: 'Copper Pot', now: true, confirmNow: 'delete now' })).status, 400, 'the right company name');
  assert.ok(fs.existsSync(path.join(dir, 'media', harbor.file)));
  const done = await confirm({ confirm: 'Harbor Table', now: true, confirmNow: 'Delete now' });
  assert.equal(done.status, 200);
  assert.equal(done.data.removed.users, 3);
  assert.equal(done.data.removed.files, 2, 'the video and its captions');
  assert.equal((await confirm({ confirm: 'Harbor Table', now: true, confirmNow: 'delete now' })).status, 409, 'done once');

  // Harbor Table is gone: people signed out, no rows anywhere, its file removed
  assert.equal((await harbor.owner('/api/me')).data.user, null);
  assert.equal((await harbor.staff('/api/me')).data.user, null);
  assert.ok(!fs.existsSync(path.join(dir, 'media', harbor.file)));
  assert.ok(!fs.existsSync(path.join(dir, 'media', harbor.captions)), 'its captions file too');
  const db = openDb();
  try {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM companies WHERE id = ?').get(harbor.id).n, 0);
    const users = db.prepare("SELECT id FROM users WHERE name LIKE 'Harbor Table%'").all();
    assert.equal(users.length, 0);
    for (const { name: t } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('company_deletions')").all()) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      if (cols.includes('company_id')) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE company_id = ?`).get(harbor.id).n, 0, t);
    }
    // the request stays as the record of what happened
    const rec = db.prepare('SELECT * FROM company_deletions WHERE id = ?').get(req.id);
    assert.equal(rec.status, 'done'); assert.equal(rec.early, 1);
    // everyone else is untouched
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE name LIKE 'Copper Pot%'").get().n, 3);
    assert.ok(db.prepare("SELECT COUNT(*) n FROM quiz_attempts WHERE name = 'Bea Baldwin'").get().n > 0);
    assert.ok(db.prepare("SELECT COUNT(*) n FROM entries WHERE collection = 'classic'").get().n > 50, 'the shared library (HQ’s since Nov 19)');
  } finally { db.close(); }
  assert.ok(fs.existsSync(path.join(dir, 'media', copper.file)));
  assert.equal((await copper.staff('/api/me')).data.user.name, 'Copper Pot Server');
  assert.ok((await boss('/api/super/log')).data.log.some((l) => l.action === 'delete company data' && /Harbor Table/.test(l.detail)));
});

test('delete: after the 7 days, typing the name is enough; the super admin can also decline', async () => {
  assert.equal((await copper.owner('/api/company/delete-request', { method: 'POST', body: { confirm: 'Copper Pot' } })).status, 200);
  let req = (await boss('/api/super/deletions')).data.requests.find((x) => x.companyId === copper.id && x.status === 'pending');
  assert.equal((await boss(`/api/super/deletions/${req.id}/cancel`, { method: 'POST' })).status, 200);
  assert.equal((await copper.owner('/api/company/data')).data.request, null);
  assert.equal((await copper.owner('/api/company/data')).data.lastCancelled.closedBy, 'Boss');
  assert.equal((await copper.owner('/api/company/delete-request', { method: 'POST', body: { confirm: 'Copper Pot' } })).status, 200);
  req = (await boss('/api/super/deletions')).data.requests.find((x) => x.companyId === copper.id && x.status === 'pending');
  const db = openDb();
  db.prepare('UPDATE company_deletions SET ends_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), req.id);
  db.close();
  assert.equal((await boss('/api/super/deletions')).data.requests.find((x) => x.id === req.id).ready, true);
  const done = await boss(`/api/super/deletions/${req.id}/confirm`, { method: 'POST', body: { confirm: 'Copper Pot' } });
  assert.equal(done.status, 200);
  assert.equal((await copper.owner('/api/me')).data.user, null);
});

test('The Baldwin is a customer like any other (Nov 19): its deletion waits the 7 days, it isn’t blocked as the library', async () => {
  assert.equal((await baldwin('/api/company/delete-request', { method: 'POST', body: { confirm: 'Baldwin Restaurant Group' } })).status, 200);
  const req = (await boss('/api/super/deletions')).data.requests.find((x) => x.companyId === 1 && x.status === 'pending');
  assert.ok(!req.byHand, 'no longer "deleted by hand"');
  const r = await boss(`/api/super/deletions/${req.id}/confirm`, { method: 'POST', body: { confirm: 'Baldwin Restaurant Group' } });
  assert.notEqual(r.status, 200, 'not before the 7 days');
  assert.doesNotMatch(r.data.error || '', /shared library/);
  assert.equal((await bea('/api/me')).data.user.name, 'Bea Baldwin');
  assert.equal((await baldwin('/api/company/delete-request', { method: 'DELETE' })).status, 200);
});

test('demo: export works on the demo’s own data; delete is switched off', async () => {
  const demo = person('10.8.9.9');
  assert.equal((await demo('/api/demo/start', { method: 'POST', body: { role: 'manager' } })).status, 200);
  const page = await demo('/api/company/data');
  assert.equal(page.status, 200);
  assert.equal(page.data.demo, true);
  const files = unzip((await download(demo)).buf);
  const all = [...files.values()].map((b) => b.toString()).join('\n');
  assert.match(files.get('people.csv').toString(), /Rosalind Hart/);
  assert.ok(!all.includes('Bea Baldwin') && !all.includes('Bram Baldwin'), 'nothing of the real Baldwin team');
  const del = await demo('/api/company/delete-request', { method: 'POST', body: { confirm: 'Baldwin Restaurant Group' } });
  assert.equal(del.status, 403);
  assert.match(del.data.error, /switched off in the demo/);
  const staff = person('10.8.9.10');
  await staff('/api/demo/start', { method: 'POST', body: { role: 'employee' } });
  assert.equal((await download(staff)).status, 403, 'the demo employee can’t');
});

test('a company deleted by the super admin is fully removed after its 30 days (it used to leave pages, uploads and prep behind)', async () => {
  const slate = await company('Slate Room', 'slate');
  assert.equal((await slate.owner('/api/entries', { method: 'POST', body: { collection: 'recipe', data: { name: 'Slate Burger', course: 'Entrees' } } })).status, 200);
  assert.equal((await boss(`/api/super/companies/${slate.id}`, { method: 'DELETE', body: { confirm: 'Slate Room' } })).status, 200);
  const db = openDb();
  try {
    db.prepare('UPDATE companies SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - 31 * 864e5).toISOString(), slate.id);
    // the 12-hourly sweep, run on this database (its own process, so its media folder is this test's)
    const sweep = spawnSync(process.execPath, ['--input-type=module', '-e', `import { DatabaseSync } from 'node:sqlite'; import { purgeDeleted } from './server/accounts.mjs';
      purgeDeleted(new DatabaseSync(${JSON.stringify(path.join(dir, 'baldwin.db'))}));`], { cwd: root, env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
    assert.equal(sweep.status, 0, sweep.stderr);
    for (const t of ['entries', 'media', 'quiz_attempts', 'chat_messages', 'users', 'stores']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE company_id = ?`).get(slate.id).n, 0, t);
    assert.ok(db.prepare('SELECT COUNT(*) n FROM users WHERE company_id = 1').get().n >= 2, 'The Baldwin is untouched');
  } finally { db.close(); }
  assert.ok(!fs.existsSync(path.join(dir, 'media', slate.file)));
});
