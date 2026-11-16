// The Mise team (Nov 16, Tommy: "as the business owner of Mise, if someone were to call and say 'I have an issue with my
// account', I can … pull up every account … make one of the roles a manager so people can be assigned higher access").
// Mise's own people are super admins (users.role = 'superadmin', no company; they work in Mise Academy (HQ) unless they
// pick a customer). Each has a team role, users.super_role:
//   owner    Tommy, the primary super admin (users.super_primary = 1). Everything. The only one who adds or removes
//            teammates and changes their roles. There's one Owner: the role follows super_primary.
//   manager  Looks up any account; Work Here and Sign In As; changes a company's plan and look; resets passwords and PINs;
//            invites company owners; adds and edits companies, stores and people; sees the log. Can't touch the team,
//            delete a company or confirm a company's deletion.
//   support  Looks up any account and its people; Work Here and Sign In As to see what they see; sees the log. Changes
//            nothing: inside a company (and while signed in as someone) Support is view only.
// The server checks every /api/super/* route and every super-only action against this list (teamCan); the Super Admin
// screens hide what a role can't do.
export const TEAM_ROLES = { owner: 'Owner', manager: 'Manager', support: 'Support' };
/** The roles the Owner can give a teammate (the Owner role is Tommy's, the primary super admin). */
export const GIVABLE = ['manager', 'support'];

const ALL = ['view', 'work', 'signInAs', 'log', 'planLook', 'resetPassword', 'resetPin', 'inviteOwner', 'addCompany', 'editCompany', 'editPerson',
  'removePerson', 'library', 'change', 'deleteCompany', 'deletions', 'team'];
const CAN = {
  owner: new Set(ALL),
  manager: new Set(['view', 'work', 'signInAs', 'log', 'planLook', 'resetPassword', 'resetPin', 'inviteOwner', 'addCompany', 'editCompany', 'editPerson',
    'removePerson', 'library', 'change']),
  support: new Set(['view', 'work', 'signInAs', 'log']),
};

/** A super admin's team role: the primary is the Owner; anyone else is what they were given (Support if unknown). */
export function teamRole(u) {
  if (!u || u.role !== 'superadmin') return null;
  if (u.super_primary) return 'owner';
  return u.super_role === 'manager' ? 'manager' : 'support';
}
/** Can this super admin do this? (false for anyone who isn't one) */
export const teamCan = (u, action) => !!teamRole(u) && CAN[teamRole(u)].has(action);
/** Every action, for the Super Admin screens. */
export const teamCans = (u) => Object.fromEntries(ALL.map((a) => [a, teamCan(u, a)]));

/** View only: a Support teammate, in a company or signed in as someone. Their own account still works. */
export function viewOnly(u) {
  if (!u) return false;
  if (u.impersonator_id) return u.impersonator_role === 'superadmin' && !u.impersonator_primary && u.impersonator_super_role !== 'manager';
  return teamRole(u) === 'support';
}
export const VIEW_ONLY_MESSAGE = 'Support can look but not change anything. Ask a Mise manager or the owner.';

/** Columns, added by a check (no migration number, like companies.plan, so it can't collide with another branch):
 *    users.super_role       a super admin's team role. Those already there: the primary → owner, everyone else → manager
 *                           (what they could already do, minus the team).
 *    invites.super_role     the role a team invite gives.
 *    invites.user_id        Promote to Manager (Nov 16): a one-time link for someone who's already on the team.
 *    audit.team_role        a Super Admin log row names who did it and their team role at the time. */
export function migrateTeam(db) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  db.exec('BEGIN');
  try {
    if (!cols('users').includes('super_role')) {
      db.exec('ALTER TABLE users ADD COLUMN super_role TEXT');
      db.exec("UPDATE users SET super_role = CASE WHEN super_primary = 1 THEN 'owner' ELSE 'manager' END WHERE role = 'superadmin'");
    }
    const inv = cols('invites');
    if (!inv.includes('super_role')) db.exec('ALTER TABLE invites ADD COLUMN super_role TEXT');
    if (!inv.includes('user_id')) db.exec('ALTER TABLE invites ADD COLUMN user_id INT');
    if (!cols('audit').includes('team_role')) db.exec('ALTER TABLE audit ADD COLUMN team_role TEXT');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
