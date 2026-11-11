// The Team Chat side panel (Nov 11, Tommy: "make the chat similar to growth where you can select an item to populate in
// the chat"). One small store for the whole app: whether the panel is open, which conversation it shows, and the item
// staged in the composer (a page from the book, or for managers a person's progress), Growth's "pending" card.
// Send to Team stages an item and opens the panel; the composer shows it with an ✕; sending clears it.
import { useSyncExternalStore } from 'react';
import { api, ApiError } from '../lib/api';

export type PageCard = { slug: string; title: string; kicker: string; kind?: string | null; thumb: string | null; line: string; at?: string };
export type PersonNext = { id: string; title: string; kind: 'quiz' | 'read' | 'lesson' | 'signoff'; due: string; late: boolean; stage?: string } | { waiting: true } | null;
export type PersonCard = {
  id: number; name: string; initials: string; job: string; done: number; total: number; late: number;
  status: 'behind' | 'new' | 'on-track' | 'done' | 'no-job'; week: number | null; weeks: number | null; startedOn: string; next: PersonNext; at: string;
};
export type ChatItem = { type: 'page'; slug: string } | { type: 'person'; id: number };
export type Staged = (ChatItem & { card: PageCard | PersonCard | null; error: string }) | null;

type State = { open: boolean; room: string | null; staged: Staged };
let state: State = { open: false, room: null, staged: null };
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const sameItem = (a: ChatItem, b: ChatItem) => a.type === b.type && (a.type === 'page' ? a.slug === (b as { slug: string }).slug : a.id === (b as { id: number }).id);

/** Puts an item in the composer, and fetches its card (the server checks it's in this store's book, or on its team). */
export function stageItem(item: ChatItem) {
  if (state.staged && sameItem(state.staged, item) && !state.staged.error) return;
  set({ staged: { ...item, card: null, error: '' } as Staged });
  const q = item.type === 'page' ? 'page=' + encodeURIComponent(item.slug) : 'person=' + item.id;
  api<{ card: PageCard | PersonCard }>('/api/chat/card?' + q)
    .then((r) => { if (state.staged && sameItem(state.staged, item)) set({ staged: { ...state.staged, card: r.card, error: '' } as Staged }); })
    .catch((e) => { if (state.staged && sameItem(state.staged, item)) set({ staged: { ...state.staged, card: null, error: e instanceof ApiError ? e.message : 'That didn’t load. Try again.' } as Staged }); });
}
export const clearStaged = () => set({ staged: null });

/** Opens the panel. With an item: it's staged, and the panel shows the conversations so you pick who gets it (unless
 *  a conversation is already open in the panel). Remembers what had focus, so closing puts you back there. */
export function openChat(opts: { item?: ChatItem; room?: string } = {}) {
  if (!state.open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (opts.item) stageItem(opts.item);
  set({ open: true, room: opts.room ?? (state.open ? state.room : null) });
}
export function closeChat({ restoreFocus = true } = {}) {
  if (!state.open) return;
  set({ open: false });
  const el = opener; opener = null;
  if (restoreFocus && el && el.isConnected) requestAnimationFrame(() => el.focus());
}
export const setPanelRoom = (room: string | null) => set({ room });

export const useChatPanel = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
