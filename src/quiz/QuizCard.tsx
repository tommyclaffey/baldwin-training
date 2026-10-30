// The live quiz card and the progress ring on the Quizzes page. Built to match the Figma design (Quizzes · Desktop).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PRE_SHIFT, QUIZZES, answer, lookup, nextQuiz, passFor, quizById, refreshSignoffs, save, start, statusOf, titleOf, useQuiz } from './store';

/** A custom quiz id ("c:house+wine-glass:10") back into what to ask for. */
const customOf = (id: string) => { const m = /^c:([^:]+):(\d+)$/.exec(id); return m ? { topics: m[1].split('+'), count: Number(m[2]) } : undefined; };
const enc = encodeURIComponent;

export function QuizCard({ style, className }: { style: CSSProperties; className: string }) {
  const s = useQuiz();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const id = params.get('quiz') || '';
  const valid = id === PRE_SHIFT || !!quizById(id) || !!customOf(id) || /^(t|s):/.test(id);
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState<number | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { refreshSignoffs(); }, []);

  // Opening a quiz: resume one in progress, start a new one, or restart on "Retake".
  useEffect(() => {
    if (!valid) return;
    const cur = s.quizzes[id]?.current;
    const retake = params.get('retake') === '1';
    // Attempts saved before the quizzes were written from the book have no questions with them: start fresh.
    if (retake || !cur || !cur.questions || (id === PRE_SHIFT && cur.finished)) { setError(''); start(id, customOf(id)).catch((e) => setError((e as Error).message)); }
    if (retake) { params.delete('retake'); setParams(params, { replace: true }); }
    setReveal(null);
    const el = card.current;
    if (el && el.getBoundingClientRect().top < 0 || (el && el.getBoundingClientRect().top > window.innerHeight * 0.6)) el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, params.get('retake')]);

  const found = valid ? s.quizzes[id]?.current : undefined;
  const cur = found?.questions ? found : undefined;
  const name = cur?.title || titleOf(id);
  const kicker = id === PRE_SHIFT ? 'Pre-shift quiz' : id.startsWith('c:') ? 'Your quiz' : 'Sign-off quiz';

  /* ---- intro: no quiz picked (or it's loading) ---- */
  if (!valid || !cur) {
    const next = nextQuiz(s);
    if (valid && !error) return (
      <div ref={card} className={className + ' quiz-card'} style={style}>
        <div className="quiz-head"><span className="quiz-kicker">{kicker}</span><span className="quiz-count" /></div>
        <h2 className="quiz-q">Writing your questions…</h2>
      </div>
    );
    return (
      <div ref={card} className={className + ' quiz-card'} style={style}>
        <div className="quiz-head">
          <span className="quiz-kicker">{next ? `Next up · ${next.title}` : 'All quizzes passed'}</span>
          <span className="quiz-count">{next ? `${next.count} questions` : ''}</span>
        </div>
        <div className="quiz-steps" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <span key={i} />)}</div>
        {error && <p className="quiz-error" role="alert">{error}</p>}
        <h2 className="quiz-q">{next ? `Ready for ${next.title}?` : QUIZZES.length ? 'Nice work. Every quiz is passed.' : 'Quizzes show up once the menu is in.'}</h2>
        <p className="quiz-text">
          {next
            ? `${next.count} questions from the book, about ${Math.max(2, Math.round(next.count / 3))} minutes. Get ${passFor(next.count)} right to pass, then a manager signs you off.`
            : QUIZZES.length ? 'Ask a manager to sign off anything still waiting, or build your own quiz below.' : 'Every quiz is written from your dishes, drinks and wines.'}
        </p>
        <div className="quiz-actions">
          <button className="quiz-btn ghost" onClick={() => nav('/quizzes?quiz=' + PRE_SHIFT)}>Pre-Shift Quiz</button>
          {next && <button className="quiz-btn" onClick={() => nav('/quizzes?quiz=' + enc(next.id))}>{statusOf(s, next.id) === 'progress' ? 'Continue' : 'Start'} Quiz <Arrow /></button>}
        </div>
      </div>
    );
  }

  const total = cur.items.length;
  const showing = reveal ?? (cur.finished ? null : cur.answers.length);

  /* ---- results ---- */
  if (showing === null) {
    const passed = (cur.score ?? 0) >= passFor(total);
    const missed = cur.items.map((ref, i) => ({ ref, i, ...lookup(ref, cur)! })).filter((x) => x.question && x.question.answer !== cur.answers[x.i]);
    const following = id === PRE_SHIFT || id.startsWith('c:') ? null : nextQuiz(s);
    const signable = !!quizById(id);
    return (
      <div ref={card} className={className + ' quiz-card'} style={style}>
        <div className="quiz-head">
          <span className="quiz-kicker">{id === PRE_SHIFT ? kicker : `${kicker} · ${name}`}</span>
          <span className="quiz-count">Done</span>
        </div>
        <div className="quiz-steps" aria-hidden="true">
          {cur.items.map((ref, i) => <span key={i} className={lookup(ref, cur)?.question.answer === cur.answers[i] ? 'right' : 'wrong'} />)}
        </div>
        <h2 className="quiz-q" ref={heading} tabIndex={-1}>{cur.score} of {total}. {passed ? 'You passed.' : 'Not yet.'}</h2>
        <p className="quiz-text">
          {id === PRE_SHIFT || !signable
            ? passed ? 'You know it.' : 'Read up on the ones you missed, then try again.'
            : passed ? 'Next: show a manager you know it at the table. They sign you off.' : `You need ${passFor(total)} to pass. Review the pages, then try again.`}
        </p>
        {missed.length > 0 && (
          <ul className="quiz-missed">
            {missed.map((m) => (
              <li key={m.ref}>
                <strong>{m.question.q}</strong>
                <span>Answer: {m.question.options[m.question.answer]}. {m.question.why}</span>
                <Link to={m.quiz.page}>Review {m.quiz.title}</Link>
              </li>
            ))}
          </ul>
        )}
        <NameSave id={id} />
        <div className="quiz-actions">
          <button className="quiz-btn ghost" onClick={() => nav(`/quizzes?quiz=${enc(id)}&retake=1`)}>New Questions</button>
          {following
            ? <button className="quiz-btn" onClick={() => nav('/quizzes?quiz=' + enc(following.id))}>Next: {following.title} <Arrow /></button>
            : <button className="quiz-btn" onClick={() => nav('/quizzes')}>Back to Quizzes</button>}
        </div>
      </div>
    );
  }

  /* ---- a question ---- */
  const ref = cur.items[showing];
  const item = lookup(ref, cur)!;
  const chosen = cur.answers[showing];
  const answered = chosen !== undefined;
  const right = answered && chosen === item.question.answer;
  const last = showing === total - 1;
  return (
    <div ref={card} className={className + ' quiz-card'} style={style}>
      <div className="quiz-head">
        <span className="quiz-kicker">{`${id === PRE_SHIFT ? kicker : name} · ${item.quiz.title}`}</span>
        <span className="quiz-count">Question {showing + 1} of {total}</span>
      </div>
      <div className="quiz-steps" aria-hidden="true">{cur.items.map((_, i) => <span key={i} className={i < cur.answers.length ? 'done' : ''} />)}</div>
      <h2 className="quiz-q" ref={heading} tabIndex={-1}>{item.question.q}</h2>
      <div className="quiz-options" role="group" aria-label="Answers">
        {item.question.options.map((o, i) => {
          const state = !answered ? '' : i === item.question.answer ? 'right' : i === chosen ? 'wrong' : 'dim';
          return (
            <button key={i} className={'quiz-option ' + state} disabled={answered}
              aria-pressed={answered ? i === chosen : undefined}
              onClick={() => { answer(id, i); setReveal(showing); }}>
              <span className="quiz-letter">{'ABCD'[i]}</span>
              <span className="quiz-option-text">{o}</span>
              {state === 'right' && <Check />}
              {state === 'wrong' && <Cross />}
            </button>
          );
        })}
      </div>
      <div className="quiz-feedback" aria-live="polite">
        <span className={'quiz-why ' + (answered ? (right ? 'right' : 'wrong') : '')}>
          {answered ? `${right ? 'Correct.' : 'Not quite.'} ${item.question.why}` : ''}
        </span>
        {answered && (
          <button className="quiz-btn" onClick={() => { setReveal(null); requestAnimationFrame(() => heading.current?.focus()); }}>
            {last ? 'See Results' : 'Next Question'} <Arrow />
          </button>
        )}
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
  const r = 80, c = 2 * Math.PI * r, frac = QUIZZES.length ? passed / QUIZZES.length : 0;
  return (
    <div className={className + ' quiz-progress'} style={style}>
      <span className="quiz-kicker light">Your sign-offs</span>
      <div className="quiz-ring">
        <svg width="180" height="180" viewBox="0 0 180 180" aria-hidden="true">
          <circle cx="90" cy="90" r={r} fill="none" stroke="#3A3632" strokeWidth="18" />
          <circle cx="90" cy="90" r={r} fill="none" stroke="#C49A6C" strokeWidth="18" strokeLinecap="round"
            strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 90 90)" opacity={passed ? 1 : 0} />
        </svg>
        <div className="quiz-ring-count"><strong>{passed} of {QUIZZES.length}</strong><span>passed</span></div>
      </div>
      <span className="quiz-who">{s.name || 'Front of House · Week 1'}</span>
      <div className="quiz-pills">
        <span className="pill green">{signed} signed off</span>
        <span className="pill copper">{progress} in progress</span>
        <span className="pill dark">{toGo} to go</span>
      </div>
    </div>
  );
}

const Arrow = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const Check = () => <svg className="quiz-mark" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3F6A39" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Right answer"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const Cross = () => <svg className="quiz-mark" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A1271F" strokeWidth="2.4" strokeLinecap="round" aria-label="Your answer"><path d="M6 6l12 12M18 6L6 18" /></svg>;
