// The /admin area: everything a manager needs to change the book.
import { NavLink, Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import { ACADEMY_NAME } from '../lib/brand';
import { useSession } from '../lib/session';
import { AcceptInvite, Account, Activity, MediaLibrary, People, SignIn } from './screens';
import { CollectionList, EntryEditor, PageOptions, useCollections } from './cms';
import { Loading } from './ui';
import { WineVideos } from './wine';
import { BottleScannerPage } from './scanner';
import { SuperAdmin } from './super';
import { ManagerHome, PeoplePage, SignoffsPage, useSignoffCount } from './manager';
import { api } from '../lib/api';
import { DemoBar, DemoTour, openWelcome } from '../components/DemoTour';
import { hasChat, useChatUnread } from '../chat/unread';
import { openChat } from '../chat/panel';

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
  const signoffs = useSignoffCount();
  const chatUnread = useChatUnread(hasChat(user));
  return (
    <div className="admin">
      <aside className="admin-side">
        <div className="admin-brand">
          <Link to="/" className="admin-logo"><img src="/img/logo-white.png" alt="The Baldwin" /></Link>
          {user.demo && <button type="button" className="demo-line admin-demo" onClick={openWelcome} aria-label="Demo: open the welcome card"><span>{ACADEMY_NAME}</span><span className="demo-pill">DEMO</span></button>}
        </div>
        <span className="admin-tag">{isSuper ? 'Super Admin' : 'Admin'}</span>
        {isSuper && <span className="admin-working">Working in <strong>{user.workingInName || '—'}</strong> · <NavLink to="/admin/super">Switch</NavLink></span>}
        {user.canSwitchStore && (user.stores || []).length > 1
          ? <label className="store-switch"><span>Store</span>
              <select value={user.store?.id ?? ''} onChange={(e) => void switchStore(Number(e.target.value))}>
                {(user.stores || []).map((x) => <option key={x.id} value={x.id}>{x.name}{x.bookReady ? '' : ' · shared library'}</option>)}
              </select></label>
          : user.store && <span className="admin-working">Store: <strong>{user.store.name}</strong></span>}
        {/* Nov 11 (Figma 523:276): Home, then the team (a manager's daily job), then the book. */}
        <nav aria-label="Admin">
          <NavLink end to="/admin"><NavIcon d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" />Home</NavLink>
          {/* Nov 11 (Figma 580:670): Team Chat under Home. The chat lives in the book, beside the pages people link. */}
          {hasChat(user) && <NavLink to="/team-chat" onClick={(e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); openChat(); } }}><NavIcon d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.55L3.5 20.5l1.45-4.5A8.5 8.5 0 1 1 20.5 11.5Z" />Team Chat{chatUnread > 0 && <span className="admin-count" aria-label={`${chatUnread} unread`}>{chatUnread}</span>}</NavLink>}
          <p className="admin-group">Team</p>
          <NavLink to="/admin/people"><NavIcon d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3" />People</NavLink>
          <NavLink to="/admin/signoffs"><NavIcon d="M3 17c3-4 5-8 7-8s-1 8 1 8 3-5 5-5-1 5 1 5h4M3 21h18" />Sign-offs{signoffs > 0 && <span className="admin-count" aria-label={`${signoffs} waiting`}>{signoffs}</span>}</NavLink>
          <p className="admin-group">The Book</p>
          {cols?.collections && Object.values(cols.collections).filter((c) => library || c.id !== 'classic').map((c) => <NavLink key={c.id} to={`/admin/pages/${c.id}`}>{c.label}</NavLink>)}
          {(hasBook || library) && <NavLink to="/admin/wine-videos">Wine Videos</NavLink>}
          <NavLink to="/admin/bottle-scanner">Bottle Scanner</NavLink>
          <NavLink to="/admin/media">Videos and Photos</NavLink>
          <p className="admin-group">You</p>
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
          <Route index element={<ManagerHome />} />
          <Route path="pages/:col" element={<CollectionList />} />
          <Route path="pages/:col/:id" element={<EntryEditor />} />
          <Route path="wine-videos" element={<WineVideos />} />
          <Route path="bottle-scanner" element={<BottleScannerPage />} />
          <Route path="media" element={<MediaLibrary />} />
          {/* Nov 11: Training, Quiz Results and Team are one People screen now. The old addresses land there. */}
          <Route path="people" element={<PeoplePage />} />
          <Route path="people/managers" element={<People leadsOnly />} />
          <Route path="signoffs" element={<SignoffsPage />} />
          <Route path="training" element={<ToPeople />} />
          <Route path="quizzes" element={<ToPeople />} />
          <Route path="team" element={<ToPeople />} />
          <Route path="super/*" element={<SuperAdmin />} />
          <Route path="activity" element={<Activity />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<div className="admin-page"><h1>Nothing here</h1><Link to="/admin">Go to the overview</Link></div>} />
        </Routes>
      </main>
    </div>
  );
}

/** Old addresses (Training, Quiz Results, Team) keep working: they open People, with the person if one was named. */
function ToPeople() {
  const { search } = useLocation();
  return <Navigate to={'/admin/people' + search} replace />;
}

const NavIcon = ({ d }: { d: string }) => <svg className="admin-nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
