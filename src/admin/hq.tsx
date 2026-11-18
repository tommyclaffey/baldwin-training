// The Mise HQ home (Nov 16, Figma 09 · Proposals → 32: desktop 699:880, Sign In As picker 708:920, phone 714:961 and the
// picker as a bottom sheet 716:1016). Tommy: "there's nothing for me to interact with. There's no page or anything." A super
// admin working in Mise Academy (HQ) opens Admin here: Waiting on you, Health, Companies, Recent Activity, New This Week and
// the Mise Team. Real data only (server/hqhome.mjs). The design's "Example" rows are left out; where there's nothing,
// the section says so.
// Buttons follow the teammate's Mise role (`can`): Support sees everything and changes nothing (the server refuses anyway).
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { api, TEAM_ROLE_LABEL, type MailStatus, type TeamRole, type User } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNote, InviteSentCard, Loading } from './ui';
import { LegalLinks } from '../components/Legal';
import { LookLogo } from '../components/LookLogo';
import { MISE_CROP, MISE_ON_LIGHT, THEMES } from '../lib/theme';

/* ------------------------------------------------ types ------------------------------------------------ */
type Can = Record<'view' | 'work' | 'signInAs' | 'log' | 'planLook' | 'resetPassword' | 'resetPin' | 'inviteOwner' | 'addCompany' | 'editCompany' | 'editPerson' | 'removePerson' | 'library' | 'change' | 'deleteCompany' | 'deletions' | 'team', boolean>;
type Waiting =
  | { type: 'deletion'; id: number; companyId: number; companyName: string; requestedBy: string | null; requestedAt: string; readyAt: string; byHand: boolean }
  | { type: 'invite'; companyId: number; companyName: string; planName: string; createdAt: string; isNew: boolean; email: string; expiresAt: string; expired: boolean }
  | { type: 'error'; kind: string; path: string | null; message: string; count: number; firstAt: string; lastAt: string };
type Line = { key: 'snapshot' | 'backup' | 'files' | 'health'; title: string; note: string; at: string | null; ok: boolean; failed?: boolean };
type Company = { id: number; name: string; hq: boolean; createdAt: string | null; isNew: boolean; plan: string; planName: string; lookName: string; stores: string[];
  owners: number; managers: number; staff: number; team: number; storage: number; lastActiveAt: string | null; workingHere: boolean;
  ownerInvite: { email: string; expiresAt: string; expired: boolean } | null; deletion: { id: number; ready: boolean; endsAt: string } | null };
type Demo = { kind: string; name: string; path: string; lookName: string; open: number; lastActiveAt: string | null };
type Home = {
  you: { id: number; name: string; role: TeamRole }; can: Can; workingIn: number; hqId: number; hqName: string; waitDays: number; repeatAt: number;
  waiting: Waiting[];
  health: {
    errors: { total: number; kinds: number; top: { kind: string; path: string | null; message: string; count: number; lastAt: string }[] };
    backups: { allGood: boolean; lines: Line[] };
    storage: { capBytes: number; floorBytes: number; freeBytes: number | null; companies: { id: number; name: string; bytes: number }[] };
  };
  companies: Company[]; demos: Demo[];
  activity: { id: number; at: string; name: string | null; role: string | null; what: string; company: string | null }[];
  newThisWeek: { id: number; name: string; createdAt: string; planName: string; stores: number }[];
  team: { id: number; name: string; initials: string; role: TeamRole; totpOn: boolean; you: boolean; lastSeenAt: string | null }[];
};
type Counts = { companies: number; team: number; deletions: number };

/* ------------------------------------------------ words and numbers ------------------------------------------------ */
const TZ = 'America/Detroit';
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const word = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const clockOf = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).toLowerCase().replace(/\s/g, ' ');
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
/** "9:12 am" today, "Yesterday", else "Nov 13". */
function stamp(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso), now = new Date();
  if (dayKey(d) === dayKey(now)) return clockOf(d);
  if (dayKey(d) === dayKey(new Date(now.getTime() - 864e5))) return 'Yesterday';
  return shortDay(iso);
}
/** "Today, 9:31 am", "Yesterday", "Nov 9"; "Now" within 5 minutes. */
function lastActive(iso: string | null) {
  if (!iso) return null;
  if (Date.now() - Date.parse(iso) < 5 * 60e3) return 'Now';
  const s = stamp(iso);
  return /am|pm/.test(s) ? `Today, ${s}` : s;
}
/** "Today, 9:12 am", "Yesterday, 9:12 am", else "Nov 13, 9:12 am". */
function fullStamp(iso: string) {
  const s = stamp(iso);
  const day = /am|pm/.test(s) ? 'Today' : s;
  return `${day}, ${clockOf(new Date(iso))}`;
}
/** Backup times: "12:41 am" today, else "Nov 15, 3:15 am". */
const backupTime = (iso: string) => (dayKey(new Date(iso)) === dayKey(new Date()) ? clockOf(new Date(iso)) : `${shortDay(iso)}, ${clockOf(new Date(iso))}`);
const MB = 1024 * 1024;
const mb = (b: number) => (b > 0 && b < MB ? 'Under 1 MB' : `${Math.round(b / MB).toLocaleString('en-US')} MB`);
const gb = (b: number) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);
const pct = (b: number, cap: number) => (cap ? Math.min(100, (b / cap) * 100) : 0);
const greeting = () => {
  const h = Number(new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/* ------------------------------------------------ icons (24-grid strokes, like the admin nav) ------------------------------------------------ */
const Icon = ({ d, size = 18, className }: { d: string; size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const I = {
  home: 'M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10',
  building: 'M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  shield: 'M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Zm-3 9 2 2 4-4',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  book: 'M2 5c3-1.3 6.3-1.3 10 1 3.7-2.3 7-2.3 10-1v14c-3-1.3-6.3-1.3-10 1-3.7-2.3-7-2.3-10-1V5Zm10 1v14',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm-8 9a8 8 0 0 1 16 0',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  alert: 'M12 4 2.5 20h19L12 4Zm0 6v4.5M12 17.5h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5',
  plus: 'M12 5v14M5 12h14',
  check: 'm7 12.5 3.2 3.2L17 9',
  chevron: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6 6 18',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 3 15-4 1z',
};
const More = ({ to, children }: { to: string; children: ReactNode }) => <Link className="hq-more" to={to}>{children}<Icon d={I.arrow} size={16} /></Link>;

/* ------------------------------------------------ the HQ sidebar (Figma 699:880, left) ------------------------------------------------ */
/** The sidebar's numbers, for every admin page while a super admin works in HQ. */
export function useSuperCounts(on: boolean) {
  const [n, setN] = useState<Counts | null>(null);
  useEffect(() => { if (on) api<Counts>('/api/super/counts').then(setN).catch(() => setN(null)); }, [on]);
  return n;
}
const Count = ({ n, alert }: { n?: number; alert?: boolean }) => (n ? <span className={'admin-count hq-count' + (alert ? ' alert' : '')}>{n}</span> : null);

/** The HQ menu: Home, Mise HQ's tools, HQ's book (the Customer View), You. The same list is the phone's menu. */
export function HqNav({ user, counts, onPick }: { user: User; counts: Counts | null; onPick?: () => void }) {
  const library = user.teamRole !== 'support';
  return (
    <nav aria-label="Admin" className="hq-nav" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onPick?.(); }}>
      <NavLink end to="/admin"><Icon d={I.home} className="admin-nav-icon" />Home</NavLink>
      <p className="admin-group">Mise HQ</p>
      <NavLink end to="/admin/super"><Icon d={I.building} className="admin-nav-icon" />Companies<Count n={counts?.companies} /></NavLink>
      <NavLink to="/admin/super/people"><Icon d={I.people} className="admin-nav-icon" />People</NavLink>
      <NavLink to="/admin/super/team"><Icon d={I.shield} className="admin-nav-icon" />Mise Team<Count n={counts?.team} /></NavLink>
      <NavLink to="/admin/super/deletions"><Icon d={I.trash} className="admin-nav-icon" />Deletions<Count n={counts?.deletions} alert /></NavLink>
      <NavLink to="/admin/super/log"><Icon d={I.list} className="admin-nav-icon" />Log</NavLink>
      <p className="admin-group">HQ Book</p>
      <Link to="/"><Icon d={I.book} className="admin-nav-icon" />Customer View</Link>
      {/* the shared library (classic cocktails) is kept by the Mise team; Support only looks */}
      {library && <NavLink to="/admin/pages/classic"><Icon d={I.library} className="admin-nav-icon" />Shared Library</NavLink>}
      <p className="admin-group">You</p>
      <NavLink to="/admin/account"><Icon d={I.user} className="admin-nav-icon" />Your Account</NavLink>
    </nav>
  );
}
/** Bottom of the HQ sidebar: where you're working, and the way to a customer. */
export function HqWorking({ user }: { user: User }) {
  return (
    <div className="hq-working">
      <p className="hq-label on-dark">Working in</p>
      <strong>{user.workingInName || 'Mise Academy (HQ)'}</strong>
      <p>Mise’s own company. Its book is the empty view a new customer starts with.</p>
      <Link className="hq-btn dark-ghost small" to="/admin/super">Switch Company</Link>
    </div>
  );
}
/** Phones (Figma 714:961): the logo, where you're working, and a menu button; the menu replaces the strip of tabs. */
export function HqPhoneBar({ user, counts }: { user: User; counts: Counts | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  return (
    <div className="hq-phonebar">
      <div className="hq-phonebar-row">
        <Link to="/admin" className="hq-lockup" aria-label="Mise Academy, HQ home"><Lockup /></Link>
        <Link to="/admin/super" className="hq-switch" aria-label={`Working in ${user.workingInName || 'Mise HQ'}. Switch company`}>Mise HQ<Icon d={I.down} size={14} /></Link>
        <button type="button" className="hq-menu-btn" aria-expanded={open} aria-controls="hq-phone-menu" onClick={() => setOpen(!open)}>
          <Icon d={open ? I.close : I.menu} size={20} /><span className="sr-only">{open ? 'Close the menu' : 'Menu'}</span>
        </button>
      </div>
      {open && (
        <div className="hq-phone-menu" id="hq-phone-menu">
          <HqNav user={user} counts={counts} onPick={() => setOpen(false)} />
          <LegalLinks className="admin-legal" />
        </div>
      )}
    </div>
  );
}
/** The mise logo in Char, for the light phone bar (Nov 18 rebrand: Figma Lockup/Mise, Theme=Light, 508:26; plain mise in the
 *  nav and anything small, the Mise Academy lockup only for big moments). The export as it is, its artwork shown at uniform
 *  scale. */
const ON_LIGHT = { ...THEMES.mise, mark: { src: MISE_ON_LIGHT, alt: '', barH: 28, crop: MISE_CROP } };
function Lockup() {
  return <span className="hq-lockup-art" aria-hidden="true"><LookLogo t={ON_LIGHT} height={28} alt="" /></span>;
}

/* ------------------------------------------------ the home ------------------------------------------------ */
function useAct() {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ key: string; text: string; error?: boolean } | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); if (ok) setMsg({ key, text: ok }); } catch (e) { setMsg({ key, text: (e as Error).message, error: true }); }
    setBusy('');
  };
  return { busy, msg, run };
}
type Act = ReturnType<typeof useAct>;

export function HqHome() {
  const { user, refresh } = useSession();
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState('');
  const load = () => api<Home>('/api/super/home').then((d) => { setData(d); setError(''); }).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); document.title = 'Mise HQ · Mise Academy'; }, []);
  const nav = useNavigate();
  const act = useAct();
  const [invite, setInvite] = useState<{ link: string; email: string; days: number; mail: MailStatus } | null>(null);
  const [picker, setPicker] = useState<{ company: { id: number; name: string }; anchor: HTMLElement } | null>(null);
  const [q, setQ] = useState('');
  if (error) return <div className="admin-page"><ErrorNote error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="admin-page"><Loading /></div>;
  const workHere = (id: number, name: string) => act.run('w' + id, async () => {
    await api('/api/super/act', { method: 'POST', body: { companyId: id } }); await refresh(); nav('/admin');
  }, `Working in ${name}.`);
  const first = (user?.name || data.you.name).split(' ')[0];
  const customers = data.companies.filter((c) => !c.hq);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ });
  const find = (e: FormEvent) => { e.preventDefault(); if (q.trim()) nav(`/admin/super/people?q=${encodeURIComponent(q.trim())}`); };
  return (
    <div className="admin-page hq">
      <div className="hq-top">
        <form className="mg-find hq-find" role="search" onSubmit={find}>
          <Icon d={I.search} size={18} />
          <label className="sr-only" htmlFor="hq-q">Search companies, people and emails</label>
          <input id="hq-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies, people, emails…" autoComplete="off" />
        </form>
        <div className="hq-top-right">
          <span className="hq-you"><span aria-hidden="true" />You’re {TEAM_ROLE_LABEL[data.you.role]} on the Mise team</span>
          {data.can.addCompany && <Link className="hq-btn dark" to="/admin/super#add-company"><Icon d={I.plus} size={16} />Add Company</Link>}
        </div>
      </div>
      {q.trim() && <CompanyMatches q={q} data={data} />}

      <header className="mg-head hq-head">
        <div>
          <h1>{greeting()}, {first}</h1>
          <p className="hq-date">{today} · {data.hqName}</p>
        </div>
        <div className="mg-sum" aria-label="Mise at a glance">
          <span className="mg-sum-pill">{plural(customers.length + data.demos.length + 1, 'company', 'companies')}</span>
          {data.waiting.length > 0 && <span className="mg-sum-pill bad">{data.waiting.length} waiting on you</span>}
          <span className={'mg-sum-pill dot ' + (data.health.backups.allGood ? 'ok' : 'bad')}><span aria-hidden="true" />{data.health.backups.allGood ? 'Backups up to date' : 'Backups need a look'}</span>
        </div>
      </header>

      {invite && <InviteSentCard link={invite.link} email={invite.email} mail={invite.mail} days={invite.days} note="It’s a new owner invite. The old link still works until it expires." onDone={() => setInvite(null)} />}
      <WaitingBand data={data} act={act} reload={load} workHere={workHere} onInvite={setInvite} />

      <section className="hq-section" aria-labelledby="hq-health">
        <div className="hq-section-head"><h2 id="hq-health">Health</h2><p>Errors, backups and storage across every company</p></div>
        <div className="hq-health">
          <ErrorsCard e={data.health.errors} />
          <BackupsCard b={data.health.backups} />
          <StorageCard s={data.health.storage} />
        </div>
      </section>

      <CompaniesCard data={data} act={act} workHere={workHere} openPicker={(company, anchor) => setPicker({ company, anchor })} />

      <div className="hq-cols">
        <ActivityCard rows={data.activity} />
        <div className="hq-side">
          <NewThisWeek list={data.newThisWeek} />
          <TeamCard team={data.team} />
        </div>
      </div>
      {picker && <SignInAsPicker company={picker.company} anchor={picker.anchor} onClose={() => { const a = picker.anchor; setPicker(null); a.focus(); }} />}
    </div>
  );
}

/** Typing in the search box: the companies that match, straight away (Enter searches people and emails). */
function CompanyMatches({ q, data }: { q: string; data: Home }) {
  const t = q.trim().toLowerCase();
  const hits = data.companies.filter((c) => c.name.toLowerCase().includes(t) || c.stores.some((s) => s.toLowerCase().includes(t))).slice(0, 5);
  return (
    <div className="hq-matches" role="status">
      {hits.length ? <><span className="hq-label">Companies</span>{hits.map((c) => <a key={c.id} href={`#company-${c.id}`}>{c.name}</a>)}</> : <span className="muted">No company by that name.</span>}
      <span className="muted">Press Enter to search people and emails.</span>
    </div>
  );
}

/* ---------- Waiting on you: the dark band ---------- */
function WaitingBand({ data, act, reload, workHere, onInvite }: { data: Home; act: Act; reload: () => Promise<unknown>; workHere: (id: number, name: string) => Promise<void>;
  onInvite: (x: { link: string; email: string; days: number; mail: MailStatus }) => void }) {
  const list = data.waiting;
  const hasDeletion = list.some((w) => w.type === 'deletion');
  return (
    <section className="mh-band hq-band" aria-labelledby="hq-waiting">
      <div className="mh-band-head hq-band-head">
        <div>
          <p className="hq-label tape">Waiting on you · {list.length}</p>
          <h2 id="hq-waiting">{list.length ? `${word(list.length)} ${list.length === 1 ? 'thing needs' : 'things need'} a super admin` : 'Nothing waiting on you'}</h2>
        </div>
        {hasDeletion && <p className="mh-band-note">Only the Owner confirms a deletion</p>}
      </div>
      {list.length === 0 && <p className="hq-band-empty">Deletion requests past their {data.waitDays} days, owner invites nobody has used, and errors that keep coming back show up here.</p>}
      {list.map((w) => w.type === 'deletion' ? <DeletionRow key={'d' + w.id} w={w} can={data.can} act={act} reload={reload} waitDays={data.waitDays} />
        : w.type === 'invite' ? <InviteRow key={'i' + w.companyId} w={w} can={data.can} act={act} workHere={workHere} onInvite={onInvite} />
        : <ErrorRow key={'e' + w.kind + w.path + w.message} w={w} />)}
    </section>
  );
}
const Tag = ({ children, dark }: { children: ReactNode; dark?: boolean }) => <span className={'hq-tag' + (dark ? ' dark' : '')}>{children}</span>;
const RowMsg = ({ act, at }: { act: Act; at: string }) => (act.msg && act.msg.key === at ? <p className={'hq-row-msg' + (act.msg.error ? ' error' : '')} role={act.msg.error ? 'alert' : 'status'}>{act.msg.text}</p> : null);

const endedWhen = (iso: string) => { const s = stamp(iso); return s === 'Yesterday' ? 'yesterday' : /am|pm/.test(s) ? 'today' : `on ${shortDay(iso)}`; };
function DeletionRow({ w, can, act, reload, waitDays }: { w: Extract<Waiting, { type: 'deletion' }>; can: Can; act: Act; reload: () => Promise<unknown>; waitDays: number }) {
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState('');
  const key = 'd' + w.id;
  const cancel = () => { if (window.confirm(`Cancel ${w.companyName}’s deletion request? Nothing will be deleted.`)) void act.run(key, async () => { await api(`/api/super/deletions/${w.id}/cancel`, { method: 'POST' }); await reload(); }, `${w.companyName}’s request is cancelled.`); };
  const confirm = (e: FormEvent) => { e.preventDefault(); void act.run(key, async () => {
    const r = await api<{ removed: Record<string, number> }>(`/api/super/deletions/${w.id}/confirm`, { method: 'POST', body: { confirm: name } });
    await reload(); return r;
  }, `${w.companyName}’s data is deleted.`); };
  return (
    <div className="hq-ask">
      <span className="hq-ask-icon"><Icon d={I.trash} /></span>
      <span className="hq-ask-who"><strong>{w.companyName}</strong><small>Data deletion</small></span>
      <span className="hq-ask-what">
        <span>{w.requestedBy || 'An owner'} asked to delete the company’s data. The {waitDays}-day wait ended {endedWhen(w.readyAt)}. Confirming removes its people, training records, chat, prep logs and uploads.</span>
        <small>Asked {shortDay(w.requestedAt)} · ready since {shortDay(w.readyAt)}</small>
      </span>
      <span className="hq-ask-end">
        <Tag dark>Ready</Tag>
        {can.deletions && <span className="hq-ask-btns">
          <button type="button" className="hq-btn dark-ghost" disabled={!!act.busy} onClick={cancel}>Cancel Request</button>
          {w.byHand ? <small className="hq-ask-note">Holds the shared library: deleted by hand, not here.</small>
            : <button type="button" className="hq-btn bone fig" disabled={!!act.busy} aria-expanded={confirming} onClick={() => setConfirming(!confirming)}>Confirm Deletion</button>}
        </span>}
      </span>
      {confirming && can.deletions && (
        <form className="hq-confirm" onSubmit={confirm}>
          <label><span>Type <strong>{w.companyName}</strong> to delete its data for good</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} /></label>
          <button className="hq-btn bone fig" disabled={!!act.busy || name.trim().length < 2}>{act.busy === key ? 'Deleting…' : 'Delete for Good'}</button>
          <button type="button" className="hq-btn dark-ghost" onClick={() => { setConfirming(false); setName(''); }}>Not Now</button>
        </form>
      )}
      <RowMsg act={act} at={key} />
    </div>
  );
}
function InviteRow({ w, can, act, workHere, onInvite }: { w: Extract<Waiting, { type: 'invite' }>; can: Can; act: Act; workHere: (id: number, name: string) => Promise<void>;
  onInvite: (x: { link: string; email: string; days: number; mail: MailStatus }) => void }) {
  const key = 'i' + w.companyId;
  const again = () => void act.run(key, async () => {
    const r = await api<{ link: string; email: string; days: number; mail: MailStatus }>(`/api/super/companies/${w.companyId}/owner-invite`, { method: 'POST', body: { email: w.email } });
    onInvite({ ...r, link: location.origin + r.link });
  });
  return (
    <div className="hq-ask">
      <span className="hq-ask-icon"><Icon d={I.mail} /></span>
      <span className="hq-ask-who"><strong>{w.companyName}</strong><small>{w.isNew ? 'New company' : 'Owner invite'}</small></span>
      <span className="hq-ask-what">
        <span>{w.createdAt ? `Added ${shortDay(w.createdAt)} on ${w.planName}. ` : ''}The owner invite to {w.email} {w.expired ? `expired on ${shortDay(w.expiresAt)}` : 'hasn’t been used'}, and nobody has signed in yet.</span>
        <small>{w.expired ? `Expired ${shortDay(w.expiresAt)}` : `Invite expires ${shortDay(w.expiresAt)}`}</small>
      </span>
      <span className="hq-ask-end">
        <Tag dark>{w.expired ? 'Expired' : w.isNew ? 'New' : 'Open'}</Tag>
        <span className="hq-ask-btns">
          {can.work && <button type="button" className="hq-btn dark-ghost" disabled={!!act.busy} onClick={() => void workHere(w.companyId, w.companyName)}>Work Here</button>}
          {can.inviteOwner && <button type="button" className="hq-btn bone" disabled={!!act.busy} onClick={again}>{act.busy === key ? 'Making…' : 'New Invite Link'}</button>}
        </span>
      </span>
      <RowMsg act={act} at={key} /><RowMsg act={act} at={'w' + w.companyId} />
    </div>
  );
}
function ErrorRow({ w }: { w: Extract<Waiting, { type: 'error' }> }) {
  return (
    <div className="hq-ask">
      <span className="hq-ask-icon"><Icon d={I.alert} /></span>
      <span className="hq-ask-who"><strong>{w.kind === 'client' ? 'Browser error' : 'Server error'}, repeating</strong><small>{w.path || 'No address'}</small></span>
      <span className="hq-ask-what">
        <span>“{w.message}” came in {w.count} times in the last 24 hours. The nightly check emails you too.</span>
        <small>First seen {stamp(w.firstAt)} · last {stamp(w.lastAt)}</small>
      </span>
      <span className="hq-ask-end">
        <Tag dark>×{w.count}</Tag>
        <span className="hq-ask-btns"><Link className="hq-btn bone" to={`/admin/super/errors?days=1&q=${encodeURIComponent(w.path || w.message)}`}>Open Error Log</Link></span>
      </span>
    </div>
  );
}

/* ---------- Health ---------- */
function ErrorsCard({ e }: { e: Home['health']['errors'] }) {
  return (
    <article className="mg-card hq-card" aria-labelledby="hq-errors">
      <div className="hq-card-head"><div><h3 id="hq-errors">Errors</h3><p>Last 24 hours</p></div></div>
      <p className="hq-big"><strong>{e.total}</strong><span>{e.total === 1 ? 'error' : 'errors'}{e.total ? ` · ${plural(e.kinds, 'kind')}` : ''}</span></p>
      {e.top.length === 0 ? <p className="hq-quiet">Nothing has gone wrong in the last day.</p> : (
        <ul className="hq-errs">{e.top.map((x, i) => (
          <li key={i}><span className="hq-chip">{x.kind === 'client' ? 'Browser' : 'Server'}</span>
            <span className="hq-err-text"><strong>{x.path || 'No address'}</strong><small>{x.message}</small></span>
            <span className={'hq-times' + (x.count >= 3 ? ' hot' : '')}>×{x.count}</span></li>
        ))}</ul>
      )}
      <More to="/admin/super/errors">Open Error Log</More>
    </article>
  );
}
function BackupsCard({ b }: { b: Home['health']['backups'] }) {
  return (
    <article className="mg-card hq-card" aria-labelledby="hq-backups">
      <div className="hq-card-head"><div><h3 id="hq-backups">Backups</h3><p>When each one last ran</p></div><span className={'hq-badge ' + (b.allGood ? 'olive' : 'fig')}>{b.allGood ? 'All good' : 'Check'}</span></div>
      <ul className="hq-lines">{b.lines.map((l) => (
        <li key={l.key} className={l.ok ? 'is-ok' : 'is-off'}>
          <span className="hq-tick" aria-hidden="true">{l.ok ? <Icon d={I.check} size={16} /> : '!'}</span>
          <span className="hq-line-text"><strong>{l.title}</strong><small>{l.failed ? 'The last try didn’t finish' : l.note}</small></span>
          <span className="hq-line-time">{l.at ? backupTime(l.at) : 'Not yet'}<span className="sr-only">{l.ok ? ', up to date' : ', needs a look'}</span></span>
        </li>
      ))}</ul>
      {b.lines.some((l) => !l.at && l.key !== 'snapshot') && <p className="hq-quiet small">The app has kept these times since Nov 16. Each line fills in the next time it runs.</p>}
    </article>
  );
}
function StorageCard({ s }: { s: Home['health']['storage'] }) {
  const shown = s.companies.slice(0, 4);
  const rest = s.companies.length - shown.length;
  return (
    <article className="mg-card hq-card" aria-labelledby="hq-storage">
      <div className="hq-card-head"><div><h3 id="hq-storage">Storage</h3><p>{Math.round(s.capBytes / MB).toLocaleString('en-US')} MB cap per company</p></div></div>
      <ul className="hq-store">{shown.map((c) => (
        <li key={c.id}><span className="hq-store-row"><strong>{c.name}</strong><small>{mb(c.bytes)} · {Math.round(pct(c.bytes, s.capBytes))}%</small></span>
          <Bar bytes={c.bytes} cap={s.capBytes} /></li>
      ))}</ul>
      {rest > 0 && <p className="hq-quiet small">{plural(rest, 'more company', 'more companies')}, each smaller.</p>}
      {s.freeBytes != null && <p className="hq-volume">Volume: {gb(s.freeBytes)} free. Uploads stop when it drops to {gb(s.floorBytes)}.</p>}
    </article>
  );
}

/* ---------- Companies ---------- */
type Filter = 'all' | 'customers' | 'demos' | 'hq';
function CompaniesCard({ data, act, workHere, openPicker }: { data: Home; act: Act; workHere: (id: number, name: string) => Promise<void>; openPicker: (c: { id: number; name: string }, anchor: HTMLElement) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const hq = data.companies.filter((c) => c.hq), customers = data.companies.filter((c) => !c.hq);
  const chips: [Filter, string, number][] = [['all', 'All', hq.length + customers.length + data.demos.length], ['customers', 'Customers', customers.length], ['demos', 'Demos', data.demos.length], ['hq', 'HQ', hq.length]];
  const show = (f: Filter) => filter === 'all' || filter === f;
  return (
    <section className="mg-card hq-cos" aria-labelledby="hq-cos-title">
      <div className="hq-cos-head">
        <div><h2 id="hq-cos-title">Companies</h2><p>Work Here opens a company’s admin. Sign In As shows what one of its people sees. Both go in the Log.</p></div>
        <div className="mg-chips hq-chips" role="group" aria-label="Show">
          {chips.map(([k, l, n]) => <button key={k} type="button" className={'mg-chip' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} · {n}</button>)}
        </div>
      </div>
      <table className="hq-table">
        <thead><tr><th>Company</th><th>Plan and Look</th><th>Stores</th><th>People</th><th>Storage</th><th>Last Active</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {show('hq') && hq.map((c) => (
            <tr key={c.id} id={`company-${c.id}`} className="is-hq">
              <td data-cell="name"><span className="hq-co-name"><strong>{c.name}</strong><span className="hq-pill raised">HQ</span></span><small>{c.stores.join(' · ')}</small></td>
              <td data-label="Plan and Look"><span className="hq-pill">Mise’s Own</span><small>{c.lookName} look</small></td>
              <td data-label="Stores"><b>{c.stores.length}</b></td>
              <td data-label="People"><span>{plural(c.team, 'on the Mise team', 'on the Mise team')}</span><small>No customers</small></td>
              <td data-label="Storage"><StorageCell bytes={c.storage} cap={data.health.storage.capBytes} /></td>
              <td data-label="Last Active">{lastActive(c.lastActiveAt) || '—'}</td>
              <td data-cell="actions">{c.workingHere ? <span className="hq-here">You’re working here</span>
                : data.can.work && <button type="button" className="hq-btn dark small" disabled={!!act.busy} onClick={() => void workHere(c.id, c.name)}>Work Here</button>}</td>
            </tr>
          ))}
          {show('customers') && customers.map((c) => {
            const leads = c.owners + c.managers;
            return (
              <tr key={c.id} id={`company-${c.id}`}>
                <td data-cell="name"><span className="hq-co-name"><strong>{c.name}</strong>{c.isNew && <span className="hq-pill olive">New</span>}</span>
                  <small>{c.stores.join(' · ')}</small>
                  {c.deletion && (c.deletion.ready ? <small className="hq-alert">Deletion ready · waiting on you</small> : <small className="hq-wait">Deletion asked · ready {shortDay(c.deletion.endsAt)}</small>)}</td>
                <td data-label="Plan and Look"><span className={'hq-pill' + (c.plan === 'custom-brand' ? ' fig' : '')}>{c.planName}</span><small>{c.lookName} look</small></td>
                <td data-label="Stores"><b>{c.stores.length}</b></td>
                <td data-label="People"><span>{leads ? peopleLine(c) : c.ownerInvite ? 'Owner invite open' : 'No owner yet'}</span><small>{c.staff ? `${c.staff} staff` : 'No staff yet'}</small></td>
                <td data-label="Storage"><StorageCell bytes={c.storage} cap={data.health.storage.capBytes} /></td>
                <td data-label="Last Active">{lastActive(c.lastActiveAt) || <span className="hq-never">Never</span>}</td>
                <td data-cell="actions"><span className="hq-row-btns">
                  {data.can.signInAs && <button type="button" className="hq-btn small" onClick={(e) => openPicker({ id: c.id, name: c.name }, e.currentTarget)} aria-haspopup="dialog">Sign In As</button>}
                  {c.workingHere ? <span className="hq-here">You’re working here</span>
                    : data.can.work && <button type="button" className="hq-btn dark small" disabled={!!act.busy} onClick={() => void workHere(c.id, c.name)}>Work Here</button>}
                </span></td>
              </tr>
            );
          })}
          {show('demos') && data.demos.map((d) => (
            <tr key={d.kind}>
              <td data-cell="name"><span className="hq-co-name"><strong>{d.name}</strong><span className="hq-pill raised">Demo</span></span><small>{d.path} · a private copy per visitor</small></td>
              <td data-label="Plan and Look"><span className="hq-pill">Demo</span><small>{d.lookName} look</small></td>
              <td data-label="Stores"><b>1</b></td>
              <td data-label="People"><span>{d.open ? plural(d.open, 'copy open', 'copies open') : 'No copies open'}</span><small>Removed after a day</small></td>
              <td data-label="Storage"><span className="muted">—</span></td>
              <td data-label="Last Active">{lastActive(d.lastActiveAt) || '—'}</td>
              <td data-cell="actions"><a className="hq-btn small" href={d.path} target="_blank" rel="noopener">Open Demo<span className="sr-only"> (opens in a new tab)</span></a></td>
            </tr>
          ))}
        </tbody>
      </table>
      {act.msg && act.msg.key.startsWith('w') && act.msg.error && <p className="error hq-cos-msg" role="alert">{act.msg.text}</p>}
      <div className="hq-cos-foot"><More to="/admin/super">Open Companies</More></div>
    </section>
  );
}
function peopleLine(c: Company) {
  if (c.owners && !c.managers) return plural(c.owners, 'owner');
  if (c.managers && !c.owners) return plural(c.managers, 'manager');
  return `${c.owners + c.managers} owners and managers`;
}
/** Share of the cap; anything above nothing shows at least a dot. */
const Bar = ({ bytes, cap }: { bytes: number; cap: number }) => <span className="hq-bar" aria-hidden="true">{bytes > 0 && <span style={{ width: `${pct(bytes, cap)}%` }} />}</span>;
const StorageCell = ({ bytes, cap }: { bytes: number; cap: number }) => (
  <span className="hq-storage-cell"><span>{mb(bytes)}</span><Bar bytes={bytes} cap={cap} /></span>
);

/* ---------- Recent Activity, New This Week, Mise Team ---------- */
function ActivityCard({ rows }: { rows: Home['activity'] }) {
  return (
    <section className="mg-card hq-card hq-activity" aria-labelledby="hq-activity">
      <div className="hq-card-head"><div><h2 id="hq-activity">Recent Activity</h2><p>From the Log: who did what, with their role</p></div></div>
      {rows.length === 0 ? <p className="hq-quiet">Nothing in the Log yet.</p> : (
        <ul className="hq-acts">{rows.map((r) => (
          <li key={r.id}>
            <span className="hq-act-time">{stamp(r.at)}</span>
            <span className="hq-act-who"><strong>{r.name || 'Someone'}</strong>{r.role && <small>{r.role}</small>}</span>
            <span className="hq-act-what">{r.what}</span>
            <span className="hq-act-co">{r.company || '—'}</span>
          </li>
        ))}</ul>
      )}
      <More to="/admin/super/log">Open the Log</More>
    </section>
  );
}
function NewThisWeek({ list }: { list: Home['newThisWeek'] }) {
  return (
    <section className="hq-new" aria-labelledby="hq-new">
      <p className="hq-label">New this week</p>
      <h2 id="hq-new">{list.length ? `${word(list.length)} new ${list.length === 1 ? 'company' : 'companies'}` : 'No new companies this week'}</h2>
      {list.length === 0 ? <p className="hq-new-empty">Companies added in the last 7 days show up here.</p> : (
        <ul>{list.slice(0, 4).map((c) => <li key={c.id}><strong>{c.name}</strong><small>Added {shortDay(c.createdAt)} · {c.planName} · {plural(c.stores, 'store')}</small></li>)}</ul>
      )}
    </section>
  );
}
function TeamCard({ team }: { team: Home['team'] }) {
  return (
    <section className="mg-card hq-card hq-team" aria-labelledby="hq-team">
      <div className="hq-card-head"><div><h2 id="hq-team">Mise Team</h2><p>Everyone signs in with two-step</p></div></div>
      <ul className="hq-team-list">{team.map((t) => (
        <li key={t.id}><span className="mg-av hq-av" aria-hidden="true">{t.initials}</span>
          <span className="hq-team-who"><strong>{t.name}{t.you ? ' · you' : ''}</strong><small className={t.totpOn ? '' : 'hq-alert'}>Two-step: {t.totpOn ? 'On' : 'Not set up'}</small></span>
          <span className={'hq-role ' + t.role}>{TEAM_ROLE_LABEL[t.role]}</span></li>
      ))}</ul>
      <More to="/admin/super/team">Open Mise Team</More>
    </section>
  );
}

/* ------------------------------------------------ Sign In As picker (708:920 desktop, 716:1016 phone) ------------------------------------------------ */
type Pick = { id: number; name: string; email: string | null; initials: string; role: 'owner' | 'manager' | 'staff'; roleLabel: string; storeName: string | null; lastSeenAt: string | null };
type People = { company: { id: number; name: string }; total: number; owners: Pick[]; managers: Pick[]; staff: { storeId: number | null; storeName: string; people: Pick[] }[] };

export function SignInAsPicker({ company, anchor, onClose }: { company: { id: number; name: string }; anchor: HTMLElement; onClose: () => void }) {
  const [data, setData] = useState<People | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const sheet = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;
  // Desktop: under the row's Sign In As button, its right edge lined up with the button's (Figma 708:920).
  const where = () => {
    const r = anchor.getBoundingClientRect();
    const w = Math.min(460, window.innerWidth - 24);
    return { top: r.bottom + window.scrollY + 10, left: Math.max(12, Math.min(r.right + window.scrollX - w + 45, window.innerWidth - w - 12)) };
  };
  const [pos, setPos] = useState<{ top: number; left: number } | null>(() => (sheet ? null : where()));
  useEffect(() => { api<People>(`/api/super/companies/${company.id}/people`).then(setData).catch((e) => setError((e as Error).message)); }, [company.id]);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    if (sheet) return;
    const place = () => setPos(where());
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab' && box.current) { // keep Tab inside the picker
        const f = [...box.current.querySelectorAll<HTMLElement>('input, button:not([disabled])')];
        if (!f.length) return;
        const [a, z] = [f[0], f[f.length - 1]];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', out);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', out); };
  }, [onClose, anchor]);
  const go = async (p: Pick) => {
    setBusy(p.id); setError('');
    try { await api(`/api/super/users/${p.id}/sign-in-as`, { method: 'POST' }); location.assign(p.role === 'staff' ? '/' : '/admin'); }
    catch (e) { setError((e as Error).message); setBusy(0); }
  };
  const t = q.trim().toLowerCase();
  const match = (p: Pick) => !t || p.name.toLowerCase().includes(t) || (p.email || '').toLowerCase().includes(t);
  const groups: { label: string; people: Pick[] }[] = data ? [
    { label: data.owners.length === 1 ? 'Owner' : 'Owners', people: data.owners.filter(match) },
    { label: 'Managers', people: data.managers.filter(match) },
    ...data.staff.map((g) => ({ label: `Staff · ${g.storeName} · ${g.people.length}`, people: g.people.filter(match) })),
  ].filter((g) => g.people.length) : [];
  const shown = groups.reduce((n, g) => n + g.people.length, 0);
  const body = (
    <div ref={box} className={'hq-picker' + (sheet ? ' sheet' : '')} role="dialog" aria-modal={sheet} aria-labelledby="hq-picker-title"
      style={!sheet && pos ? { top: pos.top, left: pos.left } : undefined}>
      {sheet && <span className="hq-grab" aria-hidden="true" />}
      <div className="hq-picker-head">
        <h2 id="hq-picker-title">Sign In As someone at {company.name}</h2>
        <p>Owner first, then managers, then staff by store</p>
        <label className="hq-picker-find"><Icon d={I.search} size={18} /><span className="sr-only">Search people</span>
          <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={data ? `Search ${plural(data.total, 'person', 'people')} by name or email` : 'Search by name or email'} autoComplete="off" /></label>
      </div>
      <div className="hq-picker-list">
        {!data && !error && <Loading />}
        {data && data.total === 0 && <p className="hq-quiet">Nobody has joined {company.name} yet.</p>}
        {data && data.total > 0 && shown === 0 && <p className="hq-quiet">No one matches “{q}”.</p>}
        {groups.map((g) => (
          <div key={g.label} className="hq-picker-group" role="group" aria-label={g.label}>
            <p className="hq-label">{g.label}</p>
            {g.people.map((p) => (
              <button key={p.id} type="button" className={'hq-pick' + (p.role === 'owner' ? ' owner' : '')} disabled={!!busy} onClick={() => void go(p)}>
                <span className="mg-av hq-av" aria-hidden="true">{p.initials}</span>
                <span className="hq-pick-who"><span className="hq-pick-name">{p.name}{p.role === 'owner' && <span className="hq-role owner">Owner</span>}</span>
                  <small>{p.roleLabel}{p.storeName ? ` · ${p.storeName}` : ''}</small></span>
                <span className="hq-pick-when">{busy === p.id ? 'Signing in…' : lastActive(p.lastSeenAt) || 'Never'}</span>
                <Icon d={I.chevron} size={16} className="hq-pick-chev" />
              </button>
            ))}
          </div>
        ))}
      </div>
      {data && data.total > 0 && <p className="hq-picker-count">{shown === data.total ? plural(data.total, 'person', 'people') : `Showing ${shown} of ${data.total}`}</p>}
      {error && <p className="error hq-picker-err" role="alert">{error}</p>}
      <div className="hq-picker-foot">
        <Icon d={I.eye} size={18} />
        <p>You’ll see the app as them. Every action is logged under your name.</p>
        <button type="button" className="hq-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
  return sheet ? <div className="hq-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>{body}</div> : body;
}

/* ------------------------------------------------ Error Log (Super Admin → Error Log) ------------------------------------------------ */
type ErrRow = { id: number; kind: 'server' | 'client'; path: string | null; message: string; stack: string | null; count: number; firstAt: string; lastAt: string;
  user: { name: string; role: string; company: string | null } | null };
export function ErrorLog() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') === 'server' || params.get('kind') === 'client' ? params.get('kind')! : 'all';
  const days = ['1', '7', '90'].includes(params.get('days') || '') ? params.get('days')! : '7';
  const [q, setQ] = useState(params.get('q') || '');
  const [data, setData] = useState<{ errors: ErrRow[]; totals: { server: number; client: number } } | null>(null);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ errors: ErrRow[]; totals: { server: number; client: number } }>(`/api/super/errors?days=${days}&kind=${kind === 'all' ? '' : kind}&q=${encodeURIComponent(q.trim())}`)
        .then((d) => { setData(d); setError(''); }).catch((e) => setError((e as Error).message));
    }, 200);
    return () => clearTimeout(t);
  }, [kind, days, q]);
  useEffect(() => { document.title = 'Error Log · Mise Academy'; }, []);
  const all = data ? data.totals.server + data.totals.client : 0;
  return (
    <div className="stack hq-errlog">
      <p className="muted">Every server error and browser error the app has caught, newest first. The same message on the same address counts up once a day. Read only: the nightly check emails the owner when any come in. Kept 90 days.</p>
      <div className="hq-errlog-filters">
        <div className="mg-chips" role="group" aria-label="Kind">
          {([['all', `All · ${all}`], ['server', `Server · ${data?.totals.server ?? 0}`], ['client', `Browser · ${data?.totals.client ?? 0}`]] as const).map(([k, l]) => (
            <button key={k} type="button" className={'mg-chip' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => set('kind', k === 'all' ? '' : k)}>{l}</button>
          ))}
        </div>
        <label className="field"><span>Since</span><select value={days} onChange={(e) => set('days', e.target.value)}>
          <option value="1">The Last 24 Hours</option><option value="7">The Last 7 Days</option><option value="90">The Last 90 Days</option></select></label>
        <label className="field grow"><span>Search</span><input type="search" value={q} onChange={(e) => { setQ(e.target.value); set('q', e.target.value); }} placeholder="Words in the message or address" /></label>
      </div>
      {error && <ErrorNote error={error} />}
      {!data && !error && <Loading />}
      {data && data.errors.length === 0 && <div className="empty"><h3>No errors{q.trim() ? ` matching “${q.trim()}”` : ''}</h3><p className="muted">{days === '1' ? 'Nothing in the last 24 hours.' : `Nothing in the last ${days} days.`}</p></div>}
      {data && data.errors.length > 0 && (
        <table className="table hq-errtable stack-table">
          <thead><tr><th>Last Seen</th><th>Kind</th><th>Where and What</th><th>Times</th><th>Person</th></tr></thead>
          <tbody>{data.errors.map((e) => (
            <tr key={e.id}>
              <td data-label="Last seen">{fullStamp(e.lastAt)}<small className="muted">First {fullStamp(e.firstAt)}</small></td>
              <td data-label="Kind"><span className="hq-chip">{e.kind === 'client' ? 'Browser' : 'Server'}</span></td>
              <td className="hq-err-cell"><strong>{e.path || 'No address'}</strong><span>{e.message}</span>
                {e.stack && <details><summary>Stack</summary><pre>{e.stack}</pre></details>}</td>
              <td data-label="Times"><span className={'hq-times' + (e.count >= 3 ? ' hot' : '')}>×{e.count}</span></td>
              <td data-label="Person">{e.user ? <>{e.user.name}<small className="muted">{e.user.company || ''}</small></> : <span className="muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
