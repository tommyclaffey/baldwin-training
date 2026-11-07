// The /admin area: everything a manager needs to change the book.
import { NavLink, Route, Routes, Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { AcceptInvite, Account, Activity, MediaLibrary, Overview, People, QuizResults, SignIn } from './screens';
import { CollectionList, EntryEditor, PageOptions, useCollections } from './cms';
import { Loading } from './ui';
import { WineVideos } from './wine';
import { BottleScannerPage } from './scanner';
import { SuperAdmin } from './super';
import { api } from '../lib/api';
import { DemoBar, DemoTour } from '../components/DemoTour';

export default function AdminApp() {
  const { user, loaded } = useSession();
  return (
    <Routes>
      <Route path="invite/:token" element={<AcceptInvite />} />
      <Route path="*" element={!loaded ? <Loading /> : !user ? <SignIn /> : <Shell />} />
    </Routes>
  );
}

function Shell() {
  const { user, refresh } = useSession();
  if (user?.role === 'staff') return <StaffOnly />;
  return <ManagerShell user={user!} refresh={refresh} />;
}

/** Staff read the book; the admin is for owners and managers. */
function StaffOnly() {
  const { user, setUser } = useSession();
  return (
    <div className="auth"><div className="auth-card">
      <img src="/img/logo-white.png" alt="The Baldwin" className="auth-logo" />
      <h1>This part is for managers</h1>
      <p className="muted">You’re signed in as {user?.name}. Your training is in the book.</p>
      <div className="stack">
        <Link className="btn" to="/">Go to the Book</Link>
        <button className="link-btn" onClick={() => { void api('/api/logout', { method: 'POST' }).finally(() => setUser(null)); }}>Sign in as someone else</button>
      </div>
    </div></div>
  );
}

function ManagerShell({ user, refresh }: { user: NonNullable<ReturnType<typeof useSession>['user']>; refresh: () => Promise<void> }) {
  const { data: cols } = useCollections();
  const owner = user.role === 'owner' || user.role === 'superadmin';
  const isSuper = user.role === 'superadmin' && !user.impersonatedBy;
  const back = async () => { await api('/api/super/return', { method: 'POST' }).catch(() => {}); await refresh(); location.assign('/admin/super'); };
  // Owners, all-store managers and super admins pick the store they're working in; the page reloads for that store.
  const switchStore = async (id: number) => { await api('/api/store', { method: 'POST', body: { storeId: id } }); location.reload(); };
  const hasBook = !!user.store?.bookReady;
  // The shared library (classics, grape and region videos) is kept by super admins; everything else is the store's own.
  const library = user.role === 'superadmin';
  return (
    <div className="admin">
      <aside className="admin-side">
        <Link to="/" className="admin-logo"><img src="/img/logo-white.png" alt="The Baldwin" /></Link>
        <span className="admin-tag">{isSuper ? 'Super Admin' : 'Admin'}</span>
        {isSuper && <span className="admin-working">Working in <strong>{user.workingInName || '—'}</strong> · <NavLink to="/admin/super">Switch</NavLink></span>}
        {user.canSwitchStore && (user.stores || []).length > 1
          ? <label className="store-switch"><span>Store</span>
              <select value={user.store?.id ?? ''} onChange={(e) => void switchStore(Number(e.target.value))}>
                {(user.stores || []).map((x) => <option key={x.id} value={x.id}>{x.name}{x.bookReady ? '' : ' · shared library'}</option>)}
              </select></label>
          : user.store && <span className="admin-working">Store: <strong>{user.store.name}</strong></span>}
        <nav aria-label="Admin">
          <NavLink end to="/admin">Overview</NavLink>
          {cols?.collections && Object.values(cols.collections).filter((c) => library || c.id !== 'classic').map((c) => <NavLink key={c.id} to={`/admin/pages/${c.id}`}>{c.label}</NavLink>)}
          {(hasBook || library) && <NavLink to="/admin/wine-videos">Wine Videos</NavLink>}
          <NavLink to="/admin/bottle-scanner">Bottle Scanner</NavLink>
          <NavLink to="/admin/media">Videos and Photos</NavLink>
          <NavLink to="/admin/quizzes">Quiz Results</NavLink>
          <NavLink to="/admin/team">Team</NavLink>
          {owner && <NavLink to="/admin/activity">Activity</NavLink>}
          <NavLink to="/admin/account">Your Account</NavLink>
          {isSuper && <NavLink to="/admin/super" className="nav-super">Super Admin</NavLink>}
        </nav>
        <Link to="/" className="admin-back">← Back to the Book</Link>
      </aside>
      <main className="admin-main" id="content">
        {user.impersonatedBy && <div className="support-bar" role="note">Support view: you’re signed in as <strong>{user.name}</strong>. <button className="link-btn" onClick={() => void back()}>Back to Your Account</button></div>}
        <DemoBar />
        {user.demo && <DemoTour />}
        <PageOptions />
        <Routes>
          <Route index element={<Overview />} />
          <Route path="pages/:col" element={<CollectionList />} />
          <Route path="pages/:col/:id" element={<EntryEditor />} />
          <Route path="wine-videos" element={<WineVideos />} />
          <Route path="bottle-scanner" element={<BottleScannerPage />} />
          <Route path="media" element={<MediaLibrary />} />
          <Route path="quizzes" element={<QuizResults />} />
          <Route path="team" element={<People />} />
          <Route path="people" element={<People />} />
          <Route path="super/*" element={<SuperAdmin />} />
          <Route path="activity" element={<Activity />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<div className="admin-page"><h1>Nothing here</h1><Link to="/admin">Go to the overview</Link></div>} />
        </Routes>
      </main>
    </div>
  );
}
