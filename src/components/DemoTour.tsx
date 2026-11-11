// The public demo's banner, welcome card and tour (Nov 7, Tommy: "the best tour style I've seen is this one", Growth's).
//   • The welcome card says what this is and who you are, with four things to try. It opens when the demo opens; the DEMO pill brings it back.
//   • The tour is one walk through the real pages, a step at a time. It replaces the Nov 6 tips that fired page by page.
//   • Nothing here is saved, on purpose: a refresh starts the demo over ("have all my demo restart after a refresh").
//     main.tsx swaps the data for a fresh copy; this file's state just goes away with the page.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { markDemoTab, demoKindOf, demoHome } from '../lib/demo';
import { useSession } from '../lib/session';

/** A stop on the walk. `path` is where it lives (a function when the address depends on the data); `manager` stops are for managers only. */
type Stop = { path: string | (() => string | null); match?: RegExp; target: string; title: string; body: string; manager?: boolean; staff?: boolean };

// The dish stops open whichever dish the Food Matrix lists first. Kept, so Back still gets there from a later page.
let dish: string | null = null;
const dishPath = () => { dish = document.querySelector('a[href^="/recipe/"]')?.getAttribute('href') ?? dish; return dish; };
const DISH = { path: dishPath, match: /^\/recipe\// };
const PILL = '[data-name="Demo pill"], .mobile-brand .demo-pill, .admin-demo';

const STOPS: Stop[] = [
  { path: '/', target: '#side, .menu-btn', title: 'The whole book', body: 'Food, the bar, service, safety, videos and your training all live in this menu.' },
  { path: '/', target: '.search', title: 'Search anything', body: 'Type a dish, a drink, a wine or an ingredient. Results show as you type.' },
  { path: '/', target: '[data-name="Section · Dashboard"]', title: 'Your shift at a glance', body: 'Tonight’s sections, your training progress and what’s new on the menu.' },
  { path: '/my-path', target: '.mp-stages', title: 'Your path', body: 'What your job learns, stage by stage, with a due date for each. Pass a quiz or read a page and it ticks here.', staff: true },
  { path: '/food-matrix', target: '[data-name="Filters"]', title: 'Every dish, one list', body: 'Filter by course or station. A guest has an allergy? Hide every dish that lists it.' },
  { ...DISH, target: '[data-name="Selling line"]', title: 'What to say at the table', body: 'Every dish has its own page, with the line to use with a guest, so everyone describes it the same way.' },
  { ...DISH, target: '[data-name="Pairings band"]', title: 'What to pair it with', body: 'The wine and cocktail to suggest. Each one opens its own page.' },
  { ...DISH, target: '.eip-edit', title: 'Edit right here', body: 'Managers change a dish from its own page. Everyone sees the update on Save.', manager: true },
  { path: '/the-bar/cocktail-specs', target: '[data-name^="Spec · "]', title: 'Specs for bartenders', body: 'One card per drink: the amounts, glass, ice, method and garnish. The spec quizzes test these builds.' },
  { path: '/the-bar/wine', target: '[data-name="Section · By the glass"]', title: 'The wine list', body: 'Every wine has its own page: tasting notes, what to pair and what to say.' },
  { path: '/quizzes', target: '.qb', title: 'Build a quiz', body: 'Pick any subjects and a length. New Questions never repeats until you’ve seen them all.' },
  // Nov 10 (audit: the demo never showed the programs): the training programs, and a certificate earned
  { path: '/cocktail-program', target: '[data-name="Your path"]', title: 'Training programs', body: 'Cocktail, Beer and Sommelier programs, each in levels with video lessons and practice cards.' },
  { path: '/cocktail-program/level-1', target: '[data-name="Hero"]', title: 'Every level ends in a final', body: 'Pass the final, and the practical where a level has one, and the level is yours.' },
  { path: '/certificate/bar-1', target: '.cert', title: 'A certificate to keep', body: 'You passed Level 1 of the Cocktail Program. Print it or save it as a PDF; your manager sees it too.', staff: true },
  { path: '/sommelier-program', target: '[data-name="Your path"]', title: 'The Sommelier lessons', body: 'Built on the Court of Master Sommeliers’ path, with videos and a practice exam at each level.' },
  { path: '/admin', target: '.admin-side nav', title: 'Everything you can change', body: 'The menu, cocktails, wine, back bar, photos, quiz results and your team.', manager: true },
  { path: '/admin/training', target: '.list', title: 'Everyone’s path', body: 'Each person’s job, how far along they are and what’s late. Open someone to sign off what you’ve watched them do.', manager: true },
  { path: '/admin/quizzes', target: '.person, .list-row', title: 'Everyone’s scores', body: 'Open a person to see their attempts, then sign them off.', manager: true },
];
// The last stop points at the DEMO pill, wherever the walk ended.
const last = (path: string): Stop => ({ path, target: PILL, title: 'That’s the tour', body: 'Click DEMO anytime for the welcome card or to take the tour again. Refresh and the demo starts over.' });
const FOR_STAFF = [...STOPS.filter((s) => !s.manager), last('/sommelier-program')];
const FOR_MANAGER = [...STOPS.filter((s) => !s.staff), last('/admin/quizzes')];

// The two pieces of state, held outside React because the book and the admin each mount their own copy of this.
let welcomeOpen = false, welcomed = false, step: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const openWelcome = () => { welcomed = true; welcomeOpen = true; step = null; emit(); };
const closeWelcome = () => { welcomeOpen = false; emit(); };
const setStep = (i: number | null) => { step = i; welcomeOpen = false; emit(); };
const useWelcome = () => useSyncExternalStore(subscribe, () => welcomeOpen);
const useStep = () => useSyncExternalStore(subscribe, () => step);

/** The first element on screen for a selector list, or null. */
function find(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** While the card is up the keyboard belongs to it: Tab cycles its buttons, Escape closes. */
function trapKeys(card: () => HTMLElement | null, close: () => void, more?: (e: KeyboardEvent) => void) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return; }
    more?.(e);
    if (e.key !== 'Tab') return;
    const f = [...(card()?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])];
    if (!f.length) return;
    e.preventDefault();
    const at = f.indexOf(document.activeElement as HTMLElement);
    f[at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus({ preventScroll: true });
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}

export function DemoBar() {
  const { user, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  if (!user?.demo) return null;
  const manager = user.role !== 'staff';
  const kind = demoKindOf(user); // Nov 11: The Baldwin's demo or the Mise demo (Wrenfield); switching role stays in the same one
  const swap = async () => {
    setBusy(true);
    try { await api('/api/demo/start', { method: 'POST', body: { role: manager ? 'employee' : 'manager', demo: kind } }); markDemoTab(); await refresh(); location.assign('/'); }
    catch { location.assign(demoHome(kind)); }
  };
  return (
    <div className="demo-bar" role="region" aria-label="Demo">
      <p><span className="demo-long">You’re in <strong>{user.store?.name || 'The Baldwin'}</strong>, a sample restaurant, as </span>{manager ? <><span className="demo-long">the </span><strong>Manager</strong></> : <><span className="demo-long">an </span><strong>Employee</strong></>}<span className="demo-short"> view</span><span className="demo-long">.</span></p>
      <div className="demo-bar-actions">
        <button type="button" className="main" onClick={() => void swap()} disabled={busy}>{busy ? 'Switching…' : <><span className="demo-long">{manager ? 'See It as an Employee' : 'See It as a Manager'}</span><span className="demo-short">{manager ? 'As Employee' : 'As Manager'}</span></>}</button>
        <button type="button" onClick={() => setStep(0)}><span className="demo-long">Show Me Around</span><span className="demo-short">Tour</span></button>
        <a href={demoHome(kind)}><span className="demo-long">Demo Home</span><span className="demo-short">Home</span></a>
      </div>
    </div>
  );
}

const CHEVRON = <svg className="dw-chev" width="8" height="12" viewBox="0 0 8 12" aria-hidden="true"><path d="M1.5 1.5 6 6l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const TRY_STAFF = [
  { title: 'Follow your path', body: 'What a server learns, week by week, and what’s next for you', to: '/my-path' },
  { title: 'Look up a dish', body: 'Allergens, what to say at the table and what to pair it with', to: '/food-matrix' },
  { title: 'Find a cocktail spec', body: 'Every build in one place, for bartenders', to: '/the-bar/cocktail-specs' },
  { title: 'Earn a certificate', body: 'Cocktail, Beer and Sommelier programs: video lessons, a final, a certificate', to: '/cocktail-program' },
];
const TRY_MANAGER = [
  { title: 'Change the menu', body: 'Add a dish or edit one, and everyone sees it on Save', to: '/admin/pages/recipe' },
  { title: 'Check quiz results', body: 'Everyone’s scores. Open a person, then sign them off', to: '/admin/quizzes' },
  { title: 'See your team’s training', body: 'Each person’s path, what’s late, and sign-offs', to: '/admin/training' },
  { title: 'See the training programs', body: 'Cocktail, Beer and Sommelier, each level with a final and a certificate', to: '/cocktail-program' },
];

function WelcomeCard({ manager, place }: { manager: boolean; place: string }) {
  const go = useNavigate();
  const open = useWelcome();
  const card = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    start.current?.focus({ preventScroll: true });
    document.body.classList.add('menu-lock');
    const off = trapKeys(() => card.current, closeWelcome);
    return () => { off(); document.body.classList.remove('menu-lock'); };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="dw-scrim" onClick={closeWelcome}>
      <div ref={card} className="dw" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <span className="dw-pill">Live Demo</span>
        <h2 id={titleId}>Welcome to Mise Academy</h2>
        <p className="dw-lede">One training book for the whole restaurant, on every phone: the menu, the bar, the wine list, the lessons and the quizzes.</p>
        <p className="dw-persona">{manager ? `You’re Rosalind Hart, the manager of ${place}` : `You’re Marisol Vega, a server at ${place}`}. {place === 'The Baldwin' ? 'It’s a sample restaurant: the dishes, house cocktails and people are made up.' : 'It’s a sample restaurant: the menu, drinks, wine list and people are all made up.'} Refresh anytime to start over.</p>
        <p className="dw-label">Try These</p>
        <ol className="dw-steps">
          {(manager ? TRY_MANAGER : TRY_STAFF).map((s, i) => (
            <li key={s.title}>
              <button type="button" className="dw-step" onClick={() => { closeWelcome(); go(s.to); }}>
                <span className="dw-num" aria-hidden="true">{i + 1}</span>
                <span className="dw-text"><strong>{s.title}</strong><span>{s.body}</span></span>
                {CHEVRON}
              </button>
            </li>
          ))}
        </ol>
        <div className="dw-foot">
          <span className="dw-credit">Designed and engineered by <a href="https://www.tommyclaffey.com" target="_blank" rel="noopener noreferrer">Tommy Claffey</a></span>
          <div className="dw-actions">
            <button type="button" className="tour-btn ghost" onClick={closeWelcome}>Explore on My Own</button>
            <button type="button" ref={start} className="tour-btn" onClick={() => setStep(0)}>Take the Tour</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Tour({ manager }: { manager: boolean }) {
  const i = useStep();
  const go = useNavigate();
  const { pathname } = useLocation();
  const stops = manager ? FOR_MANAGER : FOR_STAFF;
  const stop = i === null ? null : stops[i];
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const dir = useRef(1);
  const nextRef = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const end = useCallback(() => setStep(null), []);
  const move = useCallback((by: number) => {
    dir.current = by;
    const to = (i ?? 0) + by;
    if (to >= stops.length) setStep(null); else if (to >= 0) setStep(to);
  }, [i, stops.length]);

  // Get to the stop's page, then wait for its element. Anything that never shows (a phone hides it, a drink has no such line) is
  // skipped in the direction you were going.
  useLayoutEffect(() => {
    setEl(null); setRect(null);
    if (!stop) return;
    const onPage = stop.match ? stop.match.test(pathname) : pathname === stop.path;
    if (!onPage) {
      const to = typeof stop.path === 'function' ? stop.path() : stop.path;
      if (to) go(to); else move(dir.current);
      return;
    }
    const first = find(stop.target);
    if (first) { setEl(first); return; }
    let tries = 0;
    const timer = setInterval(() => {
      const found = find(stop.target);
      if (found) { clearInterval(timer); setEl(found); }
      else if (++tries > 60) { clearInterval(timer); move(dir.current); } // 3 seconds
    }, 50);
    return () => clearInterval(timer);
  }, [stop, pathname, go, move]);

  // Nov 6, Tommy: the box was "trying to find it … moving kind of in a sloppy way". The page, the box and the card land together in
  // one frame, before anything is painted. After that it only moves if the page itself does.
  useLayoutEffect(() => {
    if (!el || !stop) return;
    el.style.scrollMarginTop = '72px';
    const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
    el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
    setRect(el.getBoundingClientRect());
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (el.isConnected) setRect(el.getBoundingClientRect()); else setEl(find(stop.target)); });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement); ro.observe(el);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [el, stop]);

  const shown = !!stop && !!rect;
  useEffect(() => { if (shown) nextRef.current?.focus({ preventScroll: true }); }, [shown, i]);
  useEffect(() => {
    if (!shown) return;
    return trapKeys(() => card.current, end, (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    });
  }, [shown, end, move]);

  if (i === null || !stop) return null;
  // Between pages the screen stays dimmed, so it never flashes the page underneath.
  if (!rect) return createPortal(<div className="tour"><div className="tour-block" /><div className="tour-dim" /></div>, document.body);

  const vw = window.innerWidth, vh = window.innerHeight, pad = 8;
  const top = Math.max(rect.top - pad, 4);
  // A full-height rail (the sidebar): the box matches its exact edge instead of spilling onto the page beside it (Nov 7).
  const rail = rect.left <= 1 && rect.height >= vh - 2;
  const hl: CSSProperties & { top: number; left: number; width: number; height: number } = rail
    ? { top: 0, left: 0, width: rect.width, height: vh, borderRadius: 0 }
    : { top, left: Math.max(rect.left - pad, 4), width: Math.min(rect.width + pad * 2, vw - 8), height: Math.max(Math.min(rect.bottom + pad, vh - 4) - top, 0) };
  const narrow = vw < 640, cardW = 340;
  const below = vh - (hl.top + hl.height) > 260;
  const beside = !below && hl.top < 280; // a target that fills the screen: sit the card on top of it
  const style: CSSProperties = narrow ? {} : rail
    ? { top: 96, left: hl.width + 16, width: cardW } // beside the rail, so it doesn't cover what it's pointing at
    : {
      top: below ? hl.top + hl.height + 12 : beside ? vh - 24 : Math.max(12, hl.top - 12),
      left: Math.min(Math.max(12, hl.left), vw - cardW - 12),
      transform: below ? undefined : 'translateY(-100%)',
      width: cardW,
    };
  return createPortal(
    <div className="tour">
      <div className="tour-block" />
      <div className="tour-hl" style={hl} aria-hidden="true" />
      <div ref={card} className={'tour-card' + (narrow ? ' sheet' : '')} style={style} role="dialog" aria-modal="false" aria-labelledby={titleId}>
        <p className="tour-count">Step {i + 1} of {stops.length}</p>
        <h2 id={titleId}>{stop.title}</h2>
        <p className="tour-body">{stop.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {stops.map((_, n) => <span key={n} className={n === i ? 'on' : n < i ? 'done' : ''} />)}
        </div>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={end}>End Tour</button>
          <span>
            {i > 0 && <button type="button" className="tour-btn ghost" onClick={() => move(-1)}>Back</button>}
            <button type="button" ref={nextRef} className="tour-btn" onClick={() => move(1)}>{i < stops.length - 1 ? 'Next' : 'Finish'}</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DemoTour() {
  const { user } = useSession();
  const manager = !!user && user.role !== 'staff';
  useEffect(() => { if (!welcomed) openWelcome(); }, []);
  return <><WelcomeCard manager={manager} place={user?.store?.name || 'The Baldwin'} /><Tour manager={manager} /></>;
}
