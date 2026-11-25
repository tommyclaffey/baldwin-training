// Tip Tracker's tables (Nov 25; server/tips.mjs has the rules). Its own module with no imports, so db.mjs can make the
// tables at startup without loading the rest of the app.
// No migration number, like temp_credentials: can't collide with a migration added on another branch.
export function migrateTips(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tip_shifts(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT, user_id INT NOT NULL,
      day TEXT NOT NULL, part TEXT NOT NULL CHECK(part IN ('lunch','dinner')), position TEXT,
      cash_cents INT NOT NULL DEFAULT 0, card_cents INT NOT NULL DEFAULT 0, tipout_cents INT NOT NULL DEFAULT 0,
      minutes INT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT);
    CREATE INDEX IF NOT EXISTS tip_shifts_user ON tip_shifts(user_id, day);
    CREATE TABLE IF NOT EXISTS tip_owed(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT, user_id INT NOT NULL,
      shift_id INT, day TEXT NOT NULL, part TEXT, reason TEXT NOT NULL CHECK(reason IN ('cash','card','drawer','other')),
      label TEXT NOT NULL, amount_cents INT NOT NULL, note TEXT, created_at TEXT NOT NULL, updated_at TEXT);
    CREATE INDEX IF NOT EXISTS tip_owed_user ON tip_owed(user_id);
    CREATE INDEX IF NOT EXISTS tip_owed_store ON tip_owed(store_id);
    CREATE TABLE IF NOT EXISTS tip_payments(id INTEGER PRIMARY KEY, owed_id INT NOT NULL, company_id INT NOT NULL, store_id INT,
      user_id INT NOT NULL, amount_cents INT NOT NULL, paid_on TEXT NOT NULL, by_user INT, by_name TEXT, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tip_payments_owed ON tip_payments(owed_id);
  `);
}
