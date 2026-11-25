// Admin screens: sign in, first-time setup, invites, lists, media, people, account, activity.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, uploadCaptions, uploadFile, ROLE_LABEL, type MailStatus, type MediaItem, type Role, type TeamRole, type User } from '../lib/api';
import { useSession } from '../lib/session';
import { VideoEmbed, forgetCaptions } from '../components/VideoEmbed';
import { Empty, ErrorNote, InviteSentCard, Loading, ResetLinkCard, Text, useAsk, when, type ResetLink } from './ui';
import { PRODUCT_NAME } from '../lib/brand';
import { registerLook } from '../lib/theme';
import { AuthCard } from '../components/AuthCard';
import type { Brand } from '../lib/theme';
import { linkText } from '../lib/account';
import { joinPath, markMoved, setUpPath } from '../lib/authroute';
import { LegalLinks, SupportLine } from '../components/Legal';
import { landingFor, needsTwoStep, TWO_STEP_MSG } from '../lib/twostep';
import { TempTag, useTemp, type Temporary } from './temppass';
import { ChooseOwn, type MustChoose } from '../components/ChooseOwn';

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
// Nov 23 (Tommy: "There should be a 'Join with a Code,' and there should be 'Sign In.' Doesn't matter what position you are
// in."): no role label over any of these screens (it said "Owners and managers").

/** Sign In: email + password, for everyone with an account (Nov 23: at /sign-in, /admin, and an account's own link).
 *  brand / kicker / account (Nov 19, Nov 23): on an account's link (/the-baldwin) it wears that account's look with its name
 *  over the title, and Join with a Code goes to that account's /the-baldwin/join. Elsewhere: Mise, and /join. Nov 24: staff
 *  on a PIN use "Joined with a PIN? Sign In with Your PIN" (the code → name → PIN screens, titled as a sign-in).
 *  Nov 25 (section 50, approved): nobody signs in with a PIN. That line is now "Joined with a PIN? Set Up Your Sign-In",
 *  the one-time move to email + password (src/components/SetUpSignIn.tsx). Join with a Code is the card's second button,
 *  and Try the Demo sits under the card (not on an account's link). */
export function SignIn({ brand, kicker, account = null }: { brand?: Brand; kicker?: string; account?: { slug: string } | null } = {}) {
  const { setUser, setupNeeded, superSetupNeeded } = useSession();
  const join = joinPath(account);
  // signed in with email here: this phone opens Sign In from now on, not Set Up Your Sign-In (src/lib/authroute.ts)
  const done = (u: User) => { markMoved(); setUser(u); };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const [forgot, setForgot] = useState(false);
  // Nov 24: signed in with a temporary password (after the two-step code, if that's on): Choose Your Own Password first
  const [choose, setChoose] = useState<MustChoose | null>(null);
  if (setupNeeded || setup) return <Setup superAdmin={!setupNeeded && superSetupNeeded} />;
  if (choose) return <ChooseOwn need={choose} temp={password} brand={brand} kicker={kicker} onDone={done}
    onBack={() => { setChoose(null); setTicket(''); setCode(''); setPassword(''); setError(''); }} />;
  if (forgot) return <ForgotPassword brand={brand} email={email} onBack={(e) => { setForgot(false); setEmail(e); setError(''); }} />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<{ user?: User; needCode?: boolean; ticket?: string } & Partial<MustChoose>>('/api/login', { method: 'POST', body: { email, password } });
      if (r.mustChoose) setChoose(r as MustChoose); else if (r.needCode) setTicket(r.ticket!); else done(r.user!);
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  const submitCode = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<{ user?: User } & Partial<MustChoose>>('/api/login/code', { method: 'POST', body: { ticket, code } });
      if (r.mustChoose) setChoose(r as MustChoose); else done(r.user!);
    } catch (err) { setError((err as Error).message); if (/timed out|stopped working/.test((err as Error).message)) { setTicket(''); setCode(''); } }
    setBusy(false);
  };
  if (ticket) return (
    <AuthCard kicker={kicker} brand={brand} title="Two-Step Sign-In" sub="Open your authenticator app and type the 6-digit code for Mise.">
      <form className="stack" onSubmit={submitCode}>
        <label className="field"><span>Code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign In'}</button>
        <button type="button" className="link-btn" onClick={() => { setTicket(''); setCode(''); setError(''); }}>Start over</button>
      </form>
    </AuthCard>
  );
  return (
    <AuthCard kicker={kicker} brand={brand} title="Sign In" sub="Use your email and password."
      foot={account ? undefined : <>Just looking? <Link to="/demo/mise">Try the Demo</Link></>}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Email</span>
          <input inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button type="button" className="link-btn si-forgot" onClick={() => { setForgot(true); setError(''); }}>Forgot Password?</button>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || !email || !password}>{busy ? 'Signing In…' : 'Sign In'}</button>
        {superSetupNeeded && <button type="button" className="link-btn" onClick={() => setSetup(true)}>Set up the super admin account</button>}
      </form>
      <hr className="si-rule" />
      <p className="si-alt">New here? Your manager has the code.</p>
      <Link className="btn ghost si-btn-link" to={join}>Join with a Code</Link>
      {/* Nov 24 (Tommy: "they have to give them the pin option … I don't have everyone's email"): staff who joined with a
          PIN always have a way in. Nov 25 (section 50): it's the one-time move to email + password. */}
      <p className="si-alt">Joined with a PIN? <Link to={setUpPath(account)}>Set Up Your Sign-In</Link></p>
    </AuthCard>
  );
}

/** Forgot Password? (Nov 11): the same answer for every email. The link comes by email when Resend is set up. */
function ForgotPassword({ email: start, onBack, brand }: { email: string; onBack: (email: string) => void; brand?: Brand }) {
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
    <AuthCard brand={brand} title="Check Your Email" sub={sent}>
      <div className="stack">
        <p className="muted small">The link works once and expires in 24 hours.</p>
        <button type="button" className="btn" onClick={() => onBack(email)}>Back to Sign In</button>
      </div>
    </AuthCard>
  );
  return (
    <AuthCard brand={brand} title="Forgot Your Password?" sub="Type the email you sign in with. If it has an account, we’ll email a link to pick a new password.">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send Reset Link'}</button>
        <button type="button" className="link-btn" onClick={() => onBack(email)}>Back to Sign In</button>
        <p className="muted small">Joined with a PIN and haven’t set up email yet? Use Set Up Your Sign-In on the sign-in page.</p>
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
  const done = (u: User) => { setUser(u); nav(landingFor(u)); };
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
    <AuthCard title="Two-Step Sign-In" sub="Your new password is set. Open your authenticator app and type the 6-digit code for Mise.">
      <form className="stack" onSubmit={submitCode}>
        <label className="field"><span>Code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign In'}</button>
      </form>
    </AuthCard>
  );
  return (
    <AuthCard title="Pick a New Password" sub={<>For <strong>{info.email}</strong>. The link works once{info.expiresAt ? ` and expires ${when(info.expiresAt)}` : ''}. You’ll be signed out everywhere else.</>}>
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
  const [inv, setInv] = useState<{ valid: boolean; email?: string; role?: Role; company?: string | null; store?: string | null; brand?: import('../lib/theme').Brand;
    teamRole?: TeamRole | null; promotion?: boolean; name?: string | null } | null>(null);
  const [f, setF] = useState({ name: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<typeof inv & { lookSpec?: unknown }>(`/api/invite/${token}`).then((r) => { if (r?.brand && r.lookSpec) registerLook(r.brand, r.lookSpec, { quiet: true }); setInv(r); }).catch(() => setInv({ valid: false })); }, [token]);
  if (!inv) return <AuthCard title="Checking Your Invite…"><Loading /></AuthCard>;
  if (!inv.valid) return <AuthCard title="This Invite Doesn’t Work" sub="It expired, was already used, or a newer link replaced it. Ask for a new link."><Link className="btn" to="/">Go to the Book</Link></AuthCard>;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { setUser((await api<{ user: User }>(`/api/invite/${token}`, { method: 'POST', body: f })).user); nav(inv.role === 'superadmin' ? '/admin/account' : '/admin'); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  // Promote to Manager (Nov 16): the same person, so no name to type; just the password they'll sign in with.
  if (inv.promotion) {
    const first = (inv.name || '').split(' ')[0];
    const place = inv.store || inv.company;
    return (
      <AuthCard brand={inv.brand} title="You’re a Manager Now"
        sub={<>Congratulations{first ? `, ${first}` : ''}. You’re a manager{place ? <> at <strong>{place}</strong></> : ''}. Pick a password to sign in with <strong>{inv.email}</strong> from now on. Your training, quiz scores, certificates and chat stay with you.</>}>
        <form className="stack" onSubmit={submit}>
          <input type="email" autoComplete="username" value={inv.email || ''} readOnly hidden />
          <label className="field"><span>Choose a password</span><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoFocus /><small>At least 10 characters.</small></label>
          {error && <ErrorNote error={error} />}
          <button className="btn" disabled={busy || !f.password}>{busy ? 'Saving…' : 'Save and Sign In'}</button>
        </form>
      </AuthCard>
    );
  }
  const what = inv.role === 'superadmin' ? `${inv.teamRole === 'support' ? 'Support' : 'a Manager'} on the Mise team` : `${inv.role === 'owner' ? 'an owner' : 'a manager'}${inv.company ? ` at ${inv.company}` : ''}`;
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
/** Storage line (Nov 16): 1,536 MB reads as 1.5 GB. */
const mbOrGb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(b > 0 ? 1 : 0, Math.round(b / 1024 ** 2))} MB`);
export function MediaLibrary() {
  const { data, error, load, setData } = useLoad<{ media: MediaItem[]; storage?: { used: number; cap: number } }>('/api/media');
  const archive = useLoad<{ media: MediaItem[] }>('/api/media?archived=1');
  const [showArchive, setShowArchive] = useState(false);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [play, setPlay] = useState<MediaItem | null>(null);
  const add = (m: MediaItem) => setData({ ...data, media: [m, ...(data?.media || [])] });

  const upload = async (files: FileList | null) => {
    setErr('');
    for (const f of Array.from(files || [])) {
      try { setProgress(0); add(await uploadFile(f, setProgress)); } catch (e) { setErr((e as Error).message); }
    }
    setProgress(null);
    load(); // the storage line
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
      {data?.storage && <p className="muted small">Uploads: {mbOrGb(data.storage.used)} of {mbOrGb(data.storage.cap)} used. Long videos fit better as YouTube links.</p>}
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
type Member = { id: number; name: string; email: string | null; role: Role; createdAt: string; lastSeenAt: string | null; hasPin: boolean; /** Nov 25: signs in with email + password (a staff member who moved over, or joined after Nov 25) */ emailSignIn?: boolean; signedOff: number; storeId: number | null; storeName: string | null; canManage: boolean;
  /** Nov 16: Promote to Manager / Change to Staff */
  canPromote?: boolean; canDemote?: boolean; promotion?: { email: string; storeName: string | null; createdAt: string; expiresAt: string } | null;
  /** Nov 24: a temporary password waiting to be used */ temporary?: Temporary; totpOn?: boolean };
type Invite = { id: string; email: string; role: string; created_at: string; expires_at: string; storeName: string | null };
type StoreRow = { id: number; name: string; bookReady: boolean };
type TeamData = { company: { id: number; name: string; joinCode: string; demo?: boolean; link?: string | null }; stores: StoreRow[]; yourStore: number | null; people: Member[]; invites: Invite[]; you: number; youRole: Role };
export function People({ leadsOnly = false }: { leadsOnly?: boolean }) {
  const { user, mailOn } = useSession();
  const { data, error, load } = useLoad<TeamData>('/api/team');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('manager');
  const [inviteStore, setInviteStore] = useState('');
  const [show, setShow] = useState<number | 'all'>('all');
  const [made, setMade] = useState<{ link: string; email: string; days?: number; mail?: MailStatus } | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState('');
  const [reset, setReset] = useState<ResetLink | null>(null);
  const owner = data?.youRole === 'owner' || data?.youRole === 'superadmin';
  const { ask, askThen, asking } = useAsk(); // Nov 23: asks inside the page, never the browser's confirm() (see useAsk)
  // Nov 24: Set Temporary Password beside the resets (owners for owners and managers; managers for their staff, who give
  // an email in the dialog).
  const { openTemp, cancelTemp, tempDialog } = useTemp({ ask, done: (t) => { setErr(''); setNote(t); }, fail: setErr, reload: load });
  const tempPath = (p: Member) => `/api/team/${p.id}/temporary`;
  const tempButton = (p: Member) => (p.temporary
    ? <button className="link-btn" onClick={() => void cancelTemp(p, tempPath(p))}>Cancel Temporary</button>
    : <button className="link-btn" onClick={() => { setErr(''); setNote(''); openTemp({ person: p, path: tempPath(p), roleLabel: ROLE_LABEL[p.role], twoStep: p.totpOn }); }}>Set Temporary Password</button>);
  // Nov 16: back to staff, same person. They sign in with their PIN again (or pick one with the join code and their name).
  const demote = (p: Member) => {
    const where = p.storeName || user?.store?.name || 'their store';
    void askThen({ title: `Change ${p.name} to Staff?`, body: `${p.name} becomes staff at ${where}. They’re signed out and sign in with their email and password, as before. Their training and history stay.`, go: 'Change to Staff' }, () => run(() => api(`/api/team/${p.id}/demote`, { method: 'POST', body: {} }), `${p.name} is staff at ${where} now.`));
  };
  const makeReset = (p: Member) => {
    void askThen({ title: `Make a Password Reset Link for ${p.name}?`, body: 'Their password keeps working until they use the link.', go: 'Make Link' }, () => run(async () => { setReset(null); setReset(await api<ResetLink>(`/api/team/${p.id}/reset-password`, { method: 'POST' })); }));
  };
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setErr(''); setNote(''); try { await fn(); if (ok) setNote(ok); load(); } catch (e) { setErr((e as Error).message); } };
  const copy = (text: string, what: string) => { void navigator.clipboard.writeText(text); setCopied(what); };

  const invite = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setCopied('');
    try { const r = await api<{ link: string; email: string; days: number; mail: MailStatus }>('/api/team/invite', { method: 'POST', body: { email, role, storeId: role === 'manager' && inviteStore ? Number(inviteStore) : null } }); setMade({ ...r, link: location.origin + r.link }); setEmail(''); load(); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  if (error) return <div className="admin-page"><ErrorNote error={error} retry={load} /></div>;
  if (!data) return <div className="admin-page"><Loading /></div>;
  const switcher = !data.yourStore && data.youRole !== 'staff';
  const multi = data.stores.length > 1;
  const leads = data.people.filter((p) => p.role !== 'staff');
  const staff = data.people.filter((p) => p.role === 'staff' && (show === 'all' || p.storeId === show));
  const move = (p: Member, storeId: number | null) => void run(() => api(`/api/team/${p.id}`, { method: 'PATCH', body: { storeId } }), `${p.name} moved to ${storeId ? data.stores.find((x) => x.id === storeId)?.name : 'every store'}.`);
  // Nov 19: staff open the company's own link (miseacademy.app/the-baldwin): its card when shared, its look at sign-in
  const joinUrl = location.origin + (data.company.link || '/');

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
        <p className="muted small">Staff open <strong>{joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</strong>, type this code, {multi ? 'pick their restaurant, ' : ''}and add their name, email and a password. One code for {multi ? 'every restaurant in the group' : 'the whole team'}. Share it at line-up or post it in the back of house.</p>
        <div className="row">
          <button className="btn ghost" onClick={() => copy(`Join the ${data.company.name} training app on Mise: ${joinUrl}  Join code: ${data.company.joinCode}`, 'code')}>{copied === 'code' ? 'Copied' : 'Copy Code and Link'}</button>
          {data.company.link && <button className="btn ghost" onClick={() => copy(joinUrl, 'link')} aria-label={`Copy Link, ${linkText(data.company.link)}`}>{copied === 'link' ? 'Copied' : 'Copy Link'}</button>}
          <button className="link-btn danger" onClick={() => void askThen({ title: 'Make a New Join Code?', body: 'The old one stops working. People already signed in stay signed in.', go: 'New Code' }, () => run(() => api('/api/team/join-code', { method: 'POST' }), 'New join code made.'))}>New Code</button>
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
              <td>{p.name}{p.emailSignIn ? <small className="muted"> · {p.email}</small> : <small className="muted"> · {p.hasPin ? 'on a PIN until they set up email' : 'PIN reset: sets up email next'}</small>}<TempTag temp={p.temporary} /></td>
              {multi && <td>{switcher && p.canManage
                ? <select aria-label={`${p.name}’s store`} value={p.storeId ?? ''} onChange={(e) => move(p, Number(e.target.value))}>{data.stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                : p.storeName}</td>}
              <td>{p.signedOff}</td><td>{when(p.createdAt)}</td><td>{when(p.lastSeenAt)}</td>
              <td className="row-actions">{p.canManage && <>
                {!data.company.demo && tempButton(p)}
                {!p.emailSignIn && <button className="link-btn" onClick={() => void askThen({ title: `Reset ${p.name}’s PIN?`, body: 'They’re signed out. Next time, Set Up Your Sign-In skips the PIN and asks for their email and a password.', go: 'Reset PIN' }, () => run(() => api(`/api/team/${p.id}/reset-pin`, { method: 'POST' }), `${p.name}’s PIN is reset. They set up email and a password next time.`))}>Reset PIN</button>}
                <button className="link-btn danger" onClick={() => void askThen({ title: `Remove ${p.name}?`, body: 'They’re signed out right away.', go: 'Remove', danger: true }, () => run(() => api(`/api/team/${p.id}`, { method: 'DELETE' }), `${p.name} is removed.`))}>Remove</button>
              </>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      </>}

      <h2 className="sub">Owners and managers · {leads.length}</h2>
      {/* Nov 25: the row holds its layout (as Super Admin → People did, b45c335). The shared .row-actions rule made the actions
          cell a flex box, out of the table, and four actions stacked or wrapped. Now the email sits under the name and the
          actions run in one line across the bottom of the person's row; under 640 px of room each person is a card. */}
      <div className="leads-wrap"><table className={'table leads-table' + (multi ? ' multi' : '')}>
        <thead><tr><th>Name</th><th>Role</th>{multi && <th>Store</th>}<th>Last seen</th><th className="sr-only">Actions</th></tr></thead>
        <tbody>{leads.map((p) => (
          <tr key={p.id}>
            <td className="person"><span className="person-name">{p.name}{p.id === data.you && <small className="muted"> · you</small>}</span>
              <small className="person-sub email">{p.email}</small><TempTag temp={p.temporary} /></td>
            <td data-label="Role">{owner && p.id !== data.you
              ? <select aria-label={`${p.name}’s role`} value={p.role} onChange={(e) => void run(() => api(`/api/team/${p.id}`, { method: 'PATCH', body: { role: e.target.value } }))}><option value="owner">Owner</option><option value="manager">Manager</option></select>
              : ROLE_LABEL[p.role]}</td>
            {multi && <td data-label="Store">{p.role === 'owner' ? 'Every store'
              : owner && p.id !== data.you
                ? <select aria-label={`${p.name}’s stores`} value={p.storeId ?? ''} onChange={(e) => move(p, e.target.value ? Number(e.target.value) : null)}><option value="">Every store</option>{data.stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                : p.storeName || 'Every store'}</td>}
            <td data-label="Last seen" className="when">{when(p.lastSeenAt)}</td>
            {(owner || p.canDemote) && p.id !== data.you ? <td className="row-actions"><div className="acts">
              {owner && p.email && !data.company.demo && tempButton(p)}
              {owner && p.email && !data.company.demo && <button className="link-btn" onClick={() => makeReset(p)}>Reset Password</button>}
              {p.canDemote && <button className="link-btn" onClick={() => demote(p)}>Change to Staff</button>}
              {owner && !data.company.demo && <button className="link-btn danger" onClick={() => void askThen({ title: `Remove ${p.name}?`, body: 'They’re signed out and can’t edit anymore.', go: 'Remove', danger: true }, () => run(() => api(`/api/team/${p.id}`, { method: 'DELETE' }), `${p.name} is removed.`))}>Remove</button>}
            </div></td> : <td className="row-actions none" />}
          </tr>
        ))}</tbody>
      </table></div>
      {reset && <ResetLinkCard reset={reset} onClose={() => setReset(null)} />}
      {tempDialog}
      {owner && data.people.some((p) => p.promotion) && (
        <>
          <h2 className="sub">Promotions sent</h2>
          <p className="muted small">Staff with a link to become a manager. They keep signing in with their PIN until they use it. Copy a new link from their People page.</p>
          <table className="table stack-table">
            <thead><tr><th>Name</th><th>Email</th><th>Manages</th><th>Expires</th><th /></tr></thead>
            <tbody>{data.people.filter((p) => p.promotion).map((p) => (
              <tr key={p.id}><td>{p.name}</td><td data-label="Email">{p.promotion!.email}</td><td data-label="Manages">{p.promotion!.storeName || 'Every store'}</td><td data-label="Expires">{when(p.promotion!.expiresAt)}</td>
                <td className="row-actions"><button className="link-btn danger" onClick={() => void askThen({ title: `Cancel ${p.name}’s Promotion?`, body: 'The link stops working and they stay on staff.', go: 'Cancel Promotion', danger: true }, () => run(() => api(`/api/team/${p.id}/promote`, { method: 'DELETE' }), 'Promotion cancelled.'))}>Cancel</button></td></tr>
            ))}</tbody>
          </table>
        </>
      )}

      {owner && (
        <>
          <form className="card invite-form" onSubmit={invite}>
            <Text label="Invite an owner or manager by email" value={email} placeholder="manager@yourrestaurant.com" onChange={setEmail} />
            <label className="field"><span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}><option value="manager">Manager: edits the book, signs people off, manages staff</option><option value="owner">Owner: every store, plus owners and managers</option></select>
            </label>
            {multi && role === 'manager' && <label className="field"><span>Store</span>
              <select value={inviteStore} onChange={(e) => setInviteStore(e.target.value)}><option value="">Every store</option>{data.stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </label>}
            <button className="btn" disabled={!email.trim()}>{mailOn ? 'Send Invite' : 'Create Invite Link'}</button>
          </form>
          {made && <InviteSentCard link={made.link} email={made.email} mail={made.mail} days={made.days} onDone={() => setMade(null)} />}
          {data.invites.length > 0 && (
            <>
              <h2 className="sub">Open invites</h2>
              {/* Nov 16: stacks on a phone (Cancel was cut off at 390) */}
              <table className="table stack-table">
                <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th /></tr></thead>
                <tbody>{data.invites.map((i) => (
                  <tr key={i.id}><td><strong>{i.email}</strong></td><td data-label="Role">{ROLE_LABEL[i.role as Role] || i.role}{i.storeName ? ` · ${i.storeName}` : ''}</td><td data-label="Expires">{when(i.expires_at)}</td><td className="stores-actions"><button className="link-btn danger" onClick={() => void run(() => api(`/api/team/invites/${i.id}`, { method: 'DELETE' }))}>Cancel</button></td></tr>
                ))}</tbody>
              </table>
            </>
          )}
        </>
      )}
      {asking}
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
      <p className="muted">{[user?.name, user?.email, user ? ROLE_LABEL[user.role] : '', user?.companyName].filter(Boolean).join(' · ')}</p>
      {/* Nov 16: a manager promoted from staff signs in with their PIN (no password yet), so there's no password to change */}
      {user?.pinSignIn && <section className="card stack"><h2>Signing in</h2><p className="muted small">You joined with a PIN. Everyone signs in with email and a password now: next time you sign in, use Set Up Your Sign-In (once) to add yours. Forgot your PIN? Ask an owner.</p></section>}
      {!user?.pinSignIn && <section className="card stack">
        <h2>Two-step sign-in</h2>
        {needsTwoStep(user) && <p className="error" role="alert">{TWO_STEP_MSG}</p>}
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
      </section>}
      {!user?.pinSignIn && <form className="card stack" onSubmit={change}>
        <h2>Change password</h2>
        <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /><small>At least 10 characters.</small></label>
        {err && <ErrorNote error={err} />}
        {msg && <p className="ok" role="status">{msg}</p>}
        <button className="btn" disabled={!f.current || !f.next}>Change Password</button>
      </form>}
      {/* Nov 16: the support line, once Privacy, Terms and Help are public (content/legal.md) */}
      <SupportLine className="card" />
      <LegalLinks className="account-page-legal" />
      {!user?.demo && <button className="btn ghost" onClick={signOut}>Sign Out</button>}
    </div>
  );
}

/* ---------- activity ---------- */
type Row = { id: number; name: string | null; action: string; detail: string | null; at: string };
const ACTIONS: Record<string, string> = { 'joined with the code': 'Joined with the code:', 'reset PIN': 'Reset the PIN for', 'set a new PIN': 'Picked a new PIN', 'changed PIN': 'Changed their PIN', 'new join code': 'Made a new join code', 'change role': 'Changed a role:', 'remove person': 'Removed', rename: 'Renamed', 'two-step on': 'Turned on two-step sign-in', 'two-step off': 'Turned off two-step sign-in', 'set section': 'Set a section:', edit: 'Edited', revert: 'Undid an edit on', setup: 'Created the owner account', login: 'Signed in', password: 'Changed their password', invite: 'Invited', joined: 'Joined', upload: 'Uploaded', 'add youtube': 'Added a YouTube video', 'delete media': 'Deleted a file', 'archive media': 'Archived', 'restore media': 'Restored', 'remove user': 'Removed a person', 'cancel invite': 'Cancelled an invite', 'add dish': 'Added recipe', 'edit dish': 'Edited recipe', 'delete dish': 'Deleted recipe', 'add cocktail': 'Added cocktail', 'sign off': 'Signed off', 'undo sign off': 'Undid a sign-off for', 'edit cocktail': 'Edited cocktail', 'delete cocktail': 'Deleted cocktail', 'reset link': 'Made a password reset link for', 'reset password': 'Reset their password', 'reset email': 'Was emailed a password reset link', 'reset asked': 'Asked for a password reset email:',
  // Nov 16: Promote to Manager and Change to Staff
  'promotion link': 'Sent a promotion link to', 'promoted to manager': 'Became a manager:', 'promote to manager': 'Promoted to manager:', 'change to staff': 'Changed to staff:', 'cancel promotion': 'Cancelled the promotion for',
  // Nov 16: owners add and rename stores
  'add store': 'Added a store:', 'rename store': 'Renamed a store:' };
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
