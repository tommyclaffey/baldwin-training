// Start Your Restaurant: company sign-up (Nov 25; Figma 09 · Idea Board section 48, 965:1574; Tommy approved Nov 25: "go
// with your choice", with "free until prices and Stripe exist" and "every new company shows in Super Admin").
//
//   1 Your Account      name, work email, password (the owner). Email checked when they press Continue.
//   2 Your Restaurant   company name, its link (miseacademy.app/<slug>), first location, state, how many locations
//   3 Your Plan         Foundation or Custom Brand. No prices ("Pricing coming soon"); no card. Free until prices and Stripe
//                       exist: the plan they pick is the plan they get.
//   4 Your Book Starts Here   then the admin Home, with a Get Ready checklist (getReady below) until it's all done.
//
// What gets made: the same things Super Admin → Add Company + an owner invite make, without us in the middle: one company
// (Mise look, the plan picked, its state, a join code and its link), its first store, the owner's account (signed in).
// Logged as "super: company signed up" (Super Admin → Log) and under the owner; companies.signed_up_at marks it.
//
// Email check (edge state 4, "Check Your Email") is built but off until email sending is on (RESEND_API_KEY + MAIL_FROM):
// then step 1 sends a link (signup_pending, 24 hours, works once) and steps 2–3 carry its token instead of the password.
// Until then sign-up goes straight on to step 2.
//
// Limits: 30 email/link checks per address per 15 minutes; 5 sign-ups per address a day; 3 check emails per address an hour.
// signup_pending and companies.signed_up_at are made here (no migration number, like temp_credentials).
import { now } from './db.mjs';

export const SIGNUP_HOURS = 24;
export const SIZES = { '1': '1', '2-5': '2–5', '6-25': '6–25', '25+': 'More than 25' };

export function migrateSignup(db) {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  if (!cols.includes('signed_up_at')) db.exec('ALTER TABLE companies ADD COLUMN signed_up_at TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS signup_pending(token_hash TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, verified_at TEXT, used_at TEXT)`);
}

/** The Get Ready checklist on a signed-up company's admin Home (section 48, frame 968:1904). Every line comes from what's
 *  really there. Foundation's Your Look line is shown but not counted (it's the Custom Brand plan). null once all done, or
 *  for a company that didn't sign up itself (The Baldwin and every company we set up by hand never see it). */
export function getReady(db, { co, store, link }) {
  if (!co?.signed_up_at || co.demo || co.internal) return null;
  const owner = db.prepare("SELECT name FROM users WHERE company_id = ? AND role = 'owner' AND deleted_at IS NULL ORDER BY id LIMIT 1").get(co.id);
  const any = (sql, ...a) => !!db.prepare(sql).get(...a);
  const custom = co.plan === 'custom-brand';
  const items = [
    { key: 'account', title: 'Create your account', done: true, detail: owner ? `${owner.name} · owner` : null },
    { key: 'restaurant', title: 'Name your restaurant', done: true, detail: [store?.name || co.name, link ? link.replace(/^\//, 'miseacademy.app/') : null, co.state].filter(Boolean).join(' · ') },
    { key: 'menu', title: 'Import your menu', done: any("SELECT 1 FROM entries WHERE company_id = ? AND collection = 'recipe' AND archived_at IS NULL LIMIT 1", co.id) || any('SELECT 1 FROM menu_imports WHERE company_id = ? LIMIT 1', co.id),
      detail: 'Upload a PDF or photo of your menu. We build the dish and drink pages; you check them.', action: { label: 'Import a Menu', to: '/import' } },
    { key: 'team', title: 'Invite your team', done: any("SELECT 1 FROM users WHERE company_id = ? AND role != 'owner' AND deleted_at IS NULL LIMIT 1", co.id),
      detail: 'New people tap Join with a Code and add their name, email and a password.', action: { label: 'Add a Person', to: '/admin/people?add=1' } },
    { key: 'paths', title: 'Set jobs and paths', done: any("SELECT 1 FROM users WHERE company_id = ? AND deleted_at IS NULL AND jobs IS NOT NULL AND jobs NOT IN ('', '[]') LIMIT 1", co.id),
      detail: 'Give each person their job, and their path shows what they learn first.', action: { label: 'Open People', to: '/admin/people' } },
    { key: 'drinks', title: 'Add your drinks and wine', done: any("SELECT 1 FROM entries WHERE company_id = ? AND collection IN ('house','wine','shelf','beer') AND archived_at IS NULL LIMIT 1", co.id),
      detail: 'House cocktails, the wine list, the back bar and beer: add them where they live in the book, or with Import a Menu.', action: { label: 'Open the Book', to: '/' } },
    { key: 'look', title: 'Your Look', tag: 'Custom Brand', optional: !custom,
      done: custom && (String(co.brand || '').startsWith('look-') || any("SELECT 1 FROM looks WHERE company_id = ? AND status = 'saved' LIMIT 1", co.id)),
      detail: 'Your logo, colours and fonts on every screen, read from your website.', action: { label: custom ? 'Open Your Look' : 'See Custom Brand', to: '/admin/your-look' } },
  ];
  const counted = items.filter((i) => !i.optional);
  const done = counted.filter((i) => i.done).length;
  if (done === counted.length) return null;
  return { done, total: counted.length, items };
}

/** The routes, called from server/accounts.mjs (they need its sign-in and helpers). */
export function signupRoutes(h) {
  const { db, fail, sendJson, readJson, str, ip, validEmail, validPassword, hashPassword, verifyPassword, sha256, newToken, signIn, LoginLimiter,
    accountSlug, toSlug, isReserved, SLUG, STATES, stateName, setJoinCode, addStore, audit, DEFAULT_LOOK, PLANS, STORE_CAP, mailConfigured, sendMail, signUpEmail, APP_URL,
    logError, libraryCounts } = h;
  const checkLimiter = new LoginLimiter(30, 15 * 60_000, 'signup-check');
  const createLimiter = new LoginLimiter(5, 24 * 3600e3, 'signup-create');
  const mailLimiter = new LoginLimiter(3, 60 * 60_000, 'signup-mail');
  const emailTaken = (e) => !!db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(e);
  const USED = 'There’s already an account with this email.';
  const pending = (token) => db.prepare('SELECT * FROM signup_pending WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(sha256(String(token || '')), now());
  /** Is this link free? → { ok, reason } (reason: the words to show). */
  const linkCheck = (slug) => {
    if (!SLUG.test(slug)) return { ok: false, reason: 'Use 2 to 40 lower-case letters, numbers and hyphens.' };
    if (isReserved(slug) || db.prepare('SELECT 1 FROM companies WHERE slug = ?').get(slug)) return { ok: false, reason: 'That link is taken. Pick another, or tap one below.' };
    return { ok: true, reason: null };
  };
  const suggestions = (company, store, state) => {
    const a = toSlug(company), b = toSlug(store), first = a.split('-')[0];
    const st = stateName(state) ? toSlug(stateName(state)) : null;
    const out = [];
    for (const s of [a, b, a && b && !b.startsWith(a) ? `${first}-${b.replace(new RegExp('^' + first + '-'), '')}` : null, st && first ? `${first}-${st}` : null, accountSlug(db, company || store || 'restaurant')]) {
      if (s && s.length <= 40 && !out.includes(s) && linkCheck(s).ok) out.push(s);
      if (out.length === 3) break;
    }
    return out;
  };

  return async function route(req, res, url, c) {
    const m = req.method, p = url.pathname, parts = p.split('/').filter(Boolean);
    const blocked = () => { if (req.headers['x-bt'] !== '1') fail(403, 'Request blocked.'); };
    const limit = () => { if (!checkLimiter.check(ip(req))) fail(429, 'Too many tries. Wait 15 minutes, then try again.'); checkLimiter.record(ip(req)); };

    // What the screens need: the states, the shared library's real counts, whether email is on, the store cap
    if (p === '/api/sign-up/info' && m === 'GET') {
      return sendJson(res, 200, { states: STATES, library: libraryCounts(), mailOn: mailConfigured(), maxStores: STORE_CAP, plans: Object.values(PLANS).map((x) => ({ id: x.id, name: x.name })) });
    }
    // Step 1's Continue: is the email free? (Rate-limited: it tells someone whether an email has an account.)
    if (p === '/api/sign-up/email' && m === 'POST') {
      blocked(); limit();
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!validEmail(email)) fail(400, 'Enter a valid email address.');
      if (emailTaken(email)) fail(409, USED);
      return sendJson(res, 200, { ok: true });
    }
    // Step 2: the link, as they type
    if (p === '/api/sign-up/link' && m === 'GET') {
      limit();
      const slug = String(url.searchParams.get('slug') || '').trim().toLowerCase();
      const r = linkCheck(slug);
      return sendJson(res, 200, { slug, available: r.ok, reason: r.reason, suggestions: r.ok ? [] : suggestions(url.searchParams.get('company'), url.searchParams.get('store'), url.searchParams.get('state')) });
    }
    // Email on: step 1 sends a link; nothing else is made until it's opened
    if (p === '/api/sign-up/start' && m === 'POST') {
      blocked();
      if (!mailConfigured()) fail(409, 'Email isn’t set up, so there’s nothing to send. Carry on to Your Restaurant.');
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase();
      const name = str(b.name, 80).replace(/\s+/g, ' ');
      if (name.length < 2) fail(400, 'Add your name.');
      if (!validEmail(email)) fail(400, 'Enter a valid email address.');
      if (!validPassword(b.password)) fail(400, 'Too short. Use at least 10 characters; a short sentence works well.');
      if (emailTaken(email)) fail(409, USED);
      if (!mailLimiter.check(ip(req)) || !mailLimiter.check(email)) fail(429, 'We’ve sent a few already. Check your inbox and spam, or try again in an hour.');
      mailLimiter.record(ip(req)); mailLimiter.record(email);
      const token = newToken();
      db.prepare('DELETE FROM signup_pending WHERE email = ? AND used_at IS NULL').run(email);
      db.prepare('INSERT INTO signup_pending(token_hash, email, name, password_hash, created_at, expires_at) VALUES (?,?,?,?,?,?)')
        .run(sha256(token), email, name, await hashPassword(b.password), now(), new Date(Date.now() + SIGNUP_HOURS * 3600e3).toISOString());
      try { await sendMail({ to: email, ...signUpEmail({ name, email, url: `${APP_URL}/sign-up?verify=${token}`, hours: SIGNUP_HOURS }) }); }
      catch (e) { logError(db, 'server', '/api/sign-up/start', e); fail(502, 'We couldn’t send the email. Try again in a minute.'); }
      return sendJson(res, 200, { sent: true, email });
    }
    if (parts[1] === 'sign-up' && parts[2] === 'verify' && parts[3] && m === 'GET') {
      const r = pending(parts[3]);
      if (r && !r.verified_at) db.prepare('UPDATE signup_pending SET verified_at = ? WHERE token_hash = ?').run(now(), r.token_hash);
      return sendJson(res, 200, r ? { valid: true, name: r.name, email: r.email } : { valid: false });
    }

    // Step 3's Continue: make it all, sign the owner in
    if (p === '/api/sign-up' && m === 'POST') {
      blocked();
      const b = await readJson(req, 20_000);
      let name, email, hash, pend = null;
      if (b.verify) {
        pend = pending(b.verify);
        if (!pend) fail(410, 'That link has expired or was already used. Start again.');
        ({ name, email } = pend); hash = pend.password_hash;
      } else {
        if (mailConfigured()) fail(400, 'Check your email first: open the link we sent.');
        name = str(b.name, 80).replace(/\s+/g, ' ');
        email = String(b.email || '').trim().toLowerCase();
        if (name.length < 2) fail(400, 'Add your name.');
        if (!validEmail(email)) fail(400, 'Enter a valid email address.');
        if (!validPassword(b.password)) fail(400, 'Too short. Use at least 10 characters; a short sentence works well.');
        if (String(b.password).trim().toLowerCase() === email) fail(400, 'Don’t use your email as your password. Choose something only you know.');
      }
      if (emailTaken(email)) fail(409, USED);
      const company = str(b.company, 80).replace(/\s+/g, ' ');
      const storeName = str(b.store, 80).replace(/\s+/g, ' ') || company;
      if (company.length < 2) fail(400, 'Add your company or group name.');
      if (storeName.length < 2) fail(400, 'Add your first location’s name.');
      const slug = String(b.slug || '').trim().toLowerCase();
      const lc = linkCheck(slug);
      if (!lc.ok) fail(409, lc.reason);
      const state = b.state ? stateName(b.state) : null;
      if (b.state && !state) fail(400, 'Pick your state from the list.');
      const size = Object.hasOwn(SIZES, String(b.size)) ? String(b.size) : '1';
      const plan = PLANS[b.plan] ? b.plan : 'foundation';
      if (!createLimiter.check(ip(req))) fail(429, 'Too many new restaurants from here today. Write to us and we’ll set it up with you.');
      if (!hash) hash = await hashPassword(b.password);
      let companyId, ownerId;
      db.exec('BEGIN');
      try {
        if (pend && db.prepare('UPDATE signup_pending SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(now(), pend.token_hash).changes !== 1) fail(410, 'That link was already used.');
        companyId = Number(db.prepare('INSERT INTO companies(name, slug, created_at, brand, plan, state, signed_up_at) VALUES (?,?,?,?,?,?,?)')
          .run(company, slug, now(), DEFAULT_LOOK, plan, state, now()).lastInsertRowid);
        setJoinCode(db, companyId);
        const storeId = addStore(db, companyId, storeName);
        db.prepare('UPDATE users SET email = NULL WHERE email = ? AND deleted_at IS NOT NULL').run(email); // an archived person's old email
        ownerId = Number(db.prepare("INSERT INTO users(company_id, email, name, role, password_hash, created_at) VALUES (?,?,?,'owner',?,?)")
          .run(companyId, email, name, hash, now()).lastInsertRowid);
        db.exec('COMMIT');
        void storeId;
      } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); if (/UNIQUE/.test(String(e.message))) fail(409, /slug/.test(e.message) ? 'That link was just taken. Pick another.' : USED); throw e; }
      createLimiter.record(ip(req));
      const detail = `${company} · ${storeName} · ${PLANS[plan].name} · ${SIZES[size]} location${size === '1' ? '' : 's'}${state ? ' · ' + state : ''} · ${email} · free until prices are set`;
      audit(db, ownerId, 'super: company signed up', detail, companyId);
      audit(db, ownerId, 'signed up', detail, companyId);
      return signIn(res, req, { id: ownerId, role: 'owner' });
    }
    return false;
  };
}
