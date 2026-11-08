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

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const now = () => new Date().toISOString();
const LIFETIME_MS = 24 * 3600e3;
// Nov 4, Tommy: "one account for an employee and then one account that is a manager/admin."
export const DEMO_ROLES = {
  employee: { role: 'staff', name: 'Marisol Vega' },
  manager: { role: 'manager', name: 'Rosalind Hart' },
};
const TEAM = [
  { name: 'Teddy Lam', jobs: ['server'], started: 5, scores: [['t:course:Pasta', 9], ['t:house', 7], ['t:classic', 10]], signed: ['t:course:Pasta', 't:classic'] },
  { name: 'Odalys Ruiz', jobs: ['server'], started: 3, scores: [['t:course:Mains', 10], ['t:course:Pizza', 8]], signed: ['t:course:Mains'] },
  { name: 'Quinn Abbott', jobs: ['bartender'], started: 10, scores: [['t:house', 6], ['t:course:Snacks & Small Plates', 9]], signed: [], finals: [['t:final:bar-1', 28, 30], ['t:final:bar-2', 54, 60]] },
  { name: 'Wynn Carver', jobs: ['support'], started: 2, scores: [['t:classic', 8], ['t:course:Salads', 10], ['t:house', 9]], signed: ['t:course:Salads'] },
];
const FIRST_DAY = ['our-story', 'steps-of-service', 'safety', 'cleanliness', 'floor-plan', 'allergen-guide', 'step-1/greet', 'step-9/goodbye', 'step-4/fire-and-run', 'step-6/clear'];
const COPY = ['wine', 'shelf', 'beer']; // The Baldwin's real lists (Tommy: "wine is fine")

export function migrateDemo(db) {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  if (!cols.includes('demo')) db.exec('ALTER TABLE companies ADD COLUMN demo INT NOT NULL DEFAULT 0');
}
export const isDemoCompany = (db, companyId) => !!companyId && !!db.prepare('SELECT demo FROM companies WHERE id = ?').get(companyId)?.demo;

const readSeed = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content/demo', f), 'utf8')); } catch { return []; } };

/** Make a visitor's private copy and sign them in. Returns { token, userId }. */
export function startDemo(db, key) {
  const pick = DEMO_ROLES[key];
  if (!pick) return null;
  const tag = crypto.randomBytes(5).toString('hex');
  const t = now();
  db.exec('BEGIN');
  try {
    const co = Number(db.prepare('INSERT INTO companies(name, slug, created_at, demo) VALUES (?,?,?,1)').run('Baldwin Restaurant Group', 'demo-' + tag, t).lastInsertRowid);
    const st = Number(db.prepare('INSERT INTO stores(company_id, name, slug, book_ready, sort, created_at) VALUES (?,?,?,1,0,?)').run(co, 'The Baldwin', 'the-baldwin', t).lastInsertRowid);
    const ins = db.prepare('INSERT INTO entries(collection,slug,data,sort,created_at,updated_at,company_id,store_id) VALUES (?,?,?,?,?,?,?,?)');
    for (const col of COPY) {
      for (const r of db.prepare('SELECT slug, data, sort FROM entries WHERE collection = ? AND store_id = 1 AND archived_at IS NULL').all(col)) ins.run(col, r.slug, r.data, r.sort, t, t, co, st);
    }
    for (const [col, file] of [['recipe', 'recipe.json'], ['house', 'house.json']]) {
      for (const s of readSeed(file)) ins.run(col, s.slug, JSON.stringify(s.data), s.sort ?? 0, t, t, co, st);
    }
    const addUser = (name, role, storeId) => Number(db.prepare('INSERT INTO users(company_id, name, role, store_id, created_at, last_seen_at) VALUES (?,?,?,?,?,?)').run(co, name, role, storeId, t, t).lastInsertRowid);
    const me = addUser(pick.name, pick.role, pick.role === 'staff' ? st : null);
    // Job paths (Nov 8): everyone on the team has a job and a start date, and the employee is part-way through hers.
    const ago = (d) => new Date(Date.now() - d * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
    const setJob = (id, jobs, days) => db.prepare('UPDATE users SET jobs = ?, started_on = ? WHERE id = ?').run(JSON.stringify(jobs), ago(days), id);
    if (pick.role === 'staff') {
      setJob(me, ['server'], 6);
      for (const slug of ['our-story', 'steps-of-service', 'safety', 'cleanliness', 'floor-plan', 'allergen-guide']) db.prepare('INSERT OR IGNORE INTO manual_reads(user_id, slug, at) VALUES (?,?,?)').run(me, 'page:' + slug, new Date(Date.now() - 6 * 864e5).toISOString());
      [['t:allergens', 10], ['t:course:Pasta', 10], ['t:course:Snacks & Small Plates', 9], ['t:course:Salads', 9]].forEach(([quiz, score], i) =>
        db.prepare('INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at,company_id,user_id,store_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run('u' + me, pick.name, quiz, score, 10, '{"items":[],"answers":[]}', new Date(Date.now() - (5 - i) * 864e5).toISOString(), co, me, st));
      // Certificates (Nov 8): she passed the Cocktail Program's Level 1 final yesterday, so the demo has a certificate to show.
      db.prepare('INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at,company_id,user_id,store_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run('u' + me, pick.name, 't:final:bar-1', 27, 30, '{"items":[],"answers":[]}', new Date(Date.now() - 864e5).toISOString(), co, me, st);
    }
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
    const slots = ['Servers 1', 'Servers 2', 'Bar 1', 'Support 1'];
    TEAM.forEach((p, i) => {
      const id = addUser(p.name, 'staff', st);
      setJob(id, p.jobs, p.started);
      // Their first day is done: the pages read and the allergens quiz passed.
      const firstDay = new Date(Date.now() - p.started * 864e5).toISOString();
      for (const slug of FIRST_DAY) db.prepare('INSERT OR IGNORE INTO manual_reads(user_id, slug, at) VALUES (?,?,?)').run(id, 'page:' + slug, firstDay);
      db.prepare('INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at,company_id,user_id,store_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run('u' + id, p.name, 't:allergens', 10, 10, '{"items":[],"answers":[]}', firstDay, co, id, st);
      for (const [quiz, score] of p.scores) {
        db.prepare('INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at,company_id,user_id,store_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run('u' + id, p.name, quiz, score, 10, '{"items":[],"answers":[]}', new Date(Date.now() - (i + 1) * 3600e3).toISOString(), co, id, st);
      }
      for (const [quiz, score, total] of p.finals || []) db.prepare('INSERT INTO quiz_attempts(device,name,quiz,score,total,answers,at,company_id,user_id,store_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run('u' + id, p.name, quiz, score, total, '{"items":[],"answers":[]}', new Date(Date.now() - 2 * 864e5).toISOString(), co, id, st);
      for (const quiz of p.signed) db.prepare('INSERT INTO signoffs(device, quiz, by_user, at, company_id, store_id) VALUES (?,?,?,?,?,?)').run('u' + id, quiz, me, t, co, st);
      db.prepare('INSERT INTO sections(company_id,store_id,day,slot,name,by_user,at) VALUES (?,?,?,?,?,?,?)').run(co, st, day, slots[i], p.name, me, t);
    });
    db.exec('COMMIT');
    return { token: createSession(db, me, { days: 1 }), userId: me };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** One demo copy goes: its people, sessions, records and entries. */
export function dropDemo(db, id) {
  const users = db.prepare('SELECT id FROM users WHERE company_id = ?').all(id).map((u) => u.id);
  for (const u of users) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM manual_reads WHERE user_id = ?').run(u);
    db.prepare('DELETE FROM quiz_marks WHERE user_id = ?').run(u);
  }
  for (const t of ['quiz_attempts', 'signoffs', 'sections', 'entries', 'quiz_sets', 'media', 'audit']) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (cols.includes('company_id')) db.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(id);
  }
  db.prepare('DELETE FROM users WHERE company_id = ?').run(id);
  db.prepare('DELETE FROM stores WHERE company_id = ?').run(id);
  db.prepare('DELETE FROM companies WHERE id = ?').run(id);
}

/** Throwaway demo copies older than a day go. */
export function purgeDemos(db) {
  const old = db.prepare('SELECT id FROM companies WHERE demo = 1 AND created_at < ?').all(new Date(Date.now() - LIFETIME_MS).toISOString());
  for (const { id } of old) dropDemo(db, id);
  return old.length;
}

/** What a demo visitor can't do: anything that leaves the sandbox or changes accounts. */
const BLOCKED = [/^\/api\/2fa\//, /^\/api\/password$/, /^\/api\/pin$/, /^\/api\/team/, /^\/api\/media\/upload$/, /^\/api\/scan/, /^\/api\/super/, /^\/api\/store$/, /^\/api\/setup$/, /^\/api\/join$/];
export const demoBlocks = (p, m) => m !== 'GET' && BLOCKED.some((r) => r.test(p));

export { sessionCookie };
