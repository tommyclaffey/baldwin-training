// /demo (Nov 2): pick a role, get your own private copy of The Baldwin with a sample menu. Figma: 09 · Proposals,
// "18 · Demo account" → "Demo · Pick a role · Desktop".
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

const ROLES = [
  { key: 'server', name: 'Server', line: 'The book on your phone: the menu, wine, the Sommelier lessons and quizzes.' },
  { key: 'bartender', name: 'Bartender', line: 'Cocktail specs, the back bar, spirits and the classics, plus quizzes.' },
  { key: 'manager', name: 'Manager', line: 'Everything staff see, plus adding dishes and cocktails, sections and quiz results.', lead: true },
  { key: 'owner', name: 'Owner', line: 'The whole restaurant: the team, every page and every result.' },
];

export function DemoPicker() {
  const { refresh } = useSession();
  const go = useNavigate();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const start = async (key: string) => {
    if (busy) return; setBusy(key); setErr('');
    try { await api('/api/demo/start', { method: 'POST', body: { role: key } }); await refresh(); go('/'); }
    catch (e) { setErr((e as Error).message || 'That didn’t start. Try again.'); setBusy(''); }
  };
  return (
    <main className="demo-pick">
      <img src="/img/logo-white.png" alt="The Baldwin" height="40" />
      <div className="demo-head">
        <p className="demo-script">Try it yourself</p>
        <h1>THE TRAINING APP</h1>
        <p className="demo-sub">Pick a role and look around. Your own copy, with a sample menu and our real wine list. It resets after a day.</p>
      </div>
      <div className="demo-roles">
        {ROLES.map((r) => (
          <section key={r.key} className={'demo-role' + (r.lead ? ' lead' : '')}>
            <h2>{r.name.toUpperCase()}</h2>
            <p>{r.line}</p>
            <button type="button" onClick={() => start(r.key)} disabled={!!busy}>{busy === r.key ? 'Opening…' : `Start as ${r.name}  →`}</button>
          </section>
        ))}
      </div>
      {err && <p role="alert" className="demo-err">{err}</p>}
      <p className="demo-foot">Demo · sample dishes and cocktails, not a real menu. Uploads, invites and passwords are switched off.</p>
    </main>
  );
}
