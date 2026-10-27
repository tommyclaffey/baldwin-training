// Quiz progress, kept on this device. Scores also go to the server (with the person's name) so a manager can sign them off.
import { useSyncExternalStore } from 'react';
import bank from '../../content/quizzes.json';
import { api } from '../lib/api';

export type Question = { q: string; options: string[]; answer: number; why: string };
export type Quiz = { id: string; title: string; kind: string; page: string; questions: Question[] };
export const BANK = bank as { passMark: number; preShift: { id: string; title: string; focus: string; fromFocus: number; total: number }; quizzes: Quiz[] };
export const QUIZZES = BANK.quizzes;
export const PRE_SHIFT = BANK.preShift.id;
const byId = new Map(QUIZZES.map((q) => [q.id, q]));
export const quizById = (id: string) => byId.get(id);
export const quizByTitle = (title: string) => QUIZZES.find((q) => q.title === title);

/** "short-rib#2" → the quiz and question. */
export function lookup(ref: string) {
  const [id, n] = ref.split('#');
  const quiz = byId.get(id);
  return quiz ? { quiz, question: quiz.questions[Number(n)] } : null;
}

export type Attempt = { items: string[]; answers: number[]; finished?: boolean; score?: number; saved?: boolean; at: string };
export type Record = { current?: Attempt; best?: number; total?: number; last?: number; at?: string };
type State = { device: string; name: string; quizzes: { [id: string]: Record }; signoffs: string[] };

const KEY = 'bt-quiz';
function load(): State {
  let s: Partial<State> = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* start fresh */ }
  const device = s.device || (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9]/g, '');
  return { device, name: s.name || '', quizzes: s.quizzes || {}, signoffs: s.signoffs || [] };
}
let state = load();
const subs = new Set<() => void>();
function set(next: State) { state = next; localStorage.setItem(KEY, JSON.stringify(state)); subs.forEach((f) => f()); }
export const useQuiz = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);

/** Signed-off quizzes come from the server (a manager confirms them). */
let fetched = false;
export function refreshSignoffs(force = false) {
  if (fetched && !force) return;
  fetched = true;
  api<{ signoffs: { quiz: string }[] }>(`/api/quiz/progress/${state.device}`)
    .then((r) => set({ ...state, signoffs: r.signoffs.map((s) => s.quiz) }))
    .catch(() => { /* offline: keep what we have */ });
}

export function setName(name: string) { set({ ...state, name: name.trim().slice(0, 60) }); }

function shuffle<T>(a: T[]) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** A fresh attempt. The pre-shift quiz mixes questions from tonight's focus with the rest. */
export function start(id: string) {
  let items: string[];
  if (id === PRE_SHIFT) {
    const { focus, fromFocus, total } = BANK.preShift;
    const f = byId.get(focus)!;
    const focusItems = shuffle(f.questions.map((_, i) => `${focus}#${i}`)).slice(0, fromFocus);
    const others = shuffle(QUIZZES.filter((q) => q.id !== focus).flatMap((q) => q.questions.map((_, i) => `${q.id}#${i}`))).slice(0, total - fromFocus);
    items = shuffle([...focusItems, ...others]);
  } else {
    items = byId.get(id)!.questions.map((_, i) => `${id}#${i}`);
  }
  const rec = state.quizzes[id] || {};
  set({ ...state, quizzes: { ...state.quizzes, [id]: { ...rec, current: { items, answers: [], at: new Date().toISOString() } } } });
}

export function answer(id: string, choice: number) {
  const rec = state.quizzes[id];
  if (!rec?.current || rec.current.finished) return;
  const cur = { ...rec.current, answers: [...rec.current.answers, choice] };
  if (cur.answers.length === cur.items.length) {
    cur.finished = true;
    cur.score = cur.items.reduce((n, ref, i) => n + (lookup(ref)?.question.answer === cur.answers[i] ? 1 : 0), 0);
  }
  const total = cur.items.length;
  const next: Record = { ...rec, current: cur };
  if (cur.finished) {
    next.last = cur.score; next.at = new Date().toISOString();
    if (next.best === undefined || cur.score! > next.best) { next.best = cur.score; next.total = total; }
  }
  set({ ...state, quizzes: { ...state.quizzes, [id]: next } });
  if (cur.finished) void save(id);
}

/** Sends a finished attempt to the server. Needs a name. */
export async function save(id: string) {
  const rec = state.quizzes[id];
  const cur = rec?.current;
  if (!cur?.finished || cur.saved || !state.name) return;
  await api('/api/quiz/attempt', { method: 'POST', body: { device: state.device, name: state.name, quiz: id, items: cur.items, answers: cur.answers } });
  const now = state.quizzes[id];
  if (now?.current === cur) set({ ...state, quizzes: { ...state.quizzes, [id]: { ...now, current: { ...cur, saved: true } } } });
}

export type Status = 'signed' | 'passed' | 'retry' | 'progress' | 'todo';
export function statusOf(s: State, id: string): Status {
  const rec = s.quizzes[id];
  if (s.signoffs.includes(id)) return 'signed';
  if (rec?.current && !rec.current.finished && rec.current.answers.length) return 'progress';
  if (rec?.best !== undefined && rec.best >= BANK.passMark) return 'passed';
  if (rec?.best !== undefined) return 'retry';
  return 'todo';
}

/** The quiz to suggest next: one in progress, then the first not passed. */
export function nextQuiz(s: State) {
  return QUIZZES.find((q) => statusOf(s, q.id) === 'progress') || QUIZZES.find((q) => ['todo', 'retry'].includes(statusOf(s, q.id))) || null;
}
