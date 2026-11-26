// Shared test helpers.
import { totpAt } from '../server/auth.mjs';

/** Super admins need two-step sign-in before they can work in any company (Nov 14, security review). Tests that sign up
 *  the owner email as the super admin turn it on straight after setup. `call(path, { method, body })` → { status, data }. */
export async function turnOnTwoStep(call, { workIn = 1 } = {}) {
  const secret = (await call('/api/2fa/start', { method: 'POST' })).data?.secret;
  const r = await call('/api/2fa/enable', { method: 'POST', body: { code: totpAt(secret, Math.floor(Date.now() / 30000)) } });
  if (r.status !== 200) throw new Error('two-step sign-in didn’t turn on: ' + r.status);
  // Nov 16: a super admin starts in Mise Academy (HQ). These tests use the owner email as The Baldwin's owner, so the super
  // admin works in company 1 (Super Admin → Companies → Work Here). workIn: null stays in HQ.
  if (workIn != null) { const w = await call('/api/super/act', { method: 'POST', body: { companyId: workIn } }); if (w.status !== 200) throw new Error('work here failed: ' + w.status); }
  return secret;
}

/* ---- Company 1's account folder (Nov 16) ----
 * The Baldwin's menu, its own pages and its Hospitality Program are its account content on the volume, not in this repo
 * (server/account.mjs). Tests give company 1 an account folder before the server starts:
 *   • MISE_PRIVATE_ACCOUNT=<folder> (e.g. ~/Coding/mise-private/baldwin/account): The Baldwin's real one, so the tests that
 *     check The Baldwin's own book run too;
 *   • otherwise a made-up one: the Baldwin demo's menu (content/demo), as company 1's menu seeds. The tests about The
 *     Baldwin's real content are skipped (`baldwinOnly`). */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const PRIVATE_ACCOUNT = process.env.MISE_PRIVATE_ACCOUNT ? path.resolve(process.env.MISE_PRIVATE_ACCOUNT.replace(/^~(?=\/)/, process.env.HOME)) : null;
export const baldwinOnly = PRIVATE_ACCOUNT ? {} : { skip: 'checks The Baldwin’s own content: set MISE_PRIVATE_ACCOUNT to its account folder' };
export function giveAccount(dataDir) {
  const to = path.join(dataDir, 'accounts', '1');
  if (fs.existsSync(to)) return to;
  if (PRIVATE_ACCOUNT) { fs.cpSync(PRIVATE_ACCOUNT, to, { recursive: true }); return to; }
  fs.mkdirSync(path.join(to, 'cms'), { recursive: true });
  fs.writeFileSync(path.join(to, 'account.json'), JSON.stringify({ name: 'Made-up test account (the Baldwin demo’s menu)', seedStore: 1, seedKeyPrefix: '' }));
  for (const c of ['recipe', 'house', 'wine', 'shelf', 'beer']) {
    const seeds = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/demo', c + '.json'), 'utf8'));
    fs.writeFileSync(path.join(to, 'cms', c + '.json'), JSON.stringify(seeds.map((s, i) => ({ key: s.slug, slug: s.slug, sort: s.sort ?? i, data: s.data }))));
  }
  return to;
}

/* ---- People who joined with a PIN (Nov 25) ----
 * Since section 50 nobody joins with a PIN (Join with a Code asks for an email and a password), but the people who joined
 * before still have one until they use Set Up Your Sign-In. Tests make them straight in the database, as they are on live:
 * staff with a PIN, no email, no password. → their user id. */
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../server/auth.mjs';
export async function addPinStaff(dataDir, { name, pin = '4321', companyId = 1, storeId = null, role = 'staff' }) {
  const db = new DatabaseSync(path.join(dataDir, 'baldwin.db'));
  try {
    const store = storeId ?? db.prepare('SELECT id FROM stores WHERE company_id = ? ORDER BY sort, id LIMIT 1').get(companyId)?.id ?? null;
    return Number(db.prepare('INSERT INTO users(company_id, store_id, name, role, pin_hash, created_at) VALUES (?,?,?,?,?,?)')
      .run(companyId, store, name, role, await hashPassword(pin), new Date().toISOString()).lastInsertRowid);
  } finally { db.close(); }
}
/** A phone already signed in (a session from before Nov 25, when PIN people signed in with their PIN): → its cookie. */
import { createSession, SESSION_COOKIE } from '../server/auth.mjs';
export function sessionCookieFor(dataDir, userId, days = 90) {
  const db = new DatabaseSync(path.join(dataDir, 'baldwin.db'));
  try { return `${SESSION_COOKIE}=${createSession(db, userId, { days })}`; } finally { db.close(); }
}

/* ---- Starting the test server and headless Chrome (Nov 26) ----
 * Every test file used to pick a random port from its own range, and some ranges overlapped (prep and roles; earlier
 * signin-urls and captions, seen-problems), so a full run under load failed one random test: two servers on one port.
 * Now nobody picks a port. The server listens on PORT=0, the OS hands it a free one, and the server prints it
 * ("Mise on http://localhost:<port>"); Chrome gets --remote-debugging-port=0 and writes its port to DevToolsActivePort.
 * No ranges to keep apart, and a busy machine only makes the start slower, never a clash.
 * KEEP_ALIVE_MS=0: the server never closes an idle connection itself. A test that keeps its process busy for a few
 * seconds (the a11y page walks) used to send its next request on a connection the server had just closed: ECONNRESET. */
import { spawn } from 'node:child_process';
import os from 'node:os';
const START_MS = Number(process.env.TEST_SERVER_START_MS) || 180_000; // a loaded machine (a full run next to other work) can take well over 30 s

/** Starts server/index.mjs with `env` (merged over process.env) on a free port. Resolves once it is listening:
 *  → { server, port, base }. Rejects with the server's last error output if it exits or doesn't start in time. */
export function startServer(env = {}, { cwd = ROOT, timeoutMs = START_MS } = {}) {
  const server = spawn(process.execPath, ['server/index.mjs'], { cwd, env: { ...process.env, KEEP_ALIVE_MS: '0', ...env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const fail = (why) => { server.kill(); finish(reject, new Error(`test server ${why}${err ? '\n' + err.slice(-2000) : ''}`)); };
    const timer = setTimeout(() => fail(`did not start in ${Math.round(timeoutMs / 1000)} s`), timeoutMs);
    server.stdout.on('data', (d) => { // keeps reading after the start too, so a chatty server never blocks on a full pipe
      if (done) return;
      out = (out + d).slice(-4000);
      const m = /Mise on http:\/\/localhost:(\d+)/.exec(out);
      if (m) { const port = Number(m[1]); finish(resolve, { server, port, base: `http://127.0.0.1:${port}` }); }
    });
    server.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    server.once('error', (e) => fail(`could not be spawned: ${e.message}`));
    server.once('exit', (code, signal) => fail(`exited before it started (code ${code}${signal ? ', ' + signal : ''})`));
  });
}

/** Headless Chrome with remote debugging on a free port. → { proc, port, profile }; `port` is null if Chrome never
 *  reported one (the caller's own "Chrome did not start" check then fails). */
export async function startChrome(chrome, { profilePrefix = 'bt-chrome-', args = [], timeoutMs = 60_000 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, ...args, 'about:blank'], { stdio: 'ignore' });
  let exited = false; proc.once('exit', () => { exited = true; });
  const file = path.join(profile, 'DevToolsActivePort');
  let port = null;
  for (const t0 = Date.now(); !port && !exited && Date.now() - t0 < timeoutMs;) {
    try { const t = fs.readFileSync(file, 'utf8'); if (t.includes('\n')) port = Number(t.split('\n')[0]) || null; } catch { /* not written yet */ }
    if (!port) await new Promise((r) => setTimeout(r, 100));
  }
  return { proc, port, profile };
}
