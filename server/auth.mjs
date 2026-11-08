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
  return db.prepare(`SELECT u.*, s.impersonator_id, s.acting_company_id, s.acting_store_id, c.name company_name
      FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL AND (u.company_id IS NULL OR c.deleted_at IS NULL)`)
    .get(sha256(token), now()) || null;
}

export function endSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function sessionCookie(token, { secure = false, clear = false, days = SESSION_DAYS } = {}) {
  const parts = [`${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${days * 86400}`];
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
