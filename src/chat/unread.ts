// The number beside Team Chat (sidebar, admin nav, phone bar). One light poll for the whole page, every 15 s while the tab
// is in view; the chat itself pushes a fresh number in when it marks a conversation read.
// v2 (Nov 13, Figma 27b): the poll also brings @mentions of you (the sidebar's red "@ N") and the newest mention, direct
// message or pre-shift note waiting on your Got It, which the toast (Waiting.tsx) shows once on other pages.
import { useEffect, useSyncExternalStore } from 'react';
import { api, type User } from '../lib/api';

export type Latest = { type: 'mention' | 'dm' | 'preshift'; id: number; key: string; roomName: string; kind: string; user: { id: number; name: string; initials: string; manager: boolean }; text: string; at: string } | null;
type State = { count: number; mentions: number; latest: Latest; seq: number; loaded: boolean };
let state: State = { count: 0, mentions: 0, latest: null, seq: 0, loaded: false };
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const OFF: State = { count: 0, mentions: 0, latest: null, seq: 0, loaded: false };

export function setChatUnread(n: number, mentions?: number) {
  if (n === state.count && (mentions === undefined || mentions === state.mentions)) return;
  state = { ...state, count: n, mentions: mentions ?? state.mentions, seq: state.seq + 1 }; emit();
}
export async function pollChatUnread() {
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const r = await api<{ count: number; mentions: number; latest: Latest }>('/api/chat/unread');
    const changed = !state.loaded || r.count !== state.count || r.mentions !== state.mentions || JSON.stringify(r.latest) !== JSON.stringify(state.latest);
    if (changed) { state = { count: r.count, mentions: r.mentions || 0, latest: r.latest || null, seq: state.seq + 1, loaded: true }; emit(); }
  } catch { /* keep the last number */ }
}
const onVisible = () => { if (!document.hidden) void pollChatUnread(); };

/** Who has Team Chat: everyone on a store's team (staff, managers, owners). A super admin looking around doesn't. */
export const hasChat = (u: User | null | undefined) => !!u && u.role !== 'superadmin';

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
function usePolling(on: boolean) {
  useEffect(() => {
    if (!on) return;
    users++;
    if (users === 1) { void pollChatUnread(); timer = setInterval(() => void pollChatUnread(), 15_000); document.addEventListener('visibilitychange', onVisible); }
    return () => { users--; if (users === 0 && timer) { clearInterval(timer); timer = null; document.removeEventListener('visibilitychange', onVisible); } };
  }, [on]);
}

export function useChatUnread(on: boolean) {
  usePolling(on);
  return useSyncExternalStore(subscribe, () => (on ? state.count : 0));
}
/** Everything the poll knows: the count, @mentions, the toast's newest item, and a number that moves when any of it does. */
export function useChatState(on: boolean): State {
  usePolling(on);
  return useSyncExternalStore(subscribe, () => (on ? state : OFF));
}
