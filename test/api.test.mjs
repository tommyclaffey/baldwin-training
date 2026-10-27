// Runs the real server on a temp database: setup, sign-in rules, edits, recipes and cocktails, videos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-test-'));
const PORT = 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let cookie = '';

async function call(p, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(auth && cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set && auth) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@example.test' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('setup only works for the owner email, once', async () => {
  assert.equal((await call('/api/me')).data.setupNeeded, true);
  assert.equal((await call('/api/setup', { method: 'POST', body: { name: 'A', email: 'someone@example.test', password: 'long-enough-1' }, auth: false })).status, 403);
  const ok = await call('/api/setup', { method: 'POST', body: { name: 'Owner', email: 'owner@example.test', password: 'long-enough-1' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('/api/setup', { method: 'POST', body: { name: 'B', email: 'owner@example.test', password: 'long-enough-1' }, auth: false })).status, 409);
});

test('writes need a session and the X-BT header', async () => {
  const anon = await call('/api/override', { method: 'PUT', body: { pageId: '76:2', path: '/x#0', value: { s: 'hi' } }, auth: false });
  assert.equal(anon.status, 401);
  const noHeader = await call('/api/override', { method: 'PUT', body: { pageId: '76:2', path: '/x#0', value: { s: 'hi' } }, headers: { 'X-BT': '' } });
  assert.equal(noHeader.status, 403);
});

test('a video added to a slot shows on the page', async () => {
  const title = '/Hero#0';
  const page = (await call('/api/page/76-2')).data;
  const slot = '/The story#0/Video slot · History of the Old Fashioned#0';
  assert.equal((await call('/api/override', { method: 'PUT', body: { pageId: page.id, path: slot, value: { video: { kind: 'youtube', youtubeId: 'https://youtu.be/dQw4w9WgXcQ' } } } })).status, 200);
  const after = (await call('/api/page/76-2')).data;
  const find = (n, name) => (n.n === name ? n : (n.c || []).map((c) => find(c, name)).find(Boolean));
  assert.equal(find(after.main, 'Video slot · History of the Old Fashioned').vid.youtubeId, 'dQw4w9WgXcQ');
  assert.equal(find(after.main, 'Add video'), undefined, 'the "Add video" note goes away');
  assert.ok(title);
});

test('a bad YouTube link is refused', async () => {
  assert.equal((await call('/api/media/youtube', { method: 'POST', body: { url: 'https://example.com/video' } })).status, 400);
  assert.equal((await call('/api/media/youtube', { method: 'POST', body: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })).data.youtubeId, 'dQw4w9WgXcQ');
});

test('uploads take photos and videos only', async () => {
  const bad = await call('/api/media/upload', { method: 'POST', body: 'hello', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(bad.status, 415);
  const ok = await call('/api/media/upload', { method: 'POST', body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), headers: { 'Content-Type': 'video/mp4', 'X-Filename': 'clip.mp4' } });
  assert.equal(ok.status, 200);
  const file = await fetch(BASE + ok.data.url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(file.status, 206);
});

test('a new cocktail gets a page and a row on Cocktails', async () => {
  const r = await call('/api/items', { method: 'POST', body: { type: 'cocktail', data: { name: 'Test Drink', glass: 'Coupe', build: [{ amount: '2 oz', ingredient: 'Gin', spirit: true, link: '/spirits/gin' }], video: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' } } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.slug, 'signature/test-drink');
  const index = (await call('/api/index')).data;
  assert.ok(index.some((e) => e.slug === 'signature/test-drink'));
  const page = (await call(`/api/page/i${r.data.id}`)).data;
  assert.match(JSON.stringify(page), /TEST DRINK|Test Drink/);
  const cocktails = JSON.stringify((await call('/api/page/14-2')).data);
  assert.match(cocktails, /signature\/test-drink/);
});

test('a new recipe gets a page and a Food Matrix row', async () => {
  const r = await call('/api/items', { method: 'POST', body: { type: 'dish', data: { name: 'Test Plate', course: 'Plates', allergens: ['Dairy'], steps: [{ title: 'Sear', detail: 'Hot pan' }] } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.slug, 'recipe/test-plate');
  assert.match(JSON.stringify((await call('/api/page/13-2')).data), /recipe\/test-plate/);
  assert.equal((await call(`/api/items/${r.data.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/page/i${r.data.id}`)).status, 404);
});

test('invites: owner only, single use', async () => {
  const inv = await call('/api/invites', { method: 'POST', body: { email: 'editor@example.test' } });
  assert.equal(inv.status, 200);
  const token = inv.data.link.split('/').pop();
  const ownerCookie = cookie;
  cookie = '';
  assert.equal((await call(`/api/invite/${token}`, { method: 'POST', body: { name: 'Ed', password: 'long-enough-2' } })).status, 200);
  assert.equal((await call('/api/users')).status, 403, 'editors can’t manage people');
  cookie = '';
  assert.equal((await call(`/api/invite/${token}`, { method: 'POST', body: { name: 'Ed', password: 'long-enough-2' } })).status, 410);
  cookie = ownerCookie;
});
