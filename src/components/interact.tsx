// The live state behind drawn controls (filters, tabs, chips, checklists, print, photo viewer).
// The server tags each control with a `meta` (see server/interact.mjs); this keeps the state for one page.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import type { FNode } from './FigmaNode';

export type Meta = {
  k?: string; mode?: 'toggle' | 'pick'; val?: string; def?: boolean | string;
  on?: FNode; off?: FNode; save?: 'day' | 'week';
  show?: { req?: string[]; forbid?: string[]; pick?: [string, string[], string] };
  group?: string; inGroup?: string;
  act?: 'print' | 'reset' | 'zoom'; reset?: string[]; img?: string; caption?: string;
  cls?: [string, Record<string, string>];
  finder?: 1; list?: string[]; assign?: string;
  tables?: Record<string, [number, number]>; range?: [number, number];
};

type Value = boolean | string;
type Store = {
  get: (k: string, def: Value) => Value;
  set: (k: string, v: Value, save?: 'day' | 'week') => void;
  reset: (prefixes: string[]) => void;
  zoom: (img: string, caption?: string) => void;
};

const Ctx = createContext<Store | null>(null);
export const useInteract = () => useContext(Ctx);

// Ticks are kept on this phone until the day (or the week, for weekly jobs) is over.
const today = () => new Date().toLocaleDateString('en-CA');
const week = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toLocaleDateString('en-CA'); };
const storeKey = (save: 'day' | 'week') => `bt-ticks:${save}:${save === 'day' ? today() : week()}`;
function loadSaved(): Record<string, Value> {
  try { return { ...JSON.parse(localStorage.getItem(storeKey('week')) || '{}'), ...JSON.parse(localStorage.getItem(storeKey('day')) || '{}') }; } catch { return {}; }
}

export function InteractProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Record<string, Value>>(loadSaved);
  const [photo, setPhoto] = useState<{ img: string; caption?: string } | null>(null);

  const set = useCallback((k: string, v: Value, save?: 'day' | 'week') => {
    setState((s) => ({ ...s, [k]: v }));
    if (save) {
      try {
        const key = storeKey(save);
        const saved = JSON.parse(localStorage.getItem(key) || '{}');
        saved[k] = v;
        localStorage.setItem(key, JSON.stringify(saved));
      } catch { /* private mode: ticks last the visit */ }
    }
  }, []);
  const store = useMemo<Store>(() => ({
    get: (k, def) => (k in state ? state[k] : def),
    set,
    reset: (prefixes) => setState((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !prefixes.some((p) => k.startsWith(p))))),
    zoom: (img, caption) => setPhoto({ img, caption }),
  }), [state, set]);

  useEffect(() => {
    if (!photo) return;
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setPhoto(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [photo]);

  return (
    <Ctx.Provider value={store}>
      {children}
      {photo && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setPhoto(null); }}>
          <figure className="modal photo-modal" role="dialog" aria-modal="true" aria-label={photo.caption || 'Photo'}>
            <button className="icon-btn" onClick={() => setPhoto(null)} aria-label="Close">✕</button>
            <img src={photo.img} alt={photo.caption || ''} />
            {photo.caption && <figcaption>{photo.caption}</figcaption>}
          </figure>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Is this control on? */
export function isActive(m: Meta, s: Store) {
  if (!m.k) return false;
  const v = s.get(m.k, m.def ?? (m.mode === 'pick' ? '' : false));
  return m.mode === 'pick' ? v === m.val : !!v;
}

/** Should this layer show, given the filters? */
export function isShown(m: Meta | undefined, s: Store | null) {
  if (!m?.show || !s) return true;
  const { req = [], forbid = [], pick } = m.show;
  if (req.some((k) => !s.get(k, true))) return false;
  if (forbid.some((k) => !!s.get(k, false))) return false;
  if (pick && !pick[1].includes(String(s.get(pick[0], pick[2])))) return false;
  return true;
}

/** Children after filtering: hidden rows drop out, and a group header goes when its whole group is hidden. */
export function visibleKids(kids: FNode[] | undefined, s: Store | null) {
  if (!kids || !s || !kids.some((c) => c.meta)) return kids;
  const shown = kids.filter((c) => isShown(c.meta, s));
  const live = new Set(shown.map((c) => c.meta?.inGroup).filter(Boolean));
  return shown.filter((c) => !c.meta?.group || live.has(c.meta.group));
}

/** Props that make a drawn layer act like a control. */
export function controlProps(m: Meta | undefined, s: Store | null) {
  if (!m || !s || (!m.k && !m.act)) return null;
  const run = () => {
    if (m.act === 'print') return window.print();
    if (m.act === 'reset') return s.reset(m.reset || []);
    if (m.act === 'zoom' && m.img) return s.zoom(m.img, m.caption);
    if (!m.k) return;
    if (m.mode === 'pick') s.set(m.k, m.val || '', m.save);
    else s.set(m.k, !isActive(m, s), m.save);
  };
  const active = m.k ? isActive(m, s) : undefined;
  const role = m.mode === 'toggle' ? 'checkbox' : m.mode === 'pick' ? 'tab' : 'button';
  return {
    role, tabIndex: 0,
    'aria-checked': m.mode === 'toggle' ? active : undefined,
    'aria-selected': m.mode === 'pick' ? active : undefined,
    onClick: (e: { preventDefault: () => void; stopPropagation: () => void }) => { e.preventDefault(); e.stopPropagation(); run(); },
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } },
  };
}

/* ---- Floor Plan: find a table ---- */
/** Type a table or bar-seat number: a ring marks it on the plan, its area card lights up, and the plan scrolls to it. */
export function TableFinder({ style, className, list }: { style: CSSProperties; className: string; list: string[] }) {
  const live = useInteract();
  const [q, setQ] = useState('');
  const v = q.trim();
  const miss = !!v && !list.includes(v);
  useEffect(() => { live?.set('table', list.includes(v) ? v : ''); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className={className + ' table-finder'} style={style}>
      <span className="sr-only">Find a table</span>
      <input type="search" inputMode="numeric" placeholder="Find a table…" value={q} onChange={(e) => setQ(e.target.value)} />
      {miss && <small role="status">No table {v}</small>}
    </label>
  );
}

/** The ring drawn over the floor plan image at a table's spot. */
export function TableMarker({ at, label }: { at: [number, number]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [label]);
  return <div ref={ref} className="table-marker" style={{ left: `${at[0] * 100}%`, top: `${at[1] * 100}%` }} role="status" aria-label={`Table ${label}`} />;
}

/* ---- Floor Plan: tonight's sections ---- */
type Sections = { names: Record<string, string>; save: (slot: string, name: string) => Promise<void>; ready: boolean };
let sectionsCache: Promise<{ day: string; names: Record<string, string> }> | null = null;
export function useSections(): Sections {
  const [names, setNames] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    sectionsCache ??= api<{ day: string; names: Record<string, string> }>('/api/sections');
    sectionsCache.then((r) => { setNames(r.names); setReady(true); }).catch(() => setReady(true));
  }, []);
  const save = useCallback(async (slot: string, name: string) => {
    setNames((n) => ({ ...n, [slot]: name }));
    await api('/api/sections', { method: 'PUT', body: { slot, name } });
    sectionsCache = null;
  }, []);
  return { names, save, ready };
}

/** One section row's name: plain text for staff, a box a signed-in manager types into. */
export function AssignName({ slot, node, render }: { slot: string; node: FNode; render: (n: FNode) => ReactNode }) {
  const role = useSession().user?.role;
  const canEdit = role === 'manager' || role === 'owner' || role === 'superadmin';
  const sections = useSections();
  const name = sections.names[slot] || '';
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  if (!canEdit) return <>{render({ ...node, s: name || 'Unassigned', f: name ? [{ c: '#F2EEE7' }] : node.f })}</>;
  return (
    <input className="assign-input" style={{ width: node.w, flex: '1 1 auto', minWidth: 0 }} aria-label={`${slot} tonight`} placeholder="Unassigned"
      value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() !== name) void sections.save(slot, draft.trim()); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}
