// Training acknowledgments (Nov 11, the Hospitality Program). BRG's Hospitality 101 ends with an acknowledgment the new
// hire signs (printed name, signature, date) and their trainer signs. In the app: the person types their name and ticks
// that they've read and agree (kept here with the date); their trainer or a manager then signs off the level's practical
// (program:hosp-1:practical), which needs this first.
//
// Its own table, made here, so nothing else has to change for it. Rows for people who no longer exist (old demo copies)
// are cleared at start-up.
import { LEVELS } from './manual.mjs';

export function migrateAcks(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS program_acks(user_id INT NOT NULL, store_id INT NOT NULL, company_id INT, level TEXT NOT NULL,
    name TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(user_id, store_id, level))`);
  db.prepare('DELETE FROM program_acks WHERE user_id NOT IN (SELECT id FROM users)').run();
}

/** The levels that end in an acknowledgment ('hosp-1'). */
export const ackLevel = (file) => LEVELS.find((L) => L.file === file && L.ack) || null;
/** Is this practical one that needs the person's acknowledgment first? */
export const ackFor = (practicalKey) => LEVELS.find((L) => L.practical === practicalKey && L.ack) || null;

/** { name, at } once this person has signed, else null. */
export function ackOf(db, userId, storeId, level) {
  if (!userId) return null;
  return db.prepare('SELECT name, at FROM program_acks WHERE user_id = ? AND store_id = ? AND level = ?').get(userId, storeId, level) || null;
}

/** Signs it. The name is what they typed (their printed name); the first signature stands. */
export function signAck(db, { userId, storeId, companyId, level, name }) {
  db.prepare('INSERT OR IGNORE INTO program_acks(user_id, store_id, company_id, level, name, at) VALUES (?,?,?,?,?,?)')
    .run(userId, storeId, companyId ?? null, level, name, new Date().toISOString());
  return ackOf(db, userId, storeId, level);
}
