// An account's own link (Nov 19; Figma 09 · Idea Board → 43). miseacademy.app/<account> is served by the app's server with
// that account's link-preview card and a <meta name="mise-account"> naming it (server/links.mjs): its address, name and
// look. Never its join code: staff still type that, on a sign-in that already wears the account's look.
// Nov 23: also /<account>/sign-in (the same) and /<account>/join (its Join with a Code), see ./authroute.ts.
import { asBrand, registerLook, type Brand } from './theme';
import { authRouteFor } from './authroute';

export type AccountLink = { slug: string; name: string; brand: Brand };

let read: AccountLink | null | undefined;
/** The account this page was opened for, or null (any other address, or the dev server, which doesn't fill it in). */
export function accountLink(): AccountLink | null {
  if (read !== undefined) return read;
  read = null;
  try {
    const raw = document.querySelector('meta[name="mise-account"]')?.getAttribute('content');
    const a = raw ? JSON.parse(raw) : null;
    if (a && typeof a.slug === 'string' && /^[a-z0-9-]{2,40}$/.test(a.slug) && typeof a.name === 'string') {
      if (a.lookSpec) registerLook(a.brand, a.lookSpec, { quiet: true }); // Nov 22: a look made in Your Look
      read = { slug: a.slug, name: a.name, brand: asBrand(a.brand) };
    }
  } catch { /* no account */ }
  return read;
}
/** Nov 23: which sign-in screen this address is (/sign-in, /join, /the-baldwin, /the-baldwin/sign-in, /the-baldwin/join). */
export const authRouteAt = (pathname: string) => authRouteFor(pathname, accountLink());
/** "miseacademy.app/the-baldwin" for an account's link path, as people type it. */
export const linkText = (link: string) => (location.host.replace(/^www\./, '') + link);
