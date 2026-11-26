// A link per account and its link preview (Nov 19; Figma 09 · Idea Board → 43, 850:1360; server/links.mjs). Tommy: "for
// each account … its own preview text, like the social preview … if it has custom branding … If it's generic, just doing
// the Mise." miseacademy.app/<account> opens that account's sign-in in its look; preview bots (no JavaScript) read the
// card from the HTML the server sends: Custom Brand with its own card → that card, everyone else → Mise's. The join code
// never shows. An account address can never shadow an app address. The Baldwin's card stays out of this repo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, turnOnTwoStep, PRIVATE_ACCOUNT, startServer } from './helpers.mjs';
import { reserved, isReserved, accountSlug, SLUG, DEMO_LINKS } from '../server/links.mjs';
import { baseIndex } from '../server/content.mjs';
import { PROGRAMS, LEVELS } from '../server/manual.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-links-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
const BOT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
let server, acct;
function person() {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
}
/** The page as a preview bot gets it: no cookies, no JavaScript, redirects not followed. */
const bot = async (p) => { const r = await fetch(BASE + p, { headers: { 'User-Agent': BOT }, redirect: 'manual' }); return { status: r.status, html: await r.text(), location: r.headers.get('location') }; };
const meta = (html, key) => { const m = new RegExp(`<meta (?:property|name)="${key.replace(/[:]/g, '\\:')}" content="([^"]*)"`).exec(html); return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null; };
const account = (html) => { const raw = meta(html, 'mise-account'); return raw ? JSON.parse(raw) : null; };

before(async () => {
  acct = giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@baldwin.test', SUPERADMIN_EMAIL: 'tommy@mise.test' }));
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const tommy = person(), owner = person(), harborOwner = person();
let code = '', harbor = null;

test('setup: The Baldwin’s owner, the super admin, and a Foundation company (Harbor Lane)', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Bram Owner', email: 'owner@baldwin.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@mise.test', password: 'long-enough-2' } })).status, 200);
  await turnOnTwoStep(tommy, { workIn: null });
  const add = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Harbor Lane', ownerEmail: 'owner@harbor.test' } });
  assert.equal(add.status, 200);
  harbor = add.data.id;
  assert.equal((await harborOwner(`/api/invite/${add.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Hal', password: 'long-enough-3' } })).status, 200);
  code = db().prepare('SELECT join_code FROM companies WHERE id = 1').get().join_code;
  assert.match(code, /^[A-Z0-9]{6,12}$/);
});

test('migration 24: Baldwin Restaurant Group’s link is /the-baldwin (the approved card’s address)', () => {
  const d = db();
  assert.ok(d.prepare('PRAGMA user_version').get().user_version >= 24);
  assert.equal(d.prepare('SELECT slug FROM companies WHERE id = 1').get().slug, 'the-baldwin');
  assert.equal(d.prepare('SELECT slug FROM companies WHERE id = ?').get(harbor).slug, 'harbor-lane');
});

/* ---------------- reserved addresses ---------------- */
test('every app address is reserved: the book’s pages, programs, levels, admin, demos, legal pages, API and build files', () => {
  const R = reserved();
  const firsts = new Set(baseIndex().map((e) => e.slug.split('/')[0]).filter(Boolean));
  for (const s of firsts) assert.ok(R.has(s), `book page /${s}`);
  for (const P of PROGRAMS) assert.ok(R.has(P.slug.split('/')[0]), `program /${P.slug}`);
  for (const L of LEVELS) assert.ok(R.has(L.slug.split('/')[0]), `level /${L.slug}`);
  for (const s of ['admin', 'api', 'demo', 'privacy', 'terms', 'help', 'img', 'icons', 'assets', 'media', 'content', 'import', 'prep', 'my-path', 'team-chat', 'certificate', 'share.jpg', 'favicon.ico', 'classic', 'signature', 'recipe', 'shelf', 'wine-list', 'beer-list', 'sommelier-program', 'cocktail-program', 'beer-program', 'hospitality-program', 'sign-in', 'join'])
    assert.ok(R.has(s), `/${s}`);
  for (const f of fs.readdirSync(path.join(root, 'public'))) assert.ok(R.has(f.toLowerCase()), `public/${f}`);
  if (fs.existsSync(path.join(root, 'dist'))) for (const f of fs.readdirSync(path.join(root, 'dist'))) assert.ok(R.has(f.toLowerCase()), `dist/${f}`);
  assert.ok(isReserved('demo-ab12cd34ef') && isReserved('demo-mise-ab12cd34ef'), 'a demo copy’s slug');
  for (const k of Object.keys(DEMO_LINKS)) assert.ok(isReserved(k));
  // the client's own routes (src/App.tsx and friends) are all in the list
  const src = ['src/App.tsx', 'src/components/Legal.tsx', 'src/lib/twostep.ts', 'src/lib/authroute.ts'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  for (const m of src.matchAll(/['"`]\/([a-z][a-z0-9-]*)/g)) assert.ok(R.has(m[1]), `client route /${m[1]}`);
});

test('a new company can never take an app address: Add Company picks the next free, safe slug', async () => {
  const d = db();
  for (const s of [...reserved()].filter((x) => SLUG.test(x)).slice(0, 400)) assert.notEqual(accountSlug(d, s), s, `/${s}`);
  assert.equal(accountSlug(d, 'Fig & Fire'), 'fig-and-fire-2', 'fig-and-fire is the demo’s address');
  assert.equal(accountSlug(d, 'Café Olé!'), 'cafe-ole');
  assert.equal(accountSlug(d, 'Harbor Lane'), 'harbor-lane-2', 'taken');
  for (const [name, not] of [['Admin', 'admin'], ['Food Matrix', 'food-matrix'], ['Privacy', 'privacy'], ['Demo', 'demo']]) {
    const r = await tommy('/api/super/companies', { method: 'POST', body: { name } });
    assert.equal(r.status, 200);
    const slug = db().prepare('SELECT slug FROM companies WHERE id = ?').get(r.data.id).slug;
    assert.notEqual(slug, not); assert.ok(SLUG.test(slug) && !isReserved(slug), slug);
  }
  // and the app's own address still opens the app (the Mise card, no account)
  for (const p of ['/admin', '/food-matrix', '/privacy', '/demo']) { const r = await bot(p); assert.equal(r.status, 200, p); assert.equal(account(r.html), null, p); }
});

test('walking every known one-segment app address: 200, the Mise card, never an account', async () => {
  const firsts = [...new Set([...baseIndex().map((e) => e.slug.split('/')[0]).filter(Boolean), ...PROGRAMS.map((P) => P.slug), 'admin', 'demo', 'privacy', 'terms', 'help', 'import', 'prep', 'my-path', 'team-chat', 'certificate', 'sign-in', 'join'])];
  for (const s of firsts) {
    const r = await bot('/' + s);
    assert.equal(r.status, 200, '/' + s);
    assert.equal(account(r.html), null, '/' + s);
    assert.equal(meta(r.html, 'og:title'), 'Mise Academy', '/' + s);
  }
  // deeper addresses (a book page, a lesson) are the app as before
  for (const p of ['/classic/old-fashioned', '/cocktail-program/level-1', '/admin/people', '/demo/mise']) assert.equal((await bot(p)).status, 200, p);
});

/* ---------------- the account's page and its card ---------------- */
test('/the-baldwin: the account’s sign-in data in the HTML (name and look), never its join code', async () => {
  const r = await bot('/the-baldwin');
  assert.equal(r.status, 200);
  assert.deepEqual(account(r.html), { slug: 'the-baldwin', name: 'Baldwin Restaurant Group', brand: 'baldwin' });
  assert.equal(meta(r.html, 'og:url'), 'https://www.miseacademy.app/the-baldwin');
  assert.ok(!r.html.includes(code), 'the join code is not in the page');
  assert.ok(!r.html.toLowerCase().includes('join_code') && !/joinCode/.test(r.html));
  // capitals and a trailing slash go to the one address; the demo's name opens the demo
  assert.deepEqual([(await bot('/The-Baldwin/')).status, (await bot('/The-Baldwin/')).location], [301, '/the-baldwin']);
  assert.deepEqual([(await bot('/fig-and-fire')).status, (await bot('/fig-and-fire')).location], [302, '/demo/mise']);
});

test('Custom Brand without its own card yet: the Mise card. With one in its account folder: its own card', async () => {
  // The made-up test account has no "share"; the real one (MISE_PRIVATE_ACCOUNT) has The Baldwin's.
  if (!PRIVATE_ACCOUNT) {
    const r = await bot('/the-baldwin');
    assert.equal(meta(r.html, 'og:title'), 'Mise Academy');
    assert.match(meta(r.html, 'og:image'), /^https:\/\/www\.miseacademy\.app\/img\/mise-brand\/share-card\.jpg\?v=[0-9a-f]{10}$/);
    // give the account a card (a made-up image), the way The Baldwin's sits on the volume
    fs.mkdirSync(path.join(acct, 'public', 'img'), { recursive: true });
    fs.copyFileSync(path.join(root, 'public/img/mise-brand/share-card.jpg'), path.join(acct, 'public/img/test-account-card.jpg'));
    const m = JSON.parse(fs.readFileSync(path.join(acct, 'account.json'), 'utf8'));
    m.share = { title: 'The Training App · The Baldwin', description: 'The menu, the bar, wine and service, all in one place. For The Baldwin team: sign in with your join code.', image: '/img/test-account-card.jpg', alt: 'A test card' };
    fs.writeFileSync(path.join(acct, 'account.json'), JSON.stringify(m));
  }
  const r = await bot('/the-baldwin');
  assert.equal(meta(r.html, 'og:title'), 'The Training App · The Baldwin');
  assert.equal(meta(r.html, 'twitter:title'), 'The Training App · The Baldwin');
  assert.match(r.html, /<title>The Training App · The Baldwin<\/title>/);
  assert.equal(meta(r.html, 'og:description'), 'The menu, the bar, wine and service, all in one place. For The Baldwin team: sign in with your join code.');
  const img = meta(r.html, 'og:image');
  assert.equal(meta(r.html, 'twitter:image'), img);
  assert.equal(meta(r.html, 'twitter:card'), 'summary_large_image');
  assert.equal(meta(r.html, 'og:image:width'), '1200'); assert.equal(meta(r.html, 'og:image:height'), '630');
  const u = new URL(img);
  assert.match(u.search, /^\?v=[0-9a-f]{10}$/, 'versioned, so cached previews refresh');
  assert.doesNotMatch(u.pathname, /mise-brand/);
  const file = await fetch(BASE + u.pathname + u.search);
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/jpeg');
  assert.ok((await file.arrayBuffer()).byteLength < 300e3);
  // On the Foundation plan, the same account shows Mise's card (the card comes with Custom Brand).
  assert.equal((await tommy('/api/super/companies/1', { method: 'PATCH', body: { plan: 'foundation' } })).status, 200);
  assert.equal(meta((await bot('/the-baldwin')).html, 'og:title'), 'Mise Academy');
  assert.equal(account((await bot('/the-baldwin')).html).brand, 'mise');
  assert.equal((await tommy('/api/super/companies/1', { method: 'PATCH', body: { plan: 'custom-brand', look: 'baldwin' } })).status, 200);
  assert.equal(meta((await bot('/the-baldwin')).html, 'og:title'), 'The Training App · The Baldwin');
});

test('a Foundation account: its own link, the Mise card, the Mise look, no join code', async () => {
  const hcode = db().prepare('SELECT join_code FROM companies WHERE id = ?').get(harbor).join_code;
  const r = await bot('/harbor-lane');
  assert.equal(r.status, 200);
  assert.deepEqual(account(r.html), { slug: 'harbor-lane', name: 'Harbor Lane', brand: 'mise' });
  assert.equal(meta(r.html, 'og:title'), 'Mise Academy');
  assert.equal(meta(r.html, 'og:description'), 'The menu, the bar, wine and service, all in one place.');
  assert.equal(meta(r.html, 'og:url'), 'https://www.miseacademy.app/harbor-lane');
  assert.match(meta(r.html, 'og:image'), /\/img\/mise-brand\/share-card\.jpg\?v=/);
  assert.ok(!r.html.includes(hcode) && !r.html.includes(code));
  assert.doesNotMatch(r.html, /Baldwin/);
});

test('the site root keeps the Mise card, never The Baldwin’s', async () => {
  for (const p of ['/', '/index.html']) {
    const r = await bot(p);
    assert.equal(r.status, 200);
    assert.equal(meta(r.html, 'og:title'), 'Mise Academy');
    assert.equal(meta(r.html, 'og:url'), 'https://www.miseacademy.app/');
    assert.match(meta(r.html, 'og:image'), /^https:\/\/www\.miseacademy\.app\/img\/mise-brand\/share-card\.jpg\?v=[0-9a-f]{10}$/);
    assert.equal(account(r.html), null);
    assert.doesNotMatch(r.html, /Baldwin|share\.jpg/);
  }
  const img = await fetch(new URL(meta((await bot('/')).html, 'og:image')).pathname.replace(/^/, BASE));
  assert.equal(img.status, 200);
  // the old card's address (The Baldwin's, until today) now shows Mise's
  const old = await bot('/share.jpg?v=4');
  assert.equal(old.status, 301); assert.equal(old.location, '/img/mise-brand/share-card.jpg');
});

test('unknown, deleted, demo-copy and HQ addresses are not accounts: the usual not-found page (404) or the app', async () => {
  for (const p of ['/nope', '/baldwin', '/harbor-lanes', '/x', '/no-such-group']) {
    const r = await bot(p);
    assert.equal(r.status, 404, p);
    assert.match(r.html, /<div id="root"><\/div>/, 'the app’s own page, which shows its not-found screen');
    assert.equal(account(r.html), null);
    assert.equal(meta(r.html, 'og:title'), 'Mise Academy');
  }
  // HQ: Mise's own company has no link
  const hq = db().prepare('SELECT slug FROM companies WHERE internal = 1').get().slug;
  assert.equal(account((await bot('/' + hq)).html), null);
  // a demo copy has no link
  const visitor = person();
  assert.equal((await visitor('/api/demo/start', { method: 'POST', body: { role: 'manager', demo: 'mise' } })).status, 200);
  const demoSlug = db().prepare('SELECT slug FROM companies WHERE demo = 1 ORDER BY id DESC LIMIT 1').get().slug;
  assert.equal(account((await bot('/' + demoSlug)).html), null);
  // a deleted company's link stops working
  const add = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Slate Room' } });
  assert.equal(account((await bot('/slate-room')).html)?.name, 'Slate Room');
  assert.equal((await tommy(`/api/super/companies/${add.data.id}`, { method: 'DELETE', body: { confirm: 'Slate Room' } })).status, 200);
  assert.equal((await bot('/slate-room')).status, 404);
});

test('from an account’s link, the join code has to be that account’s', async () => {
  const hcode = db().prepare('SELECT join_code FROM companies WHERE id = ?').get(harbor).join_code;
  const p = person();
  assert.equal((await p(`/api/join/${code}?account=the-baldwin`)).status, 200);
  assert.equal((await p(`/api/join/${code}?account=harbor-lane`)).status, 404);
  assert.equal((await p(`/api/join/${hcode}?account=the-baldwin`)).status, 404);
  assert.equal((await p(`/api/join/${hcode}?account=harbor-lane`)).data.company, 'Harbor Lane');
  assert.equal((await p(`/api/join/${hcode}`)).status, 200, 'without a link, any code works as before');
});

test('owners see their link (Team, People), super admins every company’s (Companies, the HQ home)', async () => {
  assert.equal((await owner('/api/team')).data.company.link, '/the-baldwin');
  assert.equal((await harborOwner('/api/team')).data.company.link, '/harbor-lane');
  assert.equal((await owner('/api/manager/team')).data.link, '/the-baldwin');
  const ov = (await tommy('/api/super/overview')).data;
  assert.equal(ov.companies.find((c) => c.id === 1).link, '/the-baldwin');
  assert.equal(ov.companies.find((c) => c.hq).link, null, 'HQ has none');
  const home = (await tommy('/api/super/home')).data;
  assert.equal(home.companies.find((c) => c.id === harbor).link, '/harbor-lane');
});

/* ---------------- The Baldwin's card stays out of the public repo ---------------- */
// sha256 of The Baldwin's cards: the old one (public/share.jpg until Nov 19), the 1200×630 JPG and the 2x PNG master
// (both in mise-private and on the volume only). A hash says nothing about the picture; it only proves it's not here.
const BALDWIN_CARDS = new Set([
  '41241381e218e9b5fc1bdd526c7d20a728d95968107146faad6d203ac3866d9d',
  '39aa8283748da51d5239f4a3ebc6d5e14c93bbaa6398c64c66c4b788f1879e25',
  '4892c050223b3c214c431cd38b744ab95f713e9a5b66a6d6da715b7ec233d5e8',
]);
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
test('leak check: no Baldwin card (or any file of the private account) in public/, dist/ or index.html', () => {
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const privateHashes = new Set(BALDWIN_CARDS);
  if (PRIVATE_ACCOUNT) for (const f of walk(PRIVATE_ACCOUNT)) if (/\.(jpe?g|png|webp|svg)$/i.test(f)) privateHashes.add(sha(f));
  for (const f of [...walk(path.join(root, 'public')), ...walk(path.join(root, 'dist'))]) {
    if (!/\.(jpe?g|png|webp|gif|svg)$/i.test(f)) continue;
    assert.ok(!privateHashes.has(sha(f)), `${path.relative(root, f)} is The Baldwin’s private material`);
  }
  assert.ok(!fs.existsSync(path.join(root, 'public/share.jpg')), 'The Baldwin’s old card is gone from the repo');
  assert.ok(!walk(path.join(root, 'public')).some((f) => /baldwin.*(share|card)|share.*baldwin/i.test(path.basename(f))));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /Baldwin/);
  assert.match(html, /<!-- share:start -->[\s\S]*og:image[\s\S]*<!-- share:end -->/, 'the block the server swaps');
});
