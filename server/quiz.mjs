// Quizzes: the bank lives in content/quizzes.json. The server scores every attempt itself.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/quizzes.json'), 'utf8'));
const byId = new Map(BANK.quizzes.map((q) => [q.id, q]));
export const quizIds = new Set([...byId.keys(), BANK.preShift.id]);

/** "short-rib#2" → the question. */
export function questionFor(ref) {
  const m = /^([a-z0-9-]+)#(\d+)$/.exec(String(ref || ''));
  if (!m) return null;
  return byId.get(m[1])?.questions[Number(m[2])] || null;
}

/** Scores an attempt. Items must belong to the quiz (any quiz for the pre-shift mix). */
export function score(quiz, items, answers) {
  if (!quizIds.has(quiz)) return null;
  if (!Array.isArray(items) || !Array.isArray(answers) || !items.length || items.length > 10 || answers.length !== items.length) return null;
  let right = 0;
  for (let i = 0; i < items.length; i++) {
    const q = questionFor(items[i]);
    if (!q) return null;
    if (quiz !== BANK.preShift.id && !String(items[i]).startsWith(quiz + '#')) return null;
    if (Number(answers[i]) === q.answer) right++;
  }
  return { score: right, total: items.length, passed: right >= Math.min(BANK.passMark, items.length) };
}

/** Everyone who has taken a quiz, with their best score per quiz and their sign-offs. */
export function results(db) {
  const rows = db.prepare('SELECT device, name, quiz, score, total, at FROM quiz_attempts ORDER BY at').all();
  const signs = db.prepare('SELECT s.device, s.quiz, s.at, u.name by_name FROM signoffs s LEFT JOIN users u ON u.id = s.by_user').all();
  const people = new Map();
  for (const r of rows) {
    const p = people.get(r.device) || { device: r.device, name: r.name, lastAt: r.at, quizzes: {}, signoffs: {} };
    p.name = r.name; p.lastAt = r.at;
    const q = p.quizzes[r.quiz] || { best: 0, total: r.total, attempts: 0, lastAt: r.at };
    q.attempts++; q.lastAt = r.at;
    if (r.score / r.total >= q.best / q.total) { q.best = r.score; q.total = r.total; }
    p.quizzes[r.quiz] = q;
    people.set(r.device, p);
  }
  for (const s of signs) { const p = people.get(s.device); if (p) p.signoffs[s.quiz] = { at: s.at, by: s.by_name }; }
  return [...people.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}
