// The way back for Mise's team (Nov 17, Tommy: "We need a back button from when you enter customer view for HQ. Stuck in
// customer view"). A super admin reading a book (HQ's Customer View, or a company they chose Work Here on) gets a bar
// at the top of every page with the way back to the admin. Same look as the demo bar. Never shown in Sign In As (that
// has its own Back) or in a demo.
import { useSession } from '../lib/session';

export function TeamBar() {
  const { user } = useSession();
  if (!user || user.role !== 'superadmin' || user.impersonatedBy || user.demo) return null;
  const where = user.workingInName || user.companyName || '';
  return (
    <div className="demo-bar team-bar" role="region" aria-label="Mise team">
      {user.hq
        ? <p><strong>Customer View</strong><span className="demo-long">: the book a new customer sees</span></p>
        : <p><span className="demo-long">You’re working in </span><strong>{where}</strong><span className="demo-long"> as Mise’s team</span></p>}
      <div className="demo-bar-actions">
        <a className="main" href="/admin">{user.hq ? 'Back to Mise HQ' : 'Back to Admin'}</a>
      </div>
    </div>
  );
}
