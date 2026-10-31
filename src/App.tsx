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
  // Phone menu: Escape closes it, and the page behind doesn't scroll while it's open.
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('keydown', esc);
    document.body.classList.add('menu-lock');
    return () => { document.removeEventListener('keydown', esc); document.body.classList.remove('menu-lock'); };
  }, [menu]);
  // A new person on this device: their own quiz progress, and no pages kept from the last person.
  useEffect(() => { clearPages(); setQuizUser(user ? { id: user.id, name: user.name } : null); }, [user?.id, user?.name, user?.workingIn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return <main className="page page-loading" aria-busy="true"><div className="loader" /></main>;
  if (!user) return <BookSignIn />;
  const signOut = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); setUser(null); };
  const back = async () => { await api('/api/super/return', { method: 'POST' }).catch(() => {}); await refresh(); location.assign('/admin/super'); };
  return (
    <NavContext.Provider value={entry?.nav ?? ''}>
      <a className="skip" href="#content">Skip to content</a>
      <header className="mobile-bar">
        {user.store && !user.store.bookReady
          ? <strong className="mobile-name">{user.store.name}</strong>
          : <Link to="/" aria-label="Home"><img src="/img/logo-white.png" alt="The Baldwin" height="28" /></Link>}
        <button className="menu-btn" aria-expanded={menu} aria-controls="side" aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu((m) => !m)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </header>
      <div className={'shell' + (menu ? ' menu-open' : '')}>
        {menu && <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenu(false)} />}
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
