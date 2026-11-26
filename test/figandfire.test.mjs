// The Mise demo is Fig & Fire (Nov 17, Tommy: the Mise demo, renamed from its old name, is Mise's official demo account;
// a name picked in between was dropped the same day). Sweep: nothing the Mise demo shows or answers names either old name,
// in either role, and no source the app is built from does either. The old names are spelled in halves here so this file
// doesn't trip its own sweep. The ampersand stays a plain "&" in JSON.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { giveAccount, startServer } from './helpers.mjs';

const OLD = new RegExp('wren' + 'field|salt' + 'well', 'i');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-figandfire-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;

before(async () => {
  giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@figandfire.test', PREP_WEEKLY: 'off' }));
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

function visitor(ip) {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.().find((c) => c.startsWith('bt_session=') && !/^bt_session=;/.test(c));
    if (set) jar = set.split(';')[0];
    return { status: res.status, text: await res.text() };
  };
}

for (const role of ['manager', 'employee']) {
  test(`the Mise demo (${role}) is Fig & Fire on every page and answer`, async () => {
    const v = visitor(role === 'manager' ? '10.17.0.1' : '10.17.0.2');
    assert.equal((await v('/api/demo/start', { method: 'POST', body: { role, demo: 'mise' } })).status, 200);
    const me = JSON.parse((await v('/api/me')).text).user;
    assert.equal(me.store.name, 'Fig & Fire');
    assert.equal(me.companyName, 'Fig & Fire');
    const index = (await v('/api/index')).text;
    assert.doesNotMatch(index, OLD);
    const files = [...new Set(JSON.parse(index).map((e) => e.file).filter(Boolean))];
    assert.ok(files.length > 100, `${files.length} pages`);
    const hits = [];
    const check = async (p) => { const r = await v(p); if (OLD.test(r.text)) hits.push(p); return r; };
    for (const f of files) await check('/api/page/' + f);
    for (const p of ['/api/me', '/api/chat', '/api/chat/room/foh', '/api/path', '/api/path/ack', '/api/collections', '/api/manager/home', '/api/team', '/api/team/stores', '/api/prep', '/api/demo/return']) await check(p);
    for (const c of ['recipe', 'house', 'wine', 'shelf', 'beer']) await check('/api/entries?collection=' + c);
    assert.deepEqual(hits, [], 'answers that still name the old restaurant');
    // its own pages name it: Our Story and the dish named for the restaurant
    const story = files.find((f) => f === '23-2');
    if (story) {
      const page = (await v('/api/page/23-2')).text;
      assert.match(page, /"Fig & Fire started with one idea/, 'a plain & in JSON');
      assert.doesNotMatch(page, /Fig (&amp;|\\u0026) Fire/);
    }
    if (role === 'manager') assert.match((await v('/api/entries?collection=recipe')).text, /Fig & Fire Burger/);
    await v('/api/demo/exit', { method: 'POST' });
  });
}

test('no source the app is built from names the old restaurant', () => {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', '.git', 'dist', 'raw'].includes(e.name)) walk(p); continue; }
      if (!/\.(m?js|tsx?|json|md|css|html)$/.test(e.name) || p === new URL(import.meta.url).pathname) continue;
      if (OLD.test(e.name) || OLD.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
    }
  };
  for (const d of ['src', 'server', 'content', 'public', 'scripts', 'test', 'docs']) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
  for (const f of ['README.md', 'SPEC.md', 'index.html']) if (OLD.test(fs.readFileSync(path.join(root, f), 'utf8'))) hits.push(f);
  for (const f of fs.readdirSync(path.join(root, 'public/img/demo-mise'))) if (OLD.test(f)) hits.push('public/img/demo-mise/' + f);
  assert.deepEqual(hits, []);
});
