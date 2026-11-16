// A company's data: download all of it, or ask for it to be deleted (Nov 14; the app is being sold to restaurant groups).
//
//   Export   An owner downloads one ZIP: friendly CSVs (people, quiz results, sign-offs, certificates, training, chat, prep,
//            content, uploads, activity), every record as JSON (raw/), and a README. Passwords, PINs, two-step secrets and
//            sign-in tokens are never in it. Logged in the company's Activity. Works in the demo, on the demo's own data.
//   Delete   An owner asks, typing the company's name. Nothing goes yet: the request waits on the super admin side. The super
//            admin confirms after 7 days (typing the name), or sooner with a second typed confirmation ("delete now"). Then
//            every row that belongs to the company goes, and its uploaded files. The owner (or a super admin) can cancel
//            while it waits. Demos can't ask (they're removed after a day anyway).
//   The Baldwin (company 1) holds the shared library every company reads (classic cocktails, grape and region videos), so
//   it can't be deleted from here at all: that would be a planned, hand-run job.
//
// What belongs to a company is worked out from the schema, so a table added later is covered without a change here: any
// table with company_id (that company), user_id (its people) or store_id (its stores). Only `errors` (the app's error log)
// keeps its rows, with the person taken off.
import { teamCan, teamRole } from './miseteam.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR, audit, now } from './db.mjs';
import { zip } from './zip.mjs';
import { titleFor } from './quiz.mjs';
import { certificatesFor } from './certs.mjs';
import { LoginLimiter } from './auth.mjs';
import { isHq } from './hq.mjs';

export const WAIT_DAYS = 7;
export const PROTECTED = new Set([1]); // The Baldwin: holds the shared library
const DAY = 864e5;
const exportLimiter = new LoginLimiter(20, 3600e3, 'export'); // 20 downloads an hour per company

export function initCompanyData(db) {
  // Unnumbered, like program_acks: can't collide with a migration added on another branch.
  db.exec(`CREATE TABLE IF NOT EXISTS company_deletions(id INTEGER PRIMARY KEY, company_id INT NOT NULL, company_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','cancelled','done')), requested_by INT, requested_name TEXT, requested_at TEXT NOT NULL,
    ends_at TEXT NOT NULL, closed_by INT, closed_name TEXT, closed_at TEXT, early INT NOT NULL DEFAULT 0, removed TEXT)`);
}

/* ------------------------------------------------ what belongs to a company ------------------------------------------------ */
const KEEP = new Set(['company_deletions', 'errors', 'limits', 'companies', 'users', 'stores']); // handled by hand, or not company data
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const colsOf = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const idsOf = (db, sql, id) => db.prepare(sql).all(id).map((r) => r.id);
const inList = (ids) => `(${ids.map(() => '?').join(',') || 'NULL'})`;

/** Rows of every table that belong to the company: { table: rows }. Secrets are taken out. */
function ownedRows(db, companyId) {
  const users = idsOf(db, 'SELECT id FROM users WHERE company_id = ?', companyId);
  const stores = idsOf(db, 'SELECT id FROM stores WHERE company_id = ?', companyId);
  const out = {};
  for (const t of tables(db)) {
    if (KEEP.has(t) || t === 'sessions' || t === 'password_resets') continue;
    const cols = colsOf(db, t);
    const where = [], args = [];
    if (cols.includes('company_id')) { where.push('company_id = ?'); args.push(companyId); }
    if (cols.includes('user_id') && users.length) { where.push(`user_id IN ${inList(users)}`); args.push(...users); }
    if (cols.includes('store_id') && stores.length) { where.push(`store_id IN ${inList(stores)}`); args.push(...stores); }
    if (!where.length) continue;
    let rows = db.prepare(`SELECT * FROM ${t} WHERE ${where.join(' OR ')}`).all(...args);
    if (t === 'invites') rows = rows.map(({ token_hash, ...r }) => r); // eslint-disable-line no-unused-vars
    if (rows.length) out[t] = rows;
  }
  out.company = [db.prepare('SELECT id, name, slug, brand, demo, created_at FROM companies WHERE id = ?').get(companyId)].filter(Boolean);
  out.stores = db.prepare('SELECT id, name, slug, book_ready, created_at, deleted_at FROM stores WHERE company_id = ?').all(companyId);
  out.users = db.prepare(`SELECT id, company_id, store_id, email, name, role, jobs, started_on, totp_on, created_at, last_seen_at, deleted_at
    FROM users WHERE company_id = ?`).all(companyId);
  return out;
}

/** Uploaded files that belong to the company (its media library, bottle scans with their spin frames, chat photos). */
export function ownedFiles(db, companyId) {
  const files = new Set();
  for (const r of db.prepare("SELECT file FROM media WHERE company_id = ? AND file IS NOT NULL AND file NOT LIKE 'demo/%'").all(companyId)) {
    files.add(path.basename(r.file));
    const spin = /^(.*-spin-.*-)00\.jpg$/.exec(path.basename(r.file));
    if (spin) for (let i = 1; i < 100; i++) files.add(`${spin[1]}${String(i).padStart(2, '0')}.jpg`);
  }
  // (only uploads: a demo's seeded chat photos point at the app's own /img/ files, which are never removed)
  for (const r of db.prepare("SELECT photo FROM chat_messages WHERE company_id = ? AND photo LIKE '/media/%' AND photo NOT LIKE '/media/demo/%'").all(companyId)) files.add(path.basename(r.photo));
  // captions on uploaded videos (Nov 14, server/captions.mjs), when that column is there
  if (colsOf(db, 'media').includes('captions')) for (const r of db.prepare('SELECT captions FROM media WHERE company_id = ? AND captions IS NOT NULL').all(companyId)) files.add(path.basename(r.captions));
  return [...files].filter((f) => f && fs.existsSync(path.join(MEDIA_DIR, f)));
}

/* ------------------------------------------------ export ------------------------------------------------ */
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // a spreadsheet won't run it as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const csv = (head, rows) => [head.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
const parse = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };

/** Everything the ZIP holds: [{ name, data }], plus counts for the screen. */
export function exportFiles(db, companyId) {
  const raw = ownedRows(db, companyId);
  const co = raw.company[0];
  const people = new Map(raw.users.map((u) => [u.id, u]));
  const nameOf = (id) => (id == null ? '' : people.get(Number(id))?.name || db.prepare('SELECT name FROM users WHERE id = ?').get(Number(id))?.name || `#${id}`);
  const byDevice = (d) => (/^u\d+$/.test(String(d)) ? nameOf(Number(String(d).slice(1))) : String(d));
  const storeName = new Map(raw.stores.map((s) => [s.id, s.name]));
  const st = (id) => (id === 0 ? 'Group kitchen' : storeName.get(id) || (id == null ? '' : `#${id}`));
  const rows = (t) => raw[t] || [];
  const titles = new Map();
  const quizTitle = (store, q) => { const k = store + '|' + q; if (!titles.has(k)) { let v = q; try { v = titleFor(db, store, q); } catch { /* the id */ } titles.set(k, v); } return titles.get(k); };

  const files = [];
  const add = (name, data) => files.push({ name, data });
  add('people.csv', csv(['id', 'name', 'email', 'role', 'store', 'jobs', 'started on', 'joined', 'last seen', 'two-step sign-in', 'removed'],
    raw.users.map((u) => [u.id, u.name, u.email, u.role, st(u.store_id), (parse(u.jobs, []) || []).join(' + '), u.started_on, u.created_at, u.last_seen_at, u.totp_on ? 'on' : 'off', u.deleted_at])));
  add('quiz_results.csv', csv(['person', 'store', 'quiz', 'quiz id', 'score', 'out of', 'percent', 'taken at'],
    rows('quiz_attempts').map((r) => [r.user_id ? nameOf(r.user_id) : r.name, st(r.store_id), quizTitle(r.store_id, r.quiz), r.quiz, r.score, r.total, r.total ? Math.round((r.score / r.total) * 100) : '', r.at])));
  add('signoffs.csv', csv(['person', 'store', 'step or quiz', 'signed off by', 'at'],
    rows('signoffs').map((r) => [byDevice(r.device), st(r.store_id), r.quiz, nameOf(r.by_user), r.at])));
  const certs = [];
  for (const u of raw.users) {
    const sid = u.store_id || raw.stores[0]?.id;
    try { for (const c of certificatesFor(db, u, sid, raw.stores.find((s) => s.id === sid))) certs.push([u.name, st(sid), c.title, c.number, c.final?.pct, c.earnedAt]); } catch { /* none */ }
  }
  add('certificates.csv', csv(['person', 'store', 'certificate', 'number', 'final score %', 'earned at'], certs));
  add('training_reads.csv', csv(['person', 'page or lesson', 'marked done at'], rows('manual_reads').map((r) => [nameOf(r.user_id), r.slug, r.at])));
  add('acknowledgments.csv', csv(['person', 'store', 'acknowledgment', 'typed name', 'signed at'], rows('program_acks').map((r) => [nameOf(r.user_id), st(r.store_id), r.level, r.name, r.at])));
  add('signoff_requests.csv', csv(['person', 'store', 'step', 'asked at', 'not yet at', 'not yet by', 'note'],
    rows('signoff_requests').map((r) => [nameOf(r.user_id), st(r.store_id), r.key, r.at, r.declined_at, nameOf(r.declined_by), r.note])));
  const rooms = new Map(rows('chat_rooms').map((r) => [r.id, r]));
  const roomName = (id) => { const r = rooms.get(id); if (!r) return `#${id}`; if (r.kind === 'dm') return 'Direct message: ' + r.key.slice(3).split(':').map((x) => nameOf(Number(x))).join(' & '); return '#' + r.key; };
  add('chat_messages.csv', csv(['id', 'store', 'conversation', 'from', 'sent at', 'message', 'photo', 'page shared', 'reply to', 'thread', 'pinned at', 'removed at'],
    rows('chat_messages').map((m) => [m.id, st(m.store_id), roomName(m.room_id), nameOf(m.user_id), m.created_at, m.removed_at ? '' : String(m.body || '').replace(/<@(\d+)>/g, (_, id) => '@' + nameOf(Number(id))),
      m.photo, parse(m.page)?.title || '', m.reply_to, m.thread_id, m.pinned_at, m.removed_at])));
  const item = new Map(rows('prep_items').map((r) => [r.id, r]));
  const itemName = (id) => item.get(id)?.name || `#${id}`;
  add('prep_items.csv', csv(['id', 'store', 'name', 'kind', 'unit', 'batch', 'pars Sun–Sat', 'shelf days', 'archived at'],
    rows('prep_items').map((r) => [r.id, st(r.store_id), r.name, r.kind, r.unit, r.batch, (parse(r.pars, []) || []).join(' '), r.shelf_days, r.archived_at])));
  add('prep_counts.csv', csv(['store', 'item', 'day', 'walked in with', 'tossed', 'prepped', 'wasted', 'used', 'counted by', 'at', 'replaced at'],
    rows('prep_counts').map((r) => [st(r.store_id), itemName(r.item_id), r.day, r.amount, r.tossed, r.prepped, r.wasted, r.used, nameOf(r.by_user), r.at, r.replaced_at])));
  add('prep_batches.csv', csv(['store', 'item', 'day', 'amount', 'left', 'use by', 'made by', 'logged by', 'made at'],
    rows('prep_batches').map((r) => [st(r.store_id), itemName(r.item_id), r.day, r.amount, r.remaining, r.use_by, nameOf(r.made_by), nameOf(r.by_user), r.made_at])));
  add('prep_waste_and_runouts.csv', csv(['store', 'item', 'kind', 'amount', 'reason', 'note', 'day', 'by', 'at'],
    rows('prep_events').map((r) => [st(r.store_id), itemName(r.item_id), r.kind, r.amount, r.reason, r.note, r.day, nameOf(r.by_user), r.at])));
  add('content.csv', csv(['id', 'type', 'name', 'address', 'store', 'updated at', 'archived at'],
    rows('entries').map((r) => [r.id, r.collection, parse(r.data, {})?.name || '', r.slug, st(r.store_id), r.updated_at, r.archived_at])));
  add('team_quizzes.csv', csv(['id', 'store', 'name', 'topics', 'questions', 'made by', 'made at', 'archived at'],
    rows('quiz_sets').map((r) => [r.id, st(r.store_id), r.name, (parse(r.topics, []) || []).join(' + '), r.count || 'all', nameOf(r.created_by), r.created_at, r.archived_at])));
  add('sections.csv', csv(['store', 'day', 'section', 'name', 'set by'], rows('sections').map((r) => [st(r.store_id), r.day, r.slot, r.name, nameOf(r.by_user)])));
  const uploads = [
    ...rows('media').map((r) => [r.id, r.kind === 'youtube' ? 'YouTube link' : 'file', r.title, r.file ? '/media/' + r.file : '', r.youtube_id, r.mime, r.size, st(r.store_id), nameOf(r.created_by), r.created_at, r.archived_at]),
    ...rows('chat_messages').filter((m) => m.photo).map((m) => ['', 'chat photo', `Team Chat · ${roomName(m.room_id)}`, m.photo, '', 'image/jpeg', '', st(m.store_id), nameOf(m.user_id), m.created_at, m.removed_at]),
  ];
  add('uploads.csv', csv(['id', 'kind', 'title', 'file', 'youtube id', 'type', 'bytes', 'store', 'added by', 'added at', 'archived or removed at'], uploads));
  add('activity.csv', csv(['at', 'who', 'action', 'detail'], rows('audit').filter((r) => !/^super:/.test(r.action)).sort((a, b) => b.id - a.id).map((r) => [r.at, nameOf(r.user_id), r.action, r.detail])));
  add('company.json', JSON.stringify({ company: co, stores: raw.stores }, null, 2));
  for (const [t, list] of Object.entries(raw)) add(`raw/${t}.json`, JSON.stringify(list, null, 1));
  const counts = { people: raw.users.length, quizResults: rows('quiz_attempts').length, signoffs: rows('signoffs').length, certificates: certs.length,
    chatMessages: rows('chat_messages').length, prepRecords: rows('prep_counts').length + rows('prep_batches').length + rows('prep_events').length,
    contentPages: rows('entries').length, uploads: uploads.length, activity: rows('audit').length };
  add('README.txt', [
    `${co?.name || 'Company'}: everything Mise Academy holds for you, exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    '',
    'Spreadsheets (open in Excel, Numbers or Google Sheets):',
    '  people.csv              everyone on the team, past and present',
    '  quiz_results.csv        every quiz taken',
    '  signoffs.csv            every sign-off, and who gave it',
    '  certificates.csv        certificates earned',
    '  training_reads.csv      pages and lessons marked done',
    '  acknowledgments.csv     signed training acknowledgments',
    '  signoff_requests.csv    sign-offs people asked for',
    '  chat_messages.csv       Team Chat messages (removed ones are blank)',
    '  prep_*.csv              the prep tracker: items, counts, batches, waste and run-outs',
    '  content.csv             your own pages (dishes, drinks, wines, bottles…)',
    '  team_quizzes.csv        quizzes your managers made',
    '  sections.csv            nightly floor sections',
    '  uploads.csv             your videos, photos and chat photos (the list; the files stay in the app)',
    '  activity.csv            your Activity log',
    '',
    'raw/ has every record as JSON, field for field. Passwords, PINs, two-step keys and sign-in tokens are never exported.',
    '',
  ].join('\r\n'));
  return { files, counts, company: co };
}

/** What the page lists before a download: quick counts, no files built. */
export function countsFor(db, companyId) {
  const n = (sql) => db.prepare(sql).get(companyId).n;
  return {
    people: n('SELECT COUNT(*) n FROM users WHERE company_id = ?'),
    quizResults: n('SELECT COUNT(*) n FROM quiz_attempts WHERE company_id = ?'),
    signoffs: n('SELECT COUNT(*) n FROM signoffs WHERE company_id = ?'),
    chatMessages: n('SELECT COUNT(*) n FROM chat_messages WHERE company_id = ?'),
    prepRecords: n('SELECT (SELECT COUNT(*) FROM prep_counts WHERE company_id = ?1) + (SELECT COUNT(*) FROM prep_batches WHERE company_id = ?1) + (SELECT COUNT(*) FROM prep_events WHERE company_id = ?1) n'),
    contentPages: n('SELECT COUNT(*) n FROM entries WHERE company_id = ?'),
    uploads: n('SELECT (SELECT COUNT(*) FROM media WHERE company_id = ?1) + (SELECT COUNT(*) FROM chat_messages WHERE company_id = ?1 AND photo IS NOT NULL) n'),
    activity: n('SELECT COUNT(*) n FROM audit WHERE company_id = ?'),
  };
}

/* ------------------------------------------------ delete ------------------------------------------------ */
/** Remove every row and file that belongs to the company. Returns counts per table. Never The Baldwin. */
export function wipeCompany(db, companyId) {
  if (PROTECTED.has(Number(companyId))) throw new Error('The Baldwin holds the shared library and can’t be wiped here.');
  if (isHq(companyId)) throw new Error('Mise Academy (HQ) is Mise’s own company and can’t be wiped.');
  const users = idsOf(db, 'SELECT id FROM users WHERE company_id = ?', companyId);
  const stores = idsOf(db, 'SELECT id FROM stores WHERE company_id = ?', companyId);
  const slug = db.prepare('SELECT slug, demo FROM companies WHERE id = ?').get(companyId);
  const files = ownedFiles(db, companyId);
  const removed = {};
  const del = (t, sql, args) => { const n = Number(db.prepare(sql).run(...args).changes); if (n) removed[t] = (removed[t] || 0) + n; };
  db.exec('BEGIN');
  try {
    for (const t of tables(db)) {
      if (KEEP.has(t)) continue;
      const cols = colsOf(db, t);
      if (cols.includes('company_id')) del(t, `DELETE FROM ${t} WHERE company_id = ?`, [companyId]);
      if (cols.includes('user_id') && users.length) del(t, `DELETE FROM ${t} WHERE user_id IN ${inList(users)}`, users);
      if (cols.includes('store_id') && stores.length) del(t, `DELETE FROM ${t} WHERE store_id IN ${inList(stores)}`, stores);
    }
    const have = new Set(tables(db)); // (a bare database, e.g. in a test, may not have the error log or the limits yet)
    if (users.length && have.has('errors')) db.prepare(`UPDATE errors SET user_id = NULL WHERE user_id IN ${inList(users)}`).run(...users);
    if (users.length && have.has('limits')) {
      db.prepare(`DELETE FROM limits WHERE key IN ${inList(users)}`).run(...users.map((id) => 'pin|' + id));
      db.prepare(`DELETE FROM limits WHERE key IN ${inList(users)}`).run(...users.map((id) => 'u' + id));
    }
    del('users', 'DELETE FROM users WHERE company_id = ?', [companyId]);
    del('stores', 'DELETE FROM stores WHERE company_id = ?', [companyId]);
    del('companies', 'DELETE FROM companies WHERE id = ?', [companyId]);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  for (const f of files) { try { fs.rmSync(path.join(MEDIA_DIR, f), { force: true }); removed.files = (removed.files || 0) + 1; } catch { /* already gone */ } }
  if (slug?.demo && /^demo(-mise)?-[a-f0-9]{10}$/.test(slug.slug)) fs.rmSync(path.join(MEDIA_DIR, 'demo', slug.slug), { recursive: true, force: true });
  return removed;
}

const requestOut = (r) => (!r ? null : { id: r.id, companyId: r.company_id, companyName: r.company_name, status: r.status, requestedBy: r.requested_name, requestedAt: r.requested_at,
  endsAt: r.ends_at, closedBy: r.closed_name, closedAt: r.closed_at, early: !!r.early, removed: r.removed ? JSON.parse(r.removed) : null,
  daysLeft: r.status === 'pending' ? Math.max(0, Math.ceil((Date.parse(r.ends_at) - Date.now()) / DAY)) : 0, ready: r.status === 'pending' && Date.parse(r.ends_at) <= Date.now() });
const pendingFor = (db, companyId) => db.prepare("SELECT * FROM company_deletions WHERE company_id = ? AND status = 'pending' ORDER BY id DESC").get(companyId);
const same = (a, b) => String(a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/* ------------------------------------------------ routes ------------------------------------------------ */
/**
 *   GET    /api/company/data            the page: what's held, and any deletion request
 *   GET    /api/company/export          the ZIP
 *   POST   /api/company/delete-request  { confirm: company name }
 *   DELETE /api/company/delete-request  cancel it
 *   GET    /api/super/deletions         requests, newest first
 *   POST   /api/super/deletions/:id/confirm  { confirm: company name, now?: true, confirmNow?: 'delete now' }
 *   POST   /api/super/deletions/:id/cancel
 * Returns false when the path isn't one of these.
 */
export function companyDataRoutes({ db, fail, sendJson, readJson, isDemoCompany }) {
  /** Owners; in a demo, its manager too (the demo has no owner to sign in as). */
  const needOwner = (c) => {
    const u = c.user;
    if (!u) fail(401, 'Sign in first.');
    const demo = isDemoCompany(db, u.company_id);
    if (!(u.role === 'owner' || (demo && u.role === 'manager'))) fail(403, 'Only an owner can do that.');
    return { u, company: u.company_id, demo };
  };
  // Nov 16: the Mise team sees the requests; only the Owner confirms or cancels one (server/miseteam.mjs).
  const needSuper = (c, action = 'view') => {
    const u = c.user;
    if (!u || u.role !== 'superadmin' || u.impersonator_id) fail(404, 'Not found.');
    if (!u.totp_on) fail(403, 'Turn on two-step sign-in (Your Account) to open the super admin.');
    if (!teamCan(u, action)) fail(403, action === 'view' ? 'Not allowed.' : 'Only the owner confirms or cancels a company’s deletion.');
    return u;
  };
  return async function route(req, res, url, c) {
    const m = req.method, p = url.pathname;
    if (p === '/api/company/data' && m === 'GET') {
      const { company, demo } = needOwner(c);
      const co = db.prepare('SELECT id, name FROM companies WHERE id = ?').get(company);
      const counts = countsFor(db, company);
      const last = db.prepare("SELECT * FROM company_deletions WHERE company_id = ? AND status = 'cancelled' ORDER BY id DESC LIMIT 1").get(company);
      return sendJson(res, 200, { company: co, demo, counts, waitDays: WAIT_DAYS, byHand: PROTECTED.has(company), request: requestOut(pendingFor(db, company)), lastCancelled: requestOut(last),
        lastExport: db.prepare("SELECT a.at, u.name FROM audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.company_id = ? AND a.action = 'export company data' ORDER BY a.id DESC LIMIT 1").get(company) || null });
    }
    if (p === '/api/company/export' && m === 'GET') {
      const { u, company } = needOwner(c);
      if (!exportLimiter.check(company)) fail(429, 'That’s a lot of downloads. Try again in an hour.');
      exportLimiter.record(company);
      const { files, counts, company: co } = exportFiles(db, company);
      const buf = zip(files);
      audit(db, u.id, 'export company data', `${counts.people} people, ${counts.quizResults} quiz results, ${counts.chatMessages} messages`, company);
      const name = `mise-${String(co?.slug || 'company').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'company'}-${new Date().toISOString().slice(0, 10)}.zip`;
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff' });
      res.end(buf);
      return true;
    }
    if (p === '/api/company/delete-request' && (m === 'POST' || m === 'DELETE')) {
      const { u, company, demo } = needOwner(c);
      if (demo) fail(403, 'Deleting is switched off in the demo, so the next visitor finds it as you did. In your own account, the owner asks here and the Mise team confirms it.');
      const co = db.prepare('SELECT id, name FROM companies WHERE id = ?').get(company);
      if (m === 'DELETE') {
        const r = pendingFor(db, company);
        if (!r) fail(404, 'There’s no deletion request waiting.');
        db.prepare("UPDATE company_deletions SET status = 'cancelled', closed_by = ?, closed_name = ?, closed_at = ? WHERE id = ?").run(u.id, u.name, now(), r.id);
        audit(db, u.id, 'cancel data deletion', co.name, company);
        return sendJson(res, 200, { ok: true, request: null });
      }
      const b = await readJson(req, 2000);
      if (!same(b.confirm, co.name)) fail(400, `Type your company’s name (${co.name}) to ask for deletion.`);
      if (pendingFor(db, company)) fail(409, 'A deletion request is already waiting.');
      const at = now();
      const id = Number(db.prepare("INSERT INTO company_deletions(company_id, company_name, status, requested_by, requested_name, requested_at, ends_at) VALUES (?,?,'pending',?,?,?,?)")
        .run(company, co.name, u.id, u.name, at, new Date(Date.parse(at) + WAIT_DAYS * DAY).toISOString()).lastInsertRowid);
      audit(db, u.id, 'request data deletion', co.name, company);
      audit(db, u.id, 'super: deletion requested', `${co.name} · by ${u.name}`, company);
      return sendJson(res, 200, { ok: true, request: requestOut(db.prepare('SELECT * FROM company_deletions WHERE id = ?').get(id)) });
    }
    if (p === '/api/super/deletions' && m === 'GET') {
      const s = needSuper(c);
      const list = db.prepare("SELECT * FROM company_deletions ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 100").all();
      return sendJson(res, 200, { requests: list.map(requestOut), waitDays: WAIT_DAYS, protected: [...PROTECTED], canDecide: teamCan(s, 'deletions') });
    }
    const dm = /^\/api\/super\/deletions\/(\d+)\/(confirm|cancel)$/.exec(p);
    if (dm && m === 'POST') {
      const s = needSuper(c, 'deletions');
      const r = db.prepare('SELECT * FROM company_deletions WHERE id = ?').get(Number(dm[1]));
      if (!r) fail(404, 'We couldn’t find that request.');
      if (r.status !== 'pending') fail(409, r.status === 'done' ? 'That company’s data is already deleted.' : 'That request was cancelled.');
      if (dm[2] === 'cancel') {
        db.prepare("UPDATE company_deletions SET status = 'cancelled', closed_by = ?, closed_name = ?, closed_at = ? WHERE id = ?").run(s.id, s.name, now(), r.id);
        audit(db, s.id, 'super: cancel deletion request', r.company_name, r.company_id, teamRole(s));
        audit(db, s.id, 'cancel data deletion', `${r.company_name} (Mise team)`, r.company_id);
        return sendJson(res, 200, { ok: true });
      }
      const b = await readJson(req, 2000);
      if (PROTECTED.has(r.company_id)) fail(400, `${r.company_name} holds the shared library every company reads (classic cocktails, grape and region videos), so it can’t be deleted from here.`);
      const co = db.prepare('SELECT * FROM companies WHERE id = ?').get(r.company_id);
      if (!co) fail(409, 'That company is already gone.');
      if (co.demo) fail(400, 'Demos remove themselves after a day.');
      if (co.internal) fail(400, 'Mise Academy (HQ) is Mise’s own company and can’t be deleted.');
      if (!same(b.confirm, co.name)) fail(400, `Type the company’s name (${co.name}) to delete its data.`);
      const early = Date.parse(r.ends_at) > Date.now();
      if (early && !(b.now === true && same(b.confirmNow, 'delete now'))) fail(400, `This request waits until ${r.ends_at.slice(0, 10)}. To delete now, also type “delete now”.`);
      const removed = wipeCompany(db, r.company_id);
      db.prepare("UPDATE company_deletions SET status = 'done', closed_by = ?, closed_name = ?, closed_at = ?, early = ?, removed = ? WHERE id = ?")
        .run(s.id, s.name, now(), early ? 1 : 0, JSON.stringify(removed), r.id);
      // The log line outlives the company: no company id on it, the name in the words.
      audit(db, s.id, 'super: delete company data', `${co.name} (#${co.id})${early ? ' · before the 7 days, confirmed twice' : ''} · ${removed.users || 0} people, ${removed.files || 0} files`, null, teamRole(s));
      return sendJson(res, 200, { ok: true, removed });
    }
    return false;
  };
}
