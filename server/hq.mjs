// Mise Academy (HQ) (Nov 16, Tommy: "it looks like my super admin account is attached to the baldwin verse a mise company
// account"). Mise's own company: where a super admin works when they haven't picked a customer, and where Mise's team will
// live later. Its book is what a brand-new customer sees (the shared library, an empty menu), so Tommy can see that
// experience. It's internal (companies.internal = 1): Mise look, Foundation plan, no join code, never shown to a customer,
// never deleted, never billed.
//
// Made at startup if it's missing (a column check and an insert, like companies.plan), so every database has exactly one.
export const HQ_NAME = 'Mise Academy (HQ)';
export const HQ_SLUG = 'mise-hq';
export const HQ_STORE = 'Mise Academy';
let HQ = null;

export function migrateHq(db) {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  if (!cols.includes('internal')) db.exec('ALTER TABLE companies ADD COLUMN internal INT NOT NULL DEFAULT 0');
  let row = db.prepare('SELECT id FROM companies WHERE internal = 1 ORDER BY id LIMIT 1').get();
  if (!row) {
    const t = new Date().toISOString();
    db.exec('BEGIN');
    try {
      const id = Number(db.prepare("INSERT INTO companies(name, slug, created_at, brand, plan, internal) VALUES (?,?,?,'mise','foundation',1)").run(HQ_NAME, HQ_SLUG, t).lastInsertRowid);
      db.prepare('INSERT INTO stores(company_id, name, slug, book_ready, sort, created_at) VALUES (?,?,?,0,0,?)').run(id, HQ_STORE, 'mise-academy', t);
      db.exec('COMMIT');
      row = { id };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  HQ = row.id;
  HQ_STORE_ID = db.prepare('SELECT id FROM stores WHERE company_id = ? ORDER BY id LIMIT 1').get(HQ)?.id ?? null;
  return HQ;
}
/** HQ's own store (made with it), where the shared library lives since Nov 19. */
let HQ_STORE_ID = null;
export const hqStoreId = () => HQ_STORE_ID;
/** HQ's company id (null before migrateHq has run on this process's database). */
export const hqId = () => HQ;
export const isHq = (companyId) => HQ != null && Number(companyId) === HQ;
