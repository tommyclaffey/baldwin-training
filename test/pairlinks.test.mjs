// Pairings link to their pages (Nov 16, Tommy: "any time you have a pair or suggestion to something else on the app make
// sure you make it a hyperlink"). Home's pre-shift focus, the Food Matrix and the cocktail cards and table carry `pl`
// ([name, path]) on the text, and every path is a page in the book.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { giveAccount } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-pairs-'));
const PORT = 5100 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
before(async () => {
  giveAccount(dir); server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
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
