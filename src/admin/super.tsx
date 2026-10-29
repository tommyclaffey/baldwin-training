// Super admin: every company and person, "sign in as" for support, super admin teammates, and the action log.
// Only super admins with two-step sign-in reach this; the server answers "not found" to everyone else.
import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, ROLE_LABEL, type Role } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNote, Loading, Text, when } from './ui';

type Company = { id: number; name: string; slug: string; joinCode: string; createdAt: string; deletedAt: string | null; leads: number; staff: number; lastSeenAt: string | null; stores: { id: number; name: string; bookReady: boolean; staff: number }[] };
type Person = { id: number; name: string; email: string | null; role: Role; companyId: number | null; companyName: string | null; createdAt: string; lastSeenAt: string | null; deletedAt: string | null; hasPin: boolean; totpOn: boolean; superPrimary: boolean };
type Overview = { companies: Company[]; admins: Person[]; you: number; youPrimary: boolean; workingIn: number };

function useOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api<Overview>('/api/super/overview').then(setData).catch((e) => setError(e.message)); };
  useEffect(load, []);
  return { data, error, load };
}
const daysLeft = (iso: string | null) => (iso ? Math.max(0, 30 - Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : 0);

export function SuperAdmin() {
  const { user } = useSession();
  if (user?.role !== 'superadmin' || user.impersonatedBy) return <div className="admin-page"><h1>Nothing here</h1></div>;
  if (!user.totpOn) return (
    <div className="admin-page narrow">
      <h1>Super admin</h1>
      <p className="error" role="alert">Turn on two-step sign-in first. It’s required for super admins.</p>
      <NavLink className="btn" to="/admin/account">Turn It On</NavLink>
    </div>
  );
  return (
    <div className="admin-page">
      <div className="editor-head"><div><h1>Super admin</h1><p className="muted">Every company and person in the app. Every action here is logged.</p></div></div>
      <nav className="tabs-row" aria-label="Super admin">
        <NavLink end to="/admin/super">Companies</NavLink>
        <NavLink to="/admin/super/people">People</NavLink>
        <NavLink to="/admin/super/admins">Super Admins</NavLink>
        <NavLink to="/admin/super/log">Log</NavLink>
      </nav>
      <Routes>
        <Route index element={<Companies />} />
        <Route path="people" element={<People />} />
        <Route path="admins" element={<Admins />} />
        <Route path="log" element={<Log />} />
      </Routes>
    </div>
  );
}

function Companies() {
  const { data, error, load } = useOverview();
  const { refresh } = useSession();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); load(); } catch (e) { setErr((e as Error).message); } };
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setLink('');
    try { const r = await api<{ link: string | null }>('/api/super/companies', { method: 'POST', body: { name, ownerEmail } }); if (r.link) setLink(location.origin + r.link); setName(''); setOwnerEmail(''); load(); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  const workIn = async (c: Company) => run(async () => { await api('/api/super/act', { method: 'POST', body: { companyId: c.id } }); await refresh(); nav('/admin'); });
  const invite = async (c: Company) => {
    const email = prompt(`Owner’s email for ${c.name}`);
    if (!email) return;
    await run(async () => { const r = await api<{ link: string }>(`/api/super/companies/${c.id}/owner-invite`, { method: 'POST', body: { email } }); setLink(location.origin + r.link); });
  };
  if (error) return <ErrorNote error={error} retry={load} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      {err && <ErrorNote error={err} />}
      {link && <div className="card ok-card" role="status"><p>Send this owner invite link. It works once and expires in 14 days.</p><div className="row"><input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" /><button className="btn ghost" onClick={() => void navigator.clipboard.writeText(link)}>Copy</button></div></div>}
      <table className="table">
        <thead><tr><th>Company</th><th>Owners and managers</th><th>Staff</th><th>Join code</th><th>Last active</th><th /></tr></thead>
        <tbody>{data.companies.map((c) => (
          <tr key={c.id} className={c.deletedAt ? 'is-deleted' : ''}>
            <td><strong>{c.name}</strong>{c.id === data.workingIn && <small className="muted"> · you’re working here</small>}{c.deletedAt && <small className="error"> · deleted, {daysLeft(c.deletedAt)} days to restore</small>}
              <ul className="store-list">{c.stores.map((st) => (
                <li key={st.id}>{st.name} <small className="muted">· {st.staff} staff · {st.bookReady ? 'designed book' : 'shared library'}</small>{' '}
                  {!c.deletedAt && <button className="link-btn" onClick={() => { const n = prompt('Store name', st.name); if (n && n !== st.name) void run(() => api(`/api/super/stores/${st.id}`, { method: 'PATCH', body: { name: n } })); }}>Rename</button>}</li>
              ))}
              {!c.deletedAt && <li><button className="link-btn" onClick={() => { const n = prompt(`New store for ${c.name}`); if (n) void run(() => api(`/api/super/companies/${c.id}/stores`, { method: 'POST', body: { name: n } })); }}>+ Add Store</button></li>}</ul></td>
            <td>{c.leads}</td><td>{c.staff}</td><td><code>{c.joinCode}</code></td><td>{when(c.lastSeenAt)}</td>
            <td className="row-actions">
              {c.deletedAt
                ? <button className="link-btn" onClick={() => void run(() => api(`/api/super/companies/${c.id}/restore`, { method: 'POST' }))}>Restore</button>
                : <>
                  {c.id !== data.workingIn && <button className="link-btn" onClick={() => void workIn(c)}>Work Here</button>}
                  <button className="link-btn" onClick={() => void invite(c)}>Invite Owner</button>
                  <button className="link-btn" onClick={() => { const n = prompt('New name', c.name); if (n && n !== c.name) void run(() => api(`/api/super/companies/${c.id}`, { method: 'PATCH', body: { name: n } })); }}>Rename</button>
                  <button className="link-btn" onClick={() => { if (confirm(`New join code for ${c.name}? The old one stops working.`)) void run(() => api(`/api/super/companies/${c.id}/join-code`, { method: 'POST' })); }}>New Code</button>
                  <button className="link-btn danger" onClick={() => { const t = prompt(`Delete ${c.name}? Everyone there is signed out. You have 30 days to restore it.\n\nType the company’s name to confirm.`); if (t) void run(() => api(`/api/super/companies/${c.id}`, { method: 'DELETE', body: { confirm: t } })); }}>Delete</button>
                </>}
            </td>
          </tr>
        ))}</tbody>
      </table>
      <form className="card invite-form" onSubmit={add}>
        <Text label="Add a company" value={name} placeholder="Restaurant group name" onChange={setName} />
        <Text label="Owner’s email (optional)" value={ownerEmail} placeholder="owner@theirgroup.com" onChange={setOwnerEmail} />
        <button className="btn" disabled={name.trim().length < 2}>Add Company</button>
      </form>
      <p className="muted small">A new company gets its own team, join code and quiz records. Its book starts with the shared library (classics, spirits, wine, beer, service, safety), with nothing of The Baldwin’s in it. Its managers add their own menu, drinks and story.</p>
    </div>
  );
}

function People() {
  const { data: ov } = useOverview();
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  const [rows, setRows] = useState<Person[] | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Person | null>(null);
  const load = () => { setErr(''); api<{ users: Person[] }>(`/api/super/users?q=${encodeURIComponent(q)}&company=${company}`).then((r) => setRows(r.users)).catch((e) => setErr(e.message)); };
  useEffect(load, [q, company]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); load(); } catch (e) { setErr((e as Error).message); } };
  const signInAs = async (p: Person) => {
    if (!confirm(`Sign in as ${p.name} to see exactly what they see? This is logged. Use “Back to Your Account” at the bottom of the screen to return.`)) return;
    await run(async () => { await api(`/api/super/users/${p.id}/sign-in-as`, { method: 'POST' }); location.assign(p.role === 'staff' ? '/' : '/admin'); });
  };
  return (
    <div className="stack">
      <div className="row filters-row">
        <label className="field grow"><span>Search</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" /></label>
        <label className="field"><span>Company</span><select value={company} onChange={(e) => setCompany(e.target.value)}><option value="">All</option>{ov?.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      {err && <ErrorNote error={err} />}
      {!rows && <Loading />}
      {rows && (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Last seen</th><th /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} className={p.deletedAt ? 'is-deleted' : ''}>
              <td>{p.name}{p.deletedAt && <small className="error"> · deleted, {daysLeft(p.deletedAt)} days to restore</small>}</td>
              <td>{p.email || <span className="muted">PIN</span>}</td><td>{ROLE_LABEL[p.role]}{p.superPrimary && ' (primary)'}</td><td>{p.companyName || '—'}</td><td>{when(p.lastSeenAt)}</td>
              <td className="row-actions">
                {p.deletedAt
                  ? <button className="link-btn" onClick={() => void run(() => api(`/api/super/users/${p.id}/restore`, { method: 'POST' }))}>Restore</button>
                  : <>
                    {p.role !== 'superadmin' && <button className="link-btn" onClick={() => void signInAs(p)}>Sign In As</button>}
                    <button className="link-btn" onClick={() => setEdit(p)}>Edit</button>
                    {p.role === 'staff' && <button className="link-btn" onClick={() => void run(() => api(`/api/super/users/${p.id}/reset-pin`, { method: 'POST' }))}>Reset PIN</button>}
                    {!p.superPrimary && ov?.you !== p.id && <button className="link-btn danger" onClick={() => { if (confirm(`Delete ${p.name}? They’re signed out. You have 30 days to restore them.`)) void run(() => api(`/api/super/users/${p.id}`, { method: 'DELETE' })); }}>Delete</button>}
                  </>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {edit && ov && <EditPerson person={edit} companies={ov.companies.filter((c) => !c.deletedAt)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function EditPerson({ person, companies, onClose, onSaved }: { person: Person; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: person.name, email: person.email || '', role: person.role, companyId: person.companyId ?? '' });
  const [err, setErr] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const body: Record<string, unknown> = {};
    if (f.name !== person.name) body.name = f.name;
    if ((f.email || '') !== (person.email || '') && f.email) body.email = f.email;
    if (f.role !== person.role) body.role = f.role;
    if (String(f.companyId) !== String(person.companyId ?? '')) body.companyId = Number(f.companyId);
    try { await api(`/api/super/users/${person.id}`, { method: 'PATCH', body }); onSaved(); } catch (e2) { setErr((e2 as Error).message); }
  };
  const isSuper = person.role === 'superadmin';
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal stack" role="dialog" aria-modal="true" aria-label={`Edit ${person.name}`} onSubmit={save}>
        <h2>Edit {person.name}</h2>
        <Text label="Name" value={f.name} onChange={(name) => setF({ ...f, name })} />
        {(f.role !== 'staff' || person.email) && <Text label="Email" value={f.email} onChange={(email) => setF({ ...f, email })} />}
        {!isSuper && person.role !== 'staff' && <label className="field"><span>Role</span><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}><option value="owner">Owner</option><option value="manager">Manager</option><option value="staff">Staff</option></select>
          {f.role === 'staff' && <small>As staff they sign in with the join code and pick a new PIN; their password stops working.</small>}</label>}
        {person.role === 'staff' && <p className="muted small">Staff sign in with a PIN. To make them a manager, send an owner or manager invite to their email (Companies → Invite Owner, or their owner’s Team page).</p>}
        {!isSuper && <label className="field"><span>Company</span><select value={String(f.companyId)} onChange={(e) => setF({ ...f, companyId: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <p className="muted small">Saving signs them out everywhere, so the change takes effect right away.</p>
        {err && <ErrorNote error={err} />}
        <div className="row"><button className="btn">Save</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  );
}

function Admins() {
  const { data, error, load } = useOverview();
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const invite = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setLink('');
    try { const r = await api<{ link: string }>('/api/super/admins/invite', { method: 'POST', body: { email } }); setLink(location.origin + r.link); setEmail(''); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  if (error) return <ErrorNote error={error} retry={load} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <p className="muted">Super admins see and change every company. Each one signs in with two-step sign-in. Only the primary super admin adds or removes them.</p>
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Two-step</th><th>Last seen</th><th /></tr></thead>
        <tbody>{data.admins.filter((a) => !a.deletedAt).map((a) => (
          <tr key={a.id}><td>{a.name}{a.superPrimary && <small className="muted"> · primary</small>}{a.id === data.you && <small className="muted"> · you</small>}</td><td>{a.email}</td><td>{a.totpOn ? 'On' : <span className="error">Not set up</span>}</td><td>{when(a.lastSeenAt)}</td>
            <td>{data.youPrimary && !a.superPrimary && <button className="link-btn danger" onClick={() => { if (confirm(`Remove ${a.name} as a super admin?`)) void api(`/api/super/users/${a.id}`, { method: 'DELETE' }).then(load).catch((e) => setErr(e.message)); }}>Remove</button>}</td></tr>
        ))}</tbody>
      </table>
      {data.youPrimary && (
        <form className="card invite-form" onSubmit={invite}>
          <Text label="Add a super admin by email" value={email} placeholder="teammate@growthminded.agency" onChange={setEmail} />
          <button className="btn" disabled={!email.trim()}>Create Invite Link</button>
        </form>
      )}
      {err && <ErrorNote error={err} />}
      {link && <div className="card ok-card" role="status"><p>Send this link. It works once and expires in 14 days. They’ll turn on two-step sign-in before the super admin opens for them.</p><div className="row"><input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" /><button className="btn ghost" onClick={() => void navigator.clipboard.writeText(link)}>Copy</button></div></div>}
    </div>
  );
}

function Log() {
  const [rows, setRows] = useState<{ id: number; action: string; detail: string | null; at: string; name: string | null; company: string | null }[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<{ log: NonNullable<typeof rows> }>('/api/super/log').then((r) => setRows(r.log)).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorNote error={err} />;
  if (!rows) return <Loading />;
  return (
    <table className="table">
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Company</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.name || '—'}</td><td>{r.action}{r.detail ? ` · ${r.detail}` : ''}</td><td>{r.company || '—'}</td></tr>)}</tbody>
    </table>
  );
}
