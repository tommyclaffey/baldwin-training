// Admin screens: sign in, first-time setup, invites, lists, media, people, account, activity.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, uploadFile, type MediaItem, type User } from '../lib/api';
import { useSession } from '../lib/session';
import { VideoEmbed } from '../components/VideoEmbed';
import { Empty, ErrorNote, Loading, Text, when } from './ui';
import { typeLabel, type Item, type ItemType } from './ItemEditor';
import { PRODUCT_NAME } from '../lib/brand';

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api<T>(path).then(setData).catch((e) => setError(e.message)); };
  useEffect(load, [path]);
  return { data, error, load, setData };
}

/* ---------- signed out ---------- */
export function AuthCard({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <img src="/img/logo-white.png" alt="The Baldwin" className="auth-logo" />
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export function SignIn() {
  const { setUser, setupNeeded } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (setupNeeded) return <Setup />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { setUser((await api<{ user: User }>('/api/login', { method: 'POST', body: { email, password } })).user); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  return (
    <AuthCard title="Sign in to edit" sub={<>Managers only. Staff can read the book without signing in. <Link to="/">Back to the book</Link></>}>
      <form className="stack" onSubmit={submit}>
        <Text label="Email" value={email} onChange={setEmail} />
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy || !email || !password}>{busy ? 'Signing In…' : 'Sign In'}</button>
        <p className="muted small">No account? Ask the owner for an invite link.</p>
      </form>
    </AuthCard>
  );
}

function Setup() {
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
    <AuthCard title="Create the owner account" sub="This only works once, with the owner’s email. After this you invite everyone else.">
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
  const [inv, setInv] = useState<{ valid: boolean; email?: string; role?: string } | null>(null);
  const [f, setF] = useState({ name: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<typeof inv>(`/api/invite/${token}`).then(setInv).catch(() => setInv({ valid: false })); }, [token]);
  if (!inv) return <AuthCard title="Checking your invite…"><Loading /></AuthCard>;
  if (!inv.valid) return <AuthCard title="This invite doesn’t work" sub="It expired or was already used. Ask the owner for a new link."><Link className="btn" to="/">Go to the Book</Link></AuthCard>;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { setUser((await api<{ user: User }>(`/api/invite/${token}`, { method: 'POST', body: f })).user); nav('/admin'); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  return (
    <AuthCard title="Join the training book" sub={<>You’re invited as <strong>{inv.email}</strong>.</>}>
      <form className="stack" onSubmit={submit}>
        <Text label="Your name" value={f.name} onChange={(name) => setF({ ...f, name })} />
        <label className="field"><span>Choose a password</span><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><small>At least 10 characters.</small></label>
        {error && <ErrorNote error={error} />}
        <button className="btn" disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
      </form>
    </AuthCard>
  );
}

/* ---------- overview ---------- */
export function Overview() {
  const { user, setEditing } = useSession();
  const items = useLoad<{ items: Item[] }>('/api/items');
  const media = useLoad<{ media: MediaItem[] }>('/api/media');
  const nav = useNavigate();
  const count = (t: ItemType) => items.data?.items.filter((i) => i.type === t).length ?? '–';
  return (
    <div className="admin-page">
      <h1>Hi, {user?.name.split(' ')[0]}</h1>
      <p className="muted">Change anything in {PRODUCT_NAME}. Changes show for everyone as soon as you save.</p>
      <div className="tiles">
        <button className="tile" onClick={() => { setEditing(true); nav('/'); }}>
          <strong>Edit the pages</strong>
          <span>Turn on editing, then click any text, photo or video slot on any page.</span>
        </button>
        <Link className="tile" to="/admin/recipes"><strong>Recipes · {count('dish')}</strong><span>Add a dish. It gets its own page and a row in the Food Matrix.</span></Link>
        <Link className="tile" to="/admin/cocktails"><strong>House cocktails · {count('cocktail')}</strong><span>Add one of our drinks. It gets its own page and a row on Cocktails.</span></Link>
        <Link className="tile" to="/admin/media"><strong>Videos and photos · {media.data?.media.length ?? '–'}</strong><span>Upload files or add YouTube links, then use them on any page.</span></Link>
      </div>
    </div>
  );
}

/* ---------- recipes / cocktails list ---------- */
export function ItemList({ type }: { type: ItemType }) {
  const { data, error, load } = useLoad<{ items: Item[] }>(`/api/items?type=${type}`);
  const base = type === 'dish' ? '/admin/recipes' : '/admin/cocktails';
  const builtIn = type === 'dish' ? [{ name: 'Short Rib', slug: 'recipe/short-rib' }] : [{ name: 'Fuschia Satin', slug: 'signature/fuschia-satin' }, { name: 'Cozy Blankets', slug: 'signature/cozy-blankets' }];
  return (
    <div className="admin-page">
      <div className="editor-head">
        <div>
          <h1>{type === 'dish' ? 'Recipes' : 'House cocktails'}</h1>
          <p className="muted">{type === 'dish' ? 'Each recipe becomes a page like Short Rib and a row in the Food Matrix.' : 'Each drink becomes a page like Fuschia Satin and a row on the Cocktails page.'}</p>
        </div>
        <Link className="btn" to={`${base}/new`}>Add {typeLabel(type)}</Link>
      </div>
      {error && <ErrorNote error={error} retry={load} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="list">
          {data.items.map((it) => (
            <Link key={it.id} className="list-row" to={`${base}/${it.id}`}>
              {it.data.photo ? <img src={it.data.photo as string} alt="" /> : <span className="thumb-empty" />}
              <span className="grow"><strong>{it.data.name}</strong><small>{(it.data.tagline as string) || '—'}</small></span>
              <small className="muted">{it.data.video ? 'Has video · ' : ''}Edited {when(it.updated_at)}</small>
            </Link>
          ))}
          {data.items.length === 0 && <Empty title={`No ${type === 'dish' ? 'recipes' : 'house cocktails'} added yet`}><p className="muted">Add the first one. It shows up in the book right away.</p></Empty>}
        </div>
      )}
      <h2 className="sub">Built into the design</h2>
      <p className="muted small">These pages came from the design. Edit them on the page itself: turn on editing and click what you want to change.</p>
      <div className="list">
        {builtIn.map((b) => (
          <Link key={b.slug} className="list-row" to={'/' + b.slug}><span className="thumb-empty" /><span className="grow"><strong>{b.name}</strong><small>Edit on the page</small></span></Link>
        ))}
      </div>
    </div>
  );
}

/* ---------- media ---------- */
export function MediaLibrary() {
  const { data, error, load, setData } = useLoad<{ media: MediaItem[] }>('/api/media');
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
  const remove = async (m: MediaItem) => {
    if (!confirm(`Delete “${m.title}”? Any page using it will show an empty slot.`)) return;
    try { await api(`/api/media/${m.id}`, { method: 'DELETE' }); setData({ media: (data?.media || []).filter((x) => x.id !== m.id) }); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="admin-page">
      <h1>Videos and photos</h1>
      <p className="muted">Everything here can be used in any video or photo slot. To put one on a page, turn on editing and click the slot.</p>
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
                <small className="muted">{m.kind === 'youtube' ? 'YouTube' : m.mime?.startsWith('video/') ? `Video · ${mb(m.size)}` : `Photo · ${mb(m.size)}`}</small>
              </div>
              <button className="link-btn danger" onClick={() => remove(m)}>Delete</button>
            </div>
          ))}
        </div>
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

/* ---------- people ---------- */
type Person = { id: number; name: string; email: string; role: string; created_at: string; last_seen_at: string | null };
type Invite = { id: string; email: string; role: string; created_at: string; expires_at: string };
export function People() {
  const { user } = useSession();
  const users = useLoad<{ users: Person[] }>('/api/users');
  const invites = useLoad<{ invites: Invite[] }>('/api/invites');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [made, setMade] = useState<{ link: string; email: string } | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  if (user?.role !== 'owner') return <Empty title="Only the owner can manage people" />;

  const invite = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setCopied(false);
    try { const r = await api<{ link: string; email: string }>('/api/invites', { method: 'POST', body: { email, role } }); setMade({ ...r, link: location.origin + r.link }); setEmail(''); invites.load(); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  const cancel = async (i: Invite) => { try { await api(`/api/invites/${i.id}`, { method: 'DELETE' }); invites.load(); } catch (e) { setErr((e as Error).message); } };
  const remove = async (p: Person) => {
    if (!confirm(`Remove ${p.name}? They’re signed out and can’t edit anymore.`)) return;
    try { await api(`/api/users/${p.id}`, { method: 'DELETE' }); users.load(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="admin-page">
      <h1>People</h1>
      <p className="muted">Who can edit the book. Staff read it without an account.</p>
      <form className="card invite-form" onSubmit={invite}>
        <Text label="Invite by email" value={email} placeholder="manager@thebaldwinshelby.com" onChange={setEmail} />
        <label className="field"><span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}><option value="editor">Editor: edits content</option><option value="owner">Owner: also manages people</option></select>
        </label>
        <button className="btn" disabled={!email.trim()}>Create Invite Link</button>
      </form>
      {made && (
        <div className="card ok-card" role="status">
          <p>Send this link to <strong>{made.email}</strong>. It works once and expires in 14 days.</p>
          <div className="row"><input readOnly value={made.link} onFocus={(e) => e.target.select()} aria-label="Invite link" /><button className="btn ghost" onClick={() => { navigator.clipboard.writeText(made.link); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button></div>
        </div>
      )}
      {err && <ErrorNote error={err} />}
      <h2 className="sub">Accounts</h2>
      {users.error && <ErrorNote error={users.error} retry={users.load} />}
      {!users.data && !users.error && <Loading />}
      {users.data && (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last seen</th><th /></tr></thead>
          <tbody>
            {users.data.users.map((p) => (
              <tr key={p.id}><td>{p.name}</td><td>{p.email}</td><td>{p.role === 'owner' ? 'Owner' : 'Editor'}</td><td>{when(p.last_seen_at)}</td>
                <td>{p.id !== user.id && <button className="link-btn danger" onClick={() => remove(p)}>Remove</button>}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <h2 className="sub">Open invites</h2>
      {invites.data && invites.data.invites.length === 0 && <p className="muted small">None.</p>}
      {invites.data && invites.data.invites.length > 0 && (
        <table className="table">
          <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th /></tr></thead>
          <tbody>{invites.data.invites.map((i) => (
            <tr key={i.id}><td>{i.email}</td><td>{i.role === 'owner' ? 'Owner' : 'Editor'}</td><td>{when(i.expires_at)}</td><td><button className="link-btn danger" onClick={() => cancel(i)}>Cancel</button></td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

/* ---------- account ---------- */
export function Account() {
  const { user, setUser } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const change = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    try { await api('/api/password', { method: 'POST', body: f }); setMsg('Password changed. Other devices were signed out.'); setF({ current: '', next: '' }); }
    catch (e2) { setErr((e2 as Error).message); }
  };
  const signOut = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); setUser(null); nav('/'); };
  return (
    <div className="admin-page narrow">
      <h1>Your account</h1>
      <p className="muted">{user?.name} · {user?.email} · {user?.role === 'owner' ? 'Owner' : 'Editor'}</p>
      <form className="card stack" onSubmit={change}>
        <h2>Change password</h2>
        <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /><small>At least 10 characters.</small></label>
        {err && <ErrorNote error={err} />}
        {msg && <p className="ok" role="status">{msg}</p>}
        <button className="btn" disabled={!f.current || !f.next}>Change Password</button>
      </form>
      <button className="btn ghost" onClick={signOut}>Sign Out</button>
    </div>
  );
}

/* ---------- activity ---------- */
type Row = { id: number; name: string | null; action: string; detail: string | null; at: string };
const ACTIONS: Record<string, string> = { edit: 'Edited', revert: 'Undid an edit on', setup: 'Created the owner account', login: 'Signed in', password: 'Changed their password', invite: 'Invited', joined: 'Joined', upload: 'Uploaded', 'add youtube': 'Added a YouTube video', 'delete media': 'Deleted a file', 'remove user': 'Removed a person', 'cancel invite': 'Cancelled an invite', 'add dish': 'Added recipe', 'edit dish': 'Edited recipe', 'delete dish': 'Deleted recipe', 'add cocktail': 'Added cocktail', 'edit cocktail': 'Edited cocktail', 'delete cocktail': 'Deleted cocktail' };
export function Activity() {
  const { data, error, load } = useLoad<{ audit: Row[] }>('/api/audit');
  const { index } = useSession();
  const pageName = (id: string) => index.find((e) => e.id === id || e.file === id)?.name || id;
  const what = (r: Row) => {
    const verb = ACTIONS[r.action] || r.action;
    if ((r.action === 'edit' || r.action === 'revert') && r.detail) return `${verb} ${pageName(r.detail.split(' ')[0])}`;
    if (['upload', 'add youtube', 'delete media', 'remove user', 'cancel invite', 'login', 'password', 'setup'].includes(r.action)) return verb;
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
