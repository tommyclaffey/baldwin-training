// Temporary passwords (Nov 24; Tommy: "i need a assign temporary password vs a reset pin"; Figma 09 · Idea Board → section
// 49, 1002:194). An admin sets a temporary password, tells the person, and the person chooses their own the first time they
// sign in with it. Beside Reset Password and Reset PIN, not instead of them.
//
// Nov 24, scope from Tommy: "you sign up with pin code and you sign in with email and password" (the join code is for
// signing up; everyone signs in with email + password). So there's no temporary PIN, and staff get a temporary password
// too: for staff without an email the dialog asks for it, and it's saved on their account. Their PIN is left alone (the
// move of PIN staff to email + password is its own change).
//
//   • Who: whoever can already reset that person. Owners and managers: Reset Password's rules (owners; the Mise team's
//     Owner/Manager). Staff: Reset PIN's (managers for the staff they manage; the Mise team's Owner/Manager). Support changes
//     nothing. Checked in server/accounts.mjs.
//   • Stored hashed (scrypt, like every password). The admin sees it once, in the dialog; the server never sends it back.
//   • Expires: 1, 3, 7 (default) or 14 days. Works once: it opens only "Choose Your Own Password", and is used up the moment
//     the person saves their own.
//   • Setting one signs the person out everywhere and their old password stops working (users.password_hash becomes
//     UNUSABLE). Two-step stays on: the code is still asked after the temporary password, before choosing.
//   • Cancel Temporary puts their old password back (prev_hash): the undo for one set by mistake. Once one expires, the old
//     one does not come back by itself: they ask for a new temporary one, or a reset link.
//   • Every set, cancel and use is in the log, under who did it.
//
// temp_credentials is made here (no migration number, like program_acks and company_deletions), so it can't collide with a
// migration added on another branch. prev_hash is only kept while the temporary one is outstanding.
import { now } from './db.mjs';

export const TEMP_DAYS = [1, 3, 7, 14];
export const DEFAULT_TEMP_DAYS = 7;
/** What users.password_hash holds while a temporary password is outstanding (or after it expired unused): a value no
 *  password matches (verifyPassword only accepts 'scrypt$…'). Never NULL, so a manager's sign-in kind doesn't change. */
export const UNUSABLE = '!temporary';
export const isUnusable = (h) => h === UNUSABLE;

export function migrateTemp(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS temp_credentials(id INTEGER PRIMARY KEY, user_id INT NOT NULL, company_id INT,
    kind TEXT NOT NULL DEFAULT 'password' CHECK(kind = 'password'), hash TEXT NOT NULL, prev_hash TEXT, created_by INT, created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, used_at TEXT, cancelled_at TEXT, cancelled_by INT)`);
  db.exec('CREATE INDEX IF NOT EXISTS temp_credentials_user ON temp_credentials(user_id, id)');
}

/** The temporary password this person has outstanding (not used, not cancelled, not expired), or undefined. */
export const activeTemp = (db, userId) => db.prepare(`SELECT * FROM temp_credentials
    WHERE user_id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1`).get(userId, now());
/** Their newest one that no longer works because it was used or expired (not cancelled), from the last 30 days: so a person
 *  typing it again is told why, instead of "that doesn't match". */
export const spentTemp = (db, userId) => db.prepare(`SELECT * FROM temp_credentials WHERE user_id = ? AND cancelled_at IS NULL
    AND (used_at IS NOT NULL OR expires_at <= ?) AND created_at > ? ORDER BY id DESC LIMIT 1`).get(userId, now(), new Date(Date.now() - 30 * 864e5).toISOString());
/** For a People row: "Temporary · until Nov 30". */
export const tempOut = (t) => (t ? { expiresAt: t.expires_at, createdAt: t.created_at } : null);
/** Every outstanding one, by person, for a list (one query). */
export function activeTemps(db, userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT * FROM temp_credentials WHERE user_id IN (${ids.map(() => '?').join(',')}) AND used_at IS NULL AND cancelled_at IS NULL
      AND expires_at > ? ORDER BY id`).all(...ids, now());
  return new Map(rows.map((r) => [r.user_id, r]));
}

/** "Nov 30", in the restaurants' time (Detroit), for messages. */
export const dayOf = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Detroit' });

/** Purge (with the 30-day deletions): rows 30 days past their end go; one that's over stops keeping the old hash. */
export function purgeTemps(db) {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  db.prepare('DELETE FROM temp_credentials WHERE expires_at < ? OR used_at < ? OR cancelled_at < ?').run(cutoff, cutoff, cutoff);
  db.prepare('UPDATE temp_credentials SET prev_hash = NULL WHERE prev_hash IS NOT NULL AND (used_at IS NOT NULL OR cancelled_at IS NOT NULL OR expires_at <= ?)').run(now());
}
