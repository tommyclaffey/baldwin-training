// Start of Shift Count (Nov 12, Figma 09 · Proposals → 31b: desktop 666:818, phone 672:816; note 672:997). Tommy: "log
// how many we have at the beginning of the shift … the amount that they walked in with and then the amount that they're
// prepping." Each item: what it started last shift with, a stepper for what's on the shelf now, and the Used that falls out.
//   Past its use-by: a gentle note with Keep (it counts) or Toss (logged as Expired waste, not counted). No choice = kept;
//     nothing is ever tossed for them (Tommy, Nov 12: "have the user make the decision").
//   Higher than expected: Check this. Used shows "—", never negative. Recount, Log a Batch (the one nobody logged), or Keep.
//   Quarts and pieces are never added together. Finish Later keeps the numbers on this device for today.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { amt, dayLabel, frac, KIND_LABEL, spanLabel, timeOf, UNIT_LABEL, type CountItem, type CountSheet, type Kind } from './data';
import { Avatar, DemoPill, ErrorBox, Head, Ico, KindDot, Loading, Sheet, Toast, useLoad } from './ui';

const EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;
const stepOf = (unit: string) => (unit === 'qt' || unit === 'pt' ? 0.25 : 1);
const quarters = (unit: string) => unit === 'qt' || unit === 'pt';
const GROUP_LINE: Record<Kind, string> = { juice: 'Juices', syrup: 'Syrups', garnish: 'Garnishes' };
const unitLine = (unit: string) => (quarters(unit) ? `${UNIT_LABEL[unit][0].toUpperCase()}${UNIT_LABEL[unit].slice(1)} · ¼ steps` : unit === 'each' ? 'Pieces · whole numbers' : `${UNIT_LABEL[unit] || unit} · whole numbers`);
/** The quick picks under the big number: quarter steps for quarts, round numbers for pieces, up to what it could be. */
function picks(it: CountItem) {
  const top = Math.max(it.last?.expected ?? 0, it.last?.starting ?? 0, it.par, quarters(it.unit) ? 3.5 : 10);
  if (quarters(it.unit)) {
    const out = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5];
    for (let v = 4; v <= Math.ceil(top) && out.length < 14; v++) out.push(v);
    return out;
  }
  const step = [1, 2, 5, 10, 20, 50].find((s) => top / s <= 11) ?? 100;
  return Array.from({ length: Math.ceil(top / step) }, (_, i) => (i + 1) * step);
}
const show = (v: number, unit: string) => (unit === 'each' ? String(v) : amt(v, unit));

type Draft = { vals: Record<number, number | null>; toss: Record<number, number>; past: Record<number, 'keep'>; keep: Record<number, boolean> };
const draftKey = (d: CountSheet) => `bt-prep-count:${d.store}:${d.day}`;

export function CountPage() {
  const { user } = useSession();
  const { data, error, load } = useLoad<CountSheet>('/api/prep/count');
  const [vals, setVals] = useState<Record<number, number | null>>({});
  const [toss, setToss] = useState<Record<number, number>>({});
  const [past, setPast] = useState<Record<number, 'keep'>>({});
  const [keep, setKeep] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [sheet, setSheet] = useState<CountItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');
  const started = useRef(new Date().toISOString());
  const ready = useRef(false);
  const nav = useNavigate();
  useEffect(() => { document.title = 'Shift Count · Prep'; }, []);
  // First load: a saved draft (Finish Later), or today's count if there is one (an edit), or blank.
  useEffect(() => {
    if (!data || ready.current) return;
    ready.current = true;
    try {
      const d = JSON.parse(localStorage.getItem(draftKey(data)) || 'null') as Draft | null;
      if (d) { setVals(d.vals || {}); setToss(d.toss || {}); setPast(d.past || {}); setKeep(d.keep || {}); return; }
    } catch { /* no draft */ }
    const v: Record<number, number | null> = {}, k: Record<number, boolean> = {};
    for (const it of data.items) if (it.today) { v[it.id] = it.today.amount; if (it.today.kept) k[it.id] = true; }
    setVals(v); setKeep(k);
    const first = data.items.find((i) => !i.today) || data.items[0];
    if (first && window.matchMedia('(min-width: 860px)').matches) setOpen(first.id);
  }, [data]);
  const calc = useMemo(() => {
    const out = new Map<number, ReturnType<typeof work>>();
    for (const it of data?.items || []) out.set(it.id, work(it, vals[it.id] ?? null, toss[it.id] || 0, !!keep[it.id]));
    return out;
  }, [data, vals, toss, keep]);
  if (error) return <div className="prp"><ErrorBox error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="prp"><Loading /></div>;
  const items = data.items;
  const set = (id: number, v: number | null) => { setVals((x) => ({ ...x, [id]: v == null ? null : Math.max(0, r2(v)) })); setKeep((x) => ({ ...x, [id]: false })); };
  const counted = items.filter((i) => vals[i.id] != null).length;
  const tossN = items.filter((i) => (toss[i.id] || 0) > 0).length;
  const checkN = items.filter((i) => calc.get(i.id)?.high && !keep[i.id]).length;
  const pastN = items.filter((i) => (calc.get(i.id)?.pastPart || 0) > 0 && !past[i.id]).length;
  const longDay = dayLabel(data.day, { weekday: 'long', month: 'short', day: 'numeric' }).replace(',', '');
  const lastDay = items.find((i) => i.last)?.last?.day;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { items: items.filter((i) => vals[i.id] != null).map((i) => ({ itemId: i.id, amount: vals[i.id], toss: toss[i.id] || 0, keep: !!keep[i.id] && !!calc.get(i.id)?.high })) };
      await api('/api/prep/count', { method: 'POST', body });
      localStorage.removeItem(draftKey(data));
      nav('/prep', { state: { toast: `Count saved: ${body.items.length} of ${items.length}. Prep to par.` } });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const later = () => { localStorage.setItem(draftKey(data), JSON.stringify({ vals, toss, past, keep } satisfies Draft)); nav('/prep', { state: { toast: 'Count kept on this device. Finish it any time today.' } }); };
  const doToss = (it: CountItem) => {
    const c = calc.get(it.id)!;
    setToss((x) => ({ ...x, [it.id]: r2((x[it.id] || 0) + c.pastPart) }));
    setVals((x) => ({ ...x, [it.id]: r2((x[it.id] ?? 0) - c.pastPart) }));
  };
  const undoToss = (it: CountItem) => { const t = toss[it.id] || 0; setToss((x) => ({ ...x, [it.id]: 0 })); setVals((x) => ({ ...x, [it.id]: r2((x[it.id] ?? 0) + t) })); setPast((x) => { const y = { ...x }; delete y[it.id]; return y; }); };
  const recount = (it: CountItem) => { setOpen(it.id); setTimeout(() => document.getElementById(`pad-${it.id}`)?.focus(), 30); };
  if (!data.can.log) return (
    <div className="prp prp-count">
      <Head line={`${longDay} · Start of shift`} title="Shift Count" pills={<DemoPill />} crumbs={<nav className="prp-crumbs" aria-label="Breadcrumb"><Link to="/prep">Bar Prep</Link><span aria-hidden="true">/</span><span aria-current="page">Shift Count</span></nav>} />
      <p className="prp-card prp-pad prp-note">Bartenders and managers count the bar at the start of the shift. {data.counted ? `Today’s count was saved at ${timeOf(data.counted.at)}${data.counted.by ? ' by ' + data.counted.by.name : ''}.` : 'Nobody has counted yet today.'} <Link to="/prep" className="prp-link">Back to Bar Prep {Ico.arrow}</Link></p>
    </div>
  );
  const kinds = (['juice', 'syrup', 'garnish'] as Kind[]).filter((k) => items.some((i) => i.kind === k));
  const me = data.me || (user ? { id: user.id, name: user.name, initials: user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() } : null);
  return (
    <div className="prp prp-count">
      <Head line={`${longDay} · Start of shift`} title="Shift Count"
        crumbs={<nav className="prp-crumbs" aria-label="Breadcrumb"><Link to="/prep">Bar Prep</Link><span aria-hidden="true">/</span><span aria-current="page">Shift Count</span></nav>}
        pills={<><DemoPill /><span className={'prp-pill' + (counted === items.length ? ' good' : '')}>{counted === items.length && Ico.check}{counted} of {items.length} counted</span>
          {tossN > 0 && <span className="prp-pill bad">{tossN} to toss</span>}{pastN > 0 && <span className="prp-pill warn">{pastN} past use-by</span>}{checkN > 0 && <span className="prp-pill warn">{checkN} to check</span>}</>} />
      <ol className="prp-tips" aria-label="How the count works">
        <li><span className="n" aria-hidden="true">1</span><span><strong>Count before you prep</strong>Open bottles, the well cooler and the walk-in. Count what is there now, not what you plan to make.</span></li>
        <li><span className="n" aria-hidden="true">2</span><span><strong>Past its use-by? You decide</strong>Keep it and it counts. Toss it and it’s logged as waste, so Used stays honest.</span></li>
        <li><span className="n" aria-hidden="true">3</span><span><strong>Quarts in ¼ steps, pieces whole</strong>Quarts and pieces are never added together, here or in Reports.</span></li>
      </ol>
      <section className="prp-card prp-countcard" aria-labelledby="wi-title">
        <div className="prp-cc-head">
          <div><h2 id="wi-title">Walked in with</h2><p className="prp-sub">Count what is on the shelf right now. What each item started last shift with sits beside it.</p></div>
          {me && <span className="prp-who-pill"><Avatar p={me} /><span><strong>{me.name}</strong> is counting · started {timeOf(started.current)}</span></span>}
        </div>
        <div className="prp-cc-tools">
          <div className="prp-chips" role="group" aria-label="Show">
            {(['all', ...kinds] as const).map((k) => <button key={k} type="button" className={'prp-chip' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : KIND_LABEL[k]} {k === 'all' ? items.length : items.filter((i) => i.kind === k).length}</button>)}
          </div>
          <p className="prp-sub">Tap a row to open the big number pad</p>
        </div>
        <div className="prp-ct" role="table" aria-label="Walked in with">
          <div className="prp-ct-tr prp-ct-th" role="row"><span role="columnheader">Item</span><span role="columnheader">Last shift started with</span><span role="columnheader">Walked in with</span><span role="columnheader">Used since</span><span role="columnheader" className="r">Shortcuts</span></div>
          {kinds.filter((k) => filter === 'all' || filter === k).map((k) => {
            const list = items.filter((i) => i.kind === k);
            return (
              <div key={k} role="rowgroup">
                <div className="prp-group" role="row"><span role="cell">{GROUP_LINE[k]} · {quarters(list[0].unit) ? `${UNIT_LABEL[list[0].unit]}, ¼ steps` : `${UNIT_LABEL[list[0].unit] || list[0].unit}, whole numbers`}</span></div>
                {list.map((it) => <CountRow key={it.id} it={it} v={vals[it.id] ?? null} c={calc.get(it.id)!} on={open === it.id} tossed={toss[it.id] || 0} pastChoice={past[it.id]} kept={!!keep[it.id]}
                  onOpen={() => setOpen(open === it.id ? null : it.id)} onSet={(v) => set(it.id, v)} onToss={() => doToss(it)} onUndoToss={() => undoToss(it)}
                  onKeepPast={() => setPast((x) => ({ ...x, [it.id]: 'keep' }))} onKeep={() => setKeep((x) => ({ ...x, [it.id]: true }))} onRecount={() => recount(it)} onBatch={() => setSheet(it)} />)}
              </div>
            );
          })}
        </div>
        <div className="prp-savebar" role="region" aria-label="Save the count">
          {me && <Avatar p={me} />}
          <div className="who"><strong>{me?.name} · {dayLabel(data.day, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')}</strong>
            <small>{counted} of {items.length} counted{tossN ? ` · ${tossN} to toss` : ''}{checkN ? ` · ${checkN} to check` : ''}{lastDay ? ` · last count ${dayLabel(lastDay, { weekday: 'short' })}` : ''}</small></div>
          {err && <p className="prp-err onDark" role="alert">{err}</p>}
          <button type="button" className="prp-btn ghostdark" onClick={later}>Finish Later</button>
          <button type="button" className="prp-btn ondark" disabled={busy || counted === 0} onClick={() => void save()}>{Ico.check}{busy ? 'Saving…' : <>Save Count<span className="wide-only"> · {counted} of {items.length} counted</span></>}</button>
        </div>
      </section>
      {sheet && <Sheet kicker="Log a batch" title={`The ${sheet.name.toLowerCase()} nobody logged`} onClose={() => setSheet(null)}>
        <MissedBatch it={sheet} onDone={(m) => { setSheet(null); setToast(m); void load(); }} /></Sheet>}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}

/** One item's numbers from what's typed: Used since, past its use-by, higher than expected. */
function work(it: CountItem, v: number | null, tossed: number, kept: boolean) {
  const expected = it.last?.expected ?? null;
  const expiredLeft = r2(it.expired.reduce((s, b) => s + b.amount, 0) - tossed);
  // What's on the shelf is the newest stock (the oldest goes out first), so anything counted past what's still in date is old.
  const pastPart = v == null ? 0 : r2(Math.min(Math.max(0, v - it.fresh), Math.max(0, expiredLeft)));
  const high = v != null && expected != null && v > expected + EPS;
  const used = v == null || expected == null || high ? null : r2(expected - v);
  let rest = pastPart; const from: string[] = [];
  for (const b of it.expired) { if (rest <= EPS) break; from.push(b.day); rest -= b.amount; }
  return { expected, pastPart, high, used, kept, pastFrom: from.length ? spanLabel(from[from.length - 1], from[0]) : '' };
}

function Stepper({ it, v, onSet, big, id }: { it: CountItem; v: number | null; onSet: (v: number | null) => void; big?: boolean; id?: string }) {
  const step = stepOf(it.unit);
  const [text, setText] = useState(v == null ? '' : String(v));
  useEffect(() => { setText(v == null ? '' : String(v)); }, [v]);
  const commit = (s: string) => { const t = s.trim(); if (t === '') { onSet(null); return; } const n = Number(t); if (Number.isFinite(n) && n >= 0) onSet(quarters(it.unit) ? n : Math.round(n)); else setText(v == null ? '' : String(v)); };
  return (
    <div className={'prp-step' + (big ? ' big' : '')} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="prp-sbtn" aria-label={`Less ${it.name}`} disabled={!v} onClick={() => onSet(Math.max(0, r2((v ?? 0) - step)))}>{Ico.minus}</button>
      <label className="prp-sval"><span className="sr-only">{it.name}, walked in with ({UNIT_LABEL[it.unit] || it.unit})</span>
        <input id={id} type="text" inputMode={quarters(it.unit) ? 'decimal' : 'numeric'} value={text} placeholder="—" onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value); } }} />
        {it.unit !== 'each' && <span className="u" aria-hidden="true">{it.unit}</span>}</label>
      <button type="button" className="prp-sbtn" aria-label={`More ${it.name}`} onClick={() => onSet(r2((v ?? 0) + step))}>{Ico.plusBig}</button>
    </div>
  );
}

type RowProps = {
  it: CountItem; v: number | null; c: ReturnType<typeof work>; on: boolean; tossed: number; pastChoice?: 'keep'; kept: boolean;
  onOpen: () => void; onSet: (v: number | null) => void; onToss: () => void; onUndoToss: () => void; onKeepPast: () => void; onKeep: () => void; onRecount: () => void; onBatch: () => void;
};
function CountRow({ it, v, c, on, tossed, pastChoice, kept, onOpen, onSet, onToss, onUndoToss, onKeepPast, onKeep, onRecount, onBatch }: RowProps) {
  const last = it.last;
  const lastWord = last ? dayLabel(last.day, { weekday: 'short' }) : '';
  const same = c.expected ?? last?.starting ?? null;
  const usedCell = v == null ? <><strong className="none">—</strong><small>{last ? 'not counted yet' : 'first count'}</small></>
    : c.high ? <><strong className="none" aria-label="No used figure">—</strong><small className="warn">{kept ? 'Count kept' : 'Check this'}</small></>
      : c.used == null ? <><strong className="none">—</strong><small>first count</small></>
        : <><strong>{show(c.used, it.unit)}</strong><small>{tossed > 0 ? `${show(tossed, it.unit)} tossed` : `since ${lastWord}`}</small></>;
  const shortcuts = (
    <div className="prp-short" onClick={(e) => e.stopPropagation()}>
      {same != null && <button type="button" className={'prp-chip' + (v != null && Math.abs(v - same) < EPS ? ' on' : '')} aria-pressed={v != null && Math.abs(v - same) < EPS} onClick={() => onSet(same)}>{v != null && Math.abs(v - same) < EPS && Ico.check}Same as Last</button>}
      <button type="button" className={'prp-chip' + (v === 0 ? ' on' : '')} aria-pressed={v === 0} onClick={() => onSet(0)}>{v === 0 && Ico.check}None Left</button>
    </div>
  );
  return (
    <div className={'prp-ct-item' + (on ? ' on' : '')} id={`count-${it.id}`}>
      <div className="prp-ct-tr" role="row" onClick={onOpen}>
        <span role="cell" className="c-item"><KindDot kind={it.kind} /><span className="prp-name"><button type="button" className="prp-rowbtn" aria-expanded={on} aria-controls={`padbox-${it.id}`} onClick={(e) => { e.stopPropagation(); onOpen(); }}>{it.name}</button>
          <small className="desk">{unitLine(it.unit)}</small><small className="phone">{last ? `${lastWord} started with ${show(last.starting, it.unit)}${last.by ? ' · ' + last.by.name : ''}` : 'First count'}</small></span></span>
        <span role="cell" className="c-last">{last ? <><strong>{show(last.starting, it.unit)}</strong><small>{lastWord} {timeOf(last.at)}{last.by ? ` · ${last.by.name}` : ''}</small></> : <><strong className="none">—</strong><small>No count yet</small></>}</span>
        <span role="cell" className="c-step"><Stepper it={it} v={v} onSet={onSet} /></span>
        <span role="cell" className="c-used">{usedCell}</span>
        <span role="cell" className="c-short">{shortcuts}</span>
      </div>
      {on && (
        <div className="prp-numpad" id={`padbox-${it.id}`}>
          <div className="prp-pad-l">
            <p className="prp-kicker">Walked in with · {it.name}</p>
            <Stepper it={it} v={v} onSet={onSet} big id={`pad-${it.id}`} />
            {shortcuts}
          </div>
          <div className="prp-pad-r">
            <p className="prp-kicker">Quick pick · {quarters(it.unit) ? 'quarter steps' : 'pieces'}</p>
            <div className="prp-picks">{picks(it).map((p) => <button key={p} type="button" className={'prp-pick' + (v != null && Math.abs(v - p) < EPS ? ' on' : '')} aria-pressed={v != null && Math.abs(v - p) < EPS} aria-label={show(p, it.unit)} onClick={() => onSet(p)}>{quarters(it.unit) ? frac(p) : p}</button>)}</div>
            {v != null && c.used != null && last && <div className="prp-usedbox">{Ico.check}<span><strong>Used since last count: {show(c.used, it.unit)}</strong>
              <small>{lastWord} started with {show(last.starting, it.unit)} − {show(last.wasted, it.unit)} wasted − {show(v, it.unit)} now = {show(c.used, it.unit)}</small></span></div>}
          </div>
        </div>
      )}
      {c.pastPart > 0 && pastChoice !== 'keep' && (
        <div className="prp-flag past" role="group" aria-label={`${it.name}: past its use-by`}>
          <span className="ic">{Ico.bin}</span>
          <span className="t"><strong>{show(c.pastPart, it.unit)} of this is from {c.pastFrom}, past its use-by</strong>
            <small>{it.name} {it.shelfWords.toLowerCase()}. Keep it and it counts. Toss it and it goes in as waste (Expired), not as used.</small></span>
          <span className="prp-state expired">Past its use-by</span>
          <span className="b"><button type="button" className="prp-btn sm" onClick={onKeepPast}>Keep</button><button type="button" className="prp-btn sm tan" onClick={onToss}>{Ico.bin}Toss</button></span>
        </div>
      )}
      {c.pastPart > 0 && pastChoice === 'keep' && <p className="prp-flag-note">Kept: {show(c.pastPart, it.unit)} from {c.pastFrom}, past its use-by, counts as walked in with.</p>}
      {tossed > 0 && <p className="prp-flag-note">{show(tossed, it.unit)} tossed as Expired waste when you save. <button type="button" className="prp-link asbtn" onClick={onUndoToss}>Undo</button></p>}
      {c.high && !kept && last && (
        <div className="prp-flag high" role="group" aria-label={`${it.name}: check this`}>
          <span className="ic">{Ico.warn}</span>
          <span className="t"><strong>Check this: {show(v!, it.unit)} is more than the {show(c.expected!, it.unit)} it could have</strong>
            <small>{lastWord} started with {show(last.starting, it.unit)}{last.wasted ? `, ${show(last.wasted, it.unit)} wasted` : ''}. Used never goes below zero. Recount, or log the batch nobody logged.</small></span>
          <span className="b"><button type="button" className="prp-btn sm" onClick={onRecount}>{Ico.redo}Recount</button><button type="button" className="prp-btn sm" onClick={onBatch}>Log a Batch</button><button type="button" className="prp-btn sm" onClick={onKeep}>Keep {show(v!, it.unit)}</button></span>
        </div>
      )}
      {c.high && kept && <p className="prp-flag-note">Count kept at {show(v!, it.unit)}. {lastWord}’s Used shows “—”, and Reports lists it for your manager.</p>}
    </div>
  );
}

/** Log a Batch from Check this: the batch nobody logged last shift (it goes on that shift, so its numbers add up). */
function MissedBatch({ it, onDone }: { it: CountItem; onDone: (m: string) => void }) {
  const [amount, setAmount] = useState(String(it.batch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/api/prep/batches', { method: 'POST', body: { itemId: it.id, amount: Number(amount), forShift: 'last' } }); onDone(`${amt(Number(amount), it.unit)} of ${it.name.toLowerCase()} logged on ${it.last ? dayLabel(it.last.day, { weekday: 'long' }) : 'last shift'}.`); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  return (
    <form className="prp-form" onSubmit={(e) => void submit(e)}>
      <div className="prp-two">
        <label className="prp-field"><span>Amount</span><input type="number" inputMode="decimal" min="0" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <div className="prp-field"><span id="mb-unit">Unit</span><output className="prp-unit" aria-labelledby="mb-unit">{UNIT_LABEL[it.unit] || it.unit}</output></div>
      </div>
      <p className="prp-hint">It goes on the shift that started {it.last ? dayLabel(it.last.day, { weekday: 'long' }) : 'last time'}, so that shift’s numbers add up. One batch is {amt(it.batch, it.unit)}.</p>
      {error && <p className="prp-err" role="alert">{error}</p>}
      <button type="submit" className="prp-btn dark wide" disabled={busy}>{Ico.check}{busy ? 'Logging…' : 'Log Batch'}</button>
    </form>
  );
}
