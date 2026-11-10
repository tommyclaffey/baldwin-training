import sidebar from '../content/sidebar.json';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FigmaNode, type FNode } from './FigmaNode';
import { QUIZZES, statusOf, useQuiz } from '../quiz/store';
import { api, canEdit } from '../lib/api';
import { ManagerLinks } from './EditBar';
import { trainingCard, pathSidebar } from '../quiz/transform';
import { usePath } from '../path/store';
import { useSession } from '../lib/session';
import { openWelcome } from './DemoTour';
import { ACADEMY_NAME } from '../lib/brand';

/** A store without its own designed book: its name where The Baldwin's logo is, and no Baldwin quiz card. */
function forStore(n: FNode, name: string): FNode {
  if (n.n === 'Logo') return { ...n, sh: 'F', c: [{ t: 'T', n: 'Store name', s: name, w: 164, h: 28, sh: 'F', sv: 'H', f: [{ c: '#F2EEE7' }], ff: 'Archivo', fs: 'ExtraBold', z: 22, ls: '-1%', ar: 'H' } as FNode] };
  return n.c ? { ...n, c: n.c.filter((c) => c.n !== 'Your Training').map((c) => forStore(c, name)) } : n;
}

/** The demo pill (Nov 9, Tommy: "I like it like the screenshot", Growth's "Copperline · DEMO"): under the logo, a line with
 *  the product's name and a small tinted DEMO tag beside it. Same pattern in every app. */
function withDemoPill(n: FNode): FNode {
  const tag: FNode = { t: 'F', n: 'Pill', lm: 'H', pa: 'C', ca: 'C', sh: 'H', sv: 'H', r: 6, pd: [3, 7, 3, 7], f: [{ c: '#C49A6C', o: .24 }], c: [{ t: 'T', n: 'DEMO', s: 'DEMO', ff: 'Archivo', fs: 'Bold', z: 11, ls: '8%', f: [{ c: '#EBD2B2' }], ar: 'W', sh: 'H', sv: 'H' } as FNode] } as FNode;
  const pill: FNode = { t: 'F', n: 'Demo pill', lm: 'H', gap: 8, ca: 'C', sh: 'H', sv: 'H', c: [{ t: 'T', n: 'Product', s: ACADEMY_NAME, ff: 'Archivo', fs: 'Medium', z: 14, f: [{ c: '#B8AFA3' }], ar: 'W', sh: 'H', sv: 'H' } as FNode, tag] } as FNode;
  if (!n.c) return n;
  const at = n.c.findIndex((c) => c.n === 'Logo');
  if (at < 0) return { ...n, c: n.c.map(withDemoPill) };
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
  const path = usePath(user?.id);
  const mine = path?.paths[0] || null;
  const generic = !!user?.store && !user.store.bookReady;
  // Other stores start at zero (no drawn Baldwin numbers while the real ones load).
  const [counts, setCounts] = useState<Record<string, number>>((): Record<string, number> => (generic ? { 'Food Matrix': 0, 'Video Library': 0, 'Photo Library': 0 } : {}));
  useEffect(() => { api<Record<string, number>>('/api/counts').then(setCounts).catch(() => { /* keep the drawn numbers */ }); }, []);
  const node = useMemo(() => {
    // Badges: what's really on each page; Quizzes = quizzes still to pass on this phone.
    const live: Record<string, number> = { ...counts, Quizzes: generic ? 0 : QUIZZES.filter((q) => !['signed', 'passed'].includes(statusOf(quiz, q.id))).length };
    const drawn = pathSidebar(linkHome(withCounts(trainingCard([SIDEBAR], quiz)[0], live)), mine);
    const named = generic ? forStore(drawn, user!.store!.name) : drawn;
    return user?.demo ? withDemoPill(named) : named;
  }, [quiz, counts, generic, user, mine]);
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
    <nav ref={nav} className="sidebar" aria-label="Main" onClick={(e) => {
      if ((e.target as HTMLElement).closest('[data-name="Demo pill"]')) { openWelcome(); return; }
      if ((e.target as HTMLElement).closest('a')) onNavigate?.();
    }}>
      <FigmaNode node={{ ...node, x: undefined, y: undefined }} rootStyle={{ position: 'relative', width: '100%', height: 'auto', flex: '1 0 auto' }} />
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
