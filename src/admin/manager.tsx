// Manager home + People (Nov 11). Figma: 09 · Proposals → 24 · Manager home (523:276), People (532:274), job chip open (532:919).
// The Baldwin's look. Tommy, Nov 10: "actions happen on the row where the person shows up, not in a backend table."
// Server: server/team.mjs (+ the /api/path routes in server/index.mjs).
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Store } from '../lib/api';
import { useSession } from '../lib/session';
import { SearchBox } from '../components/SearchBox';
import { useCollections } from './cms';
import { ErrorNote, Loading, Text } from './ui';
import { dayLabel, type Job, type MyPath, type Stage, type Step } from '../path/store';

/* ---------- data ---------- */
type Status = 'behind' | 'new' | 'on-track' | 'done' | 'no-job';
type Next = { id: string; title: string; kind: Step['kind']; due: string; late: boolean; stage: string } | { waiting: true } | null;
type Row = { id: number; name: string; initials: string; jobs: string[]; jobLabel: string; startedOn: string; done: number; total: number; late: number;
  status: Status; next: Next; week: number | null; weeks: number | null; asks: number; lastSeenAt: string | null };
type Ask = { userId: number; name: string; initials: string; jobLabel: string; key: string; title: string; at: string };
type Team = { store: string; company: string | null; joinCode: string | null; you: string; jobs: Job[]; people: Row[]; signoffs: Ask[] };
type Home = Team & {
  certificates: { userId: number; name: string; initials: string; title: string; key: string; earnedAt: string }[];
  quizzes: { taken: number; average: number | null; retakes: number; missed: { q: string; pct: number; asked: number; topic: string; topicLabel: string } | null; teamQuizzes: { id: string; title: string }[] };
  edits: { name: string; what: string; by: string; at: string; to: string | null }[];
  book: { key: string; label: string; count: number; unit: string; to: string }[];
};
type QuizRow = { id: string; title: string; best: number; total: number; attempts: number; lastAt: string; passed: boolean; signedOff: { at: string; by: string | null } | null; signable: boolean };
type Person = MyPath & Row & { hasPin: boolean; createdAt: string; store: string | null; quizzes: QuizRow[]; quizAverage: number | null; certificates: { key: string; title: string; earnedAt: string }[] };

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); return api<T>(path).then(setData).catch((e) => setError((e as Error).message)); };
  useEffect(() => { void load(); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, load, setData };
}
/** Tell the sidebar's Sign-offs count to refresh. */
export const signoffsChanged = () => window.dispatchEvent(new Event('mise:signoffs'));

/* ---------- words and dates (the restaurant's day, Metro Detroit) ---------- */
const DAY = 864e5;
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
const daysFrom = (iso: string) => Math.round((Date.parse(iso.slice(0, 10) + 'T12:00:00Z') - Date.parse(todayIso() + 'T12:00:00Z')) / DAY);
const plusDays = (n: number) => new Date(Date.parse(todayIso() + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const weekday = (iso: string) => dayLabel(iso, { weekday: 'long' });
/** "2 days late", "due today", "due Friday", "due Nov 20". */
export function dueText(due: string, late?: boolean) {
  const d = daysFrom(due);
  if (late || d < 0) return d === -1 ? '1 day late' : d < 0 ? `${-d} days late` : 'late';
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  if (d < 7) return `due ${weekday(due)}`;
  return `due ${dayLabel(due, { month: 'short', day: 'numeric' })}`;
}
/** "today, 4:12 pm", "yesterday", "Nov 8". */
function whenWords(at: string) {
  const local = new Date(at).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
  const d = daysFrom(local);
  const time = new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Detroit' }).toLowerCase();
  if (d === 0) return `today, ${time}`;
  if (d === -1) return 'yesterday';
  return dayLabel(local, { month: 'short', day: 'numeric' });
}
const shortDay = (iso: string) => dayLabel(iso, { weekday: 'short', month: 'short', day: 'numeric' });
const KIND: Record<Step['kind'], string> = { quiz: 'Quiz', read: 'Read', lesson: 'Lesson', signoff: 'Sign-off' };
const STATUS: Record<Status, string> = { behind: 'Behind', new: 'New', 'on-track': 'On track', done: 'Done', 'no-job': 'No job yet' };
const nextLine = (n: Next) => {
  if (!n) return 'Every step is done';
  if ('waiting' in n) return 'Waiting on your sign-off';
  const what = n.kind === 'quiz' && !/quiz/i.test(n.title) ? `${n.title} quiz` : n.title;
  return `${what} · ${dueText(n.due, n.late)}`;
};
const progressLine = (r: Row) => {
  if (!r.jobs.length) return 'Pick their job to start';
  const d = daysFrom(r.startedOn);
  return `${d > 0 ? `Starts ${weekday(r.startedOn)}` : `Week ${r.week} of ${r.weeks}`} · ${r.done} of ${r.total}`;
};

/* ---------- small pieces ---------- */
const Avatar = ({ initials, size }: { initials: string; size?: 'lg' }) => <span className={'mg-av' + (size ? ' ' + size : '')} aria-hidden="true">{initials}</span>;
const Pill = ({ status }: { status: Status }) => <span className={'mg-status ' + status}>{STATUS[status]}</span>;
const Bar = ({ done, total }: { done: number; total: number }) => <span className="mg-bar" aria-hidden="true"><span style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></span>;
const Label = ({ children, id }: { children: ReactNode; id?: string }) => <p className="mg-label" id={id}>{children}</p>;
const Icon = ({ d }: { d: string }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

/** Runs an action, shows "Working…" on its button, and a line of feedback after. */
function useAct() {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ key: string; text: string; error?: boolean } | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); if (ok) setMsg({ key, text: ok }); } catch (e) { setMsg({ key, text: (e as Error).message, error: true }); }
    setBusy('');
  };
  return { busy, msg, run, setMsg };
}
/** Feedback for the actions whose key matches (an exact key, or a test). */
const Feedback = ({ msg, at }: { msg: ReturnType<typeof useAct>['msg']; at: string | ((key: string) => boolean) }) =>
  msg && (typeof at === 'string' ? msg.key === at : at(msg.key)) ? <p className={msg.error ? 'error mg-msg' : 'ok mg-msg'} role={msg.error ? 'alert' : 'status'}>{msg.text}</p> : null;

/* ---------- the dark band: sign-offs waiting on you ---------- */
function SignoffBand({ asks, onDone, title }: { asks: Ask[]; onDone: () => Promise<unknown> | void; title?: string }) {
  const { busy, msg, run } = useAct();
  const act = (a: Ask, sign: boolean) => run(a.key + a.userId, async () => {
    await api(sign ? '/api/path/signoff' : '/api/path/not-yet', { method: 'POST', body: { userId: a.userId, key: a.key } });
    signoffsChanged(); await onDone();
  }, sign ? `${a.name} is signed off.` : `${a.name} sees “not yet” on their path and can ask again.`);
  const n = asks.length;
  return (
    <section className="mh-band" aria-labelledby="mh-band-title">
      <div className="mh-band-head">
        <div>
          <p className="mg-label on-dark">Waiting on you · {n} sign-off{n === 1 ? '' : 's'}</p>
          <h2 id="mh-band-title">{title || (n === 1 ? 'One person is ready for you to watch and sign off' : `${n === 2 ? 'Two' : n === 3 ? 'Three' : n} people are ready for you to watch and sign off`)}</h2>
        </div>
        <p className="mh-band-note">Sign off on the floor or right here</p>
      </div>
      {asks.map((a) => (
        <div key={a.userId + a.key} className="mh-ask">
          <Avatar initials={a.initials} />
          <span className="mh-ask-who"><strong>{a.name}</strong><small>{a.jobLabel}</small></span>
          <span className="mh-ask-what"><strong>{a.title}</strong><small>Asked {whenWords(a.at)}</small></span>
          <span className="mh-ask-btns">
            <button type="button" className="mg-btn dark-ghost" disabled={!!busy} onClick={() => void act(a, false)}>{busy === a.key + a.userId ? '…' : 'Not Yet'}</button>
            <button type="button" className="mg-btn copper" disabled={!!busy} onClick={() => void act(a, true)}>{busy === a.key + a.userId ? 'Signing…' : 'Sign Off'}</button>
          </span>
        </div>
      ))}
      {msg && <p className={msg.error ? 'mh-band-msg error' : 'mh-band-msg'} role={msg.error ? 'alert' : 'status'}>{msg.text}</p>}
    </section>
  );
}

/* ---------- the page title: script line, big heading, counts ---------- */
function PageHead({ script, title, people }: { script: string; title: string; people: Row[] }) {
  const behind = people.filter((p) => p.status === 'behind').length;
  const fine = people.filter((p) => p.status === 'on-track' || p.status === 'new' || p.status === 'done').length;
  return (
    <header className="mg-head">
      <div>
        <p className="mg-script">{script}</p>
        <h1>{title}</h1>
      </div>
      <div className="mg-sum" aria-label="The team at a glance">
        <span className="mg-sum-pill">{people.length} on the team</span>
        <span className="mg-sum-pill ok">{fine} on track</span>
        {behind > 0 && <span className="mg-sum-pill bad">{behind} behind</span>}
      </div>
    </header>
  );
}

/* ================================================================== */
/* Manager home (523:276)                                              */
/* ================================================================== */
export function ManagerHome() {
  const { user } = useSession();
  const { data, error, load } = useLoad<Home>('/api/manager/home');
  useEffect(() => { document.title = 'Home · Mise Academy'; }, []);
  if (error) return <div className="admin-page"><ErrorNote error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="admin-page"><Loading /></div>;
  const hour = Number(new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Detroit' }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = (user?.name || data.you).split(' ')[0];
  return (
    <div className="admin-page mg">
      <div className="mg-top">
        <SearchBox style={{ position: 'relative', flex: '1 1 320px', maxWidth: 520 }} />
        {user?.store?.bookReady && user.store.slug === 'the-baldwin' && <Link className="mg-menu-chip" to="/food-matrix"><span aria-hidden="true" />Opening Menu · Fall 2026</Link>}
      </div>
      <PageHead script={`${dayLabel(todayIso(), { weekday: 'long', month: 'short', day: 'numeric' })} · ${data.store}`} title={`${greet}, ${first}`.toUpperCase()} people={data.people} />
      {data.signoffs.length > 0 && <SignoffBand asks={data.signoffs} onDone={load} />}
      <div className="mh-cols">
        <TeamCard data={data} reload={load} />
        <div className="mh-side">
          <Certificates list={data.certificates} />
          <Quizzes q={data.quizzes} reload={load} />
          <Edits list={data.edits} you={data.you} />
        </div>
      </div>
      <Book tiles={data.book} />
    </div>
  );
}

function TeamCard({ data, reload }: { data: Home; reload: () => Promise<unknown> }) {
  const [filter, setFilter] = useState<'all' | 'behind' | 'new'>('all');
  const firstBehind = data.people.find((p) => p.status === 'behind')?.id ?? null;
  const [open, setOpen] = useState<number | null>(firstBehind);
  const { busy, msg, run } = useAct();
  const list = data.people.filter((p) => filter === 'all' || p.status === filter);
  const count = (s: Status) => data.people.filter((p) => p.status === s).length;
  const remind = (p: Row) => run('r' + p.id, () => api('/api/path/remind', { method: 'POST', body: { userId: p.id } }), `Reminder sent. ${p.name.split(' ')[0]} sees it on My Path next time they open the app.`);
  const more = (p: Row) => run('m' + p.id, async () => { await api('/api/path/more-time', { method: 'POST', body: { userId: p.id } }); await reload(); }, `Late steps are now due ${shortDay(plusDays(3))}.`);
  return (
    <section className="mg-card mh-team" aria-labelledby="mh-team-title">
      <div className="mh-team-head">
        <div><h2 id="mh-team-title">The team</h2><p className="muted">Tap a person to see their path, quizzes and certificates</p></div>
        <div className="mg-chips" role="group" aria-label="Show">
          {([['all', `All ${data.people.length}`], ['behind', `Behind ${count('behind')}`], ['new', `New ${count('new')}`]] as const).map(([k, l]) => (
            <button key={k} type="button" className={'mg-chip' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      {list.length === 0 && <p className="mh-empty">{data.people.length ? 'No one here right now.' : 'No one on the team yet. Share the join code below.'}</p>}
      {list.map((p) => {
        const isOpen = open === p.id;
        return (
          <div key={p.id} className={'mh-person' + (isOpen ? ' open' : '')}>
            <button type="button" className="mh-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
              <Avatar initials={p.initials} />
              <span className="mh-who"><strong>{p.name}</strong><small>{p.jobLabel || 'No job yet'}</small></span>
              <span className="mh-prog"><small>{progressLine(p)}</small><Bar done={p.done} total={p.total} /></span>
              <span className="mh-next"><span className="mg-label">Next</span><small>{nextLine(p.next)}</small></span>
              <Pill status={p.status} />
            </button>
            {isOpen && (
              <div className="mh-actions">
                <button type="button" className="mg-btn dark" disabled={!!busy} onClick={() => void remind(p)}>{busy === 'r' + p.id ? 'Sending…' : 'Send a Reminder'}</button>
                {p.late > 0 && <button type="button" className="mg-btn" disabled={!!busy} onClick={() => void more(p)}>{busy === 'm' + p.id ? 'Saving…' : 'Give More Time'}</button>}
                <Link className="mg-link" to={`/admin/people?id=${p.id}`}>Open Profile →</Link>
                <Feedback msg={msg} at={'r' + p.id} /><Feedback msg={msg} at={'m' + p.id} />
              </div>
            )}
          </div>
        );
      })}
      <div className="mh-team-foot">
        <Link className="mg-btn" to="/admin/people?add=1">Add a Person</Link>
        {data.joinCode && <span className="muted">or share join code <span className="mg-code">{data.joinCode}</span></span>}
        <Link className="mg-link" to="/admin/people">See All People →</Link>
      </div>
    </section>
  );
}

function Certificates({ list }: { list: Home['certificates'] }) {
  const { busy, msg, run } = useAct();
  const [sent, setSent] = useState(false);
  const congrats = () => run('c', async () => { for (const c of list) await api('/api/path/congrats', { method: 'POST', body: { userId: c.userId, cert: c.key } }); setSent(true); },
    list.length === 1 ? 'Sent. It shows on their My Path.' : 'Sent. Each one shows on that person’s My Path.');
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
  return (
    <section className="mg-card mh-certs" aria-labelledby="mh-certs-title">
      <Label>New this week</Label>
      <h2 id="mh-certs-title">{list.length ? `${words[list.length] || list.length} new certificate${list.length === 1 ? '' : 's'}` : 'No new certificates yet'}</h2>
      {list.length === 0 && <p>When someone passes a level’s final (and its practical, where it has one), they show here.</p>}
      {list.map((c) => (
        <Link key={c.userId + c.key} className="mh-cert" to={`/certificate/${c.key}?user=${c.userId}`}>
          <Avatar initials={c.initials} />
          <span><strong>{c.name}</strong><small>{c.title} · {dayLabel(new Date(c.earnedAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }), { month: 'short', day: 'numeric' })}</small></span>
        </Link>
      ))}
      {list.length > 0 && <button type="button" className="mg-btn dark" disabled={!!busy || sent} onClick={() => void congrats()}>{sent ? 'Congrats Sent' : busy ? 'Sending…' : 'Send Congrats'}</button>}
      <Feedback msg={msg} at="c" />
    </section>
  );
}

function Quizzes({ q, reload }: { q: Home['quizzes']; reload: () => Promise<unknown> }) {
  const { busy, msg, run } = useAct();
  const name = q.missed ? `Refresher · ${q.missed.topicLabel}` : '';
  const exists = q.teamQuizzes.some((t) => t.title === name);
  const refresher = () => run('q', async () => { await api('/api/quiz/sets', { method: 'POST', body: { name, topics: [q.missed!.topic], count: 10 } }); await reload(); },
    `“${name}” is on everyone’s Quizzes page now, with sign-offs like the others.`);
  const archive = (id: string, title: string) => { if (confirm(`Archive “${title}”? It leaves everyone’s list. Scores already taken stay.`)) void run('a' + id, async () => { await api('/api/quiz/sets/' + id.slice(2), { method: 'DELETE' }); await reload(); }); };
  return (
    <section className="mg-card mh-quiz" aria-labelledby="mh-quiz-title">
      <Label id="mh-quiz-title">Quizzes this week</Label>
      <div className="mh-stats">
        <span><strong>{q.taken}</strong><small>taken</small></span>
        <span><strong>{q.average === null ? '–' : q.average + '%'}</strong><small>average</small></span>
        <span><strong>{q.retakes}</strong><small>retakes</small></span>
      </div>
      {q.missed && (
        <div className="mh-missed">
          <Label>Most missed</Label>
          <strong>{q.missed.q}</strong>
          <small>{q.missed.pct}% got it right · {q.missed.topicLabel}</small>
          {exists ? <p className="muted small">“{name}” is already on everyone’s list.</p>
            : <button type="button" className="mg-btn" disabled={!!busy} onClick={() => void refresher()}>{busy === 'q' ? 'Adding…' : 'Assign a Refresher'}</button>}
        </div>
      )}
      {q.teamQuizzes.length > 0 && (
        <div className="mh-sets">
          <Label>Team quizzes</Label>
          {q.teamQuizzes.map((t) => <p key={t.id}><span>{t.title}</span><button type="button" className="link-btn danger" onClick={() => archive(t.id, t.title)}>Archive</button></p>)}
        </div>
      )}
      <Feedback msg={msg} at="q" /><Feedback msg={msg} at="a" />
    </section>
  );
}

function Edits({ list, you }: { list: Home['edits']; you: string }) {
  return (
    <section className="mg-card mh-edits" aria-labelledby="mh-edits-title">
      <Label id="mh-edits-title">Your last edits</Label>
      {list.length === 0 && <p className="muted small">Nothing changed in the book yet.</p>}
      {list.map((e) => (
        <div key={e.name + e.at} className="mh-edit">
          {e.to ? <Link to={e.to}><strong>{e.name}</strong> · {e.what}</Link> : <span><strong>{e.name}</strong> · {e.what}</span>}
          <small>{e.by === you ? 'You' : e.by} · {whenWords(e.at).replace(/, .*/, '')}</small>
        </div>
      ))}
      <p className="mh-edits-note">Open any dish, drink or wine and press Edit Page to change it where it lives.</p>
    </section>
  );
}

function Book({ tiles }: { tiles: Home['book'] }) {
  const { user } = useSession();
  const { data: cols } = useCollections();
  const [adding, setAdding] = useState(false);
  const addable = cols ? Object.values(cols.collections).filter((c) => user?.role === 'superadmin' || c.id !== 'classic') : [];
  return (
    <section className="mh-book" aria-labelledby="mh-book-title">
      <h2 id="mh-book-title">Your book</h2>
      <p className="muted">Open a page to change it, or add a new one</p>
      <div className="mh-tiles">
        {tiles.map((t) => (
          <Link key={t.key} className="mh-tile" to={t.to}>
            <span className="mg-label">{t.label}</span><strong>{t.count}</strong><small>{t.unit}</small><span className="mh-open">Open →</span>
          </Link>
        ))}
        <div className="mh-tile add">
          {!adding
            ? <button type="button" onClick={() => setAdding(true)} aria-expanded={false}><span aria-hidden="true">+</span>Add a Page</button>
            : <div className="mh-add-menu" role="group" aria-label="Add a page">
                {addable.map((c) => <Link key={c.id} to={`/admin/pages/${c.id}/new`}>{c.label}</Link>)}
                <button type="button" className="link-btn" onClick={() => setAdding(false)}>Close</button>
              </div>}
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/* People (532:274): Training, Quiz Results and Team in one screen     */
/* ================================================================== */
type Filter = 'all' | 'behind' | 'new' | `job:${string}`;
export function PeoplePage() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const { data, error, load } = useLoad<Team>('/api/manager/team');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(params.get('add') === '1');
  const detail = useRef<HTMLDivElement>(null);
  const sel = Number(params.get('id')) || null;
  useEffect(() => { document.title = 'People · Mise Academy'; }, []);
  if (error) return <div className="admin-page"><ErrorNote error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="admin-page"><Loading /></div>;
  const people = data.people;
  const chosen = people.find((p) => p.id === sel) || people[0] || null;
  const shown = people.filter((p) => (filter === 'all' || (filter.startsWith('job:') ? p.jobs.includes(filter.slice(4)) : p.status === filter)) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));
  const plural: Record<string, string> = { server: 'Servers', bartender: 'Bartenders', host: 'Host', support: 'Support' };
  const chips: [Filter, string, number][] = [['all', 'All', people.length], ['behind', 'Behind', people.filter((p) => p.status === 'behind').length], ['new', 'New', people.filter((p) => p.status === 'new').length],
    ...data.jobs.map((j) => [`job:${j.key}`, plural[j.key] || j.label, people.filter((p) => p.jobs.includes(j.key)).length] as [Filter, string, number]).filter(([, , n]) => n > 0)];
  const pick = (id: number) => {
    setParams({ id: String(id) }, { replace: true });
    if (window.matchMedia('(max-width: 900px)').matches) requestAnimationFrame(() => detail.current?.scrollIntoView({ block: 'start' }));
  };
  const owner = user?.role === 'owner' || user?.role === 'superadmin';
  return (
    <div className="admin-page mg">
      <div className="mg-top">
        <label className="mg-find"><Icon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm10 3-5-5" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" aria-label="Search people" /></label>
      </div>
      <PageHead script={`${data.store} · ${people.length} on the team`} title="PEOPLE" people={people} />
      <div className="pp-cols">
        <section className="mg-card pp-list" aria-label="The team">
          <div className="mg-chips pp-filters" role="group" aria-label="Show">
            {chips.map(([k, l, n]) => <button key={k} type="button" className={'mg-chip' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} {n}</button>)}
          </div>
          {shown.length === 0 && <p className="mh-empty">{people.length ? 'No one matches.' : 'No one on the team yet.'}</p>}
          {shown.map((p) => (
            <button key={p.id} type="button" className={'pp-row' + (chosen?.id === p.id ? ' on' : '')} aria-current={chosen?.id === p.id ? 'true' : undefined} onClick={() => pick(p.id)}>
              <Avatar initials={p.initials} />
              <span className="pp-row-main"><span><strong>{p.name}</strong><small> · {p.jobLabel || 'No job yet'}</small></span><Bar done={p.done} total={p.total} /></span>
              <Pill status={p.status} />
            </button>
          ))}
          <div className="pp-foot">
            <button type="button" className="mg-btn" onClick={() => setAdding(true)}>Add a Person</button>
            {data.joinCode && <p className="muted small">Or they join with code <span className="mg-code">{data.joinCode}</span></p>}
            <Link className="mg-link small" to="/admin/people/managers">{owner ? 'Owners, Managers and Invites →' : 'Owners and Managers →'}</Link>
          </div>
        </section>
        <div ref={detail} className="pp-detail-wrap">
          {chosen ? <PersonPanel key={chosen.id} id={chosen.id} jobs={data.jobs} onChange={load} onGone={() => { setParams({}, { replace: true }); void load(); }} />
            : <section className="mg-card pp-detail"><p className="mh-empty">Pick someone on the left to see their path.</p></section>}
        </div>
      </div>
      {adding && <AddPerson joinCode={data.joinCode} company={data.company} onClose={() => { setAdding(false); if (params.get('add')) setParams({}, { replace: true }); }} onCode={load} />}
    </div>
  );
}

function PersonPanel({ id, jobs, onChange, onGone }: { id: number; jobs: Job[]; onChange: () => Promise<unknown>; onGone: () => void }) {
  const { user } = useSession();
  const nav = useNavigate();
  const [p, setP] = useState<Person | null>(null);
  const [err, setErr] = useState('');
  const [whole, setWhole] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dateEdit, setDateEdit] = useState(false);
  const [showQuizzes, setShowQuizzes] = useState(false);
  const { busy, msg, run } = useAct();
  useEffect(() => { api<Person>(`/api/path/person/${id}`).then(setP).catch((e) => setErr((e as Error).message)); }, [id]);
  if (err && !p) return <section className="mg-card pp-detail"><ErrorNote error={err} /></section>;
  if (!p) return <section className="mg-card pp-detail"><Loading /></section>;
  /** Every person action returns the person as they are now. */
  const act = (key: string, path: string, body: object, ok?: string, method = 'POST') => run(key, async () => {
    setP(await api<Person>(path, { method, body: { userId: p.id, ...body } })); signoffsChanged(); await onChange();
  }, ok);
  const setJob = (key: string) => act('job', `/api/path/person/${p.id}`, { jobs: [key] }, `${p.name.split(' ')[0]} is on the ${jobs.find((j) => j.key === key)?.label} path now.`, 'PATCH');
  const setStart = (date: string) => { setDateEdit(false); void act('date', `/api/path/person/${p.id}`, { startedOn: date }, 'Start date changed. Due dates follow it.', 'PATCH'); };
  const team = (key: string, path: string, method: string, ok: string, after?: () => void) => run(key, async () => { await api(path, { method }); after?.(); }, ok);
  const archive = () => { if (confirm(`Archive ${p.name}? They’re signed out right away and leave the team list. An owner or the Mise team can restore them.`)) void team('arch', `/api/team/${p.id}`, 'DELETE', `${p.name} is archived.`, onGone); };
  const resetPin = () => { if (confirm(`Reset ${p.name}’s PIN? They’re signed out and pick a new PIN next time.`)) void team('pin', `/api/team/${p.id}/reset-pin`, 'POST', `${p.name.split(' ')[0]} picks a new PIN next time they sign in.`); };
  const stores = (user?.canSwitchStore && (user.stores || []).length > 1 ? user.stores : []) as Store[];
  const move = (s: Store) => {
    setMoreOpen(false);
    if (confirm(`Move ${p.name} to ${s.name}? They’re signed out and see ${s.name}’s book next time.`)) void run('move', async () => { await api(`/api/team/${p.id}`, { method: 'PATCH', body: { storeId: s.id } }); onGone(); });
  };
  const path = p.paths[0];
  const steps = p.paths.flatMap((x) => x.stages.flatMap((st) => st.steps));
  const first = p.name.split(' ')[0];
  const lastReminder = (p.notes || []).find((n) => n.kind === 'reminder');
  return (
    <section className="mg-card pp-detail" aria-labelledby="pp-name">
      <div className="pp-head">
        <Avatar initials={p.initials} size="lg" />
        <div className="pp-head-main">
          <p className="pp-title"><span id="pp-name">{p.name}</span><Pill status={p.status} /></p>
          <div className="pp-meta">
            <JobChip jobs={jobs} current={p.jobs} onPick={setJob} busy={busy === 'job'} />
            {dateEdit
              ? <input type="date" className="pp-date" defaultValue={p.startedOn} autoFocus aria-label="Start date" onBlur={(e) => (e.target.value && e.target.value !== p.startedOn ? setStart(e.target.value) : setDateEdit(false))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDateEdit(false); }} />
              : <button type="button" className="pp-started" onClick={() => setDateEdit(true)} title="Change the start date">{daysFrom(p.startedOn) > 0 ? 'Starts' : 'Started'} {dayLabel(p.startedOn, { month: 'short', day: 'numeric' })}</button>}
            {path && <span className="muted">· Week {path.week} of {path.weeks}</span>}
          </div>
        </div>
        <div className="pp-head-btns">
          <button type="button" className="mg-btn dark" disabled={!!busy || !p.jobs.length} onClick={() => void act('remind', '/api/path/remind', {}, `Reminder sent. ${first} sees it on My Path next time they open the app.`)}>{busy === 'remind' ? 'Sending…' : 'Send a Reminder'}</button>
          <div className="pp-more">
            <button type="button" className="mg-btn" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>More</button>
            {moreOpen && (
              <div className="mg-menu" role="menu" onKeyDown={(e) => { if (e.key === 'Escape') setMoreOpen(false); }}>
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setDateEdit(true); }}>Change Start Date</button>
                {p.certificates.map((c) => <button key={c.key} type="button" role="menuitem" onClick={() => nav(`/certificate/${c.key}?user=${p.id}`)}>View {c.title} Certificate</button>)}
                {stores.filter((s) => s.id !== user?.store?.id).map((s) => <button key={s.id} type="button" role="menuitem" onClick={() => move(s)}>Move to {s.name}</button>)}
                <button type="button" role="menuitem" className="danger" onClick={() => { setMoreOpen(false); archive(); }}>Archive</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {lastReminder && !lastReminder.seenAt && <p className="pp-note">Reminder sent {whenWords(lastReminder.at)} · not seen yet</p>}
      <Feedback msg={msg} at={(k) => !k.startsWith('s:')} />
      <div className="pp-stats">
        <span><strong>{p.done} of {p.total}</strong><small>steps done</small></span>
        <span><strong>{p.quizAverage === null ? '–' : p.quizAverage + '%'}</strong><small>quiz average</small></span>
        <span className={p.late ? 'bad' : ''}><strong>{p.late}</strong><small>late</small></span>
        <span><strong>{p.certificates.length}</strong><small>certificate{p.certificates.length === 1 ? '' : 's'}</small></span>
      </div>

      {!p.paths.length && <div className="pp-section"><p className="muted">Pick {first}’s job with the chip above and their path appears here.</p></div>}
      {p.paths.map((jp) => {
        const now = jp.stages.find((st) => st.state === 'now') || jp.stages[jp.stages.length - 1];
        const later = jp.stages.filter((st) => st.state === 'later');
        const shownStages = whole ? jp.stages : [now];
        return (
          <div key={jp.job} className="pp-section pp-path">
            <div className="pp-path-head">
              <div><Label>{jp.label} path</Label>{!whole && <h3>{now.title}</h3>}</div>
              <button type="button" className="mg-btn" onClick={() => setWhole(!whole)} aria-expanded={whole}>{whole ? 'Show This Week' : 'Show Whole Path'}</button>
            </div>
            {shownStages.map((st) => (
              <div key={st.key} className="pp-stage">
                {whole && <p className="pp-stage-title"><strong>{st.title}</strong><small>{st.done} of {st.total} · due {dayLabel(st.due, { month: 'short', day: 'numeric' })}</small></p>}
                {st.steps.map((s) => <StepRow key={s.id} s={s} first={first} busy={busy} act={act} />)}
              </div>
            ))}
            {!whole && later.length > 0 && (
              <div className="pp-coming"><Label>Coming up</Label><p>{later.map((st: Stage) => `${st.title} (${st.done} of ${st.total})`).join(' · ')}</p></div>
            )}
          </div>
        );
      })}
      <Feedback msg={msg} at={(k) => k.startsWith('s:')} />

      <div className="pp-section pp-two">
        <div>
          <Label>Programs</Label>
          {(() => {
            const started = p.programs.filter((g) => g.done > 0 || g.final?.best || g.certified || g.practical?.ask);
            if (!started.length) return <p className="muted small">No program started yet.</p>;
            return started.map((g) => (
              <div key={g.title} className="pp-prog">
                <strong>{g.title}</strong>
                <small>{g.done} of {g.total} lessons · {g.certified ? `${g.cert}` : g.final?.passedAt ? 'final passed' : g.final?.best ? `final best ${g.final.best}` : 'no final yet'}</small>
                <Bar done={g.done} total={g.total} />
                {g.practical && !g.practical.at && g.final?.passedAt && (
                  <div className="pp-prog-row">
                    <small>Practical: {g.practical.title}{g.practical.ask && !g.practical.ask.declinedAt ? ` · asked ${whenWords(g.practical.ask.at)}` : ''}</small>
                    <button type="button" className="mg-btn copper small" disabled={!!busy} onClick={() => void act('s:' + g.practical!.key, '/api/path/signoff', { key: g.practical!.key }, `${first}’s practical is signed off.`)}>Sign Off</button>
                  </div>
                )}
                {g.practical?.at && <small>Practical signed off{g.practical.by ? ` by ${g.practical.by}` : ''} · <button type="button" className="link-btn danger" onClick={() => void act('s:u' + g.practical!.key, '/api/path/signoff', { key: g.practical!.key }, 'Sign-off undone.', 'DELETE')}>Undo</button></small>}
              </div>
            ));
          })()}
        </div>
        <div>
          <Label>Sign-in</Label>
          <p>{p.hasPin ? 'Signs in with a PIN' : 'No PIN yet: they pick one the next time they sign in'}</p>
          <p className="muted small">{p.lastSeenAt ? `Last opened the app ${whenWords(p.lastSeenAt)}` : 'Hasn’t opened the app yet'}</p>
          <div className="pp-btn-row">
            <button type="button" className="mg-btn" disabled={!!busy} onClick={resetPin}>Reset PIN</button>
            <button type="button" className="mg-btn" disabled={!!busy} onClick={archive}>Archive</button>
          </div>
        </div>
      </div>

      <div className="pp-section">
        <button type="button" className="pp-disclose" aria-expanded={showQuizzes} onClick={() => setShowQuizzes(!showQuizzes)}>
          <Label>Every quiz · {p.quizzes.length} taken</Label><span aria-hidden="true">{showQuizzes ? '▴' : '▾'}</span>
        </button>
        {showQuizzes && (p.quizzes.length === 0 ? <p className="muted small">No quizzes taken yet.</p> : (
          <ul className="pp-quizzes">
            {p.quizzes.map((x) => (
              <li key={x.id}>
                <span><strong>{x.title}</strong><small>Best {x.best}/{x.total} · {x.attempts} {x.attempts === 1 ? 'try' : 'tries'}{x.signedOff ? ` · signed off${x.signedOff.by ? ' by ' + x.signedOff.by : ''}` : x.passed ? ' · passed' : ' · not passed yet'}</small></span>
                {x.signable && (x.signedOff
                  ? <button type="button" className="link-btn danger" disabled={!!busy} onClick={() => void act('s:q' + x.id, '/api/path/signoff', { key: x.id }, 'Sign-off undone.', 'DELETE')}>Undo</button>
                  : x.passed ? <button type="button" className="mg-btn small" disabled={!!busy} onClick={() => void act('s:q' + x.id, '/api/path/signoff', { key: x.id }, `${x.title} is signed off.`)}>Sign Off</button> : null)}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}

/** One step on a person's path, with what a manager can do about it right there. */
function StepRow({ s, first, busy, act }: { s: Step; first: string; busy: string; act: (key: string, path: string, body: object, ok?: string, method?: string) => Promise<void> }) {
  const options = [1, 3, 7, 14].map((n) => plusDays(n));
  const [due, setDue] = useState(options[1]);
  const asked = s.ask && !s.ask.declinedAt;
  const icon = s.done ? <span className="pp-icon done" aria-label="Done">✓</span>
    : s.late ? <span className="pp-icon late" aria-label="Late"><Icon d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" /></span>
      : <span className="pp-icon" aria-label="Not done yet" />;
  const sub = s.done
    ? s.kind === 'signoff' ? `Signed off${s.by ? ` by ${s.by}` : ''}` : s.meta
    : s.late ? `Was due ${dayLabel(s.due)}`
      : asked ? `${first} asked ${whenWords(s.ask!.at)}`
        : s.ask?.declinedAt ? `Not yet${s.ask.declinedBy ? `, said ${s.ask.declinedBy}` : ''} · ${s.meta}`
          : s.kind === 'signoff' ? s.meta : `Due ${dayLabel(s.due)}${s.moved ? ' (more time given)' : ''}`;
  return (
    <div className={'pp-step' + (s.late ? ' late' : '') + (s.done ? ' done' : '')}>
      {icon}
      <span className={'pp-kind ' + s.kind}>{KIND[s.kind]}</span>
      <span className="pp-step-main"><strong>{s.to && s.kind !== 'quiz' ? <Link to={s.to}>{s.title}</Link> : s.title}</strong><small>{sub}</small></span>
      <span className="pp-step-end">
        {s.done && s.kind !== 'signoff' && <span className="pp-result">{s.result || 'Done'}</span>}
        {s.done && s.kind === 'signoff' && <button type="button" className="link-btn danger" disabled={!!busy} onClick={() => void act('s:' + s.id, '/api/path/signoff', { key: s.id }, 'Sign-off undone.', 'DELETE')}>Undo</button>}
        {!s.done && s.late && s.kind !== 'signoff' && <>
          <label className="pp-due"><span className="sr-only">New due date</span>
            <select value={due} onChange={(e) => setDue(e.target.value)}>{options.map((o) => <option key={o} value={o}>Due {shortDay(o)}</option>)}</select>
          </label>
          <button type="button" className="mg-btn dark small" disabled={!!busy} onClick={() => void act('s:' + s.id, '/api/path/more-time', { step: s.id, due }, `${s.title} is now due ${shortDay(due)}.`)}>{busy === 's:' + s.id ? 'Saving…' : 'Give More Time'}</button>
        </>}
        {!s.done && s.kind === 'signoff' && <>
          {asked && <button type="button" className="mg-btn small" disabled={!!busy} onClick={() => void act('s:n' + s.id, '/api/path/not-yet', { key: s.id }, `${first} sees “not yet” on their path.`)}>Not Yet</button>}
          <button type="button" className="mg-btn copper small" disabled={!!busy} onClick={() => void act('s:' + s.id, '/api/path/signoff', { key: s.id }, `${s.title}: signed off.`)}>{busy === 's:' + s.id ? 'Signing…' : 'Sign Off'}</button>
        </>}
        {!s.done && !s.late && s.kind !== 'signoff' && <span className="muted small">{s.result ? `Best ${s.result}` : 'Not started'}</span>}
      </span>
    </div>
  );
}

/** The job chip: tap it, pick a job, the path swaps in place (532:919). */
function JobChip({ jobs, current, onPick, busy }: { jobs: Job[]; current: string[]; onPick: (key: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const label = current.map((k) => jobs.find((j) => j.key === k)?.label || k).join(' + ') || 'Pick a Job';
  return (
    <div className="pp-job" ref={box} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button type="button" className="pp-job-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} disabled={busy}>
        {busy ? 'Saving…' : label}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="pp-job-menu">
          <ul role="listbox" aria-label="Job">
            {jobs.map((j) => {
              const on = current.length === 1 && current[0] === j.key;
              return <li key={j.key} role="option" aria-selected={on}><button type="button" onClick={() => { setOpen(false); if (!on) onPick(j.key); }}><span>{j.label}{j.note && <small> · {j.note}</small>}</span>{current.includes(j.key) && <span aria-hidden="true">✓</span>}</button></li>;
            })}
          </ul>
          <p>Changing the job swaps the path. Finished steps carry over.</p>
        </div>
      )}
    </div>
  );
}

/** Add a Person: staff join with the code; owners also invite managers and owners by email. */
function AddPerson({ joinCode, company, onClose, onCode }: { joinCode: string | null; company: string | null; onClose: () => void; onCode: () => Promise<unknown> }) {
  const { user } = useSession();
  const owner = user?.role === 'owner' || user?.role === 'superadmin';
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('manager');
  const [link, setLink] = useState('');
  const { busy, msg, run } = useAct();
  const joinUrl = location.origin + '/';
  const copy = () => { void navigator.clipboard?.writeText(`Join the ${company || 'team'} training app on Mise Academy: ${joinUrl}  Join code: ${joinCode}`); setCopied(true); };
  const invite = (e: FormEvent) => { e.preventDefault(); void run('inv', async () => { const r = await api<{ link: string }>('/api/team/invite', { method: 'POST', body: { email, role } }); setLink(location.origin + r.link); setEmail(''); }); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal pp-add" role="dialog" aria-modal="true" aria-labelledby="pp-add-title">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        <h2 id="pp-add-title">Add a Person</h2>
        <section>
          <Label>Staff</Label>
          <p>They open <strong>{joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</strong> on their phone, type the code, pick their name (or “I’m New Here”) and a PIN. They show up here right away.</p>
          <div className="pp-add-code"><span className="mg-code big">{joinCode || '–'}</span>
            <button type="button" className="mg-btn" onClick={copy}>{copied ? 'Copied' : 'Copy Code and Link'}</button>
            <button type="button" className="link-btn danger" disabled={!!busy} onClick={() => { if (confirm('Make a new join code? The old one stops working. People already signed in stay signed in.')) void run('code', async () => { await api('/api/team/join-code', { method: 'POST' }); await onCode(); }, 'New join code made.'); }}>New Code</button>
          </div>
          <Feedback msg={msg} at="code" />
        </section>
        {owner && (
          <form className="pp-add-invite" onSubmit={invite}>
            <Label>A manager or owner</Label>
            <Text label="Their email" value={email} placeholder="manager@thebaldwinshelby.com" onChange={setEmail} />
            <label className="field"><span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}><option value="manager">Manager: signs people off, edits the book</option><option value="owner">Owner: every store, plus owners and managers</option></select>
            </label>
            <button className="mg-btn dark" disabled={!email.trim() || !!busy}>{busy === 'inv' ? 'Making…' : 'Create Invite Link'}</button>
            <Feedback msg={msg} at="inv" />
            {link && <div className="ok-card card" role="status"><p>Send this link. It works once and expires in 14 days.</p><input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" /></div>}
          </form>
        )}
        {!owner && <p className="muted small">Managers and owners are invited by an owner.</p>}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Sign-offs: everything waiting on a manager                          */
/* ================================================================== */
type QuizPerson = { device: string; name: string; quizzes: Record<string, { best: number; total: number; title?: string }>; signoffs: Record<string, unknown> };
export function SignoffsPage() {
  const team = useLoad<Team>('/api/manager/team');
  const quiz = useLoad<{ people: QuizPerson[] }>('/api/quiz/results');
  const { busy, msg, run } = useAct();
  useEffect(() => { document.title = 'Sign-offs · Mise Academy'; }, []);
  const err = team.error || quiz.error;
  if (err) return <div className="admin-page"><ErrorNote error={err} retry={() => { void team.load(); void quiz.load(); }} /></div>;
  if (!team.data || !quiz.data) return <div className="admin-page"><Loading /></div>;
  const staff = new Set(team.data.people.map((p) => 'u' + p.id));
  // Quizzes someone passed that nobody has signed off yet (the old Quiz Results screen's job).
  const passed = quiz.data.people.filter((p) => staff.has(p.device)).flatMap((p) => Object.entries(p.quizzes)
    .filter(([id, r]) => id !== 'pre-shift' && !p.signoffs[id] && r.best / r.total >= 0.8 && /^(t:|s:)/.test(id) && !id.startsWith('t:final:'))
    .map(([id, r]) => ({ device: p.device, name: p.name, id, title: r.title || id, score: `${r.best}/${r.total}` })));
  // One row per person; single quizzes can also be signed off on their People page (Every quiz).
  const byPerson = [...new Set(passed.map((x) => x.device))].map((d) => ({ device: d, name: passed.find((x) => x.device === d)!.name, list: passed.filter((x) => x.device === d) }));
  const signAll = (g: (typeof byPerson)[number]) => run(g.device, async () => {
    for (const x of g.list) await api('/api/quiz/signoff', { method: 'POST', body: { device: x.device, quiz: x.id } });
    await quiz.load();
  }, `${g.name}: ${g.list.length} quiz${g.list.length === 1 ? '' : 'zes'} signed off.`);
  return (
    <div className="admin-page mg">
      <PageHead script={`${team.data.store} · what’s waiting on you`} title="SIGN-OFFS" people={team.data.people} />
      {team.data.signoffs.length > 0
        ? <SignoffBand asks={team.data.signoffs} onDone={team.load} />
        : <section className="mg-card mh-empty-card"><h2>Nothing waiting on you</h2><p className="muted">When someone taps Ask for a Sign-Off on their path, it shows here and on Home.</p></section>}
      <section className="mg-card so-quizzes" aria-labelledby="so-q">
        <h2 id="so-q">Quizzes passed, not signed off yet</h2>
        <p className="muted">Passing counts on their path already. Sign off once you’ve heard them know it at the table, or one at a time on their People page.</p>
        {byPerson.length === 0 && <p className="muted small">None right now.</p>}
        {byPerson.map((g) => (
          <div key={g.device} className="so-row">
            <span><strong>{g.name}</strong><small>{g.list.map((x) => `${x.title} ${x.score}`).join(' · ')}</small></span>
            <span className="so-btns">
              <Link className="mg-link small" to={`/admin/people?id=${g.device.slice(1)}`}>Open</Link>
              <button type="button" className="mg-btn small" disabled={!!busy} onClick={() => void signAll(g)}>{busy === g.device ? 'Signing…' : g.list.length === 1 ? 'Sign Off' : `Sign Off All ${g.list.length}`}</button>
            </span>
          </div>
        ))}
        {msg && <p className={msg.error ? 'error' : 'ok'} role="status">{msg.text}</p>}
      </section>
    </div>
  );
}

/** The count beside Sign-offs in the sidebar. */
export function useSignoffCount(enabled = true) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const load = () => { api<{ count: number }>('/api/manager/signoffs/count').then((r) => setN(r.count)).catch(() => {}); };
    load();
    window.addEventListener('mise:signoffs', load);
    return () => window.removeEventListener('mise:signoffs', load);
  }, [enabled]);
  return n;
}
