// The number beside Team Chat (sidebar, admin nav, phone menu button). One light poll for the whole page, every 30 s while
// the tab is in view; the chat itself pushes a fresh number in when it marks a conversation read.
import { useEffect, useSyncExternalStore } from 'react';
import { api, type User } from '../lib/api';

let count = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setChatUnread(n: number) { if (n !== count) { count = n; emit(); } }
export async function pollChatUnread() {
  if (typeof document !== 'undefined' && document.hidden) return;
  try { setChatUnread((await api<{ count: number }>('/api/chat/unread')).count); } catch { /* keep the last number */ }
}
const onVisible = () => { if (!document.hidden) void pollChatUnread(); };

/** Who has Team Chat: everyone on a store's team (staff, managers, owners). A super admin looking around doesn't. */
export const hasChat = (u: User | null | undefined) => !!u && u.role !== 'superadmin';

export function useChatUnread(on: boolean) {
  useEffect(() => {
    if (!on) return;
    users++;
    if (users === 1) { void pollChatUnread(); timer = setInterval(() => void pollChatUnread(), 30_000); document.addEventListener('visibilitychange', onVisible); }
    return () => { users--; if (users === 0 && timer) { clearInterval(timer); timer = null; document.removeEventListener('visibilitychange', onVisible); } };
  }, [on]);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => (on ? count : 0));
}
