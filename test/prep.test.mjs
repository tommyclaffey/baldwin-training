// Prep tracker (Nov 12, server/prep.mjs): who can log and edit, use-by math, "to make" rounding, suggested pars, report
// totals, archive and restore, and that one store never sees another's prep. Plus both demos come with full prep.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dayOf, addDays, useByFor, toMake, suggestions, parsFor, pct, periodFor, summaryText, canLog, canManage, detroitAt } from '../server/prep.mjs';

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
  assert.equal(pct(1, 4), 25); assert.equal(pct(0, 0), null);
  assert.equal(summaryText({ period: { label: 'Nov 2–8' }, tiles: { liquid: { made: 10, pct: 10, prevPct: 14 }, garnish: { made: 100, pct: 11, prevPct: 11 } }, ranOut: [{ item: 'Lime juice', day: '2026-11-07' }, { item: 'Lime wedges', day: '2026-11-06' }] }),
    'Prep, Nov 2–8: juices and syrups 10% wasted (down from 14%), garnishes 11%, same as before. We ran out 2 times: lime juice on Saturday and lime wedges on Friday.');
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

test('permissions: a server reads Today but can’t log; staff can’t edit; a bartender logs', async () => {
  const s = await server_('/api/prep');
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.can, { log: false, edit: false });
  assert.equal((await server_('/api/prep/batches', { method: 'POST', body: { itemId: items[0].id, amount: 3 } })).status, 403);
  assert.equal((await server_(`/api/prep/items/${items[0].id}/ranout`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await server_('/api/prep/report')).status, 403, 'reports are for managers');
  const b = await bar('/api/prep');
  assert.deepEqual(b.data.can, { log: true, edit: false });
  assert.equal((await bar(`/api/prep/items/${items[0].id}`, { method: 'PATCH', body: { pars: [9, 9, 9, 9, 9, 9, 9] } })).status, 403, 'staff can’t edit pars');
  assert.equal((await bar(`/api/prep/items/${items[0].id}/suggestion`, { method: 'POST', body: { dow: 1, action: 'accept', to: 9 } })).status, 403);
  assert.equal((await bar('/api/prep/items', { method: 'POST', body: { name: 'X', kind: 'juice', unit: 'qt', batch: 1 } })).status, 403);
  assert.equal((await bar(`/api/prep/items/${items[0].id}/archive`, { method: 'POST' })).status, 403);
  // A bartender can't log a batch as made by a server (only people who prep).
  const sera = (await manager('/api/manager/team')).data.people.find((p) => p.name === 'Sera Server');
  assert.equal((await bar('/api/prep/batches', { method: 'POST', body: { itemId: items[0].id, amount: 1, madeBy: sera.id } })).status, 400);
});

let limeBatch;
test('a batch’s use-by comes from shelf life; to make drops; waste and Used Up close it', async () => {
  const lime = items[0];
  const r = await bar('/api/prep/batches', { method: 'POST', body: { itemId: lime.id, amount: 3 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.useBy, today(), 'lime juice keeps 1 shift');
  limeBatch = r.data.id;
  const row = (await bar('/api/prep')).data.items.find((i) => i.id === lime.id);
  assert.equal(row.onHand, 3);
  assert.equal(row.toMake, Math.max(0, Math.ceil(row.par - 3)));
  assert.equal(row.made.amount, 3);
  assert.equal(row.made.by.name, 'Bo Bartender');
  // Shelf life change by a manager: new batches get the new use-by
  const syrup = items[3];
  assert.equal((await manager(`/api/prep/items/${syrup.id}`, { method: 'PATCH', body: { shelfDays: 3 } })).status, 200);
  const b2 = await bar('/api/prep/batches', { method: 'POST', body: { itemId: syrup.id, amount: 2 } });
  assert.equal(b2.data.useBy, addDays(today(), 3));
  const after = (await manager(`/api/prep/items/${syrup.id}`)).data;
  assert.match(after.shelf.source, /^Set by Max Manager/);
  // Waste: more than what's left is refused; a spill comes off what's left
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 5, reason: 'spilled' } })).status, 400);
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.5, reason: 'other' } })).status, 400, 'Other needs a note');
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.5, reason: 'spilled' } })).status, 200);
  // Count: 2.5 left → 1.5 counted = 1 used
  assert.equal((await bar(`/api/prep/items/${lime.id}/count`, { method: 'POST', body: { onHand: 4 } })).status, 400, 'can’t count more than logged');
  assert.equal((await bar(`/api/prep/items/${lime.id}/count`, { method: 'POST', body: { onHand: 1.5 } })).status, 200);
  // Expired-style clear: log 0.5 as expired → the batch closes, the other 1 qt counts as used
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.5, reason: 'expired' } })).status, 200);
  const d = (await manager(`/api/prep/items/${lime.id}`)).data;
  const b = d.batches.find((x) => x.id === limeBatch);
  assert.equal(b.open, false);
  assert.equal(b.used, 2);
  assert.deepEqual(b.wasted, [{ amount: 0.5, reason: 'spilled' }, { amount: 0.5, reason: 'expired' }]);
  assert.equal((await bar('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.1, reason: 'spilled' } })).status, 409, 'cleared');
  // Used Up on the syrup batch
  const sb = (await manager(`/api/prep/items/${syrup.id}`)).data.batches[0];
  assert.equal((await bar(`/api/prep/batches/${sb.id}/used`, { method: 'POST' })).status, 200);
  assert.equal((await manager(`/api/prep/items/${syrup.id}`)).data.batches[0].used, 2);
  assert.equal((await bar(`/api/prep/items/${lime.id}/ranout`, { method: 'POST', body: { note: 'busy bar' } })).status, 200);
});

test('report totals: made, used, wasted, waste %, ran out, by the day the batch was made', async () => {
  const r = await manager(`/api/prep/report?range=day&series=${items[0].id}`);
  assert.equal(r.status, 200);
  const lime = r.data.rows.find((x) => x.id === items[0].id);
  assert.deepEqual([lime.made, lime.used, lime.wasted, lime.inUse, lime.wastePct, lime.ranOut], [3, 2, 1, 0, 33, 1]);
  const dem = r.data.rows.find((x) => x.id === items[3].id);
  assert.deepEqual([dem.made, dem.used, dem.wasted, dem.wastePct], [2, 2, 0, 0]);
  // Tiles: juices + syrups in quarts (5 made, 1 wasted = 20%); garnishes in pieces (none)
  assert.deepEqual([r.data.tiles.liquid.made, r.data.tiles.liquid.wasted, r.data.tiles.liquid.pct], [5, 1, 20]);
  assert.equal(r.data.tiles.garnish.made, 0);
  assert.equal(r.data.tiles.ranOut.count, 1);
  assert.equal(r.data.tiles.batches.count, 2);
  const todayBar = r.data.chart.find((b) => b.on);
  assert.deepEqual([todayBar.made, todayBar.used, todayBar.wasted, todayBar.ranOut], [3, 2, 1, 1]);
  assert.equal(r.data.lastYear, false, 'no year of logs yet');
  assert.match(r.data.summary, /juices and syrups 20% wasted\. We ran out once: lime juice on/);
  // Week view includes today’s batches in this week
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

test('store isolation: Testa Barra has its own list and can’t reach The Baldwin’s items or batches', async () => {
  const t = await testaGm('/api/prep');
  assert.equal(t.status, 200);
  assert.ok(!t.data.items.some((i) => items.some((b) => b.id === i.id)), 'none of The Baldwin’s items');
  assert.equal((await testaGm(`/api/prep/items/${items[0].id}`)).status, 404);
  assert.equal((await testaGm(`/api/prep/items/${items[0].id}`, { method: 'PATCH', body: { pars: [1, 1, 1, 1, 1, 1, 1] } })).status, 404);
  assert.equal((await testaGm('/api/prep/batches', { method: 'POST', body: { itemId: items[0].id, amount: 1 } })).status, 404);
  assert.equal((await testaGm('/api/prep/waste', { method: 'POST', body: { batchId: limeBatch, amount: 0.1, reason: 'spilled' } })).status, 404);
  assert.equal((await testaGm(`/api/prep/items/${items[0].id}/archive`, { method: 'POST' })).status, 404);
  const rep = (await testaGm('/api/prep/report?range=day')).data;
  assert.equal(rep.tiles.batches.count, 0, 'none of The Baldwin’s batches in its report');
  assert.ok(!(await testaGm('/api/archived')).data.groups.find((g) => g.id === 'prep').items.length);
});

test('both demos come with full prep: items, 8 weeks of logs, suggestions; labelled as demo data on screen', async () => {
  for (const demo of ['baldwin', 'mise']) {
    const v = person();
    assert.equal((await v('/api/demo/start', { method: 'POST', body: { role: 'manager', demo } })).status, 200);
    const t = (await v('/api/prep')).data;
    assert.equal(t.items.length, 12, demo);
    assert.ok(t.useFirst.length >= 1, demo + ': something to use first');
    assert.ok(t.started && t.started <= addDays(today(), -50), demo + ': about 8 weeks of logs');
    const r = (await v(`/api/prep/report?range=week&at=${addDays(today(), -7)}`)).data;
    assert.ok(r.tiles.batches.count > 40 && r.tiles.liquid.made > 0 && r.tiles.garnish.made > 0, demo + ': a full week');
    assert.ok(r.rows.every((x) => x.made > 0), demo + ': every item has batches');
    const lime = (await v(`/api/prep/items/${t.items[0].id}`)).data;
    assert.ok(lime.suggestions.length >= 1, demo + ': the logs suggest a par');
    assert.ok(lime.drinks.length >= 2, demo + ': its drinks');
    const emp = person();
    await emp('/api/demo/start', { method: 'POST', body: { role: 'employee', demo } });
    assert.deepEqual((await emp('/api/prep')).data.can, { log: false, edit: false }, demo + ': the employee demo is a server');
  }
});
