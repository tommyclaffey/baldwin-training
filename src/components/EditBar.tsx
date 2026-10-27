import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { usePageEntry } from './PageView';

const COLLECTION_OF: Record<string, string> = { Classic: 'classic', Signature: 'house', Recipe: 'recipe' };

/** For signed-in managers: a way into the admin, and straight to this page's template form. */
export function EditBar() {
  const { user } = useSession();
  const entry = usePageEntry();
  if (!user) return null;
  const col = entry && entry.file.startsWith('e') ? COLLECTION_OF[entry.section] : null;
  return (
    <div className="edit-bar" role="region" aria-label="Manager tools">
      {col && <Link to={`/admin/pages/${col}/${entry!.file.slice(1)}`}>Edit This Page</Link>}
      <Link to="/admin">Admin</Link>
    </div>
  );
}
