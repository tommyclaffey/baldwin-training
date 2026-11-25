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
import { pruneOldCopies } from './files.mjs';

const BACKUPS = path.join(DATA_DIR, 'backups');
export const KEEP_DAYS = 14; // daily snapshots, and (Nov 16) the copies taken before a change
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });

export function initOps(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS errors(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, path TEXT, message TEXT NOT NULL,
    stack TEXT, user_id INT, count INT NOT NULL DEFAULT 1, first_at TEXT NOT NULL, last_at TEXT NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS errors_last ON errors(last_at)');
  const tick = () => {
    try { dailySnapshot(db); } catch (e) { logError(db, 'server', 'backup', e); }
    try { pruneErrors(db); } catch (e) { console.error('prune errors', e); }
    try { pruneOpsRuns(db); } catch (e) { console.error('prune ops runs', e); }
    try { pruneOldCopies(KEEP_DAYS); } catch (e) { logError(db, 'server', 'prune copies', e); }
  };
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

/** The error log keeps 90 days (Nov 15): older rows go, so it can't grow without end. */
export const ERROR_DAYS = 90;
export function pruneErrors(db, days = ERROR_DAYS) {
  return Number(db.prepare('DELETE FROM errors WHERE last_at < ?').run(new Date(Date.now() - days * 864e5).toISOString()).changes);
}

/* ---- What the HQ home's Health card reads (Nov 16, Figma 699:880) ---- */

/** The newest daily snapshot on the volume: { file, day, at (its file time), bytes }, or null when there's none yet. */
export function latestSnapshot(dir = BACKUPS) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /^daily-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort(); } catch { return null; }
  const f = names.at(-1);
  if (!f) return null;
  try { const st = fs.statSync(path.join(dir, f)); return { file: f, day: f.slice(6, 16), at: new Date(st.mtimeMs).toISOString(), bytes: st.size }; } catch { return null; }
}
/** One off-site copy or hourly check, as it happened (migration 22, ops_runs). */
export function recordOps(db, kind, { ok = true, bytes = null, detail = null } = {}) {
  try { db.prepare('INSERT INTO ops_runs(kind, at, ok, bytes, detail) VALUES (?,?,?,?,?)').run(kind, new Date().toISOString(), ok ? 1 : 0, bytes, detail); }
  catch (e) { console.error('recordOps', e); }
}
/** The last time each kind ran: { backup, files, health } → { at, ok, bytes, detail } | null. Also the last one that worked. */
export function lastOps(db) {
  const out = {};
  for (const kind of ['backup', 'files', 'health']) {
    const last = db.prepare('SELECT at, ok, bytes, detail FROM ops_runs WHERE kind = ? ORDER BY at DESC, id DESC LIMIT 1').get(kind) || null;
    const good = last && !last.ok ? db.prepare('SELECT at, ok, bytes, detail FROM ops_runs WHERE kind = ? AND ok = 1 ORDER BY at DESC, id DESC LIMIT 1').get(kind) || null : last;
    out[kind] = last ? { at: last.at, ok: !!last.ok, bytes: last.bytes, detail: last.detail, lastGoodAt: good?.at ?? null } : null;
  }
  return out;
}
export function pruneOpsRuns(db, days = ERROR_DAYS) {
  return Number(db.prepare('DELETE FROM ops_runs WHERE at < ?').run(new Date(Date.now() - days * 864e5).toISOString()).changes);
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
    // Nov 25: a problem someone saw keeps its latest detail (status, tries), so the log says what happened last time
    if (row) db.prepare(`UPDATE errors SET count = count + 1, last_at = ?${kind === 'seen' ? ', stack = ?' : ''} WHERE id = ?`).run(...(kind === 'seen' ? [at, stack, row.id] : [at, row.id]));
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

/** Nov 25 (Tommy: "get warned before staff do"): what someone was left looking at, reported by the app
 *  (src/lib/problems.ts). The words come from here, not from the browser; only fixed fields are read (never a PIN,
 *  password, email, code or token). Kind "seen" in the errors table. Returns { path, message, detail } or null. */
export const SEEN_MESSAGES = {
  index: 'Page list didn’t load',
  page: 'A page didn’t load',
  signin: 'Sign-in didn’t go through',
};
const SIGNIN_STEPS = {
  login: 'Sign In with email and password', code: 'Two-step code', choose: 'Choosing their own password', 'staff-login': 'Sign In with a PIN',
  'join-check': 'Checking a join code', join: 'Joining with a code', reset: 'Resetting a password', invite: 'Accepting an invite', forgot: 'Forgot Password',
};
/** An address with nothing secret in it: invite and reset tokens and join codes taken out, odd characters dropped. */
export function safeClientPath(p) {
  return String(p || '').split(/[?#]/)[0]
    .replace(/\/(invite|reset)\/[^/]+/g, '/$1/:token')
    .replace(/\/api\/join\/[^/]+/g, '/api/join/:code')
    .replace(/[^\w\-/.:~]/g, '')
    .slice(0, 200) || null;
}
export function seenProblem(b) {
  const message = Object.hasOwn(SEEN_MESSAGES, b?.event) ? SEEN_MESSAGES[b.event] : null;
  if (!message) return null;
  const status = Number.isInteger(b.status) && b.status >= 0 && b.status < 600 ? b.status : 0;
  if (b.event === 'signin' && status !== 0 && status < 500) return null; // a wrong PIN or password is not Mise breaking
  if (status === 401 || status === 403) return null;
  const bits = [];
  if (b.event === 'signin' && Object.hasOwn(SIGNIN_STEPS, b.step)) bits.push(SIGNIN_STEPS[b.step]);
  if (b.event === 'page' && typeof b.page === 'string' && /^[\w:.-]{1,40}$/.test(b.page)) bits.push(`Page ${b.page}`);
  bits.push(status === 0 ? 'No answer from Mise (no connection, or the server was restarting)'
    : status >= 500 ? `Mise answered ${status} (a server error)` : `Mise answered ${status}`);
  if (Number.isInteger(b.attempts) && b.attempts > 1 && b.attempts <= 10) bits.push(`after ${b.attempts} tries`);
  if (Number.isFinite(b.late) && b.late > 60_000) {
    const min = Math.round(Math.min(b.late, 7 * 864e5) / 60_000);
    bits.push(`sent ${min < 120 ? `${min} min` : `${Math.round(min / 60)} h`} later, once the device was back online`);
  }
  return { path: safeClientPath(b.path), message, detail: bits.join(' · ') };
}

/** Browser errors: 20 an hour per address, so a broken page can't flood the table. */
const clientHits = new Map();
export function clientErrorAllowed(ip) {
  const now = Date.now(); const h = (clientHits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (h.length >= 20) return false;
  h.push(now); clientHits.set(ip, h); return true;
}
