// Job paths (Nov 8, Tommy: "Let's work on the job paths … much more interested in this being more of a training platform").
// Figma: 09 · Proposals → 21 · Mise structure + job paths. Plan: vault › Apps/The Baldwin Training Book/(C) Mise — Structure + Job Paths.
//
//   • One path per job. A person can hold more than one job.
//   • A path is stages with a due day, counted from the person's first day.
//   • Four kinds of step: read a page, pass a quiz (80%), finish a program lesson, or get a manager's sign-off.
//   • Paths borrow from the programs (Tommy: "if they've completed it, it counts towards their regular [Sommelier] training"):
//     a Sommelier lesson in a path is the same lesson, so finishing it in either place ticks it in both.
//   • Steps are only ever things the book already has; a step whose page or quiz isn't in this store's book is left out.
import { chapterBySlug, allChapters, chaptersOf, programOf, LEVELS, programDef, isProgram } from './manual.mjs';
import { lessonSlug, doneKey } from './study.mjs';
import { passFor, PASS_PCT } from './quizgen.mjs';

export const JOBS = [
  { key: 'server', label: 'Server' },
  { key: 'bartender', label: 'Bartender' },
  { key: 'host', label: 'Host' },
  { key: 'support', label: 'Support', note: 'Bussers and runners' },
];
const JOB_KEYS = new Set(JOBS.map((j) => j.key));
export const validJobs = (list) => [...new Set((Array.isArray(list) ? list : []).map(String))].filter((k) => JOB_KEYS.has(k));

const read = (slug) => ({ kind: 'read', slug });
const quiz = (id) => ({ kind: 'quiz', id });
const group = (name) => ({ kind: 'quizzes', group: name }); // every quiz in a catalog group (this store's menu)
const lesson = (key) => ({ kind: 'lesson', key });
const sign = (key, title, how) => ({ kind: 'signoff', key, title, how });

/** Mise's starting path for each job. The steps name what's in the book; each store's menu fills in the quizzes. */
const PATHS = {
  server: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('steps-of-service'), read('safety'), read('cleanliness'), read('floor-plan'), read('allergen-guide'), quiz('t:allergens')] },
    { key: 'week-1', title: 'Week 1 · The menu', day: 7, steps: [group('food'), sign('table-talk', 'Talk through three dishes at a table', 'A manager listens and signs you off')] },
    { key: 'week-2', title: 'Week 2 · The bar and wine', day: 14, steps: [lesson('bar-serving#0'), lesson('bar-serving#2'), group('bar-menu'), group('wine'), lesson('on-the-floor#1'), lesson('on-the-floor#7')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · On the floor', day: 28, steps: [sign('shadow', 'Shadow a full shift', 'Work a shift beside a trainer'), sign('wine-at-table', 'Open and pour wine at a table', 'A manager watches the full service'), sign('floor', 'Floor sign-off', 'Your manager signs you off for the floor')] },
  ],
  bartender: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('steps-of-service'), read('safety'), read('cleanliness'), read('allergen-guide'), quiz('t:allergens')] },
    { key: 'week-1', title: 'Week 1 · Our cocktails', day: 7, steps: [lesson('bar-our-menu#0'), lesson('bar-glass-ice-garnish#3'), read('the-bar/cocktail-specs'), group('specs-menu'), sign('build-three', 'Build three menu cocktails', 'A manager watches the builds and tastes them')] },
    { key: 'week-2', title: 'Week 2 · Back bar, wine and food', day: 14, steps: [lesson('bar-vodka-gin#2'), lesson('bar-american-whiskey#1'), lesson('bar-liqueurs#2'), read('the-bar/back-bar'), quiz('t:spec:classic-off'), group('wine'), group('food'), lesson('on-the-floor#1')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · Behind the bar', day: 28, steps: [sign('shadow', 'Shadow a bar shift', 'Work a shift beside a bartender'), sign('bar', 'Bar sign-off', 'Your manager signs you off for the bar')] },
  ],
  host: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('step-1/greet'), read('step-9/goodbye'), read('floor-plan'), read('safety'), read('allergen-guide'), quiz('t:allergens')] },
    { key: 'week-1', title: 'Week 1 · The menu, for questions at the door', day: 7, steps: [group('food'), sign('door', 'Run the door for a shift', 'A manager watches and signs you off')] },
  ],
  support: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('safety'), read('cleanliness'), read('floor-plan'), read('step-4/fire-and-run'), read('step-6/clear'), read('allergen-guide'), quiz('t:allergens')] },
    { key: 'week-1', title: 'Week 1 · Every dish you run', day: 7, steps: [group('food'), sign('run-food', 'Run food for a shift', 'Name every dish at the table; a manager signs you off')] },
  ],
};

/** The quizzes a group step stands for, from this store's quiz catalog. */
function groupQuizzes(name, quizzes) {
  const inGroup = (g) => quizzes.filter((q) => q.group === g);
  if (name === 'food') return inGroup('Food');
  if (name === 'wine') return quizzes.filter((q) => /^t:wine-/.test(q.id));
  if (name === 'bar-menu') return inGroup('Bar').filter((q) => !/^t:(wine-|classic-off)/.test(q.id));
  if (name === 'specs-menu') return inGroup('Cocktail Specs · For Bartenders').filter((q) => q.id !== 't:spec:classic-off');
  return [];
}
const PROGRAM_LEVEL = programOf;

/** A job's path for this store: stages with concrete steps (left out when this store's book doesn't have them). */
export function pathFor(job, { quizzes, slugs, titles }) {
  const byId = new Map(quizzes.map((q) => [q.id, q]));
  const qStep = (q) => ({ id: q.id, kind: 'quiz', title: q.title, meta: `${q.count} questions · pass with ${PASS_PCT}%`, to: `/quizzes?quiz=${encodeURIComponent(q.id)}` });
  return (PATHS[job] || []).map((st) => {
    const steps = [];
    for (const s of st.steps) {
      if (s.kind === 'read' && slugs.has(s.slug)) steps.push({ id: 'page:' + s.slug, kind: 'read', title: titles.get(s.slug) || s.slug, meta: 'Read it, then mark it read', to: '/' + s.slug });
      else if (s.kind === 'quiz' && byId.has(s.id)) steps.push(qStep(byId.get(s.id)));
      else if (s.kind === 'quizzes') steps.push(...groupQuizzes(s.group, quizzes).map(qStep));
      else if (s.kind === 'lesson') {
        const [slug, i] = s.key.split('#'); const ch = chapterBySlug(slug); const sec = ch?.sections[Number(i)];
        if (sec) steps.push({ id: 'lesson:' + s.key, kind: 'lesson', key: s.key, title: sec.name, meta: `${PROGRAM_LEVEL(ch)} lesson · counts there too`, program: PROGRAM_LEVEL(ch), to: '/' + lessonSlug(ch, Number(i)) });
      } else if (s.kind === 'signoff') steps.push({ id: `path:${job}:${s.key}`, kind: 'signoff', title: s.title, meta: s.how });
    }
    return { key: st.key, title: st.title, day: st.day, steps: dedupe(steps) };
  }).filter((st) => st.steps.length);
}
const dedupe = (steps) => { const seen = new Set(); return steps.filter((s) => (seen.has(s.id) ? false : seen.add(s.id))); };

/** Everything a person has finished that a path can count: page reads, lessons, quiz passes, sign-offs. */
function doneFor(db, store, userId) {
  const reads = new Map(db.prepare('SELECT slug, at FROM manual_reads WHERE user_id = ?').all(userId).map((r) => [r.slug, r.at]));
  const quizzes = new Map();
  for (const r of db.prepare('SELECT quiz, score, total, at FROM quiz_attempts WHERE user_id = ? AND store_id = ? ORDER BY at').all(userId, store)) {
    const q = quizzes.get(r.quiz) || { best: 0, total: r.total, tries: 0, passedAt: null };
    q.tries++;
    if (r.score / r.total >= q.best / q.total) { q.best = r.score; q.total = r.total; }
    if (!q.passedAt && r.score >= passFor(r.total)) q.passedAt = r.at;
    quizzes.set(r.quiz, q);
  }
  const signs = new Map(db.prepare("SELECT s.quiz, s.at, u.name by_name FROM signoffs s LEFT JOIN users u ON u.id = s.by_user WHERE s.device = ? AND s.store_id = ?").all('u' + userId, store).map((r) => [r.quiz, { at: r.at, by: r.by_name }]));
  return { reads, quizzes, signs };
}

const DAY = 864e5;
const dayOf = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
const today = () => dayOf(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }));
export const startOf = (u) => String(u.started_on || u.created_at || new Date().toISOString()).slice(0, 10);

/** One person's path for one job, with what's done, what's due and what's next. */
function progressFor(stages, done, startedOn) {
  const start = dayOf(startedOn), now = today();
  let next = null, total = 0, finished = 0, late = 0;
  const out = stages.map((st) => {
    const due = new Date(start.getTime() + st.day * DAY);
    const steps = st.steps.map((s) => {
      let ok = false, at = null, result = null, by = null;
      if (s.kind === 'read') { at = done.reads.get(s.id) || null; ok = !!at; }
      else if (s.kind === 'lesson') { at = done.reads.get(s.key) || null; ok = !!at; }
      else if (s.kind === 'quiz') {
        const q = done.quizzes.get(s.id); const sg = done.signs.get(s.id);
        if (q) result = `${Math.round((q.best / q.total) * 100)}%`;
        ok = !!(q?.passedAt || sg); at = q?.passedAt || sg?.at || null;
      } else if (s.kind === 'signoff') { const sg = done.signs.get(s.id); ok = !!sg; at = sg?.at || null; by = sg?.by || null; }
      return { ...s, done: ok, at, result, by };
    });
    const k = steps.filter((s) => s.done).length;
    total += steps.length; finished += k;
    const overdue = due < now ? steps.length - k : 0;
    late += overdue;
    if (!next) next = steps.find((s) => !s.done && s.kind !== 'signoff') || null;
    return { key: st.key, title: st.title, due: due.toISOString().slice(0, 10), done: k, total: steps.length, late: overdue, steps };
  });
  if (!next) for (const st of out) { next = st.steps.find((s) => !s.done) || null; if (next) break; }
  // The stage you're on: the first one with anything left.
  const current = out.find((st) => st.done < st.total)?.key || null;
  for (const st of out) st.state = st.done === st.total ? 'done' : st.key === current ? 'now' : 'later';
  const lastDay = stages.length ? Math.max(...stages.map((s) => s.day)) : 0;
  const days = Math.max(0, Math.round((now - start) / DAY));
  return {
    stages: out, done: finished, total, late, next, current,
    week: Math.min(Math.floor(days / 7) + 1, Math.max(1, Math.ceil(lastDay / 7))), weeks: Math.max(1, Math.ceil(lastDay / 7)),
    status: total && finished === total ? 'done' : late ? 'behind' : 'on-track',
  };
}

/** How far someone is in the Sommelier levels, counting lessons done anywhere (a path or the program). */
function programsFor(done, paths) {
  const inPath = new Set(paths.flatMap((p) => p.stages.flatMap((st) => st.steps.filter((s) => s.kind === 'lesson').map((s) => s.key))));
  const out = [];
  // The Cocktail and Beer Programs first: they're the ones most of the floor takes. Each level shows its final and practical.
  for (const L of LEVELS) {
    const bar = chaptersOf(L.program, L.level).flatMap((c) => c.sections.map((_, i) => doneKey(c, i)));
    if (!bar.length) continue;
    const fin = done.quizzes.get('t:' + L.final); const pr = L.practical && done.signs.get(L.practical);
    out.push({ title: `${programDef(L.program).name} · Level ${L.level}`, cert: L.title, certKey: L.file, to: '/' + L.slug, total: bar.length, done: bar.filter((k) => done.reads.has(k)).length, inPath: bar.filter((k) => inPath.has(k)).length,
      final: { id: 't:' + L.final, passedAt: fin?.passedAt || null, best: fin ? `${Math.round((fin.best / fin.total) * 100)}%` : null },
      ...(L.practical ? { practical: { key: L.practical, title: L.practicalTitle, how: L.practicalHow, at: pr?.at || null, by: pr?.by || null } } : {}),
      certified: !!(fin?.passedAt && (!L.practical || pr)) });
  }
  for (const level of [1, 2]) {
    const chs = allChapters().filter((c) => !isProgram(c) && (c.level || 1) === level);
    const keys = chs.flatMap((c) => c.sections.map((_, i) => doneKey(c, i)));
    if (!keys.length) continue;
    out.push({ title: `Sommelier · Level ${level}`, to: level === 1 ? '/sommelier-program/level-1' : '/sommelier-program/level-2', total: keys.length,
      done: keys.filter((k) => done.reads.has(k)).length, inPath: keys.filter((k) => inPath.has(k)).length });
  }
  return out;
}

/** Everything the My Path page needs for one person. */
export function personPath(db, store, user, ctx) {
  const jobs = validJobs(safeJson(user.jobs));
  const done = doneFor(db, store, user.id);
  const startedOn = startOf(user);
  const paths = jobs.map((job) => ({ job, label: JOBS.find((j) => j.key === job).label, ...progressFor(pathFor(job, ctx), done, startedOn) }));
  return { jobs, startedOn, paths, programs: programsFor(done, paths), allJobs: JOBS };
}
/** One line per person for the manager's Training list. */
export function personSummary(db, store, user, ctx) {
  const p = personPath(db, store, user, ctx);
  const sum = (k) => p.paths.reduce((n, x) => n + x[k], 0);
  return { id: user.id, name: user.name, jobs: p.jobs, startedOn: p.startedOn, done: sum('done'), total: sum('total'), late: sum('late'),
    status: !p.paths.length ? 'no-job' : p.paths.every((x) => x.status === 'done') ? 'done' : p.paths.some((x) => x.status === 'behind') ? 'behind' : 'on-track',
    next: p.paths.map((x) => x.next).find(Boolean) || null, week: p.paths[0]?.week || null, weeks: p.paths[0]?.weeks || null };
}
/** Is this a sign-off step in one of this person's paths, or a program's practical (Cocktail Program Level 2)? */
export const isPathSignoff = (user, key) => LEVELS.some((L) => L.practical === key) || validJobs(safeJson(user.jobs)).some((job) => (PATHS[job] || []).some((st) => st.steps.some((s) => s.kind === 'signoff' && `path:${job}:${s.key}` === key)));
const safeJson = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
