// Signing in to read the book. Staff: the restaurant's join code → your name → your PIN.
// Owners and managers sign in with email in the admin, which also opens the book.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { useSession } from '../lib/session';
import { AuthCard } from '../admin/screens';

type Staff = { id: number; name: string; needsPin: boolean };
const CODE_KEY = 'bt-join-code';

export function BookSignIn() {
  const { setUser } = useSession();
  const [step, setStep] = useState<'code' | 'who' | 'pin' | 'new'>('code');
  const [code, setCode] = useState(() => localStorage.getItem(CODE_KEY) || '');
  const [company, setCompany] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [who, setWho] = useState<Staff | null>(null);
  const [q, setQ] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lookUp = async (c: string) => {
    setBusy(true); setError('');
    try {
      const r = await api<{ company: string; staff: Staff[] }>(`/api/join/${encodeURIComponent(c.trim().toUpperCase())}`);
      setCompany(r.company); setStaff(r.staff); localStorage.setItem(CODE_KEY, c.trim().toUpperCase());
      setStep(r.staff.length ? 'who' : 'new');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  // Come straight to the name list on a phone that has joined before.
  useEffect(() => { if (code) void lookUp(code); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => staff.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())), [staff, q]);
  const finish = (u: User) => { setPin(''); setPin2(''); setUser(u); };

  const signIn = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    if (who?.needsPin && pin !== pin2) { setError('Those PINs don’t match. Type the same one twice.'); setBusy(false); return; }
    try { finish((await api<{ user: User }>('/api/staff-login', { method: 'POST', body: { code, id: who!.id, pin } })).user); }
    catch (err) { setError((err as Error).message); setPin(''); }
    setBusy(false);
  };
  const join = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    if (pin !== pin2) { setError('Those PINs don’t match. Type the same one twice.'); setBusy(false); return; }
    try { finish((await api<{ user: User }>('/api/join', { method: 'POST', body: { code, name, pin } })).user); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  const pinField = (label: string, value: string, set: (v: string) => void, auto: string) => (
    <label className="field"><span>{label}</span>
      <input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete={auto} maxLength={6} value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    </label>
  );
  const managers = <p className="muted small">Owner or manager? <Link to="/admin">Sign in with your email</Link>.</p>;

  if (step === 'code') return (
    <AuthCard title="Sign in to the training book" sub="Ask a manager for your restaurant’s join code. You only type it once on this phone.">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void lookUp(code); }}>
        <label className="field"><span>Join code</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="8 letters and numbers" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Continue'}</button>
        {managers}
      </form>
    </AuthCard>
  );

  if (step === 'who') return (
    <AuthCard title={company} sub="Tap your name.">
      <div className="stack">
        {staff.length > 8 && <label className="field"><span className="sr-only">Find your name</span><input type="search" placeholder="Find your name" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
        <div className="name-list" role="list">
          {shown.map((s) => <button key={s.id} role="listitem" className="name-btn" onClick={() => { setWho(s); setError(''); setStep('pin'); }}>{s.name}</button>)}
          {!shown.length && <p className="muted small">No one by that name yet.</p>}
        </div>
        <button className="btn ghost" onClick={() => { setStep('new'); setError(''); }}>I’m New Here</button>
        <button className="link-btn" onClick={() => { localStorage.removeItem(CODE_KEY); setCode(''); setStep('code'); }}>Different restaurant?</button>
        {managers}
      </div>
    </AuthCard>
  );

  if (step === 'pin' && who) return (
    <AuthCard title={`Hi, ${who.name.split(' ')[0]}`} sub={who.needsPin ? 'Your PIN was reset. Pick a new one: 4 to 6 numbers.' : 'Enter your PIN.'}>
      <form className="stack" onSubmit={signIn}>
        {pinField(who.needsPin ? 'New PIN' : 'PIN', pin, setPin, who.needsPin ? 'new-password' : 'current-password')}
        {who.needsPin && pinField('Type it again', pin2, setPin2, 'new-password')}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy || pin.length < 4}>{busy ? 'Signing In…' : 'Sign In'}</button>
        <button type="button" className="link-btn" onClick={() => { setStep('who'); setPin(''); setError(''); }}>Not {who.name.split(' ')[0]}?</button>
        <p className="muted small">Forgot your PIN? A manager can reset it.</p>
      </form>
    </AuthCard>
  );

  return (
    <AuthCard title={`Join ${company}`} sub="Your name is how managers find your quiz scores. Your PIN keeps your training yours.">
      <form className="stack" onSubmit={join}>
        <label className="field"><span>First and last name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        {pinField('Pick a PIN (4 to 6 numbers)', pin, setPin, 'new-password')}
        {pinField('Type it again', pin2, setPin2, 'new-password')}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy || name.trim().length < 2 || pin.length < 4}>{busy ? 'Joining…' : 'Join'}</button>
        {staff.length > 0 && <button type="button" className="link-btn" onClick={() => { setStep('who'); setError(''); }}>Already joined? Pick your name</button>}
        {managers}
      </form>
    </AuthCard>
  );
}
