import { useState, useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { PageView, usePageEntry } from './components/PageView';
import { NavContext } from './components/FigmaNode';
import { EditBar } from './components/EditBar';
import { useSession } from './lib/session';
import { BookSignIn } from './components/BookSignIn';
import { clearPages } from './components/PageView';
import { setQuizUser } from './quiz/store';
import { api, canEdit } from './lib/api';
import AdminApp from './admin/AdminApp';

export default function App() {
  const { pathname } = useLocation();
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return <Routes><Route path="/admin/*" element={<AdminApp />} /></Routes>;
  return <Book />;
}

function Book() {
  const entry = usePageEntry();
  const { user, loaded, setUser, refresh } = useSession();
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenu(false), [pathname]);
  // A new person on this device: their own quiz progress, and no pages kept from the last person.
  useEffect(() => { clearPages(); setQuizUser(user ? { id: user.id, name: user.name } : null); }, [user?.id, user?.name, user?.workingIn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return <main className="page page-loading" aria-busy="true"><div className="loader" /></main>;
  if (!user) return <BookSignIn />;
  const signOut = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); setUser(null); };
  const back = async () => { await api('/api/super/return', { method: 'POST' }).catch(() => {}); await refresh(); location.assign('/admin/super'); };
  const switchTo = async (id: number) => { await api('/api/store', { method: 'POST', body: { storeId: id } }).catch(() => {}); await refresh(); };
  // A store whose book isn't built yet: say so plainly (owners and all-store managers can switch store here).
  if (user.store && !user.store.bookReady) return (
    <div className="auth"><div className="auth-card">
      <img src="/img/logo-white.png" alt="The Baldwin" className="auth-logo" />
      <h1>The book for {user.store.name} is on its way</h1>
      <p className="muted">You’re all set up{user.role === 'staff' ? ` as part of ${user.store.name}` : ''}. The training book for {user.store.name} is being built; we’ll open it here when it’s ready.</p>
      {user.canSwitchStore && (user.stores || []).filter((x) => x.bookReady).map((x) => <button key={x.id} className="btn" onClick={() => void switchTo(x.id)}>Open {x.name}’s Book</button>)}
      {canEdit(user) && <Link className="btn ghost" to="/admin">Go to the Admin</Link>}
      {user.impersonatedBy
        ? <button className="link-btn" onClick={() => void back()}>Back to Your Account</button>
        : <button className="link-btn" onClick={() => void signOut()}>Sign Out</button>}
    </div></div>
  );

  return (
    <NavContext.Provider value={entry?.nav ?? ''}>
      <a className="skip" href="#content">Skip to content</a>
      <header className="mobile-bar">
        <img src="/img/logo-white.png" alt="The Baldwin" height="28" />
        <button className="menu-btn" aria-expanded={menu} aria-controls="side" onClick={() => setMenu((m) => !m)}>
          {menu ? 'Close' : 'Menu'}
        </button>
      </header>
      <div className={'shell' + (menu ? ' menu-open' : '')}>
        <aside id="side" className="side">
          <Sidebar onNavigate={() => setMenu(false)} />
        </aside>
        <div id="content" className="content">
          <PageView />
        </div>
      </div>
      <div className="corner">
      {canEdit(user) && !user.impersonatedBy && <EditBar />}
      <div className={'demo-flag' + (user.impersonatedBy ? ' support' : '')} role="note">
        {user.impersonatedBy
          ? <>Support view: signed in as <strong>{user.name}</strong> · <button className="link-btn" onClick={() => void back()}>Back to Your Account</button></>
          : <>Signed in as <strong>{user.name}</strong> · <button className="link-btn" onClick={() => void signOut()}>Sign Out</button></>}
      </div>
      </div>
    </NavContext.Provider>
  );
}
