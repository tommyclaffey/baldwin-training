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

/** Another person with their own cookie jar. */
function person() {
  let jar = '';
  return async (p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
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
  const anon = await call('/api/entries', { method: 'POST', body: { collection: 'classic', data: { name: 'X' } }, auth: false });
  assert.equal(anon.status, 401);
  const noHeader = await call('/api/entries', { method: 'POST', body: { collection: 'classic', data: { name: 'X' } }, headers: { 'X-BT': '' } });
  assert.equal(noHeader.status, 403);
});

test('the CMS starts with every classic, house cocktail and dish from the design', async () => {
  const cols = (await call('/api/collections')).data;
  assert.equal(cols.counts.classic, 23);
  assert.equal(cols.counts.house, 17, 'every cocktail on our menu');
  assert.equal(cols.counts.shelf, 92, "Mionetto moved to the wine list");
  assert.equal(cols.counts.beer, 15);
  assert.equal(cols.counts.recipe, 10);
  const index = (await call('/api/index')).data;
  assert.equal(index.length, 346, 'the design, plus 15 menu cocktails, the Lemon Drop and 106 wine pages');
  const caymus = index.find((e) => e.slug === 'wine-list/sommelier-selection-red-cabernet-sauvignon-caymus-napa');
  const wp = (await call('/api/page/' + caymus.file)).data;
  const findN = (n, name) => (n.n === name ? n : (n.c || []).map((c) => findN(c, name)).find(Boolean));
  assert.equal(findN(wp.main, 'Title').s, 'CAYMUS');
  assert.equal(findN(wp.main, 'Dots · 5 of 5').c.length, 5);
  for (const slug of ['classic/old-fashioned', 'classic/pisco-sour', 'signature/fuschia-satin', 'recipe/short-rib']) assert.ok(index.some((e) => e.slug === slug), slug);
  const of = index.find((e) => e.slug === 'classic/old-fashioned');
  const page = (await call('/api/page/' + of.file)).data;
  const find = (n, name) => (n.n === name ? n : (n.c || []).map((c) => find(c, name)).find(Boolean));
  assert.equal(find(page.main, 'Video slot · History of the Old Fashioned').vid.youtubeId, 'pdcrJ5V7YKM');
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

test('a new classic gets a page, a chip on every classic page and a row in the table', async () => {
  const r = await call('/api/entries', { method: 'POST', body: { collection: 'classic', data: { name: 'Test Drink', family: 'Shaken', glass: 'Coupe', build: [{ amount: '2 oz', ingredient: 'Gin', spirit: true, link: '/spirit/gin' }], video: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' } } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.slug, 'classic/test-drink');
  const index = (await call('/api/index')).data;
  const e = index.find((x) => x.slug === 'classic/test-drink');
  assert.ok(e);
  assert.match(JSON.stringify((await call('/api/page/' + e.file)).data), /TEST DRINK/);
  const daq = index.find((x) => x.slug === 'classic/daiquiri');
  assert.match(JSON.stringify((await call('/api/page/' + daq.file)).data), /classic\/test-drink/);
  const hub = JSON.stringify((await call('/api/page/14-2')).data);
  assert.match(hub, /Classic row · Test Drink/);
  // renaming keeps the address
  const up = await call(`/api/entries/${r.data.id}`, { method: 'PUT', body: { data: { ...r.data.data, name: 'Renamed Drink' } } });
  assert.equal(up.data.slug, 'classic/test-drink');
  assert.equal((await call(`/api/entries/${r.data.id}`, { method: 'DELETE' })).status, 200);
  assert.doesNotMatch(JSON.stringify((await call('/api/page/14-2')).data), /Renamed Drink/);
});

test('a dish shows in the Food Matrix, and gets a page only when it has one', async () => {
  const r = await call('/api/entries', { method: 'POST', body: { collection: 'recipe', data: { name: 'Test Plate', course: 'Plates', allergens: ['Dairy'], fullPage: false } } });
  assert.equal(r.status, 200);
  const matrix = JSON.stringify((await call('/api/page/13-2')).data);
  assert.match(matrix, /Row · Test Plate/);
  assert.equal((await call(`/api/page/e${r.data.id}`)).status, 404);
  await call(`/api/entries/${r.data.id}`, { method: 'PUT', body: { data: { ...r.data.data, fullPage: true, steps: [{ title: 'Sear', detail: 'Hot pan' }] } } });
  assert.equal((await call(`/api/page/e${r.data.id}`)).status, 200);
  assert.match(JSON.stringify((await call('/api/page/13-2')).data), /recipe\/test-plate/);
  await call(`/api/entries/${r.data.id}`, { method: 'DELETE' });
});

test('invites: owners invite managers, links work once, managers can’t invite', async () => {
  const inv = await call('/api/team/invite', { method: 'POST', body: { email: 'editor@example.test', role: 'manager' } });
  assert.equal(inv.status, 200);
  const token = inv.data.link.split('/').pop();
  const ed = person();
  assert.equal((await ed(`/api/invite/${token}`, { method: 'POST', body: { name: 'Ed', password: 'long-enough-2' } })).status, 200);
  assert.equal((await ed('/api/team')).status, 200, 'managers see the team');
  assert.equal((await ed('/api/team/invite', { method: 'POST', body: { email: 'x@example.test' } })).status, 403, 'managers can’t invite');
  assert.equal((await person()(`/api/invite/${token}`, { method: 'POST', body: { name: 'Ed', password: 'long-enough-2' } })).status, 410);
});

test('quiz scores are checked by the server, and a manager can sign off', async () => {
  const code = (await call('/api/team')).data.company.joinCode;
  const sam = person();
  assert.equal((await sam('/api/join', { method: 'POST', body: { code, name: 'Sam Server', pin: '4321' } })).status, 200);
  const items = [0, 1, 2, 3, 4].map((i) => `short-rib#${i}`);
  const r = await sam('/api/quiz/attempt', { method: 'POST', body: { quiz: 'short-rib', items, answers: [1, 1, 3, 0, 2] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { score: 5, total: 5, passed: true });
  const wrong = await sam('/api/quiz/attempt', { method: 'POST', body: { quiz: 'short-rib', items: ['date-cake#0'], answers: [3] } });
  assert.equal(wrong.status, 400, 'questions from another quiz are refused');
  assert.equal((await call('/api/quiz/attempt', { method: 'POST', body: { quiz: 'short-rib', items, answers: [1, 1, 3, 0, 2] }, auth: false })).status, 401, 'no account, no score');
  assert.equal((await sam('/api/quiz/results')).status, 403, 'staff can’t see everyone’s scores');
  const people = (await call('/api/quiz/results')).data.people;
  const me = people.find((p) => p.name === 'Sam Server');
  assert.equal(me.quizzes['short-rib'].best, 5);
  assert.equal((await call('/api/quiz/signoff', { method: 'POST', body: { device: me.device, quiz: 'short-rib' } })).status, 200);
  const mine = (await sam('/api/quiz/mine')).data;
  assert.equal(mine.signoffs[0].quiz, 'short-rib');
  assert.equal(mine.best[0].best, 5);
});

test('wine videos: every wine page has a Learn more section, and a video plays there and on the wine list', async () => {
  const groups = (await call('/api/wine-videos')).data.groups;
  const items = groups.flatMap((g) => g.items);
  assert.equal(items.filter((i) => !i.key.startsWith('wine:')).length, 54);
  assert.ok(items.some((i) => i.key === 'wine:Tenuta Spinelli Pecorino'));
  const index = (await call('/api/index')).data;
  const find = (n, pred) => (pred(n) ? n : (n.c || []).map((c) => find(c, pred)).find(Boolean));
  const page = async (slug) => (await call('/api/page/' + index.find((e) => e.slug === slug).file)).data;
  // no video yet: the section is there, ready for one
  const syrah = await page('wine/red/syrah');
  const sec = find(syrah.main, (n) => n.n === 'Learn more');
  assert.ok(sec && JSON.stringify(sec).includes('SYRAH'));
  assert.equal(find(sec, (n) => !!n.vid), undefined);
  // the starting videos from the repo are in place
  const cab = find((await page('wine/red/cabernet')).main, (n) => n.n === 'Learn more');
  assert.equal(find(cab, (n) => !!n.vid).vid.youtubeId, '-w6gz4YVPyk');
  assert.equal(items.filter((i) => i.video).length, 6);
  // anonymous can't set one, an unknown page is refused
  assert.equal((await call('/api/wine-videos', { method: 'PUT', body: { key: 'wine/red/syrah', video: null }, auth: false })).status, 401);
  assert.equal((await call('/api/wine-videos', { method: 'PUT', body: { key: 'wine/red/nope', video: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' } } })).status, 400);
  // add one to a grape and to a wine on the list
  const v = { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', title: 'Syrah' };
  assert.equal((await call('/api/wine-videos', { method: 'PUT', body: { key: 'wine/red/syrah', video: v, note: 'Our Syrah story.' } })).status, 200);
  assert.equal((await call('/api/wine-videos', { method: 'PUT', body: { key: 'wine:Bolgheri Rosso', video: v } })).status, 200);
  const after = await page('wine/red/syrah');
  const sec2 = find(after.main, (n) => n.n === 'Learn more');
  assert.equal(find(sec2, (n) => !!n.vid).vid.youtubeId, 'dQw4w9WgXcQ');
  assert.ok(JSON.stringify(sec2).includes('Our Syrah story.'));
  const list = (await call('/api/page/25-2')).data;
  const card = find(list.main, (n) => n.n === 'Wine · Bolgheri Rosso');
  assert.equal(card.vid.youtubeId, 'dQw4w9WgXcQ');
  assert.ok(find(card, (n) => n.n === 'Play badge'));
  assert.equal(find(find(list.main, (n) => n.n === 'Wine · Tenuta Spinelli Pecorino'), (n) => n.n === 'Play badge'), undefined);
  // and remove it
  await call('/api/wine-videos', { method: 'PUT', body: { key: 'wine:Bolgheri Rosso', video: null } });
  assert.equal(find((await call('/api/page/25-2')).data.main, (n) => n.n === 'Wine · Bolgheri Rosso').vid, undefined);
});

test('the back bar and beer list fill the shelves, the tap wall and the style pages', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  const bourbon = await page('spirit/bourbon');
  assert.ok(bourbon.includes('Group · Wheated') && bourbon.includes("Bottle · Maker's Mark"));
  assert.ok(!bourbon.includes('"Tiers"'), 'the empty tier boxes are gone');
  const wheated = await page('spirit/bourbon/wheated');
  assert.ok(wheated.includes('Bottle · Penelope Wheated') && !wheated.includes('Bottle · Woodford Reserve'));
  const blanco = await page('spirit/tequila/blanco');
  assert.ok(blanco.includes('Bottle · Lalo Blanco'));
  const whiskey = await page('spirit/whiskey');
  assert.ok(whiskey.includes('Group · Canadian') && whiskey.includes('Bottle · Crown Royal'));
  const draft = await page('the-bar/beer-and-draft');
  assert.ok(draft.includes('Row · Stella Artois') && !draft.includes("Row · Bell's Two Hearted"));
  assert.ok(draft.includes('Bottle · Blue Moon'));
  const stout = await page('beer/stout');
  assert.ok(!stout.includes('On tap · Tap 4'), 'no stale tap number');
  const pils = await page('beer/pilsner');
  assert.ok(pils.includes('Draft · Stella Artois') && pils.includes('Bottle · Heineken'));
  // an edit in the admin shows up
  const bottles = (await call('/api/entries?collection=shelf')).data.entries;
  const tito = bottles.find((b) => b.data.name === "Tito's");
  await call(`/api/entries/${tito.id}`, { method: 'PUT', body: { data: { ...tito.data, name: "Tito's Handmade" } } });
  assert.ok((await page('spirit/vodka/corn')).includes("Bottle · Tito's Handmade"));
  assert.ok(index.find((e) => e.slug === 'spirit/bourbon').text.includes("Maker's Mark"), 'bottles are searchable');
});

test('the wine list fills the Wine page and every wine page it belongs on', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  const wine = await page('the-bar/wine');
  assert.equal((wine.match(/"Pour · /g) || []).length, 106, 'every wine on the list');
  assert.ok(wine.includes('Pour · Caymus') && wine.includes('Pour · Veuve Clicquot'));
  const cab = await page('wine/red/cabernet');
  assert.ok(cab.includes('Pour · Caymus') && cab.includes('Pour · Silver Oak') && !cab.includes('Pour · Emeritus'));
  assert.ok(!cab.includes('Sommelier to add'), 'the placeholder is replaced');
  const rose = await page('wine/rose');
  assert.ok(rose.includes("Kettmeir 'Athesis'") && !rose.includes('Pour · Maschio'), 'Prosecco is not a rosé');
  const cava = await page('wine/sparkling/cava');
  assert.ok(!cava.includes('"Pour · '), 'nothing on the list, placeholder stays');
  const italy = await page('wine/italy');
  assert.ok(italy.includes('"Columns"'), 'a long list goes full width in two columns');
  assert.ok(index.find((e) => e.slug === 'wine/red/cabernet').text.includes('Caymus'), 'wines are searchable');
  const cols = (await call('/api/collections')).data;
  assert.equal(cols.counts.wine, 106);
});

test('working controls: Food Matrix filters, photo chips, cleaning checklist, sidebar counts', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => (await call('/api/page/' + index.find((e) => e.slug === slug).file)).data;
  const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };
  const fm = await page('food-matrix');
  const opts = all(fm.main, (n) => (n.n || '').startsWith('Option · ') && n.meta?.k);
  assert.ok(opts.some((o) => o.meta.k === 'hide:Finfish') && opts.some((o) => o.meta.k === 'hide:Nightshade'), 'every allergen can be hidden');
  assert.ok(opts.some((o) => o.meta.k === 'course:Plates'), 'courses come from the dishes');
  assert.ok(all(fm.main, (n) => n.meta?.show?.req?.includes('course:Plates')).length >= 5, 'plates rows know their course');
  assert.equal(all(fm.main, (n) => n.n === 'Button · Reset')[0].meta.act, 'reset');
  const clean = await page('cleanliness');
  const tasks = all(clean.main, (n) => n.meta?.save);
  assert.ok(tasks.length >= 20 && new Set(tasks.map((t) => t.meta.k)).size === tasks.length, 'every task has its own tick');
  const photos = await page('photo-library');
  assert.ok(all(photos.main, (n) => n.meta?.act === 'zoom').length >= 10, 'photos open large');
  assert.ok(!all(photos.main, (n) => n.n === 'Load more').length, 'no dead Load more');
  const counts = (await call('/api/counts')).data;
  assert.equal(counts['Photo Library'], all(photos.main, (n) => (n.n || '').startsWith('Photo · ')).length);
});

test('tonight’s sections: the team reads them, only a manager sets them', async () => {
  const code = (await call('/api/team')).data.company.joinCode;
  const ana = person();
  await ana('/api/join', { method: 'POST', body: { code, name: 'Ana Host', pin: '2468' } });
  assert.equal((await call('/api/sections', { auth: false })).status, 401);
  assert.equal((await ana('/api/sections', { method: 'PUT', body: { slot: 'Servers 1', name: 'Ana' } })).status, 403, 'staff can’t set sections');
  assert.equal((await call('/api/sections', { method: 'PUT', body: { slot: 'Kitchen 9', name: 'Ana' } })).status, 400);
  assert.equal((await call('/api/sections', { method: 'PUT', body: { slot: 'Servers 1', name: 'Ana' } })).status, 200);
  assert.equal((await ana('/api/sections')).data.names['Servers 1'], 'Ana');
  await call('/api/sections', { method: 'PUT', body: { slot: 'Servers 1', name: '' } });
  assert.equal((await ana('/api/sections')).data.names['Servers 1'], undefined);
});

test('the bottle scanner is for signed-in managers only', async () => {
  for (const [p, body] of [['/api/scan/ready', {}], ['/api/scan/cut', { token: 'x', box: [0, 0, 1, 1] }], ['/api/scan/keep', { token: 'x' }]]) {
    assert.equal((await call(p, { method: 'POST', body, auth: false })).status, 401, p);
  }
  assert.equal((await call('/api/scan', { method: 'POST', body: 'not a photo', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('/api/scan/cut', { method: 'POST', body: { token: 'expired', box: [0.2, 0.1, 0.8, 0.9] } })).status, 410);
});
