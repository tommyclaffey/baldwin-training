import { currentBrand, hasPageTitle, themePage, lookTheme, type Theme } from '../lib/theme';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigationType, Link, Navigate } from 'react-router-dom';
import { JUST_SIGNED_IN, justSignedIn } from '../lib/authroute';
import { ChatItemsContext, CompactContext, FigmaNode, NavContext, SlotContext, type FNode, type Slot } from './FigmaNode';
import { WaitingCard } from '../chat/Waiting';
import { InteractProvider } from './interact';
import { QuizModal, ReviewCard, ProgressCard } from '../quiz/QuizCard';
import { QuizBuilder } from '../quiz/QuizBuilder';
import { quizPage, trainingCard } from '../quiz/transform';
import { useQuiz } from '../quiz/store';

const QUIZ_PAGE = '18:2';
const QUIZ_SLOTS: Record<string, Slot> = { 'Review queue': (p) => <ReviewCard {...p} />, 'Live quiz': (p) => <ReviewCard {...p} />, Progress: (p) => <ProgressCard {...p} />, Builder: (p) => <QuizBuilder {...p} /> };
const NO_SLOTS: Record<string, Slot> = {};
// Team Chat v2 (Nov 13, Figma 688:862): Home's "Waiting for you" card, between the greeting and the day's cards.
const HOME_SLOTS: Record<string, Slot> = { 'Chat · Waiting': (p) => <WaitingCard {...p} /> };
function withWaitingSlot(main: FNode): FNode {
  const dash = main.c?.find((c) => c.n === 'Section · Dashboard');
  if (!dash?.c || dash.c.some((c) => c.n === 'Chat · Waiting')) return main;
  const at = dash.c.findIndex((c) => c.n === 'Greeting');
  const slot = { t: 'F', n: 'Chat · Waiting', w: dash.w, sh: 'F', sv: 'H' } as FNode;
  const c = [...dash.c.slice(0, at + 1), slot, ...dash.c.slice(at + 1)];
  return { ...main, c: main.c!.map((x) => (x === dash ? { ...dash, c } : x)) };
}

// Nov 15 (audit 13): on phones Send to Team and Edit Page floated over the page and covered body text on first view (the
// Negroni's description, a lesson's key points). Now they sit in the breadcrumb row, as on desktop: beside the breadcrumb
// when both fit, on their own line under it (right-aligned) when not. A page without a breadcrumb gets the row under its top bar.
const CRUMB_ROW = 'Page tools · Breadcrumb row';
function withToolsRow(main: FNode): { main: FNode; crumb: FNode | null } {
  let crumb: FNode | null = null;
  const swap = (n: FNode): FNode => {
    if (crumb || !n.c) return n;
    const at = n.c.findIndex((k) => k.n === 'Breadcrumb');
    if (at >= 0) {
      crumb = n.c[at];
      return { ...n, c: n.c.map((k, i) => (i === at ? ({ t: 'F', n: CRUMB_ROW, w: k.w, h: k.h, sh: 'H', sv: 'H' } as FNode) : k)) };
    }
    const c = n.c.map(swap);
    return crumb ? { ...n, c } : n;
  };
  const out = swap(main);
  if (crumb || !main.c) return { main: out, crumb };
  const at = main.c.findIndex((k) => k.n === 'Top bar') + 1;
  const row = { t: 'F', n: CRUMB_ROW, w: main.w, h: 44, sh: 'H', sv: 'H' } as FNode;
  return { main: { ...main, c: [...main.c.slice(0, at), row, ...main.c.slice(at)] }, crumb: null };
}
import { PRODUCT_NAME } from '../lib/brand';
import { api, canEdit } from '../lib/api';
import { reportProblem } from '../lib/problems';
import { useSession } from '../lib/session';
import { EditPageButton } from './EditSheet';
import { COLLECTION_OF } from './EditBar';
import { PageTools, SendToTeamButton, shareable } from '../chat/SendToTeam';
import { hasChat } from '../chat/unread';
import { EditModeBar } from '../edit/EditModeBar';
import { PageEditContext, useEditMode, type PageEdit } from '../edit/state';
import { editView, hasAddRow } from '../edit/view';

type Empty = { kind: 'home' | 'page'; title: string; body: string; admin: string | null; store: string | null };
type Page = { id: string; name: string; bg?: string; main: FNode; edited?: number; empty?: Empty; edit?: PageEdit };

/** The shared library every store has from day one. */
const LIBRARY = [
  ['steps-of-service', 'Steps of Service', 'The nine steps, what to say and what to do.'],
  ['the-bar/cocktails', 'Cocktails', 'The classics: specs, glassware and history.'],
  ['the-bar/spirits', 'Spirits', 'Every spirit, how it’s made and what to pour.'],
  ['the-bar/wine', 'Wine', 'Grapes, regions and how to talk about wine.'],
  ['the-bar/beer-and-draft', 'Beer & Draft', 'Styles, glassware and pouring.'],
  ['allergen-guide', 'Allergen Guide', 'The major allergens and how to handle them.'],
  ['safety', 'Safety', 'Food safety, temperatures and alcohol service.'],
  ['cleanliness', 'Cleanliness', 'Opening, running and closing checklists.'],
] as const;

/** A store's own page with nothing in it yet, or its home page while its book fills in. */
function EmptyPage({ e, mainRef }: { e: Empty; mainRef: React.RefObject<HTMLElement | null> }) {
  const { user, index } = useSession();
  const has = new Set(index.map((x) => x.slug));
  const manager = canEdit(user);
  if (e.kind === 'home') return (
    <main ref={mainRef} className="page page-message store-home">
      <p className="eyebrow">Mise</p>
      <h1>{e.store}</h1>
      <p>The library below is ready now. Your menu, story and floor plan fill in as your managers add them.</p>
      {manager && <Link className="btn" to="/admin">Add Your Menu</Link>}
      <h2>The Library</h2>
      <ul className="library-tiles">
        {LIBRARY.filter(([slug]) => has.has(slug)).map(([slug, title, sub]) => (
          <li key={slug}><Link to={'/' + slug}><strong>{title}</strong><span>{sub}</span></Link></li>
        ))}
      </ul>
    </main>
  );
  return (
    <main ref={mainRef} className="page page-message">
      <h1>{e.title}</h1>
      <p>{manager ? e.body : e.body.replace(/\s*Managers? [^.]*\.\s*/g, ' ').trim()}</p>
      {manager && e.admin && <Link className="btn" to={e.admin}>Add It in the Admin</Link>}
      <Link className={manager && e.admin ? 'link-btn' : 'btn'} to="/">Go to Home</Link>
    </main>
  );
}
const cache = new Map<string, Page>();

export function usePageEntry() {
  const { pathname } = useLocation();
  const { index } = useSession();
  const bySlug = useMemo(() => new Map(index.map((e) => [e.slug, e])), [index]);
  const slug = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
  return bySlug.get(slug);
}

/** The assembled page from the server (recipes, cocktails and edits included), for signed-in people only. */
// The theme layer (Nov 12, lib/theme.ts): every page is drawn in the company's brand (Nov 11: the brand comes with the
// session), with the layouts every brand shares (the cinematic hero). Themed pages are kept per page object and brand, so
// re-renders don't redo the work.
// Nov 22: kept per paint (a Theme object), so a data look's new paint (Your Look's live preview) re-themes the page; the
// hand-built looks' paint never changes, so for them it's as before.
const themeCache = new WeakMap<Theme, WeakMap<object, Page>>();
function themed(p: Page): Page {
  const t = lookTheme(currentBrand());
  let cache = themeCache.get(t);
  if (!cache) { cache = new WeakMap(); themeCache.set(t, cache); }
  let s = cache.get(p);
  if (!s) { s = themePage(p, t); cache.set(p, s); }
  return s;
}
async function fetchPage(file: string): Promise<Page> {
  return api<Page>(`/api/page/${file}`);
}
/** Someone else signed in on this device: drop the pages kept for the last person. */
export function clearPages() { cache.clear(); inflight.clear(); }
const inflight = new Map<string, Promise<Page>>();
/** One request per page at a time; the result is kept so going back is instant. */
function loadPage(file: string): Promise<Page> {
  let p = inflight.get(file);
  if (!p) {
    p = fetchPage(file).then((pg) => { cache.set(file, pg); return pg; }).finally(() => inflight.delete(file));
    inflight.set(file, p);
  }
  return p;
}
/** Loads a page ahead of a click (hover, focus, touch, or links on screen once the page is idle). */
function prefetch(file: string | undefined) {
  if (file && !cache.has(file) && !inflight.has(file)) loadPage(file).catch(() => {});
}

/** Scroll positions per history entry, so Back returns to where you were. */
const scrolls = new Map<string, number>();

const DESIGN_W = 1176;
const PHONE_MAX = 860;

/** Laptop/tablet: scale the 1176-wide design to fit. Phone: reflow instead. */
function useFit() {
  const ref = useRef<HTMLElement>(null);
  const [fit, setFit] = useState({ zoom: 1, compact: false });
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const calc = () => {
      const w = el.clientWidth;
      const compact = window.innerWidth < PHONE_MAX;
      setFit({ compact, zoom: compact ? 1 : Math.min(1, w / DESIGN_W) });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...fit };
}

export function PageView() {
  const entry = usePageEntry();
  const session = useSession();
  const quiz = useQuiz();
  const location = useLocation();
  const navType = useNavigationType();
  const { ref, zoom, compact } = useFit();
  const editMode = useEditMode();
  const editing = editMode.can && editMode.on;
  const file = entry?.file;
  // The page on screen. While the next one loads, the current one stays up (no blank screen).
  const [shown, setShown] = useState<{ file: string; page: Page; key: string } | null>(() => (file && cache.has(file) ? { file, page: cache.get(file)!, key: location.key } : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const bySlug = useMemo(() => new Map(session.index.map((e) => [e.slug, e.file])), [session.index]);
  // Chat buttons on the page's items: links to pages you can share, other than the one you're on (Send to Team covers it).
  const chatOn = hasChat(session.user);
  const here = entry?.slug;
  const chatLookup = useMemo(() => {
    if (!chatOn) return null;
    const by = new Map(session.index.map((e) => [e.slug, e]));
    return (slug: string) => { const e = by.get(slug); return e && slug !== here && shareable(e) ? { slug, title: e.title } : null; };
  }, [chatOn, session.index, here]);
  const fileFor = (href: string | null) => {
    if (!href || !href.startsWith('/') || href.startsWith('/admin') || href.startsWith('/media')) return undefined;
    return bySlug.get(decodeURIComponent(href.split(/[?#]/)[0]).replace(/^\/+|\/+$/g, ''));
  };

  useEffect(() => {
    if (!entry) return;
    document.title = entry.slug ? `${entry.title} · ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [entry]);

  // Remember where you were on each page.
  useEffect(() => {
    const key = location.key;
    const save = () => scrolls.set(key, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => { save(); window.removeEventListener('scroll', save); };
  }, [location.key]);

  // A page already loaded swaps in before the browser paints.
  useLayoutEffect(() => {
    if (file && cache.has(file) && shown?.file !== file) setShown({ file, page: cache.get(file)!, key: location.key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    if (!file) return;
    let live = true;
    setError(false);
    const hit = cache.get(file);
    if (!hit) setLoading(true);
    // Always ask the server too, so edits show; a cached page stays up meanwhile.
    (hit ? fetchPage(file).then((p) => { cache.set(file, p); return p; }) : loadPage(file))
      .then((p) => { if (live) setShown({ file, page: p, key: location.key }); })
      .catch((e) => { if (live && !hit) { setError(true); reportProblem('page', e, { page: file, path: '/' + (entry?.slug || '') }); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, session.version]);

  // Scroll once the new page is on screen: back to where you were on Back, otherwise to the top.
  const shownKey = shown?.key;
  useLayoutEffect(() => {
    if (!shownKey) return;
    window.scrollTo(0, navType === 'POP' ? scrolls.get(shownKey) ?? 0 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, shown?.file]);

  // Load pages ahead of a click: on hover, focus or touch, and the page's own links once it's idle.
  useEffect(() => {
    const on = (e: Event) => { const a = (e.target as Element | null)?.closest?.('a[href]'); if (a) prefetch(fileFor(a.getAttribute('href'))); };
    document.addEventListener('pointerover', on, { passive: true });
    document.addEventListener('touchstart', on, { passive: true });
    document.addEventListener('focusin', on);
    return () => { document.removeEventListener('pointerover', on); document.removeEventListener('touchstart', on); document.removeEventListener('focusin', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bySlug]);
  useEffect(() => {
    if (!shown) return;
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback || ((cb: () => void) => window.setTimeout(cb, 600));
    let stop = false;
    idle(async () => {
      const files = [...new Set([...(ref.current?.querySelectorAll('a[href]') || [])].map((a) => fileFor(a.getAttribute('href'))).filter(Boolean) as string[])];
      for (const f of files.slice(0, 16)) {
        if (stop) return;
        if (!cache.has(f)) await loadPage(f).catch(() => {});
      }
    });
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.file]);

  if (!entry) {
    if (!session.indexLoaded && !session.index.some((e) => e.file.startsWith('i'))) {
      return <main ref={ref} className="page page-loading" aria-busy="true"><div className="loader" /></main>;
    }
    // just signed in on an old address (Nov 24): Home, not "couldn't find"
    if (justSignedIn() && location.pathname !== '/') { try { sessionStorage.removeItem(JUST_SIGNED_IN); } catch { /* */ } return <Navigate to="/" replace />; }
    // Nov 25: no page list at all means it didn't load (not that the page is gone): say so, and offer to try again
    if (!session.index.length) return (
      <main ref={ref} className="page page-message">
        <h1>This page didn’t load</h1>
        <p>Check your connection, then try again.</p>
        <button className="btn" onClick={() => window.location.reload()}>Try Again</button>
      </main>
    );
    return (
      <main ref={ref} className="page page-message">
        <h1>We couldn’t find that page</h1>
        <p>It may have moved. Head back to the start, or use the search at the top.</p>
        <Link className="btn" to="/">Go to Home</Link>
      </main>
    );
  }
  if (error) {
    return (
      <main ref={ref} className="page page-message">
        <h1>This page didn’t load</h1>
        <p>Check your connection, then try again.</p>
        <button className="btn" onClick={() => window.location.reload()}>Try Again</button>
      </main>
    );
  }
  if (!shown) return <main ref={ref} className="page page-loading" aria-busy="true"><div className="loader" /></main>;
  const page = !shown.page.empty ? themed(shown.page) : shown.page;
  if (page.empty) return <EmptyPage e={page.empty} mainRef={ref} />;

  const isQuiz = page.id === QUIZ_PAGE;
  const isHome = page.id === '4:2';
  const { x, y, ...drawnMain } = isQuiz ? quizPage(page.main, quiz) : isHome ? withWaitingSlot(trainingCard([page.main], quiz)[0]) : page.main;
  void x; void y;
  // Edit Mode: fields where the server marked them; off, the editing-only parts go.
  const viewed = editView(drawnMain as FNode, editing);
  const hasAdd = editing && hasAddRow(page.main);
  // Send to Team and Edit Page: one row, the same spot on every page (desktop: over the breadcrumb row; phones: in it).
  const share = hasChat(session.user) && shareable(entry);
  const editCol = entry.file.startsWith('e') ? COLLECTION_OF[entry.section] : undefined;
  const tools = !editing && (share || editCol) ? (
    <>
      {share && <SendToTeamButton item={{ type: 'page', slug: entry.slug }} />}
      {editCol && <EditPageButton col={editCol} id={Number(entry.file.slice(1))} />}
    </>
  ) : null;
  const inRow = compact && tools ? withToolsRow(viewed) : null;
  const main = inRow ? inRow.main : viewed;
  const baseSlots = isQuiz ? QUIZ_SLOTS : isHome ? HOME_SLOTS : NO_SLOTS;
  const slots: Record<string, Slot> = inRow ? { ...baseSlots, [CRUMB_ROW]: (p) => (
    <div className={p.className + ' crumb-row'} style={{ ...p.style, width: undefined, height: undefined, minHeight: undefined }}>
      {inRow.crumb && <FigmaNode node={inRow.crumb} parentLm="H" />}
      <PageTools inline>{tools}</PageTools>
    </div>
  ) } : baseSlots;
  return (
    <NavContext.Provider value={entry.nav}>
      <CompactContext.Provider value={compact}>
          <SlotContext.Provider value={slots}>
          <ChatItemsContext.Provider value={chatLookup}>
          <InteractProvider key={shown.file}>
          <PageEditContext.Provider value={page.edit || null}>
          {loading && <div className="nav-progress" role="progressbar" aria-label="Loading page" />}
          <main ref={ref} key={shown.file} aria-busy={loading || undefined} className={'page page-enter' + (compact ? ' compact' : '')} style={{ backgroundColor: page.bg }}>
            {editing && <EditModeBar page={page.edit || null} hasAdd={hasAdd} floating={compact} width={compact ? '100%' : DESIGN_W} zoom={zoom < 1 ? zoom : undefined} />}
            {/* Every page has one h1: the drawn title (FigmaNode), or this hidden one when the design has none. */}
            {!hasPageTitle(main) && <h1 className="sr-only">{entry.title}</h1>}
            {/* Nov 21 (keyboard pass): the tools sit over the top row (absolute), so they come first in the Tab order too,
                not after the whole page */}
            {tools && !compact && <PageTools width={DESIGN_W} zoom={zoom < 1 ? zoom : undefined}>{tools}</PageTools>}
            <FigmaNode node={main} rootStyle={{ width: compact ? '100%' : DESIGN_W, height: 'auto', minHeight: '100vh', margin: '0 auto', position: 'relative', zoom: zoom < 1 ? zoom : undefined }} />
          </main>
          {isQuiz && <QuizModal />}
          </PageEditContext.Provider>
          </InteractProvider>
          </ChatItemsContext.Provider>
          </SlotContext.Provider>
      </CompactContext.Provider>
    </NavContext.Provider>
  );
}
