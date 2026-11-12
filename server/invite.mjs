// Levels by invitation (Nov 12). Tommy, Nov 6: "Level 4, by invitation, panel." The Cocktail Program's Level 4 (Master of the
// Bar) is visible to everyone, but staff can only open its lessons and take its final once a manager invites them on People.
// The invitation is a row in `signoffs` keyed by the level's `invite` key ('program:bar-4:invite'), so it's per person and per
// store like every other sign-off, and Undo removes it. Managers, owners and super admins can always open the level.
import { LEVELS, chaptersOf } from './manual.mjs';

export const INVITE_LEVELS = () => LEVELS.filter((L) => L.invite);
export const isInviteKey = (key) => LEVELS.some((L) => L.invite && L.invite === key);

/** The invitation this person has for a level: { at, by } or null. */
export function invitationOf(db, user, store, L) {
  if (!L?.invite || !user?.id) return null;
  const r = db.prepare('SELECT s.at, u.name by_name FROM signoffs s LEFT JOIN users u ON u.id = s.by_user WHERE s.device = ? AND s.quiz = ? AND s.store_id = ?').get('u' + user.id, L.invite, store);
  return r ? { at: r.at, by: r.by_name || null } : null;
}

/** Can this person open the level's lessons and take its final? */
export function canTake(db, user, store, L) {
  if (!L?.invite) return true;
  if (!user) return false;
  if (user.role && user.role !== 'staff') return true; // managers, owners and super admins run the program
  return !!invitationOf(db, user, store, L);
}

/** The quiz topics (finals and lesson quizzes) this person can't take yet. */
export function lockedTopics(db, user, store) {
  const out = new Set();
  for (const L of INVITE_LEVELS()) {
    if (canTake(db, user, store, L)) continue;
    out.add(L.final);
    for (const c of chaptersOf(L.program, L.level)) out.add('study:' + c.slug);
  }
  return out;
}

/** The level a program lesson belongs to, when it's by invitation and this person can't open it (else null). */
export function lockedLevelOf(db, user, store, ch) {
  const L = LEVELS.find((x) => x.invite && x.program === ch?.program && x.level === (ch.programLevel || ch.barLevel || 1));
  return L && !canTake(db, user, store, L) ? L : null;
}
