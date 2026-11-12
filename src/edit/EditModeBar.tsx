// The dark edit bar at the top of a page in Edit Mode (bottom of the screen on phones), the sidebar's Edit Mode card,
// and the pen in the phone top bar. Figma 533:596 (bar), 533:590 (card on), 523:520 (card off).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../lib/session';
import { useEditInPlace } from '../components/EditSheet';
import { changesLabel, needsScope, saveDrafts, useEditMode, type PageEdit } from './state';
import { askArchive } from './archive';

const Pen = ({ size = 16 }: { size?: number }) => <img src="/img/edit/pen.svg" width={size} height={size} alt="" aria-hidden="true" />;

export function EditModeBar({ page, hasAdd, floating, width, zoom }: { page: PageEdit | null; hasAdd: boolean; floating: boolean; width: number | string; zoom?: number }) {
  const { count, drafts, discard, setOn } = useEditMode();
  const session = useSession();
  const { open } = useEditInPlace();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<{ others: number; store: string } | null>(null);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { setError(''); setAsk(null); }, [page]);

  const main = page?.main != null ? page.entries[page.main] : null;
  const draftName = page?.main != null ? drafts[page.main]?.name?.v : undefined;
  const name = String(draftName ?? main?.name ?? page?.title ?? '');

  const save = async (scope?: 'group' | 'store') => {
    if (!page || !count) return;
    const shared = needsScope(drafts, page);
    if (shared && !scope) { setAsk(shared); return; }
    setAsk(null); setSaving(true); setError('');
    try {
      const saved = await saveDrafts(drafts, page, scope || 'group');
      // The page shows the saved values straight away, then reloads with everything that follows from them.
      for (const [id, data] of Object.entries(saved)) { const info = page.entries[id]; if (info) { info.data = data; info.name = String(data.name || info.name); } }
      discard();
      await session.reloadIndex(); session.bump();
      setToast(scope === 'store' ? `Saved for ${shared?.store || 'this restaurant'} only. Staff see it now.` : 'Saved. Staff see it now.');
    } catch (e) { setError((e as Error).message); }
    setSaving(false);
  };
  const moreFields = () => {
    if (!main || page?.main == null) return;
    const mine = drafts[page.main] || {};
    open({ col: main.col, id: page.main, preset: {}, draft: Object.fromEntries(Object.entries(mine).map(([k, c]) => [k, c.v])) });
  };

  // Archive (Nov 12): takes this item out of the book, then back to its list with Undo. A group dish only leaves this store.
  const archive = () => {
    if (!main || page?.main == null) return;
    const sh = main.shared;
    askArchive({ e: page.main, n: name, c: main.col, ...(sh ? { s: sh.store, o: sh.others } : {}) }, { back: true, changes: count, done: () => discard() });
  };
  const status = saving ? 'Saving…' : error ? error : count ? `${changesLabel(count)} · staff see it when you save` : page ? 'Tap anything outlined · staff see it when you save'
    : hasAdd ? 'Open a dish, drink, wine or bottle to change it, or use an Add row' : 'Open a dish, drink, wine or bottle to change it';
  const bar = (
    <div className={'em-bar' + (floating ? ' floating' : '')} role="region" aria-label="Edit Mode">
      <span className="em-pen" aria-hidden="true"><Pen /></span>
      <div className="em-copy">
        <strong>{page ? (page.main != null ? `Editing ${name}` : `Editing ${page.title || 'this page'}`) : 'Edit Mode is on'}</strong>
        <span className={error ? 'em-error' : ''} role={error ? 'alert' : 'status'} aria-live="polite">{status}</span>
      </div>
      <span className="em-spacer" />
      {ask ? (
        <div className="em-scope" role="radiogroup" aria-label="Who sees this change">
          <span>Save for</span>
          <button type="button" className="em-btn primary" onClick={() => void save('group')}>All {ask.others + 1} Restaurants</button>
          <button type="button" className="em-btn" onClick={() => void save('store')}>Only {ask.store || 'This Store'}</button>
          <button type="button" className="em-btn quiet" onClick={() => setAsk(null)}>Cancel</button>
        </div>
      ) : page ? (
        <div className="em-actions">
          {main && <button type="button" className="em-btn quiet em-archive" onClick={archive} disabled={saving}>Archive</button>}
          {main && <button type="button" className="em-btn quiet" onClick={moreFields}>More Fields</button>}
          <button type="button" className="em-btn" disabled={!count || saving} onClick={() => discard(true)}>Discard</button>
          <button type="button" className="em-btn primary" disabled={!count || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      ) : (
        <div className="em-actions"><button type="button" className="em-btn" onClick={() => setOn(false)}>Turn Off</button></div>
      )}
    </div>
  );
  return (
    <>
      {floating ? createPortal(bar, document.body) : <div className="em-bar-wrap" style={{ width, zoom }}>{bar}</div>}
      {toast && createPortal(<div className="eip-toast" role="status"><span className="dot" aria-hidden="true" />{toast}</div>, document.body)}
    </>
  );
}

/** The sidebar card: turn Edit Mode on or off. */
export function EditModeCard({ onToggle }: { onToggle?: () => void }) {
  const { can, on, setOn } = useEditMode();
  if (!can) return null;
  return (
    <div className={'em-card' + (on ? ' on' : '')}>
      <p className="em-card-eyebrow">{on ? 'EDIT MODE · ON' : 'EDIT MODE'}</p>
      <p className="em-card-title">{on ? 'Tap anything outlined' : 'Change the book in place'}</p>
      <p className="em-card-body">Tap any dish, spec or wine and type. Staff see it when you save.</p>
      <button type="button" className="em-card-btn" aria-pressed={on} onClick={() => { setOn(!on); onToggle?.(); }}>{on ? 'Turn Off Edit Mode' : 'Turn On Edit Mode'}</button>
    </div>
  );
}

/** The pen in the top bar (laptops, tablets and phones, where the sidebar is a menu). */
export function EditModeToggle() {
  const { can, on, setOn } = useEditMode();
  if (!can) return null;
  return (
    <button type="button" className={'em-toggle' + (on ? ' on' : '')} aria-pressed={on} aria-label={on ? 'Turn off Edit Mode' : 'Turn on Edit Mode'} onClick={() => setOn(!on)}>
      <Pen size={18} /><span>{on ? 'Editing' : 'Edit'}</span>
    </button>
  );
}
