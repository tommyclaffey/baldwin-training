// Michigan law, labelled for other states (Nov 21, launch checklist step 5). The lessons that teach liquor law were written
// from Michigan's code (The Baldwin is in Michigan). Outside Michigan, each of those sections carries "Example: Michigan law"
// and the hubs' source lists say the law is Michigan's; The Baldwin (Michigan) and its demo read them exactly as before.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, startServer } from './helpers.mjs';
import { isMichiganLaw, lawNote, stateName } from '../server/lawstate.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('which sections are Michigan law, and the note each company gets', () => {
  const law = JSON.parse(fs.readFileSync(path.join(root, 'content/bar/bar-l4-law.json'), 'utf8'));
  assert.ok(law.sections.every((s) => isMichiganLaw(law, s)), 'every section of Responsible service and the law');
  const menu = JSON.parse(fs.readFileSync(path.join(root, 'content/bar/bar-l4-menu.json'), 'utf8'));
  assert.ok(menu.sections.every((s) => !isMichiganLaw(menu, s)), 'Michigan State University (menu engineering) is not law');
  const beer = JSON.parse(fs.readFileSync(path.join(root, 'content/beer/beer-events.json'), 'utf8'));
  assert.ok(isMichiganLaw(beer, beer.sections.find((s) => s.name === 'Samples and flights')), 'MCL 436.2027 samples');
  assert.equal(lawNote('Michigan'), null);
  assert.equal(lawNote(null).text, 'Example: Michigan law. Your state’s rules may differ; check with your manager.');
  assert.equal(lawNote('Ohio', 'Harbor Lane Kitchen').text, 'Example: Michigan law. Harbor Lane Kitchen is in Ohio, where the rules may differ; check with your manager.');
  assert.equal(stateName('new york'), 'New York');
  assert.equal(stateName('Ontario'), null);
});

/* ---- served ---- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-law-state-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;
const env = { ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@law.test', PREP_WEEKLY: 'off', SCANNER_WARM: '0' };
async function start() {
  ({ server, port: PORT, base: BASE } = await startServer(env));
}
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

before(async () => {
  giveAccount(dir);
  await start(); server.kill(); await new Promise((r) => server.once('exit', r));
  const db = new DatabaseSync(path.join(dir, 'baldwin.db'));
  assert.equal(db.prepare('SELECT state FROM companies WHERE id = 1').get().state, 'Michigan', 'Baldwin Restaurant Group is in Michigan');
  const t = '2026-11-21T00:00:00.000Z', exp = '2027-11-21T00:00:00.000Z';
  const user = (co, name, role, store) => Number(db.prepare('INSERT INTO users(company_id, name, role, store_id, created_at) VALUES (?,?,?,?,?)').run(co, name, role, store, t).lastInsertRowid);
  const sess = (uid, token) => db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(sha(token), uid, t, exp);
  sess(user(1, 'Law Manager One', 'manager', 1), 'mi');
  const company = (name, slug, state) => {
    const co = Number(db.prepare("INSERT INTO companies(name, slug, created_at, brand, plan, state) VALUES (?,?,?,'mise','foundation',?)").run(name, slug, t, state).lastInsertRowid);
    const st = Number(db.prepare('INSERT INTO stores(company_id, name, slug, book_ready, sort, created_at) VALUES (?, ?, ?, 0, 0, ?)').run(co, name, slug, t).lastInsertRowid);
    return [co, st];
  };
  const [oh, ohSt] = company('Harbor Lane Kitchen', 'harbor-lane-law', 'Ohio');
  sess(user(oh, 'Ohio Manager', 'manager', ohSt), 'oh');
  const [un, unSt] = company('Copper Pot Tavern', 'copper-pot-law', null);
  sess(user(un, 'Unknown Manager', 'manager', unSt), 'un');
  const [mi2, mi2St] = company('Lakeshore Grill', 'lakeshore-law', 'Michigan');
  sess(user(mi2, 'Michigan Manager', 'manager', mi2St), 'mi2');
  db.close();
  await start();
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const get = async (token, p) => { const r = await fetch(BASE + p, { headers: token ? { cookie: `bt_session=${token}` } : {} }); return { status: r.status, text: await r.text() }; };
const strings = (n, out = []) => { for (const k of ['n', 's']) if (typeof n[k] === 'string') out.push(n[k]); (n.c || []).forEach((c) => strings(c, out)); return out; };
const page = async (token, file) => { const r = await get(token, '/api/page/' + file); assert.equal(r.status, 200, file); return strings(JSON.parse(r.text).main || {}); };
async function demo(which) {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': '10.31.' + (which === 'mise' ? 1 : 2) + '.1' }, body: JSON.stringify({ demo: which, role: 'manager' }) });
  assert.equal(r.status, 200);
  return /bt_session=([^;]+)/.exec(r.headers.get('set-cookie'))[1];
}
const hubFile = async (token, slug) => JSON.parse((await get(token, '/api/index')).text).find((e) => e.slug === slug).file;
const NOTE = /^Example: Michigan law\./;

test('a law lesson: labelled for a company outside Michigan, its state named when it is known', async () => {
  const oh = await page('oh', 'l-bar-l4-law~0');
  assert.ok(oh.includes('EXAMPLE · MICHIGAN LAW'));
  assert.ok(oh.includes('Example: Michigan law. Harbor Lane Kitchen is in Ohio, where the rules may differ; check with your manager.'));
  const un = await page('un', 'l-bar-l4-law~2');
  assert.ok(un.includes('Example: Michigan law. Your state’s rules may differ; check with your manager.'));
  // the Beer Program's Michigan rules too (samples, staff tastings, suppliers, self-distribution)
  for (const f of ['l-beer-events~1', 'l-beer-training~0', 'l-beer-l4-leading~2', 'l-beer-l4-taps~3', 'l-bar-l4-suppliers~0', 'l-bar-l4-running~2', 'l-bar-l4-team~3']) assert.ok((await page('un', f)).some((s) => NOTE.test(s)), f);
  // a lesson that isn't law has no note
  assert.ok(!(await page('un', 'l-bar-l4-menu~3')).some((s) => NOTE.test(s)), 'menu engineering');
});

test('Michigan companies read the law lessons as written: The Baldwin, its demo, any company set to Michigan', async () => {
  const bd = await demo('baldwin');
  for (const tok of ['mi', 'mi2', bd]) for (const f of ['l-bar-l4-law~0', 'l-beer-events~1']) assert.ok(!(await page(tok, f)).some((s) => NOTE.test(s) || s === 'EXAMPLE · MICHIGAN LAW'), f);
  const mi = await page('mi', 'l-bar-l4-law~0'), oh = await page('oh', 'l-bar-l4-law~0');
  assert.ok(!mi.some((s) => /^Law · /.test(s)), 'no note card on The Baldwin’s page');
  assert.ok(oh.length > mi.length);
});

test('the Mise demo (Fig & Fire, state not set) gets the note; the hubs’ source lists say the law is Michigan’s', async () => {
  const fig = await demo('mise');
  assert.ok((await page(fig, 'l-bar-l4-law~1')).includes('Example: Michigan law. Your state’s rules may differ; check with your manager.'));
  const bar = await page(fig, await hubFile(fig, 'cocktail-program'));
  assert.ok(bar.includes('Example: Michigan law. The state law behind Level 4: service, minors, hours, training. Your state’s rules may differ.'));
  assert.ok(bar.includes('MICHIGAN LAW'));
  const beer = await page(fig, await hubFile(fig, 'beer-program'));
  assert.ok(beer.includes('Example: Michigan law. MCL 436.1609: what brewers and distributors may give us. Your state’s rules may differ.'));
  const mine = await page('mi', await hubFile('mi', 'cocktail-program'));
  assert.ok(mine.includes('The state law behind Level 4: service, minors, hours, training.') && !mine.includes('MICHIGAN LAW'), 'The Baldwin’s hub as before');
});

test('a demo copy that takes a removed copy’s id reads its own state (no per-id cache)', async () => {
  // Nov 21: on the live site a Baldwin demo copy got the id a Fig & Fire copy had, and showed the note
  const db = new DatabaseSync(path.join(dir, 'baldwin.db'));
  const t = '2026-11-21T00:00:00.000Z', exp = '2027-11-21T00:00:00.000Z';
  db.prepare("INSERT INTO companies(id, name, slug, created_at, demo, brand, plan) VALUES (900, 'Fig & Fire', 'demo-mise-reuse', ?, 1, 'mise', 'foundation')").run(t);
  db.prepare("INSERT INTO stores(id, company_id, name, slug, book_ready, sort, created_at) VALUES (900, 900, 'Fig & Fire', 'fig-and-fire', 1, 0, ?)").run(t);
  const uid = Number(db.prepare("INSERT INTO users(company_id, name, role, store_id, created_at) VALUES (900, 'Reuse Manager', 'manager', 900, ?)").run(t).lastInsertRowid);
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(sha('reuse'), uid, t, exp);
  assert.ok((await page('reuse', 'l-bar-l4-law~0')).some((s) => NOTE.test(s)), 'Fig & Fire copy: labelled');
  db.prepare("UPDATE companies SET name = 'Baldwin Restaurant Group', brand = 'baldwin', plan = 'custom-brand' WHERE id = 900").run();
  db.prepare("UPDATE stores SET name = 'The Baldwin' WHERE id = 900").run();
  db.close();
  assert.ok(!(await page('reuse', 'l-bar-l4-law~0')).some((s) => NOTE.test(s)), 'now a Baldwin copy on the same id: Michigan, as written');
});
