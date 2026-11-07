// The public demo's banner and walkthrough (Nov 6, Tommy: "create the tour guides like you have the other apps"; same pattern as
// Clinically Ready). The banner says what you're looking at and switches between the employee and the manager. The walkthrough
// shows a few tips the first time you open each key page; "Show Me Around" replays them.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

type Tip = { target: string; title: string; body: string; manager?: boolean };
type Tour = { key: string; match: RegExp; tips: Tip[] };

const TOURS: Tour[] = [
  { key: 'home', match: /^\/$/, tips: [
    { target: '.menu-btn, #side', title: 'The whole book', body: 'Food, the bar, service, safety, videos and your training all live in this menu.' },
    { target: '.search', title: 'Search anything', body: 'Type a dish, a drink, a wine or an ingredient. Results show as you type.' },
    { target: '[data-name="Section · Dashboard"]', title: 'Your shift at a glance', body: 'Tonight’s sections, your training progress and what’s new on the menu.' },
    { target: '[data-name^="Hero · "]', title: 'Tonight’s focus', body: 'The dish to know before line-up, with the pairing to suggest and its spec sheet.' },
    { target: '.account-tools', title: 'Your admin', body: 'Managers change the menu, assign sections and check quiz results from here.', manager: true },
  ] },
  { key: 'matrix', match: /^\/food-matrix$/, tips: [
    { target: '[data-name="Filters"]', title: 'Filter the menu', body: 'By course or station. A guest has an allergy? Hide every dish that lists it.' },
    { target: '[data-name="Matrix table"]', title: 'Every dish, one list', body: 'Station, allergens and pairing at a glance. Open a dish for its full page.' },
    { target: '[data-name="Actions"]', title: 'Table, cards or print', body: 'Switch the view, or print the matrix for line-up.' },
  ] },
  { key: 'dish', match: /^\/recipe\//, tips: [
    { target: '[data-name="Header"]', title: 'A page for every dish', body: 'What’s in it and what to watch for, including allergens.' },
    { target: '[data-name="Selling line"]', title: 'What to say at the table', body: 'The line to use with a guest, so everyone describes the dish the same way.' },
    { target: '[data-name="Pairings band"]', title: 'What to pair it with', body: 'The wine and cocktail to suggest. Each one opens its own page.' },
    { target: '.eip-edit', title: 'Edit right here', body: 'Managers change a dish from its own page. Everyone sees the update on Save.', manager: true },
  ] },
  { key: 'bar', match: /^\/the-bar\/cocktails$/, tips: [
    { target: '[data-name="Bar tabs"]', title: 'The whole bar', body: 'Cocktails, wine, beer and spirits, each with its own section.' },
    { target: '[data-name="Our signatures"]', title: 'What’s on the menu', body: 'Swipe through the drinks. Each card shows what’s in it, the glass and what it pairs with.' },
    { target: '[data-name="Section · Classic cocktails"]', title: 'The classics', body: 'Every classic worth knowing, grouped by family. Open one for its story and riffs.' },
  ] },
  { key: 'drink', match: /^\/(signature|classic)\//, tips: [
    { target: '[data-name="Hero"]', title: 'A page for every drink', body: 'What it tastes like, the glass and the garnish.' },
    { target: '[data-name="The spec"]', title: 'For bartenders', body: 'Amounts and the build live in Cocktail Specs. This button opens this drink’s spec.' },
    { target: '[data-name="Say it"]', title: 'What to say at the table', body: 'One line to use with a guest.' },
  ] },
  { key: 'specs', match: /^\/the-bar\/cocktail-specs$/, tips: [
    { target: '[data-name="Toolbar"]', title: 'Find a spec fast', body: 'Search by drink, spirit or ingredient, or pick a list.' },
    { target: '[data-name^="Spec · "]', title: 'One card per drink', body: 'The amounts, glass, ice, method and garnish. The spec quizzes test these builds.' },
  ] },
  { key: 'wine', match: /^\/the-bar\/wine$/, tips: [
    { target: '[data-name="Section · By the glass"]', title: 'The list', body: 'Every wine has its own page: tasting notes, what to pair and what to say.' },
    { target: '[data-name="Section · Wine by style"]', title: 'Learn wine', body: 'Styles, countries, grapes and regions, for when a guest asks more.' },
  ] },
  { key: 'quizzes', match: /^\/quizzes$/, tips: [
    { target: '.rq', title: 'Your review queue', body: 'Mark how well you know each answer. Red and yellow come back here until they’re green.' },
    { target: '.qb', title: 'Build a quiz', body: 'Pick any subjects and a length. New Questions never repeats until you’ve seen them all.' },
    { target: '[data-name="Section · Sign-offs"]', title: 'Sign-offs', body: 'Pass a quiz here and a manager signs you off.' },
  ] },
  { key: 'somm', match: /^\/sommelier-program$/, tips: [
    { target: '[data-name="Your path"]', title: 'Four levels', body: 'The Court of Master Sommeliers’ path, from Introductory to Master.' },
    { target: '[data-name="Start here · videos"]', title: 'Video first', body: 'Short videos to start, then lessons with practice cards for each subject.' },
  ] },
  { key: 'admin', match: /^\/admin$/, tips: [
    { target: '.admin-side nav', title: 'Everything you can change', body: 'The menu, cocktails, wine, back bar, photos, quiz results and your team.' },
    { target: '.tiles', title: 'Where things stand', body: 'A quick count of what’s in the book.' },
  ] },
  { key: 'admin-list', match: /^\/admin\/pages\/[^/]+$/, tips: [
    { target: '.editor-head .btn', title: 'Add something new', body: 'Fill in one form and it shows up on every list and page it belongs on.' },
    { target: '.cms-row', title: 'Open any item', body: 'Edit it, or use the arrows to change the order on the menu.' },
  ] },
  { key: 'admin-edit', match: /^\/admin\/pages\/[^/]+\/\d+$/, tips: [
    { target: '.photo-field', title: 'Frame the photo', body: 'Adjust Photo lets you choose what stays in frame on every screen.' },
    { target: '.editor-foot, .editor-head .btn', title: 'Save when ready', body: 'Nothing changes for your team until you save.' },
  ] },
  { key: 'admin-quizzes', match: /^\/admin\/quizzes$/, tips: [
    { target: '.person, .list-row', title: 'Everyone’s scores', body: 'Open a person to see their attempts, then sign them off.' },
  ] },
];
// "Show Me Around" on a page with no tour of its own.
const ANYWHERE: Tour = { key: 'any', match: /./, tips: [
  { target: '.menu-btn, #side', title: 'The whole book', body: 'Everything is in this menu.' },
  { target: '.search', title: 'Search anything', body: 'Type a dish, a drink, a wine or an ingredient.' },
] };

const seenKey = (userId: number, key: string) => `bt-tour:${userId}:${key}`;
const RESTART = 'bt-tour-restart';

/** The first element on screen for a selector list, or null. */
function find(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

export function DemoBar() {
  const { user, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  if (!user?.demo) return null;
  const manager = user.role !== 'staff';
  const swap = async () => {
    setBusy(true);
    try { await api('/api/demo/start', { method: 'POST', body: { role: manager ? 'employee' : 'manager' } }); await refresh(); location.assign('/'); }
    catch { location.assign('/demo'); }
  };
  return (
    <div className="demo-bar" role="region" aria-label="Demo">
      <p>You’re in <strong>The Baldwin</strong>, a sample restaurant, as {manager ? <>the <strong>manager</strong></> : <>an <strong>employee</strong></>}.</p>
      <div className="demo-bar-actions">
        <button type="button" className="main" onClick={() => void swap()} disabled={busy}>{busy ? 'Switching…' : manager ? 'See It as an Employee' : 'See It as a Manager'}</button>
        <button type="button" onClick={() => window.dispatchEvent(new Event(RESTART))}>Show Me Around</button>
      </div>
    </div>
  );
}

export function DemoTour() {
  const { user } = useSession();
  const { pathname, search } = useLocation();
  const manager = !!user && user.role !== 'staff';
  const quizOpen = /[?&]quiz=/.test(search); // never over a quiz in progress
  const tour = quizOpen ? null : TOURS.find((t) => t.match.test(pathname)) ?? null;
  const [tips, setTips] = useState<Tip[]>([]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // `waiting`: the page may still be loading, so hold off until every tip has something to point at.
  const open = useCallback((t: Tour, waiting = false) => {
    const mine = t.tips.filter((tip) => !tip.manager || manager);
    const found = mine.filter((tip) => find(tip.target));
    if (!found.length || (waiting && found.length < mine.length)) return false;
    setTips(found); setI(0);
    return true;
  }, [manager]);
  const close = useCallback(() => {
    if (tour && user) localStorage.setItem(seenKey(user.id, tour.key), '1');
    setTips([]); setRect(null);
  }, [tour, user]);

  // First visit to a page with a tour: wait for the page to arrive, then start.
  useEffect(() => {
    setTips([]); setRect(null);
    if (!tour || !user || localStorage.getItem(seenKey(user.id, tour.key))) return;
    let tries = 0;
    // Some tips may never match (a phone hides the admin button, a drink has no line to say): after 4 seconds, use what's there.
    const timer = setInterval(() => { tries++; if (open(tour, tries < 8) || tries >= 8) clearInterval(timer); }, 500);
    return () => clearInterval(timer);
  }, [tour, user, open]);

  useEffect(() => {
    const restart = () => { window.scrollTo({ top: 0 }); setTimeout(() => open(tour ?? ANYWHERE), 200); };
    window.addEventListener(RESTART, restart);
    return () => window.removeEventListener(RESTART, restart);
  }, [tour, open]);

  const tip = tips[i];
  // Keep the highlight on its target as the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!tip) return;
    const el = find(tip.target);
    if (!el) return;
    el.style.scrollMarginTop = '72px';
    const r0 = el.getBoundingClientRect();
    // A target far down a long page jumps there; a smooth scroll would take seconds.
    el.scrollIntoView({ block: r0.height > window.innerHeight * 0.6 ? 'start' : 'center', behavior: Math.abs(r0.top) > window.innerHeight * 2 ? 'auto' : 'smooth' });
    let frame = 0;
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setRect(el.getBoundingClientRect())); };
    measure();
    const settle = setInterval(measure, 120);
    const stop = setTimeout(() => clearInterval(settle), 900);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); clearInterval(settle); clearTimeout(stop); window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [tip]);
  useEffect(() => { if (tip) nextRef.current?.focus({ preventScroll: true }); }, [tip]);

  if (!tip || !rect) return null;
  const vw = window.innerWidth, vh = window.innerHeight, pad = 8;
  const top = Math.max(rect.top - pad, 4);
  const hl = { top, left: Math.max(rect.left - pad, 4), width: Math.min(rect.width + pad * 2, vw - 8), height: Math.max(Math.min(rect.bottom + pad, vh - 4) - top, 0) };
  const narrow = vw < 640, cardW = 340;
  const below = vh - (hl.top + hl.height) > 220;
  const beside = !below && hl.top < 240; // a target that fills the screen: sit the card on top of it
  const style: CSSProperties = narrow ? {} : {
    top: below ? hl.top + hl.height + 12 : beside ? vh - 24 : Math.max(12, hl.top - 12),
    left: Math.min(Math.max(12, hl.left), vw - cardW - 12),
    transform: below ? undefined : 'translateY(-100%)',
    width: cardW,
  };
  return createPortal(
    <div className="tour" onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <div className="tour-hl" style={hl} aria-hidden="true" />
      <div className={'tour-card' + (narrow ? ' sheet' : '')} style={style} role="dialog" aria-modal="false" aria-labelledby={titleId}>
        <p className="tour-count">{i + 1} of {tips.length}</p>
        <h2 id={titleId}>{tip.title}</h2>
        <p className="tour-body">{tip.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={close}>Skip Tour</button>
          <span>
            {i > 0 && <button type="button" className="tour-btn ghost" onClick={() => setI(i - 1)}>Back</button>}
            <button type="button" ref={nextRef} className="tour-btn" onClick={() => (i < tips.length - 1 ? setI(i + 1) : close())}>{i < tips.length - 1 ? 'Next' : 'Got It'}</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
