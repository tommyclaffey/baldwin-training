// Plans and looks (Nov 16, Tommy: "the baldwin is supposed to [be] an account under the app. custom brand is an upgraded
// tier"). Mise Academy is the product; its look is every company's look. A restaurant's own look (logo, colours, type) is
// part of the Custom Brand plan, set per company by a super admin (Super Admin → Companies).
//
//   companies.plan   'foundation' (every company, the default) · 'custom-brand' (the upgrade)
//   companies.brand  the look the company picked: 'mise', or a custom look made for it
//
// A custom look is drawn in code today (src/lib/theme.ts fills every colour and type role per look) and its files (logo,
// app icons) live in the account's folder on the volume (server/account.mjs), not in this repo. The seam for building new
// custom looks: add an entry to LOOKS below (who it's made for), its theme object in src/lib/theme.ts, and its files in that
// account's folder. Building arbitrary looks from settings (any colours, any logo) is a later step.

/** Every look the app can draw. `madeFor`: the companies (by id) a custom look belongs to. A demo copy of an account's
 *  book (companies.demo = 1) wears the look its demo was made with (server/demo.mjs), so it isn't listed here. */
export const LOOKS = {
  mise: { id: 'mise', name: 'Mise Academy', custom: false },
  baldwin: { id: 'baldwin', name: 'The Baldwin', custom: true, madeFor: [1] },
};
export const DEFAULT_LOOK = 'mise';
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
  const L = LOOKS[look];
  if (!L || !co) return false;
  if (!L.custom) return true;
  return !!co.demo || (L.madeFor || []).includes(Number(co.id));
}
/** The look a company is drawn in: its own look when its plan includes a custom look and the look is made for it; Mise
 *  otherwise. `co` is a companies row (or null: signed out, no company yet → Mise). */
export function lookOf(co) {
  if (!co) return DEFAULT_LOOK;
  const plan = PLANS[co.plan] || PLANS[DEFAULT_PLAN];
  const look = co.brand || DEFAULT_LOOK;
  if (look === DEFAULT_LOOK || !plan.customLook || !lookAllowed(co, look)) return DEFAULT_LOOK;
  return look;
}
/** The looks a super admin can pick for a company (Mise first). */
export const looksFor = (co) => Object.values(LOOKS).filter((L) => lookAllowed(co, L.id)).map((L) => ({ id: L.id, name: L.name, custom: L.custom }));
