// Team Chat v2 (Nov 13, Figma 09 · Proposals → 27b): reactions (one tap, service words, members only), threads (and
// unread that never counts a reply twice), Mark Unread, mute, "typing…" that lapses, Home's summary (mentions, then
// pre-shift notes, then DMs), the toast's newest item, other stores kept out, and migration 21 on a database that already
// has chat in it. Runs the real server on a temp database, like test/chat.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-chat2-'));
const PORT = 5700 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
process.env.DATA_DIR = dir; // before any server module loads in this process (the migration test opens a database here)

function person() {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@chat2.test', SUPERADMIN_EMAIL: '' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = person(), ana = person(), ben = person(), cal = person(), jo = person();
const ids = {};
const room = (who, key) => who(`/api/chat/room/${key}`);
const say = (who, key, body) => who(`/api/chat/room/${key}/messages`, { method: 'POST', body });
const unreadOf = async (who, key) => (await who('/api/chat')).data.rooms.find((r) => r.key === key)?.unread;
const readUp = async (who, key) => { const d = (await room(who, key)).data; await who(`/api/chat/room/${key}/read`, { method: 'POST', body: { last: d.room.lastId } }); };

test('setup: an owner, a server and a bartender at The Baldwin, a host with no job, a server at J.Baldwin’s', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Olive Owner', email: 'owner@chat2.test', password: 'long-enough-1' } })).status, 200);
  const team = (await owner('/api/team')).data;
  const code = team.company.joinCode;
  const stores = (await person()(`/api/join/${code}`)).data.stores;
  const jb = stores.find((s) => s.name !== 'The Baldwin').id;
  for (const [who, name, pin, store, job] of [[ana, 'Ana Server', '1111', 1, 'server'], [ben, 'Ben Bar', '2222', 1, 'bartender'], [cal, 'Cal Host', '3333', 1, null], [jo, 'Jo Jbs', '4444', jb, 'server']]) {
    assert.equal((await who('/api/join', { method: 'POST', body: { code, name, pin, storeId: store } })).status, 200, name);
    if (job) assert.equal((await who('/api/path/jobs', { method: 'POST', body: { jobs: [job] } })).status, 200);
    ids[name] = (await who('/api/me')).data.user.id;
  }
  ids.owner = (await owner('/api/me')).data.user.id;
});

test('the reaction list in the app (src/chat/reactions.ts) is the list the server accepts', async () => {
  const app = await import('../src/chat/reactions.ts');
  const srv = await import('../server/chat.mjs');
  assert.deepEqual([...srv.REACTIONS].sort(), app.ALL.map((r) => r.key).sort());
  assert.deepEqual(srv.QUICK, app.QUICK);
  assert.deepEqual(srv.SERVICE_WORDS, app.SERVICE.map((r) => r.key));
  assert.equal(app.chipLabel('👍', 4, true), '👍 4, you reacted');
  assert.equal(app.chipLabel('Heard', 2, false), 'Heard 2');
  assert.deepEqual(app.findReactions('86').map((r) => r.key), ['86’d']);
});

test('reactions: one tap adds, a second takes it back; service words count; per person; members only; the set only', async () => {
  const id = (await say(owner, 'foh', { body: 'Lineup at 4:15.' })).data.id;
  const react = (who, emoji) => who(`/api/chat/message/${id}/react`, { method: 'POST', body: { emoji } });
  for (const who of [ana, ben]) assert.equal((await react(who, '👍')).status, 200);
  let r = (await react(ana, 'Heard')).data.messages.find((m) => m.id === id).reactions;
  assert.deepEqual(r.map((x) => [x.emoji, x.count, x.mine, !!x.word]), [['👍', 2, true, false], ['Heard', 1, true, true]]);
  r = (await react(ben, '86’d')).data.messages.find((m) => m.id === id).reactions;
  assert.deepEqual(r.find((x) => x.emoji === '86’d').names, ['Ben']);
  r = (await react(ana, '👍')).data.messages.find((m) => m.id === id).reactions;
  assert.equal(r.find((x) => x.emoji === '👍').count, 1, 'a second tap takes yours back, not Ben’s');
  assert.equal(r.find((x) => x.emoji === '👍').mine, false);
  assert.equal((await react(ana, 'Yes Chef')).status, 200);
  assert.equal((await react(ana, '🍕')).status, 400, 'only the set');
  assert.equal((await react(ana, 'Heard!')).status, 400);
  assert.equal((await react(cal, '👍')).status, 404, 'Cal (no job) isn’t in #front-of-house, so the message isn’t there for him');
  assert.equal((await react(jo, '👍')).status, 404, 'another store');
  // stored per person, with its kind
  const db = new DatabaseSync(path.join(dir, 'baldwin.db'));
  assert.deepEqual(db.prepare('SELECT emoji, kind FROM chat_reactions WHERE message_id = ? AND user_id = ? ORDER BY emoji').all(id, ids['Ana Server']).map((x) => [x.emoji, x.kind]), [['Heard', 'word'], ['Yes Chef', 'word']]);
  db.close();
});

test('threads: replies hang off a message, the channel shows "N replies", a reply can go to the channel too', async () => {
  const parent = (await say(owner, 'foh', { body: 'Paloma spec changed.' })).data.id;
  const t1 = await ana(`/api/chat/message/${parent}/thread`, { method: 'POST', body: { body: 'Salt rim still?' } });
  assert.equal(t1.status, 200);
  assert.equal(t1.data.parent.id, parent);
  assert.deepEqual(t1.data.replies.map((m) => m.body), ['Salt rim still?']);
  await owner(`/api/chat/message/${parent}/thread`, { method: 'POST', body: { body: 'Half rim.' } });
  // a reply's id works for the thread too (it opens its parent's thread)
  const viaReply = (await ben(`/api/chat/message/${t1.data.id}/thread`)).data;
  assert.equal(viaReply.parent.id, parent);
  assert.equal(viaReply.replies.length, 2);
  // the channel: the parent with its count, not the replies
  let foh = (await room(ben, 'foh')).data;
  const p = foh.messages.find((m) => m.id === parent);
  assert.equal(p.thread.count, 2);
  assert.equal(p.thread.last.name, 'Olive Owner');
  assert.ok(!foh.messages.some((m) => m.body === 'Salt rim still?'), 'thread replies stay in the thread');
  // also to the channel: shown once, in the channel, saying which thread it answers
  const also = (await ben(`/api/chat/message/${parent}/thread`, { method: 'POST', body: { body: 'Made two. Tastes right.', alsoChannel: true } })).data;
  foh = (await room(ana, 'foh')).data;
  const copy = foh.messages.find((m) => m.id === also.id);
  assert.equal(copy.inThread.id, parent);
  assert.equal(foh.messages.find((m) => m.id === parent).thread.count, 3);
  // staff can reply in a thread in #everyone (it's a reply), though they can't start a post there
  const ev = (await say(owner, 'everyone', { body: 'Schedule is up.' })).data.id;
  assert.equal((await say(ana, 'everyone', { body: 'Hi all' })).status, 403);
  assert.equal((await ana(`/api/chat/message/${ev}/thread`, { method: 'POST', body: { body: 'Thanks!' } })).status, 200);
  // a reply in a thread from someone outside the room: not found
  assert.equal((await jo(`/api/chat/message/${parent}/thread`)).status, 404);
  assert.equal((await cal(`/api/chat/message/${parent}/thread`, { method: 'POST', body: { body: 'hi' } })).status, 404);
});

test('unread never counts a thread reply twice; thread-only replies count for the thread’s people and @mentions only', async () => {
  for (const who of [owner, ana, ben]) await readUp(who, 'foh');
  const parent = (await say(owner, 'foh', { body: 'Who can stay late Saturday?' })).data.id;
  assert.equal(await unreadOf(ana, 'foh'), 1);
  await readUp(ana, 'foh'); await readUp(ben, 'foh');
  // Ana replies in the thread; the owner (who started it) sees 1; Ben (not in it) sees nothing new
  await ana(`/api/chat/message/${parent}/thread`, { method: 'POST', body: { body: 'I can.' } });
  assert.equal(await unreadOf(owner, 'foh'), 1, 'the thread’s starter');
  assert.equal(await unreadOf(ben, 'foh'), 0, 'not in the thread');
  // a thread reply also sent to the channel: one row, counted once for everyone
  await ana(`/api/chat/message/${parent}/thread`, { method: 'POST', body: { body: 'Until close.', alsoChannel: true } });
  assert.equal(await unreadOf(owner, 'foh'), 2, 'the starter: 2 replies, each once');
  assert.equal(await unreadOf(ben, 'foh'), 1, 'Ben: just the one sent to the channel');
  // a thread-only reply that @mentions Ben counts for him, once (as a mention too)
  await owner(`/api/chat/message/${parent}/thread`, { method: 'POST', body: { body: `<@${ids['Ben Bar']}> you too?` } });
  const l = (await ben('/api/chat')).data.rooms.find((r) => r.key === 'foh');
  assert.equal(l.unread, 2); assert.equal(l.mentions, 1);
});

test('Mark Unread: from that message on counts again (yours aside), and the sidebar number follows', async () => {
  await readUp(ana, 'foh');
  const a = (await say(owner, 'foh', { body: 'One' })).data.id;
  await say(ben, 'foh', { body: 'Two' });
  await say(ana, 'foh', { body: 'Three (mine)' });
  await readUp(ana, 'foh');
  assert.equal(await unreadOf(ana, 'foh'), 0);
  const r = await ana(`/api/chat/message/${a}/unread`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(await unreadOf(ana, 'foh'), 2, 'One and Two; her own Three doesn’t count');
  assert.equal(r.data.count, (await ana('/api/chat/unread')).data.count);
  assert.equal((await jo(`/api/chat/message/${a}/unread`, { method: 'POST' })).status, 404, 'another store');
});

test('mute: a muted room’s unread leaves Team Chat’s number, but an @mention still counts', async () => {
  await readUp(ben, 'bar');
  const before = (await ben('/api/chat/unread')).data.count;
  assert.equal((await ben('/api/chat/room/bar/mute', { method: 'POST' })).data.muted, true);
  await say(owner, 'bar', { body: 'Ice delivery at 3.' });
  assert.equal((await ben('/api/chat')).data.rooms.find((r) => r.key === 'bar').unread, 1, 'the list still shows it');
  assert.equal((await ben('/api/chat/unread')).data.count, before, 'but the number doesn’t move');
  await say(owner, 'bar', { body: `<@${ids['Ben Bar']}> sign for it?` });
  const u = (await ben('/api/chat/unread')).data;
  assert.equal(u.count, before + 1, 'a mention of you counts');
  assert.equal(u.mentions >= 1, true);
  assert.equal((await room(ben, 'bar')).data.room.muted, true);
  await ben('/api/chat/room/bar/mute', { method: 'DELETE' });
  assert.equal((await ben('/api/chat/unread')).data.count, before + 2);
});

test('typing: a ping shows to others in the room for 5 seconds, never to yourself, and sending clears it', async () => {
  const chat = await import('../server/chat.mjs');
  const members = [{ id: 1, name: 'Rosa Hart', manager: true, jobs: [] }, { id: 2, name: 'Dee Pike', manager: false, jobs: ['bartender'] }, { id: 3, name: 'Hal Grant', manager: false, jobs: ['host'] }];
  const as = (id) => ({ me: members.find((m) => m.id === id), members });
  const bar = { id: 9001, kind: 'channel', key: 'bar' };
  const t0 = 1_000_000;
  chat.setTyping(as(2), bar, true, t0);
  assert.deepEqual(chat.typingIn(as(1), bar, t0 + 1000), ['Dee']);
  assert.deepEqual(chat.typingIn(as(2), bar, t0 + 1000), [], 'not to yourself');
  assert.deepEqual(chat.typingIn(as(1), bar, t0 + chat.TYPING_MS + 1), [], 'gone after 5 s');
  chat.setTyping(as(2), bar, true, t0); chat.setTyping(as(2), bar, false, t0);
  assert.deepEqual(chat.typingIn(as(1), bar, t0 + 10), [], 'cleared');
  // over HTTP: Ben types in #bar, the owner sees it on the next poll (even a "nothing new" one)
  assert.equal((await ben('/api/chat/room/bar/typing', { method: 'POST' })).status, 200);
  const d = (await room(owner, 'bar')).data;
  assert.deepEqual(d.typing, ['Ben']);
  assert.deepEqual((await owner(`/api/chat/room/bar?rev=${d.room.rev}`)).data.typing, ['Ben']);
  await say(ben, 'bar', { body: 'Done.' });
  assert.deepEqual((await room(owner, 'bar')).data.typing, [], 'sending clears it');
});

test('Home summary: mentions first, then pre-shift notes not yet Got It, then DMs; Got It and Mark All Read clear them', async () => {
  const emp = person();
  await emp('/api/demo/start', { method: 'POST', body: { role: 'employee' } });
  let s = (await emp('/api/chat/summary')).data;
  assert.deepEqual(s.items.map((i) => i.type), ['mention', 'preshift', 'dm']);
  assert.equal(s.items[0].user.name, 'Rosalind Hart');
  assert.equal(s.items[0].roomName, 'front-of-house');
  assert.match(s.items[1].body, /^Focus dish: /);
  assert.equal(s.items[2].user.name, 'Teddy Lam');
  assert.deepEqual(s.channels.map((c) => [c.name, c.unread]), [['front-of-house', 3]], '3 new in #front-of-house');
  assert.equal(s.dms, 1, 'plus 1 direct message');
  assert.equal(s.mentions, 1);
  const u = (await emp('/api/chat/unread')).data;
  assert.equal(u.count, 4); assert.equal(u.mentions, 1);
  assert.equal(u.latest.type, 'dm', 'the toast: the newest of them (Teddy’s DM)');
  // Got It from Home
  assert.equal((await emp(`/api/chat/message/${s.items[1].id}/got-it`, { method: 'POST' })).status, 200);
  s = (await emp('/api/chat/summary')).data;
  assert.deepEqual(s.items.map((i) => i.type), ['mention', 'dm']);
  // Mark All Read
  const r = (await emp('/api/chat/read-all', { method: 'POST' })).data;
  assert.deepEqual([r.count, r.mentions], [0, 0]);
  s = (await emp('/api/chat/summary')).data;
  assert.deepEqual([s.items.length, s.count, s.channels.length, s.dms], [0, 0, 0, 0]);
  assert.equal((await emp('/api/chat/unread')).data.latest, null);
  // the manager's: Quinn's @Rosalind first, then the DMs (Rosalind wrote the pre-shift note, so nothing to tap)
  const mgr = person();
  await mgr('/api/demo/start', { method: 'POST', body: { role: 'manager' } });
  const m = (await mgr('/api/chat/summary')).data;
  assert.deepEqual(m.items.map((i) => i.type), ['mention', 'dm', 'dm']);
  assert.equal(m.items[0].roomName, 'bar');
  assert.ok(!m.channels.some((c) => c.key === 'kitchen'), 'muted #kitchen isn’t in the count');
  // the demo is full: a thread with replies, service-word reactions, people on now
  const foh = (await room(mgr, 'foh')).data;
  const spec = foh.messages.find((x) => x.thread);
  assert.equal(spec.thread.count, 3);
  assert.ok(foh.messages.some((x) => x.reactions.some((z) => z.word)), 'service words');
  assert.deepEqual(foh.room.members.filter((x) => x.online).map((x) => x.name).sort(), ['Dorian Pike', 'Gideon Ambrose', 'Marisol Vega', 'Rosalind Hart', 'Teddy Lam']);
});

test('the rail: Mentions and Pinned list only this person’s rooms; other stores see none of it', async () => {
  const mentions = (await ben('/api/chat/mentions')).data.results;
  assert.ok(mentions.length >= 2);
  assert.ok(mentions.every((m) => m.user.name === 'Olive Owner'));
  const fohId = (await say(owner, 'foh', { body: 'Pre-shift: focus dish is the chop.' })).data.id;
  await owner(`/api/chat/message/${fohId}/pin`, { method: 'POST' });
  const pins = (await ana('/api/chat/pinned')).data.results;
  assert.ok(pins.some((p) => p.id === fohId && p.gotIt.canTap && !p.gotIt.mine));
  assert.ok(!(await cal('/api/chat/pinned')).data.results.some((p) => p.id === fohId), 'Cal isn’t in #front-of-house');
  // J.Baldwin's: nothing from The Baldwin anywhere
  assert.deepEqual((await jo('/api/chat/mentions')).data.results, []);
  assert.ok(!(await jo('/api/chat/pinned')).data.results.some((p) => p.id === fohId));
  const js = (await jo('/api/chat/summary')).data;
  assert.ok(!js.items.some((i) => i.user?.name === 'Olive Owner'));
  assert.equal((await jo('/api/chat/room/foh/mute', { method: 'POST' })).status, 200, 'its own #front-of-house');
  assert.equal((await jo(`/api/chat/message/${fohId}/react`, { method: 'POST', body: { emoji: 'Heard' } })).status, 404);
});

test('migration 21 runs on a database that already has migrations 1–20 and chat in it', async () => {
  const { MIGRATIONS, openDb } = await import('../server/db.mjs');
  assert.equal(MIGRATIONS.length, 21);
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  for (let v = 0; v < 20; v++) { old.exec('BEGIN'); old.exec(MIGRATIONS[v]); old.exec(`PRAGMA user_version = ${v + 1}`); old.exec('COMMIT'); }
  old.exec("INSERT INTO companies(id, name, slug, created_at) VALUES (7, 'Old Co', 'old-co', '2026-11-01') ON CONFLICT DO NOTHING");
  old.prepare('INSERT INTO chat_rooms(id, company_id, store_id, key, kind, created_at) VALUES (1, 7, 1, ?, ?, ?)').run('foh', 'channel', '2026-11-11');
  old.prepare('INSERT INTO chat_messages(id, room_id, company_id, store_id, user_id, body, created_at, mentions) VALUES (1, 1, 7, 1, 1, ?, ?, ?)').run('Hello', '2026-11-11', null);
  old.prepare('INSERT INTO chat_messages(id, room_id, company_id, store_id, user_id, body, created_at, reply_to) VALUES (2, 1, 7, 1, 2, ?, ?, 1)').run('Hi back', '2026-11-11');
  old.prepare('INSERT INTO chat_reactions(message_id, user_id, emoji, company_id, store_id, at) VALUES (1, 2, ?, 7, 1, ?)').run('👍', '2026-11-11');
  old.prepare('INSERT INTO chat_reads(room_id, user_id, company_id, store_id, last_read, at) VALUES (1, 2, 7, 1, 2, ?)').run('2026-11-11');
  assert.equal(old.prepare('PRAGMA user_version').get().user_version, 20);
  old.close();
  const db = openDb(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 21);
  assert.deepEqual(db.prepare('SELECT id, body, thread_id, also_channel, reply_to FROM chat_messages ORDER BY id').all().map((r) => ({ ...r })),
    [{ id: 1, body: 'Hello', thread_id: null, also_channel: 0, reply_to: null }, { id: 2, body: 'Hi back', thread_id: null, also_channel: 0, reply_to: 1 }]);
  assert.equal(db.prepare('SELECT kind FROM chat_reactions').get().kind, 'emoji', 'old reactions are emoji');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_mutes').get().n, 0);
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'online_until'));
  assert.equal(db.prepare('SELECT last_read FROM chat_reads').get().last_read, 2, 'reads kept');
  db.close();
  // and again: nothing to do on a database that's already at 21
  const again = openDb(file);
  assert.equal(again.prepare('PRAGMA user_version').get().user_version, 21);
  again.close();
});
