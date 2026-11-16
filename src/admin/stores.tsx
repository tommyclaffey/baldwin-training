// Stores (Nov 16): owners add and rename their own company's stores (it used to take a super admin). A new store starts
// with the shared library, like J.Baldwin's and Testa Barra; its own menu is added store by store. Managers don't see this
// page (the server refuses them too); in a demo its manager can, up to 3 stores, since a demo has no owner.
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNote, Loading, Text, when } from './ui';

type StoreRow = { id: number; name: string; bookReady: boolean; staff: number; managers: number; createdAt: string | null };
type Data = { company: string; demo: boolean; stores: StoreRow[]; cap: number; canAdd: boolean };

export function StoresPage() {
  const { refresh } = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const load = () => { setError(''); return api<Data>('/api/team/stores').then(setData).catch((e) => setError((e as Error).message)); };
  useEffect(() => { void load(); document.title = 'Stores · Mise Academy'; }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(''); setNote('');
    try {
      const r = await api<{ store: { name: string } }>('/api/team/stores', { method: 'POST', body: { name } });
      setName(''); setNote(`${r.store.name} is added. Pick it in the Store menu to work on its book and invite its team.`);
      await load(); await refresh(); // the Store menu in the sidebar lists it now
    } catch (e2) { setErr((e2 as Error).message); }
    setBusy(false);
  };
  const rename = async (e: FormEvent) => {
    e.preventDefault(); if (!editing) return; setBusy(true); setErr(''); setNote('');
    try {
      const r = await api<{ store: { name: string } }>(`/api/team/stores/${editing.id}`, { method: 'PATCH', body: { name: editing.name } });
      setEditing(null); setNote(`Renamed to ${r.store.name}.`);
      await load(); await refresh();
    } catch (e2) { setErr((e2 as Error).message); }
    setBusy(false);
  };

  if (error) return <div className="admin-page"><ErrorNote error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="admin-page"><Loading /></div>;
  const full = !data.canAdd;
  return (
    <div className="admin-page stores-page">
      <h1>Stores</h1>
      <p className="muted">{data.company} · {data.stores.length} {data.stores.length === 1 ? 'store' : 'stores'}. Each store has its own menu, staff, quiz scores, sign-offs and floor plan. Owners see every store and switch with the Store menu.</p>
      {err && <ErrorNote error={err} />}
      {note && <p className="ok" role="status">{note}</p>}

      <table className="table stack-table stores-table">
        <thead><tr><th>Store</th><th>Staff</th><th>Managers</th><th>Added</th><th /></tr></thead>
        <tbody>{data.stores.map((s) => (
          <tr key={s.id}>
            <td>{editing?.id === s.id
              ? <form className="row stores-rename" onSubmit={rename}>
                  <input value={editing.name} maxLength={80} onChange={(e) => setEditing({ id: s.id, name: e.target.value })} aria-label={`New name for ${s.name}`} autoFocus />
                  <button className="btn" disabled={busy || editing.name.trim().length < 2}>{busy ? 'Saving…' : 'Save'}</button>
                  <button type="button" className="link-btn" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              : <><strong>{s.name}</strong>{!s.bookReady && <small className="muted"> · shared library</small>}</>}</td>
            <td data-label="Staff">{s.staff}</td>
            <td data-label="Managers">{s.managers}</td>
            <td data-label="Added">{when(s.createdAt)}</td>
            <td className="stores-actions">{editing?.id !== s.id && <button className="link-btn" onClick={() => { setEditing({ id: s.id, name: s.name }); setErr(''); setNote(''); }}>Rename</button>}</td>
          </tr>
        ))}</tbody>
      </table>

      <form className="card stores-add" onSubmit={add}>
        <h2>Add a Store</h2>
        <p className="muted small">A new store starts with the shared library: classic cocktails, spirits, wine, beer, the steps of service, safety and cleanliness. Add its dishes, drinks and wines in the admin, invite its managers on People, and its staff join with your company’s code.</p>
        {data.demo && <p className="muted small">This is a demo: you can have up to {data.cap} stores, and they go when the demo ends.</p>}
        {full
          ? <p className="muted small">{data.demo ? `This demo has its ${data.cap} stores.` : `You have ${data.stores.length} stores, the most one account can add. Contact Mise support for more.`}</p>
          : <>
              <Text label="Store name" value={name} placeholder="The name your team and guests use" onChange={setName} max={80} />
              <button className="btn" disabled={busy || name.trim().length < 2}>{busy ? 'Adding…' : 'Add a Store'}</button>
            </>}
      </form>
    </div>
  );
}
