// Tip Tracker (Nov 25, Figma 09 · Idea Board → 52): the shapes the server sends (server/tips.mjs) and the words and
// numbers every Tips screen shares. Money comes as whole cents and is only ever formatted here.

export type Status = 'owed' | 'part' | 'settled';
export type Payment = { id: number; amount: number; paidOn: string; by: string | null; at: string };
export type Owed = {
  id: number; day: string; part: 'lunch' | 'dinner' | null; reason: Reason; label: string; amount: number; paid: number; remaining: number; status: Status;
  settledOn: string | null; settledBy: string | null; payments: Payment[]; shiftId?: number | null; note?: string; createdAt?: string;
};
export type ShiftOwed = { id: number; label: string; amount: number; remaining: number; status: Status };
export type Shift = { id: number; day: string; part: 'lunch' | 'dinner'; position: string; cash: number; card: number; tipout: number; net: number; minutes: number | null; note: string; owed: ShiftOwed[] };
export type Totals = { count: number; cash: number; card: number; tipout: number; net: number; minutes: number; hourly: number | null };
export type TipsPageData = {
  today: string; view: 'week' | 'period'; from: string; to: string; label: string; current: boolean; prev: string | null; next: string | null;
  shifts: Shift[]; totals: Totals; anyShifts: boolean; owed: { remaining: number; count: number; oldest: string | null };
  positions: string[]; position: string; payDays: number;
};
export type OwedList = { remaining: number; open: Owed[]; settled: Owed[]; settledCount: number };
export type StaffOwed = Owed & { person: { id: number; name: string; job: string } };
export type TeamOwed = {
  store: string; you: string; owedNow: number; count: number; people: number;
  oldest: { day: string; name: string; remaining: number } | null;
  settledThisPeriod: { amount: number; count: number; from: string };
  open: StaffOwed[]; recent: StaffOwed[];
};

export type Reason = 'cash' | 'card' | 'drawer' | 'other';
/** The Why chips (Log a Shift, Add Owed Money) and the title each one gives the item. */
export const REASONS: { key: Reason; chip: string; title: string }[] = [
  { key: 'cash', chip: 'Cash tips not paid out', title: 'Cash tips not paid out' },
  { key: 'card', chip: 'Card tips paid later', title: 'Card tips paid later' },
  { key: 'drawer', chip: 'Drawer short', title: 'Drawer short at close' },
  { key: 'other', chip: 'Other', title: '' },
];

/** $1,665.00 · −$65.00 (a true minus) · +$40.00 with `sign`. */
export function money(cents: number, { sign = false }: { sign?: boolean } = {}) {
  const s = (Math.abs(cents) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '−' : sign && cents > 0 ? '+' : ''}$${s}`;
}
/** Short money for a row's detail line: $34, $34.50. */
export const short = (cents: number) => `$${cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100)}`;
/** 6.5 h · 7.33 h */
export const hoursOf = (minutes: number | null | undefined) => (minutes ? `${String(Math.round((minutes / 60) * 100) / 100)} h` : '');
export const hoursInput = (minutes: number | null | undefined) => (minutes ? String(Math.round((minutes / 60) * 100) / 100) : '');
export const centsInput = (cents: number) => (cents ? (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100)) : '');

/** Typed money → cents, or null when it isn't an amount yet (the server checks it again). */
export function toCents(v: string): number | null {
  const s = v.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!s) return 0;
  if (!/^(\d{1,7}(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w || 0) * 100 + Number((f + '00').slice(0, 2));
}

const at = (iso: string) => new Date(iso + 'T12:00:00Z');
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => at(iso).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
/** "Wed, Nov 25" */
export const dayShort = (iso: string) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
/** "Nov 25" */
export const monthDay = (iso: string) => fmt(iso, { month: 'short', day: 'numeric' });
/** "WED" and "25" for the phone rows' date column. */
export const dow = (iso: string) => fmt(iso, { weekday: 'short' }).toUpperCase();
export const dom = (iso: string) => String(at(iso).getUTCDate());
/** "Today · Wed, Nov 25", or "Tue, Nov 24". */
export const dayField = (iso: string, today: string) => (iso === today ? `Today · ${dayShort(iso)}` : dayShort(iso));
export const partWord = (p: string | null | undefined) => (p === 'lunch' ? 'Lunch' : p === 'dinner' ? 'Dinner' : '');
/** "From Sat, Nov 21 · Dinner" */
export const fromLine = (o: { day: string; part?: string | null }) => `From ${dayShort(o.day)}${o.part ? ' · ' + partWord(o.part) : ''}`;
/** "Nov 16–29", "Nov 30–Dec 13", with ", 2026" when asked. */
export function rangeWords(from: string, to: string, year = false) {
  const a = monthDay(from), b = from.slice(0, 7) === to.slice(0, 7) ? dom(to) : monthDay(to);
  return `${a}–${b}${year ? ', ' + to.slice(0, 4) : ''}`;
}
/** The Detroit date right now (the server's day for shifts). */
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
/** Lunch before 4 pm, dinner after (restaurant time). */
export const partNow = (): 'lunch' | 'dinner' => (Number(new Date().toLocaleTimeString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', hour12: false })) < 16 ? 'lunch' : 'dinner');

export const STATUS_WORD: Record<Status, string> = { owed: 'Owed', part: 'Part Settled', settled: 'Settled' };
export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const FOOTNOTE = 'A personal record, not payroll. Your pay stub is the official number.';
