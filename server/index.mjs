// The Baldwin Training Book server: the built app, the content API, sign-in and uploads. No dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, audit, now, MEDIA_DIR } from './db.mjs';
import { hashPassword, verifyPassword, burnPasswordCheck, createSession, sessionUser, endSession, sessionCookie, SESSION_COOKIE, LoginLimiter, publicUser, sha256, newToken } from './auth.mjs';
import { assemble, fullIndex, listItems, itemEntry } from './content.mjs';
import { slugify } from './templates.mjs';
import { score as scoreQuiz, results as quizResults, quizIds } from './quiz.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const MAX_UPLOAD = 600 * 1024 * 1024;
const db = openDb();
const limiter = new LoginLimiter();
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
  return { token, user };
};
function needUser(c, req) {
  if (!c.user) fail(401, 'Sign in to make changes.');
  if (req.method !== 'GET' && req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
  return c.user;
}
const needOwner = (c, req) => { const u = needUser(c, req); if (u.role !== 'owner') fail(403, 'Only the owner can do that.'); return u; };

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

function cleanItem(type, d = {}) {
  const base = { name: str(d.name, 120), tagline: str(d.tagline, 120), description: str(d.description, 800), photo: imageUrl(d.photo), say: str(d.say, 800), video: media(d.video) };
  if (!base.name) fail(400, 'Give it a name.');
  if (type === 'cocktail') {
    return {
      ...base,
      glass: str(d.glass, 60), method: str(d.method, 60), ice: str(d.ice, 60), garnish: str(d.garnish, 80),
      build: (Array.isArray(d.build) ? d.build : []).slice(0, 12).map((b) => ({ amount: str(b?.amount, 30), ingredient: str(b?.ingredient, 80), spirit: !!b?.spirit, link: link(b?.link) })).filter((b) => b.amount || b.ingredient),
      spiritName: str(d.spiritName, 80), spiritLine: str(d.spiritLine, 300), spiritLink: link(d.spiritLink), spiritLinkLabel: str(d.spiritLinkLabel, 60),
      steps: strList(d.steps, 12), tags: strList(d.tags, 8), tasteLine: str(d.tasteLine, 300),
      score: str(d.score, 10), status: str(d.status, 30), pairs: str(d.pairs, 80), note: str(d.note, 600), story: str(d.story, 1500),
    };
  }
  return {
    ...base,
    course: ['Passed Bites', 'Plates', 'Dessert'].includes(d.course) ? d.course : 'Plates',
    station: str(d.station, 40), signature: !!d.signature, score: str(d.score, 10),
    allergens: strList(d.allergens, 12),
    components: (Array.isArray(d.components) ? d.components : []).slice(0, 12).map((r) => ({ component: str(r?.component, 80), portion: str(r?.portion, 80), hold: str(r?.hold, 80) })).filter((r) => r.component || r.portion || r.hold),
    steps: (Array.isArray(d.steps) ? d.steps : []).slice(0, 12).map((s) => ({ title: str(s?.title, 80), detail: str(s?.detail, 500), time: str(s?.time, 30) })).filter((s) => s.title || s.detail),
    plating: (Array.isArray(d.plating) ? d.plating : []).slice(0, 4).map((p) => ({ name: str(p?.name, 60), note: str(p?.note, 120) })).filter((p) => p.name),
    platePhoto: imageUrl(d.platePhoto),
    pairing: str(d.pairing, 80), pairingNote: str(d.pairingNote, 200),
    videoTitle: str(d.videoTitle, 120), videoNote: str(d.videoNote, 500),
    photos: (Array.isArray(d.photos) ? d.photos : []).slice(0, 8).map((p) => ({ img: imageUrl(p?.img), caption: str(p?.caption, 80) })).filter((p) => p.img),
  };
}
function uniqueSlug(type, name, id) {
  const base = (type === 'cocktail' ? 'signature/' : 'recipe/') + slugify(name);
  let slug = base, n = 2;
  const taken = new Set(fullIndex(db).filter((e) => e.id !== 'i' + id).map((e) => e.slug));
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}

/* ------------------------------ routes ------------------------------ */
async function api(req, res, url) {
  const c = ctx(req);
  const m = req.method;
  const p = url.pathname;
  const parts = p.split('/').filter(Boolean); // ['api', ...]

  if (p === '/api/me' && m === 'GET') {
    const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
    return sendJson(res, 200, { user: publicUser(c.user), setupNeeded: users === 0 });
  }

  if (p === '/api/setup' && m === 'POST') {
    const b = await readJson(req);
    if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) fail(409, 'The owner account already exists. Sign in instead.');
    if (!OWNER_EMAIL) fail(503, 'Setup is off: OWNER_EMAIL isn’t set on the server.');
    if (String(b.email || '').trim().toLowerCase() !== OWNER_EMAIL) fail(403, 'That email can’t set up this app. Use the owner’s email.');
    if (!str(b.name, 80)) fail(400, 'Add your name.');
    if (!validPassword(b.password)) fail(400, 'Use at least 10 characters for the password.');
    const r = db.prepare('INSERT INTO users(email,name,role,password_hash,created_at) VALUES (?,?,?,?,?)').run(OWNER_EMAIL, str(b.name, 80), 'owner', await hashPassword(b.password), now());
    audit(db, Number(r.lastInsertRowid), 'setup', OWNER_EMAIL);
    const token = createSession(db, Number(r.lastInsertRowid));
    return sendJson(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) }, { 'Set-Cookie': sessionCookie(token, { secure: isSecure(req) }) });
  }

  if (p === '/api/login' && m === 'POST') {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const key = email + '|' + (req.headers['x-forwarded-for'] || req.socket.remoteAddress);
    if (!limiter.check(key)) fail(429, 'Too many tries. Wait 15 minutes, then try again.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = user ? await verifyPassword(b.password, user.password_hash) : (await burnPasswordCheck(b.password), false);
    if (!ok) { limiter.record(key); fail(401, 'That email and password don’t match.'); }
    limiter.reset(key);
    const token = createSession(db, user.id);
    audit(db, user.id, 'login');
    return sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, { secure: isSecure(req) }) });
  }

  if (p === '/api/logout' && m === 'POST') {
    endSession(db, c.token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', { clear: true, secure: isSecure(req) }) });
  }

  if (p === '/api/password' && m === 'POST') {
    const u = needUser(c, req);
    const b = await readJson(req);
    if (!(await verifyPassword(b.current, u.password_hash))) fail(400, 'Your current password isn’t right.');
    if (!validPassword(b.next)) fail(400, 'Use at least 10 characters for the new password.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(b.next), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, sha256(c.token));
    audit(db, u.id, 'password');
    return sendJson(res, 200, { ok: true });
  }

  /* people */
  if (p === '/api/users' && m === 'GET') {
    needOwner(c, req);
    return sendJson(res, 200, { users: db.prepare('SELECT id,name,email,role,created_at,last_seen_at FROM users ORDER BY id').all() });
  }
  if (parts[1] === 'users' && parts[2] && m === 'DELETE') {
    const u = needOwner(c, req);
    const id = Number(parts[2]);
    if (id === u.id) fail(400, 'You can’t remove your own account.');
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit(db, u.id, 'remove user', id);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/invites' && m === 'GET') {
    needOwner(c, req);
    return sendJson(res, 200, { invites: db.prepare('SELECT substr(token_hash,1,16) id,email,role,created_at,expires_at FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC').all(now()) });
  }
  if (p === '/api/invites' && m === 'POST') {
    const u = needOwner(c, req);
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!validEmail(email)) fail(400, 'Enter a valid email address.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'That person already has an account.');
    const role = b.role === 'owner' ? 'owner' : 'editor';
    const token = newToken();
    db.prepare('INSERT INTO invites(token_hash,email,role,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?)').run(sha256(token), email, role, u.id, now(), new Date(Date.now() + 14 * 864e5).toISOString());
    audit(db, u.id, 'invite', email);
    return sendJson(res, 200, { link: `/admin/invite/${token}`, email, role });
  }
  if (parts[1] === 'invites' && parts[2] && m === 'DELETE') {
    const u = needOwner(c, req);
    db.prepare('DELETE FROM invites WHERE substr(token_hash,1,16) = ? AND used_at IS NULL').run(parts[2]);
    audit(db, u.id, 'cancel invite', parts[2]);
    return sendJson(res, 200, { ok: true });
  }
  if (parts[1] === 'invite' && parts[2]) {
    const inv = db.prepare('SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(sha256(parts[2]), now());
    if (m === 'GET') return sendJson(res, 200, inv ? { valid: true, email: inv.email, role: inv.role } : { valid: false });
    if (m === 'POST') {
      if (!inv) fail(410, 'This invite has expired or was already used. Ask for a new one.');
      const b = await readJson(req);
      if (!str(b.name, 80)) fail(400, 'Add your name.');
      if (!validPassword(b.password)) fail(400, 'Use at least 10 characters for the password.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(inv.email)) fail(409, 'That person already has an account.');
      const r = db.prepare('INSERT INTO users(email,name,role,password_hash,created_at) VALUES (?,?,?,?,?)').run(inv.email, str(b.name, 80), inv.role, await hashPassword(b.password), now());
      db.prepare('UPDATE invites SET used_at = ? WHERE token_hash = ?').run(now(), inv.token_hash);
      audit(db, Number(r.lastInsertRowid), 'joined', inv.email);
      const token = createSession(db, Number(r.lastInsertRowid));
      return sendJson(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) }, { 'Set-Cookie': sessionCookie(token, { secure: isSecure(req) }) });
    }
  }

  /* quizzes: public, so staff can save scores without an account */
  const device = (v) => (/^[A-Za-z0-9_-]{16,64}$/.test(String(v || '')) ? String(v) : null);
  if (p === '/api/quiz/attempt' && m === 'POST') {
    if (req.headers['x-bt'] !== '1') fail(403, 'Request blocked.');
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0];
    if (!quizLimiter.check(ip)) fail(429, 'Too many saves. Try again in an hour.');
    const b = await readJson(req, 20_000);
    const dev = device(b.device), name = str(b.name, 60);
    if (!dev) fail(400, 'Missing device.');
    if (!name) fail(400, 'Add your name so a manager can sign you off.');
    const r = scoreQuiz(String(b.quiz || ''), b.items, b.answers);
    if (!r) fail(400, 'That quiz didn’t match. Reload and try again.');
    quizLimiter.record(ip);
    db.prepare('INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at) VALUES (?,?,?,?,?,?,?)')
      .run(dev, name, b.quiz, r.score, r.total, JSON.stringify({ items: b.items, answers: b.answers.map(Number) }), now());
    return sendJson(res, 200, r);
  }
  if (parts[1] === 'quiz' && parts[2] === 'progress' && parts[3] && m === 'GET') {
    const dev = device(parts[3]);
    if (!dev) fail(400, 'Missing device.');
    const signoffs = db.prepare('SELECT quiz, at FROM signoffs WHERE device = ?').all(dev);
    return sendJson(res, 200, { signoffs });
  }
  if (p === '/api/quiz/results' && m === 'GET') {
    needUser(c, req);
    return sendJson(res, 200, { people: quizResults(db) });
  }
  if (p === '/api/quiz/signoff' && (m === 'POST' || m === 'DELETE')) {
    const u = needUser(c, req);
    const b = await readJson(req);
    const dev = device(b.device), quiz = String(b.quiz || '');
    if (!dev || !quizIds.has(quiz)) fail(400, 'Missing person or quiz.');
    const who = db.prepare('SELECT name FROM quiz_attempts WHERE device = ? ORDER BY id DESC LIMIT 1').get(dev);
    if (!who) fail(404, 'We couldn’t find that person.');
    if (m === 'POST') db.prepare('INSERT OR REPLACE INTO signoffs(device,quiz,by_user,at) VALUES (?,?,?,?)').run(dev, quiz, u.id, now());
    else db.prepare('DELETE FROM signoffs WHERE device = ? AND quiz = ?').run(dev, quiz);
    audit(db, u.id, m === 'POST' ? 'sign off' : 'undo sign off', `${who.name} · ${quiz}`);
    return sendJson(res, 200, { ok: true });
  }

  /* content */
  if (p === '/api/index' && m === 'GET') return sendJson(res, 200, fullIndex(db));
  if (parts[1] === 'page' && parts[2] && m === 'GET') {
    const page = assemble(db, parts[2]);
    if (!page) fail(404, 'We couldn’t find that page.');
    return sendJson(res, 200, page);
  }
  if (p === '/api/override' && (m === 'PUT' || m === 'DELETE')) {
    const u = needUser(c, req);
    const b = await readJson(req);
    const pageId = str(b.pageId, 20), nodeP = clean(b.path, 1000);
    if (!pageId || !nodeP) fail(400, 'Missing page or element.');
    if (m === 'DELETE') {
      db.prepare('DELETE FROM overrides WHERE page_id = ? AND path = ?').run(pageId, nodeP);
      audit(db, u.id, 'revert', `${pageId} ${nodeP}`);
      return sendJson(res, 200, { ok: true });
    }
    const v = b.value || {};
    let value;
    if (typeof v.s === 'string') value = { s: clean(v.s, 4000) };
    else if (v.img !== undefined) { const i = imageUrl(v.img); if (!i) fail(400, 'That photo isn’t one we uploaded.'); value = { img: i }; }
    else if (v.video !== undefined) value = { video: v.video === null ? null : media(v.video) };
    else fail(400, 'Nothing to save.');
    if (value.video === null && v.video !== null) fail(400, 'That video link isn’t valid. Paste a YouTube link or upload a file.');
    db.prepare('INSERT INTO overrides(page_id,path,value,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(page_id,path) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at')
      .run(pageId, nodeP, JSON.stringify(value), u.id, now());
    audit(db, u.id, 'edit', `${pageId} ${nodeP}`);
    return sendJson(res, 200, { ok: true });
  }

  /* recipes + cocktails */
  if (p === '/api/items' && m === 'GET') return sendJson(res, 200, { items: listItems(db, url.searchParams.get('type') || undefined) });
  if (parts[1] === 'items' && parts[2] && m === 'GET') {
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(parts[2]));
    if (!row) fail(404, 'We couldn’t find that item.');
    return sendJson(res, 200, itemEntry(row));
  }
  if (p === '/api/items' && m === 'POST') {
    const u = needUser(c, req);
    const b = await readJson(req);
    const type = b.type === 'cocktail' ? 'cocktail' : 'dish';
    const data = cleanItem(type, b.data);
    const slug = uniqueSlug(type, data.name);
    const r = db.prepare('INSERT INTO items(type,slug,data,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)').run(type, slug, JSON.stringify(data), u.id, now(), u.id, now());
    audit(db, u.id, 'add ' + type, data.name);
    return sendJson(res, 200, itemEntry(db.prepare('SELECT * FROM items WHERE id = ?').get(r.lastInsertRowid)));
  }
  if (parts[1] === 'items' && parts[2] && m === 'PUT') {
    const u = needUser(c, req);
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(parts[2]));
    if (!row) fail(404, 'We couldn’t find that item.');
    const b = await readJson(req);
    const data = cleanItem(row.type, b.data);
    const slug = JSON.parse(row.data).name === data.name ? row.slug : uniqueSlug(row.type, data.name, row.id);
    db.prepare('UPDATE items SET data = ?, slug = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), slug, u.id, now(), row.id);
    audit(db, u.id, 'edit ' + row.type, data.name);
    return sendJson(res, 200, itemEntry(db.prepare('SELECT * FROM items WHERE id = ?').get(row.id)));
  }
  if (parts[1] === 'items' && parts[2] && m === 'DELETE') {
    const u = needUser(c, req);
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(parts[2]));
    if (!row) fail(404, 'We couldn’t find that item.');
    db.prepare('DELETE FROM items WHERE id = ?').run(row.id);
    db.prepare('DELETE FROM overrides WHERE page_id = ?').run('i' + row.id);
    audit(db, u.id, 'delete ' + row.type, JSON.parse(row.data).name);
    return sendJson(res, 200, { ok: true });
  }

  /* media */
  if (p === '/api/media' && m === 'GET') {
    needUser(c, req);
    return sendJson(res, 200, { media: db.prepare('SELECT * FROM media ORDER BY id DESC').all().map(mediaOut) });
  }
  if (p === '/api/media/youtube' && m === 'POST') {
    const u = needUser(c, req);
    const b = await readJson(req);
    const id = youtubeId(b.url);
    if (!id) fail(400, 'That doesn’t look like a YouTube link. Copy the link from the Share button.');
    const r = db.prepare('INSERT INTO media(kind,title,youtube_id,created_by,created_at) VALUES (?,?,?,?,?)').run('youtube', str(b.title, 200) || 'YouTube video', id, u.id, now());
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
    const r = db.prepare('INSERT INTO media(kind,title,file,mime,size,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run('file', original, file, mime, size, u.id, now());
    audit(db, u.id, 'upload', file);
    return sendJson(res, 200, mediaOut(db.prepare('SELECT * FROM media WHERE id = ?').get(r.lastInsertRowid)));
  }
  if (parts[1] === 'media' && parts[2] && m === 'DELETE') {
    const u = needUser(c, req);
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(parts[2]));
    if (!row) fail(404, 'We couldn’t find that file.');
    if (row.file) fs.rmSync(path.join(MEDIA_DIR, row.file), { force: true });
    db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
    audit(db, u.id, 'delete media', row.file || row.youtube_id);
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/audit' && m === 'GET') {
    needOwner(c, req);
    return sendJson(res, 200, { audit: db.prepare('SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200').all() });
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
}).listen(PORT, () => console.log(`The Baldwin Training Book on http://localhost:${PORT}`));
