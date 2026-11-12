// Passwords (scrypt), hash-only session tokens, login rate limiting.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { now } from './db.mjs';

const N = 16384, R = 8, P = 1, KEYLEN = 64;
export const SESSION_COOKIE = 'bt_session';
export const SESSION_DAYS = 14;
/** Staff stay signed in on their phone for 90 days; everyone else 14. */
export const sessionDays = (role) => (role === 'staff' ? 90 : SESSION_DAYS);

const scryptAsync = (pw, salt, n, r, p) =>
  new Promise((res, rej) => scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: 256 * n * r }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(String(password), Buffer.from(salt, 'base64'), +n, +r, +p);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let dummy;
/** Unknown emails still pay the scrypt cost, so timing doesn't reveal which emails exist. */
export async function burnPasswordCheck(pw) {
  dummy ??= await hashPassword('not-a-real-password');
  await verifyPassword(pw, dummy);
}

export const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function createSession(db, userId, { days = SESSION_DAYS, impersonator = null, acting = null } = {}) {
  const token = newToken();
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,impersonator_id,acting_company_id) VALUES (?,?,?,?,?,?)')
    .run(sha256(token), userId, now(), new Date(Date.now() + days * 864e5).toISOString(), impersonator, acting);
  return token;
}

/** The signed-in person, with their session's support and acting-company details. Deleted people and companies are out. */
export function sessionUser(db, token) {
  if (!token) return null;
  return db.prepare(`SELECT u.*, s.impersonator_id, s.acting_company_id, s.acting_store_id, c.name company_name, c.demo demo
      FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL AND (u.company_id IS NULL OR c.deleted_at IS NULL)`)
    .get(sha256(token), now()) || null;
}

export function endSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

/** `embeddable` (demo sessions only, Nov 12): inside the portfolio's iframe a SameSite=Lax cookie is never sent, so the
 *  demo would start and then lose its session. SameSite=None + Partitioned keeps it to that one embedding site. Real
 *  accounts always stay SameSite=Lax. */
export function sessionCookie(token, { secure = false, clear = false, days = SESSION_DAYS, embeddable = false } = {}) {
  const site = embeddable && secure ? ['SameSite=None', 'Partitioned'] : ['SameSite=Lax'];
  const parts = [`${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', ...site,
    clear ? 'Max-Age=0' : `Max-Age=${days * 86400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** A real (non-demo) session cookie, plus an expired demo cookie on https so a demo started in this browser can't
 *  leave a second session cookie of the same name behind (Nov 12). */
export function sessionCookies(token, opts = {}) {
  const c = sessionCookie(token, opts);
  return opts.secure ? [c, sessionCookie('', { clear: true, secure: true, embeddable: true })] : c;
}

/** 8 tries per email+IP per 15 minutes. */
/** Attempts per key in a time window. Nov 10 (audit): named limiters keep their count in the database once useDb() is
 *  called, so a redeploy doesn't clear a lockout (5 wrong PINs, too many sign-ins). Unnamed ones stay in memory. */
export class LoginLimiter {
  static db = null;
  static useDb(db) {
    db.exec('CREATE TABLE IF NOT EXISTS limits(name TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL)');
    db.exec('CREATE INDEX IF NOT EXISTS limits_key ON limits(name, key, at)');
    LoginLimiter.db = db;
  }
  constructor(max = 8, windowMs = 15 * 60_000, name = null) { this.max = max; this.windowMs = windowMs; this.name = name; this.hits = new Map(); }
  get #db() { return this.name ? LoginLimiter.db : null; }
  check(key) {
    const t = Date.now(), db = this.#db;
    if (db) return db.prepare('SELECT COUNT(*) n FROM limits WHERE name = ? AND key = ? AND at > ?').get(this.name, String(key), t - this.windowMs).n < this.max;
    const l = (this.hits.get(key) || []).filter((x) => t - x < this.windowMs); this.hits.set(key, l); return l.length < this.max;
  }
  record(key) {
    const t = Date.now(), db = this.#db;
    if (db) { db.prepare('INSERT INTO limits(name, key, at) VALUES (?,?,?)').run(this.name, String(key), t); if (Math.random() < 0.02) db.prepare('DELETE FROM limits WHERE at < ?').run(t - 24 * 3600e3); return; }
    const l = this.hits.get(key) || []; l.push(t); this.hits.set(key, l);
  }
  reset(key) { const db = this.#db; if (db) db.prepare('DELETE FROM limits WHERE name = ? AND key = ?').run(this.name, String(key)); else this.hits.delete(key); }
}

/** Public shape of a user. Never includes password, PIN or two-step secrets. */
export const publicUser = (u) => u && {
  id: u.id, name: u.name, email: u.email, role: u.role, companyId: u.company_id ?? null, companyName: u.company_name ?? null,
  totpOn: !!u.totp_on, superPrimary: !!u.super_primary, impersonatedBy: u.impersonator_id ?? null, storeId: u.store_id ?? null,
};

/* ---- Two-step sign-in (TOTP, RFC 6238: 6 digits, 30 s steps, SHA-1, the usual authenticator apps) ---- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newTotpSecret = () => { const b = randomBytes(20); let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; };
function base32(s) { let bits = ''; for (const ch of String(s).replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(ch); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
export function totpAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
/** True if `code` matches now, or one step either side (clock drift). */
export function verifyTotp(secret, code) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return false;
  const step = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => timingSafeEqual(Buffer.from(totpAt(secret, step + d)), Buffer.from(c)));
}
export const otpauthUrl = (secret, email) => `otpauth://totp/${encodeURIComponent('Mise:' + email)}?secret=${secret}&issuer=${encodeURIComponent('Mise')}&digits=6&period=30`;

/** Join codes: 8 letters and digits, no look-alikes (0/O, 1/I/L). */
export const newJoinCode = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = randomBytes(8); return [...b].map((x) => A[x % A.length]).join(''); };
