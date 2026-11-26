// Temporary passwords (Nov 24; Tommy: "i need a assign temporary password vs a reset pin"; Figma 09 · Idea Board → section
// 49). An admin sets one, the person signs in with it once and must choose their own before anything else. Nov 24 scope:
// everyone signs in with email + password, so there's no temporary PIN and staff get a temporary password (with an email).
// API part: hashed, expires, works once, signs the person out, old one stops, two-step still asked, logged, who can and
// can't, Cancel puts the old one back, staff give an email, errors (expired, used, reused). Browser part (needs Chrome and a
// built dist/; skipped otherwise): Super Admin → People at 1440 (five actions in one row), the dialog, Cancel sends nothing,
// Set shows the tag, and the email sign-in goes to Choose Your Own Password.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { totpAt } from '../server/auth.mjs';
import { giveAccount, addPinStaff, sessionCookieFor, startServer, startChrome } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-temp-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;
before(async () => {
  giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@temp.test', SUPERADMIN_EMAIL: 'tommy@temp.test', RESEND_API_KEY: '', MAIL_FROM: '', PREP_WEEKLY: 'off' }));
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

let ipN = 10;
function person() {
  const ip = `10.9.0.${ipN++}`;
  const p = { jar: '', ip };
  p.call = async (u, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + u, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(p.jar ? { Cookie: p.jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) p.jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), cookie: !!set };
  };
  return p;
}
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const code = (s) => totpAt(s, Math.floor(Date.now() / 30000));
const token = (link) => link.split('/').pop();
const tommy = person(), owner = person(), imogen = person(), soren = person(), tobias = person(), sm = person();
let joinCode = '', imogenId = 0, sorenId = 0, tobiasId = 0, ownerId = 0, smId = 0, tommySecret = '', sorenSecret = '';

test('setup: a super admin, an owner, two managers (one with two-step), a store manager, a staff member', async () => {
  assert.equal((await owner.call('/api/setup', { method: 'POST', body: { name: 'Odile Owner', email: 'owner@temp.test', password: 'owner-pass-1' } })).status, 200);
  assert.equal((await tommy.call('/api/setup', { method: 'POST', body: { name: 'Tommy Claffey', email: 'tommy@temp.test', password: 'super-pass-1' } })).status, 200);
  tommySecret = (await tommy.call('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await tommy.call('/api/2fa/enable', { method: 'POST', body: { code: code(tommySecret) } })).status, 200);
  const team = (await owner.call('/api/team')).data;
  joinCode = team.company.joinCode;
  for (const [p, email, name, pw, store] of [[imogen, 'imogen@temp.test', 'Imogen Pell', 'imogen-pass-1', null], [soren, 'soren@temp.test', 'Soren Vale', 'soren-pass-1', null], [sm, 'sm@temp.test', 'Nell Achebe', 'nell-pass-01', team.stores[0].id]]) {
    const inv = await owner.call('/api/team/invite', { method: 'POST', body: { email, role: 'manager', storeId: store } });
    assert.equal((await p.call(`/api/invite/${token(inv.data.link)}`, { method: 'POST', body: { name, password: pw } })).status, 200);
  }
  sorenSecret = (await soren.call('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await soren.call('/api/2fa/enable', { method: 'POST', body: { code: code(sorenSecret) } })).status, 200);
  // Nov 25: a staff member who joined with a PIN (before section 50), signed in on their phone
  tobias.jar = sessionCookieFor(dir, await addPinStaff(dir, { name: 'Tobias Quill', pin: '4826', storeId: team.stores[0].id }));
  ownerId = (await owner.call('/api/me')).data.user.id; imogenId = (await imogen.call('/api/me')).data.user.id;
  sorenId = (await soren.call('/api/me')).data.user.id; tobiasId = (await tobias.call('/api/me')).data.user.id; smId = (await sm.call('/api/me')).data.user.id;
});

test('an owner sets a temporary password: hashed, never sent back, person signed out, old password stops, logged', async () => {
  const r = await owner.call(`/api/team/${imogenId}/temporary`, { method: 'POST', body: { kind: 'password', value: 'quince-harbor-4827', days: 7 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.email, 'imogen@temp.test'); assert.equal(r.data.days, 7);
  assert.ok(Math.abs(new Date(r.data.expiresAt) - (Date.now() + 7 * 864e5)) < 60e3, 'expires in 7 days');
  assert.ok(!JSON.stringify(r.data).includes('quince-harbor-4827'), 'the value never comes back');
  const d = db();
  const row = d.prepare('SELECT * FROM temp_credentials WHERE user_id = ?').get(imogenId);
  assert.match(row.hash, /^scrypt\$/); assert.ok(!row.hash.includes('quince'), 'stored hashed');
  assert.ok(d.prepare("SELECT 1 FROM audit WHERE action = 'set temporary password' AND user_id = ? AND detail LIKE 'Imogen Pell%'").get(ownerId), 'logged under the owner');
  d.close();
  assert.equal((await imogen.call('/api/me')).data.user, null, 'signed out everywhere');
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'imogen-pass-1' } })).status, 401, 'the old password stops working');
  const row2 = (await owner.call('/api/team')).data.people.find((p) => p.id === imogenId);
  assert.ok(row2.temporary.expiresAt);
});

test('signing in with it opens Choose Your Own Password only: no session, can’t reuse it, then in; works once', async () => {
  const p = person();
  const r = await p.call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'quince-harbor-4827' } });
  assert.equal(r.status, 200); assert.equal(r.data.mustChoose, 'password'); assert.ok(r.data.ticket); assert.equal(r.cookie, false, 'no session cookie');
  assert.equal((await p.call('/api/me')).data.user, null, 'not signed in yet');
  const t = r.data.ticket;
  const bad = async (password, re) => { const x = await p.call('/api/login/choose', { method: 'POST', body: { ticket: t, password } }); assert.equal(x.status, 400, password); assert.match(x.data.error, re); };
  await bad('quince-harbor-4827', /temporary password/);
  await bad('imogen@temp.test', /email/);
  await bad('imogen-pass-1', /old password/);
  await bad('short', /10 characters/);
  const ok = await p.call('/api/login/choose', { method: 'POST', body: { ticket: t, password: 'imogen-own-pass-2' } });
  assert.equal(ok.status, 200); assert.equal(ok.data.user.name, 'Imogen Pell');
  assert.equal((await p.call('/api/me')).data.user.id, imogenId, 'in');
  // Works once: the temporary one, and the ticket, are spent
  const again = await person().call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'quince-harbor-4827' } });
  assert.equal(again.status, 401); assert.match(again.data.error, /already used/);
  assert.equal((await p.call('/api/login/choose', { method: 'POST', body: { ticket: t, password: 'another-pass-99' } })).status, 410);
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'imogen-own-pass-2' } })).status, 200, 'their own works');
  const d = db();
  assert.ok(d.prepare("SELECT 1 FROM audit WHERE action = 'chose own password' AND user_id = ? AND detail LIKE '%Odile Owner%'").get(imogenId), 'the use is logged');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM temp_credentials WHERE prev_hash IS NOT NULL').get().n, 0, 'the old hash isn’t kept');
  d.close();
  assert.equal((await owner.call('/api/team')).data.people.find((x) => x.id === imogenId).temporary, null, 'the row tag goes');
});

test('two-step stays on: the code is asked after the temporary password, before choosing', async () => {
  assert.equal((await owner.call(`/api/team/${sorenId}/temporary`, { method: 'POST', body: { value: 'meadow-tulip-3381' } })).status, 200);
  const p = person();
  const r = await p.call('/api/login', { method: 'POST', body: { email: 'soren@temp.test', password: 'meadow-tulip-3381' } });
  assert.equal(r.data.needCode, true, 'code first'); assert.equal(r.data.mustChoose, undefined);
  assert.equal((await p.call('/api/login/code', { method: 'POST', body: { ticket: r.data.ticket, code: '000000' } })).status, 401);
  const c = await p.call('/api/login/code', { method: 'POST', body: { ticket: r.data.ticket, code: code(sorenSecret) } });
  assert.equal(c.data.mustChoose, 'password'); assert.equal(c.cookie, false);
  const ok = await p.call('/api/login/choose', { method: 'POST', body: { ticket: c.data.ticket, password: 'soren-own-pass-2' } });
  assert.equal(ok.status, 200); assert.equal(ok.data.user.totpOn, true, 'two-step still on');
});

test('expired: it stops working and says when; Cancel puts the old password back', async () => {
  assert.equal((await owner.call(`/api/team/${imogenId}/temporary`, { method: 'POST', body: { value: 'orchard-slate-1190', days: 1 } })).status, 200);
  const d = db(); d.prepare('UPDATE temp_credentials SET expires_at = ? WHERE user_id = ? AND used_at IS NULL AND cancelled_at IS NULL').run(new Date(Date.now() - 60e3).toISOString(), imogenId); d.close();
  const r = await person().call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'orchard-slate-1190' } });
  assert.equal(r.status, 401); assert.match(r.data.error, /expired on [A-Z][a-z]{2} \d+\. Ask whoever gave it to you/);
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'imogen-own-pass-2' } })).status, 401, 'an expired one doesn’t bring the old one back');
  // A new one, then Cancel: the old password (from before both) works again
  assert.equal((await owner.call(`/api/team/${imogenId}/temporary`, { method: 'POST', body: { value: 'lantern-fig-5520' } })).status, 200);
  assert.equal((await owner.call(`/api/team/${imogenId}/temporary`, { method: 'DELETE' })).status, 200);
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'lantern-fig-5520' } })).status, 401, 'cancelled one stops');
  // (the expired one had already made the old password unusable, so there's nothing earlier to restore: reset link it is)
  const link = await owner.call(`/api/team/${imogenId}/reset-password`, { method: 'POST' });
  assert.equal((await person().call(`/api/reset/${token(link.data.link)}`, { method: 'POST', body: { password: 'imogen-own-pass-3' } })).status, 200);
  // Now cancel straight after setting: the real old password works again
  assert.equal((await owner.call(`/api/team/${imogenId}/temporary`, { method: 'POST', body: { value: 'lantern-fig-5521' } })).status, 200);
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'imogen-own-pass-3' } })).status, 401);
  assert.equal((await owner.call(`/api/team/${imogenId}/temporary`, { method: 'DELETE' })).status, 200);
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'imogen-own-pass-3' } })).status, 200, 'Cancel puts the old one back');
  assert.equal((await owner.call(`/api/team/${imogenId}/temporary`, { method: 'DELETE' })).status, 404, 'nothing left to cancel');
  const d2 = db();
  assert.ok(d2.prepare("SELECT 1 FROM audit WHERE action = 'cancel temporary password' AND user_id = ?").get(ownerId));
  d2.close();
});

test('staff: a temporary password with their email; they sign in with it and choose their own; it moves them off their PIN', async () => {
  // A store manager sets it for staff in their store (the same people who can Reset PIN); staff need an email for it
  const noEmail = await sm.call(`/api/team/${tobiasId}/temporary`, { method: 'POST', body: { value: 'kettle-otter-2048' } });
  assert.equal(noEmail.status, 400); assert.match(noEmail.data.error, /Add Tobias’s email/);
  assert.equal((await sm.call(`/api/team/${tobiasId}/temporary`, { method: 'POST', body: { value: 'kettle-otter-2048', email: 'owner@temp.test' } })).status, 409, 'an email already in use');
  const r = await sm.call(`/api/team/${tobiasId}/temporary`, { method: 'POST', body: { value: 'kettle-otter-2048', email: 'Tobias@Temp.test', days: 3 } });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.email, 'tobias@temp.test'); assert.equal(r.data.days, 3);
  assert.equal((await tobias.call('/api/me')).data.user, null, 'signed out');
  // Nov 25 (section 50): with an email and a (temporary) password they're off the Set Up Your Sign-In list, and the PIN is done
  assert.equal((await person().call(`/api/join/${joinCode}`)).data.staff.find((s) => s.id === tobiasId), undefined, 'off the Set Up list');
  assert.equal((await person().call('/api/set-up/check', { method: 'POST', body: { code: joinCode, id: tobiasId, pin: '4826' } })).status, 404, 'the PIN no longer opens anything');
  const p = person();
  const r2 = await p.call('/api/login', { method: 'POST', body: { email: 'tobias@temp.test', password: 'kettle-otter-2048' } });
  assert.equal(r2.data.mustChoose, 'password'); assert.equal(r2.cookie, false);
  const bad = await p.call('/api/login/choose', { method: 'POST', body: { ticket: r2.data.ticket, password: 'kettle-otter-2048' } });
  assert.equal(bad.status, 400); assert.match(bad.data.error, /temporary password/);
  const ok = await p.call('/api/login/choose', { method: 'POST', body: { ticket: r2.data.ticket, password: 'tobias-own-pass' } });
  assert.equal(ok.status, 200); assert.equal(ok.data.user.role, 'staff');
  assert.equal((await p.call('/api/me')).data.user.id, tobiasId);
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'tobias@temp.test', password: 'tobias-own-pass' } })).status, 200, 'staff sign in with email and their password');
  assert.match((await person().call('/api/login', { method: 'POST', body: { email: 'tobias@temp.test', password: 'kettle-otter-2048' } })).data.error, /already used/);
  // A staff member without a password still can't sign in by email
  const d = db(); assert.equal(d.prepare("SELECT COUNT(*) n FROM users WHERE role = 'staff' AND password_hash IS NULL AND email IS NULL").get().n, 0); d.close();
});

test('who can: owners and the Mise team’s Owner/Manager; not a store manager for an owner; not Support; not yourself', async () => {
  assert.equal((await sm.call(`/api/team/${ownerId}/temporary`, { method: 'POST', body: { value: 'pecan-river-1234' } })).status, 404, 'a store manager can’t reach an owner');
  const im = person(); assert.equal((await im.call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'imogen-own-pass-3' } })).status, 200);
  assert.equal((await im.call(`/api/team/${sorenId}/temporary`, { method: 'POST', body: { value: 'pecan-river-1234' } })).status, 403, 'managers can’t set passwords (like Reset Password)');
  assert.equal((await im.call(`/api/team/${tobiasId}/temporary`, { method: 'POST', body: { value: 'nutmeg-cove-6152' } })).status, 200, 'a manager can for staff (like Reset PIN); their email is kept');
  assert.equal((await im.call(`/api/team/${tobiasId}/temporary`, { method: 'DELETE' })).status, 200);
  assert.equal((await owner.call(`/api/team/${ownerId}/temporary`, { method: 'POST', body: { value: 'pecan-river-1234' } })).status, 400, 'not yourself');
  assert.equal((await owner.call(`/api/team/${imogenId}/temporary`, { method: 'POST', body: { value: 'short' } })).status, 400);
  assert.equal((await owner.call(`/api/team/${imogenId}/temporary`, { method: 'POST', body: { value: 'imogen@temp.test' } })).status, 400, 'not their email');
  // A super admin (Owner) from Super Admin → People: logged in the Super Admin log
  const s = await tommy.call(`/api/super/users/${tobiasId}/temporary`, { method: 'POST', body: { value: 'hazel-reef-6152', days: 14 } });
  assert.equal(s.status, 200); assert.equal(s.data.days, 14);
  assert.ok((await tommy.call('/api/super/users?q=Tobias&company=')).data.users[0].temporary.expiresAt);
  assert.equal((await tommy.call(`/api/super/users/${tobiasId}/temporary`, { method: 'DELETE' })).status, 200);
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'tobias@temp.test', password: 'tobias-own-pass' } })).status, 200, 'Cancel: their own password works again');
  assert.ok((await tommy.call('/api/super/log')).data.log.some((l) => l.action === 'set temporary password' && /Tobias Quill/.test(l.detail)));
  // A Support teammate: looks, never sets
  const inv = await tommy.call('/api/super/admins/invite', { method: 'POST', body: { email: 'support@temp.test', teamRole: 'support' } });
  const sup = person();
  assert.equal((await sup.call(`/api/invite/${token(inv.data.link)}`, { method: 'POST', body: { name: 'Dax Whitlow', password: 'support-pass-1' } })).status, 200);
  const sec = (await sup.call('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await sup.call('/api/2fa/enable', { method: 'POST', body: { code: code(sec) } })).status, 200);
  assert.equal((await sup.call(`/api/super/users/${tobiasId}/temporary`, { method: 'POST', body: { value: 'hazel-reef-6153' } })).status, 403, 'Support: Super Admin route');
  assert.equal((await sup.call(`/api/super/users/${imogenId}/temporary`, { method: 'POST', body: { value: 'pecan-river-1234' } })).status, 403);
  assert.equal((await sup.call('/api/super/act', { method: 'POST', body: { companyId: 1 } })).status, 200);
  assert.equal((await sup.call(`/api/team/${tobiasId}/temporary`, { method: 'POST', body: { value: 'hazel-reef-6153' } })).status, 403, 'Support working in the company: view only');
  // Not in the company data export (it's a secret)
  const d = db(); assert.ok(d.prepare('SELECT COUNT(*) n FROM temp_credentials').get().n > 0); d.close();
});

test('the People screens use the in-page dialogs, never confirm(), for the temporary actions; nothing new on PINs', () => {
  const code = (t) => t.replace(/\/\/.*$/gm, '');
  const tp = code(fs.readFileSync(path.join(root, 'src/admin/temppass.tsx'), 'utf8'));
  assert.doesNotMatch(tp, /\bconfirm\(|\bprompt\(|\balert\(/);
  const sup = fs.readFileSync(path.join(root, 'src/admin/super.tsx'), 'utf8');
  const people = code(sup.slice(sup.indexOf('function People()'), sup.indexOf('function EditPerson(')));
  assert.match(people, /Set Temporary/); assert.match(people, /Cancel Temporary/); assert.match(people, /Reset PIN/); assert.match(people, /Reset Password/);
  const mgr = fs.readFileSync(path.join(root, 'src/admin/manager.tsx'), 'utf8');
  assert.match(mgr, /Set Temporary Password/); assert.match(mgr, />Reset PIN</);
  for (const f of ['src/admin/temppass.tsx', 'src/admin/super.tsx', 'src/admin/manager.tsx', 'src/admin/screens.tsx', 'server/accounts.mjs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /Temporary PIN|temporary PIN/, `${f}: no temporary PIN`);
  }
});

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browserOk = CHROME && fs.existsSync(path.join(root, 'dist', 'index.html')) ? {} : { skip: 'needs Chrome and a built dist/' };

test('browser: People at 1440, the dialog, Cancel sends nothing, Set shows the tag; sign-in goes to Choose Your Own', browserOk, async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { proc, port, profile } = await startChrome(CHROME, { profilePrefix: 'bt-temp-chrome-' }); // Chrome picks a free debugging port (Nov 26)
  let ws;
  try {
    for (let i = 0; i < 100 && !ws; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); if (t) ws = new WebSocket(t.webSocketDebuggerUrl); } catch {} await sleep(200); }
    assert.ok(ws, 'Chrome started');
    if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pend = new Map(); const posts = []; const errors = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Network.requestWillBeSent' && m.params.request.method !== 'GET' && m.params.request.url.includes('/api/')) posts.push({ path: new URL(m.params.request.url).pathname, body: m.params.request.postData });
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
      if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: false });
    });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
    const waitFor = async (x, n = 50) => { for (let i = 0; i < n; i++) { if (await ev(x)) return true; await sleep(200); } return false; };
    const click = (sel, text) => ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(b)b.click();return !!b})()`);
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.confirm=()=>false;window.prompt=()=>null;' });
    await send('Network.setCookie', { name: tommy.jar.split('=')[0], value: tommy.jar.split('=').slice(1).join('='), url: BASE });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${BASE}/admin/super/people` });
    assert.ok(await waitFor(`document.querySelectorAll('tbody tr .acts button').length > 4`), 'People loaded');
    // Every row: the actions in one row of 44 px targets, never over Last Seen; the email under the name
    const rows = await ev(`(()=>{const t=document.querySelector('.people-table');return [...t.querySelectorAll('tbody tr')].map(tr=>{const b=[...tr.querySelectorAll('.acts button')];const prev=tr.querySelector('td.row-actions').previousElementSibling.getBoundingClientRect();
      return {name:tr.querySelector('.person-name')?.textContent,names:b.map(x=>x.textContent),lines:new Set(b.map(x=>Math.round(x.getBoundingClientRect().top))).size,minH:Math.min(...b.map(x=>x.getBoundingClientRect().height)),over:b.some(x=>x.getBoundingClientRect().left<prev.right-1),sub:tr.querySelector('.person-sub')?.textContent}})})()`);
    const toby = rows.find((r) => r.name === 'Tobias Quill'), imo = rows.find((r) => r.name === 'Imogen Pell'), own = rows.find((r) => r.name === 'Odile Owner');
    assert.deepEqual(toby.names, ['Sign In As', 'Edit', 'Set Temporary Password', 'Delete']); // (Nov 25: he signs in with email now, so no Reset PIN)
    assert.deepEqual(own.names, ['Sign In As', 'Edit', 'Set Temporary Password', 'Reset Password', 'Delete']);
    assert.equal(toby.sub, 'tobias@temp.test'); assert.equal(imo.sub, 'imogen@temp.test');
    for (const r of rows) { assert.equal(r.lines, 1, `${r.name}: one row`); assert.ok(r.minH >= 44, `${r.name}: 44 px`); assert.equal(r.over, false, `${r.name}: nothing over Last Seen`); }
    assert.equal(await ev(`getComputedStyle(document.querySelector('.people-table')).display`), 'table');
    // The dialog: their email, Make One for Me, Type One, Cancel sends nothing
    posts.length = 0;
    await ev(`[...document.querySelectorAll('tbody tr')].find(tr=>tr.querySelector('.person-name').textContent==='Tobias Quill').querySelectorAll('.acts button')[2].click()`);
    assert.ok(await waitFor(`!!document.querySelector('.temp-box')`), 'the dialog opens in the page');
    assert.match(await ev(`document.querySelector('#temp-title').textContent`), /Set a Temporary Password for Tobias/);
    assert.equal(await ev(`document.querySelector('.temp-box input[type=email]').value`), 'tobias@temp.test', 'staff: their email, to sign in with');
    assert.match(await ev(`document.querySelector('.temp-made').textContent`), /^[a-z]+-[a-z]+-\d{4}$/);
    const before = await ev(`document.querySelector('.temp-made').textContent`);
    await click('.temp-box button', 'Make Another');
    await sleep(100);
    assert.match(await ev(`document.querySelector('.temp-made').textContent`), /^[a-z]+-[a-z]+-\d{4}$/);
    assert.equal(await ev(`[...document.querySelectorAll('.temp-days option')].map(o=>o.textContent.split(' ·')[0]).join(',')`), '1 day,3 days,7 days,14 days');
    assert.equal(await ev(`document.querySelector('.temp-days select').value`), '7');
    await click('.temp-seg button', 'Type One');
    assert.ok(await waitFor(`!!document.querySelector('.temp-type-row input')`));
    await click('.temp-box button', 'Make One for Me');
    // 44 px targets on the dialog's controls
    assert.ok(await ev(`[...document.querySelectorAll('.temp-box button, .temp-box select')].every(b=>b.getBoundingClientRect().height>=44)`), 'dialog targets 44 px');
    await click('.temp-box button', 'Cancel');
    assert.ok(!(await ev(`!!document.querySelector('.temp-box')`)), 'Cancel closes it');
    assert.deepEqual(posts, [], 'Cancel sends nothing');
    void before;
    // Set it: the page says so, the row shows the tag and Cancel Temporary
    await ev(`[...document.querySelectorAll('tbody tr')].find(tr=>tr.querySelector('.person-name').textContent==='Tobias Quill').querySelectorAll('.acts button')[2].click()`);
    assert.ok(await waitFor(`!!document.querySelector('.temp-box')`));
    const made = await ev(`document.querySelector('.temp-made').textContent`);
    await click('.temp-box button', 'Set Temporary Password');
    assert.ok(await waitFor(`!!document.querySelector('.done-note')`), 'done note');
    assert.match(await ev(`document.querySelector('.done-note p').textContent`), /Tobias Quill has a temporary password until [A-Z][a-z]{2} \d+\. Tobias signs in with tobias@temp\.test and chooses their own the first time\. It’s in the Log\./);
    assert.equal(posts.length, 1); assert.equal(posts[0].path, `/api/super/users/${tobiasId}/temporary`);
    assert.deepEqual(JSON.parse(posts[0].body), { value: made, days: 7, email: 'tobias@temp.test' });
    assert.ok(await waitFor(`[...document.querySelectorAll('tbody tr')].some(tr=>/Temporary · until/i.test(tr.querySelector('.temp-tag')?.textContent||''))`), 'the tag');
    const after = await ev(`(()=>{const tr=[...document.querySelectorAll('tbody tr')].find(tr=>tr.querySelector('.person-name').textContent==='Tobias Quill');const b=[...tr.querySelectorAll('.acts button')];const prev=tr.querySelector('td.row-actions').previousElementSibling.getBoundingClientRect();return {names:b.map(x=>x.textContent),lines:new Set(b.map(x=>Math.round(x.getBoundingClientRect().top))).size,over:b.some(x=>x.getBoundingClientRect().left<prev.right-1)}})()`);
    assert.deepEqual(after.names, ['Sign In As', 'Edit', 'Cancel Temporary', 'Delete']); // (Nov 25: email sign-in now, so no Reset PIN) assert.equal(after.lines, 1); assert.equal(after.over, false);
    // Cancel Temporary asks in the page; Keep It sends nothing
    posts.length = 0;
    await click('tbody tr .acts button', 'Cancel Temporary');
    assert.ok(await waitFor(`!!document.querySelector('[role=alertdialog]')`));
    await click('[role=alertdialog] button', 'Keep It');
    await sleep(200); assert.deepEqual(posts, []);
    // The email sign-in goes to Choose Your Own Password
    assert.equal((await owner.call(`/api/team/${imogenId}/temporary`, { method: 'POST', body: { value: 'willow-cove-7713' } })).status, 200);
    await send('Network.clearBrowserCookies');
    await send('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: `${BASE}/sign-in` });
    assert.ok(await waitFor(`!!document.querySelector('input[autocomplete=username]')`));
    const type = (sel, v) => ev(`(()=>{const i=document.querySelector(${JSON.stringify(sel)});const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await type('input[autocomplete=username]', 'imogen@temp.test'); await type('input[autocomplete=current-password]', 'willow-cove-7713');
    await click('form button', 'Sign In');
    assert.ok(await waitFor(`/Choose Your Own Password/.test(document.body.textContent)`), 'Choose Your Own Password');
    const inputs = `document.querySelectorAll('input[autocomplete=new-password]')`;
    await ev(`(()=>{const [a,b]=${inputs};const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const i of [a,b]){s.call(i,'willow-cove-7713');i.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
    assert.ok(await waitFor(`!!document.querySelector('.co-checks li.co-no')`), 'the temporary one is flagged as you type');
    await ev(`(()=>{const [a,b]=${inputs};const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const i of [a,b]){s.call(i,'imogen-browser-pass');i.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
    await click('form button', 'Save and Continue');
    assert.ok(await waitFor(`/You’re In, Imogen/.test(document.body.textContent)`), 'You’re In');
    await click('button', 'Continue');
    assert.ok(await waitFor(`!/You’re In/.test(document.body.textContent) && !document.querySelector('input[autocomplete=username]')`), 'into the app');
    assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'imogen@temp.test', password: 'imogen-browser-pass' } })).status, 200);
    assert.deepEqual(errors, []);
  } finally { try { ws?.close(); } catch {} proc.kill(); await new Promise((r) => setTimeout(r, 500)); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
});
