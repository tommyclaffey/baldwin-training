// My Path (Nov 8): the person's job path, stage by stage. Figma: 09 · Proposals → 21 → "My Path · Server · Desktop" (459:72)
// and "· Phone" (461:45). Steps open the real page, quiz or lesson; a sign-off is done by a manager on their phone.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { dayLabel, dueWords, setPath, usePath, reloadPath, type JobPath, type Program, type Stage, type Step } from './store';

const KIND: Record<Step['kind'], string> = { read: 'Read', quiz: 'Quiz', lesson: 'Lesson', signoff: 'Sign-Off' };
const STATUS = { 'on-track': 'On Track', behind: 'Behind', done: 'Done' } as const;

export function MyPathPage() {
  const { user } = useSession();
  const path = usePath(user?.id);
  const [tab, setTab] = useState(0);
  useEffect(() => { document.title = 'My Path · The Training App'; void reloadPath(); }, []);
  if (!path) return <main className="page mp"><div className="loader" /></main>;
  if (!path.paths.length) return <PickJob jobs={path.allJobs} />;
  const p = path.paths[Math.min(tab, path.paths.length - 1)];
  return (
    <main className="page mp" aria-labelledby="mp-title">
      <header className="mp-head">
        <div>
          <p className="mp-script">{p.label} · started {dayLabel(path.startedOn)}</p>
          <h1 id="mp-title">MY PATH</h1>
        </div>
        <div className="mp-pills">
          <span className="mp-pill">Week {p.week} of {p.weeks}</span>
          <span className="mp-pill">{p.done} of {p.total} Done</span>
          <span className={'mp-pill status ' + p.status}>{STATUS[p.status]}</span>
        </div>
      </header>
      {path.paths.length > 1 && (
        <div className="mp-jobs" role="tablist" aria-label="Your jobs">
          {path.paths.map((x, i) => <button key={x.job} role="tab" aria-selected={i === tab} className={'mp-job' + (i === tab ? ' on' : '')} onClick={() => setTab(i)}>{x.label}</button>)}
        </div>
      )}
      <div className="mp-cols">
        <section className="mp-stages" aria-label="Stages">
          {p.stages.map((st, i) => <StageCard key={st.key} stage={st} n={i + 1} open={st.state === 'now'} />)}
        </section>
        <aside className="mp-side">
          <UpNext path={p} />
          {path.programs.length > 0 && (
            <section className="mp-card mp-programs" aria-labelledby="mp-prog">
              <p className="mp-label" id="mp-prog">Your Programs</p>
              <p className="mp-note">Lessons in your path count here too. Go further any time, or redo a lesson.</p>
              {path.programs.map((g) => (
                <Link key={g.title} to={g.to} className="mp-program">
                  <strong>{g.title}</strong>
                  <small>{g.total} lessons · {g.done} done{g.inPath ? ` · ${g.inPath} in your path` : ''}</small>
                  <span className="mp-track" aria-hidden="true"><span style={{ width: `${Math.round((g.done / g.total) * 100)}%` }} /></span>
                  {g.cert && <small className={'mp-cert' + (g.certified ? ' on' : '')}>{certLine(g)}</small>}
                </Link>
              ))}
            </section>
          )}
          <section className="mp-card mp-tint">
            <p className="mp-label">Sign-Offs</p>
            <p>When a step needs a sign-off, ask a manager on shift. They tap it on their phone.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

/** "✓ Certified Bartender", or what's left: the final, the practical. */
function certLine(g: Program) {
  if (g.certified) return `✓ ${g.cert}`;
  const left = [!g.final?.passedAt && 'final exam', g.practical && !g.practical.at && 'practical'].filter(Boolean);
  return `${g.cert}: ${left.join(' and ')} to go`;
}

function StageCard({ stage, n, open: startOpen }: { stage: Stage; n: number; open: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const late = stage.late > 0;
  const dueLine = stage.state === 'done' ? `Due ${dayLabel(stage.due)} · done` : `Due ${dayLabel(stage.due)} · ${dueWords(stage.due)}`;
  return (
    <div className={'mp-stage ' + stage.state + (late ? ' late' : '')}>
      <button type="button" className="mp-stage-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mp-num" aria-hidden="true">{stage.state === 'done' ? '✓' : n}</span>
        <span className="mp-stage-copy"><strong>{stage.title}</strong><small className={late ? 'late' : ''}>{dueLine}</small></span>
        <span className={'mp-count ' + stage.state}>{stage.state === 'done' ? 'Done' : `${stage.done} of ${stage.total}`}</span>
      </button>
      {open
        ? <ol className="mp-steps">{stage.steps.map((s) => <StepRow key={s.id} step={s} />)}</ol>
        : <p className="mp-summary">{stage.steps.map((s) => s.title).join(' · ')}</p>}
    </div>
  );
}

function StepRow({ step: s }: { step: Step }) {
  const label = s.kind === 'quiz' ? 'Start' : s.kind === 'lesson' ? 'Open' : 'Read';
  return (
    <li className={'mp-step' + (s.done ? ' done' : '')}>
      <span className={'mp-tick' + (s.done ? ' on' : '')} aria-label={s.done ? 'Done' : 'Not done yet'}>{s.done ? '✓' : ''}</span>
      <span className="mp-step-copy">
        {/* Nov 8, Tommy: a tag on every row was noise. Only lessons and sign-offs get one, next to the title. */}
        <span className="mp-step-title">
          {s.to ? <Link to={s.to}>{s.title}</Link> : <strong>{s.title}</strong>}
          {(s.kind === 'lesson' || s.kind === 'signoff') && <span className={'mp-kind ' + s.kind}>{KIND[s.kind]}</span>}
        </span>
        <small>{s.done && s.kind === 'signoff' && s.by ? `Signed off by ${s.by}` : s.meta}</small>
      </span>
      {s.done
        ? <span className="mp-result">{s.result || 'Done'}</span>
        : s.to ? <Link className="mp-btn" to={s.to}>{label}</Link> : <span className="mp-wait">Ask a Manager</span>}
    </li>
  );
}

function UpNext({ path: p }: { path: JobPath }) {
  const s = p.next;
  if (!s) return (
    <section className="mp-card mp-next">
      <p className="mp-label">Up Next</p>
      <h2>{p.status === 'done' ? 'Your path is done' : 'Waiting on sign-offs'}</h2>
      <p>{p.status === 'done' ? 'Every step is done. Keep going in the programs.' : 'Ask a manager on shift to sign off what’s left.'}</p>
    </section>
  );
  return (
    <section className="mp-card mp-next">
      <p className="mp-label">Up Next</p>
      <h2>{s.title}</h2>
      <p>{s.meta}</p>
      {s.to && <Link className="mp-btn dark" to={s.to}>{s.kind === 'quiz' ? 'Start Quiz' : s.kind === 'lesson' ? 'Open Lesson' : 'Read It'}</Link>}
    </section>
  );
}

/** No job yet: pick one (a manager can change it later). */
function PickJob({ jobs }: { jobs: { key: string; label: string; note?: string }[] }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const pick = async (key: string) => {
    setBusy(key); setErr('');
    try { setPath(await api('/api/path/jobs', { method: 'POST', body: { jobs: [key] } })); }
    catch (e) { setErr((e as Error).message); setBusy(''); }
  };
  return (
    <main className="page mp" aria-labelledby="mp-title">
      <header className="mp-head"><div><p className="mp-script">Your training, week by week</p><h1 id="mp-title">MY PATH</h1></div></header>
      <section className="mp-card mp-pick">
        <h2>What’s Your Job?</h2>
        <p>Your path is what your job needs to learn, in order, with a due date for each stage. A manager can change it later.</p>
        <div className="mp-pick-row">
          {jobs.map((j) => (
            <button key={j.key} type="button" className="mp-pick-btn" onClick={() => void pick(j.key)} disabled={!!busy}>
              <strong>{busy === j.key ? 'Setting…' : j.label}</strong>{j.note && <small>{j.note}</small>}
            </button>
          ))}
        </div>
        {err && <p role="alert" className="mp-err">{err}</p>}
      </section>
    </main>
  );
}

/** "Mark as Read" at the end of a page that's a step in your path. */
export function PathReadBar({ slug }: { slug: string | undefined }) {
  const { user } = useSession();
  const path = usePath(user?.id);
  const [busy, setBusy] = useState(false);
  if (!path || slug === undefined) return null;
  let hit: { step: Step; stage: Stage; label: string } | null = null;
  for (const p of path.paths) for (const st of p.stages) for (const s of st.steps) if (s.kind === 'read' && s.to === '/' + slug && !hit) hit = { step: s, stage: st, label: p.label };
  if (!hit) return null;
  const { step, stage } = hit;
  const flip = async () => {
    setBusy(true);
    try { await api('/api/path/read', { method: 'POST', body: { slug, done: !step.done } }); await reloadPath(); } catch { /* leave as is */ }
    setBusy(false);
  };
  return (
    <div className="mp-readbar" role="region" aria-label="Your path">
      <p><span>Part of your path</span><strong>{stage.title}</strong></p>
      <div className="mp-readbar-actions">
        <Link to="/my-path">My Path</Link>
        <button type="button" className={'mp-btn' + (step.done ? ' done' : ' dark')} aria-pressed={step.done} onClick={() => void flip()} disabled={busy}>
          {step.done ? '✓ Read' : 'Mark as Read'}
        </button>
      </div>
    </div>
  );
}
