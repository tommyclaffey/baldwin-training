// Build a quiz (Quizzes page, designed in Figma: Quizzes · Desktop → Section · Build a quiz).
// Pick topics and a length; the server writes the questions from the book. Managers can save the mix for the team.
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, canEdit } from '../lib/api';
import { useSession } from '../lib/session';
import { getCatalog, loadCatalog, start, useQuiz } from './store';

const LENGTHS = [5, 10, 20];

export function QuizBuilder({ style, className }: { style: CSSProperties; className: string }) {
  useQuiz(); // re-render when the catalog arrives
  const { user } = useSession();
  const nav = useNavigate();
  const topics = getCatalog().topics;
  const [picked, setPicked] = useState<string[]>([]);
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState('');
  const groups = useMemo(() => [...new Set(topics.map((t) => t.group))].map((g) => ({ g, items: topics.filter((t) => t.group === g) })), [topics]);
  const chosen = topics.filter((t) => picked.includes(t.key));
  const pool = chosen.reduce((n, t) => n + t.count, 0);
  const toggle = (k: string) => { setSaved(''); setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k])); };
  const toggleGroup = (keys: string[]) => { setSaved(''); setPicked((p) => (keys.every((k) => p.includes(k)) ? p.filter((x) => !keys.includes(x)) : [...new Set([...p, ...keys])])); };

  const go = async () => {
    setBusy(true); setError('');
    try {
      const id = await start('', { topics: picked, count });
      nav('/quizzes?quiz=' + encodeURIComponent(id));
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const saveForTeam = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api('/api/quiz/sets', { method: 'POST', body: { name, topics: picked, count } });
      await loadCatalog();
      setSaved(name.trim()); setNaming(false); setName('');
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };

  if (!topics.length) return <div className={className + ' qb'} style={{ ...style, height: 'auto' }}><p className="qb-summary">Quizzes show up once the menu is in.</p></div>;
  return (
    <div className={className + ' qb'} style={{ ...style, height: 'auto', minHeight: 0 }} role="group" aria-label="Build a quiz">
      {groups.map(({ g, items }) => {
        const keys = items.map((t) => t.key), all = keys.every((k) => picked.includes(k));
        return (
          <div key={g} className="qb-group">
            <div className="qb-ghead">
              <span className="qb-label">{g}</span>
              <button type="button" className="qb-all" onClick={() => toggleGroup(keys)}>{all ? 'Clear' : 'Select All'}<span className="sr-only"> {g}</span></button>
            </div>
            <div className="qb-tiles">
              {items.map((t) => {
                const on = picked.includes(t.key);
                return (
                  <button key={t.key} type="button" className={'qb-tile' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggle(t.key)}>
                    <span className="qb-tile-name">{t.label}</span>
                    <span className="qb-tile-foot">
                      <span className="qb-tile-count">{t.count} questions</span>
                      <span className="qb-check" aria-hidden="true">{on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1E1C1A" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <hr className="qb-divider" />
      <div className="qb-footer">
        <div className="qb-length">
          <span className="qb-label">Questions</span>
          <div className="qb-seg" role="radiogroup" aria-label="How many questions">
            {LENGTHS.map((n) => <button key={n} type="button" role="radio" aria-checked={count === n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>{n}</button>)}
          </div>
          <span className="qb-summary">
            {chosen.length ? `${chosen.length} subject${chosen.length === 1 ? '' : 's'} · ${pool} questions to pick from` : 'Pick one or more subjects.'}
          </span>
        </div>
        <div className="qb-buttons">
          {canEdit(user) && <button type="button" className="qb-btn ghost" disabled={!chosen.length || busy} onClick={() => setNaming((v) => !v)}>Save for the Team</button>}
          <button type="button" className="qb-btn" disabled={!chosen.length || busy} onClick={() => void go()}>{busy ? 'Writing…' : 'Start Quiz'}</button>
        </div>
      </div>
      {naming && (
        <form className="qb-name" onSubmit={saveForTeam}>
          <label><span className="qb-label">Name for the team</span>
            <input value={name} maxLength={60} autoFocus placeholder="Bar knowledge · week 2" onChange={(e) => setName(e.target.value)} /></label>
          <button className="qb-btn" disabled={!name.trim() || busy}>Save Quiz</button>
          <span className="qb-summary">It joins everyone’s sign-off list, with {count} questions from what you picked.</span>
        </form>
      )}
      {saved && <p className="qb-saved" role="status">“{saved}” is on everyone’s list now.</p>}
      {error && <p className="quiz-error" role="alert">{error}</p>}
    </div>
  );
}
