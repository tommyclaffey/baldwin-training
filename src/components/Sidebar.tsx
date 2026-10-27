import sidebar from '../content/sidebar.json';
import { FigmaNode, type FNode } from './FigmaNode';

const NODES = sidebar as FNode[];
// The drawn sidebar is the second node ("Sidebar"); the first is the dark rail behind it.
const SIDEBAR = NODES.find((n) => n.n === 'Sidebar') as FNode;

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="sidebar" aria-label="Main" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onNavigate?.(); }}>
      <FigmaNode node={{ ...SIDEBAR, x: undefined, y: undefined }} rootStyle={{ position: 'relative', width: '100%', height: '100%', minHeight: '100%' }} />
    </nav>
  );
}
