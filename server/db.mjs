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

export function audit(db, userId, action, detail) {
  db.prepare('INSERT INTO audit(user_id,action,detail,at) VALUES (?,?,?,?)').run(userId ?? null, action, detail ? String(detail).slice(0, 500) : null, now());
}
