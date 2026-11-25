import { useState, useEffect, useRef } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { needsTwoStep, TWO_STEP_HOME } from './lib/twostep';
import { Sidebar } from './components/Sidebar';
import { PageView, usePageEntry } from './components/PageView';
import { NavContext } from './components/FigmaNode';
import { useSession } from './lib/session';
import { canEdit } from './lib/api';
import { demoTab, leaveDemo, isSample } from './lib/demo';
import { BookSignIn, SignedInCard } from './components/BookSignIn';
import { SignIn } from './admin/screens';
import { DemoPicker } from './components/DemoPicker';
import { clearPages } from './components/PageView';
import { setQuizUser } from './quiz/store';
import AdminApp from './admin/AdminApp';
import { EditInPlaceProvider } from './components/EditSheet';
import { EditModeProvider } from './edit/state';
import { EditModeToggle } from './edit/EditModeBar';
import { setFavicon } from './lib/favicon';
import { DemoBar, DemoTour, openWelcome } from './components/DemoTour';
import { TeamBar } from './components/TeamBar';
import { MyPathPage, PathReadBar } from './path/MyPath';
import { AckPage } from './path/AckPage';
import { theme, onLookChange } from './lib/theme';
import { focusablesIn } from './lib/modal';
import { LookLogo } from './components/LookLogo';

// Mise skin (Nov 10): a Mise-brand company sees the app in Mise (Nov 11: the brand comes with the session, see lib/theme.ts);
// The Baldwin's look is the default.
import { CertificatePage } from './path/Certificate';
import { TeamChatPage } from './chat/TeamChat';
import { hasChat, useChatState } from './chat/unread';
import { openChat } from './chat/panel';
import { ChatPanelHost } from './chat/ChatPanel';
import { PrepPage } from './prep/PrepPage';
import { ImportPage } from './import/ImportPage';
import { LegalRoute, LEGAL_PATHS } from './components/Legal';
import { authRouteAt } from './lib/account';
import { SetUpSignIn } from './components/SetUpSignIn';
import { SignUp } from './components/SignUp';
import { phoneOnPin, setUpPath } from './lib/authroute';

export default function App() {
  const { pathname } = useLocation();
  // Nov 22: a look made in Your Look draws once its paint is here (and Your Look's live preview redraws as it changes)
  const [, redraw] = useState(0);
  useEffect(() => onLookChange(() => redraw((n) => n + 1)), []);
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return <><Routes><Route path="/admin/*" element={<AdminApp />} /></Routes><ChatPanelHost /></>;
  // Nov 11: two demos, each with its own link. /demo = The Baldwin's, /demo/mise = Fig & Fire in the Mise look.
  if (pathname === '/demo' || pathname === '/demo/brg') return <DemoPicker kind="baldwin" />;
  if (pathname === '/demo/mise') return <DemoPicker kind="mise" />;
  // Nov 16: Privacy, Terms and Help. Until they're public the server says "not found", and the address shows what any
  // unknown address does (the sign-in screen, or "We couldn't find that page").
  if (LEGAL_PATHS[pathname]) return <LegalRoute kind={LEGAL_PATHS[pathname]} fallback={<><Book /><ChatPanelHost /></>} />;
  return <><Book /><ChatPanelHost /></>;
}

function Book() {
  const entry = usePageEntry();
  const { search } = useLocation();
  const { user, loaded, refresh } = useSession();
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenu(false), [pathname]);
  // Phone menu: Escape closes it, and the page behind doesn't scroll while it's open.
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => {
      const btn = document.querySelector<HTMLElement>('.menu-btn'), side = document.getElementById('side');
      if (e.key === 'Escape') { setMenu(false); btn?.focus(); return; }
      // Nov 21 (keyboard pass): while the menu covers the page, Tab goes round the menu button and the menu, not the page behind
      if (e.key !== 'Tab' || !btn || !side || !btn.getClientRects().length) return;
      const f = [btn, ...focusablesIn(side)];
      // the backdrop (a Close Menu button for pointers) sits between the two, so every step is taken here
      const at = f.indexOf(document.activeElement as HTMLElement);
      e.preventDefault(); f[at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    };
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

  const { count: unread, mentions } = useChatState(hasChat(user));
  // Nov 23: was this tab signed out a moment ago? Signing in on /sign-in or /join goes Home; arriving signed in shows who.
  const seen = useRef<'none' | 'out' | 'in'>('none');
  useEffect(() => { if (loaded) seen.current = user ? 'in' : 'out'; }, [loaded, user]);
  if (!loaded || strayDemo) return <main className="page page-loading" aria-busy="true"><div className="loader" /></main>;
  // Nov 19: an account's own link (miseacademy.app/the-baldwin) opens its sign-in in its look; signed in, it's just Home.
  // Nov 23 (src/lib/authroute.ts): /sign-in and /<account>(/sign-in) = Sign In (email + password); /join and /<account>/join
  // = Join with a Code. Nov 25 (section 50): every other address, signed out, is Sign In (the root too), and
  // /set-up-sign-in is the one-time move for people who joined with a PIN. A phone that joined with a PIN opens that by
  // itself (the root, any page, or its account's own link; /sign-in typed out is always Sign In). The old PIN link
  // (/join?pin=1) goes there too.
  const route = authRouteAt(pathname);
  if (!user) {
    const account = route?.account ?? null;
    if (route?.kind === 'join' && new URLSearchParams(search).get('pin') === '1') return <Navigate to={setUpPath(account)} replace />;
    if (route?.kind === 'join') return <BookSignIn account={account} />;
    if (route?.kind === 'sign-up') return <SignUp />; // Nov 25: Start Your Restaurant (section 48)
    if (route?.kind === 'set-up' || ((!route || (account && pathname === '/' + account.slug)) && phoneOnPin())) return <SetUpSignIn account={account} />;
    return <SignIn brand={account?.brand} kicker={account?.name} account={account} />;
  }
  if (needsTwoStep(user)) return <Navigate to={TWO_STEP_HOME} replace />; // the server won't open the book until it's on (Nov 16)
  if (route) {
    // just signed in here, or the account's own link: Home. Arrived already signed in: who, Go to Home, Sign Out.
    if (seen.current === 'out' || (route.account && pathname === '/' + route.account.slug)) return <Navigate to="/" replace />;
    return <SignedInCard kind={route.kind} account={route.account} />;
  }
  return (
    <EditInPlaceProvider>
    <EditModeProvider>
    <NavContext.Provider value={pathname === '/import' || pathname.startsWith('/import/') ? 'Import a Menu' : pathname === '/prep' || pathname.startsWith('/prep/') ? 'Prep' : pathname === '/my-path' || pathname.startsWith('/my-path/') ? 'My Path' : pathname === '/team-chat' || pathname.startsWith('/team-chat/') ? 'Team Chat' : pathname.startsWith('/certificate/beer') ? 'Beer Program' : pathname.startsWith('/certificate/hosp') ? 'Hospitality Program' : pathname.startsWith('/certificate/somm') ? 'Sommelier Program' : pathname.startsWith('/certificate/') ? 'Cocktail Program' : entry?.nav ?? ''}>
      <a className="skip" href="#content">Skip to content</a>
      <header className="mobile-bar">
        <div className={'mobile-brand' + (user.demo ? ' has-pill' : '')}>
          {/* Nov 17: the look's own logo (the store's, when it wears its own look, even before its book is ready) */}
          {user.store && !user.store.bookReady && !isSample(user) && !user.store.ownLook
            ? <strong className="mobile-name">{user.store.name}</strong>
            : <Link to="/" aria-label="Home"><LookLogo height={theme().mark.barH} /></Link>}
          {user.demo && <button type="button" className="demo-pill" onClick={openWelcome}>DEMO</button>}
        </div>
        <div className="mobile-tools">
        <EditModeToggle />
        {/* Chat v2 (Nov 13, Figma 690:862): Team Chat on the phone bar, with its count (red "@ N" when you're mentioned). */}
        {hasChat(user) && (
          <button type="button" className="chat-btn" aria-haspopup="dialog" onClick={() => openChat()}
            aria-label={'Team Chat' + (mentions && unread ? `, ${mentions} ${mentions === 1 ? 'mention' : 'mentions'} of you` : '') + (unread ? `, ${unread} unread` : '')}>
            <svg width="24" height="24" viewBox="0 0 17 17" fill="none" aria-hidden="true"><path d="M14.52 8.15a5.67 5.67 0 0 1-8.29 5.03l-3.4.99.99-3.12A5.67 5.67 0 1 1 14.52 8.15Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            {unread > 0 && <span className={'menu-count' + (mentions ? ' at' : '')} aria-hidden="true">{mentions ? `@ ${mentions}` : unread > 99 ? '99+' : unread}</span>}
          </button>
        )}
        <button className="menu-btn" aria-expanded={menu} aria-controls="side" aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu((m) => !m)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        </div>
      </header>
      <div className={'shell' + (menu ? ' menu-open' : '')}>
        {menu && <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenu(false)} />}
        <aside id="side" className="side" aria-label="Sidebar">
          <Sidebar onNavigate={() => setMenu(false)} />
        </aside>
        <div id="content" className="content">
          <DemoBar />
          <TeamBar />
          {pathname === '/import' || pathname.startsWith('/import/') ? (canEdit(user) ? <ImportPage /> : <PageView />) : pathname === '/prep' || pathname.startsWith('/prep/') ? <PrepPage /> : pathname === '/team-chat' || pathname.startsWith('/team-chat/') ? <TeamChatPage /> : pathname === '/my-path' ? <MyPathPage /> : pathname === '/my-path/acknowledgment' ? <AckPage /> : pathname.startsWith('/certificate/') ? <CertificatePage /> : <><PageView /><PathReadBar slug={entry?.slug} /></>}
        </div>
        {user.demo && <DemoTour />}
      </div>
    </NavContext.Provider>
    </EditModeProvider>
    </EditInPlaceProvider>
  );
}
