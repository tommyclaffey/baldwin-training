// SQLite via node:sqlite. Migrations are keyed on PRAGMA user_version.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data'));
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const now = () => new Date().toISOString();

const MIGRATIONS = [
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
  return db;
}

export function audit(db, userId, action, detail, companyId = null) {
  db.prepare('INSERT INTO audit(user_id,action,detail,at,company_id) VALUES (?,?,?,?,?)').run(userId ?? null, action, detail ? String(detail).slice(0, 500) : null, now(), companyId);
}
