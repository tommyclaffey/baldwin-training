// Team Chat (Nov 11). Figma: 09 · Proposals → 27 · Team chat (580:670). Tommy: "a chat feature amongst the team." / "good build it"
//
//   • Chat belongs to one store: its channels and its people only. Owners and all-store managers see the store they're working in.
//   • Channels by role: "<Store> · Everyone" (managers start posts; everyone reacts and replies), Front of House, Bar and Kitchen
//     (members by job, managers in all). Direct messages: anyone in the store with anyone in the store.
//   • Pinned pre-shift notes: a manager pins a message; the team taps "Got It"; managers see who has.
//   • Messages: text, a photo, or a page from the book (a card that opens it). Reactions from a small fixed set, "seen by",
//     unread counts per conversation and in the sidebar.
//   • Delivery is polling (a few seconds while the chat is open). Each room has a rev that goes up on every change, so a poll
//     that finds nothing new is answered in one line.
//   • The server decides everything here: who's in a room is worked out from the store's people and their jobs on every
//     request, and anyone outside a room gets "not found", never its messages. Nothing is hard-deleted: a removed message
//     shows "Message removed".
//   • Send to Team (Nov 11, Tommy: "make the chat similar to growth where you can select an item to populate in the chat"):
//     a page from the book (dish, cocktail, wine, bottle, lesson…) as a card with its kind ("House cocktail"), or, for
//     managers, a person's progress card. Person cards go only into a direct message with another manager (there's no
//     managers-only channel: Kitchen is managers-only today only because nobody has a kitchen job yet), and only managers
//     ever see one.
//   • @mentions, Growth's way: only the conversation's members; stored as <@id> in the body and a list of ids, never names.
//   • Chat v2 (Nov 13, Figma 09 · Proposals → 27b, 681:833; Tommy: "love it, build all of it out"). Discord's structure:
//     channels grouped Announcements (#everyone) / Floor (#front-of-house, #bar, #kitchen), DMs with online dots, a channel
//     you can mute. Reactions in one tap from a set (src/chat/reactions.ts: emoji plus the service words 86'd, Heard…),
//     per person per message. Threads: a reply can open a thread under a message (thread_id); a thread reply can also go
//     to the channel. Each message counts once toward unread: a thread-only reply counts only if it mentions you or
//     you're in that thread. Mark Unread, "typing…" (in memory, gone after 5 s), a Home summary (mentions, then pre-shift
//     notes you haven't tapped Got It on, then DMs), and the newest mention/DM/pre-shift note for the toast.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEDIA_DIR, now } from './db.mjs';
import { JOBS } from './paths.mjs';
import { fullIndex, withStore } from './content.mjs';
import { COLLECTIONS } from './cms.mjs';
import { pathCtxFor, personRow } from './team.mjs';

/** Reactions (v2): every emoji in the picker, plus the service words. The list lives in src/chat/reactions.ts (the app
 *  draws the picker from it); test/chat2.test.mjs checks the two match. */
export const QUICK = ['👍', '✅', '🔥', '👀'];
const EMOJI = ['👍', '✅', '🔥', '👀', '🙏', '❤️', '😂', '🎉', '🍋', '🍊', '🌶️', '🧂', '🍸', '🍹', '🥃', '🍷', '🥩', '🐟', '🦞', '🍝', '🥗', '🍰', '☕', '🧊'];
export const SERVICE_WORDS = ['86’d', 'Heard', 'Behind', 'Corner', 'Hands', 'Yes Chef'];
export const REACTIONS = [...EMOJI, ...SERVICE_WORDS];
const reactionOrder = (e) => { const i = REACTIONS.indexOf(e); return i < 0 ? 999 : i; };
const FOH_JOBS = ['server', 'host', 'bartender', 'support'];
/** Kitchen jobs aren't on the job list yet (Server, Bartender, Host, Support). Until they are, Kitchen is the managers. */
export const KITCHEN_JOBS = ['kitchen', 'cook', 'line-cook', 'prep', 'dish'];
// v2 (Figma 681:833): Discord's lower-case channel names, grouped; the topic sits beside the name in the header.
export const CHANNELS = [
  { key: 'everyone', name: () => 'everyone', group: 'Announcements', jobs: null, line: 'everyone at the store', topic: 'Everyone at the store',
    about: (s) => `Everyone at ${s}. Managers post here, and the whole team can react and reply.` },
  { key: 'foh', name: () => 'front-of-house', group: 'Floor', jobs: FOH_JOBS, line: 'servers, hosts, bar and support', topic: 'Servers, hosts, bar and support',
    about: (s) => `Servers, hosts, bar and support at ${s}. Pre-shift notes are pinned here every day.` },
  { key: 'bar', name: () => 'bar', group: 'Floor', jobs: ['bartender'], line: 'bartenders and managers', topic: 'Bartenders and managers', about: (s) => `The bar team at ${s}, and its managers.` },
  { key: 'kitchen', name: () => 'kitchen', group: 'Floor', jobs: KITCHEN_JOBS, line: 'cooks and managers', topic: 'Cooks and managers', about: (s) => `The kitchen at ${s}, and its managers.` },
];
/** Online: seen in the last 5 minutes (users.last_seen_at moves on every request), or held on by the demo (online_until). */
export const ONLINE_MS = 5 * 60e3;
const MAX_BODY = 2000;
const PAGE_SIZE = 60;
export const PHOTO_MAX = 15 * 1024 * 1024;

const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const jobsOf = (j) => { try { const a = JSON.parse(j || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
const jobLabel = (jobs) => jobs.map((j) => JOBS.find((x) => x.key === j)?.label || j).join(' + ');
const first = (name) => String(name || '').split(/\s+/)[0];

class ChatError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ChatError(status, message); };
export { ChatError };

/** Everyone in a store's chat: its staff, its managers (and the company's all-store managers) and the owners. */
export function storeMembers(db, company, store) {
  const t = Date.now();
  return db.prepare(`SELECT id, name, role, jobs, created_at, last_seen_at, online_until FROM users WHERE company_id = ? AND deleted_at IS NULL AND (
      (role = 'staff' AND store_id = ?) OR (role = 'manager' AND (store_id = ? OR store_id IS NULL)) OR role = 'owner')
    ORDER BY name COLLATE NOCASE`).all(company, store, store).map((u) => {
    const jobs = jobsOf(u.jobs); const manager = u.role !== 'staff';
    const online = (!!u.last_seen_at && t - Date.parse(u.last_seen_at) < ONLINE_MS) || (!!u.online_until && Date.parse(u.online_until) > t);
    return { id: u.id, name: u.name, initials: initials(u.name), manager, jobs, since: u.created_at, online,
      label: manager ? (u.role === 'owner' ? 'Owner' : 'Manager') : jobLabel(jobs) || 'Team' };
  });
}
/** A person as the app shows them: name, initials, job or role, and whether they're on now. */
const personOut = (m) => ({ id: m.id, name: m.name, initials: m.initials, label: m.label, manager: m.manager, online: !!m.online });

/** The chat for this request, or null if the person isn't on this store's team (a super admin looking around, say). */
export function chatCtx(db, c) {
  if (!c.user || !c.storeRow || !c.company) return null;
  const members = storeMembers(db, c.company, c.store);
  const me = members.find((m) => m.id === c.user.id);
  if (!me) return null;
  return { db, company: c.company, store: c.store, storeRow: c.storeRow, storeName: c.storeRow.name, members, me, user: c.user };
}

const byManagerThenName = (a, b) => Number(b.manager) - Number(a.manager) || a.name.localeCompare(b.name);
const dmIds = (key) => key.slice(3).split(':').map(Number);
/** Who's in a room, worked out now: a DM is its two people; a channel is the managers plus everyone with one of its jobs. */
export function membersOf(room, members) {
  if (room.kind === 'dm') { const ids = dmIds(room.key); return members.filter((m) => ids.includes(m.id)); }
  const ch = CHANNELS.find((c) => c.key === room.key);
  const list = !ch?.jobs ? members : members.filter((m) => m.manager || m.jobs.some((j) => ch.jobs.includes(j)));
  return [...list].sort(byManagerThenName);
}
const isIn = (room, x) => membersOf(room, x.members).some((m) => m.id === x.me.id);

function ensureChannels(x) {
  const ins = x.db.prepare('INSERT OR IGNORE INTO chat_rooms(company_id, store_id, key, kind, created_at) VALUES (?,?,?,?,?)');
  for (const ch of CHANNELS) ins.run(x.company, x.store, ch.key, ch.key === 'everyone' ? 'everyone' : 'channel', now());
}
const bump = (db, roomId) => db.prepare('UPDATE chat_rooms SET rev = rev + 1 WHERE id = ?').run(roomId);

/** The address a person uses for a room: the channel's key, or "dm-<the other person's id>". */
function clientKey(room, me) {
  if (room.kind !== 'dm') return room.key;
  const [a, b] = dmIds(room.key);
  return 'dm-' + (a === me.id ? b : a);
}

/** Every room this person is in, in this store: the four channels they belong to and their DMs. */
function myRooms(x) {
  ensureChannels(x);
  const rooms = x.db.prepare('SELECT * FROM chat_rooms WHERE store_id = ? ORDER BY id').all(x.store);
  return rooms.filter((r) => (r.kind === 'dm' ? dmIds(r.key).includes(x.me.id) && membersOf(r, x.members).length === 2 : isIn(r, x)));
}

/** Messages from before someone joined count as read: a new hire doesn't open the app to 200 unread. */
function ensureReads(x, rooms) {
  const ins = x.db.prepare(`INSERT OR IGNORE INTO chat_reads(room_id, user_id, company_id, store_id, last_read, at)
    VALUES (?, ?, ?, ?, IFNULL((SELECT MAX(id) FROM chat_messages WHERE room_id = ? AND created_at < ?), 0), ?)`);
  for (const r of rooms) ins.run(r.id, x.me.id, x.company, x.store, r.id, x.me.since || now(), now());
}

/** Which messages count toward someone's unread (v2, threads): channel messages and thread replies also sent to the
 *  channel; a thread-only reply only if it mentions them or it's in a thread they started or replied in. One row, one
 *  count, so a reply that's in a thread and the channel is never counted twice. (`me` is a user id, a number.) */
const counts = (me) => `(m.thread_id IS NULL OR m.also_channel = 1
  OR (m.mentions IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(m.mentions) j WHERE j.value = ${Number(me)}))
  OR EXISTS (SELECT 1 FROM chat_messages t WHERE (t.id = m.thread_id OR t.thread_id = m.thread_id) AND t.user_id = ${Number(me)}))`;
/** Shown in the channel's timeline: everything but thread-only replies. */
const IN_CHANNEL = '(thread_id IS NULL OR also_channel = 1)';

function unreadByRoom(x) {
  const rows = x.db.prepare(`SELECT m.room_id, COUNT(*) n FROM chat_messages m JOIN chat_reads r ON r.room_id = m.room_id AND r.user_id = ?
    WHERE m.store_id = ? AND m.user_id <> ? AND m.removed_at IS NULL AND m.id > r.last_read AND ${counts(x.me.id)} GROUP BY m.room_id`).all(x.me.id, x.store, x.me.id);
  return new Map(rows.map((r) => [r.room_id, r.n]));
}
/** The rooms this person muted (v2): their unread doesn't count toward Team Chat's number, but @mentions still do. */
function mutedRooms(x) {
  return new Set(x.db.prepare('SELECT room_id FROM chat_mutes WHERE user_id = ? AND store_id = ?').all(x.me.id, x.store).map((r) => r.room_id));
}
/** Unread messages that @mention you, per room (they're in the unread count too; the list marks them with an @). */
function mentionsByRoom(x) {
  const rows = x.db.prepare(`SELECT m.room_id, COUNT(*) n FROM chat_messages m JOIN chat_reads r ON r.room_id = m.room_id AND r.user_id = ?
    WHERE m.store_id = ? AND m.user_id <> ? AND m.removed_at IS NULL AND m.id > r.last_read AND m.mentions IS NOT NULL
    AND EXISTS (SELECT 1 FROM json_each(m.mentions) j WHERE j.value = ?) GROUP BY m.room_id`).all(x.me.id, x.store, x.me.id, x.me.id);
  return new Map(rows.map((r) => [r.room_id, r.n]));
}

/* ---------------------------------- @mentions ---------------------------------- */
const MENTION_RE = /<@(\d+)>/g;
/** The ids a body mentions, each once, in order. */
export const mentionIds = (body) => [...new Set([...String(body || '').matchAll(MENTION_RE)].map((m) => Number(m[1])))];
/** <@12> → "@Rosalind Hart", for previews, reply quotes and search results. */
const plainBody = (body, who) => String(body || '').replace(MENTION_RE, (_, id) => '@' + who(Number(id)).name);

/** The number beside Team Chat in the sidebar: unread in rooms you haven't muted, plus @mentions of you anywhere. */
export function unreadTotal(x) { return unreadCounts(x).count; }
export function unreadCounts(x) {
  const rooms = myRooms(x);
  ensureReads(x, rooms);
  const by = unreadByRoom(x), at = mentionsByRoom(x), muted = mutedRooms(x);
  return {
    count: rooms.reduce((n, r) => n + (muted.has(r.id) ? at.get(r.id) || 0 : by.get(r.id) || 0), 0),
    mentions: rooms.reduce((n, r) => n + (at.get(r.id) || 0), 0),
  };
}

/** One line for the list, a reply quote or a search hit. A progress card names its person only to managers. */
const preview = (m, who, me) => (m.removed_at ? 'Message removed' : m.body ? plainBody(m.body, who).split('\n')[0] : m.photo ? 'Sent a photo'
  : m.page ? `Shared a page: ${JSON.parse(m.page).title}` : m.person ? (me?.manager ? `Shared a progress card: ${JSON.parse(m.person).name}` : 'Shared a progress card') : '');

/** The conversation list: channels first (in their set order), then DMs, newest first. Plus the store's people, for New Message. */
export function roomList(x) {
  const rooms = myRooms(x);
  ensureReads(x, rooms);
  const unread = unreadByRoom(x);
  const mentioned = mentionsByRoom(x);
  const muted = mutedRooms(x);
  const last = new Map(x.db.prepare(`SELECT * FROM chat_messages WHERE id IN (SELECT MAX(id) FROM chat_messages WHERE store_id = ? AND ${IN_CHANNEL} GROUP BY room_id)`).all(x.store).map((m) => [m.room_id, m]));
  const who = nameBook(x, [...last.values()].flatMap((m) => mentionIds(m.body)));
  const out = rooms.map((r) => {
    const l = last.get(r.id);
    const base = { id: r.id, key: clientKey(r, x.me), kind: r.kind, unread: Math.min(unread.get(r.id) || 0, 99), mentions: mentioned.get(r.id) || 0, muted: muted.has(r.id),
      last: l ? { at: l.created_at, text: preview(l, who, x.me), mine: l.user_id === x.me.id } : null };
    if (r.kind === 'dm') {
      const other = x.members.find((m) => m.id === dmIds(r.key).find((id) => id !== x.me.id));
      return { ...base, name: other.name, other: personOut(other) };
    }
    const ch = CHANNELS.find((c) => c.key === r.key);
    return { ...base, name: ch.name(x.storeName), group: ch.group, order: CHANNELS.indexOf(ch) };
  });
  const channels = out.filter((r) => r.kind !== 'dm').sort((a, b) => a.order - b.order).map(({ order, ...r }) => r); // eslint-disable-line no-unused-vars
  const dms = out.filter((r) => r.kind === 'dm' && r.last).sort((a, b) => String(b.last.at).localeCompare(String(a.last.at)));
  const all = [...channels, ...dms];
  const pinsToTap = pinnedFor(x, rooms).filter((p) => p.gotIt.canTap && !p.gotIt.mine).length;
  return {
    store: x.storeName, me: { ...personOut(x.me), online: true },
    rooms: all, unread: all.reduce((n, r) => n + (r.muted ? r.mentions : r.unread), 0), mentions: all.reduce((n, r) => n + r.mentions, 0), pinsToTap,
    people: x.members.filter((m) => m.id !== x.me.id).map(personOut),
    total: x.members.length, online: x.members.filter((m) => m.online || m.id === x.me.id).length,
  };
}

/** A room by the address the app uses. A DM room is made the first time either person opens it. */
export function resolveRoom(x, key, { create = true } = {}) {
  ensureChannels(x);
  const k = String(key || '');
  if (CHANNELS.some((c) => c.key === k)) {
    const room = x.db.prepare('SELECT * FROM chat_rooms WHERE store_id = ? AND key = ?').get(x.store, k);
    if (!room || !isIn(room, x)) fail(404, 'We couldn’t find that conversation.');
    return room;
  }
  const dm = /^dm-(\d+)$/.exec(k);
  if (!dm) fail(404, 'We couldn’t find that conversation.');
  const other = x.members.find((m) => m.id === Number(dm[1]));
  if (!other || other.id === x.me.id) fail(404, 'We couldn’t find that person.');
  const dbKey = `dm:${Math.min(x.me.id, other.id)}:${Math.max(x.me.id, other.id)}`;
  let room = x.db.prepare('SELECT * FROM chat_rooms WHERE store_id = ? AND key = ?').get(x.store, dbKey);
  if (!room && create) {
    x.db.prepare('INSERT OR IGNORE INTO chat_rooms(company_id, store_id, key, kind, created_at) VALUES (?,?,?,?,?)').run(x.company, x.store, dbKey, 'dm', now());
    room = x.db.prepare('SELECT * FROM chat_rooms WHERE store_id = ? AND key = ?').get(x.store, dbKey);
  }
  if (!room) fail(404, 'We couldn’t find that conversation.');
  return room;
}

/** A message by id, only if it's in a room this person is in. */
function messageFor(x, id) {
  const m = x.db.prepare('SELECT * FROM chat_messages WHERE id = ? AND store_id = ?').get(Number(id), x.store);
  if (!m) fail(404, 'We couldn’t find that message.');
  const room = x.db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(m.room_id);
  if (!room || !isIn(room, x)) fail(404, 'We couldn’t find that message.');
  return { m, room };
}

/** Names for people who wrote something but have since left the store. */
function nameBook(x, ids) {
  const book = new Map(x.members.map((m) => [m.id, m]));
  const missing = [...new Set(ids)].filter((id) => !book.has(id));
  if (missing.length) {
    for (const u of x.db.prepare(`SELECT id, name FROM users WHERE company_id = ? AND id IN (${missing.map(() => '?').join(',')})`).all(x.company, ...missing))
      book.set(u.id, { id: u.id, name: u.name, initials: initials(u.name), manager: false, label: 'Former teammate', jobs: [] });
  }
  return (id) => book.get(id) || { id, name: 'Former teammate', initials: '·', manager: false, label: '', jobs: [] };
}

function reactionsFor(x, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const who = nameBook(x, []);
  for (const r of x.db.prepare(`SELECT message_id, emoji, user_id FROM chat_reactions WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY at`).all(...ids)) {
    const list = out.get(r.message_id) || [];
    let e = list.find((z) => z.emoji === r.emoji);
    if (!e) { e = { emoji: r.emoji, word: SERVICE_WORDS.includes(r.emoji), count: 0, mine: false, names: [] }; list.push(e); }
    e.count++; if (r.user_id === x.me.id) e.mine = true; e.names.push(first(who(r.user_id).name));
    out.set(r.message_id, list);
  }
  // First come stays first (a chip doesn't jump when someone taps it), like Discord.
  for (const list of out.values()) list.sort((a, b) => b.count - a.count || reactionOrder(a.emoji) - reactionOrder(b.emoji));
  return out;
}

/** Thread summaries for the messages shown: how many replies, the last one's writer and time, and who's in it. */
function threadsFor(x, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = x.db.prepare(`SELECT thread_id, id, user_id, created_at FROM chat_messages WHERE thread_id IN (${ids.map(() => '?').join(',')}) AND removed_at IS NULL ORDER BY id`).all(...ids);
  const who = nameBook(x, rows.map((r) => r.user_id));
  for (const r of rows) {
    const t = out.get(r.thread_id) || { count: 0, last: null, people: [] };
    t.count++;
    const p = who(r.user_id);
    t.last = { at: r.created_at, name: p.name };
    if (!t.people.some((z) => z.id === p.id)) t.people.push({ id: p.id, initials: p.initials, manager: p.manager, name: p.name });
    out.set(r.thread_id, t);
  }
  return out;
}

function msgOut(x, m, who, reactions, quotes, threads = new Map()) {
  const p = who(m.user_id);
  const base = { id: m.id, at: m.created_at, user: personOut({ ...p, online: x.members.find((z) => z.id === p.id)?.online }), mine: m.user_id === x.me.id, threadId: m.thread_id || null };
  if (m.removed_at) return { ...base, removed: true, reactions: [], thread: threads.get(m.id) || null };
  const q = m.reply_to ? quotes.get(m.reply_to) : null;
  const parent = m.thread_id && m.also_channel ? quotes.get(m.thread_id) : null;
  const ids = m.mentions ? JSON.parse(m.mentions) : [];
  return { ...base, body: m.body || '', photo: m.photo || null, page: m.page ? JSON.parse(m.page) : null,
    // A progress card is for managers: anyone else (say, someone demoted since) sees that one was shared, not who or how they're doing.
    person: m.person && x.me.manager ? JSON.parse(m.person) : null, personHidden: !!m.person && !x.me.manager,
    mentions: ids.map((id) => ({ id, name: who(id).name })), mentionsMe: ids.includes(x.me.id),
    replyTo: q ? { id: q.id, name: who(q.user_id).name, text: q.removed_at ? 'Message removed' : preview(q, who, x.me) } : null,
    // A thread reply also sent to the channel says which thread it answers.
    inThread: parent ? { id: parent.id, name: who(parent.user_id).name, text: parent.removed_at ? 'Message removed' : preview(parent, who, x.me) } : null,
    thread: threads.get(m.id) || null,
    reactions: reactions.get(m.id) || [], canRemove: m.user_id === x.me.id || x.me.manager };
}

/** Everything the open conversation shows: the timeline, the pinned pre-shift notes, members, shared pages and "seen by". */
export function roomDetail(x, room, { before } = {}) {
  const db = x.db;
  const members = membersOf(room, x.members);
  const rows = db.prepare(`SELECT * FROM chat_messages WHERE room_id = ? AND pinned_at IS NULL AND ${IN_CHANNEL} ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`)
    .all(...[room.id, ...(before ? [Number(before)] : []), PAGE_SIZE + 1]);
  const hasMore = rows.length > PAGE_SIZE;
  const list = rows.slice(0, PAGE_SIZE).reverse();
  const pinnedRows = db.prepare('SELECT * FROM chat_messages WHERE room_id = ? AND pinned_at IS NOT NULL AND removed_at IS NULL ORDER BY pinned_at DESC').all(room.id);
  const quotes = quotesFor(x, room, [...list, ...pinnedRows]);
  const shown = [...list, ...pinnedRows, ...quotes.values()];
  const who = nameBook(x, [...shown.map((m) => m.user_id), ...shown.flatMap((m) => mentionIds(m.body))]);
  const reactions = reactionsFor(x, [...list, ...pinnedRows].map((m) => m.id));
  const threads = threadsFor(x, [...list, ...pinnedRows].filter((m) => !m.thread_id).map((m) => m.id));
  const messages = list.map((m) => msgOut(x, m, who, reactions, quotes, threads));

  // Pinned pre-shift notes. Managers see who tapped Got It and who hasn't yet; everyone else sees their own tap.
  const pins = pinnedRows.map((m) => {
    const taps = db.prepare('SELECT user_id, at FROM chat_gotit WHERE message_id = ? ORDER BY at').all(m.id);
    const audience = members.filter((z) => z.id !== m.user_id);
    const tapped = taps.filter((t) => audience.some((z) => z.id === t.user_id));
    const gotIt = { mine: taps.some((t) => t.user_id === x.me.id), count: tapped.length, total: audience.length, canTap: m.user_id !== x.me.id };
    if (x.me.manager) Object.assign(gotIt, {
      people: tapped.map((t) => { const p = who(t.user_id); return { id: p.id, name: p.name, initials: p.initials, at: t.at }; }),
      waiting: audience.filter((z) => !tapped.some((t) => t.user_id === z.id)).map((z) => ({ id: z.id, name: z.name, initials: z.initials })),
    });
    return { ...msgOut(x, m, who, reactions, quotes, threads), title: m.pin_title || 'Pre-shift', pinnedAt: m.pinned_at, gotIt };
  });

  // Pages linked in this room, newest first, each once.
  const shared = [];
  for (const r of db.prepare('SELECT page, created_at FROM chat_messages WHERE room_id = ? AND page IS NOT NULL AND removed_at IS NULL ORDER BY id DESC LIMIT 200').all(room.id)) {
    const pg = JSON.parse(r.page);
    if (!shared.some((s) => s.slug === pg.slug)) shared.push({ ...pg, at: r.created_at });
  }

  // "Seen by": under the newest message, everyone in the room (but its writer and you) who has read that far, latest first.
  const lastMsg = db.prepare(`SELECT id, user_id FROM chat_messages WHERE room_id = ? AND removed_at IS NULL AND ${IN_CHANNEL} ORDER BY id DESC LIMIT 1`).get(room.id);
  let seen = null;
  if (lastMsg) {
    const reads = db.prepare('SELECT user_id, at FROM chat_reads WHERE room_id = ? AND last_read >= ? ORDER BY at DESC').all(room.id, lastMsg.id);
    const people = reads.filter((r) => r.user_id !== lastMsg.user_id && r.user_id !== x.me.id && members.some((z) => z.id === r.user_id))
      .map((r) => { const p = who(r.user_id); return { id: p.id, name: p.name, first: first(p.name), initials: p.initials }; });
    seen = { messageId: lastMsg.id, people, of: members.filter((z) => z.id !== lastMsg.user_id && z.id !== x.me.id).length };
  }

  const ch = CHANNELS.find((c) => c.key === room.key);
  const other = room.kind === 'dm' ? members.find((m) => m.id !== x.me.id) || null : null;
  const lastId = db.prepare('SELECT MAX(id) id FROM chat_messages WHERE room_id = ?').get(room.id).id || 0;
  const read = db.prepare('SELECT last_read FROM chat_reads WHERE room_id = ? AND user_id = ?').get(room.id, x.me.id)?.last_read ?? 0;
  const online = members.filter((m) => m.online || m.id === x.me.id).length;
  return {
    room: {
      id: room.id, key: clientKey(room, x.me), kind: room.kind, rev: room.rev,
      name: other ? other.name : ch.name(x.storeName),
      line: other ? other.label : `${members.length} ${members.length === 1 ? 'member' : 'members'} · ${ch.line}`,
      topic: other ? other.label : ch.topic, group: ch?.group || null, online,
      about: other ? null : ch.about(x.storeName),
      other: other && personOut(other),
      members: members.map((m) => ({ ...personOut(m), online: m.online || m.id === x.me.id })),
      canStart: room.kind !== 'everyone' || x.me.manager, canPin: x.me.manager && room.kind !== 'dm', lastId, read,
      canSendPerson: canSendPerson(x, room, members), muted: isMuted(x, room),
    },
    messages, hasMore, pins, shared, seen, reactions: QUICK, typing: typingIn(x, room),
  };
}

/** The messages a list quotes: what each replies to, and the thread a channel copy of a thread reply belongs to. */
function quotesFor(x, room, list) {
  const ids = [...new Set(list.flatMap((m) => [m.reply_to, m.also_channel ? m.thread_id : null]).filter(Boolean))];
  return new Map(ids.length ? x.db.prepare(`SELECT * FROM chat_messages WHERE room_id = ? AND id IN (${ids.map(() => '?').join(',')})`).all(room.id, ...ids).map((q) => [q.id, q]) : []);
}

/* ---------------------------------- threads (v2) ---------------------------------- */
/** A thread: the message it hangs off and every reply, oldest first. Anyone in the room can read and reply. */
export function threadDetail(x, id) {
  const { m, room } = messageFor(x, id);
  const parent = m.thread_id ? x.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(m.thread_id) : m;
  const replies = x.db.prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY id').all(parent.id);
  const quotes = quotesFor(x, room, replies);
  const shown = [parent, ...replies, ...quotes.values()];
  const who = nameBook(x, [...shown.map((z) => z.user_id), ...shown.flatMap((z) => mentionIds(z.body))]);
  const reactions = reactionsFor(x, [parent, ...replies].map((z) => z.id));
  const ch = CHANNELS.find((c) => c.key === room.key);
  const members = membersOf(room, x.members);
  return {
    room: { id: room.id, key: clientKey(room, x.me), kind: room.kind, rev: room.rev, name: ch ? ch.name(x.storeName) : members.find((z) => z.id !== x.me.id)?.name || '',
      members: members.map(personOut), canStart: true, canPin: false, canSendPerson: canSendPerson(x, room, members), lastId: 0, read: 0 },
    parent: msgOut(x, parent, who, reactions, quotes, threadsFor(x, [parent.id])),
    replies: replies.map((z) => msgOut(x, z, who, reactions, quotes)),
  };
}

/* ---------------------------------- mute, typing, mark unread (v2) ---------------------------------- */
const isMuted = (x, room) => !!x.db.prepare('SELECT 1 FROM chat_mutes WHERE room_id = ? AND user_id = ?').get(room.id, x.me.id);
/** Mute a room for yourself (its unread drops out of Team Chat's number; @mentions of you still count), or unmute it. */
export function setMute(x, room, on) {
  if (on) x.db.prepare('INSERT OR IGNORE INTO chat_mutes(room_id, user_id, company_id, store_id, at) VALUES (?,?,?,?,?)').run(room.id, x.me.id, x.company, x.store, now());
  else x.db.prepare('DELETE FROM chat_mutes WHERE room_id = ? AND user_id = ?').run(room.id, x.me.id);
  return isMuted(x, room);
}

/** "Rosalind is typing…": a ping from the composer, kept in memory, gone after 5 s (or when they send). */
export const TYPING_MS = 5000;
const typingNow = new Map(); // room id → Map(user id → until, ms)
export function setTyping(x, room, on = true, at = Date.now()) {
  const m = typingNow.get(room.id) || new Map();
  if (on) m.set(x.me.id, at + TYPING_MS); else m.delete(x.me.id);
  if (m.size) typingNow.set(room.id, m); else typingNow.delete(room.id);
}
/** First names of the people typing in this room now (never you), oldest ping first. */
export function typingIn(x, room, at = Date.now()) {
  const m = typingNow.get(room.id);
  if (!m) return [];
  for (const [id, until] of m) if (until <= at) m.delete(id);
  if (!m.size) typingNow.delete(room.id);
  const members = membersOf(room, x.members);
  return [...m.keys()].filter((id) => id !== x.me.id).map((id) => members.find((z) => z.id === id)).filter(Boolean).map((z) => first(z.name));
}

/** Mark Unread: this message and everything after it count as unread again (yours aside). */
export function markUnread(x, id) {
  const { m, room } = messageFor(x, id);
  const to = x.db.prepare('SELECT IFNULL(MAX(id), 0) id FROM chat_messages WHERE room_id = ? AND id < ?').get(room.id, m.id).id;
  x.db.prepare(`INSERT INTO chat_reads(room_id, user_id, company_id, store_id, last_read, at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(room_id, user_id) DO UPDATE SET last_read = excluded.last_read, at = excluded.at`).run(room.id, x.me.id, x.company, x.store, to, now());
  bump(x.db, room.id);
  return room;
}

/** Mark All Read (Home's card): every conversation read up to its newest message. */
export function readAll(x) {
  const rooms = myRooms(x);
  ensureReads(x, rooms);
  for (const r of rooms) {
    const max = x.db.prepare('SELECT MAX(id) id FROM chat_messages WHERE room_id = ?').get(r.id).id || 0;
    const cur = x.db.prepare('SELECT last_read FROM chat_reads WHERE room_id = ? AND user_id = ?').get(r.id, x.me.id)?.last_read ?? 0;
    if (max > cur) { x.db.prepare('UPDATE chat_reads SET last_read = ?, at = ? WHERE room_id = ? AND user_id = ?').run(max, now(), r.id, x.me.id); bump(x.db, r.id); }
  }
  return unreadCounts(x);
}

/* ---------------------------------- Home, the toast, the rail (v2) ---------------------------------- */
const roomName = (x, room) => (room.kind === 'dm' ? x.members.find((m) => m.id === dmIds(room.key).find((id) => id !== x.me.id))?.name || 'Former teammate' : CHANNELS.find((c) => c.key === room.key).name(x.storeName));

/** Pre-shift notes pinned in these rooms, with your Got It state, newest first. */
function pinnedFor(x, rooms) {
  if (!rooms.length) return [];
  const rows = x.db.prepare(`SELECT * FROM chat_messages WHERE room_id IN (${rooms.map(() => '?').join(',')}) AND pinned_at IS NOT NULL AND removed_at IS NULL ORDER BY pinned_at DESC`).all(...rooms.map((r) => r.id));
  const mine = new Set(rows.length ? x.db.prepare(`SELECT message_id FROM chat_gotit WHERE user_id = ? AND message_id IN (${rows.map(() => '?').join(',')})`).all(x.me.id, ...rows.map((m) => m.id)).map((r) => r.message_id) : []);
  const who = nameBook(x, [...rows.map((m) => m.user_id), ...rows.flatMap((m) => mentionIds(m.body))]);
  return rows.map((m) => {
    const room = rooms.find((r) => r.id === m.room_id);
    const p = who(m.user_id);
    return { id: m.id, key: clientKey(room, x.me), kind: room.kind, roomName: roomName(x, room), title: m.pin_title || 'Pre-shift', at: m.created_at, pinnedAt: m.pinned_at,
      user: personOut(p), text: preview(m, who, x.me), body: m.body ? plainBody(m.body, who) : '', gotIt: { mine: mine.has(m.id), canTap: m.user_id !== x.me.id } };
  });
}
export const pinnedList = (x) => pinnedFor(x, myRooms(x));

/** Messages that @mention you, newest first (the rail's Mentions). Unread ones are marked. */
export function mentionsList(x, limit = 30) {
  const rooms = myRooms(x);
  if (!rooms.length) return [];
  ensureReads(x, rooms);
  const rows = x.db.prepare(`SELECT m.*, r.last_read FROM chat_messages m JOIN chat_reads r ON r.room_id = m.room_id AND r.user_id = ?
    WHERE m.room_id IN (${rooms.map(() => '?').join(',')}) AND m.removed_at IS NULL AND m.user_id <> ? AND m.mentions IS NOT NULL
    AND EXISTS (SELECT 1 FROM json_each(m.mentions) j WHERE j.value = ?) ORDER BY m.id DESC LIMIT ?`).all(x.me.id, ...rooms.map((r) => r.id), x.me.id, x.me.id, limit);
  const who = nameBook(x, [...rows.map((m) => m.user_id), ...rows.flatMap((m) => mentionIds(m.body))]);
  return rows.map((m) => {
    const room = rooms.find((r) => r.id === m.room_id);
    return { id: m.id, key: clientKey(room, x.me), kind: room.kind, roomName: roomName(x, room), user: personOut(who(m.user_id)), text: preview(m, who, x.me),
      body: m.body ? plainBody(m.body, who) : '', at: m.created_at, unread: m.id > m.last_read, threadId: m.thread_id || null };
  });
}

/** Home's "Waiting for you" card (Figma 688:862): what's most important first. @mentions of you (unread), then pre-shift
 *  notes you haven't tapped Got It on, then direct messages (the newest unread in each). Plus the counts for its summary
 *  line ("3 new in #front-of-house, plus 1 direct message"). Muted channels don't count, except a mention of you. */
export function summary(x) {
  const rooms = myRooms(x);
  ensureReads(x, rooms);
  const by = unreadByRoom(x), muted = mutedRooms(x), at = mentionsByRoom(x);
  const items = [];
  for (const m of mentionsList(x, 10).filter((z) => z.unread)) items.push({ type: 'mention', ...m });
  for (const p of pinnedFor(x, rooms).filter((z) => z.gotIt.canTap && !z.gotIt.mine)) items.push({ type: 'preshift', ...p });
  const dmRooms = rooms.filter((r) => r.kind === 'dm' && (by.get(r.id) || 0) > 0 && !muted.has(r.id));
  for (const r of dmRooms) {
    const m = x.db.prepare(`SELECT m.* FROM chat_messages m JOIN chat_reads rd ON rd.room_id = m.room_id AND rd.user_id = ? WHERE m.room_id = ? AND m.user_id <> ?
      AND m.removed_at IS NULL AND m.id > rd.last_read AND ${counts(x.me.id)} ORDER BY m.id DESC LIMIT 1`).get(x.me.id, r.id, x.me.id);
    if (!m || items.some((i) => i.type === 'mention' && i.id === m.id)) continue;
    const who = nameBook(x, [m.user_id, ...mentionIds(m.body)]);
    items.push({ type: 'dm', id: m.id, key: clientKey(r, x.me), kind: 'dm', roomName: roomName(x, r), user: personOut(who(m.user_id)), text: preview(m, who, x.me), at: m.created_at, count: by.get(r.id) });
  }
  const channels = rooms.filter((r) => r.kind !== 'dm').map((r) => ({ key: r.key, name: roomName(x, r), unread: muted.has(r.id) ? at.get(r.id) || 0 : by.get(r.id) || 0 }))
    .filter((c) => c.unread > 0).sort((a, b) => b.unread - a.unread);
  const dmCount = rooms.filter((r) => r.kind === 'dm').reduce((n, r) => n + (muted.has(r.id) ? at.get(r.id) || 0 : by.get(r.id) || 0), 0);
  const { count, mentions } = unreadCounts(x);
  return { count, mentions, channels, dms: dmCount, items };
}

/** The toast's message (v2): the newest unread @mention of you, direct message, or pre-shift note waiting on your Got It.
 *  The app shows one when this changes, on pages other than the chat. Null when there's none. */
export function latestForToast(x) {
  const s = summary(x);
  const when = (i) => (i.type === 'preshift' ? i.pinnedAt : i.at);
  const top = [...s.items].sort((a, b) => String(when(b)).localeCompare(String(when(a))))[0];
  return top ? { type: top.type, id: top.id, key: top.key, roomName: top.roomName, kind: top.kind, user: top.user, text: top.text, at: when(top) } : null;
}

/* ---------------------------------- changes ---------------------------------- */

const recent = new Map(); // user id → send times (the last minute)
function rateLimit(userId) {
  const t = Date.now();
  const list = (recent.get(userId) || []).filter((s) => t - s < 60_000);
  if (list.length >= 30) fail(429, 'That’s a lot of messages at once. Wait a minute and try again.');
  list.push(t); recent.set(userId, list);
}

/** "The Book · House Cocktails": where a page lives, for its card. */
function kickerFor(e) {
  const col = Object.values(COLLECTIONS).find((c) => c.section === e.section);
  const where = col?.label || (e.name.split(' · ').length > 1 ? e.name.split(' · ')[0] : e.nav) || 'Page';
  return `The Book · ${where}`;
}
const WINE_STYLES = new Set(['red', 'white', 'rose', 'orange', 'sparkling']);
/** What a page is, in a word or two, for its card: "House cocktail", "Grape", "Lesson". Null for hubs and the like. */
export function kindFor(e) {
  if (/^[lm]/.test(String(e.file || ''))) return 'Lesson';
  if (/^Step \d/.test(e.section)) return 'Steps of service';
  const parts = String(e.slug).split('/');
  switch (e.section) {
    case 'Recipe': return 'Dish';
    case 'Signature': return 'House cocktail';
    case 'Classic': return 'Classic cocktail';
    case 'Wine list': return /by-the-glass/.test(e.slug) ? 'Wine by the glass' : 'Wine by the bottle';
    case 'Back bar': return 'Back bar';
    case 'Bottle': return 'Bottle';
    case 'Spirit': return 'Spirit';
    case 'Beer': return 'Beer';
    case 'Bar Basics': return 'Bar basics';
    case 'Wine Service': return 'Wine service';
    case 'Wine':
      if (parts.length <= 2) return WINE_STYLES.has(parts[1]) ? 'Wine style' : 'Wine country';
      return WINE_STYLES.has(parts[1]) ? (parts[1] === 'red' || parts[1] === 'white' ? 'Grape' : 'Wine style') : 'Wine region';
    default: return null;
  }
}

/** A page from this store's book, as a card. Null if the store's book doesn't have it. */
/** Cards for coded pages that aren't in the book's index (Nov 12: the Prep tracker registers its own). A source
 *  returns undefined when the address isn't one of its pages. */
const cardSources = [];
export const addCardSource = (fn) => { cardSources.push(fn); };
export function pageCard(db, storeRow, slug, user = null) {
  const s = String(slug || '').replace(/^\//, '');
  if (!s) return null;
  for (const fn of cardSources) { const card = fn(db, storeRow, s, user); if (card !== undefined) return card; }
  const e = withStore(storeRow, () => fullIndex(db, { text: false }), user).find((z) => z.slug === s); // addresses and titles only
  if (!e) return null;
  // The card's one line: the page's blurb, or for a drink or dish without one, its taste or selling line.
  let extra = '';
  if (!e.blurb && /^e\d+$/.test(String(e.id))) {
    try { const d = JSON.parse(db.prepare('SELECT data FROM entries WHERE id = ?').get(Number(String(e.id).slice(1)))?.data || '{}'); extra = d.tasteLine || d.sellingLine || d.story || ''; } catch { /* no line */ }
  }
  const line = String(e.blurb || extra).replace(/\s+/g, ' ').trim();
  return { slug: e.slug, title: e.title, kicker: kickerFor(e), kind: kindFor(e), thumb: e.thumb || null, line: line.length > 90 ? line.slice(0, 88).replace(/\s+\S*$/, '') + '…' : line };
}

/** Person cards go from a manager into a direct message with another manager, and nowhere else. */
export function canSendPerson(x, room, members = membersOf(room, x.members)) {
  if (!x.me.manager || room.kind !== 'dm') return false;
  const other = members.find((m) => m.id !== x.me.id);
  return !!other?.manager;
}

/** A manager's snapshot of how someone on this store's team is doing: job, progress, status and what's next. */
export function personCard(x, id) {
  if (!x.me.manager) fail(403, 'Only managers can share someone’s progress.');
  const u = x.db.prepare("SELECT * FROM users WHERE id = ? AND company_id = ? AND store_id = ? AND role = 'staff' AND deleted_at IS NULL").get(Number(id), x.company, x.store);
  if (!u) fail(404, 'That person isn’t on this store’s team.');
  return personSnapshot(x.db, x.storeRow, u, x.user);
}
function personSnapshot(db, storeRow, u, viewer = null) {
  const { row } = personRow(db, storeRow.id, u, pathCtxFor(db, storeRow, viewer));
  return { id: row.id, name: row.name, initials: row.initials, job: row.jobLabel || '', done: row.done, total: row.total, late: row.late,
    status: row.status, week: row.week, weeks: row.weeks, startedOn: row.startedOn, next: row.next, at: now() };
}

const PHOTO_RE = /^\/media\/chat-[a-z0-9]+-[a-f0-9]{18}\.jpg$/;

export function postMessage(x, room, b) {
  const db = x.db;
  const body = String(b.body ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_BODY);
  let photo = null, page = null, replyTo = null;
  if (b.photo) {
    photo = String(b.photo);
    if (!PHOTO_RE.test(photo) || !fs.existsSync(path.join(MEDIA_DIR, path.basename(photo)))) fail(400, 'That photo didn’t upload. Try again.');
  }
  if (b.page) {
    page = pageCard(db, x.storeRow, b.page, x.user);
    if (!page) fail(400, 'That page isn’t in the book.');
  }
  let person = null;
  if (b.person) {
    if (!x.me.manager) fail(403, 'Only managers can share someone’s progress.');
    if (!canSendPerson(x, room)) fail(403, 'Progress cards go only to another manager, in a direct message.');
    person = personCard(x, b.person);
  }
  if (page && person) fail(400, 'Send one card at a time.');
  // @mentions: <@id> for people in this conversation only.
  const members = membersOf(room, x.members);
  const mentions = mentionIds(body);
  if (mentions.some((id) => !members.some((m) => m.id === id))) fail(400, 'You can only mention people in this conversation.');
  if (b.replyTo) {
    const q = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND room_id = ?').get(Number(b.replyTo), room.id);
    if (!q || q.removed_at) fail(400, 'That message isn’t there anymore.');
    replyTo = q.id;
  }
  // A thread reply (v2): under a message in this room that isn't itself in a thread. It can go to the channel too.
  let threadId = null;
  if (b.threadId) {
    const t = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND room_id = ?').get(Number(b.threadId), room.id);
    if (!t || t.removed_at) fail(400, 'That message isn’t there anymore.');
    threadId = t.thread_id || t.id;
  }
  const alsoChannel = threadId && b.alsoChannel ? 1 : 0;
  if (!body && !photo && !page && !person) fail(400, 'Write a message first.');
  if (room.kind === 'everyone' && !x.me.manager && !replyTo && !threadId) fail(403, 'Managers start posts in #everyone. Reply to a post to join in.');
  rateLimit(x.me.id);
  const t = now();
  const id = Number(db.prepare('INSERT INTO chat_messages(room_id, company_id, store_id, user_id, body, photo, page, person, mentions, reply_to, created_at, thread_id, also_channel) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(room.id, x.company, x.store, x.me.id, body || null, photo, page ? JSON.stringify(page) : null, person ? JSON.stringify(person) : null,
      mentions.length ? JSON.stringify(mentions) : null, replyTo, t, threadId, alsoChannel).lastInsertRowid);
  // Your own message is read; a thread reply only moves your place if everything before it was read already.
  const cur = db.prepare('SELECT last_read FROM chat_reads WHERE room_id = ? AND user_id = ?').get(room.id, x.me.id)?.last_read ?? 0;
  const gap = db.prepare(`SELECT COUNT(*) n FROM chat_messages m WHERE m.room_id = ? AND m.id > ? AND m.id < ? AND m.user_id <> ? AND m.removed_at IS NULL AND ${counts(x.me.id)}`).get(room.id, cur, id, x.me.id).n;
  if (!threadId || alsoChannel || !gap) markRead(x, room, id, { quiet: true });
  setTyping(x, room, false);
  bump(db, room.id);
  return id;
}

export function markRead(x, room, last, { quiet = false } = {}) {
  const max = x.db.prepare('SELECT MAX(id) id FROM chat_messages WHERE room_id = ?').get(room.id).id || 0;
  const to = Math.max(0, Math.min(Number(last) || 0, max));
  const cur = x.db.prepare('SELECT last_read FROM chat_reads WHERE room_id = ? AND user_id = ?').get(room.id, x.me.id);
  if (cur && cur.last_read >= to) return false;
  x.db.prepare(`INSERT INTO chat_reads(room_id, user_id, company_id, store_id, last_read, at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(room_id, user_id) DO UPDATE SET last_read = excluded.last_read, at = excluded.at`).run(room.id, x.me.id, x.company, x.store, to, now());
  if (!quiet) bump(x.db, room.id);
  return true;
}

/** Your own message, or (managers) anyone's in the store: it stays, as "Message removed". */
export function removeMessage(x, id) {
  const { m, room } = messageFor(x, id);
  if (m.user_id !== x.me.id && !x.me.manager) fail(403, 'You can remove your own messages.');
  if (!m.removed_at) {
    x.db.prepare('UPDATE chat_messages SET removed_at = ?, removed_by = ?, pinned_at = NULL, pinned_by = NULL WHERE id = ?').run(now(), x.me.id, m.id);
    bump(x.db, room.id);
  }
  return room;
}

export function react(x, id, emoji) {
  const { m, room } = messageFor(x, id);
  if (!REACTIONS.includes(emoji)) fail(400, 'Pick one of the reactions.');
  if (m.removed_at) fail(400, 'That message isn’t there anymore.');
  const has = x.db.prepare('SELECT 1 FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(m.id, x.me.id, emoji);
  if (has) x.db.prepare('DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(m.id, x.me.id, emoji);
  else x.db.prepare('INSERT INTO chat_reactions(message_id, user_id, emoji, company_id, store_id, at, kind) VALUES (?,?,?,?,?,?,?)').run(m.id, x.me.id, emoji, x.company, x.store, now(), SERVICE_WORDS.includes(emoji) ? 'word' : 'emoji');
  bump(x.db, room.id);
  return room;
}

const weekday = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Detroit' });
/** Managers pin a message in a channel as the pre-shift note ("Wednesday pre-shift"), or unpin it. */
export function pin(x, id, on) {
  const { m, room } = messageFor(x, id);
  if (!x.me.manager) fail(403, 'Managers pin pre-shift notes.');
  if (room.kind === 'dm') fail(400, 'Pin notes in a channel.');
  if (m.removed_at) fail(400, 'That message isn’t there anymore.');
  if (on) x.db.prepare('UPDATE chat_messages SET pinned_at = ?, pinned_by = ?, pin_title = ? WHERE id = ?').run(now(), x.me.id, `${weekday(now())} pre-shift`, m.id);
  else x.db.prepare('UPDATE chat_messages SET pinned_at = NULL, pinned_by = NULL WHERE id = ?').run(m.id);
  bump(x.db, room.id);
  return room;
}

/** "Got It" on a pinned note (or take it back). */
export function gotIt(x, id, on) {
  const { m, room } = messageFor(x, id);
  if (!m.pinned_at || m.removed_at) fail(400, 'That note isn’t pinned anymore.');
  if (m.user_id === x.me.id) fail(400, 'That’s your own note.');
  if (on) x.db.prepare('INSERT OR IGNORE INTO chat_gotit(message_id, user_id, company_id, store_id, at) VALUES (?,?,?,?,?)').run(m.id, x.me.id, x.company, x.store, now());
  else x.db.prepare('DELETE FROM chat_gotit WHERE message_id = ? AND user_id = ?').run(m.id, x.me.id);
  bump(x.db, room.id);
  return room;
}

/** Messages with these words, in the rooms this person is in. */
export function search(x, q) {
  const term = String(q || '').trim().slice(0, 80);
  if (term.length < 2) return [];
  const rooms = myRooms(x);
  if (!rooms.length) return [];
  const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const rows = x.db.prepare(`SELECT * FROM chat_messages WHERE store_id = ? AND removed_at IS NULL AND room_id IN (${rooms.map(() => '?').join(',')})
    AND (body LIKE ? ESCAPE '\\' OR page LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 20`).all(x.store, ...rooms.map((r) => r.id), like, like);
  const who = nameBook(x, [...rows.map((m) => m.user_id), ...rows.flatMap((m) => mentionIds(m.body))]);
  return rows.map((m) => {
    const room = rooms.find((r) => r.id === m.room_id);
    const ch = CHANNELS.find((c) => c.key === room.key);
    const roomName = room.kind === 'dm' ? who(dmIds(room.key).find((id) => id !== x.me.id)).name : ch.name(x.storeName);
    return { id: m.id, key: clientKey(room, x.me), kind: room.kind, roomName, name: who(m.user_id).name, text: preview(m, who, x.me), at: m.created_at, pinned: !!m.pinned_at };
  });
}

/** A photo for the chat: turned upright, made no bigger than 1600 px, saved as JPEG (which drops the location and camera data). */
export async function savePhoto(buf) {
  const sharp = (await import('sharp')).default;
  let out;
  try { out = await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(); }
  catch { fail(415, 'That photo couldn’t be read. Try a JPG or PNG.'); }
  const file = `chat-${Date.now().toString(36)}-${crypto.randomBytes(9).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(MEDIA_DIR, file), out);
  return '/media/' + file;
}

/* ------------------------------ demo conversation ------------------------------ */

/** Detroit wall time → a Date (good to the minute; the demo only needs "3:30 pm"). */
function detroit(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(guess)).map((x) => [x.type, Number(x.value)]));
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess - (wall - guess));
}
/** The last 3:30 pm (Detroit) that's at least 40 minutes gone: the demo's pre-shift happens then, so its times match the design. */
export function demoAnchor(at = new Date()) {
  const [y, mo, d] = at.toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }).split('-').map(Number);
  let a = detroit(y, mo, d, 15, 30);
  if (at.getTime() - a.getTime() < 40 * 60e3) { const yd = new Date(Date.UTC(y, mo - 1, d - 1)); a = detroit(yd.getUTCFullYear(), yd.getUTCMonth() + 1, yd.getUTCDate(), 15, 30); }
  return a;
}

/**
 * Seeds a store's chat from a script, so a demo opens on a real conversation. Reusable: pass any store and a script that
 * names its own people (by name, as they are in the store) and its own pages (by slug; a page the store doesn't have is
 * left off its message). "{store}" in a message becomes the store's name.
 *   script.channels: { everyone|foh|bar|kitchen: [message…] }    script.dms: [{ between: [name, name], messages: [message…] }]
 *   message: { ref?, by, at (minutes from the anchor), body? ("@[Name]" mentions them), photo?, page?, person? (a staff name:
 *              their progress card, in a DM between managers only), reply? (a ref), pin?, gotIt?: [names],
 *              react?: { emoji: [names] }, unreadBy?: [names] }
 *   script.seen?: { roomKey: [names, oldest read first] } orders "seen by".
 */
//   v2 (Nov 13): message.thread? (a ref: a reply in that message's thread; also? sends it to the channel too),
//   message.only? ('manager' | 'employee': in that demo only; the employee demo is Marisol's own view), react can use the
//   service words ("Heard"), script.mute?: { roomKey: [names] }, script.online?: [names] shown on now for the demo's day.
export function seedChat(db, { company, storeRow, script, anchor = demoAnchor(), role = 'manager', until = null }) {
  const store = storeRow.id;
  const members = storeMembers(db, company, store);
  const id = (name) => members.find((m) => m.name === name)?.id;
  const at = (min) => new Date(anchor.getTime() + min * 60e3).toISOString();
  const x = { db, company, store, storeRow, storeName: storeRow.name, members, me: members[0] };
  ensureChannels(x);
  const refs = new Map();
  const cards = new Map();
  const card = (slug) => { if (!cards.has(slug)) cards.set(slug, pageCard(db, storeRow, slug)); return cards.get(slug); };
  const insMsg = db.prepare(`INSERT INTO chat_messages(room_id, company_id, store_id, user_id, body, photo, page, person, mentions, reply_to, created_at, pinned_at, pinned_by, pin_title, thread_id, also_channel)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  // A person card in a script: a snapshot of a staff member's progress, by name (only between managers, as in the app).
  const personFor = (name) => { const u = db.prepare("SELECT * FROM users WHERE company_id = ? AND store_id = ? AND role = 'staff' AND name = ? AND deleted_at IS NULL").get(company, store, name); return u ? personSnapshot(db, storeRow, u) : null; };
  const insReact = db.prepare('INSERT OR IGNORE INTO chat_reactions(message_id, user_id, emoji, company_id, store_id, at, kind) VALUES (?,?,?,?,?,?,?)');
  const insGot = db.prepare('INSERT OR IGNORE INTO chat_gotit(message_id, user_id, company_id, store_id, at) VALUES (?,?,?,?,?)');
  const insRead = db.prepare('INSERT OR REPLACE INTO chat_reads(room_id, user_id, company_id, store_id, last_read, at) VALUES (?,?,?,?,?,?)');

  const play = (room, messages, seenOrder = []) => {
    const done = []; // [message id, minutes, unreadBy]
    for (const s of [...messages].sort((a, b) => a.at - b.at)) {
      const by = id(s.by);
      if (!by || (s.only && s.only !== role)) continue;
      const pg = s.page ? card(s.page) : null;
      // "@[Marisol Vega]" in a script is a mention: <@her id> in the body (left as plain text if she isn't in the room).
      const inRoom = membersOf(room, members);
      const body = s.body ? s.body.replaceAll('{store}', storeRow.name).replace(/@\[([^\]]+)\]/g, (_, n) => { const m = inRoom.find((z) => z.name === n); return m ? `<@${m.id}>` : '@' + n; }) : null;
      if (!body && !s.photo && !pg) continue;
      const ments = mentionIds(body);
      const pc = s.person && room.kind === 'dm' && membersOf(room, members).every((m) => m.manager) ? personFor(s.person) : null;
      const thread = s.thread ? refs.get(s.thread) ?? null : null;
      const mid = Number(insMsg.run(room.id, company, store, by, body, s.photo || null, pg ? JSON.stringify(pg) : null, pc ? JSON.stringify(pc) : null, ments.length ? JSON.stringify(ments) : null, s.reply ? refs.get(s.reply) ?? null : null, at(s.at),
        s.pin ? at(s.at) : null, s.pin ? by : null, s.pin ? `${weekday(at(s.at))} pre-shift` : null, thread, thread && s.also ? 1 : 0).lastInsertRowid);
      if (s.ref) refs.set(s.ref, mid);
      for (const [emoji, names] of Object.entries(s.react || {})) {
        if (!REACTIONS.includes(emoji)) continue;
        names.forEach((n, i) => id(n) && insReact.run(mid, id(n), emoji, company, store, at(s.at + 1 + i), SERVICE_WORDS.includes(emoji) ? 'word' : 'emoji'));
      }
      (s.gotIt || []).forEach((n, i) => id(n) && insGot.run(mid, id(n), company, store, at(s.at + 2 + i)));
      // Thread-only replies don't move anyone's place (they're read with the channel), so they're left out of "unread from".
      if (!thread || s.also) done.push([mid, s.at, s.unreadBy || []]);
    }
    // Reads: everyone in the room has read up to just before the first message flagged unread for them.
    const lastAt = done.length ? done[done.length - 1][1] : 0;
    for (const m of membersOf(room, members)) {
      const stop = done.findIndex(([, , u]) => u.includes(m.name));
      const upTo = stop < 0 ? done[done.length - 1] : done[stop - 1];
      const order = seenOrder.indexOf(m.name);
      const when = order >= 0 ? lastAt + 1 + order : upTo ? upTo[1] + 1 : 0;
      insRead.run(room.id, m.id, company, store, upTo ? upTo[0] : 0, at(Math.min(when, (Date.now() - anchor.getTime()) / 60e3 - 1)));
    }
    if (done.length) bump(db, room.id);
  };

  for (const [key, messages] of Object.entries(script.channels || {})) {
    const room = db.prepare('SELECT * FROM chat_rooms WHERE store_id = ? AND key = ?').get(store, key);
    if (room) play(room, messages, script.seen?.[key]);
  }
  for (const dm of script.dms || []) {
    const [a, b] = dm.between.map(id);
    if (!a || !b) continue;
    const key = `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
    db.prepare('INSERT OR IGNORE INTO chat_rooms(company_id, store_id, key, kind, created_at) VALUES (?,?,?,?,?)').run(company, store, key, 'dm', at(-3 * 24 * 60));
    play(db.prepare('SELECT * FROM chat_rooms WHERE store_id = ? AND key = ?').get(store, key), dm.messages);
  }
  for (const [key, names] of Object.entries(script.mute || {})) {
    const room = db.prepare('SELECT * FROM chat_rooms WHERE store_id = ? AND key = ?').get(store, key);
    for (const n of names) if (room && id(n) && membersOf(room, members).some((m) => m.id === id(n))) db.prepare('INSERT OR IGNORE INTO chat_mutes(room_id, user_id, company_id, store_id, at) VALUES (?,?,?,?,?)').run(room.id, id(n), company, store, now());
  }
  if (until) {
    for (const n of script.online || []) if (id(n)) db.prepare('UPDATE users SET online_until = ? WHERE id = ?').run(until, id(n));
    // the rest were last in a few hours ago, so they show as off (and People says when they last opened the app)
    members.filter((m) => !(script.online || []).includes(m.name)).forEach((m, i) => db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date(Date.now() - (2 + i) * 3600e3).toISOString(), m.id));
  }
}

/** The Baldwin demo's chat (Figma 580:670), told with the demo's own menu: its pork chop and Paloma Verde stand in for the
 *  design's short rib and Paloma, so every card opens a page the demo really has. Times are minutes from 3:30 pm. */
const R = 'Rosalind Hart', DP = 'Dorian Pike', QA = 'Quinn Abbott', TL = 'Teddy Lam', MV = 'Marisol Vega', HG = 'Hollis Grant', OR = 'Odalys Ruiz', WC = 'Wynn Carver';
const GA = 'Gideon Ambrose'; // The Baldwin's owner (Nov 11): a second manager, so a progress card has somewhere to go
export const BALDWIN_DEMO_CHAT = {
  channels: {
    everyone: [
      { ref: 'sched', by: R, at: -26 * 60, body: 'Next week’s schedule is up by the host stand. Shift swaps go through me by Friday.', react: { '👍': [DP, TL, OR, WC] } },
      { by: HG, at: -25 * 60, reply: 'sched', body: 'Got it, thank you.' },
      { ref: 'walkin', by: R, at: -45, body: 'Deep clean of the walk-in is Sunday after brunch. Two people from front of house, please.', react: { 'Heard': [DP, OR, MV], '🙏': [TL] } },
      { by: QA, at: 10, reply: 'walkin', body: 'I can stay Sunday.', unreadBy: [R] },
      { by: WC, at: 15, reply: 'walkin', body: 'Me too.', unreadBy: [R] },
    ],
    foh: [
      { by: R, at: -3 * 24 * 60 + 10, body: 'Two gluten allergies on the books for the weekend. Know the guide before you go on the floor.', page: 'allergen-guide', react: { '👍': [TL, OR, MV] } },
      { by: R, at: -24 * 60 + 15, body: 'Tomorrow’s focus dish, if you want a head start.', page: 'recipe/bone-in-pork-chop', react: { '🔥': [DP, MV] } },
      { by: R, at: 0, pin: true, body: 'Focus dish: Bone-In Pork Chop. We taste it at lineup, 4:15.\n86 tonight: seared salmon. Offer the lobster tagliatelle.\nBar: Paloma Verde spec changed. Read the page before your first one.\n7:30, back room: 12-top, two gluten allergies.',
        gotIt: [DP, QA, TL, OR, WC] },
      { by: R, at: 4, body: 'Chef’s plate for tonight. The chop sits on the polenta, and the mostarda goes on at the pass.', photo: '/img/demo/bone-in-pork-chop.jpg',
        react: { '🔥': [R, DP, QA, TL, OR], 'Heard': [HG, MV, WC], 'Yes Chef': [DP, GA] } },
      { ref: 'spec', by: DP, at: 11, body: 'Paloma Verde spec changed today. Check the build before you make your first one. The page is updated.', page: 'signature/paloma-verde', react: { '✅': [QA, TL, MV, OR], '👍': [R, HG] } },
      // a thread under the spec change (v2): three replies, the last Quinn's at 3:48
      { by: TL, at: 12, thread: 'spec', body: 'Does the salt rim stay?' },
      { by: DP, at: 13, thread: 'spec', body: 'Half rim now, and the grapefruit wheel goes on top.', react: { '👍': [TL] } },
      { by: QA, at: 18, thread: 'spec', body: 'Made two at the bar. Tastes right.', react: { '🔥': [DP, TL] } },
      { ref: 'friday', by: TL, at: 22, body: 'Can anyone take my Friday close? Family thing.', unreadBy: [MV] },
      { by: TL, at: 22.4, body: 'I can pick up Sunday brunch for you.', unreadBy: [MV] },
      { by: R, at: 23, body: '@[Marisol Vega] you asked for more hours this week. Want Teddy’s Friday close?', react: { '👀': [TL] }, unreadBy: [MV] },
      // the employee demo is Marisol's own view: she hasn't answered yet, so the @mention is waiting for her on Home
      { by: MV, at: 25, reply: 'friday', only: 'manager', body: 'I’ve got Friday, Teddy.', react: { '🙏': [TL, OR], 'Hands': [DP] }, unreadBy: [R] },
    ],
    bar: [
      { by: R, at: -50, body: 'Bar inventory is Sunday at 10. Dorian and Quinn, plan on an hour.', react: { 'Heard': [DP, QA] } },
      { by: QA, at: 6, body: '@[Rosalind Hart] we’re low on grapefruit soda for the Paloma Verde. Using the backup case from dry storage.', unreadBy: [R] },
      { by: DP, at: 14, body: 'Juice is batched: lime and lemon, two quarts each.', react: { '✅': [QA] }, unreadBy: [R] },
      { by: QA, at: 20, body: 'Espresso for the Espresso Negroni is pulled fresh. Good until close.', page: 'signature/espresso-negroni', unreadBy: [R] },
    ],
    kitchen: [
      { by: GA, at: -40, body: 'New allergen sheet is up on the pass. Every plate gets checked against it before it goes.' },
      { by: GA, at: 9, body: 'Walk-in temperature log is done for today: 36°F.', unreadBy: [R] },
    ],
  },
  seen: { foh: [HG, DP, TL, WC, OR, QA] },
  mute: { kitchen: [R] }, // Rosalind keeps #kitchen muted, so it shows quiet in her list
  online: [GA, R, DP, MV, TL], // on now (the design's Members panel); Quinn, Hollis, Odalys and Wynn are off
  dms: [
    { between: [R, TL], messages: [
      { by: R, at: 24, body: 'I asked Marisol about your Friday close. I’ll update the schedule once it’s settled.' },
      { by: TL, at: 28, body: 'Thank you! Sunday brunch is mine.', unreadBy: [R] },
    ] },
    { between: [R, OR], messages: [
      { by: R, at: -100, body: 'Welcome to the team, Odalys. Your first week is in My Path. Start with Our Story.' },
      { by: OR, at: -76, body: 'Is lineup at 4:15 on Fridays too?', unreadBy: [R] },
    ] },
    { between: [R, QA], messages: [
      { by: QA, at: -24 * 60 - 40, body: 'Passed the Level 2 final, 54 of 60. Can I do the practical this week?' },
      { by: R, at: -24 * 60 - 20, body: 'Great work on the Level 2 final. Let’s do the practical Thursday before service.' },
    ] },
    { between: [R, HG], messages: [
      { by: HG, at: -2 * 24 * 60 - 60, body: 'Sorry I’m behind on my path. Busy week at school.' },
      { by: R, at: -2 * 24 * 60 - 30, body: 'No problem. Let’s finish Steps of Service by Friday.' },
    ] },
    { between: [MV, TL], messages: [
      { by: TL, at: 26, body: 'If you can take Friday, I owe you one. Thank you!', unreadBy: [MV] },
    ] },
    { between: [GA, R], messages: [
      { by: GA, at: -24 * 60 - 150, body: 'How’s Hollis doing on the host path?' },
      { by: R, at: -24 * 60 - 140, body: 'Behind on the host quiz. I gave him until Friday.', person: HG },
      { by: GA, at: -24 * 60 - 130, body: 'Thanks. Let me know if he needs a shift shadowing Odalys.' },
    ] },
    { between: [R, MV], messages: [
      { by: R, at: -24 * 60 - 90, body: 'Nice work on the Level 1 final. Level 2 whenever you’re ready.' },
      { by: MV, at: -24 * 60 - 80, body: 'Thank you! Starting it this week.' },
    ] },
  ],
};

/** Wrenfield's chat (the Mise demo, Nov 11, Tommy: "make sure both styles have all the same functions and features"): the
 *  same conversation as The Baldwin's demo, told with Wrenfield's menu: its wood-grilled half chicken, the Smoke Signal
 *  spec change and the Hibiscus Daiquiri, so every card opens a page Wrenfield's book has. Same cast, same times. */
export const WRENFIELD_DEMO_CHAT = {
  channels: {
    everyone: [
      { ref: 'sched', by: R, at: -26 * 60, body: 'Next week’s schedule is up by the host stand. Shift swaps go through me by Friday.', react: { '👍': [DP, TL, OR, WC] } },
      { by: HG, at: -25 * 60, reply: 'sched', body: 'Got it, thank you.' },
      { ref: 'walkin', by: R, at: -45, body: 'Deep clean of the walk-in is Sunday after brunch. Two people from front of house, please.', react: { 'Heard': [DP, OR, MV], '🙏': [TL] } },
      { by: QA, at: 10, reply: 'walkin', body: 'I can stay Sunday.', unreadBy: [R] },
      { by: WC, at: 15, reply: 'walkin', body: 'Me too.', unreadBy: [R] },
    ],
    foh: [
      { by: R, at: -3 * 24 * 60 + 10, body: 'Two shellfish allergies on the books for the weekend. Know the guide before you go on the floor.', page: 'allergen-guide', react: { '👍': [TL, OR, MV] } },
      { by: R, at: -24 * 60 + 15, body: 'Tomorrow’s focus dish, if you want a head start.', page: 'recipe/wood-grilled-half-chicken', react: { '🔥': [DP, MV] } },
      { by: R, at: 0, pin: true, body: 'Focus dish: Wood-Grilled Half Chicken. We taste it at lineup, 4:15.\n86 tonight: seared scallops. Offer the braised lamb shank.\nBar: Smoke Signal spec changed. Read the page before your first one.\n7:30, The Nest: 12-top, two gluten allergies.',
        gotIt: [DP, QA, TL, OR, WC] },
      { by: R, at: 4, body: 'Chef’s plate for tonight. The chicken sits on the crispy potatoes, and the salsa verde goes on at the pass.', photo: '/img/demo-mise/wood-grilled-half-chicken.jpg',
        react: { '🔥': [R, DP, QA, TL, OR], 'Heard': [HG, MV, WC], 'Yes Chef': [DP, GA] } },
      { ref: 'spec', by: DP, at: 11, body: 'Smoke Signal spec changed today. Check the build before you make your first one. The page is updated.', page: 'signature/smoke-signal', react: { '✅': [QA, TL, MV, OR], '👍': [R, HG] } },
      // a thread under the spec change (v2): three replies, the last Quinn's at 3:48
      { by: TL, at: 12, thread: 'spec', body: 'Does the smoked salt rim stay?' },
      { by: DP, at: 13, thread: 'spec', body: 'Half rim now, and the grapefruit peel goes on top.', react: { '👍': [TL] } },
      { by: QA, at: 18, thread: 'spec', body: 'Made two at the bar. Tastes right.', react: { '🔥': [DP, TL] } },
      { ref: 'friday', by: TL, at: 22, body: 'Can anyone take my Friday close? Family thing.', unreadBy: [MV] },
      { by: TL, at: 22.4, body: 'I can pick up Sunday brunch for you.', unreadBy: [MV] },
      { by: R, at: 23, body: '@[Marisol Vega] you asked for more hours this week. Want Teddy’s Friday close?', react: { '👀': [TL] }, unreadBy: [MV] },
      // the employee demo is Marisol's own view: she hasn't answered yet, so the @mention is waiting for her on Home
      { by: MV, at: 25, reply: 'friday', only: 'manager', body: 'I’ve got Friday, Teddy.', react: { '🙏': [TL, OR], 'Hands': [DP] }, unreadBy: [R] },
    ],
    bar: [
      { by: R, at: -50, body: 'Bar inventory is Sunday at 10. Dorian and Quinn, plan on an hour.', react: { 'Heard': [DP, QA] } },
      { by: QA, at: 6, body: '@[Rosalind Hart] we’re low on grapefruit for the Smoke Signal peels. Using the backup case from the walk-in.', unreadBy: [R] },
      { by: DP, at: 14, body: 'Juice is batched: lime and lemon, two quarts each.', react: { '✅': [QA] }, unreadBy: [R] },
      { by: QA, at: 20, body: 'Hibiscus syrup for the Hibiscus Daiquiri is made fresh. Good until close.', page: 'signature/hibiscus-daiquiri', unreadBy: [R] },
    ],
    kitchen: [
      { by: GA, at: -40, body: 'New allergen sheet is up on the pass. Every plate gets checked against it before it goes.' },
      { by: GA, at: 9, body: 'Walk-in temperature log is done for today: 36°F.', unreadBy: [R] },
    ],
  },
  seen: { foh: [HG, DP, TL, WC, OR, QA] },
  mute: { kitchen: [R] }, // Rosalind keeps #kitchen muted, so it shows quiet in her list
  online: [GA, R, DP, MV, TL], // on now (the design's Members panel); Quinn, Hollis, Odalys and Wynn are off
  dms: BALDWIN_DEMO_CHAT.dms, // the direct messages don’t name the menu, so both demos share them
};

