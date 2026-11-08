// Training (Nov 8, job paths): every staff member's job, start date and where they are in their path. Open a person to see
// each step and sign off what you've watched them do. Figma: 09 · Proposals → 21 (structure map, "Manage → Team").
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Empty, ErrorNote, Loading, when } from './ui';
import type { Job, JobPath, MyPath } from '../path/store';
import { dayLabel, dueWords } from '../path/store';

type Summary = { id: number; name: string; jobs: string[]; startedOn: string; done: number; total: number; late: number; status: 'no-job' | 'done' | 'behind' | 'on-track'; next: { title: string } | null; week: number | null; weeks: number | null };
type Team = { jobs: Job[]; store: string | null; people: Summary[] };
type Person = MyPath & { id: number; name: string };
const STATUS: Record<Summary['status'], string> = { 'no-job': 'No job set', done: 'Done', behind: 'Behind', 'on-track': 'On track' };

export function Training() {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const load = () => { setError(''); api<Team>('/api/path/team').then(setTeam).catch((e) => setError((e as Error).message)); };
  useEffect(load, []);
  return (
    <div className="admin-page">
      <h1>Training{team?.store ? ` · ${team.store}` : ''}</h1>
      <p className="muted">Each person’s job path: what they’ve finished, what’s due and what’s next. Open someone to set their job and start date, and to sign off steps you’ve watched them do.</p>
      {error && <ErrorNote error={error} retry={load} />}
      {!team && !error && <Loading />}
      {team && team.people.length === 0 && <Empty title="No staff yet"><p className="muted">People show here once they join with the store’s code.</p></Empty>}
      {team && team.people.length > 0 && (
        <div className="list">
          {team.people.map((p) => (
            <div key={p.id} className="person">
              <button className="list-row person-head" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                <span className="avatar" aria-hidden="true">{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                <span className="grow">
                  <strong>{p.name}</strong>
                  <small>{p.jobs.length ? `${p.jobs.map((j) => team.jobs.find((x) => x.key === j)?.label || j).join(' + ')} · week ${p.week} of ${p.weeks} · ${p.done} of ${p.total} done` : 'Pick their job to start their path'}</small>
                </span>
                {p.jobs.length > 0 && <span className="tr-bar" aria-hidden="true"><span style={{ width: `${p.total ? Math.round((p.done / p.total) * 100) : 0}%` }} /></span>}
                <span className={'tr-status ' + p.status}>{STATUS[p.status]}{p.late ? ` · ${p.late} late` : ''}</span>
                <span aria-hidden="true">{open === p.id ? '▴' : '▾'}</span>
              </button>
              {open === p.id && <PersonPath id={p.id} jobs={team.jobs} onChange={load} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PersonPath({ id, jobs, onChange }: { id: number; jobs: Job[]; onChange: () => void }) {
  const [p, setP] = useState<Person | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { api<Person>(`/api/path/person/${id}`).then(setP).catch((e) => setErr((e as Error).message)); }, [id]);
  const run = async (key: string, fn: () => Promise<Person>) => {
    setBusy(key); setErr('');
    try { setP(await fn()); onChange(); } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  if (err && !p) return <div className="tr-detail"><ErrorNote error={err} /></div>;
  if (!p) return <div className="tr-detail"><Loading /></div>;
  const toggleJob = (key: string) => {
    const next = p.jobs.includes(key) ? p.jobs.filter((j) => j !== key) : [...p.jobs, key];
    void run('jobs', () => api(`/api/path/person/${id}`, { method: 'PATCH', body: { jobs: next } }));
  };
  const sign = (key: string, on: boolean) => run(key, () => api('/api/path/signoff', { method: on ? 'POST' : 'DELETE', body: { userId: id, key } }));
  return (
    <div className="tr-detail">
      <div className="tr-settings">
        <fieldset className="chips">
          <legend>Job</legend>
          {jobs.map((j) => (
            <label key={j.key} className={'chip' + (p.jobs.includes(j.key) ? ' on' : '')}>
              <input type="checkbox" checked={p.jobs.includes(j.key)} onChange={() => toggleJob(j.key)} disabled={!!busy} />{j.label}
            </label>
          ))}
        </fieldset>
        <label className="tr-date">
          <span>Started</span>
          <input type="date" value={p.startedOn} onChange={(e) => e.target.value && void run('date', () => api(`/api/path/person/${id}`, { method: 'PATCH', body: { startedOn: e.target.value } }))} />
        </label>
      </div>
      {err && <ErrorNote error={err} />}
      {p.paths.map((path: JobPath) => (
        <div key={path.job} className="tr-path">
          {p.paths.length > 1 && <h3>{path.label}</h3>}
          {path.stages.map((st) => (
            <div key={st.key} className="tr-stage">
              <p className="tr-stage-head"><strong>{st.title}</strong><small className={st.late ? 'late' : ''}>Due {dayLabel(st.due, { month: 'short', day: 'numeric' })}{st.state !== 'done' ? ` · ${dueWords(st.due)}` : ''} · {st.done} of {st.total}</small></p>
              <table className="table inner">
                <tbody>
                  {st.steps.map((s) => (
                    <tr key={s.id}>
                      <td className="tr-kind">{s.kind === 'signoff' ? 'Sign-off' : s.kind[0].toUpperCase() + s.kind.slice(1)}</td>
                      <td>{s.title}</td>
                      <td>{s.done ? (s.kind === 'signoff' ? `Signed off${s.by ? ' by ' + s.by : ''} ${when(s.at)}` : `${s.result ? s.result + ' · ' : ''}Done ${when(s.at)}`) : s.result ? `Best ${s.result}, not passed yet` : 'Not done'}</td>
                      <td>{s.kind === 'signoff' && (s.done
                        ? <button className="link-btn danger" onClick={() => void sign(s.id, false)} disabled={!!busy}>Undo</button>
                        : <button className="btn small" onClick={() => void sign(s.id, true)} disabled={!!busy}>{busy === s.id ? 'Signing…' : 'Sign Off'}</button>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
      {!p.paths.length && <p className="muted">Pick a job above and their path appears here.</p>}
      {/* Nov 8: program certificates. Level 2 of the Cocktail Program needs a practical a manager signs off. */}
      {p.programs.some((g) => g.cert) && (
        <div className="tr-stage">
          <p className="tr-stage-head"><strong>Certificates</strong><small>Final exam, plus a practical where the level has one</small></p>
          <table className="table inner">
            <tbody>
              {p.programs.filter((g) => g.cert).map((g) => (
                <tr key={g.title}>
                  <td className="tr-kind">{g.title.replace('Cocktail Program · ', 'Bar · ')}</td>
                  <td>{g.cert}{g.certified ? <> · certified · <a href={`/certificate/${g.certKey}?user=${p.id}`}>View</a></> : ''}</td>
                  <td>{g.final?.passedAt ? `Final passed ${when(g.final.passedAt)}` : g.final?.best ? `Final best ${g.final.best}, not passed yet` : 'Final not taken'}
                    {g.practical && <><br />{g.practical.at ? `Practical signed off${g.practical.by ? ' by ' + g.practical.by : ''} ${when(g.practical.at)}` : `Practical: ${g.practical.how}`}</>}</td>
                  <td>{g.practical && (g.practical.at
                    ? <button className="link-btn danger" onClick={() => void sign(g.practical!.key, false)} disabled={!!busy}>Undo</button>
                    : <button className="btn small" onClick={() => void sign(g.practical!.key, true)} disabled={!!busy}>{busy === g.practical.key ? 'Signing…' : 'Sign Off Practical'}</button>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
