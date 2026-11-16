// Super admin: every company and person, "sign in as" for support, the Mise team, and the action log.
// Only super admins with two-step sign-in reach this; the server answers "not found" to everyone else.
// Nov 16: each teammate has a role (Owner · Manager · Support, server/miseteam.mjs). The server checks every action;
// these screens only show what your role can do (`can`, from /api/super/overview), so there are no dead buttons.
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ROLE_LABEL, TEAM_ROLE_LABEL, type MailStatus, type Role, type TeamRole } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNote, InviteSentCard, Loading, ResetLinkCard, Text, when, type ResetLink } from './ui';
import { Deletions } from './companydata';
import { ErrorLog } from './hq';

type Look = { id: string; name: string; custom: boolean };
type Plan = { id: string; name: string; customLook: boolean };
type Company = { id: number; name: string; slug: string; joinCode: string; createdAt: string; deletedAt: string | null; leads: number; staff: number; lastSeenAt: string | null; stores: { id: number; name: string; bookReady: boolean; staff: number }[];
  demo: boolean; hq: boolean; plan: string; look: string; drawnIn: string; looks: Look[] };
type Person = { id: number; name: string; email: string | null; role: Role; companyId: number | null; companyName: string | null; createdAt: string; lastSeenAt: string | null; deletedAt: string | null; hasPin: boolean; totpOn: boolean; superPrimary: boolean;
  teamRole: TeamRole | null };
type Can = Record<'view' | 'work' | 'signInAs' | 'log' | 'planLook' | 'resetPassword' | 'resetPin' | 'inviteOwner' | 'addCompany' | 'editCompany' | 'editPerson' | 'removePerson' | 'library' | 'change' | 'deleteCompany' | 'deletions' | 'team', boolean>;
type TeamInvite = { id: string; email: string; teamRole: TeamRole; createdAt: string; expiresAt: string };
type Overview = { companies: Company[]; admins: Person[]; teamInvites: TeamInvite[]; you: number; youPrimary: boolean; youRole: TeamRole; can: Can; workingIn: number; plans: Plan[];
  teamRoles: { id: TeamRole; name: string; givable: boolean }[] };
/** What each Mise team role does, in one line (Mise Team tab and the invite form). */
const ROLE_LINE: Record<TeamRole, string> = {
  owner: 'Everything, and the only one who adds, removes and changes the team',
  manager: 'Looks up any account, Work Here and Sign In As, plans and looks, passwords and PINs, owner invites',
  support: 'Looks up any account and its people, Work Here and Sign In As to see what they see. Changes nothing',
};

function useOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api<Overview>('/api/super/overview').then(setData).catch((e) => setError(e.message)); };
  useEffect(load, []);
  return { data, error, load };
}
const daysLeft = (iso: string | null) => (iso ? Math.max(0, 30 - Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : 0);

export function SuperAdmin() {
  const { user, legal } = useSession();
  if (user?.role !== 'superadmin' || user.impersonatedBy) return <div className="admin-page"><h1>Nothing here</h1></div>;
  if (!user.totpOn) return (
    <div className="admin-page narrow">
      <h1>Super admin</h1>
      <p className="error" role="alert">Turn on two-step sign-in first. It’s required for super admins.</p>
      <NavLink className="btn" to="/admin/account">Turn It On</NavLink>
    </div>
  );
  const role = user.teamRole || 'support';
  return (
    <div className="admin-page">
      <div className="editor-head"><div><h1>Super admin</h1><p className="muted">Every company and person in the app. Every action here is logged. You’re <strong>{TEAM_ROLE_LABEL[role]}</strong> on the Mise team{role === 'support' ? ': you can look at everything and change nothing' : ''}.</p></div></div>
      {/* Nov 16: Privacy, Terms and Help wait on four blanks in content/legal.md; only super admins can open the drafts */}
      {!legal.public && <p className="muted small legal-draft-note">Privacy, Terms and Help are drafts, hidden from everyone else: preview <a href="/privacy">Privacy</a>, <a href="/terms">Terms</a> and <a href="/help">Help</a>. They go public, with their links, when the blanks at the top of <code>content/legal.md</code> are filled; each preview lists the ones still empty.</p>}
      <nav className="tabs-row" aria-label="Super admin">
        <NavLink end to="/admin/super">Companies</NavLink>
        <NavLink to="/admin/super/people">People</NavLink>
        <NavLink to="/admin/super/team">Mise Team</NavLink>
        <NavLink to="/admin/super/deletions">Deletions</NavLink>
        <NavLink to="/admin/super/log">Log</NavLink>
        <NavLink to="/admin/super/errors">Error Log</NavLink>
      </nav>
      <Routes>
        <Route index element={<Companies />} />
        <Route path="people" element={<People />} />
        <Route path="team" element={<MiseTeam />} />
        <Route path="admins" element={<Navigate to="/admin/super/team" replace />} />
        <Route path="deletions" element={<Deletions />} />
        <Route path="log" element={<Log />} />
        <Route path="errors" element={<ErrorLog />} />
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
  const { mailOn } = useSession();
  type Made = { link: string; email: string; days: number; mail: MailStatus | null };
  const [link, setLink] = useState<Made | null>(null);
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); load(); } catch (e) { setErr((e as Error).message); } };
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setLink(null);
    try { const r = await api<{ link: string | null; email: string | null; days: number; mail: MailStatus | null }>('/api/super/companies', { method: 'POST', body: { name, ownerEmail } }); if (r.link) setLink({ link: location.origin + r.link, email: r.email || ownerEmail, days: r.days, mail: r.mail }); setName(''); setOwnerEmail(''); load(); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  const workIn = async (c: Company) => run(async () => { await api('/api/super/act', { method: 'POST', body: { companyId: c.id } }); await refresh(); nav('/admin'); });
  const invite = async (c: Company) => {
    const email = prompt(`Owner’s email for ${c.name}`);
    if (!email) return;
    await run(async () => { setLink(null); const r = await api<{ link: string; email: string; days: number; mail: MailStatus }>(`/api/super/companies/${c.id}/owner-invite`, { method: 'POST', body: { email } }); setLink({ link: location.origin + r.link, email: r.email, days: r.days, mail: r.mail }); });
  };
  // Nov 16: the HQ home's Add Company button lands on the form
  useEffect(() => {
    if (!data || location.hash !== '#add-company') return;
    const f = document.getElementById('add-company');
    f?.scrollIntoView({ block: 'center' }); f?.querySelector('input')?.focus();
  }, [data]);
  if (error) return <ErrorNote error={error} retry={load} />;
  if (!data) return <Loading />;
  const can = data.can;
  return (
    <div className="stack">
      {err && <ErrorNote error={err} />}
      {link && <InviteSentCard link={link.link} email={link.email} mail={link.mail} days={link.days} note="It’s an owner invite." onDone={() => setLink(null)} />}
      <table className="table">
        <thead><tr><th>Company</th><th>Plan and Look</th><th>Owners and managers</th><th>Staff</th><th>Join code</th><th>Last active</th><th /></tr></thead>
        <tbody>{data.companies.map((c) => (
          <tr key={c.id} className={c.deletedAt ? 'is-deleted' : ''}>
            <td><strong>{c.name}</strong>{c.hq && <small className="hq-tag">HQ</small>}{c.id === data.workingIn && <small className="muted"> · you’re working here</small>}{c.deletedAt && <small className="error"> · deleted, {daysLeft(c.deletedAt)} days to restore</small>}
              <ul className="store-list">{c.stores.map((st) => (
                <li key={st.id}>{st.name} <small className="muted">· {st.staff} staff · {st.bookReady ? 'designed book' : 'shared library'}</small>{' '}
                  {!c.deletedAt && can.editCompany && <button className="link-btn" onClick={() => { const n = prompt('Store name', st.name); if (n && n !== st.name) void run(() => api(`/api/super/stores/${st.id}`, { method: 'PATCH', body: { name: n } })); }}>Rename</button>}</li>
              ))}
              {!c.deletedAt && can.editCompany && <li><button className="link-btn" onClick={() => { const n = prompt(`New store for ${c.name}`); if (n) void run(() => api(`/api/super/companies/${c.id}/stores`, { method: 'POST', body: { name: n } })); }}>+ Add Store</button></li>}</ul></td>
            <td><PlanLook c={c} plans={data.plans} canChange={can.planLook} onChange={(body) => run(() => api(`/api/super/companies/${c.id}`, { method: 'PATCH', body }))} /></td>
            <td>{c.leads}</td><td>{c.staff}</td><td><code>{c.joinCode}</code></td><td>{when(c.lastSeenAt)}</td>
            <td className="row-actions">
              {c.deletedAt
                ? can.editCompany && <button className="link-btn" onClick={() => void run(() => api(`/api/super/companies/${c.id}/restore`, { method: 'POST' }))}>Restore</button>
                : <>
                  {c.id !== data.workingIn && can.work && <button className="link-btn" onClick={() => void workIn(c)}>Work Here</button>}
                  {!c.hq && can.inviteOwner && <button className="link-btn" onClick={() => void invite(c)}>Invite Owner</button>}
                  {can.editCompany && <button className="link-btn" onClick={() => { const n = prompt('New name', c.name); if (n && n !== c.name) void run(() => api(`/api/super/companies/${c.id}`, { method: 'PATCH', body: { name: n } })); }}>Rename</button>}
                  {!c.hq && can.editCompany && <button className="link-btn" onClick={() => { if (confirm(`New join code for ${c.name}? The old one stops working.`)) void run(() => api(`/api/super/companies/${c.id}/join-code`, { method: 'POST' })); }}>New Code</button>}
                  {!c.hq && can.deleteCompany && <button className="link-btn danger" onClick={() => { const t = prompt(`Delete ${c.name}? Everyone there is signed out. You have 30 days to restore it.\n\nType the company’s name to confirm.`); if (t) void run(() => api(`/api/super/companies/${c.id}`, { method: 'DELETE', body: { confirm: t } })); }}>Delete</button>}
                </>}
            </td>
          </tr>
        ))}</tbody>
      </table>
      {can.addCompany && <form className="card invite-form" id="add-company" onSubmit={add}>
        <Text label="Add a company" value={name} placeholder="Restaurant group name" onChange={setName} />
        <Text label="Owner’s email (optional)" value={ownerEmail} placeholder="owner@theirgroup.com" onChange={setOwnerEmail} />
        <button className="btn" disabled={name.trim().length < 2}>{ownerEmail.trim() && mailOn ? 'Add Company and Send Invite' : 'Add Company'}</button>
      </form>}
      <p className="muted small">A new company gets its own team, join code and quiz records, on the Foundation plan in the Mise Academy look. Its book starts with the shared library (classics, spirits, wine, beer, service, safety), with nothing of The Baldwin’s in it. Its managers add their own menu, drinks and story. A restaurant’s own look comes with the Custom Brand plan, once that look is built for them.</p>
    </div>
  );
}

/** Plan and look for one company (Nov 16, Tommy: "custom brand is an upgraded tier"). The look list holds Mise Academy and
 *  any custom look made for this company; a custom look needs the Custom Brand plan. Demo copies keep the look they were
 *  made with. */
function PlanLook({ c, plans, canChange, onChange }: { c: Company; plans: Plan[]; canChange: boolean; onChange: (body: { plan?: string; look?: string }) => void }) {
  const lookName = (id: string) => c.looks.find((l) => l.id === id)?.name || 'Mise Academy';
  if (c.demo) return <small className="muted">Demo · {lookName(c.drawnIn)}</small>;
  if (c.hq) return <small className="muted">Mise’s own · Mise Academy</small>;
  const plan = plans.find((p) => p.id === c.plan);
  if (!canChange) return <small className="muted">{plan?.name || c.plan} · {lookName(c.drawnIn)}</small>;
  const pickPlan = (id: string) => {
    const next = plans.find((p) => p.id === id);
    const custom = c.looks.find((l) => l.id === c.look)?.custom;
    if (next && !next.customLook && custom && !confirm(`Move ${c.name} to ${next.name}? Everyone there sees the Mise Academy look from their next page.`)) return;
    onChange({ plan: id });
  };
  return (
    <div className="plan-look">
      <select aria-label={`${c.name}’s plan`} value={c.plan} disabled={!!c.deletedAt} onChange={(e) => pickPlan(e.target.value)}>
        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select aria-label={`${c.name}’s look`} value={c.look} disabled={!!c.deletedAt} onChange={(e) => onChange({ look: e.target.value })}>
        {c.looks.map((l) => <option key={l.id} value={l.id} disabled={l.custom && !plan?.customLook}>{l.name}{l.custom && !plan?.customLook ? ' (Custom Brand)' : ''}</option>)}
      </select>
      {c.looks.length < 2 && <small className="muted">No custom look built yet</small>}
    </div>
  );
}

function People() {
  const { data: ov } = useOverview();
  const [params] = useSearchParams(); // Nov 16: the HQ home's search box lands here with ?q=
  const [q, setQ] = useState(params.get('q') || '');
  const [company, setCompany] = useState('');
  const [rows, setRows] = useState<Person[] | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Person | null>(null);
  const [reset, setReset] = useState<ResetLink | null>(null);
  const load = () => { setErr(''); api<{ users: Person[] }>(`/api/super/users?q=${encodeURIComponent(q)}&company=${company}`).then((r) => setRows(r.users)).catch((e) => setErr(e.message)); };
  useEffect(load, [q, company]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); load(); } catch (e) { setErr((e as Error).message); } };
  // Reset Password (Nov 11): a one-time link for anyone who signs in with email. Another super admin's only from the primary.
  const can = ov?.can;
  const canReset = (p: Person) => !!can?.resetPassword && !!p.email && p.role !== 'staff' && p.id !== ov?.you && (p.role !== 'superadmin' || (!!ov?.youPrimary && !p.superPrimary));
  // Teammates are the Owner's to change; everyone else follows your role.
  const mayEdit = (p: Person) => (p.role === 'superadmin' && p.id !== ov?.you ? !!can?.team : !!can?.editPerson || p.id === ov?.you);
  const mayRemove = (p: Person) => (p.role === 'superadmin' ? !!can?.team : !!can?.removePerson);
  const makeReset = (p: Person) => {
    if (!confirm(`Make a password reset link for ${p.name}? Their password keeps working until they use the link. This is logged.`)) return;
    void run(async () => { setReset(null); setReset(await api<ResetLink>(`/api/super/users/${p.id}/reset-password`, { method: 'POST' })); });
  };
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
      {reset && <ResetLinkCard reset={reset} onClose={() => setReset(null)} />}
      {!rows && <Loading />}
      {rows && (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Last seen</th><th /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} className={p.deletedAt ? 'is-deleted' : ''}>
              <td>{p.name}{p.deletedAt && <small className="error"> · deleted, {daysLeft(p.deletedAt)} days to restore</small>}</td>
              <td>{p.email || <span className="muted">PIN</span>}</td><td>{p.teamRole ? `Mise ${TEAM_ROLE_LABEL[p.teamRole]}` : ROLE_LABEL[p.role]}</td><td>{p.companyName || '—'}</td><td>{when(p.lastSeenAt)}</td>
              <td className="row-actions">
                {p.deletedAt
                  ? mayRemove(p) && <button className="link-btn" onClick={() => void run(() => api(`/api/super/users/${p.id}/restore`, { method: 'POST' }))}>Restore</button>
                  : <>
                    {p.role !== 'superadmin' && can?.signInAs && <button className="link-btn" onClick={() => void signInAs(p)}>Sign In As</button>}
                    {mayEdit(p) && <button className="link-btn" onClick={() => setEdit(p)}>Edit</button>}
                    {p.role === 'staff' && can?.resetPin && <button className="link-btn" onClick={() => void run(() => api(`/api/super/users/${p.id}/reset-pin`, { method: 'POST' }))}>Reset PIN</button>}
                    {canReset(p) && <button className="link-btn" onClick={() => makeReset(p)}>Reset Password</button>}
                    {!p.superPrimary && ov?.you !== p.id && mayRemove(p) && <button className="link-btn danger" onClick={() => { if (confirm(`Delete ${p.name}? They’re signed out. You have 30 days to restore them.`)) void run(() => api(`/api/super/users/${p.id}`, { method: 'DELETE' })); }}>Delete</button>}
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
        {person.role === 'staff' && <p className="muted small">Staff sign in with a PIN. To make them a manager, use Promote to Manager on their People page (Companies → Work Here, then People). They keep their training and history.</p>}
        {!isSuper && <label className="field"><span>Company</span><select value={String(f.companyId)} onChange={(e) => setF({ ...f, companyId: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <p className="muted small">Saving signs them out everywhere, so the change takes effect right away.</p>
        {err && <ErrorNote error={err} />}
        <div className="row"><button className="btn">Save</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  );
}

/** Mise Team (Nov 16): Mise Academy (HQ)'s people. Everyone sees the list; only the Owner invites, changes roles and removes. */
function MiseTeam() {
  const { data, error, load } = useOverview();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('support');
  const { mailOn } = useSession();
  const [made, setMade] = useState<{ link: string; email: string; teamRole: TeamRole; days: number; mail: MailStatus } | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setErr(''); setNote(''); try { await fn(); if (ok) setNote(ok); load(); } catch (e) { setErr((e as Error).message); } };
  const invite = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setNote(''); setMade(null);
    try { const r = await api<{ link: string; email: string; teamRole: TeamRole; days: number; mail: MailStatus }>('/api/super/admins/invite', { method: 'POST', body: { email, teamRole: role } }); setMade({ ...r, link: location.origin + r.link }); setEmail(''); load(); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  if (error) return <ErrorNote error={error} retry={load} />;
  if (!data) return <Loading />;
  const owner = data.can.team;
  const team = data.admins.filter((a) => !a.deletedAt);
  const changeRole = (a: Person, next: TeamRole) => {
    if (!confirm(`Make ${a.name} ${TEAM_ROLE_LABEL[next]}? They’re signed out and sign back in with the new role.`)) return;
    void run(() => api(`/api/super/users/${a.id}`, { method: 'PATCH', body: { teamRole: next } }), `${a.name} is ${TEAM_ROLE_LABEL[next]} now.`);
  };
  return (
    <div className="stack">
      <p className="muted">The people at Mise Academy (HQ) who help customers. Everyone signs in with two-step sign-in, and every action is in the Log with their name and role. {owner ? 'Only you add, remove and change teammates.' : 'Only the owner adds, removes and changes teammates.'}</p>
      <ul className="team-roles" aria-label="What each role can do">
        {data.teamRoles.map((r) => <li key={r.id}><strong>{r.name}</strong><span>{ROLE_LINE[r.id]}</span></li>)}
      </ul>
      {note && <p className="ok" role="status">{note}</p>}
      {err && <ErrorNote error={err} />}
      <table className="table team-table stack-table">
        <thead><tr><th>Name</th><th>Role</th><th>Two-step</th><th>Last seen</th>{owner && <th />}</tr></thead>
        <tbody>{team.map((a) => (
          <tr key={a.id}>
            <td><strong>{a.name}</strong>{a.id === data.you && <small className="muted"> · you</small>}<br /><small className="muted team-email">{a.email}</small></td>
            <td data-label="Role">{owner && !a.superPrimary
              ? <select aria-label={`${a.name}’s role`} value={a.teamRole || 'support'} onChange={(e) => changeRole(a, e.target.value as TeamRole)}>
                  {data.teamRoles.filter((r) => r.givable).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              : <span className={`team-role ${a.teamRole}`}>{TEAM_ROLE_LABEL[a.teamRole || 'support']}</span>}</td>
            <td data-label="Two-step">{a.totpOn ? 'On' : <span className="error">Not set up</span>}</td>
            <td data-label="Last seen">{when(a.lastSeenAt)}</td>
            {owner && <td className="row-actions">{!a.superPrimary && <button className="link-btn danger" onClick={() => { if (confirm(`Remove ${a.name} from the Mise team? They’re signed out right away. You have 30 days to restore them (People).`)) void run(() => api(`/api/super/users/${a.id}`, { method: 'DELETE' }), `${a.name} is off the team.`); }}>Remove</button>}</td>}
          </tr>
        ))}</tbody>
      </table>
      {owner && (
        <>
          <form className="card invite-form" onSubmit={invite}>
            <Text label="Add a teammate by email" value={email} placeholder="teammate@miseacademy.app" onChange={setEmail} />
            <label className="field"><span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                {data.teamRoles.filter((r) => r.givable).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <button className="btn" disabled={!email.trim()}>{mailOn ? 'Send Invite' : 'Create Invite Link'}</button>
          </form>
          {made && <InviteSentCard link={made.link} email={made.email} mail={made.mail} days={made.days} note={`${TEAM_ROLE_LABEL[made.teamRole]} on the Mise team. They turn on two-step sign-in before anything opens for them.`} onDone={() => setMade(null)} />}
          {data.teamInvites.length > 0 && (
            <>
              <h2 className="sub">Open invites</h2>
              <table className="table stack-table">
                <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th /></tr></thead>
                <tbody>{data.teamInvites.map((i) => (
                  <tr key={i.id}><td>{i.email}</td><td data-label="Role">{TEAM_ROLE_LABEL[i.teamRole]}</td><td data-label="Expires">{when(i.expiresAt)}</td>
                    <td className="row-actions"><button className="link-btn danger" onClick={() => void run(() => api(`/api/super/admins/invites/${i.id}`, { method: 'DELETE' }), 'Invite cancelled.')}>Cancel</button></td></tr>
                ))}</tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Log() {
  const [rows, setRows] = useState<{ id: number; action: string; detail: string | null; at: string; name: string | null; teamRole: TeamRole | null; company: string | null }[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<{ log: NonNullable<typeof rows> }>('/api/super/log').then((r) => setRows(r.log)).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorNote error={err} />;
  if (!rows) return <Loading />;
  // Who did it, and their Mise team role at the time (Nov 16)
  return (
    <table className="table">
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Company</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.name || '—'}{r.teamRole && <><br /><small className="muted">{TEAM_ROLE_LABEL[r.teamRole]}</small></>}</td><td>{r.action}{r.detail ? ` · ${r.detail}` : ''}</td><td>{r.company || '—'}</td></tr>)}</tbody>
    </table>
  );
}
