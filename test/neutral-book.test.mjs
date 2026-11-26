// The neutral foundation book (Nov 20, Tommy: "Go for it", Figma 09 · Idea Board, section 45): the base design every
// company reads is neutral (Fig & Fire, the Mise demo, as its sample restaurant), and The Baldwin keeps its own versions of
// those pages in its account folder (server/account.mjs, account.json "book"), which its demo copies read too.
//   • base pages: none of The Baldwin's words; the raw export holds only stubs, content/templates the pages
//   • The Baldwin gets its account's version; a store without one gets the foundation book with its own name in it
//   • leak sweep: a Foundation company sees nothing of The Baldwin's and nothing of Fig & Fire's; Fig & Fire sees its own
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, PRIVATE_ACCOUNT, startServer } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BOOK = ['28-2', '31-2', '40-2', '40-515', '40-1023', '40-1531', '40-2026', '40-2526', '40-3012', '40-3507', '40-4002', '9-2', '87-12', '176-50', '68-2', '49-3318'];
const BALDWIN = /The Baldwin|Baldwin|Testa Barra|Macomb|Shelby|Short Rib|Cozy Blankets|Fuschia|Date Cake|Agnolotti|Beet Confit|Scallop Rockefeller|Bolgheri|DCD Rye|G4 Tequila|Wine Club|sister restaurants|Opening Menu|Caymus|Silver Oak|Food Book|Wine Book|Drink Book/;
// the sweep (as scripts/account-content/book-sweep.mjs, + The Baldwin's dishes and drinks the old scripts named)
const SWEEP = /The Baldwin|J\.?\s?Baldwin|Baldwin|Testa Barra|\bBRG\b|Jeffrey(?! Ong)|Shelby|Macomb|Feb 2[2-4]|\$22\b|flight · \$30|wine flight|sommelier flight|We host|Rosemarie|Gabriella(?! Clare)|jbaldwins|testabarra|thebaldwinshelby|Short Rib|Cozy Blankets|Fuschia Satin|DCD Rye|G4 Tequila/;
const SAMPLE = /Fig & Fire|Honey Rye Highball|Wood-Grilled Half Chicken|Smoke Signal|Frog’s Leap|Hanger Steak Frites|Braised Lamb Shank/;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
/** Every layer name, word and link in a page tree, with where it is. */
const strings = (n, at = '', out = []) => {
  for (const k of ['n', 's', 'to']) if (typeof n[k] === 'string') out.push([at + '.' + k, n[k]]);
  (n.c || []).forEach((c, i) => strings(c, at + '/' + i, out));
  return out;
};

test('the foundation book’s pages are neutral: templates in content/templates, stubs in the raw export, none of The Baldwin’s words', () => {
  const raw = fs.readdirSync(path.join(root, 'content/raw')).filter((f) => /^layout.*\.json$/.test(f));
  for (const f of raw) for (const p of readJson('content/raw/' + f).pages) if (BOOK.includes(p.id.replace(':', '-'))) assert.ok(!p.main, `${f} holds ${p.id} only as a stub`);
  const index = readJson('public/content/index.json');
  for (const file of BOOK) {
    assert.ok(fs.existsSync(path.join(root, 'content/templates', file + '.json')), file + ' has its template');
    const page = readJson(`public/content/pages/${file}.json`);
    // the templates keep their names (Recipe · Short Rib…): the CMS pages they draw keep their addresses
    for (const [at, v] of strings(page.main)) assert.doesNotMatch(v, BALDWIN, `${file} ${at}: ${v}`);
    const e = index.find((x) => x.file === file);
    if (e) assert.doesNotMatch([e.text, e.blurb].join(' '), BALDWIN, file + ' search text');
  }
  const t = (file) => strings(readJson(`public/content/pages/${file}.json`).main).map(([, v]) => v);
  // the approved frames' words (885:2367, 885:6521, 885:7092, 887:1893, 887:2579, 888:3106, 888:3784, 888:4430)
  assert.ok(t('40-2').includes('“Good evening, welcome to Fig & Fire! I’m [your name], and I’ll be taking care of you tonight.”'));
  assert.ok(t('40-2').includes('Tell guests a little about the restaurant'));
  for (const s of ['Mention our other locations, if your group has them', 'Mention anything coming up: events, specials or a club, if you have one', '“I’m so glad. It’s on our list, so I’ll write the name down for you to take home.”', 'Who we are']) assert.ok(t('40-4002').includes(s), s);
  assert.ok(t('31-2').includes('Based on the FDA Food Code · confirm with your local health department'));
  assert.ok(t('9-2').includes('From the menu') && t('9-2').includes('From our wine and drink lists'));
  assert.ok(t('176-50').includes('From our wine list') && t('176-50').includes('FROG’S LEAP'));
  assert.ok(t('87-12').includes('SMOKE SIGNAL'));
  assert.ok(t('68-2').includes('Chateau Montelena') && t('68-2').includes('Heitz Cellar'));
  assert.ok(t('49-3318').includes('Ours: Rittenhouse Rye, honey-ginger syrup and soda.'));
  // Frog's Leap's own profile: body 4, sweetness 1, acidity 3, tannin 4
  const dots = strings(readJson('public/content/pages/176-50.json').main).map(([, v]) => v).filter((v) => v.startsWith('Dots · '));
  assert.deepEqual(dots, ['Dots · 4 of 5', 'Dots · 1 of 5', 'Dots · 3 of 5', 'Dots · 4 of 5']);
});

test('generic.mjs reads the old lines the way the neutral book says them (for stores that read The Baldwin’s version)', async () => {
  const { genericize } = await import('../server/generic.mjs');
  const line = (s) => ({ t: 'F', n: 'Task', c: [{ t: 'T', n: s, s }] });
  const page = { main: { t: 'F', n: 'Main', c: [line('Mention the sister restaurants'), line('Mention the Wine Club or Supper Club when it fits'), line('The family'), line('Tell guests about the family'), line('From the Food Book'), line('From the Wine Book and Drink Book'), line('From the Wine Book'), line('“Welcome to Fig & Fire. Have you been in with us before?”')] } };
  genericize(page, 'step-9/goodbye', { store: { name: 'Harbor Lane Kitchen' }, statics: new Map(), terms: /(?!)/, has: {} });
  assert.deepEqual(page.main.c.map((c) => c.c[0].s), ['Mention our other locations, if your group has them', 'Mention anything coming up: events, specials or a club, if you have one', 'Who we are', 'Tell guests a little about the restaurant', 'From the menu', 'From our wine and drink lists', 'From our wine list', '“Welcome to Harbor Lane Kitchen. Have you been in with us before?”']);
});

/* ---- served: The Baldwin, its demo, a Foundation company and Fig & Fire ---- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-neutral-book-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
const MARK = '“Welcome to the account’s own version of this page.”';
let server;
const env = { ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@neutral.test', PREP_WEEKLY: 'off', SCANNER_WARM: '0' };
async function start() {
  ({ server, port: PORT, base: BASE } = await startServer(env));
}
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

before(async () => {
  const acct = giveAccount(dir);
  if (!PRIVATE_ACCOUNT) {
    // a made-up account's own version of Step 1 (and only Step 1), listed in its "book"
    const p = readJson('public/content/pages/40-2.json');
    (function w(n) { if (n.t === 'T' && /^“Good evening, welcome to/.test(n.s || '')) { n.s = MARK; n.n = MARK; } (n.c || []).forEach(w); })(p.main);
    fs.mkdirSync(path.join(acct, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(acct, 'pages', '40-2.json'), JSON.stringify(p));
    const a = JSON.parse(fs.readFileSync(path.join(acct, 'account.json'), 'utf8'));
    fs.writeFileSync(path.join(acct, 'account.json'), JSON.stringify({ ...a, book: ['40-2'] }));
  }
  await start(); server.kill(); await new Promise((r) => server.once('exit', r));
  // people and sessions, the way scripts/account-content/book-snapshot.mjs makes them
  const db = new DatabaseSync(path.join(dir, 'baldwin.db'));
  const t = '2026-11-20T00:00:00.000Z', exp = '2027-11-20T00:00:00.000Z';
  const user = (co, name, role, store) => Number(db.prepare('INSERT INTO users(company_id, name, role, store_id, created_at) VALUES (?,?,?,?,?)').run(co, name, role, store, t).lastInsertRowid);
  const sess = (uid, token) => db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(sha(token), uid, t, exp);
  sess(user(1, 'Neutral Staff One', 'staff', 1), 's1');
  const co = Number(db.prepare("INSERT INTO companies(name, slug, created_at, brand, plan) VALUES ('Harbor Lane Hospitality','harbor-lane-neutral',?,'mise','foundation')").run(t).lastInsertRowid);
  const st = Number(db.prepare("INSERT INTO stores(company_id, name, slug, book_ready, sort, created_at) VALUES (?, 'Harbor Lane Kitchen', 'harbor-lane-kitchen', 0, 0, ?)").run(co, t).lastInsertRowid);
  sess(user(co, 'Fake Staff', 'staff', st), 'fake');
  db.close();
  await start();
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const get = async (token, p) => { const r = await fetch(BASE + p, { headers: { cookie: `bt_session=${token}` } }); return { status: r.status, text: await r.text() }; };
async function demo(which, role = 'employee') {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': '10.20.' + (which === 'mise' ? 1 : 2) + '.' + (role === 'manager' ? 1 : 2) }, body: JSON.stringify({ demo: which, role }) });
  assert.equal(r.status, 200);
  return /bt_session=([^;]+)/.exec(r.headers.get('set-cookie'))[1];
}
const words = (text) => strings(JSON.parse(text).main || {}).map(([, v]) => v);

test('The Baldwin reads its account’s version of a book page; without one, the foundation book with its own name', async () => {
  const step1 = words((await get('s1', '/api/page/40-2')).text);
  const steps = words((await get('s1', '/api/page/28-2')).text);
  if (PRIVATE_ACCOUNT) {
    assert.ok(step1.some((s) => s.includes('welcome to The Baldwin!')), 'The Baldwin’s own script');
    assert.ok(steps.some((s) => s.includes('Welcome to The Baldwin.')));
  } else {
    assert.ok(step1.includes(MARK), 'the account’s version of Step 1');
    assert.ok(steps.includes('“Welcome to The Baldwin. Have you been in with us before?”'), 'no version of its own: the foundation book, with its name');
  }
  for (const f of ['40-2', '28-2', '40-4002', '49-3318']) assert.doesNotMatch((await get('s1', '/api/page/' + f)).text, /Fig & Fire|Honey Rye Highball/, f + ': nothing of the sample restaurant’s');
});

test('The Baldwin’s demo reads the account’s versions of the book pages too', async () => {
  const tok = await demo('baldwin');
  const step1 = words((await get(tok, '/api/page/40-2')).text);
  if (PRIVATE_ACCOUNT) assert.ok(step1.some((s) => s.includes('welcome to The Baldwin!')));
  else assert.ok(step1.includes(MARK), 'the account’s version of Step 1');
  assert.doesNotMatch((await get(tok, '/api/page/28-2')).text, /Fig & Fire/);
});

test('a Foundation company: the neutral book with its own name, and nothing of The Baldwin’s or Fig & Fire’s anywhere', async () => {
  assert.ok(words((await get('fake', '/api/page/40-2')).text).includes('“Good evening, welcome to Harbor Lane Kitchen! I’m [your name], and I’ll be taking care of you tonight.”'));
  const step9 = words((await get('fake', '/api/page/40-4002')).text);
  for (const s of ['Mention our other locations, if your group has them', 'Who we are', '“I’m so glad. It’s on our list, so I’ll write the name down for you to take home.”']) assert.ok(step9.includes(s), s);
  const cab = words((await get('fake', '/api/page/68-2')).text);
  assert.ok(cab.includes('Chateau Montelena') && !cab.includes('Caymus'), 'Bottles to Know as the neutral design names them');
  const index = (await get('fake', '/api/index')).text;
  const hits = [];
  if (SWEEP.test(index) || SAMPLE.test(index)) hits.push('index');
  for (const f of [...new Set(JSON.parse(index).map((e) => e.file))]) {
    const r = await get('fake', '/api/page/' + encodeURIComponent(f));
    const m = SWEEP.exec(r.text) || SAMPLE.exec(r.text);
    if (m) hits.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(hits, [], 'leak sweep');
});

test('Fig & Fire sees its own samples: its name, its rye drink, the neutral Bottles to Know; none of The Baldwin’s', async () => {
  const tok = await demo('mise');
  assert.ok(words((await get(tok, '/api/page/40-2')).text).some((s) => s.includes('welcome to Fig & Fire!')));
  assert.ok(words((await get(tok, '/api/page/49-3318')).text).includes('Honey Rye Highball'), 'its house rye cocktail on the Rye page');
  assert.ok(words((await get(tok, '/api/page/68-2')).text).includes('Heitz Cellar'));
  for (const f of BOOK.filter((x) => !['9-2', '87-12', '176-50'].includes(x))) assert.doesNotMatch((await get(tok, '/api/page/' + f)).text, /The Baldwin|Testa Barra|J\.Baldwin|Short Rib|Cozy Blankets|Caymus/, f);
});
