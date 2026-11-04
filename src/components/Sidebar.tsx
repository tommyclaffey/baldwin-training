import sidebar from '../content/sidebar.json';
import { useEffect, useMemo, useState } from 'react';
import { FigmaNode, type FNode } from './FigmaNode';
import { QUIZZES, statusOf, useQuiz } from '../quiz/store';
import { api, canEdit } from '../lib/api';
import { ManagerLinks } from './EditBar';
import { trainingCard } from '../quiz/transform';
import { useSession } from '../lib/session';
import { exitDemo } from '../lib/demo';

/** A store without its own designed book: its name where The Baldwin's logo is, and no Baldwin quiz card. */
function forStore(n: FNode, name: string): FNode {
  if (n.n === 'Logo') return { ...n, sh: 'F', c: [{ t: 'T', n: 'Store name', s: name, w: 164, h: 28, sh: 'F', sv: 'H', f: [{ c: '#F2EEE7' }], ff: 'Archivo', fs: 'ExtraBold', z: 22, ls: '-1%', ar: 'H' } as FNode] };
  return n.c ? { ...n, c: n.c.filter((c) => c.n !== 'Your Training').map((c) => forStore(c, name)) } : n;
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
  const generic = !!user?.store && !user.store.bookReady;
  // Other stores start at zero (no drawn Baldwin numbers while the real ones load).
  const [counts, setCounts] = useState<Record<string, number>>((): Record<string, number> => (generic ? { 'Food Matrix': 0, 'Video Library': 0, 'Photo Library': 0 } : {}));
  useEffect(() => { api<Record<string, number>>('/api/counts').then(setCounts).catch(() => { /* keep the drawn numbers */ }); }, []);
  const node = useMemo(() => {
    // Badges: what's really on each page; Quizzes = quizzes still to pass on this phone.
    const live: Record<string, number> = { ...counts, Quizzes: generic ? 0 : QUIZZES.filter((q) => !['signed', 'passed'].includes(statusOf(quiz, q.id))).length };
    const drawn = linkHome(withCounts(trainingCard([SIDEBAR], quiz)[0], live));
    return generic ? forStore(drawn, user!.store!.name) : drawn;
  }, [quiz, counts, generic, user]);
  return (
    <nav className="sidebar" aria-label="Main" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onNavigate?.(); }}>
      {user?.demo && <DemoPill />}
      <FigmaNode node={{ ...node, x: undefined, y: undefined }} rootStyle={{ position: 'relative', width: '100%', height: 'auto', flex: '1 0 auto' }} />
      <Account />
    </nav>
  );
}

/** Nov 4, Tommy: "the little demo pill label in the top left." */
export function DemoPill({ compact = false }: { compact?: boolean }) {
  const { refresh } = useSession();
  return (
    <div className={'demo-pill-row' + (compact ? ' compact' : '')}>
      <span className="demo-pill">DEMO</span>
      <button type="button" className="demo-exit" onClick={() => void exitDemo(refresh)}>Exit Demo</button>
    </div>
  );
}

const ROLE: Record<string, string> = { staff: 'Team', manager: 'Manager', owner: 'Owner', superadmin: 'Super admin' };
/** Who's signed in, at the foot of the sidebar (Tommy, Oct 31: the floating name pill sat on top of the page). */
function Account() {
  const { user, setUser, refresh } = useSession();
  if (!user) return null;
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  // in the demo, signing out leaves the demo and puts your own sign-in back
  const signOut = async () => { if (user.demo) return exitDemo(refresh); await api('/api/logout', { method: 'POST' }).catch(() => {}); setUser(null); };
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
          : <button type="button" className="account-out" onClick={() => void signOut()}>Sign Out</button>}
      </div>
    </div>
  );
}
