// Plans, looks and Mise Academy (HQ) (Nov 16, Tommy: "the baldwin is supposed to [be] an account under the app. custom
// brand is an upgraded tier" · "it looks like my super admin account is attached to the baldwin verse a mise company
// account"). And the leak sweep: a real company that isn't The Baldwin sees nothing of The Baldwin group's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { giveAccount, turnOnTwoStep, startServer } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-hq-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server;
function person() {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
before(async () => {
  giveAccount(dir);
  ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@baldwin.test', SUPERADMIN_EMAIL: 'tommy@mise.test' }));
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const tommy = person(), owner = person(), harborOwner = person(), harborStaff = person();
let hq = 0, harbor = 0, harborCode = '';
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));

test('setup: The Baldwin’s owner and the super admin (two-step on, no company picked)', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Bram Owner', email: 'owner@baldwin.test', password: 'long-enough-1' } })).status, 200);
  assert.equal((await tommy('/api/setup', { method: 'POST', body: { name: 'Tommy', email: 'tommy@mise.test', password: 'long-enough-1' } })).status, 200);
  await turnOnTwoStep(tommy, { workIn: null });
});

test('a super admin with no company picked works in Mise Academy (HQ), in the Mise look, never The Baldwin', async () => {
  const me = (await tommy('/api/me')).data.user;
  const d = db(); const row = d.prepare('SELECT * FROM companies WHERE internal = 1').all(); d.close();
  assert.equal(row.length, 1, 'exactly one HQ');
  hq = row[0].id;
  assert.equal(me.workingIn, hq);
  assert.equal(me.workingInName, 'Mise Academy (HQ)');
  assert.equal(me.brand, 'mise');
  assert.equal(me.store.name, 'Mise Academy');
  assert.equal(row[0].join_code, null, 'no join code: nobody joins HQ as staff');
  // Its book is a brand-new customer's: the shared library, no menu, Our Story and the Floor Plan waiting to be filled in
  const idx = (await tommy('/api/index')).data;
  assert.ok(idx.length > 300 && !idx.some((e) => e.slug.startsWith('recipe/') || e.slug.startsWith('signature/')), 'no menu');
  assert.ok((await tommy('/api/page/' + idx.find((e) => e.slug === 'our-story').file)).data.empty, 'Our Story: an empty state');
});

test('Super Admin → Companies: HQ first, tagged, Mise’s own (no plan change, no delete); The Baldwin on Custom Brand in its look', async () => {
  const ov = (await tommy('/api/super/overview')).data;
  assert.equal(ov.companies[0].id, hq);
  assert.equal(ov.companies[0].hq, true);
  assert.deepEqual([ov.companies[0].plan, ov.companies[0].drawnIn], ['foundation', 'mise']);
  const b = ov.companies.find((c) => c.id === 1);
  assert.deepEqual([b.hq, b.plan, b.look, b.drawnIn], [false, 'custom-brand', 'baldwin', 'baldwin'], 'company 1 is untouched');
  assert.deepEqual(b.looks.map((l) => l.id), ['mise', 'baldwin', 'testabarra', 'jbaldwins']); // Nov 17: its other two restaurants' looks
  assert.deepEqual(ov.plans.map((p) => p.id), ['foundation', 'custom-brand']);
  assert.equal((await tommy(`/api/super/companies/${hq}`, { method: 'PATCH', body: { plan: 'custom-brand' } })).status, 400);
  assert.equal((await tommy(`/api/super/companies/${hq}`, { method: 'DELETE', body: { confirm: 'Mise Academy (HQ)' } })).status, 400);
});

test('Work Here takes a super admin into a customer’s account and back to HQ', async () => {
  assert.equal((await tommy('/api/super/act', { method: 'POST', body: { companyId: 1 } })).status, 200);
  let me = (await tommy('/api/me')).data.user;
  assert.deepEqual([me.workingIn, me.brand], [1, 'baldwin']);
  assert.equal((await tommy('/api/super/act', { method: 'POST', body: { companyId: hq } })).status, 200);
  me = (await tommy('/api/me')).data.user;
  assert.deepEqual([me.workingIn, me.brand], [hq, 'mise']);
});

test('a new company starts on Foundation in the Mise look; a custom look needs the plan and has to be made for it', async () => {
  const add = await tommy('/api/super/companies', { method: 'POST', body: { name: 'Harbor Lane Hospitality', ownerEmail: 'owner@harbor.test' } });
  assert.equal(add.status, 200);
  harbor = add.data.id;
  assert.equal((await harborOwner(`/api/invite/${add.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Hale Owner', password: 'long-enough-2' } })).status, 200);
  const c = (await tommy('/api/super/overview')).data.companies.find((x) => x.id === harbor);
  assert.deepEqual([c.plan, c.look, c.drawnIn], ['foundation', 'mise', 'mise']);
  assert.deepEqual(c.looks.map((l) => l.id), ['mise'], 'The Baldwin’s look isn’t made for them');
  assert.equal((await tommy(`/api/super/companies/${harbor}`, { method: 'PATCH', body: { look: 'baldwin' } })).status, 400);
  assert.equal((await tommy(`/api/super/companies/${harbor}`, { method: 'PATCH', body: { plan: 'custom-brand' } })).status, 200);
  assert.equal((await tommy(`/api/super/companies/${harbor}`, { method: 'PATCH', body: { look: 'baldwin' } })).status, 400, 'still not theirs on the upgrade');
  assert.equal((await harborOwner('/api/me')).data.user.brand, 'mise');
  // Even if the look column says otherwise (the live table's default is The Baldwin's), the plan decides
  const d = db(); d.prepare("UPDATE companies SET brand = 'baldwin', plan = 'foundation' WHERE id = ?").run(harbor); d.close();
  assert.equal((await harborOwner('/api/me')).data.user.brand, 'mise');
  harborCode = (await harborOwner('/api/team')).data.company.joinCode;
  assert.equal((await person()(`/api/join/${harborCode}`)).data.brand, 'mise');
  assert.equal((await harborStaff('/api/join', { method: 'POST', body: { code: harborCode, name: 'Pia Server', email: `j${Math.random().toString(36).slice(2, 10)}@join.test`, password: 'join-pass-4321-x' } })).status, 200);
});

test('The Baldwin moves to Foundation → Mise look; back on Custom Brand with its look → its look again', async () => {
  assert.equal((await tommy('/api/super/companies/1', { method: 'PATCH', body: { plan: 'foundation' } })).status, 200);
  assert.equal((await owner('/api/me')).data.user.brand, 'mise');
  assert.equal((await tommy('/api/super/companies/1', { method: 'PATCH', body: { look: 'baldwin' } })).status, 400, 'a custom look needs the plan');
  assert.equal((await tommy('/api/super/companies/1', { method: 'PATCH', body: { plan: 'custom-brand', look: 'baldwin' } })).status, 200);
  assert.equal((await owner('/api/me')).data.user.brand, 'baldwin');
  const log = (await tommy('/api/super/log')).data;
  assert.ok(JSON.stringify(log).includes('plan and look'), 'logged');
});

test('HQ never appears to a customer', async () => {
  for (const who of [owner, harborOwner, harborStaff]) {
    const me = (await who('/api/me')).data.user;
    assert.notEqual(me.workingIn, hq);
    assert.ok(!JSON.stringify(me).includes('Mise Academy (HQ)'));
    assert.ok(!(me.stores || []).some((s) => s.name === 'Mise Academy'));
  }
  const d = db(); const hqStore = d.prepare('SELECT id FROM stores WHERE company_id = ?').get(hq).id; d.close();
  assert.equal((await owner('/api/store', { method: 'POST', body: { storeId: hqStore } })).status, 404, 'an owner can’t switch into HQ');
  assert.equal((await owner('/api/super/overview')).status, 404);
});

// The leak sweep (Nov 16, audit 11): every page and the search index, as a real company's staff and owner.
const THEIRS = /The Baldwin|J\.\s?Baldwin|Baldwin Restaurant Group|Baldwin|Testa Barra|\bBRG\b|Jeffrey(?! Ong)|Shelby|Macomb|Feb 2[2-4]|\$22\b|flight · \$30|wine flight|sommelier flight|We host|Book your seat with us|Rosemarie|Gabriella(?! Clare)|jbaldwins|testabarra|thebaldwinshelby|Clinton Township/;
test('nothing of The Baldwin group’s shows to another real company: every page, the index, its look', async () => {
  const hits = [];
  const scan = (v, where) => {
    if (typeof v === 'string') { const m = THEIRS.exec(v); if (m) hits.push(`${where}: …${v.slice(Math.max(0, m.index - 40), m.index + 40)}…`); return; }
    if (Array.isArray(v)) return v.forEach((x, i) => scan(x, where + '[' + i + ']'));
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(x, where + '.' + k);
  };
  for (const [name, who] of [['staff', harborStaff], ['owner', harborOwner]]) {
    const me = (await who('/api/me')).data;
    assert.equal(me.user.brand, 'mise');
    scan(me, name + ' /api/me');
    const idx = (await who('/api/index')).data;
    scan(idx, name + ' /api/index');
    for (const f of [...new Set(idx.map((e) => e.file))]) {
      const r = await who('/api/page/' + encodeURIComponent(f));
      assert.equal(r.status, 200, f);
      scan(r.data, `${name} ${f}`);
    }
  }
  assert.deepEqual(hits.slice(0, 20), [], `${hits.length} Baldwin mentions`);
});
