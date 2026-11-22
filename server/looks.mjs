// Plans and looks (Nov 16, Tommy: "the baldwin is supposed to [be] an account under the app. custom brand is an upgraded
// tier"). Mise Academy is the product; its look is every company's look. A restaurant's own look (logo, colours, type) is
// part of the Custom Brand plan, set per company by a super admin (Super Admin → Companies).
//
//   companies.plan   'foundation' (every company, the default) · 'custom-brand' (the upgrade)
//   companies.brand  the look the company picked: 'mise', or a custom look made for it
//
// A custom look is drawn in code today (src/lib/theme.ts fills every colour and type role per look). The Baldwin's files
// (logo, app icons) live in the account's folder on the volume (server/account.mjs); Testa Barra's and J.Baldwin's are
// public brand files in public/img/looks and public/icons. Adding a look is data, not new code paths: an entry in LOOKS
// below (who it's made for, its logo for the certificate band), its theme object in src/lib/theme.ts (THEMES), and its
// files. Building arbitrary looks from settings (any colours, any logo) is a later step.
//
// Looks per store (Nov 17, Tommy: "can we start building out the branding for testa barra and j. baldwins?" · "yes can
// start building"; Figma 09 · Proposals → 33, 732:1085). A company's stores can each wear their own look:
//   stores.look  NULL = the company's look (every store until a super admin sets one) · or a look made for the company
// Only on the Custom Brand plan; on Foundation every store is drawn in Mise, whatever it says. Set by super admins only
// (Super Admin → Companies, each store's Look) until owners get their own control (Tommy, Nov 17: "We need to figure out
// how we do this internally from the app but we can do that after").

/** Every look the app can draw. `madeFor`: the companies (by id) a custom look belongs to. A demo copy of an account's
 *  book (companies.demo = 1) wears the look its demo was made with (server/demo.mjs), so it isn't listed here. */
export const LOOKS = {
  mise: { id: 'mise', name: 'Mise Academy', custom: false },
  baldwin: { id: 'baldwin', name: 'The Baldwin', custom: true, madeFor: [1] },
  // Nov 17: Baldwin Restaurant Group's other two restaurants (Figma 09 · Proposals → 33: 736:1085, 737:1085)
  testabarra: { id: 'testabarra', name: 'Testa Barra', custom: true, madeFor: [1] },
  jbaldwins: { id: 'jbaldwins', name: 'J.Baldwin’s', custom: true, madeFor: [1] },
};
export const DEFAULT_LOOK = 'mise';

// Looks as data (Nov 22, "Your Look from your website", server/yourlook.mjs): a look made from a restaurant's website is a
// `looks` row, worn as 'look-<id>'. LOOKS above stays the hand-built ones; `lookInfo` answers for both. The data looks are
// read through a function set at startup (server/yourlook.mjs migrateLooks), so this file needs no database.
let dataLooks = () => null;
export const setDataLooks = (fn) => { dataLooks = fn; };
export const isDataLook = (id) => /^look-\d{1,9}$/.test(String(id || ''));
/** A look by id: a hand-built one, or a data look ({ id, name, custom, data, madeFor: [company id], demo }), or null. */
export const lookInfo = (id) => LOOKS[id] || (isDataLook(id) ? dataLooks(id) : null);
export const PLANS = {
  foundation: { id: 'foundation', name: 'Foundation', customLook: false },
  'custom-brand': { id: 'custom-brand', name: 'Custom Brand', customLook: true },
};
export const DEFAULT_PLAN = 'foundation';

/** Added by a column check, like companies.brand (server/db.mjs), so it can't collide with a numbered migration on another
 *  branch. When the column first appears, every company already wearing a custom look gets the plan that includes it, so
 *  nobody's look changes: on the live database that's Baldwin Restaurant Group (company 1) and The Baldwin's demo copies. */
export function migratePlan(db) {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  if (cols.includes('plan')) return;
  db.exec('BEGIN');
  try {
    db.exec(`ALTER TABLE companies ADD COLUMN plan TEXT NOT NULL DEFAULT '${DEFAULT_PLAN}'`);
    db.prepare(`UPDATE companies SET plan = 'custom-brand' WHERE brand <> ?`).run(DEFAULT_LOOK);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Can this company wear this look? Mise always; a custom look only for a company it's made for (or a demo copy that was
 *  made wearing it). */
export function lookAllowed(co, look) {
  const L = lookInfo(look);
  if (!L || !co) return false;
  if (!L.custom) return true;
  if (L.data) return (L.madeFor || []).includes(Number(co.id)); // a data look: only its own company (a demo copy included)
  return !!co.demo || (L.madeFor || []).includes(Number(co.id));
}
/** A demo copy on Foundation can wear the throwaway look it made itself (Your Look's "See an Example"). */
const demoTry = (co, look) => !!co?.demo && isDataLook(look) && lookAllowed(co, look);
/** The look a company is drawn in: its own look when its plan includes a custom look and the look is made for it; Mise
 *  otherwise. `co` is a companies row (or null: signed out, no company yet → Mise). */
export function lookOf(co) {
  if (!co) return DEFAULT_LOOK;
  const plan = PLANS[co.plan] || PLANS[DEFAULT_PLAN];
  const look = co.brand || DEFAULT_LOOK;
  if (look === DEFAULT_LOOK || !(plan.customLook || demoTry(co, look)) || !lookAllowed(co, look)) return DEFAULT_LOOK;
  return look;
}
/** The looks a super admin can pick for a company (Mise first; then its own looks made in Your Look, `extra`). */
export const looksFor = (co, extra = []) => [...Object.values(LOOKS), ...extra].filter((L) => lookAllowed(co, L.id)).map((L) => ({ id: L.id, name: L.name, custom: L.custom }));

/** The look a store is drawn in (Nov 17): the store's own look when it has one that's allowed (Custom Brand plan, made for
 *  the company), else the company's look. `st` is a stores row (or null: no store yet → the company's look). */
export function lookOfStore(co, st) {
  const base = lookOf(co);
  const own = st?.look;
  if (!co || !own || !lookInfo(own)) return base;
  const plan = PLANS[co.plan] || PLANS[DEFAULT_PLAN];
  if (!(plan.customLook || demoTry(co, own)) || !lookAllowed(co, own)) return base;
  return own;
}
/** Can this company give its stores their own looks? Custom Brand only; never a demo copy or Mise Academy (HQ). */
export const storeLooksAllowed = (co) => !!co && !co.demo && !co.internal && !!(PLANS[co.plan] || PLANS[DEFAULT_PLAN]).customLook;
