// The parts of a page that turn into fields in Edit Mode (Figma 533:274): text typed in place, taste words and allergens
// as pills, the hero photo's Replace Photo, and a cocktail's spec as an inline editor.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react';
import { MediaPicker } from '../components/MediaPicker';
import { PhotoAdjust } from '../admin/PhotoAdjust';
import { useField, useEditMode, type EdBind } from './state';

const ICON = '/img/edit/';
const Icon = ({ name, size = 16 }: { name: string; size?: number }) => <img src={ICON + name + '.svg'} width={size} height={size} alt="" aria-hidden="true" className="em-icon" />;

/** What a field is called, for screen readers ("Tagline", "Steps 2 · detail"). */
const LABEL: Record<string, string> = {
  name: 'Name', tagline: 'Line under the name', description: 'Description', price: 'Price', glass: 'Glass', garnish: 'Garnish', station: 'Station',
  tasteLine: 'How it tastes', spiritName: 'The spirit', spiritLine: 'Why this spirit', pour: 'Our pour', say: 'Say it at the table', story: 'The story',
  ingredients: 'Ingredients', sellingLine: 'Selling line', dropMain: 'Drop · main', dropSide: 'Drop · side', dropSauce: 'Drop · sauce',
  talkingPoints: 'Talking point', components: 'Component', steps: 'Step', inspiration: 'The story', sellingPoints: 'Selling point',
  grape: 'Varietal', region: 'Region', half: 'Half bottle price', bottle: 'Bottle price', notes: 'Notes', tap: 'Tap', abv: 'ABV',
};
export function fieldLabel(k: string) {
  const [top, i, sub] = k.split('.');
  const base = LABEL[top] || top;
  return [base + (i !== undefined ? ' ' + (Number(i) + 1) : ''), sub].filter(Boolean).join(' · ');
}

/* ---------------------------------- text ---------------------------------- */

/** A text on the page, typed into where it sits. Keeps the design's type; the saved value shows (not the staff view). */
export function EditText({ ed, st, cls }: { ed: EdBind; st: CSSProperties; cls: string[] }) {
  const f = useField(ed)!;
  const ref = useRef<HTMLSpanElement>(null);
  const list = ed.t === 'list';
  const toText = (v: unknown) => (list ? (Array.isArray(v) ? v.join(ed.sep || ', ') : String(v ?? '')) : String(v ?? ''));
  const parse = (s: string): unknown => (list ? s.split(/\s*[·,]\s*/).map((x) => x.trim()).filter(Boolean) : ed.n ? s.replace(/^\s*\$\s*/, '') : s);
  const text = toText(f.value);
  // The field follows the value when it changes from outside (Discard, a saved page); never while it already matches.
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (JSON.stringify(parse(el.textContent || '')) !== JSON.stringify(list ? f.value || [] : String(f.value ?? ''))) el.textContent = text;
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (e: RKeyboardEvent) => {
    if (e.key === 'Escape') { (e.target as HTMLElement).blur(); return; }
    if (e.key === 'Enter' && (!ed.m || e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLElement).blur(); }
  };
  const style: CSSProperties = { ...st, textTransform: ed.u ? 'uppercase' : undefined, whiteSpace: ed.m ? 'pre-wrap' : st.whiteSpace };
  const label = fieldLabel(ed.k);
  return (
    <div className={cls.concat('ed-text', ed.cell ? 'ed-cell' : '', ed.m ? 'ed-m' : '', ed.dk ? 'ed-dark' : '', f.changed ? 'ed-changed' : '').filter(Boolean).join(' ')} style={style}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (document.activeElement !== ref.current) ref.current?.focus(); }}>
      {ed.pre && <span className="ed-affix" aria-hidden="true">{ed.pre}</span>}
      <span ref={ref} className="ed-input" contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-label={label}
        aria-multiline={ed.m ? true : undefined} aria-required={ed.req ? true : undefined} data-ph={ed.ph || ''} spellCheck
        onInput={(e) => f.set(parse(e.currentTarget.textContent || ''))} onKeyDown={key}
        onPaste={(e) => { e.preventDefault(); const t = e.clipboardData.getData('text/plain'); document.execCommand('insertText', false, ed.m ? t : t.replace(/\s*\n\s*/g, ' ')); }} />
      {ed.suf && <span className="ed-affix" aria-hidden="true">{ed.suf}</span>}
      <span className="ed-hint" aria-hidden="true"><Icon name="hint-pen" size={12} />Tap to edit</span>
    </div>
  );
}

/* ---------------------------------- pills ---------------------------------- */

/** Taste words: each pill comes off with ×, and a new one is typed at the end. */
export function TagsEditor({ ed }: { ed: EdBind }) {
  const f = useField(ed)!;
  const words = (Array.isArray(f.value) ? f.value : []) as string[];
  const [draft, setDraft] = useState('');
  const add = () => { const w = draft.trim().replace(/,$/, ''); if (w && !words.some((x) => x.toLowerCase() === w.toLowerCase())) f.set([...words, w]); setDraft(''); };
  return (
    <div className="ed-tags" role="group" aria-label="Taste words">
      {words.map((w) => (
        <span key={w} className="ed-pill">{w}
          <button type="button" aria-label={`Remove ${w}`} onClick={() => f.set(words.filter((x) => x !== w))}><Icon name="remove" size={14} /></button>
        </span>
      ))}
      <label className="ed-pill ed-pill-add">
        <span className="sr-only">Add a taste word</span>
        <Icon name="plus" size={14} />
        <input value={draft} placeholder="Add a word" size={Math.max(10, draft.length + 1)}
          onChange={(e) => { const v = e.target.value; if (v.endsWith(',')) { setDraft(v.slice(0, -1)); setTimeout(add); } else setDraft(v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !draft && words.length) f.set(words.slice(0, -1)); }}
          onBlur={add} />
      </label>
    </div>
  );
}

/** Allergens: every allergen as a pill, ticked ones filled. */
export function ChipsEditor({ ed }: { ed: EdBind }) {
  const f = useField(ed)!;
  const on = (Array.isArray(f.value) ? f.value : []) as string[];
  const opts = ed.opts || [];
  return (
    <div className="ed-chips" role="group" aria-label="Allergens">
      {opts.map((o) => {
        const sel = on.includes(o);
        return <button key={o} type="button" className={'ed-chip' + (sel ? ' on' : '')} aria-pressed={sel}
          onClick={() => f.set(sel ? on.filter((x) => x !== o) : opts.filter((x) => x === o || on.includes(x)))}>{o.toUpperCase()}</button>;
      })}
    </div>
  );
}

/* ---------------------------------- photo ---------------------------------- */

/** Replace Photo (and Adjust Photo) on a hero photo. The same picker and focus tool as the photo fields in the forms. */
export function PhotoTools({ ed }: { ed: EdBind }) {
  const f = useField(ed)!;
  const [pick, setPick] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const v = String(f.value || '');
  return (
    <div className="ed-photo-tools" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <button type="button" className="ed-photo-btn" onClick={() => setPick(true)}><Icon name="camera" />{v ? 'Replace Photo' : 'Add Photo'}</button>
      {v && <button type="button" className="ed-photo-btn" onClick={() => setAdjust(true)}>Adjust Photo</button>}
      {pick && <MediaPicker kind="image" title="Main photo" onClose={() => setPick(false)} onPick={(x) => { if ('img' in x) f.set(x.img); setPick(false); }} />}
      {adjust && v && <PhotoAdjust value={v} label="Main photo" onClose={() => setAdjust(false)} onSave={(x) => { f.set(x); setAdjust(false); }} />}
    </div>
  );
}

/* ---------------------------------- the spec ---------------------------------- */

type Row = { id: number; amount: string; ingredient: string; link?: string; spirit?: boolean; was?: string };
type Build = { amount?: string; ingredient?: string; link?: string; spirit?: boolean }[];
const METHODS = ['Shake', 'Stir', 'Build'];
const PAST: Record<string, string> = { Shake: 'Shaken', Stir: 'Stirred', Build: 'Built' };
/** Which of Shake / Stir / Build a method starts with ("Shake, double strain" → Shake). */
function verbOf(m: string) {
  const lead = m.split(',')[0].trim().toLowerCase();
  if (/^(hard |dry )?shak/.test(lead)) return 'Shake';
  if (/^stir/.test(lead)) return 'Stir';
  if (/^buil/.test(lead)) return 'Build';
  return '';
}
let rowId = 0;

/** The Spec, as an inline editor: amounts and ingredients as fields, drag to reorder, "was 1 oz" under a changed amount,
 *  Add an Ingredient, Shake / Stir / Build, glass and garnish. Saves into the build that Cocktail Specs and the quizzes read. */
export function SpecEditor({ ed, title }: { ed: EdBind; title: ReactNode }) {
  const { reset } = useEditMode();
  const build = useField({ ...ed, k: 'build' })!;
  const method = useField({ ...ed, k: 'method' })!;
  const glass = useField({ ...ed, k: 'glass' })!;
  const garnish = useField({ ...ed, k: 'garnish' })!;
  const savedRows = ((build.saved as Build) || []).filter((b) => b && (b.amount || b.ingredient));
  const make = (): Row[] => ((build.value as Build) || []).filter((b) => b && (b.amount || b.ingredient)).map((b) => {
    const orig = savedRows.find((s) => s.ingredient && s.ingredient === b.ingredient);
    return { id: ++rowId, amount: b.amount || '', ingredient: b.ingredient || '', link: b.link, spirit: b.spirit, was: orig?.amount };
  });
  const [rows, setRows] = useState<Row[]>(make);
  // Discard or a save starts the editor again from the saved spec.
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setRows(make()); }, [reset]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (next: Row[]) => {
    setRows(next);
    build.set(next.map(({ amount, ingredient, link, spirit }) => ({ amount, ingredient, link: link || '', spirit: !!spirit })));
  };
  const patch = (id: number, p: Partial<Row>) => commit(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const move = (from: number, to: number) => { if (to < 0 || to >= rows.length || from === to) return; const next = [...rows]; const [r] = next.splice(from, 1); next.splice(to, 0, r); commit(next); };

  // Drag a row by its handle (mouse, touch or pen); arrow keys on the handle move it too.
  const list = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const startDrag = (e: React.PointerEvent, id: number) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(id);
  };
  const onDrag = (e: React.PointerEvent) => {
    if (dragging == null || !list.current) return;
    const els = [...list.current.querySelectorAll<HTMLElement>('[data-row]')];
    const from = rows.findIndex((r) => r.id === dragging);
    let to = els.findIndex((el) => { const b = el.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
    if (to < 0) to = els.length - 1; else if (to > from) to -= 1;
    if (to !== from) move(from, to);
  };
  const max = 8;
  const verb = verbOf(String(method.value || ''));
  const setVerb = (v: string) => {
    const cur = String(method.value || '');
    const word = ed.past ? PAST[v] : v;
    const rest = verbOf(cur) ? cur.split(',').slice(1).join(',').trim() : '';
    method.set(rest ? `${word}, ${rest}` : word);
  };
  const glasses = [...new Set([...(ed.glasses || []), ...(glass.value ? [String(glass.value)] : [])])];
  const shown = (v: string) => (ed.past ? PAST[v] : v);

  return (
    <div className="ed-spec">
      {title}
      <div ref={list} className="ed-spec-rows" onPointerMove={onDrag} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
        {rows.map((r, i) => {
          const changed = r.was !== undefined && r.was !== r.amount;
          return (
            <div key={r.id} data-row className={'ed-spec-row' + (dragging === r.id ? ' dragging' : '')}>
              <button type="button" className="ed-drag" aria-label={`Move ${r.ingredient || 'this ingredient'}. Use the up and down arrow keys.`}
                onPointerDown={(e) => startDrag(e, r.id)}
                onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(i, i + (e.key === 'ArrowUp' ? -1 : 1)); requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>('.ed-drag')[i + (e.key === 'ArrowUp' ? -1 : 1)]?.focus()); } }}>
                <Icon name="drag" />
              </button>
              <input className={'ed-amount' + (changed ? ' changed' : '')} value={r.amount} placeholder="1 oz" aria-label={`Amount of ${r.ingredient || 'ingredient ' + (i + 1)}`} onChange={(e) => patch(r.id, { amount: e.target.value })} maxLength={30} />
              <input className="ed-ingredient" value={r.ingredient} placeholder="Ingredient" aria-label={`Ingredient ${i + 1}`} onChange={(e) => patch(r.id, { ingredient: e.target.value })} maxLength={80} />
              {changed && <span className="ed-was">was {r.was || 'empty'}</span>}
              <button type="button" className="ed-remove" aria-label={`Remove ${r.ingredient || 'this ingredient'}`} onClick={() => commit(rows.filter((x) => x.id !== r.id))}><Icon name="remove" /></button>
            </div>
          );
        })}
      </div>
      <button type="button" className="ed-add" disabled={rows.length >= max} onClick={() => {
        const next = [...rows, { id: ++rowId, amount: '', ingredient: '' }];
        setRows(next);
        requestAnimationFrame(() => [...(list.current?.querySelectorAll<HTMLInputElement>('.ed-amount') || [])].pop()?.focus());
      }}>
        <Icon name="plus" />{rows.length >= max ? `Up to ${max} ingredients` : 'Add an Ingredient'}
      </button>
      <div className="ed-spec-more">
        <div className="ed-spec-field">
          <span className="ed-label" id={`m-${ed.e}`}>METHOD</span>
          <div className="ed-segments" role="radiogroup" aria-labelledby={`m-${ed.e}`}>
            {METHODS.map((m) => <button key={m} type="button" role="radio" aria-checked={verb === m} className={verb === m ? 'on' : ''} onClick={() => setVerb(m)}>{shown(m)}</button>)}
          </div>
          {String(method.value || '') && String(method.value) !== shown(verb) && <span className="ed-method-note">{String(method.value)}</span>}
        </div>
        <label className="ed-spec-field">
          <span className="ed-label">GLASS</span>
          <span className="ed-select">
            <select value={String(glass.value || '')} onChange={(e) => glass.set(e.target.value)}>
              {!glass.value && <option value="">Pick a glass</option>}
              {glasses.map((g) => <option key={g}>{g}</option>)}
            </select>
            <Icon name="chevron" size={14} />
          </span>
        </label>
        <label className="ed-spec-field grow">
          <span className="ed-label">GARNISH</span>
          <input className="ed-garnish" value={String(garnish.value || '')} placeholder="None" maxLength={80} onChange={(e) => garnish.set(e.target.value)} />
        </label>
      </div>
    </div>
  );
}
