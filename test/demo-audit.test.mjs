// Demo fixes from the Nov 15 audit (items 19–24). Runs the real server on a temp database; both demos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-demoaudit-'));
const PORT = 5750 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));

/** A visitor with their own cookie jar, from one address. */
function visitor(ip) {
  let jar = '';
  const call = async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.().find((c) => c.startsWith('bt_session=') && !/^bt_session=;/.test(c));
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return call;
}
const companyOf = (call) => call('/api/me').then((r) => r.data?.user?.companyId);

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@demoaudit.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('19 · switching employee ↔ manager is not a new demo start, and the old copy goes', async () => {
  const v = visitor('10.19.0.1');
  assert.equal((await v('/api/demo/start', { method: 'POST', body: { role: 'employee', demo: 'mise' } })).status, 200);
  const first = await companyOf(v);
  // 62 switches from one address: more than the fresh-start limit, none refused
  for (let i = 0; i < 62; i++) {
    const r = await v('/api/demo/start', { method: 'POST', body: { role: i % 2 ? 'employee' : 'manager', demo: 'mise' } });
    assert.equal(r.status, 200, `switch ${i + 1}`);
  }
  const d = db();
  assert.equal(d.prepare('SELECT COUNT(*) n FROM companies WHERE demo = 1').get().n, 1, 'one copy left, not 63');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM companies WHERE id = ?').get(first).n, 0, 'the first copy is gone');
  assert.equal(d.prepare("SELECT COUNT(*) n FROM limits WHERE name = 'demo-start'").get().n, 1, 'only the fresh start counted');
  d.close();
  // and the address can still start fresh demos (another tab, another visitor on the same Wi-Fi)
  assert.equal((await visitor('10.19.0.1')('/api/demo/start', { method: 'POST', body: { role: 'manager' } })).status, 200);
});

test('19 · fresh starts are limited per address, with a message', async () => {
  const ip = '10.19.0.2';
  const d = db();
  // 59 starts already this hour from this address (cheaper than making 59 copies)
  const ins = d.prepare("INSERT INTO limits(name, key, at) VALUES ('demo-start', ?, ?)");
  for (let i = 0; i < 59; i++) ins.run(ip, Date.now());
  d.close();
  assert.equal((await visitor(ip)('/api/demo/start', { method: 'POST', body: { role: 'employee' } })).status, 200, 'the 60th start works');
  const r = await visitor(ip)('/api/demo/start', { method: 'POST', body: { role: 'employee' } });
  assert.equal(r.status, 429, 'the 61st is refused');
  assert.match(r.data.error, /Too many demos/);
});

/** Start a demo as a fresh visitor; returns { call, company, store }. */
let ipN = 0;
async function demo(role, which) {
  const call = visitor(`10.30.${Math.floor(++ipN / 250)}.${ipN % 250}`);
  const r = await call('/api/demo/start', { method: 'POST', body: { role, demo: which } });
  assert.equal(r.status, 200);
  const company = await companyOf(call);
  const d = db();
  const store = d.prepare('SELECT id FROM stores WHERE company_id = ?').get(company).id;
  d.close();
  return { call, company, store };
}

for (const which of ['baldwin', 'mise']) {
  test(`21 · ${which} demo: the pinned pre-shift note names tonight's focus dish`, async () => {
    const { company, store } = await demo('employee', which);
    const d = db();
    // Home's Tonight's Pre-Shift Focus: the signature dish (server/home.mjs)
    const focus = d.prepare("SELECT data FROM entries WHERE collection = 'recipe' AND store_id = ? AND archived_at IS NULL").all(store)
      .map((r) => JSON.parse(r.data)).find((x) => x.signature);
    const pin = d.prepare('SELECT body FROM chat_messages WHERE company_id = ? AND pinned_at IS NOT NULL').get(company);
    d.close();
    assert.ok(focus, 'the demo menu has a signature dish');
    assert.match(pin.body, new RegExp(`^Focus dish: ${focus.name}\\.`));
  });
}

test('22 · a level whose final is seeded as passed has every section read (Marisol Level 1, Quinn Levels 1 and 2)', async () => {
  const { chaptersForLevel, LEVELS } = await import('../server/manual.mjs');
  const keysOf = (file) => chaptersForLevel(LEVELS.find((L) => L.file === file)).flatMap((c) => c.sections.map((_, i) => `${c.slug}#${i}`));
  for (const which of ['baldwin', 'mise']) {
    const { company } = await demo('employee', which);
    const d = db();
    const readBy = (name) => new Set(d.prepare('SELECT r.slug FROM manual_reads r JOIN users u ON u.id = r.user_id WHERE u.company_id = ? AND u.name = ?').all(company, name).map((r) => r.slug));
    const marisol = readBy('Marisol Vega'), quinn = readBy('Quinn Abbott');
    d.close();
    const bar1 = keysOf('bar-1'), bar2 = keysOf('bar-2');
    assert.ok(bar1.length > 30);
    assert.deepEqual(bar1.filter((k) => !marisol.has(k)), [], `${which}: Marisol read all of Level 1`);
    assert.deepEqual([...bar1, ...bar2].filter((k) => !quinn.has(k)), [], `${which}: Quinn read Levels 1 and 2`);
    assert.ok(!keysOf('bar-3').some((k) => quinn.has(k)), 'no final, no level 3 reads');
  }
});

/** Every text on a page, from the API. */
async function pageText(call, file) {
  const r = await call('/api/page/' + file);
  assert.equal(r.status, 200, 'page ' + file);
  const out = []; (function walk(n) { if (!n) return; if (n.t === 'T' && n.s) out.push(n.s); (n.c || []).forEach(walk); })(r.data.main);
  return out;
}

test('23 · Baldwin demo: wines pair with the demo menu, no empty prices, cocktails name a dish; the real list is untouched', async () => {
  const { call, store } = await demo('employee', 'baldwin');
  const d = db();
  const menu = new Set(d.prepare("SELECT data FROM entries WHERE collection = 'recipe' AND store_id = ?").all(store).map((r) => JSON.parse(r.data).name));
  const wines = d.prepare("SELECT data FROM entries WHERE collection = 'wine' AND store_id = ?").all(store).map((r) => JSON.parse(r.data));
  assert.ok(wines.length > 50, 'the demo has The Baldwin’s wine list');
  for (const w of wines) for (const p of String(w.pairs || '').split(/,| · /).map((s) => s.trim()).filter(Boolean)) {
    assert.ok(menu.has(p) || /^an?\s/i.test(p), `${w.name} pairs with ${p}, which isn't on the demo menu`);
  }
  assert.ok(wines.filter((w) => w.pairs).length > 40, 'most wines keep a pairing');
  const house = d.prepare("SELECT data FROM entries WHERE collection = 'house' AND store_id = ? AND archived_at IS NULL").all(store).map((r) => JSON.parse(r.data));
  for (const h of house) assert.ok(menu.has(h.pairs), `${h.name} pairs with a demo dish`);
  // The Baldwin's own list (store 1) still pairs with its own dishes
  const real = d.prepare("SELECT data FROM entries WHERE collection = 'wine' AND store_id = 1 AND slug = 'wine-list/by-the-glass-red-pinot-noir-adelsheim-willamette'").get();
  assert.match(JSON.parse(real.data).pairs, /Seasonal Veggie Pie/);
  d.close();
  const wine = await pageText(call, '25-2');
  assert.ok(!wine.some((s) => /\$\s*—/.test(s)), 'no "$—" price boxes');
  assert.ok(!wine.some((s) => /Walleye|Short Rib\b/.test(s)), 'no dishes from The Baldwin’s menu');
  assert.ok(wine.includes('Pairs with Seared Salmon'));
  const cocktails = await pageText(call, '14-2');
  assert.ok(!cocktails.includes('Ask the bar'), 'house cocktails name a dish');
});

test('24 · both demos have archived items to show and restore', async () => {
  for (const which of ['baldwin', 'mise']) {
    const { call } = await demo('manager', which);
    const { groups } = (await call('/api/archived')).data;
    const of = (id) => groups.find((g) => g.id === id)?.items || [];
    assert.equal(of('recipe').length, 1, `${which}: one archived dish`);
    assert.equal(of('house').length, 1, `${which}: one archived house cocktail`);
    assert.equal(of('recipe')[0].by, 'Rosalind Hart', 'archived by the manager');
    // archived means off the menu: the Food Matrix and Cocktails pages don't list it
    const name = of('recipe')[0].name;
    assert.ok(!(await pageText(call, '13-2')).includes(name), `${name} isn't on the Food Matrix`);
    // and Restore puts it back
    assert.equal((await call('/api/archived/restore', { method: 'POST', body: { group: 'recipe' } })).data.restored, 1);
  }
});

test('20 · the picker, welcome card and tour name what the demo has', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const picker = read('src/components/DemoPicker.tsx'), tour = read('src/components/DemoTour.tsx');
  for (const w of ['Cocktail', 'Beer', 'Sommelier', 'Hospitality', 'certificates', 'Team Chat']) assert.ok(picker.includes(w), `picker names ${w}`);
  for (const w of ['People', 'Sign-offs', 'Prep', 'Import a Menu']) assert.ok(picker.includes(w), `manager line names ${w}`);
  const tries = tour.slice(tour.indexOf('const TRY_STAFF'), tour.indexOf('function WelcomeCard'));
  for (const w of ['Hospitality', '/team-chat/', '/prep', '/import/new']) assert.ok(tries.includes(w), `welcome card: ${w}`);
  assert.match(tour.split('\n').find((l) => /title: 'Training programs'/.test(l)), /Hospitality/);
  // the manager tour stops on Import a Menu, at something the page really draws
  const stop = tour.split('\n').find((l) => /path: '\/import\/new'/.test(l));
  assert.match(stop, /manager: true/);
  const cls = /target: '\.([a-z0-9-]+)'/.exec(stop)[1];
  assert.match(read('src/import/ImportPage.tsx'), new RegExp(`className="[^"]*\\b${cls}\\b`));
});
