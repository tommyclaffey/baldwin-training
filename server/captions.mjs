// Captions on uploaded videos (Nov 14). Wherever a manager uploads a video file (not YouTube), they can add a captions
// file: WebVTT (.vtt) as is, or SubRip (.srt), turned into WebVTT here. It's saved in media/ beside the video, under a new
// name each time (so the year-long cache never serves an old one), and the video's media row points at it (captions).
// The player asks for a video's captions by its file name and adds them as <track kind="captions">; with no `default`,
// each browser (and the viewer's own caption setting) decides whether they show.
// Scoping: captions are added to, replaced on or removed from a video in the store you're working in only, like archiving
// it. The file itself is served like every upload (/media/<unguessable name>), so anyone who can play the video gets them.
// The column is added by a column check, not a numbered migration, so it can't collide with another branch's migration.
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR, audit } from './db.mjs';

export const MAX_CAPTIONS = 1024 * 1024; // 1 MB is hours of captions

export function migrateCaptions(db) {
  const cols = db.prepare('PRAGMA table_info(media)').all().map((c) => c.name);
  if (!cols.includes('captions')) db.exec('ALTER TABLE media ADD COLUMN captions TEXT');
}

class CaptionsError extends Error { constructor(status, message) { super(message); this.status = status; } }
export { CaptionsError };
const fail = (status, message) => { throw new CaptionsError(status, message); };

const TIME = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
/**
 * The text of a captions file as WebVTT. `name` picks the format (.srt or .vtt); with no extension, a file that starts
 * with WEBVTT is VTT and anything else with cue times is read as SRT. Throws a plain-words error when it isn't captions.
 */
export function toVtt(text, name = '') {
  let s = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (s.includes('\0')) fail(415, 'That isn’t a captions file. Upload a .vtt or .srt file.');
  const ext = path.extname(String(name)).toLowerCase();
  const isVtt = /^WEBVTT(?=$|[ \t\n])/.test(s);
  if (ext === '.vtt' || (isVtt && ext !== '.srt')) {
    if (!isVtt) fail(400, 'A .vtt file starts with the word WEBVTT. Check the file, or upload the .srt version.');
    if (!/-->/.test(s)) fail(400, 'That captions file has no timed lines in it.');
    return s.endsWith('\n') ? s : s + '\n';
  }
  if (ext && ext !== '.srt') fail(415, 'Upload captions as a .vtt or .srt file.');
  // SubRip: numbered cues, "00:00:01,000 --> 00:00:04,000". WebVTT uses a full stop in the times; the numbers can stay
  // (they become cue names). Hours are optional in VTT but always there in SRT.
  const blocks = s.trim().split(/\n{2,}/).map((b) => b.split('\n'));
  const out = ['WEBVTT', ''];
  let cues = 0;
  for (const lines of blocks) {
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 || at > 1) continue;
    const [a, b] = lines[at].split('-->').map((x) => x.trim());
    const ta = TIME.exec(a)?.[0], tb = TIME.exec(b)?.[0];
    if (!ta || !tb) continue;
    const fix = (t) => { const [hms, ms] = t.split(/[.,]/); const parts = hms.split(':'); while (parts.length < 3) parts.unshift('00'); return `${parts.map((p) => p.padStart(2, '0')).join(':')}.${ms.padEnd(3, '0')}`; };
    const body = lines.slice(at + 1).filter((l) => l.trim() !== '');
    if (!body.length) continue;
    if (at === 1 && lines[0].trim()) out.push(lines[0].trim());
    out.push(`${fix(ta)} --> ${fix(tb)}`, ...body, '');
    cues++;
  }
  if (!cues) fail(400, 'We couldn’t find any timed lines in that file. Upload a .vtt or .srt captions file.');
  return out.join('\n');
}

const mediaRow = (db, id, store) => db.prepare('SELECT * FROM media WHERE id = ? AND store_id = ?').get(Number(id), store);
const isVideo = (m) => m && m.kind === 'file' && /^video\//.test(m.mime || '');
const urlOf = (file) => (file ? '/media/' + file : null);

/** Add or replace a video's captions. x = { company, store }; returns the captions url. */
export function saveCaptions(db, x, u, id, text, name) {
  const m = mediaRow(db, id, x.store);
  if (!m) fail(404, 'We couldn’t find that video.');
  if (!isVideo(m)) fail(400, 'Captions go on an uploaded video. For a YouTube video, add them on YouTube.');
  const vtt = toVtt(text, name);
  const stem = path.basename(m.file).replace(/\.[a-z0-9]+$/i, '');
  const file = `${stem}-${Date.now().toString(36)}.vtt`;
  fs.writeFileSync(path.join(MEDIA_DIR, file), vtt);
  db.prepare('UPDATE media SET captions = ? WHERE id = ?').run(file, m.id);
  audit(db, u.id, m.captions ? 'replace captions' : 'add captions', m.title || m.file, x.company);
  return urlOf(file);
}

/** Take a video's captions off. The old file stays on the volume (nothing is deleted), it just isn't linked. */
export function removeCaptions(db, x, u, id) {
  const m = mediaRow(db, id, x.store);
  if (!m) fail(404, 'We couldn’t find that video.');
  if (m.captions) {
    db.prepare('UPDATE media SET captions = NULL WHERE id = ?').run(m.id);
    audit(db, u.id, 'remove captions', m.title || m.file, x.company);
  }
  return null;
}

/** The captions for a video, by its url ("/media/abc.mp4"): this company's upload first, then any (the shared library's
 *  videos are uploaded once and shown in every company). */
export function captionsFor(db, company, videoUrl) {
  const file = path.basename(String(videoUrl || '').split(/[?#]/)[0]);
  if (!file || !/^\/media\/[^/]+$/.test(String(videoUrl).split(/[?#]/)[0])) return null;
  const row = db.prepare(`SELECT captions FROM media WHERE file = ? AND captions IS NOT NULL ORDER BY company_id = ? DESC, id DESC LIMIT 1`).get(file, company ?? -1);
  return urlOf(row?.captions);
}
