// Edit Mode (Nov 11, Figma 09 · Proposals → 24: 533:274). Tommy, Nov 10: "I want the adding editing and stuff to feel
// more front end interaction verse a backend matrix."
// A manager turns it on (sidebar card, or the pen in the top bar); every page then shows what can change, outlined in copper,
// and those parts become fields. Changes wait in a draft until Save Changes, which writes them to the same CMS records the
// admin forms use (PATCH /api/entries/:id). The server only marks fields for people who can edit them (server/editmode.mjs).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, canEdit } from '../lib/api';
import { useSession } from '../lib/session';

/** A field marked by the server on a node (see server/editmode.mjs). */
export type EdBind = {
  e: number; k: string; v: unknown; t?: 'photo' | 'tags' | 'chips' | 'spec' | 'list';
  ph?: string; u?: 1; m?: 1; n?: 1; req?: 1; cell?: 1; pre?: string; suf?: string; sep?: string; fit?: 1;
  opts?: string[]; glasses?: string[]; past?: boolean;
};
export type EntryInfo = { col: string; name: string; kind: string; data: Record<string, unknown>; shared?: { others: number; store: string }; local?: string[] };
export type PageEdit = { main: number | null; title: string; entries: Record<string, EntryInfo> };

type Change = { v: unknown; was: unknown };
type Drafts = Record<number, Record<string, Change>>;
type Ctx = {
  can: boolean; on: boolean; setOn: (on: boolean) => void;
  drafts: Drafts; count: number; reset: number;
  setTop: (e: number, key: string, v: unknown, was: unknown) => void;
  discard: (ask?: boolean) => boolean;
  clearEntry: (e: number) => void;
};
const EditCtx = createContext<Ctx>({ can: false, on: false, setOn: () => {}, drafts: {}, count: 0, reset: 0, setTop: () => {}, discard: () => true, clearEntry: () => {} });
export const useEditMode = () => useContext(EditCtx);
/** The page's editable entries (PageView provides it). */
export const PageEditContext = createContext<PageEdit | null>(null);
/** True while Edit Mode is on for someone who can edit. */
export const useEditing = () => { const c = useContext(EditCtx); return c.can && c.on; };

export const topKey = (path: string) => path.split('.')[0];
export function valueAt(d: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), d);
}
/** A copy of `root` with the value at `path` (below the top key) set; lists and rows are made as needed. */
function setIn(root: unknown, parts: string[], v: unknown): unknown {
  if (!parts.length) return v;
  const [k, ...rest] = parts;
  const idx = /^\d+$/.test(k);
  const base = Array.isArray(root) ? [...root] : root && typeof root === 'object' ? { ...(root as object) } : idx ? [] : {};
  const cur = (base as Record<string, unknown>)[k];
  if (Array.isArray(base) && idx) while (base.length < Number(k)) base.push(rest.length ? {} : '');
  (base as Record<string, unknown>)[k] = setIn(cur, rest, v);
  return base;
}
/** Empty values compare equal ('' / undefined / [] / null), so undoing a change by hand clears it. */
const norm = (v: unknown): unknown => {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).filter(([, x]) => norm(x) !== '').map(([k, x]) => [k, norm(x)]));
  return v;
};
export const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const changesLabel = (n: number) => plural(n, 'change');

const KEY = 'bt-edit-mode';

export function EditModeProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const can = canEdit(user) && !user?.impersonatedBy;
  const [on, setOnRaw] = useState(() => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } });
  const [drafts, setDrafts] = useState<Drafts>({});
  const [reset, setReset] = useState(0);
  const count = useMemo(() => Object.values(drafts).reduce((n, d) => n + Object.keys(d).length, 0), [drafts]);
  const countRef = useRef(count); countRef.current = count;

  const discard = useCallback((ask = false) => {
    if (ask && countRef.current && !confirm(`Discard your ${changesLabel(countRef.current)}? The page goes back to what staff see now.`)) return false;
    setDrafts({}); setReset((r) => r + 1);
    return true;
  }, []);
  const setOn = useCallback((v: boolean) => {
    if (!v && countRef.current && !confirm(`Turn off Edit Mode? Your ${changesLabel(countRef.current)} haven’t been saved and will be lost.`)) return;
    if (!v) discard();
    setOnRaw(v);
    try { if (v) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY); } catch { /* private mode */ }
  }, [discard]);
  const setTop = useCallback((e: number, key: string, v: unknown, was: unknown) => {
    setDrafts((d) => {
      const mine = { ...(d[e] || {}) };
      if (same(v, was)) delete mine[key]; else mine[key] = { v, was };
      const next = { ...d, [e]: mine };
      if (!Object.keys(mine).length) delete next[e];
      return next;
    });
  }, []);
  const clearEntry = useCallback((e: number) => { setDrafts((d) => { const n = { ...d }; delete n[e]; return n; }); setReset((r) => r + 1); }, []);

  // Someone else signs in on this device: nothing carries over.
  useEffect(() => { setDrafts({}); if (!can) setOnRaw(false); }, [user?.id, user?.workingIn, can]);

  // Leaving the page with unsaved changes asks first: links, Back/Forward, and closing the tab.
  const loc = useLocation();
  const nav = useNavigate();
  const here = useRef(loc.pathname + loc.search);
  const allow = useRef(false);
  useEffect(() => {
    if (!count) return;
    const warn = (ev: BeforeUnloadEvent) => { ev.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    const click = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.origin !== location.origin) return;
      if (a.pathname === location.pathname) return;
      if (confirm(`Leave this page? Your ${changesLabel(countRef.current)} haven’t been saved and will be lost.`)) { allow.current = true; discard(); return; }
      ev.preventDefault(); ev.stopPropagation();
    };
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', click, true); };
  }, [count, discard]);
  useEffect(() => {
    const now = loc.pathname + loc.search;
    if (now === here.current) return;
    const prevPath = here.current.split('?')[0];
    if (countRef.current && !allow.current && loc.pathname !== prevPath) {
      // Back or Forward with changes waiting: ask, and go back to the page if they want to keep them.
      if (confirm(`Leave this page? Your ${changesLabel(countRef.current)} haven’t been saved and will be lost.`)) discard();
      else { nav(here.current); return; }
    }
    allow.current = false;
    here.current = now;
  }, [loc.pathname, loc.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // A save from the full form (More Fields) clears that entry's waiting changes.
  useEffect(() => {
    const done = (ev: Event) => clearEntry(Number((ev as CustomEvent<{ id: number }>).detail?.id));
    window.addEventListener('bt:entry-saved', done);
    return () => window.removeEventListener('bt:entry-saved', done);
  }, [clearEntry]);

  // While editing, the page knows it (outlines, phone bar spacing).
  useEffect(() => { document.body.classList.toggle('edit-on', can && on); return () => document.body.classList.remove('edit-on'); }, [can, on]);

  return <EditCtx.Provider value={{ can, on: can && on, setOn, drafts, count, reset, setTop, discard, clearEntry }}>{children}</EditCtx.Provider>;
}

/** A field's current value (the waiting change, or what's saved) and a setter, for a path like "steps.0.title". */
export function useField(ed: EdBind | undefined) {
  const { drafts, setTop } = useEditMode();
  const page = useContext(PageEditContext);
  const data = (ed && page?.entries[ed.e]?.data) || null;
  if (!ed) return null;
  const top = topKey(ed.k);
  const saved = data ? data[top] : undefined;
  const d = drafts[ed.e]?.[top];
  const cur = d ? d.v : saved;
  const value = ed.k === top ? cur : valueAt({ [top]: cur }, ed.k);
  const savedValue = ed.k === top ? saved : valueAt({ [top]: saved }, ed.k);
  const set = (v: unknown) => setTop(ed.e, top, ed.k === top ? v : setIn(cur, ed.k.split('.').slice(1), v), saved);
  return { value: value === undefined && !data ? ed.v : value, saved: savedValue === undefined && !data ? ed.v : savedValue, set, changed: !!d && !same(value, savedValue) };
}

/** Saves every waiting change on the page. Returns the saved entries, or throws with a message to show. */
export async function saveDrafts(drafts: Drafts, page: PageEdit, scope: 'group' | 'store') {
  const out: Record<number, Record<string, unknown>> = {};
  for (const [id, changes] of Object.entries(drafts)) {
    const info = page.entries[id];
    if (!info) continue;
    const body = Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.v]));
    if ('name' in body && !String(body.name || '').trim()) throw new Error('Give it a name first.');
    const saved = await api<{ data: Record<string, unknown> }>(`/api/entries/${id}`, { method: 'PATCH', body: { changes: body, scope } });
    out[Number(id)] = saved.data;
  }
  return out;
}
/** Does saving these changes need "for every restaurant, or only this one?" (a shared dish, a shared field). */
export function needsScope(drafts: Drafts, page: PageEdit | null) {
  if (!page) return null;
  for (const [id, changes] of Object.entries(drafts)) {
    const info = page.entries[id];
    if (info?.shared && Object.keys(changes).some((k) => !(info.local || []).includes(k))) return info.shared;
  }
  return null;
}
