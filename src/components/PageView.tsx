import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigationType, Link } from 'react-router-dom';
import { CompactContext, FigmaNode, NavContext, SlotContext, type FNode, type Slot } from './FigmaNode';
import { InteractProvider } from './interact';
import { QuizCard, ProgressCard } from '../quiz/QuizCard';
import { quizPage, trainingCard } from '../quiz/transform';
import { useQuiz } from '../quiz/store';

const QUIZ_PAGE = '18:2';
const QUIZ_SLOTS: Record<string, Slot> = { 'Live quiz': (p) => <QuizCard {...p} />, Progress: (p) => <ProgressCard {...p} /> };
const NO_SLOTS: Record<string, Slot> = {};
import { PRODUCT_NAME } from '../lib/brand';
import { api, canEdit } from '../lib/api';
import { useSession } from '../lib/session';

type Empty = { kind: 'home' | 'page'; title: string; body: string; admin: string | null; store: string | null };
type Page = { id: string; name: string; bg?: string; main: FNode; edited?: number; empty?: Empty };

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
      <p className="eyebrow">Lineup</p>
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
      <p>{e.body}</p>
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
  const file = entry?.file;
  // The page on screen. While the next one loads, the current one stays up (no blank screen).
  const [shown, setShown] = useState<{ file: string; page: Page; key: string } | null>(() => (file && cache.has(file) ? { file, page: cache.get(file)!, key: location.key } : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const bySlug = useMemo(() => new Map(session.index.map((e) => [e.slug, e.file])), [session.index]);
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
      .catch(() => { if (live && !hit) setError(true); })
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
  const page = shown.page;
  if (page.empty) return <EmptyPage e={page.empty} mainRef={ref} />;

  const isQuiz = page.id === QUIZ_PAGE;
  const isHome = page.id === '4:2';
  const { x, y, ...main } = isQuiz ? quizPage(page.main, quiz) : isHome ? trainingCard([page.main], quiz)[0] : page.main;
  void x; void y;
  return (
    <NavContext.Provider value={entry.nav}>
      <CompactContext.Provider value={compact}>
          <SlotContext.Provider value={isQuiz ? QUIZ_SLOTS : NO_SLOTS}>
          <InteractProvider key={shown.file}>
          {loading && <div className="nav-progress" role="progressbar" aria-label="Loading page" />}
          <main ref={ref} key={shown.file} aria-busy={loading || undefined} className={'page page-enter' + (compact ? ' compact' : '')} style={{ backgroundColor: page.bg }}>
            <FigmaNode node={main} rootStyle={{ width: compact ? '100%' : DESIGN_W, height: 'auto', minHeight: '100vh', margin: '0 auto', position: 'relative', zoom: zoom < 1 ? zoom : undefined }} />
          </main>
          </InteractProvider>
          </SlotContext.Provider>
      </CompactContext.Provider>
    </NavContext.Provider>
  );
}
