// Accounts: companies, people, sign-in, staff join codes, two-step sign-in, and the super admin.
//
// Roles
//   superadmin  Tommy and the teammates he adds. Belongs to no company; sees and changes everything (/api/super/*).
//               Two-step sign-in is required before the super admin area opens. Only the primary super admin adds or removes others.
//   owner       Runs a company: everything a manager can do, plus owners and managers.
//   manager     Edits the book, signs people off, manages staff and the join code.
//   staff       Reads the book and takes quizzes. Signs in with the company's join code, their name and a PIN.
//
// Every query about people is scoped to the signed-in person's company (super admins: the company they're working in).
import { audit, now } from './db.mjs';
import {
  hashPassword, verifyPassword, burnPasswordCheck, createSession, endSession, sessionCookie, sessionDays, LoginLimiter, publicUser,
  sha256, newToken, newTotpSecret, verifyTotp, otpauthUrl, newJoinCode,
} from './auth.mjs';

const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
const STAFF_ROLES = new Set(['owner', 'manager', 'superadmin']);

const loginLimiter = new LoginLimiter();
const codeLimiter = new LoginLimiter(30, 15 * 60_000); // join-code lookups per address
const pinLimiter = new LoginLimiter(5, 15 * 60_000); // wrong PINs per person
const tickets = new Map(); // two-step sign-in: ticket → { userId, at }

/** Startup: Baldwin has a join code, the super admin email is a super admin, and 30-day-old deletions are gone for good. */
export function bootAccounts(db) {
  for (const c of db.prepare('SELECT id FROM companies WHERE join_code IS NULL').all()) setJoinCode(db, c.id);
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
/** Soft deletes are kept 30 days, then removed. */
export function purgeDeleted(db) {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  for (const c of db.prepare('SELECT id FROM companies WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff)) {
    for (const t of ['quiz_attempts', 'signoffs', 'sections']) db.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(c.id);
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)').run(c.id);
    db.prepare('DELETE FROM users WHERE company_id = ?').run(c.id);
    db.prepare('DELETE FROM invites WHERE company_id = ?').run(c.id);
    db.prepare('DELETE FROM companies WHERE id = ?').run(c.id);
  }
  for (const u of db.prepare('SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff)) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  }
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
  const signIn = (res, req, user, opts = {}) => {
    const days = sessionDays(user.role);
    const token = createSession(db, user.id, { days, ...opts });
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), user.id);
    return sendJson(res, 200, { user: publicUser(byId(user.id)) }, { 'Set-Cookie': sessionCookie(token, { secure: isSecure(req), days }) });
  };
  const need = (c, req) => {
    if (!c.user) fail(401, 'Sign in first.');
    if (req.method !== 'GET' && req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
    return c.user;
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

  return async function route(req, res, url, c) {
    const m = req.method, p = url.pathname, parts = p.split('/').filter(Boolean);

    /* ---- who's signed in ---- */
    if (p === '/api/me' && m === 'GET') {
      const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
      const superNeeded = !!SUPERADMIN_EMAIL && !db.prepare("SELECT 1 FROM users WHERE role = 'superadmin' AND deleted_at IS NULL").get();
      const me = c.user ? { ...publicUser(c.user), workingIn: companyOf(c.user), workingInName: companyRow(companyOf(c.user))?.name || null } : null;
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
      audit(db, u.id, 'password', null, u.company_id);
      return sendJson(res, 200, { ok: true });
    }

    /* ---- staff: join code → name → PIN ---- */
    if (parts[1] === 'join' && parts[2] && m === 'GET') {
      if (!codeLimiter.check(ip(req))) fail(429, 'Too many tries. Wait 15 minutes, then try again.');
      const co = staffByCode(parts[2]);
      if (!co) { codeLimiter.record(ip(req)); fail(404, 'That join code isn’t right. Ask a manager for it.'); }
      const staff = db.prepare("SELECT id, name, pin_hash FROM users WHERE company_id = ? AND role = 'staff' AND deleted_at IS NULL ORDER BY name COLLATE NOCASE").all(co.id);
      return sendJson(res, 200, { company: co.name, staff: staff.map((s) => ({ id: s.id, name: s.name, needsPin: !s.pin_hash })) });
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
      if (db.prepare("SELECT 1 FROM users WHERE company_id = ? AND role = 'staff' AND name = ? COLLATE NOCASE AND deleted_at IS NULL").get(co.id, name)) fail(409, 'Someone with that name already joined. Pick your name from the list, or add your last initial.');
      const r = db.prepare("INSERT INTO users(company_id,name,role,pin_hash,created_at) VALUES (?,?,'staff',?,?)").run(co.id, name, await hashPassword(b.pin), now());
      audit(db, Number(r.lastInsertRowid), 'joined with the code', name, co.id);
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
      if (m === 'GET') return sendJson(res, 200, inv ? { valid: true, email: inv.email, role: inv.role, company: inv.company_name } : { valid: false });
      if (m === 'POST') {
        if (!inv) fail(410, 'This invite has expired or was already used. Ask for a new one.');
        const b = await readJson(req);
        if (!str(b.name, 80)) fail(400, 'Add your name.');
        if (!validPassword(b.password)) fail(400, 'Use at least 10 characters for the password.');
        if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(inv.email)) fail(409, 'That person already has an account.');
        db.prepare('DELETE FROM users WHERE email = ? AND deleted_at IS NOT NULL').run(inv.email);
        const r = db.prepare('INSERT INTO users(company_id,email,name,role,password_hash,created_at) VALUES (?,?,?,?,?,?)')
          .run(inv.role === 'superadmin' ? null : inv.company_id, inv.email, str(b.name, 80), inv.role, await hashPassword(b.password), now());
        db.prepare('UPDATE invites SET used_at = ? WHERE token_hash = ?').run(now(), inv.token_hash);
        audit(db, Number(r.lastInsertRowid), inv.role === 'superadmin' ? 'super: joined as super admin' : 'joined', inv.email, inv.company_id);
        return signIn(res, req, byId(Number(r.lastInsertRowid)));
      }
    }
    const makeInvite = (u, email, role, companyId) => {
      const token = newToken();
      db.prepare('INSERT INTO invites(token_hash,company_id,email,role,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
        .run(sha256(token), companyId, email, role, u.id, now(), new Date(Date.now() + 14 * 864e5).toISOString());
      return `/admin/invite/${token}`;
    };

    /* ---- a company's team (owners, managers, staff, join code) ---- */
    if (p === '/api/team' && m === 'GET') {
      const u = needManager(c, req);
      const cid = companyOf(u);
      const co = companyRow(cid);
      if (!co) fail(404, 'We couldn’t find that company.');
      const people = db.prepare('SELECT u.*, c.name company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.company_id = ? AND u.deleted_at IS NULL ORDER BY CASE u.role WHEN \'owner\' THEN 0 WHEN \'manager\' THEN 1 ELSE 2 END, u.name COLLATE NOCASE').all(cid);
      const passed = new Map(db.prepare('SELECT device, COUNT(*) n FROM signoffs WHERE company_id = ? GROUP BY device').all(cid).map((r) => [r.device, r.n]));
      const invites = db.prepare('SELECT substr(token_hash,1,16) id, email, role, created_at, expires_at FROM invites WHERE company_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC').all(cid, now());
      return sendJson(res, 200, { company: { id: co.id, name: co.name, joinCode: co.join_code }, people: people.map((x) => ({ ...personOut(x), signedOff: passed.get('u' + x.id) || 0 })), invites, you: u.id, youRole: u.role });
    }
    if (p === '/api/team/invite' && m === 'POST') {
      const u = needOwner(c, req);
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!validEmail(email)) fail(400, 'Enter a valid email address.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(email)) fail(409, 'That person already has an account.');
      const role = b.role === 'owner' ? 'owner' : 'manager';
      const link = makeInvite(u, email, role, companyOf(u));
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
      if (!t) fail(404, 'We couldn’t find that person.');
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
          db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, t.id);
          audit(db, u.id, 'change role', `${t.name} → ${b.role}`, cid);
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
        companies: companies.map((x) => ({ id: x.id, name: x.name, slug: x.slug, joinCode: x.join_code, createdAt: x.created_at, deletedAt: x.deleted_at, leads: x.leads, staff: x.staff, lastSeenAt: x.last_seen })),
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
    if (p === '/api/super/act' && m === 'POST') {
      const b = await readJson(req);
      const co = companyRow(Number(b.companyId));
      if (!co) fail(404, 'We couldn’t find that company.');
      db.prepare('UPDATE sessions SET acting_company_id = ? WHERE token_hash = ?').run(co.id, sha256(c.token));
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
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
        superLog(s, 'edit person', `${t.name}: ${changes.join(', ') || 'no change'}`, t.company_id);
        return sendJson(res, 200, { ok: true });
      }
      if (parts[4] === 'restore' && m === 'POST') { db.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').run(t.id); superLog(s, 'restore person', t.name, t.company_id); return sendJson(res, 200, { ok: true }); }
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
