// Choose Your Own Password (Nov 24; Figma 09 · Idea Board → 49: 1008:3555, "that's the temporary one" 1008:4289, You're In
// 1008:3625). After someone signs in with a temporary password the server gives a ticket for this screen only, never a
// session (server/accounts.mjs): there's nothing to skip to. Drawn in today's sign-in screens (AuthCard), not section 50's
// redesign, which isn't approved.
import { useState, type FormEvent } from 'react';
import { api, type User } from '../lib/api';
import { AuthCard } from './AuthCard';
import type { Brand } from '../lib/theme';

/** What /api/login and /api/login/code answer when a temporary password was used. */
export type MustChoose = { mustChoose: 'password'; ticket: string; name: string; email?: string | null };

export function ChooseOwn({ need, temp, brand, kicker, onDone, onBack }: {
  need: MustChoose; /** what they typed to get here, so "not the temporary one" can be checked as they type */ temp: string;
  brand?: Brand; kicker?: string; onDone: (u: User) => void; onBack: () => void;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState('');
  const [gone, setGone] = useState(false); // the ticket ran out or the temporary one stopped: back to sign in
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const first = need.name.split(' ')[0];

  if (user) return (
    <AuthCard brand={brand} kicker={kicker} title={`You’re In, ${first}`}
      sub={<>Your new password is set. Next time, sign in with {need.email ? <strong>{need.email}</strong> : 'your email'} and that password.</>}>
      <div className="stack"><button type="button" className="btn" autoFocus onClick={() => onDone(user)}>Continue</button></div>
    </AuthCard>
  );

  const isTemp = !!a && a === temp;
  const isEmail = !!a && a.trim().toLowerCase() === (need.email || '').toLowerCase();
  const checks = [{ ok: a.length >= 10, text: 'At least 10 characters' }, { ok: !!a && !isTemp, bad: isTemp, text: 'Not the temporary password' },
    { ok: !!a && !isEmail, bad: isEmail, text: 'Not your email or an old password' }];
  const match = !!b && a === b;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (isTemp) { setError('That’s the temporary password. Choose a new one only you know.'); return; }
    if (a !== b) { setError('Those passwords don’t match. Type the same one twice.'); return; }
    setBusy(true);
    try { setUser((await api<{ user: User }>('/api/login/choose', { method: 'POST', body: { ticket: need.ticket, password: a } })).user); }
    catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      if (/took too long|cancelled|already used|expired/.test(msg)) setGone(true);
    }
    setBusy(false);
  };
  const errorFor = error ? { 'aria-invalid': true, 'aria-describedby': 'co-error' } : {};
  return (
    <AuthCard brand={brand} kicker={kicker || 'One more step'} title="Choose Your Own Password" sub="The temporary one worked. Now pick one only you know.">
      <form className="stack" onSubmit={submit}>
        {need.email && <input type="email" autoComplete="username" value={need.email} readOnly hidden />}
        <label className="field"><span>New password</span>
          <input type="password" autoComplete="new-password" value={a} autoFocus {...errorFor} onChange={(e) => setA(e.target.value)} />
        </label>
        <label className="field"><span>Type it again</span>
          <input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        </label>
        {b && <small className={'co-match' + (match ? ' co-yes' : '')} aria-live="polite">{match ? 'They match.' : 'They don’t match yet.'}</small>}
        <ul className="co-checks" aria-label="Your new password">
          {checks.map((c) => <li key={c.text} className={c.ok ? 'co-yes' : c.bad ? 'co-no' : ''}><span className="co-dot" aria-hidden="true">{c.bad ? '✕' : '✓'}</span>{c.text}
            <span className="sr-only">{c.ok ? ' (done)' : c.bad ? ' (not yet)' : ''}</span></li>)}
        </ul>
        {error && <p className="error" id="co-error" role="alert">{error}</p>}
        {gone
          ? <button type="button" className="btn" onClick={onBack}>Back to Sign In</button>
          : <button className="btn" disabled={busy || !a || !b}>{busy ? 'Saving…' : 'Save and Continue'}</button>}
        <p className="muted small">You can’t skip this step. The temporary password only opens this screen.</p>
      </form>
    </AuthCard>
  );
}
