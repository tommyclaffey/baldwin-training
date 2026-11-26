// Uploads behind the scenes (Nov 16, server/files.mjs; audit Nov 15, items 30–31): the encrypted files backup holds every
// upload and account folder (demos left out), "since" sends only what changed, the restore script gives the files back
// byte for byte; a company can't upload past its storage cap; old "before-…" database copies go after 14 days.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { giveAccount, startServer } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-files-'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-files-out-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
const OPS_TOKEN = 'ops-token-for-the-files-test-1234';
const BACKUP_KEY = 'backup-key-for-the-files-test-5678';
let server;

const media = path.join(dir, 'media');
const big = Buffer.alloc(700_000, 7); // not a multiple of 512, so the tar padding is checked
before(async () => {
  giveAccount(dir);
  fs.mkdirSync(path.join(media, 'demo', 'demo-mise-0123456789'), { recursive: true });
  fs.writeFileSync(path.join(media, 'old-clip.mp4'), big);
  fs.writeFileSync(path.join(media, 'demo', 'demo-mise-0123456789', 'scan.jpg'), 'demo file');
  const longName = 'a'.repeat(60) + '-' + 'b'.repeat(60) + '.jpg'; // past 100 bytes with media/ in front
  fs.writeFileSync(path.join(media, longName), 'long name');
  const past = new Date(Date.now() - 3 * 864e5);
  for (const f of ['old-clip.mp4', longName]) fs.utimesSync(path.join(media, f), past, past);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OPS_TOKEN, BACKUP_KEY, STORAGE_CAP_MB: '1', OWNER_EMAIL: 'owner@files.test', SUPERADMIN_EMAIL: 'boss@files.test', PREP_WEEKLY: 'off' }));
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); });

async function pull(q = '') {
  const r = await fetch(`${BASE}/api/ops/files${q}`, { headers: { authorization: `Bearer ${OPS_TOKEN}` } });
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 7).toString(), 'MISEFL1');
  assert.equal(buf.subarray(-8).toString(), 'MISEEND1');
  return buf;
}
function restore(buf, name) {
  const file = path.join(out, name + '.bk'), to = path.join(out, name);
  fs.writeFileSync(file, buf);
  execFileSync(process.execPath, ['scripts/restore-files.mjs', file, to], { cwd: root, env: { ...process.env, BACKUP_KEY }, stdio: 'pipe' });
  return to;
}
const tree = (d, pre = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(path.join(d, e.name), pre + e.name + '/') : [pre + e.name])).sort();

test('the files backup is closed without the token', async () => {
  assert.equal((await fetch(BASE + '/api/ops/files')).status, 404);
  assert.equal((await fetch(BASE + '/api/ops/files', { headers: { authorization: 'Bearer nope' } })).status, 404);
});

test('everything: uploads and account folders come back byte for byte; demos are left out; the key matters', async () => {
  const buf = await pull();
  assert.ok(!buf.includes(Buffer.from('old-clip')), 'file names are encrypted too');
  const to = restore(buf, 'full');
  const got = tree(to);
  assert.ok(got.includes('media/old-clip.mp4'));
  assert.ok(got.some((f) => /^media\/a{60}-b{60}\.jpg$/.test(f)), 'long names survive');
  assert.ok(got.some((f) => f.startsWith('accounts/1/')), 'account folders are in');
  assert.ok(!got.some((f) => f.startsWith('media/demo')), 'a demo’s files are not');
  assert.deepEqual(fs.readFileSync(path.join(to, 'media/old-clip.mp4')), big);
  const accountFiles = tree(path.join(dir, 'accounts'));
  for (const f of accountFiles) assert.deepEqual(fs.readFileSync(path.join(to, 'accounts', f)), fs.readFileSync(path.join(dir, 'accounts', f)), f);
  const manifest = JSON.parse(fs.readFileSync(path.join(to, 'MANIFEST.json'), 'utf8'));
  assert.equal(manifest.since, null);
  assert.equal(manifest.files.length, got.length - 1);

  const file = path.join(out, 'wrong.bk'); fs.writeFileSync(file, buf);
  assert.throws(() => execFileSync(process.execPath, ['scripts/restore-files.mjs', file, path.join(out, 'wrong')], { cwd: root, env: { ...process.env, BACKUP_KEY: 'not-the-right-key-at-all-0000' }, stdio: 'pipe' }));
  fs.writeFileSync(file, buf.subarray(0, buf.length - 100));
  assert.throws(() => execFileSync(process.execPath, ['scripts/restore-files.mjs', file, path.join(out, 'cut')], { cwd: root, env: { ...process.env, BACKUP_KEY }, stdio: 'pipe' }), /cut off/);
});

test('since: only files changed after it, but the manifest still lists everything', async () => {
  fs.writeFileSync(path.join(media, 'new-photo.jpg'), 'fresh');
  const since = new Date(Date.now() - 864e5).toISOString();
  const to = restore(await pull(`?since=${encodeURIComponent(since)}`), 'changes');
  const got = tree(to).filter((f) => f.startsWith('media/'));
  assert.deepEqual(got, ['media/new-photo.jpg']);
  const manifest = JSON.parse(fs.readFileSync(path.join(to, 'MANIFEST.json'), 'utf8'));
  assert.ok(manifest.files.some((f) => f.name === 'media/old-clip.mp4'));
  assert.equal((await fetch(`${BASE}/api/ops/files?since=soon`, { headers: { authorization: `Bearer ${OPS_TOKEN}` } })).status, 400);
});

function person() {
  let jar = '';
  return async (p, { method = 'GET', body, raw, headers = {} } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'X-BT': '1', ...(raw === undefined ? { 'Content-Type': 'application/json' } : {}), ...headers, ...(jar ? { Cookie: jar } : {}) },
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
  };
}

test('storage cap: uploads fit until the company’s cap, then a plain message; the library shows what’s used', async () => {
  const owner = person();
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Odile Owner', email: 'owner@files.test', password: 'long-enough-1' } })).status, 200);
  const up = (bytes, name) => owner('/api/media/upload', { method: 'POST', raw: Buffer.alloc(bytes, 1), headers: { 'Content-Type': 'image/jpeg', 'X-Filename': name } });
  // the cap is 1 MB; company 1 already owns nothing (old-clip.mp4 isn't in its library)
  assert.equal((await up(600_000, 'first.jpg')).status, 200);
  const lib = await owner('/api/media');
  assert.ok(lib.data.storage.used >= 600_000 && lib.data.storage.cap === 1024 * 1024, JSON.stringify(lib.data.storage));
  const full = await up(600_000, 'second.jpg');
  assert.equal(full.status, 413);
  assert.match(full.data.error, /used 1 MB of 1 MB.*YouTube/);
  assert.ok(!fs.readdirSync(media).some((f) => f.includes('second')), 'a refused file isn’t left on the volume');
  assert.equal((await up(100_000, 'small.jpg')).status, 200, 'a small one still fits');
});

test('old database copies: "before-…" copies and old baldwin-backup files go after 14 days; daily ones and the live database stay', async () => {
  const { pruneOldCopies } = await import('../server/files.mjs');
  const backups = path.join(dir, 'backups');
  fs.mkdirSync(path.join(backups, 'partial-upload-old'), { recursive: true });
  const files = {
    [path.join(backups, 'before-old.db')]: 20, [path.join(backups, 'before-new.db')]: 2, [path.join(backups, 'daily-2020-01-01.db')]: 20,
    [path.join(dir, 'baldwin-backup-2020-01-01-before-x.db')]: 20, [path.join(dir, 'keep-me.db')]: 20,
  };
  for (const [f, days] of Object.entries(files)) { fs.writeFileSync(f, 'x'); const t = new Date(Date.now() - days * 864e5); fs.utimesSync(f, t, t); }
  const t = new Date(Date.now() - 20 * 864e5); fs.utimesSync(path.join(backups, 'partial-upload-old'), t, t);
  const removed = pruneOldCopies(14, { dataDir: dir }).sort();
  assert.deepEqual(removed, ['baldwin-backup-2020-01-01-before-x.db', 'before-old.db', 'partial-upload-old']);
  assert.ok(fs.existsSync(path.join(backups, 'before-new.db')));
  assert.ok(fs.existsSync(path.join(backups, 'daily-2020-01-01.db')), 'daily snapshots are ops.mjs’s job');
  assert.ok(fs.existsSync(path.join(dir, 'keep-me.db')));
});
