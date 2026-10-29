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
