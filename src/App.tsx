import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { PageView, usePageEntry } from './components/PageView';
import { NavContext } from './components/FigmaNode';

export default function App() {
  const entry = usePageEntry();
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
      <div className="demo-flag" role="note">Demo · sample content, Baldwin team to confirm</div>
    </NavContext.Provider>
  );
}
