// Tip Tracker (Nov 25, Tommy approved Idea Board section 52, 1041:4459: "approved", with Claude's defaults: manager view yes,
// pay period every two weeks). Tommy: "I want a tip tracker so people can track their tips, as well as put in if they are
// still owed cash from the restaurant and if that cash has been settled."
//
// What it holds (all money in whole cents, never floats):
//   tip_shifts    one shift someone logged: day (the store's Detroit date), lunch or dinner, position, cash tips, card tips,
//                 tip-out given, minutes worked (optional) and a note (optional). Net = cash + card − tip-out.
//   tip_owed      money the restaurant still owes the person: why (cash tips not paid out, card tips paid later, drawer short,
//                 other), how much, the day and shift it's from (kept here too, so deleting the shift leaves it on the list).
//   tip_payments  each time some or all of an owed item was paid: how much, the day it was paid, and who marked it (the
//                 person, or a manager or owner of that store). Status comes from the payments: Owed (none), Part Settled,
//                 Settled (paid in full).
//
// Who sees what (server-enforced here, never by the screen):
//   • A person's shifts and tips are theirs alone. Nobody else can read them through the API: not another staff member, not
//     a manager, not the owner, not a super admin. Every query is WHERE user_id = the signed-in person.
//   • Sign In As: while a super admin is signed in as someone, Tips is closed (reads and writes), the person's own view and
//     the manager view alike. The super admin sees a "private" card, never a number. (Support's whole point is to see what
//     the person sees, but tips are the one place the app promises "only you".)
//   • Owed items: the person, and that store's managers and owners (the manager view, "Owed to Staff"). They see who is owed,
//     the reason, the amount, the day and the status, and can mark items settled. Never a note, a shift or a tip total.
//   • Super admins (working in a company) don't get the manager view either; they aren't the restaurant.
//   • Every company's rows stay in that company (company_id on every row, checked on every read and write).
// Personal tip actions aren't written to the Activity log (owners read it). A manager's settle is, with the person and amount,
// which managers can already see.
// "A personal record, not payroll." No tax advice anywhere.
import { audit, now } from './db.mjs';
// (the same day helpers as server/prep.mjs, kept here so db.mjs can make these tables without loading the prep tracker)
const TZ = 'America/Detroit';
export const dayOf = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const weekStart = (iso) => addDays(iso, -((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7)); // Monday
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const rangeLabel = (a, b) => (a.slice(0, 7) === b.slice(0, 7) ? `${md(a)}–${+b.slice(8, 10)}` : `${md(a)}–${md(b)}`);
import { JOBS, validJobs } from './paths.mjs';

export class TipError extends Error { constructor(status, message) { super(message); this.status = status; } }
const no = (status, message) => { throw new TipError(status, message); };

/* ------------------------------------------------------------------ tables: server/tipsdb.mjs (db.mjs makes them at startup) */
export { migrateTips } from './tipsdb.mjs';
/** A person removed for good (30 days after Remove): their tip records go with them. */
export function dropTipsOf(db, userId) {
  for (const t of ['tip_payments', 'tip_owed', 'tip_shifts']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
}

/* ------------------------------------------------------------------ money, hours, days */
export const MAX_CENTS = 9_999_999; // $99,999.99 on any one line
/** "64", "64.5", "$1,064.50", 64.5 → cents. Strings only ever go through text, so 0.1 + 0.2 never happens. */
export function toCents(v, what, { optional = false } = {}) {
  if (v === null || v === undefined || String(v).trim() === '') { if (optional) return 0; no(400, `Enter ${what}.`); }
  const s = String(v).trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^(\d{1,7}(\.\d{0,2})?|\.\d{1,2})$/.test(s)) no(400, `${what[0].toUpperCase() + what.slice(1)} should be an amount like 64 or 64.50.`);
  const [w, f = ''] = s.split('.');
  const cents = Number(w || 0) * 100 + Number((f + '00').slice(0, 2));
  if (cents > MAX_CENTS) no(400, `${what[0].toUpperCase() + what.slice(1)} is over $99,999.99. Check the number.`);
  return cents;
}
/** "6", "6.5", "6.25" hours → minutes (or null when left empty). Up to 24 hours a shift. */
export function toMinutes(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const s = String(v).trim().replace(/\s*h(ours?)?$/i, '');
  if (!/^(\d{1,2}(\.\d{0,2})?|\.\d{1,2})$/.test(s)) no(400, 'Hours should be a number like 6 or 6.5.');
  const [w, f = ''] = s.split('.');
  const hundredths = Number(w || 0) * 100 + Number((f + '00').slice(0, 2));
  if (hundredths > 2400) no(400, 'A shift is 24 hours at most.');
  return hundredths ? Math.round(hundredths * 0.6) : null;
}
/** Hourly rate in cents from net cents and minutes (rounded to the cent). */
export const hourly = (netCents, minutes) => (minutes > 0 ? Math.round((netCents * 60) / minutes) : null);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
function validDay(v, what = 'the date', today = dayOf()) {
  const d = String(v || '').trim();
  if (!ISO.test(d) || Number.isNaN(Date.parse(d + 'T12:00:00Z')) || new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) !== d) no(400, `Pick ${what}.`);
  if (d > today) no(400, `${what[0].toUpperCase() + what.slice(1)} can’t be in the future.`);
  if (daysBetween(d, today) > 400) no(400, `${what[0].toUpperCase() + what.slice(1)} is more than a year ago.`);
  return d;
}
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/* ------------------------------------------------------------------ weeks and pay periods */
// Pay period: every two weeks (Tommy, Nov 25, the default offered), Monday to the Sunday after next, counted from Monday
// Nov 16, 2026 (the period on the approved screens: Nov 16–29). One place to change it if a store's payroll differs.
export const PAY_ANCHOR = '2026-11-16';
export const PAY_DAYS = 14;
export const periodStart = (day) => addDays(PAY_ANCHOR, Math.floor(daysBetween(PAY_ANCHOR, day) / PAY_DAYS) * PAY_DAYS);
/** The range a view covers: { from, to } for 'week' (Mon–Sun) or 'period' (two weeks) holding `day`. */
export function rangeOf(view, day) {
  const from = view === 'period' ? periodStart(day) : weekStart(day);
  return { from, to: addDays(from, (view === 'period' ? PAY_DAYS : 7) - 1) };
}

/* ------------------------------------------------------------------ who */
const MANAGES = new Set(['owner', 'manager']);
/** The signed-in person can keep their own tips: someone in a company (staff, managers, owners), signed in as themselves. */
export function needOwnTips(u) {
  if (!u) no(401, 'Sign in to see your tips.');
  if (u.impersonator_id) no(403, `Tips are private to ${u.name}. They stay closed while you’re signed in as someone.`);
  if (u.role === 'superadmin' || !u.company_id) no(403, 'Tips are for people on a restaurant’s team.');
  return u;
}
/** The manager view: that store's managers and owners, signed in as themselves. */
export function needManagerView(u, storeRow) {
  if (!u) no(401, 'Sign in first.');
  if (u.impersonator_id) no(403, 'Owed to Staff stays closed while you’re signed in as someone.');
  if (!MANAGES.has(u.role) || !u.company_id) no(403, 'Only that store’s managers and owners see what’s owed to staff.');
  if (!storeRow || storeRow.company_id !== u.company_id) no(400, 'Pick a store to work in first.');
  if (u.role === 'manager' && u.store_id && u.store_id !== storeRow.id) no(403, 'You manage a different store.');
  return u;
}

/* ------------------------------------------------------------------ owed items */
export const REASONS = { cash: 'Cash tips not paid out', card: 'Card tips paid later', drawer: 'Drawer short at close', other: '' };
const statusOf = (amount, paid) => (paid <= 0 ? 'owed' : paid >= amount ? 'settled' : 'part');
function paymentsOf(db, ids) {
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  for (const p of db.prepare(`SELECT * FROM tip_payments WHERE owed_id IN (${ids.map(() => '?').join(',')}) ORDER BY paid_on, id`).all(...ids)) map.get(p.owed_id)?.push(p);
  return map;
}
/** One owed item. `me` = the viewer (for "marked by you"). `full`: the person's own view (with the note and shift). */
function owedOut(r, pays, me, full) {
  const paid = pays.reduce((s, p) => s + p.amount_cents, 0);
  const status = statusOf(r.amount_cents, paid);
  const out = { id: r.id, day: r.day, part: r.part, reason: r.reason, label: r.label, amount: r.amount_cents, paid, remaining: Math.max(0, r.amount_cents - paid), status,
    settledOn: status === 'settled' ? pays[pays.length - 1]?.paid_on ?? null : null,
    settledBy: status === 'settled' ? byWord(pays[pays.length - 1], me) : null,
    payments: pays.map((p) => ({ id: p.id, amount: p.amount_cents, paidOn: p.paid_on, by: byWord(p, me), at: p.at })) };
  if (full) Object.assign(out, { shiftId: r.shift_id, note: r.note || '', createdAt: r.created_at });
  return out;
}
const byWord = (p, me) => (!p ? null : p.by_user === me ? 'you' : p.by_name || 'a manager');

/** A person's own owed list: still owed first (oldest first), then settled (newest first, the last 30). */
export function myOwed(db, u) {
  const rows = db.prepare('SELECT * FROM tip_owed WHERE user_id = ? AND company_id = ? ORDER BY day, id').all(u.id, u.company_id);
  const pays = paymentsOf(db, rows.map((r) => r.id));
  const all = rows.map((r) => owedOut(r, pays.get(r.id) || [], u.id, true));
  const open = all.filter((x) => x.status !== 'settled');
  const settled = all.filter((x) => x.status === 'settled').sort((a, b) => (b.settledOn || '').localeCompare(a.settledOn || '') || b.id - a.id).slice(0, 30);
  return { remaining: open.reduce((s, x) => s + x.remaining, 0), open, settled, settledCount: all.length - open.length };
}
function ownOwed(db, u, id) {
  const r = db.prepare('SELECT * FROM tip_owed WHERE id = ? AND user_id = ? AND company_id = ?').get(Number(id), u.id, u.company_id);
  if (!r) no(404, 'That owed item isn’t here.');
  return r;
}
export function owedDetail(db, u, id) {
  const r = ownOwed(db, u, id);
  return owedOut(r, paymentsOf(db, [r.id]).get(r.id) || [], u.id, true);
}
function readOwed(b, { day, part } = {}) {
  const reason = Object.hasOwn(REASONS, b.reason) ? b.reason : no(400, 'Pick why the house owes you.');
  const label = reason === 'other' ? clean(b.label, 80) || no(400, 'Say what it’s for, like “Private party gratuity”.') : REASONS[reason];
  const amount = toCents(b.amount, 'how much the house owes you');
  if (amount <= 0) no(400, 'Enter how much the house owes you.');
  return { reason, label, amount, note: clean(b.note, 300), day, part };
}
const insOwed = (db, u, store, shiftId, o) => Number(db.prepare(`INSERT INTO tip_owed(company_id, store_id, user_id, shift_id, day, part, reason, label, amount_cents, note, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(u.company_id, store, u.id, shiftId, o.day, o.part ?? null, o.reason, o.label, o.amount, o.note || null, now()).lastInsertRowid);
const OPEN_CAP = 300; // owed items a person can have at once (a guard, far past real use)
function roomForOwed(db, u) {
  if (db.prepare('SELECT COUNT(*) n FROM tip_owed WHERE user_id = ?').get(u.id).n >= OPEN_CAP) no(429, 'That’s a lot of owed items. Settle or delete a few first.');
}
/** + Add Owed Money: an item that isn't from a shift logged here (or added later). */
export function addOwed(db, u, store, b) {
  roomForOwed(db, u);
  const o = readOwed(b, { day: validDay(b.day, 'the day it’s from'), part: b.part === 'lunch' || b.part === 'dinner' ? b.part : null });
  return insOwed(db, u, store, null, o);
}
export function editOwed(db, u, id, b) {
  const r = ownOwed(db, u, id);
  const paid = (paymentsOf(db, [r.id]).get(r.id) || []).reduce((s, p) => s + p.amount_cents, 0);
  const o = readOwed({ reason: b.reason ?? r.reason, label: b.label ?? r.label, amount: b.amount ?? (r.amount_cents / 100).toFixed(2), note: b.note ?? r.note });
  if (o.amount < paid) no(400, `You’ve been paid ${money(paid)} of it already, so it can’t be less than that.`);
  db.prepare('UPDATE tip_owed SET reason = ?, label = ?, amount_cents = ?, note = ?, updated_at = ? WHERE id = ?').run(o.reason, o.label, o.amount, o.note || null, now(), r.id);
}
export function deleteOwed(db, u, id) {
  const r = ownOwed(db, u, id);
  db.prepare('DELETE FROM tip_payments WHERE owed_id = ?').run(r.id);
  db.prepare('DELETE FROM tip_owed WHERE id = ?').run(r.id);
}
/** Mark Settled: all of what's left, or part of it, paid on a day. `by` = who marked it (the person, or a manager). */
export function settle(db, r, by, b) {
  const pays = paymentsOf(db, [r.id]).get(r.id) || [];
  const left = r.amount_cents - pays.reduce((s, p) => s + p.amount_cents, 0);
  if (left <= 0) no(409, 'That’s already settled.');
  const amount = b.all === true ? left : toCents(b.amount, 'the amount paid');
  if (amount <= 0) no(400, 'Enter the amount paid.');
  if (amount > left) no(400, `Only ${money(left)} is still owed. Enter that or less.`);
  const paidOn = validDay(b.paidOn || dayOf(), 'the date paid');
  if (paidOn < r.day) no(400, 'The date paid can’t be before the day it’s from.');
  db.prepare('INSERT INTO tip_payments(owed_id, company_id, store_id, user_id, amount_cents, paid_on, by_user, by_name, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(r.id, r.company_id, r.store_id, r.user_id, amount, paidOn, by.id, by.name, now());
  return { paid: amount, left: left - amount };
}
export const settleOwn = (db, u, id, b) => settle(db, ownOwed(db, u, id), u, b);
export const money = (c) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/* ------------------------------------------------------------------ shifts */
const POSITIONS = ['Server', 'Bartender', 'Host', 'Support'];
const jobsOf = (u) => { try { return validJobs(JSON.parse(u.jobs || '[]')); } catch { return []; } };
const labelOf = (k) => JOBS.find((j) => j.key === k)?.label;
/** The position chips: the four on the design, plus any job of theirs that isn't one of them. Theirs first is the default. */
export function positionsFor(u) {
  const mine = jobsOf(u).map(labelOf).filter(Boolean);
  return { list: [...new Set([...POSITIONS, ...mine])], mine: mine[0] || 'Server' };
}
const ALL_POSITIONS = new Set([...POSITIONS, ...JOBS.map((j) => j.label)]);
function readShift(b, u, { partial = null } = {}) {
  const s = partial ? { ...partial } : {};
  if (!partial) {
    s.day = validDay(b.day);
    s.part = b.part === 'lunch' || b.part === 'dinner' ? b.part : no(400, 'Pick lunch or dinner.');
    s.position = ALL_POSITIONS.has(b.position) ? b.position : positionsFor(u).mine;
  }
  if (!partial || b.cash !== undefined) s.cash = toCents(b.cash, 'cash tips', { optional: true });
  if (!partial || b.card !== undefined) s.card = toCents(b.card, 'card tips', { optional: true });
  if (!partial || b.tipout !== undefined) s.tipout = toCents(b.tipout, 'the tip-out', { optional: true });
  if (!partial || b.hours !== undefined) s.minutes = toMinutes(b.hours);
  if (!partial || b.note !== undefined) s.note = clean(b.note, 300);
  if (!partial && !s.cash && !s.card) no(400, 'Enter your cash tips or card tips (0 is fine for one of them).');
  return s;
}
const SHIFTS_A_DAY = 4;
/** Log a Shift. With `owed` on, the money the house still owes from it goes on the Owed list in the same step. */
export function logShift(db, u, store, b) {
  const s = readShift(b, u);
  if (db.prepare('SELECT COUNT(*) n FROM tip_shifts WHERE user_id = ? AND day = ?').get(u.id, s.day).n >= SHIFTS_A_DAY) no(400, `That day already has ${SHIFTS_A_DAY} shifts.`);
  const owed = b.owed && b.owed.on !== false ? readOwed(b.owed, { day: s.day, part: s.part }) : null;
  if (owed) roomForOwed(db, u);
  db.exec('BEGIN');
  try {
    const id = Number(db.prepare(`INSERT INTO tip_shifts(company_id, store_id, user_id, day, part, position, cash_cents, card_cents, tipout_cents, minutes, note, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(u.company_id, store, u.id, s.day, s.part, s.position, s.cash, s.card, s.tipout, s.minutes, s.note || null, now()).lastInsertRowid);
    const owedId = owed ? insOwed(db, u, store, id, owed) : null;
    db.exec('COMMIT');
    return { id, owedId };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function ownShift(db, u, id) {
  const r = db.prepare('SELECT * FROM tip_shifts WHERE id = ? AND user_id = ? AND company_id = ?').get(Number(id), u.id, u.company_id);
  if (!r) no(404, 'That shift isn’t here.');
  return r;
}
export function editShift(db, u, id, b) {
  const r = ownShift(db, u, id);
  const s = readShift(b, u, { partial: { cash: r.cash_cents, card: r.card_cents, tipout: r.tipout_cents, minutes: r.minutes, note: r.note } });
  if (!s.cash && !s.card) no(400, 'Enter your cash tips or card tips (0 is fine for one of them).');
  db.prepare('UPDATE tip_shifts SET cash_cents = ?, card_cents = ?, tipout_cents = ?, minutes = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(s.cash, s.card, s.tipout, s.minutes, s.note || null, now(), r.id);
}
/** Delete a shift: its numbers come off the totals; anything the house owes from it stays on the Owed list. */
export function deleteShift(db, u, id) {
  const r = ownShift(db, u, id);
  db.prepare('UPDATE tip_owed SET shift_id = NULL WHERE shift_id = ? AND user_id = ?').run(r.id, u.id);
  db.prepare('DELETE FROM tip_shifts WHERE id = ?').run(r.id);
}
const netOf = (r) => r.cash_cents + r.card_cents - r.tipout_cents;
function shiftOut(r, owed) {
  return { id: r.id, day: r.day, part: r.part, position: r.position || '', cash: r.cash_cents, card: r.card_cents, tipout: r.tipout_cents, net: netOf(r),
    minutes: r.minutes, note: r.note || '', owed: owed.map((o) => ({ id: o.id, label: o.label, amount: o.amount, remaining: o.remaining, status: o.status })) };
}
export function shiftDetail(db, u, id) {
  const r = ownShift(db, u, id);
  const rows = db.prepare('SELECT * FROM tip_owed WHERE shift_id = ? AND user_id = ?').all(r.id, u.id);
  const pays = paymentsOf(db, rows.map((x) => x.id));
  return shiftOut(r, rows.map((x) => owedOut(x, pays.get(x.id) || [], u.id, false)));
}
/** Totals for a list of shifts. Hourly counts only shifts with hours logged. */
export function totalsOf(shifts) {
  const t = { count: shifts.length, cash: 0, card: 0, tipout: 0, net: 0, minutes: 0, hourly: null };
  let timedNet = 0;
  for (const s of shifts) {
    t.cash += s.cash; t.card += s.card; t.tipout += s.tipout; t.net += s.net;
    if (s.minutes > 0) { t.minutes += s.minutes; timedNet += s.net; }
  }
  t.hourly = hourly(timedNet, t.minutes);
  return t;
}

/** The Tips page: one week (Mon–Sun) or one pay period, with its shifts and totals, and the Owed to You summary. */
export function tipsPage(db, u, q = {}) {
  const today = dayOf();
  const view = q.view === 'period' ? 'period' : 'week';
  const at = ISO.test(String(q.at || '')) && q.at <= today ? q.at : today;
  const { from, to } = rangeOf(view, at);
  const rows = db.prepare('SELECT * FROM tip_shifts WHERE user_id = ? AND company_id = ? AND day BETWEEN ? AND ? ORDER BY day DESC, part = \'lunch\', id DESC').all(u.id, u.company_id, from, to);
  const owedRows = rows.length ? db.prepare(`SELECT * FROM tip_owed WHERE user_id = ? AND shift_id IN (${rows.map(() => '?').join(',')})`).all(u.id, ...rows.map((r) => r.id)) : [];
  const pays = paymentsOf(db, owedRows.map((r) => r.id));
  const owedBy = new Map();
  for (const o of owedRows) { const x = owedOut(o, pays.get(o.id) || [], u.id, false); owedBy.set(o.shift_id, [...(owedBy.get(o.shift_id) || []), x]); }
  const shifts = rows.map((r) => shiftOut(r, owedBy.get(r.id) || []));
  const owed = myOwed(db, u);
  const prevAt = addDays(from, -1), nextAt = addDays(to, 1);
  const first = db.prepare('SELECT MIN(day) d FROM tip_shifts WHERE user_id = ?').get(u.id).d;
  const pos = positionsFor(u);
  return {
    today, view, from, to, label: rangeLabel(from, to), current: to >= today,
    prev: first && first < from ? prevAt : null, next: nextAt <= today ? nextAt : null,
    shifts, totals: totalsOf(shifts), anyShifts: !!first,
    owed: { remaining: owed.remaining, count: owed.open.length, oldest: owed.open[0]?.day ?? null },
    positions: pos.list, position: pos.mine, payDays: PAY_DAYS,
  };
}

/* ------------------------------------------------------------------ the manager view: Owed to Staff */
const jobWord = (jobs) => { try { return validJobs(JSON.parse(jobs || '[]')).map(labelOf).filter(Boolean).join(' + '); } catch { return ''; } };
/** What the store still owes its people, and what was settled lately. Owed items only: no note, no shift, no tip totals. */
export function teamOwed(db, u, storeRow) {
  const rows = db.prepare(`SELECT o.*, p.name person, p.jobs jobs, p.role prole FROM tip_owed o JOIN users p ON p.id = o.user_id
    WHERE o.company_id = ? AND o.store_id = ? AND p.company_id = ? AND p.deleted_at IS NULL ORDER BY o.day, o.id`).all(u.company_id, storeRow.id, u.company_id);
  const pays = paymentsOf(db, rows.map((r) => r.id));
  const item = (r) => { const x = owedOut(r, pays.get(r.id) || [], u.id, false); return { ...x, part: undefined, person: { id: r.user_id, name: r.person, job: jobWord(r.jobs) || (r.prole === 'staff' ? '' : r.prole === 'owner' ? 'Owner' : 'Manager') } }; };
  const all = rows.map(item);
  const open = all.filter((x) => x.status !== 'settled');
  const today = dayOf();
  const { from } = rangeOf('period', today);
  const settledThisPeriod = all.filter((x) => x.status === 'settled' && x.settledOn >= from);
  const recent = all.filter((x) => x.status === 'settled' && x.settledOn >= addDays(today, -30)).sort((a, b) => b.settledOn.localeCompare(a.settledOn) || b.id - a.id).slice(0, 20);
  const oldest = open[0] || null;
  return {
    store: storeRow.name, you: u.name,
    owedNow: open.reduce((s, x) => s + x.remaining, 0), count: open.length, people: new Set(open.map((x) => x.person.id)).size,
    oldest: oldest && { day: oldest.day, name: oldest.person.name, remaining: oldest.remaining },
    settledThisPeriod: { amount: settledThisPeriod.reduce((s, x) => s + x.amount, 0), count: settledThisPeriod.length, from },
    open, recent,
  };
}
export function settleForTeam(db, u, storeRow, id, b) {
  const r = db.prepare(`SELECT o.*, p.name person FROM tip_owed o JOIN users p ON p.id = o.user_id
    WHERE o.id = ? AND o.company_id = ? AND o.store_id = ? AND p.deleted_at IS NULL`).get(Number(id), u.company_id, storeRow.id);
  if (!r) no(404, 'That owed item isn’t here.');
  const out = settle(db, r, u, b);
  audit(db, u.id, 'settle owed money', `${r.person} · ${r.label} · ${money(out.paid)}${out.left > 0 ? ` (${money(out.left)} still owed)` : ' (settled)'}`, u.company_id);
  return out;
}

/* ------------------------------------------------------------------ the demo (Fig & Fire cast, the approved screens' numbers) */
// Marisol Vega's last two pay periods as drawn (Nov 16–25 on the screens; here counted back from the demo's own day), so
// Tips, the week, the pay period and Owed to You are full. In the employee demo tonight's dinner isn't logged yet: the
// visitor logs it (the screens' Log a Shift). In the manager demo it is, with the $40 cash the house still owes her.
// Dorian, Teddy and Quinn have the owed items the manager view shows. Example data, shown as Demo data on screen.
const MARISOL = [ // [days ago, part, hours, cash, card, tip-out, note]
  [0, 'lunch', 5, 34, 96, 13], [1, 'dinner', 6.5, 86, 214, 30, 'Patio full, two big tables'], [2, 'dinner', 6, 52, 168, 22], [3, 'dinner', 6, 64, 182, 25],
  [4, 'dinner', 7.5, 118, 296, 41], [5, 'dinner', 7, 97, 251, 35], [6, 'dinner', 6, 41, 139, 18], [8, 'lunch', 5, 22, 88, 11],
  // the two weeks before
  [12, 'dinner', 6, 58, 176, 24], [10, 'dinner', 7, 104, 268, 37], [11, 'dinner', 7.5, 121, 301, 42], [13, 'dinner', 6, 47, 152, 20],
  [14, 'lunch', 4.5, 19, 74, 9], [16, 'dinner', 6, 61, 170, 23], [17, 'dinner', 7, 96, 244, 34], [18, 'dinner', 7.5, 112, 289, 40], [20, 'dinner', 5.5, 38, 131, 17],
];
export function seedDemoTips(db, { company, store, employeeDemo }) {
  const today = dayOf();
  const ago = (n) => addDays(today, -n);
  const who = (name) => db.prepare('SELECT * FROM users WHERE company_id = ? AND name = ?').get(company, name);
  const marisol = who('Marisol Vega'), rosalind = who('Rosalind Hart');
  const t = now();
  const shift = (u, n, part, hours, cash, card, tipout, note = null, position = 'Server') => Number(db.prepare(`INSERT INTO tip_shifts(company_id, store_id, user_id, day, part, position, cash_cents, card_cents, tipout_cents, minutes, note, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(company, store, u.id, ago(n), part, position, cash * 100, card * 100, tipout * 100, Math.round(hours * 60), note, t).lastInsertRowid);
  const owe = (u, shiftId, n, part, reason, label, amount, note = null) => Number(db.prepare(`INSERT INTO tip_owed(company_id, store_id, user_id, shift_id, day, part, reason, label, amount_cents, note, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(company, store, u.id, shiftId, ago(n), part, reason, label, amount * 100, note, t).lastInsertRowid);
  const pay = (u, owedId, amount, n, by) => db.prepare('INSERT INTO tip_payments(owed_id, company_id, store_id, user_id, amount_cents, paid_on, by_user, by_name, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(owedId, company, store, u.id, amount * 100, ago(n), by?.id ?? null, by?.name ?? null, t);
  if (marisol) {
    const ids = new Map();
    for (const [n, part, h, cash, card, out, note] of MARISOL) ids.set(`${n}${part}`, shift(marisol, n, part, h, cash, card, out, note));
    owe(marisol, ids.get('1dinner'), 1, 'dinner', 'card', REASONS.card, 54);
    const party = owe(marisol, ids.get('4dinner'), 4, 'dinner', 'other', 'Private party gratuity', 60, 'Split from the 7:30 party, paid later');
    pay(marisol, party, 40, 2, marisol);
    pay(marisol, owe(marisol, ids.get('6dinner'), 6, 'dinner', 'drawer', REASONS.drawer, 45), 45, 5, marisol);
    pay(marisol, owe(marisol, ids.get('13dinner'), 13, 'dinner', 'card', REASONS.card, 32), 32, 12, marisol);
    if (!employeeDemo) owe(marisol, shift(marisol, 0, 'dinner', 6, 64, 231, 29, 'Busy close'), 0, 'dinner', 'cash', REASONS.cash, 40, 'House was short on cash at close');
  }
  const dorian = who('Dorian Pike'), teddy = who('Teddy Lam'), quinn = who('Quinn Abbott');
  if (dorian) owe(dorian, shift(dorian, 3, 'dinner', 7, 88, 236, 0, null, 'Bartender'), 3, 'dinner', 'card', REASONS.card, 42);
  if (teddy) owe(teddy, shift(teddy, 2, 'dinner', 6, 49, 160, 21), 2, 'dinner', 'drawer', REASONS.drawer, 25);
  if (quinn) pay(quinn, owe(quinn, shift(quinn, 4, 'dinner', 7.5, 102, 288, 0, null, 'Bartender'), 4, 'dinner', 'card', REASONS.card, 30), 30, 3, rosalind);
}
