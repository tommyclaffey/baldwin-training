import { focusImg } from '../lib/focus';
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import type { IndexEntry as Entry } from '../lib/api';

/** Lower case, accents off: "anejo" finds "Añejo". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Where a page lives, in plain words: "Classic cocktail", "Spirit · Vodka", "Wine · Red". */
function kicker(e: Entry) {
  const parts = e.name.split(' · ');
  const head = parts.slice(0, -1);
  if (!head.length) return e.nav === 'Home' && e.slug ? 'Page' : e.nav || 'Page';
  if (head[0] === 'Classic') return 'Classic cocktail';
  if (head[0] === 'Signature') return 'Our cocktail';
  if (head[0] === 'Recipe') return 'Recipe';
  if (/^Step \d/.test(head[0])) return 'Steps of Service';
  return head.join(' · ');
}

function initials(title: string) {
  const step = title.match(/^Step (\d)/);
  if (step) return step[1];
  return title.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

/** Bold the part of the title that matches what was typed. */
function mark(title: string, term: string): ReactNode {
  const i = fold(title).indexOf(term);
  if (i < 0 || !term) return title;
  return <>{title.slice(0, i)}<mark>{title.slice(i, i + term.length)}</mark>{title.slice(i + term.length)}</>;
}

/** Searches every page as you type, with a photo, the name and one line about it. */
export function SearchBox({ style }: { style?: CSSProperties }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const { index } = useSession();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  const folded = useMemo(() => index.map((e) => ({ e, t: fold(e.title), n: fold(e.name), x: fold(e.text || '') })), [index]);
  const term = fold(q.trim());

  const results = useMemo(() => {
    if (!term) return [];
    const scored: { e: Entry; s: number }[] = [];
    for (const { e, t, n, x } of folded) {
      let s = 0;
      if (t === term) s = 100;
      else if (t.startsWith(term)) s = 70;
      else if (t.split(/[\s-]+/).some((w) => w.startsWith(term))) s = 55;
      else if (term.length >= 2 && t.includes(term)) s = 40;
      else if (term.length >= 2 && n.includes(term)) s = 25;
      else if (term.length >= 3 && (' ' + x).includes(' ' + term)) s = 10;
      if (s) scored.push({ e, s: s - e.name.split(' · ').length * 2 });
    }
    return scored.sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title)).slice(0, 7).map((x) => x.e);
  }, [term, folded]);

  const go = (e: Entry) => { setOpen(false); setQ(''); nav('/' + e.slug); };
  const show = open && term.length > 0;

  // The list sits on the page body, placed under the box, so the top bar's clipping and the page zoom can't cut it off.
  const [pos, setPos] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!show) return;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const vw = document.documentElement.clientWidth;
      const width = Math.min(Math.max(r.width, 460), vw - 24);
      const left = Math.max(12, Math.min(r.left, vw - width - 12));
      setPos({ top: r.bottom + 6, left, width, maxHeight: Math.max(220, window.innerHeight - r.bottom - 24) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [show]);

  return (
    <div className="search" style={{ ...style, position: 'relative' }} ref={box}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5E574F" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && results[active] ? `${listId}-${active}` : undefined}
        aria-label="Search the training app"
        placeholder="Search dishes, drinks, wine, service…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && results[active]) go(results[active]);
          if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {q && <button type="button" className="search-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(''); setActive(0); }}>✕</button>}
      {show && createPortal(
        <ul className="search-results" role="listbox" id={listId} style={pos}>
          {results.length === 0 && <li className="search-empty">Nothing found for “{q.trim()}”. Try a dish, a drink or an ingredient.</li>}
          {results.map((e, i) => (
            <li key={e.slug} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
              onMouseDown={(ev) => { ev.preventDefault(); go(e); }} onMouseEnter={() => setActive(i)}>
              {e.thumb
                ? <img className="search-thumb" src={e.thumb} style={focusImg(e.thumb)} alt="" loading="lazy" />
                : <span className="search-thumb search-initials" aria-hidden="true">{initials(e.title)}</span>}
              <span className="search-copy">
                <span className="search-section">{kicker(e)}</span>
                <span className="search-title">{mark(e.title, term)}</span>
                {e.blurb && <span className="search-blurb">{e.blurb}</span>}
              </span>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
