import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { usePageEntry } from './PageView';

const COLLECTION_OF: Record<string, string> = { Classic: 'classic', Signature: 'house', Recipe: 'recipe' };

/** For signed-in managers: a way into the admin, and straight to this page's template form. */
export function EditBar() {
  return <ManagerLinks className="edit-bar" />;
}

/** "Edit This Page" (when there's a form for it) and "Admin". Lives in the sidebar's account card. */
export function ManagerLinks({ className }: { className: string }) {
  const { user } = useSession();
  const entry = usePageEntry();
  if (!user) return null;
  const found = entry && entry.file.startsWith('e') ? COLLECTION_OF[entry.section] : null;
  // Classics are the shared library: only a super admin edits them.
  const col = found === 'classic' && user.role !== 'superadmin' ? null : found;
  return (
    <div className={className} role="group" aria-label="Manager tools">
      {col && <Link to={`/admin/pages/${col}/${entry!.file.slice(1)}`}>Edit This Page</Link>}
      <Link to="/admin">Admin</Link>
    </div>
  );
}
