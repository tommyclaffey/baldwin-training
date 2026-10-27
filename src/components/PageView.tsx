import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigationType, Link } from 'react-router-dom';
import { CompactContext, FigmaNode, NavContext, SlotContext, type FNode, type Slot } from './FigmaNode';
import { QuizCard, ProgressCard } from '../quiz/QuizCard';
import { quizPage } from '../quiz/transform';
import { useQuiz } from '../quiz/store';

const QUIZ_PAGE = '18:2';
const QUIZ_SLOTS: Record<string, Slot> = { 'Live quiz': (p) => <QuizCard {...p} />, Progress: (p) => <ProgressCard {...p} /> };
const NO_SLOTS: Record<string, Slot> = {};
import { PRODUCT_NAME } from '../lib/brand';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

type Page = { id: string; name: string; bg?: string; main: FNode; edited?: number };
const cache = new Map<string, Page>();

export function usePageEntry() {
  const { pathname } = useLocation();
  const { index } = useSession();
  const bySlug = useMemo(() => new Map(index.map((e) => [e.slug, e])), [index]);
  const slug = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
  return bySlug.get(slug);
}

/** The assembled page from the server (recipes, cocktails and edits included). Falls back to the built-in copy. */
async function fetchPage(file: string): Promise<Page> {
  try {
    return await api<Page>(`/api/page/${file}`);
  } catch (e) {
    if (file.startsWith('i')) throw e;
    const r = await fetch(`/content/pages/${file}.json`);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
}
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

  const isQuiz = page.id === QUIZ_PAGE;
  const { x, y, ...main } = isQuiz ? quizPage(page.main, quiz) : page.main;
  void x; void y;
  return (
    <NavContext.Provider value={entry.nav}>
      <CompactContext.Provider value={compact}>
          <SlotContext.Provider value={isQuiz ? QUIZ_SLOTS : NO_SLOTS}>
          {loading && <div className="nav-progress" role="progressbar" aria-label="Loading page" />}
          <main ref={ref} key={shown.file} aria-busy={loading || undefined} className={'page page-enter' + (compact ? ' compact' : '')} style={{ backgroundColor: page.bg }}>
            <FigmaNode node={main} rootStyle={{ width: compact ? '100%' : DESIGN_W, height: 'auto', minHeight: '100vh', margin: '0 auto', position: 'relative', zoom: zoom < 1 ? zoom : undefined }} />
          </main>
          </SlotContext.Provider>
      </CompactContext.Provider>
    </NavContext.Provider>
  );
}
