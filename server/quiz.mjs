// Quizzes. Questions are written from the book (quizgen.mjs); the server scores every attempt itself.
// The old hand-written bank (content/quizzes.json) only names old results now.
import fs from 'node:fs';
import path from 'node:path';
import { questionPool, topicList, forTopics, pick, passFor, PASS_PCT, BUILT_IN, SPEC_TOPICS, barOnly } from './quizgen.mjs';
import { listEntries, COURSES } from './cms.mjs';
import { chapterBySlug, BAR_LEVELS } from './manual.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/quizzes.json'), 'utf8'));
const LEGACY = new Map(BANK.quizzes.map((q) => [q.id, q.title]));
export const PRE_SHIFT = 'pre-shift';
/** The review queue: questions this person marked red or yellow. */
export const REVIEW = 'review';
export const MARKS = ['red', 'yellow', 'green'];
const REVIEW_LEN = 20;
const BUILT_IN_LEN = 10, PRE_SHIFT_LEN = 5, FINAL_LEN = 60; // a program level's final exam: 60 questions
// Nov 8: Certified Bar Server's final is 30 questions (like WSET Spirits Level 1); Certified Bartender's is 60.
const finalLen = (key) => BAR_LEVELS.find((L) => L.final === key)?.len || FINAL_LEN;

/** Team quizzes a manager saved: a name, its topics and its length. */
export function teamSets(db, store) {
  return db.prepare('SELECT * FROM quiz_sets WHERE store_id = ? AND archived_at IS NULL ORDER BY id').all(store)
    .map((r) => ({ id: 's:' + r.id, title: r.name, kind: 'team', topics: JSON.parse(r.topics), count: r.count }));
}

/** Everything the Quizzes page needs: topics to pick from, built-in and team quizzes. */
export function catalog(db, store) {
  const pool = questionPool(db, store);
  const topics = topicList(pool);
  const photoFor = (key) => {
    if (key.startsWith('spec:')) key = key.slice(5); // a specs quiz shows the same drink as its list
    const col = key.startsWith('course:') ? 'recipe' : ['specialty', 'brg', 'mules', 'dessert', 'spiritless', 'house'].includes(key) ? 'house' : key === 'classic' || key === 'classic-off' ? 'classic' : key === 'classic-on' ? 'house' : null;
    if (!col) return null;
    const section = { 'classic-on': 'Classics', specialty: 'Specialty Cocktails', brg: 'BRG Staples', mules: 'Mules', dessert: 'Dessert Cocktails', spiritless: 'Spiritless Cocktails' }[key];
    const list = listEntries(db, col, col === 'classic' ? null : store).filter((e) => e.data.photo && (!key.startsWith('course:') || e.data.course === key.slice(7)) && (!section || e.data.menuSection === section) && (key !== 'house' || !['Specialty Cocktails', 'BRG Staples', 'Classics', 'Mules', 'Dessert Cocktails', 'Spiritless Cocktails'].includes(e.data.menuSection)));
    return list[0]?.data.photo || null;
  };
  // Nov 5, Tommy: "no som quizzes in the sign off sections". Every quiz carries its group (Food, Bar, Know it cold,
  // Sommelier Study Guide, Sommelier Level 2) so the sign-off list is sectioned like the builder. A chapter's sign-off
  // is the whole chapter (every card), with its lesson video as the picture.
  const studyPhoto = (key) => { const ch = key.startsWith('study:') && chapterBySlug(key.slice(6)); if (!ch) return null; const v = ch.v3?.video?.youtubeId || (ch.v3?.sections || []).find((x) => x.video?.youtubeId)?.video.youtubeId; return v ? `https://i.ytimg.com/vi/${v}/mqdefault.jpg` : null; };
  const builtins = topics.filter((t) => BUILT_IN(t.key)).map((t) => ({ id: 't:' + t.key, title: t.label, kind: 'builtin', group: t.group, topics: [t.key], count: t.key.startsWith('study:') ? t.count : t.key.startsWith('final:') ? Math.min(finalLen(t.key), t.count) : Math.min(BUILT_IN_LEN, t.count), photo: photoFor(t.key) || studyPhoto(t.key) }));
  const team = teamSets(db, store).map((q) => ({ ...q, group: 'Team Quizzes', count: Math.min(q.count || Infinity, forTopics(pool, q.topics).length), photo: photoFor(q.topics[0]) }));
  return { passPct: PASS_PCT, topics, quizzes: [...builtins, ...team], preShift: { id: PRE_SHIFT, title: 'Quick Quiz', count: PRE_SHIFT_LEN } };
}

/** What a quiz id asks about: a built-in topic, a team quiz's topics, or a custom mix. null = not a quiz. */
function topicsOf(db, store, id) {
  if (id === PRE_SHIFT) return { title: 'Quick Quiz', topics: null, count: PRE_SHIFT_LEN };
  if (id === REVIEW) return { title: 'Review Queue', topics: null, count: REVIEW_LEN };
  let m;
  if ((m = /^t:(.+)$/.exec(id))) { const t = m[1]; return BUILT_IN(t) ? { title: labelOf(t), topics: [t], count: t.startsWith('study:') ? 100 : t.startsWith('final:') ? finalLen(t) : BUILT_IN_LEN } : null; }
  if ((m = /^s:(\d+)$/.exec(id))) { const r = db.prepare('SELECT * FROM quiz_sets WHERE id = ? AND store_id = ?').get(Number(m[1]), store); return r ? { title: r.name, topics: JSON.parse(r.topics), count: r.count || Infinity } : null; }
  // Nov 5: topics like "course:Mains" and "study:france" have a colon in them; the count is whatever follows the last one.
  // (Before, any pick with a course or a chapter came back "We couldn't find that quiz".)
  if ((m = /^c:(.+):(\d+)$/.exec(id))) { const topics = m[1].split('+').filter(Boolean); return { title: 'Your Quiz', topics, count: Number(m[2]) === 0 ? Infinity : Math.min(100, Number(m[2])) }; } // 0 = every question (Nov 5: "full quiz")
  return null;
}
export function labelOf(key) {
  const L = { 'classic-on': 'Classic Cocktails on the Menu', 'classic-off': 'Classic Cocktails off the Menu', specialty: 'Specialty Cocktails', brg: 'BRG Favorites', mules: 'Mules', dessert: 'Dessert Cocktails', spiritless: 'Spiritless Cocktails', house: 'House Cocktails', classic: 'Classic Cocktails', 'wine-glass': 'Wine by the Glass', 'wine-bottle': 'Wine by the Bottle', beer: 'Beer', allergens: 'Allergens', pairings: 'Pairings' };
  if (key.startsWith('spec:')) return SPEC_TOPICS.find(([k]) => k === key)?.[1] || key;
  { const L = BAR_LEVELS.find((x) => x.final === key); if (L) return `${L.title} · Final Exam`; }
  if (key.startsWith('study:')) { const ch = chapterBySlug(key.slice(6)); return ch ? `${ch.program === 'bar' ? `Cocktail Program L${ch.barLevel || 1}` : 'Study Guide'} · ${ch.title}` : key; }
  return key.startsWith('course:') ? key.slice(7) : L[key] || key;
}
export const customId = (topics, count) => `c:${[...new Set(topics)].sort().join('+')}:${count}`;

/** A fresh attempt: the questions, with answers (the phone shows feedback right away; the server re-scores).
 *  Questions rotate (Nov 5): someone signed in gets questions they haven't had in this quiz yet, until every one has come up;
 *  then a new round starts. `fresh` (Start Over) starts a new round now. */
export function startQuiz(db, store, id, userId = null, { fresh = false } = {}) {
  const def = topicsOf(db, store, id);
  if (!def) return null;
  const all = questionPool(db, store);
  // The Quick Quiz is for everyone, so bartender-only questions (amounts, ice) stay out of it.
  const pool = id === PRE_SHIFT ? all.filter((q) => !barOnly(q)) : all;
  const deck = id !== REVIEW && userId ? rotation(db, store, userId, id, fresh) : null;
  // Picks n from a list, questions not yet seen this round first; a short round is topped up from the next one.
  const draw = (list, n) => {
    if (!deck) return pick(list, n);
    const unseen = list.filter((q) => !deck.seen.has(q.ref));
    if (unseen.length >= n) return pick(unseen, n);
    deck.reset();
    return [...pick(unseen, unseen.length), ...pick(list.filter((q) => !unseen.includes(q)), n - unseen.length)];
  };
  let qs;
  if (id === REVIEW) {
    if (!userId) return null;
    const byRef = new Map(pool.map((q) => [q.ref, q]));
    qs = reviewRows(db, store, userId, byRef).filter((r) => r.mark !== 'green').slice(0, REVIEW_LEN).map((r) => byRef.get(r.ref));
  } else if (id === PRE_SHIFT) {
    // Tonight's focus (the signature dish) twice, then anything.
    const recipes = listEntries(db, 'recipe', store);
    const focus = recipes.find((e) => e.data.signature) || recipes.find((e) => e.data.course === 'Mains') || recipes[0];
    const mine = focus ? draw(pool.filter((q) => q.ref.endsWith(':' + focus.id) && q.topics.some((t) => t.startsWith('course:'))), 2) : [];
    qs = [...mine, ...draw(pool.filter((q) => !mine.includes(q)), PRE_SHIFT_LEN - mine.length)];
    qs = pick(qs, qs.length);
  } else {
    const list = forTopics(pool, def.topics);
    qs = def.count >= list.length ? pick(list, list.length) : draw(list, def.count);
  }
  if (!qs.length) return null;
  if (deck) deck.add(qs.map((q) => q.ref));
  return { id, title: def.title, items: qs.map((q) => q.ref), questions: Object.fromEntries(qs.map((q) => [q.ref, { q: q.q, options: q.options, answer: q.answer, why: q.why, page: q.page, label: q.label }])) };
}

/** The questions this person has had in this quiz this round. */
function rotation(db, store, userId, quiz, fresh) {
  const clear = () => db.prepare('DELETE FROM quiz_seen WHERE user_id = ? AND store_id = ? AND quiz = ?').run(userId, store, quiz);
  if (fresh) clear();
  const seen = new Set(db.prepare('SELECT ref FROM quiz_seen WHERE user_id = ? AND store_id = ? AND quiz = ?').all(userId, store, quiz).map((r) => r.ref));
  return {
    seen,
    reset: () => { clear(); seen.clear(); },
    add: (refs) => {
      const ins = db.prepare('INSERT OR IGNORE INTO quiz_seen(user_id, store_id, quiz, ref, at) VALUES (?,?,?,?,?)');
      const at = new Date().toISOString();
      for (const r of refs) ins.run(userId, store, quiz, r, at);
    },
  };
}

/* ---- the review queue ---- */
/** This person's marks that still match a question (red first, then yellow; oldest first). */
function reviewRows(db, store, userId, byRef) {
  const order = { red: 0, yellow: 1, green: 2 };
  return db.prepare('SELECT ref, mark, at FROM quiz_marks WHERE user_id = ? AND store_id = ?').all(userId, store)
    .filter((r) => byRef.has(r.ref))
    .sort((a, b) => order[a.mark] - order[b.mark] || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
/** Counts per colour and the next few questions to work on. */
export function reviewQueue(db, store, userId) {
  const byRef = new Map(questionPool(db, store).map((q) => [q.ref, q]));
  const rows = reviewRows(db, store, userId, byRef);
  const counts = { red: 0, yellow: 0, green: 0 };
  for (const r of rows) counts[r.mark]++;
  const open = rows.filter((r) => r.mark !== 'green');
  return {
    counts, total: open.length, practice: Math.min(REVIEW_LEN, open.length),
    next: open.slice(0, 3).map((r) => { const q = byRef.get(r.ref); return { ref: r.ref, mark: r.mark, q: q.q, topic: labelOf(q.topics[q.topics.length > 1 && q.topics[1] !== 'pairings' ? 1 : 0]) }; }),
  };
}
/** Saves how well someone knows a question. Only questions this store's book can ask. */
export function setMark(db, store, userId, ref, mark) {
  if (!MARKS.includes(mark)) return false;
  if (!questionPool(db, store).some((q) => q.ref === ref)) return false;
  db.prepare('INSERT INTO quiz_marks(user_id, store_id, ref, mark, at) VALUES (?,?,?,?,?) ON CONFLICT(user_id, store_id, ref) DO UPDATE SET mark = excluded.mark, at = excluded.at')
    .run(userId, store, ref, mark, new Date().toISOString());
  return true;
}

/** Scores an attempt from scratch: every question must exist and belong to the quiz. */
export function score(db, store, quiz, items, answers) {
  const def = topicsOf(db, store, quiz);
  if (!def || !Array.isArray(items) || !Array.isArray(answers) || !items.length || items.length > 1000 || answers.length !== items.length) return null;
  const pool = new Map(questionPool(db, store).map((q) => [q.ref, q]));
  let right = 0;
  for (let i = 0; i < items.length; i++) {
    const q = pool.get(String(items[i]));
    if (!q) return null;
    if (def.topics && !q.topics.some((t) => def.topics.includes(t))) return null;
    if (Number(answers[i]) === q.answer) right++;
  }
  return { score: right, total: items.length, passed: right >= passFor(items.length) };
}

/** A quiz id a manager can sign someone off on (built-in, team, or an old hand-written one). */
export const signable = (db, store, id) => LEGACY.has(id) || (/^(t:|s:)/.test(id) && !!topicsOf(db, store, id));
export const titleFor = (db, store, id) => LEGACY.get(id) || topicsOf(db, store, id)?.title || 'Custom quiz';

/** Everyone in a store who has taken a quiz. */
export function results(db, storeId = 1) {
  const rows = db.prepare('SELECT device, name, quiz, score, total, at FROM quiz_attempts WHERE store_id = ? ORDER BY at').all(storeId);
  const signs = db.prepare('SELECT s.device, s.quiz, s.at, u.name by_name FROM signoffs s LEFT JOIN users u ON u.id = s.by_user WHERE s.store_id = ?').all(storeId);
  const people = new Map();
  for (const r of rows) {
    const p = people.get(r.device) || { device: r.device, name: r.name, lastAt: r.at, quizzes: {}, signoffs: {} };
    p.name = r.name; p.lastAt = r.at;
    const q = p.quizzes[r.quiz] || { best: 0, total: r.total, attempts: 0, lastAt: r.at, title: titleFor(db, storeId, r.quiz) };
    q.attempts++; q.lastAt = r.at;
    if (r.score / r.total >= q.best / q.total) { q.best = r.score; q.total = r.total; }
    p.quizzes[r.quiz] = q;
    people.set(r.device, p);
  }
  for (const s of signs) { const p = people.get(s.device); if (p) p.signoffs[s.quiz] = { at: s.at, by: s.by_name }; }
  return [...people.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}
void COURSES;
