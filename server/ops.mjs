// Behind the scenes (Nov 10; audit; Tommy: "do the behind-the-scenes stuff too").
//   • Backups: a snapshot of the database every day on the volume (kept 14 days), and an encrypted copy that a nightly
//     GitHub Action pulls off Railway (.github/workflows/ops.yml), so losing the volume doesn't lose the data.
//   • Errors: every server error and browser error is written to the database, so nothing goes unnoticed after a
//     redeploy wipes the logs. The same nightly Action fails (and GitHub emails Tommy) when any came in.
// The ops endpoints need OPS_TOKEN (Railway variable + GitHub secret). Backups are encrypted with BACKUP_KEY;
// scripts/restore-backup.mjs turns one back into a database file.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createCipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DATA_DIR } from './db.mjs';

const BACKUPS = path.join(DATA_DIR, 'backups');
const KEEP_DAYS = 14;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });

export function initOps(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS errors(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, path TEXT, message TEXT NOT NULL,
    stack TEXT, user_id INT, count INT NOT NULL DEFAULT 1, first_at TEXT NOT NULL, last_at TEXT NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS errors_last ON errors(last_at)');
  const tick = () => { try { dailySnapshot(db); } catch (e) { logError(db, 'server', 'backup', e); } };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 3600_000).unref();
}

/** One snapshot a day on the volume; older than KEEP_DAYS are removed. */
export function dailySnapshot(db) {
  fs.mkdirSync(BACKUPS, { recursive: true });
  const file = path.join(BACKUPS, `daily-${today()}.db`);
  if (fs.existsSync(file)) return null;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const f of fs.readdirSync(BACKUPS)) {
    const m = /^daily-(\d{4}-\d{2}-\d{2})\.db$/.exec(f);
    if (m && new Date(m[1] + 'T12:00:00Z').getTime() < cutoff) fs.rmSync(path.join(BACKUPS, f));
  }
  return file;
}

/** A fresh snapshot, gzipped and encrypted (AES-256-GCM). Layout: "MISEBK1" · iv(12) · tag(16) · ciphertext. */
export function encryptedBackup(db) {
  const key = process.env.BACKUP_KEY;
  if (!key || key.length < 24) throw Object.assign(new Error('BACKUP_KEY is not set'), { status: 503 });
  fs.mkdirSync(BACKUPS, { recursive: true });
  const tmp = path.join(BACKUPS, `.pull-${Date.now()}-${randomBytes(4).toString('hex')}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp}'`);
    const gz = zlib.gzipSync(fs.readFileSync(tmp), { level: 9 });
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), iv);
    const body = Buffer.concat([c.update(gz), c.final()]);
    return Buffer.concat([Buffer.from('MISEBK1'), iv, c.getAuthTag(), body]);
  } finally { fs.rmSync(tmp, { force: true }); }
}

/** Errors: the same message on the same path counts up instead of piling up rows (per day). */
export function logError(db, kind, where, err, userId = null) {
  try {
    const message = String(err?.message || err || 'Unknown error').slice(0, 500);
    const stack = String(err?.stack || '').slice(0, 4000) || null;
    const at = new Date().toISOString();
    const row = db.prepare("SELECT id FROM errors WHERE kind = ? AND path IS ? AND message = ? AND substr(last_at,1,10) = substr(?,1,10)").get(kind, where || null, message, at);
    if (row) db.prepare('UPDATE errors SET count = count + 1, last_at = ? WHERE id = ?').run(at, row.id);
    else db.prepare('INSERT INTO errors(kind, path, message, stack, user_id, first_at, last_at) VALUES (?,?,?,?,?,?,?)').run(kind, where || null, message, stack, userId, at, at);
  } catch (e) { console.error('logError', e); }
}
export function recentErrors(db, hours = 24) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  return db.prepare('SELECT id, kind, path, message, count, first_at, last_at FROM errors WHERE last_at >= ? ORDER BY last_at DESC LIMIT 200').all(since);
}

/** Bearer OPS_TOKEN, compared in constant time. */
export function opsAllowed(req) {
  const want = process.env.OPS_TOKEN;
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!want || want.length < 24 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Browser errors: 20 an hour per address, so a broken page can't flood the table. */
const clientHits = new Map();
export function clientErrorAllowed(ip) {
  const now = Date.now(); const h = (clientHits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (h.length >= 20) return false;
  h.push(now); clientHits.set(ip, h); return true;
}
