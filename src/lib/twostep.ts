// Super admins need two-step sign-in before Mise opens for them (Nov 14, security review: the server refuses the book and
// every company's data until it's on). Nov 16 (Tommy hit it live): signed in without it, the book used to show its built-in
// sidebar and "We couldn't find that page" everywhere. Now every book page and the sign-in send them to Your Account.
type Person = { role: string; totpOn?: boolean; impersonatedBy?: number | null } | null | undefined;

export const TWO_STEP_MSG = 'Turn on two-step sign-in to open Mise. Super admins need it.';
export const TWO_STEP_HOME = '/admin/account';
/** A super admin (signed in as themselves) who hasn't turned two-step sign-in on yet. */
export const needsTwoStep = (u: Person) => !!u && u.role === 'superadmin' && !u.totpOn && !u.impersonatedBy;
/** Where an owner, manager or super admin lands after signing in. */
export const landingFor = (u: Person) => (needsTwoStep(u) ? TWO_STEP_HOME : '/admin');
