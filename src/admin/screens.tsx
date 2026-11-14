// Admin screens: sign in, first-time setup, invites, lists, media, people, account, activity.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, uploadCaptions, uploadFile, ROLE_LABEL, type MediaItem, type Role, type User } from '../lib/api';
import { useSession } from '../lib/session';
import { VideoEmbed, forgetCaptions } from '../components/VideoEmbed';
import { Empty, ErrorNote, Loading, ResetLinkCard, Text, when, type ResetLink } from './ui';
import { PRODUCT_NAME } from '../lib/brand';
import { AuthCard } from '../components/AuthCard';

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api<T>(path).then(setData).catch((e) => setError(e.message)); };
  useEffect(load, [path]);
  return { data, error, load, setData };
}

/* ---------- signed out ---------- */
// Nov 12: the signed-out screens wear Mise, the platform's front door (src/components/AuthCard.tsx; Figma section 28).
export { AuthCard };
const OWNERS = 'Owners and managers';

export function SignIn() {
  const { setUser, setupNeeded, superSetupNeeded } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const [forgot, setForgot] = useState(false);
  if (setupNeeded || setup) return <Setup superAdmin={!setupNeeded && superSetupNeeded} />;
  if (forgot) return <ForgotPassword email={email} onBack={(e) => { setForgot(false); setEmail(e); setError(''); }} />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<{ user?: User; needCode?: boolean; ticket?: string }>('/api/login', { method: 'POST', body: { email, password } });
      if (r.needCode) setTicket(r.ticket!); else setUser(r.user!);
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  const submitCode = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { setUser((await api<{ user: User }>('/api/login/code', { method: 'POST', body: { ticket, code } })).user); }
    catch (err) { setError((err as Error).message); if (/timed out/.test((err as Error).message)) { setTicket(''); setCode(''); } }
    setBusy(false);
  };
  if (ticket) return (
    <AuthCard kicker={OWNERS} title="Two-Step Sign-In" sub="Open your authenticator app and type the 6-digit code for Mise.">
      <form className="stack" onSubmit={submitCode}>
        <label className="field"><span>Code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign In'}</button>
        <button type="button" className="link-btn" onClick={() => { setTicket(''); setCode(''); setError(''); }}>Start over</button>
      </form>
    </AuthCard>
  );
  return (
    <AuthCard kicker={OWNERS} title="Sign In" sub="Use the email your invite was sent to.">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Email</span>
          <input inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="you@yourrestaurant.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button type="button" className="link-btn si-forgot" onClick={() => { setForgot(true); setError(''); }}>Forgot Password?</button>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || !email || !password}>{busy ? 'Signing In…' : 'Sign In'}</button>
        {superSetupNeeded && <button type="button" className="link-btn" onClick={() => setSetup(true)}>Set up the super admin account</button>}
      </form>
      <hr className="si-rule" />
      <p className="si-alt">On staff? <Link to="/">Sign in with your join code.</Link></p>
    </AuthCard>
  );
}

/** Forgot Password? (Nov 11): the same answer for every email. The link comes by email when Resend is set up. */
function ForgotPassword({ email: start, onBack }: { email: string; onBack: (email: string) => void }) {
  const { user } = useSession();
  const [email, setEmail] = useState(start);
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    if (user?.demo) { setError('That’s switched off in the demo.'); setBusy(false); return; }
    try { setSent((await api<{ message: string }>('/api/password/forgot', { method: 'POST', body: { email } })).message); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  if (sent) return (
    <AuthCard kicker={OWNERS} title="Check Your Email" sub={sent}>
      <div className="stack">
        <p className="muted small">The link works once and expires in 24 hours. Staff don’t need one: a manager can Reset PIN.</p>
        <button type="button" className="btn" onClick={() => onBack(email)}>Back to Sign In</button>
      </div>
    </AuthCard>
  );
  return (
    <AuthCard kicker={OWNERS} title="Forgot Your Password?" sub="Type the email you sign in with. If it has an account, we’ll email a link to pick a new password.">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send Reset Link'}</button>
        <button type="button" className="link-btn" onClick={() => onBack(email)}>Back to Sign In</button>
        <p className="muted small">Staff sign in with a PIN. Forgot it? Ask a manager to reset it.</p>
      </form>
    </AuthCard>
  );
}

/** /admin/reset/<token>: pick a new password from a one-time link, then you're signed in. Two-step still asks for its code. */
export function ResetPassword() {
  const { token } = useParams();
  const { user, setUser } = useSession();
  const nav = useNavigate();
  const [info, setInfo] = useState<{ valid: boolean; name?: string; email?: string; expiresAt?: string } | null>(null);
  const [f, setF] = useState({ password: '', again: '' });
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<typeof info>(`/api/reset/${token}`).then(setInfo).catch(() => setInfo({ valid: false })); }, [token]);
  if (!info) return <AuthCard title="Checking Your Link…"><Loading /></AuthCard>;
  if (!info.valid) return (
    <AuthCard title="This Reset Link Doesn’t Work" sub="It expired, was already used, or a newer link replaced it. Ask an owner for a new one, or use Forgot Password? on the sign-in page.">
      <Link className="btn" to="/admin">Go to Sign In</Link>
    </AuthCard>
  );
  const done = (u: User) => { setUser(u); nav('/admin'); };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (user?.demo) { setError('That’s switched off in the demo.'); return; }
    if (f.password !== f.again) { setError('Those passwords don’t match. Type the same one twice.'); return; }
    setBusy(true);
    try {
      const r = await api<{ user?: User; needCode?: boolean; ticket?: string }>(`/api/reset/${token}`, { method: 'POST', body: { password: f.password } });
      if (r.needCode) setTicket(r.ticket!); else done(r.user!);
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  const submitCode = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { done((await api<{ user: User }>('/api/login/code', { method: 'POST', body: { ticket, code } })).user); }
    catch (err) { setError((err as Error).message); if (/timed out/.test((err as Error).message)) nav('/admin'); }
    setBusy(false);
  };
  if (ticket) return (
    <AuthCard kicker={OWNERS} title="Two-Step Sign-In" sub="Your new password is set. Open your authenticator app and type the 6-digit code for Mise.">
      <form className="stack" onSubmit={submitCode}>
        <label className="field"><span>Code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign In'}</button>
      </form>
    </AuthCard>
  );
  return (
    <AuthCard kicker={OWNERS} title="Pick a New Password" sub={<>For <strong>{info.email}</strong>. The link works once{info.expiresAt ? ` and expires ${when(info.expiresAt)}` : ''}. You’ll be signed out everywhere else.</>}>
      <form className="stack" onSubmit={submit}>
        <input type="email" autoComplete="username" value={info.email || ''} readOnly hidden />
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoFocus /><small>At least 10 characters.</small></label>
        <label className="field"><span>Type it again</span><input type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || !f.password || !f.again}>{busy ? 'Saving…' : 'Save and Sign In'}</button>
      </form>
    </AuthCard>
  );
}

function Setup({ superAdmin }: { superAdmin: boolean }) {
  const { setUser, refresh } = useSession();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { setUser((await api<{ user: User }>('/api/setup', { method: 'POST', body: f })).user); await refresh(); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  return (
    <AuthCard title={superAdmin ? 'Create the Super Admin Account' : 'Create the Owner Account'}
      sub={superAdmin ? 'This only works once, with the super admin email set on the server. You’ll turn on two-step sign-in next.' : 'This only works once, with the owner’s email. After this you invite everyone else.'}>
      <form className="stack" onSubmit={submit}>
        <Text label="Your name" value={f.name} onChange={(name) => setF({ ...f, name })} />
        <Text label="Email" value={f.email} onChange={(email) => setF({ ...f, email })} />
        <label className="field"><span>Password</span><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><small>At least 10 characters.</small></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create Account'}</button>
      </form>
    </AuthCard>
  );
}

export function AcceptInvite() {
  const { token } = useParams();
  const { setUser } = useSession();
  const nav = useNavigate();
  const [inv, setInv] = useState<{ valid: boolean; email?: string; role?: Role; company?: string | null } | null>(null);
  const [f, setF] = useState({ name: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<typeof inv>(`/api/invite/${token}`).then(setInv).catch(() => setInv({ valid: false })); }, [token]);
  if (!inv) return <AuthCard title="Checking Your Invite…"><Loading /></AuthCard>;
  if (!inv.valid) return <AuthCard title="This Invite Doesn’t Work" sub="It expired or was already used. Ask for a new link."><Link className="btn" to="/">Go to the Book</Link></AuthCard>;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { setUser((await api<{ user: User }>(`/api/invite/${token}`, { method: 'POST', body: f })).user); nav(inv.role === 'superadmin' ? '/admin/account' : '/admin'); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  const what = inv.role === 'superadmin' ? 'a super admin' : `${inv.role === 'owner' ? 'an owner' : 'a manager'}${inv.company ? ` at ${inv.company}` : ''}`;
  return (
    <AuthCard title="Join the Training App" sub={<>You’re invited as <strong>{what}</strong>, with <strong>{inv.email}</strong>.</>}>
      <form className="stack" onSubmit={submit}>
        <Text label="Your name" value={f.name} onChange={(name) => setF({ ...f, name })} />
        <label className="field"><span>Choose a password</span><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><small>At least 10 characters.</small></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
      </form>
    </AuthCard>
  );
}

/* ---------- media ---------- */
export function MediaLibrary() {
  const { data, error, load, setData } = useLoad<{ media: MediaItem[] }>('/api/media');
  const archive = useLoad<{ media: MediaItem[] }>('/api/media?archived=1');
  const [showArchive, setShowArchive] = useState(false);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [play, setPlay] = useState<MediaItem | null>(null);
  const add = (m: MediaItem) => setData({ media: [m, ...(data?.media || [])] });

  const upload = async (files: FileList | null) => {
    setErr('');
    for (const f of Array.from(files || [])) {
      try { setProgress(0); add(await uploadFile(f, setProgress)); } catch (e) { setErr((e as Error).message); }
    }
    setProgress(null);
  };
  const addLink = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try { add(await api<MediaItem>('/api/media/youtube', { method: 'POST', body: { url: link, title } })); setLink(''); setTitle(''); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  // Archive, never delete (Tommy, Oct 28): it leaves the library and the pickers, and can be restored.
  const remove = async (m: MediaItem) => {
    if (!confirm(`Archive “${m.title}”? It leaves the library and the pickers. Pages already using it keep it, and you can restore it from the Archive below.`)) return;
    try { await api(`/api/media/${m.id}`, { method: 'DELETE' }); setData({ media: (data?.media || []).filter((x) => x.id !== m.id) }); archive.load(); }
    catch (e) { setErr((e as Error).message); }
  };
  // Captions on an uploaded video (Nov 14): add or replace (.vtt or .srt), or remove.
  const ccInput = useRef<HTMLInputElement>(null);
  const [ccFor, setCcFor] = useState<MediaItem | null>(null);
  const swap = (m: MediaItem) => { forgetCaptions(m.url || undefined); setData({ media: (data?.media || []).map((x) => (x.id === m.id ? m : x)) }); };
  const addCaptions = async (f: File | undefined) => {
    if (!f || !ccFor) return;
    setErr('');
    try { swap(await uploadCaptions(ccFor.id, f)); } catch (e) { setErr((e as Error).message); }
    setCcFor(null);
  };
  const removeCaptions = async (m: MediaItem) => {
    if (!confirm(`Take the captions off “${m.title}”?`)) return;
    try { swap(await api<MediaItem>(`/api/media/${m.id}/captions`, { method: 'DELETE' })); } catch (e) { setErr((e as Error).message); }
  };
  const restore = async (m: MediaItem) => {
    try { add(await api<MediaItem>(`/api/media/${m.id}/restore`, { method: 'POST' })); archive.load(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="admin-page">
      <h1>Videos and photos</h1>
      <p className="muted">Everything here can be picked in any page’s form, wherever there’s a photo or video.</p>
      <div className="grid2 media-add">
        <label className="drop">
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(e) => upload(e.target.files)} />
          {progress === null
            ? <><strong>Upload videos or photos</strong><span>MP4, MOV, WebM up to 600 MB · JPG, PNG, WebP</span></>
            : <><strong>Uploading… {progress}%</strong><span className="bar"><span style={{ width: progress + '%' }} /></span></>}
        </label>
        <form className="card stack" onSubmit={addLink}>
          <strong>Add a YouTube link</strong>
          <Text label="Link" value={link} placeholder="https://youtu.be/…" onChange={setLink} />
          <Text label="Title" value={title} placeholder="How we build the Old Fashioned" onChange={setTitle} />
          <button className="btn" disabled={!link.trim()}>Add Link</button>
        </form>
      </div>
      <input ref={ccInput} type="file" accept=".vtt,.srt,text/vtt" hidden onChange={(e) => { void addCaptions(e.target.files?.[0]); e.target.value = ''; }} />
      {(err || error) && <ErrorNote error={err || error} retry={error ? load : undefined} />}
      {!data && !error && <Loading />}
      {data && data.media.length === 0 && <Empty title="Nothing uploaded yet"><p className="muted">Upload a video or add a YouTube link to start.</p></Empty>}
      {data && data.media.length > 0 && (
        <div className="media-grid">
          {data.media.map((m) => (
            <div key={m.id} className="media-card">
              <button className="media-thumb" onClick={() => m.mime?.startsWith('image/') ? window.open(m.url!, '_blank') : setPlay(m)} aria-label={`Open ${m.title}`}>
                {m.mime?.startsWith('image/') && m.url ? <img src={m.url} alt="" /> : m.kind === 'youtube' ? <img src={`https://i.ytimg.com/vi/${m.youtubeId}/mqdefault.jpg`} alt="" /> : <span className="vid-icon">▶</span>}
              </button>
              <div className="media-meta">
                <strong title={m.title}>{m.title}</strong>
                <small className="muted">{m.kind === 'youtube' ? 'YouTube' : m.mime?.startsWith('video/') ? `Video · ${mb(m.size)}${m.captions ? ' · Captions' : ''}` : `Photo · ${mb(m.size)}`}</small>
              </div>
              {m.kind === 'file' && m.mime?.startsWith('video/') && (
                <div className="media-cc">
                  <button type="button" className="link-btn" onClick={() => { setCcFor(m); ccInput.current?.click(); }}>{m.captions ? 'Replace Captions' : 'Add Captions'}</button>
                  {m.captions && <button type="button" className="link-btn" onClick={() => void removeCaptions(m)}>Remove Captions</button>}
                </div>
              )}
              <button className="link-btn danger" onClick={() => remove(m)}>Archive</button>
            </div>
          ))}
        </div>
      )}
      {(archive.data?.media.length || 0) > 0 && (
        <section className="stack-sm">
          <button type="button" className="link-btn" aria-expanded={showArchive} onClick={() => setShowArchive((v) => !v)}>
            {showArchive ? 'Hide' : 'Show'} the Archive ({archive.data!.media.length})
          </button>
          {showArchive && (
            <div className="media-grid">
              {archive.data!.media.map((m) => (
                <div key={m.id} className="media-card archived">
                  <span className="media-thumb">{m.mime?.startsWith('image/') && m.url ? <img src={m.url} alt="" /> : m.kind === 'youtube' ? <img src={`https://i.ytimg.com/vi/${m.youtubeId}/mqdefault.jpg`} alt="" /> : <span className="vid-icon">▶</span>}</span>
                  <div className="media-meta"><strong title={m.title}>{m.title}</strong></div>
                  <button className="link-btn" onClick={() => void restore(m)}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {play && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setPlay(null); }}>
          <div className="modal video-modal" role="dialog" aria-modal="true" aria-label={play.title}>
            <button className="icon-btn" onClick={() => setPlay(null)} aria-label="Close">✕</button>
            <div className="video-frame">
              <VideoEmbed video={play.kind === 'youtube' ? { kind: 'youtube', youtubeId: play.youtubeId!, title: play.title } : { kind: 'file', url: play.url!, title: play.title }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const mb = (n: number | null) => (n ? (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`) : '');

/* ---------- team ---------- */
type Member = { id: number; name: string; email: string | null; role: Role; createdAt: string; lastSeenAt: string | null; hasPin: boolean; signedOff: number; storeId: number | null; storeName: string | null; canManage: boolean };
type Invite = { id: string; email: string; role: string; created_at: string; expires_at: string; storeName: string | null };
type StoreRow = { id: number; name: string; bookReady: boolean };
type TeamData = { company: { id: number; name: string; joinCode: string }; stores: StoreRow[]; yourStore: number | null; people: Member[]; invites: Invite[]; you: number; youRole: Role };
export function People({ leadsOnly = false }: { leadsOnly?: boolean }) {
  const { user } = useSession();
  const { data, error, load } = useLoad<TeamData>('/api/team');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('manager');
  const [inviteStore, setInviteStore] = useState('');
  const [show, setShow] = useState<number | 'all'>('all');
  const [made, setMade] = useState<{ link: string; email: string } | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState('');
  const [reset, setReset] = useState<ResetLink | null>(null);
  const owner = data?.youRole === 'owner' || data?.youRole === 'superadmin';
  const makeReset = (p: Member) => {
    if (!confirm(`Make a password reset link for ${p.name}? Their password keeps working until they use the link.`)) return;
    void run(async () => { setReset(null); setReset(await api<ResetLink>(`/api/team/${p.id}/reset-password`, { method: 'POST' })); });
  };
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setErr(''); setNote(''); try { await fn(); if (ok) setNote(ok); load(); } catch (e) { setErr((e as Error).message); } };
  const copy = (text: string, what: string) => { void navigator.clipboard.writeText(text); setCopied(what); };

  const invite = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setCopied('');
    try { const r = await api<{ link: string; email: string }>('/api/team/invite', { method: 'POST', body: { email, role, storeId: role === 'manager' && inviteStore ? Number(inviteStore) : null } }); setMade({ ...r, link: location.origin + r.link }); setEmail(''); load(); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  if (error) return <div className="admin-page"><ErrorNote error={error} retry={load} /></div>;
  if (!data) return <div className="admin-page"><Loading /></div>;
  const switcher = !data.yourStore && data.youRole !== 'staff';
  const multi = data.stores.length > 1;
  const leads = data.people.filter((p) => p.role !== 'staff');
  const staff = data.people.filter((p) => p.role === 'staff' && (show === 'all' || p.storeId === show));
  const move = (p: Member, storeId: number | null) => void run(() => api(`/api/team/${p.id}`, { method: 'PATCH', body: { storeId } }), `${p.name} moved to ${storeId ? data.stores.find((x) => x.id === storeId)?.name : 'every store'}.`);
  const joinUrl = location.origin + '/';

  return (
    <div className="admin-page">
      {leadsOnly && <Link className="link-btn back-link" to="/admin/people">← People</Link>}
      <h1>{leadsOnly ? 'Owners and managers' : 'Team'}</h1>
      <p className="muted">{data.company.name}{multi ? ` · ${data.stores.map((x) => x.name).join(', ')}` : ''}. {leadsOnly ? 'Owners and managers sign in with email. Owners invite them and set their role and store here.' : 'Owners and managers sign in with email; staff join with the code below, pick their restaurant, and use a PIN.'}</p>
      {err && <ErrorNote error={err} />}
      {note && <p className="ok" role="status">{note}</p>}

      {!leadsOnly && <>
      <section className="card stack">
        <h2>Staff join code</h2>
        <div className="join-code" aria-label="Join code">{data.company.joinCode || (user?.demo ? 'DEMO' : '–')}</div>
        <p className="muted small">Staff open <strong>{joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</strong>, type this code, {multi ? 'pick their restaurant, ' : ''}pick their name (or “I’m New Here”) and a PIN. One code for {multi ? 'every restaurant in the group' : 'the whole team'}. Share it at line-up or post it in the back of house.</p>
        <div className="row">
          <button className="btn ghost" onClick={() => copy(`Join the ${data.company.name} training app on Mise: ${joinUrl}  Join code: ${data.company.joinCode}`, 'code')}>{copied === 'code' ? 'Copied' : 'Copy Code and Link'}</button>
          <button className="link-btn danger" onClick={() => { if (confirm('Make a new join code? The old one stops working. People already signed in stay signed in.')) void run(() => api('/api/team/join-code', { method: 'POST' }), 'New join code made.'); }}>New Code</button>
        </div>
      </section>

      <h2 className="sub">Staff · {staff.length}</h2>
      {switcher && multi && (
        <div className="row chip-row" role="tablist" aria-label="Show staff from">
          {[{ id: 'all' as const, name: 'All stores' }, ...data.stores].map((x) => <button key={x.id} role="tab" aria-selected={show === x.id} className={'chip' + (show === x.id ? ' on' : '')} onClick={() => setShow(x.id)}>{x.name}</button>)}
        </div>
      )}
      {staff.length === 0 && <p className="muted small">No one has joined yet. Share the join code.</p>}
      {staff.length > 0 && (
        <table className="table">
          <thead><tr><th>Name</th>{multi && <th>Store</th>}<th>Signed off</th><th>Joined</th><th>Last seen</th><th /></tr></thead>
          <tbody>{staff.map((p) => (
            <tr key={p.id}>
              <td>{p.name}{!p.hasPin && <small className="muted"> · picking a new PIN</small>}</td>
              {multi && <td>{switcher && p.canManage
                ? <select aria-label={`${p.name}’s store`} value={p.storeId ?? ''} onChange={(e) => move(p, Number(e.target.value))}>{data.stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                : p.storeName}</td>}
              <td>{p.signedOff}</td><td>{when(p.createdAt)}</td><td>{when(p.lastSeenAt)}</td>
              <td className="row-actions">{p.canManage && <>
                <button className="link-btn" onClick={() => { if (confirm(`Reset ${p.name}’s PIN? They’re signed out and pick a new PIN next time.`)) void run(() => api(`/api/team/${p.id}/reset-pin`, { method: 'POST' }), `${p.name} picks a new PIN next time they sign in.`); }}>Reset PIN</button>
                <button className="link-btn danger" onClick={() => { if (confirm(`Remove ${p.name}? They’re signed out right away.`)) void run(() => api(`/api/team/${p.id}`, { method: 'DELETE' })); }}>Remove</button>
              </>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      </>}

      <h2 className="sub">Owners and managers · {leads.length}</h2>
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th>{multi && <th>Store</th>}<th>Last seen</th><th /></tr></thead>
        <tbody>{leads.map((p) => (
          <tr key={p.id}>
            <td>{p.name}{p.id === data.you && <small className="muted"> · you</small>}</td><td>{p.email}</td>
            <td>{owner && p.id !== data.you
              ? <select aria-label={`${p.name}’s role`} value={p.role} onChange={(e) => void run(() => api(`/api/team/${p.id}`, { method: 'PATCH', body: { role: e.target.value } }))}><option value="owner">Owner</option><option value="manager">Manager</option></select>
              : ROLE_LABEL[p.role]}</td>
            {multi && <td>{p.role === 'owner' ? 'Every store'
              : owner && p.id !== data.you
                ? <select aria-label={`${p.name}’s stores`} value={p.storeId ?? ''} onChange={(e) => move(p, e.target.value ? Number(e.target.value) : null)}><option value="">Every store</option>{data.stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                : p.storeName || 'Every store'}</td>}
            <td>{when(p.lastSeenAt)}</td>
            <td>{owner && p.id !== data.you && <div className="row-actions">
              {p.email && <button className="link-btn" onClick={() => makeReset(p)}>Reset Password</button>}
              <button className="link-btn danger" onClick={() => { if (confirm(`Remove ${p.name}? They’re signed out and can’t edit anymore.`)) void run(() => api(`/api/team/${p.id}`, { method: 'DELETE' })); }}>Remove</button>
            </div>}</td>
          </tr>
        ))}</tbody>
      </table>
      {reset && <ResetLinkCard reset={reset} onClose={() => setReset(null)} />}

      {owner && (
        <>
          <form className="card invite-form" onSubmit={invite}>
            <Text label="Invite an owner or manager by email" value={email} placeholder="manager@thebaldwinshelby.com" onChange={setEmail} />
            <label className="field"><span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}><option value="manager">Manager: edits the book, signs people off, manages staff</option><option value="owner">Owner: every store, plus owners and managers</option></select>
            </label>
            {multi && role === 'manager' && <label className="field"><span>Store</span>
              <select value={inviteStore} onChange={(e) => setInviteStore(e.target.value)}><option value="">Every store</option>{data.stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </label>}
            <button className="btn" disabled={!email.trim()}>Create Invite Link</button>
          </form>
          {made && (
            <div className="card ok-card" role="status">
              <p>Send this link to <strong>{made.email}</strong>. It works once and expires in 14 days.</p>
              <div className="row"><input readOnly value={made.link} onFocus={(e) => e.target.select()} aria-label="Invite link" /><button className="btn ghost" onClick={() => copy(made.link, 'link')}>{copied === 'link' ? 'Copied' : 'Copy'}</button></div>
            </div>
          )}
          {data.invites.length > 0 && (
            <>
              <h2 className="sub">Open invites</h2>
              <table className="table">
                <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th /></tr></thead>
                <tbody>{data.invites.map((i) => (
                  <tr key={i.id}><td>{i.email}</td><td>{ROLE_LABEL[i.role as Role] || i.role}{i.storeName ? ` · ${i.storeName}` : ''}</td><td>{when(i.expires_at)}</td><td><button className="link-btn danger" onClick={() => void run(() => api(`/api/team/invites/${i.id}`, { method: 'DELETE' }))}>Cancel</button></td></tr>
                ))}</tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- account ---------- */
export function Account() {
  const { user, setUser, refresh } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [twoMsg, setTwoMsg] = useState('');
  const [twoErr, setTwoErr] = useState('');
  const change = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    try { await api('/api/password', { method: 'POST', body: f }); setMsg('Password changed. Other devices were signed out.'); setF({ current: '', next: '' }); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  const start2 = async () => { setTwoErr(''); try { setSetup(await api('/api/2fa/start', { method: 'POST' })); } catch (e) { setTwoErr((e as Error).message); } };
  const enable2 = async (e: FormEvent) => {
    e.preventDefault(); setTwoErr('');
    try { await api('/api/2fa/enable', { method: 'POST', body: { code } }); setSetup(null); setCode(''); setTwoMsg('Two-step sign-in is on. Next time you sign in, you’ll type a code from the app.'); await refresh(); }
    catch (e2) { setTwoErr((e2 as Error).message); }
  };
  const off2 = async () => {
    const password = prompt('Type your password to turn off two-step sign-in.');
    if (!password) return;
    try { await api('/api/2fa/disable', { method: 'POST', body: { password } }); setTwoMsg('Two-step sign-in is off.'); await refresh(); } catch (e) { setTwoErr((e as Error).message); }
  };
  const signOut = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); setUser(null); nav('/'); };
  const isSuper = user?.role === 'superadmin';
  return (
    <div className="admin-page narrow">
      <h1>Your account</h1>
      <p className="muted">{user?.name} · {user?.email} · {user ? ROLE_LABEL[user.role] : ''}{user?.companyName ? ` · ${user.companyName}` : ''}</p>
      <section className="card stack">
        <h2>Two-step sign-in</h2>
        {isSuper && !user?.totpOn && <p className="error" role="alert">Super admins need two-step sign-in before the super admin opens.</p>}
        <p className="muted small">After your password, you type a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password or Authy).</p>
        {user?.totpOn && <p className="ok">On.{!isSuper && <> <button className="link-btn danger" onClick={() => void off2()}>Turn Off</button></>}</p>}
        {!user?.totpOn && !setup && <button className="btn" onClick={() => void start2()}>Turn On Two-Step Sign-In</button>}
        {setup && (
          <form className="stack" onSubmit={enable2}>
            <ol className="steps-list">
              <li>In your authenticator app, add an account and scan this code.</li>
              <li>Type the 6-digit code the app shows.</li>
            </ol>
            <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qr }} aria-label="QR code for your authenticator app" role="img" />
            <p className="muted small">Can’t scan? Enter this key instead: <code className="secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
            <label className="field"><span>Code from the app</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
            <button className="btn" disabled={code.length !== 6}>Turn On</button>
          </form>
        )}
        {twoErr && <ErrorNote error={twoErr} />}
        {twoMsg && <p className="ok" role="status">{twoMsg}</p>}
      </section>
      <form className="card stack" onSubmit={change}>
        <h2>Change password</h2>
        <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /><small>At least 10 characters.</small></label>
        {err && <ErrorNote error={err} />}
        {msg && <p className="ok" role="status">{msg}</p>}
        <button className="btn" disabled={!f.current || !f.next}>Change Password</button>
      </form>
      {!user?.demo && <button className="btn ghost" onClick={signOut}>Sign Out</button>}
    </div>
  );
}

/* ---------- activity ---------- */
type Row = { id: number; name: string | null; action: string; detail: string | null; at: string };
const ACTIONS: Record<string, string> = { 'joined with the code': 'Joined with the code:', 'reset PIN': 'Reset the PIN for', 'set a new PIN': 'Picked a new PIN', 'changed PIN': 'Changed their PIN', 'new join code': 'Made a new join code', 'change role': 'Changed a role:', 'remove person': 'Removed', rename: 'Renamed', 'two-step on': 'Turned on two-step sign-in', 'two-step off': 'Turned off two-step sign-in', 'set section': 'Set a section:', edit: 'Edited', revert: 'Undid an edit on', setup: 'Created the owner account', login: 'Signed in', password: 'Changed their password', invite: 'Invited', joined: 'Joined', upload: 'Uploaded', 'add youtube': 'Added a YouTube video', 'delete media': 'Deleted a file', 'archive media': 'Archived', 'restore media': 'Restored', 'remove user': 'Removed a person', 'cancel invite': 'Cancelled an invite', 'add dish': 'Added recipe', 'edit dish': 'Edited recipe', 'delete dish': 'Deleted recipe', 'add cocktail': 'Added cocktail', 'sign off': 'Signed off', 'undo sign off': 'Undid a sign-off for', 'edit cocktail': 'Edited cocktail', 'delete cocktail': 'Deleted cocktail', 'reset link': 'Made a password reset link for', 'reset password': 'Reset their password', 'reset email': 'Was emailed a password reset link', 'reset asked': 'Asked for a password reset email:' };
export function Activity() {
  const { data, error, load } = useLoad<{ audit: Row[] }>('/api/audit');
  const { index } = useSession();
  const pageName = (id: string) => index.find((e) => e.id === id || e.file === id)?.name || id;
  const what = (r: Row) => {
    const verb = ACTIONS[r.action] || r.action;
    if ((r.action === 'edit' || r.action === 'revert') && r.detail) return `${verb} ${pageName(r.detail.split(' ')[0])}`;
    if (['upload', 'add youtube', 'delete media', 'remove user', 'cancel invite', 'login', 'password', 'setup', 'set a new PIN', 'changed PIN', 'new join code', 'two-step on', 'two-step off', 'reset email'].includes(r.action)) return verb;
    return r.detail ? `${verb} ${r.detail}` : verb;
  };
  return (
    <div className="admin-page">
      <h1>Activity</h1>
      <p className="muted">The last 200 changes, newest first.</p>
      {error && <ErrorNote error={error} retry={load} />}
      {!data && !error && <Loading />}
      {data && data.audit.length === 0 && <Empty title="No activity yet" />}
      {data && data.audit.length > 0 && (
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>{data.audit.map((r) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.name || '—'}</td><td>{what(r)}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}
