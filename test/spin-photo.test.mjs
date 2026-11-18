// Bottle spin · Photo by Photo, and spirits in the Bottle Scanner (Nov 18, Figma 09 · Proposals → 34).
// Runs the real server on a temp database with SCANNER_STUB=1: no model download. For Photo by Photo the stub cuts out what
// inside the box differs from the box's edge colour, so every fixture photo gets its own outline and the lining-up is
// checked on real shapes. Limits, saving, privacy and the pages all run for real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { turnOnTwoStep, giveAccount } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-spinp-'));
const MEDIA = path.join(dir, 'media');
const PORT = 5010 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const W = 900, H = 1200;
// The spirit guide the browser draws on a 900 × 1200 frame (src/admin/scanner.tsx guideFor, kind 'spirit').
const GW = Math.min(0.9, (0.76 * H * 0.44) / W);
const BOX = [(1 - GW) / 2, 0.12, (1 + GW) / 2, 0.88].map((v) => v.toFixed(4)).join(',');
const BEIGE = [231, 222, 207];
let server, owner = '';
let ipN = 0;
const freshIp = () => `10.40.${Math.floor(++ipN / 250)}.${ipN % 250}`;

/** A fixture photo: a bottle turned to photo `i` (the label slides round), and moved, the way a hand-turned bottle is:
 *  a little left or right, nearer or further (bigger or smaller), and set down a little higher or lower. `wide` makes
 *  a stouter bottle, so a frame cut with someone else's outline would show. */
async function fixture(i, { dx = 0, scale = 1, dy = 0, wide = 1, metadata = false } = {}) {
  const bh = Math.round(640 * scale), bw = Math.round(250 * scale * wide), nw = Math.round(80 * scale), nh = Math.round(170 * scale);
  const cx = W / 2 + dx, base = 1000 + dy, top = base - bh, x0 = cx - bw / 2;
  const lw = Math.round(bw * 0.4), lx = x0 + bw * 0.08 + ((i * bw * 0.44) / 11); // the label moves across as it turns
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#d6cfc4"/>
    <rect x="${cx - nw / 2}" y="${top}" width="${nw}" height="${nh + 20}" rx="6" fill="#5a3216"/>
    <rect x="${x0}" y="${top + nh}" width="${bw}" height="${bh - nh}" rx="${Math.round(30 * scale)}" fill="#6b3c1a"/>
    <rect x="${lx}" y="${top + nh + (bh - nh) * 0.45}" width="${lw}" height="${(bh - nh) * 0.3}" fill="#c9a46a"/>
  </svg>`;
  let img = sharp(Buffer.from(svg)).jpeg({ quality: 90 });
  if (metadata) img = img.withExif({ IFD0: { Copyright: 'SECRET-OWNER', Artist: 'SECRET-OWNER' } });
  return img.toBuffer();
}
const MOVES = Array.from({ length: 12 }, (_, i) => ({ dx: [0, 18, -22, 30, -10, 25, -30, 12, -18, 22, 5, -8][i], scale: [1, 1.04, 0.96, 1.07, 0.94, 1, 1.05, 0.97, 1.02, 0.95, 1.06, 0.99][i], dy: [0, -12, 10, -20, 15, 5, -8, 18, -15, 8, -5, 12][i], wide: i === 4 ? 1.18 : 1 }));

before(async () => {
  giveAccount(dir);
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@example.test', SUPERADMIN_EMAIL: 'owner@example.test', SCANNER_STUB: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const r = await fetch(BASE + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ name: 'Owner', email: 'owner@example.test', password: 'long-enough-1' }) });
  assert.equal(r.status, 200);
  owner = r.headers.get('set-cookie').split(';')[0];
  await turnOnTwoStep(async (p, { method, body }) => { const x = await fetch(BASE + p, { method, headers: { cookie: owner, 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify(body || {}) }); return { status: x.status, data: await x.json() }; });
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

async function demo(role = 'manager', which = 'mise') {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': freshIp() }, body: JSON.stringify({ role, demo: which }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
}
const json = (cookie, p, body, { ip = '10.0.0.1', method = 'POST' } = {}) => fetch(BASE + p, { method, headers: { cookie, 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': ip }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (cookie, p) => fetch(BASE + p, { headers: cookie ? { cookie } : {} });
const shot = (cookie, i, buf, token = '', ip = '10.0.0.1') => fetch(BASE + `/api/scan/photos?i=${i}&box=${BOX}${token ? '&token=' + token : ''}`, { method: 'POST', headers: { cookie, 'content-type': 'image/jpeg', 'x-bt': '1', 'x-forwarded-for': ip }, body: buf });
/** All 12 photos, in order. Returns the set's token. */
async function twelve(cookie, ip) {
  let token = '';
  for (let i = 0; i < 12; i++) {
    const r = await shot(cookie, i, await fixture(i, MOVES[i]), token, ip);
    assert.equal(r.status, 200, `photo ${i + 1}`);
    const b = await r.json();
    if (token) assert.equal(b.token, token, 'the same set'); else token = b.token;
    assert.equal(b.i, i); assert.equal(b.taken, i + 1);
    assert.match(b.thumb, /^data:image\/jpeg;base64,/);
  }
  return token;
}
/** Where the bottle is in a lined-up frame: everything that isn't the beige. */
async function bottleIn(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1, lx0 = info.width, lx1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    if (Math.abs(data[i] - BEIGE[0]) + Math.abs(data[i + 1] - BEIGE[1]) + Math.abs(data[i + 2] - BEIGE[2]) > 45) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (y > info.height * 0.6) { if (x < lx0) lx0 = x; if (x > lx1) lx1 = x; }
    }
  }
  // the body's middle: halfway across the lower part (the label is near the beige, so a mean would lean)
  return { w: info.width, h: info.height, top: y0, bottom: y1, height: y1 - y0, width: x1 - x0, cx: (lx0 + lx1) / 2 };
}

test('Photo by Photo: 12 photos, each cut out on its own, lined up (same height, centred, one base line), 12 frames saved', async () => {
  const token = await twelve(owner, '10.11.0.1');
  const a = await json(owner, '/api/scan/photos/align', { token });
  assert.equal(a.status, 200);
  const { frames } = await a.json();
  assert.equal(frames.length, 12);
  const shapes = [];
  for (const f of frames) {
    const r = await get(owner, f);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    shapes.push(await bottleIn(Buffer.from(await r.arrayBuffer())));
  }
  // one canvas size for all 12
  assert.ok(shapes.every((s) => s.w === shapes[0].w && s.h === 900), 'every frame is the same size, 900 tall');
  // lined up: the bottle is the same height, sits on one base line and is centred, however the photos moved
  const spread = (k) => Math.max(...shapes.map((s) => s[k])) - Math.min(...shapes.map((s) => s[k]));
  assert.ok(spread('height') <= 4, `same height (spread ${spread('height')})`);
  assert.ok(spread('bottom') <= 4, `one base line (spread ${spread('bottom')})`);
  assert.ok(spread('cx') <= 4, `centred (spread ${spread('cx').toFixed(1)})`);
  assert.ok(Math.abs(shapes[0].cx - shapes[0].w / 2) <= 4, 'on the middle of the frame');
  // each photo had its own outline: the stout bottle (photo 5) comes out wider than the rest
  const others = shapes.filter((_, i) => i !== 4).map((s) => s.width);
  assert.ok(shapes[4].width > Math.max(...others) * 1.08, `photo 5 keeps its own, wider outline (${shapes[4].width} vs ${Math.max(...others)})`);
  // someone else can't see or use the set
  const mgr = await demo();
  assert.equal((await get(mgr, frames[0])).status, 404);
  assert.equal((await json(mgr, '/api/scan/photos/keep', { token, name: 'x' })).status, 410);
  // keep it: 12 files, one media row
  const k = await json(owner, '/api/scan/photos/keep', { token, name: 'Rittenhouse' });
  assert.equal(k.status, 200);
  const kept = (await k.json()).frames;
  assert.equal(kept.length, 12);
  for (const [i, u] of kept.entries()) {
    assert.match(u, new RegExp(`^/media/[a-z0-9]+-spin-rittenhouse-${String(i).padStart(2, '0')}\\.jpg$`));
    const file = fs.readFileSync(path.join(MEDIA, u.slice(7)));
    assert.equal((await sharp(file).metadata()).exif, undefined, 'no metadata');
  }
  const media = (await (await json(owner, '/api/media', undefined, { method: 'GET' })).json()).media;
  assert.equal(media.filter((m) => m.title === 'Bottle spin · Rittenhouse').length, 1, 'one spin, one row');
  // the set is gone once kept
  assert.equal((await json(owner, '/api/scan/photos/align', { token })).status, 410);
});

test('Photo by Photo: retake one photo; only that frame changes and the spin stays lined up', async () => {
  const token = await twelve(owner, '10.12.0.1');
  const before = (await (await json(owner, '/api/scan/photos/align', { token })).json()).frames;
  const bytes = async (u) => Buffer.from(await (await get(owner, u)).arrayBuffer());
  const was = await Promise.all(before.map(bytes));
  // photo 7 again: moved a long way and much nearer the phone
  const r = await shot(owner, 6, await fixture(6, { dx: -60, scale: 1.12, dy: -30 }), token, '10.12.0.1');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).taken, 12, 'still 12');
  const after = (await (await json(owner, '/api/scan/photos/align', { token })).json()).frames;
  assert.notDeepEqual(after, before, 'new addresses after a change');
  const now = await Promise.all(after.map(bytes));
  assert.ok(!now[6].equals(was[6]), 'photo 7 is new');
  const shapes = await Promise.all(now.map(bottleIn));
  const spread = (k) => Math.max(...shapes.map((s) => s[k])) - Math.min(...shapes.map((s) => s[k]));
  assert.ok(spread('height') <= 4 && spread('bottom') <= 4 && spread('cx') <= 4, 'still lined up');
  assert.deepEqual((await (await json(owner, '/api/scan/photos/align', { token })).json()).odd, [], 'nothing looks off');
  // a cut-out that isn't bottle-shaped (only the label came out, say) is flagged for a retake
  const squat = await shot(owner, 2, await fixture(2, { scale: 0.55, wide: 2.6, dy: -150 }), token, '10.12.0.1');
  assert.equal(squat.status, 200);
  assert.deepEqual((await (await json(owner, '/api/scan/photos/align', { token })).json()).odd, [2], 'photo 3 flagged');
  // a photo with no bottle in the box is refused plainly, and the set keeps the old one
  const blank = await sharp({ create: { width: W, height: H, channels: 3, background: '#d6cfc4' } }).jpeg().toBuffer();
  const bad = await shot(owner, 3, blank, token, '10.12.0.1');
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).error, /couldn’t find a bottle/);
  assert.equal((await json(owner, '/api/scan/photos/align', { token })).status, 200);
  // not all 12: align and keep say so
  const one = await (await shot(owner, 0, await fixture(0), '', '10.12.0.1')).json();
  const half = await json(owner, '/api/scan/photos/align', { token: one.token });
  assert.equal(half.status, 400);
  assert.match((await half.json()).error, /all 12 photos/);
  assert.equal((await json(owner, '/api/scan/photos/keep', { token: one.token, name: 'x' })).status, 400);
  // a bad photo number or box
  assert.equal((await fetch(BASE + `/api/scan/photos?i=12&box=${BOX}`, { method: 'POST', headers: { cookie: owner, 'content-type': 'image/jpeg', 'x-bt': '1' }, body: await fixture(0) })).status, 400);
  assert.equal((await fetch(BASE + '/api/scan/photos?i=0&box=1,2', { method: 'POST', headers: { cookie: owner, 'content-type': 'image/jpeg', 'x-bt': '1' }, body: await fixture(0) })).status, 400);
});

test('Photo by Photo: staff never get the scanner', async () => {
  const staff = await demo('employee');
  assert.equal((await shot(staff, 0, await fixture(0))).status, 403);
  assert.equal((await json(staff, '/api/scan/photos/align', { token: 'x' })).status, 403);
  assert.equal((await json(staff, '/api/scan/photos/keep', { token: 'x' })).status, 403);
  assert.equal((await get(staff, '/api/scan/photos/frame?token=x&i=0')).status, 403);
  assert.equal((await json(staff, '/api/scan/ready', {})).status, 403);
  assert.equal((await shot('', 0, await fixture(0))).status, 401);
});

test('demo: a full spin fits the caps (12 cuts, one save, files in the demo folder, no metadata)', async () => {
  const me = await demo('manager', 'mise');
  const before = (await (await json(me, '/api/scan/ready', {})).json()).demo;
  assert.deepEqual([before.cutsLeft, before.savesLeft], [60, 5]);
  const ip = '10.13.0.1';
  let token = '';
  for (let i = 0; i < 12; i++) {
    const r = await shot(me, i, await fixture(i, { ...MOVES[i], metadata: true }), token, ip);
    assert.equal(r.status, 200, `photo ${i + 1}`);
    token = (await r.json()).token;
  }
  const k = await json(me, '/api/scan/photos/keep', { token, name: 'Rittenhouse' }, { ip });
  assert.equal(k.status, 200);
  const { frames } = await k.json();
  assert.equal(frames.length, 12);
  for (const u of frames) {
    assert.match(u, /^\/media\/demo\/demo-mise-[a-f0-9]{10}\/[a-f0-9]{12}-[a-z0-9]+-spin-rittenhouse-\d\d\.jpg$/);
    const file = fs.readFileSync(path.join(MEDIA, u.slice(7)));
    assert.doesNotMatch(file.toString('latin1'), /SECRET-OWNER/, 're-encoded: no metadata');
    assert.equal((await get(me, u)).status, 200);
    assert.equal((await get(owner, u)).status, 404, 'only this demo sees it');
  }
  const after = (await (await json(me, '/api/scan/ready', {})).json()).demo;
  assert.deepEqual([after.cutsLeft, after.savesLeft, after.scansLeft], [48, 4, 10], '12 cuts and one save; no photo reads used');
  // it goes onto a back-bar bottle in the demo, and the bottle's page spins
  const shelf = (await (await json(me, '/api/entries?collection=shelf', undefined, { method: 'GET' })).json()).entries;
  assert.ok(shelf.length > 0, 'the demo has a back bar');
  const b = shelf[0];
  const full = await (await json(me, `/api/entries/${b.id}`, undefined, { method: 'GET' })).json();
  const put = await json(me, `/api/entries/${b.id}`, { data: { ...full.data, spin: frames } }, { method: 'PUT' });
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json()).data.spin, frames);
  const index = await (await get(me, '/api/index')).json();
  const entry = index.find((e) => e.slug === b.slug);
  const page = JSON.stringify(await (await get(me, '/api/page/' + entry.file)).json());
  assert.ok(page.includes('"spin":[') && page.includes('"spinPanel":1'), 'the bottle page spins, in the panel');
  // the demo's 36 spin photos: a full spin plus retakes, then a plain "refresh"
  for (let i = 12; i < 36; i++) assert.equal((await shot(me, i % 12, await fixture(i % 12), '', ip)).status, 200, `spin photo ${i + 1}`);
  const over = await shot(me, 0, await fixture(0), '', ip);
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /all the spin photos for this demo/);
});

test('rate limits: 240 spin photos an hour per person, and the demo cut cap per address', async () => {
  // fill the owner's hour (the limiter's own table), then one more is refused
  const me = await (await json(owner, '/api/me', undefined, { method: 'GET' })).json();
  const db = new DatabaseSync(path.join(dir, 'baldwin.db'));
  const ins = db.prepare('INSERT INTO limits(name, key, at) VALUES (?,?,?)');
  for (let i = 0; i < 240; i++) ins.run('spin-photo-user', String(me.user.id), Date.now() - 1000);
  const r = await shot(owner, 0, await fixture(0));
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /a lot of spin photos/);
  // an address that has used its 150 demo cuts this hour can't start more in any demo
  const ip = '10.14.0.1';
  for (let i = 0; i < 150; i++) ins.run('demo-cut-ip', ip, Date.now() - 1000);
  const r2 = await shot(await demo(), 0, await fixture(0), '', ip);
  assert.equal(r2.status, 429);
  assert.match((await r2.json()).error, /Too many photos from here/);
  assert.equal((await shot(await demo(), 0, await fixture(0), '', '10.14.0.2')).status, 200, 'another address is fine');
  db.prepare("DELETE FROM limits WHERE name = 'spin-photo-user'").run(); // the owner's hour back, for the tests after this
  db.close();
});

test('spirits: a back-bar bottle has a photo field; its page, its Back Bar row and search show it, else the drawn bottle', async () => {
  const schema = await (await get(owner, '/api/collections')).json().catch(() => null);
  const cols = schema?.collections || schema;
  if (cols?.shelf) {
    const f = cols.shelf.fields.find((x) => x.key === 'bottle_img');
    assert.ok(f && f.type === 'photo' && f.scan === 'spirit', 'Scan Bottle in the shelf form');
    assert.equal(cols.shelf.fields.find((x) => x.key === 'spin').scan, 'spirit');
    assert.equal(cols.wine.fields.find((x) => x.key === 'bottle_img').scan, 'wine');
  }
  // both tabs list: the wines and the back bar
  const wines = (await (await json(owner, '/api/entries?collection=wine', undefined, { method: 'GET' })).json()).entries;
  const shelf = (await (await json(owner, '/api/entries?collection=shelf', undefined, { method: 'GET' })).json()).entries;
  assert.ok(wines.length > 0 && shelf.length > 0, 'both lists');
  const b = shelf[0];
  const index = async () => (await get(owner, '/api/index')).json();
  const pageOf = async (slug) => { const e = (await index()).find((x) => x.slug === slug); return JSON.stringify(await (await get(owner, '/api/page/' + e.file)).json()); };
  // no photo yet: the drawn bottle everywhere
  assert.ok((await pageOf(b.slug)).includes('/img/spirit-bottle-filler.jpg'));
  assert.equal((await index()).find((x) => x.slug === b.slug).thumb, '/img/spirit-bottle-filler.jpg');
  // a scanned photo (One Photo)
  const s = await (await fetch(BASE + '/api/scan', { method: 'POST', headers: { cookie: owner, 'content-type': 'image/jpeg', 'x-bt': '1' }, body: await fixture(0) })).json();
  assert.equal((await json(owner, '/api/scan/cut', { token: s.token, box: BOX.split(',').map(Number) })).status, 200);
  const m = await (await json(owner, '/api/scan/keep', { token: s.token, name: b.data.name })).json();
  const full = await (await json(owner, `/api/entries/${b.id}`, undefined, { method: 'GET' })).json();
  const put = await json(owner, `/api/entries/${b.id}`, { data: { ...full.data, bottle_img: m.url } }, { method: 'PUT' });
  assert.equal(put.status, 200);
  assert.equal((await put.json()).data.bottle_img, m.url, 'saved on the bottle');
  const withPhoto = await pageOf(b.slug);
  assert.ok(withPhoto.includes(`"img":"${m.url}"`) && withPhoto.includes(`IMG/Bottle · ${b.data.name}`), 'the bottle page shows our photo');
  assert.ok(!withPhoto.includes('"spinPanel"'), 'a photo, not a spin');
  assert.ok((await pageOf('the-bar/back-bar')).includes(`"img":"${m.url}"`), 'its Back Bar row shows it');
  assert.equal((await index()).find((x) => x.slug === b.slug).thumb, m.url, 'search shows it');
  // Edit Mode: the bottle gets Scan Bottle and Make a Spin
  assert.ok(withPhoto.includes('"scan":"spirit"'), 'Edit Mode tools on the bottle');
  // a spin wins over the photo
  const token = await twelve(owner, '10.15.0.1');
  const spin = (await (await json(owner, '/api/scan/photos/keep', { token, name: b.data.name })).json()).frames;
  await json(owner, `/api/entries/${b.id}`, { data: { ...full.data, bottle_img: m.url, spin } }, { method: 'PUT' });
  const spun = await pageOf(b.slug);
  assert.ok(spun.includes('"spinPanel":1') && spun.includes(`"img":"${spin[0]}"`), 'the page spins');
  assert.ok((await pageOf('the-bar/back-bar')).includes(`"img":"${spin[0]}"`), 'the row shows the spin’s front');
  assert.equal((await index()).find((x) => x.slug === b.slug).thumb, spin[0]);
  // a wine's spin fills its bottle panel too
  const w = wines[0];
  const wf = await (await json(owner, `/api/entries/${w.id}`, undefined, { method: 'GET' })).json();
  await json(owner, `/api/entries/${w.id}`, { data: { ...wf.data, spin } }, { method: 'PUT' });
  assert.ok((await pageOf(w.slug)).includes('"spinPanel":1'));
  // nothing is deleted: taking the photo off brings the drawing back, and the files stay
  await json(owner, `/api/entries/${b.id}`, { data: { ...full.data, bottle_img: '', spin: [] } }, { method: 'PUT' });
  assert.ok((await pageOf(b.slug)).includes('/img/spirit-bottle-filler.jpg'));
  assert.ok(fs.existsSync(path.join(MEDIA, m.url.slice(7))));
});
