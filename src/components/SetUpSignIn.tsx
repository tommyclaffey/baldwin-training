// Set Up Your Sign-In (Nov 25; Figma 09 · Idea Board section 50, row 3, approved Nov 25: "go with your choice").
// Everyone signs in with email and password now. People who joined with a PIN move over once: find your name → type the old
// PIN one last time → add your email and choose a password. Then the PIN stops working and they're in.
//   • Opens by itself on a phone that joined with a PIN (it remembers the join code), and from Sign In's "Joined with a
//     PIN? Set Up Your Sign-In". At /set-up-sign-in and /<account>/set-up-sign-in (src/lib/authroute.ts).
//   • Never a lock-out (Tommy, Nov 24: "they have to give them the pin option … I don't have everyone's email"): the PIN
//     still gets them in, here, as long as they add an email. Forgot the PIN? A manager's Reset PIN lets them skip it,
//     or Set Temporary Password (section 49) moves them over from the manager's side.
//   • No "Not Now" (section 50's notes).
// Server: /api/set-up/check (code, name, PIN → a 15-minute ticket) and /api/set-up/save (ticket, email, password).
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { useSession } from '../lib/session';
import { asBrand, type Brand } from '../lib/theme';
import { AuthCard } from './AuthCard';
import type { AccountLink } from '../lib/account';
import { CODE_KEY, signInPath } from '../lib/authroute';
import { ChoiceRow, kickerOf, lookUpCode, noteSignedIn, type JoinStaff, type JoinStore } from './BookSignIn';

export function SetUpSignIn({ account = null }: { account?: AccountLink | null }) {
  const { setUser } = useSession();
  const saved = (() => { try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; } })();
  const [step, setStep] = useState<'loading' | 'code' | 'who' | 'pin' | 'email'>(saved ? 'loading' : 'code');
  const [code, setCode] = useState(saved);
  const [company, setCompany] = useState('');
  const [coBrand, setCoBrand] = useState<Brand>(account?.brand ?? 'mise');
  const [stores, setStores] = useState<JoinStore[]>([]);
  const [staff, setStaff] = useState<JoinStaff[]>([]);
  const [who, setWho] = useState<JoinStaff | null>(null);
  const [q, setQ] = useState('');
  const [pin, setPin] = useState('');
  const [ticket, setTicket] = useState('');
  const [f, setF] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lookUp = async (c: string, quiet = false) => {
    setBusy(true); setError('');
    try {
      const r = await lookUpCode(c, account);
      setCompany(r.company); setCoBrand(asBrand(r.brand)); setStores(r.stores); setStaff(r.staff);
      try { localStorage.setItem(CODE_KEY, c.trim().toUpperCase()); } catch { /* private mode */ }
      setStep('who');
    } catch (e) {
      // A phone's remembered code that no longer works (a new code was made, or it's another account's): ask for it
      setStep('code'); if (quiet) setCode(''); else setError((e as Error).message);
    }
    setBusy(false);
  };
  useEffect(() => { if (saved) void lookUp(saved, true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => staff.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())), [staff, q]);
  const storeOf = (s: JoinStaff | null) => stores.find((x) => x.id === s?.storeId) || null;
  // after the code: the restaurant's own look; once they've picked their name, their store's (Nov 17)
  const brand = who && storeOf(who)?.brand ? asBrand(storeOf(who)!.brand) : coBrand;
  const first = who?.name.split(' ')[0] || '';

  const check = async (s: JoinStaff, pinValue: string | null) => {
    setBusy(true); setError('');
    try {
      const r = await api<{ ticket: string; email: string | null }>('/api/set-up/check', { method: 'POST', body: { code, id: s.id, ...(pinValue == null ? {} : { pin: pinValue }) } });
      setTicket(r.ticket); setF({ email: r.email || '', password: '' }); setPin(''); setStep('email');
    } catch (e) { setError((e as Error).message); setPin(''); }
    setBusy(false);
  };
  // A PIN a manager reset (none set) skips the PIN step, as picking a new PIN did before
  const pick = (s: JoinStaff) => { setWho(s); setError(''); if (s.needsPin) void check(s, null); else setStep('pin'); };
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<{ user: User }>('/api/set-up/save', { method: 'POST', body: { ticket, email: f.email, password: f.password } });
      noteSignedIn(); setUser(r.user);
    } catch (err) {
      const m = (err as Error).message;
      setError(m);
      if (/took too long/.test(m)) { setStep('pin'); setTicket(''); }
    }
    setBusy(false);
  };
  const invalid = error ? { 'aria-invalid': true, 'aria-describedby': 'si-error' } : {};
  const errorNote = error ? <p className="error" id="si-error" role="alert">{error}</p> : null;
  const setUpAlready = <p className="si-alt">Already set up? <Link to={signInPath(account)}>Sign In</Link></p>;
  const title = 'Set Up Your Sign-In';

  if (step === 'loading') return <AuthCard kicker={kickerOf(account?.name, 'One time')} brand={account?.brand} title={title}><div className="loader" aria-busy="true" /></AuthCard>;

  if (step === 'code') return (
    <AuthCard kicker={kickerOf(account?.name, 'One time')} brand={account?.brand} title={title}
      sub="We’ve moved to email and password. Type your restaurant’s join code to find your name.">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void lookUp(code); }}>
        <label className="field"><span>Join code</span>
          <input value={code} {...invalid} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="8 letters and numbers" />
          <small>Your manager has it.</small>
        </label>
        {errorNote}
        <button className="btn" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Continue'}</button>
      </form>
      <hr className="si-rule" />
      {setUpAlready}
    </AuthCard>
  );

  if (step === 'who') return (
    <AuthCard kicker={kickerOf(account?.name, 'One time · Step 1 of 3')} brand={brand} title={title}
      sub={staff.length ? 'We’ve moved to email and password. Find your name to set yours up.' : `Everyone at ${company} has set up email and password.`}>
      <div className="stack">
        {staff.length > 0 && <>
          <label className="field"><span>Your name</span><input type="search" placeholder="Type your name" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
          {errorNote}
          <div className="name-list si-names" role="list" aria-label="Names">
            {shown.map((s) => <ChoiceRow key={s.id} onClick={() => pick(s)}>{s.name}</ChoiceRow>)}
            {!shown.length && <p className="muted small">No one by that name. Check the spelling, or ask a manager.</p>}
          </div>
        </>}
        {setUpAlready}
        <p className="si-alt">Not on the list? <strong>Ask a manager</strong> to set you up.</p>
        <button type="button" className="link-btn" onClick={() => { try { localStorage.removeItem(CODE_KEY); } catch { /* private mode */ } setCode(''); setStep('code'); setError(''); }}>Different restaurant?</button>
      </div>
    </AuthCard>
  );

  if (step === 'pin' && who) return (
    <AuthCard kicker={kickerOf(account?.name, 'One time · Step 2 of 3')} brand={brand} title={`Hi, ${first}`} sub="Type your PIN one last time, so we know it’s you.">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void check(who, pin); }}>
        <label className="field"><span>PIN</span>
          <input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="current-password" maxLength={6} value={pin} {...invalid} autoFocus
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <small>Forgot it? Ask a manager to set you up.</small>
        </label>
        {errorNote}
        <button className="btn" disabled={busy || pin.length < 4}>{busy ? 'Checking…' : 'Continue'}</button>
        <button type="button" className="link-btn" onClick={() => { setWho(null); setPin(''); setError(''); setStep('who'); }}>Not {first}? Pick your name</button>
      </form>
    </AuthCard>
  );

  return (
    <AuthCard kicker={kickerOf(account?.name, 'One time · Step 3 of 3')} brand={brand} title="Your Email and Password" sub="You’ll sign in with these from now on, on any phone or computer.">
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Email</span><input type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="email" value={f.email} {...(/email/i.test(error) ? invalid : {})} onChange={(e) => setF({ ...f, email: e.target.value })} autoFocus /></label>
        <label className="field"><span>Choose a password</span><input type="password" autoComplete="new-password" value={f.password} {...(/password|characters/i.test(error) ? invalid : {})} onChange={(e) => setF({ ...f, password: e.target.value })} /><small>At least 10 characters.</small></label>
        {errorNote}
        <button className="btn" disabled={busy || !f.email.trim() || f.password.length < 10}>{busy ? 'Saving…' : 'Save and Continue'}</button>
        <p className="muted small">After you save, your PIN stops working.</p>
      </form>
    </AuthCard>
  );
}
