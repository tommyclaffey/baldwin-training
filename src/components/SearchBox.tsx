import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import type { IndexEntry as Entry } from '../lib/api';

/** Searches every page title and its text. */
export function SearchBox({ style }: { style?: CSSProperties }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const { index: ENTRIES } = useSession();
  const box = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const scored: { e: Entry; s: number }[] = [];
    for (const e of ENTRIES) {
      const t = e.title.toLowerCase();
      let s = 0;
      if (t === term) s = 100;
      else if (t.startsWith(term)) s = 60;
      else if (t.includes(term)) s = 40;
      else if (e.name.toLowerCase().includes(term)) s = 25;
      else if (e.text.toLowerCase().includes(term)) s = 10;
      if (s) scored.push({ e, s: s - e.name.split(' · ').length });
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.e);
  }, [q, ENTRIES]);

  const go = (e: Entry) => { setOpen(false); setQ(''); nav('/' + e.slug); };

  return (
    <div className="search" style={{ ...style, position: 'relative' }} ref={box}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5E574F" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        aria-label="Search the training book"
        placeholder="Search dishes, ingredients, allergens…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && results[active]) go(results[active]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 && (
        <ul className="search-results" role="listbox">
          {results.length === 0 && <li className="search-empty">Nothing found for “{q}”.</li>}
          {results.map((e, i) => (
            <li key={e.slug} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseDown={() => go(e)} onMouseEnter={() => setActive(i)}>
              <span className="search-title">{e.title}</span>
              <span className="search-section">{e.name.split(' · ').slice(0, -1).join(' · ') || 'Page'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
