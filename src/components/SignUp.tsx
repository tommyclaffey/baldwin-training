// Start Your Restaurant (Nov 25; Figma 09 · Idea Board section 48, 965:1574; approved Nov 25: "go with your choice").
// /sign-up, linked under the Sign In card ("New restaurant? Start Your Restaurant", like Try the Demo).
//   1 Your Account → 2 Your Restaurant → 3 Your Plan → 4 Your Book Starts Here, then the admin Home with Get Ready.
// Free until prices and Stripe exist: no prices, no card; the plan picked is the plan they get. Every new company shows in
// Super Admin → Companies ("Signed Up" tag) and its log. Server: server/signup.mjs.
// Email on (RESEND_API_KEY): step 1 sends a link first ("Check Your Email"), and the link opens step 2 (?verify=<token>).
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { useSession } from '../lib/session';
import { AuthCard } from './AuthCard';
import { noteSignedIn } from './BookSignIn';

type Info = { states: string[]; library: { classics: number; videos: number }; mailOn: boolean; maxStores: number };
type Plan = 'foundation' | 'custom-brand';
const SIZES: [string, string][] = [['1', '1'], ['2-5', '2–5'], ['6-25', '6–25'], ['25+', 'More than 25']];
const STEPS = ['Account', 'Restaurant', 'Plan', 'Your Book'];
/** The link from a name, as the server makes it (server/links.mjs toSlug), cut to 40. */
const slugOf = (s: string) => s.toLowerCase().replace(/&/g, ' and ').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
const host = () => location.host.replace(/^www\./, '');

function Progress({ at }: { at: number }) {
  return (
    <ol className="su-progress" aria-label={`Step ${Math.min(at + 1, 4)} of 4`}>
      {STEPS.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'here' : ''} aria-current={i === at ? 'step' : undefined}><span className="su-bar" /><span className="su-step">{s}</span></li>)}
    </ol>
  );
}

export function SignUp() {
  const { legal } = useSession();
  const [info, setInfo] = useState<Info | null>(null);
  const [step, setStep] = useState(0); // 0 account · 1 restaurant · 2 plan · 3 your book · 9 check your email
  const [acct, setAcct] = useState({ name: '', email: '', password: '' });
  const [verify, setVerify] = useState<string | null>(null);
  const [rest, setRest] = useState({ company: '', slug: '', store: '', state: '', size: '1' });
  const [slugEdited, setSlugEdited] = useState(false);
  const [link, setLink] = useState<{ slug: string; available: boolean; reason: string | null; suggestions: string[] } | null>(null);
  const [plan, setPlan] = useState<Plan>('foundation');
  const [made, setMade] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [errorAt, setErrorAt] = useState('');
  const [busy, setBusy] = useState(false);
  const linkSeq = useRef(0);

  useEffect(() => {
    api<Info>('/api/sign-up/info').then(setInfo).catch(() => setInfo({ states: [], library: { classics: 0, videos: 0 }, mailOn: false, maxStores: 25 }));
    // Email on: the link in the email opens step 2
    const v = new URLSearchParams(location.search).get('verify');
    if (v) api<{ valid: boolean; name?: string; email?: string }>(`/api/sign-up/verify/${encodeURIComponent(v)}`).then((r) => {
      if (r.valid) { setVerify(v); setAcct({ name: r.name || '', email: r.email || '', password: '' }); setStep(1); }
      else { setError('That link has expired or was already used. Start again.'); setErrorAt('form'); }
    }).catch(() => {});
  }, []);
  useEffect(() => { document.title = 'Start Your Restaurant · Mise Academy'; }, []);

  // The link follows the company name until they change it themselves; checked as they type (the server says if it's free)
  const slug = slugEdited ? rest.slug : slugOf(rest.company);
  useEffect(() => {
    if (step !== 1 || slug.length < 2) { setLink(null); return; }
    const n = ++linkSeq.current;
    const t = setTimeout(() => {
      const q = new URLSearchParams({ slug, company: rest.company, store: rest.store, state: rest.state });
      api<NonNullable<typeof link>>(`/api/sign-up/link?${q}`).then((r) => { if (n === linkSeq.current) setLink(r); }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [slug, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown, at: string) => { setError((e as Error).message); setErrorAt(at); };
  const clear = () => { setError(''); setErrorAt(''); };
  const invalid = (at: string) => (error && errorAt === at ? { 'aria-invalid': true, 'aria-describedby': 'su-error' } : {});
  const note = (at: string, extra?: ReactNode) => (error && errorAt === at ? <div className="error" id="su-error" role="alert"><p>{error}</p>{extra}</div> : null);

  const account = async (e: FormEvent) => {
    e.preventDefault(); clear();
    if (acct.password.length < 10) { setError('Too short. Use at least 10 characters; a short sentence works well.'); setErrorAt('password'); return; }
    setBusy(true);
    try {
      await api('/api/sign-up/email', { method: 'POST', body: { email: acct.email } });
      if (info?.mailOn) { await api('/api/sign-up/start', { method: 'POST', body: acct }); setStep(9); }
      else setStep(1);
    } catch (err) { fail(err, /email/i.test((err as Error).message) ? 'email' : 'form'); }
    setBusy(false);
  };
  const resend = async () => {
    setBusy(true); clear();
    try { await api('/api/sign-up/start', { method: 'POST', body: acct }); setError('Sent again.'); setErrorAt('sent'); } catch (err) { fail(err, 'form'); }
    setBusy(false);
  };
  const restaurant = (e: FormEvent) => {
    e.preventDefault(); clear();
    if (rest.company.trim().length < 2) { setError('Add your company or group name.'); setErrorAt('company'); return; }
    if (!link?.available) { setError(link?.reason || 'Pick a link for your restaurant.'); setErrorAt('slug'); return; }
    if ((rest.store.trim() || rest.company.trim()).length < 2) { setError('Add your first location’s name.'); setErrorAt('store'); return; }
    setStep(2);
  };
  const create = async (e: FormEvent) => {
    e.preventDefault(); clear(); setBusy(true);
    try {
      const body = { ...(verify ? { verify } : acct), company: rest.company, slug, store: rest.store.trim() || rest.company, state: rest.state || null, size: rest.size, plan };
      const r = await api<{ user: User }>('/api/sign-up', { method: 'POST', body });
      setMade(r.user); setStep(3);
    } catch (err) {
      const m = (err as Error).message;
      if (/link/i.test(m)) { setStep(1); fail(err, 'slug'); } else if (/email|account/i.test(m) && !verify) { setStep(0); fail(err, 'email'); } else fail(err, 'form');
    }
    setBusy(false);
  };
  /** Into the app: signed in already (the cookie came with step 3); the session takes them where they tapped. */
  // (a full load: the app's signed-out route would otherwise win the race and send them Home)
  const go = (to: string) => { if (!made) return; noteSignedIn(); location.assign(to); };

  const agree = legal.public
    ? <p className="muted small su-agree">By continuing you agree to the <Link to="/terms">Terms</Link> and the <Link to="/privacy">Privacy Policy</Link>.</p>
    : null;
  const back = (to: number) => <button type="button" className="btn ghost su-back" onClick={() => { clear(); setStep(to); }}>Back</button>;

  if (step === 9) return (
    <AuthCard kicker="One more step" title="Check Your Email" sub={<>We sent a link to <strong>{acct.email}</strong>. Open it to finish setting up your restaurant.</>}>
      <div className="stack">
        <p className="muted small">Nothing yet? Check spam, or send it again in a minute.</p>
        {error && errorAt === 'sent' ? <p className="small" role="status">{error}</p> : note('form')}
        <button type="button" className="btn" disabled={busy} onClick={() => void resend()}>{busy ? 'Sending…' : 'Resend Email'}</button>
        <p className="si-alt">Wrong email? <button type="button" className="link-btn si-inline" onClick={() => { clear(); setStep(0); }}>Change It</button></p>
      </div>
    </AuthCard>
  );

  if (step === 0) return (
    <AuthCard top={<Progress at={0} />} kicker="Start Your Restaurant · Step 1 of 4" title="Your Account" sub="You’ll be the owner. You can add managers once you’re in.">
      <form className="stack" onSubmit={account} noValidate>
        <label className="field"><span>Your name</span><input value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })} autoComplete="name" /></label>
        <label className="field"><span>Work email</span><input type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="username" value={acct.email} {...invalid('email')} onChange={(e) => setAcct({ ...acct, email: e.target.value })} /></label>
        {note('email', /already/.test(error) ? <p>Is it yours? <Link to="/sign-in">Sign In</Link>, or use Forgot Password? there.</p> : null)}
        <label className="field"><span>Password</span><input type="password" autoComplete="new-password" value={acct.password} {...invalid('password')} onChange={(e) => setAcct({ ...acct, password: e.target.value })} />
          <small>At least 10 characters. A short sentence works well.</small></label>
        {note('password')}
        <p className="muted small su-later"><strong>Later: two-step sign-in.</strong> After setup, turn it on in Your Account: a code from an authenticator app each time you sign in.</p>
        {note('form')}
        <button className="btn" disabled={busy || acct.name.trim().length < 2 || !acct.email.trim() || !acct.password}>{busy ? 'Checking…' : 'Continue'}</button>
        {agree}
      </form>
      <hr className="si-rule" />
      <p className="si-alt">Already on Mise? <Link to="/sign-in">Sign In</Link></p>
    </AuthCard>
  );

  if (step === 1) return (
    <AuthCard top={<Progress at={1} />} kicker="Start Your Restaurant · Step 2 of 4" title="Your Restaurant" sub="This is what your team sees when they sign in.">
      <form className="stack" onSubmit={restaurant} noValidate>
        <label className="field"><span>Company or group name</span><input value={rest.company} {...invalid('company')} onChange={(e) => setRest({ ...rest, company: e.target.value })} autoComplete="organization" /></label>
        {note('company')}
        <label className="field"><span>Your link</span>
          <span className="su-link"><span className="su-host" aria-hidden="true">{host()}/</span>
            <input value={slug} aria-label={`Your link: ${host()}/`} {...invalid('slug')} autoCapitalize="none" spellCheck={false}
              onChange={(e) => { setSlugEdited(true); setRest({ ...rest, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) }); }} /></span>
          {link?.available && <small className="su-ok">✓ Available. Share it with your join code; the link alone never opens your book.</small>}
        </label>
        {link && !link.available && <div className="error" id={errorAt === 'slug' ? 'su-error' : undefined} role="alert"><p>{link.reason}</p>
          {link.suggestions.length > 0 && <div className="su-try"><span>Try</span>{link.suggestions.map((s) => <button key={s} type="button" className="su-chip" onClick={() => { setSlugEdited(true); setRest({ ...rest, slug: s }); }}>{s}</button>)}</div>}</div>}
        {!(link && !link.available) && note('slug')}
        <label className="field"><span>First location’s name</span><input name="store" value={rest.store} placeholder={rest.company || undefined} {...invalid('store')} onChange={(e) => setRest({ ...rest, store: e.target.value })} />
          <small>Add more locations any time, up to {info?.maxStores ?? 25}.</small></label>
        {note('store')}
        <label className="field"><span>State</span>
          <select value={rest.state} onChange={(e) => setRest({ ...rest, state: e.target.value })}>
            <option value="">Pick your state</option>
            {(info?.states || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <small>A few lessons use Michigan law as the example. {rest.state && rest.state !== 'Michigan' ? `We’ll label them for ${rest.state}.` : 'We label them for your state.'}</small></label>
        <fieldset className="field su-sizes"><legend>How many locations?</legend>
          <div className="su-chips">{SIZES.map(([k, l]) => <label key={k} className={'su-chip' + (rest.size === k ? ' on' : '')}><input type="radio" name="size" value={k} checked={rest.size === k} onChange={() => setRest({ ...rest, size: k })} />{l}</label>)}</div>
          {rest.size === '25+' && <small>More than 25? Start with your first ones; we’ll help with the rest.</small>}
        </fieldset>
        {note('form')}
        <div className="su-nav">{back(0)}<button className="btn" disabled={rest.company.trim().length < 2 || !link?.available}>Continue</button></div>
      </form>
    </AuthCard>
  );

  if (step === 2) return (
    <AuthCard top={<Progress at={2} />} kicker="Start Your Restaurant · Step 3 of 4" title="Your Plan" sub="Both plans have every feature. Custom Brand changes the look.">
      <form className="stack" onSubmit={create}>
        <div className="su-plans" role="radiogroup" aria-label="Plan">
          {([['foundation', 'Foundation', 'The Mise Academy look on every screen.', ['Every feature: the book, quizzes, sign-offs, certificates, Team Chat and prep',
            `The shared library: ${info?.library.classics ?? '…'} classic cocktails and ${info?.library.videos ?? '…'} wine videos`, 'Mise sign-in, link card and certificates']],
            ['custom-brand', 'Custom Brand', 'Your logo, colours and fonts on every screen, read from your website.', ['Everything in Foundation. Same features, only the look changes',
              'Each location can have its own look', 'Your sign-in and link card in your look']]] as [Plan, string, string, string[]][]).map(([id, name, line, points]) => (
            <label key={id} className={'su-plan' + (plan === id ? ' on' : '')}>
              <input type="radio" name="plan" value={id} checked={plan === id} onChange={() => setPlan(id)} />
              <span className="su-plan-head"><strong>{name}</strong><span className="su-soon">Pricing coming soon</span></span>
              <span className="su-plan-line">{line}</span>
              <ul>{points.map((p) => <li key={p}>{p}</li>)}</ul>
            </label>
          ))}
        </div>
        <p className="su-pay"><strong>No card needed.</strong> Mise is free until prices are set.</p>
        {note('form')}
        <div className="su-nav">{back(1)}<button className="btn" disabled={busy}>{busy ? 'Setting Up…' : 'Continue'}</button></div>
      </form>
    </AuthCard>
  );

  // 4 · Your Book Starts Here
  const store = rest.store.trim() || rest.company;
  const next: [string, string, string, string, string?][] = [
    ['Import your menu', 'Upload a PDF or photo. We build the dish and drink pages; you check them.', '/import', 'Import a Menu'],
    ['Invite your team', `Share your join code and your link: ${host()}/${slug}`, '/admin/people?add=1', 'Add a Person'],
    ['Set jobs and paths', 'Give each person their job; their path shows what they learn first.', '/admin/people', 'Open People'],
    ['Your Look', 'Bring in your logo and colours from your website.', '/admin/your-look', plan === 'custom-brand' ? 'Open Your Look' : 'See Custom Brand', 'Custom Brand'],
  ];
  return (
    <AuthCard top={<Progress at={4} />} kicker="Start Your Restaurant · Step 4 of 4 · Done" title="Your Book Starts Here" sub={`${store} is set up. Here’s what your team gets on day one, and what to do next.`}>
      <div className="stack">
        <section className="su-ready" aria-label="Ready on day one">
          <p className="si-kicker">Ready on day one</p>
          <ul>
            <li><strong>The shared library</strong><span>{info?.library.classics ?? 0} classic cocktails, spirits, wine regions and grapes, beer styles, and {info?.library.videos ?? 0} wine videos</span></li>
            <li><strong>Cocktail, Beer and Sommelier Programs</strong><span>Lessons, quizzes, finals and certificates by level</span></li>
            <li><strong>Steps of Service and Safety</strong><span>Written for any restaurant, ready for your own menu</span></li>
          </ul>
        </section>
        <section className="su-next" aria-label="Next, in any order">
          <p className="si-kicker">Next, in any order</p>
          <ol>{next.map(([t, d, to, label, tag], i) => (
            <li key={t}><span className="su-num" aria-hidden="true">{i + 1}</span><span className="su-next-text"><strong>{t}{tag && <small className="su-tag">{tag}</small>}</strong><span>{d}</span></span>
              <button type="button" className="su-go" aria-label={label} onClick={() => go(to)}>→</button></li>
          ))}</ol>
        </section>
        <button type="button" className="btn" autoFocus onClick={() => go('/admin')}>Open My Book</button>
      </div>
    </AuthCard>
  );
}
