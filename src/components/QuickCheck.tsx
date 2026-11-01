// The quick check at the end of a Study Guide lesson (Nov 1): three cards, one at a time. Right answers come out of the
// review queue, misses go into it, and three right marks the lesson done.
import { useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { loadReview } from '../quiz/store';
import { useSession } from '../lib/session';

export type Check = { key: string; done?: boolean; items: { ref: string; q: string; options: string[]; answer: number }[] };

export function QuickCheck({ data, style, className = '' }: { data: Check; style?: CSSProperties; className?: string }) {
  const { bump } = useSession();
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [right, setRight] = useState(0);
  const [finished, setFinished] = useState(false);
  const [done, setDone] = useState(!!data.done);
  const n = data.items.length;
  const item = data.items[i];

  const choose = async (k: number) => {
    if (picked !== null) return;
    setPicked(k);
    const ok = k === item.answer;
    if (ok) setRight((r) => r + 1);
    try { await api('/api/quiz/mark', { method: 'POST', body: { ref: item.ref, mark: ok ? 'green' : 'red' } }); loadReview(); } catch { /* keep going offline */ }
  };
  const next = async () => {
    if (i + 1 < n) { setI(i + 1); setPicked(null); return; }
    setFinished(true);
    if (right === n && !done) {
      try { await api('/api/study/done', { method: 'POST', body: { key: data.key } }); setDone(true); bump(); } catch { /* try again next time */ }
    }
  };
  const again = () => { setI(0); setPicked(null); setRight(0); setFinished(false); };

  return (
    <section className={'quick-check ' + className} style={style} aria-label="Quick check">
      <div className="qc-head">
        <span className="qc-label">{finished ? 'QUICK CHECK' : `QUICK CHECK · ${i + 1} OF ${n}`}</span>
        <span className="qc-note">{done ? 'Section done ✓' : `Get ${n} right to finish the section`}</span>
      </div>
      {finished ? (
        <div className="qc-end">
          <p className="qc-q">{right === n ? 'All right. This section is done.' : `${right} of ${n} right. The misses are in your review queue.`}</p>
          {right < n && <button type="button" className="qc-btn" onClick={again}>Try Again</button>}
        </div>
      ) : (
        <>
          <p className="qc-q">{item.q}</p>
          <div className="qc-options" role="group" aria-label="Answers">
            {item.options.map((o, k) => {
              const state = picked === null ? '' : k === item.answer ? ' right' : k === picked ? ' wrong' : ' dim';
              return <button key={k} type="button" className={'qc-option' + state} onClick={() => choose(k)} disabled={picked !== null}>{o}</button>;
            })}
          </div>
          {picked !== null && (
            <div className="qc-foot">
              <span className={picked === item.answer ? 'qc-good' : 'qc-bad'}>{picked === item.answer ? 'Right.' : `Not quite: it’s ${item.options[item.answer]}.`}</span>
              <button type="button" className="qc-btn" onClick={next}>{i + 1 < n ? 'Next' : 'Finish'}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
