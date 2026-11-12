// Accounts: companies, people, sign-in, staff join codes, two-step sign-in, and the super admin.
//
// Roles
//   superadmin  Tommy and the teammates he adds. Belongs to no company; sees and changes everything (/api/super/*).
//               Two-step sign-in is required before the super admin area opens. Only the primary super admin adds or removes others.
//   owner       Runs a company: everything a manager can do, plus owners and managers.
//   manager     Edits the book, signs people off, manages staff and the join code.
//   staff       Reads the book and takes quizzes. Signs in with the company's join code, their name and a PIN.
//
// Stores: a company oversees one or more stores (Baldwin Restaurant Group: The Baldwin, J.Baldwin's, Testa Barra).
// Each store has its own book, staff, quiz records, sign-offs and sections. Staff belong to one store; a manager to one store
// or all of them; owners and super admins work in one store at a time and can switch.
// Every query about people is scoped to the signed-in person's company, and store-level records to their store.
import { audit, now } from './db.mjs';
import {
  hashPassword, verifyPassword, burnPasswordCheck, createSession, endSession, sessionCookie, sessionDays, LoginLimiter, publicUser,
  sha256, newToken, newTotpSecret, verifyTotp, otpauthUrl, newJoinCode,
} from './auth.mjs';
import { APP_URL, mailConfigured, sendMail, resetEmail } from './mail.mjs';
import { logError } from './ops.mjs';

const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
const STAFF_ROLES = new Set(['owner', 'manager', 'superadmin']);

const loginLimiter = new LoginLimiter(8, 15 * 60_000, 'login');
const codeLimiter = new LoginLimiter(30, 15 * 60_000, 'join-code'); // join-code lookups per address
const pinLimiter = new LoginLimiter(5, 15 * 60_000, 'pin'); // wrong PINs per person
const tickets = new Map(); // two-step sign-in: ticket → { userId, at }
// Password reset (Nov 11): one-time links, 24 hours. Forgot Password? is limited per address and per email.
const RESET_HOURS = 24;
const forgotIpLimiter = new LoginLimiter(10, 60 * 60_000, 'forgot-ip');
const forgotEmailLimiter = new LoginLimiter(3, 60 * 60_000, 'forgot-email');
export const FORGOT_MESSAGE = 'If that email has an account, we’ve sent a reset link. No email? Ask an owner for a reset link.';

/** Startup: Baldwin has a join code, the super admin email is a super admin, and 30-day-old deletions are gone for good. */
export function bootAccounts(db) {
  for (const c of db.prepare('SELECT id FROM companies WHERE join_code IS NULL').all()) setJoinCode(db, c.id);
  // Every company has at least one store; staff and store-level records without a store go to the company's first store.
  for (const c of db.prepare('SELECT * FROM companies c WHERE NOT EXISTS (SELECT 1 FROM stores s WHERE s.company_id = c.id)').all()) addStore(db, c.id, c.name);
  for (const t of ['quiz_attempts', 'signoffs', 'media']) db.prepare(`UPDATE ${t} SET store_id = (SELECT id FROM stores s WHERE s.company_id = ${t}.company_id ORDER BY sort, id LIMIT 1) WHERE store_id IS NULL`).run();
  db.prepare("UPDATE users SET store_id = (SELECT id FROM stores s WHERE s.company_id = users.company_id ORDER BY sort, id LIMIT 1) WHERE role = 'staff' AND store_id IS NULL").run();
  if (SUPERADMIN_EMAIL) {
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(SUPERADMIN_EMAIL);
    const primary = db.prepare("SELECT 1 FROM users WHERE role = 'superadmin' AND super_primary = 1 AND deleted_at IS NULL").get();
    if (u && !primary) {
      db.prepare("UPDATE users SET role = 'superadmin', company_id = NULL, super_primary = 1, deleted_at = NULL WHERE id = ?").run(u.id);
      audit(db, u.id, 'super: became primary super admin', SUPERADMIN_EMAIL);
    }
  }
  purgeDeleted(db);
  setInterval(() => purgeDeleted(db), 12 * 3600e3).unref();
}
function setJoinCode(db, companyId) {
  for (let i = 0; i < 5; i++) {
    try { const code = newJoinCode(); db.prepare('UPDATE companies SET join_code = ? WHERE id = ?').run(code, companyId); return code; } catch { /* clash: try again */ }
  }
  throw new Error('Could not make a join code');
}
export function addStore(db, companyId, name) {
  let slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'store';
  while (db.prepare('SELECT 1 FROM stores WHERE company_id = ? AND slug = ?').get(companyId, slug)) slug += '-2';
  const sort = db.prepare('SELECT COUNT(*) n FROM stores WHERE company_id = ?').get(companyId).n;
  return Number(db.prepare('INSERT INTO stores(company_id, name, slug, sort, created_at) VALUES (?,?,?,?,?)').run(companyId, name, slug, sort, now()).lastInsertRowid);
}
export const storesOf = (db, companyId) => db.prepare('SELECT * FROM stores WHERE company_id = ? AND deleted_at IS NULL ORDER BY sort, id').all(companyId);
/** The store a person works in: their own (staff, store managers), or the one they switched to (owners, all-store managers, super admins). */
export function storeOf(db, u) {
  if (!u) return null;
  const company = companyOf(u);
  const stores = storesOf(db, company);
  const pick = (id) => stores.find((x) => x.id === id);
  return pick(u.store_id) || pick(u.acting_store_id) || stores[0] || null;
}
/** Can this person switch between their company's stores? */
export const switchesStores = (u) => !!u && (u.role === 'owner' || u.role === 'superadmin' || (u.role === 'manager' && !u.store_id));
const storeOut = (x) => x && { id: x.id, name: x.name, slug: x.slug, bookReady: !!x.book_ready };

/** Soft deletes are kept 30 days, then removed. */
export function purgeDeleted(db) {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  for (const c of db.prepare('SELECT id FROM companies WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff)) {
    for (const t of ['quiz_attempts', 'signoffs', 'sections', 'chat_messages', 'chat_reactions', 'chat_reads', 'chat_gotit', 'chat_rooms']) db.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(c.id);
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)').run(c.id);
    db.prepare('DELETE FROM users WHERE company_id = ?').run(c.id);
    db.prepare('DELETE FROM invites WHERE company_id = ?').run(c.id);
    db.prepare('DELETE FROM password_resets WHERE company_id = ?').run(c.id);
    db.prepare('DELETE FROM companies WHERE id = ?').run(c.id);
  }
  for (const u of db.prepare('SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff)) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  }
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(new Date(Date.now() - 7 * 864e5).toISOString());
}

/** The company a request works in: the person's own, or for a super admin the one they picked (Baldwin by default). */
export const companyOf = (u) => (u ? u.company_id ?? u.acting_company_id ?? 1 : null);
export const canEdit = (u) => !!u && STAFF_ROLES.has(u.role);

export function accountRoutes({ db, fail, sendJson, readJson, str, isSecure }) {
  const ip = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
  const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));
  const validPassword = (p) => String(p || '').length >= 10;
  const validPin = (p) => /^\d{4,6}$/.test(String(p || ''));
  const byId = (id) => db.prepare('SELECT u.*, c.name company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?').get(id);
  /** The signed-in person as the app sees them: role, company, and the store they're working in. */
  const meOut = (u) => ({
    ...publicUser(u), workingIn: companyOf(u), workingInName: companyRow(companyOf(u))?.name || null, demo: !!companyRow(u.company_id)?.demo,
    brand: companyRow(companyOf(u))?.brand === 'mise' ? 'mise' : 'baldwin', // Nov 11: the look follows the company
    store: storeOut(storeOf(db, u)), canSwitchStore: switchesStores(u), stores: switchesStores(u) ? storesOf(db, companyOf(u)).map(storeOut) : [],
  });
  const signIn = (res, req, user, opts = {}) => {
    const days = sessionDays(user.role);
    const token = createSession(db, user.id, { days, ...opts });
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), user.id);
    return sendJson(res, 200, { user: meOut({ ...byId(user.id), acting_company_id: opts.acting ?? null, impersonator_id: opts.impersonator ?? null }) }, { 'Set-Cookie': sessionCookie(token, { secure: isSecure(req), days }) });
  };
  const need = (c, req) => {
    if (!c.user) fail(401, 'Sign in first.');
    if (req.method !== 'GET' && req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
    return c.user;
  };
  /** A store manager only reaches their own store's people; owners, all-store managers and super admins reach the company. */
  const inScope = (actor, target) => {
    if (actor.company_id !== null && actor.company_id !== target.company_id) return false;
    if (actor.role === 'manager' && actor.store_id) return target.store_id === actor.store_id && target.role !== 'owner';
    return true;
  };
  const needManager = (c, req) => { const u = need(c, req); if (!canEdit(u)) fail(403, 'Only managers can do that.'); return u; };
  const needOwner = (c, req) => { const u = need(c, req); if (u.role !== 'owner' && u.role !== 'superadmin') fail(403, 'Only an owner can do that.'); return u; };
  // The super admin area doesn't exist for anyone else.
  const needSuper = (c, req) => {
    if (!c.user || c.user.role !== 'superadmin') fail(404, 'Not found.');
    need(c, req);
    if (c.user.impersonator_id) fail(404, 'Not found.');
    if (!c.user.totp_on) fail(403, 'Turn on two-step sign-in (Your Account) to open the super admin.');
    return c.user;
  };
  const companyRow = (id) => db.prepare('SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL').get(id);
  const staffByCode = (code) => {
    const c = db.prepare('SELECT * FROM companies WHERE join_code = ? AND deleted_at IS NULL').get(String(code || '').trim().toUpperCase());
    return c || null;
  };
  const superLog = (u, action, detail, companyId = null) => audit(db, u.id, 'super: ' + action, detail, companyId);
  const personOut = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, companyId: u.company_id, companyName: u.company_name ?? null,
    createdAt: u.created_at, lastSeenAt: u.last_seen_at, deletedAt: u.deleted_at, hasPin: !!u.pin_hash, totpOn: !!u.totp_on, superPrimary: !!u.super_primary });

  /* Password reset links (Nov 11). Only the hash is stored; a new link replaces the person's unused ones. */
  const makeReset = (t, by, via) => {
    const token = newToken();
    const expiresAt = new Date(Date.now() + RESET_HOURS * 3600e3).toISOString();
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(t.id);
    db.prepare('INSERT INTO password_resets(token_hash,user_id,company_id,created_by,via,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(sha256(token), t.id, t.company_id ?? null, by?.id ?? null, via, now(), expiresAt);
    return { token, link: `/admin/reset/${token}`, expiresAt, hours: RESET_HOURS };
  };
  /** A link that still works: not used, not expired, for someone who still signs in with email. */
  const resetRow = (token) => db.prepare(`SELECT r.*, u.name, u.email, u.role, u.totp_on, b.name by_name FROM password_resets r
      JOIN users u ON u.id = r.user_id LEFT JOIN companies c ON c.id = u.company_id LEFT JOIN users b ON b.id = r.created_by
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.deleted_at IS NULL AND u.role != 'staff' AND u.email IS NOT NULL
        AND (u.company_id IS NULL OR c.deleted_at IS NULL)`).get(sha256(String(token || '')), now());
  /** Can this person get a reset link at all? Owners, managers and super admins sign in with email; staff use a PIN. */
  const resettable = (t, actor) => {
    if (t.deleted_at) fail(400, 'Restore this person first.');
    if (t.role === 'staff' || !t.email) fail(400, 'Staff sign in with a PIN. Use Reset PIN instead.');
    if (t.id === actor.id) fail(400, 'Change your own password on Your Account.');
    if (t.company_id && !companyRow(t.company_id)) fail(400, 'Restore their company first.');
  };
  const resetOut = (t, r) => ({ link: r.link, expiresAt: r.expiresAt, hours: r.hours, name: t.name, email: t.email });

  return async function route(req, res, url, c) {
    const m = req.method, p = url.pathname, parts = p.split('/').filter(Boolean);

    /* ---- who's signed in ---- */
    if (p === '/api/me' && m === 'GET') {
      const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
      const superNeeded = !!SUPERADMIN_EMAIL && !db.prepare("SELECT 1 FROM users WHERE role = 'superadmin' AND deleted_at IS NULL").get();
      const me = c.user ? meOut(c.user) : null;
      return sendJson(res, 200, { user: me, setupNeeded: users === 0, superSetupNeeded: superNeeded });
    }

    /* ---- first accounts: the company owner (OWNER_EMAIL) and the primary super admin (SUPERADMIN_EMAIL) ---- */
    if (p === '/api/setup' && m === 'POST') {
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!str(b.name, 80)) fail(400, 'Add your name.');
      if (!validPassword(b.password)) fail(400, 'Use at least 10 characters for the password.');
      if (SUPERADMIN_EMAIL && email === SUPERADMIN_EMAIL && !db.prepare("SELECT 1 FROM users WHERE role = 'superadmin' AND deleted_at IS NULL").get()) {
        if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'That email already has an account. Sign in instead.');
        const r = db.prepare("INSERT INTO users(email,name,role,password_hash,super_primary,created_at) VALUES (?,?,'superadmin',?,1,?)").run(email, str(b.name, 80), await hashPassword(b.password), now());
        audit(db, Number(r.lastInsertRowid), 'super: setup', email);
        return signIn(res, req, byId(Number(r.lastInsertRowid)));
      }
      if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) fail(409, 'The owner account already exists. Sign in instead.');
      if (!OWNER_EMAIL) fail(503, 'Setup is off: OWNER_EMAIL isn’t set on the server.');
      if (email !== OWNER_EMAIL) fail(403, 'That email can’t set up this app. Use the owner’s email.');
      const r = db.prepare("INSERT INTO users(company_id,email,name,role,password_hash,created_at) VALUES (1,?,?,'owner',?,?)").run(OWNER_EMAIL, str(b.name, 80), await hashPassword(b.password), now());
      audit(db, Number(r.lastInsertRowid), 'setup', OWNER_EMAIL, 1);
      return signIn(res, req, byId(Number(r.lastInsertRowid)));
    }

    /* ---- email + password (owners, managers, super admins), then a code if two-step is on ---- */
    if (p === '/api/login' && m === 'POST') {
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      const key = email + '|' + ip(req);
      if (!loginLimiter.check(key)) fail(429, 'Too many tries. Wait 15 minutes, then try again.');
      const user = db.prepare("SELECT u.* FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.email = ? AND u.deleted_at IS NULL AND u.role != 'staff' AND (u.company_id IS NULL OR c.deleted_at IS NULL)").get(email);
      const ok = user && user.password_hash ? await verifyPassword(b.password, user.password_hash) : (await burnPasswordCheck(b.password), false);
      if (!ok) { loginLimiter.record(key); fail(401, 'That email and password don’t match.'); }
      loginLimiter.reset(key);
      if (user.totp_on) {
        const ticket = newToken();
        tickets.set(sha256(ticket), { userId: user.id, at: Date.now(), tries: 0 });
        return sendJson(res, 200, { needCode: true, ticket });
      }
      audit(db, user.id, 'login', null, user.company_id);
      return signIn(res, req, user);
    }
    if (p === '/api/login/code' && m === 'POST') {
      const b = await readJson(req);
      const t = tickets.get(sha256(String(b.ticket || '')));
      if (!t || Date.now() - t.at > 5 * 60e3) fail(410, 'That sign-in timed out. Enter your email and password again.');
      const user = byId(t.userId);
      if (!user || user.deleted_at || !verifyTotp(user.totp_secret, b.code)) {
        if (++t.tries >= 5) tickets.delete(sha256(String(b.ticket)));
        fail(401, 'That code isn’t right. Use the newest code in your authenticator app.');
      }
      tickets.delete(sha256(String(b.ticket)));
      audit(db, user.id, 'login', 'two-step', user.company_id);
      return signIn(res, req, user);
    }
    if (p === '/api/logout' && m === 'POST') {
      endSession(db, c.token);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', { clear: true, secure: isSecure(req) }) });
    }
    if (p === '/api/password' && m === 'POST') {
      const u = need(c, req);
      const b = await readJson(req);
      if (!u.password_hash || !(await verifyPassword(b.current, u.password_hash))) fail(400, 'Your current password isn’t right.');
      if (!validPassword(b.next)) fail(400, 'Use at least 10 characters for the new password.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(b.next), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, sha256(c.token));
      db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(u.id);
      audit(db, u.id, 'password', null, u.company_id);
      return sendJson(res, 200, { ok: true });
    }

    /* ---- Forgot Password? The same answer for every email, so nobody can find out which emails have accounts. ---- */
    if (p === '/api/password/forgot' && m === 'POST') {
      if (req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!validEmail(email)) fail(400, 'Enter a valid email address.');
      if (!forgotIpLimiter.check(ip(req))) fail(429, 'Too many tries. Wait an hour, then try again.');
      forgotIpLimiter.record(ip(req));
      const reply = () => sendJson(res, 200, { ok: true, message: FORGOT_MESSAGE });
      // A few emails an hour per address at most; past that, the same answer and nothing sent.
      if (!forgotEmailLimiter.check(email)) return reply();
      forgotEmailLimiter.record(email);
      const t = db.prepare(`SELECT u.* FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.email = ? AND u.deleted_at IS NULL
        AND u.role != 'staff' AND (u.company_id IS NULL OR (c.deleted_at IS NULL AND IFNULL(c.demo, 0) = 0))`).get(email);
      const tag = t?.role === 'superadmin' ? 'super: ' : '';
      if (!mailConfigured()) {
        console.log('[mail] Forgot Password asked for, but email isn’t set up (RESEND_API_KEY and MAIL_FROM). Nothing sent.');
        if (t) audit(db, t.id, tag + 'reset asked', 'email isn’t set up, so nothing was sent', t.company_id);
        return reply();
      }
      if (t) {
        const r = makeReset(t, null, 'email');
        audit(db, t.id, tag + 'reset email', null, t.company_id);
        // Not awaited: a real email shouldn't answer slower than an unknown one.
        // The restaurant's name in the email (Tommy, Nov 11): their store, else their company; the sender stays MAIL_FROM.
        const place = (t.store_id && db.prepare('SELECT name FROM stores WHERE id = ?').get(t.store_id)?.name)
          || (t.company_id && db.prepare('SELECT name FROM companies WHERE id = ?').get(t.company_id)?.name) || null;
        void sendMail({ to: t.email, ...resetEmail({ name: t.name, email: t.email, url: APP_URL + r.link, hours: r.hours, place }) })
          .catch((e) => { console.error('[mail] reset email failed', e.message); logError(db, 'server', '/api/password/forgot', e, t.id); });
      }
      return reply();
    }

    /* ---- a reset link: pick a new password, then you're signed in (two-step still asks for its code) ---- */
    if (parts[1] === 'reset' && parts[2] && !parts[3]) {
      const r = resetRow(parts[2]);
      if (m === 'GET') return sendJson(res, 200, r ? { valid: true, name: r.name, email: r.email, expiresAt: r.expires_at } : { valid: false });
      if (m === 'POST') {
        if (req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
        if (!r) fail(410, 'This reset link has expired or was already used. Ask for a new one.');
        const b = await readJson(req);
        if (!validPassword(b.password)) fail(400, 'Use at least 10 characters for the password.');
        const hash = await hashPassword(b.password);
        // Single use: whoever marks it used first wins (a second request in flight gets "already used").
        if (db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').run(now(), r.token_hash, now()).changes !== 1) {
          fail(410, 'This reset link has expired or was already used. Ask for a new one.');
        }
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, r.user_id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(r.user_id); // signed out everywhere else
        db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(r.user_id);
        loginLimiter.reset(r.email + '|' + ip(req));
        const how = r.via === 'email' ? 'from an email link' : `with a link from ${r.by_name || 'an owner'}`;
        audit(db, r.user_id, 'reset password', how, r.company_id);
        if (r.via === 'super' || r.role === 'superadmin') audit(db, r.user_id, 'super: reset password', how, r.company_id);
        const user = byId(r.user_id);
        if (user.totp_on) {
          const ticket = newToken();
          tickets.set(sha256(ticket), { userId: user.id, at: Date.now(), tries: 0 });
          return sendJson(res, 200, { needCode: true, ticket });
        }
        return signIn(res, req, user);
      }
    }

    /* ---- owners, all-store managers and super admins switch the store they're working in ---- */
    if (p === '/api/store' && m === 'POST') {
      const u = need(c, req);
      if (!switchesStores(u)) fail(403, 'You work in one store.');
      const b = await readJson(req);
      const st = db.prepare('SELECT * FROM stores WHERE id = ? AND deleted_at IS NULL').get(Number(b.storeId));
      if (!st || (u.role !== 'superadmin' && st.company_id !== u.company_id)) fail(404, 'We couldn’t find that store.');
      db.prepare('UPDATE sessions SET acting_store_id = ?, acting_company_id = CASE WHEN ? THEN ? ELSE acting_company_id END WHERE token_hash = ?')
        .run(st.id, u.role === 'superadmin' ? 1 : 0, st.company_id, sha256(c.token));
      return sendJson(res, 200, { store: storeOut(st) });
    }

    /* ---- staff: join code → store → name → PIN ---- */
    if (parts[1] === 'join' && parts[2] && m === 'GET') {
      if (!codeLimiter.check(ip(req))) fail(429, 'Too many tries. Wait 15 minutes, then try again.');
      const co = staffByCode(parts[2]);
      if (!co) { codeLimiter.record(ip(req)); fail(404, 'That join code isn’t right. Ask a manager for it.'); }
      const staff = db.prepare("SELECT id, name, pin_hash, store_id FROM users WHERE company_id = ? AND role = 'staff' AND deleted_at IS NULL ORDER BY name COLLATE NOCASE").all(co.id);
      return sendJson(res, 200, { company: co.name, stores: storesOf(db, co.id).map((x) => ({ id: x.id, name: x.name })), staff: staff.map((s) => ({ id: s.id, name: s.name, storeId: s.store_id, needsPin: !s.pin_hash })) });
    }
    if (p === '/api/join' && m === 'POST') {
      if (req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
      if (!codeLimiter.check(ip(req))) fail(429, 'Too many tries. Wait 15 minutes, then try again.');
      const b = await readJson(req);
      const co = staffByCode(b.code);
      if (!co) { codeLimiter.record(ip(req)); fail(404, 'That join code isn’t right. Ask a manager for it.'); }
      const name = str(b.name, 60).replace(/\s+/g, ' ');
      if (name.length < 2) fail(400, 'Add your first and last name.');
      if (!validPin(b.pin)) fail(400, 'Pick a PIN of 4 to 6 numbers.');
      const stores = storesOf(db, co.id);
      const store = stores.length === 1 ? stores[0] : stores.find((x) => x.id === Number(b.storeId));
      if (!store) fail(400, 'Pick the restaurant you work at.');
      if (db.prepare("SELECT 1 FROM users WHERE company_id = ? AND role = 'staff' AND name = ? COLLATE NOCASE AND deleted_at IS NULL").get(co.id, name)) fail(409, 'Someone with that name already joined. Pick your name from the list, or add your last initial.');
      const r = db.prepare("INSERT INTO users(company_id,store_id,name,role,pin_hash,created_at) VALUES (?,?,?,'staff',?,?)").run(co.id, store.id, name, await hashPassword(b.pin), now());
      audit(db, Number(r.lastInsertRowid), 'joined with the code', `${name} · ${store.name}`, co.id);
      return signIn(res, req, byId(Number(r.lastInsertRowid)));
    }
    if (p === '/api/staff-login' && m === 'POST') {
      if (req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
      const b = await readJson(req);
      const co = staffByCode(b.code);
      if (!co) fail(404, 'That join code isn’t right. Ask a manager for it.');
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND company_id = ? AND role = 'staff' AND deleted_at IS NULL").get(Number(b.id), co.id);
      if (!u) fail(404, 'We couldn’t find you. Pick your name again.');
      const key = 'pin|' + u.id;
      if (!pinLimiter.check(key)) fail(429, 'Too many wrong PINs. Wait 15 minutes, or ask a manager to reset your PIN.');
      if (!validPin(b.pin)) fail(400, 'Your PIN is 4 to 6 numbers.');
      if (!u.pin_hash) {
        // A manager reset this PIN: the person picks a new one now.
        db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashPassword(b.pin), u.id);
        audit(db, u.id, 'set a new PIN', null, co.id);
      } else if (!(await verifyPassword(b.pin, u.pin_hash))) {
        pinLimiter.record(key);
        fail(401, 'That PIN isn’t right.');
      }
      pinLimiter.reset(key);
      return signIn(res, req, u);
    }
    if (p === '/api/pin' && m === 'POST') {
      const u = need(c, req);
      if (u.role !== 'staff') fail(400, 'Only staff have a PIN.');
      const b = await readJson(req);
      if (!(await verifyPassword(b.current, u.pin_hash))) fail(400, 'Your current PIN isn’t right.');
      if (!validPin(b.next)) fail(400, 'Pick a PIN of 4 to 6 numbers.');
      db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashPassword(b.next), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, sha256(c.token));
      audit(db, u.id, 'changed PIN', null, u.company_id);
      return sendJson(res, 200, { ok: true });
    }

    /* ---- invites (owners and managers for a company; super admins for super admins) ---- */
    if (parts[1] === 'invite' && parts[2]) {
      const inv = db.prepare('SELECT i.*, c.name company_name FROM invites i LEFT JOIN companies c ON c.id = i.company_id WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(sha256(parts[2]), now());
      if (m === 'GET') return sendJson(res, 200, inv ? { valid: true, email: inv.email, role: inv.role, company: inv.company_name, store: inv.store_id ? db.prepare('SELECT name FROM stores WHERE id = ?').get(inv.store_id)?.name : null } : { valid: false });
      if (m === 'POST') {
        if (!inv) fail(410, 'This invite has expired or was already used. Ask for a new one.');
        const b = await readJson(req);
        if (!str(b.name, 80)) fail(400, 'Add your name.');
        if (!validPassword(b.password)) fail(400, 'Use at least 10 characters for the password.');
        if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(inv.email)) fail(409, 'That person already has an account.');
        db.prepare('DELETE FROM users WHERE email = ? AND deleted_at IS NOT NULL').run(inv.email);
        const r = db.prepare('INSERT INTO users(company_id,store_id,email,name,role,password_hash,created_at) VALUES (?,?,?,?,?,?,?)')
          .run(inv.role === 'superadmin' ? null : inv.company_id, inv.role === 'manager' ? inv.store_id ?? null : null, inv.email, str(b.name, 80), inv.role, await hashPassword(b.password), now());
        db.prepare('UPDATE invites SET used_at = ? WHERE token_hash = ?').run(now(), inv.token_hash);
        audit(db, Number(r.lastInsertRowid), inv.role === 'superadmin' ? 'super: joined as super admin' : 'joined', inv.email, inv.company_id);
        return signIn(res, req, byId(Number(r.lastInsertRowid)));
      }
    }
    const makeInvite = (u, email, role, companyId, storeId = null) => {
      const token = newToken();
      db.prepare('INSERT INTO invites(token_hash,company_id,email,role,created_by,created_at,expires_at,store_id) VALUES (?,?,?,?,?,?,?,?)')
        .run(sha256(token), companyId, email, role, u.id, now(), new Date(Date.now() + 14 * 864e5).toISOString(), storeId);
      return `/admin/invite/${token}`;
    };

    /* ---- a company's team (owners, managers, staff, join code) ---- */
    if (p === '/api/team' && m === 'GET') {
      const u = needManager(c, req);
      const cid = companyOf(u);
      const co = companyRow(cid);
      if (!co) fail(404, 'We couldn’t find that company.');
      const all = db.prepare("SELECT u.*, c.name company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.company_id = ? AND u.deleted_at IS NULL ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name COLLATE NOCASE").all(cid);
      // A store manager sees their store's people (and the owners); everyone else sees the whole company.
      const people = all.filter((x) => inScope(u, x) || x.role === 'owner');
      const passed = new Map(db.prepare('SELECT device, COUNT(*) n FROM signoffs WHERE company_id = ? GROUP BY device').all(cid).map((r) => [r.device, r.n]));
      const invites = db.prepare('SELECT substr(token_hash,1,16) id, email, role, store_id, created_at, expires_at FROM invites WHERE company_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC').all(cid, now());
      const stores = storesOf(db, cid);
      const storeName = new Map(stores.map((x) => [x.id, x.name]));
      return sendJson(res, 200, {
        company: { id: co.id, name: co.name, joinCode: co.join_code }, stores: stores.map(storeOut), yourStore: u.store_id ?? null,
        people: people.map((x) => ({ ...personOut(x), storeId: x.store_id ?? null, storeName: x.store_id ? storeName.get(x.store_id) || null : null, signedOff: passed.get('u' + x.id) || 0, canManage: x.id !== u.id && inScope(u, x) && (x.role === 'staff' || u.role === 'owner' || u.role === 'superadmin') })),
        invites: invites.map((i) => ({ ...i, storeName: i.store_id ? storeName.get(i.store_id) || null : null })), you: u.id, youRole: u.role,
      });
    }
    if (p === '/api/team/invite' && m === 'POST') {
      const u = needOwner(c, req);
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!validEmail(email)) fail(400, 'Enter a valid email address.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(email)) fail(409, 'That person already has an account.');
      const role = b.role === 'owner' ? 'owner' : 'manager';
      const store = role === 'manager' && b.storeId ? storesOf(db, companyOf(u)).find((x) => x.id === Number(b.storeId)) : null;
      if (role === 'manager' && b.storeId && !store) fail(404, 'We couldn’t find that store.');
      const link = makeInvite(u, email, role, companyOf(u), store?.id ?? null);
      audit(db, u.id, 'invite', `${email} · ${role}`, companyOf(u));
      return sendJson(res, 200, { link, email, role });
    }
    if (parts[1] === 'team' && parts[2] === 'invites' && parts[3] && m === 'DELETE') {
      const u = needOwner(c, req);
      db.prepare('DELETE FROM invites WHERE substr(token_hash,1,16) = ? AND company_id = ? AND used_at IS NULL').run(parts[3], companyOf(u));
      audit(db, u.id, 'cancel invite', parts[3], companyOf(u));
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/team/join-code' && m === 'POST') {
      const u = needManager(c, req);
      const code = setJoinCode(db, companyOf(u));
      audit(db, u.id, 'new join code', null, companyOf(u));
      return sendJson(res, 200, { joinCode: code });
    }
    if (parts[1] === 'team' && /^\d+$/.test(parts[2] || '')) {
      const u = needManager(c, req);
      const cid = companyOf(u);
      const t = db.prepare('SELECT * FROM users WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(parts[2]), cid);
      if (!t || !inScope(u, t)) fail(404, 'We couldn’t find that person.');
      // Owners (and super admins working in the company) make reset links for owners and managers. Managers can't:
      // like invites, role changes and removing people, owners and managers are an owner's call.
      if (parts[3] === 'reset-password' && m === 'POST') {
        if (u.role !== 'owner' && u.role !== 'superadmin') fail(403, 'Only an owner can make a reset link.');
        resettable(t, u);
        const r = makeReset(t, u, u.role === 'superadmin' ? 'super' : 'owner');
        audit(db, u.id, 'reset link', `${t.name} · ${t.email}`, cid);
        return sendJson(res, 200, resetOut(t, r));
      }
      if (parts[3] === 'reset-pin' && m === 'POST') {
        if (t.role !== 'staff') fail(400, 'Only staff have a PIN.');
        db.prepare('UPDATE users SET pin_hash = NULL WHERE id = ?').run(t.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
        audit(db, u.id, 'reset PIN', t.name, cid);
        return sendJson(res, 200, { ok: true });
      }
      if (m === 'PATCH') {
        const b = await readJson(req);
        if (b.role !== undefined) {
          if (u.role !== 'owner' && u.role !== 'superadmin') fail(403, 'Only an owner can change roles.');
          if (t.role === 'staff' || !['owner', 'manager'].includes(b.role)) fail(400, 'Owners and managers can switch between those two roles.');
          if (t.id === u.id) fail(400, 'Ask another owner to change your role.');
          db.prepare("UPDATE users SET role = ?, store_id = CASE WHEN ? = 'owner' THEN NULL ELSE store_id END WHERE id = ?").run(b.role, b.role, t.id);
          audit(db, u.id, 'change role', `${t.name} → ${b.role}`, cid);
        }
        if (b.storeId !== undefined) {
          if (!switchesStores(u)) fail(403, 'Only an owner or an all-store manager can move people between stores.');
          if (t.role === 'owner') fail(400, 'Owners oversee every store.');
          const st = b.storeId === null ? null : storesOf(db, cid).find((x) => x.id === Number(b.storeId));
          if (b.storeId !== null && !st) fail(404, 'We couldn’t find that store.');
          if (t.role === 'staff' && !st) fail(400, 'Staff work at one store. Pick it.');
          if (t.role === 'manager' && u.role !== 'owner' && u.role !== 'superadmin') fail(403, 'Only an owner can change a manager’s stores.');
          db.prepare('UPDATE users SET store_id = ? WHERE id = ?').run(st?.id ?? null, t.id);
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
          audit(db, u.id, 'move store', `${t.name} → ${st?.name || 'every store'}`, cid);
        }
        if (b.name !== undefined && t.role === 'staff') {
          const name = str(b.name, 60);
          if (name.length < 2) fail(400, 'Add a name.');
          try { db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, t.id); } catch { fail(409, 'Someone on the team already has that name.'); }
          audit(db, u.id, 'rename', `${t.name} → ${name}`, cid);
        }
        return sendJson(res, 200, { ok: true });
      }
      if (m === 'DELETE') {
        if (t.id === u.id) fail(400, 'You can’t remove your own account.');
        if (t.role !== 'staff' && u.role !== 'owner' && u.role !== 'superadmin') fail(403, 'Only an owner can remove an owner or manager.');
        if (t.role === 'owner' && db.prepare("SELECT COUNT(*) n FROM users WHERE company_id = ? AND role = 'owner' AND deleted_at IS NULL").get(cid).n < 2) fail(400, 'Every company keeps at least one owner. Make someone else an owner first.');
        db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(now(), t.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
        audit(db, u.id, 'remove person', t.name, cid);
        return sendJson(res, 200, { ok: true });
      }
    }

    /* ---- two-step sign-in (required for super admins, optional for owners and managers) ---- */
    if (p === '/api/2fa/start' && m === 'POST') {
      const u = need(c, req);
      if (u.role === 'staff') fail(400, 'Staff sign in with a PIN.');
      if (u.totp_on) fail(409, 'Two-step sign-in is already on.');
      const secret = newTotpSecret();
      db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, u.id);
      const url = otpauthUrl(secret, u.email);
      const qr = (await import('qrcode')).default;
      const svg = await qr.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      return sendJson(res, 200, { secret, url, qr: svg });
    }
    if (p === '/api/2fa/enable' && m === 'POST') {
      const u = need(c, req);
      const b = await readJson(req);
      const fresh = byId(u.id);
      if (!verifyTotp(fresh.totp_secret, b.code)) fail(400, 'That code isn’t right. Type the 6 numbers your authenticator app shows now.');
      db.prepare('UPDATE users SET totp_on = 1 WHERE id = ?').run(u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, sha256(c.token));
      audit(db, u.id, u.role === 'superadmin' ? 'super: two-step on' : 'two-step on', null, u.company_id);
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/2fa/disable' && m === 'POST') {
      const u = need(c, req);
      if (u.role === 'superadmin') fail(400, 'Super admins always use two-step sign-in.');
      const b = await readJson(req);
      if (!(await verifyPassword(b.password, u.password_hash))) fail(400, 'Your password isn’t right.');
      db.prepare('UPDATE users SET totp_on = 0, totp_secret = NULL WHERE id = ?').run(u.id);
      audit(db, u.id, 'two-step off', null, u.company_id);
      return sendJson(res, 200, { ok: true });
    }

    /* ---- support: back from "sign in as" ---- */
    if (p === '/api/super/return' && m === 'POST') {
      const u = need(c, req);
      if (!u.impersonator_id) fail(400, 'You’re signed in as yourself.');
      const sup = byId(u.impersonator_id);
      endSession(db, c.token);
      if (!sup || sup.deleted_at || sup.role !== 'superadmin') return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', { clear: true, secure: isSecure(req) }) });
      superLog(sup, 'back from signing in as', u.name, u.company_id);
      return signIn(res, req, sup, { acting: u.company_id });
    }

    /* ---- super admin ---- */
    if (parts[1] !== 'super') return false;
    const s = needSuper(c, req);
    if (p === '/api/super/overview' && m === 'GET') {
      const companies = db.prepare(`SELECT c.*,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.deleted_at IS NULL AND u.role IN ('owner','manager')) leads,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.deleted_at IS NULL AND u.role = 'staff') staff,
          (SELECT MAX(last_seen_at) FROM users u WHERE u.company_id = c.id) last_seen
        FROM companies c ORDER BY c.deleted_at IS NOT NULL, c.name`).all();
      const admins = db.prepare("SELECT u.*, NULL company_name FROM users u WHERE role = 'superadmin' ORDER BY super_primary DESC, name").all();
      return sendJson(res, 200, {
        companies: companies.map((x) => ({ id: x.id, name: x.name, slug: x.slug, joinCode: x.join_code, createdAt: x.created_at, deletedAt: x.deleted_at, leads: x.leads, staff: x.staff, lastSeenAt: x.last_seen,
          stores: storesOf(db, x.id).map((st) => ({ ...storeOut(st), staff: db.prepare("SELECT COUNT(*) n FROM users WHERE store_id = ? AND role = 'staff' AND deleted_at IS NULL").get(st.id).n })) })),
        admins: admins.map(personOut), you: s.id, youPrimary: !!s.super_primary, workingIn: companyOf(s),
      });
    }
    if (p === '/api/super/companies' && m === 'POST') {
      const b = await readJson(req);
      const name = str(b.name, 80);
      if (name.length < 2) fail(400, 'Add the company’s name.');
      let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'company';
      while (db.prepare('SELECT 1 FROM companies WHERE slug = ?').get(slug)) slug += '-2';
      const r = db.prepare('INSERT INTO companies(name, slug, created_at) VALUES (?,?,?)').run(name, slug, now());
      const id = Number(r.lastInsertRowid);
      setJoinCode(db, id);
      const storeNames = (Array.isArray(b.stores) ? b.stores : []).map((x) => str(x, 80)).filter((x) => x.length > 1).slice(0, 20);
      for (const n of storeNames.length ? storeNames : [name]) addStore(db, id, n);
      let link = null;
      const email = String(b.ownerEmail || '').trim().toLowerCase();
      if (email) {
        if (!validEmail(email)) fail(400, 'Enter a valid email for the owner.');
        if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(email)) fail(409, 'That email already has an account.');
        link = makeInvite(s, email, 'owner', id);
      }
      superLog(s, 'add company', name + (email ? ` · owner invite to ${email}` : ''), id);
      return sendJson(res, 200, { id, link });
    }
    if (parts[2] === 'companies' && /^\d+$/.test(parts[3] || '')) {
      const co = db.prepare('SELECT * FROM companies WHERE id = ?').get(Number(parts[3]));
      if (!co) fail(404, 'We couldn’t find that company.');
      if (m === 'PATCH') {
        const b = await readJson(req);
        const name = str(b.name, 80);
        if (name.length < 2) fail(400, 'Add the company’s name.');
        db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(name, co.id);
        superLog(s, 'rename company', `${co.name} → ${name}`, co.id);
        return sendJson(res, 200, { ok: true });
      }
      if (parts[4] === 'join-code' && m === 'POST') { const code = setJoinCode(db, co.id); superLog(s, 'new join code', co.name, co.id); return sendJson(res, 200, { joinCode: code }); }
      if (parts[4] === 'owner-invite' && m === 'POST') {
        const b = await readJson(req);
        const email = String(b.email || '').trim().toLowerCase();
        if (!validEmail(email)) fail(400, 'Enter a valid email address.');
        if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(email)) fail(409, 'That email already has an account.');
        const link = makeInvite(s, email, b.role === 'manager' ? 'manager' : 'owner', co.id);
        superLog(s, 'invite', `${email} → ${co.name}`, co.id);
        return sendJson(res, 200, { link });
      }
      if (parts[4] === 'stores' && m === 'POST') {
        const b = await readJson(req);
        const n = str(b.name, 80);
        if (n.length < 2) fail(400, 'Add the store’s name.');
        const sid = addStore(db, co.id, n);
        superLog(s, 'add store', `${co.name} · ${n}`, co.id);
        return sendJson(res, 200, { id: sid });
      }
      if (parts[4] === 'restore' && m === 'POST') { db.prepare('UPDATE companies SET deleted_at = NULL WHERE id = ?').run(co.id); superLog(s, 'restore company', co.name, co.id); return sendJson(res, 200, { ok: true }); }
      if (m === 'DELETE') {
        const b = await readJson(req);
        if (str(b.confirm, 80) !== co.name) fail(400, `Type the company’s name (${co.name}) to delete it.`);
        db.prepare('UPDATE companies SET deleted_at = ? WHERE id = ?').run(now(), co.id);
        db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)').run(co.id);
        superLog(s, 'delete company (30 days to restore)', co.name, co.id);
        return sendJson(res, 200, { ok: true });
      }
    }
    if (parts[2] === 'stores' && /^\d+$/.test(parts[3] || '') && m === 'PATCH') {
      const st = db.prepare('SELECT * FROM stores WHERE id = ?').get(Number(parts[3]));
      if (!st) fail(404, 'We couldn’t find that store.');
      const b = await readJson(req);
      if (b.name !== undefined) { const n = str(b.name, 80); if (n.length < 2) fail(400, 'Add the store’s name.'); db.prepare('UPDATE stores SET name = ? WHERE id = ?').run(n, st.id); }
      // A store's book opens when its own content is built (the content isn't split by store yet), so there's no switch for it here.
      superLog(s, 'edit store', `${st.name}${b.name ? ` → ${b.name}` : ''}`, st.company_id);
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/super/act' && m === 'POST') {
      const b = await readJson(req);
      const co = companyRow(Number(b.companyId));
      if (!co) fail(404, 'We couldn’t find that company.');
      db.prepare('UPDATE sessions SET acting_company_id = ?, acting_store_id = NULL WHERE token_hash = ?').run(co.id, sha256(c.token));
      superLog(s, 'work in company', co.name, co.id);
      return sendJson(res, 200, { ok: true, workingIn: co.id, workingInName: co.name });
    }
    if (p === '/api/super/users' && m === 'GET') {
      const cid = url.searchParams.get('company');
      const q = `%${str(url.searchParams.get('q'), 60)}%`;
      const rows = db.prepare(`SELECT u.*, c.name company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id
        WHERE (? = '' OR u.company_id = ?) AND (u.name LIKE ? OR IFNULL(u.email,'') LIKE ?) ORDER BY u.deleted_at IS NOT NULL, c.name, u.name LIMIT 500`)
        .all(cid || '', Number(cid) || 0, q, q);
      return sendJson(res, 200, { users: rows.map(personOut) });
    }
    if (parts[2] === 'users' && /^\d+$/.test(parts[3] || '')) {
      const t = byId(Number(parts[3]));
      if (!t) fail(404, 'We couldn’t find that person.');
      const protectedSuper = t.role === 'superadmin' && (t.super_primary || !s.super_primary) && t.id !== s.id;
      if (m === 'PATCH') {
        if (protectedSuper) fail(403, 'Only the primary super admin can change another super admin.');
        const b = await readJson(req);
        const changes = [];
        if (b.name !== undefined) { const n = str(b.name, 80); if (n.length < 2) fail(400, 'Add a name.'); db.prepare('UPDATE users SET name = ? WHERE id = ?').run(n, t.id); changes.push(`name → ${n}`); }
        if (b.email !== undefined && (t.role !== 'staff' || (b.role && b.role !== 'staff'))) {
          const e = String(b.email || '').trim().toLowerCase();
          if (!validEmail(e)) fail(400, 'Enter a valid email address.');
          if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(e, t.id)) fail(409, 'Another account uses that email.');
          db.prepare('UPDATE users SET email = ? WHERE id = ?').run(e, t.id); changes.push(`email → ${e}`);
        }
        if (b.role !== undefined && t.role !== 'superadmin') {
          if (!['owner', 'manager', 'staff'].includes(b.role)) fail(400, 'Pick owner, manager or staff.');
          if (b.role !== 'staff' && !t.email && !b.email) fail(400, 'Owners and managers need an email to sign in.');
          if (b.role === 'staff' && t.role !== 'staff') db.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').run(t.id);
          db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, t.id); changes.push(`role → ${b.role}`);
        }
        if (b.companyId !== undefined && t.role !== 'superadmin') {
          const co = companyRow(Number(b.companyId)); if (!co) fail(404, 'We couldn’t find that company.');
          db.prepare('UPDATE users SET company_id = ? WHERE id = ?').run(co.id, t.id); changes.push(`company → ${co.name}`);
        }
        // Keep the store right for the new role or company: staff need one, owners have none.
        const after = byId(t.id);
        if (after.role === 'owner') db.prepare('UPDATE users SET store_id = NULL WHERE id = ?').run(t.id);
        else if (after.company_id && (!after.store_id || !storesOf(db, after.company_id).some((x) => x.id === after.store_id))) {
          db.prepare('UPDATE users SET store_id = ? WHERE id = ?').run(after.role === 'staff' ? storesOf(db, after.company_id)[0]?.id ?? null : null, t.id);
        }
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
        superLog(s, 'edit person', `${t.name}: ${changes.join(', ') || 'no change'}`, t.company_id);
        return sendJson(res, 200, { ok: true });
      }
      if (parts[4] === 'restore' && m === 'POST') { db.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').run(t.id); superLog(s, 'restore person', t.name, t.company_id); return sendJson(res, 200, { ok: true }); }
      if (parts[4] === 'reset-password' && m === 'POST') {
        resettable(t, s);
        if (protectedSuper) fail(403, 'Only the primary super admin can reset another super admin’s password.');
        const r = makeReset(t, s, 'super');
        superLog(s, 'reset password link', `${t.name} (${t.role}) · ${t.email}`, t.company_id);
        return sendJson(res, 200, resetOut(t, r));
      }
      if (parts[4] === 'reset-pin' && m === 'POST') { db.prepare('UPDATE users SET pin_hash = NULL WHERE id = ?').run(t.id); db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id); superLog(s, 'reset PIN', t.name, t.company_id); return sendJson(res, 200, { ok: true }); }
      if (parts[4] === 'sign-in-as' && m === 'POST') {
        if (t.role === 'superadmin') fail(400, 'Super admins can’t sign in as each other.');
        if (t.deleted_at) fail(400, 'Restore this person first.');
        superLog(s, 'sign in as', `${t.name} (${t.role})`, t.company_id);
        endSession(db, c.token);
        const token = createSession(db, t.id, { days: 1, impersonator: s.id });
        return sendJson(res, 200, { user: publicUser({ ...t, impersonator_id: s.id }) }, { 'Set-Cookie': sessionCookie(token, { secure: isSecure(req), days: 1 }) });
      }
      if (m === 'DELETE') {
        if (t.id === s.id) fail(400, 'You can’t delete your own account.');
        if (protectedSuper || (t.role === 'superadmin' && !s.super_primary)) fail(403, 'Only the primary super admin can remove a super admin.');
        db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(now(), t.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
        superLog(s, 'delete person (30 days to restore)', `${t.name} (${t.role})`, t.company_id);
        return sendJson(res, 200, { ok: true });
      }
    }
    if (p === '/api/super/admins/invite' && m === 'POST') {
      if (!s.super_primary) fail(403, 'Only the primary super admin can add super admins.');
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!validEmail(email)) fail(400, 'Enter a valid email address.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(email)) fail(409, 'That email already has an account.');
      const link = makeInvite(s, email, 'superadmin', null);
      superLog(s, 'invite super admin', email);
      return sendJson(res, 200, { link });
    }
    if (p === '/api/super/log' && m === 'GET') {
      const rows = db.prepare(`SELECT a.id, a.action, a.detail, a.at, u.name, c.name company FROM audit a LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN companies c ON c.id = a.company_id WHERE a.action LIKE 'super:%' ORDER BY a.id DESC LIMIT 300`).all();
      return sendJson(res, 200, { log: rows.map((r) => ({ ...r, action: r.action.replace(/^super: /, '') })) });
    }
    fail(404, 'Not found.');
  };
}
