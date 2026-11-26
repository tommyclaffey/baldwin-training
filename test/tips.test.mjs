// Tip Tracker (Nov 25; Figma 09 · Idea Board → 52, approved by Tommy: "approved", manager view yes, pay period every two
// weeks). API part: the money math in whole cents (logging, totals, hourly, partial settles), the privacy rules (a person's
// shifts and tips are theirs alone: not another staff member, not a manager, not the owner, not a super admin, not through
// Sign In As), the manager view (owed items only), companies kept apart (a demo copy is another company), the export (owed
// in, private shifts out) and a removed person's records going at the 30-day purge. Browser part (needs Chrome and a built
// dist/; skipped otherwise): the demo's Tips, Log a Shift, Owed to You, Mark Settled and Owed to Staff at 390 and 1440.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { totpAt } from '../server/auth.mjs';
import { unzip } from '../server/zip.mjs';
import { startServer, startChrome } from './helpers.mjs';
import { toCents, toMinutes, hourly, totalsOf, periodStart, rangeOf, addDays, dayOf } from '../server/tips.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-tips-'));
let BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const BROWSER = CHROME && fs.existsSync(path.join(root, 'dist/index.html')) ? {} : { skip: 'needs a build (npm run build) and Chrome' };
const SHOTS = process.env.TIPS_SHOTS || null; // a folder: the browser test saves its screens there
let server;
const start = async () => { // (startServer's error carries the server's last error output)
  ({ server, base: BASE } = await startServer({ DATA_DIR: dir, OWNER_EMAIL: 'owner@tips.test', SUPERADMIN_EMAIL: 'tommy@tips.test', RESEND_API_KEY: '', MAIL_FROM: '', PREP_WEEKLY: 'off' }));
};
before(start);
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

let ipN = 10;
function person() {
  const ip = `10.31.0.${ipN++}`;
  const p = { jar: '', ip };
  p.call = async (u, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + u, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', 'X-Forwarded-For': ip, ...(p.jar ? { Cookie: p.jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) p.jar = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json().catch(() => null) : null, buf: type.includes('json') ? null : Buffer.from(await res.arrayBuffer()) };
  };
  return p;
}
const db = () => new DatabaseSync(path.join(dir, 'baldwin.db'));
const code = (s) => totpAt(s, Math.floor(Date.now() / 30000));
const token = (link) => link.split('/').pop();
const owner = person(), mgr = person(), ana = person(), ben = person(), tommy = person();
let anaId = 0, benId = 0, mgrId = 0, anaShift = 0, anaOwed = 0, benOwed = 0;
const today = dayOf();

/* ---------------- the math, on its own ---------------- */
test('money: text to whole cents, never floats; bad amounts refused', () => {
  assert.equal(toCents('64', 'x'), 6400); assert.equal(toCents('64.5', 'x'), 6450); assert.equal(toCents('$1,064.05', 'x'), 106405);
  assert.equal(toCents(0.1, 'x') + toCents(0.2, 'x'), 30, '0.1 + 0.2 is 30 cents, exactly');
  assert.equal(toCents('.75', 'x'), 75); assert.equal(toCents('', 'x', { optional: true }), 0);
  for (const bad of ['64.555', '-5', 'abc', '1e3', '100000', '12.3.4']) assert.throws(() => toCents(bad, 'cash tips'), /amount like|over \$99,999\.99/, bad);
  assert.throws(() => toCents('', 'cash tips'), /Enter cash tips/);
  assert.equal(toMinutes('6.5'), 390); assert.equal(toMinutes('6'), 360); assert.equal(toMinutes('7.33'), 440); assert.equal(toMinutes(''), null); assert.equal(toMinutes('6 h'), 360);
  assert.throws(() => toMinutes('25'), /24 hours/); assert.throws(() => toMinutes('six'), /Hours should be/);
  // the approved screens' numbers: Nov 23–29 net $585.00 over 17.5 h = $33.43 an hour; the pay period $2,019.00 over 55 h = $36.71
  assert.equal(hourly(58500, 1050), 3343); assert.equal(hourly(201900, 3300), 3671); assert.equal(hourly(1000, 0), null);
  const t = totalsOf([{ cash: 6400, card: 23100, tipout: 2900, net: 26600, minutes: 360 }, { cash: 1000, card: 0, tipout: 0, net: 1000, minutes: null }]);
  assert.deepEqual([t.cash, t.card, t.tipout, t.net, t.minutes, t.hourly], [7400, 23100, 2900, 27600, 360, 4433], 'hourly counts only the shift with hours');
});
test('pay periods: every two weeks from Monday Nov 16, 2026; weeks Monday to Sunday', () => {
  assert.equal(periodStart('2026-11-16'), '2026-11-16'); assert.equal(periodStart('2026-11-25'), '2026-11-16'); assert.equal(periodStart('2026-11-29'), '2026-11-16');
  assert.equal(periodStart('2026-11-30'), '2026-11-30'); assert.equal(periodStart('2026-11-15'), '2026-11-02');
  assert.deepEqual(rangeOf('period', '2026-11-25'), { from: '2026-11-16', to: '2026-11-29' });
  assert.deepEqual(rangeOf('week', '2026-11-25'), { from: '2026-11-23', to: '2026-11-29' });
  assert.deepEqual(rangeOf('week', '2026-11-29'), { from: '2026-11-23', to: '2026-11-29' }, 'Sunday ends the week');
});

/* ---------------- people ---------------- */
test('setup: an owner, a manager, two staff members (email sign-in), a super admin with two-step', async () => {
  assert.equal((await owner.call('/api/setup', { method: 'POST', body: { name: 'Odile Owner', email: 'owner@tips.test', password: 'owner-pass-1' } })).status, 200);
  assert.equal((await tommy.call('/api/setup', { method: 'POST', body: { name: 'Tommy Claffey', email: 'tommy@tips.test', password: 'super-pass-1' } })).status, 200);
  const secret = (await tommy.call('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await tommy.call('/api/2fa/enable', { method: 'POST', body: { code: code(secret) } })).status, 200);
  const team = (await owner.call('/api/team')).data;
  const inv = await owner.call('/api/team/invite', { method: 'POST', body: { email: 'mgr@tips.test', role: 'manager', storeId: null } });
  assert.equal((await mgr.call(`/api/invite/${token(inv.data.link)}`, { method: 'POST', body: { name: 'Mina Manager', password: 'mgr-pass-01' } })).status, 200);
  for (const [p, name, email] of [[ana, 'Ana Lindqvist', 'ana@tips.test'], [ben, 'Ben Okoro', 'ben@tips.test']]) {
    const r = await p.call('/api/join', { method: 'POST', body: { code: team.company.joinCode, storeId: team.stores[0].id, name, email, password: 'staff-pass-01' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  anaId = (await ana.call('/api/me')).data.user.id; benId = (await ben.call('/api/me')).data.user.id; mgrId = (await mgr.call('/api/me')).data.user.id;
  assert.ok(anaId && benId && mgrId);
});

test('a real company starts empty', async () => {
  const r = await ana.call('/api/tips');
  assert.equal(r.status, 200);
  assert.equal(r.data.anyShifts, false); assert.equal(r.data.shifts.length, 0); assert.equal(r.data.owed.remaining, 0);
  assert.equal((await mgr.call('/api/tips/team')).data.open.length, 0);
});

test('Log a Shift: cash + card − tip-out = net, in cents; with the house owing $40 from it', async () => {
  const r = await ana.call('/api/tips/shifts', { method: 'POST', body: { day: today, part: 'dinner', position: 'Server', cash: '64', card: '231', tipout: '29', hours: '6', note: 'Patio secret note',
    owed: { on: true, amount: '40', reason: 'cash', note: 'Drawer secret note' } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  anaShift = r.data.id; anaOwed = r.data.owedId; assert.ok(anaShift && anaOwed);
  const page = (await ana.call('/api/tips')).data;
  assert.equal(page.shifts.length, 1);
  const s = page.shifts[0];
  assert.deepEqual([s.cash, s.card, s.tipout, s.net, s.minutes], [6400, 23100, 2900, 26600, 360]);
  assert.equal(s.owed[0].status, 'owed'); assert.equal(s.owed[0].amount, 4000);
  assert.equal(page.totals.net, 26600); assert.equal(page.totals.hourly, 4433);
  assert.deepEqual(page.owed, { remaining: 4000, count: 1, oldest: today });
  // a lunch with cents, no hours: the week adds up to the cent, and hourly still counts only the dinner's hours
  assert.equal((await ana.call('/api/tips/shifts', { method: 'POST', body: { day: today, part: 'lunch', cash: '34.25', card: '96.10', tipout: '13.05' } })).status, 200);
  const wk = (await ana.call('/api/tips?view=week')).data;
  assert.equal(wk.totals.net, 26600 + 3425 + 9610 - 1305); assert.equal(wk.totals.hourly, 4433); assert.equal(wk.totals.count, 2);
  const pd = (await ana.call('/api/tips?view=period')).data;
  assert.equal(pd.from, periodStart(today)); assert.equal(pd.to, addDays(periodStart(today), 13)); assert.equal(pd.totals.net, wk.totals.net);
  assert.equal(wk.shifts[0].part, 'dinner', 'dinner first within a day, as drawn');
});

test('Log a Shift: what’s refused', async () => {
  const bad = async (body, re) => { const r = await ana.call('/api/tips/shifts', { method: 'POST', body: { day: today, part: 'dinner', cash: '10', ...body } }); assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.data.error, re); };
  await bad({ cash: '64.555' }, /amount like 64/);
  await bad({ cash: '-5' }, /amount like 64/);
  await bad({ cash: '', card: '' }, /cash tips or card tips/);
  await bad({ day: addDays(today, 1) }, /future/);
  await bad({ day: '2026-02-30' }, /Pick the date/);
  await bad({ part: 'brunch' }, /lunch or dinner/);
  await bad({ hours: '30' }, /24 hours/);
  await bad({ owed: { on: true, amount: '0', reason: 'cash' } }, /how much/);
  await bad({ owed: { on: true, amount: '20', reason: 'other' } }, /what it’s for/);
  await bad({ owed: { on: true, amount: '20' } }, /Pick why/);
  assert.equal((await person().call('/api/tips')).status, 401, 'signed out');
  const noHeader = await fetch(BASE + '/api/tips/shifts', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ana.jar }, body: '{}' });
  assert.equal(noHeader.status, 403, 'writes need X-BT');
});

test('settling: partial in cents, then the rest; never more than is owed; edit can’t go under what was paid', async () => {
  let r = await ana.call(`/api/tips/owed/${anaOwed}/settle`, { method: 'POST', body: { amount: '25.50', paidOn: today } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.paid, r.data.remaining, r.data.status], [2550, 1450, 'part']);
  assert.equal(r.data.payments[0].by, 'you');
  r = await ana.call(`/api/tips/owed/${anaOwed}/settle`, { method: 'POST', body: { amount: '14.51' } });
  assert.equal(r.status, 400); assert.match(r.data.error, /Only \$14\.50 is still owed/);
  assert.equal((await ana.call(`/api/tips/owed/${anaOwed}/settle`, { method: 'POST', body: { amount: '5', paidOn: addDays(today, 1) } })).status, 400, 'not in the future');
  assert.equal((await ana.call(`/api/tips/owed/${anaOwed}/settle`, { method: 'POST', body: { amount: '5', paidOn: addDays(today, -1) } })).status, 400, 'not before the day it’s from');
  r = await ana.call(`/api/tips/owed/${anaOwed}`, { method: 'PATCH', body: { amount: '20' } });
  assert.equal(r.status, 400); assert.match(r.data.error, /\$25\.50 of it already/);
  r = await ana.call(`/api/tips/owed/${anaOwed}/settle`, { method: 'POST', body: { all: true } });
  assert.deepEqual([r.data.paid, r.data.remaining, r.data.status, r.data.settledOn], [4000, 0, 'settled', today]);
  assert.equal((await ana.call(`/api/tips/owed/${anaOwed}/settle`, { method: 'POST', body: { all: true } })).status, 409, 'already settled');
  const list = (await ana.call('/api/tips/owed')).data;
  assert.equal(list.remaining, 0); assert.equal(list.settled[0].id, anaOwed);
});

test('Add Owed Money, and Ben’s own shift with something owed', async () => {
  const r = await ana.call('/api/tips/owed', { method: 'POST', body: { day: addDays(today, -1), part: 'dinner', reason: 'other', label: 'Private party gratuity', amount: '60', note: 'Split from the 7:30 party' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = (await ana.call(`/api/tips/owed/${r.data.id}`)).data;
  assert.equal(d.label, 'Private party gratuity'); assert.equal(d.status, 'owed'); assert.equal(d.note, 'Split from the 7:30 party');
  const b = await ben.call('/api/tips/shifts', { method: 'POST', body: { day: today, part: 'dinner', position: 'Bartender', cash: '88', card: '236', hours: '7', note: 'Ben private note',
    owed: { on: true, amount: '42', reason: 'card' } } });
  assert.equal(b.status, 200); benOwed = b.data.owedId;
});

/* ---------------- privacy ---------------- */
const NO_TIPS = (json, who) => {
  const keys = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  walk(json);
  for (const k of ['cash', 'card', 'tipout', 'net', 'minutes', 'hourly', 'totals', 'shifts', 'note', 'shiftId', 'part']) assert.ok(!keys.has(k), `${who}: no ${k}`);
  const s = JSON.stringify(json);
  for (const word of ['secret note', 'Ben private note', 'Split from the 7:30', 'Patio', 'Busy close', 'House was short']) assert.ok(!s.includes(word), `${who}: no ${word}`);
};
test('privacy: another staff member can’t read, change or delete someone’s shifts or owed items', async () => {
  for (const [u, m] of [[`/api/tips/shifts/${anaShift}`, 'GET'], [`/api/tips/shifts/${anaShift}`, 'PATCH'], [`/api/tips/shifts/${anaShift}`, 'DELETE'],
    [`/api/tips/owed/${anaOwed}`, 'GET'], [`/api/tips/owed/${anaOwed}`, 'PATCH'], [`/api/tips/owed/${anaOwed}`, 'DELETE'], [`/api/tips/owed/${anaOwed}/settle`, 'POST']]) {
    const r = await ben.call(u, { method: m, body: m === 'GET' || m === 'DELETE' ? undefined : { cash: '1', amount: '1' } });
    assert.equal(r.status, 404, `${m} ${u}`);
  }
  const mine = (await ben.call('/api/tips?view=period')).data;
  assert.equal(mine.shifts.length, 1); assert.equal(mine.shifts[0].cash, 8800, 'only his own');
  assert.ok((await ben.call('/api/tips/owed')).data.open.every((o) => o.id === benOwed));
  assert.equal((await ben.call('/api/tips/team')).status, 403, 'staff don’t get the manager view');
  assert.equal((await ana.call(`/api/tips/shifts/${anaShift}`)).status, 200, 'still there for Ana');
});

test('privacy: a manager and the owner see owed items only (who, why, how much, status), never tips, shifts or notes', async () => {
  for (const [p, who] of [[mgr, 'manager'], [owner, 'owner']]) {
    for (const u of [`/api/tips/shifts/${anaShift}`, `/api/tips/owed/${anaOwed}`]) assert.equal((await p.call(u)).status, 404, `${who}: ${u}`);
    const own = (await p.call('/api/tips?view=period')).data;
    assert.equal(own.shifts.length, 0, `${who}: /api/tips is their own (empty)`);
    const team = await p.call('/api/tips/team');
    assert.equal(team.status, 200);
    NO_TIPS(team.data, who);
    const names = team.data.open.map((o) => o.person.name).sort();
    assert.deepEqual(names, ['Ana Lindqvist', 'Ben Okoro']);
    const ben42 = team.data.open.find((o) => o.person.name === 'Ben Okoro');
    assert.deepEqual([ben42.amount, ben42.remaining, ben42.status, ben42.label, ben42.person.job], [4200, 4200, 'owed', 'Card tips paid later', '']);
    assert.ok(team.data.recent.some((o) => o.id === anaOwed && o.status === 'settled'), 'recently settled');
  }
});

test('the manager view: partial and full settles, logged with who marked it; the person sees who', async () => {
  let r = await mgr.call(`/api/tips/team/${benOwed}/settle`, { method: 'POST', body: { amount: '30' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const item = r.data.open.find((o) => o.id === benOwed);
  assert.deepEqual([item.paid, item.remaining, item.status], [3000, 1200, 'part']);
  assert.equal(item.payments[0].by, 'you');
  NO_TIPS(r.data, 'settle answer');
  assert.equal((await mgr.call(`/api/tips/team/${benOwed}/settle`, { method: 'POST', body: { amount: '12.01' } })).status, 400);
  r = await owner.call(`/api/tips/team/${benOwed}/settle`, { method: 'POST', body: { all: true } });
  assert.ok(r.data.recent.some((o) => o.id === benOwed && o.status === 'settled'));
  const seen = (await ben.call(`/api/tips/owed/${benOwed}`)).data;
  assert.deepEqual(seen.payments.map((p) => [p.amount, p.by]), [[3000, 'Mina Manager'], [1200, 'Odile Owner']]);
  assert.equal(seen.settledBy, 'Odile Owner');
  const d = db();
  const rows = d.prepare("SELECT detail FROM audit WHERE action = 'settle owed money' ORDER BY id").all().map((x) => x.detail);
  assert.deepEqual(rows, ['Ben Okoro · Card tips paid later · $30.00 ($12.00 still owed)', 'Ben Okoro · Card tips paid later · $12.00 (settled)']);
  assert.ok(!d.prepare("SELECT 1 FROM audit WHERE detail LIKE '%$88%' OR detail LIKE '%$236%' OR detail LIKE '%Patio%'").get(), 'tips never in the Activity log');
  d.close();
});

test('privacy: a super admin can’t read tips, not working in the company and not through Sign In As', async () => {
  const companyId = (await owner.call('/api/me')).data.user.companyId;
  const work = await tommy.call('/api/super/act', { method: 'POST', body: { companyId } });
  assert.equal(work.status, 200, JSON.stringify(work.data));
  assert.equal((await tommy.call('/api/tips')).status, 403);
  assert.equal((await tommy.call('/api/tips/team')).status, 403);
  assert.equal((await tommy.call(`/api/tips/shifts/${anaShift}`)).status, 403);
  // Sign In As Ana: Tips is closed, reads and writes
  const as = await tommy.call(`/api/super/users/${anaId}/sign-in-as`, { method: 'POST' });
  assert.equal(as.status, 200, JSON.stringify(as.data));
  assert.equal((await tommy.call('/api/me')).data.user.id, anaId);
  for (const [u, m] of [['/api/tips', 'GET'], ['/api/tips?view=period', 'GET'], ['/api/tips/owed', 'GET'], [`/api/tips/shifts/${anaShift}`, 'GET'], [`/api/tips/owed/${anaOwed}`, 'GET'],
    ['/api/tips/shifts', 'POST'], [`/api/tips/shifts/${anaShift}`, 'DELETE'], ['/api/tips/team', 'GET']]) {
    const r = await tommy.call(u, { method: m, body: m === 'POST' ? { day: today, part: 'dinner', cash: '1' } : undefined });
    assert.equal(r.status, 403, `${m} ${u}`); assert.match(r.data.error, /private to Ana Lindqvist|while you’re signed in as someone/);
    NO_TIPS(r.data, 'sign in as');
  }
  assert.equal((await tommy.call('/api/super/return', { method: 'POST' })).status, 200);
  // Sign In As the manager: Owed to Staff is closed too
  assert.equal((await tommy.call(`/api/super/users/${mgrId}/sign-in-as`, { method: 'POST' })).status, 200);
  assert.equal((await tommy.call('/api/tips/team')).status, 403);
  assert.equal((await tommy.call('/api/super/return', { method: 'POST' })).status, 200);
  assert.equal((await ana.call(`/api/tips/shifts/${anaShift}`)).status, 200, 'nothing changed for Ana');
});

test('companies stay apart: a demo copy (another company) and this one can’t see each other’s items', async () => {
  const visitor = person();
  assert.equal((await visitor.call('/api/demo/start', { method: 'POST', body: { role: 'manager', demo: 'mise' } })).status, 200);
  const team = (await visitor.call('/api/tips/team')).data;
  assert.ok(team.open.length >= 4, 'the demo has its own example data');
  assert.ok(!JSON.stringify(team).includes('Ana Lindqvist') && !JSON.stringify(team).includes('Ben Okoro'));
  assert.equal((await visitor.call(`/api/tips/owed/${anaOwed}`)).status, 404);
  assert.equal((await visitor.call(`/api/tips/team/${benOwed}/settle`, { method: 'POST', body: { all: true } })).status, 404);
  const theirs = team.open[0].id;
  assert.equal((await mgr.call(`/api/tips/team/${theirs}/settle`, { method: 'POST', body: { all: true } })).status, 404);
  assert.equal((await ana.call(`/api/tips/owed/${theirs}`)).status, 404);
  assert.ok(!JSON.stringify((await mgr.call('/api/tips/team')).data).includes('Marisol'));
});

test('the demo: Marisol’s screens add up as drawn; the manager view matches Owed to Staff', async () => {
  const marisol = person();
  assert.equal((await marisol.call('/api/demo/start', { method: 'POST', body: { role: 'employee', demo: 'mise' } })).status, 200);
  const wk = (await marisol.call('/api/tips?view=week')).data;
  const pd = (await marisol.call('/api/tips?view=period')).data;
  assert.ok(pd.shifts.length >= 1);
  const owed = (await marisol.call('/api/tips/owed')).data;
  assert.equal(owed.remaining, 7400, '$54 + $20 left of the $60 gratuity (tonight’s dinner not logged yet)');
  assert.deepEqual(owed.open.map((o) => [o.label, o.status]), [['Private party gratuity', 'part'], ['Card tips paid later', 'owed']]);
  assert.deepEqual(owed.settled.map((o) => [o.label, o.amount]), [['Drawer short at close', 4500], ['Card tips paid later', 3200]]);
  assert.ok(wk.totals.net > 0);
  const boss = person();
  assert.equal((await boss.call('/api/demo/start', { method: 'POST', body: { role: 'manager', demo: 'mise' } })).status, 200);
  const t = (await boss.call('/api/tips/team')).data;
  assert.equal(t.owedNow, 18100, 'Owed now $181.00'); assert.equal(t.count, 5); assert.equal(t.people, 3);
  assert.deepEqual(t.oldest, { day: addDays(today, -4), name: 'Marisol Vega', remaining: 2000 });
  assert.equal(t.recent.find((o) => o.person.name === 'Quinn Abbott')?.settledBy, 'Rosalind Hart' === t.you ? 'you' : 'Rosalind Hart');
  NO_TIPS(t, 'demo manager');
  assert.equal((await boss.call('/api/tips')).data.anyShifts, false, 'Rosalind’s own tips start empty');
});

test('the export: owed items and payments in; each person’s shifts and tips never; notes never', async () => {
  const r = await owner.call('/api/company/export');
  assert.equal(r.status, 200);
  const files = unzip(r.buf);
  assert.ok(files.has('tips_owed.csv') && files.has('tips_owed_payments.csv'));
  assert.ok(!files.has('raw/tip_shifts.json'), 'no raw shifts');
  const owedCsv = files.get('tips_owed.csv').toString();
  assert.match(owedCsv, /Ben Okoro,.*Card tips paid later,.*42\.00,42\.00,0\.00,Settled/);
  assert.match(files.get('tips_owed_payments.csv').toString(), /Ben Okoro,.*30\.00,.*Mina Manager/);
  const all = [...files.values()].map((b) => b.toString()).join('\n');
  for (const s of ['secret note', 'Ben private note', 'Split from the 7:30', 'cash_cents', 'tipout_cents']) assert.ok(!all.includes(s), `no ${s}`);
  assert.match(files.get('README.txt').toString(), /never in this export/);
});

test('deleting: a shift goes, what’s owed from it stays; a removed person’s tip records go at the 30-day purge', async () => {
  const before = (await ana.call('/api/tips/owed')).data;
  assert.equal((await ana.call(`/api/tips/shifts/${anaShift}`, { method: 'DELETE' })).status, 200);
  assert.equal((await ana.call(`/api/tips/shifts/${anaShift}`)).status, 404);
  const after2 = (await ana.call('/api/tips/owed')).data;
  assert.equal(after2.settled.length + after2.open.length, before.settled.length + before.open.length, 'owed list unchanged');
  // Ben is removed: the manager view leaves him out straight away (restorable for 30 days)
  assert.equal((await owner.call(`/api/team/${benId}`, { method: 'DELETE' })).status, 200);
  const team = (await mgr.call('/api/tips/team')).data;
  assert.ok(!JSON.stringify(team).includes('Ben Okoro'));
  // 30 days on, the purge (at startup and every 12 hours) takes his records with him; Ana's stay
  let d = db(); d.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - 31 * 864e5).toISOString(), benId); d.close();
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', "const d = await import('./server/db.mjs'); const a = await import('./server/accounts.mjs'); a.purgeDeleted(d.openDb(process.env.TIPS_DB)); process.exit(0);"],
    { cwd: root, encoding: 'utf8', env: { ...process.env, DATA_DIR: dir, TIPS_DB: path.join(dir, 'baldwin.db') } });
  assert.equal(run.status, 0, run.stderr);
  d = db();
  for (const t of ['tip_shifts', 'tip_owed', 'tip_payments']) assert.equal(d.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`).get(benId).n, 0, t);
  assert.ok(d.prepare('SELECT COUNT(*) n FROM tip_owed WHERE user_id = ?').get(anaId).n > 0, 'Ana’s stay');
  d.close();
});

/* ---------------- in a browser ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function browser() {
  const { proc, port, profile } = await startChrome(CHROME, { profilePrefix: 'bt-tips-chrome-' }); // Chrome picks a free debugging port (Nov 26)
  let ws;
  for (let i = 0; i < 100 && !ws; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); if (t) ws = new WebSocket(t.webSocketDebuggerUrl); } catch { /* starting */ } await sleep(200); }
  if (!ws) throw new Error('Chrome did not start');
  if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-For': '10.31.9.9' } });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const size = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 800 ? 844 : 1024, deviceScaleFactor: w < 800 ? 3 : 1, mobile: w < 800 });
  const until = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 100) { const v = await ev(expr); if (v) return v; await sleep(100); } return ev(expr); };
  const shot = async (file, full = false) => {
    let clip;
    if (full) { const h = await ev('Math.ceil(document.documentElement.scrollHeight)'); const w = await ev('innerWidth'); clip = { x: 0, y: 0, width: w, height: Math.min(h, 4000), scale: 1 }; }
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  };
  const close = () => { try { ws.close(); } catch { /* gone */ } proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } };
  return { send, ev, until, size, shot, close, errors };
}
/** The page's checks: contrast on every text in .tip, 44 px targets, Title Case buttons, centred pills, nothing wider than the screen. */
export const CHECK = `(()=>{
  const lum=(c)=>{let m=c.match(/[\\d.]+/g).map(Number);if(/^color\\(srgb/.test(c))m=m.map(v=>v*255);const f=(v)=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])};
  const bg=(el)=>{for(let e=el;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;const a=c.match(/[\\d.]+/g);if(a&&(a.length<4||+a[3]>.9))return c}return 'rgb(255,255,255)'};
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const scope=[...document.querySelectorAll('.tip, .tip-sheet')];
  const low=[];for(const root of scope)for(const el of root.querySelectorAll('*')){if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;const s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none'||!el.getClientRects().length||+s.opacity<1)continue;
    if(el.closest('[disabled],[aria-disabled=true]'))continue;
    const r=ratio(s.color,bg(el));if(r<4.5)low.push(el.textContent.trim().slice(0,40)+' '+r.toFixed(2))}
  const small=[];for(const root of scope)for(const e of root.querySelectorAll('button, a, input, select, textarea, [role=button]')){if(!e.getClientRects().length)continue;const b=e.getBoundingClientRect();if(e.type==='date'&&getComputedStyle(e).opacity==='0')continue;if(b.height<44||(b.width<44&&!e.closest('.tip-inline')))small.push((e.textContent||e.getAttribute('aria-label')||e.name||'').trim().slice(0,30)+' '+Math.round(b.width)+'x'+Math.round(b.height))}
  const buttons=[];for(const root of scope)for(const b of root.querySelectorAll('.tip-btn, .tip-toggles button')){const t=b.textContent.trim();if(t&&b.getClientRects().length)buttons.push(t)}
  const off=[];for(const root of scope)for(const p of root.querySelectorAll('.tip-pill')){const b=p.getBoundingClientRect();const t=[...p.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());if(!t)continue;const rg=document.createRange();rg.selectNodeContents(p);const tb=[...rg.getClientRects()];const ux=Math.min(...tb.map(r=>r.left)),vx=Math.max(...tb.map(r=>r.right)),uy=Math.min(...tb.map(r=>r.top)),vy=Math.max(...tb.map(r=>r.bottom));
    if(Math.abs((ux+vx)/2-(b.left+b.right)/2)>1.5||Math.abs((uy+vy)/2-(b.top+b.bottom)/2)>1.5)off.push(p.textContent.trim())}
  return {title:document.querySelector('h1,h2.tip-sheet-title')?.textContent.trim(),low,small,buttons,off,wide:document.documentElement.scrollWidth>innerWidth+1,text:(document.querySelector('.tip')?.innerText||'')+(document.querySelector('.tip-sheet')?.innerText||'')}})()`;
const titleCase = (s) => s.replace(/[·+−$\d.,:]/g, ' ').trim().split(/\s+/).filter(Boolean).every((w, i) => !/^[a-z]/.test(w) || (i > 0 && ['a', 'an', 'and', 'of', 'the', 'to', 'or', 'at', 'by', 'with', 'h'].includes(w)));
const typeInto = (sel, value) => `(()=>{const i=document.querySelector(${JSON.stringify(sel)});if(!i)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;
const click = (label, scope = 'document') => `(()=>{const b=[...${scope}.querySelectorAll('button, a')].find(x=>x.textContent.trim()===${JSON.stringify(label)}&&x.getClientRects().length);if(!b)return false;b.click();return true})()`;

test('browser: the demo’s Tips, Log a Shift, Owed to You, Mark Settled and Owed to Staff at 390 and 1440', BROWSER, async () => {
  const b = await browser();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const look = async (name, w) => {
    await sleep(250);
    const c = await b.ev(CHECK);
    assert.deepEqual(c.low, [], `${name} @${w}: contrast`); assert.deepEqual(c.small, [], `${name} @${w}: 44 px targets`);
    assert.deepEqual(c.off, [], `${name} @${w}: pills centred`); assert.equal(c.wide, false, `${name} @${w}: nothing wider than the screen`);
    for (const t of c.buttons) assert.ok(titleCase(t), `${name}: "${t}" in Title Case`);
    if (SHOTS) await b.shot(path.join(SHOTS, `${name} · ${w}.png`));
    return c;
  };
  const demo = async (role) => {
    await b.send('Page.navigate', { url: `${BASE}/demo/mise` }); await sleep(800);
    const started = await b.ev(`fetch('/api/demo/start',{method:'POST',headers:{'X-BT':'1','Content-Type':'application/json'},body:JSON.stringify({role:${JSON.stringify(role)},demo:'mise'})}).then(r=>r.status)`);
    assert.equal(started, 200);
    await b.ev(`sessionStorage.setItem('bt-demo-tab','1')`);
  };
  const welcomeOff = async () => { if (await b.until(`!!document.querySelector('.dw-scrim')`, 1500)) { await b.ev(click('Explore on My Own')); await b.until(`!document.querySelector('.dw-scrim')`); } };
  const go = async (u) => { await b.send('Page.navigate', { url: BASE + u }); await sleep(300); await b.until(`!!document.querySelector('.tip h1') && !document.querySelector('.tip .loader')`); await welcomeOff(); await sleep(200); };
  try {
    for (const w of [390, 1440]) {
      await b.size(w);
      await demo('employee');
      await go('/tips');
      let c = await look('1 tips · week', w);
      assert.equal(c.title, 'Tips'); assert.match(c.text, /Only you can see this/); assert.match(c.text, /A personal record, not payroll\./);
      assert.match(c.text, /\$\d/); assert.doesNotMatch(c.text, /tax/i);
      // money is Archivo with tabular figures
      assert.equal(await b.ev(`(()=>{const m=document.querySelector('.tip-money');const s=getComputedStyle(m);return s.fontVariantNumeric.includes('tabular-nums')&&/Archivo/.test(s.fontFamily)})()`), true);
      await b.ev(click('Pay Period')); await b.until(`/every two weeks|Pay period/i.test(document.querySelector('.tip').innerText)`);
      await look('2 tips · pay period', w);
      // Log a Shift: numeric keyboards on the money fields, Save at the bottom
      await b.ev(click('Log a Shift'));
      assert.equal(await b.until(`!!document.querySelector('.tip-sheet')`), true);
      assert.deepEqual(await b.ev(`[...document.querySelectorAll('.tip-sheet input[data-money]')].map(i=>i.inputMode)`), ['decimal', 'decimal', 'decimal', 'decimal'].slice(0, await b.ev(`document.querySelectorAll('.tip-sheet input[data-money]').length`)));
      await b.ev(typeInto('.tip-sheet input[name=cash]', '64')); await b.ev(typeInto('.tip-sheet input[name=card]', '231'));
      await b.ev(typeInto('.tip-sheet input[name=tipout]', '29')); await b.ev(typeInto('.tip-sheet input[name=hours]', '6'));
      await b.ev(`document.querySelector('.tip-sheet [role=switch]').click()`);
      await b.until(`!!document.querySelector('.tip-sheet input[name=owedAmount]')`);
      await b.ev(typeInto('.tip-sheet input[name=owedAmount]', '40'));
      await b.ev(click('Cash tips not paid out', `document.querySelector('.tip-sheet')`));
      assert.match(await b.until(`document.querySelector('.tip-sheet-foot')?.innerText`), /\$266\.00[\s\S]*\+\$40\.00/);
      c = await look('3 log a shift', w);
      if (w < 800) { const save = await b.ev(`(()=>{const r=[...document.querySelectorAll('.tip-sheet button')].find(x=>x.textContent.trim()==='Save Shift').getBoundingClientRect();return r.bottom<=innerHeight&&r.top>innerHeight*.75})()`); assert.equal(save, true, 'Save Shift in thumb reach'); }
      await b.ev(click('Save Shift'));
      assert.equal(await b.until(`!document.querySelector('.tip-sheet')`), true);
      // Owed to You → an item → Mark Settled, part of it
      await go('/tips/owed');
      c = await look('4 owed to you', w); assert.equal(c.title, 'Owed to You'); assert.match(c.text, /\$114\.00/);
      const opened = await b.ev(`(()=>{const r=[...document.querySelectorAll('.tip-owed-row')].find(x=>x.textContent.includes('Card tips paid later')&&x.querySelector('.tip-pill.owed'));if(!r)return false;r.querySelector('a').click();return true})()`);
      assert.equal(opened, true);
      if (w < 800) { await b.until(`/Card tips paid later/.test(document.querySelector('.tip h1')?.textContent||'')`); await b.ev(click('Mark Settled')); }
      else await b.until(`/Card tips paid later/.test(document.querySelector('.tip-detail h2')?.textContent||'')`);
      await b.until(`!!document.querySelector('.tip-settle')`);
      await b.ev(click('Part of It', `document.querySelector('.tip-settle')`));
      await b.until(`!!document.querySelector('.tip-settle input[name=paid]')`);
      await b.ev(typeInto('.tip-settle input[name=paid]', '30'));
      assert.match(await b.until(`document.querySelector('.tip-settle')?.innerText.match(/\\$24\\.00 will still show as owed/)?.[0]`), /\$24\.00/);
      await look('5 mark settled · part', w);
      await b.ev(`document.querySelector('.tip-settle form').requestSubmit()`);
      assert.match(await b.until(`document.querySelector('.tip')?.innerText.match(/Part Settled/)?.[0]`), /Part Settled/);
      await look('6 part settled', w);
      // the manager's Owed to Staff
      await demo('manager');
      await b.send('Page.navigate', { url: BASE + '/admin/owed' }); await sleep(400);
      await b.until(`!!document.querySelector('.tip h1') && /Owed to Staff/.test(document.querySelector('.tip h1').textContent)`); await welcomeOff(); await sleep(200);
      c = await look('7 owed to staff', w);
      assert.match(c.text, /\$181\.00/); assert.match(c.text, /You see owed items only/);
      assert.doesNotMatch(c.text, /Cash tips\s+\$|Card tips\s+\$|Tip-out/, 'no tip totals');
      await b.ev(`[...document.querySelectorAll('.tip-staff-row')].find(x=>x.textContent.includes('Teddy Lam')).querySelector('button').click()`);
      await b.until(`!!document.querySelector('.tip-settle')`);
      await look('8 owed to staff · settle', w);
      await b.ev(`document.querySelector('.tip-settle form').requestSubmit()`);
      assert.match(await b.until(`[...document.querySelectorAll('.tip-staff-row')].find(x=>x.textContent.includes('Teddy Lam')&&x.textContent.includes('by you'))?.textContent`), /by you/);
      assert.equal(await b.ev(`[...document.querySelectorAll('.tip-staff-row')].filter(x=>x.textContent.includes('Teddy Lam')).length`), 1, 'moved to Recently settled');
    }
    assert.deepEqual(b.errors, []);
  } finally { b.close(); }
});
