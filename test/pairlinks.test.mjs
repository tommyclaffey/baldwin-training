// Pairings link to their pages (Nov 16, Tommy: "any time you have a pair or suggestion to something else on the app make
// sure you make it a hyperlink"). Home's pre-shift focus, the Food Matrix and the cocktail cards and table carry `pl`
// ([name, path]) on the text, and every path is a page in the book.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { giveAccount, startServer } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-pairs-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;
before(async () => {
  giveAccount(dir); ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir }));
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };
async function open(demo) {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ role: 'employee', demo }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
  const get = async (p) => (await fetch(BASE + p, { headers: { cookie, 'x-bt': '1' } })).json();
  const index = await get('/api/index');
  const page = async (slug) => get('/api/page/' + index.find((e) => e.slug === slug).file);
  return { index, page };
}

// The demos' Food Books pair dishes with wines that aren't on their wine lists, so Home and the Food Matrix may have
// nothing to link there; the live Baldwin book does (Micheletti Bolgheri → its wine page). Every link made must be real.
for (const demo of ['baldwin', 'mise']) test(`${demo} demo: pairings are links to pages in the book`, async () => {
  const { index, page } = await open(demo);
  const slugs = new Set(index.map((e) => '/' + e.slug));
  const links = (p) => all(p.main, (n) => n.pl).flatMap((n) => n.pl.map(([name, to]) => ({ name, to, s: n.s })));
  const home = links(await page(''));
  const matrix = links(await page('food-matrix'));
  const bar = links(await page('the-bar/cocktails'));
  assert.ok(bar.length, 'the cocktail cards link the dishes they pair with');
  for (const l of [...home, ...matrix, ...bar]) {
    assert.ok(l.s.includes(l.name), `${l.name} is in "${l.s}"`);
    assert.ok(slugs.has(l.to) || /^\/(wine-list|recipe|signature|classic|spirit)\//.test(l.to), `${l.name} → ${l.to} is a page`);
  }
});
