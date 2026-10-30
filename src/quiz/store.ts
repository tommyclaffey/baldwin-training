// Quiz progress for the signed-in person: kept on this device (per person, so a shared tablet doesn't mix people up)
// and on the server, so it follows them to another phone and a manager can sign them off.
// The quizzes themselves come from the server, written from this restaurant's own book (server/quizgen.mjs).
import { useSyncExternalStore } from 'react';
import { api } from '../lib/api';

export type Question = { q: string; options: string[]; answer: number; why: string; page: string; label: string };
export type Topic = { key: string; label: string; group: string; count: number };
export type Quiz = { id: string; title: string; kind: 'builtin' | 'team'; topics: string[]; count: number; photo?: string | null };
export type Catalog = { passPct: number; topics: Topic[]; quizzes: Quiz[]; preShift: { id: string; title: string; count: number } };

export const PRE_SHIFT = 'pre-shift';
let catalog: Catalog = { passPct: 80, topics: [], quizzes: [], preShift: { id: PRE_SHIFT, title: 'Pre-Shift Quiz', count: 5 } };
/** Built-in and team quizzes (the ones that count toward sign-offs). */
export let QUIZZES: Quiz[] = [];
export const passFor = (total: number) => Math.ceil((total * catalog.passPct) / 100);
export const quizById = (id: string) => QUIZZES.find((q) => q.id === id);
export const getCatalog = () => catalog;
export const titleOf = (id: string) => (id === PRE_SHIFT ? catalog.preShift.title : quizById(id)?.title || (id.startsWith('c:') ? 'Custom quiz' : ''));

export type Attempt = { items: string[]; questions: Record<string, Question>; answers: number[]; title?: string; finished?: boolean; score?: number; saved?: boolean; at: string };
export type Record_ = { current?: Attempt; best?: number; total?: number; last?: number; at?: string };
type State = { device: string; name: string; quizzes: { [id: string]: Record_ }; signoffs: string[]; version: number };

const KEY = 'bt-quiz2';
const keyFor = (userId: number | null) => (userId ? `${KEY}:u${userId}` : KEY);
let userId: number | null = null;
function load(id: number | null = null, name = ''): State {
  let s: Partial<State> = {};
  try { s = JSON.parse(localStorage.getItem(keyFor(id)) || '{}'); } catch { /* start fresh */ }
  return { device: id ? `u${id}` : 'anon', name: name || s.name || '', quizzes: s.quizzes || {}, signoffs: s.signoffs || [], version: 0 };
}
let state = load();
const subs = new Set<() => void>();
function set(next: State) { state = { ...next, version: next.version + 1 }; if (userId) localStorage.setItem(keyFor(userId), JSON.stringify(state)); subs.forEach((f) => f()); }
export const useQuiz = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);

/** This restaurant's quizzes, from the server. */
export async function loadCatalog() {
  try {
    catalog = await api<Catalog>('/api/quiz/catalog');
    QUIZZES = catalog.quizzes;
    set({ ...state });
  } catch { /* offline: keep what we have */ }
}

/** Switch to the signed-in person's progress, then bring in what the server has (other phones, sign-offs). */
export function setQuizUser(u: { id: number; name: string } | null) {
  if ((u?.id ?? null) === userId && (!u || state.name === u.name)) return;
  userId = u?.id ?? null;
  set(load(userId, u?.name));
  if (u) { refreshSignoffs(true); void loadCatalog(); }
}

/** Best scores and sign-offs from the server, merged into this device's progress. */
export function refreshSignoffs(force = false) {
  if (!userId) return;
  void force;
  const id = userId;
  api<{ best: { quiz: string; best: number; total: number; at: string }[]; signoffs: { quiz: string }[] }>('/api/quiz/mine')
    .then((r) => {
      if (id !== userId) return;
      const quizzes = { ...state.quizzes };
      for (const b of r.best) {
        const rec = quizzes[b.quiz] || {};
        if (rec.best === undefined || b.best / b.total > rec.best / (rec.total || 1)) quizzes[b.quiz] = { ...rec, best: b.best, total: b.total, at: rec.at || b.at };
      }
      set({ ...state, quizzes, signoffs: r.signoffs.map((x) => x.quiz) });
    })
    .catch(() => { /* offline: keep what we have */ });
}

export function setName(name: string) { set({ ...state, name: name.trim().slice(0, 60) }); }

/** "price:123" → the question and where to read up on it (from the attempt it belongs to). */
export function lookup(ref: string, a?: Attempt) {
  const question = a?.questions?.[ref];
  return question ? { quiz: { title: question.label, page: question.page }, question } : null;
}

/** A fresh attempt from the server. A custom mix is { topics, count }; it gets an id like "c:house+wine-glass:10". */
export async function start(id: string, custom?: { topics: string[]; count: number }) {
  const q = await api<{ id: string; title: string; items: string[]; questions: Record<string, Question> }>('/api/quiz/start', { method: 'POST', body: custom ? custom : { quiz: id } });
  const rec = state.quizzes[q.id] || {};
  set({ ...state, quizzes: { ...state.quizzes, [q.id]: { ...rec, current: { items: q.items, questions: q.questions, answers: [], title: q.title, at: new Date().toISOString() } } } });
  return q.id;
}

export function answer(id: string, choice: number) {
  const rec = state.quizzes[id];
  if (!rec?.current || rec.current.finished) return;
  const cur = { ...rec.current, answers: [...rec.current.answers, choice] };
  if (cur.answers.length === cur.items.length) {
    cur.finished = true;
    cur.score = cur.items.reduce((n, ref, i) => n + (cur.questions[ref]?.answer === cur.answers[i] ? 1 : 0), 0);
  }
  const total = cur.items.length;
  const next: Record_ = { ...rec, current: cur };
  if (cur.finished) {
    next.last = cur.score; next.at = new Date().toISOString();
    if (next.best === undefined || cur.score! / total > next.best / (next.total || 1)) { next.best = cur.score; next.total = total; }
  }
  set({ ...state, quizzes: { ...state.quizzes, [id]: next } });
  if (cur.finished) void save(id);
}

/** Sends a finished attempt to the server, which scores it again. */
export async function save(id: string) {
  const rec = state.quizzes[id];
  const cur = rec?.current;
  if (!cur?.finished || cur.saved || !userId) return;
  await api('/api/quiz/attempt', { method: 'POST', body: { quiz: id, items: cur.items, answers: cur.answers } });
  const now = state.quizzes[id];
  if (now?.current === cur) set({ ...state, quizzes: { ...state.quizzes, [id]: { ...now, current: { ...cur, saved: true } } } });
}

export type Status = 'signed' | 'passed' | 'retry' | 'progress' | 'todo';
export function statusOf(s: State, id: string): Status {
  const rec = s.quizzes[id];
  if (s.signoffs.includes(id)) return 'signed';
  if (rec?.current && !rec.current.finished && rec.current.answers.length) return 'progress';
  if (rec?.best !== undefined && rec.total && rec.best >= passFor(rec.total)) return 'passed';
  if (rec?.best !== undefined) return 'retry';
  return 'todo';
}

/** The quiz to suggest next: one in progress, then the first not passed. */
export function nextQuiz(s: State) {
  return QUIZZES.find((q) => statusOf(s, q.id) === 'progress') || QUIZZES.find((q) => ['todo', 'retry'].includes(statusOf(s, q.id))) || null;
}
