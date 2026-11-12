// Nov 4: leaving the demo puts your own sign-in back (the server kept it aside when the demo started).
import { api, type User } from './api';

/* Nov 11: two demos. /demo is The Baldwin's (its name, logo and look); /demo/mise is Wrenfield, a made-up restaurant in the
 * Mise Academy look. Which one a demo account is in comes from its company's brand. */
export type DemoKind = 'baldwin' | 'mise';
export const demoKindOf = (u: User | null | undefined): DemoKind => (u?.brand === 'mise' ? 'mise' : 'baldwin');
// Nov 11, Tommy: "can it be demo/brg for the other one": The Baldwin's demo lives at /demo/brg; plain /demo still opens it
// so links already shared keep working.
export const demoHome = (k: DemoKind) => (k === 'mise' ? '/demo/mise' : '/demo/brg');
export const isDemoHome = (p: string) => p === '/demo' || p === '/demo/brg' || p === '/demo/mise';
export const isSample = (u: User | null | undefined) => !!u?.demo && u.brand === 'mise';
/** The menu the top bar's chip names: The Baldwin's opening menu, or the Mise demo's (SAMPLE_MENU in server/content.mjs). */
export const menuName = (u: User | null | undefined) => (isSample(u) ? 'Fall Menu · 2026' : u?.store?.bookReady && u.store.slug === 'the-baldwin' ? 'Opening Menu · Fall 2026' : null);

export async function exitDemo(refresh: () => Promise<unknown>) {
  await leaveDemo();
  await refresh();
  location.assign('/');
}

// Nov 7, Tommy: "have all my demo restart after a refresh". Runs before the app draws: a refresh inside the demo gets a fresh copy of
// the sample restaurant and lands on Home. Real accounts never make this call (the flag is only there while a demo account is signed in).
const FLAG = 'bt-demo';
export function markDemo(on: boolean) { try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch { /* private mode */ } }
// Nov 10, Tommy: "this should be the site not the demo. demo should be its own link". The demo lives only in the tab it was
// started in (from /demo). Opening the site anywhere else (a new tab, the address bar, a bookmark) ends it, so
// www.miseacademy.app always opens the real sign-in (or your own account, if the demo kept it aside).
const TAB = 'bt-demo-tab';
export function markDemoTab() { try { sessionStorage.setItem(TAB, '1'); } catch { /* private mode */ } }
export function demoTab() { try { return !!sessionStorage.getItem(TAB); } catch { return true; } }
export async function leaveDemo() {
  markDemo(false);
  try { sessionStorage.removeItem(TAB); } catch { /* private mode */ }
  await api('/api/demo/exit', { method: 'POST' }).catch(() => {});
}
export function inDemo() { try { return !!localStorage.getItem(FLAG); } catch { return false; } }

export async function restartDemoIfRefreshed() {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  // Inside another page's frame a refresh of that page reports "navigate", so every load there counts.
  if ((nav?.type !== 'reload' && window.self === window.top) || !inDemo() || isDemoHome(location.pathname)) return;
  try {
    const r = await api<{ restarted: boolean }>('/api/demo/restart', { method: 'POST' });
    if (!r.restarted) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith('bt-demo-ticks:')) localStorage.removeItem(k);
    history.replaceState(null, '', '/');
  } catch { /* keep the copy they have */ }
}
