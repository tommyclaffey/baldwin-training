// People → Owners and managers: the row holds its layout (Nov 25). The four actions (Set Temporary Password, Reset
// Password, Change to Staff, Remove) stacked or wrapped in the actions cell, and ran off the side at 1025: the shared
// .row-actions rule made the cell a flex box, out of the table (the same thing Super Admin → People had, b45c335).
// Now the email sits under the name and the actions run in one line across the bottom of the person's row; under 640 px
// of room each person is a card. Checked with long names and emails at 1440, 1025 and 390: actions in one line on
// desktop, nothing overlaps, nothing runs off the side, 44 px targets. (Needs Chrome and a built dist/; skipped otherwise.)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { giveAccount } from './helpers.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browserOk = CHROME && fs.existsSync(path.join(root, 'dist', 'index.html')) ? {} : { skip: 'needs Chrome and a built dist/' };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-leads-'));
let server;
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('the Owners and managers table: email under the name, actions in their own wrapper, no stack-table', () => {
  const scr = fs.readFileSync(path.join(root, 'src/admin/screens.tsx'), 'utf8');
  const part = scr.slice(scr.indexOf('Owners and managers · {leads.length}'), scr.indexOf('{reset && <ResetLinkCard'));
  assert.match(part, /className="leads-wrap"/); assert.match(part, /'table leads-table'/);
  assert.match(part, /<small className="person-sub email">\{p\.email\}<\/small>/);
  assert.match(part, /<td className="row-actions"><div className="acts">/);
  assert.doesNotMatch(part, /stack-table/);
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  assert.match(css, /\.leads-table \.acts \{ display: flex; flex-wrap: nowrap;/);
  assert.match(css, /@container \(max-width: 640px\)/);
});

test('browser: long names and emails at 1440, 1025 and 390: one line of actions on desktop, nothing overlaps or runs off', browserOk, async () => {
  giveAccount(dir);
  const PORT = 10900 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}`;
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@leads.test', SUPERADMIN_EMAIL: 'x@leads.test', RESEND_API_KEY: '', MAIL_FROM: '', PREP_WEEKLY: 'off' } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); break; } catch { await sleep(100); } }
  let ip = 0;
  const person = () => { const p = { jar: '' }; const me = `10.6.${++ip}.1`; p.call = async (u, { method = 'GET', body } = {}) => { const r = await fetch(BASE + u, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': me, ...(p.jar ? { Cookie: p.jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const s = r.headers.get('set-cookie'); if (s) p.jar = s.split(';')[0]; return { status: r.status, data: await r.json().catch(() => null) }; }; return p; };
  const owner = person();
  assert.equal((await owner.call('/api/setup', { method: 'POST', body: { name: 'Marguerite Okonkwo-Valdés', email: 'owner@leads.test', password: 'long-enough-1' } })).status, 200);
  const team = (await owner.call('/api/team')).data;
  const people = [['Bartholomew Fitzgerald-Achterberg', 'bartholomew.fitzgerald-achterberg@thebaldwinrestaurantgroup.com', 'manager', team.stores[0]?.id ?? null],
    ['Anastasia Kowalczyk-Raghunathan', 'anastasia.kowalczyk@testabarra-macombtownship.com', 'manager', team.stores[1]?.id ?? null],
    ['Leopold Wexford', 'leo@jbaldwins.com', 'owner', null],
    ['Sebastián Castellanos-Penhallow', 'sebastian.castellanos.penhallow@baldwinrestaurantgroup.com', 'manager', null]];
  for (const [name, email, role, storeId] of people) {
    const inv = await owner.call('/api/team/invite', { method: 'POST', body: { email, role, storeId: role === 'manager' ? storeId : null } });
    assert.equal(inv.status, 200, JSON.stringify(inv.data));
    assert.equal((await person().call(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name, password: 'long-enough-1' } })).status, 200);
  }
  const port = 11000 + Math.floor(Math.random() * 90); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-leads-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    for (let i = 0; i < 100 && !ws; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); if (t) ws = new WebSocket(t.webSocketDebuggerUrl); } catch {} await sleep(200); }
    assert.ok(ws, 'Chrome started');
    if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pend = new Map(); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setCookie', { name: owner.jar.split('=')[0], value: owner.jar.split('=').slice(1).join('='), url: BASE });
    for (const [w, h] of [[1440, 1000], [1025, 900], [390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 });
      await send('Page.navigate', { url: `${BASE}/admin/people/managers` });
      for (let i = 0; i < 60 && !(await ev(`document.querySelectorAll('.leads-table tbody tr').length >= 5`)); i++) await sleep(250);
      await sleep(500);
      const m = await ev(`(()=>{
        const W=document.documentElement.clientWidth;
        const rows=[...document.querySelectorAll('.leads-table tbody tr')].map(tr=>{
          const btns=[...tr.querySelectorAll('td.row-actions button')]; const rs=btns.map(b=>b.getBoundingClientRect());
          const cells=[...tr.children].filter(td=>getComputedStyle(td).display!=='none').map(td=>td.getBoundingClientRect());
          const hit=(a,b)=>a.width&&b.width&&a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
          let overlap=0; for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++) if(hit(cells[i],cells[j])) overlap++;
          let btnOver=0; for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++) if(hit(rs[i],rs[j])) btnOver++;
          return {n:btns.length,lines:new Set(rs.map(r=>Math.round(r.top))).size,overlap,btnOver,off:rs.filter(r=>r.right>W+1||r.left<-1).length,minH:Math.min(...rs.map(r=>r.height)),
            labelOneLine:btns.every(b=>b.getBoundingClientRect().height<50)};
        });
        return {scrollW:document.documentElement.scrollWidth,W,rows};
      })()`);
      assert.equal(m.scrollW, m.W, `${w}: nothing runs off the side`);
      const withActs = m.rows.filter((r) => r.n);
      assert.equal(withActs.length, 4, `${w}: four people with actions`);
      for (const r of withActs) {
        assert.equal(r.n, 4, `${w}: four actions`);
        if (w > 700) assert.equal(r.lines, 1, `${w}: the actions sit in one line`);
        assert.equal(r.overlap, 0, `${w}: no cell sits on another`); assert.equal(r.btnOver, 0, `${w}: no button on another`);
        assert.equal(r.off, 0); assert.ok(r.minH >= 44, `${w}: 44 px targets`); assert.ok(r.labelOneLine, `${w}: no label wraps`);
      }
    }
  } finally { try { ws?.close(); } catch {} proc.kill(); await new Promise((r) => setTimeout(r, 500)); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
});
