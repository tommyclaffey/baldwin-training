// Team Chat (Nov 11): who's in which room, what staff can and can't do, other stores kept out, Got It, unread counts,
// "message removed", Send to Team cards (pages; managers' person cards), @mentions, and the demo's conversation. Runs the real server on a temp database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-chat-'));
const PORT = 5400 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

function person() {
  let jar = '';
  return async (p, { method = 'GET', body, headers = {}, raw } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@chat.test', SUPERADMIN_EMAIL: '' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = person(), ana = person(), ben = person(), cal = person(), jo = person();
const ids = {};
const room = (who, key) => who(`/api/chat/room/${key}`);
const say = (who, key, body) => who(`/api/chat/room/${key}/messages`, { method: 'POST', body });

test('setup: an owner, a server and a bartender at The Baldwin, a server at J.Baldwin’s', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Olive Owner', email: 'owner@chat.test', password: 'long-enough-1' } })).status, 200);
  const team = (await owner('/api/team')).data;
  const code = team.company.joinCode;
  const stores = (await person()(`/api/join/${code}`)).data.stores;
  const jb = stores.find((s) => s.name === 'J.Baldwin’s' || s.name === "J.Baldwin's").id;
  for (const [who, name, pin, store, job] of [[ana, 'Ana Server', '1111', 1, 'server'], [ben, 'Ben Bar', '2222', 1, 'bartender'], [cal, 'Cal Host', '3333', 1, null], [jo, 'Jo Jbs', '4444', jb, 'server']]) {
    assert.equal((await who('/api/join', { method: 'POST', body: { code, name, pin, storeId: store } })).status, 200, name);
    if (job) assert.equal((await who('/api/path/jobs', { method: 'POST', body: { jobs: [job] } })).status, 200);
    ids[name] = (await who('/api/me')).data.user.id;
  }
  ids.owner = (await owner('/api/me')).data.user.id;
});

test('channels by job: a server sees Everyone and Front of House; a bartender also Bar; managers see all four', async () => {
  const keys = async (who) => (await who('/api/chat')).data.rooms.filter((r) => r.kind !== 'dm').map((r) => r.key);
  assert.deepEqual(await keys(ana), ['everyone', 'foh']);
  assert.deepEqual(await keys(ben), ['everyone', 'foh', 'bar']);
  assert.deepEqual(await keys(cal), ['everyone'], 'no job yet: only Everyone');
  assert.deepEqual(await keys(owner), ['everyone', 'foh', 'bar', 'kitchen']);
  assert.equal((await owner('/api/chat')).data.rooms[0].name, 'The Baldwin · Everyone');
  assert.equal((await room(ana, 'bar')).status, 404, 'a server can’t open Bar');
  assert.equal((await say(ana, 'bar', { body: 'hi' })).status, 404, 'or post in it');
  assert.equal((await room(ana, 'kitchen')).status, 404);
  const foh = (await room(owner, 'foh')).data.room;
  assert.deepEqual(foh.members.map((m) => m.name), ['Olive Owner', 'Ana Server', 'Ben Bar'], 'managers first; Cal has no job');
});

test('Everyone: managers start posts; staff reply and react but can’t start one or pin', async () => {
  assert.equal((await say(ana, 'everyone', { body: 'Hello all' })).status, 403);
  const post = await say(owner, 'everyone', { body: 'Staff meal at 3:45.' });
  assert.equal(post.status, 200);
  const id = post.data.id;
  const reply = await say(ana, 'everyone', { body: 'Thank you!', replyTo: id });
  assert.equal(reply.status, 200);
  assert.equal(reply.data.messages.at(-1).replyTo.id, id);
  assert.equal((await ana(`/api/chat/message/${id}/react`, { method: 'POST', body: { emoji: '👍' } })).data.messages.find((m) => m.id === id).reactions[0].count, 1);
  assert.equal((await ana(`/api/chat/message/${id}/react`, { method: 'POST', body: { emoji: '🍕' } })).status, 400, 'only the fixed set');
  const off = (await ana(`/api/chat/message/${id}/react`, { method: 'POST', body: { emoji: '👍' } })).data;
  assert.equal(off.messages.find((m) => m.id === id).reactions.length, 0, 'a second tap takes it back');
  assert.equal((await ana(`/api/chat/message/${id}/pin`, { method: 'POST' })).status, 403, 'staff can’t pin');
  assert.equal((await room(ana, 'everyone')).data.room.canStart, false);
  assert.equal((await room(owner, 'everyone')).data.room.canStart, true);
});

test('pinned pre-shift notes: Got It taps, and only managers see who', async () => {
  const note = (await say(owner, 'foh', { body: 'Focus dish: Short Rib.\n86 tonight: walleye.' })).data.id;
  const pinned = (await owner(`/api/chat/message/${note}/pin`, { method: 'POST' })).data;
  assert.equal(pinned.pins.length, 1);
  assert.match(pinned.pins[0].title, /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) pre-shift$/);
  assert.ok(!pinned.messages.some((m) => m.id === note), 'a pinned note sits in the pinned card, not the timeline');
  assert.equal((await ben(`/api/chat/message/${note}/pin`, { method: 'DELETE' })).status, 403);
  const tapped = (await ana(`/api/chat/message/${note}/got-it`, { method: 'POST' })).data.pins[0].gotIt;
  assert.equal(tapped.mine, true);
  assert.equal(tapped.people, undefined, 'staff don’t see the list');
  const g = (await room(owner, 'foh')).data.pins[0].gotIt;
  assert.deepEqual([g.count, g.total], [1, 2]);
  assert.deepEqual(g.people.map((p) => p.name), ['Ana Server']);
  assert.deepEqual(g.waiting.map((p) => p.name), ['Ben Bar']);
  assert.equal((await owner(`/api/chat/message/${note}/got-it`, { method: 'POST' })).status, 400, 'not on your own note');
  assert.equal((await ana(`/api/chat/message/${note}/got-it`, { method: 'DELETE' })).data.pins[0].gotIt.mine, false);
  await owner(`/api/chat/message/${note}/pin`, { method: 'DELETE' });
  assert.equal((await room(ana, 'foh')).data.pins.length, 0);
});

test('unread counts per conversation and in total; reading clears them; "seen by"', async () => {
  const before = (await ben('/api/chat/unread')).data.count;
  const m1 = (await say(ana, 'foh', { body: 'Out of lemons at the bar?' })).data.id;
  await say(ana, 'foh', { body: 'Never mind, found them.' });
  const list = (await ben('/api/chat')).data;
  assert.equal(list.rooms.find((r) => r.key === 'foh').unread >= 2, true);
  assert.equal((await ben('/api/chat/unread')).data.count, before + 2);
  assert.equal((await ana('/api/chat')).data.rooms.find((r) => r.key === 'foh').unread, 0, 'your own messages aren’t unread');
  const d = (await room(ben, 'foh')).data;
  const r = await ben('/api/chat/room/foh/read', { method: 'POST', body: { last: d.room.lastId } });
  assert.equal(r.status, 200);
  assert.equal((await ben('/api/chat')).data.rooms.find((x) => x.key === 'foh').unread, 0);
  const seen = (await room(ana, 'foh')).data.seen;
  assert.ok(seen.people.some((p) => p.first === 'Ben'), 'Ana sees Ben has seen it');
  assert.ok(m1 > 0);
  // polling: nothing new is a one-line answer
  const rev = (await room(ana, 'foh')).data.room.rev;
  assert.deepEqual((await ana(`/api/chat/room/foh?rev=${rev}`)).data, { same: true, rev });
});

test('direct messages: anyone in the store; nobody else can read them; another store can’t be reached', async () => {
  const dm = await say(ana, `dm-${ids['Cal Host']}`, { body: 'Can you cover my host shift?' });
  assert.equal(dm.status, 200);
  const calList = (await cal('/api/chat')).data;
  const toCal = calList.rooms.find((r) => r.key === `dm-${ids['Ana Server']}`);
  assert.equal(toCal.unread, 1);
  assert.equal(toCal.name, 'Ana Server');
  // a third person (even the owner) can't open it: there's no address for someone else's DM
  assert.equal((await owner(`/api/chat/message/${dm.data.id}/react`, { method: 'POST', body: { emoji: '👍' } })).status, 404);
  assert.equal((await owner(`/api/chat/message/${dm.data.id}`, { method: 'DELETE' })).status, 404);
  assert.ok(!(await owner('/api/chat/search?q=cover')).data.results.length, 'search only looks in your rooms');
  assert.equal((await ana('/api/chat/search?q=cover')).data.results.length, 1);
  // J.Baldwin's: its own Everyone, and The Baldwin's people and messages are out of reach
  const joList = (await jo('/api/chat')).data;
  assert.equal(joList.rooms[0].name.endsWith('· Everyone'), true);
  assert.ok(!joList.rooms[0].name.startsWith('The Baldwin'));
  assert.ok(!joList.people.some((p) => p.name === 'Ana Server'), 'other stores’ people are invisible');
  assert.equal((await say(jo, `dm-${ids['Ana Server']}`, { body: 'hi' })).status, 404);
  assert.equal((await say(ana, `dm-${ids['Jo Jbs']}`, { body: 'hi' })).status, 404);
  assert.equal((await jo(`/api/chat/message/${dm.data.id}/react`, { method: 'POST', body: { emoji: '👍' } })).status, 404);
  const jbFoh = (await room(jo, 'foh')).data;
  assert.ok(!jbFoh.messages.some((m) => /lemons/.test(m.body || '')), 'each store has its own Front of House');
});

test('removing: your own message, or a manager any in the store; it stays as "Message removed"', async () => {
  const mine = (await say(ben, 'bar', { body: 'Typo here' })).data.id;
  assert.equal((await ana(`/api/chat/message/${mine}`, { method: 'DELETE' })).status, 404, 'Ana isn’t in Bar');
  const other = (await say(ana, 'foh', { body: 'Something to remove' })).data.id;
  assert.equal((await ben(`/api/chat/message/${other}`, { method: 'DELETE' })).status, 403, 'not someone else’s');
  const gone = (await ben(`/api/chat/message/${mine}`, { method: 'DELETE' })).data;
  const m = gone.messages.find((x) => x.id === mine);
  assert.equal(m.removed, true); assert.equal(m.body, undefined);
  const byOwner = (await owner(`/api/chat/message/${other}`, { method: 'DELETE' })).data.messages.find((x) => x.id === other);
  assert.equal(byOwner.removed, true);
});

test('pages and photos: a page must be in the book; photos must be ones the chat saved', async () => {
  const card = await say(ana, 'foh', { body: 'Read this', page: 'classic/old-fashioned' });
  assert.equal(card.status, 200);
  const pg = card.data.messages.at(-1).page;
  assert.equal(pg.title, 'Old Fashioned'); assert.match(pg.kicker, /^The Book · /);
  assert.equal(card.data.shared[0].slug, 'classic/old-fashioned');
  assert.equal((await say(ana, 'foh', { page: 'nope/not-a-page' })).status, 400);
  assert.equal((await say(ana, 'foh', { photo: '/img/logo-white.png' })).status, 400, 'only chat uploads');
  assert.equal((await say(ana, 'foh', {})).status, 400, 'empty');
  // a real photo: a tiny PNG goes in, a JPEG under /media/chat-… comes out, and it can be sent
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await ana('/api/chat/photo', { method: 'POST', raw: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(up.status, 200);
  assert.match(up.data.url, /^\/media\/chat-[a-z0-9]+-[a-f0-9]{18}\.jpg$/);
  assert.equal((await say(ana, 'foh', { photo: up.data.url })).status, 200);
  assert.equal((await ana('/api/chat/photo', { method: 'POST', raw: 'hello', headers: { 'Content-Type': 'text/plain' } })).status, 415);
});

test('Send to Team: a page card says what it is; the server checks the page is in this store’s book', async () => {
  const c = await ana('/api/chat/card?page=classic/old-fashioned');
  assert.equal(c.status, 200);
  assert.equal(c.data.type, 'page');
  assert.equal(c.data.card.kind, 'Classic cocktail');
  assert.equal(c.data.card.title, 'Old Fashioned');
  assert.equal((await ana('/api/chat/card?page=nope/not-a-page')).status, 404);
  const sent = await say(ana, 'foh', { page: 'classic/old-fashioned' });
  assert.equal(sent.status, 200, 'a card on its own, no words, is a message');
  assert.equal(sent.data.messages.at(-1).page.kind, 'Classic cocktail');
  assert.equal((await say(ana, 'foh', { page: 'classic/old-fashioned', person: ids['Ben Bar'] })).status, 403, 'staff never send a person card');
  // another store's own page isn't in J.Baldwin's book: no card, no message
  const mine = (await owner('/api/index')).data.find((e) => e.section === 'Recipe');
  assert.ok(mine && !(await jo('/api/index')).data.some((e) => e.slug === mine.slug), 'The Baldwin has a dish J.Baldwin’s doesn’t');
  assert.equal((await jo('/api/chat/card?page=' + encodeURIComponent(mine.slug))).status, 404);
  assert.equal((await say(jo, 'foh', { page: mine.slug })).status, 400);
  // and the panel's list (the same /api/chat) holds only Jo's own store
  const jl = (await jo('/api/chat')).data;
  assert.equal(jl.store.startsWith('J'), true);
  assert.ok(!jl.people.some((p) => ['Ana Server', 'Ben Bar', 'Cal Host'].includes(p.name)));
});

test('person cards: managers only, only into a direct message with another manager, only this store’s team', async () => {
  const inv = await owner('/api/team/invite', { method: 'POST', body: { email: 'mo@chat.test', role: 'manager', storeId: 1 } });
  assert.equal(inv.status, 200);
  const mo = person();
  assert.equal((await mo(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Mo Manager', password: 'long-enough-7' } })).status, 200);
  ids['Mo Manager'] = (await mo('/api/me')).data.user.id;

  const card = await owner(`/api/chat/card?person=${ids['Ana Server']}`);
  assert.equal(card.status, 200);
  assert.equal(card.data.card.name, 'Ana Server');
  assert.equal(card.data.card.job, 'Server');
  assert.ok(['behind', 'new', 'on-track', 'done', 'no-job'].includes(card.data.card.status));
  assert.equal((await ana(`/api/chat/card?person=${ids['Ben Bar']}`)).status, 403, 'staff can’t look anyone up');
  assert.equal((await owner(`/api/chat/card?person=${ids['Jo Jbs']}`)).status, 404, 'another store’s person');
  assert.equal((await owner(`/api/chat/card?person=${ids['Mo Manager']}`)).status, 404, 'a manager isn’t on the team list');

  assert.equal((await room(owner, 'dm-' + ids['Mo Manager'])).data.room.canSendPerson, true);
  assert.equal((await room(owner, 'foh')).data.room.canSendPerson, false);
  const sent = await say(owner, 'dm-' + ids['Mo Manager'], { body: 'Ana is flying through it.', person: ids['Ana Server'] });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.messages.at(-1).person.name, 'Ana Server');
  const seen = (await room(mo, 'dm-' + ids.owner)).data.messages.at(-1);
  assert.equal(seen.person.name, 'Ana Server', 'the other manager sees the card');
  assert.match((await mo('/api/chat')).data.rooms.find((r) => r.key === 'dm-' + ids.owner).last.text, /Ana Server|flying/);

  assert.equal((await say(owner, 'foh', { person: ids['Ana Server'] })).status, 403, 'not into a channel the subject is in');
  assert.equal((await say(owner, 'kitchen', { person: ids['Ana Server'] })).status, 403, 'not into a channel at all');
  assert.equal((await say(owner, 'dm-' + ids['Ben Bar'], { person: ids['Ana Server'] })).status, 403, 'not to staff');
  assert.equal((await say(ana, 'dm-' + ids.owner, { person: ids['Ben Bar'] })).status, 403, 'staff can’t send one');
  assert.equal((await say(owner, 'dm-' + ids['Mo Manager'], { person: ids['Jo Jbs'] })).status, 404, 'only this store’s team');
});

test('@mentions: only the conversation’s members, stored as ids; a mention of you is flagged and counts as unread', async () => {
  const before = (await ana('/api/chat')).data.rooms.find((r) => r.key === 'foh');
  const sent = await say(owner, 'foh', { body: `Great tables tonight <@${ids['Ana Server']}>.` });
  assert.equal(sent.status, 200);
  const m = sent.data.messages.at(-1);
  assert.equal(m.body, `Great tables tonight <@${ids['Ana Server']}>.`, 'the body keeps the id, not the name');
  assert.deepEqual(m.mentions, [{ id: ids['Ana Server'], name: 'Ana Server' }]);
  assert.equal(m.mentionsMe, false);
  const list = (await ana('/api/chat')).data.rooms.find((r) => r.key === 'foh');
  assert.equal(list.unread, before.unread + 1);
  assert.equal(list.mentions, 1);
  assert.equal(list.last.text, 'Great tables tonight @Ana Server.', 'previews show the name');
  const mine = (await room(ana, 'foh')).data;
  assert.equal(mine.messages.at(-1).mentionsMe, true);
  await ana('/api/chat/room/foh/read', { method: 'POST', body: { last: mine.room.lastId } });
  assert.equal((await ana('/api/chat')).data.rooms.find((r) => r.key === 'foh').mentions, 0, 'reading clears it');

  assert.equal((await say(owner, 'foh', { body: `<@${ids['Cal Host']}> can you help?` })).status, 400, 'Cal has no job, so isn’t in Front of House');
  assert.equal((await say(owner, 'foh', { body: `<@${ids['Jo Jbs']}> hi` })).status, 400, 'another store');
  assert.equal((await say(ana, 'dm-' + ids['Ben Bar'], { body: `<@${ids.owner}> look` })).status, 400, 'a DM is its two people');
  assert.equal((await say(ana, 'dm-' + ids['Ben Bar'], { body: `<@${ids['Ben Bar']}> look` })).status, 200);
  assert.equal((await say(owner, 'everyone', { body: `<@${ids['Cal Host']}> welcome!` })).status, 200, 'everyone is in Everyone');
});

test('the demo opens on the design’s conversation, with uploads off; its chat goes when the demo does', async () => {
  const mgr = person();
  await mgr('/api/demo/start', { method: 'POST', body: { role: 'manager' } });
  const list = (await mgr('/api/chat')).data;
  const by = Object.fromEntries(list.rooms.map((r) => [r.kind === 'dm' ? r.name : r.key, r.unread]));
  assert.deepEqual([by.everyone, by.foh, by.bar, by.kitchen, by['Teddy Lam'], by['Odalys Ruiz'], by['Quinn Abbott'], by['Hollis Grant']], [2, 0, 3, 0, 1, 1, 0, 0]);
  assert.equal((await mgr('/api/chat/unread')).data.count, 7, 'Team Chat 7, as in the design');
  const foh = (await room(mgr, 'foh')).data;
  assert.equal(foh.pins[0].user.name, 'Rosalind Hart');
  assert.match(foh.pins[0].body, /^Focus dish: /);
  assert.equal(foh.pins[0].gotIt.count, 5);
  assert.ok(foh.messages.some((m) => m.photo && m.user.name === 'Rosalind Hart'), 'the plate photo');
  assert.ok(foh.messages.some((m) => m.page?.title === 'Paloma Verde' && m.page.kind === 'House cocktail' && m.user.name === 'Dorian Pike'), 'the spec card');
  assert.ok(foh.messages.some((m) => m.user.name === 'Rosalind Hart' && m.mentions?.[0]?.name === 'Marisol Vega'), 'a message with an @mention');
  assert.equal(list.rooms.find((r) => r.key === 'bar').mentions, 1, 'Quinn’s @Rosalind in Bar is unread');
  assert.ok(foh.messages.some((m) => m.user.name === 'Teddy Lam' && /Friday close/.test(m.body)));
  assert.equal(foh.messages.at(-1).user.name, 'Marisol Vega');
  assert.equal(foh.seen.people.slice(0, 3).map((p) => p.first).join(', '), 'Quinn, Odalys, Wynn');
  assert.equal(foh.room.members.length, 9, 'the seven on the team, Rosalind and the owner');
  const dm = (await room(mgr, 'dm-' + list.rooms.find((r) => r.name === 'Gideon Ambrose').other.id)).data;
  assert.equal(dm.messages.find((m) => m.person)?.person.name, 'Hollis Grant', 'a progress card between the two managers');
  assert.equal((await mgr('/api/chat/photo', { method: 'POST', raw: 'x', headers: { 'Content-Type': 'image/png' } })).status, 403, 'uploads are off in the demo');
  // the employee's copy: Rosalind is there too (her note, her DMs), and Marisol hasn't tapped Got It yet
  const emp = person();
  await emp('/api/demo/start', { method: 'POST', body: { role: 'employee' } });
  const e = (await room(emp, 'foh')).data;
  assert.equal(e.pins[0].gotIt.canTap, true); assert.equal(e.pins[0].gotIt.mine, false);
  assert.ok(e.messages.some((m) => m.mentionsMe && m.user.name === 'Rosalind Hart'), 'Marisol sees Rosalind’s @mention of her');
  assert.ok((await emp('/api/chat')).data.rooms.some((r) => r.name === 'Rosalind Hart'));
  // a refresh swaps the copy: the old copy's chat is gone with it
  const oldId = foh.messages[0].id;
  await mgr('/api/demo/restart', { method: 'POST' });
  const fresh = (await room(mgr, 'foh')).data;
  assert.ok(!fresh.messages.some((m) => m.id === oldId), 'new copy, new messages');
});

test('the demo’s chat rows are removed with the demo copy (dropDemo)', async () => {
  process.env.DATA_DIR = dir; // before the server modules load, so nothing lands in the repo
  const { openDb } = await import('../server/db.mjs');
  const { startDemo, dropDemo, migrateDemo } = await import('../server/demo.mjs');
  const db = openDb(path.join(dir, 'direct.db'));
  migrateDemo(db);
  const { seed } = await import('../server/cms.mjs');
  seed(db);
  startDemo(db, 'manager');
  const co = db.prepare('SELECT id FROM companies WHERE demo = 1').get().id;
  const count = () => ['chat_rooms', 'chat_messages', 'chat_reactions', 'chat_reads', 'chat_gotit'].map((t) => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE company_id = ?`).get(co).n);
  assert.ok(count().every((n) => n > 0), 'seeded: rooms, messages, reactions, reads and Got It taps');
  dropDemo(db, co);
  assert.deepEqual(count(), [0, 0, 0, 0, 0]);
  db.close();
});
