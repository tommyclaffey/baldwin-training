// Nov 25 (Tommy: "get warned before staff do"): Autumn saw "We couldn't find that page" on Home because the page list
// failed once, and nothing told us. Now the moments where someone is left looking at a problem are sent to the error log
// (Super Admin → Error Log, kind "seen"), in plain words the server picks:
//   index   the page list didn't load, after its tries        (src/lib/session.tsx)
//   page    a page didn't load                                (src/components/PageView.tsx)
//   signin  a sign-in request got a server error, or never reached the server (a wrong PIN or password isn't one)
// Only fixed fields go: which moment, the answer's status number, how many tries, the address (tokens and codes taken out)
// and a page id. Never what was typed: no PIN, password, email, code or token.
// If the report can't be sent (no connection, often the very cause), it waits on this device and goes once it's back.

export type ProblemEvent = 'index' | 'page' | 'signin';
/** Which sign-in request it was (the server turns these into words). */
export type SignInStep = 'login' | 'code' | 'choose' | 'staff-login' | 'join-check' | 'join' | 'reset' | 'invite' | 'forgot' | 'set-up-check' | 'set-up-save';
type Report = { event: ProblemEvent; status: number; attempts?: number; path: string; page?: string; step?: SignInStep; at: number };

const QUEUE = 'mise-problems';
const sent = new Set<string>();

/** The address without anything secret in it: invite and reset tokens, join codes. */
export function safePath(p: string): string {
  return String(p || '/').split(/[?#]/)[0]
    .replace(/\/(invite|reset)\/[^/]+/g, '/$1/:token')
    .replace(/\/api\/join\/[^/]+/g, '/api/join/:code')
    .replace(/[^\w\-/.:~]/g, '')
    .slice(0, 200) || '/';
}
/** The status of a failed request: an ApiError's status, or 0 when it never got an answer (no connection). */
export function statusOf(err: unknown): number {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' && Number.isFinite(s) ? s : 0;
}

function post(r: Report): Promise<boolean> {
  const late = Date.now() - r.at;
  const body = JSON.stringify({ event: r.event, status: r.status, attempts: r.attempts, path: r.path, page: r.page, step: r.step, late: late > 60_000 ? late : undefined });
  return fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BT': '1' }, body, keepalive: true, credentials: 'same-origin' })
    .then((res) => res.status < 500)
    .catch(() => false);
}
function readQueue(): Report[] {
  try { const q = JSON.parse(localStorage.getItem(QUEUE) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeQueue(q: Report[]) {
  try { if (q.length) localStorage.setItem(QUEUE, JSON.stringify(q.slice(-10))); else localStorage.removeItem(QUEUE); } catch { /* private mode */ }
}
let flushing = false;
/** Sends the reports that waited for a connection (on start, and when the browser says it's back online). */
export async function flushProblems() {
  if (flushing) return;
  flushing = true;
  try {
    const q = readQueue().filter((r) => Date.now() - r.at < 7 * 864e5);
    const left: Report[] = [];
    for (const r of q) if (!(await post(r))) left.push(r);
    writeQueue(left);
  } finally { flushing = false; }
}

/** Reports one problem someone saw. Sign-in only counts server errors and no connection; the page list and pages count
 *  every failure but "you're not signed in / not allowed" (401, 403), which isn't Mise breaking. */
export function reportProblem(event: ProblemEvent, err: unknown, extra: { attempts?: number; page?: string; step?: SignInStep; path?: string } = {}) {
  const status = statusOf(err);
  if (status === 401 || status === 403) return;
  if (event === 'signin' && status !== 0 && status < 500) return; // a wrong PIN, password or code: not a problem with Mise
  const r: Report = { event, status, attempts: extra.attempts, page: extra.page, step: extra.step,
    path: safePath(extra.path ?? (typeof location !== 'undefined' ? location.pathname : '/')), at: Date.now() };
  const key = [event, r.path, r.step || '', r.page || '', status].join('|');
  if (sent.has(key) || sent.size > 20) return;
  sent.add(key);
  post(r).then((ok) => { if (!ok) writeQueue([...readQueue(), r]); });
}

/** Sign-in requests, by address (src/lib/api.ts watches these). */
export function signInStep(method: string, path: string): SignInStep | null {
  const p = path.split('?')[0];
  if (method === 'POST') {
    if (p === '/api/login') return 'login';
    if (p === '/api/login/code') return 'code';
    if (p === '/api/login/choose') return 'choose';
    if (p === '/api/staff-login') return 'staff-login';
    if (p === '/api/join') return 'join';
    if (p === '/api/set-up/check') return 'set-up-check'; // Nov 25: Set Up Your Sign-In (section 50)
    if (p === '/api/set-up/save') return 'set-up-save';
    if (p === '/api/password/forgot') return 'forgot';
    if (/^\/api\/reset\/[^/]+$/.test(p)) return 'reset';
    if (/^\/api\/invite\/[^/]+$/.test(p)) return 'invite';
  }
  if (method === 'GET' && /^\/api\/join\/[^/]+$/.test(p)) return 'join-check';
  return null;
}
