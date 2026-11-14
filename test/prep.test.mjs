// Prep tracker (Nov 12, server/prep.mjs): who can log and edit, use-by math, "to make" rounding, suggested pars, report
// totals, archive and restore, and that one store never sees another's prep. Plus both demos come with full prep.
// The shift count (Nov 12, 31b): the Used maths, two counts in one day, a missed day, a count higher than expected, Keep vs
// Toss at the count (never auto-waste), the count gating the prep list, and migration 20 on a database with prep rows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { dayOf, addDays, useByFor, toMake, suggestions, parsFor, pct, periodFor, summaryText, canLog, canManage, detroitAt, recompute, ledgerOf, weekdayStats, saveCount, logWaste, report, weeklyDue, postWeekly, setWeekly, weeklySetting, WEEKLY_NOTE } from '../server/prep.mjs';
import { MIGRATIONS } from '../server/db.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-prep-'));
const PORT = 6100 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
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
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@prep.test', SUPERADMIN_EMAIL: 'boss@prep.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

/* ---------------- the math, without a server ---------------- */
test('days are the store’s Detroit date, also across UTC midnight', () => {
  assert.equal(dayOf('2026-11-13T03:30:00Z'), '2026-11-12', '10:30 pm in Detroit is still the 12th');
  assert.equal(dayOf('2026-11-13T05:30:00Z'), '2026-11-13');
  assert.equal(dayOf('2026-07-04T03:59:00Z'), '2026-07-03', 'summer time: UTC−4');
  assert.equal(detroitAt('2026-11-12', 15, 30), '2026-11-12T20:30:00.000Z');
  assert.equal(detroitAt('2026-07-04', 15, 30), '2026-07-04T19:30:00.000Z');
});
test('use-by: made day + shelf days (0 = toss at close the same day; not set = no use-by)', () => {
  assert.equal(useByFor(0, '2026-11-12'), '2026-11-12');
  assert.equal(useByFor(1, '2026-11-12'), '2026-11-13');
  assert.equal(useByFor(7, '2026-11-28'), '2026-12-05', 'across a month');
  assert.equal(useByFor(3, '2026-12-30'), '2027-01-02', 'across a year');
  assert.equal(useByFor(null, '2026-11-12'), null);
});
test('to make: par minus on hand, rounded up to whole batches', () => {
  assert.equal(toMake(3, 0, 1), 3);
  assert.equal(toMake(3, 1.5, 1), 2, '1.5 short → 2 batches of 1 qt');
  assert.equal(toMake(2, 2, 1), 0);
  assert.equal(toMake(2, 2.5, 1), 0, 'over par → nothing');
  assert.equal(toMake(60, 15, 5), 45);
  assert.equal(toMake(40, 12, 5), 30, '28 short → 6 batches of 5');
  assert.equal(toMake(0.5, 0.25, 0.5), 0.5);
});
test('starting pars follow the week (Thursday = base) in clean steps', () => {
  assert.deepEqual(parsFor(3, 'qt', 1), [3, 2, 2, 2.5, 3, 4, 4.5]);
  assert.deepEqual(parsFor(60, 'each', 5), [60, 40, 40, 50, 60, 80, 90]);
});
test('suggested pars: raise when it runs short, lower when it runs long, quiet otherwise', () => {
  const item = { pars: JSON.stringify([3, 2, 2, 2.5, 3, 4, 4.5]), unit: 'qt', batch: 1, kept: null };
  const quiet = { days: 4, used: 1, wasted: 0.1, ranOut: 0 };
  const stats = Array.from({ length: 7 }, () => ({ ...quiet }));
  stats[6] = { days: 4, used: 4.8, wasted: 0.1, ranOut: 1 }; // Saturday ran out → 4.8 × 1.1 = 5.28 → 5.5
  stats[3] = { days: 4, used: 1.2, wasted: 1.1, ranOut: 0 }; // Wednesday tossed 1.1 of a 2.5 par → 1.2 × 1.1 = 1.32 → 1.5
  stats[1] = { days: 1, used: 5, wasted: 0, ranOut: 2 }; // one Monday isn't enough to go on
  stats[0].used = 1.5; stats[0].wasted = 0.4; // Sunday: tossed 0.4 of 3 (13%): under the 20% line
  const s = suggestions(item, stats, '2026-11-12');
  assert.deepEqual(s.map((x) => [x.dow, x.kind, x.from, x.to]), [[3, 'lower', 2.5, 1.5], [6, 'raise', 4.5, 5.5]]);
  assert.match(s[1].text, /Saturdays run short\. You used 4\.8 qt on average and ran out once/);
  // High use without running out still counts (95% of par)
  const s2 = suggestions(item, stats.map((x, i) => (i === 5 ? { days: 3, used: 3.9, wasted: 0, ranOut: 0 } : { days: 0, used: null, wasted: null, ranOut: 0 })), '2026-11-12');
  assert.deepEqual(s2.map((x) => [x.dow, x.to]), [[5, 4.5]]);
  // Keep: a weekday someone kept stays quiet for 14 days
  const kept = { ...item, kept: JSON.stringify({ 6: '2026-11-05' }) };
  assert.ok(!suggestions(kept, stats, '2026-11-12').some((x) => x.dow === 6));
  assert.ok(suggestions(kept, stats, '2026-11-20').some((x) => x.dow === 6), 'back after 14 days');
});
test('who logs and who edits (bartenders, managers and owners log; managers and owners edit)', () => {
  assert.equal(canLog({ role: 'staff', jobs: '["bartender"]' }), true);
  assert.equal(canLog({ role: 'staff', jobs: '["server","bartender"]' }), true);
  for (const j of ['["server"]', '["host"]', '["support"]', null]) assert.equal(canLog({ role: 'staff', jobs: j }), false, j);
  for (const r of ['manager', 'owner', 'superadmin']) { assert.equal(canLog({ role: r }), true); assert.equal(canManage({ role: r }), true); }
  assert.equal(canManage({ role: 'staff', jobs: '["bartender"]' }), false);
});
test('periods: week runs Monday to Sunday against the week before; year against last year', () => {
  const w = periodFor('week', '2026-11-12');
  assert.deepEqual([w.from, w.to, w.prevFrom, w.prevTo, w.label], ['2026-11-09', '2026-11-15', '2026-11-02', '2026-11-08', 'Nov 9–15']);
  const d = periodFor('day', '2026-11-12');
  assert.deepEqual([d.from, d.prevFrom, d.buckets.length, d.buckets[6].key], ['2026-11-12', '2026-11-11', 7, '2026-11-12']);
  const y = periodFor('year', '2026-03-01');
  assert.deepEqual([y.from, y.to, y.prevFrom, y.buckets.length, y.buckets[1].to], ['2026-01-01', '2026-12-31', '2025-01-01', 12, '2026-02-28']);
  assert.equal(pct(1, 4), 20, 'wasted ÷ (used + wasted)'); assert.equal(pct(0, 0), null);
  assert.equal(summaryText({ period: { label: 'Nov 2–8' }, tiles: { liquid: { made: 10, pct: 10, prevPct: 14 }, garnish: { made: 100, pct: 11, prevPct: 11 } }, ranOut: [{ item: 'Lime juice', day: '2026-11-07' }, { item: 'Lime wedges', day: '2026-11-06' }] }),
    'Prep, Nov 2–8: juices and syrups 10% wasted (down from 14%), garnishes 11%, same as before. We ran out 2 times: lime juice on Saturday and lime wedges on Friday.');
});

/* ---------------- the shift count, on its own database ---------------- */
function memDb() {
  const db = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) db.exec(m);
  db.exec("INSERT INTO users(id, company_id, name, role, email) VALUES (1001, 1, 'Cam Counter', 'manager', 'cam@prep.test')");
  return db;
}
const storeRow = { id: 1, company_id: 1, name: 'The Baldwin', slug: 'the-baldwin' };
const X = { company: 1, store: 1, storeRow };
function addItem(db, name, { unit = 'qt', batch = 1, shelf = 0, kind = 'juice' } = {}) {
  return Number(db.prepare(`INSERT INTO prep_items(company_id, store_id, name, kind, unit, batch, pars, shelf_days, sort) VALUES (1,1,?,?,?,?,?,?,0)`)
    .run(name, kind, unit, batch, JSON.stringify([3, 3, 3, 3, 3, 3, 3]), shelf).lastInsertRowid);
}
const addCount = (db, item, day, amount, h = 15, m = 0, extra = {}) => Number(db.prepare('INSERT INTO prep_counts(company_id, store_id, item_id, day, amount, at, by_user, tossed, kept) VALUES (1,1,?,?,?,?,1001,?,?)')
  .run(item, day, amount, detroitAt(day, h, m), extra.tossed || 0, extra.kept ? 1 : 0).lastInsertRowid);
const addBatch = (db, item, day, amount, useBy = day, h = 15, m = 30) => Number(db.prepare('INSERT INTO prep_batches(company_id, store_id, item_id, amount, remaining, day, made_at, use_by, made_by, by_user) VALUES (1,1,?,?,?,?,?,?,1001,1001)')
  .run(item, amount, amount, day, detroitAt(day, h, m), useBy).lastInsertRowid);
const addWaste = (db, item, at, amount, reason = 'spilled', batch = null) => db.prepare("INSERT INTO prep_events(company_id, store_id, item_id, batch_id, kind, amount, reason, day, at, by_user) VALUES (1,1,?,?,'waste',?,?,?,?,1001)")
  .run(item, batch, amount, reason, dayOf(at), at);
const rowOn = (rows, day) => rows.find((r) => r.day === day);

test('the Used maths: walked in with + prepped − wasted − the next count; mid-shift waste is waste, never Used', () => {
  const db = memDb();
  const lime = addItem(db, 'Lime juice');
  // Tommy's example (Figma 672:997): Wed walked in with 1 qt + prepped 2.5 = 3.5. Thu count 1.5, no waste → Used Wed = 2.
  addCount(db, lime, '2026-11-04', 1); addBatch(db, lime, '2026-11-04', 2.5);
  addCount(db, lime, '2026-11-05', 1.5); addBatch(db, lime, '2026-11-05', 2);
  // Thu: a 0.5 qt spill mid-shift. Fri count 1 → Used Thu = 3.5 − 0.5 − 1 = 2 (the spill is waste, not used).
  addWaste(db, lime, detroitAt('2026-11-05', 19, 10), 0.5);
  addCount(db, lime, '2026-11-06', 1);
  recompute(db, lime);
  const rows = ledgerOf(db, lime);
  const wed = rowOn(rows, '2026-11-04'), thu = rowOn(rows, '2026-11-05'), fri = rowOn(rows, '2026-11-06');
  assert.deepEqual([wed.walkedIn, wed.prepped, wed.starting, wed.wasted, wed.used], [1, 2.5, 3.5, 0, 2]);
  assert.deepEqual([thu.walkedIn, thu.prepped, thu.starting, thu.wasted, thu.used], [1.5, 2, 3.5, 0.5, 2]);
  assert.deepEqual(thu.waste, [{ reason: 'spilled', amount: 0.5 }]);
  assert.equal(fri.pending, true, 'the newest shift waits for the next count');
  assert.equal(fri.used, null);
  // Today's par 3 − walked in with 1.5 → 2 batches of 1 qt (Thursday in the note)
  assert.equal(toMake(3, 1.5, 1), 2);
  // Stored on the rows, so reports read them
  const stored = db.prepare('SELECT day, used, wasted, prepped, shifts FROM prep_counts WHERE item_id = ? ORDER BY day').all(lime).map((r) => ({ ...r }));
  assert.deepEqual(stored[0], { day: '2026-11-04', used: 2, wasted: 0, prepped: 2.5, shifts: 1 });
});

test('a missed day: Used spans the gap in one row, and weekday averages skip it', () => {
  const db = memDb();
  const lime = addItem(db, 'Lime juice');
  addCount(db, lime, '2026-11-06', 1); addBatch(db, lime, '2026-11-06', 2);
  addBatch(db, lime, '2026-11-07', 1); // Saturday: nobody counted, someone still made a batch
  addCount(db, lime, '2026-11-08', 0.5);
  addCount(db, lime, '2026-11-09', 0.25);
  addCount(db, lime, '2026-11-10', 0);
  recompute(db, lime);
  const rows = ledgerOf(db, lime);
  const fri = rowOn(rows, '2026-11-06');
  assert.deepEqual([fri.shifts, fri.lastDay, fri.prepped, fri.starting, fri.used], [2, '2026-11-07', 3, 4, 3.5], 'Fri–Sat · 2 shifts: 1 + 2 + 1 − 0.5');
  assert.equal(rowOn(rows, '2026-11-08').used, 0.25);
  const stats = weekdayStats(db, lime, '2026-11-12');
  assert.equal(stats[5].days, 0, 'Friday skipped: its shift ran into Saturday');
  assert.equal(stats[6].days, 0, 'Saturday: no count');
  assert.deepEqual([stats[0].days, stats[0].used], [1, 0.25], 'Sunday counts');
});

test('a count higher than expected: Check this, Used shows — (never negative); a missed batch or Keep settles it', () => {
  const db = memDb();
  const rosemary = addItem(db, 'Rosemary sprigs', { unit: 'each', batch: 1, shelf: 2, kind: 'garnish' });
  addCount(db, rosemary, '2026-11-04', 2); addBatch(db, rosemary, '2026-11-04', 10, '2026-11-06');
  addCount(db, rosemary, '2026-11-05', 14); // 14 > 12 it could have
  recompute(db, rosemary);
  let rows = ledgerOf(db, rosemary);
  const wed = rowOn(rows, '2026-11-04');
  assert.equal(wed.used, null, 'never a negative Used');
  assert.equal(wed.check, true);
  assert.equal(wed.expectedNext, 12);
  assert.equal(db.prepare('SELECT high FROM prep_counts WHERE item_id = ? AND day = ?').get(rosemary, '2026-11-05').high, 1);
  // Log the batch nobody logged (6 more on Wednesday) → 2 + 16 − 14 = 4 used, no flag
  addBatch(db, rosemary, '2026-11-04', 6, '2026-11-06', 16);
  recompute(db, rosemary, '2026-11-04');
  rows = ledgerOf(db, rosemary);
  assert.deepEqual([rowOn(rows, '2026-11-04').used, rowOn(rows, '2026-11-04').check], [4, false]);
  // Keep the count instead: stays "—", marked kept (Reports lists it)
  const db2 = memDb();
  const r2 = addItem(db2, 'Rosemary sprigs', { unit: 'each', batch: 1, shelf: 2, kind: 'garnish' });
  addCount(db2, r2, '2026-11-04', 2); addBatch(db2, r2, '2026-11-04', 10, '2026-11-06');
  addCount(db2, r2, '2026-11-05', 14, 15, 0, { kept: true });
  recompute(db2, r2);
  const row = rowOn(ledgerOf(db2, r2), '2026-11-04');
  assert.deepEqual([row.used, row.check, row.kept], [null, false, true]);
  const rep = report(db2, storeRow, { range: 'week', at: '2026-11-04', series: String(r2) });
  assert.deepEqual(rep.kept.map((k) => [k.item, k.amount, k.expected, k.kept]), [['Rosemary sprigs', 14, 12, true]]);
});

test('two counts in one day: the latest wins, the earlier stays in the history', () => {
  const db = memDb();
  const lime = addItem(db, 'Lime juice');
  addCount(db, lime, '2026-11-04', 1); addBatch(db, lime, '2026-11-04', 2.5);
  const first = addCount(db, lime, '2026-11-05', 2, 15, 0);
  db.prepare('UPDATE prep_counts SET replaced_at = ? WHERE id = ?').run(detroitAt('2026-11-05', 15, 10), first);
  addCount(db, lime, '2026-11-05', 1.5, 15, 10);
  recompute(db, lime);
  const rows = ledgerOf(db, lime);
  assert.equal(rows.length, 2, 'one row per day');
  assert.equal(rowOn(rows, '2026-11-04').used, 2, '3.5 − 1.5 (the latest), not 3.5 − 2');
  assert.deepEqual(rowOn(rows, '2026-11-05').recounts.map((r) => r.amount), [2]);
  assert.equal(rowOn(rows, '2026-11-05').walkedIn, 1.5);
});

test('past its use-by at the count: Keep counts it, Toss logs Expired waste; no choice = kept, never auto-waste', () => {
  const db = memDb();
  const y = addDays(dayOf(), -1);
  const lemon = addItem(db, 'Lemon juice'), lime = addItem(db, 'Lime juice'), grape = addItem(db, 'Grapefruit juice');
  for (const it of [lemon, lime, grape]) { addCount(db, it, y, 0, 14); addBatch(db, it, y, 2, y, 14, 30); }
  recompute(db, lemon); recompute(db, lime); recompute(db, grape);
  // Lemon: 0.5 on the shelf, Toss → 0 walked in, 0.5 Expired waste. Lime: 0.5, Keep. Grapefruit: 0.5, no choice.
  saveCount(db, X, { id: 1001 }, { items: [{ itemId: lemon, amount: 0, toss: 0.5 }, { itemId: lime, amount: 0.5 }, { itemId: grape, amount: 0.5 }] });
  const waste = db.prepare("SELECT item_id, amount, reason, at FROM prep_events WHERE kind = 'waste'").all();
  assert.equal(waste.length, 1, 'only the one they tossed');
  assert.deepEqual([waste[0].item_id, waste[0].amount, waste[0].reason], [lemon, 0.5, 'expired']);
  const lemonRows = ledgerOf(db, lemon);
  assert.deepEqual([lemonRows[0].walkedIn, lemonRows[0].tossed], [0, 0.5]);
  assert.deepEqual([rowOn(lemonRows, y).wasted, rowOn(lemonRows, y).used], [0.5, 1.5], 'tossed at the count is yesterday’s waste: 2 − 0.5 − 0 = 1.5 used');
  for (const it of [lime, grape]) {
    const r = ledgerOf(db, it);
    assert.deepEqual([r[0].walkedIn, rowOn(r, y).wasted, rowOn(r, y).used], [0.5, 0, 1.5], 'kept: it counts as walked in with');
    assert.equal(db.prepare('SELECT remaining FROM prep_batches WHERE item_id = ?').get(it).remaining, 0.5, 'the batch keeps what was counted');
  }
  // Can't toss more than what's past its use-by
  assert.throws(() => saveCount(db, X, { id: 1001 }, { items: [{ itemId: lime, amount: 0, toss: 5 }] }), /past its use-by/);
  // Waste logged mid-shift comes off this shift as waste
  const b = db.prepare('SELECT id FROM prep_batches WHERE item_id = ?').get(lime).id;
  logWaste(db, X, { id: 1001 }, { batchId: b, amount: 0.25, reason: 'spilled' });
  assert.equal(ledgerOf(db, lime)[0].wasted, 0.25);
});

test('reports read counted Used: waste % = wasted ÷ (used + wasted); a missed day stays one shift', () => {
  const db = memDb();
  const lime = addItem(db, 'Lime juice');
  addCount(db, lime, '2026-11-04', 1); addBatch(db, lime, '2026-11-04', 2.5);
  addCount(db, lime, '2026-11-05', 1.5); addBatch(db, lime, '2026-11-05', 2);
  addWaste(db, lime, detroitAt('2026-11-05', 19, 10), 0.5);
  addCount(db, lime, '2026-11-06', 1);
  recompute(db, lime);
  const r = report(db, storeRow, { range: 'week', at: '2026-11-04', series: String(lime) });
  const row = r.rows.find((x) => x.id === lime);
  assert.deepEqual([row.made, row.used, row.wasted, row.wastePct, row.batches, row.pending], [4.5, 4, 0.5, 11, 2, 1]);
  assert.deepEqual([r.tiles.liquid.used, r.tiles.liquid.wasted, r.tiles.liquid.pct], [4, 0.5, 11]);
  const wed = r.chart.find((b) => b.key === '2026-11-04'), thu = r.chart.find((b) => b.key === '2026-11-05');
  assert.deepEqual([wed.made, wed.used, wed.wasted, thu.used, thu.wasted], [2.5, 2, 0, 2, 0.5]);
});

/* ---------------- the Monday post to #Bar (Nov 14) ---------------- */
test('the weekly post is due Monday from 9 am Detroit time (and Tuesday, to catch up), for last week', () => {
  assert.equal(weeklyDue(detroitAt('2026-11-16', 8, 59)), null, 'Monday before 9');
  assert.equal(weeklyDue(detroitAt('2026-11-16', 9, 0)), '2026-11-09', 'Monday 9 am: the week of Nov 9–15');
  assert.equal(weeklyDue(detroitAt('2026-11-17', 23, 0)), '2026-11-09', 'Tuesday catches up');
  assert.equal(weeklyDue(detroitAt('2026-11-18', 9, 0)), null, 'Wednesday: too late, wait for next Monday');
  assert.equal(weeklyDue(detroitAt('2026-11-15', 23, 0)), null, 'Sunday');
  assert.equal(weeklyDue('2026-11-16T13:30:00Z'), null, '8:30 am in Detroit is 13:30 UTC');
});

function weeklyDb() {
  const db = memDb();
  db.exec('ALTER TABLE companies ADD COLUMN demo INT NOT NULL DEFAULT 0');
  db.exec("INSERT INTO users(id, company_id, name, role, email, jobs, store_id) VALUES (1002, 1, 'Bea Bar', 'staff', 'bea@prep.test', '[\"bartender\"]', 1)");
  const lime = addItem(db, 'Lime juice');
  addCount(db, lime, '2026-11-10', 1); addBatch(db, lime, '2026-11-10', 2);
  addCount(db, lime, '2026-11-11', 1); addBatch(db, lime, '2026-11-11', 2);
  addCount(db, lime, '2026-11-12', 1.5);
  recompute(db, lime);
  return db;
}
const barMessages = (db) => db.prepare("SELECT m.* FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE r.store_id = 1 AND r.key = 'bar' ORDER BY m.id").all();

test('Monday: last week’s summary goes to #Bar once, the same words and card as Send Now; never twice after a restart', () => {
  const db = weeklyDb();
  const monday = detroitAt('2026-11-16', 9, 5);
  const out = postWeekly(db, monday);
  assert.deepEqual(out.map((o) => [o.store, o.week, !!o.id]), [[1, '2026-11-09', true]], 'only the store that keeps prep');
  const msgs = barMessages(db);
  assert.equal(msgs.length, 1);
  const r = report(db, storeRow, { range: 'week', at: '2026-11-09' });
  assert.equal(msgs[0].body, `${r.summary}\n${WEEKLY_NOTE}`);
  assert.match(r.summary, /^Prep, Nov 9–15: juices and syrups/);
  const card = JSON.parse(msgs[0].page);
  assert.equal(card.slug, 'prep/reports?range=week&at=2026-11-09'); assert.equal(card.kind, 'Prep report');
  assert.equal(msgs[0].user_id, 1001, 'from the store’s manager');
  // Another tick, a "restart" (a new pass on the same database), and Tuesday: nothing more
  assert.deepEqual(postWeekly(db, detroitAt('2026-11-16', 9, 20)), []);
  assert.deepEqual(postWeekly(db, detroitAt('2026-11-17', 10, 0)), []);
  assert.equal(barMessages(db).length, 1);
  assert.equal(weeklySetting(db, storeRow).lastWeek, '2026-11-09');
  // The next Monday posts the next week
  const lime = db.prepare('SELECT id FROM prep_items').get().id;
  addCount(db, lime, '2026-11-17', 1); addBatch(db, lime, '2026-11-17', 2); recompute(db, lime);
  assert.equal(postWeekly(db, detroitAt('2026-11-23', 9, 0)).filter((o) => o.id).length, 1);
  assert.equal(barMessages(db).length, 2);
});

test('the weekly post: a manager turns it off (and back on); demo companies and stores with nothing logged never get it', () => {
  const db = weeklyDb();
  const u = { id: 1001 };
  assert.equal(weeklySetting(db, storeRow).on, true, 'on by default');
  assert.equal(setWeekly(db, X, u, false).on, false);
  assert.deepEqual(postWeekly(db, detroitAt('2026-11-16', 9, 0)), []);
  assert.equal(barMessages(db).length, 0, 'off: nothing posted');
  assert.equal(setWeekly(db, X, u, true).on, true);
  assert.equal(postWeekly(db, detroitAt('2026-11-16', 10, 0)).length, 1, 'back on: posts');
  // A demo company: never
  const demo = weeklyDb();
  demo.exec('UPDATE companies SET demo = 1 WHERE id = 1');
  assert.deepEqual(postWeekly(demo, detroitAt('2026-11-16', 9, 0)), []);
  assert.equal(barMessages(demo).length, 0);
  // Nothing logged that week: no post, and the week is done (no hourly re-check)
  const quiet = weeklyDb();
  const r = postWeekly(quiet, detroitAt('2026-11-23', 9, 0));
  assert.deepEqual(r.map((o) => o.skipped), ['nothing logged']);
  assert.equal(barMessages(quiet).length, 0);
  assert.deepEqual(postWeekly(quiet, detroitAt('2026-11-23', 10, 0)), []);
  assert.equal(weeklySetting(quiet, storeRow).lastWeek, null, 'Reports doesn’t say it was sent');
});

test('migration 20 runs on a database that already has migration 19 prep rows', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-mig-'));
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { MIGRATIONS, openDb } from ${JSON.stringify(path.join(root, 'server/db.mjs'))};
    const file = process.env.DATA_DIR + '/baldwin.db';
    const old = new DatabaseSync(file);
    for (let i = 0; i < 19; i++) old.exec(MIGRATIONS[i]);
    old.exec('PRAGMA user_version = 19');
    old.exec("INSERT INTO prep_items(id, company_id, store_id, name, kind, unit, batch, pars) VALUES (1, 1, 1, 'Lime juice', 'juice', 'qt', 1, '[3,3,3,3,3,3,3]')");
    old.exec("INSERT INTO prep_batches(company_id, store_id, item_id, amount, remaining, day, made_at, use_by) VALUES (1, 1, 1, 3, 2, '2026-11-12', '2026-11-12T20:00:00Z', '2026-11-12')");
    old.exec("INSERT INTO prep_events(company_id, store_id, item_id, batch_id, kind, amount, day, at) VALUES (1, 1, 1, 1, 'used', 1, '2026-11-12', '2026-11-12T22:00:00Z')");
    old.close();
    const db = openDb(file);
    const v = db.prepare('PRAGMA user_version').get().user_version;
    const cols = db.prepare('PRAGMA table_info(prep_counts)').all().map((c) => c.name);
    const n = ['prep_items', 'prep_batches', 'prep_events'].map((t) => db.prepare('SELECT COUNT(*) n FROM ' + t).get().n);
    console.log(JSON.stringify({ v, cols, n }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, DATA_DIR: tmp }, encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.v, MIGRATIONS.length);
  assert.ok(['amount', 'tossed', 'kept', 'used', 'expected', 'high', 'shifts'].every((c) => out.cols.includes(c)));
  assert.deepEqual(out.n, [1, 1, 1], 'the prep rows from before are untouched');
});

/* ---------------- through the API ---------------- */
const owner = person(), manager = person(), server_ = person(), bar = person(), testaGm = person();
let stores = [], items = [];
const today = () => dayOf();

test('setup: owner, a manager, a server and a bartender at The Baldwin, a manager at Testa Barra', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Olive Owner', email: 'owner@prep.test', password: 'long-enough-1' } })).status, 200);
  const code = (await owner('/api/team')).data.company.joinCode;
  stores = (await person()(`/api/join/${code}`)).data.stores;
  const inv = await owner('/api/team/invite', { method: 'POST', body: { email: 'max@prep.test', role: 'manager', storeId: stores[0].id } });
  assert.equal((await manager(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Max Manager', password: 'long-enough-2' } })).status, 200);
  assert.equal((await server_('/api/join', { method: 'POST', body: { code, name: 'Sera Server', pin: '4321', storeId: stores[0].id } })).status, 200);
  assert.equal((await server_('/api/path/jobs', { method: 'POST', body: { jobs: ['server'] } })).status, 200);
  assert.equal((await bar('/api/join', { method: 'POST', body: { code, name: 'Bo Bartender', pin: '8765', storeId: stores[0].id } })).status, 200);
  assert.equal((await bar('/api/path/jobs', { method: 'POST', body: { jobs: ['bartender'] } })).status, 200);
  const inv2 = await owner('/api/team/invite', { method: 'POST', body: { email: 'tia@prep.test', role: 'manager', storeId: stores[2].id } });
  assert.equal((await testaGm(`/api/invite/${inv2.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Tia Testa', password: 'long-enough-3' } })).status, 200);
});

test('The Baldwin starts with its 12 items from its house specs, with Level 3 shelf lives where the lessons give one', async () => {
  const r = await manager('/api/prep');
  assert.equal(r.status, 200);
  items = r.data.items;
  assert.deepEqual(items.map((i) => i.name), ['Lime juice', 'Lemon juice', 'Grapefruit juice', 'Demerara syrup', 'Simple syrup', 'Ginger honey syrup', 'Spiced hibiscus syrup', 'Orange oleo saccharum', 'Orange twists', 'Lemon twists', 'Lime wedges', 'Rosemary sprigs']);
  assert.deepEqual(r.data.can, { log: true, edit: true });
  const lime = (await manager(`/api/prep/items/${items[0].id}`)).data;
  assert.equal(lime.shelf.days, 0);
  assert.equal(lime.shelf.confirmed, true);
  assert.match(lime.shelf.source, /Level 3 · Water, ice and citrus.*Dave Arnold/);
  assert.equal(lime.shelf.lesson, '/cocktail-program/level-3/bar-dilution');
  assert.ok(lime.drinks.length >= 10 && lime.drinks.every((d) => d.slug.startsWith('signature/')), 'the house drinks that list lime juice');
  const simple = (await manager(`/api/prep/items/${items[4].id}`)).data;
  assert.equal(simple.shelf.confirmed, false, 'no lesson number for syrups: house standard, to confirm');
  assert.equal(simple.recipe.ratio, '1:1');
});

test('permissions: a server reads Today and the count page but can’t count or log; staff can’t edit; a bartender counts', async () => {
  const s = await server_('/api/prep');
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.can, { log: false, edit: false });
  assert.equal(s.data.counted, null, 'nobody has counted yet');
  assert.equal((await server_('/api/prep/count')).data.can.log, false);
  assert.equal((await server_('/api/prep/count', { method: 'POST', body: { items: [{ itemId: items[0].id, amount: 1 }] } })).status, 403, 'only the people who log can count');
  assert.equal((await server_('/api/prep/batches', { method: 'POST', body: { itemId: items[0].id, amount: 3 } })).status, 403);
  assert.equal((await server_(`/api/prep/items/${items[0].id}/ranout`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await server_('/api/prep/report')).status, 403, 'reports are for managers');
  const b = await bar('/api/prep');
  assert.deepEqual(b.data.can, { log: true, edit: false });
  assert.equal((await bar(`/api/prep/items/${items[0].id}`, { method: 'PATCH', body: { pars: [9, 9, 9, 9, 9, 9, 9] } })).status, 403, 'staff can’t edit pars');
  assert.equal((await bar(`/api/prep/items/${items[0].id}/suggestion`, { method: 'POST', body: { dow: 1, action: 'accept', to: 9 } })).status, 403);
  assert.equal((await bar('/api/prep/items', { method: 'POST', body: { name: 'X', kind: 'juice', unit: 'qt', batch: 1 } })).status, 403);
  assert.equal((await bar(`/api/prep/items/${items[0].id}/archive`, { method: 'POST' })).status, 403);
  // Used Up is gone: Used comes from the count
  assert.equal((await bar('/api/prep/batches/1/used', { method: 'POST' })).status, 404);
});

let limeBatch;
test('the count gates the prep list: no batch today until someone counts; then walked in with + prepped = starting with', async () => {
  const lime = items[0];
  const r0 = await bar('/api/prep/batches', { method: 'POST', body: { itemId: lime.id, amount: 3 } });
  assert.equal(r0.status, 409, 'count first');
  assert.match(r0.data.error, /Count first/);
  // Bad counts are refused
  assert.equal((await bar('/api/prep/count', { method: 'POST', body: { items: [] } })).status, 400);
  assert.equal((await bar('/api/prep/count', { method: 'POST', body: { items: [{ itemId: lime.id, amount: -1 }] } })).status, 400);
  assert.equal((await bar('/api/prep/count', { method: 'POST', body: { items: [{ itemId: lime.id, amount: 1 }, { itemId: lime.id, amount: 2 }] } })).status, 400, 'twice');
  assert.equal((await bar('/api/prep/count', { method: 'POST', body: { items: [{ itemId: lime.id, amount: 1, toss: 1 }] } })).status, 400, 'nothing is past its use-by');
  const c = await bar('/api/prep/count', { method: 'POST', body: { items: items.map((i) => ({ itemId: i.id, amount: i.kind === 'garnish' ? 10 : 0.5 })) } });
  assert.equal(c.status, 200);
  assert.equal(c.data.counted.n, 12);
  assert.equal(c.data.counted.by.name, 'Bo Bartender');
  const row = c.data.items.find((i) => i.id === lime.id);
  assert.deepEqual([row.walkedIn, row.prepped, row.starting, row.status], [0.5, 0, 0.5, 'make']);
  assert.equal(row.toMake, toMake(row.par, 0.5, 1), 'par − walked in with, in whole batches');
  assert.equal(row.lastUsed, null, 'first count: no Used yet');
  const sheet = (await bar('/api/prep/count')).data;
  assert.equal(sheet.items.find((i) => i.id === lime.id).today.amount, 0.5);
  // Now batches log
  const r = await bar('/api/prep/batches', { method: 'POST', body: { itemId: lime.id, amount: 3 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.useBy, today(), 'lime juice keeps 1 shift');
  limeBatch = r.data.id;
  const after = (await bar('/api/prep')).data.items.find((i) => i.id === lime.id);
  assert.deepEqual([after.walkedIn, after.prepped, after.starting], [0.5, 3, 3.5]);
  assert.equal(after.made.by.name, 'Bo Bartender');
  // A recount today: the latest wins, the earlier stays in the history
  assert.equal((await bar('/api/prep/count', { method: 'POST', body: { items: [{ itemId: lime.id, amount: 1 }] } })).status, 200);
  const d = (await manager(`/api/prep/items/${lime.id}`)).data;
  assert.equal(d.ledger.length, 1);
  assert.deepEqual([d.ledger[0].walkedIn, d.ledger[0].prepped, d.ledger[0].starting, d.ledger[0].pending], [1, 3, 4, true]);
  assert.deepEqual(d.ledger[0].recounts.map((x) => x.amount), [0.5]);
  assert.equal(d.counted.walkedIn, 1);
  // Shelf life change by a manager: new batches get the new use-by
  const syrup = items[3];
  assert.equal((await manager(`/api/prep/items/${syrup.id}`, { method: 'PATCH', body: { shelfDays: 3 } })).status, 200);
  const b2 = await bar('/api/prep/batches', { method: 'POST', body: { itemId: syrup.id, amount: 2 } });
  assert.equal(b2.data.useBy, addDays(today(), 3));
  assert.match((await manager(`/api/prep/items/${syrup.id}`)).data.shelf.source, /^Set by Max Manager/);
  // Waste: more than what's left is refused; Other needs a note; a spill is waste on this shift, never Used
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 5, reason: 'spilled' } })).status, 400);
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.5, reason: 'other' } })).status, 400, 'Other needs a note');
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.5, reason: 'spilled' } })).status, 200);
  const d2 = (await manager(`/api/prep/items/${lime.id}`)).data;
  assert.deepEqual([d2.ledger[0].wasted, d2.ledger[0].used], [0.5, null]);
  assert.deepEqual(d2.ledger[0].waste, [{ reason: 'spilled', amount: 0.5 }]);
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.5, reason: 'expired' } })).status, 200, 'Expired clears the batch');
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.1, reason: 'spilled' } })).status, 409, 'cleared');
  const ev = (await manager(`/api/prep/items/${lime.id}`)).data;
  assert.ok(!ev.batches.some((b) => b.id === limeBatch), 'no longer open');
  assert.equal((await bar(`/api/prep/items/${lime.id}/ranout`, { method: 'POST', body: { note: 'busy bar' } })).status, 200);
});

test('report today: made from batches, waste from the shift, Used pending until the next count', async () => {
  const r = await manager(`/api/prep/report?range=day&series=${items[0].id}`);
  assert.equal(r.status, 200);
  const lime = r.data.rows.find((x) => x.id === items[0].id);
  assert.deepEqual([lime.made, lime.used, lime.wasted, lime.pending, lime.ranOut], [3, 0, 1, 1, 1]);
  assert.equal(r.data.tiles.batches.count, 2);
  assert.equal(r.data.tiles.ranOut.count, 1);
  assert.equal(r.data.lastYear, false, 'no year of logs yet');
  assert.deepEqual(r.data.kept, []);
  assert.match(r.data.summary, /We ran out once: lime juice on/);
  const w = await manager(`/api/prep/report?range=week&at=${today()}`);
  assert.equal(w.data.rows.find((x) => x.id === items[0].id).made, 3);
});

test('Send to Team Chat posts the summary to #Bar as a card that opens the report', async () => {
  const r = await manager('/api/prep/report/send', { method: 'POST', body: { range: 'day', at: today(), body: 'Prep today: see the report.' } });
  assert.equal(r.status, 200);
  const room = (await bar('/api/chat/room/bar')).data;
  const msg = room.messages[room.messages.length - 1];
  assert.equal(msg.body, 'Prep today: see the report.');
  assert.equal(msg.page.kind, 'Prep report');
  assert.match(msg.page.slug, /^prep\/reports\?range=day&at=\d{4}-\d{2}-\d{2}$/);
  assert.equal((await bar('/api/prep/report/send', { method: 'POST', body: { range: 'day' } })).status, 403, 'managers send it');
  const card = await bar(`/api/chat/card?page=${encodeURIComponent('prep/item/' + items[0].id)}`);
  assert.equal(card.data.card.title, 'Lime juice');
});

test('Reports carries the Monday post setting; managers turn it off, staff can’t', async () => {
  const r = await manager('/api/prep/report?range=week');
  assert.deepEqual([r.data.weekly.on, r.data.weekly.hour], [true, 9]);
  assert.equal((await bar('/api/prep/weekly', { method: 'PUT', body: { on: false } })).status, 403, 'managers only');
  const off = await manager('/api/prep/weekly', { method: 'PUT', body: { on: false } });
  assert.equal(off.status, 200); assert.equal(off.data.on, false);
  assert.equal((await manager('/api/prep/report?range=week')).data.weekly.on, false);
  assert.equal((await testaGm('/api/prep/report?range=week')).data.weekly.on, true, 'per store');
  assert.equal((await manager('/api/prep/weekly', { method: 'PUT', body: { on: true } })).data.on, true);
});

test('suggestions are only applied when a manager accepts one', async () => {
  const id = items[1].id;
  const before = (await manager(`/api/prep/items/${id}`)).data.pars;
  assert.equal((await manager(`/api/prep/items/${id}/suggestion`, { method: 'POST', body: { dow: 6, action: 'accept', to: 3.5 } })).status, 200);
  const after = (await manager(`/api/prep/items/${id}`)).data.pars;
  assert.equal(after[6], 3.5);
  assert.deepEqual(after.slice(0, 6), before.slice(0, 6));
  assert.equal((await manager(`/api/prep/items/${id}/suggestion`, { method: 'POST', body: { dow: 6, action: 'keep' } })).status, 200);
});

test('archive and restore: off Today, on Archived as “Prep items”, back on Restore; nothing deleted', async () => {
  const id = items[11].id;
  assert.equal((await manager(`/api/prep/items/${id}/archive`, { method: 'POST' })).status, 200);
  assert.ok(!(await bar('/api/prep')).data.items.some((i) => i.id === id));
  const arc = (await manager('/api/archived')).data.groups;
  const g = arc.find((x) => x.id === 'prep');
  assert.equal(g.label, 'Prep items');
  assert.deepEqual(g.items.map((i) => i.name), ['Rosemary sprigs']);
  assert.equal(g.items[0].by, 'Max Manager');
  assert.ok(arc.findIndex((x) => x.id === 'prep') === arc.findIndex((x) => x.id === 'media') - 1, 'before Videos and Photos');
  assert.equal((await bar('/api/prep/batches', { method: 'POST', body: { itemId: id, amount: 5 } })).status, 409, 'can’t log against an archived item');
  assert.equal((await manager(`/api/prep/items/${id}/restore`, { method: 'POST' })).status, 200);
  assert.ok((await bar('/api/prep')).data.items.some((i) => i.id === id));
  // Restore All
  await manager(`/api/prep/items/${id}/archive`, { method: 'POST' });
  await manager(`/api/prep/items/${items[10].id}/archive`, { method: 'POST' });
  assert.equal((await manager('/api/archived/restore', { method: 'POST', body: { group: 'prep' } })).data.restored, 2);
  assert.equal((await manager('/api/prep')).data.items.length, 12);
});

test('a manager adds an item; names are unique on the list', async () => {
  const r = await manager('/api/prep/items', { method: 'POST', body: { name: 'Cucumber juice', kind: 'juice', unit: 'qt', batch: 1, pars: [1, 1, 1, 1, 1, 1, 1], shelfDays: 0 } });
  assert.equal(r.status, 200);
  assert.equal((await manager('/api/prep/items', { method: 'POST', body: { name: 'cucumber JUICE', kind: 'juice', unit: 'qt', batch: 1 } })).status, 409);
  assert.equal((await manager('/api/prep/items', { method: 'POST', body: { name: 'Bad', kind: 'juice', unit: 'liters', batch: 1 } })).status, 400, 'one of the units');
  assert.equal((await manager(`/api/prep/items/${r.data.id}`)).data.unit, 'qt');
});

test('store isolation: Testa Barra has its own list and can’t reach The Baldwin’s items, counts or batches', async () => {
  const t = await testaGm('/api/prep');
  assert.equal(t.status, 200);
  assert.ok(!t.data.items.some((i) => items.some((b) => b.id === i.id)), 'none of The Baldwin’s items');
  assert.equal(t.data.counted, null, 'The Baldwin’s count isn’t Testa Barra’s');
  const sheet = (await testaGm('/api/prep/count')).data;
  assert.ok(!sheet.items.some((i) => items.some((b) => b.id === i.id)));
  assert.equal((await testaGm('/api/prep/count', { method: 'POST', body: { items: [{ itemId: items[0].id, amount: 9 }] } })).status, 404, 'can’t count another store’s item');
  assert.equal((await manager(`/api/prep/items/${items[0].id}`)).data.counted.walkedIn, 1, 'unchanged');
  assert.equal((await testaGm(`/api/prep/items/${items[0].id}`)).status, 404);
  assert.equal((await testaGm(`/api/prep/items/${items[0].id}`, { method: 'PATCH', body: { pars: [1, 1, 1, 1, 1, 1, 1] } })).status, 404);
  assert.equal((await testaGm('/api/prep/batches', { method: 'POST', body: { itemId: items[0].id, amount: 1 } })).status, 404);
  assert.equal((await testaGm('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.1, reason: 'spilled' } })).status, 404);
  assert.equal((await testaGm(`/api/prep/items/${items[0].id}/archive`, { method: 'POST' })).status, 404);
  const rep = (await testaGm('/api/prep/report?range=day')).data;
  assert.equal(rep.tiles.batches.count, 0, 'none of The Baldwin’s batches in its report');
  assert.ok(!(await testaGm('/api/archived')).data.groups.find((g) => g.id === 'prep').items.length);
});

test('both demos: 8 weeks of daily counts that add up, a missed day, a kept count, and today not counted yet', async () => {
  for (const demo of ['baldwin', 'mise']) {
    const v = person();
    assert.equal((await v('/api/demo/start', { method: 'POST', body: { role: 'manager', demo } })).status, 200);
    const t = (await v('/api/prep')).data;
    assert.equal(t.items.length, 12, demo);
    assert.equal(t.counted, null, demo + ': today starts with the count');
    assert.equal(t.lastCount.day, addDays(today(), -1), demo + ': counted yesterday');
    assert.ok(t.items.every((i) => i.status === 'uncounted' && i.lastStarting != null), demo + ': what you’ll count');
    assert.ok(t.example && t.example.used >= 0, demo + ': a real example');
    assert.ok(t.started && t.started <= addDays(today(), -50), demo + ': about 8 weeks of logs');
    assert.equal((await v('/api/prep/batches', { method: 'POST', body: { itemId: t.items[0].id, amount: 1 } })).status, 409, demo + ': count first');
    const sheet = (await v('/api/prep/count')).data;
    assert.ok(sheet.items.some((i) => i.expired.length > 0), demo + ': something past its use-by to decide on');
    assert.ok(sheet.items.every((i) => i.last && i.last.expected != null && !i.today), demo);
    // Every ledger row's Used follows from its numbers
    let missed = 0;
    for (const it of t.items) {
      const d = (await v(`/api/prep/items/${it.id}`)).data;
      assert.ok(d.ledger.length >= 50, demo + ': a row per shift');
      for (const r of d.ledger) {
        assert.ok(Math.abs(r.starting - (r.walkedIn + r.prepped)) < 1e-6);
        if (r.used != null) assert.ok(Math.abs(r.used - (r.starting - r.wasted - r.nextCount)) < 1e-6 && r.used >= 0, `${demo} ${it.name} ${r.day}`);
        if (r.shifts > 1) missed++;
      }
    }
    assert.equal(missed, 12, demo + ': one missed day, every item');
    const r = (await v(`/api/prep/report?range=week&at=${addDays(today(), -7)}`)).data;
    assert.ok(r.tiles.batches.count > 40 && r.tiles.liquid.used > 0 && r.tiles.garnish.used > 0, demo + ': a full week');
    assert.ok(r.rows.every((x) => x.made > 0 && x.used > 0), demo + ': every item made and used');
    const k = (await v(`/api/prep/report?range=week&at=${addDays(today(), -9)}`)).data;
    assert.equal(k.kept.filter((x) => x.kept).length, 1, demo + ': the kept count');
    const lime = (await v(`/api/prep/items/${t.items[0].id}`)).data;
    assert.ok(lime.suggestions.length >= 1, demo + ': the counts suggest a par');
    assert.ok(lime.drinks.length >= 2, demo + ': its drinks');
    // The visitor counts: the prep list opens
    const saved = await v('/api/prep/count', { method: 'POST', body: { items: sheet.items.map((i) => ({ itemId: i.id, amount: i.fresh })) } });
    assert.equal(saved.status, 200);
    assert.ok(saved.data.items.every((i) => i.status !== 'uncounted' && i.lastUsed != null), demo + ': yesterday’s Used is filled in');
    const emp = person();
    await emp('/api/demo/start', { method: 'POST', body: { role: 'employee', demo } });
    assert.deepEqual((await emp('/api/prep')).data.can, { log: false, edit: false }, demo + ': the employee demo is a server');
  }
});
