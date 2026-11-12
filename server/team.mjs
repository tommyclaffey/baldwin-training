// Manager home + People (Nov 11). Figma: 09 · Proposals → 24 · Manager home (523:276) and People (532:274).
// Tommy, Nov 10: "actions happen on the row where the person shows up, not in a backend table."
//
//   • The team list: everyone on staff in the store you're working in, with their path progress, what's next and a status.
//   • Sign-offs waiting on you: steps a person asked you to watch (My Path → Ask for a Sign-Off), signed off or "Not Yet".
//   • Give More Time moves a late step's due date; Send a Reminder leaves a note on their My Path.
//   • Everything is per store: a store manager only ever sees and acts on their own store's staff (index.mjs checks that).
import { fullIndex, withStore, sidebarCounts } from './content.mjs';
import { catalog as quizCatalog, labelOf, teamSets } from './quiz.mjs';
import { personPath, JOBS, isPathSignoff, today } from './paths.mjs';
import { certificatesFor } from './certs.mjs';
import { questionPool } from './quizgen.mjs';
import { listEntries, COLLECTIONS } from './cms.mjs';
import { LEVELS } from './manual.mjs';

const DAY = 864e5;
const ymd = (d) => d.toISOString().slice(0, 10);
export const todayIso = () => ymd(today());
export const addDays = (iso, n) => ymd(new Date(new Date(iso.slice(0, 10) + 'T12:00:00Z').getTime() + n * DAY));
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const jobLabel = (jobs) => jobs.map((j) => JOBS.find((x) => x.key === j)?.label || j).join(' + ');

/** What a path needs from this store's book: its built-in quizzes and the pages it has. */
export function pathCtxFor(db, storeRow, user = null) {
  const idx = withStore(storeRow, () => fullIndex(db, { text: false }), user); // addresses and titles only
  return { quizzes: quizCatalog(db, storeRow?.id ?? 1).quizzes.filter((q) => q.kind === 'builtin'), slugs: new Set(idx.map((e) => e.slug)), titles: new Map(idx.map((e) => [e.slug, e.title])) };
}

export const staffOf = (db, company, store) => db.prepare("SELECT * FROM users WHERE company_id = ? AND store_id = ? AND role = 'staff' AND deleted_at IS NULL ORDER BY name COLLATE NOCASE").all(company, store);

/** A program practical's title as a sign-off line: "Level 2 practical: build from our specs". */
const practicalLine = (L) => `Level ${L.level} practical: ${L.practicalTitle.charAt(0).toLowerCase()}${L.practicalTitle.slice(1)}`;

/** Every sign-off this person has asked for and is still waiting on (not signed, not turned down). */
function openAsks(p) {
  const out = [];
  for (const path of p.paths) for (const st of path.stages) for (const s of st.steps) if (s.ask && !s.ask.declinedAt) out.push({ key: s.id, title: s.title, at: s.ask.at });
  for (const g of p.programs) {
    if (!g.practical?.ask || g.practical.ask.declinedAt || g.practical.at) continue;
    const L = LEVELS.find((x) => x.practical === g.practical.key);
    if (L && !out.some((x) => x.key === L.practical)) out.push({ key: L.practical, title: practicalLine(L), at: g.practical.ask.at, program: g.title });
  }
  return out;
}

const STATUS_RANK = { behind: 0, new: 1, 'on-track': 2, 'no-job': 3, done: 4 };

/** One person on the team list: progress, status, and the one thing to look at next. */
export function personRow(db, store, x, ctx) {
  const p = personPath(db, store, x, ctx);
  const steps = p.paths.flatMap((path) => path.stages.flatMap((st) => st.steps.map((s) => ({ ...s, stage: st.title }))));
  const done = steps.filter((s) => s.done).length;
  const late = steps.filter((s) => s.late);
  const asks = openAsks(p);
  const t = todayIso();
  const isNew = p.startedOn >= addDays(t, -1); // just started, or starts soon
  const status = !p.paths.length ? 'no-job' : late.length ? 'behind' : done === steps.length ? 'done' : isNew ? 'new' : 'on-track';
  const oldest = [...late].sort((a, b) => a.due.localeCompare(b.due))[0];
  const upcoming = steps.find((s) => !s.done && (s.kind !== 'signoff' || (s.ack && !s.ack.signed))) || steps.find((s) => !s.done && !s.ask);
  const pick = oldest || (!asks.length ? upcoming : null);
  const next = pick ? { id: pick.id, title: pick.title, kind: pick.kind, due: pick.due, late: !!pick.late, stage: pick.stage } : asks.length ? { waiting: true } : null;
  const path = p.paths[0];
  return {
    row: { id: x.id, name: x.name, initials: initials(x.name), jobs: p.jobs, jobLabel: jobLabel(p.jobs), startedOn: p.startedOn, done, total: steps.length, late: late.length,
      status, next, week: path?.week ?? null, weeks: path?.weeks ?? null, asks: asks.length, lastSeenAt: x.last_seen_at || null },
    path: p, asks,
  };
}

/** The team in the store you're working in, behind first. */
export function teamRows(db, company, storeRow, ctx) {
  const all = staffOf(db, company, storeRow.id).map((x) => ({ user: x, ...personRow(db, storeRow.id, x, ctx) }));
  all.sort((a, b) => STATUS_RANK[a.row.status] - STATUS_RANK[b.row.status] || a.row.name.localeCompare(b.row.name));
  return all;
}

/** Sign-offs waiting on a manager, newest ask first. */
export function signoffQueue(rows) {
  return rows.flatMap((r) => r.asks.map((a) => ({ userId: r.row.id, name: r.row.name, initials: r.row.initials, jobLabel: r.row.jobLabel, key: a.key, title: a.title, at: a.at })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** This week's quizzes in the store: how many, the average, retakes, and the question most people got wrong. */
export function quizWeek(db, store) {
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const rows = db.prepare('SELECT user_id, quiz, score, total, answers, at FROM quiz_attempts WHERE store_id = ? AND at >= ? AND total > 0').all(store, since);
  const retakes = db.prepare('SELECT COUNT(*) n FROM quiz_attempts a WHERE a.store_id = ? AND a.at >= ? AND EXISTS (SELECT 1 FROM quiz_attempts b WHERE b.store_id = a.store_id AND b.user_id = a.user_id AND b.quiz = a.quiz AND b.at < a.at)').get(store, since).n;
  const average = rows.length ? Math.round((rows.reduce((n, r) => n + r.score / r.total, 0) / rows.length) * 100) : null;
  // Most missed: from the answers saved with each attempt (only questions at least three people were asked).
  const tally = new Map();
  let pool = null;
  for (const r of rows) {
    let a; try { a = JSON.parse(r.answers || '{}'); } catch { continue; }
    if (!Array.isArray(a.items) || !a.items.length) continue;
    pool ||= new Map(questionPool(db, store).map((q) => [q.ref, q]));
    a.items.forEach((ref, i) => {
      const q = pool.get(String(ref)); if (!q) return;
      const t = tally.get(q.ref) || { q, asked: 0, right: 0 };
      t.asked++; if (Number(a.answers?.[i]) === q.answer) t.right++;
      tally.set(q.ref, t);
    });
  }
  const worst = [...tally.values()].filter((t) => t.asked >= 3 && t.right < t.asked).sort((a, b) => a.right / a.asked - b.right / b.asked || b.asked - a.asked)[0];
  const topic = worst && (worst.q.topics.find((k) => !k.startsWith('final:') && !k.startsWith('study:')) || worst.q.topics[0]);
  return {
    taken: rows.length, average, retakes,
    missed: worst ? { q: worst.q.q, pct: Math.round((worst.right / worst.asked) * 100), asked: worst.asked, topic, topicLabel: topic ? labelOf(topic) : 'Quiz' } : null,
    teamQuizzes: teamSets(db, store).map((q) => ({ id: q.id, title: q.title })),
  };
}

/** Certificates the team earned in the last week. */
export function newCertificates(db, rows, storeRow) {
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  return rows.flatMap((r) => certificatesFor(db, r.user, storeRow.id, storeRow).filter((c) => String(c.earnedAt) >= since)
    .map((c) => ({ userId: r.row.id, name: r.row.name, initials: r.row.initials, title: c.title, key: c.key, earnedAt: c.earnedAt })))
    .sort((a, b) => String(b.earnedAt).localeCompare(String(a.earnedAt)));
}

/** The last changes to the book by this store's managers (and the owners). */
export function lastEdits(db, company, store) {
  const rows = db.prepare(`SELECT a.action, a.detail, a.at, u.name FROM audit a JOIN users u ON u.id = a.user_id
    WHERE u.company_id = ? AND (u.store_id IS NULL OR u.store_id = ?) AND (a.action LIKE 'edit %' OR a.action LIKE 'add %') AND a.action NOT IN ('add quiz', 'add youtube')
    ORDER BY a.id DESC LIMIT 12`).all(company, store);
  const out = [];
  for (const r of rows) {
    const [verb, col] = r.action.split(' ');
    if (!COLLECTIONS[col] || !r.detail) continue;
    const e = listEntries(db, col, col === 'classic' ? null : store).find((x) => x.data.name === r.detail);
    if (!e) continue; // archived or renamed since: nothing to open
    if (out.some((o) => o.to === '/' + e.slug)) continue;
    out.push({ name: r.detail, what: verb === 'add' ? 'added' : 'edited', by: r.name, at: r.at, to: COLLECTIONS[col].hasPage && !COLLECTIONS[col].hasPage(e.data) ? null : '/' + e.slug });
    if (out.length === 3) break;
  }
  return out;
}

/** The book as tiles: how much is in each list, and where it lives. */
export function bookTiles(db, storeRow, user) {
  const n = (col) => listEntries(db, col, storeRow.id).length;
  const videos = withStore(storeRow, () => sidebarCounts(db), user)['Video Library'] || 0;
  return [
    { key: 'recipe', label: 'Food', count: n('recipe'), unit: 'dishes', to: '/food-matrix' },
    { key: 'house', label: 'House Cocktails', count: n('house'), unit: 'drinks', to: '/the-bar/cocktails' },
    { key: 'shelf', label: 'Back Bar', count: n('shelf'), unit: 'bottles', to: '/the-bar/back-bar' },
    { key: 'wine', label: 'Wine List', count: n('wine'), unit: 'wines', to: '/the-bar/wine' },
    { key: 'videos', label: 'Videos', count: videos, unit: 'to watch', to: '/video-library' },
  ];
}

/** A reminder written from where the person is: the most overdue step, else what's next. */
export function reminderText(row) {
  const n = row.next;
  if (!n || n.waiting) return 'Keep going on your path. Ask me when you’re ready for your sign-off.';
  const what = n.kind === 'quiz' && !/quiz/i.test(n.title) ? `the ${n.title} quiz` : n.title;
  if (n.late) return `Your path has ${what} past due. Try to finish it before your next shift.`;
  return `Next on your path: ${what}.`;
}

/** Leave a note on someone's My Path. A second reminder the same day replaces the first instead of piling up. */
export function addNote(db, { company, store, userId, by, kind, body }) {
  const t = new Date().toISOString();
  const open = db.prepare('SELECT id FROM notes WHERE user_id = ? AND store_id = ? AND kind = ? AND seen_at IS NULL AND at >= ? ORDER BY id DESC LIMIT 1')
    .get(userId, store, kind, todayIso() + 'T00:00:00');
  if (open && kind === 'reminder') db.prepare('UPDATE notes SET body = ?, by_user = ?, at = ? WHERE id = ?').run(body, by, t, open.id);
  else db.prepare('INSERT INTO notes(company_id, store_id, user_id, kind, body, by_user, at) VALUES (?,?,?,?,?,?,?)').run(company, store, userId, kind, body, by, t);
}

/** The step ids in a person's paths (for Give More Time). */
export const pathSteps = (p) => p.paths.flatMap((path) => path.stages.flatMap((st) => st.steps));

export { isPathSignoff, practicalLine };
