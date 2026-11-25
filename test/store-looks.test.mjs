// Looks per store (Nov 17, Tommy: "can we start building out the branding for testa barra and j. baldwins?" · "yes can
// start building"; Figma 09 · Proposals → 33, 732:1085). A store can wear its own look; without one it wears its company's.
// Only Custom Brand companies, only set by super admins (Super Admin → Companies), logged. Testa Barra and J.Baldwin's are
// the first two store looks; The Baldwin's look and Mise's don't change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, turnOnTwoStep } from './helpers.mjs';
import { LOOKS, lookOf, lookOfStore, storeLooksAllowed } from '../server/looks.mjs';
const T = await import('../src/lib/theme.ts');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-looks-'));
const PORT = 5900 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
function person() {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
}
before(async () => {
  giveAccount(dir);
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@baldwin.test', SUPERADMIN_EMAIL: 'tommy@mise.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const tommy = person(), owner = person(), baldwinStaff = person(), testaStaff = person(), jbStaff = person(), harborOwner = person();
let code = '', harbor = 0;
const setLook = (co, st, look, who = tommy) => who(`/api/super/companies/${co}/stores/${st}`, { method: 'PATCH', body: { look } });

test('setup: The Baldwin’s owner, the super admin (two-step on), and staff at each of the three restaurants', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Bram Owner', email: 'owner@baldwin.test', password: 'long-enough-1' } })).status, 200);
  // the super admin signs up the way the other tests do (SUPERADMIN_EMAIL), then turns on two-step
  const su = await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@mise.test', password: 'long-enough-2' } });
  assert.equal(su.status, 200, JSON.stringify(su.data));
  await turnOnTwoStep(tommy, { workIn: null });
  code = db().prepare('SELECT join_code FROM companies WHERE id = 1').get().join_code;
  for (const [p, name, storeId] of [[baldwinStaff, 'Ada Baldwin', 1], [jbStaff, 'Jo Jaybee', 2], [testaStaff, 'Tess Testa', 3]])
    assert.equal((await p('/api/join', { method: 'POST', body: { code, name, email: `j${Math.random().toString(36).slice(2, 10)}@join.test`, password: 'join-pass-4321-x', storeId } })).status, 200);
});

test('the migration adds stores.look, empty for every store, so every store wears its company’s look', async () => {
  const d = db();
  assert.ok(d.prepare('PRAGMA table_info(stores)').all().some((c) => c.name === 'look'));
  assert.ok(d.prepare('PRAGMA user_version').get().user_version >= 23);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM stores WHERE look IS NOT NULL').get().n, 0);
  for (const p of [baldwinStaff, jbStaff, testaStaff]) assert.equal((await p('/api/me')).data.user.brand, 'baldwin', 'fallback: the company’s look');
});

test('only super admins can set a store’s look: owners, managers and staff get “not found”', async () => {
  for (const p of [owner, testaStaff]) assert.equal((await setLook(1, 3, 'testabarra', p)).status, 404);
  assert.equal(db().prepare('SELECT look FROM stores WHERE id = 3').get().look, null);
});

test('a store look overrides the company look; the session, the join screen and the certificate say the store’s look', async () => {
  let r = await setLook(1, 3, 'testabarra');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.drawnIn, 'testabarra');
  assert.equal((await setLook(1, 2, 'jbaldwins')).status, 200);
  const me = (await testaStaff('/api/me')).data.user;
  assert.equal(me.brand, 'testabarra');
  assert.equal(me.store.ownLook, true);
  assert.equal((await jbStaff('/api/me')).data.user.brand, 'jbaldwins');
  // The Baldwin is untouched
  const bald = (await baldwinStaff('/api/me')).data.user;
  assert.equal(bald.brand, 'baldwin');
  assert.equal(bald.store.ownLook, undefined);
  // the store question wears the company's look; each store says its own
  const j = (await person()(`/api/join/${code}`)).data;
  assert.equal(j.brand, 'baldwin');
  assert.deepEqual(Object.fromEntries(j.stores.map((s) => [s.name, s.brand])), { 'The Baldwin': 'baldwin', 'J.Baldwin\'s': 'jbaldwins', 'Testa Barra': 'testabarra' });
  // the certificate band shows the store's own look; The Baldwin's keeps its logo
  const d = db();
  for (const [uid, sid] of d.prepare("SELECT id, store_id FROM users WHERE role = 'staff' AND company_id = 1").all().map((x) => [x.id, x.store_id]))
    d.prepare("INSERT INTO quiz_attempts(device, name, quiz, score, total, answers, at, company_id, user_id, store_id) VALUES (?,?,?,?,?,?,?,1,?,?)").run('u' + uid, 'x', 't:final:bar-1', 38, 40, '{}', new Date().toISOString(), uid, sid);
  const cert = (await testaStaff('/api/certificates')).data.certificates[0];
  assert.equal(cert.look, 'testabarra'); assert.equal(cert.store, 'Testa Barra');
  const bcert = (await baldwinStaff('/api/certificates')).data.certificates[0];
  assert.equal(bcert.look, null); assert.equal(bcert.logo, '/img/logo-white.png');
  // Super Admin → Companies lists each store's look
  const co = (await tommy('/api/super/overview')).data.companies.find((c) => c.id === 1);
  assert.equal(co.storeLooks, true);
  assert.deepEqual(co.stores.map((s) => [s.id, s.look, s.drawnIn]), [[1, null, 'baldwin'], [2, 'jbaldwins', 'jbaldwins'], [3, 'testabarra', 'testabarra']]);
  // and every change is in the log
  const log = db().prepare("SELECT detail FROM audit WHERE action = 'super: store look' ORDER BY id").all().map((x) => x.detail);
  assert.ok(log.some((x) => x.includes('Testa Barra · Testa Barra')) && log.some((x) => x.includes('J.Baldwin')), log.join(' | '));
});

test('“Same as company” goes back to the company’s look; a look not made for the company is refused', async () => {
  assert.equal((await setLook(1, 2, null)).data.drawnIn, 'baldwin');
  assert.equal((await jbStaff('/api/me')).data.user.brand, 'baldwin');
  assert.equal((await setLook(1, 2, 'nonsense')).status, 400);
  assert.equal((await setLook(1, 2, 'jbaldwins')).status, 200);
});

test('Custom Brand only: a Foundation company can’t give a store its own look, and moving to Foundation puts every store in Mise', async () => {
  const add = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Harbor Hall', stores: ['Dockside'] } });
  harbor = add.data.id;
  const st = db().prepare('SELECT id FROM stores WHERE company_id = ?').get(harbor).id;
  const r = await setLook(harbor, st, 'testabarra');
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Custom Brand/);
  // on Custom Brand, a look made for another company is still refused
  assert.equal((await tommy(`/api/super/companies/${harbor}`, { method: 'PATCH', body: { plan: 'custom-brand' } })).status, 200);
  assert.equal((await setLook(harbor, st, 'testabarra')).status, 400);
  void harborOwner;
  // Baldwin Restaurant Group on Foundation: every store is drawn in Mise (the store looks stay saved for when it comes back)
  assert.equal((await tommy('/api/super/companies/1', { method: 'PATCH', body: { plan: 'foundation' } })).status, 200);
  assert.equal((await testaStaff('/api/me')).data.user.brand, 'mise');
  assert.equal(db().prepare('SELECT look FROM stores WHERE id = 3').get().look, 'testabarra');
  assert.equal((await tommy('/api/super/companies/1', { method: 'PATCH', body: { plan: 'custom-brand', look: 'baldwin' } })).status, 200);
  assert.equal((await testaStaff('/api/me')).data.user.brand, 'testabarra');
  assert.equal((await baldwinStaff('/api/me')).data.user.brand, 'baldwin');
});

test('demo copies and Mise Academy (HQ) never take a store look', async () => {
  const demo = person();
  assert.equal((await demo('/api/demo/start', { method: 'POST', body: { role: 'employee', demo: 'baldwin' } })).status, 200);
  const d = db();
  const co = d.prepare('SELECT id FROM companies WHERE demo = 1 ORDER BY id DESC').get().id;
  const st = d.prepare('SELECT id FROM stores WHERE company_id = ?').get(co).id;
  assert.equal((await setLook(co, st, 'testabarra')).status, 400);
  const hq = d.prepare('SELECT id FROM companies WHERE internal = 1').get().id;
  const hqStore = d.prepare('SELECT id FROM stores WHERE company_id = ?').get(hq).id;
  assert.equal((await setLook(hq, hqStore, 'testabarra')).status, 400);
  assert.equal((await demo('/api/me')).data.user.brand, 'baldwin', 'the Baldwin demo stays The Baldwin');
});

test('the new looks’ logos and icons are served (the logo files exactly as published on their sites)', async () => {
  for (const f of ['/img/looks/testabarra-wordmark-white.webp', '/img/looks/jbaldwins-logo-white.webp', ...['testabarra', 'jbaldwins'].flatMap((k) => [32, 48, 180, 192, 512].map((s) => `/icons/${k}-${s}.png`))]) {
    const res = await fetch(BASE + f);
    assert.equal(res.status, 200, f);
    assert.ok(Number(res.headers.get('content-length') || (await res.arrayBuffer()).byteLength) > 500, f);
  }
  // every look the server knows has its paint, its logo and its faces in the theme layer, and the other way round
  assert.deepEqual([...T.BRAND_IDS].sort(), Object.keys(LOOKS).sort());
  assert.deepEqual(Object.keys(T.THEMES).sort(), Object.keys(LOOKS).sort());
  for (const id of ['testabarra', 'jbaldwins']) {
    const t = T.THEMES[id];
    assert.ok(fs.existsSync(path.join(root, 'public', t.mark.src)), t.mark.src);
    assert.ok(fs.existsSync(path.join(root, 'public', t.drawnLogo.src)), t.drawnLogo.src);
    assert.equal(t.type.accent.ff, 'Gilda Display', 'the accent line is Gilda Display (Tommy, Nov 17: Bigelow Rules was too cartoony)');
    assert.match(T.fontsUrl(t), /^https:\/\/fonts\.googleapis\.com\/css2\?/); // inside the CSP's style-src
    assert.doesNotMatch(T.fontsUrl(t), /Bigelow/);
  }
  assert.equal(T.fontsUrl(T.THEMES.baldwin), null, 'The Baldwin loads nothing new');
  assert.equal(T.fontsUrl(T.THEMES.mise), null, 'Mise loads nothing new');
});

test('server rules: lookOfStore falls back, and needs the plan and the company', () => {
  const brg = { id: 1, plan: 'custom-brand', brand: 'baldwin', demo: 0, internal: 0 };
  assert.equal(lookOfStore(brg, null), 'baldwin');
  assert.equal(lookOfStore(brg, { look: null }), 'baldwin');
  assert.equal(lookOfStore(brg, { look: 'testabarra' }), 'testabarra');
  assert.equal(lookOfStore(brg, { look: 'mise' }), 'mise');
  assert.equal(lookOfStore({ ...brg, plan: 'foundation' }, { look: 'testabarra' }), 'mise');
  assert.equal(lookOfStore({ ...brg, id: 9 }, { look: 'testabarra' }), lookOf({ ...brg, id: 9 }));
  assert.equal(storeLooksAllowed(brg), true);
  assert.equal(storeLooksAllowed({ ...brg, demo: 1 }), false);
  assert.equal(storeLooksAllowed({ ...brg, plan: 'foundation' }), false);
});

test('theme: an accent drawn on light takes the look’s deep accent (coral, burgundy); on dark it stays chartreuse or gold', () => {
  const main = { t: 'F', n: 'Main', w: 1176, h: 600, lm: 'V', c: [
    { t: 'F', n: 'Card', w: 500, h: 200, r: 18, lm: 'V', f: [{ c: '#FBF9F5' }], c: [
      { t: 'F', n: 'Progress', w: 186, h: 6, f: [{ c: '#E4DCCF' }], c: [{ t: 'R', n: 'Rectangle', w: 120, h: 6, f: [{ c: '#C49A6C' }] }] },
      { t: 'F', n: 'Badge', w: 40, h: 22, r: 11, f: [{ c: '#C49A6C' }], c: [{ t: 'T', n: '01', s: '01', ff: 'Archivo', fs: 'Bold', z: 12, f: [{ c: '#1E1C1A' }] }] },
    ] },
    { t: 'F', n: 'Panel', w: 500, h: 200, f: [{ c: '#1E1C1A' }], c: [{ t: 'R', n: 'Rectangle', w: 120, h: 6, f: [{ c: '#C49A6C' }] }] },
  ] };
  const page = { id: 'x', name: 'x', bg: '#F2EEE7', main };
  const tb = T.themePage(page, T.THEMES.testabarra).main;
  assert.equal(tb.c[0].c[0].c[0].f[0].c, '#B23A32', 'progress on a light card: deep coral');
  assert.equal(tb.c[0].c[1].f[0].c, '#B23A32');
  assert.equal(tb.c[0].c[1].c[0].f[0].c, '#FFFFFF', 'white on coral');
  assert.equal(tb.c[1].c[0].f[0].c, '#DFFF00', 'on navy: chartreuse');
  const jb = T.themePage(page, T.THEMES.jbaldwins).main;
  assert.equal(jb.c[0].c[0].c[0].f[0].c, '#860028');
  assert.equal(jb.c[1].c[0].f[0].c, '#C9A455');
  // The Baldwin and Mise: the new role is their accent, so nothing changes
  const b = T.themePage(page, T.THEMES.baldwin).main;
  assert.equal(b.c[0].c[0].c[0].f[0].c, '#C49A6C'); assert.equal(b.c[0].c[1].c[0].f[0].c, '#1E1C1A');
  for (const t of [T.THEMES.baldwin, T.THEMES.mise]) for (const i of [0, 1, 2]) {
    assert.equal(T.color(t, 'accentOnLight', i), T.color(t, 'accent', i));
    assert.equal(T.color(t, 'onAccentOnLight', i), T.color(t, 'onAccent', i));
  }
});

test('theme: Testa Barra’s headings are Bebas Neue 1.26× the drawn size; J.Baldwin’s body is Montserrat; the accent line is Gilda Display', () => {
  const main = { t: 'F', n: 'Main', w: 1176, h: 600, lm: 'V', c: [
    { t: 'T', n: 'BROWSE THE BOOK', s: 'BROWSE THE BOOK', ff: 'Archivo', fs: 'ExtraBold', z: 30, w: 400, h: 36, f: [{ c: '#1E1C1A' }] },
    { t: 'T', n: 'Everything we serve', s: 'Everything we serve', ff: 'Pinyon Script', fs: 'Regular', z: 28, w: 300, h: 34, f: [{ c: '#8A5A3A' }] },
    { t: 'T', n: 'Body', s: 'Some words', ff: 'Archivo', fs: 'Regular', z: 15, w: 300, h: 20, f: [{ c: '#5E574F' }] },
  ] };
  const page = { id: 'x', name: 'x', bg: '#F2EEE7', main };
  const [h, a, body] = T.themePage(page, T.THEMES.testabarra).main.c;
  assert.equal(h.ff, 'Bebas Neue'); assert.equal(h.z, 38); assert.equal(h.s, 'BROWSE THE BOOK');
  assert.equal(a.ff, 'Gilda Display'); assert.equal(a.z, 28); assert.equal(a.f[0].c, '#B23A32');
  assert.equal(body.ff, 'Archivo'); assert.equal(body.f[0].c, '#4A5570');
  const [jh, , jbody] = T.themePage(page, T.THEMES.jbaldwins).main.c;
  assert.equal(jh.ff, 'Cinzel'); assert.equal(jh.z, 28);
  assert.equal(jbody.ff, 'Montserrat');
  // The Baldwin: as drawn
  const [bh, ba, bb] = T.themePage(page, T.THEMES.baldwin).main.c;
  assert.equal(bh.ff, 'Archivo'); assert.equal(bh.z, 30); assert.equal(ba.ff, 'Pinyon Script'); assert.equal(ba.z, 28); assert.equal(bb.ff, 'Archivo');
});

test('styles.css: every rule that sets Archivo has its look-body line (scripts/look-body-css.mjs), so J.Baldwin’s text is Montserrat everywhere', async () => {
  const { build } = await import('../scripts/look-body-css.mjs');
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  assert.ok(css.includes(build(css)), 'run: node scripts/look-body-css.mjs');
});

test('contrast: every text role the new looks paint passes (body 4.5:1, large and UI 3:1)', () => {
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const id of ['testabarra', 'jbaldwins']) {
    const t = T.THEMES[id]; const c = (r, i = 0) => T.color(t, r, i);
    const pairs = [
      ['ink on page', c('ink'), c('page'), 4.5], ['ink on card', c('ink'), c('card'), 4.5], ['ink on wash', c('ink'), c('wash', 1), 4.5],
      ['muted on page', c('inkMuted', 0), c('page'), 4.5], ['muted on card', c('inkMuted', 0), c('card'), 4.5], ['muted 2 on card', c('inkMuted', 1), c('card'), 4.5],
      ['accent text on page', c('accentText'), c('page'), 4.5], ['accent text on card', c('accentText'), c('card'), 4.5],
      ['on dark', c('onInverse'), c('inverse'), 4.5], ['muted on dark', c('onInverseMuted', 1), c('inverse'), 4.5], ['label on dark', c('onInverseLabel'), c('inverse'), 4.5],
      ['label on raised dark', c('onInverseLabel'), c('inverseRaised', 0), 4.5], ['on chip', c('onInverseMuted', 1), c('inverseChip'), 4.5],
      ['accent on dark', c('accentOnDark'), c('inverse'), 4.5], ['ink on accent', c('onAccent'), c('accent'), 4.5],
      ['white on deep accent', c('onAccentOnLight'), c('accentOnLight'), 4.5], ['white on allergen', c('onDanger'), c('danger'), 4.5],
      ['button on light', c('onButton'), c('button'), 4.5], ['button on dark', c('onButtonOnDark'), c('buttonOnDark'), 4.5],
      ['deep accent bar on card (UI)', c('accentOnLight'), c('card'), 3], ['button edge on page (UI)', c('button'), c('page'), 3],
      ['outlined button on dark (UI)', c('outlineOnDark'), c('inverse'), 3], ['focus on page (UI)', c('focus'), c('page'), 3], ['focus band on dark (UI)', c('focusBand'), c('inverse'), 3],
      ['photo-to-come label', c('accentText'), c('placeholder'), 4.5],
      ['used bar on card (UI)', c('dataUsed'), c('card'), 3], ['wasted bar on card (UI)', c('dataWasted'), c('card'), 3],
    ];
    for (const [what, fg, bg, need] of pairs) assert.ok(ratio(fg, bg) >= need, `${id}: ${what} ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
  }
});
