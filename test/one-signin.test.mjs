// One sign-in (Nov 25; Figma 09 · Idea Board section 50, approved Nov 25: "go with your choice"). Everyone signs in with email
// and password. Join with a Code is sign-up only (code → restaurant → name, email, password; no PIN). People who joined with
// a PIN move over once with Set Up Your Sign-In (find your name → the old PIN once → email and password); after that the PIN
// stops working. Nobody is locked out: a PIN person signed in stays signed in, and the PIN still gets them in, through the move.
// API part, then a browser part (needs Chrome and a built dist/; skipped otherwise): Join with a Code and Set Up Your Sign-In
// end to end at 390 and 1440 (Title Case buttons, 44 px targets, nothing wider than the screen, contrast ≥ 4.5 : 1 on the card).
// ONE_SIGNIN_SHOTS=<folder> saves a screenshot of each screen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, addPinStaff, sessionCookieFor, startServer, startChrome } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-one-signin-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const BROWSER = CHROME && fs.existsSync(path.join(root, 'dist/index.html')) ? {} : { skip: 'needs a build (npm run build) and Chrome' };
const SHOTS = process.env.ONE_SIGNIN_SHOTS || null;
let server;
before(async () => {
  giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@one.test', SUPERADMIN_EMAIL: 'tommy@one.test', RESEND_API_KEY: '', MAIL_FROM: '', PREP_WEEKLY: 'off' }));
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

let ipN = 10;
function person(jar = '') {
  const ip = `10.25.0.${ipN++}`;
  const p = { jar, ip };
  p.call = async (u, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + u, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(p.jar ? { Cookie: p.jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) p.jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return p;
}
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const owner = person();
let code = '', storeA = 0, storeB = 0, marisolId = 0;

test('setup: an owner, two restaurants, and a staff member who joined with a PIN (signed in on her phone)', async () => {
  assert.equal((await owner.call('/api/setup', { method: 'POST', body: { name: 'Odile Owner', email: 'owner@one.test', password: 'owner-pass-1' } })).status, 200);
  const team = (await owner.call('/api/team')).data;
  code = team.company.joinCode; storeA = team.stores[0].id;
  const add = await owner.call('/api/team/stores', { method: 'POST', body: { name: 'Ironbark Ferndale' } });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  storeB = (await owner.call('/api/team')).data.stores.find((s) => s.name === 'Ironbark Ferndale').id;
  marisolId = await addPinStaff(dir, { name: 'Marisol Vega', pin: '2468', storeId: storeB });
});

test('Join with a Code: name, email and password; no PIN; the email is theirs alone; they sign in with it', async () => {
  const delia = person();
  const base = { code, name: 'Delia Marsh', email: 'delia.marsh@one.test', password: 'delia-pass-01', storeId: storeB };
  assert.equal((await delia.call('/api/join', { method: 'POST', body: { ...base, email: 'not-an-email' } })).status, 400);
  assert.equal((await delia.call('/api/join', { method: 'POST', body: { ...base, password: 'short' } })).status, 400);
  assert.equal((await delia.call('/api/join', { method: 'POST', body: { ...base, password: 'delia.marsh@one.test' } })).status, 400, 'not their email');
  const used = await delia.call('/api/join', { method: 'POST', body: { ...base, email: 'Owner@One.test' } });
  assert.equal(used.status, 409); assert.equal(used.data.error, 'That email already has an account. Sign in with it instead.');
  const wrong = await delia.call('/api/join', { method: 'POST', body: { ...base, code: 'ZZZZ9999' } });
  assert.equal(wrong.status, 404); assert.equal(wrong.data.error, 'We don’t know that code. Check it with your manager.');
  assert.equal((await delia.call('/api/join', { method: 'POST', body: { ...base, storeId: 99999 } })).status, 400, 'pick a restaurant when there are several');
  // Marisol joined with a PIN: joining again by name would start her over, so she's sent to move over instead
  const again = await person().call('/api/join', { method: 'POST', body: { ...base, name: 'marisol vega', email: 'marisol.again@one.test' } });
  assert.equal(again.status, 409); assert.match(again.data.error, /already joined with a PIN.*Set Up Your Sign-In/);
  const r = await delia.call('/api/join', { method: 'POST', body: { ...base, email: 'Delia.Marsh@One.test' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.user.name, r.data.user.role, r.data.user.email, r.data.user.storeId], ['Delia Marsh', 'staff', 'delia.marsh@one.test', storeB]);
  const d = db(); const row = d.prepare('SELECT * FROM users WHERE id = ?').get(r.data.user.id); d.close();
  assert.equal(row.pin_hash, null, 'no PIN'); assert.match(row.password_hash, /^scrypt\$/, 'hashed like every password');
  assert.ok(!(await person().call(`/api/join/${code}`)).data.staff.some((s) => s.name === 'Delia Marsh'), 'never on the Set Up list');
  const back = await person().call('/api/login', { method: 'POST', body: { email: 'delia.marsh@one.test', password: 'delia-pass-01' } });
  assert.equal(back.status, 200); assert.equal(back.data.user.id, r.data.user.id);
  assert.equal((await person().call('/api/join', { method: 'POST', body: { ...base, email: 'delia2@one.test' } })).status, 409, 'one Delia Marsh per company');
  assert.ok((await owner.call('/api/audit')).data.audit.some((a) => a.action === 'joined with the code' && /Delia Marsh/.test(a.detail)));
  const wrongPw = await person().call('/api/login', { method: 'POST', body: { email: 'delia.marsh@one.test', password: 'not-her-password' } });
  assert.equal(wrongPw.data.error, 'That email and password don’t match. Try again, or reset it below.');
});

test('nobody signs in with a PIN; a PIN person signed in stays signed in until they move', async () => {
  const phone = person(sessionCookieFor(dir, marisolId));
  assert.equal((await phone.call('/api/me')).data.user.name, 'Marisol Vega', 'her phone stays signed in');
  const r = await person().call('/api/staff-login', { method: 'POST', body: { code, id: marisolId, pin: '2468' } });
  assert.equal(r.status, 410); assert.match(r.data.error, /Set Up Your Sign-In/);
  const list = (await person().call(`/api/join/${code}`)).data.staff;
  assert.deepEqual(list.map((s) => [s.name, s.needsPin, s.storeId]), [['Marisol Vega', false, storeB]]);
});

test('Set Up Your Sign-In: the old PIN once, then email and password; the PIN stops working; she is in', async () => {
  const p = person();
  assert.equal((await p.call('/api/set-up/check', { method: 'POST', body: { code, id: marisolId, pin: '1111' } })).status, 401, 'wrong PIN');
  assert.equal((await p.call('/api/set-up/check', { method: 'POST', body: { code: 'ZZZZ9999', id: marisolId, pin: '2468' } })).status, 404, 'wrong code');
  const chk = await p.call('/api/set-up/check', { method: 'POST', body: { code, id: marisolId, pin: '2468' } });
  assert.equal(chk.status, 200); assert.deepEqual([chk.data.name, chk.data.email], ['Marisol Vega', null]);
  assert.equal((await p.call('/api/me')).data.user, null, 'the PIN alone signs no one in');
  const save = (body) => p.call('/api/set-up/save', { method: 'POST', body: { ticket: chk.data.ticket, ...body } });
  assert.equal((await save({ email: 'delia.marsh@one.test', password: 'marisol-pass-1' })).status, 409, 'someone else’s email');
  assert.equal((await save({ email: 'marisol.vega@one.test', password: 'short' })).status, 400);
  assert.equal((await save({ email: 'bad', password: 'marisol-pass-1' })).status, 400);
  assert.equal((await person().call('/api/set-up/save', { method: 'POST', body: { ticket: 'not-a-ticket', email: 'marisol.vega@one.test', password: 'marisol-pass-1' } })).status, 410);
  const old = person(sessionCookieFor(dir, marisolId));
  const ok = await save({ email: 'Marisol.Vega@One.test', password: 'marisol-pass-1' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.user.id, ok.data.user.email, ok.data.user.role], [marisolId, 'marisol.vega@one.test', 'staff']);
  assert.equal((await p.call('/api/me')).data.user.id, marisolId, 'signed in');
  assert.equal((await old.call('/api/me')).data.user, null, 'her old PIN session ends');
  const d = db(); const row = d.prepare('SELECT * FROM users WHERE id = ?').get(marisolId); d.close();
  assert.equal(row.pin_hash, null, 'the PIN is gone'); assert.match(row.password_hash, /^scrypt\$/);
  assert.equal((await save({ email: 'marisol.vega@one.test', password: 'marisol-pass-2' })).status, 410, 'once');
  assert.equal((await person().call('/api/set-up/check', { method: 'POST', body: { code, id: marisolId, pin: '2468' } })).status, 404, 'the PIN opens nothing now');
  assert.deepEqual((await person().call(`/api/join/${code}`)).data.staff, [], 'off the list');
  assert.equal((await person().call('/api/login', { method: 'POST', body: { email: 'marisol.vega@one.test', password: 'marisol-pass-1' } })).status, 200);
  assert.ok((await owner.call('/api/audit')).data.audit.some((a) => a.action === 'moved to email sign-in' && /Marisol Vega/.test(a.detail)));
  // People: her row says email; Reset PIN is refused (Set Temporary Password is the manager's route now)
  const row2 = (await owner.call('/api/team')).data.people.find((x) => x.id === marisolId);
  assert.deepEqual([row2.emailSignIn, row2.hasPin, row2.email], [true, false, 'marisol.vega@one.test']);
  const rp = await owner.call(`/api/team/${marisolId}/reset-pin`, { method: 'POST' });
  assert.equal(rp.status, 400); assert.match(rp.data.error, /Set Temporary Password/);
});

test('a PIN a manager reset: Set Up skips the PIN; Forgot Password? is open to staff with an email', async () => {
  const teo = await addPinStaff(dir, { name: 'Teodor Brask', pin: '9753', storeId: storeA });
  assert.equal((await owner.call(`/api/team/${teo}/reset-pin`, { method: 'POST' })).status, 200);
  assert.equal((await person().call(`/api/join/${code}`)).data.staff.find((s) => s.id === teo).needsPin, true);
  const p = person();
  const chk = await p.call('/api/set-up/check', { method: 'POST', body: { code, id: teo } });
  assert.equal(chk.status, 200);
  assert.equal((await p.call('/api/set-up/save', { method: 'POST', body: { ticket: chk.data.ticket, email: 'teodor@one.test', password: 'teodor-pass-1' } })).status, 200);
  // Forgot Password? (email isn't set up in tests: the ask is logged, nothing sent, the same answer for every email)
  const f = await person().call('/api/password/forgot', { method: 'POST', body: { email: 'marisol.vega@one.test' } });
  assert.equal(f.status, 200);
  const d = db(); assert.ok(d.prepare("SELECT 1 FROM audit WHERE action = 'reset asked' AND user_id = ?").get(marisolId), 'staff can ask'); d.close();
});

test('the Set Up address is reserved and serves the app (and an account’s, in its look)', async () => {
  const r = await fetch(BASE + '/set-up-sign-in');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<div id="root">|id="root"/);
});

/* ---------------- in a browser ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function browser() {
  const { proc, port, profile } = await startChrome(CHROME, { profilePrefix: 'bt-one-chrome-' }); // Chrome picks a free debugging port (Nov 26)
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
  await send('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-For': '10.26.0.9' } });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const size = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 800 ? 844 : 900, deviceScaleFactor: w < 800 ? 3 : 1, mobile: w < 800 });
  const until = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 100) { const v = await ev(expr); if (v) return v; await sleep(100); } return ev(expr); };
  const go = async (url) => { await send('Page.navigate', { url }); await sleep(300); await until(`!!document.querySelector('h1') && !document.querySelector('.loader')`); await sleep(250); };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
  const close = () => { try { ws.close(); } catch { /* gone */ } proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } };
  return { ev, until, go, size, shot, close, errors };
}
const typeInto = (sel, value) => `(()=>{const i=document.querySelector(${JSON.stringify(sel)});if(!i)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;
const click = (label) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`;
const h1 = `document.querySelector('h1')?.textContent.trim().toLowerCase()`; // (The Baldwin's look sets titles in capitals)
/** The screen's checks: title, buttons in Title Case, 44 px targets, nothing wider than the screen, contrast on the card. */
const CHECK = `(()=>{
  const lum=(c)=>{let m=c.match(/[\\d.]+/g).map(Number);if(/^color\\(srgb/.test(c))m=m.map(v=>v*255);const f=(v)=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])};
  const bg=(el)=>{for(let e=el;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;const a=c.match(/[\\d.]+/g);if(a&&(a.length<4||+a[3]>.9))return c}return 'rgb(255,255,255)'};
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const low=[];for(const el of document.querySelectorAll('.si-side *')){if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;const s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none'||!el.getClientRects().length)continue;
    const r=ratio(s.color,bg(el));if(r<4.5)low.push(el.textContent.trim().slice(0,40)+' '+r.toFixed(2))}
  const small=[...document.querySelectorAll('.si-side button, .si-side a, .si-side input')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<44&&!e.closest('.si-legal')).map(e=>(e.textContent||e.getAttribute('type')||'').trim().slice(0,30)+' '+Math.round(e.getBoundingClientRect().height));
  const buttons=[...document.querySelectorAll('.si-side button.btn, .si-side a.btn')].map(b=>b.textContent.trim());
  return {title:document.querySelector('h1')?.textContent.trim(),kicker:document.querySelector('.si-kicker')?.textContent.trim()||null,low,small,buttons,wide:document.documentElement.scrollWidth>innerWidth,
    text:document.querySelector('.si-side')?.innerText||''}})()`;
const titleCase = (s) => s.split(/\s+/).every((w, i) => !/^[a-z]/.test(w) || (i > 0 && ['a', 'an', 'and', 'of', 'the', 'to', 'or', 'at', 'by', 'with'].includes(w)));

test('browser: Join with a Code and Set Up Your Sign-In, end to end, at 390 and 1440', BROWSER, async () => {
  const b = await browser();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const look = async (name, w) => {
    const c = await b.ev(CHECK);
    assert.deepEqual(c.low, [], `${name} @${w}: contrast`); assert.deepEqual(c.small, [], `${name} @${w}: 44 px targets`);
    assert.equal(c.wide, false, `${name} @${w}: nothing wider than the screen`);
    for (const t of c.buttons) assert.ok(titleCase(t), `${name}: "${t}" in Title Case`);
    assert.doesNotMatch(c.text, /owners? and managers?|\bstaff\b/i, `${name}: no role labels`);
    if (SHOTS) await b.shot(path.join(SHOTS, `${name} · ${w}.png`));
    return c;
  };
  try {
    for (const w of [390, 1440]) {
      await b.size(w);
      await b.ev('localStorage.clear()'); await fetch(BASE + '/api/logout', { method: 'POST', headers: { 'X-BT': '1' } });
      // Sign In, the front door (the root)
      await b.go(BASE + '/');
      let c = await look('1 sign-in', w);
      assert.equal(c.title.toLowerCase(), 'sign in'); assert.deepEqual(c.buttons, ['Sign In', 'Join with a Code']);
      assert.match(c.text, /New here\? Your manager has the code\./); assert.match(c.text, /Joined with a PIN\? Set Up Your Sign-In/);
      // Join with a Code → Where Do You Work? → About You → You're In → Home
      await b.ev(`[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Join with a Code').click()`);
      assert.equal(await b.until(`${h1}==='join with a code' && location.pathname==='/join'`), true);
      c = await look('2a join · code', w); assert.equal(c.kicker, 'Step 1 of 3');
      await b.ev(typeInto('.si input', 'ZZZZ9999')); await b.ev(click('Continue'));
      assert.match(await b.until(`document.querySelector('.si [role=alert]')?.textContent`), /We don’t know that code/);
      await look('5b join · unknown code', w);
      await b.ev(typeInto('.si input', code)); await b.ev(click('Continue'));
      assert.equal(await b.until(`${h1}==='where do you work?'`), true);
      c = await look('2b join · store', w); assert.match(c.kicker, /^Step 2 of 3 · /);
      await b.ev(`[...document.querySelectorAll('.si-choice')].find(x=>x.textContent.includes('Ironbark Ferndale')).click()`);
      assert.equal(await b.until(`${h1}==='about you'`), true);
      c = await look('2c join · about you', w); assert.equal(c.kicker, 'Step 3 of 3 · Ironbark Ferndale');
      const email = `nadia.${w}@one.test`;
      await b.ev(typeInto('.si input[autocomplete=name]', `Nadia Quist ${w}`));
      await b.ev(typeInto('.si input[type=email]', 'owner@one.test'));
      await b.ev(typeInto('.si input[type=password]', 'nadia-pass-01'));
      await b.ev(`document.querySelector('.si form').requestSubmit()`);
      assert.match(await b.until(`document.querySelector('.si [role=alert]')?.textContent`), /That email already has an account/);
      assert.equal(await b.ev(`document.querySelector('.si input[type=email]').getAttribute('aria-invalid')`), 'true', 'the email field is the one marked');
      await look('5c join · email used', w);
      await b.ev(typeInto('.si input[type=email]', email)); await b.ev(`document.querySelector('.si form').requestSubmit()`);
      assert.equal(await b.until(`${h1}==='you’re in, nadia'`), true);
      c = await look('2d join · you’re in', w); assert.match(c.text, new RegExp(email.replace('.', '\\.')));
      await b.ev(click('Start Training'));
      assert.equal(await b.until(`location.pathname==='/' && !document.querySelector('.si')`), true, 'Home');
      // Signed out again, this computer opens Sign In (it's on email sign-in now), not Set Up
      await b.ev(`fetch('/api/logout',{method:'POST',headers:{'X-BT':'1'}})`); await b.go(BASE + '/');
      assert.equal(await b.ev(h1), 'sign in');

      // A phone that joined with a PIN: Set Up Your Sign-In opens by itself
      const name = `Pilar Okafor ${w}`;
      await addPinStaff(dir, { name, pin: '8642', storeId: storeA });
      await b.ev(`localStorage.clear(); localStorage.setItem('bt-join-code', ${JSON.stringify(code)})`);
      await b.go(BASE + '/');
      assert.equal(await b.until(`${h1}==='set up your sign-in' && !!document.querySelector('.si-choice')`), true, 'opens by itself');
      c = await look('3a set up · find your name', w); assert.equal(c.kicker, 'One time · Step 1 of 3');
      await b.ev(typeInto('.si input[type=search]', 'pilar'));
      await b.ev(`[...document.querySelectorAll('.si-choice')].find(x=>x.textContent.trim()===${JSON.stringify(name)}).click()`);
      assert.equal(await b.until(`${h1}==='hi, pilar'`), true);
      c = await look('3b set up · old PIN', w); assert.equal(c.kicker, 'One time · Step 2 of 3');
      await b.ev(typeInto('.si input[type=password]', '1111')); await b.ev(click('Continue'));
      assert.match(await b.until(`document.querySelector('.si [role=alert]')?.textContent`), /That PIN isn’t right/);
      await b.ev(typeInto('.si input[type=password]', '8642')); await b.ev(click('Continue'));
      assert.equal(await b.until(`${h1}==='your email and password'`), true);
      c = await look('3c set up · email and password', w); assert.match(c.text, /After you save, your PIN stops working\./);
      await b.ev(typeInto('.si input[type=email]', `pilar.${w}@one.test`)); await b.ev(typeInto('.si input[type=password]', 'pilar-pass-01'));
      await b.ev(click('Save and Continue'));
      assert.equal(await b.until(`location.pathname==='/' && !document.querySelector('.si')`), true, 'moved over, Home');
      await b.ev(`fetch('/api/logout',{method:'POST',headers:{'X-BT':'1'}})`); await b.go(BASE + '/');
      assert.equal(await b.ev(h1), 'sign in', 'once moved, the phone opens Sign In');

      // Already signed in on /join: You're Signed In
      await b.ev(`fetch('/api/login',{method:'POST',headers:{'X-BT':'1','Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(`pilar.${w}@one.test`)},password:'pilar-pass-01'})})`);
      await b.go(BASE + '/join');
      c = await look('6 already signed in', w); assert.equal(c.title.toLowerCase(), 'you’re signed in'); assert.match(c.text, new RegExp(`signed in as ${name} \\(pilar\\.${w}@one\\.test\\)`));
      await b.ev(`fetch('/api/logout',{method:'POST',headers:{'X-BT':'1'}})`);
    }
    assert.deepEqual(b.errors, [], 'no JavaScript errors');
  } finally { b.close(); }
});
