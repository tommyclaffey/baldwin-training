// Start Your Restaurant (Nov 25; Figma 09 · Idea Board section 48; approved Nov 25, free until prices and Stripe exist).
// API: the email and link checks, what a sign-up makes (company, store, owner signed in, plan, state, join code, link,
// signed_up_at), Super Admin sees it (tag + log), the Get Ready checklist (real data, leaves when done, never for a company
// set up by hand), limits; with email on (a fake Resend): Check Your Email, the link works once.
// Browser (needs Chrome and a built dist/): the four steps and Home's checklist at 390 and 1440 (contrast ≥ 4.5 : 1 on the
// card, 44 px targets, Title Case buttons, nothing wider than the screen). SIGN_UP_SHOTS=<folder> saves screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, turnOnTwoStep } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-signup-')), dirMail = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-signup-mail-'));
const PORT = 2200 + Math.floor(Math.random() * 100), PORT_MAIL = 2300 + Math.floor(Math.random() * 90), PORT_RESEND = 2395 + Math.floor(Math.random() * 4);
const BASE = `http://127.0.0.1:${PORT}`, BASE_MAIL = `http://127.0.0.1:${PORT_MAIL}`;
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const BROWSER = CHROME && fs.existsSync(path.join(root, 'dist/index.html')) ? {} : { skip: 'needs a build (npm run build) and Chrome' };
const SHOTS = process.env.SIGN_UP_SHOTS || null;
const servers = []; const mails = []; let resend;
async function start(port, data, extra = {}) {
  giveAccount(data);
  const s = spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_DIR: data, OWNER_EMAIL: 'owner@signup.test', SUPERADMIN_EMAIL: 'tommy@signup.test', RESEND_API_KEY: '', MAIL_FROM: '', PREP_WEEKLY: 'off', ...extra } });
  servers.push(s);
  for (let i = 0; i < 300; i++) { try { await fetch(`http://127.0.0.1:${port}/api/me`); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
}
before(async () => {
  resend = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { mails.push(JSON.parse(b)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"x"}'); }); });
  await new Promise((r) => resend.listen(PORT_RESEND, '127.0.0.1', r));
  await Promise.all([start(PORT, dir), start(PORT_MAIL, dirMail, { RESEND_API_KEY: 're_test', MAIL_FROM: 'Mise <hi@mise.test>', RESEND_API_URL: `http://127.0.0.1:${PORT_RESEND}/emails`, APP_URL: 'https://app.mise.test' })]);
});
after(() => { for (const s of servers) s.kill(); resend?.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dirMail, { recursive: true, force: true }); });

let ipN = 10;
function person(base = BASE) {
  const ip = `10.31.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;
  const p = { jar: '', ip };
  p.call = async (u, { method = 'GET', body } = {}) => {
    const res = await fetch(base + u, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(p.jar ? { Cookie: p.jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) p.jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return p;
}
const db = (d = dir) => new DatabaseSync(path.join(d, 'baldwin.db'));
const tommy = person();
const ivy = { name: 'Ivy Okonjo', email: 'ivy@ironbark.test', password: 'a short sentence works' };
const place = { company: 'Ironbark Hospitality', slug: 'ironbark', store: 'Ironbark Kitchen', state: 'Ohio', size: '1', plan: 'foundation' };

test('setup: the super admin (two-step on) and the owner of company 1', async () => {
  assert.equal((await person().call('/api/setup', { method: 'POST', body: { name: 'Odile Owner', email: 'owner@signup.test', password: 'owner-pass-1' } })).status, 200);
  assert.equal((await tommy.call('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@signup.test', password: 'super-pass-1' } })).status, 200);
  await turnOnTwoStep(tommy.call, { workIn: null });
});

test('the checks: info, the email (step 1), the link (step 2)', async () => {
  const p = person();
  const info = (await p.call('/api/sign-up/info')).data;
  assert.equal(info.mailOn, false); assert.ok(info.states.includes('Ohio')); assert.equal(typeof info.library.classics, 'number');
  assert.equal((await p.call('/api/sign-up/email', { method: 'POST', body: { email: 'nope' } })).status, 400);
  const used = await p.call('/api/sign-up/email', { method: 'POST', body: { email: 'Owner@Signup.test' } });
  assert.equal(used.status, 409); assert.equal(used.data.error, 'There’s already an account with this email.');
  assert.equal((await p.call('/api/sign-up/email', { method: 'POST', body: { email: ivy.email } })).status, 200);
  const free = (await p.call('/api/sign-up/link?slug=ironbark')).data;
  assert.deepEqual([free.available, free.reason], [true, null]);
  for (const s of ['join', 'sign-in', 'demo', 'admin', 'set-up-sign-in']) assert.equal((await p.call(`/api/sign-up/link?slug=${s}`)).data.available, false, s + ' is the app’s');
  assert.match((await p.call('/api/sign-up/link?slug=a')).data.reason, /2 to 40/);
  assert.equal((await p.call('/api/sign-up/email', { method: 'POST', body: {} })).status, 400);
  assert.equal((await p.call('/api/sign-up/start', { method: 'POST', body: ivy })).status, 409, 'no email to send while email is off');
});

test('signing up makes the company, its first store and the owner (signed in); free, the plan picked; Super Admin sees it', async () => {
  const p = person();
  const bad = async (body, status, re) => { const r = await p.call('/api/sign-up', { method: 'POST', body: { ...ivy, ...place, ...body } }); assert.equal(r.status, status, JSON.stringify(body)); if (re) assert.match(r.data.error, re); };
  await bad({ password: 'short' }, 400, /Too short/);
  await bad({ email: 'owner@signup.test' }, 409, /already an account/);
  await bad({ company: 'x' }, 400, /company or group name/);
  await bad({ slug: 'join' }, 409, /taken/);
  await bad({ state: 'Atlantis' }, 400, /state/);
  const r = await p.call('/api/sign-up', { method: 'POST', body: { ...ivy, ...place } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.user.name, r.data.user.role, r.data.user.email, r.data.user.store.name], ['Ivy Okonjo', 'owner', ivy.email, 'Ironbark Kitchen']);
  assert.equal((await p.call('/api/me')).data.user.workingInName, 'Ironbark Hospitality', 'signed in');
  const d = db(); const co = d.prepare('SELECT * FROM companies WHERE slug = ?').get('ironbark');
  const u = d.prepare('SELECT * FROM users WHERE email = ?').get(ivy.email); d.close();
  assert.deepEqual([co.name, co.plan, co.brand, co.state, !!co.signed_up_at, /^[A-Z0-9]{8}$/.test(co.join_code)], ['Ironbark Hospitality', 'foundation', 'mise', 'Ohio', true, true]);
  assert.match(u.password_hash, /^scrypt\$/); assert.equal(u.company_id, co.id);
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: ivy.email, password: ivy.password } })).status, 200);
  assert.equal((await p.call('/api/sign-up/link?slug=ironbark')).data.available, false, 'the link is theirs now');
  const sug = (await p.call('/api/sign-up/link?slug=ironbark&company=Ironbark%20Hospitality&store=Ironbark%20Kitchen&state=Ohio')).data.suggestions;
  assert.ok(sug.length >= 2 && sug.every((s) => /^[a-z0-9-]+$/.test(s) && s !== 'ironbark'), sug.join());
  // Super Admin: listed, tagged, logged
  const ov = (await tommy.call('/api/super/overview')).data.companies.find((c) => c.id === co.id);
  assert.ok(ov.signedUpAt); assert.equal(ov.link, '/ironbark'); assert.equal(ov.plan, 'foundation');
  const log = (await tommy.call('/api/super/log')).data.log.find((l) => l.action === 'company signed up');
  assert.match(log.detail, /Ironbark Hospitality · Ironbark Kitchen · Foundation · 1 location · Ohio · ivy@ironbark\.test · free until prices are set/);
  // the link opens its sign-in
  assert.equal((await fetch(BASE + '/ironbark')).status, 200);
  // the same email again
  assert.equal((await person().call('/api/sign-up', { method: 'POST', body: { ...ivy, ...place, slug: 'ironbark-2' } })).status, 409);
});

test('Get Ready on Home: real lines, Your Look optional on Foundation, done as things happen; never for a company set up by hand', async () => {
  const p = person(); assert.equal((await p.call('/api/login', { method: 'POST', body: { email: ivy.email, password: ivy.password } })).status, 200);
  let g = (await p.call('/api/manager/home')).data.getReady;
  assert.deepEqual([g.done, g.total], [2, 6]);
  assert.deepEqual(g.items.map((i) => [i.key, i.done]), [['account', true], ['restaurant', true], ['menu', false], ['team', false], ['paths', false], ['drinks', false], ['look', false]]);
  assert.equal(g.items.find((i) => i.key === 'look').optional, true);
  assert.match(g.items[1].detail, /Ironbark Kitchen · miseacademy\.app\/ironbark · Ohio/);
  // someone joins with the code: Invite your team is done
  const code = (await p.call('/api/team')).data.company.joinCode;
  assert.equal((await person().call('/api/join', { method: 'POST', body: { code, name: 'Rafe Lindqvist', email: 'rafe@ironbark.test', password: 'rafe-pass-001' } })).status, 200);
  g = (await p.call('/api/manager/home')).data.getReady;
  assert.equal(g.items.find((i) => i.key === 'team').done, true); assert.equal(g.done, 3);
  // everything counted done → the card leaves
  const d = db(); const co = d.prepare("SELECT id FROM companies WHERE slug = 'ironbark'").get();
  const st = d.prepare('SELECT id FROM stores WHERE company_id = ?').get(co.id);
  d.prepare("UPDATE users SET jobs = '[\"server\"]' WHERE email = 'rafe@ironbark.test'").run();
  for (const col of ['recipe', 'house']) d.prepare("INSERT INTO entries(collection, slug, data, sort, company_id, store_id, created_at) VALUES (?,?,?,0,?,?,?)").run(col, `test-${col}-${co.id}`, '{"name":"Test"}', co.id, st.id, new Date().toISOString());
  d.close();
  assert.equal((await p.call('/api/manager/home')).data.getReady, null, 'all done: no card');
  // company 1, set up by hand: never
  const o = person(); assert.equal((await o.call('/api/login', { method: 'POST', body: { email: 'owner@signup.test', password: 'owner-pass-1' } })).status, 200);
  assert.equal((await o.call('/api/manager/home')).data.getReady, null);
});

test('Custom Brand: the plan they pick is the plan they get (free for now), and Your Look counts', async () => {
  const p = person();
  const r = await p.call('/api/sign-up', { method: 'POST', body: { name: 'Tamsin Rowe', email: 'tamsin@lark.test', password: 'tamsin-pass-01', company: 'Lark & Ledger', slug: 'lark-and-ledger', store: '', state: '', size: '2-5', plan: 'custom-brand' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.store.name, 'Lark & Ledger', 'first location defaults to the company name');
  assert.equal(r.data.user.yourLook, 'full', 'Your Look open');
  const g = (await p.call('/api/manager/home')).data.getReady;
  assert.equal(g.total, 7); assert.equal(g.items.find((i) => i.key === 'look').optional, false);
});

test('limits: five sign-ups a day from one address', async () => {
  const p = person(); const s = [];
  for (let i = 0; i < 6; i++) s.push((await p.call('/api/sign-up', { method: 'POST', body: { name: 'Limit Test', email: `limit${i}@signup.test`, password: 'limit-pass-01', company: `Limit Test ${i}`, slug: `limit-test-${i}`, store: '', state: '', size: '1', plan: 'foundation' } })).status);
  assert.deepEqual(s, [200, 200, 200, 200, 200, 429]);
});

test('email on: Check Your Email, the link opens step 2, works once; nothing made before it', async () => {
  const p = person(BASE_MAIL);
  assert.equal((await p.call('/api/sign-up/info')).data.mailOn, true);
  assert.equal((await p.call('/api/sign-up', { method: 'POST', body: { ...ivy, ...place } })).status, 400, 'no straight sign-up while email is on');
  const s = await p.call('/api/sign-up/start', { method: 'POST', body: ivy });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const m = mails.at(-1); assert.deepEqual(m.to, [ivy.email]); assert.match(m.subject, /Finish setting up/);
  const token = /verify=([A-Za-z0-9_-]+)/.exec(m.text)[1];
  assert.match(m.text, /https:\/\/app\.mise\.test\/sign-up\?verify=/);
  const d = db(dirMail); assert.equal(d.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get(ivy.email).n, 0, 'no account yet'); d.close();
  assert.deepEqual((await p.call(`/api/sign-up/verify/${token}`)).data, { valid: true, name: 'Ivy Okonjo', email: ivy.email });
  const r = await p.call('/api/sign-up', { method: 'POST', body: { verify: token, ...place } });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.user.email, ivy.email);
  assert.equal((await p.call(`/api/sign-up/verify/${token}`)).data.valid, false, 'once');
  assert.equal((await person(BASE_MAIL).call('/api/sign-up', { method: 'POST', body: { verify: token, ...place, slug: 'ironbark-again' } })).status, 410);
});

/* ---------------- in a browser ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function browser() {
  const port = 2500 + Math.floor(Math.random() * 150); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-signup-chrome-'));
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
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const size = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 800 ? 844 : 900, deviceScaleFactor: w < 800 ? 3 : 1, mobile: w < 800 });
  const until = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 100) { const v = await ev(expr); if (v) return v; await sleep(100); } return ev(expr); };
  const go = async (url) => { await send('Page.navigate', { url }); await sleep(300); await until(`!!document.querySelector('h1') && !document.querySelector('.loader')`); await sleep(250); };
  const shot = async (file, full = false) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
  const close = () => { try { ws.close(); } catch { /* gone */ } proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } };
  return { ev, until, go, size, shot, close, errors, send };
}
const typeInto = (sel, value) => `(()=>{const i=document.querySelector(${JSON.stringify(sel)});if(!i)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;
const pickSelect = (sel, value) => `(()=>{const i=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('change',{bubbles:true}));return true})()`;
const click = (label) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`;
const h1 = `document.querySelector('h1')?.textContent.trim()`;
const CHECK = (scope) => `(()=>{
  const lum=(c)=>{let m=c.match(/[\\d.]+/g).map(Number);if(/^color\\(srgb/.test(c))m=m.map(v=>v*255);const f=(v)=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])};
  const bg=(el)=>{for(let e=el;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;const a=c.match(/[\\d.]+/g);if(a&&(a.length<4||+a[3]>.9))return c}return 'rgb(255,255,255)'};
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const low=[];for(const el of document.querySelectorAll('${scope} *')){if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;const s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none'||!el.getClientRects().length)continue;
    if(el.closest('button:disabled'))continue;const r=ratio(s.color,bg(el));if(r<4.5)low.push(el.textContent.trim().slice(0,40)+' '+r.toFixed(2))}
  const small=[...document.querySelectorAll('${scope} button, ${scope} a, ${scope} input:not([type=radio]), ${scope} select, ${scope} .su-chip, ${scope} .su-plan')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<44&&!e.closest('.si-legal')).map(e=>(e.textContent||e.tagName).trim().slice(0,30)+' '+Math.round(e.getBoundingClientRect().height));
  const buttons=[...document.querySelectorAll('${scope} button.btn, ${scope} a.btn, ${scope} .mg-btn')].map(b=>b.textContent.trim());
  return {low,small,buttons,wide:document.documentElement.scrollWidth>innerWidth}})()`;
const titleCase = (s) => s.split(/\s+/).every((w, i) => !/^[a-z]/.test(w) || (i > 0 && ['a', 'an', 'and', 'of', 'the', 'to', 'or', 'at', 'by', 'with'].includes(w)));

test('browser: Start Your Restaurant, the four steps and Home’s checklist, at 390 and 1440', BROWSER, async () => {
  const b = await browser();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const look = async (name, w, scope = '.si-side') => {
    const c = await b.ev(CHECK(scope));
    assert.deepEqual(c.low, [], `${name} @${w}: contrast`); assert.deepEqual(c.small, [], `${name} @${w}: 44 px targets`);
    assert.equal(c.wide, false, `${name} @${w}: nothing wider than the screen ` + await b.ev(`[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,5).map(e=>e.tagName+'.'+e.className+' '+Math.round(e.getBoundingClientRect().right)).join(' | ')`));
    for (const t of c.buttons) assert.ok(titleCase(t), `${name}: "${t}" in Title Case`);
    if (SHOTS) await b.shot(path.join(SHOTS, `${name} · ${w}.png`), true);
  };
  try {
    for (const w of [390, 1440]) {
      await b.size(w);
      await b.send('Network.clearBrowserCookies'); await b.send('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-For': `10.32.0.${w === 390 ? 1 : 2}` } });
      await b.go(BASE + '/sign-in');
      assert.ok(await b.ev(`[...document.querySelectorAll('.si-foot a')].some(a=>a.textContent.trim()==='Start Your Restaurant'&&a.getAttribute('href')==='/sign-up')`), 'linked under the Sign In card');
      await look('0 sign-in with start your restaurant', w);
      await b.go(BASE + '/sign-up');
      assert.equal(await b.ev(h1), 'Your Account');
      await look('1 your account', w);
      await b.ev(typeInto('.si input[autocomplete=name]', `Ines Valcourt`));
      await b.ev(typeInto('.si input[type=email]', 'owner@signup.test'));
      await b.ev(typeInto('.si input[type=password]', 'short'));
      await b.ev(`document.querySelector('.si form').requestSubmit()`);
      assert.match(await b.until(`document.querySelector('.si [role=alert]')?.textContent`), /Too short/);
      await look('1e password too short', w);
      await b.ev(typeInto('.si input[type=password]', 'ines is opening a bistro'));
      await b.ev(`document.querySelector('.si form').requestSubmit()`);
      assert.match(await b.until(`document.querySelector('.si [role=alert]')?.textContent`), /already an account.*Is it yours\? Sign In/);
      await look('1e email already used', w);
      await b.ev(typeInto('.si input[type=email]', `ines.${w}@signup.test`));
      await b.ev(`document.querySelector('.si form').requestSubmit()`);
      assert.equal(await b.until(`${h1}==='Your Restaurant'`), true);
      await b.ev(typeInto('.si input[autocomplete=organization]', 'Ironbark'));
      assert.match(await b.until(`document.querySelector('.si [role=alert]')?.textContent`), /That link is taken/);
      await look('2e link taken', w);
      await b.ev(`document.querySelector('.su-try .su-chip').click()`);
      assert.match(await b.until(`document.querySelector('.su-ok')?.textContent`), /Available/);
      await b.ev(typeInto('.si .su-link input', `valcourt-${w}`));
      assert.match(await b.until(`document.querySelector('.su-ok')?.textContent`), /Available/);
      await b.ev(typeInto('.si input[autocomplete=organization]', 'Valcourt Hospitality'));
      await b.ev(typeInto('.si input[name=store]', 'Valcourt Bistro'));
      await b.ev(pickSelect('.si select', 'Ohio'));
      await b.ev(`[...document.querySelectorAll('.su-chip')].find(x=>x.textContent.trim()==='2–5').click()`);
      await look('2 your restaurant', w);
      await b.ev(click('Continue'));
      assert.equal(await b.until(`${h1}==='Your Plan'`), true);
      await look('3 your plan', w);
      await b.ev(`document.querySelectorAll('.su-plan')[1].click()`);
      await b.ev(click('Continue'));
      assert.equal(await b.until(`${h1}==='Your Book Starts Here'`), true);
      await look('4 your book starts here', w);
      await b.ev(click('Open My Book'));
      assert.equal(await b.until(`location.pathname==='/admin' && !!document.querySelector('.gr-card')`), true, await b.ev(`location.pathname+' | '+document.body.innerText.slice(0,300)`));
      await sleep(400);
      assert.match(await b.ev(`document.querySelector('.gr-card').innerText`), /GET READY · 2 OF 7 DONE|Get ready · 2 of 7 done/i);
      await look('5 home · get ready', w, '.gr-card');
      await b.ev(`fetch('/api/logout',{method:'POST',headers:{'X-BT':'1'}})`);
    }
    assert.deepEqual(b.errors, [], 'no JavaScript errors');
  } finally { b.close(); }
});
