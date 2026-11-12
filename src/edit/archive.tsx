// Archive where items live (Nov 12; server/archive.mjs). Tommy, Nov 11: "I want to create a system where you're archiving
// certain items and you're not necessarily removing them fully. You can archive the item."
// One confirm and one Undo toast for every place Archive appears: the Edit Mode bar on an item's page, and the small
// Archive button on list rows and cards (managers only: the server only marks what this person can archive).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

/** An item someone can archive (node.arc, or the Edit Mode bar's page). s: a group dish (comes off this store only). */
export type Arc = { e: number; n: string; c: string; s?: string; o?: number };

/** The list an item lives in: where you land after archiving it from its own page. */
export const LIST_OF: Record<string, string> = {
  recipe: '/food-matrix', house: '/the-bar/cocktails', classic: '/the-bar/cocktails', wine: '/the-bar/wine',
  shelf: '/the-bar/back-bar', beer: '/the-bar/beer-and-draft',
};
const WHERE: Record<string, string> = { recipe: 'the menu', house: 'the menu', classic: 'the book', wine: 'the wine list', shelf: 'the back bar', beer: 'the beer list' };

/** The confirm's words (the tests read these too). */
export function confirmCopy(a: Arc) {
  const title = `Archive ${a.n || 'this'}?`;
  if (a.s !== undefined) {
    const others = a.o ? `The other ${a.o === 1 ? 'restaurant keeps' : `${a.o} restaurants keep`} it, and it stays in the group kitchen.` : 'It stays in the group kitchen.';
    return { title, body: `It comes off ${a.s || 'this restaurant'}’s menu, quizzes and search. ${others} You can restore it any time from Archived.` };
  }
  return { title, body: `It leaves ${WHERE[a.c] || 'the book'}, quizzes and search. You can restore it any time from Archived.` };
}

type Ask = { arc: Arc; back: boolean; changes?: number; done?: () => void };
let ask: (a: Ask) => void = () => {};
/** Opens the confirm. back: you're on the item's own page, so after archiving you go to its list. */
export const askArchive = (arc: Arc, opts: { back?: boolean; changes?: number; done?: () => void } = {}) => ask({ arc, back: !!opts.back, changes: opts.changes, done: opts.done });

const BoxIcon = <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 3.5h12v3H2zM3 6.5v6.25c0 .41.34.75.75.75h8.5c.41 0 .75-.34.75-.75V6.5M6.25 9h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>;

/** The small round Archive button on a row or card, beside the chat button (same size and look). Never follows the link. */
export function ItemArchiveButton({ arc, className = '', style }: { arc: Arc; className?: string; style?: CSSProperties }) {
  return (
    <button type="button" className={'item-chat item-archive ' + className} style={style} aria-label={`Archive ${arc.n}`} aria-haspopup="dialog"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); askArchive(arc); }}>
      {BoxIcon}
    </button>
  );
}

/** The confirm and the Undo toast. Mounted once (EditModeProvider), so the toast stays when archiving takes you to the list. */
export function ArchiveHost() {
  const session = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [pending, setPending] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ text: string; undo?: { arc: Arc; from: string | null } } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { ask = (a) => { lastFocus.current = document.activeElement as HTMLElement | null; setError(''); setPending(a); }; return () => { ask = () => {}; }; }, []);
  useEffect(() => { if (pending) cancelRef.current?.focus(); }, [pending]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 3200); return () => clearTimeout(t); }, [toast]);

  const close = () => { setPending(null); lastFocus.current?.focus?.(); };
  const refresh = async () => { await session.reloadIndex(); session.bump(); };
  const run = async () => {
    if (!pending) return;
    const { arc, back, done } = pending;
    setBusy(true); setError('');
    try {
      await api(`/api/entries/${arc.e}`, { method: 'DELETE' });
      done?.();
      const from = back ? loc.pathname + loc.search : null;
      setPending(null);
      if (back) nav(LIST_OF[arc.c] || '/');
      await refresh();
      setToast({ text: `${arc.n} archived.`, undo: { arc, from } });
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const undo = async () => {
    const u = toast?.undo;
    if (!u) return;
    setToast(null);
    try {
      await api(`/api/entries/${u.arc.e}/restore`, { method: 'POST' });
      await refresh();
      if (u.from) nav(u.from);
      setToast({ text: `${u.arc.n} is back.` });
    } catch (e) { setToast({ text: (e as Error).message }); }
  };

  const copy = pending ? confirmCopy(pending.arc) : null;
  return (
    <>
      {pending && copy && createPortal(
        <div className="modal-back arc-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}
          onKeyDown={(e) => { if (e.key === 'Escape' && !busy) close(); }}>
          <div className="modal arc-confirm" role="alertdialog" aria-modal="true" aria-labelledby="arc-title" aria-describedby="arc-body">
            <h2 id="arc-title">{copy.title}</h2>
            <p id="arc-body">{copy.body}</p>
            {!!pending.changes && <p className="arc-note">Your {pending.changes === 1 ? '1 unsaved change' : `${pending.changes} unsaved changes`} won’t be saved.</p>}
            {error && <p className="arc-error" role="alert">{error}</p>}
            <div className="arc-actions">
              <button ref={cancelRef} type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
              <button type="button" className="btn arc-go" onClick={() => void run()} disabled={busy}>{busy ? 'Archiving…' : 'Archive'}</button>
            </div>
          </div>
        </div>, document.body)}
      {toast && createPortal(
        <div className="eip-toast arc-toast" role="status">
          <span className="dot" aria-hidden="true" />{toast.text}
          {toast.undo && <button type="button" className="arc-undo" onClick={() => void undo()}>Undo</button>}
        </div>, document.body)}
    </>
  );
}
