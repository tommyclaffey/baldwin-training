// Nov 4: leaving the demo puts your own sign-in back (the server kept it aside when the demo started).
import { api, type User } from './api';

/* Nov 11: two demos. /demo is The Baldwin's (its name, logo and look); /demo/mise is Wrenfield, a made-up restaurant in the
 * Mise Academy look. Which one a demo account is in comes from its company's brand. */
export type DemoKind = 'baldwin' | 'mise';
export const demoKindOf = (u: User | null | undefined): DemoKind => (u?.brand === 'mise' ? 'mise' : 'baldwin');
export const demoHome = (k: DemoKind) => (k === 'mise' ? '/demo/mise' : '/demo');
export const isDemoHome = (p: string) => p === '/demo' || p === '/demo/mise';
/** Pages the Mise demo's book leaves out (The Baldwin's own story and floor plan). Kept in step with SAMPLE_HIDDEN in server/content.mjs. */
export const SAMPLE_HIDDEN = ['/our-story', '/floor-plan', '/sommelier-program/about'];
export const isSample = (u: User | null | undefined) => !!u?.demo && u.brand === 'mise';

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
