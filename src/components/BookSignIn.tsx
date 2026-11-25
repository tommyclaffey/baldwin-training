// Join with a Code (sign-up). Nov 25 (Figma 09 · Idea Board section 50, approved): the group's join code → your restaurant
// (only if the group has several) → your name, email and password → You're In. Nobody picks a PIN any more, and everyone
// signs in with email and password (src/admin/screens.tsx SignIn). People who joined with a PIN move over once:
// SetUpSignIn.tsx. Earlier notes, kept for the history:
// Nov 12 (Figma section 28): the join-code screen wears Mise, the platform's front door. Once the code is right the app
// knows the restaurant, so the store, name and PIN screens wear that restaurant's own look (the brand comes with the code).
// Nov 17: once a store is picked, its own look (Testa Barra, J.Baldwin's); the store question itself wears the company's.
// Nov 19: from an account's own link (miseacademy.app/the-baldwin, src/lib/account.ts) every screen wears that account's
// look from the start, the join code has to be that account's, and the email sign-in for owners and managers opens right
// here in the same look. The code is still typed: a public link can't be the key to a restaurant's book.
// Nov 23 (real addresses, src/lib/authroute.ts): this is Join with a Code, at /join, /<account>/join and the site's root.
// Sign In (email + password) is its own address, /sign-in or the account's own link; no role labels on any of these screens
// (Tommy: "There should be a 'Join with a Code,' and there should be 'Sign In.' Doesn't matter what position you are in.").
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { useSession } from '../lib/session';
import { asBrand, registerLook, type Brand } from '../lib/theme';
import { AuthCard } from './AuthCard';
import type { AccountLink } from '../lib/account';
import { CODE_KEY, JUST_SIGNED_IN, markMoved, setUpPath, signInPath, type AuthKind } from '../lib/authroute';

export type JoinStore = { id: number; name: string; brand?: string };
export type JoinStaff = { id: number; name: string; needsPin: boolean; storeId: number | null };
export type JoinInfo = { company: string; brand?: string; stores: JoinStore[]; staff: JoinStaff[]; looks?: Record<string, unknown> };
export const STORE_KEY = 'bt-join-store';

/** The group behind a join code (its stores, and the people who still have to move from a PIN). From an account's link the
 *  code has to be that account's. Registers any look made in Your Look (Nov 22) so the next screens can wear it. */
export async function lookUpCode(code: string, account: AccountLink | null): Promise<JoinInfo> {
  const via = account ? `?account=${encodeURIComponent(account.slug)}` : '';
  const r = await api<JoinInfo>(`/api/join/${encodeURIComponent(code.trim().toUpperCase())}${via}`);
  for (const [id, spec] of Object.entries(r.looks || {})) registerLook(id, spec, { quiet: true });
  return r;
}
/** Signed in on the signed-out screen: note the moment (PageView sends a just-signed-in person Home, Nov 24), and mark this
 *  phone as on email sign-in (it opens Sign In from now on, not Set Up Your Sign-In). */
export function noteSignedIn() {
  try { sessionStorage.setItem(JUST_SIGNED_IN, String(Date.now())); } catch { /* private mode */ }
  markMoved();
}
/** "Step 2 of 3 · Fig & Fire": the account's or group's name and the step, as one line over the title. */
export const kickerOf = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ') || undefined;

/** A tappable row with a name or a restaurant and a chevron (Figma 993:1955, "Choice row"). 56 px tall. */
export function ChoiceRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="listitem" className="name-btn si-choice" onClick={onClick}>
      <span>{children}</span>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

export function BookSignIn({ account = null }: { account?: AccountLink | null }) {
  const { setUser } = useSession();
  const [step, setStep] = useState<'code' | 'store' | 'about' | 'done'>('code');
  const [stores, setStores] = useState<JoinStore[]>([]);
  const [store, setStore] = useState<JoinStore | null>(null);
  const [code, setCode] = useState(() => { try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; } });
  const [company, setCompany] = useState('');
  const [coBrand, setCoBrand] = useState<Brand>(account?.brand ?? 'mise');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [joined, setJoined] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [errorAt, setErrorAt] = useState<'name' | 'email' | 'password' | 'form'>('form');
  const [busy, setBusy] = useState(false);

  // Steps: the code, the restaurant (only when the group has several), about you. Before the code is in, it's "of 3".
  const total = stores.length === 1 ? 2 : 3;
  const lookUp = async () => {
    setBusy(true); setError('');
    try {
      const r = await lookUpCode(code, account);
      setCompany(r.company); setCoBrand(asBrand(r.brand)); setStores(r.stores);
      try { localStorage.setItem(CODE_KEY, code.trim().toUpperCase()); } catch { /* private mode */ }
      if (r.stores.length === 1) { setStore(r.stores[0]); setStep('about'); } else setStep('store');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const choose = (st: JoinStore) => { setStore(st); try { localStorage.setItem(STORE_KEY, String(st.id)); } catch { /* private mode */ } setError(''); setStep('about'); };
  const join = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<{ user: User }>('/api/join', { method: 'POST', body: { code, name: f.name, email: f.email, password: f.password, storeId: store?.id } });
      setF((x) => ({ ...x, password: '' })); setJoined(r.user); setStep('done');
    } catch (err) {
      const m = (err as Error).message;
      setError(m); setErrorAt(/email/i.test(m) && !/password/i.test(m) ? 'email' : /password|characters/i.test(m) ? 'password' : /name/i.test(m) && !/PIN/.test(m) ? 'name' : 'form');
    }
    setBusy(false);
  };
  // A field with an error points at it (Nov 12 accessibility scan): marked invalid, and the message is its description.
  const invalid = (at: typeof errorAt) => (error && errorAt === at ? { 'aria-invalid': true, 'aria-describedby': 'si-error' } : {});
  const errorNote = (at: typeof errorAt) => error && errorAt === at ? <p className="error" id="si-error" role="alert">{error}</p> : null;
  const toSignIn = (q: string) => <><hr className="si-rule" /><p className="si-alt">{q} <Link to={signInPath(account)}>Sign In</Link></p></>;
  // after the join code: the restaurant's own look; after the store question, that store's (Nov 17)
  const brand = step !== 'store' && store?.brand ? asBrand(store.brand) : coBrand;

  if (step === 'code') return (
    <AuthCard kicker={kickerOf(account?.name, 'Step 1 of 3')} title="Join with a Code" brand={account?.brand}
      sub={account ? 'Ask a manager for your join code.' : 'Your manager has it: 8 letters and numbers.'}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void lookUp(); }}>
        <label className="field"><span>Join code</span>
          <input value={code} {...(error ? { 'aria-invalid': true, 'aria-describedby': 'si-error' } : {})} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="8 letters and numbers" />
          <small><span className="si-wide">You only type it once on this device.</span><span className="si-narrow">You only type it once on this phone.</span></small>
        </label>
        {error && <p className="error" id="si-error" role="alert">{error}</p>}
        <button className="btn" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Continue'}</button>
      </form>
      {toSignIn('Already have an account?')}
    </AuthCard>
  );

  const retype = <button type="button" className="link-btn" onClick={() => { setStep('code'); setStore(null); setError(''); }}>Wrong restaurant group? Type the code again</button>;
  if (step === 'store') return (
    <AuthCard brand={brand} kicker={kickerOf(`Step 2 of ${total}`, company)} title="Where Do You Work?" sub={`${company} has ${stores.length} restaurants. Tap yours.`}>
      <div className="stack">
        <div className="name-list" role="list">
          {stores.map((st) => <ChoiceRow key={st.id} onClick={() => choose(st)}>{st.name}</ChoiceRow>)}
        </div>
        {retype}
      </div>
    </AuthCard>
  );

  if (step === 'done' && joined) return (
    <AuthCard brand={brand} kicker={store?.name || company} title={`You’re In, ${joined.name.split(' ')[0]}`}
      sub={<>Next time, sign in with <strong>{joined.email || f.email}</strong> and your password, on any phone or computer.</>}>
      <button type="button" className="btn" autoFocus onClick={() => { noteSignedIn(); setUser(joined); }}>Start Training</button>
    </AuthCard>
  );

  // Someone who joined with a PIN typing their name again: send them to move over, so their training comes with them.
  const pinPerson = /already joined with a PIN/.test(error);
  return (
    <AuthCard brand={brand} kicker={kickerOf(`Step ${total} of ${total}`, store?.name || company)} title="About You" sub="You’ll sign in with this email and password from now on.">
      <form className="stack" onSubmit={join}>
        <label className="field"><span>First and last name</span><input value={f.name} {...invalid('name')} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
        {errorNote('name')}
        <label className="field"><span>Email</span><input type="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={f.email} {...invalid('email')} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
        {errorNote('email')}
        <label className="field"><span>Choose a password</span><input type="password" value={f.password} {...invalid('password')} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /><small>At least 10 characters.</small></label>
        {errorNote('password')}
        {errorNote('form')}
        {pinPerson && <Link className="btn ghost" to={setUpPath(account)}>Set Up Your Sign-In</Link>}
        <button className="btn" disabled={busy || f.name.trim().length < 2 || !f.email.trim() || f.password.length < 10}>{busy ? 'Joining…' : `Join ${company}`}</button>
        {stores.length > 1 && <button type="button" className="link-btn" onClick={() => { setStep('store'); setError(''); }}>Different restaurant?</button>}
      </form>
      {toSignIn('Already joined?')}
    </AuthCard>
  );
}

/** Nov 23: /sign-in, /join, /<account>/sign-in or /<account>/join opened by someone already signed in. Never "We couldn't find
 *  that page" (Tommy opened miseacademy.app/join on his phone and got it): who's signed in, Go to Home and Sign Out.
 *  Nov 25 (section 50, frame 6): "You're Signed In", with their email and where. */
export function SignedInCard({ kind, account = null }: { kind: AuthKind; account?: AccountLink | null }) {
  const { user, setUser } = useSession();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const where = user?.store?.name || user?.workingInName || null;
  void kind; // the same card on every one of these addresses
  const signOut = async () => { setBusy(true); await api('/api/logout', { method: 'POST' }).catch(() => {}); setUser(null); setBusy(false); };
  return (
    <AuthCard kicker={account?.name} brand={account?.brand} title="You’re Signed In" sub={<>You’re signed in as <strong>{user?.name}</strong>{user?.email ? <> ({user.email})</> : null}{where ? <> at {where}</> : null}.</>}>
      <div className="stack">
        <button type="button" className="btn" onClick={() => nav('/', { replace: true })}>Go to Home</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing Out…' : 'Sign Out'}</button>
        <p className="muted small">Want a different account? Sign out first, then sign in or join.</p>
      </div>
    </AuthCard>
  );
}
