// The wine pages' dish pairings belong to the restaurant (Nov 21, launch checklist step 5). The Baldwin's "Pairs with" cards
// on the region and grape pages moved out of content/wine into its account folder (wine/pairs.json); every other company has
// none. The grape and region templates (111-4, 377-2) draw Fig & Fire's dishes as their sample, and "Our home state" on
// Michigan is The Baldwin's alone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, PRIVATE_ACCOUNT, startServer } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const BALDWIN = /Baldwin|Short Rib|Walleye|Scallops? Rockefeller|Agnolotti|Beet Confit|Mike’s Vegas|JB Calamari|Prosciutto Fondue|Espresso Encrusted|Duck Gnocchetti|Date Cake|Spicy Bar Nutz/;
const strings = (n, out = []) => { for (const k of ['n', 's', 'to']) if (typeof n[k] === 'string') out.push(n[k]); (n.c || []).forEach((c) => strings(c, out)); return out; };

test('content/wine holds no pairings, and the grape and region templates are neutral (Fig & Fire’s dishes)', () => {
  for (const [f, key] of [['content/wine/regions.json', 'regions'], ['content/wine/grapes.json', 'grapes']]) {
    const j = readJson(f);
    assert.ok(j[key].length > 20);
    assert.ok(j[key].every((x) => !('pairs' in x)), f + ': no pairs');
    assert.doesNotMatch(JSON.stringify(j), BALDWIN, f);
  }
  for (const [file, id] of [['111-4', '111:4'], ['377-2', '377:2']]) {
    assert.ok(fs.existsSync(path.join(root, 'content/templates', file + '.json')), file + ' is a template');
    for (const f of fs.readdirSync(path.join(root, 'content/raw')).filter((x) => /^layout.*\.json$/.test(x))) for (const p of readJson('content/raw/' + f).pages) if (p.id === id) assert.ok(!p.main, `${f} holds ${id} only as a stub`);
    const words = strings(readJson(`public/content/pages/${file}.json`).main);
    for (const w of words) assert.doesNotMatch(w, BALDWIN, `${file}: ${w}`);
  }
  assert.ok(strings(readJson('public/content/pages/111-4.json').main).includes('Hanger Steak Frites'));
  assert.ok(strings(readJson('public/content/pages/377-2.json').main).includes('Seared Scallops'));
});

/* ---- served ---- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-wine-pairs-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
// dishes on the made-up account's menu (content/demo/recipe.json): a pairing whose dish isn't on the menu leaves the card
const MADE_UP = { name: 'Whipped Ricotta Toast', why: 'A made-up pairing for the test.', to: '/food-matrix' };
let server;
const env = { ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@pairs.test', PREP_WEEKLY: 'off', SCANNER_WARM: '0' };
async function start() {
  ({ server, port: PORT, base: BASE } = await startServer(env));
}
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

before(async () => {
  const acct = giveAccount(dir);
  if (!PRIVATE_ACCOUNT) {
    fs.mkdirSync(path.join(acct, 'wine'), { recursive: true });
    fs.writeFileSync(path.join(acct, 'wine', 'pairs.json'), JSON.stringify({ pairs: { 'wine/red/merlot': [MADE_UP], 'wine/france/loire': [MADE_UP, { ...MADE_UP, name: 'Crispy Calamari', why: 'A second made-up pairing.' }] } }));
  }
  await start(); server.kill(); await new Promise((r) => server.once('exit', r));
  const db = new DatabaseSync(path.join(dir, 'baldwin.db'));
  const t = '2026-11-21T00:00:00.000Z', exp = '2027-11-21T00:00:00.000Z';
  const user = (co, name, role, store) => Number(db.prepare('INSERT INTO users(company_id, name, role, store_id, created_at) VALUES (?,?,?,?,?)').run(co, name, role, store, t).lastInsertRowid);
  const sess = (uid, token) => db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(sha(token), uid, t, exp);
  sess(user(1, 'Pairs Staff One', 'staff', 1), 's1');
  const co = Number(db.prepare("INSERT INTO companies(name, slug, created_at, brand, plan) VALUES ('Harbor Lane Hospitality','harbor-lane-pairs',?,'mise','foundation')").run(t).lastInsertRowid);
  const st = Number(db.prepare("INSERT INTO stores(company_id, name, slug, book_ready, sort, created_at) VALUES (?, 'Harbor Lane Kitchen', 'harbor-lane-kitchen', 0, 0, ?)").run(co, t).lastInsertRowid);
  sess(user(co, 'Fake Staff', 'staff', st), 'fake');
  db.close();
  await start();
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const get = async (token, p) => { const r = await fetch(BASE + p, { headers: { cookie: `bt_session=${token}` } }); assert.equal(r.status, 200, p); return r.text(); };
const fileOf = async (token, slug) => JSON.parse(await get(token, '/api/index')).find((e) => e.slug === slug).file;
const page = async (token, slug) => strings(JSON.parse(await get(token, '/api/page/' + await fileOf(token, slug))).main);
async function demo(which) {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': '10.41.' + (which === 'mise' ? 1 : 2) + '.1' }, body: JSON.stringify({ demo: which, role: 'employee' }) });
  assert.equal(r.status, 200);
  return /bt_session=([^;]+)/.exec(r.headers.get('set-cookie'))[1];
}

test('The Baldwin reads its own pairings from its account folder; its demo too', async () => {
  const bd = await demo('baldwin');
  for (const tok of ['s1', bd]) {
    const merlot = await page(tok, 'wine/red/merlot');
    assert.ok(merlot.includes('PAIRS WITH'), 'Pairs with on Merlot');
    if (!PRIVATE_ACCOUNT) {
      assert.ok(merlot.includes('Whipped Ricotta Toast') && merlot.includes('A made-up pairing for the test.'));
      const loire = await page(tok, 'wine/france/loire');
      assert.ok(loire.includes('Whipped Ricotta Toast') && loire.includes('A second made-up pairing.'));
      assert.ok(!(await page(tok, 'wine/red/syrah')).includes('PAIRS WITH'), 'a page the account has no pairings for has none');
      assert.ok((await page(tok, 'wine/italy/piedmont')).includes('Alba, in Piedmont, is famous for its white truffles.'), 'no account line: the neutral Good to Know');
    }
    assert.ok((await page(tok, 'wine/usa/michigan')).includes('Our home state'), 'Michigan is The Baldwin’s home state');
  }
});

test('every other company: no pairings, nothing from the sample, and Michigan isn’t its home state', async () => {
  const fig = await demo('mise');
  for (const tok of ['fake', fig]) {
    for (const slug of ['wine/red/merlot', 'wine/red/cabernet', 'wine/france/loire', 'wine/usa/michigan', 'wine/usa/virginia']) {
      const w = await page(tok, slug);
      assert.ok(!w.includes('PAIRS WITH'), slug + ': no Pairs with');
      for (const s of w) assert.doesNotMatch(s, /made-up pairing|Hanger Steak Frites|Seared Scallops|Roasted Beet & Citrus Salad|Braised Lamb Shank|Our home state/, `${slug}: ${s}`);
    }
    assert.ok((await page(tok, 'wine/usa/virginia')).includes('Riesling by Lake Michigan'));
  }
});
