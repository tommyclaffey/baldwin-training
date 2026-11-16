// Company Data (Nov 14): an owner downloads everything the app holds for their company, or asks for it to be deleted.
// The super admin's Deletions tab confirms a request after 7 days (or sooner, typed twice). Server: server/companydata.mjs.
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { ErrorNote, Loading } from './ui';

type Request = { id: number; companyId: number; companyName: string; status: 'pending' | 'cancelled' | 'done'; requestedBy: string | null; requestedAt: string;
  endsAt: string; closedBy: string | null; closedAt: string | null; early: boolean; removed: Record<string, number> | null; daysLeft: number; ready: boolean };
type Counts = { people: number; quizResults: number; signoffs: number; chatMessages: number; prepRecords: number; contentPages: number; uploads: number; activity: number };
type Page = { company: { id: number; name: string }; demo: boolean; byHand?: boolean; counts: Counts; waitDays: number; request: Request | null; lastCancelled: Request | null; lastExport: { at: string; name: string | null } | null };

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
const n = (x: number, one: string, many = one + 's') => `${x.toLocaleString()} ${x === 1 ? one : many}`;

export function CompanyData() {
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api<Page>('/api/company/data').then(setData).catch((e) => setError((e as Error).message)); };
  useEffect(load, []);
  const [busy, setBusy] = useState(false);
  const [dlErr, setDlErr] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const download = async () => {
    setBusy(true); setDlErr('');
    try {
      const res = await fetch('/api/company/export', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || 'The download didn’t work. Try again.');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'company-data.zip';
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      load();
    } catch (e) { setDlErr((e as Error).message); }
    setBusy(false);
  };
  const ask = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    try { await api('/api/company/delete-request', { method: 'POST', body: { confirm } }); setConfirm(''); setMsg('Deletion requested. You can cancel it until the Mise team confirms it.'); load(); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  const cancel = async () => {
    setErr(''); setMsg('');
    try { await api('/api/company/delete-request', { method: 'DELETE' }); setMsg('Request cancelled. Nothing was deleted.'); load(); }
    catch (e2) { setErr((e2 as Error).message); }
  };

  if (error) return <div className="admin-page cd-page"><h1>Company Data</h1><ErrorNote error={error} retry={load} /></div>;
  if (!data) return <Loading />;
  const { company, counts, request, demo } = data;
  const parts = [n(counts.people, 'person', 'people'), n(counts.quizResults, 'quiz result'), n(counts.signoffs, 'sign-off'), n(counts.chatMessages, 'chat message'),
    n(counts.prepRecords, 'prep record'), n(counts.contentPages, 'page'), n(counts.uploads, 'upload'), n(counts.activity, 'activity entry', 'activity entries')];
  return (
    <div className="admin-page cd-page">
      <h1>Company Data</h1>
      <p className="muted">Everything Mise Academy holds for <strong>{company.name}</strong>. Download it any time, or ask for it to be deleted.</p>

      <section className="card stack" aria-labelledby="cd-download">
        <h2 id="cd-download">Download Your Data</h2>
        <p className="cd-lead">One ZIP file with spreadsheets you can open in Excel, Numbers or Google Sheets, and every record as JSON.</p>
        <ul className="cd-counts" aria-label="What’s included">
          {parts.map((p) => { const [num, ...w] = p.split(' '); return <li key={p}><strong>{num}</strong> {w.join(' ')}</li>; })}
          <li className="cd-wide"><strong>All</strong> certificates and training progress</li>
        </ul>
        <p className="muted small">Passwords, PINs and two-step keys are never included. Uploads are listed; the files stay in the app.{demo && ' In the demo, this is the demo’s made-up team.'}</p>
        <div className="cd-actions">
          <button type="button" className="btn" onClick={() => void download()} disabled={busy}>{busy ? 'Preparing…' : 'Download Company Data'}</button>
          {data.lastExport && <span className="muted small">Last downloaded {day(data.lastExport.at)}{data.lastExport.name ? ` by ${data.lastExport.name}` : ''}.</span>}
        </div>
        {dlErr && <ErrorNote error={dlErr} />}
      </section>

      <section className="card stack cd-delete" aria-labelledby="cd-delete">
        <h2 id="cd-delete">Delete Company Data</h2>
        {request ? (
          <div className="cd-pending stack" role="status">
            <p><strong>Deletion requested</strong> by {request.requestedBy || 'an owner'} on {day(request.requestedAt)}.</p>
            {data.byHand
              ? <p>Your company holds the shared library every restaurant reads, so the Mise team will contact you to plan the deletion. Until then, everything works as usual.</p>
              : <p>The Mise team deletes everything on or after <strong>{day(request.endsAt)}</strong>{request.daysLeft > 0 ? ` (${n(request.daysLeft, 'day')} from now)` : ''}, unless you cancel. Until then, everything works as usual.</p>}
            <div><button type="button" className="btn ghost" onClick={() => void cancel()}>Cancel Request</button></div>
          </div>
        ) : (
          <form className="stack" onSubmit={ask}>
            <p className="cd-lead">This removes your people, training records, quiz results, sign-offs, certificates, Team Chat, prep logs, your own pages and uploaded files. It can’t be undone.</p>
            <ol className="cd-steps">
              <li>You ask here. Nothing is deleted yet.</li>
              <li>Your request waits {data.waitDays} days. You can cancel it any time.</li>
              <li>The Mise team confirms it, and everything is deleted.</li>
            </ol>
            <p className="muted small">Want a copy? Download your data first.</p>
            {demo ? <p className="cd-note" role="note">Deleting is switched off in the demo, so the next visitor finds it as you did.</p> : (
              <>
                <label className="field"><span>Type <strong>{company.name}</strong> to confirm</span>
                  <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} /></label>
                <div><button className="btn danger" disabled={!same(confirm, company.name)}>Request Deletion</button></div>
              </>
            )}
          </form>
        )}
        {err && <ErrorNote error={err} />}
        {msg && <p className="ok" role="status">{msg}</p>}
      </section>
    </div>
  );
}

/* ---------- super admin: Deletions ---------- */
type SuperList = { requests: Request[]; waitDays: number; protected: number[]; canDecide?: boolean };

export function Deletions() {
  const [data, setData] = useState<SuperList | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api<SuperList>('/api/super/deletions').then(setData).catch((e) => setError((e as Error).message)); };
  useEffect(load, []);
  const [open, setOpen] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [early, setEarly] = useState(false);
  const [now, setNow] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const pick = (id: number | null) => { setOpen(id); setName(''); setEarly(false); setNow(''); setErr(''); };
  const confirm = async (r: Request, e: FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    try {
      const out = await api<{ removed: Record<string, number> }>(`/api/super/deletions/${r.id}/confirm`, { method: 'POST', body: { confirm: name, now: early, confirmNow: now } });
      setMsg(`${r.companyName}: deleted ${out.removed.users || 0} people and ${out.removed.files || 0} files, with all their records.`); pick(null); load();
    } catch (e2) { setErr((e2 as Error).message); }
  };
  const decline = async (r: Request) => {
    if (!window.confirm(`Cancel ${r.companyName}’s deletion request? Nothing will be deleted.`)) return;
    setErr(''); setMsg('');
    try { await api(`/api/super/deletions/${r.id}/cancel`, { method: 'POST' }); setMsg(`${r.companyName}’s request is cancelled.`); load(); } catch (e2) { setErr((e2 as Error).message); }
  };
  if (error) return <ErrorNote error={error} retry={load} />;
  if (!data) return <Loading />;
  const status = (r: Request) => (r.status === 'done' ? `Deleted ${day(r.closedAt)}${r.early ? ' (early)' : ''}` : r.status === 'cancelled' ? `Cancelled${r.closedBy ? ` by ${r.closedBy}` : ''}`
    : r.ready ? 'Ready to delete' : `Waiting · ${n(r.daysLeft, 'day')} left`);
  return (
    <div className="stack">
      <p className="muted">An owner asks on Company Data, typing the company’s name. Confirm after {data.waitDays} days by typing the name again; sooner needs a second confirmation. Deleting removes every record and file the company owns, and can’t be undone.{data.canDecide ? '' : ' Only the Mise owner confirms or declines a request.'}</p>
      {msg && <p className="ok" role="status">{msg}</p>}
      {err && !open && <ErrorNote error={err} />}
      {data.requests.length === 0 ? <div className="empty"><h3>No deletion requests</h3></div> : (
        <table className="table cd-table">
          <thead><tr><th>Company</th><th>Asked by</th><th>Asked</th><th>Status</th><th /></tr></thead>
          <tbody>{data.requests.map((r) => (
            <tr key={r.id}>
              <td className="cd-co">{r.companyName}</td><td data-label="Asked by">{r.requestedBy || '—'}</td><td data-label="Asked">{day(r.requestedAt)}</td>
              <td data-label="Status"><span className={`cd-status ${r.status === 'pending' ? (r.ready ? 'ready' : 'waiting') : r.status}`}>{status(r)}</span></td>
              {/* Nov 16: only the Mise owner confirms or declines; the rest of the team sees where each request is */}
              <td className="cd-row-actions">{r.status === 'pending' && data.canDecide && (data.protected.includes(r.companyId)
                ? <><span className="muted small">Holds the shared library: can’t be deleted here.</span> <button className="link-btn" onClick={() => void decline(r)}>Decline</button></>
                : <><button className="btn small danger" onClick={() => pick(open === r.id ? null : r.id)} aria-expanded={open === r.id}>Confirm Deletion</button> <button className="link-btn" onClick={() => void decline(r)}>Decline</button></>)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {data.requests.filter((r) => r.id === open).map((r) => (
        <form key={r.id} className="card stack cd-delete" onSubmit={(e) => void confirm(r, e)}>
          <h2>Delete {r.companyName}’s data</h2>
          {!r.ready && <p className="cd-note" role="note">This request waits until {day(r.endsAt)}. Deleting before then needs the second confirmation below.</p>}
          <label className="field"><span>Type <strong>{r.companyName}</strong> to confirm</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} /></label>
          {!r.ready && (
            <>
              <label className="cd-check"><input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} /> Delete now, before the {data.waitDays} days are up</label>
              {early && <label className="field"><span>Type <strong>delete now</strong></span><input value={now} onChange={(e) => setNow(e.target.value)} autoComplete="off" spellCheck={false} /></label>}
            </>
          )}
          {err && <ErrorNote error={err} />}
          <div className="cd-actions">
            <button className="btn danger" disabled={!same(name, r.companyName) || (!r.ready && (!early || !same(now, 'delete now')))}>Delete Everything</button>
            <button type="button" className="btn ghost" onClick={() => pick(null)}>Keep It</button>
          </div>
        </form>
      ))}
    </div>
  );
}
