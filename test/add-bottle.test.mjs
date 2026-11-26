// Add a Bottle (Nov 25; Figma 09 · Idea Board → 47, approved Nov 25). The server side: Scan on My Phone (a QR code that
// hands the phone's photo back to the desktop), a new wine with its vintage, and who can do it. The real server on a temp
// database, in the Mise demo, with SCANNER_STUB=1 (no model download; the cut-out is the box).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { giveAccount, startServer } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-addbottle-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;
let ipN = 0;
const freshIp = () => `10.61.${Math.floor(++ipN / 250)}.${ipN % 250}`;

before(async () => {
  giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@addbottle.test', SCANNER_STUB: '1' }));
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

async function demo(role = 'manager') {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': freshIp() }, body: JSON.stringify({ role, demo: 'mise' }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
}
const call = async (cookie, p, { method = 'GET', body, ip = '10.0.0.1' } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { cookie, 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': ip }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#d6cfc4' } })
  .composite([{ input: await sharp({ create: { width: 180, height: 640, channels: 3, background: '#3a2414' } }).jpeg().toBuffer(), left: 210, top: 160 }]).jpeg().toBuffer();
/** One photo through the scanner, kept: the media address it saved. */
async function scanned(cookie, name) {
  const ip = freshIp();
  const s = await fetch(BASE + '/api/scan', { method: 'POST', headers: { cookie, 'content-type': 'image/jpeg', 'x-bt': '1', 'x-forwarded-for': ip }, body: photo });
  assert.equal(s.status, 200);
  const { token } = await s.json();
  assert.equal((await call(cookie, '/api/scan/cut', { method: 'POST', body: { token, box: [0.3, 0.15, 0.7, 0.9] }, ip })).status, 200);
  const k = await call(cookie, '/api/scan/keep', { method: 'POST', body: { token, name }, ip });
  assert.equal(k.status, 200);
  return k.data.url;
}

test('Scan on My Phone: a QR code; the phone sends its photo back; only this store, only managers', async () => {
  const desk = await demo('manager');
  const h = await call(desk, '/api/scan/handoff', { method: 'POST', body: { kind: 'wine', name: 'Muga ‘Reserva’' } });
  assert.equal(h.status, 200);
  assert.match(h.data.qr, /^<svg[\s\S]*<\/svg>\s*$/, 'an SVG QR code');
  assert.match(h.data.link, /\/admin\/bottle-scanner\/phone\/[\w-]{20,40}$/);
  assert.equal(h.data.link.split('/').pop(), h.data.token);
  const t = h.data.token;
  let r = await call(desk, `/api/scan/handoff/${t}`);
  assert.deepEqual([r.status, r.data.opened, r.data.photo, r.data.kind, r.data.name], [200, false, null, 'wine', 'Muga ‘Reserva’']);
  // the phone opens it (same person here, signed in on the phone)
  assert.equal((await call(desk, `/api/scan/handoff/${t}/open`, { method: 'POST' })).status, 200);
  assert.equal((await call(desk, `/api/scan/handoff/${t}`)).data.opened, true);
  // only a photo this store's scanner saved can go back
  assert.equal((await call(desk, `/api/scan/handoff/${t}/photo`, { method: 'POST', body: { photo: '/media/someone-elses.jpg' } })).status, 400);
  assert.equal((await call(desk, `/api/scan/handoff/${t}/photo`, { method: 'POST', body: { photo: 'https://example.com/x.jpg' } })).status, 400);
  const url = await scanned(desk, 'Muga');
  assert.equal((await call(desk, `/api/scan/handoff/${t}/photo`, { method: 'POST', body: { photo: url } })).status, 200);
  r = await call(desk, `/api/scan/handoff/${t}`);
  assert.equal(r.data.photo, url, 'the desktop gets the photo');
  // another company (another demo copy) can't see it; staff can't make or read one; a made-up token is gone
  const other = await demo('manager');
  assert.equal((await call(other, `/api/scan/handoff/${t}`)).status, 404);
  assert.equal((await call(other, `/api/scan/handoff/${t}/photo`, { method: 'POST', body: { photo: url } })).status, 404);
  const staff = await demo('employee');
  assert.equal((await call(staff, '/api/scan/handoff', { method: 'POST', body: { kind: 'wine' } })).status, 403);
  assert.equal((await call(staff, `/api/scan/handoff/${t}`)).status, 403);
  assert.equal((await call(desk, '/api/scan/handoff/' + 'x'.repeat(24))).status, 404);
  // a few at a time per person
  for (let i = 0; i < 4; i++) assert.equal((await call(desk, '/api/scan/handoff', { method: 'POST', body: { kind: 'spirit' } })).status, 200);
  assert.equal((await call(desk, '/api/scan/handoff', { method: 'POST', body: { kind: 'spirit' } })).status, 429);
});

test('Add a Bottle saves a wine with its vintage and photo, and a spirit; both get their own page; staff can’t', async () => {
  const mgr = await demo('manager');
  const img = await scanned(mgr, 'Muga');
  const w = await call(mgr, '/api/entries', { method: 'POST', body: { collection: 'wine', data: { name: 'Muga ‘Reserva’', grape: 'Tempranillo', region: 'Rioja', vintage: '2019', list: 'By the bottle', color: 'Red', country: 'Around the world', bottle: '68', pages: ['Tempranillo', 'Rioja'], bottle_img: img } } });
  assert.equal(w.status, 200);
  assert.equal(w.data.data.vintage, '2019');
  assert.equal(w.data.data.bottle_img, img);
  const index = (await call(mgr, '/api/index')).data;
  const page = index.find((e) => e.slug === w.data.slug);
  assert.ok(page, 'its own page is in the book: ' + w.data.slug);
  const drawn = JSON.stringify((await call(mgr, '/api/page/' + page.file)).data);
  assert.match(drawn, /"n":"Pill · Vintage".{0,500}?"s":"2019"/, 'the vintage, its own pill');
  assert.match(drawn, /"s":"Tempranillo"/); assert.match(drawn, /"s":"Rioja"/);
  // on the Wine page, in its column
  const wineList = index.find((e) => e.slug === 'the-bar/wine');
  assert.match(JSON.stringify((await call(mgr, '/api/page/' + wineList.file)).data), /Muga ‘Reserva’/);
  // a spirit, no photo (scan it later from its page)
  const s = await call(mgr, '/api/entries', { method: 'POST', body: { collection: 'shelf', data: { name: 'Fortaleza Blanco', spirit: 'Tequila', styles: ['Blanco'], tier: 'Premium', price: '16' } } });
  assert.equal(s.status, 200);
  assert.equal(s.data.data.bottle_img || '', '');
  assert.ok((await call(mgr, '/api/index')).data.some((e) => e.slug === s.data.slug));
  // staff never add bottles
  const staff = await demo('employee');
  assert.equal((await call(staff, '/api/entries', { method: 'POST', body: { collection: 'wine', data: { name: 'Nope' } } })).status, 403);
});

test('wines already on the list are unchanged: no vintage, the same line as before', async () => {
  const mgr = await demo('manager');
  const index = (await call(mgr, '/api/index')).data;
  const elk = index.find((e) => /^wine-list\//.test(e.slug) && /elk cove/i.test(e.title));
  assert.ok(elk, 'Elk Cove is on the demo list');
  const drawn = JSON.stringify((await call(mgr, '/api/page/' + elk.file)).data);
  assert.doesNotMatch(drawn, /Pill · Vintage/);
  assert.match(drawn, /"s":"Willamette Valley"/);
});
