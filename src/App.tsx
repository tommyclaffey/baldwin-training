import { useState, useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { PageView, usePageEntry } from './components/PageView';
import { NavContext } from './components/FigmaNode';
import { useSession } from './lib/session';
import { demoTab, leaveDemo, isSample } from './lib/demo';
import { BookSignIn } from './components/BookSignIn';
import { DemoPicker } from './components/DemoPicker';
import { clearPages } from './components/PageView';
import { setQuizUser } from './quiz/store';
import AdminApp from './admin/AdminApp';
import { EditInPlaceProvider } from './components/EditSheet';
import { EditModeProvider } from './edit/state';
import { EditModeToggle } from './edit/EditModeBar';
import { setFavicon } from './lib/favicon';
import { DemoBar, DemoTour, openWelcome } from './components/DemoTour';
import { MyPathPage, PathReadBar } from './path/MyPath';
import { currentBrand } from './lib/skin';

// Mise skin (Nov 10): a Mise-brand company sees the app in Mise (Nov 11: the brand comes with the session, see lib/skin.ts);
// The Baldwin's look is the default.
import { CertificatePage } from './path/Certificate';
import { TeamChatPage } from './chat/TeamChat';
import { hasChat, useChatUnread } from './chat/unread';
import { ChatPanelHost } from './chat/ChatPanel';

export default function App() {
  const { pathname } = useLocation();
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return <><Routes><Route path="/admin/*" element={<AdminApp />} /></Routes><ChatPanelHost /></>;
  // Nov 11: two demos, each with its own link. /demo = The Baldwin's, /demo/mise = Wrenfield in the Mise look.
  if (pathname === '/demo' || pathname === '/demo/brg') return <DemoPicker kind="baldwin" />;
  if (pathname === '/demo/mise') return <DemoPicker kind="mise" />;
  return <><Book /><ChatPanelHost /></>;
}

function Book() {
  const entry = usePageEntry();
  const { user, loaded, refresh } = useSession();
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

  // The tab icon follows the store being viewed (a manager can switch stores).
  useEffect(() => { if (loaded) setFavicon(user?.store); }, [loaded, user?.store?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // A demo sign-in opened outside the tab it started in: end it and show the real site (see leaveDemo).
  const strayDemo = !!user?.demo && !demoTab();
  useEffect(() => { if (strayDemo) void leaveDemo().then(refresh); }, [strayDemo]); // eslint-disable-line react-hooks/exhaustive-deps

  const unread = useChatUnread(hasChat(user));
  if (!loaded || strayDemo) return <main className="page page-loading" aria-busy="true"><div className="loader" /></main>;
  if (!user) return <BookSignIn />;
  return (
    <EditInPlaceProvider>
    <EditModeProvider>
    <NavContext.Provider value={pathname === '/my-path' ? 'My Path' : pathname === '/team-chat' || pathname.startsWith('/team-chat/') ? 'Team Chat' : pathname.startsWith('/certificate/beer') ? 'Beer Program' : pathname.startsWith('/certificate/somm') ? 'Sommelier Program' : pathname.startsWith('/certificate/') ? 'Cocktail Program' : entry?.nav ?? ''}>
      <a className="skip" href="#content">Skip to content</a>
      <header className="mobile-bar">
        <div className={'mobile-brand' + (user.demo ? ' has-pill' : '')}>
          {user.store && !user.store.bookReady && !isSample(user)
            ? <strong className="mobile-name">{user.store.name}</strong>
            : currentBrand() === 'mise'
              ? <Link to="/" aria-label="Home"><img src="/img/mise-academy-lockup-cream.png" alt="Mise Academy" height="34" /></Link>
              : <Link to="/" aria-label="Home"><img src="/img/logo-white.png" alt="The Baldwin" height="28" /></Link>}
          {user.demo && <button type="button" className="demo-pill" onClick={openWelcome}>DEMO</button>}
        </div>
        <div className="mobile-tools">
        <EditModeToggle />
        <button className="menu-btn" aria-expanded={menu} aria-controls="side" aria-label={(menu ? 'Close menu' : 'Open menu') + (unread ? `, ${unread} unread in Team Chat` : '')} onClick={() => setMenu((m) => !m)}>
          {unread > 0 && !menu && <span className="menu-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        </div>
      </header>
      <div className={'shell' + (menu ? ' menu-open' : '')}>
        {menu && <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenu(false)} />}
        <aside id="side" className="side">
          <Sidebar onNavigate={() => setMenu(false)} />
        </aside>
        <div id="content" className="content">
          <DemoBar />
          {pathname === '/team-chat' || pathname.startsWith('/team-chat/') ? <TeamChatPage /> : pathname === '/my-path' ? <MyPathPage /> : pathname.startsWith('/certificate/') ? <CertificatePage /> : <><PageView /><PathReadBar slug={entry?.slug} /></>}
        </div>
        {user.demo && <DemoTour />}
      </div>
    </NavContext.Provider>
    </EditModeProvider>
    </EditInPlaceProvider>
  );
}
