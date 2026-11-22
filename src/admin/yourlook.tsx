// Admin → Settings → Your Look (Nov 22; Figma 09 · Idea Board → 44, 877:1388; Tommy, Nov 20: "Looks good to me").
// Your look from your website: Paste → Read → Check → Adjust → Apply, with Undo. The server reads the site and keeps the
// look as data (server/yourlook.mjs); the colour maths is shared (src/lib/lookspec.ts); the look's paint is theme.ts
// `themeFromSpec`, the same function every screen draws a data look with, so the previews are the real thing.
//
// Screens (Figma): entry 877:1393 · paste 878:1393 (phone 882:1618) · reading 878:1570 · the look found + contrast check
// 879:1403 · adjust with the live preview of Home, sign-in and the link card 880:1408 · applied + Undo 881:1424 · the
// Custom Brand card for Foundation accounts 882:1434 (no price).
//
// This screen is admin chrome, so it's always drawn in the Mise look with the A2 colours (whatever look the store wears):
// one solid fig button per screen (its main action), every other filled button Ink, dark cards on the warm charcoal panel.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { brandTitle, color, fontCss, registerLook, lookTheme, themeFromSpec, cropFill, type Brand, type Theme } from '../lib/theme';
import { COLOR_ROLES, type LookSpec, type LookColors, type PairResult, type Fix } from '../lib/lookspec.ts';
import { ErrorNote, Loading } from './ui';

/* ── Data from the server ──────────────────────────────────────────────────────────────────────────────────────────── */
type Access = 'full' | 'try' | 'upgrade' | 'none';
type StoreRow = { id: number; name: string; look: string; lookName: string; kind: 'mise' | 'custom' | 'data'; own: boolean };
type State = { access: Access; demo: boolean; plan: string; company: string; link: string | null; store: { id: number; name: string } | null; canGroup: boolean; stores: StoreRow[];
  current: StoreRow | null; companyLook: { id: string; name: string }; aiOn: boolean; reading: number | null;
  lastChange: { id: number; scope: string; at: string; look: string | null; lookName: string | null; storeNames: string[]; before: string | null; beforeLook: string | null } | null;
  draft: { id: string; name: string; status: string; source: string | null } | null };
type LogoOpt = { src: string; w: number; h: number; crop: [number, number, number, number, number, number]; variant: 'dark' | 'light'; from: string };
type Look = { id: Brand; name: string; status: 'draft' | 'saved'; source: string | null; spec: LookSpec; pairs: PairResult[]; fixes: Fix[]; checked: number; passedAsFound: number | null;
  options: { logos: LogoOpt[]; photos: { src: string; w: number; h: number; from: string }[]; icon: string | null };
  fonts: { found: { name: string; kind: string }[]; standIn: Record<string, string>; systemBody: string | null } | null;
  colorsFound: string[]; colorCount: number; why: Partial<Record<keyof LookColors, string>>; byAi: boolean; pages: string[]; inUse: boolean; justFixed?: Fix[] };
type Read = { id: number; url: string; scope: 'store' | 'group'; status: 'reading' | 'done' | 'failed' | 'cancelled'; steps: { state: 'wait' | 'run' | 'done' | 'skip'; detail: string }[];
  error: string | null; byAi: boolean; look: Look | null };

const BASE = '/admin/your-look';
const SUPPORT = 'support@miseacademy.app';
const STEP_NAMES = ['Paste', 'Read', 'Check', 'Adjust', 'Apply'];
const READ_STEPS = [
  { title: (h: string) => `Opened ${h}`, run: (h: string) => `Opening ${h}` },
  { title: () => 'Found your logo', run: () => 'Finding your logo' },
  { title: () => 'Read your colours', run: () => 'Reading your colours' },
  { title: () => 'Read your fonts', run: () => 'Reading your fonts' },
  { title: () => 'Matched free fonts', run: () => 'Matching free fonts' },
  { title: () => 'Picked photos', run: () => 'Picking photos and checking contrast' },
];
/** Free faces an owner can pick (Google Fonts), plus whatever the look already uses. */
const FACES = ['Archivo', 'Barlow', 'Bebas Neue', 'Bodoni Moda', 'Cinzel', 'Cormorant Garamond', 'DM Sans', 'DM Serif Display', 'EB Garamond', 'Fjalla One', 'Gilda Display', 'Great Vibes',
  'Inter', 'Italiana', 'Jost', 'Josefin Sans', 'Lato', 'Libre Baskerville', 'Libre Caslon Display', 'Lora', 'Marcellus', 'Montserrat', 'Nunito Sans', 'Open Sans', 'Oswald', 'Outfit',
  'Pinyon Script', 'Playfair Display', 'Poppins', 'Prata', 'Raleway', 'Work Sans'];
/** "J.Baldwin's" → "J.Baldwin's" (already possessive), "Fig & Fire" → "Fig & Fire’s". */
const poss = (n: string) => (/['’]s$/i.test(n) ? n : n + '’s');
const host = (u: string | null | undefined) => { try { return new URL(/^https?:/.test(u || '') ? u! : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return u || ''; } };

/* ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
export function YourLookPage() {
  const { user, refresh } = useSession();
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setSt(await api<State>('/api/your-look')); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load, user?.store?.id]);
  const { pathname } = useLocation();
  const sub = pathname.slice(BASE.length).split('/').filter(Boolean); // [] · ['paste'] · ['read', id] · ['look', id, 'check'|'adjust'|'applied']
  if (error) return <Shell><ErrorNote error={error} retry={() => void load()} /></Shell>;
  if (!st) return <Shell><Loading /></Shell>;
  const tryMode = st.access === 'try';
  if (st.access === 'upgrade' || (tryMode && !sub.length)) return <Shell><Gate st={st} /></Shell>;
  const ctx = { st, reload: load, refresh };
  if (sub[0] === 'paste') return <Shell><Paste {...ctx} /></Shell>;
  if (sub[0] === 'read' && sub[1]) return <Shell><Reading {...ctx} id={Number(sub[1])} /></Shell>;
  if (sub[0] === 'look' && sub[1]) return <Shell><LookFlow {...ctx} id={sub[1]} step={(sub[2] as 'check' | 'adjust' | 'applied') || 'adjust'} /></Shell>;
  return <Shell><Entry {...ctx} /></Shell>;
}
type Ctx = { st: State; reload: () => Promise<void>; refresh: () => Promise<void> };

/** The Mise look, A2, on this screen only (the store may wear another look). */
function Shell({ children }: { children: ReactNode }) {
  return <div className="yl">{children}</div>;
}
function Head({ crumbs, title, sub, step, done = 0 }: { crumbs: string[]; title: string; sub?: ReactNode; step?: number; done?: number }) {
  return (
    <header className="yl-head">
      <p className="yl-crumbs">{crumbs.join(' · ')}</p>
      <h1 className="yl-title">{title}</h1>
      {sub && <p className="yl-sub">{sub}</p>}
      {step !== undefined && <Steps at={step} done={done} />}
    </header>
  );
}
/** 1 · Paste … 5 · Apply: done steps tinted, the current one solid. Phones show the current step's name only. */
function Steps({ at, done }: { at: number; done: number }) {
  return (
    <ol className="yl-steps" aria-label="Steps">
      {STEP_NAMES.map((n, i) => (
        <li key={n} className={i === at ? 'is-on' : i < Math.max(at, done) ? 'is-done' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="yl-step-n">{i + 1}</span><span className="yl-step-name">{'\u00A0·\u00A0'}{n}</span>
        </li>
      ))}
    </ol>
  );
}
const Check = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Lock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></svg>;
const Globe = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></svg>;
function Swatches({ colors }: { colors: string[] }) {
  return <span className="yl-swatches" aria-hidden="true">{colors.map((c, i) => <span key={i} style={{ background: c }} />)}</span>;
}

/* ── 1 · Entry (877:1393) ─────────────────────────────────────────────────────────────────────────────────────────── */
function Entry({ st, reload }: Ctx) {
  const nav = useNavigate();
  const { user } = useSession();
  const store = st.store?.name || st.company;
  const cur = st.current;
  const curTheme = cur ? lookTheme(cur.look as Brand) : lookTheme('mise');
  const sw = ['page', 'card', 'ink', 'accentOnLight', 'accent'].map((r) => color(curTheme, r as never));
  const others = st.stores.filter((s) => s.id !== st.store?.id && s.kind !== 'mise').map((s) => s.name);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const byHand = async () => {
    setBusy('hand'); setErr('');
    try { const l = await api<Look>('/api/your-look/blank', { method: 'POST' }); nav(`${BASE}/look/${l.id}/adjust`); }
    catch (e) { setErr((e as Error).message); setBusy(''); }
  };
  const switchTo = async (id: number, then: string) => { await api('/api/store', { method: 'POST', body: { storeId: id } }); location.assign(then); };
  const undo = async () => { setBusy('undo'); try { await api('/api/your-look/undo', { method: 'POST' }); location.reload(); } catch (e) { setErr((e as Error).message); setBusy(''); } };
  return (
    <div className="yl-page">
      <Head crumbs={['Settings', store]} title="Your Look" sub={`How the app looks for ${poss(store)} team: logo, colours, fonts and the photo on sign-in. Every feature stays the same; only the paint changes.`} />
      <section className="yl-card yl-status" aria-label="This store’s look">
        <Swatches colors={sw} />
        <div className="yl-status-text">
          <p className="yl-strong">{store} is using {cur?.kind === 'mise' || !cur ? 'the Mise look' : cur.own ? `its own look (${cur.lookName})` : `the ${cur.lookName} look`}</p>
          <p className="yl-muted">{cur?.kind === 'mise' || !cur ? 'The Foundation default. ' : ''}Your own look replaces it for this store only{others.length ? `; ${others.join(' and ')} keep${others.length === 1 ? 's' : ''} ${others.length === 1 ? 'its' : 'theirs'}` : ''}.</p>
        </div>
        <span className="yl-pill yl-pill-ok">{st.demo && st.access === 'try' ? 'Demo · a throwaway look' : 'Custom Brand · in your plan'}</span>
      </section>
      {st.lastChange && (
        <section className="yl-banner" role="status">
          <span className="yl-banner-icon"><Check /></span>
          <p><strong>{st.lastChange.lookName}</strong> is on {st.lastChange.scope === 'group' ? 'every store' : st.lastChange.storeNames.join(', ') || 'one store'}.{st.lastChange.before ? ` Undo puts the ${st.lastChange.before} look back.` : ''}</p>
          <button type="button" className="yl-btn ghost small" disabled={!!busy} onClick={() => void undo()}>Undo</button>
        </section>
      )}
      <div className="yl-three">
        <section className="yl-card yl-dark">
          <p className="yl-label">Recommended</p>
          <h2>Pull it from your website</h2>
          <p>Paste your web address. We read your logo, colours, fonts and photos, check every pair for contrast, and show you the look before anything changes.</p>
          <button type="button" className="yl-btn primary" onClick={() => nav(`${BASE}/paste`)}>Start With Your Website</button>
        </section>
        <section className="yl-card">
          <p className="yl-label yl-fig">By hand</p>
          <h2>Set it up yourself</h2>
          <p className="yl-muted">Upload your logo, then pick each colour and font yourself. Same contrast check, same live preview.</p>
          <button type="button" className="yl-btn ghost" disabled={busy === 'hand'} onClick={() => void byHand()}>{busy === 'hand' ? 'Starting…' : 'Set Up by Hand'}</button>
        </section>
        <section className="yl-card">
          <p className="yl-label yl-fig">Done for you</p>
          <h2>Have Mise do it</h2>
          <p className="yl-muted">Send us your files. A Mise team member builds the look in Super Admin and sends it to you to approve.</p>
          <a className="yl-btn ghost" href={`mailto:${SUPPORT}?subject=${encodeURIComponent(`Custom Brand look for ${store}`)}`}>Ask the Mise Team</a>
        </section>
      </div>
      {err && <p className="yl-error" role="alert">{err}</p>}
      <section className="yl-card yl-stores" aria-labelledby="yl-stores-h">
        <div className="yl-stores-head"><h2 id="yl-stores-h">Each store can wear its own look</h2><p className="yl-label">{st.company} · {st.stores.length} {st.stores.length === 1 ? 'store' : 'stores'}</p></div>
        <ul>
          {st.stores.map((s) => (
            <li key={s.id}>
              <span className="yl-store-name">{s.name}</span>
              <span className={'yl-pill ' + (s.kind === 'mise' ? 'yl-pill-quiet' : 'yl-pill-ok')}>{s.kind === 'mise' ? 'Mise look' : s.own ? 'Its own look' : s.lookName}</span>
              {s.kind === 'data'
                ? <button type="button" className="yl-btn ghost small" onClick={() => (s.id === st.store?.id ? nav(`${BASE}/look/${s.look}/adjust`) : void switchTo(s.id, `${BASE}/look/${s.look}/adjust`))}>Edit Look</button>
                : s.kind === 'custom'
                  ? <span className="yl-muted small">Built by the Mise team</span>
                  : (s.id === st.store?.id || user?.canSwitchStore) && <button type="button" className="yl-btn ink small" onClick={() => (s.id === st.store?.id ? nav(`${BASE}/paste`) : void switchTo(s.id, `${BASE}/paste`))}>Set Up</button>}
            </li>
          ))}
        </ul>
      </section>
      {st.draft && st.draft.status === 'draft' && (
        <p className="yl-muted">You have a draft: <Link to={`${BASE}/look/${st.draft.id}/adjust`}>{st.draft.name}</Link>{st.draft.source ? ` from ${host(st.draft.source)}` : ''}.</p>
      )}
      <button type="button" hidden onClick={() => void reload()} />
    </div>
  );
}

/* ── 7 · Foundation: the Custom Brand card (882:1434, no price) ───────────────────────────────────────────────────── */
function Gate({ st }: { st: State }) {
  const nav = useNavigate();
  const store = st.store?.name || st.company;
  const tryIt = st.access === 'try';
  return (
    <div className="yl-page">
      <Head crumbs={['Settings', store]} title="Your Look" sub={`${store} is on Foundation: every feature, in the Mise look.`} />
      <section className="yl-card yl-dark yl-gate">
        <div>
          <p className="yl-label yl-lock"><Lock /> Custom Brand</p>
          <h2 className="yl-gate-h">Make the app look like your restaurant</h2>
          <p>Paste your website and your team’s app picks up your logo, colours and fonts. Same features you have today; only the look changes.</p>
          <div className="yl-row">
            <a className="yl-btn primary" href={`mailto:${SUPPORT}?subject=${encodeURIComponent('Custom Brand for ' + st.company)}`}>Talk to Us About Custom Brand</a>
            {tryIt
              ? <button type="button" className="yl-btn outline-dark" onClick={() => nav(`${BASE}/paste`)}>See an Example</button>
              : <a className="yl-btn outline-dark" href="/demo/brg" target="_blank" rel="noreferrer">See an Example</a>}
          </div>
          {tryIt && <p className="yl-small-dark">In the demo you can try it with your own website: the look is thrown away with the demo.</p>}
        </div>
        <div>
          <p className="yl-label">What you get</p>
          <ul className="yl-ticks">
            {['Your logo, colours and fonts on every screen', 'A different look for each location', 'Your own sign-in after the join code', 'Your own tab and home-screen icon', 'Your own link card when someone texts the app', 'Your logo on every certificate']
              .map((t) => <li key={t}><span className="yl-tick"><Check /></span>{t}</li>)}
          </ul>
        </div>
      </section>
      <section className="yl-card yl-locked" aria-label="Your website, part of Custom Brand">
        <p className="yl-label yl-lock"><Lock /> Your website · part of Custom Brand</p>
        <div className="yl-url-row">
          <input className="yl-input" disabled placeholder="https://yourrestaurant.com" aria-label="Your website (part of Custom Brand)" />
          <button type="button" className="yl-btn ghost" disabled>Read My Website</button>
        </div>
        <p className="yl-muted small">Owners see this on Foundation. Managers and staff don’t see Your Look at all.</p>
      </section>
    </div>
  );
}

/* ── 2 · Paste (878:1393; phone 882:1618) ─────────────────────────────────────────────────────────────────────────── */
function Paste({ st }: Ctx) {
  const nav = useNavigate();
  const store = st.store?.name || st.company;
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState<'store' | 'group'>('store');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (st.reading) nav(`${BASE}/read/${st.reading}`, { replace: true }); }, [st.reading, nav]);
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api<{ id: number }>('/api/your-look/read', { method: 'POST', body: { url, scope } }); nav(`${BASE}/read/${r.id}`); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  const byHand = async () => { try { const l = await api<Look>('/api/your-look/blank', { method: 'POST' }); nav(`${BASE}/look/${l.id}/adjust`); } catch (x) { setErr((x as Error).message); } };
  return (
    <div className="yl-page">
      <Head crumbs={['Settings', 'Your Look', store]} title="Where’s your website?" sub="We read it to build your look. Nothing on your website changes." step={0} />
      <form className="yl-card yl-paste" onSubmit={(e) => void go(e)}>
        <label className="yl-label" htmlFor="yl-url">Your website</label>
        <div className="yl-url-row">
          <span className="yl-url"><Globe /><span className="yl-url-pre" aria-hidden="true">https://</span>
            <input id="yl-url" className="yl-url-input" value={url} onChange={(e) => setUrl(e.target.value.replace(/^https?:\/\//i, ''))} placeholder="yourrestaurant.com" autoComplete="url" inputMode="url" spellCheck={false} required /></span>
          <button className="yl-btn primary" disabled={busy || !url.trim()}>{busy ? 'Starting…' : 'Read My Website'}</button>
        </div>
        <p className="yl-muted yl-explain">We open your home page and up to two linked pages (menu, about) and read what the browser sees: the logo in your header, your site icon and link-preview image, the colours in your styles, your fonts, and a few photos.</p>
        {st.canGroup && (
          <div className="yl-use" role="radiogroup" aria-label="Use it for">
            <span className="yl-label">Use it for</span>
            <span className="yl-seg">
              <button type="button" role="radio" aria-checked={scope === 'store'} className={scope === 'store' ? 'is-on' : ''} onClick={() => setScope('store')}>{store} only</button>
              <button type="button" role="radio" aria-checked={scope === 'group'} className={scope === 'group' ? 'is-on' : ''} onClick={() => setScope('group')}><span className="yl-wide">Every store in the group</span><span className="yl-narrow">Every store</span></button>
            </span>
          </div>
        )}
        {err && <p className="yl-error" role="alert">{err}</p>}
      </form>
      <div className="yl-four">
        {[['Logo', 'From your header, plus your site icon for the app icon'], ['Colours', 'From your site’s styles, ranked by how much they’re used'], ['Fonts', 'From your font links. Paid fonts get a free stand-in'], ['Photos', '3 to 6 from the page, for sign-in and the link card']]
          .map(([t, d], i) => <section key={t} className="yl-card yl-mini"><p className="yl-num">0{i + 1}</p><h2>{t}</h2><p className="yl-muted">{d}</p></section>)}
      </div>
      <div className="yl-row yl-foot">
        <button type="button" className="yl-btn ghost" onClick={() => nav(BASE)}>Back</button>
        <p className="yl-muted"><span className="yl-wide">No website, or it’s built in a way we can’t read? </span><button type="button" className="yl-link" onClick={() => void byHand()}>Upload your logo instead</button><span className="yl-wide"> and pick the rest by hand.</span></p>
      </div>
    </div>
  );
}

/* ── 3 · Reading (878:1570) ───────────────────────────────────────────────────────────────────────────────────────── */
function Reading({ st, id }: Ctx & { id: number }) {
  const nav = useNavigate();
  const [r, setR] = useState<Read | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stop = false, t = 0;
    const tick = async () => {
      try { const x = await api<Read>(`/api/your-look/read/${id}`); if (stop) return; setR(x); if (x.status === 'reading') t = window.setTimeout(tick, 700); }
      catch (e) { if (!stop) setErr((e as Error).message); }
    };
    void tick();
    return () => { stop = true; clearTimeout(t); };
  }, [id]);
  useEffect(() => { if (r?.status === 'done' && r.look) { const t = setTimeout(() => nav(`${BASE}/look/${r.look!.id}/check`, { replace: true }), 1600); return () => clearTimeout(t); } }, [r, nav]);
  const cancel = async () => { await api(`/api/your-look/read/${id}/cancel`, { method: 'POST' }).catch(() => {}); nav(`${BASE}/paste`); };
  const store = st.store?.name || st.company;
  if (err) return <ErrorNote error={err} />;
  if (!r) return <Loading />;
  const h = host(r.url);
  const done = r.steps.filter((s) => s.state === 'done' || s.state === 'skip').length;
  const L = r.look;
  return (
    <div className="yl-page">
      <Head crumbs={['Settings', 'Your Look', store]} title={`Reading ${h}`} sub={r.status === 'failed' ? 'That didn’t work.' : 'Usually under a minute. You can leave this page; we’ll keep going.'} step={1} done={1} />
      <div className="yl-two yl-reading">
        <section className="yl-card yl-dark yl-progress" aria-live="polite">
          <p className="yl-label">Progress · {done} of {r.steps.length}</p>
          <div className="yl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={r.steps.length} aria-valuenow={done}><span style={{ width: `${(done / r.steps.length) * 100}%` }} /></div>
          <ol className="yl-read-steps">
            {r.steps.map((s, i) => (
              <li key={i} className={'is-' + s.state}>
                <span className="yl-dot" aria-hidden="true">{s.state === 'done' || s.state === 'skip' ? <Check /> : null}</span>
                <span><strong>{s.state === 'done' ? READ_STEPS[i].title(h) : READ_STEPS[i].run(h)}</strong>{s.detail && s.state !== 'run' && <small>{s.detail}</small>}{s.state === 'run' && <small>{s.detail || 'Working…'}</small>}</span>
              </li>
            ))}
          </ol>
          {r.status === 'reading' && <button type="button" className="yl-btn light" onClick={() => void cancel()}>Cancel</button>}
          {r.status === 'failed' && <div className="yl-fail"><p role="alert">{r.error}</p><div className="yl-row"><button type="button" className="yl-btn light" onClick={() => nav(`${BASE}/paste`)}>Try Another Address</button></div></div>}
          {r.status === 'cancelled' && <p>Stopped. <Link to={`${BASE}/paste`}>Start again</Link></p>}
          {r.status === 'done' && L && <button type="button" className="yl-btn light" onClick={() => nav(`${BASE}/look/${L.id}/check`)}>See Your Look</button>}
        </section>
        <section className="yl-card yl-found" aria-label="What we found so far">
          <p className="yl-label yl-fig">What we found so far</p>
          {L ? <Found look={L} /> : <FoundWaiting steps={r.steps} />}
        </section>
      </div>
    </div>
  );
}
function FoundWaiting({ steps }: { steps: Read['steps'] }) {
  const line = (i: number, label: string) => <div className="yl-found-row"><h3>{label}</h3><p className="yl-muted">{steps[i].state === 'done' || steps[i].state === 'skip' ? steps[i].detail : steps[i].state === 'run' ? 'Reading…' : 'Waiting'}</p></div>;
  return <>{line(1, 'Logo')}{line(2, 'Colours, most used first')}{line(3, 'Fonts')}{line(5, 'Photos')}<div className="yl-photos">{[0, 1, 2, 3].map((i) => <span key={i} className="yl-ph-empty" />)}</div></>;
}
function Found({ look }: { look: Look }) {
  const logos = look.options.logos;
  const dark = logos.find((l) => l.src === look.spec.logo.dark?.src) || logos.find((l) => l.variant === 'dark');
  const light = logos.find((l) => l.src === look.spec.logo.light?.src) || logos.find((l) => l.variant === 'light');
  return (
    <>
      <div className="yl-logos">
        {dark && <figure><div className="yl-logo-tile on-dark"><Art l={dark} /></div><figcaption>White · for dark</figcaption></figure>}
        {light && <figure><div className="yl-logo-tile on-light" style={{ background: look.spec.colors.card }}><Art l={light} /></div><figcaption>Full colour · for light</figcaption></figure>}
        {!dark && !light && <p className="yl-muted">No logo we could use. You can upload one in the next steps.</p>}
      </div>
      <h3>Colours, most used first</h3>
      <div className="yl-chips">{look.colorsFound.slice(0, 6).map((c) => <span key={c} className="yl-chip"><span style={{ background: c }} /><code>{c}</code></span>)}</div>
      <h3>Fonts</h3>
      <FontsFound look={look} />
      <h3>Photos</h3>
      <div className="yl-photos">{look.options.photos.slice(0, 4).map((p) => <img key={p.src} src={p.src} alt="" />)}{look.options.photos.length < 4 && Array.from({ length: 4 - Math.min(4, look.options.photos.length) }, (_, i) => <span key={i} className="yl-ph-empty" />)}</div>
    </>
  );
}
function FontsFound({ look }: { look: Look }) {
  const f = look.spec.fonts;
  return (
    <div className="yl-fonts-found">
      <p>Headings: {f.standIn?.heading || f.heading}{f.standIn?.heading && <span className="yl-pill yl-pill-warn">Paid · free match: {f.heading}</span>}</p>
      <p>Body: {f.standIn?.body ? `${f.standIn.body} (a system font) → ${f.body}` : f.body}{look.fonts?.systemBody && !f.standIn?.body ? ` · ${look.fonts.systemBody} (a system font) on your site` : ''}</p>
    </div>
  );
}
/** A logo file shown as it is: its artwork box at uniform scale (theme.ts Crop), never recoloured or redrawn. */
function Art({ l, h = 64 }: { l: { src: string; crop: [number, number, number, number, number, number] }; h?: number }) {
  const [x, y, w, hh, W] = l.crop;
  const cf = cropFill(l.crop);
  return (
    <span className="yl-art" role="img" aria-label="Logo" style={{ aspectRatio: `${w} / ${hh}`, maxHeight: h, backgroundImage: `url("${l.src}")`, backgroundSize: cf.bs, backgroundPosition: cf.bp }} data-x={x} data-y={y} data-w={W} />
  );
}

/* ── 4–6 · Check, Adjust, Applied ─────────────────────────────────────────────────────────────────────────────────── */
function LookFlow({ st, id, step }: Ctx & { id: string; step: 'check' | 'adjust' | 'applied' }) {
  const [look, setLook] = useState<Look | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<Look>(`/api/your-look/looks/${id}`).then((l) => { registerLook(l.id, l.spec, { quiet: true }); setLook(l); }).catch((e) => setErr((e as Error).message)); }, [id]);
  if (err) return <ErrorNote error={err} />;
  if (!look) return <Loading />;
  if (step === 'check') return <CheckStep st={st} look={look} />;
  if (step === 'applied') return <Applied st={st} look={look} />;
  return <Adjust st={st} look={look} setLook={setLook} />;
}

function CheckStep({ st, look }: { st: State; look: Look }) {
  const nav = useNavigate();
  const store = st.store?.name || st.company;
  const c = look.spec.colors;
  const fixes = new Map(look.fixes.map((f) => [f.id, f]));
  const passed = look.passedAsFound ?? look.pairs.filter((p) => p.pass).length;
  return (
    <div className="yl-page">
      <Head crumbs={['Settings', 'Your Look', store]} title="Here’s your look" sub={`Every colour from ${host(look.source) || 'your site'}, given a job in the app. Then every text and background pair is checked; anything under WCAG AA is fixed for you and flagged below.`} step={2} done={2} />
      <section className="yl-banner" role="status"><span className="yl-banner-icon"><Check /></span>
        <p>{look.checked} pairs checked · {passed} pass as found{look.fixes.length ? ` · ${look.fixes.length} fixed for you` : ''}. Every pair now meets 4.5 : 1.{look.byAi ? ' Roles suggested by AI, checked by rules.' : ''}</p></section>
      <div className="yl-two yl-check">
        <section className="yl-card" aria-labelledby="yl-roles">
          <p className="yl-label yl-fig" id="yl-roles">Colour roles</p>
          <ul className="yl-roles">
            {COLOR_ROLES.map(({ key, label }) => (
              <li key={key}><span className="yl-sw" style={{ background: c[key] }} /><span><strong>{label}</strong><small>{look.why[key] || ''}</small></span><code>{c[key]}</code></li>
            ))}
          </ul>
        </section>
        <section className="yl-card" aria-labelledby="yl-pairs">
          <div className="yl-pairs-head"><p className="yl-label yl-fig" id="yl-pairs">Contrast check · WCAG AA</p><p className="yl-muted small">Body text needs 4.5 : 1</p></div>
          <ul className="yl-pairs">
            {look.pairs.map((p) => {
              const f = fixes.get(p.id);
              return (
                <li key={p.id}>
                  <span className="yl-aa-pair">
                    {f && <><span className="yl-aa" style={{ color: f.before.fg, background: f.before.bg }}>Aa</span><span aria-hidden="true">→</span></>}
                    <span className="yl-aa" style={{ color: p.fg, background: p.bg }}>Aa</span>
                  </span>
                  <span className="yl-pair-text"><strong>{p.label}</strong>
                    <small>{f ? `${f.before.fg} on ${f.before.bg} was ${f.before.ratio} : 1. ${f.note} Now ${p.fg} on ${p.bg} (${p.ratio} : 1).` : `${p.fg} on ${p.bg} · ${p.ratio} : 1`}</small></span>
                  <span className={'yl-pill ' + (f ? 'yl-pill-warn' : 'yl-pill-ok')}>{f ? 'Fixed' : 'Pass'}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <div className="yl-row yl-foot">
        <button type="button" className="yl-btn ghost" onClick={() => nav(`${BASE}/paste`)}>Back</button>
        <button type="button" className="yl-btn primary" onClick={() => nav(`${BASE}/look/${look.id}/adjust`)}>Looks Right · Adjust and Preview</button>
        <p className="yl-muted">Nothing is saved yet. Your website is never changed.</p>
      </div>
    </div>
  );
}

/* The Adjust screen (880:1408) */
function Adjust({ st, look, setLook }: { st: State; look: Look; setLook: (l: Look) => void }) {
  const nav = useNavigate();
  const store = st.store?.name || st.company;
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [scope, setScope] = useState<'store' | 'group'>('store');
  const spec = look.spec;
  const t = useMemo(() => themeFromSpec(look.id, spec), [look.id, spec]);
  const homeRef = useRef<HTMLIFrameElement>(null);
  // every change goes to the server (checked there), then to the Home preview (the real app, in this look)
  const save = async (body: Record<string, unknown>) => {
    setErr(''); setNote('');
    try {
      const l = await api<Look>(`/api/your-look/looks/${look.id}`, { method: 'PATCH', body });
      registerLook(l.id, l.spec, { quiet: true });
      setLook(l);
      homeRef.current?.contentWindow?.postMessage({ type: 'mise-look-preview', id: l.id, spec: l.spec }, location.origin);
      if (l.justFixed?.length) setNote(l.justFixed.map((f) => `${f.label}: ${f.before.fg} was ${f.before.ratio} : 1, so it’s ${f.after.fg} now (${f.after.ratio} : 1).`).join(' '));
    } catch (e) { setErr((e as Error).message); }
  };
  const upload = async (kind: 'logo' | 'photo' | 'icon', file: File, variant?: 'dark' | 'light') => {
    setBusy(kind); setErr('');
    try {
      const res = await fetch(`/api/your-look/looks/${look.id}/${kind}${variant ? `?variant=${variant}` : ''}`, { method: 'POST', body: file, credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-BT': '1' } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, d.error || 'That didn’t upload. Try again.');
      registerLook(d.id, d.spec, { quiet: true }); setLook(d);
      homeRef.current?.contentWindow?.postMessage({ type: 'mise-look-preview', id: d.id, spec: d.spec }, location.origin);
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  const apply = async () => {
    setBusy('apply'); setErr('');
    try {
      if (scope === 'group') await uploadCard(look.id, t, spec).catch(() => {}); // the card people get is the one shown here
      await api(`/api/your-look/looks/${look.id}/apply`, { method: 'POST', body: { scope } });
      location.assign(`${BASE}/look/${look.id}/applied`); // a full load: the app wears the new look from here on
    } catch (e) { setErr((e as Error).message); setBusy(''); }
  };
  const draft = async () => { setBusy('draft'); await save({ name: spec.name }); setBusy(''); setNote('Saved as a draft. Nothing changed for your team.'); };
  const logos = look.options.logos;
  return (
    <div className="yl-page">
      <Head crumbs={['Settings', 'Your Look', store]} title="Make it yours" sub="Change anything on the left; the three previews update as you go. Nothing goes live until you press Apply." step={3} done={3} />
      <div className="yl-adjust">
        <section className="yl-card yl-controls" aria-label="Adjust the look">
          <p className="yl-label yl-fig">Logo</p>
          <div className="yl-logo-pick">
            {(['dark', 'light'] as const).map((v) => {
              const cur = spec.logo[v];
              return (
                <div key={v} className="yl-logo-col">
                  <div className={'yl-logo-tile ' + (v === 'dark' ? 'on-dark' : 'on-light')} style={{ background: v === 'dark' ? spec.colors.panel : spec.colors.card }}>{cur ? <Art l={cur} h={52} /> : <span className="yl-muted small">None yet</span>}</div>
                  <p className="yl-logo-cap">{cur && <span className="yl-tick-ink"><Check /></span>}{v === 'dark' ? 'On dark' : 'On light'}</p>
                  <label className="sr-only" htmlFor={`yl-logo-${v}`}>Logo {v === 'dark' ? 'on dark' : 'on light'}</label>
                  <select id={`yl-logo-${v}`} className="yl-select small" value={cur?.src || ''} onChange={(e) => void save({ logo: { [v]: e.target.value || null } })}>
                    <option value="">No logo</option>
                    {logos.map((l, i) => <option key={l.src} value={l.src}>{`Logo ${i + 1} · ${l.variant === 'dark' ? 'white' : 'colour'}${l.from === 'upload' ? ' (uploaded)' : ''}`}</option>)}
                  </select>
                  <label className="yl-link small">{busy === 'logo' ? 'Uploading…' : 'Upload'}<input type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload('logo', f, v); e.target.value = ''; }} /></label>
                </div>
              );
            })}
          </div>
          <p className="yl-muted small">Your files, used as they are: never recoloured, cropped or redrawn. {spec.icon ? 'The tab icon is your site’s own icon.' : 'No site icon found: the tab shows the Mise icon until you add one.'}</p>
          {!spec.logo.dark && spec.logo.light && <p className="yl-warn small">No version of your logo for dark backgrounds: the sidebar shows it on a light plate. Upload a white version if you have one.</p>}

          <p className="yl-label yl-fig">Colours</p>
          <ul className="yl-color-list">
            {COLOR_ROLES.filter((r) => r.key !== 'line').map(({ key, label }) => <ColorRow key={key} label={label} value={spec.colors[key]} onChange={(v) => void save({ colors: { [key]: v } })} />)}
          </ul>
          {note && <p className="yl-note small" role="status">{note}</p>}

          <p className="yl-label yl-fig">Fonts</p>
          <FontPick label="Headings" value={spec.fonts.heading} onChange={(v) => void save({ fonts: { heading: v } })}
            hint={spec.fonts.standIn?.heading ? `Free stand-in for ${spec.fonts.standIn.heading}, a paid font on your site. Have the licence? Ask us and we’ll use the real one.` : undefined} />
          <FontPick label="Accent line" value={spec.fonts.accent} onChange={(v) => void save({ fonts: { accent: v } })}
            hint={spec.fonts.standIn?.accent ? `Same stand-in for ${spec.fonts.standIn.accent}’s lighter lines.` : undefined} />
          <FontPick label="Body and labels" value={spec.fonts.body} onChange={(v) => void save({ fonts: { body: v } })}
            hint={spec.fonts.standIn?.body ? `For ${spec.fonts.standIn.body} on your site (a system font, so it isn’t on every phone).` : look.fonts?.systemBody ? `From your site. (${look.fonts.systemBody}, your body font, is a system font, so ${spec.fonts.body} reads the same on every phone.)` : undefined} />

          <p className="yl-label yl-fig">Photo for sign-in and the link card</p>
          <div className="yl-photo-pick" role="radiogroup" aria-label="Photo">
            {look.options.photos.map((p, i) => (
              <button key={p.src} type="button" role="radio" aria-checked={spec.photo === p.src} aria-label={`Photo ${i + 1}`} className={spec.photo === p.src ? 'is-on' : ''} onClick={() => void save({ photo: p.src })}><img src={p.src} alt="" /></button>
            ))}
            <label className="yl-photo-add">{busy === 'photo' ? '…' : '+'}<span className="sr-only">Upload a photo</span><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload('photo', f); e.target.value = ''; }} /></label>
          </div>

          {st.canGroup && (
            <div className="yl-use" role="radiogroup" aria-label="Use it for">
              <span className="yl-label">Use it for</span>
              <span className="yl-seg">
                <button type="button" role="radio" aria-checked={scope === 'store'} className={scope === 'store' ? 'is-on' : ''} onClick={() => setScope('store')}>{store} only</button>
                <button type="button" role="radio" aria-checked={scope === 'group'} className={scope === 'group' ? 'is-on' : ''} onClick={() => setScope('group')}>Every store</button>
              </span>
            </div>
          )}
          {err && <p className="yl-error" role="alert">{err}</p>}
          <div className="yl-row yl-apply">
            <button type="button" className="yl-btn ghost" disabled={!!busy} onClick={() => void draft()}>Save as Draft</button>
            <button type="button" className="yl-btn primary" disabled={!!busy} onClick={() => void apply()}>{busy === 'apply' ? 'Applying…' : scope === 'group' ? 'Apply to Every Store' : `Apply to ${store}`}</button>
          </div>
          <button type="button" className="yl-link small" onClick={() => nav(`${BASE}/look/${look.id}/check`)}>See the contrast check</button>
        </section>
        <section className="yl-previews" aria-label="Live preview">
          <div className="yl-previews-head"><p className="yl-label yl-fig">Live preview</p><p className="yl-muted small">Updates as you change things</p></div>
          <h3>Home · {store}</h3>
          <HomePreview id={look.id} frameRef={homeRef} />
          <h3>Sign-in · after the join code</h3>
          <SignInPreview t={t} spec={spec} />
          <h3>Link card · what a texted link shows</h3>
          <CardPreview t={t} spec={spec} />
          <p className="yl-card-meta"><strong>{spec.name} · The Training App</strong><br /><span className="yl-muted">The menu, the bar, wine and service, all in one place. Training on Mise Academy.</span><br /><code>{st.link ? `${location.host.replace(/^www\./, '')}${st.link}` : location.host.replace(/^www\./, '')}</code></p>
        </section>
      </div>
    </div>
  );
}
function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const id = 'yl-c-' + label.replace(/\W+/g, '-').toLowerCase();
  const commit = (x: string) => { const h = x.trim().toUpperCase(); if (/^#[0-9A-F]{6}$/.test(h) && h !== value) onChange(h); else setV(value); };
  return (
    <li>
      <label className="yl-sw yl-sw-pick" style={{ background: v }}><input type="color" value={v.toLowerCase()} onChange={(e) => setV(e.target.value.toUpperCase())} onBlur={(e) => commit(e.target.value)} aria-label={`${label} colour`} /></label>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="yl-hex" value={v} maxLength={7} spellCheck={false} onChange={(e) => setV(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
    </li>
  );
}
function FontPick({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const id = 'yl-f-' + label.replace(/\W+/g, '-').toLowerCase();
  const list = FACES.includes(value) ? FACES : [value, ...FACES];
  return (
    <div className="yl-font">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="yl-select" value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: fontCss(value) }}>
        {list.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      {hint && <p className="yl-muted small">{hint}</p>}
    </div>
  );
}

/* ── The previews ─────────────────────────────────────────────────────────────────────────────────────────────────── */
/** Scales a fixed-size drawing (W × H) to the width it's given. */
function Scaled({ w, h, children, className }: { w: number; h: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.4);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / w));
    ro.observe(el); setK(el.clientWidth / w);
    return () => ro.disconnect();
  }, [w]);
  return <div ref={ref} className={'yl-scaled ' + (className || '')} style={{ height: h * k }}><div style={{ width: w, height: h, transform: `scale(${k})`, transformOrigin: '0 0' }}>{children}</div></div>;
}
/** Home, as the team will see it: the real app in an iframe, in this look (?look-preview), not clickable. */
function HomePreview({ id, frameRef, h = 900 }: { id: string; frameRef?: React.RefObject<HTMLIFrameElement | null>; h?: number }) {
  return (
    <Scaled w={1440} h={h} className="yl-frame">
      <iframe ref={frameRef} src={`/?look-preview=${id}`} title={`Home in this look`} tabIndex={-1} aria-hidden="true" style={{ width: 1440, height: h, border: 0, pointerEvents: 'none' }} />
    </Scaled>
  );
}
function SignInPreview({ t, spec }: { t: Theme; spec: LookSpec }) {
  const head = t.type.pageTitle;
  const hf = { fontFamily: fontCss(head.ff), fontWeight: 700, textTransform: head.case === 'upper' ? 'uppercase' : undefined, letterSpacing: head.ls ? `${parseFloat(head.ls) / 100}em` : undefined } as CSSProperties;
  const L = spec.logo.dark || spec.logo.light;
  return (
    <Scaled w={1200} h={720} className="yl-frame">
      <div className="yl-si" style={{ background: color(t, 'page'), fontFamily: fontCss(t.type.body.ff) }}>
        <div className="yl-si-photo" style={{ background: color(t, 'inverse') }}>
          {spec.photo ? <img src={spec.photo} alt="" /> : <img src="/img/signin-bartender-1200.jpg" alt="" />}
          <div className="yl-si-shade" />
          {L && <div className="yl-si-logo" style={!spec.logo.dark ? { background: spec.colors.card, padding: 8, borderRadius: 8 } : undefined}><Art l={L} h={84} /></div>}
          <p className="yl-si-script" style={{ fontFamily: fontCss(t.type.accent.ff), color: color(t, 'accentOnDark') }}>know the menu</p>
          <p className="yl-si-punch" style={{ ...hf, color: '#FFFFFF' }}>{brandTitle('Cold.', t)}</p>
        </div>
        <div className="yl-si-side">
          <div className="yl-si-card" style={{ background: color(t, 'card'), borderColor: color(t, 'line', 1) }}>
            <p className="yl-si-kicker" style={{ color: color(t, 'inkMuted') }}>STAFF</p>
            <p className="yl-si-title" style={{ ...hf, color: color(t, 'ink') }}>{brandTitle('Sign In', t)}</p>
            <p style={{ color: color(t, 'inkMuted') }}>Ask a manager for your restaurant’s join code.</p>
            <p className="yl-si-kicker" style={{ color: color(t, 'inkMuted') }}>JOIN CODE</p>
            <div className="yl-si-input" style={{ borderColor: color(t, 'edgeMuted'), color: color(t, 'inkMuted'), background: '#fff' }}>8 letters and numbers</div>
            <div className="yl-si-btn" style={{ background: color(t, 'button'), color: color(t, 'onButton') }}>Continue</div>
            <p style={{ color: color(t, 'inkMuted') }}>Owner or manager? <u style={{ color: color(t, 'accentText') }}>Sign in with your email.</u></p>
          </div>
          <p className="yl-si-foot" style={{ color: color(t, 'inkMuted') }}>Training on Mise Academy</p>
        </div>
      </div>
    </Scaled>
  );
}
function CardPreview({ t, spec }: { t: Theme; spec: LookSpec }) {
  return <Scaled w={1200} h={630} className="yl-frame"><CardArt t={t} spec={spec} /></Scaled>;
}
/** The link card, 1200 × 630: the same drawing the canvas makes for the real card (uploadCard). */
function CardArt({ t, spec }: { t: Theme; spec: LookSpec }) {
  const head = t.type.pageTitle;
  const L = spec.logo.dark || spec.logo.light;
  return (
    <div className="yl-lc" style={{ background: color(t, 'inverse'), fontFamily: fontCss(t.type.body.ff) }}>
      {spec.photo && <img className="yl-lc-photo" src={spec.photo} alt="" />}
      <div className="yl-lc-fade" style={{ background: `linear-gradient(90deg, ${color(t, 'inverse')} 0%, ${color(t, 'inverse')} 42%, transparent 75%)` }} />
      <div className="yl-lc-copy">
        {L && <div style={!spec.logo.dark ? { background: spec.colors.card, padding: 8, borderRadius: 8, display: 'inline-block' } : undefined}><Art l={L} h={96} /></div>}
        <p className="yl-lc-script" style={{ fontFamily: fontCss(t.type.accent.ff), color: color(t, 'accentOnDark') }}>the training app</p>
        <p className="yl-lc-head" style={{ fontFamily: fontCss(head.ff), color: color(t, 'onInverse'), textTransform: head.case === 'upper' ? 'uppercase' : undefined, letterSpacing: head.ls ? `${parseFloat(head.ls) / 100}em` : undefined }}>{brandTitle('Know the menu cold.', t)}</p>
        <p className="yl-lc-line" style={{ color: color(t, 'onInverseMuted') }}>The menu, the bar, wine and service, all in one place.</p>
        <p className="yl-lc-mise" style={{ color: color(t, 'accentOnDark') }}>TRAINING ON <img src="/img/mise-brand/mise-dark.svg" alt="Mise" /></p>
      </div>
    </div>
  );
}
/** Draws the link card on a canvas in the look's own fonts and sends it, so the card people get is the one shown. */
async function uploadCard(id: string, t: Theme, spec: LookSpec) {
  const W = 1200, H = 630;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const img = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const head = t.type.pageTitle;
  await Promise.all([`700 64px ${fontCss(head.ff)}`, `400 40px ${fontCss(t.type.accent.ff)}`, `400 22px ${fontCss(t.type.body.ff)}`].map((f) => document.fonts.load(f).catch(() => {})));
  g.fillStyle = color(t, 'inverse'); g.fillRect(0, 0, W, H);
  if (spec.photo) {
    const p = await img(spec.photo);
    const k = Math.max(720 / p.width, H / p.height), w = p.width * k, h = p.height * k;
    g.drawImage(p, W - 720 + (720 - w) / 2, (H - h) / 2, w, h);
    const gr = g.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, color(t, 'inverse')); gr.addColorStop(0.42, color(t, 'inverse')); gr.addColorStop(0.75, color(t, 'inverse') + '00');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  let y = 84;
  const L = spec.logo.dark || spec.logo.light;
  if (L) {
    const i = await img(L.src);
    const [x0, y0, w0, h0] = L.crop; const k = Math.min(360 / w0, 96 / h0);
    if (!spec.logo.dark) { g.fillStyle = spec.colors.card; g.fillRect(72, y - 8, w0 * k + 16, h0 * k + 16); }
    g.drawImage(i, x0, y0, w0, h0, 80, y, w0 * k, h0 * k);
    y += h0 * k + 70;
  }
  g.fillStyle = color(t, 'accentOnDark'); g.font = `400 40px ${fontCss(t.type.accent.ff)}`; g.fillText('the training app', 80, y); y += 70;
  g.fillStyle = color(t, 'onInverse'); g.font = `700 64px ${fontCss(head.ff)}`;
  const words = brandTitle('Know the menu cold.', t);
  const lines = head.case === 'upper' ? ['KNOW THE', 'MENU COLD.'] : ['Know the', 'menu cold.'];
  if (g.measureText(words).width < 560) { g.fillText(words, 80, y); y += 72; } else for (const l of lines) { g.fillText(l, 80, y); y += 70; }
  g.fillStyle = color(t, 'onInverseMuted', 0); g.font = `400 22px ${fontCss(t.type.body.ff)}`; g.fillText('The menu, the bar, wine and service, all in one place.', 80, y + 10);
  g.fillStyle = color(t, 'accentOnDark'); g.font = `600 16px ${fontCss(t.type.body.ff)}`; g.fillText('TRAINING ON MISE ACADEMY', 80, H - 64);
  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/jpeg', 0.9));
  if (!blob) return;
  await fetch(`/api/your-look/looks/${id}/card`, { method: 'POST', body: blob, credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg', 'X-BT': '1' } });
}

/* 6 · Applied, with Undo (881:1424) */
function Applied({ st, look }: { st: State; look: Look }) {
  const nav = useNavigate();
  const store = st.store?.name || st.company;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const others = st.stores.filter((s) => s.id !== st.store?.id && s.look !== look.id && s.kind !== 'mise').map((s) => s.name);
  const group = st.lastChange?.scope === 'group' && st.lastChange.look === look.id;
  const before = st.lastChange?.look === look.id ? st.lastChange.before : null;
  const beforeId = (st.lastChange?.look === look.id && st.lastChange.beforeLook) || 'mise';
  const undo = async () => { setBusy(true); try { await api('/api/your-look/undo', { method: 'POST' }); location.assign(BASE); } catch (e) { setErr((e as Error).message); setBusy(false); } };
  const title = group ? `Every store has ${poss(look.name)} look` : `${store} has its own look`;
  return (
    <div className="yl-page">
      <Head crumbs={['Settings', 'Your Look', store]} title={title} step={4} done={5} />
      {st.lastChange?.look === look.id
        ? <section className="yl-banner" role="status"><span className="yl-banner-icon"><Check /></span><p>Applied just now. {group ? 'Every store’s team sees it' : `${poss(store)} team sees it`} the next time they open the app.{!group && others.length ? ` ${others.join(' and ')} keep${others.length === 1 ? 's' : ''} ${others.length === 1 ? 'its' : 'their'} own look${others.length === 1 ? '' : 's'}.` : ''}</p></section>
        : <section className="yl-banner" role="status"><p>{look.inUse ? 'This look is on.' : 'This look is saved, not on right now.'}</p></section>}
      <div className="yl-two">
        <figure className="yl-ba"><figcaption><strong>Before</strong> <span className="yl-muted">{before || 'Mise Academy'} look{before === 'Mise Academy' || !before ? ' (Foundation default)' : ''}</span></figcaption><HomePreview id={beforeId} h={600} /></figure>
        <figure className="yl-ba"><figcaption><strong>After</strong> <span className="yl-muted">{poss(look.name)} look</span></figcaption><HomePreview id={look.id} h={600} /></figure>
      </div>
      <div className="yl-two">
        <section className="yl-card"><p className="yl-label yl-fig">What changed</p>
          <ul className="yl-ticks light">{['Logo, colours and fonts on every page', 'Sign-in, after someone types the join code', 'Tab and home-screen icon, from your site icon', `The card a texted link shows${group ? ' (your account link)' : ' (when the look is on every store)'}`, 'Certificates: your logo on the band, Mise Academy in the fine print']
            .map((x) => <li key={x}><span className="yl-tick"><Check /></span>{x}</li>)}</ul></section>
        <section className="yl-card"><p className="yl-label yl-fig">What didn’t</p>
          <ul className="yl-dots">{['Your menus, specs and wine list', 'Training paths, quizzes and scores', 'People, sign-offs and Team Chat', 'Every feature: Custom Brand changes the paint only'].map((x) => <li key={x}>{x}</li>)}</ul></section>
      </div>
      {err && <p className="yl-error" role="alert">{err}</p>}
      <div className="yl-row yl-foot">
        {st.stores.length > 1 && st.canGroup ? <button type="button" className="yl-btn ink" onClick={() => nav(BASE)}>Set Up Another Store</button> : <button type="button" className="yl-btn ink" onClick={() => nav(BASE)}>Done</button>}
        <button type="button" className="yl-btn ghost" onClick={() => nav(`${BASE}/look/${look.id}/adjust`)}>Edit Look</button>
        {st.lastChange?.look === look.id && <button type="button" className="yl-btn ghost" disabled={busy} onClick={() => void undo()}>Undo · Back to the {before || 'Mise'} Look</button>}
      </div>
      <p className="yl-muted">{st.lastChange?.look === look.id ? `Undo puts the ${before || 'Mise'} look back right away. ` : ''} {poss(look.name)} look stays saved, so you can switch it on again.</p>
    </div>
  );
}
