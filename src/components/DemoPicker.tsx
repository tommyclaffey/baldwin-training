// /demo (Nov 2): pick a role, get your own private copy of The Baldwin with a sample menu. Figma: 09 · Proposals,
// "18 · Demo account" → "Demo · Pick a role · Desktop".
// /demo/mise (Nov 11, Tommy: "a completely separate demo for Mise itself"): the same picker for Wrenfield, a made-up
// restaurant shown in the Mise Academy look. Each demo has its own link so both can be shown.
import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { exitDemo, markDemoTab, type DemoKind } from '../lib/demo';
import { setPageBrand } from '../lib/skin';

// Nov 4, Tommy: "one account for an employee and then one account that is a manager/admin."
const ROLES = [
  { key: 'employee', name: 'Employee', line: 'The book on your phone: the menu, cocktails, wine, the Sommelier lessons and quizzes.' },
  { key: 'manager', name: 'Manager / Admin', line: 'Everything employees see, plus adding dishes and cocktails, tonight’s sections and quiz results.', lead: true },
];
const COPY: Record<DemoKind, { sub: string; foot: string }> = {
  baldwin: {
    sub: 'Pick a view and look around. It’s a separate demo restaurant with a sample menu and our real wine list. It resets after a day.',
    foot: 'Demo · sample dishes and cocktails, not a real menu. Uploads, invites and passwords are switched off.',
  },
  mise: {
    sub: 'Pick a view and look around Wrenfield, a sample restaurant made up for this demo. Its menu, drinks, wine list and team are all made up. It resets after a day.',
    foot: 'Demo · Wrenfield isn’t a real restaurant. Uploads, invites and passwords are switched off.',
  },
};

export function DemoPicker({ kind }: { kind: DemoKind }) {
  const { refresh } = useSession();
  const go = useNavigate();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  // The Mise picker is drawn in the Mise look before anyone is signed in to a Mise company.
  useLayoutEffect(() => { setPageBrand(kind === 'mise' ? 'mise' : 'baldwin'); return () => setPageBrand(null); }, [kind]);
  // There's no way out from inside the demo pages (Nov 7, Tommy). Demo Home (this picker) is the way out: back to your own
  // account if one was kept aside, otherwise to the sign-in screen.
  const [own, setOwn] = useState(false);
  useEffect(() => { api<{ own: boolean }>('/api/demo/return').then((r) => setOwn(r.own)).catch(() => {}); }, []);
  const start = async (key: string) => {
    if (busy) return; setBusy(key); setErr('');
    try { await api('/api/demo/start', { method: 'POST', body: { role: key, demo: kind } }); markDemoTab(); setPageBrand(null); await refresh(); go('/'); }
    catch (e) { setErr((e as Error).message || 'That didn’t start. Try again.'); setBusy(''); }
  };
  const mise = kind === 'mise';
  return (
    <main className={'demo-pick' + (mise ? ' mise' : '')}>
      <div className="demo-brand">
        {mise
          ? <img src="/img/mise-academy-lockup-cream.png" alt="Mise Academy" height="64" />
          : <img src="/img/logo-white.png" alt="The Baldwin" height="40" />}
        {/* The demo tag (Nov 9 rule): the workspace name in muted text, then the DEMO tag. */}
        <span className="demo-line"><span>{mise ? 'Wrenfield' : 'Mise Academy'}</span><span className="demo-pill">DEMO</span></span>
      </div>
      <div className="demo-head">
        {mise ? <p className="demo-kicker">Try it yourself</p> : <p className="demo-script">Try it yourself</p>}
        <h1>{mise ? 'Mise Academy' : 'MISE ACADEMY'}</h1>
        <p className="demo-sub">{COPY[kind].sub}</p>
      </div>
      <div className="demo-roles">
        {ROLES.map((r) => (
          <section key={r.key} className={'demo-role' + (r.lead ? ' lead' : '')}>
            <h2>{mise ? r.name : r.name.toUpperCase()}</h2>
            <p>{r.line}</p>
            <button type="button" onClick={() => start(r.key)} disabled={!!busy}>{busy === r.key ? 'Opening…' : `Start as ${r.name}  →`}</button>
          </section>
        ))}
      </div>
      {err && <p role="alert" className="demo-err">{err}</p>}
      <p className="demo-foot">{COPY[kind].foot}</p>
      {/* Nov 10, Tommy: "there is no log out button. i am stuck in demo". Demo Home always offers a way back to sign-in:
          your own account if one was kept aside, otherwise the sign-in screen. The demo pages themselves still have no exit (Nov 7). */}
      <button type="button" className="demo-back" onClick={() => void exitDemo(refresh)}>{own ? 'Back to My Account' : 'Sign In to Your Account'}</button>
    </main>
  );
}
