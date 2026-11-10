// Nov 10 (audit: "errors go to the console only"): browser errors are sent to the server's error log
// (server/ops.mjs), once each per page load, so a problem a guest hits doesn't go unnoticed.
const sent = new Set<string>();
function report(message: string, stack?: string) {
  const key = message.slice(0, 200);
  if (!message || sent.has(key) || sent.size > 10) return;
  sent.add(key);
  const body = JSON.stringify({ message, stack: stack?.slice(0, 3000), path: location.pathname });
  fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BT': '1' }, body, keepalive: true }).catch(() => {});
}
export function reportErrors() {
  window.addEventListener('error', (e) => {
    if (!e.message || /ResizeObserver loop/.test(e.message)) return; // a harmless browser notice
    report(e.message, e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | string | undefined;
    const msg = typeof r === 'string' ? r : r?.message || 'Unhandled promise rejection';
    if (/Failed to fetch|NetworkError|Load failed|AbortError/i.test(msg)) return; // a dropped connection, not a bug
    report(msg, typeof r === 'string' ? undefined : r?.stack);
  });
}
