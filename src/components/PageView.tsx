import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import index from '../content/index.json';
import { CompactContext, FigmaNode, NavContext, type FNode } from './FigmaNode';
import { PRODUCT_NAME } from '../lib/brand';

type Entry = { id: string; file: string; slug: string; name: string; title: string; nav: string };
const BY_SLUG = new Map((index as Entry[]).map((e) => [e.slug, e]));
type Page = { id: string; name: string; bg?: string; main: FNode };
const cache = new Map<string, Page>();

export function usePageEntry() {
  const { pathname } = useLocation();
  const slug = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
  return BY_SLUG.get(slug);
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
  const { ref, zoom, compact } = useFit();
  const [page, setPage] = useState<Page | null>(entry ? cache.get(entry.file) ?? null : null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!entry) return;
    document.title = entry.slug ? `${entry.title} · ${PRODUCT_NAME}` : PRODUCT_NAME;
    window.scrollTo(0, 0);
    const hit = cache.get(entry.file);
    if (hit) { setPage(hit); return; }
    setPage(null); setError(false);
    let live = true;
    fetch(`/content/pages/${entry.file}.json`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((p: Page) => { cache.set(entry.file, p); if (live) setPage(p); })
      .catch(() => live && setError(true));
    return () => { live = false; };
  }, [entry]);

  if (!entry) {
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

  const { x, y, ...main } = page.main;
  void x; void y;
  return (
    <NavContext.Provider value={entry.nav}>
      <CompactContext.Provider value={compact}>
        <main ref={ref} className={'page' + (compact ? ' compact' : '')} style={{ backgroundColor: page.bg }}>
          <FigmaNode node={main} rootStyle={{ width: compact ? '100%' : DESIGN_W, height: 'auto', minHeight: '100vh', margin: '0 auto', position: 'relative', zoom: zoom < 1 ? zoom : undefined }} />
        </main>
      </CompactContext.Provider>
    </NavContext.Provider>
  );
}
