import sidebar from '../content/sidebar.json';
import { useEffect, useMemo, useState } from 'react';
import { FigmaNode, type FNode } from './FigmaNode';
import { QUIZZES, statusOf, useQuiz } from '../quiz/store';
import { api } from '../lib/api';
import { trainingCard } from '../quiz/transform';
import { useSession } from '../lib/session';

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
      <FigmaNode node={{ ...node, x: undefined, y: undefined }} rootStyle={{ position: 'relative', width: '100%', height: '100%', minHeight: '100%' }} />
    </nav>
  );
}
