// Real addresses for signing in and joining (Nov 23; Tommy: "It should be miseacademy.app/join, and the other one should be
// sign in"). Two choices, no role labels (vault note "One sign-in, no role labels"; Idea Board section 50 is the redesign):
//
//   /sign-in                 email + password (everyone with an account). Nov 25 (section 50): also the site's root and any
//                            other address someone opens signed out
//   /join                    Join with a Code (sign-up only): the join code → restaurant → name, email and password
//   /set-up-sign-in          Nov 25: Set Up Your Sign-In, the one-time move for people who joined with a PIN (find your
//                            name → the old PIN once → email and password). Opens by itself on a phone that joined with one.
//   /<account>               that account's Sign In, in its look (server/links.mjs fills in the account)
//   /<account>/sign-in       the same (an alias)
//   /<account>/join          that account's Join with a Code, in its look; the code has to be that account's
//   /<account>/set-up-sign-in  that account's Set Up Your Sign-In, in its look
//
// No imports, so the tests can load it as it is.
export type AuthKind = 'sign-in' | 'join' | 'set-up';
export type AuthRoute<A> = { kind: AuthKind; account: A | null };

/** Which sign-in screen this address is, or null for any other address. `account` is the account this page was served for
 *  (src/lib/account.ts accountLink), or null. */
export function authRouteFor<A extends { slug: string }>(pathname: string, account: A | null): AuthRoute<A> | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === '/sign-in') return { kind: 'sign-in', account: null };
  if (p === '/join') return { kind: 'join', account: null };
  if (p === '/' + SET_UP) return { kind: 'set-up', account: null };
  if (!account) return null;
  const base = '/' + account.slug;
  if (p === base || p === base + '/sign-in') return { kind: 'sign-in', account };
  if (p === base + '/join') return { kind: 'join', account };
  if (p === base + '/' + SET_UP) return { kind: 'set-up', account };
  return null;
}
/** Set Up Your Sign-In's address segment (Nov 25; reserved in server/links.mjs AUTH_PAGES). */
export const SET_UP = 'set-up-sign-in';
/** Where Sign In is: the account's own address, or /sign-in. */
export const signInPath = (account: { slug: string } | null) => (account ? '/' + account.slug : '/sign-in');
/** Where Join with a Code is: /<account>/join, or /join. */
export const joinPath = (account: { slug: string } | null) => (account ? `/${account.slug}/join` : '/join');
/** Where Set Up Your Sign-In is: /<account>/set-up-sign-in, or /set-up-sign-in. */
export const setUpPath = (account: { slug: string } | null) => (account ? `/${account.slug}/${SET_UP}` : '/' + SET_UP);
/** The screens' titles, the same words everywhere. */
export const AUTH_TITLE: Record<AuthKind, string> = { 'sign-in': 'Sign In', join: 'Join with a Code', 'set-up': 'Set Up Your Sign-In' };

/* Nov 25 (section 50): a phone that joined with a PIN remembers the join code (bt-join-code). Signed out, that phone opens
 * Set Up Your Sign-In by itself, once: after it moves over (or anyone signs in on it with email) it's marked, and it opens
 * Sign In like everywhere else. */
export const CODE_KEY = 'bt-join-code';
export const MOVED_KEY = 'bt-signin-moved';
/** Does this phone still need Set Up Your Sign-In (it joined with a PIN and nobody has signed in here with email since)? */
export function phoneOnPin(): boolean {
  try { return !!localStorage.getItem(CODE_KEY) && !localStorage.getItem(MOVED_KEY); } catch { return false; }
}
/** Someone signed in here with email and password (or just moved over): this phone opens Sign In from now on. */
export function markMoved() {
  try { localStorage.setItem(MOVED_KEY, '1'); } catch { /* private mode */ }
}

/** Nov 24: set the moment someone signs in on the signed-out screen. If the address they were on isn't a page (an old
 *  bookmark or link), PageView sends them Home rather than "We couldn't find that page". */
export const JUST_SIGNED_IN = 'bt-just-signed-in';
export function justSignedIn(): boolean {
  try { const at = Number(sessionStorage.getItem(JUST_SIGNED_IN) || 0); return at > 0 && Date.now() - at < 60_000; } catch { return false; }
}
