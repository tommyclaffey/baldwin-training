// Accessibility checks on every page of both demos (Nov 12, from the accessibility scan): real headings, photos read out by
// what they show (never a Figma layer name), and the Food Matrix and Allergen Guide built as tables. Runs the real server
// on a temp database, then the theme layer (src/lib/theme.ts) on each page the way the browser does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const T = await import('../src/lib/theme.ts');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-a11y-'));
const PORT = 4900 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };
const isPhoto = (n) => n.t !== 'T' && n.t !== 'F' && !!n.f?.some((f) => f.img);

/** Every page of a demo, as a manager sees it (managers get every page staff do, plus the "+ Add" rows). */
async function demoPages(demo) {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ role: 'manager', demo }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
  const get = async (p) => { const x = await fetch(BASE + p, { headers: { cookie, 'x-bt': '1' } }); assert.equal(x.status, 200, p); return x.json(); };
  const index = await get('/api/index');
  const pages = [];
  for (const e of index) { const p = await get('/api/page/' + e.file); if (p.main) pages.push({ slug: e.slug, ...p }); }
  return pages;
}
const cache = {};
const pagesOf = async (demo) => (cache[demo] ||= await demoPages(demo));

for (const [demo, brand] of [['baldwin', 'baldwin'], ['mise', 'mise']]) {
  test(`${demo} demo: every page has one h1, and no heading skips a level`, async () => {
    const pages = await pagesOf(demo);
    assert.ok(pages.length > 500, 'the whole book: ' + pages.length);
    const bad = [];
    for (const p of pages) {
      const main = T.themePage(p, T.THEMES[brand]).main;
      const hs = all(main, (n) => n.t === 'T' && !!n.hd);
      const h1 = hs.filter((h) => h.hd === 1).length;
      // a page with no drawn title gets a hidden h1 from PageView (hasPageTitle false), so it still has exactly one
      if (h1 > 1) bad.push(`${p.slug}: ${h1} h1s`);
      if (h1 === 1 && !T.hasPageTitle(main)) bad.push(`${p.slug}: hasPageTitle disagrees`);
      let last = 1;
      for (const h of hs) { if (h.hd > last + 1) bad.push(`${p.slug}: h${h.hd} "${h.s}" after h${last}`); last = h.hd; }
      for (const h of hs) if (!/\p{L}/u.test(h.s || '')) bad.push(`${p.slug}: a number as a heading "${h.s}"`);
      for (const h of hs) if (h.tbl || h.to) bad.push(`${p.slug}: "${h.s}" is a table cell or a link, not a heading`);
    }
    assert.deepEqual(bad.slice(0, 10), []);
    const withTitle = pages.filter((p) => T.hasPageTitle(T.themePage(p, T.THEMES[brand]).main)).length;
    assert.ok(withTitle / pages.length > 0.95, `most pages draw their own title: ${withTitle} of ${pages.length}`);
  });

  test(`${demo} demo: photos are read by what they show, never by a Figma layer name`, async () => {
    const pages = await pagesOf(demo);
    const bad = []; let named = 0;
    for (const p of pages) {
      const main = T.themePage(p, T.THEMES[brand]).main;
      const title = all(main, (n) => n.t === 'T' && n.hd === 1)[0];
      for (const ph of all(main, isPhoto)) {
        if (!ph.alt) continue;
        named++;
        const layer = (ph.n || '').replace(/^IMG\//, '').replace(/^Hero photo · /, '').split(' · ')[0].trim();
        // a named photo shows the page's own subject (its dish, drink, wine, bottle or beer), by the page's title
        if (!title || ph.alt !== T.titleCase((title.s || '').replace(/\s+/g, ' ').trim())) bad.push(`${p.slug}: "${ph.alt}" isn't the page's subject`);
        if (/^(IMG\/|Hero photo|Photo|Image|Rectangle|Ellipse|thumb)\b/i.test(ph.alt) || (/^[a-z]+$/.test(layer) && ph.alt === layer)) bad.push(`${p.slug}: "${ph.alt}" is a layer name`);
      }
    }
    assert.deepEqual(bad.slice(0, 10), []);
    assert.ok(named > 200, 'item pages name their photo: ' + named);
    // the Food Matrix's dish photos (all drawn as "shortrib") say nothing: the dish name is beside each one
    const fm = pages.find((p) => p.slug === 'food-matrix');
    assert.deepEqual(all(T.themePage(fm, T.THEMES[brand]).main, (n) => isPhoto(n) && !!n.alt), []);
  });

  test(`${demo} demo: the Food Matrix and Allergen Guide are tables`, async () => {
    const pages = await pagesOf(demo);
    for (const [slug, name] of [['food-matrix', 'Matrix table'], ['allergen-guide', 'Allergen grid']]) {
      const main = T.themePage(pages.find((p) => p.slug === slug), T.THEMES[brand]).main;
      const table = all(main, (n) => n.n === name)[0];
      assert.equal(table.tbl, 'table', slug);
      assert.ok(table.tblv, slug + ' has a name');
      const rows = table.c.filter((c) => c.tbl === 'row');
      const head = rows.find((r) => r.c.every((c) => c.tbl === 'ch'));
      assert.ok(head, slug + ': a header row of column headers');
      const dishes = rows.filter((r) => /^Row · /.test(r.n || ''));
      assert.ok(dishes.length >= 10, slug + ': its dishes are rows');
      for (const r of dishes) {
        assert.equal(r.c.length, head.c.length, `${slug} ${r.n}: one cell per column`);
        assert.equal(r.c[0].tbl, 'rh', `${slug} ${r.n}: the dish names its row`);
        assert.ok(r.c.slice(1).every((c) => c.tbl === 'cell'), `${slug} ${r.n}: cells`);
        if (slug === 'allergen-guide') assert.ok(r.c.slice(1).every((c) => c.tblv === 'Contains' || c.tblv === 'No'), `${r.n}: each allergen mark has words`);
      }
      // nothing else in the table is a link outside a row (a manager's "+ Add" is drawn as a row)
      for (const c of table.c) if (c.to) assert.equal(c.tbl, 'row', `${slug} ${c.n}`);
    }
  });
}

test('the sidebar logo is read by its name in both brands', async () => {
  const sidebar = JSON.parse(fs.readFileSync(path.join(root, 'src/content/sidebar.json'), 'utf8')).find((n) => n.n === 'Sidebar');
  for (const [b, name] of [['baldwin', 'The Baldwin'], ['mise', 'Mise Academy']]) {
    const logo = all(T.themeSidebar(sidebar, T.THEMES[b]), (n) => n.n === 'Logo')[0];
    assert.deepEqual(all(logo, isPhoto).map((p) => p.alt), [name], b);
  }
});

test('the focus ring passes 3:1 on light and dark surfaces in both brands', () => {
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const ch = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const th of Object.values(T.THEMES)) {
    const ring = [T.color(th, 'focus'), T.color(th, 'focusBand')];
    for (const surface of ['page', 'card', 'inverse', 'inverseRaised']) {
      const best = Math.max(...ring.map((c) => ratio(c, T.color(th, surface))));
      assert.ok(best >= 3, `${th.brand} ring on ${surface}: ${best.toFixed(2)}:1`);
    }
  }
});
