import sidebar from '../content/sidebar.json';
import { useEffect, useMemo, useState } from 'react';
import { FigmaNode, type FNode } from './FigmaNode';
import { QUIZZES, statusOf, useQuiz } from '../quiz/store';
import { api } from '../lib/api';
import { trainingCard } from '../quiz/transform';

const NODES = sidebar as FNode[];
// The drawn sidebar is the second node ("Sidebar"); the first is the dark rail behind it.
const SIDEBAR = NODES.find((n) => n.n === 'Sidebar') as FNode;

function withCounts(n: FNode, live: Record<string, number>): FNode {
  if (n.n?.startsWith('Nav · ') && n.n.slice(6) in live) {
    const v = live[n.n.slice(6)];
    return { ...n, c: (n.c || []).flatMap((c) => (c.n !== 'Count' ? [c] : v ? [{ ...c, c: (c.c || []).map((t) => (t.t === 'T' ? { ...t, s: String(v) } : t)) }] : [])) };
  }
  return n.c ? { ...n, c: n.c.map((c) => withCounts(c, live)) } : n;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const quiz = useQuiz();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => { api<Record<string, number>>('/api/counts').then(setCounts).catch(() => { /* keep the drawn numbers */ }); }, []);
  const node = useMemo(() => {
    // Badges: what's really on each page; Quizzes = quizzes still to pass on this phone.
    const live: Record<string, number> = { ...counts, Quizzes: QUIZZES.filter((q) => !['signed', 'passed'].includes(statusOf(quiz, q.id))).length };
    return withCounts(trainingCard([SIDEBAR], quiz)[0], live);
  }, [quiz, counts]);
  return (
    <nav className="sidebar" aria-label="Main" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onNavigate?.(); }}>
      <FigmaNode node={{ ...node, x: undefined, y: undefined }} rootStyle={{ position: 'relative', width: '100%', height: '100%', minHeight: '100%' }} />
    </nav>
  );
}
