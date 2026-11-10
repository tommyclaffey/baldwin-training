// Turn a nightly backup (.bk from the GitHub "ops" workflow, or GET /api/ops/backup) back into a database file.
// Usage: BACKUP_KEY=... node scripts/restore-backup.mjs mise-2026-11-10.bk out.db
// The key is the BACKUP_KEY Railway variable. To restore production: stop the service, copy out.db to /data/baldwin.db
// (keep the old one aside first), start the service.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createDecipheriv, createHash } from 'node:crypto';
const [inFile, outFile] = process.argv.slice(2);
const key = process.env.BACKUP_KEY;
if (!inFile || !outFile || !key) { console.error('Usage: BACKUP_KEY=... node scripts/restore-backup.mjs <file.bk> <out.db>'); process.exit(1); }
const buf = fs.readFileSync(inFile);
if (buf.subarray(0, 7).toString() !== 'MISEBK1') { console.error('Not a Mise backup file.'); process.exit(1); }
const iv = buf.subarray(7, 19), tag = buf.subarray(19, 35), body = buf.subarray(35);
const d = createDecipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), iv);
d.setAuthTag(tag);
const db = zlib.gunzipSync(Buffer.concat([d.update(body), d.final()]));
fs.writeFileSync(outFile, db);
console.log(`Wrote ${outFile} (${(db.length / 1e6).toFixed(1)} MB). Check it with: sqlite3 ${outFile} "PRAGMA integrity_check"`);
