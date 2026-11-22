// Uploads behind the scenes (Nov 16; audit Nov 15, items 30 and 31).
//   • Off-site copy of the files: GET /api/ops/files (OPS_TOKEN) streams every uploaded file (media/, demos left out) and
//     every account folder (accounts/) as one tar, encrypted with BACKUP_KEY. ?since=<ISO> sends only files changed since
//     then, plus MANIFEST.json listing every file that exists now. The nightly GitHub Action pulls the changes every
//     night and everything on Sundays (.github/workflows/ops.yml). scripts/restore-files.mjs turns one back into folders.
//     Layout: "MISEFL1" · iv(12) · ciphertext · tag(16) · "MISEEND1" (a cut-off download is missing the end mark).
//   • Storage cap: each company gets STORAGE_CAP_MB (default 2048) for its uploads, and no upload may leave the volume
//     with less than VOLUME_FLOOR_MB free. Checked before a file is written and again while it streams in.
//   • Old database copies: the "before-…" copies taken before a change, and the old baldwin-backup-*.db ones, go after
//     KEEP_DAYS like the daily ones (they held deleted companies' data forever; the privacy draft promises 14 days).
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { DATA_DIR, MEDIA_DIR } from './db.mjs';
import { ACCOUNTS_DIR } from './account.mjs';

const MB = 1024 * 1024;
export const storageCapBytes = () => (Number(process.env.STORAGE_CAP_MB) > 0 ? Number(process.env.STORAGE_CAP_MB) : 2048) * MB;
export const volumeFloorBytes = () => (Number(process.env.VOLUME_FLOOR_MB) > 0 ? Number(process.env.VOLUME_FLOOR_MB) : 500) * MB;

/* ------------------------------------------------ storage cap ------------------------------------------------ */

/** Bytes a company's uploads take on the volume. files = the company's own files (companydata.ownedFiles). */
export function bytesOf(files) {
  let n = 0;
  for (const f of files) { try { n += fs.statSync(path.join(MEDIA_DIR, f)).size; } catch { /* gone */ } }
  return n;
}
export function volumeFree() {
  try { const s = fs.statfsSync(DATA_DIR); return s.bavail * s.bsize; } catch { return Infinity; }
}
/** How much more this company may upload right now (the smaller of its cap and the volume's spare room). */
export function roomLeft(used) {
  return Math.max(0, Math.min(storageCapBytes() - used, volumeFree() - volumeFloorBytes()));
}
const size = (b) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);
/** The message when an upload won't fit. */
export function fullMessage(used) {
  if (storageCapBytes() - used <= volumeFree() - volumeFloorBytes()) {
    return `Your uploads have used ${size(used)} of ${size(storageCapBytes())}. Archive old videos, or post long ones to YouTube and paste the link.`;
  }
  return 'There isn’t room for that file right now. Post it to YouTube and paste the link, or contact Mise support.';
}

/* ------------------------------------------------ old database copies ------------------------------------------------ */

/** Database copies taken before a change ("before-…" in backups/, the old baldwin-backup-*.db beside the database) and
 *  left-over upload folders in backups/: removed once older than `days`. Daily snapshots are handled in ops.mjs. */
export function pruneOldCopies(days, { at = Date.now(), dataDir = DATA_DIR } = {}) {
  const cutoff = at - days * 864e5;
  const removed = [];
  const old = (p) => { try { return fs.statSync(p).mtimeMs < cutoff; } catch { return false; } };
  const backups = path.join(dataDir, 'backups');
  const spots = [
    [backups, (f) => /^before-.+\.db$/.test(f) || /^partial-/.test(f)],
    [dataDir, (f) => /^baldwin-backup-.+\.db$/.test(f)],
  ];
  for (const [dir, match] of spots) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const f of names) {
      const p = path.join(dir, f);
      if (match(f) && old(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.push(f); }
    }
  }
  return removed;
}

/* ------------------------------------------------ off-site copy of the files ------------------------------------------------ */

/** Every file to copy: [{ name: 'media/x.jpg' | 'accounts/1/…', full, size, mtimeMs }]. A demo's files are left out
 *  (they're gone within a day anyway). */
export function listFiles() {
  const out = [];
  const walk = (root, prefix, skip) => {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix + e.name;
      const full = path.join(root, e.name);
      if (skip(rel)) continue;
      if (e.isDirectory()) walk(full, rel + '/', skip);
      else if (e.isFile()) { const s = fs.statSync(full); out.push({ name: rel, full, size: s.size, mtimeMs: s.mtimeMs }); }
    }
  };
  walk(MEDIA_DIR, 'media/', (rel) => rel === 'media/demo' || rel.startsWith('media/demo/'));
  walk(ACCOUNTS_DIR, 'accounts/', () => false);
  walk(path.join(DATA_DIR, 'looks'), 'looks/', () => false); // Nov 22: Your Look's logos, photos, icons and link cards
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A ustar header block. A name over 100 bytes gets a pax header in front carrying the full name (every tar reads it). */
function tarHeader(name, size, mtimeMs) {
  if (Buffer.byteLength(name) <= 100) return headerBlock(name, size, mtimeMs, '0');
  const body = ` path=${name}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len++;
  const rec = Buffer.from(len + body);
  const pad = rec.length % 512 ? Buffer.alloc(512 - (rec.length % 512)) : Buffer.alloc(0);
  const short = ('PaxHeader/' + name.split('/').pop()).slice(0, 100);
  return Buffer.concat([headerBlock(short, rec.length, mtimeMs, 'x'), rec, pad, headerBlock(name.slice(0, 100), size, mtimeMs, '0')]);
}
function headerBlock(base, size, mtimeMs, type) {
  const h = Buffer.alloc(512);
  const put = (s, at, len) => h.write(s, at, len, 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(base, 0, 100);
  put('0000644\0', 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(Math.floor(mtimeMs / 1000), 12), 136, 12);
  put('        ', 148, 8);
  h[156] = type.charCodeAt(0); // '0' a regular file, 'x' a pax header
  put('ustar\0', 257, 6); put('00', 263, 2);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

/** Tar pieces for these files (each read as a stream), then the two empty end blocks. Yields Buffers. */
export async function* tarChunks(entries) {
  for (const e of entries) {
    if (e.data) {
      yield tarHeader(e.name, e.data.length, e.mtimeMs ?? Date.now());
      yield e.data;
      if (e.data.length % 512) yield Buffer.alloc(512 - (e.data.length % 512));
      continue;
    }
    let st;
    try { st = fs.statSync(e.full); } catch { continue; } // removed since it was listed
    yield tarHeader(e.name, st.size, st.mtimeMs);
    let sent = 0;
    for await (const chunk of fs.createReadStream(e.full, { end: Math.max(0, st.size - 1) })) {
      const c = sent + chunk.length > st.size ? chunk.subarray(0, st.size - sent) : chunk;
      sent += c.length; if (c.length) yield c;
      if (sent >= st.size) break;
    }
    if (sent < st.size) yield Buffer.alloc(st.size - sent); // shrank while reading: keep the tar whole
    if (st.size % 512) yield Buffer.alloc(512 - (st.size % 512));
  }
  yield Buffer.alloc(1024);
}

export const FILES_MAGIC = 'MISEFL1';
export const FILES_END = 'MISEEND1';

/** Write the encrypted tar to `out` (a response or a file stream), minding backpressure. since: ms or null (= all). */
export async function writeFilesBackup(out, { since = null, key = process.env.BACKUP_KEY } = {}) {
  if (!key || key.length < 24) throw Object.assign(new Error('BACKUP_KEY is not set'), { status: 503 });
  const all = listFiles();
  const picked = since == null ? all : all.filter((f) => f.mtimeMs > since);
  const manifest = Buffer.from(JSON.stringify({
    at: new Date().toISOString(), since: since == null ? null : new Date(since).toISOString(),
    files: all.map((f) => ({ name: f.name, size: f.size, modified: new Date(f.mtimeMs).toISOString() })),
  }, null, 1));
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), iv);
  const write = async (buf) => { if (buf.length && !out.write(buf)) await once(out, 'drain'); };
  await write(Buffer.concat([Buffer.from(FILES_MAGIC), iv]));
  let bytes = 0;
  for await (const chunk of tarChunks([{ name: 'MANIFEST.json', data: manifest }, ...picked])) {
    bytes += chunk.length;
    await write(c.update(chunk));
  }
  await write(c.final());
  await write(Buffer.concat([c.getAuthTag(), Buffer.from(FILES_END)]));
  return { files: picked.length, of: all.length, bytes };
}

/* ------------------------------------------------ who may open a file ------------------------------------------------ */
// Nov 19 (audit Nov 15, item 37; launch Gate A): any signed-in person could open another company's upload by its address,
// and a public demo visitor counts as signed in. Now a file in /media/ opens for:
//   • a super admin (support), or the company that uploaded it (media rows, their captions and spin frames, chat photos)
//   • anyone signed in, when the file is in the shared library (a shared collection's entry names it, e.g. a classic's video)
//   • anyone signed in, when no company owns it (menu-import scans and older files), as before
// sharedCollections: cms.mjs's SHARED (passed in, so this file doesn't import the CMS).
export function mediaVisible(db, u, company, file, sharedCollections = []) {
  if (!u) return false;
  if (u.role === 'superadmin') return true;
  const names = [file];
  const spin = /^(.*-spin-.*-)\d\d\.jpg$/.exec(file); // a spin's frames belong to the row that holds its first frame
  if (spin) names.push(`${spin[1]}00.jpg`);
  const owners = new Set();
  for (const n of names) {
    for (const r of db.prepare("SELECT company_id FROM media WHERE file = ?1 OR file LIKE '%/' || ?1 OR captions = ?1 OR captions LIKE '%/' || ?1").all(n)) owners.add(r.company_id);
    for (const r of db.prepare('SELECT company_id FROM chat_messages WHERE photo = ?').all('/media/' + n)) owners.add(r.company_id);
  }
  if (!owners.size || owners.has(company)) return true;
  const shared = [...sharedCollections];
  if (!shared.length) return false;
  return !!db.prepare(`SELECT 1 FROM entries WHERE collection IN (${shared.map(() => '?').join(',')}) AND instr(data, ?) > 0 LIMIT 1`)
    .get(...shared, '/media/' + file);
}
