// Mise server (The Baldwin's training app): the built app, the content API, sign-in and uploads. No dependencies.
import { migrateDemo, purgeDemos, dropDemo, startDemo, demoBlocks, isDemoCompany, demoKind, DEMOS, demoMediaOf, demoMediaPath, demoMediaAllowed } from './demo.mjs';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb, audit, now, MEDIA_DIR } from './db.mjs';
import { sessionUser, SESSION_COOKIE, LoginLimiter, sessionCookie, endSession } from './auth.mjs';
import { accountRoutes, bootAccounts, companyOf, canEdit, storeOf } from './accounts.mjs';
import { assemble, fullIndex, isCachedIndex, warmContent, ordered, glassTitles, basePage, baseIndex, sidebarCounts, withStore, canOpen } from './content.mjs';
import { archivedList, ARCHIVE_GROUPS } from './archive.mjs';
import { wineTargets, wineVideos, setWineVideo, seedWineVideos } from './wine.mjs';
import { COLLECTIONS, SHARED, LOCAL_KEYS, publicSchemas, seed, listEntries, listArchived, getEntry, createEntry, updateEntry, archiveEntry, restoreEntry, moveEntry, libraryList, sharedWith } from './cms.mjs';
import { slugify } from './templates.mjs';
import { startScan, cutScan, lastCut, warmScanner, warmOnStart, spinFrame, spinFrames } from './scanner.mjs';
import { personPath, personSummary, isPathSignoff, validJobs, JOBS } from './paths.mjs';
import { pathCtxFor, teamRows, signoffQueue, quizWeek, newCertificates, lastEdits, bookTiles, reminderText, addNote, pathSteps, personRow, todayIso, addDays } from './team.mjs';
import { lockedTopics, isInviteKey } from './invite.mjs';
import { certificatesFor } from './certs.mjs';
import { passFor } from './quizgen.mjs';
import { score as scoreQuiz, results as quizResults, signable, catalog as quizCatalog, startQuiz, customId, titleFor, reviewQueue, setMark, REVIEW } from './quiz.mjs';
import { topicList, questionPool } from './quizgen.mjs';
import { chapterBySlug, markRead, programText } from './manual.mjs';
import * as chat from './chat.mjs';
import { initOps, encryptedBackup, logError, recentErrors, opsAllowed, clientErrorAllowed } from './ops.mjs';
import { enterStore } from './variant.mjs';
import { migrateAcks, ackOf, signAck, ACK_KEY, ACK_LEVEL } from './acks.mjs';
import * as prep from './prep.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const MAX_UPLOAD = 600 * 1024 * 1024;
const db = openDb();
initOps(db);
LoginLimiter.useDb(db); // Nov 10: lockouts survive a redeploy
seed(db);
seedWineVideos(db);
bootAccounts(db);
migrateAcks(db); migrateDemo(db); purgeDemos(db); // acks first: demo copies seed and drop them
setInterval(() => { try { purgeDemos(db); } catch { /* next hour */ } }, 3600e3).unref();
try { warmContent(db); } catch (e) { console.error('warm-up', e); } // before listening: the first visitor doesn't wait for it
const demoLimiter = new LoginLimiter(30, 60 * 60_000, 'demo-start'); // 30 demo starts an hour per address
const quizLimiter = new LoginLimiter(60, 60 * 60_000); // 60 quiz saves an hour per address
// Bottle scanner in the demo (Nov 12, Tommy: "scanner sounds good"): the same scanner, with limits. Real companies have none.
//   per demo copy: 10 photos read, 60 cuts, 5 saved photos (a spin counts as one) · per address: 30 photos and 150 cuts an hour
//   photos up to 8 MB and 40 megapixels · saved files go to media/demo/<demo>/ and are deleted with the demo
const DEMO_SCAN = { scans: 10, cuts: 60, saves: 5, bytes: 8e6, pixels: 40e6 };
const demoScanIp = new LoginLimiter(30, 60 * 60_000, 'demo-scan-ip');
const demoCutIp = new LoginLimiter(150, 60 * 60_000, 'demo-cut-ip');
const demoScans = new LoginLimiter(DEMO_SCAN.scans, 48 * 3600e3, 'demo-scan'); // keyed by the demo's random slug
const demoCuts = new LoginLimiter(DEMO_SCAN.cuts, 48 * 3600e3, 'demo-cut');

// Nov 10 (audit): a Content-Security-Policy, so an injected script can't run or send data anywhere. Only our own scripts;
// styles inline (the design's layout is drawn with style attributes) plus Google Fonts; images from us, YouTube thumbnails,
// data: and blob: (the bottle scanner); video embeds from YouTube only. HSTS: .app is HTTPS-only in browsers already.
const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com", "media-src 'self' blob:", "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  // Nov 12, Tommy: the live demo opens in his portfolio's link viewer (an iframe on tommyclaffey.com), like Growth and
  // Queue. Only that site may frame the app; X-Frame-Options went, because SAMEORIGIN would still refuse it.
  "frame-ancestors 'self' https://tommyclaffey.com https://www.tommyclaffey.com"].join('; ');
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': CSP, 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4' };

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https';

const RETURN_COOKIE = 'bt_return';
/** Your own sign-in, kept aside while you look at the demo (a day at most). */
function returnCookie(token, { secure = false, clear = false } = {}) {
  const parts = [`${RETURN_COOKIE}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', clear ? 'Max-Age=0' : 'Max-Age=86400'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
/* Nov 11 (speed): JSON goes compressed when the browser takes it (brotli, else gzip). Railway's edge only compresses the
 * app's own files, so the 1 MB search index was going out raw on every sign-in. Small answers (under 1 KB) go as they are. */
const MIN_PACK = 1024;
/** brotli or gzip, whichever the request accepts (brotli first), or null. */
function encodingFor(res) {
  const ok = new Map();
  for (const part of String(res.acceptEncoding || '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((x) => /^\s*q=([\d.]+)/.exec(x)).find(Boolean);
    if (name) ok.set(name.trim(), q ? Number(q[1]) : 1);
  }
  return ok.get('br') > 0 ? 'br' : ok.get('gzip') > 0 ? 'gzip' : null;
}
const pack = (raw, enc, quality = 6) => (enc === 'br'
  ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
  : zlib.gzipSync(raw, { level: 6 }));
/** `packed` (optional): { br, gzip, quality } kept by the caller, so an answer that doesn't change is compressed once. */
function sendJson(res, status, body, headers = {}, packed = null) {
  let enc = encodingFor(res), out = enc && packed?.[enc];
  if (!out) {
    const raw = Buffer.from(JSON.stringify(body));
    if (raw.length < MIN_PACK) enc = null;
    out = enc ? pack(raw, enc, packed?.quality) : raw;
    if (enc && packed) packed[enc] = out;
  }
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...SECURITY, ...headers,
    ...(enc ? { 'Content-Encoding': enc } : {}), 'Content-Length': out.length });
  res.end(out);
}
/** The search index as sent: kept with the cached index it came from (server/content.mjs), so it's written and compressed
 *  once per change to the book, not per sign-in. The Mise demo's index is read per person, so it's packed per request. */
const packedIndex = new WeakMap();
const indexBytes = (list) => { let p = packedIndex.get(list); if (!p) packedIndex.set(list, (p = { quality: 9 })); return p; };

function readJson(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'That’s too much text to save at once.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'The request was not valid JSON.')); } });
    req.on('error', reject);
  });
}

const ctx = (req) => {
  const token = cookies(req)[SESSION_COOKIE];
  const user = sessionUser(db, token);
  if (user) db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), user.id);
  const store = user ? storeOf(db, user) : null;
  return { token, user, company: companyOf(user), store: store?.id ?? null, storeRow: store };
};
/** Is the company this request works in a Mise-brand one (Nov 11: the Mise demo)? */
const miseBrand = (c) => !!c.company && db.prepare('SELECT brand FROM companies WHERE id = ?').get(c.company)?.brand === 'mise';
/** The Baldwin group's own house-cocktail menu sections (the BRG Staples list, Testa Barra's cart). */
const BALDWIN_SECTIONS = new Set(['BRG Staples', 'Barra Cart']);
/** Tonight, in the restaurant's time zone (Metro Detroit). */
const restaurantDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });

/** Anyone signed in (staff included): reading the book, taking quizzes. */
function needReader(c, req) {
  if (!c.user) fail(401, 'Sign in to read the book.');
  if (req.method !== 'GET' && req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
  return c.user;
}
/** Owners, managers and super admins: editing, sign-offs, uploads. */
function needUser(c, req) {
  if (!c.user) fail(401, 'Sign in to make changes.');
  if (req.method !== 'GET' && req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
  if (!canEdit(c.user)) fail(403, 'Only managers can do that.');
  return c.user;
}
const needOwner = (c, req) => { const u = needUser(c, req); if (u.role !== 'owner' && u.role !== 'superadmin') fail(403, 'Only an owner can do that.'); return u; };
/** Every store reads a book: The Baldwin's designed one, or the shared library plus the store's own content. */
const needBook = needReader;
/** Editing a store's own content: a manager of that store. */
const needEditor = needUser;
/** The shared library (classics, wine videos) is every company's, so only a super admin changes it. */
const needLibrary = (c, req) => { const u = needUser(c, req); if (u.role !== 'superadmin') fail(403, 'The shared library is kept by the app’s team. Ask us if something needs changing.'); return u; };
const inStore = (c, fn) => withStore(c.storeRow, fn, c.user);

const clean = (s, max = 4000) => String(s ?? '').slice(0, max);
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));
const validPassword = (p) => String(p || '').length >= 10;

function youtubeId(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}
/** A demo's saved scans so far (archived ones count: the file is still there). */
const demoSaves = (companyId) => db.prepare("SELECT COUNT(*) n FROM media WHERE company_id = ? AND file LIKE 'demo/%'").get(companyId).n;
const demoFull = `This demo has saved its ${DEMO_SCAN.saves} photos. Refresh the page for a fresh demo.`;
/** Write a scanned photo (already re-encoded by the scanner, no metadata). A demo's go in its own folder. Returns the
 *  path under media/. A random part keeps a demo's file names unguessable. */
function saveScan(demoDir, name, jpg) {
  const rel = demoDir ? `${demoDir}/${crypto.randomBytes(6).toString('hex')}-${name}` : name;
  if (demoDir) fs.mkdirSync(demoMediaPath(demoDir), { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, rel), jpg);
  return rel;
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
const mediaOut = (m) => ({ id: m.id, kind: m.kind, title: m.title, url: m.file ? '/media/' + m.file : null, mime: m.mime, size: m.size, youtubeId: m.youtube_id, createdAt: m.created_at });

/* ------------------------------ item data ------------------------------ */
const str = (v, max = 600) => clean(v, max).trim();
const strList = (v, max = 40) => (Array.isArray(v) ? v : []).map((x) => str(x, 400)).filter(Boolean).slice(0, max);
const link = (v) => { const s = str(v, 200); return s.startsWith('/') ? s : ''; };
const media = (v) => {
  if (!v || typeof v !== 'object') return null;
  if (v.kind === 'youtube' && youtubeId(v.youtubeId || v.url)) return { kind: 'youtube', youtubeId: youtubeId(v.youtubeId || v.url), title: str(v.title, 200) };
  if (v.kind === 'file' && typeof v.url === 'string' && v.url.startsWith('/media/')) return { kind: 'file', url: v.url, mime: str(v.mime, 80), title: str(v.title, 200) };
  return null;
};
const imageUrl = (v) => { const s = str(v, 300); return s.startsWith('/media/') || s.startsWith('/img/') ? s : ''; };

/* ------------------------------ routes ------------------------------ */
const accounts = accountRoutes({ db, fail, sendJson, readJson, str, isSecure });
async function api(req, res, url) {
  const c = ctx(req);
  enterStore(db, c.storeRow); // Nov 11: BRG's companies read BRG's Hospitality Program, everyone else the generic one
  const m = req.method;
  const p = url.pathname;
  const parts = p.split('/').filter(Boolean); // ['api', ...]

  // Behind the scenes (Nov 10, server/ops.mjs): health, the nightly encrypted backup and the error report (OPS_TOKEN),
  // and browser errors from the app.
  if (p === '/api/health' && m === 'GET') { db.prepare('SELECT 1').get(); return sendJson(res, 200, { ok: true, at: new Date().toISOString() }); }
  if (p === '/api/ops/backup' && m === 'GET') {
    if (!opsAllowed(req)) fail(404, 'Not found.');
    if (!process.env.BACKUP_KEY || process.env.BACKUP_KEY.length < 24) fail(503, 'BACKUP_KEY isn’t set.');
    const buf = encryptedBackup(db);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="mise-${new Date().toISOString().slice(0, 10)}.bk"` });
    return res.end(buf);
  }
  if (p === '/api/ops/errors' && m === 'GET') {
    if (!opsAllowed(req)) fail(404, 'Not found.');
    return sendJson(res, 200, { errors: recentErrors(db, Math.min(168, Number(url.searchParams.get('hours')) || 24)) });
  }
  if (p === '/api/client-error' && m === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
    if (req.headers['x-bt'] !== '1' || !clientErrorAllowed(ip)) { res.writeHead(204); return res.end(); }
    const b = await readJson(req, 20_000).catch(() => ({}));
    logError(db, 'client', String(b.path || '').slice(0, 200), { message: String(b.message || 'Browser error'), stack: String(b.stack || '') }, c.user?.id ?? null);
    res.writeHead(204); return res.end();
  }

  // The public demo (Nov 2): /demo starts a private copy; a demo visitor can't change accounts or upload.
  // Nov 4, Tommy: "I need the demo account to be a completely separate account, not changing the Baldwin account."
  // Opening the demo used to replace your own sign-in in that browser. Now your session is kept aside (bt_return) and
  // "Exit Demo" puts it back.
  if (p === '/api/demo/start' && m === 'POST') {
    if (req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
    if (!demoLimiter.check(ip)) fail(429, 'Too many demos from here. Try again in an hour.');
    const b = await readJson(req, 2000);
    // Nov 11: two demos. `demo: 'mise'` is Wrenfield in the Mise look (/demo/mise); anything else is The Baldwin's (/demo).
    const which = Object.hasOwn(DEMOS, String(b.demo)) ? String(b.demo) : 'baldwin';
    const r = startDemo(db, String(b.role || ''), which);
    if (!r) fail(400, 'Pick a role to start.');
    demoLimiter.record(ip);
    const secure = isSecure(req);
    const set = [sessionCookie(r.token, { secure, days: 1, embeddable: true })];
    if (c.user && !isDemoCompany(db, c.user.company_id)) set.push(returnCookie(c.token, { secure }));
    else if (c.user) endSession(db, c.token); // switching demo roles: the old demo session goes
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': set });
  }
  // Nov 7, Tommy: "have all my demo restart after a refresh". A refresh swaps this visitor's copy for a new one, same role.
  // Not counted against the start limit: it replaces a copy, so nothing piles up.
  if (p === '/api/demo/restart' && m === 'POST') {
    if (req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
    if (!c.user || !isDemoCompany(db, c.user.company_id)) return sendJson(res, 200, { restarted: false });
    const r = startDemo(db, c.user.role === 'staff' ? 'employee' : 'manager', demoKind(db, c.user.company_id)); // same demo, same role
    dropDemo(db, c.user.company_id);
    return sendJson(res, 200, { restarted: true }, { 'Set-Cookie': [sessionCookie(r.token, { secure: isSecure(req), days: 1, embeddable: true })] });
  }
  // Is there a real account to go back to? Only true inside a demo opened from one.
  if (p === '/api/demo/return' && m === 'GET') {
    const back = cookies(req)[RETURN_COOKIE];
    const kept = back ? sessionUser(db, back) : null;
    return sendJson(res, 200, { own: !!(c.user && isDemoCompany(db, c.user.company_id) && kept && !isDemoCompany(db, kept.company_id)) });
  }
  if (p === '/api/demo/exit' && m === 'POST') {
    if (req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
    const secure = isSecure(req);
    if (c.user && isDemoCompany(db, c.user.company_id)) endSession(db, c.token);
    const back = cookies(req)[RETURN_COOKIE];
    const ok = back && sessionUser(db, back) && !isDemoCompany(db, sessionUser(db, back).company_id);
    return sendJson(res, 200, { ok: true, restored: !!ok }, { 'Set-Cookie': [
      ok ? sessionCookie(back, { secure }) : sessionCookie('', { clear: true, secure }), returnCookie('', { secure, clear: true }),
      ...(secure ? [sessionCookie('', { clear: true, secure, embeddable: true })] : [])] });
  }
  if (c.user && isDemoCompany(db, c.user.company_id) && demoBlocks(p, m)) fail(403, 'That’s switched off in the demo.');
  if ((await accounts(req, res, url, c)) !== false) return;

  /* quizzes: everyone signed in. A person's records are keyed 'u<id>' (older phone-only records keep their device id). */
  if (p === '/api/quiz/attempt' && m === 'POST') {
    const u = needReader(c, req);
    if (!quizLimiter.check('u' + u.id)) fail(429, 'Too many saves. Try again in an hour.');
    const b = await readJson(req, 150_000); // a Full Quiz can be hundreds of questions (Nov 6: 50, 100 and Full didn't save)
    if (/^t:/.test(String(b.quiz || '')) && lockedTopics(db, u, c.store).has(String(b.quiz).slice(2))) fail(403, 'That level is by invitation. Ask your manager.');
    const r = scoreQuiz(db, c.store, String(b.quiz || ''), b.items, b.answers);
    if (!r) fail(400, 'That quiz didn’t match. Reload and try again.');
    quizLimiter.record('u' + u.id);
    db.prepare('INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at,company_id,user_id,store_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('u' + u.id, u.name, b.quiz, r.score, r.total, JSON.stringify({ items: b.items, answers: b.answers.map(Number) }), now(), c.company, u.id, c.store);
    return sendJson(res, 200, r);
  }
  // The quizzes for this store: topics to pick from, built-in and team quizzes.
  if (p === '/api/quiz/catalog' && m === 'GET') {
    const u = needReader(c, req); const cat = quizCatalog(db, c.store);
    // Nov 12: a level by invitation (Master of the Bar) stays out of the list until this person is invited
    const locked = lockedTopics(db, u, c.store);
    if (!locked.size) return sendJson(res, 200, cat);
    return sendJson(res, 200, { ...cat, topics: cat.topics.filter((t) => !locked.has(t.key)), quizzes: cat.quizzes.filter((q) => !(q.topics || []).some((t) => locked.has(t))) });
  }
  // A fresh attempt: a built-in, team or pre-shift quiz by id, or a custom mix of topics.
  if (p === '/api/quiz/start' && m === 'POST') {
    const reader = needReader(c, req);
    const b = await readJson(req);
    let id = String(b.quiz || '');
    const locked = lockedTopics(db, reader, c.store);
    if (/^t:/.test(id) && locked.has(id.slice(2))) fail(403, 'That level is by invitation. Ask your manager.');
    if (!id && Array.isArray(b.topics)) {
      const known = new Set(topicList(questionPool(db, c.store)).map((t) => t.key));
      const topics = b.topics.map(String).filter((t) => known.has(t) && !locked.has(t));
      if (!topics.length) fail(400, 'Pick at least one topic.');
      id = customId(topics, [0, 5, 10, 20, 50, 100].includes(Number(b.count)) ? Number(b.count) : 10);
    }
    const q = startQuiz(db, c.store, id, reader.id, { fresh: b.fresh === true });
    if (!q && id === REVIEW) fail(404, 'Your review queue is empty.');
    if (!q) fail(404, 'We couldn’t find that quiz.');
    return sendJson(res, 200, q);
  }
  // The review queue: what this person marked red or yellow, and saving a mark after each answer.
  if (p === '/api/quiz/review' && m === 'GET') { const u = needReader(c, req); return sendJson(res, 200, reviewQueue(db, c.store, u.id)); }
  // A Study Guide lesson is done when its 3 quick-check cards are answered right (Nov 1).
  if (p === '/api/study/done' && m === 'POST') {
    const u = needReader(c, req);
    const b = await readJson(req);
    const key = String(b.key || '');
    const mm = /^([a-z0-9-]+)#(\d+)$/.exec(key);
    const ch = mm && chapterBySlug(mm[1]);
    if (!ch || !ch.sections[Number(mm[2])]) fail(400, 'That lesson wasn’t found. Reload and try again.');
    // Nov 2: the Mark Complete box can be unticked too.
    if (b.done === false) db.prepare('DELETE FROM manual_reads WHERE user_id = ? AND slug = ?').run(u.id, key);
    else markRead(db, u.id, key);
    return sendJson(res, 200, { ok: true });
  }
  // The Training Acknowledgment (Nov 11; a Day 1 path step since Nov 12, server/acks.mjs): the words in this company's
  // version, whether this person has signed it, and their trainer's sign-off.
  if (p === '/api/path/ack' && m === 'GET') {
    const u = needReader(c, req);
    const text = programText('hosp').ack || {};
    const so = db.prepare('SELECT s.at, u.name by_name FROM signoffs s LEFT JOIN users u ON u.id = s.by_user WHERE s.device = ? AND s.quiz = ? AND s.store_id = ?').get('u' + u.id, ACK_KEY, c.store);
    return sendJson(res, 200, { level: ACK_LEVEL, script: text.script || null, title: text.title || 'Training Acknowledgment', statement: text.statement || '',
      signed: ackOf(db, u.id, c.store), canSign: true, trainer: so ? { at: so.at, by: so.by_name || null } : null });
  }
  // The person signs it themselves (typed name + "I agree").
  if ((p === '/api/path/ack' || p === '/api/program/ack') && m === 'POST') {
    const u = needReader(c, req);
    const b = await readJson(req);
    // 'hosp-1' is what a page loaded before Nov 12 sends: it's the same acknowledgment
    if (b.level !== undefined && ![ACK_LEVEL, 'hosp-1'].includes(String(b.level))) fail(400, 'That acknowledgment wasn’t found. Reload and try again.');
    const name = str(b.name, 80).replace(/\s+/g, ' ').trim();
    if (name.length < 2) fail(400, 'Type your full name to sign.');
    if (b.agree !== true) fail(400, 'Tick the box to say you’ve read it and agree.');
    const ack = signAck(db, { userId: u.id, storeId: c.store, companyId: c.company, name });
    // Signing asks the trainer for the sign-off: it shows in the manager's Sign-offs waiting (staff only, once, not if signed off)
    const me = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(u.id);
    if (me?.role === 'staff' && me.store_id === c.store && !db.prepare('SELECT 1 FROM signoffs WHERE device = ? AND quiz = ? AND store_id = ?').get('u' + u.id, ACK_KEY, c.store))
      db.prepare('INSERT OR IGNORE INTO signoff_requests(user_id, store_id, company_id, key, at) VALUES (?,?,?,?,?)').run(u.id, c.store, c.company, ACK_KEY, now());
    audit(db, u.id, 'sign acknowledgment', `Training Acknowledgment · ${name}`, c.company);
    return sendJson(res, 200, { ok: true, ack });
  }
  if (p === '/api/quiz/mark' && m === 'POST') {
    const u = needReader(c, req);
    const b = await readJson(req);
    if (!setMark(db, c.store, u.id, String(b.ref || ''), String(b.mark || ''))) fail(400, 'That mark didn’t save. Reload and try again.');
    return sendJson(res, 200, reviewQueue(db, c.store, u.id));
  }
  // Managers save a mix as a quiz for the whole team (it gets sign-offs like the built-in ones).
  if (p === '/api/quiz/sets' && m === 'POST') {
    const u = needUser(c, req);
    const b = await readJson(req);
    const name = str(b.name, 60).trim();
    const known = new Set(topicList(questionPool(db, c.store)).map((t) => t.key));
    const topics = (Array.isArray(b.topics) ? b.topics : []).map(String).filter((t) => known.has(t));
    if (!name) fail(400, 'Give the quiz a name.');
    if (!topics.length) fail(400, 'Pick at least one topic.');
    const count = [0, 5, 10, 20, 50, 100].includes(Number(b.count)) ? Number(b.count) : 10;
    const r = db.prepare('INSERT INTO quiz_sets(company_id,store_id,name,topics,count,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(c.company, c.store, name, JSON.stringify(topics), count, u.id, now());
    audit(db, u.id, 'add quiz', name, c.company);
    return sendJson(res, 200, { id: 's:' + r.lastInsertRowid });
  }
  if (parts[1] === 'quiz' && parts[2] === 'sets' && parts[3] && m === 'DELETE') {
    const u = needUser(c, req);
    const r = db.prepare('UPDATE quiz_sets SET archived_at = ? WHERE id = ? AND store_id = ? AND archived_at IS NULL').run(now(), Number(parts[3]), c.store);
    if (!r.changes) fail(404, 'We couldn’t find that quiz.');
    audit(db, u.id, 'archive quiz', parts[3], c.company);
    return sendJson(res, 200, { ok: true, archived: true });
  }
  if (p === '/api/quiz/mine' && m === 'GET') {
    const u = needReader(c, req);
    const best = db.prepare('SELECT quiz, MAX(score * 1.0 / total) ratio, MAX(score) best, total, MAX(at) at FROM quiz_attempts WHERE device = ? GROUP BY quiz').all('u' + u.id);
    const signoffs = db.prepare('SELECT quiz, at FROM signoffs WHERE device = ?').all('u' + u.id);
    return sendJson(res, 200, { best: best.map((r) => ({ quiz: r.quiz, best: r.best, total: r.total, at: r.at })), signoffs });
  }
  if (p === '/api/quiz/results' && m === 'GET') {
    needUser(c, req);
    return sendJson(res, 200, { people: quizResults(db, c.store), store: c.storeRow?.name || null });
  }
  /* ---- Certificates (Nov 8): server/certs.mjs. Your own, or (managers) one of your store's staff with ?user= ---- */
  if (p === '/api/certificates' && m === 'GET') {
    const u = needReader(c, req);
    const who = url.searchParams.get('user');
    let row = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(u.id) || u;
    if (who && Number(who) !== u.id) {
      if (!canEdit(u)) fail(403, 'You can only see your own certificates.');
      const x = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(Number(who));
      if (!x || x.company_id !== c.company || x.store_id !== c.store) fail(404, 'We couldn’t find that person.');
      row = x;
    }
    return sendJson(res, 200, { certificates: certificatesFor(db, row, c.store, c.storeRow) });
  }
  /* ---- Job paths (Nov 8): server/paths.mjs ---- */
  if (p.startsWith('/api/path')) {
    const pathCtx = () => pathCtxFor(db, c.storeRow, c.user);
    const userRow = (id) => db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
    // A manager's people: staff of the store they're working in, in their company.
    const staffOf = () => db.prepare("SELECT * FROM users WHERE company_id = ? AND store_id = ? AND role = 'staff' AND deleted_at IS NULL ORDER BY name").all(c.company, c.store);
    const person = (id) => { const x = userRow(Number(id)); if (!x || x.company_id !== c.company || x.store_id !== c.store || x.role !== 'staff') fail(404, 'We couldn’t find that person.'); return x; };
    if (p === '/api/path' && m === 'GET') { const u = needReader(c, req); return sendJson(res, 200, personPath(db, c.store, userRow(u.id) || u, pathCtx())); }
    // Staff pick their own job once; after that a manager changes it.
    if (p === '/api/path/jobs' && m === 'POST') {
      const u = needReader(c, req); const row = userRow(u.id);
      if (validJobs(JSON.parse(row?.jobs || '[]')).length && !canEdit(u)) fail(403, 'Ask a manager to change your job.');
      const jobs = validJobs((await readJson(req)).jobs);
      if (!jobs.length) fail(400, 'Pick your job.');
      db.prepare('UPDATE users SET jobs = ? WHERE id = ?').run(JSON.stringify(jobs), u.id);
      return sendJson(res, 200, personPath(db, c.store, userRow(u.id), pathCtx()));
    }
    // "Mark as Read" on a page in your path.
    if (p === '/api/path/read' && m === 'POST') {
      const u = needReader(c, req); const b = await readJson(req);
      const slug = String(b.slug || '');
      if (!pathCtx().slugs.has(slug)) fail(400, 'That page wasn’t found. Reload and try again.');
      if (b.done === false) db.prepare('DELETE FROM manual_reads WHERE user_id = ? AND slug = ?').run(u.id, 'page:' + slug);
      else db.prepare('INSERT OR IGNORE INTO manual_reads(user_id, slug, at) VALUES (?,?,?)').run(u.id, 'page:' + slug, now());
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/path/team' && m === 'GET') {
      needUser(c, req); const ctx = pathCtx();
      return sendJson(res, 200, { jobs: JOBS, store: c.storeRow?.name || null, people: staffOf().map((x) => personSummary(db, c.store, x, ctx)) });
    }
    // Nov 11 (People, Figma 532:274): one person, everything a manager acts on in one place.
    const personFull = (x, ctx = pathCtx()) => {
      const { row, path } = personRow(db, c.store, x, ctx);
      const mine = quizResults(db, c.store).find((r) => r.device === 'u' + x.id);
      const quizzes = mine ? Object.entries(mine.quizzes).filter(([id]) => id !== 'pre-shift').map(([id, q]) => ({ id, title: q.title, best: q.best, total: q.total, attempts: q.attempts, lastAt: q.lastAt,
        passed: q.best >= passFor(q.total), signedOff: mine.signoffs[id] || null, signable: signable(db, c.store, id) })) : [];
      const quizAverage = quizzes.length ? Math.round((quizzes.reduce((n, q) => n + q.best / q.total, 0) / quizzes.length) * 100) : null;
      const certificates = certificatesFor(db, x, c.store, c.storeRow).map((z) => ({ key: z.key, title: z.title, earnedAt: z.earnedAt }));
      return { ...path, ...row, hasPin: !!x.pin_hash, createdAt: x.created_at, store: c.storeRow?.name || null, quizzes, quizAverage, certificates };
    };
    const pm = /^\/api\/path\/person\/(\d+)$/.exec(p);
    if (pm && m === 'GET') { needUser(c, req); const x = person(pm[1]); return sendJson(res, 200, personFull(x)); }
    if (pm && m === 'PATCH') {
      const u = needUser(c, req); const x = person(pm[1]); const b = await readJson(req);
      if (b.jobs !== undefined) {
        db.prepare('UPDATE users SET jobs = ? WHERE id = ?').run(JSON.stringify(validJobs(b.jobs)), x.id);
        // A new job swaps the path: asks for the old path's sign-offs go (finished steps carry over where they're shared).
        const moved = userRow(x.id);
        for (const r of db.prepare('SELECT key FROM signoff_requests WHERE user_id = ? AND store_id = ?').all(x.id, c.store)) if (!isPathSignoff(moved, r.key)) db.prepare('DELETE FROM signoff_requests WHERE user_id = ? AND store_id = ? AND key = ?').run(x.id, c.store, r.key);
      }
      if (b.startedOn !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.startedOn))) fail(400, 'Pick a start date.');
        db.prepare('UPDATE users SET started_on = ? WHERE id = ?').run(String(b.startedOn), x.id);
      }
      audit(db, u.id, 'training path', `${x.name}: ${b.jobs !== undefined ? 'jobs ' + validJobs(b.jobs).join(', ') : ''}${b.startedOn ? ' started ' + b.startedOn : ''}`, c.company);
      return sendJson(res, 200, personFull(userRow(x.id)));
    }
    // Staff ask for a sign-off from My Path (a path sign-off step, or a program's practical); they can take it back.
    if (p === '/api/path/ask' && (m === 'POST' || m === 'DELETE')) {
      const u = needReader(c, req); const row = userRow(u.id); const key = String((await readJson(req)).key || '');
      if (!row || row.role !== 'staff' || row.store_id !== c.store) fail(403, 'Sign-offs are for staff.');
      if (!isPathSignoff(row, key)) fail(400, 'That step can’t be signed off.');
      if (m === 'POST') {
        if (db.prepare('SELECT 1 FROM signoffs WHERE device = ? AND quiz = ? AND store_id = ?').get('u' + u.id, key, c.store)) fail(409, 'That’s already signed off.');
        db.prepare('INSERT OR REPLACE INTO signoff_requests(user_id, store_id, company_id, key, at) VALUES (?,?,?,?,?)').run(u.id, c.store, c.company, key, now());
      } else db.prepare('DELETE FROM signoff_requests WHERE user_id = ? AND store_id = ? AND key = ?').run(u.id, c.store, key);
      return sendJson(res, 200, personPath(db, c.store, userRow(u.id), pathCtx()));
    }
    // Close a note from a manager on My Path.
    if (p === '/api/path/notes/seen' && m === 'POST') {
      const u = needReader(c, req); const id = Number((await readJson(req)).id);
      db.prepare('UPDATE notes SET seen_at = ? WHERE id = ? AND user_id = ? AND seen_at IS NULL').run(now(), id, u.id);
      return sendJson(res, 200, { ok: true });
    }
    // "Not Yet": the manager watched and it isn't there yet. The ask goes back to the person with an optional word why.
    if (p === '/api/path/not-yet' && m === 'POST') {
      const u = needUser(c, req); const b = await readJson(req); const x = person(b.userId); const key = String(b.key || '');
      const r = db.prepare('UPDATE signoff_requests SET declined_at = ?, declined_by = ?, note = ? WHERE user_id = ? AND store_id = ? AND key = ? AND declined_at IS NULL')
        .run(now(), u.id, str(b.note, 200) || null, x.id, c.store, key);
      if (!r.changes) fail(404, 'That sign-off isn’t waiting anymore.');
      audit(db, u.id, 'not yet', `${x.name} · ${key}`, c.company);
      return sendJson(res, 200, personFull(x));
    }
    // Give More Time: one step to a date the manager picks, or (no step) every late step to 3 days from today.
    if (p === '/api/path/more-time' && m === 'POST') {
      const u = needUser(c, req); const b = await readJson(req); const x = person(b.userId);
      const steps = pathSteps(personPath(db, c.store, x, pathCtx())).filter((s) => !s.done);
      const t = todayIso();
      let moves;
      if (b.step) {
        const s = steps.find((z) => z.id === String(b.step));
        if (!s) fail(400, 'That step isn’t open on their path.');
        const due = String(b.due || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < t || due > addDays(t, 90)) fail(400, 'Pick a date between today and three months out.');
        moves = [[s.id, due]];
      } else {
        moves = steps.filter((s) => s.late).map((s) => [s.id, addDays(t, 3)]);
        if (!moves.length) fail(400, 'Nothing on their path is late.');
      }
      const ins = db.prepare('INSERT OR REPLACE INTO path_due(user_id, store_id, company_id, step, due, by_user, at) VALUES (?,?,?,?,?,?,?)');
      for (const [step, due] of moves) ins.run(x.id, c.store, c.company, step, due, u.id, now());
      audit(db, u.id, 'more time', `${x.name} · ${moves.map(([s, d]) => `${s} → ${d}`).join(', ')}`, c.company);
      return sendJson(res, 200, personFull(x));
    }
    // Send a Reminder / Send Congrats: a note on their My Path (no email service yet, so it shows when they open the app).
    if ((p === '/api/path/remind' || p === '/api/path/congrats') && m === 'POST') {
      const u = needUser(c, req); const b = await readJson(req); const x = person(b.userId);
      const ctx = pathCtx();
      let body;
      if (p === '/api/path/remind') body = reminderText(personRow(db, c.store, x, ctx).row);
      else {
        const cert = certificatesFor(db, x, c.store, c.storeRow).find((z) => z.key === String(b.cert || ''));
        if (!cert) fail(400, 'That certificate isn’t theirs yet.');
        body = `Congrats on earning ${cert.title}.`;
      }
      addNote(db, { company: c.company, store: c.store, userId: x.id, by: u.id, kind: p === '/api/path/remind' ? 'reminder' : 'congrats', body });
      audit(db, u.id, p === '/api/path/remind' ? 'reminder' : 'congrats', x.name, c.company);
      return sendJson(res, 200, personFull(x, ctx));
    }
    // A manager signs off a path step (a sign-off, or a quiz they've watched someone know cold).
    if (p === '/api/path/signoff' && (m === 'POST' || m === 'DELETE')) {
      const u = needUser(c, req); const b = await readJson(req);
      const x = person(b.userId); const key = String(b.key || '');
      if (!isPathSignoff(x, key) && !signable(db, c.store, key) && !isInviteKey(key)) fail(400, 'That step can’t be signed off.');
      // Nov 12: inviting someone to a level by invitation (Master of the Bar). Managers and owners can already open it.
      if (isInviteKey(key) && x.role !== 'staff') fail(400, 'Managers and owners can already open that level.');
      // The Training Acknowledgment (Nov 11, a path step since Nov 12): the trainer signs off after the person has signed it
      if (m === 'POST' && key === ACK_KEY && !ackOf(db, x.id, c.store)) fail(400, `${x.name.split(/\s+/)[0]} hasn’t signed the acknowledgment yet.`);
      if (m === 'POST') {
        db.prepare('INSERT OR REPLACE INTO signoffs(device,quiz,by_user,at,company_id,store_id) VALUES (?,?,?,?,?,?)').run('u' + x.id, key, u.id, now(), c.company, c.store);
        db.prepare('DELETE FROM signoff_requests WHERE user_id = ? AND store_id = ? AND key = ?').run(x.id, c.store, key); // asked and answered
      } else db.prepare('DELETE FROM signoffs WHERE device = ? AND quiz = ? AND store_id = ?').run('u' + x.id, key, c.store);
      audit(db, u.id, isInviteKey(key) ? (m === 'POST' ? 'invite to level' : 'remove level invitation') : m === 'POST' ? 'sign off' : 'undo sign off', `${x.name} · ${key}`, c.company);
      return sendJson(res, 200, personFull(userRow(x.id)));
    }
  }
  /* ---- Team Chat (Nov 11, server/chat.mjs, Figma 580:670): one store's channels and direct messages ---- */
  if (p === '/api/chat' || p.startsWith('/api/chat/')) {
    needReader(c, req);
    const x = chat.chatCtx(db, c);
    // The sidebar's number, polled lightly on every page. Someone who isn't on this store's team just gets 0.
    if (p === '/api/chat/unread' && m === 'GET') return sendJson(res, 200, { count: x ? chat.unreadTotal(x) : 0, member: !!x });
    if (!x) fail(403, 'Team Chat is for the people who work at this store.');
    try {
      if (p === '/api/chat' && m === 'GET') return sendJson(res, 200, chat.roomList(x));
      if (p === '/api/chat/search' && m === 'GET') return sendJson(res, 200, { results: chat.search(x, url.searchParams.get('q')) });
      // Send to Team: the card a page (anyone) or a person (managers, this store's staff) makes, before it's sent.
      if (p === '/api/chat/card' && m === 'GET') {
        if (url.searchParams.get('person')) return sendJson(res, 200, { type: 'person', card: chat.personCard(x, url.searchParams.get('person')) });
        const card = chat.pageCard(db, x.storeRow, url.searchParams.get('page'), x.user);
        if (!card) fail(404, 'That page isn’t in the book.');
        return sendJson(res, 200, { type: 'page', card });
      }
      // A photo for a message. Uploads are off in the demo (demoBlocks).
      if (p === '/api/chat/photo' && m === 'POST') {
        const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
        if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(mime)) fail(415, 'Send a photo (JPG, PNG or WebP).');
        if (Number(req.headers['content-length'] || 0) > chat.PHOTO_MAX) fail(413, 'That photo is over 15 MB.');
        const buf = await new Promise((resolve, reject) => {
          const parts = []; let size = 0;
          req.on('data', (d) => { size += d.length; if (size > chat.PHOTO_MAX) { reject(new HttpError(413, 'That photo is over 15 MB.')); req.destroy(); } else parts.push(d); });
          req.on('end', () => resolve(Buffer.concat(parts))); req.on('error', reject);
        });
        if (!buf.length) fail(400, 'That photo was empty.');
        return sendJson(res, 200, { url: await chat.savePhoto(buf) });
      }
      const rm = /^\/api\/chat\/room\/([a-z0-9-]{2,40})(?:\/(messages|read))?$/.exec(p);
      if (rm) {
        const room = chat.resolveRoom(x, rm[1], { create: true });
        if (!rm[2] && m === 'GET') {
          const before = url.searchParams.get('before');
          if (!before && url.searchParams.get('rev') !== null && Number(url.searchParams.get('rev')) === room.rev) return sendJson(res, 200, { same: true, rev: room.rev });
          return sendJson(res, 200, chat.roomDetail(x, room, { before }));
        }
        if (rm[2] === 'messages' && m === 'POST') {
          const id = chat.postMessage(x, room, await readJson(req, 20_000));
          return sendJson(res, 200, { id, ...chat.roomDetail(x, db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(room.id)) });
        }
        if (rm[2] === 'read' && m === 'POST') { chat.markRead(x, room, (await readJson(req, 2000)).last); return sendJson(res, 200, { unread: chat.unreadTotal(x) }); }
      }
      const mm = /^\/api\/chat\/message\/(\d+)(?:\/(react|pin|got-it))?$/.exec(p);
      if (mm) {
        let room;
        if (!mm[2] && m === 'DELETE') {
          const own = db.prepare('SELECT user_id FROM chat_messages WHERE id = ?').get(Number(mm[1]))?.user_id === x.me.id;
          room = chat.removeMessage(x, mm[1]);
          if (!own) audit(db, x.me.id, 'chat remove', `message ${mm[1]}`, c.company);
        } else if (mm[2] === 'react' && m === 'POST') room = chat.react(x, mm[1], String((await readJson(req, 2000)).emoji || ''));
        else if (mm[2] === 'pin' && (m === 'POST' || m === 'DELETE')) room = chat.pin(x, mm[1], m === 'POST');
        else if (mm[2] === 'got-it' && (m === 'POST' || m === 'DELETE')) room = chat.gotIt(x, mm[1], m === 'POST');
        if (room) return sendJson(res, 200, chat.roomDetail(x, db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(room.id)));
      }
    } catch (e) { if (e instanceof chat.ChatError) fail(e.status, e.message); throw e; }
    fail(404, 'Not found.');
  }
  /* ---- Prep tracker (Nov 12, server/prep.mjs, Figma 09 · Proposals → 31): juices, syrups and garnishes ---- */
  // Everyone at the store reads Today. Bartenders, managers and owners count and log (prep.canLog); managers and owners edit.
  // Nov 12 (31b): POST /api/prep/count saves the shift count; the Used Up route is gone (Used comes from the count).
  if (p === '/api/prep' || p.startsWith('/api/prep/')) {
    const u = needReader(c, req);
    if (!c.storeRow) fail(400, 'Pick a store to work in first.');
    const x = { company: c.company, store: c.store, storeRow: c.storeRow };
    const logger = () => { if (!prep.canLog(u)) fail(403, 'Bartenders and managers log prep. Ask your manager if that should be you.'); };
    const manager = () => { if (!prep.canManage(u)) fail(403, 'Only managers can change prep items and pars.'); };
    try {
      if (p === '/api/prep' && m === 'GET') return sendJson(res, 200, prep.today(db, c.storeRow, u));
      if (p === '/api/prep/count' && m === 'GET') return sendJson(res, 200, prep.countSheet(db, c.storeRow, u));
      if (p === '/api/prep/count' && m === 'POST') { logger(); prep.saveCount(db, x, u, await readJson(req, 100_000)); return sendJson(res, 200, prep.today(db, c.storeRow, u)); }
      const im = /^\/api\/prep\/items\/(\d+)(?:\/(suggestion|archive|restore|ranout))?$/.exec(p);
      if (im && !im[2] && m === 'GET') { const d = prep.itemDetail(db, c.storeRow, u, im[1]); if (!d) fail(404, 'That prep item isn’t here.'); return sendJson(res, 200, d); }
      if (im && !im[2] && m === 'PATCH') { manager(); prep.saveItem(db, x, u, Number(im[1]), await readJson(req, 20_000)); return sendJson(res, 200, prep.itemDetail(db, c.storeRow, u, im[1])); }
      if (p === '/api/prep/items' && m === 'POST') { manager(); const id = prep.saveItem(db, x, u, null, await readJson(req, 20_000)); return sendJson(res, 200, { id }); }
      if (im?.[2] === 'suggestion' && m === 'POST') { manager(); prep.answerSuggestion(db, x, u, im[1], await readJson(req)); return sendJson(res, 200, prep.itemDetail(db, c.storeRow, u, im[1])); }
      if ((im?.[2] === 'archive' || im?.[2] === 'restore') && m === 'POST') { manager(); prep.archiveItem(db, x, u, im[1], im[2] === 'archive'); return sendJson(res, 200, { ok: true }); }
      if (im?.[2] === 'ranout' && m === 'POST') { logger(); prep.ranOut(db, x, u, im[1], (await readJson(req)).note); return sendJson(res, 200, { ok: true }); }
      if (p === '/api/prep/batches' && m === 'POST') { logger(); return sendJson(res, 200, prep.logBatch(db, x, u, await readJson(req))); }
      if (p === '/api/prep/waste' && m === 'POST') { logger(); prep.logWaste(db, x, u, await readJson(req)); return sendJson(res, 200, { ok: true }); }
      if (p === '/api/prep/report' && m === 'GET') {
        manager();
        const q = url.searchParams;
        return sendJson(res, 200, prep.report(db, c.storeRow, { range: q.get('range') || 'week', at: q.get('at') || undefined, series: q.get('series') || '' }));
      }
      if (p === '/api/prep/report/send' && m === 'POST') { manager(); return sendJson(res, 200, prep.sendSummary(db, c, u, await readJson(req, 20_000))); }
    } catch (e) { if (e instanceof prep.PrepError) fail(e.status, e.message); throw e; }
    fail(404, 'Not found.');
  }
  /* ---- Manager home + People (Nov 11, server/team.mjs): the team in the store you're working in ---- */
  // The count beside Sign-offs in the sidebar: asks still waiting in this store.
  if (p === '/api/manager/signoffs/count' && m === 'GET') {
    needUser(c, req);
    const n = c.store ? db.prepare(`SELECT COUNT(*) n FROM signoff_requests r JOIN users u ON u.id = r.user_id WHERE r.store_id = ? AND r.declined_at IS NULL
      AND u.deleted_at IS NULL AND u.role = 'staff' AND u.store_id = r.store_id
      AND NOT EXISTS (SELECT 1 FROM signoffs s WHERE s.device = 'u' || r.user_id AND s.quiz = r.key AND s.store_id = r.store_id)`).get(c.store).n : 0;
    return sendJson(res, 200, { count: n });
  }
  if ((p === '/api/manager/team' || p === '/api/manager/home') && m === 'GET') {
    const u = needUser(c, req);
    if (!c.storeRow) fail(400, 'Pick a store to work in first.');
    const ctx = pathCtxFor(db, c.storeRow, c.user);
    const rows = teamRows(db, c.company, c.storeRow, ctx);
    const co = db.prepare('SELECT name, join_code FROM companies WHERE id = ?').get(c.company);
    const out = { store: c.storeRow.name, company: co?.name || null, joinCode: co?.join_code || (c.user.demo ? 'DEMO' : null), you: u.name, jobs: JOBS,
      people: rows.map((r) => r.row), signoffs: signoffQueue(rows) };
    if (p === '/api/manager/home') Object.assign(out, {
      certificates: newCertificates(db, rows, c.storeRow), quizzes: quizWeek(db, c.store), edits: lastEdits(db, c.company, c.store), book: bookTiles(db, c.storeRow, c.user),
    });
    return sendJson(res, 200, out);
  }
  if (p === '/api/quiz/signoff' && (m === 'POST' || m === 'DELETE')) {
    const u = needUser(c, req);
    const b = await readJson(req);
    const dev = String(b.device || ''), quiz = String(b.quiz || '');
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(dev) || !signable(db, c.store, quiz)) fail(400, 'Missing person or quiz.');
    const who = db.prepare('SELECT name FROM quiz_attempts WHERE device = ? AND store_id = ? ORDER BY id DESC LIMIT 1').get(dev, c.store);
    if (!who) fail(404, 'We couldn’t find that person.');
    if (m === 'POST') db.prepare('INSERT OR REPLACE INTO signoffs(device,quiz,by_user,at,company_id,store_id) VALUES (?,?,?,?,?,?)').run(dev, quiz, u.id, now(), c.company, c.store);
    else db.prepare('DELETE FROM signoffs WHERE device = ? AND quiz = ? AND store_id = ?').run(dev, quiz, c.store);
    audit(db, u.id, m === 'POST' ? 'sign off' : 'undo sign off', `${who.name} · ${titleFor(db, c.store, quiz)}`, c.company);
    return sendJson(res, 200, { ok: true });
  }

  /* content */
  if (p === '/api/index' && m === 'GET') {
    needBook(c, req);
    const list = inStore(c, () => fullIndex(db));
    return sendJson(res, 200, list, {}, isCachedIndex(list) ? indexBytes(list) : null);
  }
  if (p === '/api/counts' && m === 'GET') { needBook(c, req); return sendJson(res, 200, inStore(c, () => sidebarCounts(db))); }
  if (parts[1] === 'page' && parts[2] && m === 'GET') {
    needBook(c, req);
    const page = inStore(c, () => assemble(db, parts[2]));
    if (!page) fail(404, 'We couldn’t find that page.');
    return sendJson(res, 200, page);
  }
  /* CMS: collections and their pages */
  if (p === '/api/collections' && m === 'GET') {
    needEditor(c, req);
    const counts = Object.fromEntries(Object.keys(COLLECTIONS).map((id) => [id, listEntries(db, id, SHARED.has(id) ? null : c.store).length]));
    const schemas = publicSchemas();
    const gc = schemas.classic.fields.find((f) => f.key === 'glassCard');
    if (gc) gc.options = glassTitles();
    // Nov 11: a Mise-brand company (the Mise demo) doesn't get The Baldwin group's own menu sections to pick from.
    if (miseBrand(c)) {
      const keep = (list) => list.filter((o) => !BALDWIN_SECTIONS.has(o)); // copies: the schemas share their field objects
      schemas.house = { ...schemas.house, group: { ...schemas.house.group, values: keep(schemas.house.group.values) },
        fields: schemas.house.fields.map((f) => (f.key === 'menuSection' ? { ...f, options: keep(f.options) } : f)) };
    }
    return sendJson(res, 200, { collections: schemas, counts });
  }
  if (p === '/api/entries' && m === 'GET') {
    needEditor(c, req);
    const col = url.searchParams.get('collection');
    if (!COLLECTIONS[col]) fail(400, 'Unknown collection.');
    if (url.searchParams.get('archived')) return sendJson(res, 200, { entries: listArchived(db, col, SHARED.has(col) ? null : c.store) });
    const list = inStore(c, () => ordered(db, col));
    // Shared classics carry The Baldwin's notes about its own builds; a Mise-brand company doesn't see them.
    if (col === 'classic' && miseBrand(c)) return sendJson(res, 200, { entries: list.map((e) => (/Baldwin/.test(e.data.specNote || '') ? { ...e, data: { ...e.data, specNote: '' } } : e)) });
    return sendJson(res, 200, { entries: list });
  }
  // Archived (Nov 12): everything taken out of this store's book, by type, with who archived it, ready to restore.
  // Classics are the shared library's, so only a super admin sees (and restores) them.
  if (p === '/api/archived' && m === 'GET') {
    const u = needEditor(c, req);
    const groups = archivedList(db, c.store, (col) => canOpen(u, `/admin/pages/${col}/new`));
    // Nov 12: the Prep tracker's items, before Videos and Photos
    groups.splice(groups.findIndex((g) => g.id === 'media'), 0, { id: 'prep', label: 'Prep items', items: prep.archivedItems(db, c.store) });
    return sendJson(res, 200, { groups });
  }
  if (p === '/api/archived/restore' && m === 'POST') {
    const u = needEditor(c, req);
    const b = await readJson(req);
    if (b.group === 'media') {
      const r = db.prepare('UPDATE media SET archived_at = NULL, archived_by = NULL WHERE store_id = ? AND archived_at IS NOT NULL').run(c.store);
      audit(db, u.id, 'restore media', `${r.changes} archived`, c.company);
      return sendJson(res, 200, { ok: true, restored: r.changes });
    }
    if (b.group === 'prep') {
      const list = prep.archivedItems(db, c.store);
      let n = 0;
      for (const it of list) { try { prep.archiveItem(db, { company: c.company, store: c.store }, u, it.id, false); n++; } catch (e) { if (!(e instanceof prep.PrepError)) throw e; } }
      return sendJson(res, 200, { ok: true, restored: n });
    }
    if (!ARCHIVE_GROUPS.some((g) => g.col === b.group)) fail(400, 'Unknown group.');
    if (SHARED.has(b.group)) needLibrary(c, req);
    const list = listArchived(db, b.group, SHARED.has(b.group) ? null : c.store);
    for (const e of list) restoreEntry(db, e.id);
    audit(db, u.id, 'restore ' + b.group, `${list.length} archived`, c.company);
    return sendJson(res, 200, { ok: true, restored: list.length });
  }
  // The group's kitchen: dishes every store in the company can put on its menu.
  if (p === '/api/library' && m === 'GET') {
    needEditor(c, req);
    const col = url.searchParams.get('collection');
    if (!LOCAL_KEYS[col]) fail(400, 'Unknown collection.');
    return sendJson(res, 200, { entries: libraryList(db, col, c.company, c.store) });
  }
  if (p === '/api/entries' && m === 'POST') {
    const b = await readJson(req);
    if (!COLLECTIONS[b.collection]) fail(400, 'Unknown collection.');
    const u = SHARED.has(b.collection) ? needLibrary(c, req) : needEditor(c, req);
    const libraryId = Number(b.libraryId) || null;
    if (!libraryId && !str(b.data?.name, 120)) fail(400, 'Give it a name.');
    if (libraryId && db.prepare("SELECT 1 FROM entries WHERE collection = ? AND store_id = ? AND archived_at IS NULL AND json_extract(data, '$.libraryId') = ?").get(b.collection, c.store, libraryId)) fail(409, 'That dish is already on your menu.');
    // Shared entries live under store 1; a store's own entries live under that store.
    let e;
    try { e = SHARED.has(b.collection) ? createEntry(db, b.collection, b.data, u.id) : createEntry(db, b.collection, b.data || {}, u.id, c.store, c.company, { libraryId, share: b.share !== false }); }
    catch (err) { fail(err.status || 400, err.message); }
    audit(db, u.id, 'add ' + b.collection, e.data.name, c.company);
    return sendJson(res, 200, e);
  }
  if (parts[1] === 'entries' && parts[2]) {
    needEditor(c, req);
    const e = getEntry(db, Number(parts[2]));
    const shared = e && SHARED.has(e.collection);
    // Another store's entry doesn't exist here.
    if (!e || (!shared && e.storeId !== c.store)) fail(404, 'We couldn’t find that page.');
    if (m === 'GET') return sendJson(res, 200, e.library ? { ...e, sharedWith: sharedWith(db, e), storeName: db.prepare('SELECT name FROM stores WHERE id = ?').get(c.store)?.name } : e);
    const u = shared ? needLibrary(c, req) : needEditor(c, req);
    // Edit Mode (Nov 11): only the fields changed on the page. They're laid over the saved record, then cleaned and saved
    // the same way as the admin form, so lists, quizzes and search follow.
    if (m === 'PATCH') {
      const b = await readJson(req);
      const changes = b.changes && typeof b.changes === 'object' && !Array.isArray(b.changes) ? b.changes : null;
      if (!changes || !Object.keys(changes).length) fail(400, 'Nothing to save.');
      const keys = new Set(COLLECTIONS[e.collection].fields.map((f) => f.key));
      const bad = Object.keys(changes).find((k) => !keys.has(k));
      if (bad) fail(400, 'That can’t be changed here.');
      if (e.archivedAt) fail(409, 'This page is archived. Restore it from Archived first.');
      const data = { ...e.data, ...changes };
      delete data.libraryId;
      if (!str(data.name, 120)) fail(400, 'Give it a name.');
      const out = updateEntry(db, e.id, data, u.id, b.scope === 'store' ? 'store' : 'group');
      audit(db, u.id, 'edit ' + e.collection, out.data.name, c.company); // the plain name: "Your last edits" opens it by name
      return sendJson(res, 200, out);
    }
    if (m === 'PUT') {
      const b = await readJson(req);
      if (!str(b.data?.name, 120)) fail(400, 'Give it a name.');
      const out = updateEntry(db, e.id, b.data, u.id, b.scope === 'store' ? 'store' : 'group');
      audit(db, u.id, 'edit ' + e.collection, out.data.name);
      return sendJson(res, 200, out);
    }
    // "Delete" archives: the page leaves the book and every list, and can be restored (Tommy, Oct 28).
    if (m === 'DELETE') {
      archiveEntry(db, e.id, u.id);
      audit(db, u.id, 'archive ' + e.collection, e.data.name, c.company);
      return sendJson(res, 200, { ok: true, archived: true });
    }
    if (m === 'POST' && parts[3] === 'restore') {
      const out = restoreEntry(db, e.id);
      audit(db, u.id, 'restore ' + e.collection, e.data.name, c.company);
      return sendJson(res, 200, out);
    }
    if (m === 'POST' && parts[3] === 'move') {
      const b = await readJson(req);
      return sendJson(res, 200, moveEntry(db, e.id, Number(b.dir) < 0 ? -1 : 1));
    }
  }

  /* wine videos: "Learn more about …" on wine pages, and wines on the list */
  /* Floor Plan: tonight's sections. Everyone reads them; a signed-in manager fills them in before line-up. */
  if (p === '/api/sections' && m === 'GET') {
    needReader(c, req);
    const day = restaurantDay();
    const rows = db.prepare('SELECT slot, name FROM sections WHERE day = ? AND store_id = ?').all(day, c.store);
    return sendJson(res, 200, { day, names: Object.fromEntries(rows.map((r) => [r.slot, r.name])) });
  }
  if (p === '/api/sections' && m === 'PUT') {
    const u = needUser(c, req);
    const b = await readJson(req);
    const slot = str(b.slot, 40), name = str(b.name, 60).trim();
    if (!/^(Servers|Bar|Support) \d$/.test(slot)) fail(400, 'We couldn’t find that section.');
    const day = restaurantDay();
    if (name) db.prepare('INSERT OR REPLACE INTO sections(company_id,store_id,day,slot,name,by_user,at) VALUES (?,?,?,?,?,?,?)').run(c.company, c.store, day, slot, name, u.id, now());
    else db.prepare('DELETE FROM sections WHERE store_id = ? AND day = ? AND slot = ?').run(c.store, day, slot);
    audit(db, u.id, 'set section', `${day} · ${slot} · ${name || 'Unassigned'}`, c.company);
    return sendJson(res, 200, { ok: true, day, slot, name });
  }
  if (p === '/api/wine-videos' && m === 'GET') {
    const u = needEditor(c, req);
    const vids = wineVideos(db);
    // Managers see the wines on their own list; the grape and region pages are the shared library (super admins).
    const shows = (g) => (g.label === 'Wines on our list' ? !!c.storeRow?.book_ready : u.role === 'superadmin');
    const groups = wineTargets(baseIndex(), basePage).filter(shows).map((g) => ({ ...g, items: g.items.map((it) => ({ ...it, ...(vids.get(it.key) || { video: null, note: '' }) })) }));
    return sendJson(res, 200, { groups });
  }
  if (p === '/api/wine-videos' && m === 'PUT') {
    const b = await readJson(req);
    // Grape and region pages are the shared library; "Wines on our list" are The Baldwin's own.
    const own = String(b.key || '').startsWith('wine:');
    const u = own ? needEditor(c, req) : needLibrary(c, req);
    if (own && !c.storeRow?.book_ready) fail(400, 'We couldn’t find that wine page.');
    const target = wineTargets(baseIndex(), basePage).flatMap((g) => g.items).find((it) => it.key === b.key);
    if (!target) fail(400, 'We couldn’t find that wine page.');
    const video = b.video ? media(b.video) : null;
    if (b.video && !video) fail(400, 'That video can’t be used. Pick it again from the library.');
    setWineVideo(db, target.key, video, str(b.note, 400), u.id);
    audit(db, u.id, video ? 'set wine video' : 'remove wine video', target.name);
    return sendJson(res, 200, { ok: true, video, note: video ? str(b.note, 400) : '' });
  }

  /* Bottle scanner (admin): photo → just the bottle, on the Wine Book beige → a media file.
   * In a demo (Nov 12) it works the same, within DEMO_SCAN; what it saves stays in that demo's folder. */
  if (p === '/api/scan/ready' && m === 'POST') {
    const u = needEditor(c, req);
    warmScanner();
    const dm = demoMediaOf(db, u.company_id);
    if (!dm) return sendJson(res, 200, { ok: true });
    const key = dm.slice(5);
    const left = (lim, n) => Math.max(0, n - db.prepare('SELECT COUNT(*) n FROM limits WHERE name = ? AND key = ? AND at > ?').get(lim.name, key, Date.now() - lim.windowMs).n);
    return sendJson(res, 200, { ok: true, demo: { scans: DEMO_SCAN.scans, saves: DEMO_SCAN.saves, scansLeft: left(demoScans, DEMO_SCAN.scans), savesLeft: Math.max(0, DEMO_SCAN.saves - demoSaves(c.company)) } });
  }
  if (p === '/api/scan' && m === 'POST') {
    const u = needEditor(c, req);
    const dm = demoMediaOf(db, u.company_id), ip = clientIp(req);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mime)) fail(415, 'Take a photo, or upload a JPG, PNG or WebP.');
    if (dm) {
      if (!demoScans.check(dm.slice(5))) fail(429, `This demo has read its ${DEMO_SCAN.scans} photos. Refresh the page for a fresh demo.`);
      if (!demoScanIp.check(ip)) fail(429, 'Too many scans from here. Try again in an hour.');
    }
    const max = dm ? DEMO_SCAN.bytes : 25e6;
    if (Number(req.headers['content-length'] || 0) > max) fail(413, `That photo is over ${max / 1e6} MB.`);
    const chunks = []; let size = 0;
    for await (const ch of req) { size += ch.length; if (size > max) fail(413, `That photo is over ${max / 1e6} MB.`); chunks.push(ch); }
    try {
      const r = await startScan(Buffer.concat(chunks), { owner: u.id, demo: !!dm, maxPixels: dm ? DEMO_SCAN.pixels : undefined });
      if (dm) { demoScans.record(dm.slice(5)); demoScanIp.record(ip); }
      return sendJson(res, 200, r);
    }
    catch (e) { if (!e.status) console.error('scan', e); fail(e.status || 500, e.status ? e.message : 'The scanner couldn’t read that photo. Try another.'); }
  }
  if (p === '/api/scan/cut' && m === 'POST') {
    const u = needEditor(c, req);
    const dm = demoMediaOf(db, u.company_id), ip = clientIp(req);
    const b = await readJson(req);
    if (!Array.isArray(b.box) || b.box.length !== 4) fail(400, 'Draw a box around the bottle.');
    if (dm && (!demoCuts.check(dm.slice(5)) || !demoCutIp.check(ip))) fail(429, 'That’s all the cuts for this demo. Refresh the page for a fresh demo.');
    try {
      const jpg = await cutScan(String(b.token || ''), b.box, u.id);
      if (dm) { demoCuts.record(dm.slice(5)); demoCutIp.record(ip); }
      return sendJson(res, 200, { preview: 'data:image/jpeg;base64,' + jpg.toString('base64') });
    }
    catch (e) { if (!e.status) console.error('cut', e); fail(e.status || 500, e.status ? e.message : 'The scanner couldn’t cut that out. Try a new box.'); }
  }
  // Spin scan: after the first frame is cut, each later frame is posted here, then all of them are kept together.
  if (p === '/api/scan/spin' && m === 'POST') {
    const u = needEditor(c, req);
    const dm = demoMediaOf(db, u.company_id);
    const token = url.searchParams.get('token') || '';
    const chunks = []; let size = 0;
    for await (const ch of req) { size += ch.length; if (size > 8e6) fail(413, 'That frame is too big.'); chunks.push(ch); }
    try { return sendJson(res, 200, { frames: await spinFrame(token, Buffer.concat(chunks), u.id, { maxPixels: dm ? DEMO_SCAN.pixels : undefined }) }); }
    catch (e) { if (!e.status) console.error('spin', e); fail(e.status || 500, e.status ? e.message : 'That frame didn’t work. Try the spin again.'); }
  }
  if (p === '/api/scan/spin/keep' && m === 'POST') {
    const u = needEditor(c, req);
    const dm = demoMediaOf(db, u.company_id);
    const b = await readJson(req);
    const frames = await spinFrames(String(b.token || ''), u.id);
    if (!frames) fail(410, 'That spin has expired. Record it again.');
    if (dm && demoSaves(c.company) >= DEMO_SCAN.saves) fail(429, demoFull);
    const name = str(b.name, 80) || 'Bottle';
    const stem = `${Date.now().toString(36)}-spin-${slugify(name).slice(0, 40) || 'bottle'}`;
    const urls = frames.map((jpg, i) => '/media/' + saveScan(dm, `${stem}-${String(i).padStart(2, '0')}.jpg`, jpg));
    db.prepare('INSERT INTO media(kind,title,file,mime,size,created_by,created_at,company_id,store_id) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('file', `Bottle spin · ${name}`, urls[0].slice(7), 'image/jpeg', frames[0].length, u.id, now(), c.company, c.store);
    audit(db, u.id, 'spin scan bottle', name);
    return sendJson(res, 200, { frames: urls });
  }
  if (p === '/api/scan/keep' && m === 'POST') {
    const u = needEditor(c, req);
    const dm = demoMediaOf(db, u.company_id);
    const b = await readJson(req);
    const jpg = lastCut(String(b.token || ''), u.id);
    if (!jpg) fail(410, 'That photo has expired. Take it again.');
    if (dm && demoSaves(c.company) >= DEMO_SCAN.saves) fail(429, demoFull);
    const name = str(b.name, 80) || 'Bottle';
    const file = saveScan(dm, `${Date.now().toString(36)}-bottle-${slugify(name).slice(0, 40) || 'scan'}.jpg`, jpg);
    const r = db.prepare('INSERT INTO media(kind,title,file,mime,size,created_by,created_at,company_id,store_id) VALUES (?,?,?,?,?,?,?,?,?)').run('file', `Bottle · ${name}`, file, 'image/jpeg', jpg.length, u.id, now(), c.company, c.store);
    audit(db, u.id, 'scan bottle', name);
    return sendJson(res, 200, mediaOut(db.prepare('SELECT * FROM media WHERE id = ?').get(r.lastInsertRowid)));
  }

  /* media */
  if (p === '/api/media' && m === 'GET') {
    needUser(c, req);
    const archived = url.searchParams.get('archived') ? 'IS NOT NULL' : 'IS NULL';
    return sendJson(res, 200, { media: db.prepare(`SELECT * FROM media WHERE store_id = ? AND archived_at ${archived} ORDER BY id DESC`).all(c.store).map(mediaOut) });
  }
  if (p === '/api/media/youtube' && m === 'POST') {
    const u = needUser(c, req);
    const b = await readJson(req);
    const id = youtubeId(b.url);
    if (!id) fail(400, 'That doesn’t look like a YouTube link. Copy the link from the Share button.');
    const r = db.prepare('INSERT INTO media(kind,title,youtube_id,created_by,created_at,company_id,store_id) VALUES (?,?,?,?,?,?,?)').run('youtube', str(b.title, 200) || 'YouTube video', id, u.id, now(), c.company, c.store);
    audit(db, u.id, 'add youtube', id);
    return sendJson(res, 200, mediaOut(db.prepare('SELECT * FROM media WHERE id = ?').get(r.lastInsertRowid)));
  }
  if (p === '/api/media/upload' && m === 'POST') {
    const u = needUser(c, req);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm|x-m4v))$/.test(mime)) fail(415, 'Upload a photo (JPG, PNG, WebP) or a video (MP4, MOV, WebM).');
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD) fail(413, 'That file is over 600 MB. Trim it, or post it to YouTube and paste the link.');
    const original = decodeURIComponent(String(req.headers['x-filename'] || 'upload')).slice(0, 120);
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-m4v': '.m4v' }[mime];
    const file = `${Date.now().toString(36)}-${slugify(original.replace(/\.[a-z0-9]+$/i, '')).slice(0, 40)}${ext}`;
    const dest = path.join(MEDIA_DIR, file);
    await new Promise((resolve, reject) => {
      let size = 0;
      const out = fs.createWriteStream(dest);
      req.on('data', (chunk) => { size += chunk.length; if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); fs.rmSync(dest, { force: true }); reject(new HttpError(413, 'That file is over 600 MB.')); } });
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    });
    const size = fs.statSync(dest).size;
    const r = db.prepare('INSERT INTO media(kind,title,file,mime,size,created_by,created_at,company_id,store_id) VALUES (?,?,?,?,?,?,?,?,?)').run('file', original, file, mime, size, u.id, now(), c.company, c.store);
    audit(db, u.id, 'upload', file);
    return sendJson(res, 200, mediaOut(db.prepare('SELECT * FROM media WHERE id = ?').get(r.lastInsertRowid)));
  }
  if (parts[1] === 'media' && parts[2] && m === 'DELETE') {
    const u = needUser(c, req);
    const row = db.prepare('SELECT * FROM media WHERE id = ? AND store_id = ?').get(Number(parts[2]), c.store);
    if (!row) fail(404, 'We couldn’t find that file.');
    // Archived, not deleted: the file stays, so a page that used it still works and it can be restored.
    db.prepare('UPDATE media SET archived_at = ?, archived_by = ? WHERE id = ?').run(now(), u.id, row.id);
    audit(db, u.id, 'archive media', row.title || row.file || row.youtube_id, c.company);
    return sendJson(res, 200, { ok: true, archived: true });
  }
  if (parts[1] === 'media' && parts[2] && parts[3] === 'restore' && m === 'POST') {
    const u = needUser(c, req);
    const row = db.prepare('SELECT * FROM media WHERE id = ? AND store_id = ?').get(Number(parts[2]), c.store);
    if (!row) fail(404, 'We couldn’t find that file.');
    db.prepare('UPDATE media SET archived_at = NULL, archived_by = NULL WHERE id = ?').run(row.id);
    audit(db, u.id, 'restore media', row.title || row.file || row.youtube_id, c.company);
    return sendJson(res, 200, mediaOut(db.prepare('SELECT * FROM media WHERE id = ?').get(row.id)));
  }

  if (p === '/api/audit' && m === 'GET') {
    needOwner(c, req);
    return sendJson(res, 200, { audit: db.prepare("SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.id = a.user_id WHERE IFNULL(a.company_id, 1) = ? AND a.action NOT LIKE 'super:%' ORDER BY a.id DESC LIMIT 200").all(c.company) });
  }

  fail(404, 'Not found.');
}

/* ------------------------------ files ------------------------------ */
function sendFile(req, res, file, cache) {
  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    if (!range[1]) end = stat.size - 1;
    if (start >= stat.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': cache, ...SECURITY });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ...SECURITY });
  fs.createReadStream(file).pipe(res);
}

function staticFile(req, res, url) {
  const p = decodeURIComponent(url.pathname);
  // A demo's scanned photos (Nov 12): only that demo's own people see them.
  const dm = /^\/media\/demo\/([a-z0-9-]+)\/([^/]+)$/.exec(p);
  if (dm) {
    const user = sessionUser(db, cookies(req)[SESSION_COOKIE]);
    const f = path.join(MEDIA_DIR, 'demo', dm[1], path.basename(dm[2]));
    if (!demoMediaAllowed(db, user, dm[1]) || !fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
    return sendFile(req, res, f, 'private, max-age=86400');
  }
  if (p.startsWith('/media/')) {
    const f = path.join(MEDIA_DIR, path.basename(p));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
    return sendFile(req, res, f, 'public, max-age=31536000, immutable');
  }
  // The book's page files are served through the API, to signed-in people only.
  if (p.startsWith('/content/')) { res.writeHead(404); return res.end('Not found'); }
  let f = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    if (/^\/(content|img|assets)\//.test(p)) { res.writeHead(404); return res.end('Not found'); }
    f = path.join(DIST, 'index.html');
  }
  const cache = /^\/(assets|img)\//.test(p) ? 'public, max-age=31536000, immutable' : 'no-cache';
  sendFile(req, res, f, cache);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  res.acceptEncoding = req.headers['accept-encoding']; // sendJson compresses for it
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') staticFile(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) { console.error(e); logError(db, 'server', `${req.method} ${url.pathname}`, e); }
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong on our side. Try again.' : e.message });
    else res.end();
  }
}).listen(PORT, () => { console.log(`Mise on http://localhost:${PORT}`); if (process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.SCANNER_WARM === '1') warmOnStart(); });
