// Passwords (scrypt), hash-only session tokens, login rate limiting.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { now } from './db.mjs';

const N = 16384, R = 8, P = 1, KEYLEN = 64;
export const SESSION_COOKIE = 'bt_session';
export const SESSION_DAYS = 14;

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

export function createSession(db, userId) {
  const token = newToken();
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), userId, now(), new Date(Date.now() + SESSION_DAYS * 864e5).toISOString());
  return token;
}

export function sessionUser(db, token) {
  if (!token) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .get(sha256(token), now()) || null;
}

export function endSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function sessionCookie(token, { secure = false, clear = false } = {}) {
  const parts = [`${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** 8 tries per email+IP per 15 minutes. */
export class LoginLimiter {
  constructor(max = 8, windowMs = 15 * 60_000) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  check(key) { const t = Date.now(); const l = (this.hits.get(key) || []).filter((x) => t - x < this.windowMs); this.hits.set(key, l); return l.length < this.max; }
  record(key) { const l = this.hits.get(key) || []; l.push(Date.now()); this.hits.set(key, l); }
  reset(key) { this.hits.delete(key); }
}

/** Public shape of a user. Never includes password_hash. */
export const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role };
