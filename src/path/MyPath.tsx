// My Path (Nov 8): the person's job path, stage by stage. Figma: 09 · Proposals → 21 → "My Path · Server · Desktop" (459:72)
// and "· Phone" (461:45). Steps open the real page, quiz or lesson; a sign-off is done by a manager on their phone.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { currentBrand } from '../lib/theme';
import { dayLabel, dueWords, setPath, usePath, reloadPath, type JobPath, type Note, type Program, type Stage, type Step } from './store';

const KIND: Record<Step['kind'], string> = { read: 'Read', quiz: 'Quiz', lesson: 'Lesson', signoff: 'Sign-Off' };
const STATUS = { 'on-track': 'On Track', behind: 'Behind', done: 'Done' } as const;

export function MyPathPage() {
  const { user } = useSession();
  const path = usePath(user?.id);
  const [tab, setTab] = useState(0);
  useEffect(() => { document.title = 'My Path · Mise Academy'; void reloadPath(); }, []);
  if (!path) return <main className="page mp"><div className="loader" /></main>;
  if (!path.paths.length) return <PickJob jobs={path.allJobs} />;
  const p = path.paths[Math.min(tab, path.paths.length - 1)];
  return (
    <main className="page mp" aria-labelledby="mp-title">
      <header className="mp-head">
        <div>
          <p className="mp-script">{p.label} · started {dayLabel(path.startedOn)}</p>
          <h1 id="mp-title">{currentBrand() === 'mise' ? 'My Path' : 'MY PATH'}</h1>
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
      <Notes notes={(path.notes || []).filter((n) => !n.seenAt)} />
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
                <div key={g.title} className="mp-program-row">
                  <Link to={g.to} className="mp-program">
                    <strong>{g.title}</strong>
                    <small>{g.total} lessons · {g.done} done{g.inPath ? ` · ${g.inPath} in your path` : ''}</small>
                    <span className="mp-track" aria-hidden="true"><span style={{ width: `${Math.round((g.done / g.total) * 100)}%` }} /></span>
                    {g.cert && !g.certified && <small className="mp-cert">{certLine(g)}</small>}
                  </Link>
                  {/* Nov 8 (Figma 469:58): certified levels link to their certificate. */}
                  {g.certified && <p className="mp-cert-row"><span className="mp-cert on">{certLine(g)}</span><Link to={`/certificate/${g.certKey}`}>View Certificate →</Link></p>}
                </div>
              ))}
            </section>
          )}
          <section className="mp-card mp-tint">
            <p className="mp-label">Sign-Offs</p>
            <p>When you’re ready for a sign-off, tap Ask for a Sign-Off. Your manager sees it on their home screen and watches you do it on shift.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

/** "✓ Certified Bartender", or what's left: the final, the practical. */
function certLine(g: Program) {
  if (g.certified) return `✓ ${g.cert}`;
  if (g.invite && !g.invite.at) return 'By invitation · ask your manager';
  const left = [!g.final?.passedAt && 'final exam', g.practical && !g.practical.at && 'practical'].filter(Boolean);
  return `${g.cert}: ${left.join(' and ')} to go`;
}

function StageCard({ stage, n, open: startOpen }: { stage: Stage; n: number; open: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const late = stage.late > 0;
  // Nov 12: a stage past its date with nothing late left (only a sign-off you've asked for, like a signed Training
  // Acknowledgment) isn't "late" for you: it's waiting on your trainer
  const words = dueWords(stage.due);
  const dueLine = stage.state === 'done' ? `Due ${dayLabel(stage.due)} · done`
    : !late && /late/.test(words) ? `Due ${dayLabel(stage.due)} · waiting on a sign\u2011off` : `Due ${dayLabel(stage.due)} · ${words}`;
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
  if (s.ack) return <AckRow step={s} />;
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
        <small>{s.done && s.kind === 'signoff' && s.by ? `Signed off by ${s.by}`
          : !s.done && s.ask && !s.ask.declinedAt ? `Asked ${dayLabel(s.ask.at.slice(0, 10), { month: 'short', day: 'numeric' })} · your manager will watch you on shift`
            : !s.done && s.ask?.declinedAt ? `Not yet${s.ask.declinedBy ? `, said ${s.ask.declinedBy}` : ''}${s.ask.note ? `: “${s.ask.note}”` : ''}. Ask again when you’re ready.`
              : !s.done && s.moved ? `${s.meta} · now due ${dayLabel(s.due)}` : s.meta}</small>
      </span>
      {s.done
        ? <span className="mp-result">{s.result || 'Done'}</span>
        : s.to ? <Link className="mp-btn" to={s.to}>{label}</Link> : <AskButton step={s} />}
    </li>
  );
}

/** Nov 12: the Training Acknowledgment (Day 1). Read and sign it, then it waits for the trainer's sign-off. */
function AckRow({ step: s }: { step: Step }) {
  const signed = s.ack?.signed || null;
  const day = (iso: string) => dayLabel(iso.slice(0, 10), { month: 'short', day: 'numeric' });
  const line = s.done ? `Signed off${s.by ? ` by ${s.by}` : ''}`
    : !signed ? s.meta
      : s.ask?.declinedAt ? `Not yet${s.ask.declinedBy ? `, said ${s.ask.declinedBy}` : ''}${s.ask.note ? `: “${s.ask.note}”` : ''}. Ask again when you’re ready.`
        : `You signed it ${day(signed.at)} · waiting on your trainer`;
  return (
    <li className={'mp-step' + (s.done ? ' done' : '')}>
      <span className={'mp-tick' + (s.done ? ' on' : '')} aria-label={s.done ? 'Done' : 'Not done yet'}>{s.done ? '✓' : ''}</span>
      <span className="mp-step-copy">
        <span className="mp-step-title"><Link to={s.to || '/my-path/acknowledgment'}>{s.title}</Link><span className="mp-kind signoff">{KIND.signoff}</span></span>
        <small>{line}</small>
      </span>
      {s.done ? <span className="mp-result">Done</span>
        : !signed ? <Link className="mp-btn dark" to={s.to || '/my-path/acknowledgment'}>Read and Sign</Link>
          : s.ask?.declinedAt ? <AskButton step={s} />
            : <Link className="mp-btn" to={s.to || '/my-path/acknowledgment'}>View</Link>}
    </li>
  );
}

/** Nov 11: a sign-off step asks the manager (it shows on their home screen); it can be taken back. */
function AskButton({ step: s }: { step: Step }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const asked = !!s.ask && !s.ask.declinedAt;
  const flip = async () => {
    setBusy(true); setErr('');
    try { setPath(await api('/api/path/ask', { method: asked ? 'DELETE' : 'POST', body: { key: s.id } })); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <span className="mp-ask">
      <button type="button" className={'mp-btn' + (asked ? '' : ' dark')} onClick={() => void flip()} disabled={busy} aria-pressed={asked}>
        {busy ? '…' : asked ? 'Take Back' : s.ask?.declinedAt ? 'Ask Again' : 'Ask for a Sign-Off'}
      </button>
      {err && <small role="alert" className="mp-err">{err}</small>}
    </span>
  );
}

/** Nov 11: a reminder or a congrats from a manager, until it's closed. */
function Notes({ notes }: { notes: Note[] }) {
  if (!notes.length) return null;
  const close = async (id: number) => { await api('/api/path/notes/seen', { method: 'POST', body: { id } }).catch(() => {}); await reloadPath(); };
  return (
    <div className="mp-notes">
      {notes.map((n) => (
        <section key={n.id} className={'mp-card mp-mnote ' + n.kind} role="status">
          <p className="mp-label">{n.kind === 'congrats' ? 'Congrats' : 'A reminder'}{n.by ? ` from ${n.by}` : ''} · {dayLabel(n.at.slice(0, 10), { month: 'short', day: 'numeric' })}</p>
          <p>{n.body}</p>
          <button type="button" className="mp-btn" onClick={() => void close(n.id)}>Got It</button>
        </section>
      ))}
    </div>
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
      {s.to && <Link className="mp-btn dark" to={s.to}>{s.ack ? 'Read and Sign' : s.kind === 'quiz' ? 'Start Quiz' : s.kind === 'lesson' ? 'Open Lesson' : 'Read It'}</Link>}
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
      <header className="mp-head"><div><p className="mp-script">Your training, week by week</p><h1 id="mp-title">{currentBrand() === 'mise' ? 'My Path' : 'MY PATH'}</h1></div></header>
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
