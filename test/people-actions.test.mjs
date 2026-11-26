// Super Admin → People: every action on a person's row works (Nov 23). Tommy: "links dont work" on Autumn's row (Sign In
// As · Edit · Reset PIN · Delete). The live log showed Reset PIN pressed 10 times in 25 seconds: each one worked on the
// server, but the page never asked or said anything, and Sign In As / Delete hung on the browser's own confirm() popup,
// which a browser can switch off without a sign. Now each action asks inside the page and says what happened.
// API part: each action works for a super admin on a staff row and an owner row. Browser part (needs Chrome and a built
// dist/; skipped otherwise): with the browser's popups switched off, every button opens its dialog in the page, Cancel
// sends nothing, Reset PIN says so, the date stays on one line and the actions sit in one row of 44 px targets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { totpAt } from '../server/auth.mjs';
import { giveAccount, addPinStaff, sessionCookieFor, startServer, startChrome } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-people-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;
before(async () => {
  giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@people.test', SUPERADMIN_EMAIL: 'tommy@people.test', RESEND_API_KEY: '', MAIL_FROM: '', PREP_WEEKLY: 'off' }));
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

function person(ip) {
  const p = { jar: '' };
  p.call = async (u, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + u, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(p.jar ? { Cookie: p.jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) p.jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return p;
}
const tommy = person('10.8.0.1'), owner = person('10.8.0.2'), staff = person('10.8.0.3');
let autumnId = 0, ownerId = 0, secret = '';

test('setup: a super admin with two-step, an owner, a staff member with a PIN', async () => {
  assert.equal((await owner.call('/api/setup', { method: 'POST', body: { name: 'Odette Owner', email: 'owner@people.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await tommy.call('/api/setup', { method: 'POST', body: { name: 'Tommy Claffey', email: 'tommy@people.test', password: 'long-enough-1' } })).status, 200);
  secret = (await tommy.call('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await tommy.call('/api/2fa/enable', { method: 'POST', body: { code: totpAt(secret, Math.floor(Date.now() / 30000)) } })).status, 200);
  const code = (await owner.call('/api/team')).data.company.joinCode;
  assert.ok(code);
  // Nov 25: a staff member who joined with a PIN (before section 50), signed in on their phone
  staff.jar = sessionCookieFor(dir, await addPinStaff(dir, { name: 'Wren Ashby', pin: '4826' }));
  assert.equal((await staff.call('/api/me')).data.user.name, 'Wren Ashby');
  const people = (await tommy.call('/api/super/users?q=&company=')).data.users;
  autumnId = people.find((p) => p.name === 'Wren Ashby').id;
  ownerId = people.find((p) => p.email === 'owner@people.test').id;
  assert.ok(autumnId && ownerId);
});

test('API: every People action works for a super admin, on a staff row and an owner row', async () => {
  // Reset PIN: the PIN is cleared and they're signed out (press it twice: still fine)
  for (let i = 0; i < 2; i++) assert.equal((await tommy.call(`/api/super/users/${autumnId}/reset-pin`, { method: 'POST' })).status, 200);
  assert.equal((await staff.call('/api/me')).data.user, null, 'staff signed out');
  assert.equal((await tommy.call('/api/super/users?q=Wren&company=')).data.users[0].hasPin, false);
  // Edit
  assert.equal((await tommy.call(`/api/super/users/${ownerId}`, { method: 'PATCH', body: { name: 'Odette Owner-Hale' } })).status, 200);
  // Reset Password (email accounts)
  const link = await tommy.call(`/api/super/users/${ownerId}/reset-password`, { method: 'POST' });
  assert.equal(link.status, 200); assert.match(link.data.link, /\//);
  // Delete and Restore
  assert.equal((await tommy.call(`/api/super/users/${autumnId}`, { method: 'DELETE' })).status, 200);
  assert.ok((await tommy.call('/api/super/users?q=Wren&company=')).data.users[0].deletedAt);
  assert.equal((await tommy.call(`/api/super/users/${autumnId}/restore`, { method: 'POST' })).status, 200);
  // Sign In As (staff, then owner), each from a fresh super admin sign-in (Sign In As turns that session into theirs)
  for (const [id, role] of [[autumnId, 'staff'], [ownerId, 'owner']]) {
    const s = person('10.8.0.9');
    const login = await s.call('/api/login', { method: 'POST', body: { email: 'tommy@people.test', password: 'long-enough-1' } });
    assert.equal(login.data?.needCode, true);
    assert.equal((await s.call('/api/login/code', { method: 'POST', body: { ticket: login.data.ticket, code: totpAt(secret, Math.floor(Date.now() / 30000)) } })).status, 200);
    assert.equal((await s.call(`/api/super/users/${id}/sign-in-as`, { method: 'POST' })).status, 200);
    const me = (await s.call('/api/me')).data.user;
    assert.equal(me.role, role); assert.ok(me.impersonatedBy);
  }
});

test('the People screens never use the browser’s confirm() for a person’s actions', () => {
  const sup = fs.readFileSync(path.join(root, 'src/admin/super.tsx'), 'utf8');
  const code = (t) => t.replace(/\/\/.*$/gm, ''); // comments may name confirm()
  const people = code(sup.slice(sup.indexOf('function People()'), sup.indexOf('function EditPerson(')));
  assert.doesNotMatch(people, /\bconfirm\(|\bprompt\(/, 'Super Admin → People asks inside the page');
  assert.match(people, /resetPin\(p\)/); assert.match(people, /<DoneNote/);
  const scr = fs.readFileSync(path.join(root, 'src/admin/screens.tsx'), 'utf8');
  const team = code(scr.slice(scr.indexOf('export function People('), scr.indexOf('export function', scr.indexOf('export function People(') + 10)));
  assert.doesNotMatch(team, /\bconfirm\(/, 'Owners and managers asks inside the page');
});

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browserOk = CHROME && fs.existsSync(path.join(root, 'dist', 'index.html')) ? {} : { skip: 'needs Chrome and a built dist/' };

test('browser: with popups switched off, each action opens its dialog in the page; the row holds its layout', browserOk, async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { proc, port, profile } = await startChrome(CHROME, { profilePrefix: 'bt-people-chrome-' }); // Chrome picks a free debugging port (Nov 26)
  let ws;
  try {
    for (let i = 0; i < 100 && !ws; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); if (t) ws = new WebSocket(t.webSocketDebuggerUrl); } catch {} await sleep(200); }
    assert.ok(ws, 'Chrome started');
    if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pend = new Map(); const posts = []; const errors = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Network.requestWillBeSent' && m.params.request.method !== 'GET' && m.params.request.url.includes('/api/')) posts.push(new URL(m.params.request.url).pathname);
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
      if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: false });
    });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.confirm=()=>false;window.prompt=()=>null;' }); // popups switched off
    await send('Network.setCookie', { name: tommy.jar.split('=')[0], value: tommy.jar.split('=').slice(1).join('='), url: BASE });
    await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${BASE}/admin/super/people?q=Wren` });
    for (let i = 0; i < 50 && !(await ev(`!!document.querySelector('tbody tr .acts button')`)); i++) await sleep(200);
    const row = await ev(`(()=>{const tr=document.querySelector('tbody tr');const b=[...tr.querySelectorAll('.acts button')];return {names:b.map(x=>x.textContent),lines:new Set(b.map(x=>Math.round(x.getBoundingClientRect().top))).size,minH:Math.min(...b.map(x=>x.getBoundingClientRect().height)),when:getComputedStyle(tr.querySelector('td.when')).whiteSpace}})()`);
    assert.deepEqual(row.names, ['Sign In As', 'Edit', 'Set Temporary Password', 'Reset PIN', 'Delete']); // (Nov 24: Set Temporary Password)
    assert.equal(row.lines, 1, 'the actions sit in one row'); assert.ok(row.minH >= 44, '44 px targets'); assert.equal(row.when, 'nowrap', 'the date stays on one line');
    // Nov 23 (Tommy's screenshot): at desktop width the table is a real table and the buttons never sit on top of the
    // other columns. The shared .row-actions rule made the cell a flex box, so it shrank and the buttons spilled left.
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${BASE}/admin/super/people` });
    for (let i = 0; i < 50 && !(await ev(`!!document.querySelector('tbody tr .acts button')`)); i++) await sleep(200);
    const wide = await ev(`(()=>{const t=document.querySelector('.people-table');let bad=0;for(const tr of t.querySelectorAll('tbody tr')){const a=tr.querySelector('td.row-actions');const prev=a.previousElementSibling.getBoundingClientRect();const acts=[...a.querySelectorAll('button')].map(b=>b.getBoundingClientRect());if(acts.some(r=>r.left<prev.right-1))bad++;}return {display:getComputedStyle(t).display,cell:getComputedStyle(t.querySelector('td.row-actions')).display,bad}})()`);
    assert.equal(wide.display, 'table'); assert.equal(wide.cell, 'table-cell'); assert.equal(wide.bad, 0, 'no button sits over Last Seen or Company');
    await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${BASE}/admin/super/people?q=Wren` });
    for (let i = 0; i < 50 && !(await ev(`!!document.querySelector('tbody tr .acts button')`)); i++) await sleep(200);
    for (const name of row.names) {
      posts.length = 0;
      await ev(`[...document.querySelectorAll('tbody tr:first-child .acts button')].find(x=>x.textContent===${JSON.stringify(name)}).click()`); await sleep(300);
      assert.ok(await ev(`!!document.querySelector('[role=alertdialog],[role=dialog]')`), `${name} opens its dialog`);
      await ev(`[...document.querySelectorAll('[role=alertdialog] button,[role=dialog] button')].find(x=>x.textContent==='Cancel').click()`); await sleep(300);
      assert.ok(!(await ev(`!!document.querySelector('[role=alertdialog],[role=dialog]')`)), `${name}: Cancel closes it`);
      assert.deepEqual(posts, [], `${name}: Cancel sends nothing`);
    }
    await ev(`[...document.querySelectorAll('tbody tr:first-child .acts button')].find(x=>x.textContent==='Reset PIN').click()`); await sleep(300);
    await ev(`[...document.querySelectorAll('[role=alertdialog] button')].find(x=>x.textContent==='Reset PIN').click()`);
    for (let i = 0; i < 30 && !(await ev(`!!document.querySelector('.done-note')`)); i++) await sleep(200);
    assert.deepEqual(posts, [`/api/super/users/${autumnId}/reset-pin`]);
    assert.match(await ev(`document.querySelector('.done-note p').textContent`), /Wren Ashby’s PIN is reset/);
    assert.deepEqual(errors, []);
  } finally { try { ws?.close(); } catch {} proc.kill(); await new Promise((r) => setTimeout(r, 500)); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
});
