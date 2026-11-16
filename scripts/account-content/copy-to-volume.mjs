// Puts an account's content folder on the volume (Nov 16): DATA_DIR/accounts/<company>/ (server/account.mjs).
// Run by hand, BEFORE deploying the code that reads it. Nothing in the database changes; the running server keeps serving
// until the deploy restarts it (it reads the folder at startup).
//
//   node scripts/account-content/copy-to-volume.mjs <account folder> --company 1            # Railway (railway ssh, service web)
//   node scripts/account-content/copy-to-volume.mjs <account folder> --company 1 --local /tmp/data   # a local DATA_DIR, to try it
//   options: --dry-run (list what would go, change nothing) · --no-backup (skip the database snapshot) · --chunk <n>
//            (characters per piece sent, default 60000)
//
// What it does:
//   1. a consistent snapshot of the database: /data/baldwin-backup-<date>-before-account-content.db (VACUUM INTO, read-only
//      for the live file);
//   2. sends every file (base64, in small pieces), checks each one's sha256 on the other side;
//   3. writes them to accounts/<company>.new, then swaps it in: an existing accounts/<company> is kept as
//      accounts/<company>.bak-<time> (never deleted);
//   4. lists what's on the volume with sha256s and compares them with the folder here.
// For Baldwin Restaurant Group: <account folder> = ~/Coding/mise-private/baldwin/account, --company 1.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const src = args[0] && !args[0].startsWith('--') ? path.resolve(args[0].replace(/^~(?=\/)/, process.env.HOME)) : null;
const company = opt('--company');
const local = opt('--local');
const dry = args.includes('--dry-run');
const backup = !args.includes('--no-backup');
const CHUNK = Number(opt('--chunk')) || 60000; // characters per piece sent; lower it if railway ssh refuses long commands
if (!src || !fs.existsSync(path.join(src, 'account.json')) || !/^[1-9][0-9]*$/.test(String(company || ''))) {
  console.error('Usage: copy-to-volume.mjs <account folder with account.json> --company <id> [--local <DATA_DIR>] [--dry-run] [--no-backup]');
  process.exit(1);
}
const DATA = local ? path.resolve(local) : '/data';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const walk = (d, rel = '') => fs.readdirSync(path.join(d, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(d, path.join(rel, e.name)) : e.isFile() && e.name !== '.DS_Store' ? [path.join(rel, e.name)] : []));
const files = walk(src).sort().map((rel) => { const b = fs.readFileSync(path.join(src, rel)); return { rel, b64: b.toString('base64'), sha256: sha(b), bytes: b.length }; });
console.log(`${files.length} files, ${(files.reduce((a, f) => a + f.bytes, 0) / 1e6).toFixed(1)} MB → ${DATA}/accounts/${company}${local ? ' (local)' : ' (Railway, service web)'}`);
if (dry) { for (const f of files) console.log(`  ${f.rel}  ${f.bytes}  ${f.sha256.slice(0, 12)}`); process.exit(0); }

/** One shell command on the volume's machine (Railway via railway ssh, or here with --local). Returns its output. */
function sh(cmd) {
  const r = local ? spawnSync('sh', ['-c', cmd], { encoding: 'utf8', maxBuffer: 64e6 })
    : spawnSync('railway', ['ssh', '--service', 'web', '--', cmd], { encoding: 'utf8', maxBuffer: 64e6 });
  const out = (r.stdout || '').split('\n').filter((l) => !/^Using SSH/.test(l)).join('\n');
  if (r.status !== 0) throw new Error(`failed (${r.status}): ${cmd.slice(0, 80)}…\n${r.stderr || out}`);
  return out;
}
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const inbox = `${DATA}/accounts/.incoming-${company}-${stamp}`;

// The unpacker runs over there with node (the app's own runtime): it checks every file before anything is swapped in.
const unpack = `
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [inbox, dest] = process.argv.slice(2);
const list = JSON.parse(Buffer.from(fs.readFileSync(inbox + '/bundle.b64', 'utf8').trim(), 'base64').toString('utf8'));
const tmp = dest + '.new';
fs.rmSync(tmp, { recursive: true, force: true });
for (const f of list) {
  const b = Buffer.from(f.b64, 'base64');
  if (crypto.createHash('sha256').update(b).digest('hex') !== f.sha256) { console.error('sha256 mismatch: ' + f.rel); process.exit(3); }
  const out = path.join(tmp, f.rel);
  if (!out.startsWith(tmp + path.sep)) { console.error('bad path: ' + f.rel); process.exit(3); }
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, b);
}
if (fs.existsSync(dest)) fs.renameSync(dest, dest + '.bak-' + process.argv[4]);
fs.renameSync(tmp, dest);
fs.rmSync(inbox, { recursive: true, force: true });
console.log('placed ' + list.length + ' files in ' + dest);
`;
const listing = `
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const d = process.argv[2];
const walk = (rel = '') => fs.readdirSync(path.join(d, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(rel, e.name)) : [path.join(rel, e.name)]));
for (const f of walk().sort()) console.log(crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex') + ' ' + f);
`;

if (backup) {
  const file = `${DATA}/baldwin-backup-${new Date().toISOString().slice(0, 10)}-before-account-content.db`;
  const js = `const { DatabaseSync } = require('node:sqlite'); const fs = require('node:fs'); if (fs.existsSync(${JSON.stringify(file)})) { console.log('backup already there: ${file}'); process.exit(0); } new DatabaseSync(${JSON.stringify(DATA + '/baldwin.db')}, { readOnly: true }).exec("VACUUM INTO '${file}'"); console.log('backup: ${file} ' + fs.statSync(${JSON.stringify(file)}).size + ' bytes');`;
  if (fs.existsSync(`${DATA}/baldwin.db`) || !local) console.log(sh(`node -e ${q(js)}`).trim());
  else console.log('no database at ' + DATA + ', backup skipped');
}
sh(`mkdir -p ${q(inbox)}`);
const send = (name, text) => {
  const b64 = Buffer.from(text).toString('base64');
  for (let i = 0; i < b64.length; i += CHUNK) sh(`printf %s ${q(b64.slice(i, i + CHUNK))} >> ${q(inbox + '/' + name)}`);
};
send('bundle.b64', JSON.stringify(files.map(({ rel, b64, sha256 }) => ({ rel, b64, sha256 }))));
send('unpack.js.b64', unpack);
send('list.js.b64', listing);
sh(`base64 -d < ${q(inbox + '/unpack.js.b64')} > ${q(inbox + '/unpack.js')} && base64 -d < ${q(inbox + '/list.js.b64')} > ${q(DATA + '/accounts/.list.js')}`); // (stdin: GNU and BSD base64 both take it)
console.log(sh(`node ${q(inbox + '/unpack.js')} ${q(inbox)} ${q(`${DATA}/accounts/${company}`)} ${q(stamp)}`).trim());
const there = new Map(sh(`node ${q(DATA + '/accounts/.list.js')} ${q(`${DATA}/accounts/${company}`)}`).trim().split('\n').filter(Boolean).map((l) => { const [h, ...f] = l.split(' '); return [f.join(' '), h]; }));
const bad = files.filter((f) => there.get(f.rel) !== f.sha256).map((f) => f.rel);
const extra = [...there.keys()].filter((k) => !files.some((f) => f.rel === k));
if (bad.length || extra.length) { console.error('MISMATCH on the volume:', { missingOrDifferent: bad, extra }); process.exit(4); }
console.log(`verified: ${files.length} files on the volume match ${src}`);
