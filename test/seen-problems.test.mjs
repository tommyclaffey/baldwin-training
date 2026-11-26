// Nov 25 (Tommy: "get warned before staff do"). Nov 24–25 a staff member (Autumn) saw "We couldn't find that page" on
// Home because the page list failed once, and the error log (only crashes) said nothing. Now the app reports, as kind
// "seen", when: the page list fails after its tries, a page fails to load, and a sign-in request gets a server error or no
// answer (not a wrong PIN or password). The words come from the server; nothing typed (PIN, password, email, code, token)
// is ever stored. Super Admin → Error Log shows them as "Seen on Screen".
// API part: always runs. Browser part (needs Chrome and a built dist/; skipped otherwise): each moment, made to fail on
// purpose, ends up in the log; a wrong password doesn't; a report that couldn't be sent goes once the device is back online.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { totpAt } from '../server/auth.mjs';
import { giveAccount, startServer, startChrome } from './helpers.mjs';
import { seenProblem, safeClientPath } from '../server/ops.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-seen-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;
before(async () => {
  giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@seen.test', SUPERADMIN_EMAIL: 'tommy@seen.test', RESEND_API_KEY: '', MAIL_FROM: '', PREP_WEEKLY: 'off' }));
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
const tommy = person('10.9.0.1'), owner = person('10.9.0.2');
/** Every row in the errors table (read straight from the test database). */
function rows() {
  const db = new DatabaseSync(path.join(dir, 'baldwin.db'), { readOnly: true });
  try { return db.prepare('SELECT kind, path, message, stack, count FROM errors ORDER BY id').all(); } finally { db.close(); }
}
const report = (body, ip = '10.9.1.' + Math.floor(Math.random() * 250)) => fetch(BASE + '/api/client-error',
  { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': ip }, body: JSON.stringify(body) });

test('setup: a super admin with two-step and an owner', async () => {
  assert.equal((await owner.call('/api/setup', { method: 'POST', body: { name: 'Odile Varnum', email: 'owner@seen.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await tommy.call('/api/setup', { method: 'POST', body: { name: 'Tommy Claffey', email: 'tommy@seen.test', password: 'long-enough-1' } })).status, 200);
  const secret = (await tommy.call('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await tommy.call('/api/2fa/enable', { method: 'POST', body: { code: totpAt(secret, Math.floor(Date.now() / 30000)) } })).status, 200);
});

test('the words: plain, chosen by the server; wrong PIN or password and "not allowed" are not problems', () => {
  assert.deepEqual(seenProblem({ event: 'index', status: 0, attempts: 4, path: '/' }),
    { path: '/', message: 'Page list didn’t load', detail: 'No answer from Mise (no connection, or the server was restarting) · after 4 tries' });
  assert.equal(seenProblem({ event: 'page', status: 502, page: 'e12', path: '/scallops' }).detail, 'Page e12 · Mise answered 502 (a server error)');
  assert.equal(seenProblem({ event: 'signin', status: 503, step: 'staff-login', path: '/the-baldwin/join' }).message, 'Sign-in didn’t go through');
  assert.match(seenProblem({ event: 'signin', status: 0, step: 'login', path: '/sign-in' }).detail, /^Sign In with email and password · No answer/);
  for (const s of [400, 401, 403, 404, 429]) assert.equal(seenProblem({ event: 'signin', status: s, step: 'login' }), null, `sign-in ${s} isn't logged`);
  assert.equal(seenProblem({ event: 'index', status: 401 }), null);
  assert.equal(seenProblem({ event: 'whatever', status: 500 }), null);
  // tokens and join codes never reach the log
  assert.equal(safeClientPath('/admin/reset/9f8e7d6c5b4a'), '/admin/reset/:token');
  assert.equal(safeClientPath('/admin/invite/abc?x=1'), '/admin/invite/:token');
  assert.equal(safeClientPath('/api/join/WREN26'), '/api/join/:code');
  assert.equal(safeClientPath('/x<script>@y'), '/xscripty');
  // a long delay is said in plain words
  assert.match(seenProblem({ event: 'index', status: 0, late: 5 * 60_000 }).detail, /sent 5 min later, once the device was back online/);
});

test('API: each moment lands in the errors table as "seen", counts up, and keeps nothing typed', async () => {
  const before = rows().length;
  for (let i = 0; i < 3; i++) assert.equal((await report({ event: 'index', status: 0, attempts: 4, path: '/wine' })).status, 204);
  assert.equal((await report({ event: 'page', status: 500, page: '9-2', path: '/scallops' })).status, 204);
  // a sign-in report carrying things it must never carry: none of it is stored
  assert.equal((await report({ event: 'signin', status: 502, step: 'staff-login', path: '/admin/reset/SECRETTOKEN123', pin: '4826', password: 'hunter22', email: 'wren@seen.test', code: 'WREN26', message: 'pin 4826' })).status, 204);
  // a wrong password (401) is not logged
  assert.equal((await report({ event: 'signin', status: 401, step: 'login', path: '/sign-in' })).status, 204);
  const seen = rows().slice(before).filter((r) => r.kind === 'seen');
  assert.equal(seen.length, 3, 'one row per moment');
  const idx = seen.find((r) => r.message === 'Page list didn’t load');
  assert.equal(idx.count, 3, 'the same moment counts up'); assert.equal(idx.path, '/wine');
  assert.equal(seen.find((r) => r.message === 'A page didn’t load').path, '/scallops');
  const si = seen.find((r) => r.message === 'Sign-in didn’t go through');
  assert.equal(si.path, '/admin/reset/:token');
  assert.equal(si.stack, 'Sign In with a PIN · Mise answered 502 (a server error)');
  const all = JSON.stringify(rows());
  for (const secret of ['4826', 'hunter22', 'wren@seen.test', 'WREN26', 'SECRETTOKEN123']) assert.ok(!all.includes(secret), `${secret} never stored`);
  // old-style browser crash reports still work, and their address loses its token too
  assert.equal((await report({ message: 'TypeError: boom', path: '/admin/invite/tok123' })).status, 204);
  const crash = rows().at(-1);
  assert.equal(crash.kind, 'client'); assert.equal(crash.path, '/admin/invite/:token');
});

test('Super Admin → Error Log lists them as their own kind, with totals', async () => {
  const all = (await tommy.call('/api/super/errors?days=1')).data;
  assert.ok(all.totals.seen >= 3, 'seen total');
  const only = (await tommy.call('/api/super/errors?days=1&kind=seen')).data;
  assert.ok(only.errors.length >= 3 && only.errors.every((e) => e.kind === 'seen'));
  assert.ok(only.errors.some((e) => e.message === 'Page list didn’t load' && e.count >= 3));
  const home = (await tommy.call('/api/super/home')).data;
  assert.ok(home.waiting.some((w) => w.type === 'error' && w.kind === 'seen' && w.message === 'Page list didn’t load'), 'repeating: waiting on you');
  // the screen knows the kind
  const hq = fs.readFileSync(path.join(root, 'src/admin/hq.tsx'), 'utf8');
  assert.match(hq, /seen: 'Seen on Screen'/);
});

test('the app never sends what was typed: only fixed fields leave the browser', () => {
  const src = fs.readFileSync(path.join(root, 'src/lib/problems.ts'), 'utf8');
  const body = src.slice(src.indexOf('const body = JSON.stringify('), src.indexOf('\n', src.indexOf('const body = JSON.stringify(')));
  assert.match(body, /event: r\.event, status: r\.status, attempts: r\.attempts, path: r\.path, page: r\.page, step: r\.step, late:/);
  assert.doesNotMatch(body, /pin|password|email|token|opts|body:/i);
  const api = fs.readFileSync(path.join(root, 'src/lib/api.ts'), 'utf8');
  assert.match(api, /reportProblem\('signin', e, \{ step \}\)/);
  assert.match(api, /reportProblem\('signin', err, \{ step \}\)/);
  assert.match(fs.readFileSync(path.join(root, 'src/lib/session.tsx'), 'utf8'), /reportProblem\('index', e, \{ attempts: 4 \}\)/);
  assert.match(fs.readFileSync(path.join(root, 'src/components/PageView.tsx'), 'utf8'), /reportProblem\('page', e,/);
});

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browserOk = CHROME && fs.existsSync(path.join(root, 'dist', 'index.html')) ? {} : { skip: 'needs Chrome and a built dist/' };

test('browser: the page list, a page and a sign-in, each made to fail, reach the log; a wrong password does not', browserOk, async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { proc, port, profile } = await startChrome(CHROME, { profilePrefix: 'bt-seen-chrome-' }); // Chrome picks a free debugging port (Nov 26)
  let ws;
  try {
    for (let i = 0; i < 100 && !ws; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); if (t) ws = new WebSocket(t.webSocketDebuggerUrl); } catch {} await sleep(200); }
    assert.ok(ws, 'Chrome started');
    if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pend = new Map(); const sentBodies = [];
    // which requests to break: a test of a path → 'network' (no answer) or a status number
    let breakers = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/client-error')) sentBodies.push(m.params.request.postData || '');
      if (m.method === 'Fetch.requestPaused') {
        const u = new URL(m.params.request.url).pathname;
        const b = breakers.find((x) => x.test(u, m.params.request.method));
        if (!b) send('Fetch.continueRequest', { requestId: m.params.requestId });
        else if (b.how === 'network') send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'InternetDisconnected' });
        else send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: b.how, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<h1>Bad gateway</h1>').toString('base64') });
      }
    });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
    const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 250) { const v = fn(); if (v) return v; await sleep(250); } return fn(); };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

    // 1 · The page list fails every time (signed in as the owner): after 4 tries it says so, and the log has it
    await send('Network.setCookie', { name: owner.jar.split('=')[0], value: owner.jar.split('=').slice(1).join('='), url: BASE });
    breakers = [{ test: (u) => u === '/api/index', how: 503 }];
    await send('Page.navigate', { url: `${BASE}/` });
    const idx = await until(() => rows().find((r) => r.kind === 'seen' && r.message === 'Page list didn’t load' && r.path === '/'), 20000);
    assert.ok(idx, 'page list failure logged');
    assert.match(idx.stack, /Mise answered 503 \(a server error\) · after 4 tries/);
    assert.match(await ev(`document.querySelector('main h1')?.textContent || ''`), /didn’t load/);

    // 2 · The page list arrives but a page doesn't (no connection)
    breakers = [{ test: (u) => u.startsWith('/api/page/'), how: 'network' }];
    await send('Page.navigate', { url: `${BASE}/` });
    const page = await until(() => rows().find((r) => r.kind === 'seen' && r.message === 'A page didn’t load' && r.path === '/'));
    assert.ok(page, 'page failure logged');
    assert.match(page.stack, /^Page [\w:.-]+ · No answer from Mise/);
    assert.equal(page.path, '/');

    // 3 · Sign in with email: a wrong password is not a problem; a server error is
    breakers = [];
    await send('Network.clearBrowserCookies');
    const signIn = async (email, password) => {
      await send('Page.navigate', { url: `${BASE}/sign-in` });
      for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('input[autocomplete=current-password]')`)); i++) await sleep(200);
      await ev(`(()=>{const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
        set(document.querySelector('input[autocomplete=username]'),${JSON.stringify(email)});set(document.querySelector('input[autocomplete=current-password]'),${JSON.stringify(password)});})()`);
      await sleep(100);
      await ev(`document.querySelector('form button.btn').click()`);
      await sleep(1500);
    };
    sentBodies.length = 0;
    await signIn('owner@seen.test', 'wrong-password-9');
    assert.equal(sentBodies.length, 0, 'a wrong password sends no report');
    const signInRow = () => rows().find((r) => r.kind === 'seen' && r.message === 'Sign-in didn’t go through' && r.path === '/sign-in');
    assert.ok(!signInRow());
    breakers = [{ test: (u, m) => u === '/api/login' && m === 'POST', how: 502 }];
    await signIn('owner@seen.test', 'long-enough-1');
    const si = await until(signInRow);
    assert.ok(si, 'sign-in server error logged');
    assert.equal(si.stack, 'Sign In with email and password · Mise answered 502 (a server error)');
    assert.equal(si.path, '/sign-in');
    for (const b of sentBodies) assert.ok(!/owner@seen|long-enough|password/.test(b), 'nothing typed in the report: ' + b);

    // 4 · No connection at all: the report waits on the device and goes once it's back online
    const n = signInRow().count;
    breakers = [{ test: (u, m) => u === '/api/login' && m === 'POST', how: 'network' }, { test: (u) => u === '/api/client-error', how: 'network' }];
    await signIn('owner@seen.test', 'long-enough-1');
    await sleep(500);
    assert.equal(signInRow().count, n, 'nothing reached the server yet');
    assert.match(await ev(`localStorage.getItem('mise-problems')||''`), /"event":"signin"/, 'waiting on the device');
    breakers = [];
    await ev(`window.dispatchEvent(new Event('online'))`);
    const back = await until(() => { const r = signInRow(); return r.count > n && /No answer from Mise/.test(r.stack || '') ? r : null; });
    assert.ok(back, 'sent once back online');
    assert.equal(await ev(`localStorage.getItem('mise-problems')`), null, 'the queue is empty');
  } finally { try { ws?.close(); } catch {} proc.kill(); await new Promise((r) => setTimeout(r, 500)); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
});
