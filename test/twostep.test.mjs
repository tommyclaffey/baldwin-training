// A super admin without two-step sign-in (Nov 16, Tommy hit it live: signed in, the book showed its built-in sidebar and
// "We couldn't find that page" everywhere). The server keeps the book closed; the app sends them to Your Account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { giveAccount, startServer } from './helpers.mjs';

const T = await import('../src/lib/twostep.ts');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('who is sent to Your Account, and where each person lands after signing in', () => {
  const sup = { role: 'superadmin', totpOn: false, impersonatedBy: null };
  assert.equal(T.needsTwoStep(sup), true);
  assert.equal(T.landingFor(sup), '/admin/account');
  assert.equal(T.needsTwoStep({ ...sup, totpOn: true }), false, 'two-step on: Mise opens');
  assert.equal(T.landingFor({ ...sup, totpOn: true }), '/admin');
  assert.equal(T.needsTwoStep({ ...sup, impersonatedBy: 7 }), false, 'signed in as someone else: that person’s view');
  for (const role of ['owner', 'manager', 'staff']) assert.equal(T.needsTwoStep({ role, totpOn: false }), false, role);
  assert.equal(T.needsTwoStep(null), false);
  assert.equal(T.TWO_STEP_MSG, 'Turn on two-step sign-in to open Mise. Super admins need it.');
});

test('every book route and the sign-in send them there (the book, the admin, the email sign-in)', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(read('src/App.tsx'), /if \(needsTwoStep\(user\)\) return <Navigate to=\{TWO_STEP_HOME\} replace \/>/, 'the book, before any page or sidebar');
  assert.match(read('src/admin/AdminApp.tsx'), /needsTwoStep\(user\)\) return location\.pathname === TWO_STEP_HOME/, 'any admin address');
  assert.match(read('src/admin/screens.tsx'), /nav\(landingFor\(u\)\)/, 'after signing in');
  assert.match(read('src/admin/screens.tsx'), /needsTwoStep\(user\) && <p className="error" role="alert">\{TWO_STEP_MSG\}/, 'the one-line message');
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-2step-'));
let PORT; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;
before(async () => {
  giveAccount(dir);
  ({ server, port: PORT } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: '', SUPERADMIN_EMAIL: 'tommy@two.test' }));
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('the server: the session says so, and the book stays closed until two-step is on', async () => {
  let jar = '';
  const call = async (p, { method = 'GET', body } = {}) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: body && JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) jar = set.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  assert.equal((await call('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@two.test', password: 'long-enough-1' } })).status, 200);
  const me = (await call('/api/me')).data.user;
  assert.equal(T.needsTwoStep(me), true, '/api/me carries what the app needs to decide');
  assert.equal(T.landingFor(me), '/admin/account');
  assert.equal((await call('/api/index')).status, 403, 'the book is closed');
});
