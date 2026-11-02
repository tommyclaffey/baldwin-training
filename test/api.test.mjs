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
  assert.equal(cols.counts.classic, 58);
  assert.equal(cols.counts.house, 17, 'every cocktail on our menu');
  assert.equal(cols.counts.shelf, 92, "Mionetto moved to the wine list");
  assert.equal(cols.counts.beer, 15);
  assert.equal(cols.counts.recipe, 35, 'the Food Book’s 35 dishes');
  const index = (await call('/api/index')).data;
  // each Study Guide chapter: its whole-chapter page plus one lesson per section (Nov 1)
  const manual = fs.readdirSync(path.join(root, 'content/manual')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(root, 'content/manual', f), 'utf8')));
  assert.equal(index.length, 631 + manual.reduce((a, c) => a + 1 + c.sections.length, 0), 'the design (incl. 133 wine countries, regions and states), plus 15 menu cocktails, the Lemon Drop, 106 wine pages, a page for every dish and 92 bottle pages');
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

test('every dish shows in the Food Matrix and opens its own page; empty sections stay off', async () => {
  const r = await call('/api/entries', { method: 'POST', body: { collection: 'recipe', data: { name: 'Test Plate', course: 'Mains', price: '30', allergens: ['Dairy'], pairing: 'Altocedro Malbec', cocktail: 'Paper Plane' } } });
  assert.equal(r.status, 200);
  const matrix = (await call('/api/page/13-2')).data;
  const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };
  const row = all(matrix.main, (n) => n.n === 'Row · Test Plate')[0];
  assert.equal(row.to, '/recipe/test-plate', 'the card opens the dish');
  const page = (await call(`/api/page/e${r.data.id}`)).data;
  const names = new Set(all(page.main, () => true).map((n) => n.n));
  assert.ok(!names.has('The Build') && !names.has('Plating guide') && !names.has('Section · Photos'), 'nothing to show, no section');
  assert.ok(!names.has('Watch it made'), 'no video, no video section');
  assert.ok(names.has('Tag · $30'), 'the price shows');
  assert.equal(all(page.main, (n) => n.n === 'Pairing · Cocktail')[0].to, '/classic/paper-plane', 'the cocktail links to its page');
  assert.ok(!names.has('Pairing · Opposite'), 'no opposite wine, no row');
  const video = { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', title: 'Test' };
  await call(`/api/entries/${r.data.id}`, { method: 'PUT', body: { data: { ...r.data.data, video } } });
  assert.ok(!JSON.stringify((await call(`/api/page/e${r.data.id}`)).data).includes('"Watch it made"'), 'a video alone isn’t enough: Add a video is off');
  await call(`/api/entries/${r.data.id}`, { method: 'PUT', body: { data: { ...r.data.data, video, hasVideo: true } } });
  assert.ok(JSON.stringify((await call(`/api/page/e${r.data.id}`)).data).includes('"Watch it made"'), 'Add a video on: the section shows');
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
  assert.ok(cat.topics.some((t) => t.key === 'course:Mains') && cat.topics.some((t) => t.key === 'house'), 'topics come from the menu');
  assert.ok(cat.quizzes.some((q) => q.id === 't:course:Mains'), 'a built-in quiz per course');
  // A built-in quiz: every answer right.
  const q = (await sam('/api/quiz/start', { method: 'POST', body: { quiz: 't:course:Mains' } })).data;
  assert.equal(q.items.length, 10);
  const right = q.items.map((ref) => q.questions[ref].answer);
  const r = await sam('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: q.items, answers: right } });
  assert.deepEqual(r.data, { score: 10, total: 10, passed: true });
  // A question from another topic is refused; no account, no score.
  const other = (await sam('/api/quiz/start', { method: 'POST', body: { quiz: 't:house' } })).data;
  assert.equal((await sam('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: [other.items[0]], answers: [0] } })).status, 400);
  assert.equal((await call('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: q.items, answers: right }, auth: false })).status, 401);
  // A custom mix.
  const c = (await sam('/api/quiz/start', { method: 'POST', body: { topics: ['house', 'wine-glass'], count: 5 } })).data;
  assert.equal(c.id, 'c:house+wine-glass:5');
  assert.equal(c.items.length, 5);
  assert.equal((await sam('/api/quiz/attempt', { method: 'POST', body: { quiz: c.id, items: c.items, answers: c.items.map((ref) => c.questions[ref].answer) } })).data.score, 5);
  // Staff can't save a team quiz; a manager can, and it joins the list.
  assert.equal((await sam('/api/quiz/sets', { method: 'POST', body: { name: 'X', topics: ['house'], count: 5 } })).status, 403);
  const set = (await call('/api/quiz/sets', { method: 'POST', body: { name: 'Bar week 2', topics: ['house', 'classic'], count: 10 } })).data;
  assert.ok((await sam('/api/quiz/catalog')).data.quizzes.some((x) => x.id === set.id && x.title === 'Bar week 2'));
  // Results and sign-off.
  assert.equal((await sam('/api/quiz/results')).status, 403, 'staff can’t see everyone’s scores');
  const me = (await call('/api/quiz/results')).data.people.find((p) => p.name === 'Sam Server');
  assert.equal(me.quizzes['t:course:Mains'].best, 10);
  assert.equal((await call('/api/quiz/signoff', { method: 'POST', body: { device: me.device, quiz: 't:course:Mains' } })).status, 200);
  assert.equal((await call('/api/quiz/signoff', { method: 'POST', body: { device: me.device, quiz: c.id } })).status, 400, 'custom quizzes are practice, not sign-offs');
  const mine = (await sam('/api/quiz/mine')).data;
  assert.equal(mine.signoffs[0].quiz, 't:course:Mains');
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
  const q = (await kit('/api/quiz/start', { method: 'POST', body: { quiz: 't:house' } })).data;
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
  assert.ok(opts.some((o) => o.meta.k === 'course:Mains'), 'courses come from the dishes');
  assert.ok(all(fm.main, (n) => n.meta?.show?.req?.includes('course:Mains')).length >= 10, 'main rows know their course');
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
  assert.ok(fm.includes('"to":"/admin/pages/recipe/new?course=Salads"') && fm.includes('Add a Dish to Salads'));
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
  assert.ok(l2.includes('"youtubeId":"XFiWNb9GMNE"') && l2.includes('c6f9912b50984cdf8aaf65b76099975a'));
  assert.ok((await page('sommelier-program/level-1/exam-details')).includes('42 of 70'), 'the old Level 1 page is still there');
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
  assert.equal(q.items.length, 30);
  const ref = q.items[0];
  assert.equal(q.questions[ref].options.length, 4);
  await call('/api/quiz/mark', { method: 'POST', body: { ref, mark: 'green' } });
  const guide = await page('sommelier-program/study-guide');
  assert.ok(guide.includes('1 of 12') || guide.includes('"1"'), 'progress shows');
  assert.ok(guide.includes('/sommelier-program/study-guide/france'));
});
