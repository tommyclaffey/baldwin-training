// The bottle scanner in the demos (Nov 12, Tommy: "scanner sounds good"). Runs the real server on a temp database with
// SCANNER_STUB=1 (no model download; the "cut" is the box itself). Limits, saving, privacy and cleanup all run for real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-scan-'));
const MEDIA = path.join(dir, 'media');
const PORT = 4950 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const BOX = [0.3, 0.1, 0.7, 0.9];
let server, owner = '', photo;
let ipN = 0;
const freshIp = () => `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`;

// A leftover folder from a demo that no longer exists (a crash between the two cleanup steps): startup removes it.
const STRAY = path.join(MEDIA, 'demo', 'demo-0123456789');

before(async () => {
  fs.mkdirSync(STRAY, { recursive: true });
  fs.writeFileSync(path.join(STRAY, 'old.jpg'), 'x');
  // A photo with a bottle-ish shape and camera metadata, so we can check the saved file has none.
  photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#d8d2c8' } })
    .composite([{ input: await sharp({ create: { width: 160, height: 640, channels: 3, background: '#2b3a22' } }).png().toBuffer(), left: 220, top: 140 }])
    .jpeg().withExif({ IFD0: { Copyright: 'SECRET-OWNER', Artist: 'SECRET-OWNER' } }).toBuffer();
  assert.match(photo.toString('latin1'), /SECRET-OWNER/, 'the test photo carries metadata');
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@example.test', SUPERADMIN_EMAIL: 'owner@example.test', SCANNER_STUB: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const r = await fetch(BASE + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ name: 'Owner', email: 'owner@example.test', password: 'long-enough-1' }) });
  assert.equal(r.status, 200);
  owner = r.headers.get('set-cookie').split(';')[0];
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

async function demo(role = 'manager', which = 'mise') {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': freshIp() }, body: JSON.stringify({ role, demo: which }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
}
const json = (cookie, p, body, ip = '10.0.0.1', method = 'POST') => fetch(BASE + p, { method, headers: { cookie, 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': ip }, body: body === undefined ? undefined : JSON.stringify(body) });
const scan = (cookie, ip = '10.0.0.1', buf = photo) => fetch(BASE + '/api/scan', { method: 'POST', headers: { cookie, 'content-type': 'image/jpeg', 'x-bt': '1', 'x-forwarded-for': ip }, body: buf });
/** Read a photo, cut it, keep it. Returns the saved media item. */
async function scanAndKeep(cookie, ip, name = 'Test Bottle') {
  const s = await scan(cookie, ip);
  assert.equal(s.status, 200);
  const { token } = await s.json();
  const c = await json(cookie, '/api/scan/cut', { token, box: BOX }, ip);
  assert.equal(c.status, 200);
  assert.match((await c.json()).preview, /^data:image\/jpeg;base64,/);
  const k = await json(cookie, '/api/scan/keep', { token, name }, ip);
  return { status: k.status, body: await k.json() };
}
const get = (cookie, p) => fetch(BASE + p, { headers: cookie ? { cookie } : {} });

test('startup removes a demo folder whose demo is gone', () => {
  assert.equal(fs.existsSync(STRAY), false);
});

test('demo: a manager can scan, cut and save; the photo is the demo’s own and has no metadata', async () => {
  const me = await demo('manager', 'mise');
  const ready = await (await json(me, '/api/scan/ready', {})).json();
  assert.deepEqual(ready.demo, { scans: 10, saves: 5, scansLeft: 10, savesLeft: 5 });
  const { status, body: m } = await scanAndKeep(me, '10.1.0.1', 'Elk Cove Pinot Noir');
  assert.equal(status, 200);
  assert.match(m.url, /^\/media\/demo\/demo-mise-[a-f0-9]{10}\/[a-f0-9]{12}-[a-z0-9]+-bottle-elk-cove-pinot-noir\.jpg$/);
  const file = path.join(MEDIA, m.url.slice('/media/'.length));
  assert.ok(fs.existsSync(file), 'saved under the demo’s own folder');
  const saved = fs.readFileSync(file);
  assert.doesNotMatch(saved.toString('latin1'), /SECRET-OWNER/, 're-encoded: no metadata');
  assert.equal((await sharp(saved).metadata()).exif, undefined);
  // the demo's own people see it; nobody else does
  assert.equal((await get(me, m.url)).status, 200);
  assert.equal((await get('', m.url)).status, 404, 'not public');
  assert.equal((await get(owner, m.url)).status, 404, 'not a real company');
  assert.equal((await get(await demo('manager', 'mise'), m.url)).status, 404, 'not another demo');
  assert.equal((await get(await demo('manager', 'baldwin'), m.url)).status, 404, 'not the other demo');
  // it can go on a wine page in the demo
  const wines = await (await json(me, '/api/entries?collection=wine', undefined, '10.1.0.1', 'GET')).json();
  const w = wines.entries[0];
  const full = await (await json(me, `/api/entries/${w.id}`, undefined, '10.1.0.1', 'GET')).json();
  const put = await json(me, `/api/entries/${w.id}`, { data: { ...full.data, bottle_img: m.url, source: 'Scanned Nov 12, 2026' } }, '10.1.0.1', 'PUT');
  assert.equal(put.status, 200);
  assert.equal((await put.json()).data.bottle_img, m.url);
  // it's in this demo's Videos and Photos, not another's
  const mine = (await (await json(me, '/api/media', undefined, '10.1.0.1', 'GET')).json()).media;
  assert.ok(mine.some((x) => x.url === m.url));
  const other = (await (await json(await demo('manager', 'mise'), '/api/media', undefined, '10.1.0.1', 'GET')).json()).media;
  assert.ok(!other.some((x) => x.url === m.url));
  const left = await (await json(me, '/api/scan/ready', {})).json();
  assert.deepEqual([left.demo.scansLeft, left.demo.savesLeft], [9, 4]);
});

test('demo: someone else’s scan token doesn’t work', async () => {
  const a = await demo(), b = await demo();
  const { token } = await (await scan(a, '10.2.0.1')).json();
  assert.equal((await json(b, '/api/scan/cut', { token, box: BOX }, '10.2.0.2')).status, 410);
  assert.equal((await json(a, '/api/scan/cut', { token, box: BOX }, '10.2.0.1')).status, 200);
  assert.equal((await json(b, '/api/scan/keep', { token }, '10.2.0.2')).status, 410);
  assert.equal((await json(owner, '/api/scan/keep', { token }, '10.2.0.3')).status, 410);
});

test('demo: 5 saved photos and 10 photos read per demo; then a plain "refresh for a fresh demo"', async () => {
  const me = await demo('manager', 'baldwin');
  for (let i = 0; i < 5; i++) assert.equal((await scanAndKeep(me, '10.3.0.1', 'Bottle ' + i)).status, 200, 'save ' + (i + 1));
  const sixth = await scanAndKeep(me, '10.3.0.1');
  assert.equal(sixth.status, 429);
  assert.match(sixth.body.error, /saved its 5 photos/);
  for (let i = 6; i < 10; i++) assert.equal((await scan(me, '10.3.0.1')).status, 200, 'photo ' + (i + 1));
  const eleventh = await scan(me, '10.3.0.1');
  assert.equal(eleventh.status, 429);
  assert.match((await eleventh.json()).error, /read its 10 photos/);
});

test('demo: photos over 8 MB are refused; other uploads stay off', async () => {
  const me = await demo();
  const big = Buffer.alloc(8.5e6, 1);
  assert.equal((await scan(me, '10.4.0.1', big)).status, 413);
  const up = await fetch(BASE + '/api/media/upload', { method: 'POST', headers: { cookie: me, 'content-type': 'image/jpeg', 'x-bt': '1' }, body: photo });
  assert.equal(up.status, 403);
  assert.equal((await json(me, '/api/chat/photo', {})).status, 403);
  // the employee view has no scanner at all (managers only)
  assert.equal((await scan(await demo('employee'), '10.4.0.2')).status, 403);
});

test('demo: 30 photos an hour per address, across demos', async () => {
  const ip = '10.5.0.1';
  for (let d = 0; d < 3; d++) {
    const me = await demo();
    for (let i = 0; i < 10; i++) assert.equal((await scan(me, ip)).status, 200, `demo ${d + 1}, photo ${i + 1}`);
  }
  const r = await scan(await demo(), ip);
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /Too many scans from here/);
  assert.equal((await scan(await demo(), '10.5.0.2')).status, 200, 'another address is fine');
});

test('demo: a refresh (restart) deletes the demo’s saved photos from disk, rows and all', async () => {
  const me = await demo('manager', 'mise');
  const { body: m } = await scanAndKeep(me, '10.6.0.1');
  const spinTok = (await (await scan(me, '10.6.0.1')).json()).token;
  assert.equal((await json(me, '/api/scan/cut', { token: spinTok, box: BOX }, '10.6.0.1')).status, 200);
  const frame = await fetch(BASE + `/api/scan/spin?token=${spinTok}`, { method: 'POST', headers: { cookie: me, 'content-type': 'image/jpeg', 'x-bt': '1' }, body: photo });
  assert.equal(frame.status, 200);
  const spin = await (await json(me, '/api/scan/spin/keep', { token: spinTok, name: 'Spin' }, '10.6.0.1')).json();
  assert.equal(spin.frames.length, 2);
  const folder = path.dirname(path.join(MEDIA, m.url.slice(7)));
  assert.equal(fs.readdirSync(folder).length, 3, 'one photo + two spin frames, all in the demo folder');
  const r = await json(me, '/api/demo/restart', {});
  assert.equal((await r.json()).restarted, true);
  assert.equal(fs.existsSync(folder), false, 'the folder is gone');
  const fresh = r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
  assert.equal((await get(fresh, m.url)).status, 404);
  const media = (await (await json(fresh, '/api/media', undefined, '10.6.0.1', 'GET')).json()).media;
  assert.ok(!media.some((x) => /^\/media\/demo\//.test(x.url || '')), 'the new copy starts with none');
});

test('real companies: unchanged (no caps, files in media/, public by link)', async () => {
  const ready = await (await json(owner, '/api/scan/ready', {})).json();
  assert.equal(ready.demo, undefined);
  for (let i = 0; i < 12; i++) assert.equal((await scan(owner, '10.7.0.1')).status, 200, 'photo ' + (i + 1));
  const saves = [];
  for (let i = 0; i < 6; i++) { const r = await scanAndKeep(owner, '10.7.0.1', 'House Red ' + i); assert.equal(r.status, 200); saves.push(r.body); }
  for (const m of saves) {
    assert.match(m.url, /^\/media\/[a-z0-9]+-bottle-house-red-\d\.jpg$/);
    assert.ok(fs.existsSync(path.join(MEDIA, m.url.slice(7))));
    assert.equal((await get('', m.url)).status, 200);
  }
  // a photo between 8 and 25 MB isn't refused for its size (it fails as a photo instead)
  assert.notEqual((await scan(owner, '10.7.0.1', Buffer.alloc(8.5e6, 1))).status, 413);
});
