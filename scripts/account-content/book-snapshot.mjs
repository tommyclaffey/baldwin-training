// Before/after check (Nov 16): The Baldwin’s book read through the API as real viewers, on a copy of the live database.
// Run it on the build before a change and after it, then: node scripts/account-content/book-diff.mjs <before> <after>.
// With --fake, book-sweep.mjs checks the fake company’s whole book for anything of BRG’s.
// node snap.mjs <repoRoot> <baseDb> <outDir> [accountsDir] [--fake]
//   repoRoot    a built checkout (dist/ present)
//   baseDb      a copy of the live database (never written: copied to a temp DATA_DIR first)
//   outDir      where the snapshot goes: <viewer>/<what>.json
//   accountsDir copied to DATA_DIR/accounts when given (the account content folder)
//   --fake      also make a fake real company (not a demo) and read its book as its staff and owner
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const [root, baseDb, outDir, accountsDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FAKE = process.argv.includes('--fake');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-snap-'));
fs.copyFileSync(baseDb, path.join(dataDir, 'baldwin.db'));
if (accountsDir) fs.cpSync(accountsDir, path.join(dataDir, 'accounts', '1'), { recursive: true }); // BRG's account folder
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const db = new DatabaseSync(path.join(dataDir, 'baldwin.db'));
const t = '2026-11-16T00:00:00.000Z', exp = '2027-11-16T00:00:00.000Z';
const ins = db.prepare('INSERT INTO users(company_id, name, role, store_id, created_at, jobs, started_on) VALUES (?,?,?,?,?,?,?)');
const addUser = (co, name, role, store, jobs = null) => Number(ins.run(co, name, role, store, t, jobs, jobs ? '2026-11-01' : null).lastInsertRowid);
const sess = (uid, token, actingStore = null, actingCo = null) => db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,acting_store_id,acting_company_id) VALUES (?,?,?,?,?,?)').run(sha(token), uid, t, exp, actingStore, actingCo);
const viewers = [];
// The Baldwin (company 1): a real staff member and the real manager in store 1; a test owner (every store) and a test
// staff member in stores 2 and 3. The extra people exist only in this temp copy.
const staff1 = db.prepare("SELECT id FROM users WHERE company_id = 1 AND role = 'staff' AND store_id = 1 AND deleted_at IS NULL AND jobs IS NOT NULL ORDER BY id LIMIT 1").get()
  || db.prepare("SELECT id FROM users WHERE company_id = 1 AND role = 'staff' AND store_id = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1").get();
const mgr1 = db.prepare("SELECT id FROM users WHERE company_id = 1 AND role = 'manager' AND deleted_at IS NULL ORDER BY id LIMIT 1").get();
const owner = addUser(1, 'Snapshot Owner', 'owner', null);
const staff2 = addUser(1, 'Snapshot Staff Two', 'staff', 2, '["server"]');
const staff3 = addUser(1, 'Snapshot Staff Three', 'staff', 3, '["bartender"]');
sess(staff1.id, 'v-s1-staff'); viewers.push(['s1-staff', 'v-s1-staff']);
sess(mgr1.id, 'v-s1-manager'); viewers.push(['s1-manager', 'v-s1-manager']);
for (const st of [1, 2, 3]) { sess(owner, 'v-s' + st + '-owner', st); viewers.push(['s' + st + '-owner', 'v-s' + st + '-owner']); }
sess(staff2, 'v-s2-staff'); viewers.push(['s2-staff', 'v-s2-staff']);
sess(staff3, 'v-s3-staff'); viewers.push(['s3-staff', 'v-s3-staff']);
if (FAKE) {
  // A fake real company (not a demo), made the way Super Admin → Add Company makes one: brand left to the table's default
  // on purpose (the live table's default is 'baldwin'), so the plan has to be what keeps it in the Mise look.
  const co = Number(db.prepare("INSERT INTO companies(name, slug, created_at) VALUES ('Harbor Lane Hospitality','harbor-lane',?)").run(t).lastInsertRowid);
  const st = Number(db.prepare("INSERT INTO stores(company_id, name, slug, book_ready, sort, created_at) VALUES (?, 'Harbor Lane Kitchen', 'harbor-lane-kitchen', 0, 0, ?)").run(co, t).lastInsertRowid);
  const fs1 = addUser(co, 'Fake Staff', 'staff', st, '["server"]');
  const fo = addUser(co, 'Fake Owner', 'owner', null);
  sess(fs1, 'v-fake-staff'); viewers.push(['fake-staff', 'v-fake-staff']);
  sess(fo, 'v-fake-owner', st); viewers.push(['fake-owner', 'v-fake-owner']);
}
db.close();

const PORT = 18000 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, PREP_WEEKLY: 'off', SCANNER_WARM: '0', RAILWAY_VOLUME_MOUNT_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 200; i++) { try { await fetch(base + '/api/health'); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
const get = async (token, p) => { const r = await fetch(base + p, { headers: { cookie: `bt_session=${token}` } }); const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; } return { status: r.status, body: j }; };
fs.rmSync(outDir, { recursive: true, force: true });
let pages = 0;
for (const [name, token] of viewers) {
  const dir = path.join(outDir, name); fs.mkdirSync(path.join(dir, 'page'), { recursive: true });
  const save = (f, v) => fs.writeFileSync(path.join(dir, f), JSON.stringify(v, null, 1));
  save('me.json', await get(token, '/api/me'));
  const idx = await get(token, '/api/index');
  save('index.json', idx);
  save('counts.json', await get(token, '/api/counts'));
  const files = [...new Set((Array.isArray(idx.body) ? idx.body : []).map((e) => e.file).filter(Boolean))];
  // + designed pages that aren't in the index (templates a CMS page is drawn from are not pages of their own)
  for (const f of files) { const r = await get(token, '/api/page/' + encodeURIComponent(f)); fs.writeFileSync(path.join(dir, 'page', f + '.json'), JSON.stringify(r)); pages++; }
}
server.kill();
fs.writeFileSync(path.join(outDir, 'server.log'), log);
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`snapshot: ${viewers.length} viewers, ${pages} pages → ${outDir}`);
