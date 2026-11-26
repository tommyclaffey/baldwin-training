// Your Look from your website (Nov 22; Figma 09 · Idea Board → 44, 877:1388; Tommy, Nov 20: "Looks good to me").
// The website reader is safe (no private addresses, size and time limits, redirects checked), the colours get their roles
// and every pair passes contrast after the fixes, looks are data (a `looks` row, worn as 'look-<id>'), only Custom Brand
// owners and managers use it (Foundation owners see the upgrade card), Apply and Undo work and are logged, files are the
// company's own, and the hand-built looks (The Baldwin, Testa Barra, J.Baldwin's) don't change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { giveAccount, turnOnTwoStep, startServer } from './helpers.mjs';
import { isPrivateIp, checkUrl, safeFetch, readSite, ReadError } from '../server/lookreader.mjs';
import { fixColors, checkPairs, rolesFromColors, ratio, hsl, validSpec } from '../src/lib/lookspec.ts';
import { lookOf, lookOfStore } from '../server/looks.mjs';
const T = await import('../src/lib/theme.ts');

/* ── 1. The reader is safe ────────────────────────────────────────────────────────────────────────────────────────── */
test('private, local and odd addresses are refused before anything is fetched', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:a00:1', '64:ff9b::10.0.0.1'])
    assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
  for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'file:///etc/passwd', 'ftp://example.com/',
    'http://user:pass@example.com/', 'http://example.com:8080/', 'http://printer.local/', 'http://metadata.google.internal/', 'gopher://example.com/', 'javascript:alert(1)'])
    assert.throws(() => checkUrl(u), ReadError, u);
  assert.equal(checkUrl('https://www.jbaldwins.com/menu/').hostname, 'www.jbaldwins.com');
});

let site, sitePort, siteHost;
const pages = new Map();
before(async () => {
  // a small restaurant website on this machine (let through only by the test-only `_allow`)
  const logo = await sharp({ create: { width: 600, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120"><rect x="0" y="10" width="120" height="100" fill="#860028"/><rect x="140" y="30" width="420" height="60" fill="#0B0A08"/></svg>'), left: 20, top: 20 }]).png().toBuffer();
  const white = await sharp({ create: { width: 600, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120"><rect width="560" height="120" fill="#FFFFFF"/></svg>'), left: 20, top: 20 }]).png().toBuffer();
  const photo = await sharp({ create: { width: 1400, height: 900, channels: 3, background: '#7A4E31' } }).jpeg().toBuffer();
  pages.set('/', ['text/html', `<!doctype html><html><head><title>Fig Hall | Supper</title><meta property="og:site_name" content="Fig Hall"><meta name="theme-color" content="#C9A455">
    <link rel="stylesheet" href="/site.css"><link rel="apple-touch-icon" href="/icon.png"><meta property="og:image" content="/hero.jpg">
    <style>:root{--brand-gold:#C9A455;--brand-cream:#FBF1E3}</style></head><body><header><img class="custom-logo" src="/fighall-logo-white.png" alt="Fig Hall"></header>
    <a href="/menu/">Menu</a><img src="/hero.jpg" width="1400" height="900"><img src="/fighall-logo.png" alt="Fig Hall logo"></body></html>`]);
  pages.set('/menu/', ['text/html', '<html><body><p style="color:#9A9282">Menu</p></body></html>']);
  pages.set('/site.css', ['text/css', `body{background:#FBF1E3;color:#0B0A08;font-family:"Montserrat",sans-serif} h1,h2{font-family:"TAN Grandeur",serif;color:#0B0A08}
    .nav{background:#0B0A08;color:#C9A455}.muted{color:#9A9282}.line{border-color:#D9D1C2}.btn{background:#C9A455}.dark{background:#0B0A08}`]);
  pages.set('/fighall-logo-white.png', ['image/png', white]);
  pages.set('/fighall-logo.png', ['image/png', logo]);
  pages.set('/icon.png', ['image/png', await sharp({ create: { width: 180, height: 180, channels: 3, background: '#860028' } }).png().toBuffer()]);
  pages.set('/hero.jpg', ['image/jpeg', photo]);
  site = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/huge') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(Buffer.alloc(2e6, 'a')); return; }
    if (u.pathname === '/bomb') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); res.end(zlib.gzipSync(Buffer.alloc(30e6, 0))); return; }
    if (u.pathname === '/slow') return; // never answers
    if (u.pathname === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); return; }
    if (u.pathname === '/to-metadata') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return; }
    if (u.pathname === '/to-localhost') { res.writeHead(302, { Location: `http://localhost:${sitePort}/` }); res.end(); return; }
    const p = pages.get(u.pathname);
    if (!p) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': p[0] }); res.end(p[1]);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  sitePort = site.address().port; siteHost = `127.0.0.1:${sitePort}`;
});
after(() => site?.close());

test('size and time limits, redirects checked at every hop, content types enforced', async () => {
  const base = `http://${siteHost}`;
  const opt = { _allow: siteHost };
  // the test server itself is private, so without the test-only allowance it's refused
  await assert.rejects(safeFetch(base + '/'), (e) => e instanceof ReadError && /public internet|port/.test(e.message));
  await assert.rejects(safeFetch(base + '/huge', { ...opt, maxBytes: 1e6 }), (e) => e.code === 'size');
  await assert.rejects(safeFetch(base + '/bomb', { ...opt, maxBytes: 3e6 }), (e) => e.code === 'size', 'a gzip bomb is counted after decompression');
  await assert.rejects(safeFetch(base + '/slow', { ...opt, timeoutMs: 400 }), (e) => e.code === 'timeout');
  await assert.rejects(safeFetch(base + '/loop', opt), (e) => e.code === 'redirects');
  await assert.rejects(safeFetch(base + '/to-metadata', opt), (e) => e.code === 'private', 'a redirect to the cloud metadata address is refused');
  await assert.rejects(safeFetch(base + '/to-localhost', opt), (e) => ['private', 'url'].includes(e.code), 'a redirect to another local name is refused');
  await assert.rejects(safeFetch(base + '/', { ...opt, kinds: ['image'] }), (e) => e.code === 'type');
  assert.equal((await safeFetch(base + '/', opt)).status, 200);
});

let found;
test('reading a site: the logo files (white for dark, colour for light), the colours by use, the fonts with stand-ins, photos', async () => {
  const steps = [];
  found = await readSite(`http://${siteHost}/`, { _allow: siteHost, isGoogle: async (n) => ['Montserrat'].includes(n), step: (i, s) => steps.push(i + s) });
  assert.ok(steps.includes('0done') && steps.includes('5done'), steps.join(','));
  assert.equal(found.siteName, 'Fig Hall');
  assert.equal(found.pages.length, 2, 'the home page and the menu');
  assert.deepEqual(found.logos.map((l) => l.variant).sort(), ['dark', 'light']);
  const white = found.logos.find((l) => l.variant === 'dark');
  assert.deepEqual(white.a.crop, [20, 20, 560, 120, 600, 160], 'the artwork box inside the file (the file itself is never changed)');
  assert.ok(found.logoColors.includes('#860028'), 'colours are read from the logo’s own pixels too');
  for (const h of ['#C9A455', '#FBF1E3', '#0B0A08', '#9A9282']) assert.ok(found.colors.some((c) => c.hex === h), h);
  assert.equal(found.fonts.heading, 'Cinzel', 'TAN Grandeur (paid) gets its free stand-in');
  assert.equal(found.fonts.standIn.heading, 'TAN Grandeur');
  assert.equal(found.fonts.accent, 'Gilda Display');
  assert.equal(found.fonts.body, 'Montserrat', 'a Google font is used as it is');
  assert.ok(found.icon && found.photos.length === 1);
});

/* ── 2. Roles and the contrast fixes ──────────────────────────────────────────────────────────────────────────────── */
test('roles and contrast: every pair passes after the fixes; a bright accent stays on dark; shades change, never the hue', () => {
  const m = rolesFromColors(found.colors);
  const f = fixColors(m.colors, { logo: found.logoColors, named: [], other: found.colors.map((c) => c.hex) });
  assert.ok(checkPairs(f.colors).every((p) => p.pass), JSON.stringify(checkPairs(f.colors)));
  assert.equal(f.colors.accentDark, '#C9A455', 'gold stays the accent on dark');
  assert.equal(f.colors.accentLight, '#860028', 'on light, the burgundy from the logo');
  assert.equal(f.colors.panel, '#0B0A08');
  const mu = f.fixes.find((x) => x.id === 'muted');
  assert.ok(mu, 'the warm grey was fixed');
  assert.ok(Math.abs(hsl(mu.before.fg)[0] - hsl(mu.after.fg)[0]) < 6, 'same hue');
  assert.ok(ratio(f.colors.onAccentDark, f.colors.accentDark) >= 4.5 && ratio(f.colors.onAccentDark, '#000000') < 3, 'dark ink on the bright accent');
  // a failing pick by hand is fixed too
  const g = fixColors({ ...f.colors, ink: '#AAAAAA', label: '#222222' });
  assert.ok(checkPairs(g.colors).every((p) => p.pass));
  assert.deepEqual(g.fixes.map((x) => x.id).sort(), ['ink', 'label']);
});

test('a look as data fills every role of a theme; the hand-built looks are untouched', () => {
  const spec = { v: 1, name: 'Fig Hall', colors: fixColors(rolesFromColors(found.colors).colors).colors, fonts: { heading: 'Cinzel', accent: 'Gilda Display', body: 'Montserrat', headingCase: 'upper' },
    logo: { dark: { src: '/look-files/9/' + 'a'.repeat(32) + '.png', w: 600, h: 160, crop: [20, 20, 560, 120, 600, 160] } } };
  assert.ok(validSpec(spec));
  assert.equal(validSpec({ ...spec, logo: { dark: { ...spec.logo.dark, src: '/look-files/9/x.svg' } } }), false, 'never SVG, never another address');
  assert.equal(validSpec({ ...spec, colors: { ...spec.colors, ink: 'red' } }), false);
  const th = T.themeFromSpec('look-9', spec);
  for (const role of Object.keys(T.THEMES.baldwin.colors)) assert.ok(th.colors[role], role);
  for (const role of Object.keys(T.THEMES.baldwin.type)) assert.ok(th.type[role], role);
  assert.equal(th.type.pageTitle.case, 'upper');
  assert.equal(th.drawnLogo.crop.join(), '20,20,560,120,600,160');
  // the four built-in looks are the same objects as before (snapshot of a few values each)
  assert.deepEqual(T.BRAND_IDS, ['baldwin', 'mise', 'testabarra', 'jbaldwins']);
  assert.equal(T.THEMES.jbaldwins.colors.accent[0], '#C9A455'); assert.equal(T.THEMES.testabarra.colors.inverse, '#1F2A44'); assert.equal(T.THEMES.baldwin.colors.page, '#F2EEE7');
  assert.equal(T.lookTheme('baldwin'), T.THEMES.baldwin);
  assert.equal(T.lookTheme('look-424242'), T.THEMES.mise, 'a data look not here yet draws in Mise until its paint arrives');
});

/* ── 3. The app: gating, data, Apply, Undo, files ─────────────────────────────────────────────────────────────────── */
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-yourlook-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;
function person() {
  let jar = '';
  return async (p, { method = 'GET', body, raw, type } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': type || 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json().catch(() => null) : null, headers: res.headers };
  };
}
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const owner = person(), tommy = person(), staff = person(), harborOwner = person(), anon = person(), demo = person(), jb = person();
let code = '';
before(async () => {
  giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@baldwin.test', SUPERADMIN_EMAIL: 'tommy@mise.test', ANTHROPIC_API_KEY: '' }));
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('setup: The Baldwin’s owner, staff at J.Baldwin’s, the super admin, and a Foundation company with its owner', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Bram Owner', email: 'owner@baldwin.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@mise.test', password: 'long-enough-2' } })).status, 200);
  await turnOnTwoStep(tommy, { workIn: null });
  code = db().prepare('SELECT join_code FROM companies WHERE id = 1').get().join_code;
  assert.equal((await staff('/api/join', { method: 'POST', body: { code, name: 'Jo Jaybee', email: `j${Math.random().toString(36).slice(2, 10)}@join.test`, password: 'join-pass-4321-x', storeId: 2 } })).status, 200);
  const add = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Harbor Hall', stores: ['Dockside'], ownerEmail: 'owner@harbor.test' } });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  const token = add.data.link.split('/').pop();
  assert.equal((await harborOwner(`/api/invite/${token}`, { method: 'POST', body: { name: 'Hal Harbor', password: 'long-enough-3' } })).status, 200);
});

test('gating: Custom Brand owners use it; a Foundation owner sees the upgrade card and can’t read or apply; staff never', async () => {
  assert.equal((await owner('/api/me')).data.user.yourLook, 'full');
  assert.equal((await harborOwner('/api/me')).data.user.yourLook, 'upgrade');
  assert.equal((await staff('/api/me')).data.user.yourLook, 'none');
  const h = await harborOwner('/api/your-look');
  assert.equal(h.status, 200); assert.equal(h.data.access, 'upgrade');
  assert.equal((await harborOwner('/api/your-look/read', { method: 'POST', body: { url: 'example.com' } })).status, 403);
  assert.equal((await harborOwner('/api/your-look/blank', { method: 'POST' })).status, 403);
  assert.equal((await staff('/api/your-look')).status, 403);
  assert.equal((await anon('/api/your-look')).status, 401);
});

test('the read refuses private and local addresses (the server reads nothing)', async () => {
  for (const url of ['localhost', 'http://127.0.0.1/', '10.0.0.5', 'http://169.254.169.254/', 'file:///etc/passwd', `http://127.0.0.1:${PORT}/api/me`]) {
    const r = await owner('/api/your-look/read', { method: 'POST', body: { url } });
    assert.equal(r.status, 400, url + ' ' + JSON.stringify(r.data));
  }
  assert.equal(db().prepare('SELECT COUNT(*) n FROM look_reads').get().n, 0);
});

let look = '';
test('a look by hand is data; changes are checked (a failing colour is fixed and flagged; files must be its own)', async () => {
  assert.equal((await owner('/api/store', { method: 'POST', body: { storeId: 2 } })).status, 200);
  const b = await owner('/api/your-look/blank', { method: 'POST' });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  look = b.data.id;
  assert.match(look, /^look-\d+$/);
  const row = db().prepare('SELECT company_id, status, spec FROM looks WHERE id = ?').get(Number(look.slice(5)));
  assert.equal(row.company_id, 1); assert.equal(row.status, 'draft'); assert.ok(validSpec(JSON.parse(row.spec)));
  // a pale grey for text is fixed (darkened) and said
  const p = await owner(`/api/your-look/looks/${look}`, { method: 'PATCH', body: { colors: { ink: '#BBBBBB' }, fonts: { heading: 'Cinzel' } } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.ok(p.data.pairs.every((x) => x.pass));
  assert.ok(p.data.justFixed.some((f) => f.id === 'ink'));
  assert.equal(p.data.spec.fonts.headingCase, 'upper');
  for (const bad of [{ colors: { ink: 'blue' } }, { fonts: { heading: '<script>' } }, { photo: '/look-files/1/' + 'b'.repeat(32) + '.jpg' }, { logo: { dark: 'https://evil.test/x.png' } }])
    assert.equal((await owner(`/api/your-look/looks/${look}`, { method: 'PATCH', body: bad })).status, 400, JSON.stringify(bad));
  // a logo upload: kept as it is, its artwork box measured
  const png = await sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="#fff"/></svg>'), left: 50, top: 20 }]).png().toBuffer();
  const up = await owner(`/api/your-look/looks/${look}/logo?variant=dark`, { method: 'POST', raw: png, type: 'image/png' });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.deepEqual(up.data.spec.logo.dark.crop, [50, 20, 300, 80, 400, 120]);
  const file = path.join(dir, 'looks', '1', up.data.spec.logo.dark.src.split('/').pop());
  assert.ok(fs.readFileSync(file).equals(png), 'the file is stored exactly as uploaded');
  // the company's draft files are private: signed out and other companies get nothing
  assert.equal((await anon(up.data.spec.logo.dark.src)).status, 404);
  assert.equal((await harborOwner(up.data.spec.logo.dark.src)).status, 404);
  assert.equal((await owner(up.data.spec.logo.dark.src)).status, 200);
  assert.equal((await harborOwner(`/api/your-look/looks/${look}`)).status, 404, 'another company can’t open it');
  assert.equal((await anon(`/api/looks/${look}/spec`)).status, 404, 'a draft’s paint is private');
});

test('Apply to one store: that store wears the look; the others keep theirs; the log has it; then Undo puts it back', async () => {
  const before = db().prepare('SELECT id, look FROM stores WHERE company_id = 1 ORDER BY id').all().map((s) => [s.id, s.look]);
  const a = await owner(`/api/your-look/looks/${look}/apply`, { method: 'POST', body: { scope: 'store' } });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(db().prepare('SELECT look FROM stores WHERE id = 2').get().look, look, 'stored as data: the store points at the look');
  const me = (await staff('/api/me')).data.user;
  assert.equal(me.brand, look); assert.ok(validSpec(me.lookSpec), 'the session brings the look’s paint');
  const j = (await anon(`/api/join/${code}`)).data;
  assert.equal(j.stores.find((s) => s.id === 2).brand, look); assert.ok(j.looks[look], 'the join screen brings it too');
  assert.equal(j.brand, 'baldwin');
  assert.equal((await anon(`/api/looks/${look}/spec`)).status, 200, 'worn: its paint is public (sign-in shows it)');
  const logo = me.lookSpec.logo.dark.src;
  assert.equal((await anon(logo)).status, 200, 'worn: its logo opens signed out');
  const co = db().prepare('SELECT * FROM companies WHERE id = 1').get();
  assert.equal(lookOf(co), 'baldwin', 'the company’s own look is unchanged');
  for (const st of db().prepare('SELECT * FROM stores WHERE company_id = 1 AND id <> 2').all()) assert.equal(lookOfStore(co, st), st.look || 'baldwin');
  assert.ok(db().prepare("SELECT 1 FROM audit WHERE action = 'your look: apply'").get());
  const und = await owner('/api/your-look/undo', { method: 'POST' });
  assert.equal(und.status, 200);
  assert.deepEqual(db().prepare('SELECT id, look FROM stores WHERE company_id = 1 ORDER BY id').all().map((s) => [s.id, s.look]), before);
  assert.notEqual((await staff('/api/me')).data.user.brand, look);
  assert.equal((await owner('/api/your-look/undo', { method: 'POST' })).status, 400, 'nothing left to undo');
  assert.ok(db().prepare("SELECT 1 FROM audit WHERE action = 'your look: undo'").get());
  assert.equal(db().prepare('SELECT status FROM looks WHERE id = ?').get(Number(look.slice(5))).status, 'saved', 'the look stays saved after Undo');
});

test('every store: the company look and every store change; Undo puts each back (The Baldwin, J.Baldwin’s, Testa Barra)', async () => {
  const d = db();
  d.prepare("UPDATE stores SET look = 'jbaldwins' WHERE id = 2").run(); d.prepare("UPDATE stores SET look = 'testabarra' WHERE id = 3").run();
  const before = d.prepare('SELECT id, look FROM stores WHERE company_id = 1 ORDER BY id').all().map((s) => [s.id, s.look]);
  const a = await owner(`/api/your-look/looks/${look}/apply`, { method: 'POST', body: { scope: 'group' } });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(db().prepare('SELECT brand FROM companies WHERE id = 1').get().brand, look);
  // the account's link shows a card made from the look, and its sign-in brings the look's paint
  const html = await (await fetch(BASE + '/the-baldwin')).text();
  const img = /property="og:image" content="[^"]*(\/look-files\/1\/[a-f0-9]+\.jpg)/.exec(html)?.[1];
  assert.ok(img, 'og:image is the look’s card');
  assert.equal((await anon(img)).status, 200, 'and it opens signed out');
  assert.match(html, /Training on Mise Academy/);
  assert.match(html, /lookSpec/);
  assert.equal((await owner('/api/your-look/undo', { method: 'POST' })).status, 200);
  assert.doesNotMatch(await (await fetch(BASE + '/the-baldwin')).text(), /look-files/, 'Undo: The Baldwin’s own card again');
  assert.equal(db().prepare('SELECT brand FROM companies WHERE id = 1').get().brand, 'baldwin');
  assert.deepEqual(db().prepare('SELECT id, look FROM stores WHERE company_id = 1 ORDER BY id').all().map((s) => [s.id, s.look]), before);
});

test('the demo: a Foundation demo can try it (a throwaway look), and the look and its files go with the demo', async () => {
  assert.equal((await demo('/api/demo/start', { method: 'POST', body: { role: 'manager', demo: 'mise' } })).status, 200);
  const st = (await demo('/api/your-look')).data;
  assert.equal(st.access, 'try');
  const b = await demo('/api/your-look/blank', { method: 'POST' });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.equal((await demo(`/api/your-look/looks/${b.data.id}/apply`, { method: 'POST', body: { scope: 'store' } })).status, 200);
  const me = (await demo('/api/me')).data.user;
  assert.equal(me.brand, b.data.id, 'the demo wears its throwaway look');
  const co = me.companyId;
  assert.equal(db().prepare('SELECT brand FROM companies WHERE id = ?').get(co).brand, 'mise', 'a demo copy keeps its company look (it decides which demo it is)');
  assert.equal((await demo('/api/demo/exit', { method: 'POST' })).status, 200);
  assert.equal(db().prepare('SELECT COUNT(*) n FROM looks WHERE company_id = ?').get(co).n, 0, 'wiped with the demo');
  assert.equal(fs.existsSync(path.join(dir, 'looks', String(co))), false);
});

test('a super admin can run it for any company they work in', async () => {
  assert.equal((await tommy('/api/super/act', { method: 'POST', body: { companyId: 1 } })).status, 200);
  assert.equal((await tommy('/api/your-look')).data.access, 'full');
  // and the company's saved looks show up in the super admin's look pickers
  const c = (await tommy('/api/super/overview')).data.companies.find((x) => x.id === 1);
  assert.ok(c.looks.some((l) => l.id === look));
});
