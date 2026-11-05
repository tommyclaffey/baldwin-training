// The Quizzes page (Figma: Quizzes · Desktop, and Quiz · 1–3 in section 11).
// A quiz opens in a box over the page: the page behind dims and locks until the quiz is done or saved for later.
// After each answer the person marks how well they know it; red and yellow go into their review queue.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PRE_SHIFT, REVIEW, QUIZZES, answer, getReview, loadReview, lookup, markAnswer, passFor, quizById, refreshSignoffs, save, start, statusOf, titleOf, useQuiz, type Mark } from './store';

/** A custom quiz id ("c:house+wine-glass:10") back into what to ask for. */
// topics like "course:Mains" have a colon in them; the count is whatever follows the last one (Nov 5: Start Quiz did nothing)
const customOf = (id: string) => { const m = /^c:(.+):(\d+)$/.exec(id); return m ? { topics: m[1].split('+').filter(Boolean), count: Number(m[2]) } : undefined; };
const enc = encodeURIComponent;
export const LEVELS: { key: Mark; label: string; sub: string }[] = [
  { key: 'red', label: 'Don’t know', sub: 'Back in your queue' },
  { key: 'yellow', label: 'Getting there', sub: 'Back in your queue' },
  { key: 'green', label: 'Know it cold', sub: 'Off your queue' },
];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The quiz box. Shown on the Quizzes page whenever the address has ?quiz=… */
export function QuizModal() {
  const s = useQuiz();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const id = params.get('quiz') || '';
  const valid = id === PRE_SHIFT || id === REVIEW || !!quizById(id) || !!customOf(id) || /^(t|s):/.test(id);
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Opening a quiz: resume one in progress, start a new one, or restart ("New Questions", the review queue).
  useEffect(() => {
    if (!valid) return;
    const cur = s.quizzes[id]?.current;
    const retake = params.get('retake') === '1';
    if (retake || !cur || !cur.questions || ((id === PRE_SHIFT || id === REVIEW) && cur.finished)) { setError(''); start(id, customOf(id)).catch((e) => setError((e as Error).message)); }
    if (retake) { params.delete('retake'); setParams(params, { replace: true }); }
    setReveal(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, params.get('retake')]);

  // The page behind can't be scrolled, clicked or tabbed into while the quiz is open.
  useEffect(() => {
    if (!valid) return;
    const root = document.getElementById('root');
    document.body.classList.add('quiz-lock');
    root?.setAttribute('inert', '');
    return () => { document.body.classList.remove('quiz-lock'); root?.removeAttribute('inert'); };
  }, [valid]);

  const found = valid ? s.quizzes[id]?.current : undefined;
  const cur = found?.questions ? found : undefined;
  const total = cur?.items.length ?? 0;
  const showing = !cur ? -1 : reveal ?? (cur.finished ? null : cur.answers.length);
  useEffect(() => { requestAnimationFrame(() => heading.current?.focus()); }, [showing, !!cur]);
  if (!valid) return null;

  const name = cur?.title || titleOf(id);
  const kicker = id === PRE_SHIFT ? 'Pre-shift quiz' : id === REVIEW ? 'Review queue' : name;
  const leave = () => { nav('/quizzes'); window.scrollTo({ top: 0 }); };
  // Keep Tab inside the box.
  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]')];
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };

  let body;
  if (!cur || showing === -1) {
    body = (
      <>
        <div className="quiz-head"><span className="quiz-kicker">{kicker}</span><span className="quiz-count" /></div>
        <h2 className="quiz-q" id="qm-title" ref={heading} tabIndex={-1}>{error ? 'That quiz didn’t open.' : 'Writing your questions…'}</h2>
        {error && <p className="quiz-error" role="alert">{error}</p>}
        {error && <div className="quiz-actions"><button className="quiz-btn" onClick={leave}>Back to Quizzes</button></div>}
      </>
    );
  } else if (showing === null) {
    /* ---- results ---- */
    const marks = cur.marks || {};
    const n = { red: 0, yellow: 0, green: 0 } as Record<Mark, number>;
    for (const ref of cur.items) if (marks[ref]) n[marks[ref]]++;
    const queued = n.red + n.yellow;
    const scoreN = cur.score ?? 0;
    const passed = scoreN >= passFor(total);
    const signable = !!quizById(id);
    const review = getReview();
    const r = 56, c = 2 * Math.PI * r, frac = total ? scoreN / total : 0;
    const title = id === REVIEW ? `${scoreN} of ${total} right.` : passed ? 'You passed.' : 'Not yet.';
    const text = id === REVIEW ? (review.total ? `${plural(review.total, 'question')} still in your queue.` : 'Your queue is clear. You know it all cold.')
      : id === PRE_SHIFT || !signable ? (passed ? 'You know it.' : 'Drill the ones you missed from your review queue, then try again.')
      : passed ? 'Next: show a manager you know it at the table. They sign you off.' : `You need ${passFor(total)} to pass. Drill your review queue, then try again.`;
    body = (
      <>
        <div className="quiz-head"><span className="quiz-kicker">{kicker} · Done</span><span className="quiz-count">{total} of {total}</span></div>
        <div className="quiz-steps" aria-hidden="true">
          {cur.items.map((ref, i) => <span key={i} className={lookup(ref, cur)?.question.answer === cur.answers[i] ? 'right' : 'wrong'} />)}
        </div>
        <div className="qm-score">
          <div className="qm-ring" aria-hidden="true">
            <svg width="132" height="132" viewBox="0 0 132 132">
              <circle cx="66" cy="66" r={r} fill="none" stroke="#E4DCCF" strokeWidth="14" />
              <circle cx="66" cy="66" r={r} fill="none" stroke={passed || id === REVIEW ? '#4F7A4A' : '#8A5A3A'} strokeWidth="14" strokeLinecap="round"
                strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 66 66)" opacity={scoreN ? 1 : 0} />
            </svg>
            <strong>{scoreN}/{total}</strong>
          </div>
          <div className="qm-score-copy">
            <h2 className="qm-title" id="qm-title" ref={heading} tabIndex={-1}><span className="sr-only">{scoreN} of {total}. </span>{title}</h2>
            <p className="quiz-text">{text}</p>
          </div>
        </div>
        <div className="qm-marked">
          <span className="qb-label">How you marked it</span>
          <div className="qm-pills">{LEVELS.map((l) => <span key={l.key} className={'qm-pill ' + l.key}><i />{n[l.key]} {l.label}</span>)}</div>
          <p>{id === REVIEW
            ? `${plural(n.green, 'question')} came off your queue.${queued ? ` ${queued} stay${queued === 1 ? 's' : ''} for next time.` : ''}`
            : queued ? `${plural(queued, 'question')} went into your review queue. Drill them from the Quizzes page until they’re green.` : 'Nothing new for your review queue.'}</p>
        </div>
        {id !== REVIEW && <NameSave id={id} />}
        <div className="quiz-actions">
          {review.total > 0
            ? <button className="quiz-btn ghost" onClick={() => nav(`/quizzes?quiz=${REVIEW}&retake=1`)}>{id === REVIEW ? 'Practice Again' : 'Practice Review Queue'}</button>
            : <button className="quiz-btn ghost" onClick={() => nav(`/quizzes?quiz=${enc(id)}&retake=1`)}>New Questions</button>}
          <button className="quiz-btn" onClick={leave}>Back to Quizzes</button>
        </div>
      </>
    );
  } else {
    /* ---- a question, then how well you know it ---- */
    const ref = cur.items[showing];
    const item = lookup(ref, cur)!;
    const chosen = cur.answers[showing];
    const answered = chosen !== undefined;
    const right = answered && chosen === item.question.answer;
    const mark = (m: Mark) => { void markAnswer(id, ref, m); setReveal(null); };
    body = (
      <>
        <div className="quiz-head">
          <span className="quiz-kicker">{id === PRE_SHIFT || id === REVIEW ? `${kicker} · ${item.quiz.title}` : `${name} · ${item.quiz.title}`}</span>
          <span className="quiz-count">Question {showing + 1} of {total}</span>
        </div>
        <div className="quiz-steps" aria-hidden="true">{cur.items.map((_, i) => <span key={i} className={i < cur.answers.length ? 'done' : ''} />)}</div>
        <h2 className="quiz-q" id="qm-title" ref={heading} tabIndex={-1}>{item.question.q}</h2>
        <div className="quiz-options" role="group" aria-label="Answers">
          {item.question.options.map((o, i) => {
            const state = !answered ? '' : i === item.question.answer ? 'right' : i === chosen ? 'wrong' : 'dim';
            return (
              <button key={i} className={'quiz-option ' + state} disabled={answered} aria-pressed={answered ? i === chosen : undefined}
                onClick={() => { answer(id, i); setReveal(showing); }}>
                <span className="quiz-letter">{'ABCD'[i]}</span>
                <span className="quiz-option-text">{o}</span>
                {state === 'right' && <Check />}
                {state === 'wrong' && <Cross />}
              </button>
            );
          })}
        </div>
        {answered ? (
          <>
            <p className={'qm-why ' + (right ? 'right' : 'wrong')} aria-live="polite">{right ? 'Correct.' : 'Not quite.'} {item.question.why}</p>
            <div className="qm-rate" role="group" aria-labelledby="qm-rate">
              <span className="qb-label" id="qm-rate">How well do you know this?</span>
              <div className="qm-levels">
                {LEVELS.map((l) => (
                  <button key={l.key} className={'qm-level ' + l.key} onClick={() => mark(l.key)}>
                    <span className="qm-level-label"><i />{l.label}</span>
                    <span className="qm-level-sub">{l.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="qm-foot">
            <button className="quiz-link plain" onClick={leave}>Save and Exit</button>
            <span>Pick an answer to keep going</span>
          </div>
        )}
      </>
    );
  }

  return createPortal(
    <div className="qm-scrim">
      <div className="qm quiz-card" role="dialog" aria-modal="true" aria-labelledby="qm-title" ref={box} onKeyDown={trap}>{body}</div>
    </div>,
    document.body,
  );
}

/** The review queue card: how many questions are red, yellow and green, and the next ones to drill. */
export function ReviewCard({ style, className }: { style: CSSProperties; className: string }) {
  useQuiz();
  const nav = useNavigate();
  const r = getReview();
  useEffect(() => { void loadReview(); }, []);
  const all = r.counts.red + r.counts.yellow + r.counts.green;
  return (
    <div className={className + ' rq'} style={style}>
      <div className="quiz-head"><span className="quiz-kicker">Your review queue</span><span className="quiz-count">{r.total} to work on</span></div>
      <h2 className="rq-title">{r.total ? 'Drill what you don’t know yet' : all ? 'You know it all cold' : 'Mark it, then drill it'}</h2>
      <p className="rq-intro">After every answer, mark how well you know it. Red and yellow come back here until you know them cold.</p>
      <div className="rq-levels">
        {LEVELS.map((l) => <div key={l.key} className={'rq-level ' + l.key}><span className="rq-label"><i />{l.label}</span><strong>{r.counts[l.key]}</strong></div>)}
      </div>
      <div className="rq-bar" aria-hidden="true">{all ? LEVELS.map((l) => (r.counts[l.key] ? <span key={l.key} className={l.key} style={{ flexGrow: r.counts[l.key] }} /> : null)) : <span className="none" />}</div>
      {r.next.length ? (
        <div className="rq-next">
          <span className="qb-label">Up next</span>
          <ul>{r.next.map((q) => <li key={q.ref}><i className={q.mark} aria-label={LEVELS.find((l) => l.key === q.mark)?.label} /><span>{q.q}</span><em>{q.topic}</em></li>)}</ul>
        </div>
      ) : (
        <p className="rq-empty">{all ? 'Nothing red or yellow right now.' : 'Take any quiz and mark each answer. Anything red or yellow lands here.'}</p>
      )}
      <div className="quiz-actions">
        <button className={'quiz-btn' + (r.practice ? ' ghost' : '')} onClick={() => nav('/quizzes?quiz=' + PRE_SHIFT + '&retake=1')}>Pre-Shift Quiz</button>
        {r.practice > 0 && <button className="quiz-btn" onClick={() => nav(`/quizzes?quiz=${REVIEW}&retake=1`)}>Practice {plural(r.practice, 'Question')}</button>}
      </div>
    </div>
  );
}

/** Saves a finished quiz under the signed-in person, so a manager can sign them off. */
function NameSave({ id }: { id: string }) {
  const s = useQuiz();
  const [error, setError] = useState('');
  const cur = s.quizzes[id]?.current;
  useEffect(() => { if (cur?.finished && !cur.saved) save(id).catch((e) => setError(e.message)); }, [cur, id]);
  if (!cur?.finished) return null;
  if (error) return <p className="quiz-error" role="alert">{error} <button className="quiz-link" onClick={() => { setError(''); save(id).catch((e) => setError(e.message)); }}>Try Again</button></p>;
  if (cur.saved) return <p className="quiz-saved">Saved for a manager as {s.name}.</p>;
  return <p className="quiz-saved">Saving…</p>;
}

/** The ring: quizzes passed out of all of them, plus the breakdown. */
export function ProgressCard({ style, className }: { style: CSSProperties; className: string }) {
  const s = useQuiz();
  useEffect(() => { refreshSignoffs(); }, []);
  const statuses = QUIZZES.map((q) => statusOf(s, q.id));
  const signed = statuses.filter((x) => x === 'signed').length;
  const passed = statuses.filter((x) => x === 'signed' || x === 'passed').length;
  const progress = statuses.filter((x) => x === 'progress' || x === 'retry').length;
  const toGo = QUIZZES.length - passed - progress;
  // Nov 5, Tommy: "sign offs are not showing correctly" (1 passed, but the pills read 0 · 0 · 31). Passed-but-not-yet-
  // signed quizzes get their own pill, so the pills always add up to the total.
  const waiting = passed - signed;
  const r = 80, c = 2 * Math.PI * r, frac = QUIZZES.length ? passed / QUIZZES.length : 0;
  return (
    <div className={className + ' quiz-progress'} style={style}>
      <span className="quiz-kicker light">Your sign-offs</span>
      <div className="quiz-ring">
        <svg width="180" height="180" viewBox="0 0 180 180" aria-hidden="true">
          <circle cx="90" cy="90" r={r} fill="none" stroke="#3A3632" strokeWidth="18" />
          <circle cx="90" cy="90" r={r} fill="none" stroke="#C49A6C" strokeWidth="18" strokeLinecap={frac >= 0.12 ? 'round' : 'butt'}
            strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 90 90)" opacity={passed ? 1 : 0} />
        </svg>
        <div className="quiz-ring-count"><strong>{passed} of {QUIZZES.length}</strong><span>passed</span></div>
      </div>
      <span className="quiz-who">{s.name || 'Front of House · Week 1'}</span>
      <div className="quiz-pills">
        <span className="pill green">{signed} signed off</span>
        {waiting > 0 && <span className="pill green">{waiting} passed · waiting on a manager</span>}
        <span className="pill copper">{progress} in progress</span>
        <span className="pill dark">{toGo} to go</span>
      </div>
    </div>
  );
}


const Check = () => <svg className="quiz-mark" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3F6A39" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Right answer"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const Cross = () => <svg className="quiz-mark" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A1271F" strokeWidth="2.4" strokeLinecap="round" aria-label="Your answer"><path d="M6 6l12 12M18 6L6 18" /></svg>;
