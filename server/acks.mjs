// The Training Acknowledgment (Nov 11; moved Nov 12). BRG's new-hire paperwork ends with an acknowledgment the new hire
// signs (printed name, signature, date) and their trainer signs. In the app: the person types their name and ticks that
// they've read and agree (kept here with the date); their trainer or a manager then signs it off.
//
// Nov 12, Tommy: "The employee training acknowledgement should be a part of their path, not a part of the hospitality
// part." So it's a Day 1 step on every job's path (server/paths.mjs, sign-off key `path:ack`), no longer Hospitality 101's
// practical. The words still live with the Hospitality Program's text (content/hospitality*/_program.json), so BRG's
// companies read BRG's wording and everyone else reads the softened generic one (server/variant.mjs).
//
// Its own table, made here, so nothing else has to change for it. Rows for people who no longer exist (old demo copies)
// are cleared at start-up.

/** The path step's sign-off key, and the level name the signature is kept under. */
export const ACK_KEY = 'path:ack';
export const ACK_LEVEL = 'training';
/** Before Nov 12 the acknowledgment was Hospitality 101's practical: its signatures and sign-offs used these keys. */
const OLD_LEVEL = 'hosp-1';
const OLD_KEY = 'program:hosp-1:practical';

export function migrateAcks(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS program_acks(user_id INT NOT NULL, store_id INT NOT NULL, company_id INT, level TEXT NOT NULL,
    name TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(user_id, store_id, level))`);
  db.prepare('DELETE FROM program_acks WHERE user_id NOT IN (SELECT id FROM users)').run();
  carryOverAcks(db);
}

/**
 * Nov 12: the acknowledgment moved from Hospitality 101 to the path. Every signature, trainer sign-off, open request and
 * "more time" on it moves to the path step's keys. Nothing is deleted: if a row already exists under the new key (it
 * can't, unless this ran half-way before), the old row is left where it is. Safe to run on every start.
 */
export function carryOverAcks(db) {
  const moved = { acks: 0, signoffs: 0, requests: 0 };
  db.exec('BEGIN');
  try {
    moved.acks = Number(db.prepare('UPDATE OR IGNORE program_acks SET level = ? WHERE level = ?').run(ACK_LEVEL, OLD_LEVEL).changes);
    moved.signoffs = Number(db.prepare('UPDATE OR IGNORE signoffs SET quiz = ? WHERE quiz = ?').run(ACK_KEY, OLD_KEY).changes);
    moved.requests = Number(db.prepare('UPDATE OR IGNORE signoff_requests SET key = ? WHERE key = ?').run(ACK_KEY, OLD_KEY).changes);
    db.prepare('UPDATE OR IGNORE path_due SET step = ? WHERE step = ?').run(ACK_KEY, OLD_KEY);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return moved;
}

/** { name, at } once this person has signed, else null. */
export function ackOf(db, userId, storeId) {
  if (!userId) return null;
  return db.prepare('SELECT name, at FROM program_acks WHERE user_id = ? AND store_id = ? AND level = ?').get(userId, storeId, ACK_LEVEL) || null;
}

/** Signs it. The name is what they typed (their printed name); the first signature stands. */
export function signAck(db, { userId, storeId, companyId, name }) {
  db.prepare('INSERT OR IGNORE INTO program_acks(user_id, store_id, company_id, level, name, at) VALUES (?,?,?,?,?,?)')
    .run(userId, storeId, companyId ?? null, ACK_LEVEL, name, new Date().toISOString());
  return ackOf(db, userId, storeId);
}
