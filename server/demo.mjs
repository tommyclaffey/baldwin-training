// The public demo (Nov 2, Tommy: "create a demo account like the other … keep the same name, just dummy filler food items
// and cocktails, wine is fine"). App Buildout Standard, stage 9: /demo needs no sign-up; each visitor gets a private copy.
//
// A visit makes a throwaway company (companies.demo = 1) with one store, "The Baldwin", that has the full book. It gets
// a copy of The Baldwin's wine list, back bar and beers, the made-up dishes and house cocktails in content/demo/, and a
// small made-up team (fresh names) with quiz scores, sign-offs and tonight's sections. The visitor is signed in for a day
// in the role they picked. Uploads, invites, passwords, PINs, two-step sign-in and store settings are switched off.
// Copies older than a day are removed (they're throwaway demo data, not anyone's content).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSession, sessionCookie } from './auth.mjs';
import { pathFor } from './paths.mjs';
import { ACK_KEY, ACK_LEVEL } from './acks.mjs';
import { chapterBySlug } from './manual.mjs';
import { pathCtxFor } from './team.mjs';
import { questionPool } from './quizgen.mjs';
import { seedChat, BALDWIN_DEMO_CHAT, WRENFIELD_DEMO_CHAT } from './chat.mjs';
import { forget } from './cache.mjs';
import { MEDIA_DIR } from './db.mjs';
import { seedDemoPrep } from './prep.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const now = () => new Date().toISOString();
const LIFETIME_MS = 24 * 3600e3;
// Nov 4, Tommy: "one account for an employee and then one account that is a manager/admin."
export const DEMO_ROLES = {
  employee: { role: 'staff', name: 'Marisol Vega' },
  manager: { role: 'manager', name: 'Rosalind Hart' },
};
export const DEMO_OWNER = 'Gideon Ambrose';
// Nov 11 (manager home + People, Figma 523:276 / 532:274): seven on the team, each somewhere real on their path.
//   started: days ago (negative = starts soon) · stages: stages fully done · partial: steps done in the next one
//   fail: a quiz in that stage they tried and didn't pass yet · ask: a sign-off they asked for, minutes ago
const TEAM = [
  { name: 'Hollis Grant', jobs: ['host'], started: 9, stages: 1, partial: 2, fail: true },
  // Nov 12: the Training Acknowledgment is a Day 1 step. Everyone past Day 1 signed it and had it signed off; Marisol
  // (the employee demo) signed it and is waiting on her trainer; Odalys hasn't started yet.
  { name: 'Dorian Pike', jobs: ['bartender'], started: 8, stages: 1, partial: 3, retake: true },
  { name: 'Odalys Ruiz', jobs: ['server'], started: -3, stages: 0, partial: 3 },
  { name: 'Teddy Lam', jobs: ['server'], started: 5, stages: 1, partial: 3, ask: ['path:server:table-talk', 40] },
  { name: 'Marisol Vega', jobs: ['server'], started: 6, marisol: true },
  { name: 'Quinn Abbott', jobs: ['bartender'], started: 25, stages: 3, partial: 1, ask: ['program:bar-2:practical', 190], finals: [['t:final:bar-1', 28, 30, 2], ['t:final:bar-2', 54, 60, 2]] },
  { name: 'Wynn Carver', jobs: ['support'], started: 2, stages: 1, partial: 1, ask: ['path:support:run-food', 20 * 60] },
];
// The book's last few changes, so "Your last edits" has something to open (each demo's own dishes and drinks).
const EDITS = [['edit house', 'Paloma Verde', 0.1], ['add recipe', 'Lobster Tagliatelle', 1], ['edit recipe', 'Cacio e Pepe', 2]];
const MISE_EDITS = [['edit house', 'Smoke Signal', 0.1], ['add recipe', 'Braised Lamb Shank', 1], ['edit recipe', 'Wild Mushroom Risotto', 2]];
const COPY = ['wine', 'shelf', 'beer']; // The Baldwin's real lists (Tommy: "wine is fine")

/* Two demos (Nov 11, Tommy: "a completely separate demo for Mise itself", so he can show both):
 *   baldwin  /demo       a private copy of The Baldwin: its name, logo and look, its real wine list, back bar and beers,
 *                        made-up dishes and cocktails (content/demo/). Unchanged.
 *   mise     /demo/mise  Wrenfield, a made-up restaurant in the Mise Academy look. Everything on its menu is made up
 *                        (content/demo-mise/), and it reads the shared library like any store that isn't The Baldwin
 *                        (book_ready 0), so none of The Baldwin's names, logo, story or floor plan show.
 * Same cast in both (same project, same people). */
export const DEMOS = {
  baldwin: { company: 'Baldwin Restaurant Group', store: 'The Baldwin', storeSlug: 'the-baldwin', brand: 'baldwin', bookReady: 1, seeds: 'demo', copy: COPY },
  mise: { company: 'Wrenfield', store: 'Wrenfield', storeSlug: 'wrenfield', brand: 'mise', bookReady: 0, seeds: 'demo-mise', copy: [],
    // Home's What's New: a dish, a drink and a wine (newest last), not whichever list was loaded last
    whatsNew: ['wine-list/by-the-glass-red-pinot-noir-elk-cove-willamette-valley', 'signature/smoke-signal', 'recipe/seared-scallops'] },
};
// Wrenfield's menu has no pasta or pizza: the same people's scores land on its own courses.
const MISE_QUIZ = { 't:course:Pasta': 't:course:Dessert', 't:course:Pizza': 't:course:Salads' };
/** Which demo a company is ('baldwin' or 'mise'), from its brand. */
export const demoKind = (db, companyId) => (db.prepare('SELECT brand FROM companies WHERE id = ?').get(companyId)?.brand === 'mise' ? 'mise' : 'baldwin');

export function migrateDemo(db) {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  if (!cols.includes('demo')) db.exec('ALTER TABLE companies ADD COLUMN demo INT NOT NULL DEFAULT 0');
}
export const isDemoCompany = (db, companyId) => !!companyId && !!db.prepare('SELECT demo FROM companies WHERE id = ?').get(companyId)?.demo;

const readSeed = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', dir, f), 'utf8')); } catch { return []; } };

/** Make a visitor's private copy and sign them in. Returns { token, userId }. */
export function startDemo(db, key, which = 'baldwin') {
  const pick = DEMO_ROLES[key];
  const D = DEMOS[which];
  if (!pick || !D) return null;
  const mise = which === 'mise';
  const qz = (q) => (mise ? MISE_QUIZ[q] || q : q);
  const tag = crypto.randomBytes(5).toString('hex');
  const t = now();
  db.exec('BEGIN');
  try {
    const co = Number(db.prepare('INSERT INTO companies(name, slug, created_at, demo, brand) VALUES (?,?,?,1,?)').run(D.company, (mise ? 'demo-mise-' : 'demo-') + tag, t, D.brand).lastInsertRowid);
    const st = Number(db.prepare('INSERT INTO stores(company_id, name, slug, book_ready, sort, created_at) VALUES (?,?,?,?,0,?)').run(co, D.store, D.storeSlug, D.bookReady, t).lastInsertRowid);
    const ins = db.prepare('INSERT INTO entries(collection,slug,data,sort,created_at,updated_at,company_id,store_id) VALUES (?,?,?,?,?,?,?,?)');
    for (const col of D.copy) {
      for (const r of db.prepare('SELECT slug, data, sort FROM entries WHERE collection = ? AND store_id = 1 AND archived_at IS NULL').all(col)) ins.run(col, r.slug, r.data, r.sort, t, t, co, st);
    }
    const files = [['recipe', 'recipe.json'], ['house', 'house.json'], ...(mise ? [['wine', 'wine.json'], ['shelf', 'shelf.json'], ['beer', 'beer.json']] : [])];
    for (const [col, file] of files) {
      for (const s of readSeed(D.seeds, file)) ins.run(col, s.slug, JSON.stringify(s.data), s.sort ?? 0, t, t, co, st);
    }
    (D.whatsNew || []).forEach((slug, i) => db.prepare('UPDATE entries SET updated_at = ? WHERE store_id = ? AND slug = ?').run(new Date(Date.parse(t) + (i + 1) * 1000).toISOString(), st, slug));
    const addUser = (name, role, storeId) => Number(db.prepare('INSERT INTO users(company_id, name, role, store_id, created_at, last_seen_at) VALUES (?,?,?,?,?,?)').run(co, name, role, storeId, t, t).lastInsertRowid);
    const me = addUser(pick.name, pick.role, pick.role === 'staff' ? st : null);
    // Job paths (Nov 8): everyone on the team has a job and a start date, and the employee is part-way through hers.
    const ago = (d) => new Date(Date.now() - d * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
    const setJob = (id, jobs, days) => db.prepare('UPDATE users SET jobs = ?, started_on = ? WHERE id = ?').run(JSON.stringify(jobs), ago(days), id);
    const attempt = (id, name, quiz, score, total, at, items = [], answers = []) => db.prepare('INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at,company_id,user_id,store_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('u' + id, name, quiz, score, total, JSON.stringify({ items, answers }), at, co, id, st);
    const read = (id, key, at) => db.prepare('INSERT OR IGNORE INTO manual_reads(user_id, slug, at) VALUES (?,?,?)').run(id, key, at);
    // Marisol (the employee demo, and on the manager's team): her first week, and the Cocktail Program's Level 1 final yesterday.
    const marisol = (id) => {
      setJob(id, ['server'], 6);
      for (const slug of ['our-story', 'steps-of-service', 'safety', 'cleanliness', 'floor-plan', 'allergen-guide']) read(id, 'page:' + slug, new Date(Date.now() - 6 * 864e5).toISOString());
      [['t:allergens', 10], ['t:course:Pasta', 10], ['t:course:Snacks & Small Plates', 9], ['t:course:Salads', 9]].forEach(([quiz, score], i) =>
        attempt(id, 'Marisol Vega', qz(quiz), score, 10, new Date(Date.now() - (5 - i) * 864e5).toISOString()));
      attempt(id, 'Marisol Vega', 't:final:bar-1', 27, 30, new Date(Date.now() - 864e5).toISOString());
      // the Hospitality Program (Nov 11): she's read its first lesson (Welcome), every section
      (chapterBySlug('hosp-welcome')?.sections || []).forEach((_, i) => read(id, `hosp-welcome#${i}`, new Date(Date.now() - (2 - i * 0.1) * 864e5).toISOString()));
      // the Training Acknowledgment (Nov 12, Day 1): she signed it on her first day and it's waiting on her trainer
      const signedAt = new Date(Date.now() - 5.9 * 864e5).toISOString();
      signAck(id, 'Marisol Vega', signedAt);
      db.prepare('INSERT OR IGNORE INTO signoff_requests(user_id, store_id, company_id, key, at) VALUES (?,?,?,?,?)').run(id, st, co, ACK_KEY, signedAt);
    };
    const signAck = (id, name, at) => db.prepare('INSERT OR IGNORE INTO program_acks(user_id, store_id, company_id, level, name, at) VALUES (?,?,?,?,?,?)').run(id, st, co, ACK_LEVEL, name, at);
    if (pick.role === 'staff') marisol(me);
    // The rest of the team is worked out from the real paths and quiz questions, which read the store's book.
    const storeRow = db.prepare('SELECT * FROM stores WHERE id = ?').get(st);
    const ctx = pathCtxFor(db, storeRow);
    const pool = questionPool(db, st);
    // Real questions and answers, so "most missed" this week is a real question: the 4th in each quiz trips people up.
    const answered = (topic, score, hard, seed = 0) => {
      const qs = pool.filter((q) => q.topics.includes(topic)).slice(0, 10);
      if (!qs.length) return null;
      const trap = qs.findIndex((q) => /gluten/i.test(q.q)); // the one people trip on: which dish lists gluten
      const wrong = new Set(); if (hard && score < qs.length && trap >= 0) wrong.add(trap);
      // Everyone else's misses land in different places (a different spot per person and quiz).
      const order = qs.map((_, i) => (i * 7 + seed * 3) % qs.length).filter((i) => i !== trap);
      for (const i of order) { if (wrong.size >= qs.length - Math.min(score, qs.length)) break; wrong.add(i); }
      return { items: qs.map((q) => q.ref), answers: qs.map((q, i) => (wrong.has(i) ? (q.answer + 1) % q.options.length : q.answer)), score: qs.length - wrong.size, total: qs.length };
    };
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
    const slots = ['Servers 1', 'Servers 2', 'Bar 1', 'Support 1'];
    let slot = 0;
    const bartenders = []; // the Prep tracker's openers (Nov 12)
    TEAM.forEach((p, n) => {
      if (p.marisol && pick.role === 'staff') return; // she's the visitor
      const id = addUser(p.name, 'staff', st);
      if (p.jobs.includes('bartender')) bartenders.push(id);
      if (p.marisol) { marisol(id); }
      else {
        setJob(id, p.jobs, p.started);
        const stages = pathFor(p.jobs[0], ctx);
        // Done steps happened over the days since they started, oldest first.
        const when = (k, of) => new Date(Date.now() - Math.max(0.05, Math.max(p.started, 0.5) * (1 - k / Math.max(of, 1))) * 864e5).toISOString();
        const plan = stages.flatMap((stg, i) => (i < p.stages ? stg.steps : i === p.stages ? stg.steps.filter((s) => s.kind !== 'signoff').slice(0, p.partial) : []));
        plan.forEach((s, k) => {
          const at = when(k, plan.length);
          if (s.kind === 'read') read(id, s.id, at);
          else if (s.kind === 'lesson') read(id, s.key, at);
          else if (s.kind === 'signoff') {
            // the Training Acknowledgment: they signed it (their typed name) an hour before their trainer signed it off
            if (s.id === ACK_KEY) signAck(id, p.name, new Date(Date.parse(at) - 3600e3).toISOString());
            db.prepare('INSERT INTO signoffs(device, quiz, by_user, at, company_id, store_id) VALUES (?,?,?,?,?,?)').run('u' + id, s.id, me, at, co, st);
          }
          else if (s.kind === 'quiz') {
            const a = answered(s.id.slice(2), 8 + ((n + k) % 3), (n + k) % 3 !== 0, n * 5 + k);
            // A retake: the first quiz on Dorian's path took him two tries.
            const first = p.retake && !plan.slice(0, k).some((z) => z.kind === 'quiz');
            if (a && first) { const f = answered(s.id.slice(2), 6, true); attempt(id, p.name, s.id, f.score, f.total, new Date(Date.parse(at) - 864e5).toISOString(), f.items, f.answers); }
            if (a) attempt(id, p.name, s.id, a.score, a.total, at, a.items, a.answers);
            else attempt(id, p.name, s.id, 9, 10, at);
          }
        });
        // One quiz they took this week and didn't pass yet (the Host who's behind).
        if (p.fail) {
          const open = stages[p.stages]?.steps.filter((s) => s.kind === 'quiz' && !plan.includes(s))[0];
          const a = open && answered(open.id.slice(2), 6, true);
          if (a) attempt(id, p.name, open.id, a.score, a.total, new Date(Date.now() - 1.2 * 864e5).toISOString(), a.items, a.answers);
        }
        for (const [quiz, score, total, days] of p.finals || []) attempt(id, p.name, quiz, score, total, new Date(Date.now() - days * 864e5).toISOString());
        if (p.ask) db.prepare('INSERT INTO signoff_requests(user_id, store_id, company_id, key, at) VALUES (?,?,?,?,?)').run(id, st, co, p.ask[0], new Date(Date.now() - p.ask[1] * 60e3).toISOString());
      }
      if (p.started > 0 && slot < slots.length) db.prepare('INSERT INTO sections(company_id,store_id,day,slot,name,by_user,at) VALUES (?,?,?,?,?,?,?)').run(co, st, day, slots[slot++], p.name, me, t);
    });
    // Team Chat (Nov 11, Figma 580:670): the conversation the design shows. The employee's store gets its manager too
    // (she can't sign in; she's there so her pre-shift note and DMs are). seedChat takes any store and script, so another
    // demo can bring its own.
    if (pick.role === 'staff') addUser(DEMO_ROLES.manager.name, 'manager', null);
    // The owner (Nov 11, Send to Team): a second manager in the store, so a manager's progress card has someone to go to.
    addUser(DEMO_OWNER, 'owner', null);
    seedChat(db, { company: co, storeRow, script: mise ? WRENFIELD_DEMO_CHAT : BALDWIN_DEMO_CHAT });
    // Prep tracker (Nov 12): eight weeks of batches, waste and run-outs by the two bartenders and the manager, so Today, the item pages and Reports are full. Shown as demo data on screen.
    const lead = db.prepare("SELECT id FROM users WHERE company_id = ? AND role = 'manager' ORDER BY id LIMIT 1").get(co)?.id;
    seedDemoPrep(db, { company: co, storeRow, bartenders, lead });
    if (pick.role !== 'staff') for (const [action, name, days] of (mise ? MISE_EDITS : EDITS)) db.prepare('INSERT INTO audit(user_id,action,detail,at,company_id) VALUES (?,?,?,?,?)').run(me, action, name, new Date(Date.now() - days * 864e5).toISOString(), co);
    // Nov 10 (audit: "Videos and photos · 0" in the demo admin): a few videos already in the library
    for (const [title, yt] of [['How I Make an Old Fashioned · Anders Erickson', 'pdcrJ5V7YKM'], ['How to Make a Martini · Anders Erickson', 'izZsjqnADAA'], ['The Daiquiri · Anders Erickson', '71jQRf5UrpE'], ['How to Open a Bottle of Wine · Court of Master Sommeliers', '9R3JBuXcNjQ']])
      db.prepare('INSERT INTO media(kind,title,youtube_id,created_by,created_at,company_id,store_id) VALUES (?,?,?,?,?,?,?)').run('youtube', title, yt, me, t, co, st);
    db.exec('COMMIT');
    return { token: createSession(db, me, { days: 1 }), userId: me };
  } catch (e) { db.exec('ROLLBACK'); forget(null); throw e; } // nothing cached from the half-made copy survives
}

/* Bottle scanner in the demo (Nov 12, Tommy: "scanner sounds good"): every photo a demo saves lives in its own folder,
 * media/demo/<company slug>/, served only to that demo's people, and the folder goes with the demo. The slug is random
 * per copy, so a new demo never inherits an old one's files even if the company id is reused. */
const DEMO_MEDIA = path.join(MEDIA_DIR, 'demo');
const SLUG_OK = /^demo(-mise)?-[a-f0-9]{10}$/;
/** The demo company's own media folder (relative to media/), or null if it isn't a demo. */
export function demoMediaOf(db, companyId) {
  const co = companyId && db.prepare('SELECT slug, demo FROM companies WHERE id = ?').get(companyId);
  return co?.demo && SLUG_OK.test(co.slug) ? `demo/${co.slug}` : null;
}
export const demoMediaPath = (rel) => path.join(MEDIA_DIR, rel);
/** Is `/media/demo/<slug>/<file>` this person's demo's own file? */
export function demoMediaAllowed(db, user, slug) {
  if (!user || !SLUG_OK.test(slug)) return false;
  return db.prepare('SELECT slug FROM companies WHERE id = ? AND demo = 1').get(user.company_id)?.slug === slug;
}
const dropDemoMedia = (slug) => { if (SLUG_OK.test(String(slug))) fs.rmSync(path.join(DEMO_MEDIA, slug), { recursive: true, force: true }); };

/** One demo copy goes: its people, sessions, records, entries and saved files. */
export function dropDemo(db, id) {
  const slug = db.prepare('SELECT slug FROM companies WHERE id = ? AND demo = 1').get(id)?.slug;
  const users = db.prepare('SELECT id FROM users WHERE company_id = ?').all(id).map((u) => u.id);
  for (const u of users) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM manual_reads WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM quiz_marks WHERE user_id = ?').run(u);
  }
  for (const t of ['quiz_attempts', 'signoffs', 'sections', 'entries', 'quiz_sets', 'media', 'audit', 'signoff_requests', 'path_due', 'notes', 'chat_rooms', 'chat_messages', 'chat_reactions', 'chat_reads', 'chat_gotit', 'program_acks', 'prep_items', 'prep_batches', 'prep_events', 'prep_counts']) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    if (!exists) continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (cols.includes('company_id')) db.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(id);
  }
  db.prepare('DELETE FROM users WHERE company_id = ?').run(id);
  db.prepare('DELETE FROM stores WHERE company_id = ?').run(id);
  db.prepare('DELETE FROM companies WHERE id = ?').run(id);
  if (slug) dropDemoMedia(slug);
}

/** Throwaway demo copies older than a day go. */
export function purgeDemos(db) {
  const old = db.prepare('SELECT id FROM companies WHERE demo = 1 AND created_at < ?').all(new Date(Date.now() - LIFETIME_MS).toISOString());
  for (const { id } of old) dropDemo(db, id);
  // Any demo folder whose demo is gone (a crash between the two steps) goes too.
  try {
    const live = new Set(db.prepare('SELECT slug FROM companies WHERE demo = 1').all().map((r) => r.slug));
    for (const f of fs.readdirSync(DEMO_MEDIA)) if (!live.has(f)) dropDemoMedia(f);
  } catch { /* no demo has saved anything yet */ }
  return old.length;
}

/** What a demo visitor can't do: anything that leaves the sandbox or changes accounts. The bottle scanner is on (Nov 12),
 *  with demo limits in server/index.mjs; other uploads stay off. */
const BLOCKED = [/^\/api\/2fa\//, /^\/api\/password$/, /^\/api\/password\//, /^\/api\/reset\//, /^\/api\/pin$/, /^\/api\/team/, /^\/api\/media\/upload$/, /^\/api\/chat\/photo$/, /^\/api\/super/, /^\/api\/store$/, /^\/api\/setup$/, /^\/api\/join$/];
export const demoBlocks = (p, m) => m !== 'GET' && BLOCKED.some((r) => r.test(p));

export { sessionCookie };
