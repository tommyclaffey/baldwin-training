// Edit in place (Oct 31): managers add and edit the book from the page they're on.
// Any link into the admin form (/admin/pages/<collection>/<id|new>?preset) opens that form in a panel
// over the page instead: a side panel on desktop, a bottom sheet on phones (Figma section 14).
// Saving updates the page behind it; a new entry opens its own page.
import { focusImg } from '../lib/focus';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { api, canEdit } from '../lib/api';
import { useSession } from '../lib/session';
import { PageOptions, blank, renderField, useCollections, wide, type Entry, type FieldDef } from '../admin/cms';

type Target = { col: string; id: number | null; preset: Record<string, string>; jump?: string; notice?: string; fresh?: boolean };
type LibDish = { id: number; data: Record<string, unknown>; stores: string[]; onMine: boolean };
type Shared = { library?: { id: number }; sharedWith?: string[]; storeName?: string };
type Ctx = { open: (t: Target) => void; canOpen: (col: string) => boolean };
const EditCtx = createContext<Ctx>({ open: () => {}, canOpen: () => false });
export const useEditInPlace = () => useContext(EditCtx);

/** "/admin/pages/wine/new?color=Red" → what to open. Anything else → null. */
export function parseAdminHref(href: string | null): Target | null {
  const m = /^\/admin\/pages\/([a-z]+)\/(new|\d+)(?:\?([^#]*))?(?:#(.*))?$/.exec(href || '');
  if (!m) return null;
  const preset = Object.fromEntries(new URLSearchParams(m[3] || ''));
  return { col: m[1], id: m[2] === 'new' ? null : Number(m[2]), preset, jump: m[4] ? decodeURIComponent(m[4]) : undefined };
}

/** What each page type is called in the panel's eyebrow. */
/** Where a page type is listed: an archived page goes back there. */
const LIST_OF: Record<string, string> = { recipe: '/food-matrix', house: '/the-bar/cocktails', classic: '/the-bar/cocktails', wine: '/the-bar/wine', shelf: '/the-bar/back-bar', beer: '/the-bar/beer-and-draft' };
const KIND: Record<string, string> = { recipe: 'Dish', house: 'House cocktail', classic: 'Classic cocktail', wine: 'Wine', shelf: 'Bottle', beer: 'Beer' };

export function EditInPlaceProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [target, setTarget] = useState<Target | null>(null);
  const [toast, setToast] = useState('');
  const canOpen = useCallback((col: string) => canEdit(user) && (col !== 'classic' || user!.role === 'superadmin'), [user]);
  const open = useCallback((t: Target) => { if (canOpen(t.col)) setTarget(t); }, [canOpen]);

  // Links into the admin form open the panel instead (a plain click; Cmd/Ctrl-click still opens the admin).
  useEffect(() => {
    if (!canEdit(user)) return;
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      const t = a && parseAdminHref(a.getAttribute('href'));
      if (!t || !canOpen(t.col)) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(t);
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, [user, canOpen]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); }, [toast]);

  return (
    <EditCtx.Provider value={{ open, canOpen }}>
      {children}
      {target && <EditSheet key={`${target.col}:${target.id}:${target.fresh ? 'new' : ''}`} target={target} onClose={() => setTarget(null)} onSwitch={setTarget} onSaved={(msg) => { setTarget(null); setToast(msg); }} />}
      {toast && createPortal(<div className="eip-toast" role="status"><span className="dot" aria-hidden="true" />{toast}</div>, document.body)}
    </EditCtx.Provider>
  );
}

function EditSheet({ target, onClose, onSaved, onSwitch }: { target: Target; onClose: () => void; onSaved: (msg: string) => void; onSwitch: (t: Target) => void }) {
  const { data: cols, error: colErr } = useCollections();
  const session = useSession();
  const nav = useNavigate();
  const c = cols?.collections[target.col];
  const isNew = target.id == null;
  const [entry, setEntry] = useState<Entry | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [active, setActive] = useState('');
  // The group's kitchen (dishes): adding starts by picking one the group already has; editing one asks who sees the change.
  const usesLibrary = target.col === 'recipe';
  const [lib, setLib] = useState<LibDish[] | null>(null);
  const [mode, setMode] = useState<'pick' | 'form'>(isNew && usesLibrary && !target.fresh ? 'pick' : 'form');
  const [find, setFind] = useState('');
  const [share, setShare] = useState(true);
  const [scope, setScope] = useState<'group' | 'store'>('group');
  const [adding, setAdding] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isNew) return;
    api<Entry>(`/api/entries/${target.id}`).then((e) => { setEntry(e); setData(e.data); }).catch((e) => setError(e.message));
  }, [isNew, target.id]);
  useEffect(() => {
    if (mode !== 'pick') return;
    api<{ entries: LibDish[] }>(`/api/library?collection=${target.col}`).then((r) => {
      const open = r.entries.filter((x) => !x.onMine);
      setLib(open);
      if (!open.length) setMode('form');
    }).catch(() => setMode('form'));
  }, [mode, target.col]);
  const addFromLibrary = async (d: LibDish) => {
    setAdding(d.id); setError('');
    try {
      const out = await api<Entry>('/api/entries', { method: 'POST', body: { collection: target.col, libraryId: d.id, data: { course: target.preset.course } } });
      await session.reloadIndex(); session.bump();
      nav('/' + out.slug);
      onSwitch({ col: target.col, id: out.id, preset: {}, jump: 'The basics', notice: `${String(d.data.name)} is on your menu. Set its price and station.` });
    } catch (e) { setError((e as Error).message); setAdding(0); }
  };
  useEffect(() => {
    if (!isNew || !c || data) return;
    const d = blank(c);
    for (const [k, v] of Object.entries(target.preset)) if (c.fields.some((f) => f.key === k)) d[k] = v;
    setData(d);
  }, [isNew, c, data, target.preset]);

  const sections = useMemo(() => {
    const out: { name: string; fields: FieldDef[] }[] = [];
    for (const f of c?.fields || []) {
      const name = f.section || 'Details';
      const s = out.find((x) => x.name === name) || (out.push({ name, fields: [] }), out[out.length - 1]);
      s.fields.push(f);
    }
    return out;
  }, [c]);

  const close = useCallback(() => {
    if (dirty && !confirm('Close without saving? Your changes will be lost.')) return;
    onClose();
  }, [dirty, onClose]);

  // The page behind doesn't scroll; Escape closes; focus stays in the panel.
  useEffect(() => {
    document.body.classList.add('eip-lock');
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.classList.remove('eip-lock'); document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [close]);
  useEffect(() => { if (data) panel.current?.querySelector<HTMLElement>('input,textarea,select')?.focus({ preventScroll: true }); }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump straight to a section (e.g. the video), and keep the chip on the section in view.
  const jumpTo = (name: string) => {
    const el = body.current?.querySelector<HTMLElement>(`[data-section="${CSS.escape(name)}"]`);
    if (el && body.current) body.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    setActive(name);
  };
  useEffect(() => {
    if (!data || !target.jump) return;
    const name = target.jump === 'video' ? sections.find((s) => s.fields.some((f) => f.type === 'video'))?.name : target.jump;
    if (name) setTimeout(() => jumpTo(name), 50);
  }, [!!data, sections.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const b = body.current; if (!b) return;
    const secs = [...b.querySelectorAll<HTMLElement>('[data-section]')];
    const cur = secs.filter((s) => s.offsetTop - b.scrollTop < 80).pop() || secs[0];
    if (cur) setActive(cur.dataset.section || '');
  };

  const sh = entry as (Entry & Shared) | null;
  const list = (a: string[]) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  if (!c && colErr) return null;
  const kind = KIND[target.col] || c?.singular || 'Page';
  const group = c?.group && data ? String(data[c.group.key] || '') : '';
  const name = String(data?.name || '');
  const set = (k: string, v: unknown) => { setData((d) => ({ ...d!, [k]: v })); setDirty(true); };

  const save = async () => {
    if (!c || !data) return;
    if (!name.trim()) { setError('Give it a name first.'); return; }
    setSaving(true); setError('');
    try {
      const out = isNew
        ? await api<Entry>('/api/entries', { method: 'POST', body: { collection: c.id, data, share: usesLibrary ? share : undefined } })
        : await api<Entry>(`/api/entries/${entry!.id}`, { method: 'PUT', body: { data, scope } });
      setDirty(false);
      await session.reloadIndex(); session.bump();
      if (isNew && !c.noPages) nav('/' + out.slug);
      onSaved(isNew ? `${name} is in the book.` : 'Saved. The page is updated.');
    } catch (e) { setError((e as Error).message); setSaving(false); }
  };
  const archive = async () => {
    const libDish = !!(entry as (Entry & Shared) | null)?.library;
    if (!entry || !confirm(libDish ? `Take “${name}” off our menu? It stays in the group’s kitchen, so it can come back any time.` : `Archive “${name}”? It leaves the book and every list. You can restore it from the Archive in the admin.`)) return;
    try {
      await api(`/api/entries/${entry.id}`, { method: 'DELETE' });
      setDirty(false); await session.reloadIndex(); session.bump();
      if (window.location.pathname === '/' + entry.slug) nav(LIST_OF[target.col] || '/', { replace: true });
      onSaved(libDish ? `${name} is off our menu.` : `${name} is archived.`);
    } catch (e) { setError((e as Error).message); }
  };

  return createPortal(
    <div className="eip" role="presentation">
      <div className="eip-scrim" aria-hidden="true" onClick={close} />
      <div ref={panel} className="eip-panel" role="dialog" aria-modal="true" aria-labelledby="eip-title">
        <span className="eip-handle" aria-hidden="true" />
        <header className="eip-head">
          <div className="eip-top">
            <div>
              <p className="eip-eyebrow">{isNew ? 'Adding' : 'Editing'} · {kind}{group ? ` · ${group}` : ''}</p>
              <h2 id="eip-title">{mode === 'pick' ? `Add a ${kind.toLowerCase()}` : isNew ? (name || `New ${kind.toLowerCase()}`) : name || 'Untitled'}</h2>
            </div>
            <button type="button" className="eip-close" aria-label="Close" onClick={close}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          {target.notice && <p className="eip-notice" role="status"><i className="dot" aria-hidden="true" />{target.notice}</p>}
          {mode === 'form' && sh?.library && (
            <p className="eip-shared"><i className="dot" aria-hidden="true" />
              {sh.sharedWith?.length ? `Shared with ${list(sh.sharedWith)}.` : 'In our group’s kitchen. No other restaurant has it on its menu yet.'} Price, station and pairings are {sh.storeName || 'this restaurant'}’s own.
            </p>
          )}
          {mode === 'form' && sections.length > 1 && (
            <nav className="eip-jump" aria-label="Jump to a section">
              {sections.map((s, i) => (
                <button type="button" key={s.name} className={(active || sections[0].name) === s.name || (!active && i === 0) ? 'on' : ''} onClick={() => jumpTo(s.name)}>{s.name}</button>
              ))}
            </nav>
          )}
        </header>
        <div ref={body} className="eip-body" onScroll={onScroll}>
          {mode === 'pick' && (
            <div className="eip-pick">
              <p className="eip-pick-head">From our group’s kitchen</p>
              <p className="eip-pick-sub">Dishes our other restaurants already have. Add one and it comes with its photo, recipe, allergens and talking points. You set the price and station.</p>
              {error && <p className="eip-error" role="alert">{error}</p>}
              {!lib && <div className="loader" aria-label="Loading" />}
              {lib && lib.length > 5 && <label className="field"><span className="sr-only">Search our group’s dishes</span><input placeholder="Search our group’s dishes…" value={find} onChange={(e) => setFind(e.target.value)} /></label>}
              {lib && lib.filter((d) => String(d.data.name).toLowerCase().includes(find.toLowerCase())).map((d) => (
                <div key={d.id} className="eip-lib">
                  {d.data.photo ? <img src={String(d.data.photo)} style={focusImg(String(d.data.photo))} alt="" /> : <span className="thumb-empty" aria-hidden="true" />}
                  <div className="grow">
                    <strong>{String(d.data.name)}</strong>
                    {d.data.description ? <small>{String(d.data.description)}</small> : null}
                    <em>{d.stores.length ? `On the menu at ${d.stores.join(' · ')}` : 'Not on a menu yet'}</em>
                  </div>
                  <button type="button" className="btn" disabled={!!adding} onClick={() => void addFromLibrary(d)}>{adding === d.id ? 'Adding…' : 'Add to Our Menu'}</button>
                </div>
              ))}
              <div className="eip-or"><span>or</span></div>
              <button type="button" className="eip-add eip-new" onClick={() => setMode('form')}>
                <span className="plus" aria-hidden="true">+</span>
                <span>Start a New Dish<small>For something only we serve, or something new for the whole group.</small></span>
              </button>
            </div>
          )}
          {mode === 'form' && !data && !error && <div className="loader" aria-label="Loading" />}
          {mode === 'form' && error && <p className="eip-error" role="alert">{error}</p>}
          {mode === 'form' && data && c && sections.map((s) => (
            <section key={s.name} data-section={s.name} className="eip-section">
              <h3>{s.name}</h3>
              <div className="form-grid">
                {s.fields.map((f) => <div key={f.key} className={wide(f) ? 'span-2' : ''}>{renderField(f, data[f.key], (v) => set(f.key, v), { name })}</div>)}
              </div>
            </section>
          ))}
          <PageOptions />
        </div>
        <footer className={'eip-foot' + (mode === 'pick' ? ' pick' : '')}>
          {mode === 'form' && !isNew && sh?.library && !!sh.sharedWith?.length && (
            <div className="eip-scope" role="radiogroup" aria-label="Who sees this change">
              <span>Save for</span>
              <button type="button" role="radio" aria-checked={scope === 'group'} className={scope === 'group' ? 'on' : ''} onClick={() => setScope('group')}>All {sh.sharedWith.length + 1} restaurants</button>
              <button type="button" role="radio" aria-checked={scope === 'store'} className={scope === 'store' ? 'on' : ''} onClick={() => setScope('store')}>Only {sh.storeName || 'us'}</button>
            </div>
          )}
          {mode === 'form' && isNew && usesLibrary && (
            <label className="check eip-share"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> <span>Share with all our restaurants <small>They can add it to their menus.</small></span></label>
          )}
          <div className="eip-left">
            <span className="eip-status">{mode === 'pick' ? (lib ? `${lib.length} dish${lib.length === 1 ? '' : 'es'} you can add` : '') : saving ? 'Saving…' : dirty ? <><i className="dot" aria-hidden="true" />Unsaved changes</> : isNew ? 'New · not in the book yet' : 'No changes'}</span>
            {entry && <button type="button" className="link-btn danger" onClick={() => void archive()}>{sh?.library ? 'Take Off Our Menu' : `Archive This ${kind}`}</button>}
          </div>
          <div className="eip-right">
            <button type="button" className="btn ghost" onClick={close}>Cancel</button>
            {mode === 'form' && <button type="button" className="btn" disabled={saving || !data} onClick={() => void save()}>{saving ? 'Saving…' : isNew ? (c?.noPages ? 'Add It' : 'Add to the Book') : 'Save Changes'}</button>}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** "✎ Edit Page" on a dish, cocktail, wine or bottle page (managers only). */
export function EditPageButton({ col, id, className = '', floating = false }: { col: string; id: number; className?: string; floating?: boolean }) {
  const { open, canOpen } = useEditInPlace();
  if (!canOpen(col)) return null;
  // On phones it floats over the screen (portalled: the page's entry animation would pin it to the page).
  if (floating) return createPortal(<EditPageButton col={col} id={id} className={className + ' floating'} />, document.body);
  return (
    <button type="button" className={'eip-edit ' + className} onClick={() => open({ col, id, preset: {} })}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M14 6l4 4" /></svg>
      Edit Page
    </button>
  );
}

/** The dashed "+ Add a Dish to Mains" row (or tile, in a row of cards). */
export function AddRow({ href, label, tile, inset = 0, style, className = '' }: { href: string; label: string; tile?: boolean; inset?: number; style?: React.CSSProperties; className?: string }) {
  const st: React.CSSProperties = tile ? { ...style } : { ...style, width: undefined, marginLeft: inset, marginRight: inset };
  return (
    <a href={href} className={(tile ? 'eip-add tile ' : 'eip-add ') + className} style={st}>
      <span className="plus" aria-hidden="true">+</span>
      <span>{label}</span>
    </a>
  );
}
