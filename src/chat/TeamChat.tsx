// Team Chat (Nov 11). Figma: 09 · Proposals → 27 · Team chat, "Team Chat · Front of House · Desktop" (580:670).
// Desktop: conversations on the left, the open conversation in the middle (pinned pre-shift note, messages, composer),
// its details on the right. Phone (no design; the app's phone pattern): the list, then a conversation full screen with a
// back button and the composer pinned to the bottom. The server decides who's in what (server/chat.mjs).
// The same pieces run in the side panel (ChatPanel.tsx): the list and one conversation, Growth's way, beside any page.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, type IndexEntry } from '../lib/api';
import { useSession } from '../lib/session';
import { focusImg } from '../lib/focus';
import { setChatUnread } from './unread';
import { clearStaged, closeChat, stageItem, useChatPanel, type PageCard, type PersonCard, type Staged } from './panel';
import { dueText, STATUS } from '../admin/manager';

type Person = { id: number; name: string; initials: string; label: string; manager: boolean };
type Reaction = { emoji: string; count: number; mine: boolean; names: string[] };
type Msg = {
  id: number; at: string; user: Person; mine: boolean; removed?: boolean; body?: string; photo?: string | null; page?: PageCard | null;
  person?: PersonCard | null; personHidden?: boolean; mentions?: { id: number; name: string }[]; mentionsMe?: boolean;
  replyTo?: { id: number; name: string; text: string } | null; reactions: Reaction[]; canRemove?: boolean;
};
type GotIt = { mine: boolean; count: number; total: number; canTap: boolean; people?: { id: number; name: string; initials: string; at: string }[]; waiting?: { id: number; name: string; initials: string }[] };
type Pin = Msg & { title: string; pinnedAt: string; gotIt: GotIt };
type Room = {
  id: number; key: string; kind: 'everyone' | 'channel' | 'dm'; rev: number; name: string; line: string; about: string | null; other: Person | null;
  members: Person[]; canStart: boolean; canPin: boolean; lastId: number; read: number; canSendPerson?: boolean;
};
type Detail = { room: Room; messages: Msg[]; hasMore: boolean; pins: Pin[]; shared: PageCard[]; seen: { messageId: number; people: { id: number; first: string; initials: string }[]; of: number } | null; reactions: string[] };
type ListRoom = { id: number; key: string; kind: Room['kind']; name: string; unread: number; mentions?: number; last: { at: string; text: string; mine: boolean } | null; other?: Person };
export type List = { store: string; me: { id: number; name: string; manager: boolean }; rooms: ListRoom[]; unread: number; people: Person[] };
type Hit = { id: number; key: string; kind: string; roomName: string; name: string; text: string; at: string };

const LAST_KEY = 'bt-chat-room';
const enc = encodeURIComponent;

/* ------------------------------ time, in the restaurant's words ------------------------------ */
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
const dayDiff = (iso: string) => {
  const a = new Date(iso); const b = new Date();
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 864e5);
};
/** List times: "3:58 pm" today, "Yesterday", "Mon" this week, then "Nov 3". */
const listTime = (iso: string) => { const d = dayDiff(iso); return d <= 0 ? clock(iso) : d === 1 ? 'Yesterday' : d < 7 ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short' }) : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
/** "today, 3:30 pm" · "yesterday, 3:30 pm" · "Mon, 3:30 pm". */
const dayTime = (iso: string) => { const d = dayDiff(iso); return `${d <= 0 ? 'today' : d === 1 ? 'yesterday' : new Date(iso).toLocaleDateString('en-US', d < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' })}, ${clock(iso)}`; };
const dayWord = (iso: string) => { const d = dayDiff(iso); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : listTime(iso); };
const dayHead = (iso: string) => { const d = dayDiff(iso); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); };

/* ------------------------------ icons (drawn from the design's layers) ------------------------------ */
export const I = {
  plus: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.3V8M8 8v5.7M8 8H2.3M8 8h5.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  search: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7.33" cy="7.33" r="4.33" stroke="currentColor" strokeWidth="1.33" /><path d="M10.67 10.67l2.66 2.66" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" /></svg>,
  pin: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M6.5 7.04h3.25L7.58 4.88l.54-3.25H4.88l.54 3.25-2.17 2.16H6.5Zm0 0v4.34" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  photo: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 3.33h8a2 2 0 0 1 2 2v5.34a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5.33a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.33" /><circle cx="6" cy="6.67" r="1.2" stroke="currentColor" strokeWidth="1.2" /><path d="M2.67 11.33 6 8.33l2.67 2.34 2-1.67 2.66 2.33" stroke="currentColor" strokeWidth="1.33" strokeLinejoin="round" /></svg>,
  book: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.67 3.67a1 1 0 0 1 1-1h3.66v10.66H3.67a1 1 0 0 1-1-1V3.67Zm10.66 0a1 1 0 0 0-1-1H8.67v10.66h3.66a1 1 0 0 0 1-1V3.67Z" stroke="currentColor" strokeWidth="1.33" strokeLinejoin="round" /></svg>,
  send: <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M2.5 7.5 12.5 2.5 8.75 12.5 7.19 8.44 2.5 7.5Z" stroke="currentColor" strokeWidth="1.38" strokeLinejoin="round" /></svg>,
  shield: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 2.25 14.25 4.5v3.75C14.25 11.63 12 14.25 9 15.75 6 14.25 3.75 11.63 3.75 8.25V4.5L9 2.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>,
  back: <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  more: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="12.5" cy="8" r="1.4" fill="currentColor" /></svg>,
  info: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" /><path d="M9 8v4.5M9 5.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  close: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  expand: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
};

const Avatar = ({ p, size = 34, className = '' }: { p: Pick<Person, 'initials' | 'manager' | 'name'>; size?: number; className?: string }) => (
  <span className={'tc-av ' + (p.manager ? 'mgr ' : '') + className} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">{p.initials}</span>
);
const Count = ({ n, label }: { n: number; label?: string }) => (n > 0 ? <span className="tc-count" aria-label={label ?? `${n} unread`}>{n > 99 ? '99+' : n}</span> : null);

export function useIsPhone() {
  const q = '(max-width: 859px)';
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => setOn(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return on;
}

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

/* ===================================== the page ===================================== */
export function TeamChatPage() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const phone = useIsPhone();
  const key = decodeURIComponent(pathname.replace(/^\/team-chat\/?/, '').split('/')[0] || '');
  const [list, setList] = useState<List | null>(null);
  const [listErr, setListErr] = useState('');
  const [details, setDetails] = useState(false);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = 'Team Chat · Mise Academy'; }, []);
  const loadList = useCallback(async () => {
    try { const l = await api<List>('/api/chat'); setList(l); setChatUnread(l.unread); setListErr(''); }
    catch (e) { setListErr(e instanceof ApiError ? e.message : 'Team Chat didn’t load. Try again.'); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);
  usePoll(loadList, 6000);

  // Desktop opens a conversation straight away: the last one you had open, else the first channel.
  useEffect(() => {
    if (key || phone || !list?.rooms.length) return;
    let last = ''; try { last = localStorage.getItem(LAST_KEY) || ''; } catch { /* private mode */ }
    const pick = list.rooms.find((r) => r.key === last) || list.rooms[0];
    nav('/team-chat/' + pick.key, { replace: true });
  }, [key, phone, list, nav]);
  useEffect(() => { if (key) { try { localStorage.setItem(LAST_KEY, key); } catch { /* private mode */ } } setDetails(false); }, [key]);

  // The chat fills the window under whatever sits above it (the phone bar, the demo bar); the messages scroll inside.
  useLayoutEffect(() => {
    const fit = () => { const el = shell.current; if (el) el.style.setProperty('--tc-top', `${Math.max(0, el.getBoundingClientRect().top + window.scrollY)}px`); };
    fit(); window.addEventListener('resize', fit);
    const t = setTimeout(fit, 300);
    return () => { window.removeEventListener('resize', fit); clearTimeout(t); };
  }, []);

  const showList = !phone || !key;
  const showRoom = !!key && (!phone || !!key);
  return (
    <main className={'tc' + (phone ? (key ? ' tc-phone-room' : ' tc-phone-list') : '')} ref={shell} aria-label="Team Chat" id="tc">
      {showList && <Conversations list={list} error={listErr} active={key} onOpen={(k) => nav('/team-chat/' + k)} />}
      {showRoom && <Conversation key={key} roomKey={key} phone={phone} details={details} setDetails={setDetails} onChanged={loadList} />}
      {!key && !phone && <section className="tc-room tc-empty-room"><p>{list && !list.rooms.length ? 'No conversations yet.' : ''}</p></section>}
    </main>
  );
}

/* ===================================== left: conversations ===================================== */
/** The list. In the panel (`panel`), rows are buttons that open the conversation in place, and `actions` sit in the head.
 *  With a person's progress staged, only direct messages with managers show: that's where a progress card can go. */
export function Conversations({ list, error, active, onOpen, panel = false, actions, personOnly = false }: {
  list: List | null; error: string; active: string; onOpen: (key: string) => void; panel?: boolean; actions?: ReactNode; personOnly?: boolean;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    const t = setTimeout(() => { api<{ results: Hit[] }>('/api/chat/search?q=' + enc(term)).then((r) => setHits(r.results)).catch(() => setHits([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const channels = personOnly ? [] : list?.rooms.filter((r) => r.kind !== 'dm') || [];
  const dms = list?.rooms.filter((r) => r.kind === 'dm' && (!personOnly || r.other?.manager)) || [];
  const people = (list?.people || []).filter((p) => !personOnly || p.manager);
  const Title = panel ? 'h2' : 'h1';
  // A row opens its conversation: a link on the Team Chat page, a button in the panel.
  const row = (r: ListRoom, className: string, children: ReactNode) => panel
    ? <button type="button" key={r.key} className={className + (r.unread ? ' unread' : '')} onClick={() => onOpen(r.key)}>{children}</button>
    : <Link key={r.key} to={'/team-chat/' + r.key} className={className + (r.key === active ? ' on' : '') + (r.unread ? ' unread' : '')} aria-current={r.key === active ? 'page' : undefined}>{children}</Link>;
  const at = (r: ListRoom) => (r.mentions ? <span className="tc-at-count" title="Mentions you" aria-label={`${r.mentions} ${r.mentions === 1 ? 'mention' : 'mentions'} of you`}>@</span> : null);
  return (
    <section className="tc-list" aria-label="Conversations">
      <header className="tc-list-head">
        <div>
          <Title>Team Chat</Title>
          <p>{list?.store || ' '}</p>
        </div>
        <div className="tc-head-btns">
          <button type="button" className="tc-new" aria-label="New Message" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>{I.plus}</button>
          {actions}
        </div>
        {picking && list && <NewMessage people={people} onPick={(id) => { setPicking(false); onOpen('dm-' + id); }} onClose={() => setPicking(false)} />}
      </header>
      {personOnly && <p className="tc-person-note">Progress cards go only to managers, in a direct message. Pick one below, or press + for another manager.</p>}
      {!personOnly && <label className="tc-search">
        {I.search}
        <input type="search" placeholder="Search messages" aria-label="Search messages" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>}
      {error && <p className="tc-error" role="alert">{error}</p>}
      {hits ? (
        <div className="tc-hits" aria-live="polite">
          <p className="tc-group">{hits.length ? `${hits.length} ${hits.length === 1 ? 'message' : 'messages'}` : 'No messages found'}</p>
          {hits.map((h) => (
            <button type="button" key={h.id} className="tc-hit" onClick={() => { setQ(''); onOpen(h.key); }}>
              <span className="tc-hit-where">{h.kind === 'dm' ? h.roomName : '# ' + h.roomName} · {listTime(h.at)}</span>
              <strong>{h.name}</strong>
              <span className="tc-hit-text">{h.text}</span>
            </button>
          ))}
        </div>
      ) : (
        <nav className="tc-rooms" aria-label="Channels and direct messages">
          {!personOnly && <p className="tc-group">Channels</p>}
          {!list && !error && <div className="loader" />}
          {channels.map((r) => row(r, 'tc-chan', <>
            <span className="tc-hash" aria-hidden="true">#</span><span className="tc-chan-name">{r.name}</span>{at(r)}<Count n={r.unread} />
          </>))}
          <p className={'tc-group' + (personOnly ? '' : ' tc-group-dm')}>{personOnly ? 'Managers' : 'Direct Messages'}</p>
          {list && !dms.length && <p className="tc-none">{personOnly ? 'No messages with a manager yet. Press + to start one.' : 'No direct messages yet. Press + to start one.'}</p>}
          {dms.map((r) => row(r, 'tc-dm', <>
            <Avatar p={r.other!} />
            <span className="tc-dm-copy">
              <span className="tc-dm-top"><strong>{r.name}</strong>{r.last && <time dateTime={r.last.at}>{listTime(r.last.at)}</time>}</span>
              <span className="tc-dm-bottom"><span className="tc-dm-text">{r.last ? (r.last.mine ? 'You: ' : '') + r.last.text : ''}</span>{at(r)}<Count n={r.unread} /></span>
            </span>
          </>))}
        </nav>
      )}
    </section>
  );
}

function NewMessage({ people, onPick, onClose }: { people: Person[]; onPick: (id: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tc-new')) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="tc-pop tc-people" ref={box} role="dialog" aria-label="New Message">
      <p className="tc-pop-title">New Message</p>
      <input autoFocus placeholder="Find someone" aria-label="Find someone" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tc-pop-list">
        {shown.map((p) => (
          <button type="button" key={p.id} onClick={() => onPick(p.id)}><Avatar p={p} size={30} /><span><strong>{p.name}</strong><small>{p.label}</small></span></button>
        ))}
        {!shown.length && <p className="tc-none">Nobody by that name here.</p>}
      </div>
    </div>
  );
}

/* ===================================== middle: one conversation ===================================== */
/** One conversation. In the panel: a back button (`onBack`) instead of the link, the panel's own buttons (`actions`) in
 *  the head, and no details column. */
export function Conversation({ roomKey, phone, details, setDetails, onChanged, onBack, actions }: {
  roomKey: string; phone: boolean; details: boolean; setDetails: (v: boolean) => void; onChanged: () => void; onBack?: () => void; actions?: ReactNode;
}) {
  const panel = !!onBack;
  const { user } = useSession();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [older, setOlder] = useState<Msg[]>([]);
  const [moreOlder, setMoreOlder] = useState<boolean | null>(null);
  const [pinAt, setPinAt] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const rev = useRef<number | null>(null);

  const take = useCallback((x: Detail) => { setD(x); rev.current = x.room.rev; setErr(''); }, []);
  const load = useCallback(async (fresh = false) => {
    try {
      const x = await api<Detail | { same: true }>(`/api/chat/room/${enc(roomKey)}${!fresh && rev.current !== null ? '?rev=' + rev.current : ''}`);
      if (!('same' in x)) take(x);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'This conversation didn’t load. Try again.'); }
  }, [roomKey, take]);
  useEffect(() => { rev.current = null; setD(null); setOlder([]); setMoreOlder(null); setReplyTo(null); setPinAt(null); stick.current = true; void load(true); }, [roomKey, load]);
  usePoll(() => void load(), 3000, !!d);

  // Mark as read whenever something new shows while you're looking.
  useEffect(() => {
    if (!d || document.hidden || d.room.lastId <= d.room.read) return;
    api<{ unread: number }>(`/api/chat/room/${enc(roomKey)}/read`, { method: 'POST', body: { last: d.room.lastId } })
      .then((r) => { setChatUnread(r.unread); onChanged(); }).catch(() => { /* next poll */ });
  }, [d?.room.lastId, d?.room.read, roomKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stay at the newest message unless you've scrolled up to read.
  // Anything that changes the size (a photo loading, the pinned card opening, a menu under the last message) keeps you
  // at the newest message if that's where you were.
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current; if (!el || !inner.current) return;
    const fix = () => { if (stick.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(fix);
    ro.observe(el); ro.observe(inner.current);
    return () => ro.disconnect();
  }, [d === null]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only scrolling up by hand lets go of the bottom (a photo loading in doesn't count).
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
    try { take(await api<Detail>(path, { method, body })); onChanged(); }
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

  if (err && !d) return <section className="tc-room"><div className="tc-room-error"><p role="alert">{err}</p>{panel ? <button type="button" className="tc-act" onClick={onBack}>Back to Conversations</button> : phone && <Link to="/team-chat" className="tc-btn">Back to Team Chat</Link>}</div></section>;
  if (!d) return <section className="tc-room" aria-busy="true"><div className="loader" /></section>;
  const r = d.room;
  const all = [...older, ...d.messages];
  const hasMore = moreOlder ?? d.hasMore;
  const pin = d.pins.find((p) => p.id === pinAt) || d.pins[0] || null;
  const lastVisible = all[all.length - 1];

  return (
    <>
      <section className="tc-room" aria-label={r.kind === 'dm' ? r.name : '# ' + r.name}>
        <header className="tc-room-head">
          {panel ? <button type="button" className="tc-back" aria-label="Back to Conversations" onClick={onBack}>{I.back}</button>
            : phone && <Link to="/team-chat" className="tc-back" aria-label="Back to Team Chat">{I.back}</Link>}
          {r.other && <Avatar p={r.other} size={36} />}
          <div className="tc-titles">
            <h2>{r.kind !== 'dm' && <span className="tc-hash" aria-hidden="true">#</span>}{r.name}</h2>
            <p>{r.line}</p>
          </div>
          {r.kind !== 'dm' && !panel && (
            <button type="button" className="tc-faces" onClick={() => setDetails(!details)} aria-label={`${r.members.length} members. Show details`}>
              {r.members.slice(0, 5).map((m) => <Avatar key={m.id} p={m} size={30} />)}
              {r.members.length > 5 && <span className="tc-av more" style={{ width: 30, height: 30 }} aria-hidden="true">+{r.members.length - 5}</span>}
            </button>
          )}
          {!panel && <button type="button" className="tc-info" aria-label={details ? 'Hide details' : 'Show details'} aria-expanded={details} onClick={() => setDetails(!details)}>{I.info}</button>}
          {actions && <div className="tc-head-btns">{actions}</div>}
        </header>

        {pin && <PinnedCard pin={pin} manager={!!d.room.canPin} count={d.pins.length}
          onGot={(on) => void act(`/api/chat/message/${pin.id}/got-it`, on ? 'POST' : 'DELETE')}
          onUnpin={() => void act(`/api/chat/message/${pin.id}/pin`, 'DELETE')} />}

        <div className="tc-msgs" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages">
          <div className="tc-msgs-in" ref={inner}>
          {hasMore && <button type="button" className="tc-older" onClick={() => void loadOlder()}>Show Earlier Messages</button>}
          {!all.length && <Empty room={r} />}
          {all.map((m, i) => (
            <MessageRow key={m.id} m={m} room={r} reactions={d.reactions} prev={all[i - 1]} phonePanel={panel && phone}
              seen={m.id === lastVisible?.id && d.seen?.messageId === m.id ? d.seen : null}
              onReact={(e) => void act(`/api/chat/message/${m.id}/react`, 'POST', { emoji: e })}
              onReply={() => setReplyTo(m)}
              onPin={() => void act(`/api/chat/message/${m.id}/pin`, 'POST')}
              onRemove={() => void act(`/api/chat/message/${m.id}`, 'DELETE')} />
          ))}
          </div>
        </div>
        {note && <p className="tc-note" role="alert">{note} <button type="button" onClick={() => setNote('')} aria-label="Dismiss">{I.close}</button></p>}
        <Composer room={r} demo={!!user?.demo} replyTo={replyTo} clearReply={() => setReplyTo(null)} autoFocus={panel && !phone} onPickOther={onBack}
          onSent={(x) => { stick.current = true; take(x); onChanged(); }} />
      </section>
      {!panel && <Details d={d} open={details} onClose={() => setDetails(false)} manager={!!user && user.role !== 'staff'} onPin={(id) => setPinAt(id)} />}
    </>
  );
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
function Body({ text, m }: { text: string; m: Msg }) {
  const { user } = useSession();
  const parts = text.split(/<@(\d+)>/);
  return <>{parts.map((p, i) => {
    if (i % 2 === 0) return p;
    const id = Number(p);
    const who = m.mentions?.find((x) => x.id === id);
    return <span key={i} className={'tc-at' + (id === user?.id ? ' me' : '')}>@{who?.name || 'Former teammate'}</span>;
  })}</>;
}

function PinnedCard({ pin, manager, count, onGot, onUnpin }: { pin: Pin; manager: boolean; count: number; onGot: (on: boolean) => void; onUnpin: () => void }) {
  const [who, setWho] = useState(false);
  const g = pin.gotIt;
  return (
    <div className="tc-pinned-wrap">
      <div className="tc-pinned" aria-label={`Pinned: ${pin.title}`}>
        <div className="tc-pinned-head">
          <span className="tc-pin-icon">{I.pin}</span>
          <span className="tc-pinned-title">Pinned · {pin.title}{count > 1 ? ` · 1 of ${count}` : ''}</span>
          <span className="tc-pinned-by">{pin.user.name} · {clock(pin.at)}</span>
        </div>
        <div className="tc-pinned-notes">{pin.body ? <NoteLines text={pin.body} m={pin} /> : null}</div>
        {pin.photo && <img className="tc-pinned-photo" src={pin.photo} alt="" />}
        <div className="tc-pinned-foot">
          {g.canTap && (g.mine
            ? <button type="button" className="tc-got done" aria-pressed="true" onClick={() => onGot(false)}><span aria-hidden="true">✓</span> Got It</button>
            : <button type="button" className="tc-got" aria-pressed="false" onClick={() => onGot(true)}>Got It</button>)}
          {manager && g.people && (
            <button type="button" className="tc-got-count" aria-expanded={who} onClick={() => setWho((v) => !v)}>
              {g.count} of {g.total} got it <span aria-hidden="true">{who ? '▴' : '▾'}</span>
            </button>
          )}
          {manager && <button type="button" className="tc-unpin" onClick={onUnpin}>Unpin</button>}
        </div>
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

function MessageRow({ m, room, reactions, prev, seen, phonePanel, onReact, onReply, onPin, onRemove }: {
  m: Msg; room: Room; reactions: string[]; prev?: Msg; seen: Detail['seen']; phonePanel: boolean;
  onReact: (e: string) => void; onReply: () => void; onPin: () => void; onRemove: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
  return (
    <>
      {newDay && <p className="tc-day"><span>{dayHead(m.at)}</span></p>}
      <article className={'tc-msg' + (menu ? ' menu' : '') + (m.mentionsMe ? ' at-me' : '')} aria-label={`${m.user.name}, ${clock(m.at)}${m.mentionsMe ? ', mentions you' : ''}`}>
        <Avatar p={m.user} />
        <div className="tc-body">
          <p className="tc-who"><strong>{m.user.name}</strong><span>{m.user.label}</span><time dateTime={m.at}>{clock(m.at)}</time>
            {!m.removed && <button type="button" className="tc-more" aria-label="Message actions" aria-expanded={menu} onClick={() => { setMenu((v) => !v); setConfirm(false); }}>{I.more}</button>}
          </p>
          {m.removed ? <p className="tc-removed">Message removed</p> : (
            <>
              {m.replyTo && <p className="tc-quote"><strong>{m.replyTo.name}</strong> {m.replyTo.text}</p>}
              {m.body && <p className="tc-text"><Body text={m.body} m={m} /></p>}
              {m.photo && <a className="tc-photo" href={m.photo} target="_blank" rel="noopener"><img src={m.photo} alt={`Photo from ${m.user.name}`} loading="lazy" /></a>}
              {m.page && <PageLink page={m.page} onOpen={phonePanel ? () => closeChat({ restoreFocus: false }) : undefined} />}
              {m.person && <PersonLink person={m.person} onOpen={phonePanel ? () => closeChat({ restoreFocus: false }) : undefined} />}
              {m.personHidden && <p className="tc-removed">A progress card, for managers.</p>}
              {m.reactions.length > 0 && (
                <div className="tc-reacts">
                  {m.reactions.map((r) => (
                    <button type="button" key={r.emoji} className={'tc-react' + (r.mine ? ' mine' : '')} aria-pressed={r.mine} title={r.names.join(', ')}
                      aria-label={`${r.emoji} ${r.count}: ${r.names.join(', ')}`} onClick={() => onReact(r.emoji)}>
                      <span aria-hidden="true">{r.emoji}</span><span aria-hidden="true">{r.count}</span>
                    </button>
                  ))}
                </div>
              )}
              {menu && (
                <div className="tc-actions" role="group" aria-label="Message actions">
                  {reactions.map((e) => <button type="button" key={e} className="tc-emoji" aria-label={`React ${e}`} onClick={() => { onReact(e); setMenu(false); }}>{e}</button>)}
                  <button type="button" className="tc-act" onClick={() => { onReply(); setMenu(false); }}>Reply</button>
                  {room.canPin && <button type="button" className="tc-act" onClick={() => { onPin(); setMenu(false); }}>Pin as Pre-Shift Note</button>}
                  {m.canRemove && (confirm
                    ? <span className="tc-confirm">Remove this message? <button type="button" className="tc-act danger" onClick={() => { onRemove(); setMenu(false); }}>Remove</button><button type="button" className="tc-act" onClick={() => setConfirm(false)}>Keep</button></span>
                    : <button type="button" className="tc-act danger" onClick={() => setConfirm(true)}>Remove</button>)}
                </div>
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
      </article>
    </>
  );
}
const seenWords = (names: string[]) => (names.length <= 3 ? names.join(names.length === 2 ? ' and ' : ', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`);

/** The card a page makes: its photo, what it is ("House cocktail"), its title and one line. Opens the page. */
function PageLink({ page, onOpen }: { page: PageCard; onOpen?: () => void }) {
  return (
    <Link to={'/' + page.slug} className="tc-card" onClick={onOpen}>
      <PageCardInner page={page} />
      <span className="tc-card-open">Open Page →</span>
    </Link>
  );
}
function PageCardInner({ page }: { page: PageCard }) {
  return (
    <>
      {page.thumb ? <img src={page.thumb} style={focusImg(page.thumb)} alt="" /> : <span className="tc-card-tile">{/allergen|safety/.test(page.slug) ? I.shield : I.book}</span>}
      <span className="tc-card-copy">
        <span className="tc-card-kicker">{page.kind || page.kicker.replace(/^The Book · /, '')}</span>
        <strong>{page.title}</strong>
        {page.line && <span className="tc-card-line">{page.line}</span>}
      </span>
    </>
  );
}

/** A person's progress, as a manager shared it: job, steps done, status and what's next. Opens them on People. */
const personLine = (p: PersonCard) => {
  const n = p.next;
  const next = !p.job ? 'No job picked yet' : !n ? 'Every step is done' : 'waiting' in n ? 'Waiting on a sign-off' : `Next: ${n.kind === 'quiz' && !/quiz/i.test(n.title) ? n.title + ' quiz' : n.title} · ${dueText(n.due, n.late)}`;
  return next;
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

function Composer({ room, demo, replyTo, clearReply, onSent, autoFocus = false, onPickOther }: { room: Room; demo: boolean; replyTo: Msg | null; clearReply: () => void; onSent: (d: Detail) => void; autoFocus?: boolean; onPickOther?: () => void }) {
  const { user } = useSession();
  const { staged } = useChatPanel();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ url: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [linking, setLinking] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [pick, setPick] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (replyTo) area.current?.focus(); }, [replyTo]);
  useEffect(() => { if (autoFocus) area.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const a = area.current; if (a) { a.style.height = 'auto'; a.style.height = Math.min(a.scrollHeight, 160) + 'px'; } }, [text]);
  const locked = !room.canStart && !replyTo;

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
      const d = await api<Detail>(`/api/chat/room/${enc(room.key)}/messages`, { method: 'POST', body: {
        body, photo: photo?.url, replyTo: replyTo?.id,
        page: cardReady && staged?.type === 'page' ? staged.slug : undefined, person: cardReady && staged?.type === 'person' ? staged.id : undefined,
      } });
      setText(''); setPhoto(null); clearReply(); if (cardReady) clearStaged(); onSent(d);
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'That didn’t send. Try again.'); }
    setBusy('');
  };
  const pickPhoto = () => {
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

  if (locked) return (
    <div className="tc-compose-wrap">
      {staged && <StagedCard staged={staged} note={(
        <div className="tc-blocked">
          <p className="tc-compose-note" role="note">Managers start posts in {room.name}. Pick another conversation to send this.</p>
          {onPickOther && <button type="button" className="tc-act" onClick={onPickOther}>Pick a Conversation</button>}
        </div>
      )} />}
      <p className="tc-locked">Managers start posts in {room.name}. Open the <span aria-hidden="true">⋯</span> on a post and press Reply to answer it.</p>
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
            <p className="tc-pop-title">Mention someone in {room.kind === 'dm' ? 'this conversation' : room.name}</p>
            {suggestions.map((p, i) => (
              <button type="button" role="option" id={`tc-mention-${room.id}-${i}`} aria-selected={i === pick} key={p.id} className={i === pick ? 'on' : ''}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setPick(i)} onClick={() => choose(p)}>
                <Avatar p={p} size={28} /><span><strong>{p.name}</strong><small>{p.label}</small></span>
              </button>
            ))}
          </div>
        )}
        <textarea ref={area} rows={1} value={text} maxLength={2000}
          placeholder={staged ? 'Add a message (optional)' : replyTo ? `Reply to ${replyTo.user.name.split(' ')[0]}` : room.kind === 'dm' ? `Message ${room.name.split(' ')[0]}` : `Message ${room.name}`}
          aria-label={`Message ${room.name}`} aria-autocomplete="list"
          // (a text box can't carry aria-expanded or a combobox role, Nov 12 scan; the list and its picked option are linked instead)
          aria-controls={mention && suggestions.length ? `tc-mention-${room.id}` : undefined}
          aria-activedescendant={mention && suggestions.length ? `tc-mention-${room.id}-${Math.min(pick, suggestions.length - 1)}` : undefined}
          onChange={(e) => { setText(e.target.value); watch(e.target); }}
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
        <div className="tc-compose-tools">
          <button type="button" className="tc-tool" onClick={pickPhoto} disabled={!!busy}>{I.photo}<span>Photo</span></button>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          <span className="tc-link-wrap">
            <button type="button" className="tc-tool" onClick={() => setLinking((v) => !v)} aria-expanded={linking} disabled={!!busy}>{I.book}<span>Link a Page</span></button>
            {linking && <PagePicker onPick={(e) => { stageItem({ type: 'page', slug: e.slug }); setLinking(false); area.current?.focus(); }} onClose={() => setLinking(false)} />}
          </span>
          <button type="submit" className="tc-send" disabled={!canSend}>{I.send}<span>{busy === 'Sending…' ? 'Sending' : 'Send'}</span></button>
        </div>
      </div>
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
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
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

/* ===================================== right: details ===================================== */
function Details({ d, open, onClose, manager, onPin }: { d: Detail; open: boolean; onClose: () => void; manager: boolean; onPin: (id: number) => void }) {
  const [all, setAll] = useState(false);
  const r = d.room;
  const shown = all ? r.members : r.members.slice(0, 5);
  const card = (title: ReactNode, body: ReactNode, extra?: ReactNode, cls = '') => (
    <section className={'tc-card-box ' + cls}><div className="tc-box-head"><p className="tc-box-title">{title}</p>{extra}</div>{body}</section>
  );
  return (
    <aside className={'tc-details' + (open ? ' open' : '')} aria-label={r.kind === 'dm' ? 'About this conversation' : 'About this channel'}>
      <button type="button" className="tc-details-close" aria-label="Close details" onClick={onClose}>{I.close}</button>
      {r.kind === 'dm' && r.other ? (
        <section className="tc-about tc-about-dm">
          <Avatar p={r.other} size={48} />
          <p className="tc-box-title">Direct Message</p>
          <p><strong>{r.other.name}</strong></p>
          <p>{r.other.label}. Only the two of you see these messages.</p>
        </section>
      ) : (
        <section className="tc-about"><p className="tc-box-title">About This Channel</p><p>{r.about}</p></section>
      )}
      {r.kind !== 'dm' && card(`Members · ${r.members.length}`, (
        <>
          <ul className="tc-members">
            {shown.map((m) => <li key={m.id}><Avatar p={m} size={32} /><span><strong>{m.name}</strong><small>{m.label}</small></span></li>)}
          </ul>
          {r.members.length > 5 && <button type="button" className="tc-see-all" onClick={() => setAll((v) => !v)}>{all ? 'Show Fewer' : `See All ${r.members.length} →`}</button>}
        </>
      ), manager ? <Link to="/admin/people" className="tc-small-btn">Add People</Link> : null)}
      {d.pins.length > 0 && card(`Pinned · ${d.pins.length}`, (
        <ul className="tc-pins">
          {d.pins.map((p) => <li key={p.id}><button type="button" onClick={() => { onPin(p.id); onClose(); }}><strong>{p.title.charAt(0).toUpperCase() + p.title.slice(1)}</strong><small>{p.user.name} · {dayTime(p.at)}</small></button></li>)}
        </ul>
      ))}
      {d.shared.length > 0 && card(`Shared Pages · ${d.shared.length}`, (
        <ul className="tc-shared">
          {d.shared.slice(0, 6).map((p) => (
            <li key={p.slug}><Link to={'/' + p.slug}>
              {p.thumb ? <img src={p.thumb} style={focusImg(p.thumb)} alt="" /> : <span className="tc-card-tile">{/allergen|safety/.test(p.slug) ? I.shield : I.book}</span>}
              <span><strong>{p.title}</strong><small>{p.kicker.replace(/^The Book · /, '')} · {p.at ? dayWord(p.at) : ''}</small></span>
            </Link></li>
          ))}
        </ul>
      ))}
    </aside>
  );
}
