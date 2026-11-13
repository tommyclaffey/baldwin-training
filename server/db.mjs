// SQLite via node:sqlite. Migrations are keyed on PRAGMA user_version.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { watchContent } from './cache.mjs';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data'));
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const now = () => new Date().toISOString();

export const MIGRATIONS = [
  `
  CREATE TABLE users(
    id INTEGER PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','editor')), password_hash TEXT NOT NULL,
    created_at TEXT, last_seen_at TEXT);
  CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id INT NOT NULL, created_at TEXT, expires_at TEXT);
  CREATE TABLE invites(
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, role TEXT NOT NULL CHECK(role IN ('owner','editor')),
    created_by INT, created_at TEXT, expires_at TEXT, used_at TEXT);
  -- Edits to the designed pages: one row per changed node (text, photo or video).
  CREATE TABLE overrides(
    page_id TEXT NOT NULL, path TEXT NOT NULL, value TEXT NOT NULL, updated_by INT, updated_at TEXT,
    PRIMARY KEY(page_id, path));
  -- Recipes and cocktails added in the admin. data is JSON.
  CREATE TABLE items(
    id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('dish','cocktail')), slug TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL, created_by INT, created_at TEXT, updated_by INT, updated_at TEXT);
  CREATE TABLE media(
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('file','youtube')),
    title TEXT, file TEXT, mime TEXT, size INT, youtube_id TEXT, created_by INT, created_at TEXT);
  CREATE TABLE audit(id INTEGER PRIMARY KEY, user_id INT, action TEXT NOT NULL, detail TEXT, at TEXT);
  `,
  `
  -- Quiz attempts. Staff don't have accounts: a device id (random, stored on their phone) plus the name they type.
  CREATE TABLE quiz_attempts(
    id INTEGER PRIMARY KEY, device TEXT NOT NULL, name TEXT NOT NULL, quiz TEXT NOT NULL,
    score INT NOT NULL, total INT NOT NULL, answers TEXT NOT NULL, at TEXT);
  CREATE INDEX quiz_attempts_device ON quiz_attempts(device);
  -- A manager confirms a sign-off after the person plates it or describes it at the table.
  CREATE TABLE signoffs(
    device TEXT NOT NULL, quiz TEXT NOT NULL, by_user INT, at TEXT, PRIMARY KEY(device, quiz));
  `,
  `
  -- CMS pages: one row per page, built from its collection's template. data is JSON.
  CREATE TABLE entries(
    id INTEGER PRIMARY KEY, collection TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, data TEXT NOT NULL, sort REAL DEFAULT 0,
    seed_key TEXT UNIQUE, seed_hash TEXT, created_by INT, created_at TEXT, updated_by INT, updated_at TEXT);
  CREATE INDEX entries_collection ON entries(collection, sort);
  -- Seed pages someone deleted in the admin stay deleted.
  CREATE TABLE seed_removed(seed_key TEXT PRIMARY KEY);
  `,
  `
  -- Videos attached to wine pages ("Learn more about …") and to wines on the list. key = page slug or 'wine:<name>'.
  CREATE TABLE wine_videos(key TEXT PRIMARY KEY, video TEXT NOT NULL, note TEXT, updated_by INT, updated_at TEXT);
  `,
  `
  -- Floor Plan → Tonight's sections: who works which section, per night (restaurant's date). slot = 'Servers 1', 'Bar 2'…
  CREATE TABLE sections(day TEXT NOT NULL, slot TEXT NOT NULL, name TEXT NOT NULL, by_user INT, at TEXT, PRIMARY KEY(day, slot));
  `,
  `
  -- Accounts (Oct 28): companies; roles superadmin · owner · manager · staff. Baldwin is company 1.
  -- Super admins belong to no company. Staff sign in with their company's join code, their name and a PIN.
  CREATE TABLE companies(id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, join_code TEXT UNIQUE,
    created_at TEXT, deleted_at TEXT);
  INSERT INTO companies(id, name, slug, created_at) VALUES (1, 'Baldwin Restaurant Group', 'baldwin', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  CREATE TABLE users_new(
    id INTEGER PRIMARY KEY, company_id INT REFERENCES companies(id), email TEXT UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('superadmin','owner','manager','staff')),
    password_hash TEXT, pin_hash TEXT, totp_secret TEXT, totp_on INT NOT NULL DEFAULT 0, super_primary INT NOT NULL DEFAULT 0,
    created_at TEXT, last_seen_at TEXT, deleted_at TEXT);
  INSERT INTO users_new(id, company_id, email, name, role, password_hash, created_at, last_seen_at)
    SELECT id, 1, email, name, CASE role WHEN 'editor' THEN 'manager' ELSE role END, password_hash, created_at, last_seen_at FROM users;
  DROP TABLE users;
  ALTER TABLE users_new RENAME TO users;
  CREATE UNIQUE INDEX users_staff_name ON users(company_id, name COLLATE NOCASE) WHERE role = 'staff' AND deleted_at IS NULL;
  CREATE INDEX users_company ON users(company_id);
  CREATE TABLE invites_new(
    token_hash TEXT PRIMARY KEY, company_id INT, email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL CHECK(role IN ('superadmin','owner','manager')), created_by INT, created_at TEXT, expires_at TEXT, used_at TEXT);
  INSERT INTO invites_new SELECT token_hash, 1, email, CASE role WHEN 'editor' THEN 'manager' ELSE role END, created_by, created_at, expires_at, used_at FROM invites;
  DROP TABLE invites;
  ALTER TABLE invites_new RENAME TO invites;
  ALTER TABLE sessions ADD COLUMN impersonator_id INT;
  ALTER TABLE sessions ADD COLUMN acting_company_id INT;
  ALTER TABLE quiz_attempts ADD COLUMN company_id INT NOT NULL DEFAULT 1;
  ALTER TABLE quiz_attempts ADD COLUMN user_id INT;
  ALTER TABLE signoffs ADD COLUMN company_id INT NOT NULL DEFAULT 1;
  CREATE TABLE sections_new(company_id INT NOT NULL DEFAULT 1, day TEXT NOT NULL, slot TEXT NOT NULL, name TEXT NOT NULL, by_user INT, at TEXT,
    PRIMARY KEY(company_id, day, slot));
  INSERT INTO sections_new SELECT 1, day, slot, name, by_user, at FROM sections;
  DROP TABLE sections;
  ALTER TABLE sections_new RENAME TO sections;
  ALTER TABLE audit ADD COLUMN company_id INT;
  -- Content stays Baldwin's for now; the column is here so each company can get its own book later.
  ALTER TABLE entries ADD COLUMN company_id INT NOT NULL DEFAULT 1;
  ALTER TABLE overrides ADD COLUMN company_id INT NOT NULL DEFAULT 1;
  ALTER TABLE items ADD COLUMN company_id INT NOT NULL DEFAULT 1;
  ALTER TABLE media ADD COLUMN company_id INT NOT NULL DEFAULT 1;
  ALTER TABLE wine_videos ADD COLUMN company_id INT NOT NULL DEFAULT 1;
  `,
  `
  -- Stores (Oct 28): a company oversees one or more stores; each store has its own book (menu, cocktails, theme),
  -- staff, quiz records, sign-offs and sections. Baldwin Restaurant Group: The Baldwin (book ready), J.Baldwin's, Testa Barra.
  CREATE TABLE stores(id INTEGER PRIMARY KEY, company_id INT NOT NULL REFERENCES companies(id), name TEXT NOT NULL, slug TEXT NOT NULL,
    theme TEXT, book_ready INT NOT NULL DEFAULT 0, sort INT NOT NULL DEFAULT 0, created_at TEXT, deleted_at TEXT, UNIQUE(company_id, slug));
  INSERT INTO stores(id, company_id, name, slug, book_ready, sort, created_at) VALUES
    (1, 1, 'The Baldwin', 'the-baldwin', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    (2, 1, 'J.Baldwin''s', 'j-baldwins', 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    (3, 1, 'Testa Barra', 'testa-barra', 0, 2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  -- Staff belong to one store. Managers: one store, or NULL for every store. Owners: NULL (every store).
  ALTER TABLE users ADD COLUMN store_id INT;
  UPDATE users SET store_id = 1 WHERE role = 'staff' AND company_id = 1;
  ALTER TABLE invites ADD COLUMN store_id INT;
  ALTER TABLE sessions ADD COLUMN acting_store_id INT;
  ALTER TABLE quiz_attempts ADD COLUMN store_id INT;
  UPDATE quiz_attempts SET store_id = 1 WHERE company_id = 1;
  ALTER TABLE signoffs ADD COLUMN store_id INT;
  UPDATE signoffs SET store_id = 1 WHERE company_id = 1;
  CREATE TABLE sections_new(company_id INT NOT NULL DEFAULT 1, store_id INT NOT NULL DEFAULT 1, day TEXT NOT NULL, slot TEXT NOT NULL,
    name TEXT NOT NULL, by_user INT, at TEXT, PRIMARY KEY(store_id, day, slot));
  INSERT INTO sections_new SELECT company_id, 1, day, slot, name, by_user, at FROM sections WHERE company_id = 1;
  DROP TABLE sections;
  ALTER TABLE sections_new RENAME TO sections;
  ALTER TABLE media ADD COLUMN store_id INT;
  UPDATE media SET store_id = 1 WHERE company_id = 1;
  ALTER TABLE audit ADD COLUMN store_id INT;
  -- The book's content belongs to a store. Everything so far is The Baldwin's.
  ALTER TABLE entries ADD COLUMN store_id INT NOT NULL DEFAULT 1;
  ALTER TABLE overrides ADD COLUMN store_id INT NOT NULL DEFAULT 1;
  ALTER TABLE items ADD COLUMN store_id INT NOT NULL DEFAULT 1;
  ALTER TABLE wine_videos ADD COLUMN store_id INT NOT NULL DEFAULT 1;
  `,
  `
  -- Shared library (Oct 28): each store has its own entries, so a page address only has to be unique within a store.
  -- Classic cocktails are shared by every store (they stay on store 1, The Baldwin, which seeds them).
  CREATE TABLE entries_new(
    id INTEGER PRIMARY KEY, collection TEXT NOT NULL, slug TEXT NOT NULL, data TEXT NOT NULL, sort REAL DEFAULT 0,
    seed_key TEXT UNIQUE, seed_hash TEXT, created_by INT, created_at TEXT, updated_by INT, updated_at TEXT,
    company_id INT NOT NULL DEFAULT 1, store_id INT NOT NULL DEFAULT 1, UNIQUE(store_id, slug));
  INSERT INTO entries_new(id, collection, slug, data, sort, seed_key, seed_hash, created_by, created_at, updated_by, updated_at, company_id, store_id)
    SELECT id, collection, slug, data, sort, seed_key, seed_hash, created_by, created_at, updated_by, updated_at, company_id, store_id FROM entries;
  DROP TABLE entries;
  ALTER TABLE entries_new RENAME TO entries;
  CREATE INDEX entries_collection ON entries(store_id, collection, sort);
  `,
  // 9 (Oct 28, Tommy: "archive instead of delete moving forward"): pages and media are archived, never deleted.
  `
  ALTER TABLE entries ADD COLUMN archived_at TEXT;
  ALTER TABLE entries ADD COLUMN archived_by INT;
  ALTER TABLE media ADD COLUMN archived_at TEXT;
  ALTER TABLE media ADD COLUMN archived_by INT;
  `,
  // 10 (Oct 30, Tommy: custom quizzes): a manager saves a quiz for the team: a name, its topics, how many questions.
  `
  CREATE TABLE quiz_sets(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT NOT NULL, name TEXT NOT NULL, topics TEXT NOT NULL,
    count INT NOT NULL, created_by INT, created_at TEXT, archived_at TEXT);
  `,
  // 11 (Oct 31, Tommy: "mark it red, yellow, green … a review queue"): how well each person knows each question.
  `
  CREATE TABLE quiz_marks(user_id INT NOT NULL, store_id INT NOT NULL, ref TEXT NOT NULL, mark TEXT NOT NULL, at TEXT NOT NULL,
    PRIMARY KEY(user_id, store_id, ref));
  `,
  // 12 (Oct 31, the Study Guide): which chapters each person has opened.
  `
  CREATE TABLE manual_reads(user_id INT NOT NULL, slug TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(user_id, slug));
  `,
  // 13 (Nov 5, Tommy: "give me the next set of questions without repeating"): the questions each person has had in each
  // quiz this round. New Questions skips them; once every question has come up (or they press Start Over) the round resets.
  `
  CREATE TABLE quiz_seen(user_id INT NOT NULL, store_id INT NOT NULL, quiz TEXT NOT NULL, ref TEXT NOT NULL, at TEXT NOT NULL,
    PRIMARY KEY(user_id, store_id, quiz, ref));
  `,
  // 14 (Nov 8, Tommy: "Let's work on the job paths"): each person's jobs (JSON list: server, bartender, host, support)
  // and the day they started, which the path's due dates count from. Page reads go in manual_reads as 'page:<slug>'.
  `
  ALTER TABLE users ADD COLUMN jobs TEXT;
  ALTER TABLE users ADD COLUMN started_on TEXT;
  `,
  // 15 (Nov 11, manager home + People, Figma 09 · Proposals → 24): acting on the row where a person shows up.
  //   signoff_requests: a staff member asks for a sign-off from My Path; a manager signs it off or says Not Yet.
  //   path_due: Give More Time moves one step's due date (the stage's date stays for everyone else).
  //   notes: a reminder or a congrats from a manager, shown on the person's My Path until they close it.
  `
  CREATE TABLE signoff_requests(user_id INT NOT NULL, store_id INT NOT NULL, company_id INT NOT NULL, key TEXT NOT NULL, at TEXT NOT NULL,
    declined_at TEXT, declined_by INT, note TEXT, PRIMARY KEY(user_id, store_id, key));
  CREATE TABLE path_due(user_id INT NOT NULL, store_id INT NOT NULL, company_id INT NOT NULL, step TEXT NOT NULL, due TEXT NOT NULL,
    by_user INT, at TEXT, PRIMARY KEY(user_id, store_id, step));
  CREATE TABLE notes(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT NOT NULL, user_id INT NOT NULL, kind TEXT NOT NULL,
    body TEXT NOT NULL, by_user INT, at TEXT NOT NULL, seen_at TEXT);
  CREATE INDEX notes_user ON notes(user_id, store_id);
  `,
  // 16 (Nov 11, Team Chat, Figma 09 · Proposals → 27: 580:670): one store's channels and direct messages.
  //   chat_rooms: a store's channels (key everyone · foh · bar · kitchen) and DMs (key dm:<low id>:<high id>). Who's in a
  //     channel is worked out from people's jobs each time (server/chat.mjs), so nothing here goes stale. rev goes up on
  //     every change, so a poll that finds the same rev gets a one-line answer.
  //   chat_messages: text, a photo, or a page from the book (JSON); reply_to for replies; pinned_* for pre-shift notes;
  //     removed_* instead of deleting ("message removed").
  //   chat_reactions, chat_reads (last message read, for unread counts and "seen by"), chat_gotit (the "Got It" tap).
  `
  CREATE TABLE chat_rooms(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL,
    rev INT NOT NULL DEFAULT 0, created_at TEXT, UNIQUE(store_id, key));
  CREATE TABLE chat_messages(id INTEGER PRIMARY KEY, room_id INT NOT NULL, company_id INT NOT NULL, store_id INT NOT NULL, user_id INT NOT NULL,
    body TEXT, photo TEXT, page TEXT, reply_to INT, created_at TEXT NOT NULL,
    pinned_at TEXT, pinned_by INT, pin_title TEXT, removed_at TEXT, removed_by INT);
  CREATE INDEX chat_messages_room ON chat_messages(room_id, id);
  CREATE INDEX chat_messages_store ON chat_messages(store_id, id);
  CREATE TABLE chat_reactions(message_id INT NOT NULL, user_id INT NOT NULL, emoji TEXT NOT NULL, company_id INT NOT NULL, store_id INT NOT NULL, at TEXT,
    PRIMARY KEY(message_id, user_id, emoji));
  CREATE TABLE chat_reads(room_id INT NOT NULL, user_id INT NOT NULL, company_id INT NOT NULL, store_id INT NOT NULL, last_read INT NOT NULL DEFAULT 0, at TEXT,
    PRIMARY KEY(room_id, user_id));
  CREATE TABLE chat_gotit(message_id INT NOT NULL, user_id INT NOT NULL, company_id INT NOT NULL, store_id INT NOT NULL, at TEXT,
    PRIMARY KEY(message_id, user_id));
  `,
  // 17 (Nov 11, Tommy: "make the chat similar to growth where you can select an item to populate in the chat"):
  //   mentions: the people a message @mentions, as a JSON list of user ids (the body holds them as <@id>, so a renamed
  //     person's old mentions still read right).
  //   person: a manager's progress card for someone on the team (JSON snapshot), only ever shown to managers.
  `
  ALTER TABLE chat_messages ADD COLUMN mentions TEXT;
  ALTER TABLE chat_messages ADD COLUMN person TEXT;
  `,
  // 18 (Nov 11, Tommy approved reset password): one-time links to pick a new password, for people who sign in with email.
  //   Made by an owner (Admin → People → Owners and Managers), a super admin (Super Admin → People), or sent by email from
  //   Forgot Password? when Resend is set up. Only the token's hash is kept; a link works once and expires in 24 hours.
  //   via: 'owner' | 'super' | 'email'. A new link for someone replaces their unused ones.
  `
  CREATE TABLE password_resets(token_hash TEXT PRIMARY KEY, user_id INT NOT NULL, company_id INT, created_by INT, via TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
  CREATE INDEX password_resets_user ON password_resets(user_id);
  `,
  // 19 (Nov 12, Tommy: "a garnish, syrup, and juice tracker … day over day, week over week, year over year"; Figma 09 ·
  //   Proposals → 31, 632:802; server/prep.mjs). One store's prep:
  //   prep_items: juices, syrups and garnishes. unit (qt · pt · oz · each · bottles), batch size, pars = JSON [Sun…Sat],
  //     shelf_days (0 = one shift, toss at close; NULL = not set), shelf_source NULL = "house standard · to confirm",
  //     match = JSON regexes for the house specs that use it, kept = JSON {weekday: day} for suggestions a manager kept.
  //     Archived, never deleted.
  //   prep_batches: each batch made (day = the store's Detroit date; use_by = the last day it's good, through close).
  //   prep_events: 'used' and 'waste' (reason expired · spilled · quality · other) against a batch, and 'ranout'.
  `
  CREATE TABLE prep_items(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT NOT NULL, name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('juice','syrup','garnish')), unit TEXT NOT NULL, batch REAL NOT NULL, pars TEXT NOT NULL,
    shelf_days INT, storage TEXT, shelf_note TEXT, shelf_source TEXT, shelf_lesson TEXT, ratio TEXT, recipe TEXT, recipe_lesson TEXT,
    yield_note TEXT, match TEXT, kept TEXT, sort REAL DEFAULT 0, seed_key TEXT, created_by INT, created_at TEXT, updated_by INT,
    updated_at TEXT, archived_at TEXT, archived_by INT);
  CREATE INDEX prep_items_store ON prep_items(store_id, sort);
  CREATE TABLE prep_batches(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT NOT NULL, item_id INT NOT NULL,
    amount REAL NOT NULL, remaining REAL NOT NULL, day TEXT NOT NULL, made_at TEXT NOT NULL, use_by TEXT, made_by INT, by_user INT, closed_at TEXT);
  CREATE INDEX prep_batches_item ON prep_batches(item_id, day);
  CREATE INDEX prep_batches_store ON prep_batches(store_id, day);
  CREATE TABLE prep_events(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT NOT NULL, item_id INT NOT NULL, batch_id INT,
    kind TEXT NOT NULL CHECK(kind IN ('used','waste','ranout')), amount REAL NOT NULL DEFAULT 0, reason TEXT, note TEXT,
    day TEXT NOT NULL, at TEXT NOT NULL, by_user INT);
  CREATE INDEX prep_events_store ON prep_events(store_id, day);
  CREATE INDEX prep_events_batch ON prep_events(batch_id);
  CREATE INDEX prep_events_item ON prep_events(item_id, day);
  `,
  // 20 (Nov 12, the shift count; Figma 09 · Proposals → 31b, 666:818; server/prep.mjs). Tommy: "log how many we have at the
  //   beginning of the shift … the amount that they walked in with and then the amount that they're prepping."
  //   prep_counts: one row per item each time someone counts it at the start of a shift (day = the store's Detroit date).
  //     amount = walked in with. tossed = what was past its use-by and logged as Expired waste at the count (not counted).
  //     Two counts in one day: the latest wins; the earlier gets replaced_at and stays as history.
  //     kept = 1 when a count higher than expected was kept on purpose ("Keep the count").
  //   Worked out by server/prep.mjs (recompute) every time a count, batch or waste changes, so reports read stored numbers:
  //     expected = what the shift before left if nothing was used (its starting with − its waste); high = amount > expected.
  //     For the shift this count starts (up to the next count): prepped (batches made from this day to the next count's day),
  //     wasted (waste logged from this count to the next), next_day, shifts (days spanned: 1, or more after a missed day),
  //     used = walked in + prepped − wasted − the next count (NULL until the next count, or when the next count is high).
  `
  CREATE TABLE prep_counts(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT NOT NULL, item_id INT NOT NULL,
    day TEXT NOT NULL, amount REAL NOT NULL, tossed REAL NOT NULL DEFAULT 0, at TEXT NOT NULL, by_user INT, replaced_at TEXT, kept INT NOT NULL DEFAULT 0,
    expected REAL, high INT NOT NULL DEFAULT 0, prepped REAL NOT NULL DEFAULT 0, wasted REAL NOT NULL DEFAULT 0, used REAL, next_day TEXT, shifts INT);
  CREATE INDEX prep_counts_item ON prep_counts(item_id, day);
  CREATE INDEX prep_counts_store ON prep_counts(store_id, day);
  `,
  // 21 (Nov 13, Team Chat v2, Figma 09 · Proposals → 27b, 681:833; Tommy: "love it, build all of it out"; server/chat.mjs).
  //   chat_messages.thread_id: a reply in the thread under that message; also_channel = 1 when it was sent to the channel too.
  //   chat_reactions.kind: 'emoji' or 'word' (the service words: 86'd, Heard, Behind, Corner, Hands, Yes Chef). Still one
  //     row per person per message per reaction.
  //   chat_mutes: a room someone muted (its unread leaves Team Chat's number; @mentions of them still count).
  //   users.online_until: holds someone "on now" in Team Chat until then (the demo's cast). Real people are on now when
  //     they were seen in the last 5 minutes (users.last_seen_at), so this stays empty for them.
  `
  ALTER TABLE chat_messages ADD COLUMN thread_id INT;
  ALTER TABLE chat_messages ADD COLUMN also_channel INT NOT NULL DEFAULT 0;
  CREATE INDEX chat_messages_thread ON chat_messages(thread_id);
  ALTER TABLE chat_reactions ADD COLUMN kind TEXT NOT NULL DEFAULT 'emoji';
  CREATE TABLE chat_mutes(room_id INT NOT NULL, user_id INT NOT NULL, company_id INT NOT NULL, store_id INT NOT NULL, at TEXT,
    PRIMARY KEY(room_id, user_id));
  ALTER TABLE users ADD COLUMN online_until TEXT;
  `,
];

export function openDb(file = path.join(DATA_DIR, 'baldwin.db')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  let v = db.prepare('PRAGMA user_version').get().user_version;
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
    v++;
  }
  migrateBrand(db);
  // The Hospitality Program's acknowledgments (Nov 11, server/acks.mjs): its own table, made here too, so a demo copy
  // can be seeded and dropped on any database (no migration number, like brand).
  db.exec(`CREATE TABLE IF NOT EXISTS program_acks(user_id INT NOT NULL, store_id INT NOT NULL, company_id INT, level TEXT NOT NULL,
    name TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(user_id, store_id, level))`);
  watchContent(db); // Nov 11: cached indexes and quiz pools drop the moment the book changes (server/cache.mjs)
  return db;
}

/** Brand per company (Nov 11, Tommy: a Mise demo beside The Baldwin's). 'baldwin' = The Baldwin's look (every company so
 *  far, and the default); 'mise' = the Mise Academy look. The front end gets it with the session and switches the skin on.
 *  Added by a column check, not a numbered migration, so it can't collide with a migration added on another branch. */
export const BRANDS = ['baldwin', 'mise'];
export function migrateBrand(db) {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  if (!cols.includes('brand')) db.exec("ALTER TABLE companies ADD COLUMN brand TEXT NOT NULL DEFAULT 'baldwin'");
}

export function audit(db, userId, action, detail, companyId = null) {
  db.prepare('INSERT INTO audit(user_id,action,detail,at,company_id) VALUES (?,?,?,?,?)').run(userId ?? null, action, detail ? String(detail).slice(0, 500) : null, now(), companyId);
}
