// Nov 4: leaving the demo puts your own sign-in back (the server kept it aside when the demo started).
import { api } from './api';

export async function exitDemo(refresh: () => Promise<unknown>) {
  await api('/api/demo/exit', { method: 'POST' }).catch(() => {});
  await refresh();
  location.assign('/');
}

// Nov 7, Tommy: "have all my demo restart after a refresh". Runs before the app draws: a refresh inside the demo gets a fresh copy of
// the sample restaurant and lands on Home. Real accounts never make this call (the flag is only there while a demo account is signed in).
const FLAG = 'bt-demo';
export function markDemo(on: boolean) { try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch { /* private mode */ } }
export function inDemo() { try { return !!localStorage.getItem(FLAG); } catch { return false; } }

export async function restartDemoIfRefreshed() {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type !== 'reload' || !inDemo() || location.pathname === '/demo') return;
  try {
    const r = await api<{ restarted: boolean }>('/api/demo/restart', { method: 'POST' });
    if (!r.restarted) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith('bt-demo-ticks:')) localStorage.removeItem(k);
    history.replaceState(null, '', '/');
  } catch { /* keep the copy they have */ }
}
