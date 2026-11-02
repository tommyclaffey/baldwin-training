// "Mark Complete" at the end of a Study Guide lesson (Nov 2, Tommy: "There is no completed checkbox"). Ticks the
// section done (or undoes it); getting all three quick-check cards right ticks it too.
import { useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

export function CompleteToggle({ data }: { data: { key: string; done: boolean } }) {
  const { bump } = useSession();
  const [done, setDone] = useState(data.done);
  const [busy, setBusy] = useState(false);
  const flip = async () => {
    if (busy) return; setBusy(true);
    try { await api('/api/study/done', { method: 'POST', body: { key: data.key, done: !done } }); setDone(!done); bump(); } catch { /* leave as is */ }
    setBusy(false);
  };
  return (
    <button type="button" role="checkbox" aria-checked={done} className={'complete-toggle' + (done ? ' on' : '')} onClick={flip} disabled={busy}>
      <span className="ct-box" aria-hidden="true">{done ? '✓' : ''}</span>
      <span>{done ? 'Completed' : 'Mark Complete'}</span>
    </button>
  );
}
