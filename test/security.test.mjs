// Security review (Nov 14): each test here failed before its fix. Runs the real server on a temp database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { totpAt } from '../server/auth.mjs';
import { giveAccount, addPinStaff } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-sec-'));
const PORT = 5400 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

/** A person with their own cookie jar. `ip` sets X-Forwarded-For. */
function person(ip = '10.1.0.1') {
  let jar = '';
  const call = async (p, { method = 'GET', body, headers = {}, raw = false } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(jar ? { Cookie: jar } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.().find((c) => c.startsWith('bt_session=')) || res.headers.get('set-cookie');
    if (set && !/^bt_session=;/.test(set)) jar = set.split(';')[0];
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  call.cookie = () => jar;
  return call;
}
const code = (secret) => totpAt(secret, Math.floor(Date.now() / 30000));
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));

before(async () => {
  giveAccount(dir); server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@sec.test', SUPERADMIN_EMAIL: 'boss@sec.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = person(), boss = person();
let bossSecret = '';

test('first accounts', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Odile Owner', email: 'owner@sec.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await boss('/api/setup', { method: 'POST', body: { name: 'Boss', email: 'boss@sec.test', password: 'long-enough-1' } })).status, 200);
  bossSecret = (await boss('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await boss('/api/2fa/enable', { method: 'POST', body: { code: code(bossSecret) } })).status, 200);
});

test('every write needs the X-BT header, sign-in included (no login or logout from another site)', async () => {
  const bare = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }).then((r) => r.status);
  assert.equal(await bare('/api/login', { email: 'owner@sec.test', password: 'long-enough-1' }), 403, 'login');
  assert.equal(await bare('/api/login/code', { ticket: 'x', code: '123456' }), 403, 'two-step code');
  assert.equal(await bare('/api/setup', { name: 'X', email: 'x@sec.test', password: 'long-enough-1' }), 403, 'setup');
  assert.equal(await bare('/api/invite/abc', { name: 'X', password: 'long-enough-1' }), 403, 'invite');
  const out = await fetch(BASE + '/api/logout', { method: 'POST', headers: { Cookie: owner.cookie() } });
  assert.equal(out.status, 403, 'logout');
  assert.equal((await owner('/api/me')).data.user.name, 'Odile Owner', 'still signed in');
});

test('per-address limits use the address the proxy saw, not one the browser made up', async () => {
  const tries = [];
  for (let i = 0; i < 9; i++) {
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': `198.18.${i}.${i}, 203.0.113.7` },
      body: JSON.stringify({ email: 'nobody@sec.test', password: 'wrong-password' }) });
    tries.push(r.status);
  }
  assert.deepEqual(tries.slice(0, 8), Array(8).fill(401));
  assert.equal(tries[8], 429, 'the 9th try from the same real address is stopped');
});

test('Set Up Your Sign-In counts wrong join codes like the join screen does', async () => {
  const s = [];
  for (let i = 0; i < 31; i++) {
    const r = await fetch(BASE + '/api/set-up/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': '198.51.100.9' },
      body: JSON.stringify({ code: 'ZZZZ' + String(i).padStart(4, '2'), id: 1, pin: '1234' }) });
    s.push(r.status);
  }
  assert.equal(s[0], 404);
  assert.equal(s[30], 429, 'guessing join codes is limited');
});

test('staff PINs (Set Up Your Sign-In): no more than 15 wrong a day, even spread out', async () => {
  const joinCode = (await owner('/api/team')).data.company.joinCode;
  const id = await addPinStaff(dir, { name: 'Pat Pinero', pin: '4321' }); // joined with a PIN, before Nov 25
  // 15 wrong PINs over the last day, none in the last 15 minutes
  const d = db();
  const ins = d.prepare('INSERT INTO limits(name, key, at) VALUES (?,?,?)');
  for (let i = 0; i < 15; i++) ins.run('pin-day', 'pin|' + id, Date.now() - (2 + i) * 3600e3);
  d.close();
  const r = await person('10.2.0.3')('/api/set-up/check', { method: 'POST', body: { code: joinCode, id, pin: '4321' } });
  assert.equal(r.status, 429, 'locked for the day');
  // a manager's PIN reset clears it, and the person goes on to their email and password without one
  assert.equal((await owner(`/api/team/${id}/reset-pin`, { method: 'POST' })).status, 200);
  assert.equal((await person('10.2.0.3')('/api/set-up/check', { method: 'POST', body: { code: joinCode, id } })).status, 200);
});

test('a demo can’t change the real book’s wine videos', async () => {
  const demo = person('10.3.0.3');
  assert.equal((await demo('/api/demo/start', { method: 'POST', body: { role: 'manager' } })).status, 200);
  const groups = (await demo('/api/wine-videos')).data.groups;
  const ours = groups.find((g) => g.label === 'Wines on our list');
  assert.ok(ours?.items.length, 'the Baldwin demo shows its wine list');
  const key = ours.items[0].key;
  const before = (await owner('/api/wine-videos')).data.groups.flatMap((g) => g.items).find((it) => it.key === key).video;
  const put = await demo('/api/wine-videos', { method: 'PUT', body: { key, video: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' }, note: 'defaced' } });
  assert.equal(put.status, 403);
  const after = (await owner('/api/wine-videos')).data.groups.flatMap((g) => g.items).find((it) => it.key === key);
  assert.deepEqual(after.video, before, 'The Baldwin’s wine page is unchanged');
  assert.notEqual(after.note, 'defaced');
});

test('the activity log shows only your own company (another company’s uploads stayed out)', async () => {
  const demo = person('10.3.0.4');
  await demo('/api/demo/start', { method: 'POST', body: { role: 'manager' } });
  assert.equal((await demo('/api/media/youtube', { method: 'POST', body: { url: 'https://youtu.be/LeakTest123', title: 'Demo clip' } })).status, 200);
  const ownerLog = (await owner('/api/audit')).data.audit;
  assert.ok(!ownerLog.some((r) => r.detail === 'LeakTest123'), 'a demo’s upload isn’t in The Baldwin’s log');
  // Old rows saved before companies were recorded still show for their own company's people.
  const d = db();
  const me = d.prepare("SELECT id FROM users WHERE email = 'owner@sec.test'").get().id;
  d.prepare("INSERT INTO audit(user_id, action, detail, at) VALUES (?, 'upload', 'old-row.jpg', ?)").run(me, new Date().toISOString());
  d.close();
  assert.ok((await owner('/api/audit')).data.audit.some((r) => r.detail === 'old-row.jpg'));
  // The owner's own uploads are logged to The Baldwin
  await owner('/api/media/youtube', { method: 'POST', body: { url: 'https://youtu.be/OwnClip1234', title: 'Own clip' } });
  assert.ok((await owner('/api/audit')).data.audit.some((r) => r.detail === 'OwnClip1234'));
});

test('uploaded files need a sign-in', async () => {
  const up = await owner('/api/media/upload', { method: 'POST', body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), headers: { 'Content-Type': 'video/mp4', 'X-Filename': 'lineup.mp4' } });
  assert.equal(up.status, 200);
  assert.equal((await fetch(BASE + up.data.url)).status, 404, 'not public');
  const mine = await fetch(BASE + up.data.url, { headers: { Cookie: owner.cookie() } });
  assert.equal(mine.status, 200);
  assert.match(mine.headers.get('cache-control'), /private/);
});

test('another company’s upload doesn’t open for a demo visitor, unless it’s in the shared library (Nov 19)', async () => {
  const up = await owner('/api/media/upload', { method: 'POST', body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), headers: { 'Content-Type': 'video/mp4', 'X-Filename': 'private-clip.mp4' } });
  assert.equal(up.status, 200);
  const demo = person('10.3.0.9');
  assert.equal((await demo('/api/demo/start', { method: 'POST', body: { role: 'manager' } })).status, 200);
  assert.equal((await fetch(BASE + up.data.url, { headers: { Cookie: demo.cookie() } })).status, 404, 'a demo can’t open The Baldwin’s upload');
  assert.equal((await fetch(BASE + up.data.url, { headers: { Cookie: owner.cookie() } })).status, 200, 'the owner still can');
  // The demo's own upload opens for the demo
  const mine = await demo('/api/media/upload', { method: 'POST', body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), headers: { 'Content-Type': 'video/mp4', 'X-Filename': 'demo-clip.mp4' } });
  if (mine.status === 200) assert.equal((await fetch(BASE + mine.data.url, { headers: { Cookie: demo.cookie() } })).status, 200);
  // Named by a shared collection's entry (a classic's video): every company sees it
  const d = db();
  const row = d.prepare("SELECT id, data FROM entries WHERE collection = 'classic' LIMIT 1").get();
  if (row) {
    const data = JSON.parse(row.data); data.leakTestVideo = up.data.url;
    d.prepare('UPDATE entries SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
    d.close();
    assert.equal((await fetch(BASE + up.data.url, { headers: { Cookie: demo.cookie() } })).status, 200, 'shared library files open for everyone signed in');
  } else d.close();
});

test('a super admin without two-step can’t open any company’s data', async () => {
  const link = (await boss('/api/super/admins/invite', { method: 'POST', body: { email: 'mate@sec.test' } })).data.link;
  const mate = person('10.4.0.4');
  assert.equal((await mate(`/api/invite/${link.split('/').pop()}`, { method: 'POST', body: { name: 'Mate', password: 'long-enough-2' } })).status, 200);
  assert.equal((await mate('/api/me')).status, 200, 'their own account works');
  assert.equal((await mate('/api/team')).status, 403, 'The Baldwin’s people');
  assert.equal((await mate('/api/quiz/results')).status, 403, 'quiz results');
  assert.equal((await mate('/api/store', { method: 'POST', body: { storeId: 1 } })).status, 403, 'switching stores');
  // Turning it on opens everything
  const secret = (await mate('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await mate('/api/2fa/enable', { method: 'POST', body: { code: code(secret) } })).status, 200);
  assert.equal((await mate('/api/team')).status, 200);
});

test('two-step codes: 10 wrong in 15 minutes locks the account, however many sign-ins they come from', async () => {
  const fresh = person('10.5.0.5');
  for (let round = 0; round < 2; round++) {
    const t = (await fresh('/api/login', { method: 'POST', body: { email: 'boss@sec.test', password: 'long-enough-1' } })).data.ticket;
    for (let i = 0; i < 5; i++) assert.equal((await fresh('/api/login/code', { method: 'POST', body: { ticket: t, code: String(100000 + round * 10 + i) } })).status, 401);
  }
  const t = (await fresh('/api/login', { method: 'POST', body: { email: 'boss@sec.test', password: 'long-enough-1' } })).data.ticket;
  assert.equal((await fresh('/api/login/code', { method: 'POST', body: { ticket: t, code: code(bossSecret) } })).status, 429, 'even the right code waits');
});
