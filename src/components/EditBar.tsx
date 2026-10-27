import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { usePageEntry } from './PageView';

/** Shown to signed-in managers: turn editing on and off, jump to the admin. */
export function EditBar() {
  const { user, editing, setEditing } = useSession();
  const entry = usePageEntry();
  if (!user) return null;
  const item = entry?.file.startsWith('i') ? entry : null;
  const itemLink = item ? (item.slug.startsWith('recipe/') ? '/admin/recipes/' : '/admin/cocktails/') + item.file.slice(1) : null;
  if (itemLink) {
    return (
      <div className="edit-bar" role="region" aria-label="Editing">
        <span className="edit-hint show">This page is built from a form.</span>
        <Link to={itemLink}>Edit in Form</Link>
        <Link to="/admin">Admin</Link>
      </div>
    );
  }
  return (
    <div className={'edit-bar' + (editing ? ' on' : '')} role="region" aria-label="Editing">
      <label className="switch">
        <input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} />
        <span className="track" aria-hidden="true" />
        {editing ? 'Editing on' : 'Edit this page'}
      </label>
      {editing && <span className="edit-hint">Click text to change it. Use the buttons on photos and videos.</span>}
      <Link to="/admin">Admin</Link>
    </div>
  );
}
