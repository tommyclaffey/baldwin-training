// Team Chat (Nov 11). Figma: 09 · Proposals → 27 · Team chat, "Team Chat · Front of House · Desktop" (580:670).
// v2 (Nov 13, Figma 27b · 681:833 / 683:831 / 684:831 / 686:846; Tommy: "love it, build all of it out"), Discord's shape:
//   • a narrow rail (the store, Mentions, Pinned, Search), then channels grouped Announcements / Floor (unread bold with a
//     count, a red @ for mentions, a channel you muted shows quiet) and DMs with online dots, you at the bottom;
//   • messages grouped by person, date dividers, a red New line where unread starts, the pre-shift note as a banner with
//     Got It and "5 of 8", the members panel (On Now / Offline) with Hide, "Rosalind is typing…";
//   • reacting in one tap: hover (or focus) a message for 👍 ✅ 🔥 👀, the picker (search, For Service words, Quick, Food
//     and Drink), Reply and More; chips under the message, yours outlined, tap to add or take back; on phones a long-press
//     opens a sheet (quick reactions, service words, Reply, Reply in Thread, Copy Text, Mark Unread);
//   • threads: "N replies" opens the thread beside the conversation; a reply there can go to the channel too.
// Desktop: rail + list + conversation + members (or the thread). Phone (and the side panel): the list, then a conversation
// full screen. The server decides who's in what (server/chat.mjs). Both brands: the look comes from the theme tokens only.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as RKeyboardEvent, type ReactNode, type RefObject, type TouchEvent as RTouchEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, type IndexEntry } from '../lib/api';
import { useSession } from '../lib/session';
import { focusImg } from '../lib/focus';
import { pollChatUnread, setChatUnread } from './unread';
import { clearStaged, closeChat, stageItem, takeReply, useChatPanel, type PageCard, type PersonCard, type Staged } from './panel';
import { dueText, STATUS } from '../admin/manager';
import { chipLabel, FOOD, findReactions, PICKER_QUICK, QUICK, reactionOf, SERVICE, type Reaction as RDef } from './reactions';

type Person = { id: number; name: string; initials: string; label: string; manager: boolean; online?: boolean };
type Reaction = { emoji: string; word?: boolean; count: number; mine: boolean; names: string[] };
type ThreadSum = { count: number; last: { at: string; name: string } | null; people: { id: number; initials: string; manager: boolean; name: string }[] };
type Msg = {
  id: number; at: string; user: Person; mine: boolean; removed?: boolean; body?: string; photo?: string | null; page?: PageCard | null;
  person?: PersonCard | null; personHidden?: boolean; mentions?: { id: number; name: string }[]; mentionsMe?: boolean;
  replyTo?: { id: number; name: string; text: string } | null; inThread?: { id: number; name: string; text: string } | null;
  thread?: ThreadSum | null; threadId?: number | null; reactions: Reaction[]; canRemove?: boolean;
};
type GotIt = { mine: boolean; count: number; total: number; canTap: boolean; people?: { id: number; name: string; initials: string; at: string }[]; waiting?: { id: number; name: string; initials: string }[] };
type Pin = Msg & { title: string; pinnedAt: string; gotIt: GotIt };
type Room = {
  id: number; key: string; kind: 'everyone' | 'channel' | 'dm'; rev: number; name: string; line: string; topic?: string; group?: string | null; online?: number;
  about: string | null; other: Person | null; members: Person[]; canStart: boolean; canPin: boolean; lastId: number; read: number; canSendPerson?: boolean; muted?: boolean;
};
type Detail = { room: Room; messages: Msg[]; hasMore: boolean; pins: Pin[]; shared: PageCard[]; seen: { messageId: number; people: { id: number; first: string; initials: string }[]; of: number } | null; reactions: string[]; typing?: string[] };
type ThreadDetail = { room: Pick<Room, 'id' | 'key' | 'kind' | 'name' | 'members' | 'canStart' | 'canPin' | 'canSendPerson' | 'rev' | 'lastId' | 'read'>; parent: Msg; replies: Msg[] };
type ListRoom = { id: number; key: string; kind: Room['kind']; name: string; group?: string; unread: number; mentions?: number; muted?: boolean; last: { at: string; text: string; mine: boolean } | null; other?: Person };
export type List = { store: string; me: Person; rooms: ListRoom[]; unread: number; mentions?: number; pinsToTap?: number; people: Person[]; total?: number; online?: number };
type Hit = { id: number; key: string; kind: string; roomName: string; name: string; text: string; at: string };
type RailHit = { id: number; key: string; kind: string; roomName: string; user: Person; text: string; at: string; unread?: boolean; title?: string; gotIt?: { mine: boolean; canTap: boolean } };
type ListView = 'rooms' | 'mentions' | 'pinned';

const LAST_KEY = 'bt-chat-room';
const enc = encodeURIComponent;
const roomLabel = (r: { kind: string; name: string }) => (r.kind === 'dm' ? r.name : '#' + r.name);

/* ------------------------------ time, in the restaurant's words ------------------------------ */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
const dayDiff = (iso: string) => {
  const a = new Date(iso); const b = new Date();
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 864e5);
};
/** List times: "3:58 pm" today, "Yesterday", "Mon" this week, then "Nov 3". */
export const listTime = (iso: string) => { const d = dayDiff(iso); return d <= 0 ? clock(iso) : d === 1 ? 'Yesterday' : d < 7 ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short' }) : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
/** "today, 3:30 pm" · "yesterday, 3:30 pm" · "Mon, 3:30 pm". */
const dayTime = (iso: string) => { const d = dayDiff(iso); return `${d <= 0 ? 'today' : d === 1 ? 'yesterday' : new Date(iso).toLocaleDateString('en-US', d < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' })}, ${clock(iso)}`; };
const dayWord = (iso: string) => { const d = dayDiff(iso); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : listTime(iso); };
const dayHead = (iso: string) => { const d = dayDiff(iso); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); };

/* ------------------------------ icons (drawn from the design's layers: Lucide, 1.5 px at 18) ------------------------------ */
const svg = (size: number, children: ReactNode, sw = 1.5, vb = 24) => (
  <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill="none" stroke="currentColor" strokeWidth={sw * (vb / size)} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const I = {
  plus: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.3V8M8 8v5.7M8 8H2.3M8 8h5.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  search: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7.33" cy="7.33" r="4.33" stroke="currentColor" strokeWidth="1.33" /><path d="M10.67 10.67l2.66 2.66" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" /></svg>,
  pin: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M6.5 7.04h3.25L7.58 4.88l.54-3.25H4.88l.54 3.25-2.17 2.16H6.5Zm0 0v4.34" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  photo: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 3.33h8a2 2 0 0 1 2 2v5.34a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5.33a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.33" /><circle cx="6" cy="6.67" r="1.2" stroke="currentColor" strokeWidth="1.2" /><path d="M2.67 11.33 6 8.33l2.67 2.34 2-1.67 2.66 2.33" stroke="currentColor" strokeWidth="1.33" strokeLinejoin="round" /></svg>,
  book: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.67 3.67a1 1 0 0 1 1-1h3.66v10.66H3.67a1 1 0 0 1-1-1V3.67Zm10.66 0a1 1 0 0 0-1-1H8.67v10.66h3.66a1 1 0 0 0 1-1V3.67Z" stroke="currentColor" strokeWidth="1.33" strokeLinejoin="round" /></svg>,
  send: <svg width="17" height="17" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M2.5 7.5 12.5 2.5 8.75 12.5 7.19 8.44 2.5 7.5Z" stroke="currentColor" strokeWidth="1.38" strokeLinejoin="round" /></svg>,
  shield: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 2.25 14.25 4.5v3.75C14.25 11.63 12 14.25 9 15.75 6 14.25 3.75 11.63 3.75 8.25V4.5L9 2.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>,
  back: <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  more: svg(18, <><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>),
  info: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" /><path d="M9 8v4.5M9 5.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  close: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  expand: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  at: svg(20, <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></>),
  pinBig: svg(20, <><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>),
  pin18: svg(18, <><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>),
  pin14: svg(14, <><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>, 1.4),
  search20: svg(20, <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>),
  search18: svg(18, <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>),
  bell: svg(18, <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>),
  bellOff: svg(15, <><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5" /><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /><path d="m2 2 20 20" /></>, 1.25),
  bellOff18: svg(18, <><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5" /><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /><path d="m2 2 20 20" /></>),
  hash: svg(16, <><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></>, 1.33),
  hash20: svg(20, <><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></>, 1.67),
  down: svg(12, <path d="m6 9 6 6 6-6" />, 1.25),
  right: svg(13, <path d="m9 18 6-6-6-6" />, 1.3),
  reply: svg(18, <><path d="m9 17-5-5 5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></>),
  reply13: svg(13, <><path d="m9 17-5-5 5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></>, 1.2),
  thread: svg(14, <><path d="m15 10 5 5-5 5" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></>, 1.4),
  thread18: svg(18, <><path d="m15 10 5 5-5 5" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></>),
  smilePlus: svg(18, <><path d="M22 11v1a10 10 0 1 1-9-10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01M16 5h6M19 2v6" /></>),
  smilePlus16: svg(16, <><path d="M22 11v1a10 10 0 1 1-9-10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01M16 5h6M19 2v6" /></>, 1.33),
  smile: svg(20, <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01" /></>),
  plus18: svg(18, <path d="M5 12h14M12 5v14" />, 1.6),
  plus15: svg(15, <path d="M5 12h14M12 5v14" />, 1.25),
  panel: svg(18, <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /></>),
  users: svg(20, <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>, 1.6),
  copy: svg(20, <><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>, 1.6),
  unread: svg(20, <><path d="M22 10.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12.5" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /><circle cx="19" cy="18" r="3" /></>, 1.6),
  check: svg(16, <path d="M20 6 9 17l-5-5" />, 1.8),
  arrow: svg(16, <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>, 1.6),
  trash: svg(18, <><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>),
};

const Avatar = ({ p, size = 34, className = '', dot = false }: { p: Pick<Person, 'initials' | 'manager' | 'name'> & { online?: boolean }; size?: number; className?: string; dot?: boolean }) => (
  <span className={'tc-av ' + (p.manager ? 'mgr ' : '') + className} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
    {p.initials}
    {dot && <span className={'tc-dot' + (p.online ? ' on' : '')} style={{ width: Math.round(size * 0.34), height: Math.round(size * 0.34) }} />}
  </span>
);
const Count = ({ n, label }: { n: number; label?: string }) => (n > 0 ? <span className="tc-count" aria-label={label ?? `${n} unread`}>{n > 99 ? '99+' : n}</span> : null);
const AtBadge = ({ n }: { n: number }) => (n > 0 ? <span className="tc-at-badge" aria-label={`${n} ${n === 1 ? 'mention' : 'mentions'} of you`}>@ {n}</span> : null);

export function useIsPhone() {
  const q = '(max-width: 859px)';
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => setOn(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return on;
}
const useWide = () => {
  const q = '(min-width: 1240px)';
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => setOn(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return on;
};

/** Runs every `ms` while the tab is in view. */
export function usePoll(fn: () => void, ms: number, on = true) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    const vis = () => { if (!document.hidden) ref.current(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [ms, on]);
}

/** A small dialog or menu: Escape and a click outside close it, and focus goes back to what opened it. */
function useDismiss(open: boolean, close: () => void, box: RefObject<HTMLElement | null>, opener?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const back = opener?.current || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const away = (e: Event) => { const t = e.target as Node; if (box.current?.contains(t) || opener?.current?.contains(t)) return; closeRef.current(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); requestAnimationFrame(() => back?.isConnected && back.focus()); } };
    document.addEventListener('mousedown', away); document.addEventListener('touchstart', away); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); document.removeEventListener('keydown', esc, true); };
  }, [open, box, opener]);
}
/** Where a floating box goes beside its button: below it if it fits, else above; never off the screen. */
function placeNear(anchor: HTMLElement | null, w: number, h: number, align: 'right' | 'left' = 'right'): CSSProperties {
  if (!anchor) return { position: 'fixed', right: 16, bottom: 16, width: w };
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const left = Math.max(8, Math.min(vw - w - 8, align === 'right' ? r.right - w : r.left));
  const below = r.bottom + 6 + h <= vh - 8;
  const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
  return { position: 'fixed', left, top, width: Math.min(w, vw - 16), maxHeight: vh - 16 };
}

/* ===================================== the page ===================================== */
export function TeamChatPage() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const phone = useIsPhone();
  const wide = useWide();
  const key = decodeURIComponent(pathname.replace(/^\/team-chat\/?/, '').split('/')[0] || '');
  const [list, setList] = useState<List | null>(null);
  const [listErr, setListErr] = useState('');
  const [members, setMembers] = useState(wide);
  const [view, setView] = useState<ListView>('rooms');
  const search = useRef<HTMLInputElement>(null);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = 'Team Chat · Mise Academy'; }, []);
  const loadList = useCallback(async () => {
    try { const l = await api<List>('/api/chat'); setList(l); setChatUnread(l.unread, l.mentions); setListErr(''); }
    catch (e) { setListErr(e instanceof ApiError ? e.message : 'Team Chat didn’t load. Try again.'); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);
  usePoll(loadList, 6000);
  useEffect(() => { setMembers(wide); }, [wide]);

  // Desktop opens a conversation straight away: the last one you had open, else the first channel.
  useEffect(() => {
    if (key || phone || !list?.rooms.length) return;
    let last = ''; try { last = localStorage.getItem(LAST_KEY) || ''; } catch { /* private mode */ }
    const pick = list.rooms.find((r) => r.key === last) || list.rooms[0];
    nav('/team-chat/' + pick.key, { replace: true });
  }, [key, phone, list, nav]);
  useEffect(() => { if (key) { try { localStorage.setItem(LAST_KEY, key); } catch { /* private mode */ } } }, [key]);

  // The chat fills the window under whatever sits above it (the phone bar, the demo bar); the messages scroll inside.
  useLayoutEffect(() => {
    const fit = () => { const el = shell.current; if (el) el.style.setProperty('--tc-top', `${Math.max(0, el.getBoundingClientRect().top + window.scrollY)}px`); };
    fit(); window.addEventListener('resize', fit);
    const t = setTimeout(fit, 300);
    return () => { window.removeEventListener('resize', fit); clearTimeout(t); };
  }, []);

  const focusSearch = () => {
    setView('rooms');
    if (phone && key) { nav('/team-chat', { state: { search: true } }); return; }
    requestAnimationFrame(() => search.current?.focus());
  };
  const showList = !phone || !key;
  return (
    <main className={'tc tc-page' + (phone ? (key ? ' tc-phone-room' : ' tc-phone-list') : '')} ref={shell} aria-label="Team Chat" id="tc">
      {!phone && list && <Rail list={list} view={view} setView={setView} onSearch={focusSearch} />}
      {showList && <Conversations list={list} error={listErr} active={key} onOpen={(k) => nav('/team-chat/' + k)} view={view} setView={setView} searchRef={search} onChanged={loadList} />}
      {key && <Conversation key={key} roomKey={key} phone={phone} details={members} setDetails={setMembers} onChanged={loadList} onSearch={focusSearch} />}
      {!key && !phone && <section className="tc-room tc-empty-room"><p>{list && !list.rooms.length ? 'No conversations yet.' : ''}</p></section>}
    </main>
  );
}

/* ===================================== the rail ===================================== */
function Rail({ list, view, setView, onSearch }: { list: List; view: ListView; setView: (v: ListView) => void; onSearch: () => void }) {
  const tile = list.store.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); // The Baldwin → TB
  const btn = (v: ListView, label: string, icon: ReactNode, n: number, alert = false) => (
    <button type="button" className={'tc-rail-btn' + (view === v ? ' on' : '')} aria-pressed={view === v} onClick={() => setView(view === v ? 'rooms' : v)}
      aria-label={label + (n ? `, ${n} ${alert ? 'new' : 'to tap Got It on'}` : '')}>
      {icon}
      {n > 0 && <span className={'tc-rail-badge' + (alert ? ' alert' : '')} aria-hidden="true">{n > 9 ? '9+' : n}</span>}
    </button>
  );
  return (
    <nav className="tc-rail" aria-label="Team Chat shortcuts">
      <button type="button" className={'tc-store' + (view === 'rooms' ? ' on' : '')} onClick={() => setView('rooms')} aria-label={`${list.store}: channels and direct messages`} aria-pressed={view === 'rooms'}>
        <span className="tc-store-mark" aria-hidden="true" />
        <span className="tc-store-tile" aria-hidden="true">{tile}</span>
      </button>
      <span className="tc-rail-line" aria-hidden="true" />
      {btn('mentions', 'Mentions', I.at, list.mentions || 0, true)}
      {btn('pinned', 'Pinned', I.pinBig, list.pinsToTap || 0)}
      <button type="button" className="tc-rail-btn" aria-label="Search" onClick={onSearch}>{I.search20}</button>
    </nav>
  );
}

/* ===================================== left: conversations ===================================== */
/** The list. In the panel (`panel`), rows are buttons that open the conversation in place, and `actions` sit in the head.
 *  With a person's progress staged, only direct messages with managers show: that's where a progress card can go. */
export function Conversations({ list, error, active, onOpen, panel = false, actions, personOnly = false, view = 'rooms', setView, searchRef, onChanged }: {
  list: List | null; error: string; active: string; onOpen: (key: string) => void; panel?: boolean; actions?: ReactNode; personOnly?: boolean;
  view?: ListView; setView?: (v: ListView) => void; searchRef?: RefObject<HTMLInputElement | null>; onChanged?: () => void;
}) {
  const location = useLocation();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const ownSearch = useRef<HTMLInputElement>(null);
  const input = searchRef || ownSearch;
  const plusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    const t = setTimeout(() => { api<{ results: Hit[] }>('/api/chat/search?q=' + enc(term)).then((r) => setHits(r.results)).catch(() => setHits([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  // The header's search (phones): back to the list with the search box ready.
  useEffect(() => { if ((location.state as { search?: boolean } | null)?.search) input.current?.focus(); }, [location.state, input]);
  const channels = personOnly ? [] : list?.rooms.filter((r) => r.kind !== 'dm') || [];
  const dms = list?.rooms.filter((r) => r.kind === 'dm' && (!personOnly || r.other?.manager)) || [];
  const people = (list?.people || []).filter((p) => !personOnly || p.manager);
  const groups = [...new Set(channels.map((c) => c.group || 'Channels'))];
  const Title = panel ? 'h2' : 'h1';
  // A row opens its conversation: a link on the Team Chat page, a button in the panel.
  const row = (r: ListRoom, className: string, children: ReactNode, label: string) => {
    const cls = className + (r.unread && !r.muted ? ' unread' : '') + (r.muted ? ' muted' : '');
    return panel
      ? <button type="button" key={r.key} className={cls} onClick={() => onOpen(r.key)} aria-label={label}>{children}</button>
      : <Link key={r.key} to={'/team-chat/' + r.key} className={cls + (r.key === active ? ' on' : '')} aria-current={r.key === active ? 'page' : undefined} aria-label={label}>{children}</Link>;
  };
  const rowLabel = (r: ListRoom) => [roomLabel(r), r.unread ? `${r.unread} unread` : '', r.mentions ? `${r.mentions} ${r.mentions === 1 ? 'mention' : 'mentions'} of you` : '', r.muted ? 'muted' : '', r.kind === 'dm' ? (r.other?.online ? 'on now' : 'offline') : ''].filter(Boolean).join(', ');
  const groupHead = (name: string, extra?: ReactNode) => (
    <div className="tc-group-row" key={'g-' + name}>
      <button type="button" className="tc-group" aria-expanded={!shut[name]} onClick={() => setShut((s) => ({ ...s, [name]: !s[name] }))}>
        <span className={'tc-chev' + (shut[name] ? ' shut' : '')}>{I.down}</span>{name}
      </button>
      {extra}
    </div>
  );
  if (view !== 'rooms' && !panel && setView) return <RailList view={view} list={list} onOpen={onOpen} setView={setView} onChanged={onChanged} />;
  return (
    <section className="tc-list" aria-label="Conversations">
      <header className="tc-list-head">
        <div>
          <Title>{panel ? 'Team Chat' : list?.store || 'Team Chat'}</Title>
          <p>{panel ? list?.store || ' ' : list ? `Team Chat · ${list.total ?? list.people.length + 1} people` : ' '}</p>
        </div>
        {actions && <div className="tc-head-btns">{actions}</div>}
      </header>
      {!personOnly && <label className="tc-search">
        {I.search}
        <input ref={input} type="search" placeholder={`Search ${list?.store || 'messages'}`} aria-label="Search messages" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>}
      {/* phones: the rail's Mentions and Pinned as a row */}
      {!personOnly && setView && list && (
        <div className="tc-quick" role="group" aria-label="Shortcuts">
          <button type="button" className="tc-quick-btn" onClick={() => setView('mentions')}>{I.at}<span>Mentions</span>{(list.mentions || 0) > 0 && <span className="tc-at-badge">{list.mentions}</span>}</button>
          <button type="button" className="tc-quick-btn" onClick={() => setView('pinned')}>{I.pinBig}<span>Pinned</span>{(list.pinsToTap || 0) > 0 && <span className="tc-count">{list.pinsToTap}</span>}</button>
        </div>
      )}
      {personOnly && <p className="tc-person-note">Progress cards go only to managers, in a direct message. Pick one below, or press + for another manager.</p>}
      {error && <p className="tc-error" role="alert">{error}</p>}
      {hits ? (
        <div className="tc-hits" aria-live="polite">
          <p className="tc-group tc-group-static">{hits.length ? `${hits.length} ${hits.length === 1 ? 'message' : 'messages'}` : 'No messages found'}</p>
          {hits.map((h) => (
            <button type="button" key={h.id} className="tc-hit" onClick={() => { setQ(''); onOpen(h.key); }}>
              <span className="tc-hit-where">{h.kind === 'dm' ? h.roomName : '#' + h.roomName} · {listTime(h.at)}</span>
              <strong>{h.name}</strong>
              <span className="tc-hit-text">{h.text}</span>
            </button>
          ))}
        </div>
      ) : (
        <nav className="tc-rooms" aria-label="Channels and direct messages">
          {!list && !error && <div className="loader" />}
          {groups.map((g) => (
            <div key={g} className="tc-group-block">
              {groupHead(g)}
              {!shut[g] && channels.filter((c) => (c.group || 'Channels') === g).map((r) => row(r, 'tc-chan', <>
                <span className="tc-hash">{I.hash}</span><span className="tc-chan-name">{r.name}</span>
                <AtBadge n={r.mentions || 0} />
                {r.muted ? <span className="tc-muted-icon">{I.bellOff}</span> : <Count n={r.unread} label="" />}
              </>, rowLabel(r)))}
            </div>
          ))}
          <div className="tc-group-block">
            {groupHead(personOnly ? 'Managers' : 'Direct Messages', list && (
              <span className="tc-new-wrap">
                <button type="button" ref={plusRef} className="tc-new" aria-label="New Message" aria-haspopup="dialog" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>{I.plus15}</button>
                {picking && <NewMessage people={people} opener={plusRef} onPick={(id) => { setPicking(false); onOpen('dm-' + id); }} onClose={() => setPicking(false)} />}
              </span>
            ))}
            {!shut[personOnly ? 'Managers' : 'Direct Messages'] && <>
              {list && !dms.length && <p className="tc-none">{personOnly ? 'No messages with a manager yet. Press + to start one.' : 'No direct messages yet. Press + to start one.'}</p>}
              {dms.map((r) => row(r, 'tc-dm', <>
                <Avatar p={r.other!} size={32} dot />
                <span className="tc-dm-copy">
                  <span className="tc-dm-top"><strong>{r.name}</strong></span>
                  <span className="tc-dm-text">{r.last ? (r.last.mine ? 'You: ' : '') + r.last.text : ''}</span>
                </span>
                <AtBadge n={r.mentions || 0} />
                {r.muted ? <span className="tc-muted-icon">{I.bellOff}</span> : <Count n={r.unread} label="" />}
              </>, rowLabel(r)))}
            </>}
          </div>
        </nav>
      )}
      {list && !panel && (
        <div className="tc-you">
          <Avatar p={{ ...list.me, online: true }} size={34} dot />
          <span className="tc-dm-copy"><strong>{list.me.name}</strong><span className="tc-dm-text">{list.me.label} · Online</span></span>
        </div>
      )}
    </section>
  );
}

/** The rail's Mentions (messages that @mention you) and Pinned (pre-shift notes) in place of the list. */
function RailList({ view, list, onOpen, setView, onChanged }: { view: ListView; list: List | null; onOpen: (key: string) => void; setView: (v: ListView) => void; onChanged?: () => void }) {
  const [rows, setRows] = useState<RailHit[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api<{ results: RailHit[] }>(view === 'mentions' ? '/api/chat/mentions' : '/api/chat/pinned').then((r) => { setRows(r.results); setErr(''); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'That didn’t load. Try again.'));
  }, [view]);
  useEffect(() => { setRows(null); load(); }, [load]);
  const gotIt = async (id: number) => { try { await api(`/api/chat/message/${id}/got-it`, { method: 'POST' }); load(); onChanged?.(); void pollChatUnread(); } catch { /* next load */ } };
  const title = view === 'mentions' ? 'Mentions' : 'Pinned';
  return (
    <section className="tc-list" aria-label={title}>
      <header className="tc-list-head">
        <div><h1>{title}</h1><p>{view === 'mentions' ? 'Messages that mention you' : 'Pre-shift notes in your channels'}</p></div>
        <button type="button" className="tc-small-btn" onClick={() => setView('rooms')}>Channels</button>
      </header>
      {err && <p className="tc-error" role="alert">{err}</p>}
      {!rows && !err && <div className="loader" />}
      {rows && !rows.length && <p className="tc-none">{view === 'mentions' ? 'Nobody has mentioned you yet.' : 'No pinned notes right now.'}</p>}
      <div className="tc-hits">
        {rows?.map((h) => (
          <div key={h.id} className={'tc-rail-row' + (h.unread ? ' unread' : '')}>
            <button type="button" className="tc-hit" onClick={() => { setView('rooms'); onOpen(h.key); }}>
              <span className="tc-hit-where">{h.kind === 'dm' ? h.roomName : '#' + h.roomName} · {listTime(h.at)}{h.unread ? ' · New' : ''}</span>
              <strong>{view === 'pinned' ? `${h.title ? h.title.charAt(0).toUpperCase() + h.title.slice(1) : 'Pre-shift'} · ${h.user.name}` : h.user.name}</strong>
              <span className="tc-hit-text">{h.text}</span>
            </button>
            {view === 'pinned' && h.gotIt?.canTap && (h.gotIt.mine
              ? <span className="tc-got-done"><span aria-hidden="true">✓</span> Got It</span>
              : <button type="button" className="tc-got small" onClick={() => void gotIt(h.id)}>{I.check} Got It</button>)}
          </div>
        ))}
      </div>
      {list && <p className="tc-none tc-rail-foot">{list.store}</p>}
    </section>
  );
}

function NewMessage({ people, onPick, onClose, opener }: { people: Person[]; onPick: (id: number) => void; onClose: () => void; opener: RefObject<HTMLElement | null> }) {
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useDismiss(true, onClose, box, opener);
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="tc-pop tc-people" ref={box} role="dialog" aria-label="New Message">
      <p className="tc-pop-title">New Message</p>
      <input autoFocus placeholder="Find someone" aria-label="Find someone" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tc-pop-list">
        {shown.map((p) => (
          <button type="button" key={p.id} onClick={() => onPick(p.id)}><Avatar p={p} size={30} dot /><span><strong>{p.name}</strong><small>{p.label}</small></span></button>
        ))}
        {!shown.length && <p className="tc-none">Nobody by that name here.</p>}
      </div>
    </div>
  );
}

/* ===================================== middle: one conversation ===================================== */
/** One conversation. In the panel: a back button (`onBack`) instead of the link, the panel's own buttons (`actions`) in
 *  the head, and no members column. `details` = the members panel is open. */
export function Conversation({ roomKey, phone, details, setDetails, onChanged, onBack, actions, onSearch }: {
  roomKey: string; phone: boolean; details: boolean; setDetails: (v: boolean) => void; onChanged: () => void; onBack?: () => void; actions?: ReactNode; onSearch?: () => void;
}) {
  const panel = !!onBack;
  const { user } = useSession();
  const { reply: wantReply } = useChatPanel();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [older, setOlder] = useState<Msg[]>([]);
  const [moreOlder, setMoreOlder] = useState<boolean | null>(null);
  const [pinAt, setPinAt] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [thread, setThread] = useState<number | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Msg | null>(null);
  const [toast, setToast] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const rev = useRef<number | null>(null);
  // The New line: where unread started when you opened the conversation (Mark Unread moves it).
  const newFrom = useRef<number | null>(null);
  const holdRead = useRef(false);
  const pinBtn = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const take = useCallback((x: Detail) => {
    if (newFrom.current === null) {
      const first = x.messages.find((m) => m.id > x.room.read && !m.mine);
      newFrom.current = first ? first.id : 0;
    }
    setD(x); rev.current = x.room.rev; setTyping(x.typing || []); setErr('');
  }, []);
  const load = useCallback(async (fresh = false) => {
    try {
      const x = await api<Detail | { same: true; typing?: string[] }>(`/api/chat/room/${enc(roomKey)}${!fresh && rev.current !== null ? '?rev=' + rev.current : ''}`);
      if ('same' in x) setTyping(x.typing || []); else take(x);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'This conversation didn’t load. Try again.'); }
  }, [roomKey, take]);
  useEffect(() => {
    rev.current = null; newFrom.current = null; holdRead.current = false;
    setD(null); setOlder([]); setMoreOlder(null); setReplyTo(null); setPinAt(null); setThread(null); stick.current = true; void load(true);
  }, [roomKey, load]);
  usePoll(() => void load(), 3000, !!d);

  // Mark as read whenever something new shows while you're looking (not right after Mark Unread).
  useEffect(() => {
    if (!d || document.hidden || holdRead.current || d.room.lastId <= d.room.read) return;
    api<{ unread: number }>(`/api/chat/room/${enc(roomKey)}/read`, { method: 'POST', body: { last: d.room.lastId } })
      .then((r) => { setChatUnread(r.unread); void pollChatUnread(); onChanged(); }).catch(() => { /* next poll */ });
  }, [d?.room.lastId, d?.room.read, roomKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The toast's Reply: put that message in the composer as "Replying to…".
  useEffect(() => {
    if (!d || wantReply === null) return;
    const m = d.messages.find((z) => z.id === wantReply);
    if (m) setReplyTo(m);
    takeReply();
  }, [d, wantReply]);

  // Stay at the newest message unless you've scrolled up to read.
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current; if (!el || !inner.current) return;
    const fix = () => { if (stick.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(fix);
    ro.observe(el); ro.observe(inner.current);
    return () => ro.disconnect();
  }, [d === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastTop = useRef(0);
  const onScroll = () => {
    const el = scroller.current; if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) stick.current = true;
    else if (el.scrollTop < lastTop.current - 2) stick.current = false;
    lastTop.current = el.scrollTop;
  };
  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [d?.messages.length, d?.messages[d?.messages.length - 1]?.id, d?.seen?.people.length, roomKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (path: string, method: string, body?: unknown) => {
    setNote('');
    try { take(await api<Detail>(path, { method, body })); onChanged(); void pollChatUnread(); }
    catch (e) { setNote(e instanceof ApiError ? e.message : 'That didn’t work. Try again.'); }
  };
  const react = (m: Msg, emoji: string) => void act(`/api/chat/message/${m.id}/react`, 'POST', { emoji });
  const markUnread = async (m: Msg) => {
    try {
      await api(`/api/chat/message/${m.id}/unread`, { method: 'POST' });
      holdRead.current = true; newFrom.current = m.id;
      flash('Marked unread from here.'); void load(true); onChanged(); void pollChatUnread();
    } catch (e) { setNote(e instanceof ApiError ? e.message : 'That didn’t work. Try again.'); }
  };
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2500); };
  const copy = async (m: Msg) => {
    const text = plainText(m);
    try { await navigator.clipboard.writeText(text); flash('Copied.'); }
    catch { flash('Couldn’t copy on this device.'); }
  };
  const mute = async () => {
    if (!d) return;
    const on = !d.room.muted;
    try { await api(`/api/chat/room/${enc(roomKey)}/mute`, { method: on ? 'POST' : 'DELETE' }); setD({ ...d, room: { ...d.room, muted: on } }); flash(on ? `Muted ${roomLabel(d.room)}. Mentions of you still show.` : `${roomLabel(d.room)} unmuted.`); onChanged(); void pollChatUnread(); }
    catch (e) { setNote(e instanceof ApiError ? e.message : 'That didn’t work. Try again.'); }
  };
  const loadOlder = async () => {
    const first = (older[0] || d?.messages[0])?.id;
    if (!first) return;
    const el = scroller.current; const h = el?.scrollHeight || 0;
    const x = await api<Detail>(`/api/chat/room/${enc(roomKey)}?before=${first}`);
    setOlder((o) => [...x.messages, ...o]); setMoreOlder(x.hasMore);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - h; });
  };
  const openThread = (m: Msg) => { setThread(m.threadId || m.id); setSheet(null); };

  if (err && !d) return <section className="tc-room"><div className="tc-room-error"><p role="alert">{err}</p>{panel ? <button type="button" className="tc-act" onClick={onBack}>Back to Conversations</button> : phone && <Link to="/team-chat" className="tc-btn">Back to Team Chat</Link>}</div></section>;
  if (!d) return <section className="tc-room" aria-busy="true"><div className="loader" /></section>;
  const r = d.room;
  const all = [...older, ...d.messages];
  const hasMore = moreOlder ?? d.hasMore;
  const pin = d.pins.find((p) => p.id === pinAt) || d.pins[0] || null;
  const lastVisible = all[all.length - 1];
  const manager = !!user && user.role !== 'staff';
  const onCount = r.online ?? r.members.filter((m) => m.online).length;
  const side = thread ? 'thread' : details && !panel ? 'members' : null;

  return (
    <>
      <section className={'tc-room' + (side ? ' has-side' : '')} aria-label={roomLabel(r)}>
        <header className="tc-room-head">
          {panel ? <button type="button" className="tc-back" aria-label="Back to Conversations" onClick={onBack}>{I.back}</button>
            : phone && <Link to="/team-chat" className="tc-back" aria-label="Back to Team Chat">{I.back}</Link>}
          {r.other && <Avatar p={r.other} size={34} dot />}
          <div className="tc-titles">
            <h2>{r.kind !== 'dm' && <span className="tc-hash-big">{I.hash20}</span>}{r.name}</h2>
            <p className="tc-topic">{r.kind === 'dm' ? `${r.other?.label || ''}${r.other ? ' · ' + (r.other.online ? 'On now' : 'Offline') : ''}` : r.topic}</p>
            <p className="tc-topic-phone">{r.kind === 'dm' ? (r.other?.online ? 'On now' : 'Offline') : `${r.members.length} members · ${onCount} on now`}</p>
          </div>
          <div className="tc-head-tools">
            {r.kind !== 'dm' && (
              <span className="tc-pop-wrap">
                <button type="button" ref={pinBtn} className="tc-hbtn tc-hide-phone" aria-label={`Pinned notes (${d.pins.length})`} aria-haspopup="dialog" aria-expanded={pinsOpen} onClick={() => setPinsOpen((v) => !v)}>{I.pin18}</button>
                {pinsOpen && <PinsPop pins={d.pins} opener={pinBtn} onPick={(id) => { setPinAt(id); setPinsOpen(false); }} onClose={() => setPinsOpen(false)} />}
              </span>
            )}
            <button type="button" className={'tc-hbtn tc-hide-phone' + (r.muted ? ' on' : '')} aria-pressed={!!r.muted} aria-label={r.muted ? `Unmute ${roomLabel(r)}` : `Mute ${roomLabel(r)}`} onClick={() => void mute()}>{r.muted ? I.bellOff18 : I.bell}</button>
            {onSearch && <button type="button" className="tc-hbtn" aria-label="Search messages" onClick={onSearch}>{phone ? I.search20 : I.search18}</button>}
            {!panel && <button type="button" className={'tc-hbtn' + (side === 'members' ? ' on' : '')} aria-pressed={side === 'members'} aria-label={side === 'members' ? 'Hide members' : 'Show members'} onClick={() => { setThread(null); setDetails(!(side === 'members')); }}>{phone ? I.users : I.panel}</button>}
            {actions && <div className="tc-head-btns">{actions}</div>}
          </div>
        </header>

        {pin && <PinnedCard pin={pin} manager={!!r.canPin} count={d.pins.length}
          onGot={(on) => void act(`/api/chat/message/${pin.id}/got-it`, on ? 'POST' : 'DELETE')}
          onUnpin={() => void act(`/api/chat/message/${pin.id}/pin`, 'DELETE')} />}

        <div className="tc-msgs" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages">
          <div className="tc-msgs-in" ref={inner}>
          {hasMore && <button type="button" className="tc-older" onClick={() => void loadOlder()}>Show Earlier Messages</button>}
          {!all.length && <Empty room={r} />}
          {all.map((m, i) => {
            const prev = all[i - 1];
            const isNew = !!newFrom.current && m.id === newFrom.current;
            const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
            const grouped = !!prev && !newDay && !isNew && !prev.removed && !m.removed && prev.user.id === m.user.id && !m.replyTo && !m.inThread && !prev.thread
              && new Date(m.at).getTime() - new Date(prev.at).getTime() < 7 * 60e3;
            return (
              <MessageRow key={m.id} m={m} room={r} grouped={grouped} newDay={newDay} isNew={isNew} phone={phone} phonePanel={panel && phone}
                seen={m.id === lastVisible?.id && d.seen?.messageId === m.id ? d.seen : null}
                onReact={(e) => react(m, e)} onReply={() => { setReplyTo(m); requestAnimationFrame(() => composer.current?.focus()); }}
                onThread={() => openThread(m)} onPin={() => void act(`/api/chat/message/${m.id}/pin`, 'POST')}
                onRemove={() => void act(`/api/chat/message/${m.id}`, 'DELETE')} onCopy={() => void copy(m)} onUnread={() => void markUnread(m)}
                onLongPress={() => setSheet(m)} />
            );
          })}
          </div>
        </div>
        {note && <p className="tc-note" role="alert">{note} <button type="button" onClick={() => setNote('')} aria-label="Dismiss">{I.close}</button></p>}
        {toast && <p className="tc-flash" role="status">{toast}</p>}
        <Typing names={typing} />
        <Composer room={r} demo={!!user?.demo} replyTo={replyTo} clearReply={() => setReplyTo(null)} autoFocus={panel && !phone} onPickOther={onBack} areaRef={composer}
          onSent={(x) => { stick.current = true; holdRead.current = false; take(x as Detail); onChanged(); }} />
      </section>
      {side === 'members' && <MembersPanel d={d} manager={manager} onClose={() => setDetails(false)} phone={phone} />}
      {side === 'thread' && thread && <ThreadPanel id={thread} room={r} phone={phone} demo={!!user?.demo} onClose={() => setThread(null)} onChanged={() => { void load(true); onChanged(); }} />}
      {sheet && <MessageSheet m={sheet} room={r} onClose={() => setSheet(null)}
        onReact={(e) => { react(sheet, e); setSheet(null); }}
        onReply={() => { setReplyTo(sheet); setSheet(null); requestAnimationFrame(() => composer.current?.focus()); }}
        onThread={() => openThread(sheet)} onCopy={() => { void copy(sheet); setSheet(null); }} onUnread={() => { void markUnread(sheet); setSheet(null); }}
        onPin={() => { void act(`/api/chat/message/${sheet.id}/pin`, 'POST'); setSheet(null); }}
        onRemove={() => { void act(`/api/chat/message/${sheet.id}`, 'DELETE'); setSheet(null); }} />}
    </>
  );
}

/** A message as plain words, for Copy Text: names for @mentions, and a card's title. */
function plainText(m: Msg) {
  const body = (m.body || '').replace(/<@(\d+)>/g, (_, id) => '@' + (m.mentions?.find((x) => x.id === Number(id))?.name || 'Former teammate'));
  return [body, m.page ? `${m.page.title} (${location.origin}/${m.page.slug})` : '', m.photo ? location.origin + m.photo : ''].filter(Boolean).join('\n');
}

function Typing({ names }: { names: string[] }) {
  if (!names.length) return <div className="tc-typing" aria-hidden="true" />;
  const who = names.length === 1 ? <><strong>{names[0]}</strong> is typing…</> : names.length === 2 ? <><strong>{names[0]}</strong> and <strong>{names[1]}</strong> are typing…</> : <>Several people are typing…</>;
  return <div className="tc-typing"><span className="tc-typing-dots" aria-hidden="true"><i /><i /><i /></span><span>{who}</span></div>;
}

function Empty({ room }: { room: Room }) {
  const onlyManagers = room.kind === 'channel' && room.members.every((m) => m.manager);
  return (
    <div className="tc-empty">
      <p><strong>No messages yet.</strong></p>
      <p>{room.kind === 'dm' ? `Say hello to ${room.name.split(' ')[0]}.`
        : onlyManagers ? 'Nobody on the team has a job for this channel yet, so for now it’s the managers.'
          : room.canStart ? 'Start the conversation.' : 'Managers post here first.'}</p>
    </div>
  );
}

/** Pre-shift notes: "Label: rest" lines get a bold label, like the design's pinned card. */
function NoteLines({ text, m }: { text: string; m: Msg }) {
  return <>{text.split('\n').filter((l) => l.trim()).map((l, i) => {
    const x = /^(.{1,32}?):\s(.*)$/.exec(l);
    return <p key={i}>{x ? <><strong>{x[1]}: </strong><Body text={x[2]} m={m} /></> : <Body text={l} m={m} />}</p>;
  })}</>;
}

/** A message's words with its @mentions as tags; a mention of you stands out. <@id> comes from the server. */
function Body({ text, m }: { text: string; m: Pick<Msg, 'mentions'> }) {
  const { user } = useSession();
  const parts = text.split(/<@(\d+)>/);
  return <>{parts.map((p, i) => {
    if (i % 2 === 0) return p;
    const id = Number(p);
    const who = m.mentions?.find((x) => x.id === id);
    return <span key={i} className={'tc-at' + (id === user?.id ? ' me' : '')}>@{who?.name || 'Former teammate'}</span>;
  })}</>;
}

function PinsPop({ pins, onPick, onClose, opener }: { pins: Pin[]; onPick: (id: number) => void; onClose: () => void; opener: RefObject<HTMLElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(true, onClose, box, opener);
  useEffect(() => { box.current?.querySelector<HTMLElement>('button')?.focus(); }, []);
  return (
    <div className="tc-pop tc-pins-pop" ref={box} role="dialog" aria-label="Pinned Notes">
      <p className="tc-pop-title">Pinned · {pins.length}</p>
      {!pins.length && <p className="tc-none">Nothing is pinned here. Managers pin a pre-shift note from a message’s More menu.</p>}
      <ul className="tc-pins">
        {pins.map((p) => <li key={p.id}><button type="button" onClick={() => onPick(p.id)}><strong>{p.title.charAt(0).toUpperCase() + p.title.slice(1)}</strong><small>{p.user.name} · {dayTime(p.at)} · {p.gotIt.count} of {p.gotIt.total} got it</small></button></li>)}
      </ul>
    </div>
  );
}

function PinnedCard({ pin, manager, count, onGot, onUnpin }: { pin: Pin; manager: boolean; count: number; onGot: (on: boolean) => void; onUnpin: () => void }) {
  const [who, setWho] = useState(false);
  const g = pin.gotIt;
  const faces = (g.people || []).slice(-3);
  return (
    <div className="tc-pinned-wrap">
      <div className="tc-pinned" role="region" aria-label={`Pinned: ${pin.title}`}>
        <div className="tc-pinned-head">
          <span className="tc-pin-icon">{I.pin14}</span>
          <span className="tc-pinned-title">{pin.title.replace(/ pre-shift$/i, '') === pin.title ? pin.title : 'Pre-shift'} · {pin.user.name} · {clock(pin.at)}{count > 1 ? ` · 1 of ${count}` : ''}</span>
          {faces.length > 0 && <span className="tc-got-faces" aria-hidden="true">{faces.map((p) => <span key={p.id} className="tc-av">{p.initials}</span>)}</span>}
          {manager && g.people
            ? <button type="button" className="tc-got-count" aria-expanded={who} onClick={() => setWho((v) => !v)} aria-label={`${g.count} of ${g.total} got it. Show who`}>{g.count} of {g.total}</button>
            : <span className="tc-got-count plain">{g.count} of {g.total}</span>}
          {g.canTap && (g.mine
            ? <button type="button" className="tc-got done" aria-pressed="true" onClick={() => onGot(false)}>{I.check} Got It</button>
            : <button type="button" className="tc-got" aria-pressed="false" onClick={() => onGot(true)}>{I.check} Got It</button>)}
        </div>
        <div className="tc-pinned-notes">{pin.body ? <NoteLines text={pin.body} m={pin} /> : null}</div>
        {pin.photo && <img className="tc-pinned-photo" src={pin.photo} alt="" />}
        {manager && <div className="tc-pinned-foot"><button type="button" className="tc-unpin" onClick={onUnpin}>Unpin</button></div>}
        {manager && who && g.people && (
          <div className="tc-got-who">
            <div><p className="tc-got-label">Got it</p>{g.people.length ? g.people.map((p) => <span key={p.id} className="tc-got-name">{p.name} <small>{clock(p.at)}</small></span>) : <span className="tc-got-name">Nobody yet</span>}</div>
            <div><p className="tc-got-label">Not yet</p>{g.waiting?.length ? g.waiting.map((p) => <span key={p.id} className="tc-got-name">{p.name}</span>) : <span className="tc-got-name">Everyone has</span>}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ one message ------------------------------ */
type RowActions = { onReact: (e: string) => void; onReply: () => void; onThread: () => void; onPin: () => void; onRemove: () => void; onCopy: () => void; onUnread: () => void };
function MessageRow({ m, room, grouped, newDay, isNew, seen, phone, phonePanel, onLongPress, inThread = false, ...a }: RowActions & {
  m: Msg; room: Pick<Room, 'kind' | 'canPin'>; grouped: boolean; newDay: boolean; isNew: boolean; seen: Detail['seen']; phone: boolean; phonePanel: boolean; onLongPress: () => void; inThread?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [picker, setPicker] = useState(false);
  const [more, setMore] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const pickBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const addChip = useRef<HTMLButtonElement>(null);
  const [pickFrom, setPickFrom] = useState<RefObject<HTMLButtonElement | null>>(pickBtn);
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const fired = useRef(false);
  const active = !m.removed && (hover || focus || picker || more);
  const label = `${m.user.name}, ${clock(m.at)}${m.mentionsMe ? ', mentions you' : ''}`;

  // Phones: hold a message to open its sheet (a slight move cancels, so scrolling still works).
  const touchStart = (e: RTouchEvent) => {
    if (!phone || m.removed) return;
    fired.current = false;
    const t0 = e.touches[0];
    press.current = { x: t0.clientX, y: t0.clientY, t: setTimeout(() => { fired.current = true; navigator.vibrate?.(10); onLongPress(); }, 450) };
  };
  const touchMove = (e: RTouchEvent) => {
    const p = press.current; if (!p) return;
    const t0 = e.touches[0];
    if (Math.abs(t0.clientX - p.x) > 10 || Math.abs(t0.clientY - p.y) > 10) { clearTimeout(p.t); press.current = null; }
  };
  const touchEnd = (e: RTouchEvent) => { if (press.current) clearTimeout(press.current.t); press.current = null; if (fired.current) e.preventDefault(); };

  return (
    <>
      {newDay && <p className="tc-day"><span>{dayHead(m.at)}</span></p>}
      {isNew && <p className="tc-new-line" role="separator" aria-label="New messages start here"><span>New</span></p>}
      <article className={'tc-msg' + (grouped ? ' grouped' : '') + (active ? ' active' : '') + (m.mentionsMe ? ' at-me' : '')} aria-label={label} tabIndex={0}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onFocus={() => setFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocus(false); }}
        onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onTouchCancel={touchEnd}
        onContextMenu={(e) => { if (phone && !m.removed) { e.preventDefault(); onLongPress(); } }}>
        {grouped ? <span className="tc-gutter-time" aria-hidden="true">{clock(m.at).replace(/ (am|pm)$/, '')}</span> : <Avatar p={m.user} size={36} />}
        <div className="tc-body">
          {!grouped && m.replyTo && <p className="tc-reply-pre"><span className="tc-reply-ico">{I.reply13}</span><strong>{m.replyTo.name}</strong><span>{m.replyTo.text}</span></p>}
          {!grouped && m.inThread && <p className="tc-reply-pre"><span className="tc-reply-ico">{I.thread}</span>Replied in a thread: <strong>{m.inThread.name}</strong><span>{m.inThread.text}</span></p>}
          {!grouped && <p className="tc-who"><strong>{m.user.name}</strong><span>{m.user.label}</span><time dateTime={m.at}>{clock(m.at)}</time></p>}
          {m.removed ? <p className="tc-removed">Message removed</p> : (
            <>
              {m.body && <p className="tc-text"><Body text={m.body} m={m} /></p>}
              {m.photo && <a className="tc-photo" href={m.photo} target="_blank" rel="noopener"><img src={m.photo} alt={`Photo from ${m.user.name}`} loading="lazy" /></a>}
              {m.page && <PageLink page={m.page} onOpen={phonePanel ? () => closeChat({ restoreFocus: false }) : undefined} />}
              {m.person && <PersonLink person={m.person} onOpen={phonePanel ? () => closeChat({ restoreFocus: false }) : undefined} />}
              {m.personHidden && <p className="tc-removed">A progress card, for managers.</p>}
              {m.reactions.length > 0 && (
                <div className="tc-reacts" role="group" aria-label="Reactions">
                  {m.reactions.map((r) => {
                    const def = reactionOf(r.emoji);
                    return (
                      <button type="button" key={r.emoji} className={'tc-react' + (r.mine ? ' mine' : '') + (def.word ? ' word' : '')} aria-pressed={r.mine}
                        aria-label={chipLabel(r.emoji, r.count, r.mine)} title={r.names.join(', ')} onClick={() => a.onReact(r.emoji)}>
                        <span className="tc-react-ico" aria-hidden="true">{def.icon}</span>{def.word && <span className="tc-react-word" aria-hidden="true">{def.name}</span>}<span className="tc-react-n" aria-hidden="true">{r.count}</span>
                      </button>
                    );
                  })}
                  <button type="button" ref={addChip} className="tc-react add" aria-label="Add Reaction" aria-haspopup="dialog" onClick={() => { setPickFrom(addChip); setPicker(true); }}>{I.smilePlus16}</button>
                </div>
              )}
              {m.thread && m.thread.count > 0 && !inThread && (
                <button type="button" className="tc-thread-link" onClick={a.onThread}>
                  <span className="tc-thread-ico">{I.thread}</span><strong>{m.thread.count} {m.thread.count === 1 ? 'reply' : 'replies'}</strong>
                  {m.thread.last && <span>{m.thread.last.name} · {clock(m.thread.last.at)}</span>}
                </button>
              )}
            </>
          )}
          {seen && seen.people.length > 0 && (
            <p className="tc-seen">
              <span className="tc-seen-faces" aria-hidden="true">{seen.people.slice(0, 3).map((p) => <span key={p.id} className="tc-av" style={{ width: 20, height: 20, fontSize: 9 }}>{p.initials}</span>)}</span>
              {room.kind === 'dm' ? 'Seen' : `Seen by ${seenWords(seen.people.map((p) => p.first))}`}
            </p>
          )}
        </div>
        {/* The toolbar: hover or focus a message. Phones get a single Actions button (the sheet), for screen readers. */}
        {active && !phone && (
          <div className="tc-toolbar" role="toolbar" aria-label="Message actions">
            {QUICK.map((e) => {
              const mine = m.reactions.some((r) => r.emoji === e && r.mine);
              return <button type="button" key={e} className={'tc-tool-btn emoji' + (mine ? ' on' : '')} aria-pressed={mine} aria-label={`React ${reactionOf(e).name}`} onClick={() => a.onReact(e)}><span aria-hidden="true">{e}</span></button>;
            })}
            <span className="tc-tool-line" aria-hidden="true" />
            <button type="button" ref={pickBtn} className={'tc-tool-btn' + (picker && pickFrom === pickBtn ? ' on' : '')} aria-label="Add Reaction" aria-haspopup="dialog" aria-expanded={picker} onClick={() => { setPickFrom(pickBtn); setPicker((v) => !v); }}>{I.smilePlus}</button>
            <button type="button" className="tc-tool-btn" aria-label="Reply" onClick={a.onReply}>{I.reply}</button>
            <button type="button" ref={moreBtn} className={'tc-tool-btn' + (more ? ' on' : '')} aria-label="More" aria-haspopup="menu" aria-expanded={more} onClick={() => { setMore((v) => !v); setConfirm(false); }}>{I.more}</button>
          </div>
        )}
        {phone && !m.removed && <button type="button" className="tc-sr-actions" onClick={onLongPress}>Message Actions</button>}
        {picker && <ReactionPicker opener={pickFrom} onClose={() => setPicker(false)} onPick={(e, keep) => { a.onReact(e); if (!keep) setPicker(false); }} />}
        {more && (
          <MoreMenu opener={moreBtn} onClose={() => setMore(false)}>
            {!inThread && <button type="button" role="menuitem" onClick={() => { setMore(false); a.onThread(); }}>{I.thread18}Reply in Thread</button>}
            <button type="button" role="menuitem" onClick={() => { setMore(false); a.onCopy(); }}>{I.copy}Copy Text</button>
            {!inThread && !m.mine && <button type="button" role="menuitem" onClick={() => { setMore(false); a.onUnread(); }}>{I.unread}Mark Unread</button>}
            {room.canPin && !inThread && <button type="button" role="menuitem" onClick={() => { setMore(false); a.onPin(); }}>{I.pin18}Pin as Pre-Shift Note</button>}
            {m.canRemove && (confirm
              ? <span className="tc-confirm">Remove this message? <button type="button" className="tc-act danger" onClick={() => { setMore(false); a.onRemove(); }}>Remove</button><button type="button" className="tc-act" onClick={() => setConfirm(false)}>Keep</button></span>
              : <button type="button" role="menuitem" className="danger" onClick={() => setConfirm(true)}>{I.trash}Remove</button>)}
          </MoreMenu>
        )}
      </article>
    </>
  );
}
const seenWords = (names: string[]) => (names.length <= 3 ? names.join(names.length === 2 ? ' and ' : ', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`);

function MoreMenu({ opener, onClose, children }: { opener: RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(true, onClose, box, opener);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => { setStyle(placeNear(opener.current, 230, box.current?.offsetHeight || 200)); }, [opener]);
  const placed = style.visibility !== 'hidden';
  useEffect(() => { if (placed) box.current?.querySelector<HTMLElement>('button')?.focus(); }, [placed]);
  const keys = (e: RKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLElement>('button') || [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return <div className="tc-menu" ref={box} role="menu" aria-label="More" style={style} onKeyDown={keys}>{children}</div>;
}

/* ------------------------------ the reaction picker (683:1335) ------------------------------ */
/** Search, For Service (words), Quick, Food and Drink. Click adds and closes; Shift-click adds and keeps it open.
 *  `insert`: the composer's emoji button (emoji only, no words). */
function ReactionPicker({ opener, onClose, onPick, insert = false }: { opener: RefObject<HTMLElement | null>; onClose: () => void; onPick: (key: string, keep: boolean) => void; insert?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [hot, setHot] = useState<RDef>(PICKER_QUICK[2]);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useDismiss(true, onClose, box, opener);
  useLayoutEffect(() => { setStyle(placeNear(opener.current, 340, box.current?.offsetHeight || 392)); }, [opener]);
  // focus the search once the picker is placed (it's hidden until then, and a hidden box can't take focus)
  const placed = style.visibility !== 'hidden';
  useEffect(() => { if (placed) box.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }); }, [placed]);
  const found = q.trim() ? findReactions(q).filter((r) => !insert || !r.word) : null;
  const cell = (r: RDef) => (
    <button type="button" key={r.key} className={r.word ? 'tc-word' : 'tc-emo'} aria-label={r.word ? r.name : `${r.icon} ${r.name}`}
      onMouseEnter={() => setHot(r)} onFocus={() => setHot(r)} onClick={(e) => onPick(r.key, e.shiftKey)}>
      <span aria-hidden="true">{r.icon}</span>{r.word && <span aria-hidden="true">{r.name}</span>}
    </button>
  );
  // Arrow keys move around the grid (the words row, then the emoji rows: 8 across).
  const keys = (e: RKeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key) || (e.target as HTMLElement).tagName === 'INPUT') return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>('.tc-emo, .tc-word') || [])];
    const i = items.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? 8 : -8;
    items[Math.max(0, Math.min(items.length - 1, i + step))]?.focus();
  };
  return (
    <div className="tc-picker" ref={box} role="dialog" aria-label={insert ? 'Add an Emoji' : 'Add a Reaction'} style={style} onKeyDown={keys}>
      <label className="tc-picker-search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a reaction" aria-label="Find a reaction" /></label>
      <div className="tc-picker-body">
        {found ? (
          <>
            <p className="tc-pop-title">{found.length ? 'Results' : 'Nothing found'}</p>
            <div className="tc-picker-words">{found.filter((r) => r.word).map(cell)}</div>
            <div className="tc-picker-grid">{found.filter((r) => !r.word).map(cell)}</div>
          </>
        ) : (
          <>
            {!insert && <><p className="tc-pop-title">For Service</p><div className="tc-picker-words">{SERVICE.map(cell)}</div></>}
            <p className="tc-pop-title">Quick</p><div className="tc-picker-grid">{PICKER_QUICK.map(cell)}</div>
            <p className="tc-pop-title">Food and Drink</p><div className="tc-picker-grid">{FOOD.map(cell)}</div>
          </>
        )}
      </div>
      <div className="tc-picker-foot" aria-hidden="true">
        <span className="tc-picker-big">{hot.icon}</span>
        <span><strong>{hot.name}</strong><small>Click to add · Shift-click to add more</small></span>
      </div>
    </div>
  );
}

/* ------------------------------ phones: the long-press sheet (686:846) ------------------------------ */
function MessageSheet({ m, room, onClose, onReact, onReply, onThread, onCopy, onUnread, onPin, onRemove }: {
  m: Msg; room: Room; onClose: () => void; onReact: (e: string) => void; onReply: () => void; onThread: () => void; onCopy: () => void; onUnread: () => void; onPin: () => void; onRemove: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState(false);
  const pickBtn = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(false);
  const back = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const close = useCallback(() => { onClose(); requestAnimationFrame(() => back.current?.isConnected && back.current.focus()); }, [onClose]);
  useEffect(() => {
    box.current?.focus({ preventScroll: true }); // the sheet itself, so no button looks picked; Tab goes on from there
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !picker) { e.preventDefault(); close(); } };
    document.addEventListener('keydown', esc);
    document.body.classList.add('menu-lock');
    return () => { document.removeEventListener('keydown', esc); document.body.classList.remove('menu-lock'); };
  }, [close, picker]);
  // Tab stays inside the sheet.
  const trap = (e: RKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>('button') || [])];
    const i = items.indexOf(document.activeElement as HTMLElement); // -1: the sheet itself
    if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0]?.focus(); }
  };
  return (
    <div className="tc-sheet-wrap">
      <button type="button" className="tc-sheet-scrim" aria-label="Close" tabIndex={-1} onClick={close} />
      <div className="tc-sheet-msg" aria-hidden="true">
        <Avatar p={m.user} size={32} />
        <span><strong>{m.user.name}</strong> <small>{clock(m.at)}</small><span className="tc-sheet-text">{m.body ? <Body text={m.body} m={m} /> : m.page?.title || (m.photo ? 'Photo' : '')}</span></span>
      </div>
      <div className="tc-sheet" ref={box} role="dialog" aria-modal="true" aria-label={`Message from ${m.user.name}`} onKeyDown={trap} tabIndex={-1}>
        <span className="tc-sheet-grab" aria-hidden="true" />
        <div className="tc-sheet-quick">
          {['👍', '✅', '🔥', '👀', '🙏'].map((e) => {
            const mine = m.reactions.some((r) => r.emoji === e && r.mine);
            return <button type="button" key={e} className={mine ? 'on' : ''} aria-pressed={mine} aria-label={`React ${reactionOf(e).name}`} onClick={() => onReact(e)}><span aria-hidden="true">{e}</span></button>;
          })}
          <button type="button" ref={pickBtn} className="more" aria-label="More Reactions" aria-haspopup="dialog" onClick={() => setPicker(true)}>{I.smilePlus}</button>
        </div>
        <div className="tc-sheet-words">
          {SERVICE.map((r) => {
            const mine = m.reactions.some((x) => x.emoji === r.key && x.mine);
            return <button type="button" key={r.key} className={mine ? 'on' : ''} aria-pressed={mine} aria-label={r.name} onClick={() => onReact(r.key)}><span aria-hidden="true">{r.icon}</span><span aria-hidden="true">{r.name}</span></button>;
          })}
        </div>
        <div className="tc-sheet-list">
          <button type="button" onClick={onReply}>{I.reply}Reply</button>
          <button type="button" onClick={onThread}>{I.thread18}Reply in Thread</button>
          <button type="button" onClick={onCopy}>{I.copy}Copy Text</button>
          {!m.mine && <button type="button" onClick={onUnread}>{I.unread}Mark Unread</button>}
          {room.canPin && <button type="button" onClick={onPin}>{I.pin18}Pin as Pre-Shift Note</button>}
          {m.canRemove && (confirm
            ? <div className="tc-sheet-confirm"><span>Remove this message?</span><button type="button" className="danger" onClick={onRemove}>Remove</button><button type="button" onClick={() => setConfirm(false)}>Keep</button></div>
            : <button type="button" className="danger" onClick={() => setConfirm(true)}>{I.trash}Remove</button>)}
        </div>
      </div>
      {picker && <ReactionPicker opener={pickBtn} onClose={() => setPicker(false)} onPick={(e) => { setPicker(false); onReact(e); }} />}
    </div>
  );
}

/* ------------------------------ cards ------------------------------ */
/** The card a page makes: what it is ("House cocktail"), its title, one line, Open Page; its photo on the right. */
function PageLink({ page, onOpen }: { page: PageCard; onOpen?: () => void }) {
  return (
    <Link to={'/' + page.slug} className="tc-card" onClick={onOpen}>
      <PageCardInner page={page} open />
    </Link>
  );
}
function PageCardInner({ page, open = false }: { page: PageCard; open?: boolean }) {
  return (
    <>
      <span className="tc-card-copy">
        <span className="tc-card-kicker">{page.kicker || page.kind}</span>
        <strong>{page.title}</strong>
        {page.line && <span className="tc-card-line">{page.line}</span>}
        {open && <span className="tc-card-open">Open Page {I.arrow}</span>}
      </span>
      {page.thumb ? <img src={page.thumb} style={focusImg(page.thumb)} alt="" /> : <span className="tc-card-tile">{/allergen|safety/.test(page.slug) ? I.shield : I.book}</span>}
    </>
  );
}

/** A person's progress, as a manager shared it: job, steps done, status and what's next. Opens them on People. */
const personLine = (p: PersonCard) => {
  const n = p.next;
  return !p.job ? 'No job picked yet' : !n ? 'Every step is done' : 'waiting' in n ? 'Waiting on a sign-off' : `Next: ${n.kind === 'quiz' && !/quiz/i.test(n.title) ? n.title + ' quiz' : n.title} · ${dueText(n.due, n.late)}`;
};
function PersonCardInner({ person: p }: { person: PersonCard }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <>
      <span className="tc-card-tile tc-person-av" aria-hidden="true">{p.initials}</span>
      <span className="tc-card-copy">
        <span className="tc-card-kicker">Progress{p.job ? ' · ' + p.job : ''}</span>
        <span className="tc-person-name"><strong>{p.name}</strong><span className={'mg-status ' + p.status}>{STATUS[p.status]}</span></span>
        <span className="tc-person-progress">
          <span className="tc-person-bar" aria-hidden="true"><span style={{ width: pct + '%' }} /></span>
          <span>{p.done} of {p.total} steps{p.week && p.weeks ? ` · Week ${p.week} of ${p.weeks}` : ''}</span>
        </span>
        <span className="tc-card-line">{personLine(p)}</span>
      </span>
    </>
  );
}
function PersonLink({ person, onOpen }: { person: PersonCard; onOpen?: () => void }) {
  return (
    <Link to={'/admin/people?id=' + person.id} className="tc-card tc-card-person" onClick={onOpen} aria-label={`${person.name}'s progress: ${STATUS[person.status]}, ${person.done} of ${person.total} steps. Open on People.`}>
      <PersonCardInner person={person} />
    </Link>
  );
}

/** The staged item (Send to Team, or Link a Page) as a card with an ✕, in the composer or under the panel's list. */
export function StagedCard({ staged, note }: { staged: NonNullable<Staged>; note?: ReactNode }) {
  return (
    <div className="tc-staged">
      <div className={'tc-card tc-card-staged' + (staged.type === 'person' ? ' tc-card-person' : '')} aria-live="polite">
        {staged.error ? <span className="tc-card-copy"><span className="tc-card-kicker">Didn’t load</span><span className="tc-card-line wrap">{staged.error}</span></span>
          : !staged.card ? <span className="tc-card-copy"><span className="tc-card-kicker">Loading…</span><strong>&nbsp;</strong></span>
          : staged.type === 'page' ? <PageCardInner page={staged.card as PageCard} /> : <PersonCardInner person={staged.card as PersonCard} />}
        <button type="button" className="tc-unstage" aria-label="Remove this card" onClick={clearStaged}>{I.close}</button>
      </div>
      {note}
    </div>
  );
}

/* ------------------------------ composer: text, a photo, a page from the book ------------------------------ */
/** The partial "@word" just before the caret, if the caret is in one (Growth's activeMention): "@" starts a word, a space ends it. */
function activeMention(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1 || (at > 0 && !/\s/.test(upto[at - 1]))) return null;
  const query = upto.slice(at + 1);
  return /\s/.test(query) || query.length > 30 ? null : { query, start: at };
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "@Marisol Vega" → "<@12>" for the people in this conversation (longest names first, so "Ana Lee" beats "Ana"). */
export function toMentionTokens(text: string, members: { id: number; name: string }[]) {
  let out = text;
  for (const p of [...members].sort((a, b) => b.name.length - a.name.length)) {
    out = out.replace(new RegExp(`(^|\\s)@${escapeRe(p.name)}(?=$|[\\s.,!?;:'’)])`, 'g'), `$1<@${p.id}>`);
  }
  return out;
}

type ComposerRoom = Pick<Room, 'id' | 'key' | 'kind' | 'name' | 'members' | 'canStart' | 'canSendPerson'>;
function Composer({ room, demo, replyTo, clearReply, onSent, autoFocus = false, onPickOther, areaRef, thread }: {
  room: ComposerRoom; demo: boolean; replyTo: Msg | null; clearReply: () => void; onSent: (d: Detail | ThreadDetail) => void; autoFocus?: boolean; onPickOther?: () => void;
  areaRef?: RefObject<HTMLTextAreaElement | null>; thread?: { id: number };
}) {
  const { user } = useSession();
  const { staged: panelStaged } = useChatPanel();
  const staged = thread ? null : panelStaged;
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ url: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [linking, setLinking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [also, setAlso] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [pick, setPick] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const own = useRef<HTMLTextAreaElement>(null);
  const area = areaRef || own;
  const addBtn = useRef<HTMLButtonElement>(null);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  const lastPing = useRef(0);
  useDismiss(adding, () => setAdding(false), addMenu, addBtn);
  useEffect(() => { if (replyTo) area.current?.focus(); }, [replyTo, area]);
  useEffect(() => { if (autoFocus) area.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const a = area.current; if (a) { a.style.height = 'auto'; a.style.height = Math.min(a.scrollHeight, 160) + 'px'; } }, [text, area]);
  const locked = !room.canStart && !replyTo && !thread;

  // @mentions: only the people in this conversation (Growth: "a mention is a claim that someone will see it").
  const roster = room.members.filter((m) => m.id !== user?.id);
  const q = mention?.query.toLowerCase() ?? '';
  const suggestions = mention ? roster.filter((m) => m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || m.name.toLowerCase().startsWith(q)).slice(0, 6) : [];
  const watch = (el: HTMLTextAreaElement) => { setMention(activeMention(el.value, el.selectionStart ?? el.value.length)); setPick(0); };
  const choose = (p: Person) => {
    const el = area.current; if (!el || !mention) return;
    const caret = el.selectionStart ?? text.length;
    const inserted = `@${p.name} `;
    const next = text.slice(0, mention.start) + inserted + text.slice(caret);
    setText(next); setMention(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(mention.start + inserted.length, mention.start + inserted.length); });
  };
  const insertAtCaret = (s: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? text.length, to = el?.selectionEnd ?? at;
    const next = text.slice(0, at) + s + text.slice(to);
    setText(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + s.length, at + s.length); });
  };
  // "typing…": a ping at most every 3 s while you type (the server forgets it after 5).
  const ping = () => {
    const t = Date.now();
    if (t - lastPing.current < 3000) return;
    lastPing.current = t;
    void api(`/api/chat/room/${enc(room.key)}/typing`, { method: 'POST' }).catch(() => {});
  };

  // The staged card (Send to Team or Link a Page). A progress card only goes to another manager, in a direct message.
  const cardBlocked = staged?.type === 'person' && !room.canSendPerson;
  const cardReady = !!staged?.card && !cardBlocked;
  const cardWaiting = !!staged && !staged.card && !staged.error;
  const canSend = !busy && !cardWaiting && !cardBlocked && !staged?.error && (!!text.trim() || !!photo || cardReady);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    setBusy('Sending…'); setErr('');
    try {
      const body = toMentionTokens(text, room.members);
      const payload = { body, photo: photo?.url, replyTo: replyTo?.id, page: cardReady && staged?.type === 'page' ? staged.slug : undefined, person: cardReady && staged?.type === 'person' ? staged.id : undefined };
      const d = thread
        ? await api<ThreadDetail>(`/api/chat/message/${thread.id}/thread`, { method: 'POST', body: { ...payload, alsoChannel: also } })
        : await api<Detail>(`/api/chat/room/${enc(room.key)}/messages`, { method: 'POST', body: payload });
      setText(''); setPhoto(null); clearReply(); if (cardReady) clearStaged(); lastPing.current = 0; onSent(d);
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'That didn’t send. Try again.'); }
    setBusy('');
  };
  const pickPhoto = () => {
    setAdding(false);
    if (demo) { setErr('That’s switched off in the demo.'); return; }
    file.current?.click();
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy('Uploading photo…'); setErr('');
    try {
      const res = await fetch('/api/chat/photo', { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-BT': '1' }, body: f, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.error || 'That photo didn’t upload. Try again.');
      setPhoto({ url: data.url });
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'That photo didn’t upload. Try again.'); }
    setBusy('');
    if (file.current) file.current.value = '';
  };
  // In the panel, the note offers the conversations the card can go to (the list, showing managers only).
  const blockedNote = cardBlocked ? (
    <div className="tc-blocked">
      <p className="tc-compose-note err" role="note">Progress cards go only to another manager, in a direct message. Pick a manager, or remove the card.</p>
      {onPickOther && <button type="button" className="tc-act" onClick={onPickOther}>Pick a Manager</button>}
    </div>
  ) : null;
  const where = room.kind === 'dm' ? room.name.split(' ')[0] : '#' + room.name;

  if (locked) return (
    <div className="tc-compose-wrap">
      {staged && <StagedCard staged={staged} note={(
        <div className="tc-blocked">
          <p className="tc-compose-note" role="note">Managers start posts in {where}. Pick another conversation to send this.</p>
          {onPickOther && <button type="button" className="tc-act" onClick={onPickOther}>Pick a Conversation</button>}
        </div>
      )} />}
      <p className="tc-locked">Managers start posts in {where}. Hover a post (or hold it on a phone) and press Reply to answer it.</p>
    </div>
  );
  return (
    <form className="tc-compose-wrap" onSubmit={(e) => void send(e)}>
      {staged && <StagedCard staged={staged} note={blockedNote} />}
      {(replyTo || photo) && (
        <div className="tc-attach">
          {replyTo && <span className="tc-chip">Replying to {replyTo.user.name}<button type="button" aria-label="Cancel reply" onClick={clearReply}>{I.close}</button></span>}
          {photo && <span className="tc-chip tc-chip-photo"><img src={photo.url} alt="Photo to send" />Photo<button type="button" aria-label="Remove photo" onClick={() => setPhoto(null)}>{I.close}</button></span>}
        </div>
      )}
      <div className="tc-compose">
        {mention && suggestions.length > 0 && (
          <div className="tc-mention" role="listbox" id={`tc-mention-${room.id}`} aria-label="People in this conversation">
            <p className="tc-pop-title">Mention someone in {room.kind === 'dm' ? 'this conversation' : '#' + room.name}</p>
            {suggestions.map((p, i) => (
              <button type="button" role="option" id={`tc-mention-${room.id}-${i}`} aria-selected={i === pick} key={p.id} className={i === pick ? 'on' : ''}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setPick(i)} onClick={() => choose(p)}>
                <Avatar p={p} size={28} /><span><strong>{p.name}</strong><small>{p.label}</small></span>
              </button>
            ))}
          </div>
        )}
        <span className="tc-pop-wrap">
          <button type="button" ref={addBtn} className="tc-cbtn add" aria-label="Add a Photo or a Page" aria-haspopup="menu" aria-expanded={adding} disabled={!!busy} onClick={() => setAdding((v) => !v)}>{I.plus18}</button>
          {adding && (
            <div className="tc-menu tc-add-menu" ref={addMenu} role="menu" aria-label="Add">
              <button type="button" role="menuitem" autoFocus onClick={pickPhoto}>{I.photo}Photo</button>
              <button type="button" role="menuitem" onClick={() => { setAdding(false); setLinking(true); }}>{I.book}Link a Page</button>
            </div>
          )}
          {linking && <PagePicker onPick={(e) => { stageItem({ type: 'page', slug: e.slug }); setLinking(false); area.current?.focus(); }} onClose={() => { setLinking(false); addBtn.current?.focus(); }} />}
        </span>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        <textarea ref={area} rows={1} value={text} maxLength={2000}
          placeholder={staged ? 'Add a message (optional)' : replyTo ? `Reply to ${replyTo.user.name.split(' ')[0]}` : thread ? 'Reply in thread' : `Message ${where}`}
          aria-label={thread ? 'Reply in thread' : `Message ${where}`} aria-autocomplete="list"
          // (a text box can't carry aria-expanded or a combobox role, Nov 12 scan; the list and its picked option are linked instead)
          aria-controls={mention && suggestions.length ? `tc-mention-${room.id}` : undefined}
          aria-activedescendant={mention && suggestions.length ? `tc-mention-${room.id}-${Math.min(pick, suggestions.length - 1)}` : undefined}
          onChange={(e) => { setText(e.target.value); watch(e.target); if (e.target.value.trim()) ping(); }}
          onSelect={(e) => watch(e.currentTarget)}
          onBlur={() => setMention(null)}
          onKeyDown={(e) => {
            if (mention && suggestions.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setPick((i) => (i + 1) % suggestions.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setPick((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
              if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) { e.preventDefault(); choose(suggestions[Math.min(pick, suggestions.length - 1)]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          }} />
        <button type="button" ref={emojiBtn} className="tc-cbtn" aria-label="Add an Emoji" aria-haspopup="dialog" aria-expanded={emoji} onClick={() => setEmoji((v) => !v)}>{I.smile}</button>
        {emoji && <ReactionPicker insert opener={emojiBtn} onClose={() => setEmoji(false)} onPick={(e, keep) => { insertAtCaret(e); if (!keep) setEmoji(false); }} />}
        <button type="submit" className="tc-send" disabled={!canSend} aria-label={busy === 'Sending…' ? 'Sending' : 'Send'}>{I.send}</button>
      </div>
      {thread && room.kind !== 'dm' && (
        <label className="tc-also"><input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} /> Also send to #{room.name}</label>
      )}
      {(err || busy === 'Uploading photo…') && <p className={'tc-compose-note' + (err ? ' err' : '')} role={err ? 'alert' : 'status'}>{err || busy}</p>}
    </form>
  );
}

/** Link a Page: the book's own search, as a list to pick from. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function PagePicker({ onPick, onClose }: { onPick: (e: IndexEntry) => void; onClose: () => void }) {
  const { index } = useSession();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);
  const folded = useMemo(() => index.map((e) => ({ e, t: fold(e.title), n: fold(e.name) })), [index]);
  const term = fold(q.trim());
  const results = useMemo(() => {
    if (!term) return [];
    const scored: { e: IndexEntry; s: number }[] = [];
    for (const { e, t, n } of folded) {
      const s = t === term ? 100 : t.startsWith(term) ? 70 : t.split(/[\s-]+/).some((w) => w.startsWith(term)) ? 55 : term.length >= 2 && t.includes(term) ? 40 : term.length >= 2 && n.includes(term) ? 25 : 0;
      if (s) scored.push({ e, s: s - e.name.split(' · ').length * 2 });
    }
    return scored.sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title)).slice(0, 7).map((x) => x.e);
  }, [term, folded]);
  return (
    <div className="tc-pop tc-pages" ref={box} role="dialog" aria-label="Link a Page">
      <p className="tc-pop-title">Link a Page</p>
      <input autoFocus placeholder="Search the book" aria-label="Search the book" value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); if (results[active]) onPick(results[active]); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        }} />
      <div className="tc-pop-list" role="listbox" aria-label="Pages">
        {!term && <p className="tc-none">Type a dish, a drink or a page.</p>}
        {term && !results.length && <p className="tc-none">Nothing found for “{q.trim()}”.</p>}
        {results.map((e, i) => (
          <button type="button" role="option" aria-selected={i === active} key={e.slug} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onClick={() => onPick(e)}>
            {e.thumb ? <img src={e.thumb} style={focusImg(e.thumb)} alt="" /> : <span className="tc-card-tile small">{I.book}</span>}
            <span><strong>{e.title}</strong><small>{e.name.split(' · ').slice(0, -1).join(' · ') || e.nav || 'Page'}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ===================================== right: the thread ===================================== */
function ThreadPanel({ id, room, phone, demo, onClose, onChanged }: { id: number; room: Room; phone: boolean; demo: boolean; onClose: () => void; onChanged: () => void }) {
  const [t, setT] = useState<ThreadDetail | null>(null);
  const [err, setErr] = useState('');
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [sheet, setSheet] = useState<Msg | null>(null);
  const [toast, setToast] = useState('');
  const box = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(async () => {
    try { setT(await api<ThreadDetail>(`/api/chat/message/${id}/thread`)); setErr(''); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'This thread didn’t load. Try again.'); }
  }, [id]);
  useEffect(() => { setT(null); void load(); }, [load]);
  usePoll(() => void load(), 4000, !!t);
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, [id]);
  useLayoutEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [t?.replies.length]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.tc-picker, .tc-menu, .tc-sheet')) { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const react = async (m: Msg, emoji: string) => {
    try { setT(await api<ThreadDetail>(`/api/chat/message/${m.id}/react`, { method: 'POST', body: { emoji, thread: id } })); onChanged(); } catch { /* next poll */ }
  };
  const remove = async (m: Msg) => { try { await api(`/api/chat/message/${m.id}`, { method: 'DELETE' }); void load(); onChanged(); } catch { /* next poll */ } };
  const copy = async (m: Msg) => { try { await navigator.clipboard.writeText(plainText(m)); setToast('Copied.'); } catch { setToast('Couldn’t copy on this device.'); } setTimeout(() => setToast(''), 2500); };
  const rowProps = (m: Msg) => ({
    onReact: (e: string) => void react(m, e), onReply: () => { setReplyTo(m); area.current?.focus(); }, onThread: () => {}, onPin: () => {}, onRemove: () => void remove(m),
    onCopy: () => void copy(m), onUnread: () => {}, onLongPress: () => setSheet(m),
  });
  return (
    <aside className="tc-side tc-thread" ref={box} tabIndex={-1} aria-label={`Thread in ${roomLabel(room)}`}>
      <header className="tc-side-head">
        <div><h2>Thread</h2><p>{roomLabel(room)}</p></div>
        <button type="button" className="tc-hide-btn" onClick={onClose} aria-label="Close thread"><span className="tc-wide-only">{I.right}<span>Close</span></span><span className="tc-narrow-only">{I.close}</span></button>
      </header>
      {err && <p className="tc-error" role="alert">{err}</p>}
      {!t && !err && <div className="loader" />}
      {t && (
        <>
          <div className="tc-msgs tc-thread-msgs" ref={list} role="log" aria-label="Thread messages">
            <div className="tc-msgs-in">
              <MessageRow m={t.parent} room={{ kind: room.kind, canPin: false }} grouped={false} newDay={false} isNew={false} seen={null} phone={phone} phonePanel={false} inThread {...rowProps(t.parent)} />
              <p className="tc-thread-count">{t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}</p>
              {t.replies.map((m, i) => {
                const prev = t.replies[i - 1];
                const grouped = !!prev && prev.user.id === m.user.id && !m.replyTo && new Date(m.at).getTime() - new Date(prev.at).getTime() < 7 * 60e3;
                return <MessageRow key={m.id} m={m} room={{ kind: room.kind, canPin: false }} grouped={grouped} newDay={false} isNew={false} seen={null} phone={phone} phonePanel={false} inThread {...rowProps(m)} />;
              })}
            </div>
          </div>
          {toast && <p className="tc-flash" role="status">{toast}</p>}
          <Composer room={{ ...t.room, kind: room.kind, name: room.name }} demo={demo} replyTo={replyTo} clearReply={() => setReplyTo(null)} areaRef={area} thread={{ id: t.parent.id }}
            onSent={(x) => { setT(x as ThreadDetail); onChanged(); }} />
        </>
      )}
      {sheet && <MessageSheet m={sheet} room={{ ...room, canPin: false }} onClose={() => setSheet(null)}
        onReact={(e) => { void react(sheet, e); setSheet(null); }} onReply={() => { setReplyTo(sheet); setSheet(null); area.current?.focus(); }}
        onThread={() => setSheet(null)} onCopy={() => { void copy(sheet); setSheet(null); }} onUnread={() => setSheet(null)} onPin={() => setSheet(null)}
        onRemove={() => { void remove(sheet); setSheet(null); }} />}
    </aside>
  );
}

/* ===================================== right: members ===================================== */
function MembersPanel({ d, manager, onClose, phone }: { d: Detail; manager: boolean; onClose: () => void; phone: boolean }) {
  const r = d.room;
  const on = r.members.filter((m) => m.online);
  const off = r.members.filter((m) => !m.online);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!phone) return;
    box.current?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [phone, onClose]);
  const group = (title: string, list: Person[]) => list.length > 0 && (
    <section className="tc-mem-group" aria-label={title}>
      <p className="tc-group tc-group-static">{title} · {list.length}</p>
      <ul className="tc-members">
        {list.map((m) => <li key={m.id} className={m.online ? '' : 'off'}><Avatar p={m} size={32} dot /><span><strong>{m.name}</strong><small>{m.label}</small></span></li>)}
      </ul>
    </section>
  );
  return (
    <aside className="tc-side tc-members-panel" ref={box} tabIndex={-1} aria-label={r.kind === 'dm' ? 'About this conversation' : 'Members'}>
      <header className="tc-side-head">
        <div><h2>{r.kind === 'dm' ? 'Direct Message' : 'Members'}</h2>{r.kind === 'dm' && <p>Only the two of you see these messages.</p>}</div>
        <button type="button" className="tc-hide-btn" onClick={onClose} aria-label="Hide members"><span className="tc-wide-only">{I.right}<span>Hide</span></span><span className="tc-narrow-only">{I.close}</span></button>
      </header>
      {group('On Now', on)}
      {group('Offline', off)}
      {manager && r.kind !== 'dm' && <Link to="/admin/people" className="tc-small-btn tc-add-people">Add People</Link>}
      {d.shared.length > 0 && (
        <section className="tc-mem-group" aria-label="Shared Pages">
          <p className="tc-group tc-group-static">Shared Pages · {d.shared.length}</p>
          <ul className="tc-shared">
            {d.shared.slice(0, 6).map((p) => (
              <li key={p.slug}><Link to={'/' + p.slug}>
                {p.thumb ? <img src={p.thumb} style={focusImg(p.thumb)} alt="" /> : <span className="tc-card-tile">{/allergen|safety/.test(p.slug) ? I.shield : I.book}</span>}
                <span><strong>{p.title}</strong><small>{p.kicker.replace(/^The Book · /, '')} · {p.at ? dayWord(p.at) : ''}</small></span>
              </Link></li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
