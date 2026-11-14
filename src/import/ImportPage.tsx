// Import a Menu (Nov 14). Figma 09 · Proposals → 30 (607:812): Upload 607:813, Reading (option A "The menu comes to life",
// 658:803 / 658:1160 / 658:1511, phone 661:802, motion note 662:817), Review 607:1060, Done 607:1185, wine and cocktail
// cards 613:851. Server: server/menuimport.mjs.
//   /import          the store's open import, or a new one
//   /import/new      a new import
//   /import/:id      that import, at its step (Upload · Read · Review · Done)
// Same layout for every brand; the look comes from the theme roles only (src/lib/theme.ts), like Prep.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorBox, Head, Ico, Loading, Toast } from '../prep/ui';
import '../prep/prep.css';
import './import.css';

/* ------------------------------------------------------------------ types */
type Kind = 'food' | 'wine' | 'cocktail';
type Status = 'uploaded' | 'reading' | 'failed' | 'review' | 'done' | 'undone';
type FileRow = { n: number; name: string; mime: string; size: number; pages: number; sample: boolean };
type Allergen = { name: string; printed: boolean; quote: string };
type Draft = { field: string; label: string; text: string; state: 'draft' | 'approved' | 'skipped' };
type Change = { field: string; label: string; from: unknown; to: unknown };
type Item = {
  id: number; seq: number; page: number | null; group: string; name: string; status: 'new' | 'updated' | 'unchanged' | 'missing';
  data: Record<string, unknown>; source: { section?: string; lines?: string[]; priceText?: string; priceUnclear?: boolean; allergens?: Allergen[] };
  changes: Change[]; allergensOk: boolean; priceOk: boolean; decision: 'pending' | 'approved' | 'skipped' | 'unchanged' | 'keep' | 'archived';
  decidedBy: string | null; slug: string | null; drafts: Draft[];
};
type Found = { name: string; page: number; section: string; price: string; description: string; allergens: string[]; lines: string[] };
type Summary = { added: number; updated: number; unchanged: number; skipped: number; archived: number; waiting: number; questions: number; groups: string[];
  allergenDishes: number; newPages: { name: string; slug: string }[]; skippedNames: string[]; drafts: (Draft & { itemId: number; name: string })[] };
type State = {
  import: { id: number; kind: Kind; kindLabel: string; one: string; many: string; title: string | null; status: Status; error: string | null; files: FileRow[]; pages: number;
    demo: boolean; createdAt: string; by: string | null; readAt: string | null; finishedAt: string | null; finishedBy: string | null; undoneAt: string | null; undoneBy: string | null };
  items: Item[];
  counts: Record<'all' | 'approved' | 'skipped' | 'new' | 'updated' | 'unchanged' | 'ready' | 'needsYou' | 'missing' | 'archived', number>;
  allergenList: string[]; options: Record<string, string[]>;
  progress?: { found: number; page: number; pages: number; note: string; latest: Found[] };
  summary?: Summary;
  approvedNow?: number;
};

const KINDS: { key: Kind; title: string; line: string; icon: ReactNode }[] = [
  { key: 'food', title: 'Food Book or Menu', line: 'Dishes, courses, prices, ingredients, allergens',
    icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 2.5v5.5M4 2.5V6a2 2 0 0 0 4 0V2.5M6 8v9.5M14 17.5V2.5c-2 1-3 3.2-3 6v2h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { key: 'wine', title: 'Wine List', line: 'Wines, grapes, regions, glass and bottle prices',
    icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 2.5h8c.3 3.6-.8 7-4 7s-4.3-3.4-4-7ZM10 9.5v8M7 17.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { key: 'cocktail', title: 'Cocktail List or Specs', line: 'Drinks, spec lines, glass, garnish, method',
    icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 3h14l-7 7.5L3 3ZM10 10.5v7M6.5 17.5h7M5.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> },
];
const FIELDS: Record<Kind, [string, string][]> = {
  food: [['course', 'Course'], ['price', 'Price'], ['description', 'Description'], ['ingredients', 'Ingredients']],
  wine: [['grape', 'Grape'], ['region', 'Region'], ['country', 'Country'], ['color', 'Colour'], ['list', 'On the list'], ['glass', 'Glass'], ['half', '½ bottle'], ['bottle', 'Bottle'], ['style', 'Style'], ['notes', 'Notes']],
  cocktail: [['menuSection', 'Menu section'], ['build', 'Spec'], ['glass', 'Glass'], ['method', 'Method'], ['ice', 'Ice'], ['garnish', 'Garnish'], ['base', 'Base spirit'], ['price', 'Price'], ['description', 'Description']],
};
const PRICEY = new Set(['price', 'glass', 'half', 'bottle']);
const money = (v: unknown) => (v === '' || v == null ? '' : `$${String(v)}`);
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'object' && x ? `${(x as { amount?: string }).amount || ''} ${(x as { ingredient?: string }).ingredient || ''}`.trim() : String(x))).filter(Boolean) : []);
const show = (field: string, v: unknown) => (Array.isArray(v) ? asList(v).join(', ') : PRICEY.has(field) ? money(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? ''));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sizeText = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm') : '');
const pagesText = (ps: number[]) => (ps.length === 0 ? '' : ps.length === 1 ? `Page ${ps[0]}` : ps.length === 2 ? `Pages ${ps[0]} and ${ps[1]}` : `Pages ${ps[0]}–${ps[ps.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ the page */
export function ImportPage() {
  const { pathname } = useLocation();
  useEffect(() => { document.title = 'Import a Menu · Mise Academy'; }, []);
  const m = /^\/import\/(\d+)/.exec(pathname);
  return <main className="prp-main">{m ? <ImportView id={Number(m[1])} /> : pathname.startsWith('/import/new') ? <Upload state={null} /> : <ImportHome />}</main>;
}

/** /import: the store's open import if there is one, otherwise a new one. */
function ImportHome() {
  const [to, setTo] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<{ open: number | null }>('/api/imports').then((r) => setTo(r.open ? `/import/${r.open}` : '/import/new')).catch((e) => setError((e as Error).message)); }, []);
  if (error) return <div className="prp"><ErrorBox error={error} /></div>;
  return to ? <Navigate to={to} replace /> : <div className="prp"><Loading /></div>;
}

function useImport(id: number) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<State>(`/api/imports/${id}`).then((s) => { setState(s); setError(''); }).catch((e) => setError((e as Error).message)), [id]);
  useEffect(() => { setState(null); void load(); }, [load]);
  // While it's reading, the screen follows the reader (every second).
  useEffect(() => {
    if (state?.import.status !== 'reading') return;
    const t = setInterval(() => void load(), 900);
    return () => clearInterval(t);
  }, [state?.import.status, load]);
  return { state, setState, error, load };
}

function ImportView({ id }: { id: number }) {
  const { state, setState, error, load } = useImport(id);
  if (error && !state) return <div className="prp"><ErrorBox error={error} retry={() => void load()} /></div>;
  if (!state) return <div className="prp"><Loading /></div>;
  const s = state.import.status;
  if (s === 'reading') return <Reading state={state} onState={setState} />;
  if (s === 'review') return <Review state={state} onState={setState} />;
  if (s === 'done' || s === 'undone') return <Done state={state} onState={setState} />;
  return <Upload state={state} onState={setState} />;
}

/* ------------------------------------------------------------------ head and steps */
const STEPS = ['Upload', 'Read', 'Review', 'Done'];
function Steps({ at }: { at: number }) {
  return (
    <ol className="mi-steps" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="mi-stepdot" aria-hidden="true">{i < at ? Ico.check : i + 1}</span>
          <span>{s}<span className="sr-only">{i < at ? ', done' : i === at ? ', current step' : ''}</span></span>
        </li>
      ))}
    </ol>
  );
}
function ImportHead({ at, kindLabel }: { at: number; kindLabel?: string }) {
  const { user } = useSession();
  const where = user?.workingInName || user?.store?.name || user?.companyName || '';
  return <Head line={[where, kindLabel || 'Menu import'].filter(Boolean).join(' · ')} title="Import a Menu" pills={<Steps at={at} />} />;
}
const SampleTag = () => <span className="mi-tag sample" title="The demo reads a made-up sample menu.">Sample Menu</span>;

/* ------------------------------------------------------------------ 1 · Upload (607:813) */
type Pending = { key: string; name: string; size: number; pct: number; error?: string };
function Upload({ state, onState }: { state: State | null; onState?: (s: State) => void }) {
  const { user } = useSession();
  const demo = !!user?.demo;
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind>(state?.import.kind || 'food');
  const [imp, setImp] = useState<State | null>(state);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setImp(state); if (state) setKind(state.import.kind); }, [state]);
  const files = imp?.import.files || [];
  const pages = files.reduce((n, f) => n + (f.pages || 0), 0);
  const kindMeta = KINDS.find((k) => k.key === kind)!;
  const one = kind === 'food' ? 'Food Book' : kind === 'wine' ? 'Wine List' : 'Cocktail List';

  /** The import this upload belongs to (made with the first file). */
  const ensure = async (): Promise<State> => {
    if (imp) return imp;
    const s = await api<State>('/api/imports', { method: 'POST', body: { kind } });
    setImp(s);
    // the address follows the new import without remounting this screen (an upload may be under way)
    window.history.replaceState(window.history.state, '', `/import/${s.import.id}`);
    return s;
  };
  const pickKind = async (k: Kind) => {
    setError('');
    if (demo && k !== 'food') { setError('The demo’s sample menu is a Food Book. Pick Food Book to try it.'); return; }
    setKind(k);
    if (imp) { try { setImp(await api<State>(`/api/imports/${imp.import.id}`, { method: 'PATCH', body: { kind: k } })); } catch (e) { setError((e as Error).message); } }
  };
  const addFiles = async (list: FileList | File[]) => {
    setError('');
    let s: State;
    try { s = await ensure(); } catch (e) { setError((e as Error).message); return; }
    for (const f of [...list]) {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      setPending((p) => [...p, { key, name: f.name, size: f.size, pct: 0 }]);
      try {
        const out = await sendFile(s.import.id, f, (pct) => setPending((p) => p.map((x) => (x.key === key ? { ...x, pct } : x))));
        setImp(out); s = out;
        setPending((p) => p.filter((x) => x.key !== key));
      } catch (e) { setPending((p) => p.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x))); }
    }
  };
  const remove = async (n: number) => { if (!imp) return; try { setImp(await api<State>(`/api/imports/${imp.import.id}/files/${n}`, { method: 'DELETE' })); } catch (e) { setError((e as Error).message); } };
  const useSample = async () => { setBusy(true); try { await ensure(); } catch (e) { setError((e as Error).message); } setBusy(false); };
  const read = async () => {
    if (!imp) return;
    setBusy(true); setError('');
    try {
      const s = await api<State>(`/api/imports/${imp.import.id}/read`, { method: 'POST', body: {} });
      if (onState) onState(s); else nav(`/import/${imp.import.id}`, { replace: true });
    }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const failed = imp?.import.status === 'failed' ? imp.import.error : null;
  return (
    <div className="prp mi">
      <ImportHead at={0} />
      <div className="mi-cols">
        <section className="prp-card mi-upload" aria-labelledby="mi-kind-title">
          {failed && <div className="mi-alert" role="alert"><span aria-hidden="true">{Ico.warn}</span><div><strong>We couldn’t read it this time.</strong><p>{failed}</p></div></div>}
          <p className="prp-kicker">Step 1 of 2</p>
          <h2 id="mi-kind-title">What are you importing?</h2>
          <div className="mi-kinds" role="radiogroup" aria-labelledby="mi-kind-title">
            {KINDS.map((k) => (
              <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} className={'mi-kind' + (kind === k.key ? ' on' : '')} onClick={() => void pickKind(k.key)}
                disabled={!!imp && !['uploaded', 'failed'].includes(imp.import.status)}>
                <span className="mi-kind-top"><span className="mi-kind-ico">{k.icon}</span><span className="mi-radio" aria-hidden="true">{kind === k.key && Ico.check}</span></span>
                <strong>{k.title}</strong>
                <span className="mi-kind-line">{k.line}</span>
              </button>
            ))}
          </div>
          <p className="prp-kicker mi-gap">Step 2 of 2</p>
          <h2>Add your {one}</h2>
          {demo ? (
            <div className="mi-drop sample">
              <span className="mi-drop-ico" aria-hidden="true">{kindMeta.icon}</span>
              <strong>The demo reads a sample menu</strong>
              <p>A made-up {one.toLowerCase()} with new dishes, a few price changes and two dishes left off, so you can try every step. Nothing is uploaded, and it all goes when the demo ends.</p>
              {!imp && <button type="button" className="prp-btn" onClick={() => void useSample()} disabled={busy}>Use the Sample Menu</button>}
            </div>
          ) : (
            <div className={'mi-drop' + (drag ? ' drag' : '')} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}>
              <span className="mi-drop-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 13V3.5M6 7l4-4 4 4M3.5 12.5v3a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              <strong>Drop files here, or choose them</strong>
              <p>A PDF, or photos of the pages (JPG, PNG, HEIC). Add as many as the menu needs.</p>
              <button type="button" className="prp-btn" onClick={() => input.current?.click()}>Choose Files</button>
              <input ref={input} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic" className="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ''; }} />
            </div>
          )}
          {(files.length > 0 || pending.length > 0) && (
            <ul className="mi-files">
              {files.map((f) => (
                <li key={f.n}>
                  <span className={'mi-ftype' + (f.mime === 'application/pdf' ? ' pdf' : ' img')} aria-hidden="true">{f.mime === 'application/pdf' ? 'PDF' : 'JPG'}</span>
                  <span className="mi-fname"><strong>{f.name}</strong><span>{f.sample ? `${plural(f.pages, 'page', 'pages')} · made-up sample` : `${f.mime === 'application/pdf' ? plural(f.pages, 'page', 'pages') : '1 photo'} · ${sizeText(f.size)}`}</span></span>
                  {f.sample ? <SampleTag /> : <span className="mi-tag good">Ready</span>}
                  {!f.sample && <button type="button" className="mi-textbtn" onClick={() => void remove(f.n)} aria-label={`Remove ${f.name}`}>Remove</button>}
                </li>
              ))}
              {pending.map((f) => (
                <li key={f.key}>
                  <span className="mi-ftype" aria-hidden="true">…</span>
                  <span className="mi-fname"><strong>{f.name}</strong><span>{f.error ? <span className="mi-err">{f.error}</span> : `Uploading · ${f.pct}%`}</span></span>
                  {f.error ? <button type="button" className="mi-textbtn" onClick={() => setPending((p) => p.filter((x) => x.key !== f.key))}>Remove</button> : <span className="mi-tag">Uploading</span>}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="mi-err" role="alert">{error}</p>}
          <div className="mi-upfoot">
            <div><strong>{files.length ? `${plural(pages, 'page', 'pages')} ready to read` : 'Nothing added yet'}</strong><p>Nothing changes in your book until you approve it.</p></div>
            <button type="button" className="prp-btn dark" disabled={!files.length || busy || pending.some((x) => !x.error)} onClick={() => void read()}>{failed ? 'Read It Again' : 'Read It'}</button>
          </div>
        </section>
        <aside className="mi-side" aria-label="How it works">
          <section className="prp-card mi-next">
            <p className="prp-kicker">What happens next</p>
            <ol>
              <li><span className="mi-num" aria-hidden="true">1</span><div><strong>We read every page</strong><p>Each {kind === 'food' ? 'dish comes out with its name, course, price, description, ingredients and allergens' : kind === 'wine' ? 'wine comes out with its grape, region and prices' : 'drink comes out with its spec, glass, garnish and price'}.</p></div></li>
              <li><span className="mi-num" aria-hidden="true">2</span><div><strong>You check each one</strong><p>New, changed and unchanged {kindMeta.key === 'food' ? 'dishes' : kind === 'wine' ? 'wines' : 'drinks'} are marked.{kind === 'food' ? ' Allergens always need your OK.' : ''}</p></div></li>
              <li><span className="mi-num" aria-hidden="true">3</span><div><strong>It goes where it belongs</strong><p>{kind === 'food' ? 'Approved dishes go to the Food Matrix, the Allergen Guide, search and quizzes.' : kind === 'wine' ? 'Approved wines go to the wine list, their pages, search and quizzes.' : 'Approved drinks go to the cocktail list, specs, search and quizzes.'}</p></div></li>
            </ol>
          </section>
          {kind === 'food' && (
            <section className="mi-darkcard">
              <p className="prp-kicker">Allergens</p>
              <h3>A manager confirms every allergen</h3>
              <p>Each one shows the line it came from on your page. A dish can’t go live until its allergens are confirmed.</p>
            </section>
          )}
          <section className="mi-tips">
            <p className="prp-kicker">For a clean read</p>
            <ul><li>One menu type per import</li><li>Flat, well-lit photos, one page each</li><li>Prices{kind === 'food' ? ' and allergens' : ''} printed on the page help most</li></ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
function sendFile(id: number, file: File, onPct: (n: number) => void): Promise<State> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/imports/${id}/files`);
    xhr.setRequestHeader('Content-Type', file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.hei[cf]$/i.test(file.name) ? 'image/heic' : 'application/octet-stream'));
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-BT', '1');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data: State & { error?: string };
      try { data = JSON.parse(xhr.responseText); } catch { data = { error: 'That file didn’t upload. Try again.' } as never; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new ApiError(xhr.status, data.error || 'That file didn’t upload. Try again.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'The upload stopped. Check your connection and try again.'));
    xhr.send(file);
  });
}

/* ------------------------------------------------------------------ 2 · Read: "the menu comes to life" (658:803…) */
function Reading({ state, onState }: { state: State; onState: (s: State) => void }) {
  const { user } = useSession();
  const pr = state.progress || { found: 0, page: 1, pages: state.import.pages, note: 'Reading the pages', latest: [] };
  const pages = Math.max(pr.pages || 0, pr.page, 1);
  const latest = pr.latest;
  const onPage = latest.filter((x) => x.page === pr.page).slice(-4);
  const newest = latest[latest.length - 1];
  const stack = latest.slice(-3).reverse();
  const [cancelling, setCancelling] = useState(false);
  const cancel = async () => {
    if (!window.confirm('Stop reading this menu? Your files stay here, so you can read it again.')) return;
    setCancelling(true);
    try { onState(await api<State>(`/api/imports/${state.import.id}/cancel`, { method: 'POST', body: {} })); } catch { setCancelling(false); }
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') void cancel(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const name = state.import.title || state.import.files[0]?.name?.replace(/\.[a-z0-9]+$/i, '') || state.import.kindLabel;
  const many = state.import.many;
  const section = onPage[0]?.section || newest?.section || '';
  return (
    <div className="prp mi">
      <ImportHead at={1} kindLabel={state.import.kindLabel} />
      <section className="mi-reading" aria-labelledby="mi-read-title">
        <div className="mi-read-head">
          <div>
            <p className="prp-kicker">Reading · {name}</p>
            <h2 id="mi-read-title">{pr.pages > 1 ? `Reading page ${Math.min(pr.page, pages)} of ${pages}` : 'Reading your menu'}</h2>
            <p className="mi-read-note"><span className="mi-pulse" aria-hidden="true" /><span key={pr.note} className="mi-swap">{pr.note}</span></p>
          </div>
          <button type="button" className="prp-btn ghostdark" onClick={() => void cancel()} disabled={cancelling}>Cancel</button>
        </div>
        <div className="mi-segs" role="progressbar" aria-label="Pages read" aria-valuemin={0} aria-valuemax={pages} aria-valuenow={Math.max(0, pr.page - 1)}>
          {Array.from({ length: pages }, (_, i) => <span key={i} className={i + 1 < pr.page ? 'full' : i + 1 === pr.page ? 'part' : ''} />)}
        </div>
        <p className="sr-only" aria-live="polite">{`Page ${pr.page} of ${pages}. ${plural(pr.found, state.import.one, many)} found.`}</p>
        <div className="mi-read-body">
          <div className="mi-paper" aria-hidden="true">
            <p className="mi-paper-store">{user?.store?.name || ''}</p>
            <p className="mi-paper-title">{name}</p>
            {section ? <p className="mi-paper-section">{section}</p> : <span className="mi-skel w40" />}
            <div className="mi-paper-items">
              {onPage.length ? onPage.map((x) => (
                <div key={x.name} className={'mi-paper-item' + (x === newest ? ' hot' : ' read')}>
                  <div className="mi-paper-row"><strong>{x.name}</strong><span>{x.price}</span></div>
                  {x.description && <p>{x.description}</p>}
                </div>
              )) : [0, 1, 2, 3].map((i) => <div key={i} className="mi-paper-item"><span className="mi-skel w70" /><span className="mi-skel w90" /></div>)}
            </div>
            <span className="mi-scan" />
            <p className="mi-paper-no">{pr.page}</p>
          </div>
          <div className="mi-found">
            <div className="mi-found-head">
              <div><p className="prp-kicker">Found so far</p><h3>{plural(pr.found, state.import.one, many)} found</h3></div>
              {state.import.demo && <span className="mi-tag sample dark">Sample Menu</span>}
            </div>
            <div className="mi-stack">
              {stack.length === 0 && <div className="mi-landing">The first {state.import.one} lands here</div>}
              {stack.map((x, i) => (
                <div key={x.name} className={'mi-card-dark' + (i === 0 ? ' fly' : '')} style={{ zIndex: 3 - i }}>
                  <p className="mi-card-kicker">{x.section}</p>
                  <div className="mi-card-row"><strong>{x.name}</strong>{x.price && <span>${x.price}</span>}</div>
                  {x.allergens.length > 0 && <div className="mi-card-tags">{x.allergens.map((a) => <span key={a} className="mi-dash">{a}</span>)}<span className="mi-confirm">Confirm</span></div>}
                </div>
              ))}
              {pr.found > 3 && <p className="mi-more">and {pr.found - 3} more</p>}
            </div>
          </div>
        </div>
        <div className="mi-read-foot">
          <p>You can leave this page. It keeps reading, and it’ll be here when you come back to Import a Menu.</p>
          <p className="is-muted">Nothing is added to your book until you approve it.</p>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ 3 · Review (607:1060) */
type Filter = 'all' | 'needsYou' | 'ready' | 'approved' | 'new' | 'updated' | 'unchanged' | 'skipped' | 'missing';
const needsYou = (i: Item) => i.decision === 'pending' && (!i.allergensOk || !i.priceOk);
const ready = (i: Item) => i.decision === 'pending' && i.allergensOk && i.priceOk;
function Review({ state, onState }: { state: State; onState: (s: State) => void }) {
  const nav = useNavigate();
  const imp = state.import;
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<number>>(() => new Set(state.items.filter(needsYou).slice(0, 2).map((i) => i.id)));
  const [sel, setSel] = useState<number | null>(() => state.items.find(needsYou)?.id ?? state.items[0]?.id ?? null);
  const [toast, setToast] = useState('');
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const act = async (it: Item | null, path: string, body: unknown = {}, msg?: string) => {
    setErrors((e) => (it ? { ...e, [it.id]: '' } : e));
    try {
      const s = await api<State>(`/api/imports/${imp.id}/${path}`, { method: path.endsWith('/edit') ? 'PATCH' : 'POST', body });
      onState(s);
      if (msg) setToast(msg);
      return s;
    } catch (e) { if (it) setErrors((x) => ({ ...x, [it.id]: (e as Error).message })); else setToast((e as Error).message); return null; }
  };
  const items = state.items;
  const real = items.filter((i) => i.status !== 'missing');
  const missing = items.filter((i) => i.status === 'missing');
  const shown = (i: Item) => filter === 'all' ? i.status !== 'missing' : filter === 'needsYou' ? needsYou(i) : filter === 'ready' ? ready(i)
    : filter === 'approved' ? i.decision === 'approved' : filter === 'skipped' ? i.decision === 'skipped' : filter === 'missing' ? i.status === 'missing' : i.status === filter;
  const groups = useMemo(() => {
    const out: { name: string; items: Item[]; pages: number[] }[] = [];
    for (const it of real) {
      let g = out.find((x) => x.name === it.group);
      if (!g) out.push((g = { name: it.group, items: [], pages: [] }));
      g.items.push(it);
      if (it.page && !g.pages.includes(it.page)) g.pages.push(it.page);
    }
    return out;
  }, [real]);
  const c = state.counts;
  const confirmedReady = c.ready;
  const chips: [Filter, string, number][] = [['all', 'All', c.all], ['needsYou', 'Needs You', c.needsYou], ['ready', 'Ready', c.ready], ['approved', 'Approved', c.approved], ['new', 'New', c.new],
    ['updated', 'Updated', c.updated], ['unchanged', 'Unchanged', c.unchanged], ['skipped', 'Skipped', c.skipped], ...(c.missing ? [['missing', 'Not in This File', c.missing] as [Filter, string, number]] : [])];
  const toggle = (id: number, on?: boolean) => setOpen((o) => { const n = new Set(o); if (on ?? !n.has(id)) n.add(id); else n.delete(id); return n; });
  const selected = items.find((i) => i.id === sel) || null;
  const approveAll = async () => { setBusy(true); const s = await act(null, 'approve-confirmed'); setBusy(false); if (s) setToast(`${plural(s.approvedNow || 0, imp.one, imp.many)} approved`); };
  const finish = async () => { setBusy(true); const s = await act(null, 'finish'); setBusy(false); if (s) window.scrollTo({ top: 0 }); };
  const title = imp.title || imp.kindLabel;
  return (
    <div className="prp mi">
      <ImportHead at={2} kindLabel={imp.kindLabel} />
      <section className="prp-card mi-sum" aria-labelledby="mi-sum-title">
        <div className="mi-sum-top">
          <div className="mi-sum-text">
            <h2 id="mi-sum-title">{plural(c.all, imp.one, imp.many)} found in {title} {imp.demo && <SampleTag />}</h2>
            <p>Approve what’s right, fix what isn’t, skip what doesn’t belong. Nothing goes to staff until you approve it.</p>
          </div>
          <div className="mi-sum-act">
            <div className="mi-meter"><strong>{c.approved} of {c.all - c.unchanged} approved</strong><span className="bar" aria-hidden="true"><i style={{ width: `${(c.approved / Math.max(1, c.all - c.unchanged)) * 100}%` }} /></span></div>
            <button type="button" className="prp-btn dark" disabled={!confirmedReady || busy} onClick={() => void approveAll()}>Approve All Confirmed ({confirmedReady})</button>
          </div>
        </div>
        <div className="mi-chips" role="group" aria-label="Show">
          {chips.map(([k, label, n]) => <button key={k} type="button" className={'prp-chip' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label} {n}</button>)}
        </div>
      </section>
      <div className="mi-review">
        <div className="mi-groups">
          {filter !== 'missing' && groups.map((g) => {
            const list = g.items.filter(shown);
            if (!list.length) return null;
            return (
              <section key={g.name} className="mi-group" aria-label={g.name}>
                <header className="mi-group-head"><h3>{g.name} <span>{plural(g.items.length, imp.one, imp.many)}</span></h3><span className="mi-group-pages">{pagesText(g.pages.sort((a, b) => a - b))}</span></header>
                {list.map((it) => open.has(it.id) && it.decision === 'pending'
                  ? <ItemCard key={it.id} it={it} state={state} act={act} error={errors[it.id]} onSelect={() => setSel(it.id)} onClose={() => toggle(it.id, false)} selected={sel === it.id} />
                  : <ItemRow key={it.id} it={it} imp={imp} act={act} onOpen={() => { toggle(it.id, true); setSel(it.id); }} onSelect={() => setSel(it.id)} selected={sel === it.id} error={errors[it.id]} />)}
              </section>
            );
          })}
          {(filter === 'all' || filter === 'missing') && missing.length > 0 && (
            <section className="mi-group" aria-label="Not in this file">
              <header className="mi-group-head"><h3>Not in This File <span>{plural(missing.length, imp.one, imp.many)}</span></h3></header>
              <p className="mi-group-note">In your book, but not on this menu. They stay in your book unless you archive them.</p>
              {missing.map((it) => (
                <div key={it.id} className="mi-row">
                  <span className={'mi-state ' + (it.decision === 'archived' ? 'st-skip' : 'st-same')} aria-hidden="true" />
                  <div className="mi-row-main"><strong className={it.decision === 'archived' ? 'struck' : ''}>{it.name}</strong><span className="mi-meta">{String(it.data[Object.keys(it.data).find((k) => k !== 'name') || ''] || '')}</span></div>
                  <div className="mi-seg" role="group" aria-label={`${it.name}: keep or archive`}>
                    <button type="button" aria-pressed={it.decision === 'keep'} className={it.decision === 'keep' ? 'on' : ''} onClick={() => void act(it, `items/${it.id}/keep`, {}, `${it.name} stays in your book`)}>Keep</button>
                    <button type="button" aria-pressed={it.decision === 'archived'} className={it.decision === 'archived' ? 'on' : ''} onClick={() => void act(it, `items/${it.id}/archive`, {}, `${it.name} archived`)}>Archive</button>
                  </div>
                  {errors[it.id] && <p className="mi-err full" role="alert">{errors[it.id]}</p>}
                </div>
              ))}
            </section>
          )}
          {!items.some(shown) && <p className="prp-empty prp-card">Nothing here.</p>}
        </div>
        <SourcePanel state={state} item={selected} onPick={(id) => setSel(id)} />
      </div>
      <div className="mi-foot prp-card">
        <div><strong>{c.approved} approved · {c.ready} ready · {c.needsYou} need you · {c.skipped} skipped</strong><p>{imp.kind === 'food' ? 'Dishes' : imp.kind === 'wine' ? 'Wines' : 'Drinks'} you haven’t approved stay here, not in your book.</p></div>
        <div className="prp-row-btns">
          <button type="button" className="prp-btn" onClick={() => nav('/', { state: { toast: 'Saved. Come back to Import a Menu to finish.' } })}>Finish Later</button>
          <button type="button" className="prp-btn dark" disabled={busy} onClick={() => void finish()}>Finish Import</button>
        </div>
      </div>
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}

function StateIcon({ it }: { it: Item }) {
  if (it.decision === 'approved') return <span className="mi-state st-ok" aria-hidden="true">{Ico.check}</span>;
  if (it.decision === 'skipped') return <span className="mi-state st-skip" aria-hidden="true" />;
  if (it.decision === 'unchanged') return <span className="mi-state st-same" aria-hidden="true" />;
  if (needsYou(it)) return <span className="mi-state st-need" aria-hidden="true">!</span>;
  return <span className="mi-state st-open" aria-hidden="true" />;
}
const Badge = ({ s }: { s: Item['status'] }) => <span className={'mi-badge ' + s}>{s === 'new' ? 'New' : s === 'updated' ? 'Updated' : 'Unchanged'}</span>;

function metaLine(it: Item, imp: State['import']) {
  const d = it.data;
  const parts: string[] = [];
  if (it.status === 'updated') { const p = it.changes.find((ch) => PRICEY.has(ch.field)); if (p) parts.push(`${p.label} ${money(p.from)} → ${money(p.to)}`); else parts.push(it.changes.map((ch) => ch.label).join(', ') + ' changed'); }
  else if (d.price || d.glass || d.bottle) parts.push(money(d.price || d.glass || d.bottle));
  if (imp.kind === 'food') { const a = asList(d.allergens); parts.push(a.length ? a.join(', ') + (it.decision === 'pending' && !it.allergensOk ? ' to confirm' : '') : 'no allergens listed'); }
  if (imp.kind === 'wine') parts.push([d.grape, d.region].filter(Boolean).join(', '));
  if (imp.kind === 'cocktail') parts.push(String(d.base || d.tableLine || ''));
  if (it.decision === 'approved') parts.push(`approved by ${it.decidedBy || 'you'}`);
  if (it.decision === 'unchanged') parts.push('matches your book');
  return parts.filter(Boolean).join(' · ');
}

function ItemRow({ it, imp, act, onOpen, onSelect, selected, error }: { it: Item; imp: State['import']; act: (it: Item, p: string, b?: unknown, m?: string) => Promise<State | null>; onOpen: () => void; onSelect: () => void; selected: boolean; error?: string }) {
  return (
    <div className={'mi-row' + (selected ? ' sel' : '') + (it.decision === 'skipped' ? ' dim' : '')} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) onSelect(); }}>
      <StateIcon it={it} />
      <div className="mi-row-main">
        <strong>{it.slug && it.decision === 'approved' ? <Link to={'/' + it.slug}>{it.name}</Link> : it.name}</strong>
        <span className="mi-meta"><Badge s={it.status} />{metaLine(it, imp)}</span>
      </div>
      <div className="mi-row-act">
        {it.decision === 'approved' && <><span className="mi-tag good">Approved</span><button type="button" className="mi-textbtn" onClick={() => void act(it, `items/${it.id}/undo`, {}, `${it.name} taken back out`)}>Undo</button></>}
        {it.decision === 'skipped' && <><span className="mi-tag">Skipped</span><button type="button" className="mi-textbtn" onClick={() => void act(it, `items/${it.id}/undo`)}>Undo</button></>}
        {it.decision === 'unchanged' && <span className="mi-quiet">Already in your book</span>}
        {it.decision === 'pending' && (needsYou(it)
          ? <><span className="mi-tag bad">{!it.allergensOk ? 'Confirm allergens' : 'Check the price'}</span><button type="button" className="prp-btn sm" onClick={onOpen}>Review</button></>
          : <>{imp.kind === 'food' && <span className="mi-tag good">{Ico.check}Allergens confirmed</span>}<button type="button" className="prp-btn sm" onClick={onOpen}>Edit</button>
            <button type="button" className="prp-btn sm dark" onClick={() => void act(it, `items/${it.id}/approve`, {}, `${it.name} is in your book`)}>Approve</button></>)}
      </div>
      {error && <p className="mi-err full" role="alert">{error}</p>}
    </div>
  );
}

function ItemCard({ it, state, act, error, onSelect, onClose, selected }: { it: Item; state: State; act: (it: Item, p: string, b?: unknown, m?: string) => Promise<State | null>; error?: string; onSelect: () => void; onClose: () => void; selected: boolean }) {
  const imp = state.import;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(it.data);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>(asList(it.data.allergens));
  const [price, setPrice] = useState(String(it.data.price ?? ''));
  useEffect(() => { setDraft(it.data); setPicked(asList(it.data.allergens)); setPrice(String(it.data.price ?? '')); }, [it]);
  const src = it.source.allergens || [];
  const blocked = !it.allergensOk || !it.priceOk;
  const save = async () => {
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) if (JSON.stringify(v) !== JSON.stringify(it.data[k])) changes[k] = v;
    if (Object.keys(changes).length) { const s = await act(it, `items/${it.id}/edit`, { data: changes }, 'Saved'); if (!s) return; }
    setEditing(false);
  };
  const fields = FIELDS[imp.kind];
  return (
    <article className={'mi-card' + (selected ? ' sel' : '')} aria-labelledby={`mi-it-${it.id}`} onFocus={onSelect} onClick={onSelect}>
      <header className="mi-card-head">
        <h4 id={`mi-it-${it.id}`}>{it.name} <Badge s={it.status} />{it.page && <span className="mi-pageref">Page {it.page}</span>}</h4>
        <div className="prp-row-btns">
          <button type="button" className="mi-textbtn" onClick={() => void act(it, `items/${it.id}/skip`, {}, `${it.name} skipped`)}>Skip</button>
          <button type="button" className="prp-btn sm" aria-pressed={editing} onClick={() => (editing ? void save() : setEditing(true))}>{editing ? 'Save' : 'Edit'}</button>
          <button type="button" className="mi-x" aria-label={`Close ${it.name}`} onClick={onClose}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        </div>
      </header>
      {it.status === 'updated' && it.changes.length > 0 && (
        <div className="mi-changes">
          <p className="prp-kicker">What changes in your book</p>
          <dl>{it.changes.map((ch) => <ChangeRow key={ch.field} ch={ch} />)}</dl>
        </div>
      )}
      <dl className="mi-fields">
        {editing && <Field label="Name"><input value={String(draft.name ?? '')} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" /></Field>}
        {fields.map(([k, label]) => {
          const v = (editing ? draft : it.data)[k];
          if (!editing && (v === '' || v == null || (Array.isArray(v) && !v.length))) return null;
          if (k === 'price' && !it.priceOk && !editing) return (
            <Field key={k} label={label}>
              <div className="mi-check">
                <input className="mi-amber" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price" aria-describedby={`mi-pr-${it.id}`} />
                <span className="mi-tag warn">Check This</span>
                <button type="button" className="prp-btn sm" onClick={() => void act(it, `items/${it.id}/price`, { price }, 'Price checked')}>{price === String(it.data.price ?? '') ? `Keep ${money(price)}` : 'Use This Price'}</button>
              </div>
              <p className="mi-hint" id={`mi-pr-${it.id}`}>The price was hard to read on the page{it.source.priceText ? ` (it looked like ${money(it.source.priceText)})` : ''}. Type the right one, or keep it.</p>
            </Field>
          );
          if (editing) return <Field key={k} label={label}><EditInput k={k} v={v} options={state.options[k]} onChange={(x) => setDraft({ ...draft, [k]: x })} /></Field>;
          if (k === 'ingredients') return <Field key={k} label={label}><div className="mi-chipset">{asList(v).map((x) => <span key={x} className="mi-ing">{x}</span>)}</div></Field>;
          if (k === 'build') return <Field key={k} label={label}><div className="mi-spec">{asList(v).map((x) => <span key={x}>{x}</span>)}</div></Field>;
          return <Field key={k} label={label}>{show(k, v)}</Field>;
        })}
      </dl>
      {it.source.lines?.length ? <div className="mi-fromline"><p className="prp-kicker">From your page{it.page ? ` · page ${it.page}` : ''}</p><q>{it.source.lines.join(' · ')}</q></div> : null}
      {imp.kind === 'food' && (it.allergensOk ? (
        <div className="mi-alg is-ok">
          <p><span aria-hidden="true">{Ico.check}</span> Allergens confirmed: {asList(it.data.allergens).join(', ') || 'none'}</p>
          <button type="button" className="mi-textbtn" onClick={() => setPicking(true)}>Change Allergens</button>
          {picking && <AllergenPicker list={state.allergenList} picked={picked} setPicked={setPicked} onSave={async () => { if (await act(it, `items/${it.id}/confirm`, { allergens: picked }, 'Allergens confirmed')) setPicking(false); }} onCancel={() => setPicking(false)} />}
        </div>
      ) : (
        <div className="mi-alg" role="group" aria-labelledby={`mi-alg-${it.id}`}>
          <p className="mi-alg-head" id={`mi-alg-${it.id}`}><span className="mi-state st-need sm" aria-hidden="true">!</span>Allergens · Please confirm</p>
          {src.length ? (
            <ul>{src.map((a) => (
              <li key={a.name}>
                <span className="mi-algpill">{a.name}</span>
                <span className="mi-algsrc">{a.printed ? <><q>{a.quote}</q><span className="mi-algnote">Printed on the page</span></> : <>From <q>{a.quote}</q><span className="mi-algnote red">Not printed on the page. Read from the ingredients.</span></>}</span>
              </li>
            ))}</ul>
          ) : <p className="mi-hint">No allergens were found on the page. Confirm there are none, or add them.</p>}
          {picking ? <AllergenPicker list={state.allergenList} picked={picked} setPicked={setPicked} onSave={async () => { if (await act(it, `items/${it.id}/confirm`, { allergens: picked }, 'Allergens confirmed')) setPicking(false); }} onCancel={() => setPicking(false)} />
            : <div className="prp-row-btns"><button type="button" className="prp-btn sm dark" onClick={() => void act(it, `items/${it.id}/confirm`, { allergens: asList(it.data.allergens) }, 'Allergens confirmed')}>Confirm Allergens</button>
              <button type="button" className="prp-btn sm" onClick={() => setPicking(true)}>Change Allergens</button></div>}
        </div>
      ))}
      {error && <p className="mi-err" role="alert">{error}</p>}
      <footer className="mi-card-foot">
        {blocked && <span className="mi-hint">{!it.allergensOk ? 'Confirm allergens to approve' : 'Check the price to approve'}</span>}
        <button type="button" className={'prp-btn sm' + (blocked ? ' locked' : ' dark')} disabled={blocked || editing} onClick={() => void act(it, `items/${it.id}/approve`, {}, `${it.name} is in your book`)}>
          {blocked && <span aria-hidden="true">{Ico.lock}</span>}Approve
        </button>
      </footer>
    </article>
  );
}
const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className="mi-field"><dt>{label}</dt><dd>{children}</dd></div>;
function ChangeRow({ ch }: { ch: Change }) {
  if (Array.isArray(ch.to)) {
    const from = new Set(asList(ch.from).map((x) => x.toLowerCase())), to = asList(ch.to);
    const added = to.filter((x) => !from.has(x.toLowerCase())), gone = asList(ch.from).filter((x) => !to.some((y) => y.toLowerCase() === x.toLowerCase()));
    return <div className="mi-change"><dt>{ch.label}</dt><dd>{added.map((x) => <b key={x}>+ {x} </b>)}{gone.map((x) => <s key={x}>− {x} </s>)}</dd></div>;
  }
  const f = (v: unknown) => (PRICEY.has(ch.field) ? money(v) : String(v ?? '') || 'empty');
  return <div className="mi-change"><dt>{ch.label}</dt><dd><s>{f(ch.from)}</s><span aria-hidden="true"> → </span><span className="sr-only"> becomes </span><b>{f(ch.to)}</b></dd></div>;
}
function EditInput({ k, v, options, onChange }: { k: string; v: unknown; options?: string[]; onChange: (v: unknown) => void }) {
  if (options) return <select value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} aria-label={k}>{options.map((o) => <option key={o}>{o}</option>)}</select>;
  if (k === 'ingredients') return <textarea rows={3} value={asList(v).join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} aria-label="Ingredients, one per line" />;
  if (k === 'build') return <textarea rows={4} value={asList(v).join('\n')} onChange={(e) => onChange(e.target.value.split('\n').map((l) => { const m = /^([\d./¼½¾⅓⅔\s]*(?:oz|ml|dash(?:es)?|barspoons?|tsp|cl)?\.?)\s+(.*)$/i.exec(l.trim()); return m ? { amount: m[1].trim(), ingredient: m[2] } : { amount: '', ingredient: l.trim() }; }))} aria-label="Spec, one line each" />;
  if (k === 'description' || k === 'notes') return <textarea rows={3} value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} aria-label={k} />;
  return <input value={String(v ?? '')} inputMode={PRICEY.has(k) ? 'decimal' : undefined} onChange={(e) => onChange(e.target.value)} aria-label={k} />;
}
function AllergenPicker({ list, picked, setPicked, onSave, onCancel }: { list: string[]; picked: string[]; setPicked: (x: string[]) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="mi-picker">
      <div className="prp-chips" role="group" aria-label="Allergens">
        {list.map((a) => <button key={a} type="button" aria-pressed={picked.includes(a)} className={'prp-chip' + (picked.includes(a) ? ' on' : '')} onClick={() => setPicked(picked.includes(a) ? picked.filter((x) => x !== a) : [...picked, a])}>{a}</button>)}
      </div>
      <div className="prp-row-btns"><button type="button" className="prp-btn sm dark" onClick={onSave}>Confirm These</button><button type="button" className="mi-textbtn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

/** "Your page": the page the item came from, set out the way it was read, with the item's lines highlighted. */
function SourcePanel({ state, item, onPick }: { state: State; item: Item | null; onPick: (id: number) => void }) {
  const imp = state.import;
  const pages = [...new Set(state.items.filter((i) => i.page).map((i) => i.page as number))].sort((a, b) => a - b);
  const page = item?.page || pages[0] || 1;
  const on = state.items.filter((i) => i.page === page);
  const at = pages.indexOf(page);
  // which file the page is in, for "Open the Original"
  let n = 0, file: FileRow | undefined;
  for (const f of imp.files) { if (page <= n + (f.pages || 1)) { file = f; break; } n += f.pages || 1; }
  const go = (d: number) => { const p = pages[at + d]; const first = state.items.find((i) => i.page === p); if (first) onPick(first.id); };
  return (
    <aside className="mi-source prp-card" aria-label="Your page">
      <div className="mi-source-head">
        <div><p className="prp-kicker">Your page · {page} of {Math.max(imp.pages, pages[pages.length - 1] || 1)}</p><strong>{file?.name || imp.title}</strong></div>
        <div className="prp-row-btns">
          <button type="button" className="mi-round" aria-label="Previous page" disabled={at <= 0} onClick={() => go(-1)}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <button type="button" className="mi-round" aria-label="Next page" disabled={at >= pages.length - 1} onClick={() => go(1)}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6 4.5 9.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>
      </div>
      <div className="mi-sheet">
        <div className="mi-sheet-page">
          <p className="mi-sheet-h">{on[0]?.source.section || on[0]?.group || ''}</p>
          {on.map((i) => (
            <button key={i.id} type="button" className={'mi-sheet-item' + (item?.id === i.id ? ' hot' : '')} onClick={() => onPick(i.id)} aria-label={`${i.name}, show it`}>
              <span className="mi-sheet-row"><b>{i.name.toUpperCase()}</b><span className={i.source.priceUnclear ? 'unclear' : ''}>{i.source.priceText || String(i.data.price ?? '')}</span></span>
              {(i.source.lines || []).slice(1, 3).map((l, k) => <span key={k} className={/^contains\b/i.test(l) ? 'contains' : 'desc'}>{l}</span>)}
            </button>
          ))}
          <p className="mi-sheet-no">{page}</p>
        </div>
      </div>
      {item?.source.lines?.length ? (
        <div className="mi-matched"><p className="prp-kicker">Matched to {item.name}</p><q>{item.source.lines.slice(1).join(' · ') || item.source.lines[0]}</q></div>
      ) : null}
      <p className="mi-legend"><span className="mi-dashbox" aria-hidden="true" /> Dashed = hard to read.{imp.demo ? ' This is the sample menu, set out as it was read.' : ' Set out as it was read.'}</p>
      {file && !file.sample && <a className="prp-link" href={`/api/imports/${imp.id}/files/${file.n}`} target="_blank" rel="noopener">Open the Original {Ico.arrow}</a>}
    </aside>
  );
}

/* ------------------------------------------------------------------ 4 · Done (607:1185) */
function Done({ state, onState }: { state: State; onState: (s: State) => void }) {
  const imp = state.import;
  const s = state.summary!;
  const nav = useNavigate();
  const [toast, setToast] = useState('');
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const post = async (path: string, body: unknown = {}, msg?: string) => {
    try { const out = await api<State>(`/api/imports/${imp.id}/${path}`, { method: 'POST', body }); onState(out); if (msg) setToast(msg); return out; }
    catch (e) { setToast((e as Error).message); return null; }
  };
  const undone = imp.status === 'undone';
  const inBook = s.added + s.updated;
  const many = imp.many, One = cap(imp.one);
  const where: { kicker: string; title: string; body: string; to?: string; link?: string; onClick?: () => void; muted?: boolean }[] = [];
  const listPage = imp.kind === 'food' ? ['Food Matrix', '/food-matrix'] : imp.kind === 'wine' ? ['Wine List', '/the-bar/wine'] : ['Cocktails', '/the-bar/cocktails'];
  where.push({ kicker: listPage[0], title: `${s.added} added · ${s.updated} updated`, body: s.groups.length ? `${s.groups.join(', ')}. ${imp.kind === 'food' ? 'Prices and descriptions follow your menu.' : 'Prices follow your list.'}` : `Nothing approved yet.`, to: listPage[1], link: `Open ${listPage[0]}` });
  if (imp.kind === 'food') where.push({ kicker: 'Allergen Guide', title: plural(s.allergenDishes, 'dish', 'dishes'), body: 'Every allergen on these dishes was confirmed by a manager against the page it came from.', to: '/allergen-guide', link: 'Open Allergen Guide' });
  else if (imp.kind === 'cocktail') where.push({ kicker: 'Cocktail Specs', title: plural(s.added + s.updated, 'drink', 'drinks'), body: 'Approved specs show on the Cocktail Specs cards.', to: '/the-bar/cocktail-specs', link: 'Open Cocktail Specs' });
  where.push({ kicker: `${One} pages`, title: plural(s.newPages.length, 'new page', 'new pages'), body: `Each new ${imp.one} opens its own page. Photos${imp.kind === 'food' ? ', stations and pairings' : ''} stay empty until you add them in Edit Mode.`, to: s.newPages[0] ? '/' + s.newPages[0].slug : undefined, link: 'See New Pages' });
  where.push({ kicker: 'Search', title: plural(s.added + s.updated, imp.one, many), body: `Staff can find every approved ${imp.one} by name${imp.kind === 'food' ? ', ingredient or allergen' : ''}.` });
  where.push({ kicker: 'Quizzes', title: plural(s.questions, 'question', 'questions'), body: 'Written by rules from your approved data: prices, courses, ingredients and allergens. Nothing in a quiz comes from the AI.', to: '/quizzes', link: 'Open Quizzes' });
  if (s.skipped) where.push({ kicker: 'Skipped', title: s.skippedNames.slice(0, 2).join(', ') + (s.skippedNames.length > 2 ? ` and ${s.skippedNames.length - 2} more` : ''), body: 'Not added. It stays with this import, so you can bring it in later.', onClick: () => void post('reopen'), link: 'Review It Again', muted: true });
  const drafts = s.drafts;
  const ONE: Record<string, [string, string]> = { sellingLine: ['selling line', 'selling lines'], say: ['say-it line', 'say-it lines'], talkingPoints: ['talking point', 'talking points'] };
  const counts = new Map<string, number>(); for (const d of drafts) counts.set(d.field, (counts.get(d.field) || 0) + (d.field === 'talkingPoints' ? d.text.split('\n').length : 1));
  const shown = all ? drafts : drafts.slice(0, 4);
  const undo = async () => {
    if (!window.confirm(`Undo this import? The ${plural(s.added, 'new ' + imp.one, 'new ' + many)} will be archived and ${plural(s.updated, 'updated one goes', 'updated ones go')} back the way ${s.updated === 1 ? 'it was' : 'they were'}. Nothing is deleted.`)) return;
    setBusy(true); await post('undo', {}, 'Import undone'); setBusy(false);
  };
  return (
    <div className="prp mi">
      <ImportHead at={4} kindLabel={imp.kindLabel} />
      {undone ? (
        <section className="mi-donehero" aria-labelledby="mi-done-title">
          <div><p className="prp-kicker">Undone · {imp.title}</p><h2 id="mi-done-title">This import was undone</h2>
            <p>{imp.undoneBy ? `By ${imp.undoneBy} · ` : ''}{when(imp.undoneAt)}. The {many} it added are archived and updated ones are back the way they were. Nothing was deleted.</p></div>
          <Link className="prp-btn ondark" to="/import/new">Import Another Menu</Link>
        </section>
      ) : (
        <section className="mi-donehero" aria-labelledby="mi-done-title">
          <div>
            <p className="prp-kicker">Imported · {imp.title}</p>
            <h2 id="mi-done-title">{plural(inBook, imp.one, many)} {inBook === 1 ? 'is' : 'are'} in your book</h2>
            <p>{[imp.finishedBy ? `Approved by ${imp.finishedBy}` : '', when(imp.finishedAt), imp.pages ? `from ${plural(imp.pages, 'page', 'pages')}` : ''].filter(Boolean).join(' · ')}</p>
          </div>
          <dl className="mi-tiles">
            {([['added', s.added], ['updated', s.updated], ['unchanged', s.unchanged], ['skipped', s.skipped]] as [string, number][]).map(([k, n]) => <div key={k}><dt>{k}</dt><dd>{n}</dd></div>)}
          </dl>
        </section>
      )}
      {!undone && <>
        <h2 className="mi-h2">Where it went</h2>
        <p className="prp-muted">Approved {many} are live for staff now. Drafts wait for you.{s.waiting ? ` ${plural(s.waiting, imp.one, many)} you haven’t approved ${s.waiting === 1 ? 'is' : 'are'} still with this import.` : ''}</p>
        <div className={'mi-where n' + where.length}>
          {where.map((w) => (
            <section key={w.kicker} className={'prp-card mi-wcard' + (w.muted ? ' is-muted' : '')}>
              <p className="prp-kicker">{w.kicker}</p><h3>{w.title}</h3><p>{w.body}</p>
              {w.link && (w.to ? <Link className="prp-link" to={w.to}>{w.link} {Ico.arrow}</Link> : w.onClick ? <button type="button" className="prp-link mi-linkbtn" onClick={w.onClick}>{w.link} {Ico.arrow}</button> : null)}
            </section>
          ))}
        </div>
        {drafts.length > 0 && (
          <section className="mi-drafts" aria-labelledby="mi-drafts-title">
            <div className="mi-drafts-head">
              <div><h2 id="mi-drafts-title">Drafts waiting on you <span className="mi-tag draft">Draft</span></h2>
                <p>Written by AI from your menu text, so a manager checks each one. Staff don’t see a draft until it’s approved.</p></div>
              {drafts.length > 4 && <button type="button" className="prp-btn dark" onClick={() => setAll(!all)}>{all ? 'Show Fewer' : `Review All ${drafts.length} Drafts`}</button>}
            </div>
            <div className="prp-chips mi-dcounts">{[...counts].map(([f, n]) => <span key={f} className="mi-count"><b>{n}</b> {(ONE[f] || [f, f])[n === 1 ? 0 : 1]}</span>)}</div>
            <div className="mi-dgrid">
              {shown.map((d) => {
                const key = `${d.itemId}:${d.field}`;
                return (
                  <article key={key} className="mi-draft">
                    <header><strong>{d.name}</strong><span className="mi-tag draft">Draft · {d.label}</span></header>
                    {editing === key ? <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label={`${d.label} for ${d.name}`} />
                      : d.field === 'talkingPoints' ? <ul>{d.text.split('\n').map((t) => <li key={t}>{t}</li>)}</ul> : <q>{d.text}</q>}
                    <div className="prp-row-btns">
                      <button type="button" className="prp-btn sm dark" onClick={() => { void post(`items/${d.itemId}/draft`, { field: d.field, action: 'approve', ...(editing === key ? { text } : {}) }, `${d.label} added to ${d.name}`); setEditing(null); }}>Approve</button>
                      {editing !== key && <button type="button" className="prp-btn sm" onClick={() => { setEditing(key); setText(d.text); }}>Edit</button>}
                      <button type="button" className="mi-textbtn" onClick={() => void post(`items/${d.itemId}/draft`, { field: d.field, action: 'skip' })}>Skip</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
        <section className="mi-undo">
          <div><strong>Changed your mind?</strong><p>Undo archives the {plural(s.added, 'new ' + imp.one, 'new ' + many)} and puts the {plural(s.updated, 'updated one', 'updated ones')} back the way {s.updated === 1 ? 'it was' : 'they were'}. Nothing is deleted.</p></div>
          <div className="prp-row-btns">
            <button type="button" className="prp-btn" disabled={busy} onClick={() => void undo()}>Undo This Import</button>
            <button type="button" className="prp-btn dark" onClick={() => nav('/import/new')}>Import Another Menu</button>
          </div>
        </section>
      </>}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}
