// Turn a files backup (.bk from the GitHub "Ops" workflow, or GET /api/ops/files) back into folders (Nov 16).
// Usage: BACKUP_KEY=... node scripts/restore-files.mjs mise-files-full-2026-11-22.bk out-folder
// Gives out-folder/media/… and out-folder/accounts/…, plus MANIFEST.json (every file that existed that night).
// To rebuild: restore the latest Sunday "full" backup, then each nightly "changes" one after it, in date order, into the
// same folder. Then copy media/ and accounts/ to /data on Railway (railway ssh, one piped tar).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createDecipheriv, createHash } from 'node:crypto';

const [inFile, outDir] = process.argv.slice(2);
const key = process.env.BACKUP_KEY;
if (!inFile || !outDir || !key) { console.error('Usage: BACKUP_KEY=... node scripts/restore-files.mjs <file.bk> <out-folder>'); process.exit(1); }
const fd = fs.openSync(inFile, 'r');
const total = fs.fstatSync(fd).size;
const read = (at, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, at); return b; };
if (read(0, 7).toString() !== 'MISEFL1') { console.error('Not a Mise files backup.'); process.exit(1); }
if (read(total - 8, 8).toString() !== 'MISEEND1') { console.error('This backup was cut off (no end mark).'); process.exit(1); }
const iv = read(7, 12);
const tag = read(total - 24, 16);
const d = createDecipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), iv);
d.setAuthTag(tag);
fs.mkdirSync(outDir, { recursive: true });
const tar = spawn('tar', ['-xf', '-', '-C', outDir], { stdio: ['pipe', 'inherit', 'inherit'] });
const body = fs.createReadStream(inFile, { start: 19, end: total - 25 });
body.on('data', (c) => { if (!tar.stdin.write(d.update(c))) body.pause(); });
tar.stdin.on('drain', () => body.resume());
body.on('end', () => {
  try { tar.stdin.end(d.final()); } catch { console.error('Wrong BACKUP_KEY, or the file was changed.'); tar.kill(); process.exit(1); }
});
tar.on('close', (code) => {
  if (code) { console.error(`tar stopped (${code}).`); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(`${outDir}/MANIFEST.json`, 'utf8'));
  console.log(`Restored into ${outDir}. Backup taken ${m.at}${m.since ? `, changes since ${m.since}` : ', everything'}; ${m.files.length} files existed then.`);
});
