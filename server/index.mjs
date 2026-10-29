// The Baldwin Training Book server: the built app, the content API, sign-in and uploads. No dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, audit, now, MEDIA_DIR } from './db.mjs';
import { sessionUser, SESSION_COOKIE, LoginLimiter } from './auth.mjs';
import { accountRoutes, bootAccounts, companyOf, canEdit, storeOf } from './accounts.mjs';
import { assemble, fullIndex, ordered, glassTitles, basePage, baseIndex, sidebarCounts, withStore } from './content.mjs';
import { wineTargets, wineVideos, setWineVideo, seedWineVideos } from './wine.mjs';
import { COLLECTIONS, SHARED, publicSchemas, seed, listEntries, listArchived, getEntry, createEntry, updateEntry, archiveEntry, restoreEntry, moveEntry } from './cms.mjs';
import { slugify } from './templates.mjs';
import { startScan, cutScan, lastCut, warmScanner, warmOnStart } from './scanner.mjs';
import { score as scoreQuiz, results as quizResults, quizIds } from './quiz.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const MAX_UPLOAD = 600 * 1024 * 1024;
const db = openDb();
seed(db);
seedWineVideos(db);
bootAccounts(db);
const quizLimiter = new LoginLimiter(60, 60 * 60_000); // 60 quiz saves an hour per address

const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4' };

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

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY, ...headers });
  res.end(JSON.stringify(body));
}

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
const inStore = (c, fn) => withStore(c.storeRow, fn);

const clean = (s, max = 4000) => String(s ?? '').slice(0, max);
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));
const validPassword = (p) => String(p || '').length >= 10;

function youtubeId(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}
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
  const m = req.method;
  const p = url.pathname;
  const parts = p.split('/').filter(Boolean); // ['api', ...]

  if ((await accounts(req, res, url, c)) !== false) return;

  /* quizzes: everyone signed in. A person's records are keyed 'u<id>' (older phone-only records keep their device id). */
  if (p === '/api/quiz/attempt' && m === 'POST') {
    const u = needReader(c, req);
    if (!quizLimiter.check('u' + u.id)) fail(429, 'Too many saves. Try again in an hour.');
    const b = await readJson(req, 20_000);
    const r = scoreQuiz(String(b.quiz || ''), b.items, b.answers);
    if (!r) fail(400, 'That quiz didn’t match. Reload and try again.');
    quizLimiter.record('u' + u.id);
    db.prepare('INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at,company_id,user_id,store_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('u' + u.id, u.name, b.quiz, r.score, r.total, JSON.stringify({ items: b.items, answers: b.answers.map(Number) }), now(), c.company, u.id, c.store);
    return sendJson(res, 200, r);
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
  if (p === '/api/quiz/signoff' && (m === 'POST' || m === 'DELETE')) {
    const u = needUser(c, req);
    const b = await readJson(req);
    const dev = String(b.device || ''), quiz = String(b.quiz || '');
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(dev) || !quizIds.has(quiz)) fail(400, 'Missing person or quiz.');
    const who = db.prepare('SELECT name FROM quiz_attempts WHERE device = ? AND store_id = ? ORDER BY id DESC LIMIT 1').get(dev, c.store);
    if (!who) fail(404, 'We couldn’t find that person.');
    if (m === 'POST') db.prepare('INSERT OR REPLACE INTO signoffs(device,quiz,by_user,at,company_id,store_id) VALUES (?,?,?,?,?,?)').run(dev, quiz, u.id, now(), c.company, c.store);
    else db.prepare('DELETE FROM signoffs WHERE device = ? AND quiz = ? AND store_id = ?').run(dev, quiz, c.store);
    audit(db, u.id, m === 'POST' ? 'sign off' : 'undo sign off', `${who.name} · ${quiz}`, c.company);
    return sendJson(res, 200, { ok: true });
  }

  /* content */
  if (p === '/api/index' && m === 'GET') { needBook(c, req); return sendJson(res, 200, inStore(c, () => fullIndex(db))); }
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
    return sendJson(res, 200, { collections: schemas, counts });
  }
  if (p === '/api/entries' && m === 'GET') {
    needEditor(c, req);
    const col = url.searchParams.get('collection');
    if (!COLLECTIONS[col]) fail(400, 'Unknown collection.');
    if (url.searchParams.get('archived')) return sendJson(res, 200, { entries: listArchived(db, col, SHARED.has(col) ? null : c.store) });
    return sendJson(res, 200, { entries: inStore(c, () => ordered(db, col)) });
  }
  if (p === '/api/entries' && m === 'POST') {
    const b = await readJson(req);
    if (!COLLECTIONS[b.collection]) fail(400, 'Unknown collection.');
    const u = SHARED.has(b.collection) ? needLibrary(c, req) : needEditor(c, req);
    if (!str(b.data?.name, 120)) fail(400, 'Give it a name.');
    // Shared entries live under store 1; a store's own entries live under that store.
    const e = SHARED.has(b.collection) ? createEntry(db, b.collection, b.data, u.id) : createEntry(db, b.collection, b.data, u.id, c.store, c.company);
    audit(db, u.id, 'add ' + b.collection, e.data.name, c.company);
    return sendJson(res, 200, e);
  }
  if (parts[1] === 'entries' && parts[2]) {
    needEditor(c, req);
    const e = getEntry(db, Number(parts[2]));
    const shared = e && SHARED.has(e.collection);
    // Another store's entry doesn't exist here.
    if (!e || (!shared && e.storeId !== c.store)) fail(404, 'We couldn’t find that page.');
    if (m === 'GET') return sendJson(res, 200, e);
    const u = shared ? needLibrary(c, req) : needEditor(c, req);
    if (m === 'PUT') {
      const b = await readJson(req);
      if (!str(b.data?.name, 120)) fail(400, 'Give it a name.');
      const out = updateEntry(db, e.id, b.data, u.id);
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

  /* Bottle scanner (admin): photo → just the bottle, on the Wine Book beige → a media file. */
  if (p === '/api/scan/ready' && m === 'POST') {
    needEditor(c, req);
    warmScanner();
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/scan' && m === 'POST') {
    needEditor(c, req);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mime)) fail(415, 'Take a photo, or upload a JPG, PNG or WebP.');
    const chunks = []; let size = 0;
    for await (const ch of req) { size += ch.length; if (size > 25e6) fail(413, 'That photo is over 25 MB.'); chunks.push(ch); }
    try { return sendJson(res, 200, await startScan(Buffer.concat(chunks))); }
    catch (e) { console.error('scan', e); fail(e.status || 500, e.status ? e.message : 'The scanner couldn’t read that photo. Try another.'); }
  }
  if (p === '/api/scan/cut' && m === 'POST') {
    needEditor(c, req);
    const b = await readJson(req);
    if (!Array.isArray(b.box) || b.box.length !== 4) fail(400, 'Draw a box around the bottle.');
    try { const jpg = await cutScan(String(b.token || ''), b.box); return sendJson(res, 200, { preview: 'data:image/jpeg;base64,' + jpg.toString('base64') }); }
    catch (e) { if (!e.status) console.error('cut', e); fail(e.status || 500, e.status ? e.message : 'The scanner couldn’t cut that out. Try a new box.'); }
  }
  if (p === '/api/scan/keep' && m === 'POST') {
    const u = needEditor(c, req);
    const b = await readJson(req);
    const jpg = lastCut(String(b.token || ''));
    if (!jpg) fail(410, 'That photo has expired. Take it again.');
    const name = str(b.name, 80) || 'Bottle';
    const file = `${Date.now().toString(36)}-bottle-${slugify(name).slice(0, 40) || 'scan'}.jpg`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), jpg);
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
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') staticFile(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong on our side. Try again.' : e.message });
    else res.end();
  }
}).listen(PORT, () => { console.log(`The Baldwin Training Book on http://localhost:${PORT}`); if (process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.SCANNER_WARM === '1') warmOnStart(); });
