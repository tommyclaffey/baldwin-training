import sidebar from '../content/sidebar.json';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FigmaNode, type FNode } from './FigmaNode';
import { QUIZZES, statusOf, useQuiz } from '../quiz/store';
import { api, canEdit } from '../lib/api';
import { ManagerLinks } from './EditBar';
import { EditModeCard } from '../edit/EditModeBar';
import { trainingCard, pathSidebar } from '../quiz/transform';
import { usePath } from '../path/store';
import { useSession } from '../lib/session';
import { openWelcome } from './DemoTour';
import { ACADEMY_NAME } from '../lib/brand';
import svgs from '../content/svgs.json';
import { hasChat, useChatUnread } from '../chat/unread';
import { openChat } from '../chat/panel';

/** Team Chat (Nov 11, Figma 580:670): under Home, with the design's speech-bubble icon and an unread count. */
const CHAT_ICON = 'mise_chat';
(svgs as Record<string, string>)[CHAT_ICON] = '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.52 8.15a5.67 5.67 0 0 1-8.29 5.03l-3.4.99.99-3.12A5.67 5.67 0 1 1 14.52 8.15Z" stroke="#B8AFA3" stroke-width="1.49" stroke-linejoin="round"/></svg>';
function withChat(n: FNode): FNode {
  if (n.n === 'Nav' && n.c && !n.c.some((c) => c.n === 'Nav · Team Chat')) {
    const home = n.c.find((c) => c.n === 'Nav · Home');
    const model = n.c.find((c) => c.n === 'Nav · Food Matrix');
    if (!home || !model) return n;
    const item: FNode = JSON.parse(JSON.stringify(model));
    item.n = 'Nav · Team Chat'; item.to = '/team-chat';
    item.c = (item.c || []).map((c) => (c.n === 'icon' ? { ...c, svg: CHAT_ICON } : c.t === 'T' ? { ...c, s: 'Team Chat', n: 'Team Chat', segs: undefined } : c));
    const c = [...n.c];
    c.splice(c.indexOf(home) + 1, 0, item);
    return { ...n, c };
  }
  return n.c ? { ...n, c: n.c.map(withChat) } : n;
}
import { useSignoffCount } from '../admin/manager';

/** Prep (Nov 12, Figma 632:803): the juice, syrup and garnish tracker, under the menu pages after the Allergen Guide,
 *  with a citrus-slice icon. Every store and brand gets it (the one-foundation rule). */
const PREP_ICON = 'mise_prep';
(svgs as Record<string, string>)[PREP_ICON] = '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8.5" cy="8.5" r="6.4" stroke="#B8AFA3" stroke-width="1.49"/><path d="M8.5 2.6v11.8M2.6 8.5h11.8M4.3 4.3l8.4 8.4M12.7 4.3l-8.4 8.4" stroke="#B8AFA3" stroke-width="1.1" stroke-linecap="round"/></svg>';
function withPrep(n: FNode): FNode {
  if (n.n === 'Nav' && n.c && !n.c.some((c) => c.n === 'Nav · Prep')) {
    const after = n.c.find((c) => c.n === 'Nav · Allergen Guide');
    const model = n.c.find((c) => c.n === 'Nav · Food Matrix');
    if (!after || !model) return n;
    const item: FNode = JSON.parse(JSON.stringify(model));
    item.n = 'Nav · Prep'; item.to = '/prep';
    item.c = (item.c || []).filter((c) => c.n !== 'Count').map((c) => (c.n === 'icon' ? { ...c, svg: PREP_ICON } : c.t === 'T' ? { ...c, s: 'Prep', n: 'Prep', segs: undefined, w: 171 } : c));
    const c = [...n.c];
    c.splice(c.indexOf(after) + 1, 0, item);
    return { ...n, c };
  }
  return n.c ? { ...n, c: n.c.map(withPrep) } : n;
}

// Team links for managers in the book's sidebar (Nov 11, Tommy: "there is no people button"). Same icons as the admin's.
const ICON = (d: string) => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="#B8AFA3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
(svgs as Record<string, string>)['team-people'] = ICON('M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3');
(svgs as Record<string, string>)['team-signoffs'] = ICON('M3 17c3-4 5-8 7-8s-1 8 1 8 3-5 5-5-1 5 1 5h4M3 21h18');
/** Puts a TEAM group (People, Sign-offs with its count) under Home, built from the drawn group label and nav items. */
function withTeam(n: FNode, signoffs: number): FNode {
  if (n.n !== 'Nav' || !n.c) return n.c ? { ...n, c: n.c.map((c) => withTeam(c, signoffs)) } : n;
  const label = n.c.find((c) => c.n?.startsWith('Group · '));
  const item = n.c.find((c) => c.c?.some((k) => k.n === 'Count'));
  const chatAt = n.c.findIndex((c) => c.n === 'Nav · Team Chat');
  const home = chatAt >= 0 ? chatAt : n.c.findIndex((c) => c.n === 'Nav · Home');
  if (!label || !item || home < 0) return n;
  const relabel = (x: FNode, text: string): FNode => ({ ...x, c: x.c?.map((k) => (k.t === 'T' ? { ...k, s: text, n: text } : k)) });
  const navItem = (name: string, to: string, svg: string, count: number): FNode => ({
    ...item, n: 'Nav · ' + name, to,
    c: (item.c || []).flatMap((k): FNode[] => k.n === 'icon' ? [{ ...k, svg }]
      : k.n === 'Count' ? (count ? [{ ...k, c: (k.c || []).map((t) => (t.t === 'T' ? { ...t, s: String(count) } : t)) }] : [])
      : k.t === 'T' ? [{ ...k, s: name, n: name }] : [k]),
  });
  const team = [relabel({ ...label, n: 'Group · TEAM' }, 'TEAM'), navItem('People', '/admin/people', 'team-people', 0), navItem('Sign-offs', '/admin/signoffs', 'team-signoffs', signoffs)];
  return { ...n, c: [...n.c.slice(0, home + 1), ...team, ...n.c.slice(home + 1)] };
}
import { currentBrand, themeSidebar, MISE } from '../lib/theme';
import { isSample } from '../lib/demo';

/** A store without its own designed book: its name where The Baldwin's logo is, and no Baldwin quiz card. */
function forStore(n: FNode, name: string): FNode {
  if (n.n === 'Logo') return { ...n, sh: 'F', c: [{ t: 'T', n: 'Store name', s: name, w: 164, h: 28, sh: 'F', sv: 'H', f: [{ c: '#F2EEE7' }], ff: 'Archivo', fs: 'ExtraBold', z: 22, ls: '-1%', ar: 'H' } as FNode] };
  return n.c ? { ...n, c: n.c.filter((c) => c.n !== 'Your Training').map((c) => forStore(c, name)) } : n;
}

/** The demo pill (Nov 9, Tommy: "I like it like the screenshot", Growth's "Copperline · DEMO"): under the logo, a line with
 *  the product's name and a small tinted DEMO tag beside it. Same pattern in every app. */
// Nov 11: in the Mise demo the logo is Mise Academy's own, so the line names the workspace (the restaurant), like Growth's
// "Copperline · DEMO", and the tag is tinted in Mise's accent (deep fig) with light fig text: 10.5:1 on its tint.
type PillLook = { label: string; tint: string; tintO: number; ink: string; muted: string };
const BALDWIN_PILL: PillLook = { label: ACADEMY_NAME, tint: '#C49A6C', tintO: .24, ink: '#EBD2B2', muted: '#B8AFA3' };
function withDemoPill(n: FNode, look: PillLook = BALDWIN_PILL): FNode {
  const tag: FNode = { t: 'F', n: 'Pill', lm: 'H', pa: 'C', ca: 'C', sh: 'H', sv: 'H', r: 6, pd: [3, 7, 3, 7], f: [{ c: look.tint, o: look.tintO }], c: [{ t: 'T', n: 'DEMO', s: 'DEMO', ff: 'Archivo', fs: 'Bold', z: 11, ls: '8%', f: [{ c: look.ink }], ar: 'W', sh: 'H', sv: 'H' } as FNode] } as FNode;
  const pill: FNode = { t: 'F', n: 'Demo pill', lm: 'H', gap: 8, ca: 'C', sh: 'H', sv: 'H', c: [{ t: 'T', n: 'Product', s: look.label, ff: 'Archivo', fs: 'Medium', z: 14, f: [{ c: look.muted }], ar: 'W', sh: 'H', sv: 'H' } as FNode, tag] } as FNode;
  if (!n.c) return n;
  const at = n.c.findIndex((c) => c.n === 'Logo');
  if (at < 0) return { ...n, c: n.c.map((c) => withDemoPill(c, look)) };
  const brand = { t: 'F', n: 'Brand', lm: 'V', gap: 10, sh: 'H', sv: 'H', c: [n.c[at], pill] } as FNode; // under the logo: beside it, the logo doesn't fit at full size
  return { ...n, c: [...n.c.slice(0, at), brand, ...n.c.slice(at + 1)] };
}

const NODES = sidebar as FNode[];
// The drawn sidebar is the second node ("Sidebar"); the first is the dark rail behind it.
const SIDEBAR = NODES.find((n) => n.n === 'Sidebar') as FNode;


/** Home (and the logo) open the home page; the design leaves Home unlinked because it was the page drawn. */
function linkHome(n: FNode): FNode {
  const to = n.n === 'Nav · Home' || n.n === 'Logo' ? '/' : n.to;
  return { ...n, to, c: n.c?.map(linkHome) };
}
function withCounts(n: FNode, live: Record<string, number>): FNode {
  if (n.n?.startsWith('Nav · ') && n.n.slice(6) in live) {
    const v = live[n.n.slice(6)];
    return { ...n, c: (n.c || []).flatMap((c) => (c.n !== 'Count' ? [c] : v ? [{ ...c, c: (c.c || []).map((t) => (t.t === 'T' ? { ...t, s: String(v) } : t)) }] : [])) };
  }
  return n.c ? { ...n, c: n.c.map((c) => withCounts(c, live)) } : n;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const quiz = useQuiz();
  const { user } = useSession();
  const manager = !!user && user.role !== 'staff' && canEdit(user);
  const signoffs = useSignoffCount(manager);
  const path = usePath(user?.id);
  const mine = path?.paths[0] || null;
  const sample = isSample(user); // the Mise demo restaurant: a full book from its own menu, not empty "goes here" pages
  const generic = !!user?.store && !user.store.bookReady && !sample;
  // Other stores start at zero (no drawn Baldwin numbers while the real ones load).
  const [counts, setCounts] = useState<Record<string, number>>((): Record<string, number> => (generic || sample ? { 'Food Matrix': 0, 'Video Library': 0, 'Photo Library': 0 } : {}));
  useEffect(() => { api<Record<string, number>>('/api/counts').then(setCounts).catch(() => { /* keep the drawn numbers */ }); }, []);
  const chat = hasChat(user);
  const unread = useChatUnread(chat);
  const node = useMemo(() => {
    // Badges: what's really on each page; Quizzes = quizzes still to pass on this phone.
    const live: Record<string, number> = { ...counts, 'Team Chat': unread, Quizzes: generic ? 0 : QUIZZES.filter((q) => !['signed', 'passed'].includes(statusOf(quiz, q.id))).length };
    const base = trainingCard([SIDEBAR], quiz)[0];
    const drawn = pathSidebar(linkHome(withCounts(withPrep(chat ? withChat(base) : base), live)), mine);
    const named = generic ? forStore(drawn, user!.store!.name) : drawn;
    const teamed = manager ? withTeam(named, signoffs) : named;
    const mise = currentBrand() === 'mise';
    const look: PillLook = mise && sample ? { label: user!.store?.name || ACADEMY_NAME, tint: MISE.fig, tintO: .42, ink: '#F6D3CE', muted: MISE.ash } : BALDWIN_PILL;
    const shown = user?.demo ? withDemoPill(teamed, look) : teamed;
    return themeSidebar(shown);
  }, [quiz, counts, generic, sample, user, mine, chat, unread, manager, signoffs]);
  // The pill is drawn with the rest of the sidebar, so it's made a real control here: Tab reaches it, Enter opens the welcome card.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const pill = nav.current?.querySelector<HTMLElement>('[data-name="Demo pill"]');
    if (!pill) return;
    pill.setAttribute('role', 'button'); pill.tabIndex = 0;
    pill.setAttribute('aria-label', 'Demo: open the welcome card');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWelcome(); } };
    pill.addEventListener('keydown', onKey);
    return () => pill.removeEventListener('keydown', onKey);
  }, [node]);
  return (
    <nav ref={nav} className="sidebar" aria-label="Main" onClickCapture={(e) => {
      // Team Chat opens the side panel beside the page you're on (Growth's way); the full page is one click from it.
      // Caught before the link's own click, so it doesn't navigate. Cmd/Ctrl-click, or being on the chat page, still goes there.
      const a = (e.target as HTMLElement).closest('a');
      if (a?.closest('[data-name="Nav · Team Chat"]') && !e.metaKey && !e.ctrlKey && !e.shiftKey && !location.pathname.startsWith('/team-chat')) {
        e.preventDefault(); e.stopPropagation(); onNavigate?.(); openChat();
      }
    }} onClick={(e) => {
      if ((e.target as HTMLElement).closest('[data-name="Demo pill"]')) { openWelcome(); return; }
      if ((e.target as HTMLElement).closest('a')) onNavigate?.();
    }}>
      <FigmaNode node={{ ...node, x: undefined, y: undefined }} rootStyle={{ position: 'relative', width: '100%', height: 'auto', flex: '1 0 auto' }} />
      <EditModeCard onToggle={onNavigate} />
      <Account />
    </nav>
  );
}

const ROLE: Record<string, string> = { staff: 'Team', manager: 'Manager', owner: 'Owner', superadmin: 'Super admin' };
/** Who's signed in, at the foot of the sidebar (Tommy, Oct 31: the floating name pill sat on top of the page). */
function Account() {
  const { user, setUser, refresh } = useSession();
  if (!user) return null;
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  // in the demo, signing out leaves the demo and puts your own sign-in back
  const signOut = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); setUser(null); };
  const back = async () => { await api('/api/super/return', { method: 'POST' }).catch(() => {}); await refresh(); location.assign('/admin/super'); };
  const where = user.workingInName || user.store?.name || user.companyName || '';
  return (
    <div className={'account' + (user.impersonatedBy ? ' support' : '')}>
      {canEdit(user) && !user.impersonatedBy && <ManagerLinks className="account-tools" />}
      <div className="account-row">
        <span className="account-avatar" aria-hidden="true">{initials}</span>
        <span className="account-who">
          <strong>{user.name}</strong>
          <span>{user.impersonatedBy ? 'Support view' : [ROLE[user.role] || '', where].filter(Boolean).join(' · ')}</span>
        </span>
        {user.impersonatedBy
          ? <button type="button" className="account-out" onClick={() => void back()}>Back</button>
          : !user.demo && <button type="button" className="account-out" onClick={() => void signOut()}>Sign Out</button>}
      </div>
    </div>
  );
}
