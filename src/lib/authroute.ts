// Real addresses for signing in and joining (Nov 23; Tommy: "It should be miseacademy.app/join, and the other one should be
// sign in"). Two choices, no role labels (vault note "One sign-in, no role labels"; Idea Board section 50 is the redesign):
//
//   /sign-in                 email + password (everyone with an account; "Use Your PIN Instead" for staff on a PIN)
//   /join                    Join with a Code: the join code → restaurant → name → PIN screens
//   /<account>               that account's Sign In, in its look (server/links.mjs fills in the account)
//   /<account>/sign-in       the same (an alias)
//   /<account>/join          that account's Join with a Code, in its look; the code has to be that account's
//
// No imports, so the tests can load it as it is.
export type AuthKind = 'sign-in' | 'join';
export type AuthRoute<A> = { kind: AuthKind; account: A | null };

/** Which sign-in screen this address is, or null for any other address. `account` is the account this page was served for
 *  (src/lib/account.ts accountLink), or null. */
export function authRouteFor<A extends { slug: string }>(pathname: string, account: A | null): AuthRoute<A> | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === '/sign-in') return { kind: 'sign-in', account: null };
  if (p === '/join') return { kind: 'join', account: null };
  if (!account) return null;
  const base = '/' + account.slug;
  if (p === base || p === base + '/sign-in') return { kind: 'sign-in', account };
  if (p === base + '/join') return { kind: 'join', account };
  return null;
}
/** Where Sign In is: the account's own address, or /sign-in. */
export const signInPath = (account: { slug: string } | null) => (account ? '/' + account.slug : '/sign-in');
/** Where Join with a Code is: /<account>/join, or /join. */
export const joinPath = (account: { slug: string } | null) => (account ? `/${account.slug}/join` : '/join');
/** The screens' titles, the same two words everywhere. */
export const AUTH_TITLE: Record<AuthKind, string> = { 'sign-in': 'Sign In', join: 'Join with a Code' };
