// The signed-in person's job path (server/paths.mjs), kept once for every screen that shows it:
// My Path, the sidebar card, and the "Mark as Read" bar on pages in the path.
import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../lib/api';

export type Step = {
  id: string; kind: 'read' | 'quiz' | 'lesson' | 'signoff'; title: string; meta: string; to?: string; program?: string;
  done: boolean; at: string | null; result: string | null; by: string | null;
};
export type Stage = { key: string; title: string; due: string; done: number; total: number; late: number; state: 'done' | 'now' | 'later'; steps: Step[] };
export type JobPath = {
  job: string; label: string; stages: Stage[]; done: number; total: number; late: number; next: Step | null; current: string | null;
  week: number; weeks: number; status: 'done' | 'behind' | 'on-track';
};
export type Program = { title: string; to: string; total: number; done: number; inPath: number;
  /** Cocktail Program levels (Nov 8): the certificate, its final, and Level 2's practical a manager signs off. */
  cert?: string; certKey?: string; certified?: boolean; final?: { id: string; passedAt: string | null; best: string | null };
  practical?: { key: string; title: string; how: string; at: string | null; by: string | null } };
export type Job = { key: string; label: string; note?: string };
export type MyPath = { jobs: string[]; startedOn: string; paths: JobPath[]; programs: Program[]; allJobs: Job[] };

let data: MyPath | null = null;
let loading: Promise<void> | null = null;
let owner: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setPath(next: MyPath) { data = next; emit(); }
export function reloadPath() {
  loading = api<MyPath>('/api/path').then(setPath).catch(() => { /* keep what we had */ }).finally(() => { loading = null; });
  return loading;
}
/** The path for this person (reloads when someone else signs in on this device). */
export function usePath(userId: number | null | undefined): MyPath | null {
  useEffect(() => {
    if (!userId) return;
    if (owner !== userId) { owner = userId; data = null; emit(); void reloadPath(); }
    else if (!data && !loading) void reloadPath();
  }, [userId]);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => (owner === userId ? data : null));
}

/** "Monday, Nov 9", in the restaurant's time zone. */
export const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' }) =>
  new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
/** How far off a due date is, in words: "today", "tomorrow", "3 days late". */
export function dueWords(iso: string) {
  const now = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) + 'T12:00:00Z');
  const d = Math.round((new Date(iso + 'T12:00:00Z').getTime() - now.getTime()) / 864e5);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return '1 day late';
  if (d < 0) return `${-d} days late`;
  return `in ${d} days`;
}
