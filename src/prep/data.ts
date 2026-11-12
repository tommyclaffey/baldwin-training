// Prep tracker (Nov 12): the shapes the server sends (server/prep.mjs) and the words and numbers the screens share.
import type { CSSProperties } from 'react';
import { theme, brandTitle, type TypeRole } from '../lib/theme';

export type Kind = 'juice' | 'syrup' | 'garnish';
export type Person = { id: number; name: string; initials: string; usual?: boolean };
export type Row = {
  id: number; name: string; kind: Kind; unit: string; batch: number; par: number; onHand: number; toMake: number; batches: number;
  made: { amount: number; at: string; by: Person | null } | null; who: Person | null; useFirst: boolean; ratio: string | null; hasRecipe: boolean;
  lesson: string | null; shelfDays: number | null; useByIfMadeNow: string | null; status: 'make' | 'made' | 'use-first' | 'at-par';
};
export type UseFirst = { batchId: number; itemId: number; name: string; kind: Kind; unit: string; amount: number; remaining: number; day: string; madeAt: string;
  by: Person | null; useBy: string; state: 'expired' | 'today' | 'tomorrow'; line: string };
export type Today = {
  store: string; day: string; weekday: string; can: { log: boolean; edit: boolean }; useFirst: UseFirst[]; items: Row[]; people: Person[];
  week: { from: string; to: string; made: Record<string, number>; wasted: Record<string, number>; ranOut: number }; started: string | null;
};
export type Stat = { days: number; used: number | null; wasted: number | null; ranOut: number };
export type Suggestion = { dow: number; kind: 'raise' | 'lower'; from: number; to: number; text: string };
export type Batch = { id: number; day: string; madeAt: string; by: Person | null; amount: number; remaining: number; useBy: string | null; open: boolean; expired: boolean;
  used: number; wasted: { amount: number; reason: string }[]; ranOutAt: string | null; unit: string };
export type Item = {
  id: number; name: string; kind: Kind; kindLabel: string; unit: string; batch: number; pars: number[]; today: number; day: string; parToday: number; onHand: number; step: number;
  stats: Stat[]; suggestions: Suggestion[];
  shelf: { days: number | null; words: string; storage: string; note: string; source: string; lesson: string; confirmed: boolean };
  recipe: { ratio: string; steps: string[]; yield: string; lesson: string };
  drinks: { name: string; slug: string; amount: string }[]; batches: Batch[];
  week: { from: string; made: number; used: number; wasted: number; inUse: number };
  makers: (Person & { days: string[] })[]; archived: boolean; can: { log: boolean; edit: boolean };
};
export type Bucket = { key: string; label: string; sub: string; on: boolean; made: number; used: number; wasted: number; inUse: number; prevUsed: number | null; ranOutAt: string | null; ranOut: number };
export type ReportRow = { id: number; name: string; kind: Kind; unit: string; archived: boolean; made: number; used: number; wasted: number; inUse: number; batches: number;
  wastePct: number | null; prevWastePct: number | null; vsPrev: number | null; ranOut: number; ranOutDays: string[] };
export type Tile = { made: number; wasted: number; pct: number | null; prevPct: number | null; items: number };
export type Report = {
  store: string; range: 'day' | 'week' | 'year'; at: string; today: string;
  period: { from: string; to: string; label: string; prevFrom: string; prevTo: string; prevLabel: string };
  tiles: { liquid: Tile; garnish: Tile; ranOut: { count: number; prev: number }; batches: { count: number; prev: number } };
  ranOut: { item: string; itemId: number; at: string; day: string; note: string; by: string | null }[];
  rows: ReportRow[]; series: { id: number | string; unit: string; options: { id: number | string; label: string }[] };
  chart: Bucket[]; busiest: { dow: number; label: string; batches: number }[]; started: string | null; lastYear: boolean;
  periods: { at: string; label: string }[]; summary: string;
};

export const KIND_LABEL: Record<Kind, string> = { juice: 'Juices', syrup: 'Syrups', garnish: 'Garnishes' };
export const KIND_LINE: Record<Kind, string> = { juice: 'Juices · made every shift', syrup: 'Syrups', garnish: 'Garnishes · cut before open' };
export const UNITS = ['qt', 'pt', 'oz', 'each', 'bottles'];
export const UNIT_LABEL: Record<string, string> = { qt: 'quarts', pt: 'pints', oz: 'ounces', each: 'pieces', bottles: 'bottles' };
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
/** "3 qt", "0.5 qt", "45" (pieces carry no unit word). */
export function amt(n: number, unit: string) {
  const v = r2(n);
  return unit === 'each' ? String(v) : `${v} ${unit === 'bottles' && v === 1 ? 'bottle' : unit}`;
}
export const TZ = 'America/Detroit';
export const timeOf = (at: string) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).toLowerCase();
export const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const shift = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
/** "Today, 3:55 pm", "Wed Nov 11, 3:40 pm". */
export function whenMade(at: string) {
  const d = new Date(at).toLocaleDateString('en-CA', { timeZone: TZ });
  const t = timeOf(at);
  if (d === todayIso()) return `Today, ${t}`;
  if (d === shift(todayIso(), -1)) return `Yesterday, ${t}`;
  return `${dayLabel(d, { weekday: 'short', month: 'short', day: 'numeric' })}, ${t}`;
}
/** "Tonight, close", "Tomorrow, close", "Sat, close". */
export function useByWords(useBy: string | null) {
  if (!useBy) return 'No use-by set';
  const t = todayIso();
  if (useBy === t) return 'Tonight, close';
  if (useBy === shift(t, 1)) return 'Tomorrow, close';
  if (useBy < t) return `${dayLabel(useBy, { weekday: 'short' })}, close`;
  return `${dayLabel(useBy, { weekday: 'short', month: 'short', day: 'numeric' })}, close`;
}
export const shelfWords = (d: number | null) => (d == null ? 'Shelf life not set' : d === 0 ? 'Keeps 1 shift' : d === 1 ? 'Keeps 1 day' : d === 7 ? 'Keeps 1 week' : `Keeps ${d} days`);
export const pctText = (n: number | null) => (n == null ? '—' : `${n}%`);

/** A type role's look from the theme layer (family, weight, size), so both brands paint the same layout. */
const WEIGHT: Record<string, number> = { Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800 };
export function roleStyle(role: TypeRole, size?: number): CSSProperties {
  const t = theme().type[role];
  const kebab = role.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  return { fontFamily: `var(--font-${kebab})`, fontWeight: WEIGHT[t.fs || 'Regular'] ?? 400, fontSize: t.z ?? size, lineHeight: t.lh || 1, letterSpacing: t.ls ? `${parseFloat(t.ls) / 100}em` : undefined };
}
export const pageTitle = (s: string) => brandTitle(s);
