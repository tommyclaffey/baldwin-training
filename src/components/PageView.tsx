import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { CompactContext, EditContext, FigmaNode, NavContext, SlotContext, type FNode, type Slot } from './FigmaNode';
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
async function loadPage(file: string): Promise<Page> {
  try {
    return await api<Page>(`/api/page/${file}`);
  } catch (e) {
    if (file.startsWith('i')) throw e;
    const r = await fetch(`/content/pages/${file}.json`);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
}

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
  const { ref, zoom, compact } = useFit();
  const [page, setPage] = useState<Page | null>(entry ? cache.get(entry.file) ?? null : null);
  const [error, setError] = useState(false);
  const [saveError, setSaveError] = useState('');
  const file = entry?.file;

  useEffect(() => {
    if (!entry) return;
    document.title = entry.slug ? `${entry.title} · ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [entry]);
  useEffect(() => { window.scrollTo(0, 0); }, [file]);

  useEffect(() => {
    if (!file) return;
    const hit = cache.get(file);
    if (hit) setPage(hit); else setPage(null);
    setError(false);
    let live = true;
    loadPage(file)
      .then((p) => { cache.set(file, p); if (live) setPage(p); })
      .catch(() => { if (live && !hit) setError(true); });
    return () => { live = false; };
  }, [file, session.version]);

  const save = useCallback(async (path: string, value: object) => {
    if (!page) return;
    setSaveError('');
    try {
      await api('/api/override', { method: 'PUT', body: { pageId: page.id, path, value } });
      const fresh = await loadPage(file!);
      cache.set(file!, fresh);
      setPage(fresh);
    } catch (e) {
      setSaveError((e as Error).message);
      throw e;
    }
  }, [page, file]);
  // Recipe and cocktail pages added in the admin are edited in their form, so the page and the form never disagree.
  const editing = session.editing && !!page && !page.id.startsWith('i');
  const editApi = useMemo(() => ({ pageId: page?.id ?? '', editing, save }), [page, editing, save]);

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
  if (!page) return <main ref={ref} className="page page-loading" aria-busy="true"><div className="loader" /></main>;

  const isQuiz = page.id === QUIZ_PAGE;
  const { x, y, ...main } = isQuiz ? quizPage(page.main, quiz) : page.main;
  void x; void y;
  return (
    <NavContext.Provider value={entry.nav}>
      <CompactContext.Provider value={compact}>
        <EditContext.Provider value={editApi}>
          <SlotContext.Provider value={isQuiz ? QUIZ_SLOTS : NO_SLOTS}>
          <main ref={ref} className={'page' + (compact ? ' compact' : '') + (editing ? ' is-editing' : '')} style={{ backgroundColor: page.bg }}>
            <FigmaNode node={main} rootStyle={{ width: compact ? '100%' : DESIGN_W, height: 'auto', minHeight: '100vh', margin: '0 auto', position: 'relative', zoom: zoom < 1 ? zoom : undefined }} />
          </main>
          {saveError && <div className="toast error" role="alert">{saveError} <button className="link-btn" onClick={() => setSaveError('')}>Dismiss</button></div>}
          </SlotContext.Provider>
        </EditContext.Provider>
      </CompactContext.Provider>
    </NavContext.Provider>
  );
}
