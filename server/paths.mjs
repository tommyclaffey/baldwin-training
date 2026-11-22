// Job paths (Nov 8, Tommy: "Let's work on the job paths … much more interested in this being more of a training platform").
// Figma: 09 · Proposals → 21 · Mise structure + job paths. Plan: vault › Apps/The Baldwin Training Book/(C) Mise — Structure + Job Paths.
//
//   • One path per job. A person can hold more than one job.
//   • A path is stages with a due day, counted from the person's first day.
//   • Four kinds of step: read a page, pass a quiz (80%), finish a program lesson, or get a manager's sign-off.
//   • Paths borrow from the programs (Tommy: "if they've completed it, it counts towards their regular [Sommelier] training"):
//     a Sommelier lesson in a path is the same lesson, so finishing it in either place ticks it in both.
//   • Steps are only ever things the book already has; a step whose page or quiz isn't in this store's book is left out.
import { chapterBySlug, allChapters, chaptersOf, chaptersForLevel, programOf, LEVELS, programDef, isProgram } from './manual.mjs';
import { lessonSlug, doneKey } from './study.mjs';
import { passFor, PASS_PCT } from './quizgen.mjs';
import { ACK_KEY, ACK_LEVEL } from './acks.mjs';

export const JOBS = [
  { key: 'server', label: 'Server' },
  { key: 'bartender', label: 'Bartender' },
  { key: 'host', label: 'Host' },
  { key: 'support', label: 'Support', note: 'Bussers and runners' },
  // Nov 16, Tommy: "add the Expo under support … needs to know everything that a runner would need to know, which is food,
  // but they do not need to know the drink side". Food, table numbers, the three-line drops, Hospitality; no cocktails.
  { key: 'expo', label: 'Expo', note: 'Support · runs the pass' },
  // Nov 22 draft (Tommy, Nov 16: "make paths for each position and training material for each position"). Plan: vault ›
  // Apps/The Baldwin Training Book/(C) Mise — Paths for Every Position (Nov 22 2026). NOT LIVE until Tommy approves it.
  // `area` groups the job menu later (front of house / bar / kitchen). `starter: true` = a short path of what the book has
  // today plus a manager's sign-offs, waiting on training material that doesn't exist yet (kitchen lessons, a store's recipes).
  { key: 'server-assistant', label: 'Server Assistant', note: 'Support · water, bread, clears and resets', area: 'foh' },
  { key: 'sommelier', label: 'Sommelier', note: 'Wine steward · wine service on the floor', area: 'foh' },
  { key: 'barback', label: 'Barback', note: 'Bar · stocks, ice, kegs and glassware', area: 'bar' },
  { key: 'bar-lead', label: 'Bar Lead', note: 'Bar · prep, pars and training the bar', area: 'bar' },
  { key: 'line-cook', label: 'Line Cook', note: 'Kitchen · cooks a station', area: 'kitchen', starter: true },
  { key: 'prep', label: 'Prep Cook', note: 'Kitchen · the prep list', area: 'kitchen', starter: true },
  { key: 'dish', label: 'Dishwasher', note: 'Kitchen · the dish pit', area: 'kitchen', starter: true },
  { key: 'sous-chef', label: 'Sous Chef', note: 'Kitchen · runs the line', area: 'kitchen', starter: true },
];
const JOB_KEYS = new Set(JOBS.map((j) => j.key));
export const validJobs = (list) => [...new Set((Array.isArray(list) ? list : []).map(String))].filter((k) => JOB_KEYS.has(k));

const read = (slug) => ({ kind: 'read', slug });
const quiz = (id) => ({ kind: 'quiz', id });
const group = (name) => ({ kind: 'quizzes', group: name }); // every quiz in a catalog group (this store's menu)
const lesson = (key) => ({ kind: 'lesson', key });
const sign = (key, title, how) => ({ kind: 'signoff', key, title, how });
const lessonAll = (slug) => ({ kind: 'lessons', slug }); // every section of a program lesson (Hospitality, Nov 11)
// Nov 12, Tommy: "The employee training acknowledgement should be a part of their path, not a part of the hospitality part."
// Day 1 on every job: the person reads and signs it, then their trainer or a manager signs it off (server/acks.mjs).
const ACK = { kind: 'ack' };
const ACK_GRACE = '2026-11-19';
export const ACK_STEP = { title: 'Training Acknowledgment', how: 'Read and sign it, then your trainer signs it off', to: '/my-path/acknowledgment' };
// The Hospitality Program (Nov 11): Hospitality 101 is part of the new-hire paperwork, so all five lessons open week 1 on
// every path. (Week 1, not "Before your first shift", so people already past their first shift aren't sent back.)
// The Art of Table Service is the floor's later weeks.
const HOSP_WEEK1 = ['hosp-welcome', 'hosp-experience-creator', 'hosp-soft-skills', 'hosp-guest-conflict', 'hosp-safety'].map(lessonAll);
// Kitchen jobs (Nov 22 draft): Hospitality 101's welcome and its safety lesson (accidents, illness, choking). The other three
// are about guests at the table. Decision for Tommy: all five, like the floor?
const KITCHEN_HOSP = ['hosp-welcome', 'hosp-safety'].map(lessonAll);
const TABLE_SERVICE = ['hosp-mise-en-place', 'hosp-presence', 'hosp-greeting', 'hosp-water-selling', 'hosp-coursing', 'hosp-farewell'].map(lessonAll);

// Cocktail Program Level 1, one lesson per staple spirit (Nov 12): a server's path borrows each one's "How guests order it".
const SERVER_SPIRITS = ['bar-l1-vodka#2', 'bar-l1-gin#2', 'bar-l1-rum#2', 'bar-l1-tequila#3', 'bar-l1-whiskey#4'].map(lesson);

/** Mise's starting path for each job. The steps name what's in the book; each store's menu fills in the quizzes. */
const PATHS = {
  server: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('steps-of-service'), read('safety'), read('cleanliness'), read('floor-plan'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · The menu', day: 7, steps: [...HOSP_WEEK1, group('food'), sign('table-talk', 'Talk through three dishes at a table', 'A manager listens and signs you off')] },
    { key: 'week-2', title: 'Week 2 · The bar, beer and wine', day: 14, steps: [lesson('bar-serving#0'), lesson('bar-serving#2'), ...SERVER_SPIRITS, lesson('beer-glass-pour#2'), group('bar-menu'), group('wine'), lesson('on-the-floor#1'), lesson('on-the-floor#7')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · On the floor', day: 28, steps: [...TABLE_SERVICE, sign('shadow', 'Shadow a full shift', 'Work a shift beside a trainer'), sign('wine-at-table', 'Open and pour wine at a table', 'A manager watches the full service'), sign('floor', 'Floor sign-off', 'Your manager signs you off for the floor')] },
  ],
  bartender: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('steps-of-service'), read('safety'), read('cleanliness'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · Our cocktails', day: 7, steps: [...HOSP_WEEK1, lesson('bar-our-menu#0'), lesson('bar-glass-ice-garnish#3'), read('the-bar/cocktail-specs'), group('specs-menu'), sign('build-three', 'Build three menu cocktails', 'A manager watches the builds and tastes them')] },
    { key: 'week-2', title: 'Week 2 · Back bar, wine and food', day: 14, steps: [lesson('bar-vodka-gin#2'), lesson('bar-american-whiskey#1'), lesson('bar-liqueurs#2'), lesson('beer-draft#2'), lesson('beer-glass-pour#2'), read('the-bar/back-bar'), quiz('t:spec:classic-off'), group('wine'), group('food'), lesson('on-the-floor#1')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · Behind the bar', day: 28, steps: [lessonAll('hosp-presence'), lessonAll('hosp-greeting'), lessonAll('hosp-water-selling'), sign('shadow', 'Shadow a bar shift', 'Work a shift beside a bartender'), sign('bar', 'Bar sign-off', 'Your manager signs you off for the bar')] },
  ],
  host: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('step-1/greet'), read('step-9/goodbye'), read('floor-plan'), read('safety'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · The menu, for questions at the door', day: 7, steps: [...HOSP_WEEK1, group('food'), sign('door', 'Run the door for a shift', 'A manager watches and signs you off')] },
  ],
  support: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('safety'), read('cleanliness'), read('floor-plan'), read('step-4/fire-and-run'), read('step-6/clear'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · Every dish you run', day: 7, steps: [...HOSP_WEEK1, group('food'), sign('run-food', 'Run food for a shift', 'Name every dish at the table; a manager signs you off')] },
  ],
  // Expo (Nov 16): a runner's food knowledge plus the pass. Nothing from the bar, beer or wine side.
  expo: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('safety'), read('cleanliness'), read('floor-plan'), read('step-4/fire-and-run'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · Every dish on the pass', day: 7, steps: [...HOSP_WEEK1, read('food-matrix'), group('food'), sign('table-numbers', 'Know every table and seat number', 'Point to any table or seat on the floor plan; a manager signs you off')] },
    { key: 'week-2', title: 'Week 2 · Drops and the pass', day: 14, steps: [sign('drops', 'Give the three-line drop for three dishes', 'A manager listens at the pass and signs you off'), sign('expo', 'Run the pass for a shift', 'Call the tickets, check every plate and send it to the right seat; a manager signs you off')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · Hospitality', day: 28, steps: [...TABLE_SERVICE] },
  ],

  // ---- Nov 22 draft: every other position (NOT LIVE; Tommy reviews the plan first) ----
  // Server Assistant: a runner's food knowledge plus water, bread, clears and resets. Food side only, like Expo.
  'server-assistant': [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('steps-of-service'), read('safety'), read('cleanliness'), read('floor-plan'), read('step-4/fire-and-run'), read('step-6/clear'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · Every dish and every table', day: 7, steps: [...HOSP_WEEK1, read('food-matrix'), group('food'), lesson('hosp-water-selling#0'), sign('run-food', 'Run food for a shift', 'Name every dish at the table; a manager signs you off')] },
    { key: 'week-2', title: 'Week 2 · Clears and resets', day: 14, steps: [lessonAll('hosp-mise-en-place'), lesson('hosp-coursing#1'), sign('reset', 'Clear and reset a table to our standard', 'A manager watches a clear and a reset and signs you off')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · On the floor', day: 28, steps: [lessonAll('hosp-presence'), sign('shadow', 'Assist a server’s section for a full shift', 'Work a shift beside a server'), sign('floor', 'Floor sign-off', 'Your manager signs you off for the floor')] },
  ],
  // Sommelier / wine steward: the server's floor basics, then the Sommelier Program's service lessons and the wine list.
  sommelier: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('steps-of-service'), read('safety'), read('cleanliness'), read('floor-plan'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · Our wine list', day: 7, steps: [...HOSP_WEEK1, read('the-bar/wine'), group('wine'), lesson('on-the-floor#0'), lesson('on-the-floor#1'), lesson('on-the-floor#2'), lesson('on-the-floor#4'), lesson('on-the-floor#5')] },
    { key: 'week-2', title: 'Week 2 · Wine with our food', day: 14, steps: [read('food-matrix'), group('food'), quiz('t:pairings'), lesson('on-the-floor#3'), lesson('on-the-floor#6'), lesson('on-the-floor#7'), sign('wine-at-table', 'Open and pour wine at a table', 'A manager watches the full service')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · Leading wine on the floor', day: 28, steps: [lessonAll('certified-at-the-table'), quiz('t:final:somm-1'), ...TABLE_SERVICE, sign('decant', 'Decant a bottle at a table', 'A manager watches and signs you off'), sign('floor', 'Sommelier floor sign-off', 'Your manager signs you off to run wine on the floor')] },
  ],
  // Barback: stock, ice, glassware, kegs and the bar's cleaning. Lessons from Cocktail Level 1 and the Beer Program.
  barback: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('safety'), read('cleanliness'), read('floor-plan'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · Stocking the bar', day: 7, steps: [...HOSP_WEEK1, lesson('bar-glass-ice-garnish#0'), lesson('bar-glass-ice-garnish#1'), lesson('bar-glass-ice-garnish#2'), lesson('beer-glass-pour#0'), lesson('beer-glass-pour#1'), sign('stock', 'Stock the bar for open', 'A bartender or manager checks the wells, ice, garnish and glassware')] },
    { key: 'week-2', title: 'Week 2 · Kegs and the cooler', day: 14, steps: [lesson('beer-draft#0'), lesson('beer-draft#3'), lessonAll('beer-keeping'), lesson('beer-kegs-cooler#0'), lesson('beer-kegs-cooler#2'), lesson('bar-batching#3'), sign('keg', 'Change a keg', 'A bartender or manager watches and signs you off')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · Behind the bar', day: 28, steps: [sign('close', 'Close the bar', 'The bar’s jobs on the Cleaning page: ice well, rails and mats, drains; a manager checks'), sign('shadow', 'Back a bartender for a full shift', 'Work a shift beside a bartender'), sign('bar', 'Barback sign-off', 'Your manager signs you off')] },
  ],
  // Bar Lead: for a bartender stepping up. The Cocktail Program's Level 3 (balance, batching, costing) and the beer lines.
  // Level 4 (running the bar, leading the team) is by invitation, so it isn't a path step: a manager invites them in People.
  'bar-lead': [
    { key: 'first', title: 'Before your first shift as lead', day: 0, steps: [read('safety'), read('cleanliness'), ACK] },
    { key: 'week-1', title: 'Week 1 · The craft', day: 7, steps: [lessonAll('bar-balance'), lessonAll('bar-dilution'), lessonAll('bar-syrups'), lessonAll('bar-batching')] },
    { key: 'week-2', title: 'Week 2 · Costs and the beer lines', day: 14, steps: [lessonAll('bar-costing'), lessonAll('beer-line-cleaning'), lesson('beer-costing#0'), quiz('t:final:bar-3'), sign('prep', 'Run the bar’s prep for a week', 'Set pars and log every batch and waste in Prep; a manager checks the week')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · Leading the bar', day: 28, steps: [sign('count', 'Count the bar’s inventory', 'Count with a manager and go over the numbers together'), sign('train', 'Train a new bartender for a shift', 'A manager checks in with you and the new hire'), sign('lead', 'Bar Lead sign-off', 'Your manager signs you off to lead the bar')] },
  ],
  // ---- Kitchen (starter paths) ----
  // The book has the kitchen basics (Safety: the danger zone, handwashing, gloves, allergy plates, labels, knives and burns;
  // Cleanliness: sanitizer and the cleaning board; each dish's spec sheet: station, components, steps, plating) but no kitchen
  // lessons or quizzes yet. Until there are, a cook's path is those pages, the menu quizzes and a manager's sign-offs.
  // Hospitality 101: its welcome and its safety lesson only (a decision for Tommy: all five, like the floor?). No drink steps.
  'line-cook': [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('safety'), read('cleanliness'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · Your station', day: 7, steps: [...KITCHEN_HOSP, read('food-matrix'), group('food'), sign('knife', 'Knife skills check', 'Show the cuts your station uses; the chef or sous chef signs you off'), sign('station-setup', 'Set up your station', 'Set it up from the dish spec sheets before service; the chef checks it')] },
    { key: 'week-2', title: 'Week 2 · Cooking the menu', day: 14, steps: [sign('allergy-plate', 'Make an allergy plate', 'Clean board and knife, fresh gloves, new pan, as on the Safety page; the chef watches'), sign('station-dishes', 'Cook every dish on your station', 'Each one to its spec sheet and plating; the chef tastes and signs you off')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · On the line', day: 28, steps: [sign('service', 'Work a full service on your station', 'Call back every ticket and keep up with the rail'), sign('close', 'Close your station', 'Label, date and store, then the line’s jobs on the Cleaning page; the chef checks'), sign('line', 'Line sign-off', 'The chef signs you off for your station')] },
  ],
  prep: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('safety'), read('cleanliness'), read('allergen-guide'), quiz('t:allergens'), ACK] },
    { key: 'week-1', title: 'Week 1 · The walk-in and the prep list', day: 7, steps: [...KITCHEN_HOSP, read('food-matrix'), group('food'), sign('knife', 'Knife skills check', 'Show the cuts on the prep list; the chef signs you off'), sign('labels', 'Label, date and rotate the walk-in', 'First in, first out, as on the Safety page; the chef checks')] },
    { key: 'week-2', title: 'Week 2 · Batches', day: 14, steps: [sign('cooling', 'Cool a batch and log it', 'Follow the cooling steps on the Safety page and write the times down; the chef checks the log'), sign('prep-list', 'Work the prep list for a shift', 'Everything made to the recipe, labelled and put away; the chef signs you off')] },
  ],
  dish: [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('safety'), read('cleanliness'), ACK] },
    { key: 'week-1', title: 'Week 1 · The dish pit', day: 7, steps: [...KITCHEN_HOSP, sign('machine', 'Run the dish machine and check its temperatures', 'As on the Cleaning page; a manager watches and signs you off'), sign('sanitizer', 'Mix and test sanitizer', 'Mix it to the label and check it with a test strip; a manager watches'), sign('chemicals', 'Know our chemicals', 'Show where the chemicals and their safety data sheets are kept; a manager signs you off')] },
    { key: 'week-2', title: 'Week 2 · Closing', day: 14, steps: [sign('close', 'Close the dish pit', 'The dish jobs on the Cleaning page: empty the traps, clean the machine, mop and squeegee; a manager checks'), sign('dish', 'Dish sign-off', 'Your manager signs you off')] },
  ],
  // Sous Chef: a cook's path plus running the line and the pass. Kitchen leadership lessons don't exist yet.
  'sous-chef': [
    { key: 'first', title: 'Before your first shift', day: 0, steps: [read('our-story'), read('safety'), read('cleanliness'), read('allergen-guide'), quiz('t:allergens'), read('floor-plan'), ACK] },
    { key: 'week-1', title: 'Week 1 · Every station', day: 7, steps: [...KITCHEN_HOSP, read('food-matrix'), group('food'), read('step-4/fire-and-run'), sign('stations', 'Cook every station’s dishes', 'Each one to its spec sheet and plating; the chef tastes and signs you off')] },
    { key: 'week-2', title: 'Week 2 · Running the line', day: 14, steps: [sign('expo', 'Run the pass for a service', 'Call the tickets, check every plate against its spec sheet; the chef signs you off'), sign('open-close', 'Open and close the kitchen', 'The kitchen’s jobs on the Cleaning page, labels and the walk-in; the chef checks')] },
    { key: 'weeks-3-4', title: 'Weeks 3 and 4 · Leading the kitchen', day: 28, steps: [sign('train', 'Train a new cook for a shift', 'The chef checks in with you and the new cook'), sign('sous', 'Sous Chef sign-off', 'The chef or GM signs you off')] },
  ],
};

/** The starting paths as written, for tests (test/paths-all.test.mjs). */
export const PATH_DEFS = PATHS;

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
      else if (s.kind === 'lesson' || s.kind === 'lessons') {
        const keys = s.kind === 'lesson' ? [s.key] : (chapterBySlug(s.slug)?.sections || []).map((_, i) => `${s.slug}#${i}`);
        for (const key of keys) {
          const [slug, i] = key.split('#'); const ch = chapterBySlug(slug); const sec = ch?.sections[Number(i)];
          if (sec) steps.push({ id: 'lesson:' + key, kind: 'lesson', key, title: sec.name, meta: `${PROGRAM_LEVEL(ch)} lesson · counts there too`, program: PROGRAM_LEVEL(ch), to: '/' + lessonSlug(ch, Number(i)) });
        }
      } else if (s.kind === 'signoff') steps.push({ id: `path:${job}:${s.key}`, kind: 'signoff', title: s.title, meta: s.how });
      else if (s.kind === 'ack') steps.push({ id: ACK_KEY, kind: 'signoff', ack: true, title: ACK_STEP.title, meta: ACK_STEP.how, to: ACK_STEP.to });
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
  // Nov 11 (manager home + People): a step's own due date after Give More Time, and the sign-offs this person asked for.
  const dues = new Map(db.prepare('SELECT step, due FROM path_due WHERE user_id = ? AND store_id = ?').all(userId, store).map((r) => [r.step, r.due]));
  const asks = new Map(db.prepare('SELECT r.key, r.at, r.declined_at, r.note, u.name by_name FROM signoff_requests r LEFT JOIN users u ON u.id = r.declined_by WHERE r.user_id = ? AND r.store_id = ?').all(userId, store)
    .map((r) => [r.key, { at: r.at, declinedAt: r.declined_at || null, declinedBy: r.by_name || null, note: r.note || null }]));
  // The Training Acknowledgment, signed by the person (server/acks.mjs)
  let ack = null;
  try { ack = db.prepare('SELECT name, at FROM program_acks WHERE user_id = ? AND store_id = ? AND level = ?').get(userId, store, ACK_LEVEL) || null; } catch { /* table not made yet */ }
  return { reads, quizzes, signs, dues, asks, ack: ack ? { name: ack.name, at: ack.at } : null };
}

const DAY = 864e5;
export const dayOf = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
export const today = () => dayOf(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }));
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
      // A step is due with its stage unless a manager gave more time on it.
      const own = done.dues.get(s.id) || null;
      // The Training Acknowledgment joined Day 1 on Nov 12: people who started before then get a week to sign it, not a
      // late mark overnight (ACK_GRACE).
      const base = due.toISOString().slice(0, 10);
      const stepDue = own || (s.ack && base < ACK_GRACE ? ACK_GRACE : base);
      const ask = s.kind === 'signoff' && !ok ? done.asks.get(s.id) || null : null;
      // the Training Acknowledgment: whether the person has signed it yet (the sign-off is the trainer's)
      const ack = s.ack ? { ack: { signed: done.ack } } : {};
      return { ...s, ...ack, done: ok, at, result, by, due: stepDue, moved: !!own, late: !ok && !(s.ack && done.ack) && dayOf(stepDue) < now, ...(ask ? { ask } : {}) };
    });
    const k = steps.filter((s) => s.done).length;
    total += steps.length; finished += k;
    const overdue = steps.filter((s) => s.late).length;
    late += overdue;
    if (!next) next = steps.find((s) => !s.done && (s.kind !== 'signoff' || (s.ack && !s.ack.signed))) || null;
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
function programsFor(done, paths, staff = true) {
  const inPath = new Set(paths.flatMap((p) => p.stages.flatMap((st) => st.steps.filter((s) => s.kind === 'lesson').map((s) => s.key))));
  const out = [];
  // The Cocktail and Beer Programs first: they're the ones most of the floor takes. Each level shows its final and practical.
  for (const L of LEVELS) {
    if (L.program === 'somm') continue; // the Sommelier's four levels follow, together (Nov 19)
    const bar = chaptersOf(L.program, L.level).flatMap((c) => c.sections.map((_, i) => doneKey(c, i)));
    if (!bar.length) continue;
    const fin = done.quizzes.get('t:' + L.final); const pr = L.practical && done.signs.get(L.practical);
    out.push({ title: `${programDef(L.program).name} · Level ${L.level}`, cert: L.title, certKey: L.file, to: '/' + L.slug, total: bar.length, done: bar.filter((k) => done.reads.has(k)).length, inPath: bar.filter((k) => inPath.has(k)).length,
      final: { id: 't:' + L.final, passedAt: fin?.passedAt || null, best: fin ? `${Math.round((fin.best / fin.total) * 100)}%` : null },
      ...(L.practical ? { practical: { key: L.practical, title: L.practicalTitle, how: L.practicalHow, at: pr?.at || null, by: pr?.by || null, ask: (!pr && done.asks.get(L.practical)) || null } } : {}),
      // Nov 12: Master of the Bar is by invitation; a manager invites the person on People (server/invite.mjs)
      ...(L.invite && staff ? { invite: { key: L.invite, at: done.signs.get(L.invite)?.at || null, by: done.signs.get(L.invite)?.by || null } } : {}),
      certified: !!(fin?.passedAt && (!L.practical || pr)) });
  }
  for (const level of [1, 2, 3, 4]) {
    // Nov 19: Levels 3 and 4 are program lessons (content/manual-l3, -l4); Levels 1 and 2 are the Study Guide's chapters
    const L = LEVELS.find((x) => x.program === 'somm' && x.level === level);
    const chs = level <= 2 ? allChapters().filter((c) => !isProgram(c) && (c.level || 1) === level) : L ? chaptersForLevel(L) : [];
    const keys = chs.flatMap((c) => c.sections.map((_, i) => doneKey(c, i)));
    if (!keys.length) continue;
    // Nov 8: the Sommelier levels have finals and certificates too
    const fin = L && done.quizzes.get('t:' + L.final); const pr = L?.practical && done.signs.get(L.practical);
    out.push({ title: `Sommelier · Level ${level}`, to: '/' + (L?.slug || `sommelier-program/level-${level}`), total: keys.length,
      done: keys.filter((k) => done.reads.has(k)).length, inPath: keys.filter((k) => inPath.has(k)).length,
      ...(L ? { cert: L.title, certKey: L.file, final: { id: 't:' + L.final, passedAt: fin?.passedAt || null, best: fin ? `${Math.round((fin.best / fin.total) * 100)}%` : null },
        ...(L.practical ? { practical: { key: L.practical, title: L.practicalTitle, how: L.practicalHow, at: pr?.at || null, by: pr?.by || null, ask: (!pr && done.asks.get(L.practical)) || null } } : {}),
        ...(L.invite && staff ? { invite: { key: L.invite, at: done.signs.get(L.invite)?.at || null, by: done.signs.get(L.invite)?.by || null } } : {}),
        certified: !!(fin?.passedAt && (!L.practical || pr)) } : {}) });
  }
  return out;
}

/** Everything the My Path page needs for one person. */
export function personPath(db, store, user, ctx) {
  const jobs = validJobs(safeJson(user.jobs));
  const done = doneFor(db, store, user.id);
  const startedOn = startOf(user);
  const paths = jobs.map((job) => ({ job, label: JOBS.find((j) => j.key === job).label, ...progressFor(pathFor(job, ctx), done, startedOn) }));
  // Notes from a manager (a reminder, a congrats), newest first; My Path shows the unseen ones until they're closed.
  const notes = db.prepare('SELECT n.id, n.kind, n.body, n.at, n.seen_at, u.name by_name FROM notes n LEFT JOIN users u ON u.id = n.by_user WHERE n.user_id = ? AND n.store_id = ? ORDER BY n.id DESC LIMIT 5').all(user.id, store)
    .map((n) => ({ id: n.id, kind: n.kind, body: n.body, at: n.at, seenAt: n.seen_at || null, by: n.by_name || null }));
  return { jobs, startedOn, paths, programs: programsFor(done, paths, !user.role || user.role === 'staff'), allJobs: JOBS, notes };
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
export const isPathSignoff = (user, key) => LEVELS.some((L) => L.practical === key) || (key === ACK_KEY && validJobs(safeJson(user.jobs)).length > 0) || validJobs(safeJson(user.jobs)).some((job) => (PATHS[job] || []).some((st) => st.steps.some((s) => s.kind === 'signoff' && `path:${job}:${s.key}` === key)));
const safeJson = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
