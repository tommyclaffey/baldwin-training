// Archived (Nov 12): one page with everything taken out of this store's book, by type, with who archived it and when,
// a search, and Restore on each row (Restore All per group). Managers only; classics only for super admins (the server
// decides which groups come back: GET /api/archived).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNote, Loading, when } from './ui';

type Item = { id: number; name: string; at: string; by: string | null; auto: boolean; slug?: string | null; kind?: string; storeOnly?: { store: string; others: number } };
type Group = { id: string; label: string; items: Item[] };

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const others = (n: number) => (n ? ` · still on ${n === 1 ? '1 other restaurant’s menu' : `${n} other restaurants’ menus`}` : ' · still in the group kitchen');

export function ArchivedPage() {
  const session = useSession();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const load = () => api<{ groups: Group[] }>('/api/archived').then((r) => setGroups(r.groups)).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(''), 3200); return () => clearTimeout(t); }, [note]);

  const shown = useMemo(() => (groups || []).map((g) => ({ ...g, items: q.trim() ? g.items.filter((i) => fold(i.name).includes(fold(q.trim()))) : g.items })), [groups, q]);
  const total = (groups || []).reduce((n, g) => n + g.items.length, 0);

  const after = async (text: string) => { await load(); await session.reloadIndex(); session.bump(); setNote(text); };
  const restore = async (g: Group, i: Item) => {
    setBusy(`${g.id}:${i.id}`); setError('');
    try {
      await api(g.id === 'media' ? `/api/media/${i.id}/restore` : g.id === 'prep' ? `/api/prep/items/${i.id}/restore` : `/api/entries/${i.id}/restore`, { method: 'POST' });
      await after(`${i.name} is back.`);
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  };
  const restoreAll = async (g: Group) => {
    if (!confirm(`Restore all ${g.items.length} archived ${g.label.toLowerCase()}? ${g.id === 'prep' ? 'They go back on Today’s prep list.' : 'They go back into the book, quizzes and search.'}`)) return;
    setBusy(g.id); setError('');
    try { await api('/api/archived/restore', { method: 'POST', body: { group: g.id } }); await after(`${g.label} restored.`); }
    catch (e) { setError((e as Error).message); }
    setBusy('');
  };

  return (
    <div className="admin-page arc-page">
      <div className="editor-head">
        <div>
          <h1>Archived</h1>
          <p className="muted">Everything taken out of the book. Nothing here is deleted: Restore puts it back in the book, the lists, the quizzes and search.</p>
        </div>
      </div>
      {error && <ErrorNote error={error} />}
      {!groups && !error && <Loading />}
      {groups && (
        <>
          <label className="field arc-search">
            <span>Search Archived</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="A dish, a drink, a wine…" />
          </label>
          {total === 0 && <p className="arc-empty">Nothing is archived. When you archive something, it shows here.</p>}
          {total > 0 && shown.map((g) => (
            <section key={g.id} className="arc-group" aria-labelledby={`arc-${g.id}`}>
              <div className="arc-group-head">
                <h2 id={`arc-${g.id}`}>{g.label}</h2>
                <span className="arc-count" aria-label={`${g.items.length} archived`}>{g.items.length}</span>
                <span className="grow" />
                {g.items.length > 1 && !q.trim() && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void restoreAll(g)}>{busy === g.id ? 'Restoring…' : 'Restore All'}</button>}
              </div>
              {g.items.length === 0 && <p className="arc-empty">{q.trim() ? 'No matches.' : `No archived ${g.label.toLowerCase()}.`}</p>}
              {g.items.map((i) => (
                <div key={i.id} className="arc-row">
                  <div className="grow">
                    <strong>{i.name}</strong>
                    <small>{i.kind ? i.kind + ' · ' : ''}Archived {when(i.at)} · {i.by ? `by ${i.by}` : i.auto ? 'automatically, when it left the menu file' : 'by a former team member'}</small>
                    {i.storeOnly && <span className="arc-store">Off {i.storeOnly.store || 'this restaurant'}’s menu only{others(i.storeOnly.others)}</span>}
                  </div>
                  <button type="button" className="btn ghost" disabled={!!busy} aria-label={`Restore ${i.name}`} onClick={() => void restore(g, i)}>{busy === `${g.id}:${i.id}` ? 'Restoring…' : 'Restore'}</button>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
      {note && <div className="eip-toast" role="status"><span className="dot" aria-hidden="true" />{note}</div>}
    </div>
  );
}
