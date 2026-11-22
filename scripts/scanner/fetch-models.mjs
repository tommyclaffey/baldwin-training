// Put the bottle scanner's models on a volume ahead of time (Nov 22, v2 adds IS-Net, ~179 MB). The server also fetches
// them itself on its first scan; this just saves that wait. Each file comes from its pinned URL and must match its sha256.
//   DATA_DIR=/data node scripts/scanner/fetch-models.mjs          → says what it would fetch (nothing written)
//   DATA_DIR=/data node scripts/scanner/fetch-models.mjs --go     → fetches what's missing
// On Railway: `railway ssh` into the web service, then the --go line. Not run on live yet (Tommy sees the board first).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
process.env.SCANNER_STUB = '';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { MODELS } = await import(path.join(root, 'server/scanner.mjs'));
const { DATA_DIR } = await import(path.join(root, 'server/db.mjs'));
const dir = path.join(DATA_DIR, 'models');
const go = process.argv.includes('--go');
fs.mkdirSync(dir, { recursive: true });
for (const m of Object.values(MODELS)) {
  const dest = path.join(dir, m.file);
  if (fs.existsSync(dest)) {
    const sum = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    console.log(`${m.file}: there, sha256 ${sum === m.sha256 ? 'matches' : 'DOES NOT MATCH (delete it and run again)'}`);
    continue;
  }
  if (!go) { console.log(`${m.file}: missing, would fetch ${m.url}`); continue; }
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.file}: download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sum = crypto.createHash('sha256').update(buf).digest('hex');
  if (sum !== m.sha256) throw new Error(`${m.file}: checksum ${sum} doesn't match ${m.sha256}`);
  fs.writeFileSync(dest + '.part', buf); fs.renameSync(dest + '.part', dest);
  console.log(`${m.file}: fetched, ${Math.round(buf.length / 1e6)} MB, sha256 matches`);
}
