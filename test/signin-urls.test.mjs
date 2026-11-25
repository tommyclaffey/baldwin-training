// Real addresses for signing in and joining (Nov 23; Tommy: "It should be miseacademy.app/join, and the other one should be
// sign in"; src/lib/authroute.ts). /sign-in = email + password, /join = Join with a Code, /<account>/join = that account's
// (its code only), /<account>/sign-in = /<account>. No role labels. Signed in already: who, Go to Home, Sign Out, never
// "We couldn't find that page". Old invite and reset links still open their screens.
// The screens themselves are checked in headless Chrome when there's a build (dist/) and a Chrome (CI has both).
// SIGNIN_SHOTS=<folder> saves screenshots of each at 390 and 1440.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, turnOnTwoStep } from './helpers.mjs';
import { reserved, isReserved, accountSlug } from '../server/links.mjs';
import { authRouteFor, signInPath, joinPath, setUpPath, AUTH_TITLE } from '../src/lib/authroute.ts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-signin-urls-'));
const PORT = 4300 + Math.floor(Math.random() * 300); // its own range (was 6600, shared with captions: both timed out in CI)
const BASE = `http://127.0.0.1:${PORT}`;
const BOT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const BROWSER = CHROME && fs.existsSync(path.join(root, 'dist/index.html')) ? {} : { skip: 'needs a build (npm run build) and Chrome' };
const SHOTS = process.env.SIGNIN_SHOTS || null;
let server;

function person() {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const bot = async (p) => { const r = await fetch(BASE + p, { headers: { 'User-Agent': BOT }, redirect: 'manual' }); return { status: r.status, html: await r.text(), location: r.headers.get('location') }; };
const meta = (html, key) => { const m = new RegExp(`<meta (?:property|name)="${key.replace(/[:]/g, '\\:')}" content="([^"]*)"`).exec(html); return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null; };
const account = (html) => { const raw = meta(html, 'mise-account'); return raw ? JSON.parse(raw) : null; };

before(async () => {
  giveAccount(dir);
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@baldwin.test', SUPERADMIN_EMAIL: 'tommy@mise.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const tommy = person(), owner = person();
let code = '', hcode = '', invite = '';

test('setup: The Baldwin’s owner, the super admin and a second account (Harbor Lane)', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Bram Owner', email: 'owner@baldwin.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@mise.test', password: 'long-enough-2' } })).status, 200);
  await turnOnTwoStep(tommy, { workIn: null });
  const add = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Harbor Lane', ownerEmail: 'owner@harbor.test' } });
  assert.equal(add.status, 200);
  invite = new URL(add.data.link, BASE).pathname; // unused: the browser opens it below
  code = db().prepare('SELECT join_code FROM companies WHERE id = 1').get().join_code;
  hcode = db().prepare('SELECT join_code FROM companies WHERE id = ?').get(add.data.id).join_code;
});

test('which screen each address is (src/lib/authroute.ts)', () => {
  const tb = { slug: 'the-baldwin' };
  assert.deepEqual(authRouteFor('/sign-in', null), { kind: 'sign-in', account: null });
  assert.deepEqual(authRouteFor('/join', null), { kind: 'join', account: null });
  assert.deepEqual(authRouteFor('/join/', null), { kind: 'join', account: null });
  assert.deepEqual(authRouteFor('/sign-in', tb), { kind: 'sign-in', account: null });
  assert.deepEqual(authRouteFor('/the-baldwin', tb), { kind: 'sign-in', account: tb });
  assert.deepEqual(authRouteFor('/the-baldwin/sign-in', tb), { kind: 'sign-in', account: tb });
  assert.deepEqual(authRouteFor('/the-baldwin/join', tb), { kind: 'join', account: tb });
  for (const p of ['/', '/our-story', '/the-baldwin/join', '/admin', '/signin']) if (p !== '/the-baldwin/join') assert.equal(authRouteFor(p, null), null, p);
  assert.equal(authRouteFor('/the-baldwin/join', null), null, 'without the server naming the account');
  assert.equal(authRouteFor('/harbor-lane/join', tb), null, 'another account’s address');
  assert.deepEqual([signInPath(null), joinPath(null), signInPath(tb), joinPath(tb)], ['/sign-in', '/join', '/the-baldwin', '/the-baldwin/join']);
  // Nov 25 (section 50): Set Up Your Sign-In, the one-time move for people who joined with a PIN
  assert.deepEqual(authRouteFor('/set-up-sign-in', null), { kind: 'set-up', account: null });
  assert.deepEqual(authRouteFor('/the-baldwin/set-up-sign-in', tb), { kind: 'set-up', account: tb });
  assert.deepEqual([setUpPath(null), setUpPath(tb)], ['/set-up-sign-in', '/the-baldwin/set-up-sign-in']);
  assert.deepEqual(AUTH_TITLE, { 'sign-in': 'Sign In', join: 'Join with a Code', 'set-up': 'Set Up Your Sign-In', 'sign-up': 'Start Your Restaurant' });
  assert.deepEqual(authRouteFor('/sign-up', null), { kind: 'sign-up', account: null }); // Nov 25: Start Your Restaurant (section 48)
});

test('/sign-in and /join: 200, the Mise card at their own address, no account', async () => {
  for (const p of ['/sign-in', '/join', '/set-up-sign-in']) { // (Nov 25: + Set Up Your Sign-In)
    const r = await bot(p);
    assert.equal(r.status, 200, p);
    assert.equal(account(r.html), null, p);
    assert.equal(meta(r.html, 'og:title'), 'Mise Academy', p);
    assert.equal(meta(r.html, 'og:url'), 'https://www.miseacademy.app' + p, p);
    assert.match(meta(r.html, 'og:image'), /\/img\/mise-brand\/share-card\.jpg\?v=[0-9a-f]{10}$/, p);
  }
  assert.equal(meta((await bot('/')).html, 'og:url'), 'https://www.miseacademy.app/', 'the root is still the root');
});

test('/the-baldwin/join and /the-baldwin/sign-in: the account (name and look) and its card, never its join code', async () => {
  for (const sub of ['join', 'sign-in', 'set-up-sign-in']) {
    const r = await bot('/the-baldwin/' + sub);
    assert.equal(r.status, 200, sub);
    assert.deepEqual(account(r.html), { slug: 'the-baldwin', name: 'Baldwin Restaurant Group', brand: 'baldwin' }, sub);
    assert.equal(meta(r.html, 'og:url'), 'https://www.miseacademy.app/the-baldwin/' + sub);
    assert.equal(meta(r.html, 'og:title'), meta((await bot('/the-baldwin')).html, 'og:title'), 'the same card as /the-baldwin');
    assert.ok(!r.html.includes(code), 'the join code is not in the page');
  }
  assert.deepEqual(account((await bot('/harbor-lane/join')).html)?.name, 'Harbor Lane');
  // one address each: capitals and a trailing slash go to it
  assert.deepEqual([(await bot('/The-Baldwin/Join/')).status, (await bot('/The-Baldwin/Join/')).location], [301, '/the-baldwin/join']);
  assert.deepEqual([(await bot('/THE-BALDWIN/sign-in')).status, (await bot('/THE-BALDWIN/sign-in')).location], [301, '/the-baldwin/sign-in']);
  // not an account: the usual not-found (404); an app address with /join after it is the app as before
  for (const p of ['/nope/join', '/baldwin/sign-in']) { const r = await bot(p); assert.equal(r.status, 404, p); assert.equal(account(r.html), null, p); }
  assert.equal((await bot('/admin/join')).status, 200);
});

test('repeated slashes go to the clean address (301, query kept); never a POST', async () => {
  for (const [from, to] of [['//the-baldwin', '/the-baldwin'], ['/the-baldwin//join', '/the-baldwin/join'], ['///join?x=1&y=2', '/join?x=1&y=2'], ['//sign-in/', '/sign-in/'], ['//api//me', '/api/me']]) {
    const r = await bot(from);
    assert.deepEqual([r.status, r.location], [301, to], from);
  }
  // and the clean address is the account's page, its card included
  assert.deepEqual(account((await bot('/the-baldwin')).html)?.slug, 'the-baldwin');
  // a POST with double slashes isn't redirected (it would come back as a GET)
  const post = await fetch(BASE + '//api/logout', { method: 'POST', headers: { 'X-BT': '1' }, redirect: 'manual' });
  assert.notEqual(post.status, 301);
});

test('branding by plan: a Foundation account’s link pages wear Mise and show the Mise card; Custom Brand its own', async () => {
  // Harbor Lane is on Foundation
  for (const p of ['/harbor-lane', '/harbor-lane/sign-in', '/harbor-lane/join']) {
    const r = await bot(p);
    assert.equal(r.status, 200, p);
    assert.deepEqual(account(r.html), { slug: 'harbor-lane', name: 'Harbor Lane', brand: 'mise' }, p);
    assert.equal(meta(r.html, 'og:title'), 'Mise Academy', p);
    assert.match(meta(r.html, 'og:image'), /\/img\/mise-brand\/share-card\.jpg\?v=/, p);
  }
  // The Baldwin on Foundation: Mise on every link page; back on Custom Brand: its own look again
  assert.equal((await tommy('/api/super/companies/1', { method: 'PATCH', body: { plan: 'foundation' } })).status, 200);
  for (const p of ['/the-baldwin', '/the-baldwin/sign-in', '/the-baldwin/join']) assert.equal(account((await bot(p)).html).brand, 'mise', p);
  assert.equal((await tommy('/api/super/companies/1', { method: 'PATCH', body: { plan: 'custom-brand', look: 'baldwin' } })).status, 200);
  for (const p of ['/the-baldwin', '/the-baldwin/sign-in', '/the-baldwin/join']) assert.equal(account((await bot(p)).html).brand, 'baldwin', p);
});

test('from /the-baldwin/join, the code has to be The Baldwin’s', async () => {
  const p = person();
  assert.equal((await p(`/api/join/${code}?account=the-baldwin`)).status, 200);
  assert.equal((await p(`/api/join/${hcode}?account=the-baldwin`)).status, 404, 'Harbor Lane’s code');
  assert.equal((await p(`/api/join/${code}?account=harbor-lane`)).status, 404);
  assert.equal((await p(`/api/join/${hcode}`)).status, 200, '/join takes any code, as before');
});

test('sign-in and join are reserved: no company can take them', async () => {
  for (const s of ['sign-in', 'join']) { assert.ok(reserved().has(s), s); assert.ok(isReserved(s), s); }
  const d = db();
  assert.notEqual(accountSlug(d, 'Join'), 'join');
  assert.notEqual(accountSlug(d, 'Sign In'), 'sign-in');
  for (const name of ['Join', 'Sign-In']) {
    const r = await tommy('/api/super/companies', { method: 'POST', body: { name } });
    assert.equal(r.status, 200);
    const slug = db().prepare('SELECT slug FROM companies WHERE id = ?').get(r.data.id).slug;
    assert.ok(!['join', 'sign-in'].includes(slug) && !isReserved(slug), slug);
  }
});

/* ---------------- the screens, in a browser ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function browser() {
  const port = 9100 + Math.floor(Math.random() * 400); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-signin-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 100 && !ws; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); if (t) ws = new WebSocket(t.webSocketDebuggerUrl); } catch { /* starting */ } await sleep(200); }
  if (!ws) throw new Error('Chrome did not start');
  if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const size = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 800 ? 844 : 900, deviceScaleFactor: w < 800 ? 3 : 2, mobile: w < 800 });
  /** Wait until the expression is truthy (or time out), then return it. */
  const until = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 100) { const v = await ev(expr); if (v) return v; await sleep(100); } return ev(expr); };
  const go = async (url) => { await send('Page.navigate', { url }); await sleep(300); await until(`!!document.querySelector('h1') && !document.querySelector('.loader')`); await sleep(250); };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
  const close = () => { try { ws.close(); } catch { /* gone */ } proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } };
  return { ev, until, go, size, shot, close, errors };
}
/** What a screen shows: its title (lower case: The Baldwin's look sets titles in capitals), the line over it, its links and buttons. */
const SCREEN = `(()=>{const t=s=>s.textContent.replace(/\\s+/g,' ').trim();return {h1:t(document.querySelector('h1')||document.body).toLowerCase(),
kicker:document.querySelector('.si-kicker')?t(document.querySelector('.si-kicker')):null,sub:document.querySelector('.si-sub')?t(document.querySelector('.si-sub')):null,
look:[...(document.querySelector('.si')?.classList||[])].find(c=>c.startsWith('si-'))||null,path:location.pathname,
links:[...document.querySelectorAll('.si a')].map(a=>[t(a),a.getAttribute('href')]),buttons:[...document.querySelectorAll('.si button')].map(t),
text:document.body.innerText}})()`;
const typeInto = (sel, value) => `(()=>{const i=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;
const click = (label) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`;
const noRoleLabels = (s, where) => { assert.doesNotMatch(s.text, /owners? and managers?|owner or manager|on staff\?/i, where); assert.ok(!s.kicker || !/staff|owner|manager/i.test(s.kicker), `${where}: kicker ${s.kicker}`); };

test('the screens, signed out and signed in (headless Chrome)', BROWSER, async () => {
  const b = await browser();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const snap = async (name) => { if (SHOTS) for (const w of [390, 1440]) { await b.size(w); await sleep(400); await b.shot(path.join(SHOTS, `${name} · ${w}.png`)); } await b.size(1440); };
  try {
    await b.size(1440);
    // /sign-in: email + password, no role label, Join with a Code; no "Use Your PIN Instead" (Nov 24)
    await b.go(BASE + '/sign-in');
    let s = await b.ev(SCREEN);
    assert.equal(s.h1, 'sign in'); assert.equal(s.kicker, null); assert.equal(s.look, 'si-mise');
    assert.ok(await b.ev(`!!document.querySelector('input[type=password]')`), 'the password field');
    assert.deepEqual(s.links.find((l) => l[0] === 'Join with a Code'), ['Join with a Code', '/join']);
    assert.ok(!s.buttons.includes('Use Your PIN Instead') && s.buttons.includes('Forgot Password?'), 'no old PIN link on Sign In');
    // Nov 24: staff who joined with a PIN always have a way in. Nov 25 (section 50): "Joined with a PIN? Set Up Your Sign-In"
    assert.deepEqual(s.links.find((l) => l[0] === 'Set Up Your Sign-In'), ['Set Up Your Sign-In', '/set-up-sign-in']);
    assert.deepEqual(s.links.find((l) => l[0] === 'Try the Demo'), ['Try the Demo', '/demo/mise']);
    noRoleLabels(s, '/sign-in');
    await snap('01 sign-in');

    // Nov 25: the root (and any other address, signed out) is Sign In too
    await b.go(BASE + '/');
    s = await b.ev(SCREEN);
    assert.equal(s.h1, 'sign in', '/'); assert.equal(s.look, 'si-mise');

    // /join: Join with a Code, with Sign In
    await b.go(BASE + '/join');
    s = await b.ev(SCREEN);
    assert.equal(s.h1, 'join with a code'); assert.equal(s.kicker, 'Step 1 of 3'); assert.equal(s.look, 'si-mise');
    assert.deepEqual(s.links.find((l) => l[0] === 'Sign In'), ['Sign In', '/sign-in']);
    noRoleLabels(s, '/join');
    await snap('02 join');
    // the old PIN link goes to Set Up Your Sign-In
    await b.go(BASE + '/join?pin=1');
    assert.ok(await b.until(`location.pathname==='/set-up-sign-in'`), '/join?pin=1 → /set-up-sign-in');

    // /the-baldwin/join: The Baldwin's look and name, its code only
    await b.go(BASE + '/the-baldwin/join');
    s = await b.ev(SCREEN);
    assert.equal(s.h1, 'join with a code'); assert.equal(s.kicker, 'Baldwin Restaurant Group · Step 1 of 3'); assert.equal(s.look, 'si-baldwin');
    assert.deepEqual(s.links.find((l) => l[0] === 'Sign In'), ['Sign In', '/the-baldwin']);
    noRoleLabels(s, '/the-baldwin/join');
    await snap('03 the-baldwin join');
    await b.ev(typeInto('.si input', hcode)); await b.ev(click('Continue'));
    assert.ok(await b.until(`!!document.querySelector('.si [role=alert]')`), 'Harbor Lane’s code is turned away');
    assert.equal((await b.ev(SCREEN)).h1, 'join with a code');
    await b.ev(typeInto('.si input', code)); await b.ev(click('Continue'));
    assert.ok(await b.until(`document.querySelector('h1')?.textContent.trim().toLowerCase()!=='join with a code'`), 'The Baldwin’s code goes on');
    await b.ev(`localStorage.clear()`);

    // a Foundation account's join: Mise look, its name over the title
    await b.go(BASE + '/harbor-lane/join');
    s = await b.ev(SCREEN);
    assert.equal(s.h1, 'join with a code'); assert.equal(s.kicker, 'Harbor Lane · Step 1 of 3'); assert.equal(s.look, 'si-mise');
    assert.deepEqual(s.links.find((l) => l[0] === 'Sign In'), ['Sign In', '/harbor-lane']);

    // /the-baldwin and /the-baldwin/sign-in: its Sign In in its look
    for (const p of ['/the-baldwin', '/the-baldwin/sign-in']) {
      await b.go(BASE + p);
      s = await b.ev(SCREEN);
      assert.equal(s.h1, 'sign in', p); assert.equal(s.kicker, 'Baldwin Restaurant Group', p); assert.equal(s.look, 'si-baldwin', p);
      assert.deepEqual(s.links.find((l) => l[0] === 'Join with a Code'), ['Join with a Code', '/the-baldwin/join'], p);
      noRoleLabels(s, p);
    }

    // signing in on /sign-in goes Home (not the signed-in message)
    await b.go(BASE + '/sign-in');
    await b.ev(typeInto('.si input[autocomplete=username]', 'owner@baldwin.test'));
    await b.ev(typeInto('.si input[type=password]', 'long-enough-1'));
    await b.ev(`document.querySelector('.si form').requestSubmit()`);
    assert.ok(await b.until(`location.pathname==='/' && !document.querySelector('.si')`), 'signed in, Home');

    // already signed in: who, Go to Home, Sign Out, on every one of these addresses
    for (const p of ['/sign-in', '/join', '/the-baldwin/join', '/the-baldwin/sign-in']) {
      await b.go(BASE + p);
      s = await b.ev(SCREEN);
      assert.match(s.sub, /^You’re signed in as Bram Owner \(owner@baldwin\.test\)( at .+)?\.$/, p);
      assert.deepEqual(s.buttons, ['Go to Home', 'Sign Out'], p);
      assert.doesNotMatch(s.text, /couldn.t find that page/i, p);
      assert.equal(s.h1, 'you’re signed in', p); // Nov 25 (section 50, frame 6)
      if (p === '/join') await snap('04 signed in · join');
      if (p.startsWith('/the-baldwin')) assert.equal(s.look, 'si-baldwin', p + ': Custom Brand look');
    }
    await b.go(BASE + '/harbor-lane/join');
    assert.equal((await b.ev(SCREEN)).look, 'si-mise', 'Foundation account, signed in: Mise');
    await b.go(BASE + '/the-baldwin');
    assert.ok(await b.until(`location.pathname==='/'`), '/the-baldwin signed in is Home, as before');
    await b.go(BASE + '/join');
    await b.ev(click('Go to Home'));
    assert.ok(await b.until(`location.pathname==='/' && !document.querySelector('.si')`), 'Go to Home');
    await b.go(BASE + '/join');
    await b.ev(click('Sign Out'));
    assert.ok(await b.until(`document.querySelector('h1')?.textContent.trim().toLowerCase()==='join with a code' && !!document.querySelector('.si input')`), 'Sign Out → Join with a Code');
    assert.equal((await (await fetch(BASE + '/api/me')).json()).user, null);

    // old email links: an invite and a reset still open their own screens
    await b.go(BASE + invite);
    s = await b.ev(SCREEN);
    assert.ok(!['sign in', 'join with a code'].includes(s.h1) && /invite|account|welcome|join harbor/i.test(s.text), `invite: ${s.h1}`);
    assert.ok(await b.ev(`!!document.querySelector('input[type=password]')`), 'the invite asks for a password');
    await b.go(BASE + '/admin/reset/not-a-real-token');
    s = await b.ev(SCREEN);
    assert.ok(!['sign in', 'join with a code'].includes(s.h1), `reset: ${s.h1}`);
    assert.doesNotMatch(s.text, /couldn.t find that page/i);
    assert.deepEqual(b.errors, [], 'no JavaScript errors');
  } finally { b.close(); }
});
