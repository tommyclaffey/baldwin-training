import sidebar from '../content/sidebar.json';
import { useMemo } from 'react';
import { FigmaNode, type FNode } from './FigmaNode';
import { useQuiz } from '../quiz/store';
import { trainingCard } from '../quiz/transform';

const NODES = sidebar as FNode[];
// The drawn sidebar is the second node ("Sidebar"); the first is the dark rail behind it.
const SIDEBAR = NODES.find((n) => n.n === 'Sidebar') as FNode;

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const quiz = useQuiz();
  const node = useMemo(() => trainingCard([SIDEBAR], quiz)[0], [quiz]);
  return (
    <nav className="sidebar" aria-label="Main" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onNavigate?.(); }}>
      <FigmaNode node={{ ...node, x: undefined, y: undefined }} rootStyle={{ position: 'relative', width: '100%', height: '100%', minHeight: '100%' }} />
    </nav>
  );
}
