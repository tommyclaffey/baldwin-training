import { useState, useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { PageView, usePageEntry } from './components/PageView';
import { NavContext } from './components/FigmaNode';
import { EditBar } from './components/EditBar';
import { useSession } from './lib/session';
import AdminApp from './admin/AdminApp';

export default function App() {
  const { pathname } = useLocation();
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return <Routes><Route path="/admin/*" element={<AdminApp />} /></Routes>;
  return <Book />;
}

function Book() {
  const entry = usePageEntry();
  const { user } = useSession();
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenu(false), [pathname]);

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
      {user ? <EditBar /> : <div className="demo-flag" role="note">Demo · sample content, Baldwin team to confirm · <Link to="/admin">Manager Sign In</Link></div>}
    </NavContext.Provider>
  );
}
