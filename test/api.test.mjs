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
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@example.test', SUPERADMIN_EMAIL: 'owner@example.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s'); // Nov 10: was 5 s and carried on silently, so a slow start failed 11 tests at once
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
  assert.equal(cols.counts.classic, 58);
  assert.equal(cols.counts.house, 39, 'the Cocktail Descriptions sheet (Nov 5), minus Pama-Tini and three mules (Nov 9 markup)');
  assert.equal(cols.counts.shelf, 92, "Mionetto moved to the wine list");
  assert.equal(cols.counts.beer, 15);
  assert.equal(cols.counts.recipe, 37, 'the Food Book’s 37 dishes (Quiz Updates, Nov 5)');
  const index = (await call('/api/index')).data;
  // each Study Guide chapter: its whole-chapter page plus one lesson per section (Nov 1)
  // Level 1 (content/manual) and Level 2 (content/manual-l2, Nov 2) chapters
  const readDir = (d) => (fs.existsSync(path.join(root, d)) ? fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => JSON.parse(fs.readFileSync(path.join(root, d, f), 'utf8'))) : []);
  const manual = [...readDir('content/manual'), ...readDir('content/manual-l2')];
  // + the Cocktail Program (Nov 8): a course page per level (2) and one entry per lesson section (no whole-chapter pages)
  const bar = [...readDir('content/bar'), ...readDir('content/beer'), ...readDir('content/hospitality')]; // + the Beer Program (Nov 8), the Hospitality Program (Nov 11)
  assert.equal(index.length, 656 + manual.reduce((a, c) => a + 1 + c.sections.length, 0) + 8 + 3 + bar.reduce((a, c) => a + c.sections.length, 0), 'the design (incl. 133 wine countries, regions and states), plus Cocktail Specs, the 39 house drinks (Nov 9: four off the list), the Lemon Drop, 106 wine pages, the Food Book’s 37 dishes and 92 bottle pages');
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

test('every dish shows in the Food Matrix and opens its own page; every dish page has the same sections (empty ones read "to come")', async () => {
  const r = await call('/api/entries', { method: 'POST', body: { collection: 'recipe', data: { name: 'Test Plate', course: 'Mains', price: '30', allergens: ['Dairy'], pairing: 'Altocedro Malbec', cocktail: 'Paper Plane' } } });
  assert.equal(r.status, 200);
  const matrix = (await call('/api/page/13-2')).data;
  const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };
  const row = all(matrix.main, (n) => n.n === 'Row · Test Plate')[0];
  assert.equal(row.to, '/recipe/test-plate', 'the card opens the dish');
  const page = (await call(`/api/page/e${r.data.id}`)).data;
  const names = new Set(all(page.main, () => true).map((n) => n.n));
  // Nov 4, Tommy: "Need to create consistency through the app." Every section shows, in the same order.
  assert.ok(['Selling line', 'Drop band', 'Talking points', 'Pairings band', 'The Build', 'The story', 'Plating guide', 'Section · Photos'].every((n) => names.has(n)), 'every section shows');
  // Nov 8, Tommy: "If there's no video uploaded, just have it not be there." No video, no Watch It Made.
  assert.ok(!names.has('Watch it made'), 'no video, no video section');
  const txt = JSON.stringify(page.main);
  assert.ok(txt.includes('Plating guide to come') && !txt.includes('VIDEO TO COME'), 'empty sections say what is to come; an empty video frame is gone');
  assert.ok(names.has('Tag · $30'), 'the price shows');
  assert.equal(all(page.main, (n) => n.n === 'Pairing · Cocktail')[0].to, '/classic/paper-plane', 'the cocktail links to its page');
  assert.ok(JSON.stringify(all(page.main, (n) => n.n === 'Pairing · Opposite')[0]).includes('To come'), 'no opposite wine yet: the tile says to come');
  const video = { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', title: 'Test' };
  await call(`/api/entries/${r.data.id}`, { method: 'PUT', body: { data: { ...r.data.data, video } } });
  assert.ok(!JSON.stringify((await call(`/api/page/e${r.data.id}`)).data).includes('"youtubeId":"dQw4w9WgXcQ"'), 'a video alone isn’t enough: Add a video is off');
  await call(`/api/entries/${r.data.id}`, { method: 'PUT', body: { data: { ...r.data.data, video, hasVideo: true } } });
  assert.ok(JSON.stringify((await call(`/api/page/e${r.data.id}`)).data).includes('"youtubeId":"dQw4w9WgXcQ"'), 'Add a video on: the video plays');
  await call(`/api/entries/${r.data.id}`, { method: 'DELETE' });
});

test('archive, never delete: pages and media leave the book and come back on restore', async () => {
  // A dish that leaves the Food Book (the seed file) is archived, not deleted; back in the book, it's back.
  const { openDb } = await import('../server/db.mjs');
  const { seed, listEntries, listArchived } = await import('../server/cms.mjs');
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bt-seed-')), 'seed.db'));
  seed(db);
  db.prepare("INSERT INTO entries(collection,slug,data,sort,seed_key,seed_hash) VALUES ('recipe','recipe/old-dish','{\"name\":\"Old Dish\"}',99,'recipe:recipe/old-dish','x')").run();
  seed(db);
  assert.ok(!listEntries(db, 'recipe', 1).some((e) => e.slug === 'recipe/old-dish'), 'out of the book');
  assert.ok(listArchived(db, 'recipe', 1).some((e) => e.slug === 'recipe/old-dish'), 'in the Archive, not deleted');
  const r = await call('/api/entries', { method: 'POST', body: { collection: 'recipe', data: { name: 'Archive Me', course: 'Mains' } } });
  assert.equal((await call(`/api/entries/${r.data.id}`, { method: 'DELETE' })).data.archived, true);
  assert.equal((await call(`/api/page/e${r.data.id}`)).status, 404, 'archived: no page');
  assert.doesNotMatch(JSON.stringify((await call('/api/page/13-2')).data), /Archive Me/);
  assert.ok((await call('/api/entries?collection=recipe&archived=1')).data.entries.some((e) => e.id === r.data.id));
  assert.equal((await call(`/api/entries/${r.data.id}/restore`, { method: 'POST' })).status, 200);
  assert.equal((await call(`/api/page/e${r.data.id}`)).status, 200, 'restored: back in the book');
  const yt = await call('/api/media/youtube', { method: 'POST', body: { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Keep me' } });
  await call(`/api/media/${yt.data.id}`, { method: 'DELETE' });
  assert.ok(!(await call('/api/media')).data.media.some((m) => m.id === yt.data.id));
  assert.ok((await call('/api/media?archived=1')).data.media.some((m) => m.id === yt.data.id), 'media is archived too');
  assert.equal((await call(`/api/media/${yt.data.id}/restore`, { method: 'POST' })).status, 200);
  assert.ok((await call('/api/media')).data.media.some((m) => m.id === yt.data.id));
});

test('home: a dashboard with a greeting, tonight’s sections, what’s new; pairs-with dishes open their pages', async () => {
  await call('/api/sections', { method: 'PUT', body: { slot: 'Servers 3', name: 'Odette' } });
  const home = JSON.stringify((await call('/api/page/4-2')).data);
  assert.match(home, /Good (morning|afternoon|evening)/);
  assert.match(home, /Odette/, 'tonight’s sections');
  assert.match(home, /Update · 1/, 'what’s new');
  assert.match(home, /BRAISED SHORT RIB/, 'tonight’s focus is the signature dish');
  const index = (await call('/api/index')).data;
  const pros = (await call('/api/page/' + index.find((e) => e.slug === 'wine/sparkling/prosecco').file)).data;
  const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };
  const pairs = all(pros.main, (n) => (n.n || '').startsWith('Pair · '));
  assert.ok(pairs.length && pairs.every((p) => p.to && p.to.startsWith('/recipe/')), 'each dish opens its page');
  assert.ok(!pairs.some((p) => p.n.includes('Mini Lemon Ricotta')), 'archived dishes leave the card');
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

test('quizzes are written from the book, scored by the server; custom and team quizzes; a manager signs off', async () => {
  const code = (await call('/api/team')).data.company.joinCode;
  const sam = person();
  assert.equal((await sam('/api/join', { method: 'POST', body: { code, name: 'Sam Server', pin: '4321', storeId: 1 } })).status, 200);
  const cat = (await sam('/api/quiz/catalog')).data;
  assert.ok(cat.topics.some((t) => t.key === 'course:Entrees') && cat.topics.some((t) => t.key === 'specialty'), 'topics come from the menu');
  assert.ok(cat.quizzes.some((q) => q.id === 't:course:Entrees'), 'a built-in quiz per course');
  // A built-in quiz: every answer right.
  const q = (await sam('/api/quiz/start', { method: 'POST', body: { quiz: 't:course:Entrees' } })).data;
  assert.equal(q.items.length, 10);
  const right = q.items.map((ref) => q.questions[ref].answer);
  const r = await sam('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: q.items, answers: right } });
  assert.deepEqual(r.data, { score: 10, total: 10, passed: true });
  // A question from another topic is refused; no account, no score.
  const other = (await sam('/api/quiz/start', { method: 'POST', body: { quiz: 't:specialty' } })).data;
  assert.equal((await sam('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: [other.items[0]], answers: [0] } })).status, 400);
  assert.equal((await call('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: q.items, answers: right }, auth: false })).status, 401);
  // A custom mix.
  const c = (await sam('/api/quiz/start', { method: 'POST', body: { topics: ['specialty', 'wine-glass'], count: 5 } })).data;
  assert.equal(c.id, 'c:specialty+wine-glass:5');
  assert.equal(c.items.length, 5);
  assert.equal((await sam('/api/quiz/attempt', { method: 'POST', body: { quiz: c.id, items: c.items, answers: c.items.map((ref) => c.questions[ref].answer) } })).data.score, 5);
  // Staff can't save a team quiz; a manager can, and it joins the list.
  assert.equal((await sam('/api/quiz/sets', { method: 'POST', body: { name: 'X', topics: ['specialty'], count: 5 } })).status, 403);
  const set = (await call('/api/quiz/sets', { method: 'POST', body: { name: 'Bar week 2', topics: ['specialty', 'classic-on'], count: 10 } })).data;
  assert.ok((await sam('/api/quiz/catalog')).data.quizzes.some((x) => x.id === set.id && x.title === 'Bar week 2'));
  // Results and sign-off.
  assert.equal((await sam('/api/quiz/results')).status, 403, 'staff can’t see everyone’s scores');
  const me = (await call('/api/quiz/results')).data.people.find((p) => p.name === 'Sam Server');
  assert.equal(me.quizzes['t:course:Entrees'].best, 10);
  assert.equal((await call('/api/quiz/signoff', { method: 'POST', body: { device: me.device, quiz: 't:course:Entrees' } })).status, 200);
  assert.equal((await call('/api/quiz/signoff', { method: 'POST', body: { device: me.device, quiz: c.id } })).status, 400, 'custom quizzes are practice, not sign-offs');
  const mine = (await sam('/api/quiz/mine')).data;
  assert.equal(mine.signoffs[0].quiz, 't:course:Entrees');
  assert.equal((await call('/api/quiz/sets/' + set.id.slice(2), { method: 'DELETE' })).data.archived, true);
});

test('wine videos: every wine page has a Learn more section, and a video plays there and on the wine list', async () => {
  const groups = (await call('/api/wine-videos')).data.groups;
  const items = groups.flatMap((g) => g.items);
  assert.equal(items.filter((i) => !i.key.startsWith('wine:')).length, 169, '8 styles, 15 countries, 121 regions and states, 25 grapes and styles');
  assert.ok(items.some((i) => i.key === 'wine:Tenuta Spinelli Pecorino'));
  const index = (await call('/api/index')).data;
  const find = (n, pred) => (pred(n) ? n : (n.c || []).map((c) => find(c, pred)).find(Boolean));
  const page = async (slug) => (await call('/api/page/' + index.find((e) => e.slug === slug).file)).data;
  // no video yet: the section is there, ready for one
  const syrah = await page('wine/red/syrah');
  const sec = find(syrah.main, (n) => n.n === 'Learn more' || n.n === 'The story');
  assert.ok(sec && JSON.stringify(sec).includes('SYRAH'));
  assert.equal(find(sec, (n) => !!n.vid), undefined);
  // the starting videos from the repo are in place
  const cab = find((await page('wine/red/cabernet')).main, (n) => n.n === 'Learn more' || n.n === 'The story');
  assert.equal(find(cab, (n) => !!n.vid).vid.youtubeId, '-w6gz4YVPyk');
  assert.equal(items.filter((i) => i.video).length, 83, 'Wine Folly: 6 grape videos and 77 country, state and region videos');
  assert.ok(items.find((i) => i.key === 'wine/italy/tuscany')?.video?.youtubeId === 'ixXOoWN8LGg');
  // anonymous can't set one, an unknown page is refused
  assert.equal((await call('/api/wine-videos', { method: 'PUT', body: { key: 'wine/red/syrah', video: null }, auth: false })).status, 401);
  assert.equal((await call('/api/wine-videos', { method: 'PUT', body: { key: 'wine/red/nope', video: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' } } })).status, 400);
  // add one to a grape and to a wine on the list
  const v = { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', title: 'Syrah' };
  assert.equal((await call('/api/wine-videos', { method: 'PUT', body: { key: 'wine/red/syrah', video: v, note: 'Our Syrah story.' } })).status, 200);
  assert.equal((await call('/api/wine-videos', { method: 'PUT', body: { key: 'wine:Bolgheri Rosso', video: v } })).status, 200);
  const after = await page('wine/red/syrah');
  const sec2 = find(after.main, (n) => n.n === 'Learn more' || n.n === 'The story');
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

test('the Back Bar lists every bottle, and every bottle has its own page', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => (await call('/api/page/' + index.find((e) => e.slug === slug).file)).data;
  const str = async (slug) => JSON.stringify(await page(slug));
  const bar = await str('the-bar/back-bar');
  assert.ok(bar.includes('Spirit · Bourbon') && bar.includes('Spirit · Other whiskey'), 'grouped by spirit');
  assert.ok(bar.includes('"/shelf/willett-family-estate-rye"') && bar.includes('In The Furest'), 'rows link to bottle pages and name the drinks');
  assert.ok(bar.includes('"k":"bbar"') && bar.includes('"find":"bfind"'), 'chips and the find box work');
  assert.ok(!bar.includes('More spirits'));
  const willett = await str('shelf/willett-family-estate-rye');
  assert.ok(willett.includes('The rye in The Furest') && willett.includes('Drink · The Furest') && willett.includes('STRAIGHT RYE'));
  assert.ok(!willett.includes('"Say it"'), 'no empty "say it" card');
  assert.ok(!/unsplash/i.test(willett), 'no brand or stock photos of the bottle');
  const crown = await str('shelf/crown-royal');
  assert.ok(!crown.includes('Drink · '), 'no drinks card when no house cocktail uses it');
  assert.ok((await str('spirit/rye')).includes('"/shelf/willett-family-estate-rye"'), 'shelf chips on spirit pages open the bottle');
  assert.ok((await str('the-bar/spirits')).includes('"/the-bar/back-bar"'), 'Spirits links to the Back Bar');
});

test('review queue: mark each answer; red and yellow come back until they are green', async () => {
  const code = (await call('/api/team')).data.company.joinCode;
  const kit = person();
  assert.equal((await kit('/api/join', { method: 'POST', body: { code, name: 'Odette Vale', pin: '2468', storeId: 1 } })).status, 200);
  assert.equal((await kit('/api/quiz/start', { method: 'POST', body: { quiz: 'review' } })).status, 404, 'empty queue');
  const q = (await kit('/api/quiz/start', { method: 'POST', body: { quiz: 't:specialty' } })).data;
  const [a, b, c] = q.items;
  assert.equal((await kit('/api/quiz/mark', { method: 'POST', body: { ref: a, mark: 'purple' } })).status, 400);
  assert.equal((await kit('/api/quiz/mark', { method: 'POST', body: { ref: 'price:999999', mark: 'red' } })).status, 400);
  await kit('/api/quiz/mark', { method: 'POST', body: { ref: a, mark: 'yellow' } });
  await kit('/api/quiz/mark', { method: 'POST', body: { ref: b, mark: 'red' } });
  const r = (await kit('/api/quiz/mark', { method: 'POST', body: { ref: c, mark: 'green' } })).data;
  assert.deepEqual(r.counts, { red: 1, yellow: 1, green: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.next[0].ref, b, 'red first');
  const review = (await kit('/api/quiz/start', { method: 'POST', body: { quiz: 'review' } })).data;
  assert.deepEqual(new Set(review.items), new Set([a, b]));
  await kit('/api/quiz/mark', { method: 'POST', body: { ref: a, mark: 'green' } });
  const after = (await kit('/api/quiz/review')).data;
  assert.equal(after.total, 1);
  assert.deepEqual(after.counts, { red: 1, yellow: 0, green: 2 });
  assert.equal((await call('/api/quiz/review')).data.total, 0, 'each person has their own queue');
});

test('US wine by state: breadcrumbs, the regions inside, Wine Folly links and our wines', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  const oak = await page('wine/usa/oakville');
  assert.ok(oak.includes('Crumb · California') && oak.includes('Crumb · Napa Valley'), 'Wine / USA / California / Napa Valley / Oakville');
  assert.ok(oak.includes('WHERE IT SITS IN NAPA VALLEY') && oak.includes('Sibling · Rutherford'));
  assert.ok(oak.includes('"https://winefolly.com/deep-dive/napa-wine-map/"'), 'Read more on Wine Folly');
  assert.ok(oak.includes('ON OUR LIST'), 'our Oakville wines show');
  const ca = await page('wine/usa/california');
  assert.ok(ca.includes('REGIONS IN CALIFORNIA') && ca.includes('Sibling · Sierra Foothills'));
  const usa = await page('wine/usa');
  assert.ok(usa.includes('Sub · California') && usa.includes('Sub · Snake River Valley') && !usa.includes('Sub · Napa Valley'), 'the USA page lists states');
});

test('wine around the world: 12 more countries, their regions, our wines on them', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  const spain = await page('wine/spain');
  assert.ok(spain.includes('Sub · Rioja') && spain.includes('Sub · Toro') && spain.includes('ON OUR LIST'), 'Spain lists its regions and our Spanish wines');
  assert.ok(spain.includes('"https://winefolly.com/wine-regions/spain/"'));
  const uco = await page('wine/argentina/uco-valley');
  assert.ok(uco.includes('Crumb · Mendoza') && uco.includes('Bramare'), 'Uco Valley sits under Mendoza, with our Bramare');
  assert.ok(!(await page('wine/georgia')).includes('Add bottle'), 'no empty shelf placeholder');
  const wine = await page('the-bar/wine');
  assert.ok(wine.includes('Wine country · South Africa') && wine.includes('Wine country · Georgia'));
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
  assert.ok(opts.some((o) => o.meta.k === 'course:Entrees'), 'courses come from the dishes');
  assert.ok(all(fm.main, (n) => n.meta?.show?.req?.includes('course:Entrees')).length >= 8, 'entree rows know their course');
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
  await ana('/api/join', { method: 'POST', body: { code, name: 'Ana Host', pin: '2468', storeId: 1 } });
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

test('classic cocktails: 58 in six families, each with its own glass, plus the Highballs page', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  assert.equal(index.filter((e) => e.slug.startsWith('classic/')).length, 58);
  assert.ok(!index.some((e) => e.slug === 'classic/glass-cards'), 'the glass-card sheet is not a page');
  const mai = await page('classic/mai-tai');
  assert.ok(mai.includes('TROPICAL AND TIKI') && mai.includes('Glass · Double rocks') && mai.includes('Contains almond'));
  assert.ok((await page('classic/mint-julep')).includes('Glass · Julep cup'));
  assert.ok((await page('classic/pina-colada')).includes('Glass · Hurricane'));
  assert.ok((await page('classic/irish-coffee')).includes('Glass · Irish coffee'));
  const bloody = await page('classic/bloody-mary');
  assert.ok(bloody.includes('Contains fish') && bloody.includes('"youtubeId"'), 'allergy tag and a video');
  const cocktails = await page('the-bar/cocktails');
  for (const f of ['TROPICAL AND TIKI', 'BRUNCH', 'HOT AND AFTER DINNER']) assert.ok(cocktails.includes(f), f);
  assert.ok(cocktails.includes('Classic row · Brandy Alexander') && cocktails.includes('58 every server'));
  const hb = await page('bar-basics/highballs');
  assert.ok(hb.includes('Term · Cuba Libre') && hb.includes('Twin · Greyhound · Salty Dog'));
  assert.ok((await page('classic/old-fashioned')).includes('"/classic/oaxaca-old-fashioned"'), 'riffs link to the new pages');
});

test('edit in place: list pages get Add rows with the group filled in, for managers only', async () => {
  const index = (await call('/api/index')).data;
  const file = (slug) => index.find((e) => e.slug === slug).file;
  const fm = JSON.stringify((await call('/api/page/' + file('food-matrix'))).data);
  assert.ok(fm.includes('"to":"/admin/pages/recipe/new?course=Soups+%26+Salads"') && fm.includes('Add a Dish to Soups & Salads'));
  const wine = JSON.stringify((await call('/api/page/' + file('the-bar/wine'))).data);
  assert.ok(wine.includes('/admin/pages/wine/new?color=Red"'), 'Add a Red opens a new red wine');
  assert.ok(wine.includes('/admin/pages/wine/new?list=By+the+glass'), 'the glass lists add to By the glass');
  const bar = JSON.stringify((await call('/api/page/' + file('the-bar/cocktails'))).data);
  assert.ok(bar.includes('Add a House Cocktail') && bar.includes('/admin/pages/classic/new?family=Hot'), 'super admins add classics too');
  const beer = JSON.stringify((await call('/api/page/' + file('the-bar/beer-and-draft'))).data);
  assert.ok(beer.includes('/admin/pages/beer/new?serve=Draft') && beer.includes('/admin/pages/beer/new?serve=Bottle'));
  // Staff see the same pages with none of it.
  const code = (await call('/api/team')).data.company.joinCode;
  const sam = person();
  await sam('/api/join', { method: 'POST', body: { code, name: 'Sam Runner', pin: '1357', storeId: 1 } });
  for (const slug of ['food-matrix', 'the-bar/wine', 'the-bar/cocktails', 'the-bar/beer-and-draft']) {
    const s = JSON.stringify((await sam('/api/page/' + file(slug))).data);
    assert.ok(!s.includes('/admin/') && !s.includes('"add":'), 'no admin links for staff on ' + slug);
  }
});

test('sommelier program: video-first hub, Level 1 course and Level 2, with the old pages kept as exam details', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  const hub = await page('sommelier-program');
  assert.ok(hub.includes('PROGRAM') && hub.includes('"/sommelier-program/level-1"') && hub.includes('"youtubeId":"vHo_OsDWfpE"'));
  assert.ok(hub.includes('https://portal.mastersommeliers.org/register'), 'register with the Court');
  const l1 = await page('sommelier-program/level-1');
  assert.ok(l1.includes('"/sommelier-program/study-guide/france"') && l1.includes('"/sommelier-program/level-1/exam-details"'), 'twelve lessons and the exam details');
  assert.equal((await page('sommelier-program/study-guide')).includes('12 LESSONS'), true, 'the old Study Guide address shows the course');
  const l2 = await page('sommelier-program/level-2');
  assert.ok(l2.includes('"youtubeId":"XFiWNb9GMNE"') && l2.includes('"/sommelier-program/level-2/exam-details"'));
  // Nov 8, Tommy: no Book button in the level heroes (booking stays on the hub), same two buttons as Cocktail and Beer
  assert.ok(!/"Button · Book/.test(l1 + l2) || !/"n":"Button · Book[^"]*","[^}]*"to"/.test(l1), 'no book link in the level heroes');
  assert.ok((await page('sommelier-program/level-1/exam-details')).includes('42 of 70'), 'the old Level 1 page is still there');
  // Nov 8: Sommelier finals, like every other program level: a 70-question practice exam and a 45-question theory exam
  assert.ok(l1.includes('t%3Afinal%3Asomm-1') && l1.includes('"/sommelier-program/level-1/exam-details"'), 'Level 1: final exam, exam details link');
  assert.ok(l2.includes('t%3Afinal%3Asomm-2'), 'Level 2: final exam');
  const cat = (await call('/api/quiz/catalog')).data;
  const f1 = cat.quizzes.find((q) => q.id === 't:final:somm-1'), f2 = cat.quizzes.find((q) => q.id === 't:final:somm-2');
  assert.equal(f1.count, 70); assert.equal(f1.group, 'Sommelier Level 1'); assert.equal(f1.title, 'Sommelier Level 1 · Practice Exam');
  assert.equal(f2.count, 45); assert.equal(f2.group, 'Sommelier Level 2');
  assert.equal((await call('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:somm-1' } })).data.items.length, 70);
  assert.ok((await page('sommelier-program/level-2/exam-details')).includes('THE TASTING GRID'));
  const side = JSON.stringify((await import('../src/content/sidebar.json', { with: { type: 'json' } })).default);
  assert.ok(side.includes('Nav · Sommelier Program') && side.includes('"/sommelier-program"'));
});

test('a Study Guide lesson: video, key points, reading flow, and 3 cards that finish the section', async () => {
  const index = (await call('/api/index')).data;
  const e = index.find((x) => x.slug === 'sommelier-program/study-guide/france/loire');
  assert.ok(e, 'each section has its own address');
  const loire = (await call('/api/page/' + e.file)).data;
  const json = JSON.stringify(loire);
  assert.ok(json.includes('"youtubeId":"F0jDcA_Ujcc"') && json.includes('Pays Nantais') && json.includes('MUSCADET'));
  let check; (function walk(n) { if (n.meta?.check) check = n.meta.check; (n.c || []).forEach(walk); })(loire.main);
  assert.equal(check.items.length, 3); assert.equal(check.key, 'france#3'); assert.equal(check.done, false);
  assert.equal((await call('/api/study/done', { method: 'POST', body: { key: 'nope#1' } })).status, 400);
  assert.equal((await call('/api/study/done', { method: 'POST', body: { key: 'france#3' } })).status, 200);
  const again = (await call('/api/page/' + e.file)).data;
  let c2; (function walk(n) { if (n.meta?.check) c2 = n.meta.check; (n.c || []).forEach(walk); })(again.main);
  assert.equal(c2.done, true, 'three right marks the section done');
  assert.ok(JSON.stringify(again).includes('6 sections · 1 done'));
});

test('the group’s kitchen: a dish is entered once, every store puts it on its menu with its own price', async () => {
  const lib = (await call('/api/library?collection=recipe')).data.entries;
  const cal = lib.find((d) => /calamari/i.test(d.data.name));
  assert.ok(cal && cal.onMine && cal.stores.includes('The Baldwin'), 'The Baldwin’s dishes are the group’s dishes');
  await call('/api/store', { method: 'POST', body: { storeId: 3 } }); // Testa Barra
  const there = (await call('/api/library?collection=recipe')).data.entries.find((d) => d.id === cal.id);
  assert.equal(there.onMine, false);
  const added = (await call('/api/entries', { method: 'POST', body: { collection: 'recipe', libraryId: cal.id, data: { course: cal.data.course } } })).data;
  assert.equal(added.data.description, cal.data.description, 'comes with the shared description');
  assert.equal((await call('/api/entries', { method: 'POST', body: { collection: 'recipe', libraryId: cal.id, data: {} } })).status, 409, 'not twice');
  // Testa Barra's own price; a store-only change; then a change for every store.
  await call('/api/entries/' + added.id, { method: 'PUT', body: { data: { ...added.data, price: '19', sellingLine: 'Testa only line' }, scope: 'store' } });
  const tb = (await call('/api/entries/' + added.id)).data;
  assert.equal(tb.data.price, '19'); assert.equal(tb.data.sellingLine, 'Testa only line');
  assert.deepEqual(tb.sharedWith, ['The Baldwin']);
  await call('/api/entries/' + added.id, { method: 'PUT', body: { data: { ...tb.data, tagline: 'Shared tagline' }, scope: 'group' } });
  await call('/api/store', { method: 'POST', body: { storeId: 1 } });
  const mine = (await call('/api/entries?collection=recipe')).data.entries.find((e) => e.data.libraryId === undefined && /calamari/i.test(e.data.name));
  assert.ok(mine, 'The Baldwin still has it');
  assert.equal(mine.data.tagline, 'Shared tagline', 'a group change reaches every store');
  assert.notEqual(mine.data.price, '19', 'prices stay each store’s own');
  assert.notEqual(mine.data.sellingLine, 'Testa only line', 'a store-only change stays there');
});

test('the Study Guide: chapters from content/manual, each a 30-card quiz that feeds progress', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  const fr = await page('sommelier-program/study-guide/france');
  assert.ok(fr.includes('CHAMPAGNE') && fr.includes('Brut Nature') && fr.includes('/quizzes?quiz=t:study:france'));
  assert.ok(!index.some((e) => e.file === '362-2'), 'the design template is not a page of its own');
  const q = (await call('/api/quiz/start', { method: 'POST', body: { quiz: 't:study:france' } })).data;
  // every card in the chapter (30 to 45 after the Court alignment, Nov 2)
  const frCards = JSON.parse(fs.readFileSync(path.join(root, 'content/manual/france.json'), 'utf8')).cards.length;
  assert.equal(q.items.length, frCards);
  const ref = q.items[0];
  assert.equal(q.questions[ref].options.length, 4);
  await call('/api/quiz/mark', { method: 'POST', body: { ref, mark: 'green' } });
  const guide = await page('sommelier-program/study-guide');
  assert.ok(guide.includes('1 of 12') || guide.includes('"1"'), 'progress shows');
  assert.ok(guide.includes('/sommelier-program/study-guide/france'));
});

test('demo: your own account is kept aside and Exit Demo puts it back; the real book is untouched', async () => {
  const me0 = (await call('/api/me')).data.user;
  const dishes0 = (await call('/api/collections')).data.counts.recipe;
  const h = { 'content-type': 'application/json', 'x-bt': '1', cookie };
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: h, body: JSON.stringify({ role: 'employee' }) });
  assert.equal(r.status, 200);
  const sets = r.headers.getSetCookie();
  const demo = sets.find((x) => x.startsWith('bt_session=')).split(';')[0];
  const back = sets.find((x) => x.startsWith('bt_return='));
  assert.ok(back, 'your own sign-in is kept aside');
  const me = (await (await fetch(BASE + '/api/me', { headers: { cookie: demo } })).json()).user;
  assert.equal(me.demo, true); assert.equal(me.role, 'staff');
  const x = await fetch(BASE + '/api/demo/exit', { method: 'POST', headers: { 'x-bt': '1', cookie: demo + '; ' + back.split(';')[0] } });
  assert.equal((await x.json()).restored, true);
  const again = x.headers.getSetCookie().find((c) => c.startsWith('bt_session=')).split(';')[0];
  assert.equal((await (await fetch(BASE + '/api/me', { headers: { cookie: again } })).json()).user.id, me0.id, 'back in your own account');
  assert.equal((await call('/api/collections')).data.counts.recipe, dishes0, 'the real menu is unchanged');
  assert.equal((await fetch(BASE + '/api/demo/start', { method: 'POST', headers: h, body: '{"role":"owner"}' })).status, 400, 'two views only: employee and manager');
});

test('Spirits for staff: the cards lose "Our bottles" (managers only), so they hug their words and each grid row evens out', async () => {
  const h = { 'content-type': 'application/json', 'x-bt': '1' };
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: h, body: JSON.stringify({ role: 'employee', demo: 'mise' }) });
  const demo = r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
  const get = async (p) => (await fetch(BASE + p, { headers: { ...h, cookie: demo } })).json();
  const file = (await get('/api/index')).find((e) => e.slug === 'the-bar/spirits').file;
  const find = (n, f) => (f(n) ? n : (n.c || []).reduce((hit, c) => hit || find(c, f), null));
  const grid = find((await get('/api/page/' + file)).main, (n) => n.n === 'Categories');
  const vodka = grid.c.find((c) => c.n === 'Spirit · Vodka');
  assert.ok(!vodka.c.some((c) => c.n === 'Our bottles'));
  assert.equal(vodka.sv, 'H', 'hugs its words');
  assert.equal(grid.ca, 'S', 'each row one height');
});

test('build your own quiz: any mix of topics makes a test on the spot; dish questions are for the floor, not the kitchen', async () => {
  const q = (await call('/api/quiz/start', { method: 'POST', body: { topics: ['course:Entrees', 'allergens', 'study:france'], count: 10 } })).data;
  assert.equal(q.items.length, 10, 'a course, a chapter and allergens together (these used to come back "couldn’t find that quiz")');
  const all = (await call('/api/quiz/start', { method: 'POST', body: { topics: ['course:Entrees'], count: 0 } })).data; // every Entrees question (20 random ones could miss the allergy kind)
  const qs = Object.values(all.questions).map((x) => x.q).join(' ');
  assert.ok(!/station/i.test(qs), 'no kitchen station questions');
  assert.ok(/allergy/.test(qs), 'guest allergy questions');
  // A long quiz saves too (it was capped at 20 questions, so 50, 100 and Full Quiz never reached a manager).
  const saved = await call('/api/quiz/attempt', { method: 'POST', body: { quiz: all.id, items: all.items, answers: all.items.map(() => 0) } });
  assert.equal(saved.status, 200, 'a ' + all.items.length + '-question quiz saves');
});

test('Court alignment: Level 2 lessons, the Court’s outcome on lessons, and its documents on the hub', async () => {
  const index = (await call('/api/index')).data;
  const page = async (slug) => JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  // the Court's learning outcome, quoted, on a Level 1 lesson, with a link to its PDF
  const loire = await page('sommelier-program/study-guide/france/loire');
  assert.ok(loire.includes('WHAT THE COURT EXPECTS') && loire.includes('identify the Loire Valley') && loire.includes('mastersommeliers.org/wp-content/uploads/'));
  // the hub links the Court's own PDFs
  const hub = await page('sommelier-program');
  assert.ok(hub.includes('FROM THE COURT') && hub.includes('Certified-Sommelier-Exam-Syllabus.pdf') && hub.includes('Grape-Variety-Profiles-Introductory-Level.pdf'));
  // Level 2: lessons from content/manual-l2, reachable from the Level 2 page, no "coming soon" on the lessons
  const l2 = fs.existsSync(path.join(root, 'content/manual-l2')) ? fs.readdirSync(path.join(root, 'content/manual-l2')).filter((f) => f.endsWith('.json')) : [];
  if (l2.length) {
    const ch = JSON.parse(fs.readFileSync(path.join(root, 'content/manual-l2', l2[0]), 'utf8'));
    const lvl2 = await page('sommelier-program/level-2');
    assert.ok(lvl2.includes('/sommelier-program/level-2/' + ch.slug) && !lvl2.includes('COMING SOON'));
    const lesson = await page('sommelier-program/level-2/' + ch.slug);
    assert.ok(lesson.includes('Level 2') && lesson.includes('Certified level'));
    const q = (await call('/api/quiz/start', { method: 'POST', body: { quiz: 't:study:' + ch.slug } })).data;
    assert.equal(q.items.length, ch.cards.length);
  }
});

test('demo: /demo starts a private copy with a sample menu; risky actions are off', async () => {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ role: 'manager' }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const get = async (p) => (await fetch(BASE + p, { headers: { cookie } })).json();
  const me = (await get('/api/me')).user;
  assert.equal(me.demo, true);
  assert.equal(me.store.name, 'The Baldwin');
  const index = await get('/api/index');
  assert.ok(index.some((e) => e.slug === 'recipe/crispy-calamari'), 'made-up dishes');
  assert.ok(!index.some((e) => e.slug === 'recipe/short-rib'), 'none of The Baldwin’s dishes');
  assert.ok(index.some((e) => e.slug.startsWith('wine-list/')), 'the real wine list');
  const pw = await fetch(BASE + '/api/password', { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-bt': '1' }, body: '{}' });
  assert.equal(pw.status, 403);
  assert.equal((await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: '{"role":"nope"}' })).status, 400);
});

test('quiz answers match the books in the Quiz Updates folder (Nov 5)', async () => {
  const all = (await call('/api/quiz/start', { method: 'POST', body: { topics: ['specialty', 'brg', 'mules', 'dessert', 'spiritless', 'house', 'classic-on', 'classic-off', 'wine-glass', 'wine-bottle', 'allergens', 'For the Table'.replace(/^/, 'course:')], count: 0 } })).data;
  const qs = Object.values(all.questions);
  const answer = (re) => qs.filter((x) => re.test(x.q)).map((x) => x.options[x.answer]);
  assert.deepEqual(answer(/base of the Veggie Spritz/), ['Chartreuse'], 'the Drink Book profile, not the first line of the build');
  assert.ok(!qs.some((x) => /base spirit/.test(x.q) && x.options[x.answer] === 'Tequila' && x.options.includes('Mezcal')), 'all tequila is technically mezcal (Drink Book)');
  assert.ok(!qs.some((x) => /Which of these is in The Ritz/.test(x.q) && x.options.some((o, i) => i !== x.answer && /simple syrup/i.test(o))), 'the mint foam is made with simple');
  assert.ok(!qs.some((x) => /egg allergy/.test(x.q) && x.options.some((o, i) => i !== x.answer && /eggplant|calamari|gnocchetti|sunday sauce|rigatoni|tagliatelle|salmon/i.test(o))), 'fresh pasta and breading count as egg (Allergen Guide)');
  assert.ok(!qs.some((x) => /^What style of beer/.test(x.q)), 'beer styles are ours, not the menu’s');
  assert.ok(!qs.some((x) => /base spirit/.test(x.q) && x.options.some((o) => /sugar|syrup|juice|bubbles/i.test(o))), 'only spirits are base spirits');
  assert.ok(!qs.some((x) => /What grape/.test(x.q) && x.options.some((o) => /^(Chianti Classico|Rioja|Blend|Brut|Prosecco|Barolo)$/.test(o))), 'grape questions use grapes');
  assert.ok(!qs.some((x) => /cost\?/.test(x.q)), 'no price questions');
  const pork = qs.filter((x) => /doesn’t eat pork/.test(x.q));
  assert.ok(pork.length, 'pork questions exist');
  assert.ok(pork.every((x) => !x.options.some((o, i) => i !== x.answer && /meatball|ragu|sunday sauce/i.test(o))), 'meatballs and ragu are never offered as pork-free');
});

test('cocktail specs live on their own page; the cocktail pages and the Cocktails page show none (Nov 5)', async () => {
  const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };
  const index = (await call('/api/index')).data;
  const specsEntry = index.find((e) => e.slug === 'the-bar/cocktail-specs');
  assert.ok(specsEntry, 'Cocktail Specs has an address');
  const specs = (await call('/api/page/' + specsEntry.file)).data;
  const cards = all(specs.main, (n) => (n.n || '').startsWith('Spec · '));
  const house = (await call('/api/entries?collection=house')).data.entries;
  assert.ok(house.length > 20);
  for (const h of house) assert.ok(cards.some((c) => c.n === 'Spec · ' + h.data.name), `${h.data.name} has a spec`);
  const fs = cards.find((c) => c.n === 'Spec · Fuschia Satin');
  assert.match(JSON.stringify(fs), /"s":"[0-9.]+ oz"/, 'the spec card has amounts');
  // No amounts, method, ice or steps on the drink pages or the Cocktails page.
  const oz = /"s":"[0-9.¼½¾]+ oz"/;
  for (const slug of ['signature/fuschia-satin', 'classic/daiquiri', 'classic/old-fashioned', 'the-bar/cocktails']) {
    const e = index.find((x) => x.slug === slug);
    const p = (await call('/api/page/' + e.file)).data;
    const s = JSON.stringify(p.main);
    assert.doesNotMatch(s, oz, slug + ' shows no amounts');
    assert.doesNotMatch(s, /"n":"(Build band|How to make it|Method|Ice)"/, slug + ' has no build, steps, method or ice');
    if (slug !== 'the-bar/cocktails') {
      const btn = all(p.main, (n) => n.n === 'Button · Open spec')[0];
      assert.ok(btn && btn.to.startsWith('/the-bar/cocktail-specs?find='), slug + ' links to its spec');
    }
  }
});

test('the Cocktails page lists every classic by its own name (Nov 6: every row read "Manhattan")', async () => {
  const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };
  const page = (await call('/api/page/14-2')).data;
  const rows = all(page.main, (n) => (n.n || '').startsWith('Classic row · '));
  assert.ok(rows.length > 20);
  const firstText = (n) => all(n, (x) => x.t === 'T')[0]?.s;
  for (const r of rows) assert.equal(firstText(r), r.n.slice('Classic row · '.length), r.n + ' shows its own name');
  const house = all(page.main, (n) => (n.n || '').startsWith('Row · ') && !n.n.includes('Zero-proof'));
  for (const r of house) assert.equal(firstText(r), r.n.slice('Row · '.length), r.n + ' shows its own name');
});

test('pairing questions are wine only for now (Tommy, Nov 6: no cocktails)', async () => {
  const q = (await call('/api/quiz/start', { method: 'POST', body: { topics: ['pairings'], count: 0 } })).data;
  const all = Object.values(q.questions);
  assert.ok(all.length > 20, 'the Pairings quiz still has questions');
  assert.ok(!all.some((x) => /cocktail/i.test(x.q)), 'no cocktail pairing questions');
  assert.ok(all.every((x) => /wine do we suggest|dish do we suggest/.test(x.q)), 'only wine-with-dish and dish-with-wine');
});

test('a photo keeps its framing when saved, and the file address stays clean (Nov 6)', async () => {
  const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };
  const e = (await call('/api/entries?collection=recipe')).data.entries.find((x) => x.data.photo);
  const base = e.data.photo.split('#')[0];
  const framed = base + '#f=30,20,1.5';
  const saved = await call('/api/entries/' + e.id, { method: 'PUT', body: { data: { ...e.data, photo: framed } } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.data.photo, framed, 'the framing is stored with the photo');
  const index = (await call('/api/index')).data;
  const page = (await call('/api/page/' + index.find((x) => x.slug === e.slug).file)).data;
  assert.ok(all(page.main, (n) => (n.f || []).some((f) => f.img === framed)).length, 'the dish page gets the framed photo');
  const back = await call('/api/entries/' + e.id, { method: 'PUT', body: { data: { ...e.data, photo: base } } });
  assert.equal(back.data.data.photo, base, 'Reset goes back to the plain photo');
});

test('demo: a refresh swaps the copy for a fresh one; real accounts are left alone', async () => {
  const h = { 'content-type': 'application/json', 'x-bt': '1' };
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: h, body: JSON.stringify({ role: 'manager' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const before = (await (await fetch(BASE + '/api/me', { headers: { cookie } })).json()).user;
  const again = await fetch(BASE + '/api/demo/restart', { method: 'POST', headers: { ...h, cookie } });
  assert.equal((await again.json()).restarted, true);
  const fresh = again.headers.get('set-cookie').split(';')[0];
  assert.notEqual(fresh, cookie);
  const after = (await (await fetch(BASE + '/api/me', { headers: { cookie: fresh } })).json()).user;
  assert.equal(after.demo, true); assert.equal(after.role, 'manager');
  assert.notEqual(after.id, before.id);
  assert.equal((await (await fetch(BASE + '/api/me', { headers: { cookie } })).json()).user, null, 'the old copy is gone');
  const none = await fetch(BASE + '/api/demo/restart', { method: 'POST', headers: h });
  assert.equal((await none.json()).restarted, false);
  assert.equal(none.headers.get('set-cookie'), null);
});

test('videos: no empty video frames, and the library lists only real videos (Nov 8)', async () => {
  const index = (await call('/api/index')).data;
  const file = (slug) => index.find((e) => e.slug === slug)?.file;
  const walk = (n, fn) => { fn(n); (n.c || []).forEach((c) => walk(c, fn)); };
  const lib = (await call('/api/page/' + file('video-library'))).data;
  const cards = [];
  walk(lib.main, (n) => { if ((n.n || '').startsWith('Video · ')) cards.push(n); });
  assert.ok(cards.length > 0, 'the library has videos');
  assert.ok(cards.every((c) => c.vid), 'every library card plays something');
  assert.doesNotMatch(JSON.stringify(lib), /Walleye Milanese|Watched|Required before your next shift/, 'none of the made-up library');
  for (const slug of ['recipe/baked-meatballs', 'classic/gimlet', 'wine/red', '']) {
    const f = file(slug); if (!f) continue;
    const page = (await call('/api/page/' + f)).data;
    walk(page.main, (n) => {
      const frame = (n.n || '').startsWith('Video slot') || n.n === 'Player' || (n.n || '').startsWith('Video · ');
      assert.ok(!frame || n.vid, `${slug || 'home'}: ${n.n} has no video`);
    });
  }
});

test('notes to the team ("bar lead to add", "confirm with chef") show to managers only (Nov 8)', async () => {
  const as = async (role) => {
    const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ role }) });
    const c = r.headers.get('set-cookie').split(';')[0];
    const get = async (p) => (await fetch(BASE + p, { headers: { cookie: c, 'x-bt': '1' } })).json();
    const index = await get('/api/index');
    const page = async (slug) => JSON.stringify((await get('/api/page/' + index.find((e) => e.slug === slug).file)).main);
    return Promise.all(['classic/old-fashioned', 'the-bar/cocktail-specs', 'food-matrix'].map(page)).then((x) => x.join(' '));
  };
  const NOTE = /lead to add|lead to confirm|confirm with chef|chef to confirm|sample data/i;
  // Nov 10 (audit): a demo manager sees the finished book too; real managers still see the notes (forViewer: staff || demo)
  assert.doesNotMatch(await as('manager'), NOTE, 'demo managers see the finished book');
  assert.doesNotMatch(await as('employee'), NOTE, 'staff never do');
});

test('job paths: a server’s path from the book, page reads, quiz passes and manager sign-offs (Nov 8)', async () => {
  const start = async (role) => {
    const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ role }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return async (p, method = 'GET', body) => {
      const res = await fetch(BASE + p, { method, headers: { cookie, 'x-bt': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, data: await res.json() };
    };
  };
  const me = await start('employee');
  const path = (await me('/api/path')).data;
  assert.deepEqual(path.jobs, ['server']);
  const p = path.paths[0];
  assert.equal(p.stages[0].state, 'done', 'before your first shift is done');
  assert.ok(p.stages[1].steps.some((s) => s.id === 't:course:Pasta' && s.done), 'a passed quiz ticks its step');
  assert.ok(p.stages.some((st) => st.steps.some((s) => s.kind === 'lesson' && s.program === 'Sommelier · Level 1')), 'a Sommelier lesson is part of the path');
  assert.ok(p.stages.every((st) => st.steps.every((s) => s.kind === 'signoff' || s.to)), 'every step opens a real page, quiz or lesson');
  // a page read
  await me('/api/path/read', 'POST', { slug: 'safety', done: false });
  assert.equal((await me('/api/path')).data.paths[0].stages[0].state, 'now', 'unread, the stage reopens');
  await me('/api/path/read', 'POST', { slug: 'safety' });
  assert.equal((await me('/api/path')).data.paths[0].stages[0].state, 'done');
  // staff can't change their job once it's set, or reach the manager's view
  assert.equal((await me('/api/path/jobs', 'POST', { jobs: ['host'] })).status, 403);
  assert.equal((await me('/api/path/team')).status, 403);
  // a manager's team, a job change and a sign-off
  const mgr = await start('manager');
  const team = (await mgr('/api/path/team')).data;
  assert.equal(team.people.length, 7, 'the demo team (Nov 11): seven on staff, as in the manager home design');
  const quinn = team.people.find((x) => x.name === 'Quinn Abbott');
  assert.deepEqual(quinn.jobs, ['bartender']);
  const signed = (await mgr('/api/path/signoff', 'POST', { userId: quinn.id, key: 'path:bartender:build-three' })).data;
  assert.ok(signed.paths[0].stages.some((st) => st.steps.some((s) => s.id === 'path:bartender:build-three' && s.done && s.by === 'Rosalind Hart')));
  assert.equal((await mgr('/api/path/signoff', 'POST', { userId: quinn.id, key: 'path:server:floor' })).status, 400, 'not a step in their path');
  // the Cocktail Program's Level 2 practical (Nov 8): a manager signs it off on Admin → Training
  const pr = (await mgr('/api/path/signoff', 'POST', { userId: quinn.id, key: 'program:bar-2:practical' })).data;
  assert.ok(pr.programs.find((g) => g.cert === 'Certified Bartender').practical.by === 'Rosalind Hart');
  // Certificates (Nov 8): Quinn passed both finals in the demo; Level 2 needs the practical too, now signed
  const qc = (await mgr('/api/certificates?user=' + quinn.id)).data.certificates;
  assert.deepEqual(qc.map((x) => x.key).sort(), ['bar-1', 'bar-2']);
  const c2 = qc.find((x) => x.key === 'bar-2');
  assert.equal(c2.title, 'Certified Bartender'); assert.equal(c2.final.pct, 90); assert.equal(c2.practical.by, 'Rosalind Hart'); assert.equal(c2.store, 'The Baldwin');
  assert.ok(/^BAR2-\d{4}$/.test(c2.number));
  const mine = (await me('/api/certificates')).data.certificates;
  assert.deepEqual(mine.map((x) => x.key), ['bar-1'], 'the demo employee is a Certified Bar Server');
  assert.equal((await me('/api/certificates?user=' + quinn.id)).status, 403, 'staff only see their own');
  const both = (await mgr(`/api/path/person/${quinn.id}`, 'PATCH', { jobs: ['bartender', 'server'] })).data;
  assert.equal(both.paths.length, 2);
});

test('manager home + People (Nov 11): sign-offs asked for, Not Yet, Give More Time, reminders, congrats, job chip', async () => {
  const start = async (role) => {
    const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ role }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return async (p, method = 'GET', body) => {
      const res = await fetch(BASE + p, { method, headers: { cookie, 'x-bt': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, data: await res.json() };
    };
  };
  const mgr = await start('manager');
  const home = (await mgr('/api/manager/home')).data;
  // the demo is full: seven people, two behind, one new, four sign-offs waiting (Dorian's Hospitality 101 acknowledgment, Nov 11), certificates, quizzes, edits, the book
  assert.deepEqual(home.people.map((p) => p.name).sort(), ['Dorian Pike', 'Hollis Grant', 'Marisol Vega', 'Odalys Ruiz', 'Quinn Abbott', 'Teddy Lam', 'Wynn Carver']);
  assert.equal(home.people.filter((p) => p.status === 'behind').length, 2);
  assert.equal(home.people.find((p) => p.name === 'Odalys Ruiz').status, 'new');
  assert.equal(home.signoffs.length, 4);
  assert.equal((await mgr('/api/manager/signoffs/count')).data.count, 4);
  assert.ok(home.signoffs.some((a) => a.name === 'Dorian Pike' && a.key === 'program:hosp-1:practical'), 'the signed acknowledgment waits for the trainer');
  assert.ok(home.certificates.length >= 2);
  assert.ok(home.quizzes.taken > 0 && home.quizzes.missed && home.quizzes.missed.asked >= 3 && home.quizzes.missed.pct < 100 && /\?$/.test(home.quizzes.missed.q), 'the most-missed question is a real question from saved answers');
  assert.equal(home.edits.length, 3);
  assert.ok(home.edits.every((e) => e.to && e.to.startsWith('/')), 'each edit opens its page');
  assert.equal(home.book.find((t) => t.key === 'recipe').count, 16);
  // Not Yet: the ask goes back to the person; Sign Off clears it
  const teddy = home.signoffs.find((a) => a.name === 'Teddy Lam');
  const ny = (await mgr('/api/path/not-yet', 'POST', { userId: teddy.userId, key: teddy.key })).data;
  assert.ok(ny.paths[0].stages.some((st) => st.steps.some((x) => x.id === teddy.key && x.ask.declinedAt && x.ask.declinedBy === 'Rosalind Hart')));
  assert.equal((await mgr('/api/path/not-yet', 'POST', { userId: teddy.userId, key: teddy.key })).status, 404, 'not waiting anymore');
  const wynn = home.signoffs.find((a) => a.name === 'Wynn Carver');
  const signed = (await mgr('/api/path/signoff', 'POST', { userId: wynn.userId, key: wynn.key })).data;
  assert.ok(signed.paths[0].stages.some((st) => st.steps.some((x) => x.id === wynn.key && x.done)));
  assert.equal((await mgr('/api/manager/signoffs/count')).data.count, 2, 'Quinn’s practical and Dorian’s acknowledgment are left');
  // Give More Time: every late step to 3 days out, or one step to a picked date
  const hollis = home.people.find((p) => p.name === 'Hollis Grant');
  const before = (await mgr(`/api/path/person/${hollis.id}`)).data;
  assert.ok(before.late > 0 && before.status === 'behind');
  const lateStep = before.paths[0].stages.flatMap((st) => st.steps).find((x) => x.late);
  const pick = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
  const one = (await mgr('/api/path/more-time', 'POST', { userId: hollis.id, step: lateStep.id, due: pick })).data;
  const moved = one.paths[0].stages.flatMap((st) => st.steps).find((x) => x.id === lateStep.id);
  assert.ok(moved.due === pick && moved.moved && !moved.late);
  assert.equal(one.late, before.late - 1);
  assert.equal((await mgr('/api/path/more-time', 'POST', { userId: hollis.id, step: lateStep.id, due: '2020-01-01' })).status, 400, 'not in the past');
  const all = (await mgr('/api/path/more-time', 'POST', { userId: hollis.id })).data;
  assert.equal(all.late, 0); assert.notEqual(all.status, 'behind');
  assert.equal((await mgr('/api/path/more-time', 'POST', { userId: hollis.id })).status, 400, 'nothing late now');
  // a reminder and a congrats land on the person's My Path as notes (a second reminder the same day replaces the first)
  const dorian = home.people.find((p) => p.name === 'Dorian Pike');
  await mgr('/api/path/remind', 'POST', { userId: dorian.id });
  const r2 = (await mgr('/api/path/remind', 'POST', { userId: dorian.id })).data;
  assert.equal(r2.notes.filter((n) => n.kind === 'reminder').length, 1);
  assert.match(r2.notes[0].body, /past due/);
  const cert = home.certificates[0];
  assert.equal((await mgr('/api/path/congrats', 'POST', { userId: cert.userId, cert: cert.key })).status, 200);
  assert.equal((await mgr('/api/path/congrats', 'POST', { userId: dorian.id, cert: 'bar-3' })).status, 400, 'only a certificate they have');
  // the job chip: one job, the path swaps in place
  const swapped = (await mgr(`/api/path/person/${dorian.id}`, 'PATCH', { jobs: ['host'] })).data;
  assert.deepEqual(swapped.jobs, ['host']); assert.equal(swapped.jobLabel, 'Host');
  // a person's page has their quizzes and sign-in, and the old Training / Quiz Results data
  const full = (await mgr(`/api/path/person/${hollis.id}`)).data;
  assert.ok(Array.isArray(full.quizzes) && full.quizzes.length > 0 && 'hasPin' in full && Array.isArray(full.programs));
  // staff: ask for a sign-off, take it back; close a note; never reach the manager side
  const me = await start('employee');
  assert.equal((await me('/api/path/ask', 'POST', { key: 'path:server:table-talk' })).status, 200);
  const mine = (await me('/api/path')).data;
  assert.ok(mine.paths[0].stages.some((st) => st.steps.some((x) => x.id === 'path:server:table-talk' && x.ask && !x.ask.declinedAt)));
  assert.equal((await me('/api/path/ask', 'POST', { key: 'path:bartender:bar' })).status, 400, 'not on their path');
  assert.equal((await me('/api/path/ask', 'DELETE', { key: 'path:server:table-talk' })).status, 200);
  assert.ok(!(await me('/api/path')).data.paths[0].stages.some((st) => st.steps.some((x) => x.ask)));
  for (const [p, m] of [['/api/manager/home', 'GET'], ['/api/manager/team', 'GET'], ['/api/path/remind', 'POST'], ['/api/path/more-time', 'POST'], ['/api/path/not-yet', 'POST'], ['/api/path/congrats', 'POST']])
    assert.equal((await me(p, m, m === 'POST' ? { userId: 1 } : undefined)).status, 403, p);
  // another demo's people are out of reach (each demo is its own company)
  assert.equal((await mgr(`/api/path/person/${(await me('/api/me')).data.user.id}`)).status, 404);
});

test('the Cocktail Program: its page, lessons that work like the Sommelier ones, and a 60-question final (Nov 8)', async () => {
  const index = (await call('/api/index')).data;
  // Nov 8: the program's address is its hub (like the Sommelier Program); Level 1 is /cocktail-program/level-1
  const home = JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === 'cocktail-program').file)).data);
  assert.ok(home.includes('COCKTAIL') && home.includes('Certified Bartender') && home.includes('/cocktail-program/level-3') && home.includes('t%3Afinal%3Abar-2') && home.includes('pdcrJ5V7YKM'), 'the hub: levels, finals, the six roots videos');
  assert.ok(!/Court of Master|Testa Barra|mastersommeliers/.test(home), 'nothing from the Sommelier hub left over');
  const beerHome = JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === 'beer-program').file)).data);
  assert.ok(beerHome.includes('Beer Specialist') && beerHome.includes('cicerone.org') && !/Court of Master|Testa Barra/.test(beerHome), 'the beer hub');
  const hub = index.find((e) => e.slug === 'cocktail-program/level-1');
  assert.ok(hub, 'the course page is in the book');
  const page = JSON.stringify((await call('/api/page/' + hub.file)).data);
  assert.ok(page.includes('CERTIFIED BAR SERVER') && page.includes('t%3Afinal%3Abar-1'), 'Level 1 with its final exam');
  assert.ok(!/Court of Master|mastersommeliers/.test(page), 'nothing from the Sommelier page left over');
  const lesson = index.find((e) => e.slug === 'cocktail-program/level-2/bar-six-roots');
  const lp = JSON.stringify((await call('/api/page/' + lesson.file)).data);
  assert.ok(lp.includes('"youtubeId":"pdcrJ5V7YKM"') && lp.includes('OLD FASHIONED'), 'the Old Fashioned lesson with its video');
  const cat = (await call('/api/quiz/catalog')).data;
  const final = cat.quizzes.find((q) => q.id === 't:final:bar-1');
  assert.equal(final.count, 40, 'Level 1 is a short final (40 questions since Nov 12: one lesson per staple spirit)');
  assert.equal(final.group, 'Cocktail Program · Level 1');
  assert.equal(cat.quizzes.filter((q) => q.group === 'Cocktail Program · Level 1').length, 10, 'nine lesson quizzes and the final');
  // Level 2 (Nov 8 split): the spirits and the six roots, a 60-question final with our menu's specs, and a practical
  const l2 = index.find((e) => e.slug === 'cocktail-program/level-2');
  const l2p = JSON.stringify((await call('/api/page/' + l2.file)).data);
  assert.ok(l2p.includes('CERTIFIED BARTENDER') && l2p.includes('t%3Afinal%3Abar-2') && l2p.includes('practical'), 'Level 2 with its final and practical');
  const final2 = cat.quizzes.find((q) => q.id === 't:final:bar-2');
  assert.equal(final2.count, 60);
  assert.equal(cat.quizzes.filter((q) => q.group === 'Cocktail Program · Level 2').length, 10, 'nine lesson quizzes and the final');
  const gin = JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === 'cocktail-program/level-2/bar-vodka-gin/gin-styles').file)).data);
  assert.ok(gin.includes('GENEVER') && gin.includes('/spirit/gin/london-dry'), 'a spirit lesson links to its back bar page');
  const start = (await call('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:bar-1' } })).data;
  assert.equal(start.items.length, 40);
  assert.ok(start.items.every((q) => !/What’s the spec/.test(q.q)), 'specs are a bartender’s job: not in Level 1');
  const start2 = (await call('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:bar-2' } })).data;
  assert.equal(start2.items.length, 60);
  // Level 3 (Nov 8): the craft, its final and an original-cocktail practical
  const l3 = JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === 'cocktail-program/level-3').file)).data);
  assert.ok(l3.includes('ADVANCED MIXOLOGIST') && l3.includes('t%3Afinal%3Abar-3') && l3.includes('practical'));
  assert.equal(cat.quizzes.filter((q) => q.group === 'Cocktail Program · Level 3').length, 7, 'six lesson quizzes and the final');
  assert.ok(index.some((e) => e.slug === 'cocktail-program/level-3/bar-costing/pour-cost'));
  // The Beer Program (Nov 8): Level 1 on the Cicerone Certified Beer Server outline, a 60-question final, a draft-pour practical
  const beer = index.find((e) => e.slug === 'beer-program/level-1');
  const bp = JSON.stringify((await call('/api/page/' + beer.file)).data);
  assert.ok(bp.includes('BEER SERVER') && bp.includes('t%3Afinal%3Abeer-1') && bp.includes('practical') && bp.includes('Beer Program'));
  assert.ok(!/Cocktail Program|USBG/.test(bp), 'nothing from the Cocktail Program left over');
  assert.equal(cat.quizzes.filter((q) => q.group === 'Beer Program · Level 1').length, 9, 'eight lesson quizzes and the final');
  const pour = JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === 'beer-program/level-1/beer-glass-pour/the-draft-pour').file)).data);
  assert.ok(pour.includes('/beer/pilsner') === false && pour.includes('1 INCH'), 'the draft pour lesson');
  const sb = (await call('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:beer-1' } })).data;
  assert.equal(sb.items.length, 60);
  // Beer Level 2 (Nov 8): Beer Specialist, on the Certified Cicerone outline
  const b2 = JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === 'beer-program/level-2').file)).data);
  assert.ok(b2.includes('BEER SPECIALIST') && b2.includes('t%3Afinal%3Abeer-2'));
  assert.equal(cat.quizzes.filter((q) => q.group === 'Beer Program · Level 2').length, 10, 'nine lesson quizzes and the final');
  // Beer Level 3 (Nov 8): running the beer program
  const b3 = JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === 'beer-program/level-3').file)).data);
  assert.ok(b3.includes('ADVANCED SPECIALIST') && b3.includes('t%3Afinal%3Abeer-3'));
  assert.equal(cat.quizzes.filter((q) => q.group === 'Beer Program · Level 3').length, 9, 'eight lesson quizzes and the final');
});

test('Cocktail Program Level 1: one lesson per staple spirit, each store’s own drinks and bottles, a final across all nine (Nov 12)', async () => {
  const index = (await call('/api/index')).data;
  const slugs = ['bar-serving', 'bar-l1-vodka', 'bar-l1-gin', 'bar-l1-rum', 'bar-l1-tequila', 'bar-l1-whiskey', 'bar-l1-basics', 'bar-our-menu', 'bar-glass-ice-garnish'];
  const lessons = slugs.map((s) => JSON.parse(fs.readFileSync(path.join(root, 'content/bar', s + '.json'), 'utf8')));
  assert.deepEqual(lessons.map((c) => [c.number, c.barLevel]), slugs.map((_, i) => [i + 1, 1]), 'nine lessons, in order, all Level 1');
  assert.deepEqual(lessons.map((c) => c.title), ['Serving and how guests order', 'Vodka', 'Gin', 'Rum', 'Tequila and mezcal', 'Whiskey', 'The basics', 'Our menu', 'Glass, ice and garnish']);
  assert.ok(!fs.existsSync(path.join(root, 'content/bar/bar-spirits-at-a-glance.json')) && fs.existsSync(path.join(root, 'content/archive/bar-l1-v2/bar-spirits-at-a-glance.json')), 'Spirits at a glance is archived, not deleted');
  const level1 = JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === 'cocktail-program/level-1').file)).data);
  for (const c of lessons) assert.ok(level1.includes(`"/cocktail-program/level-1/${c.slug}"`), c.slug + ' is on the Level 1 page');
  assert.ok(level1.includes('9 LESSONS') && level1.includes('Nine short lessons'), 'the Level 1 page counts nine');
  // every video in the app, so a spirit lesson's video is used nowhere else
  const ids = (dir) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json')).flatMap((f) => [...fs.readFileSync(path.join(root, dir, f), 'utf8').matchAll(/"youtubeId": ?"([\w-]{11})"/g)].map((m) => [f, m[1]]));
  const all = [...ids('content/bar'), ...ids('content/beer'), ...ids('content/manual'), ...ids('content/manual-l2'), ...ids('content/cms')];
  const photos = JSON.parse(fs.readFileSync(path.join(root, 'content/research/study-photos.json'), 'utf8')).photos;
  for (const c of lessons.slice(1, 6)) {
    const vids = c.v3.sections.map((s) => s.video).filter(Boolean);
    assert.equal(vids.length, 1, c.slug + ': one video');
    assert.ok(vids[0].youtubeId && vids[0].title && vids[0].by && vids[0].length, c.slug + ': title, channel and length recorded');
    assert.deepEqual([...new Set(all.filter(([f, id]) => id === vids[0].youtubeId).map(([f]) => f))], [c.slug + '.json'], c.slug + ': its video is used nowhere else');
    const own = { 'bar-l1-vodka': 'vodka', 'bar-l1-gin': 'gin', 'bar-l1-rum': 'rum', 'bar-l1-tequila': 'tequila', 'bar-l1-whiskey': 'whiske?y' }[c.slug];
    const named = ['vodka', 'gin', 'rum', 'tequila', 'mezcal', 'whiske?y', 'bourbon', 'scotch', 'brandy', 'cognac'].filter((w) => new RegExp(`\\b${w}s?\\b`, 'i').test(vids[0].title));
    assert.deepEqual(named, [own], c.slug + ': a video about that spirit only (' + vids[0].title + ')');
    for (const s of c.sections) {
      assert.ok(s.source && s.source.length > 10, `${c.slug} · ${s.name}: names its source`);
      const v = c.v3.sections.find((x) => x.name === s.name);
      assert.ok(v.video || photos.some((p) => p.chapter === c.slug && p.section === s.name), `${c.slug} · ${s.name}: a video or a photo`);
      assert.equal(v.check.length, 3, `${c.slug} · ${s.name}: three check cards`);
      assert.ok(v.keyPoints.length >= 3 && v.read.bigIdea && v.read.where, `${c.slug} · ${s.name}: key points and the reading`);
    }
    assert.ok(Array.isArray(c.unverified) && c.unverified.length, c.slug + ': says what still needs checking');
  }
  // our menu's drinks first: The Baldwin's own vodka drinks; no house rum on its menu, so the classics stay
  const lessonPage = async (slug) => JSON.stringify((await call('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  const vodka = await lessonPage('cocktail-program/level-1/bar-l1-vodka/vodka-cocktails');
  assert.ok(vodka.includes('ON OUR MENU') || vodka.includes('On our menu'), 'an On our menu list');
  assert.ok(vodka.includes('Lavender Haze'), 'The Baldwin’s own vodka drink');
  const rum = await lessonPage('cocktail-program/level-1/bar-l1-rum/rum-cocktails');
  assert.ok(rum.includes('Classics to know') && rum.includes('Piña Colada'), 'no house rum drink on the menu: the classics');
  const order = await lessonPage('cocktail-program/level-1/bar-l1-vodka/how-guests-order-it');
  assert.ok(order.includes('On our back bar:') && order.includes('Absolut Blue') && order.includes('and 4 more'), 'its own back bar');
  // Wrenfield (the Mise demo) sees its own
  const cookie = await startDemo('employee', 'mise');
  const idx = JSON.parse(await getAs(cookie, '/api/index'));
  const mrum = await getAs(cookie, '/api/page/' + idx.find((e) => e.slug === 'cocktail-program/level-1/bar-l1-rum/rum-cocktails').file);
  assert.ok(mrum.includes('Hibiscus Daiquiri') && !mrum.includes('Lavender Haze'), 'Wrenfield’s own rum drink');
  const mvodka = await getAs(cookie, '/api/page/' + idx.find((e) => e.slug === 'cocktail-program/level-1/bar-l1-vodka/how-guests-order-it').file);
  assert.ok(mvodka.includes('Wheatley Vodka') && !mvodka.includes('Absolut Blue'), 'Wrenfield’s own vodkas');
  // the final: 40 questions, every one of the nine lessons asked
  const start = (await call('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:bar-1', fresh: true } })).data;
  assert.equal(start.items.length, 40);
  const asked = new Set(start.items.map((r) => r.split(':')[1]));
  assert.deepEqual([...asked].sort(), [...slugs].sort(), 'every lesson is in the final');
  // the server path borrows each spirit's "How guests order it"
  const { pathFor } = await import('../server/paths.mjs');
  const steps = pathFor('server', { quizzes: [], slugs: new Set(), titles: new Map() }).flatMap((st) => st.steps.map((x) => x.key)).filter(Boolean);
  for (const k of ['bar-l1-vodka#2', 'bar-l1-gin#2', 'bar-l1-rum#2', 'bar-l1-tequila#3', 'bar-l1-whiskey#4']) assert.ok(steps.includes(k), k);
});

test('behind the scenes: health answers, ops endpoints are closed without the token, browser errors are taken (Nov 10)', async () => {
  const h = await fetch(BASE + '/api/health');
  assert.equal(h.status, 200);
  assert.equal((await h.json()).ok, true);
  assert.equal((await fetch(BASE + '/api/ops/backup')).status, 404);
  assert.equal((await fetch(BASE + '/api/ops/errors', { headers: { authorization: 'Bearer nope' } })).status, 404);
  const r = await fetch(BASE + '/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ message: 'test', path: '/x' }) });
  assert.equal(r.status, 204);
});

// Nov 11: two demos. /demo is The Baldwin's (unchanged); /demo/mise is Wrenfield, a made-up restaurant in the Mise look.
async function startDemo(role, demo) {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify(demo ? { role, demo } : { role }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
}
const getAs = async (cookie, p) => { const r = await fetch(BASE + p, { headers: { cookie, 'x-bt': '1' } }); assert.equal(r.status, 200, p); return r.text(); };

test('demo: The Baldwin demo stays brand baldwin; the Mise demo is Wrenfield, brand mise', async () => {
  const baldwin = JSON.parse(await getAs(await startDemo('employee'), '/api/me')).user;
  assert.equal(baldwin.brand, 'baldwin');
  assert.equal(baldwin.store.name, 'The Baldwin');
  assert.equal(baldwin.store.bookReady, true);
  const mise = JSON.parse(await getAs(await startDemo('employee', 'mise'), '/api/me')).user;
  assert.equal(mise.brand, 'mise');
  assert.equal(mise.demo, true);
  assert.equal(mise.store.name, 'Wrenfield');
  assert.equal(mise.companyName, 'Wrenfield');
  // the real company keeps The Baldwin's look
  assert.equal((await call('/api/me')).data.user.brand, 'baldwin');
});

test('demo: nothing of The Baldwin in the Mise demo (every page, the index, the lists, Team Chat, the admin), and its own menu fills the book', async () => {
  const cookie = await startDemo('manager', 'mise');
  const idx = JSON.parse(await getAs(cookie, '/api/index'));
  const BALDWIN = /Baldwin|Testa Barra|Jeffrey(?! Ong)|\bBRG\b|logo-white|Macomb|Shelby|Opening Menu|Paloma Verde|Pork Chop|Lobster Tagliatelle|Cacio e Pepe/i;
  const bodies = [JSON.stringify(idx)];
  for (const p of ['/api/me', '/api/counts', '/api/quiz/catalog', '/api/path', '/api/collections', '/api/team', '/api/quiz/results', '/api/sections', '/api/certificates',
    '/api/manager/home', '/api/manager/team', '/api/path/team', '/api/chat', '/api/chat/unread',
    ...['recipe', 'house', 'wine', 'shelf', 'beer', 'classic'].map((c) => '/api/entries?collection=' + c)]) bodies.push(await getAs(cookie, p));
  for (const e of idx) bodies.push(await getAs(cookie, '/api/page/' + e.file));
  // Team Chat (Nov 11): every conversation the manager has, with its messages, page cards and person cards
  const rooms = JSON.parse(await getAs(cookie, '/api/chat')).rooms;
  assert.ok(rooms.length >= 5, 'channels and direct messages are seeded');
  for (const r of rooms) bodies.push(await getAs(cookie, '/api/chat/room/' + r.key));
  // The Hospitality Program (Nov 11): its hub, levels and every lesson are in the sweep above, in the generic version
  const hosp = idx.filter((e) => e.slug.startsWith('hospitality-program'));
  assert.ok(hosp.length >= 30, 'the Hospitality Program is in its book: ' + hosp.length);
  const hospL1 = await getAs(cookie, '/api/page/' + idx.find((e) => e.slug === 'hospitality-program/level-1').file);
  assert.match(hospL1, /Wrenfield/, 'the acknowledgment names its own restaurant');
  const hits = bodies.filter((b) => BALDWIN.test(b)).map((b) => b.match(new RegExp('.{0,40}(' + BALDWIN.source + ').{0,40}', 'i'))[0]);
  assert.deepEqual(hits, [], 'no Baldwin text in what the Mise demo is sent');
  const home = await getAs(cookie, '/api/page/4-2');
  assert.match(home, /Wood-Grilled Half Chicken/);
  assert.ok(!JSON.parse(home).empty, 'Home is a full page, not an empty state');
  const fm = await getAs(cookie, '/api/page/13-2');
  for (const dish of ['Hanger Steak Frites', 'Charred Shishito Peppers', 'Chocolate Pot de Crème']) assert.match(fm, new RegExp(dish), dish);
  // Same features for every brand (Nov 11): Our Story, the Floor Plan and the Sommelier "about" page are in its book, with its own words
  for (const slug of ['our-story', 'floor-plan', 'sommelier-program/about', 'the-bar/wine', 'the-bar/beer-and-draft', 'the-bar/back-bar', 'photo-library', 'video-library', 'quizzes']) {
    const f = idx.find((e) => e.slug === slug)?.file;
    assert.ok(f, slug + ' is in the book');
    assert.ok(!JSON.parse(await getAs(cookie, '/api/page/' + f)).empty, slug + ' is full');
  }
  const story = await getAs(cookie, '/api/page/' + idx.find((e) => e.slug === 'our-story').file);
  for (const t of ['Gideon Ambrose', 'Rosalind Hart', 'Sample restaurant', 'Open the Floor Plan']) assert.match(story, new RegExp(t), t);
  const plan = JSON.parse(await getAs(cookie, '/api/page/' + idx.find((e) => e.slug === 'floor-plan').file));
  const flat = (n, out = []) => { out.push(n); (n.c || []).forEach((c) => flat(c, out)); return out; };
  const nodes = flat(plan.main);
  const img = nodes.find((n) => (n.n || '').startsWith('IMG/floorplan'));
  assert.equal(img.f[0].img, '/img/demo-mise/floor-plan.png', 'its own room drawing');
  assert.ok(img.meta.tables['404'] && img.meta.tables['12'] && !img.meta.tables['510'], 'Find a Table knows its tables and bar seats, not The Baldwin\'s');
  assert.deepEqual(nodes.find((n) => n.meta?.finder).meta.list.length, 44);
  assert.ok(nodes.some((n) => n.meta?.assign === 'Servers 1'), 'Tonight’s Sections can be assigned');
  // its pre-shift note names its own dishes and drinks
  const foh = await getAs(cookie, '/api/chat/room/foh');
  for (const t of ['Wood-Grilled Half Chicken', 'Smoke Signal', 'Gideon Ambrose']) assert.match(foh, new RegExp(t), t);
  // the manager home's last edits are its own
  assert.match(await getAs(cookie, '/api/manager/home'), /Smoke Signal/);
});

// Nov 11, Tommy: "make sure both styles have all the same functions and features, only thing different should be the menu items and the style"
test('demo: both demos have the same pages, apart from their menu items', async () => {
  const MENU = /^(recipe|signature|wine-list|shelf|beer-list)\//;
  const pages = async (demo) => new Set(JSON.parse(await getAs(await startDemo('manager', demo), '/api/index')).map((e) => e.slug).filter((s) => !MENU.test(s)));
  const [b, m] = [await pages('baldwin'), await pages('mise')];
  assert.deepEqual([...b].filter((s) => !m.has(s)), [], 'every page The Baldwin demo has, Wrenfield has');
  assert.deepEqual([...m].filter((s) => !b.has(s)), [], 'and nothing extra');
  // Nov 11 release: the Hospitality Program is the same in both (BRG's words in The Baldwin's, generic in Wrenfield's)
  const hosp = [...b].filter((s) => s.startsWith('hospitality-program'));
  assert.ok(hosp.length >= 30 && hosp.every((s) => m.has(s)), 'the same Hospitality pages in both demos');
});

// One foundation (Tommy, Nov 11): Edit Mode, the Hospitality Program's progress and the reset rules are the same in both demos.
test('demo: both demos get the same Edit Mode (managers, not staff), Hospitality progress and sign-offs', async () => {
  const MENU = ['recipe/', 'signature/', 'wine-list/', 'shelf/'];
  const flat = (n, out = []) => { if (!n) return out; out.push(n); (n.c || []).forEach((c) => flat(c, out)); return out; };
  const look = async (demo) => {
    const mgr = await startDemo('manager', demo); const staff = await startDemo('employee', demo);
    const idx = JSON.parse(await getAs(mgr, '/api/index'));
    const staffIdx = JSON.parse(await getAs(staff, '/api/index')); // each demo start is its own copy, with its own ids
    const fields = {};
    for (const pre of [...MENU, 'the-bar/beer-and-draft']) {
      const e = idx.find((x) => x.slug.startsWith(pre)); assert.ok(e, demo + ' has ' + pre);
      const page = JSON.parse(await getAs(mgr, '/api/page/' + e.file));
      assert.ok(page.edit, `${demo}: Edit Mode on ${e.slug}`);
      fields[pre] = [...new Set(flat(page.main).filter((n) => n.ed).map((n) => n.ed.k.split('.')[0]))].sort().join(',');
      const seen = JSON.parse(await getAs(staff, '/api/page/' + staffIdx.find((x) => x.slug === e.slug).file));
      assert.ok(!seen.edit && !flat(seen.main).some((n) => n.ed || n.eo), `${demo}: staff get no Edit Mode on ${e.slug}`);
    }
    const home = JSON.parse(await getAs(mgr, '/api/manager/home'));
    const path = JSON.parse(await getAs(staff, '/api/path'));
    const hosp1 = path.programs.find((g) => /Hospitality/.test(g.title) && g.certKey === 'hosp-1');
    return { fields, home: JSON.stringify(home), hosp1 };
  };
  const [b, m] = [await look('baldwin'), await look('mise')];
  assert.deepEqual(m.fields, b.fields, 'the same fields to edit');
  for (const x of [b, m]) {
    assert.match(x.home, /Dorian Pike/); assert.match(x.home, /program:hosp-1:practical/, 'the acknowledgment waits for the trainer on the manager home');
    assert.ok(x.hosp1 && x.hosp1.done >= 3, 'the demo employee has read Hospitality 101’s first lesson');
  }
});

test('demo: the Mise demo restarts as the Mise demo; The Baldwin keeps its own menu sections', async () => {
  const cookie = await startDemo('manager', 'mise');
  const r = await fetch(BASE + '/api/demo/restart', { method: 'POST', headers: { 'x-bt': '1', cookie } });
  const fresh = r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
  const me = JSON.parse(await getAs(fresh, '/api/me')).user;
  assert.equal(me.brand, 'mise'); assert.equal(me.role, 'manager'); assert.equal(me.store.name, 'Wrenfield');
  // the Mise demo's section list leaves out The Baldwin group's own; the shared schema isn't changed for anyone else
  assert.doesNotMatch(await getAs(fresh, '/api/collections'), /BRG Staples/);
  assert.match(JSON.stringify((await call('/api/collections')).data), /BRG Staples/);
});
