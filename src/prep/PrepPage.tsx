// Prep tracker (Nov 12, Tommy: "a garnish, syrup, and juice tracker in the app that works day over day, week over week,
// year over year and can give you clear reports"). Figma 09 · Proposals → 31 (632:802): Today / Prep list (632:803),
// Item detail · Lime juice (632:894), Reports (632:985). Server: server/prep.mjs.
//   /prep              Today: Use First, the prep list, Log a Batch and Log Waste (everyone reads it; loggers log)
//   /prep/item/:id     an item: par by day + suggestions, shelf life, recipe, recent batches, the drinks that use it
//   /prep/reports      day / week / year over, the chart, ran out, every item, CSV, Print, Send to Team Chat (managers)
// Same layout for every brand; the look comes from the theme roles (src/lib/theme.ts) only.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { theme } from '../lib/theme';
import { SendToTeamButton } from '../chat/SendToTeam';
import { hasChat } from '../chat/unread';
import { openChat } from '../chat/panel';
import { BusiestDays, MadeUsedChart } from './Chart';
import {
  amt, dayLabel, DAYS, KIND_LABEL, KIND_LINE, MON_FIRST, pageTitle, pctText, roleStyle, shelfWords, timeOf, UNIT_LABEL, UNITS, useByWords, whenMade,
  type Batch, type Item, type Kind, type Person, type Report, type Row, type Today, type UseFirst,
} from './data';
import './prep.css';

export function PrepPage() {
  const { pathname } = useLocation();
  const m = /^\/prep\/item\/(\d+)/.exec(pathname);
  useEffect(() => { document.title = 'Prep · Mise Academy'; }, []);
  if (m) return <ItemPage id={Number(m[1])} />;
  if (pathname.startsWith('/prep/reports')) return <ReportsPage />;
  return <TodayPage />;
}

/* ------------------------------------------------------------------ shared bits */
function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { if (!path) return Promise.resolve(); setError(''); return api<T>(path).then(setData).catch((e) => setError((e as Error).message)); }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load, setData };
}

const Ico = {
  juice: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" /><path d="M10 2.75v14.5M2.75 10h14.5M4.9 4.9l10.2 10.2M15.1 4.9 4.9 15.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
  syrup: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5c2.8 3.6 5 6.4 5 9.2a5 5 0 0 1-10 0c0-2.8 2.2-5.6 5-9.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
  garnish: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 16c0-7 4.5-11 12-12-.5 7.5-4.5 12-12 12Zm0 0 6.5-6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  check: <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2.5 7.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  bin: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  warn: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2 1.5 13.5h13L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  arrow: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  clock: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" /><path d="M10 6v4.2l2.8 1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  book: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 3.5c2-.8 4-.8 6 .6 2-1.4 4-1.4 6-.6V13c-2-.8-4-.8-6 .6-2-1.4-4-1.4-6-.6V3.5ZM8 4.1v9.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>,
};
const KindDot = ({ kind }: { kind: Kind }) => <span className={'prp-dot ' + kind} aria-hidden="true">{Ico[kind]}</span>;
const Avatar = ({ p }: { p: Person }) => <span className="prp-av" aria-hidden="true">{p.initials}</span>;

/** The page's head: the accent line (The Baldwin's script, Mise's label), the title, and its pills. */
function Head({ line, title, pills, crumbs, tools }: { line: string; title: string; pills?: ReactNode; crumbs?: ReactNode; tools?: ReactNode }) {
  const t = theme();
  return (
    <header className="prp-head">
      {(crumbs || tools) && <div className="prp-crumbrow">{crumbs || <span />}{tools && <div className="prp-tools">{tools}</div>}</div>}
      <div className="prp-titlerow">
        <div className="prp-titles">
          <p className={'prp-line ' + t.accentLine} style={t.accentLine === 'script' ? roleStyle('accent', 30) : roleStyle('label', 13)}>{line}</p>
          <h1 className="prp-title" style={roleStyle('pageTitle', 52)}>{pageTitle(title)}</h1>
        </div>
        {pills && <div className="prp-pills">{pills}</div>}
      </div>
    </header>
  );
}
/** Demo copies say their numbers are demo data, the way the rest of the demo does. */
function DemoPill() {
  const { user } = useSession();
  return user?.demo ? <span className="prp-pill demo" title="This is a sample restaurant: every number here is made up.">Demo data</span> : null;
}
function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="prp-error" role="alert">{error}{retry && <button type="button" className="prp-btn sm" onClick={retry}>Try Again</button>}</div>;
}
const Loading = () => <div className="prp-loading" aria-busy="true"><div className="loader" /></div>;
function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [text, onDone]);
  return createPortal(<div className="eip-toast" role="status"><span className="dot" aria-hidden="true" />{text}</div>, document.body);
}

/** A sheet: a dialog that slides up on phones and sits centred on bigger screens. Escape and the backdrop close it. */
function Sheet({ title, kicker, onClose, children }: { title: string; kicker: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('select, input, textarea, button:not(.prp-x)');
    first?.focus();
    document.body.classList.add('menu-lock');
    const was = back.current;
    return () => { document.body.classList.remove('menu-lock'); was?.focus?.(); };
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const els = [...ref.current.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href]')].filter((x) => !x.hasAttribute('disabled'));
    if (!els.length) return;
    const a = els[0], z = els[els.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  };
  return createPortal(
    <div className="prp-sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={trap}>
      <div className="prp-sheet" role="dialog" aria-modal="true" aria-labelledby="prp-sheet-title" ref={ref}>
        <div className="prp-sheet-head">
          <div><p className="prp-kicker">{kicker}</p><h2 id="prp-sheet-title">{title}</h2></div>
          <button type="button" className="prp-x" aria-label="Close" onClick={onClose}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        </div>
        {children}
      </div>
    </div>, document.body);
}

/* ------------------------------------------------------------------ Log a Batch / Log Waste */
type BatchFor = { itemId?: number; amount?: number };
function BatchForm({ data, start, onDone, inline }: { data: Today; start?: BatchFor; onDone: (msg: string) => void; inline?: boolean }) {
  const { user } = useSession();
  const first = data.items.find((i) => i.toMake > 0) || data.items[0];
  const [itemId, setItemId] = useState<number>(start?.itemId ?? first?.id ?? 0);
  const item = data.items.find((i) => i.id === itemId);
  const [amount, setAmount] = useState<string>(String(start?.amount ?? (item ? item.toMake || item.batch : '')));
  const [madeBy, setMadeBy] = useState<number>(user?.id ?? data.people[0]?.id ?? 0);
  const [when, setWhen] = useState<'now' | '30' | '60' | '120'>('now');
  const [ranOut, setRanOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = (id: number) => { setItemId(id); const it = data.items.find((i) => i.id === id); if (it) setAmount(String(it.toMake || it.batch)); };
  if (!item) return <p className="prp-muted">Add an item first.</p>;
  const useBy = item.useByIfMadeNow;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const madeAt = when === 'now' ? undefined : new Date(Date.now() - Number(when) * 60e3).toISOString();
      await api('/api/prep/batches', { method: 'POST', body: { itemId, amount: Number(amount), madeBy, madeAt, ranOut } });
      onDone(`${amt(Number(amount), item.unit)} of ${item.name.toLowerCase()} logged.`);
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  const id = inline ? 'in' : 'sh';
  return (
    <form className="prp-form" onSubmit={(e) => void submit(e)}>
      <label className="prp-field"><span>Item</span>
        <select value={itemId} onChange={(e) => pick(Number(e.target.value))}>
          {(['juice', 'syrup', 'garnish'] as Kind[]).map((k) => <optgroup key={k} label={KIND_LABEL[k]}>{data.items.filter((i) => i.kind === k).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>)}
        </select></label>
      <div className="prp-two">
        <label className="prp-field"><span>Amount</span><input type="number" inputMode="decimal" min="0" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <div className="prp-field"><span id={`unit-${id}`}>Unit</span><output className="prp-unit" aria-labelledby={`unit-${id}`}>{UNIT_LABEL[item.unit] || item.unit}</output></div>
      </div>
      {item.batch > 0 && <p className="prp-hint">One batch is {amt(item.batch, item.unit)}{item.toMake ? `. Today’s amount: ${amt(item.toMake, item.unit)}.` : '. Nothing needed today.'}</p>}
      <label className="prp-field"><span>Made by</span>
        <select value={madeBy} onChange={(e) => setMadeBy(Number(e.target.value))}>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === user?.id ? ' (you)' : ''}</option>)}</select></label>
      <label className="prp-field"><span>Made at</span>
        <select value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
          <option value="now">Just now, {timeOf(new Date().toISOString())}</option><option value="30">30 minutes ago</option><option value="60">An hour ago</option><option value="120">2 hours ago</option>
        </select></label>
      <label className="prp-check"><input type="checkbox" checked={ranOut} onChange={(e) => setRanOut(e.target.checked)} /><span>We ran out before this batch</span></label>
      <div className="prp-useby">{Ico.clock}<div><strong>{useBy == null ? 'No use-by yet' : `Use by ${useByWords(useBy).toLowerCase()}`}</strong>
        <small>{useBy == null ? 'Shelf life isn’t set for this item. A manager sets it on its page.' : `${item.name} ${shelfWords(item.shelfDays).toLowerCase()}. Set on its item page.`}</small></div></div>
      {error && <p className="prp-err" role="alert">{error}</p>}
      <button type="submit" className="prp-btn dark wide" disabled={busy}>{Ico.check}{busy ? 'Logging…' : 'Log Batch'}</button>
    </form>
  );
}

const REASONS: [string, string][] = [['expired', 'Expired'], ['spilled', 'Spilled'], ['quality', 'Quality'], ['other', 'Other']];
type WasteFor = { batchId?: number; itemId?: number };
type OpenBatch = { batchId: number; itemId: number; label: string; remaining: number; unit: string; expired: boolean };
function WasteForm({ batches, start, onDone }: { batches: OpenBatch[]; start?: WasteFor; onDone: (msg: string) => void }) {
  const firstId = start?.batchId ?? batches.find((b) => b.itemId === start?.itemId)?.batchId ?? batches[0]?.batchId ?? 0;
  const [batchId, setBatchId] = useState<number>(firstId);
  const b = batches.find((x) => x.batchId === batchId);
  const [amount, setAmount] = useState<string>(b ? String(b.remaining) : '');
  const [reason, setReason] = useState<string>(b?.expired ? 'expired' : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!batches.length) return <p className="prp-muted">Nothing’s open to toss. Batches show here once they’re logged.</p>;
  const pick = (id: number) => { setBatchId(id); const x = batches.find((y) => y.batchId === id); if (x) { setAmount(String(x.remaining)); setReason(x.expired ? 'expired' : ''); } };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) { setError('Pick a reason.'); return; }
    setBusy(true); setError('');
    try {
      await api('/api/prep/waste', { method: 'POST', body: { batchId, amount: Number(amount), reason, note } });
      onDone(`${amt(Number(amount), b!.unit)} logged as waste.`);
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  return (
    <form className="prp-form" onSubmit={(e) => void submit(e)}>
      <label className="prp-field"><span>Item</span>
        <select value={batchId} onChange={(e) => pick(Number(e.target.value))}>{batches.map((x) => <option key={x.batchId} value={x.batchId}>{x.label}</option>)}</select></label>
      <div className="prp-two">
        <label className="prp-field"><span>Amount</span><input type="number" inputMode="decimal" min="0" step="any" max={b?.remaining} required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <div className="prp-field"><span id="waste-unit">Unit</span><output className="prp-unit" aria-labelledby="waste-unit">{b ? UNIT_LABEL[b.unit] || b.unit : ''}</output></div>
      </div>
      {b && <p className="prp-hint">{amt(b.remaining, b.unit)} left in this batch.{b.expired || reason === 'expired' ? ' Logging it clears the batch: the rest counts as used.' : ''}</p>}
      <fieldset className="prp-field prp-reasons"><legend>Reason</legend>
        <div className="prp-chips">{REASONS.map(([k, l]) => <button key={k} type="button" className={'prp-chip' + (reason === k ? ' on' : '')} aria-pressed={reason === k} onClick={() => setReason(k)}>{reason === k && Ico.check}{l}</button>)}</div>
      </fieldset>
      {reason === 'other' && <label className="prp-field"><span>What happened?</span><input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} required /></label>}
      {error && <p className="prp-err" role="alert">{error}</p>}
      <button type="submit" className="prp-btn dark wide" disabled={busy}>{Ico.bin}{busy ? 'Logging…' : 'Log Waste'}</button>
    </form>
  );
}
/** Every open batch on Today, oldest first, for the waste form. */
function openFromToday(d: Today): OpenBatch[] {
  const out: OpenBatch[] = d.useFirst.map((u) => ({ batchId: u.batchId, itemId: u.itemId, remaining: u.remaining, unit: u.unit, expired: u.state === 'expired',
    label: `${u.name} · ${dayLabel(u.day, { weekday: 'short' })} batch` }));
  return out;
}

/* ------------------------------------------------------------------ Today */
type SheetState = { kind: 'batch'; start?: BatchFor } | { kind: 'waste'; start?: WasteFor } | { kind: 'add' } | null;
function TodayPage() {
  const { data, error, load } = useLoad<Today>('/api/prep');
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toast, setToast] = useState('');
  const [open, setOpen] = useState<OpenBatch[]>([]);
  const [busy, setBusy] = useState(0);
  const nav = useNavigate();
  // The waste list also needs today's open batches that aren't on Use First: read each item's open batches from its page.
  useEffect(() => {
    if (!data?.can.log) return;
    let live = true;
    const ids = data.items.filter((i) => i.onHand > 0 && !data.useFirst.some((u) => u.itemId === i.id)).map((i) => i.id);
    Promise.all(ids.map((id) => api<Item>(`/api/prep/items/${id}`).catch(() => null))).then((items) => {
      if (!live) return;
      const more: OpenBatch[] = items.flatMap((it) => (it ? it.batches.filter((b) => b.open && !b.expired).map((b) => ({ batchId: b.id, itemId: it.id, remaining: b.remaining, unit: it.unit, expired: false,
        label: `${it.name} · ${b.day === data.day ? 'today’s' : dayLabel(b.day, { weekday: 'short' })} batch` })) : []));
      setOpen([...openFromToday(data), ...more]);
    });
    return () => { live = false; };
  }, [data]);
  if (error) return <div className="prp"><ErrorBox error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="prp"><Loading /></div>;
  const done = (msg: string) => { setSheet(null); setToast(msg); void load(); };
  const usedUp = async (u: UseFirst) => {
    setBusy(u.batchId);
    try { await api(`/api/prep/batches/${u.batchId}/used`, { method: 'POST' }); done(`${u.name} batch cleared as used.`); } catch (e) { setToast((e as Error).message); }
    setBusy(0);
  };
  const rows = data.items.filter((i) => filter === 'all' || i.kind === filter);
  const counts = { all: data.items.length, juice: 0, syrup: 0, garnish: 0 } as Record<string, number>;
  for (const i of data.items) counts[i.kind]++;
  const toMake = data.items.filter((i) => i.toMake > 0).length, made = data.items.filter((i) => i.made).length;
  const wk = data.week;
  const longDay = dayLabel(data.day, { weekday: 'long', month: 'short', day: 'numeric' }).replace(',', '');
  return (
    <div className="prp">
      <div className="prp-topbar">
        <Link to="/prep/reports" className="prp-btn">{data.can.edit ? 'Reports' : null}</Link>
        {data.can.log && <button type="button" className="prp-btn dark" onClick={() => setSheet({ kind: 'batch' })}>{Ico.plus}Log a Batch</button>}
      </div>
      <Head line={`${longDay} · ${data.store}`} title="Bar Prep"
        pills={<><DemoPill /><span className="prp-pill">{toMake} to make</span><span className="prp-pill good">{made} made</span>{data.useFirst.length > 0 && <span className="prp-pill warn">{data.useFirst.length} use first</span>}</>} />
      {data.useFirst.length > 0 && (
        <section className="prp-usefirst" aria-labelledby="uf-title">
          <div className="prp-uf-head">
            <div><p className="prp-kicker">Use first · {data.useFirst.length} {data.useFirst.length === 1 ? 'item' : 'items'}</p><h2 id="uf-title">Clear these before you open a new batch</h2></div>
            <p className="prp-uf-note">Oldest batch goes out first. Toss what’s past its use-by.</p>
          </div>
          <ul>
            {data.useFirst.map((u) => (
              <li key={u.batchId} className="prp-uf-row">
                <KindDot kind={u.kind} />
                <div className="prp-uf-main"><Link to={`/prep/item/${u.itemId}`} className="prp-uf-name">{u.name}</Link><span className="prp-uf-line">{u.line}</span></div>
                <span className={'prp-state ' + u.state}>{u.state === 'expired' ? 'Past its use-by' : u.state === 'today' ? 'Use today' : 'Use tomorrow'}</span>
                {data.can.log && <div className="prp-uf-actions">
                  {u.state === 'expired'
                    ? <button type="button" className="prp-btn ondark" onClick={() => setSheet({ kind: 'waste', start: { batchId: u.batchId } })}>{Ico.bin}Log as Waste</button>
                    : <>
                      <button type="button" className="prp-btn ghostdark" onClick={() => setSheet({ kind: 'waste', start: { batchId: u.batchId } })}>Log Waste</button>
                      <button type="button" className="prp-btn ondark" disabled={busy === u.batchId} onClick={() => void usedUp(u)}>{Ico.check}Used Up</button>
                    </>}
                </div>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="prp-cols">
        <section className="prp-card prp-list" aria-labelledby="list-title">
          <div className="prp-list-head">
            <div><h2 id="list-title">Today’s prep list</h2><p className="prp-sub">{data.weekday}’s par minus what’s on hand, rounded up to a full batch</p></div>
            <div className="prp-chips" role="group" aria-label="Show">
              {(['all', 'juice', 'syrup', 'garnish'] as const).map((k) => <button key={k} type="button" className={'prp-chip' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : KIND_LABEL[k]} {counts[k]}</button>)}
            </div>
          </div>
          {data.items.length === 0 && <p className="prp-empty">No prep items yet.{data.can.edit ? ' Add the juices, syrups and garnishes your bar makes.' : ' A manager adds them.'}</p>}
          {data.items.length > 0 && <div className="prp-table" role="table" aria-label="Today’s prep list">
            <div className="prp-tr prp-th" role="row"><span role="columnheader" className="c-item">Item</span><span role="columnheader" className="c-par">Par · On hand</span><span role="columnheader" className="c-make">Make</span><span role="columnheader" className="c-who">Who</span><span role="columnheader" className="c-act"><span className="sr-only">Action</span></span></div>
            {(['juice', 'syrup', 'garnish'] as Kind[]).map((k) => {
              const list = rows.filter((r) => r.kind === k);
              if (!list.length) return null;
              return (
                <div key={k} role="rowgroup">
                  <div className="prp-group" role="row"><span role="cell">{KIND_LINE[k]}</span></div>
                  {list.map((r) => <PrepRow key={r.id} r={r} canLog={data.can.log} onLog={() => setSheet({ kind: 'batch', start: { itemId: r.id } })} onUseFirst={() => setSheet({ kind: 'waste', start: { itemId: r.id } })} />)}
                </div>
              );
            })}
          </div>}
          <div className="prp-list-foot">
            {data.can.edit && <button type="button" className="prp-btn" onClick={() => setSheet({ kind: 'add' })}>{Ico.plus}Add an Item</button>}
            <p className="prp-sub">Pars change by day. {data.can.edit ? 'Set them on each item’s page.' : 'Managers set them on each item’s page.'}</p>
          </div>
        </section>
        <aside className="prp-side" aria-label="Log and this week">
          {data.can.log ? <>
            <section className="prp-card prp-pad prp-desk" aria-labelledby="lb-title"><p className="prp-kicker">Log a batch</p><h2 id="lb-title" className="prp-h3">Made something? Log it here.</h2><BatchForm key={'b' + data.items.length} data={data} inline onDone={done} /></section>
            <section className="prp-card prp-pad prp-desk" aria-labelledby="lw-title"><p className="prp-kicker">Log waste</p><h2 id="lw-title" className="prp-h3">Tossed, spilled or not right?</h2><WasteForm key={open.map((o) => o.batchId).join()} batches={open} onDone={done} /></section>
          </> : <p className="prp-card prp-pad prp-note">Bartenders and managers log prep. You can see what’s made and what to use first.</p>}
          <section className="prp-card prp-pad prp-week" aria-labelledby="wk-title">
            <p className="prp-kicker" id="wk-title">This week so far{data.can.edit ? '' : ''}</p>
            <div className="prp-stats">
              {Object.entries(wk.made).map(([u, n]) => <div key={u}><strong>{amt(n, u)}</strong><span>{u === 'each' ? 'pieces made' : 'made'}</span></div>)}
              {Object.entries(wk.wasted).filter(([u]) => u === 'qt').map(([u, n]) => <div key={'w' + u}><strong>{amt(n, u)}</strong><span>wasted</span></div>)}
              <div><strong>{wk.ranOut}</strong><span>ran out</span></div>
            </div>
            <p className="prp-sub">{dayLabel(wk.from, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')} to today. Quarts and pieces are counted apart, never added together.</p>
            {data.can.edit && <button type="button" className="prp-btn" onClick={() => nav('/prep/reports')}>{Ico.arrow}Open Reports</button>}
          </section>
        </aside>
      </div>
      {sheet?.kind === 'batch' && <Sheet kicker="Log a batch" title="Made something? Log it here." onClose={() => setSheet(null)}><BatchForm data={data} start={sheet.start} onDone={done} /></Sheet>}
      {sheet?.kind === 'waste' && <Sheet kicker="Log waste" title="Tossed, spilled or not right?" onClose={() => setSheet(null)}><WasteForm batches={open.length ? open : openFromToday(data)} start={sheet.start} onDone={done} /></Sheet>}
      {sheet?.kind === 'add' && <Sheet kicker="Add an item" title="A new juice, syrup or garnish" onClose={() => setSheet(null)}><ItemForm onDone={(id) => { setSheet(null); nav(`/prep/item/${id}`); }} /></Sheet>}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}

function PrepRow({ r, canLog, onLog, onUseFirst }: { r: Row; canLog: boolean; onLog: () => void; onUseFirst: () => void }) {
  const recipe = r.kind === 'garnish' ? 'How to Cut' : r.hasRecipe ? 'Recipe' : 'Add a Recipe';
  const recipeTo = r.kind === 'garnish' && r.lesson ? r.lesson : `/prep/item/${r.id}#recipe`;
  return (
    <div className="prp-tr" role="row">
      <span role="cell" className="c-item">
        <KindDot kind={r.kind} />
        <span className="prp-name"><Link to={`/prep/item/${r.id}`}>{r.name}</Link>
          <small>{r.ratio && <>{r.ratio} · </>}{(r.kind === 'garnish' && !r.lesson) ? null : <Link to={recipeTo} className="prp-link">{recipe} {Ico.arrow}</Link>}</small></span>
      </span>
      <span role="cell" className="c-par"><span>Par {amt(r.par, r.unit)}</span><small>On hand {amt(r.onHand, r.unit)}</small></span>
      <span role="cell" className="c-make">{r.toMake > 0
        ? <><strong>{amt(r.toMake, r.unit)}</strong><small>{r.kind === 'garnish' ? (r.onHand > 0 ? `use the ${amt(r.onHand, r.unit)} first` : 'cut to order') : `${r.batches} ${r.batches === 1 ? 'batch' : 'batches'} of ${amt(r.batch, r.unit)}`}</small></>
        : <><strong className="none" aria-label="Nothing">—</strong><small>{r.useFirst ? 'Use first' : 'Nothing to make'}</small></>}</span>
      <span role="cell" className="c-who">{r.who ? <><Avatar p={r.who} /><span>{r.who.name}{r.who.usual && <small>usually</small>}</span></> : <span className="prp-dash">—</span>}</span>
      <span role="cell" className="c-act">
        {r.status === 'make' && canLog && <button type="button" className="prp-btn" onClick={onLog} aria-label={`Log a batch of ${r.name}`}>Log a Batch</button>}
        {r.status === 'made' && r.made && <span className="prp-state made">{Ico.check}Made {timeOf(r.made.at)}</span>}
        {r.status === 'use-first' && (canLog ? <button type="button" className="prp-state today asbtn" onClick={onUseFirst}>Use First</button> : <span className="prp-state today">Use First</span>)}
        {r.status === 'at-par' && <span className="prp-state par">At Par</span>}
        {r.status === 'make' && !canLog && <span className="prp-state par">To Make</span>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ Add an Item */
function ItemForm({ onDone }: { onDone: (id: number) => void }) {
  const [f, setF] = useState({ name: '', kind: 'juice' as Kind, unit: 'qt', batch: '1', shelfDays: '0' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v, ...(k === 'kind' ? { unit: v === 'garnish' ? 'each' : 'qt', batch: v === 'garnish' ? '5' : '1' } : {}) }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const batch = Number(f.batch);
      const r = await api<{ id: number }>('/api/prep/items', { method: 'POST', body: { name: f.name, kind: f.kind, unit: f.unit, batch, pars: Array(7).fill(batch), shelfDays: f.shelfDays === '' ? null : Number(f.shelfDays) } });
      onDone(r.id);
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  return (
    <form className="prp-form" onSubmit={(e) => void submit(e)}>
      <label className="prp-field"><span>Name</span><input value={f.name} maxLength={60} required onChange={(e) => set('name', e.target.value)} placeholder="Cucumber juice" /></label>
      <label className="prp-field"><span>Kind</span><select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="juice">Juice</option><option value="syrup">Syrup</option><option value="garnish">Garnish</option></select></label>
      <div className="prp-two">
        <label className="prp-field"><span>Unit</span><select value={f.unit} onChange={(e) => set('unit', e.target.value)}>{UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select></label>
        <label className="prp-field"><span>One batch</span><input type="number" inputMode="decimal" min="0" step="any" required value={f.batch} onChange={(e) => set('batch', e.target.value)} /></label>
      </div>
      <label className="prp-field"><span>Keeps for</span><select value={f.shelfDays} onChange={(e) => set('shelfDays', e.target.value)}>
        <option value="0">1 shift (toss at close)</option><option value="1">1 day</option><option value="2">2 days</option><option value="3">3 days</option><option value="7">1 week</option><option value="">Not set yet</option></select></label>
      <p className="prp-hint">Every day starts with a par of one batch. Set each day’s par on the item’s page.</p>
      {error && <p className="prp-err" role="alert">{error}</p>}
      <button type="submit" className="prp-btn dark wide" disabled={busy}>{Ico.plus}{busy ? 'Adding…' : 'Add Item'}</button>
    </form>
  );
}

/* ------------------------------------------------------------------ Item detail */
const SHELF: [number | null, string][] = [[0, '1 shift'], [1, '1 day'], [2, '2 days'], [3, '3 days'], [7, '1 week']];
function ItemPage({ id }: { id: number }) {
  const { user } = useSession();
  const { data, error, load, setData } = useLoad<Item>(`/api/prep/items/${id}`);
  const [toast, setToast] = useState('');
  const [sheet, setSheet] = useState<'batch' | 'waste' | 'count' | 'archive' | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [allBatches, setAll] = useState(false);
  const nav = useNavigate();
  useEffect(() => { if (data?.can.log) api<Today>('/api/prep').then(setToday).catch(() => {}); }, [data?.can.log, data?.batches.length]);
  useEffect(() => { if (location.hash === '#recipe' && data) document.getElementById('recipe')?.scrollIntoView({ block: 'start' }); }, [data]);
  if (error) return <div className="prp"><ErrorBox error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="prp"><Loading /></div>;
  const it = data;
  const done = (msg: string) => { setSheet(null); setToast(msg); void load(); };
  const patch = async (body: Record<string, unknown>, msg: string) => {
    try { setData(await api<Item>(`/api/prep/items/${it.id}`, { method: 'PATCH', body })); setToast(msg); } catch (e) { setToast((e as Error).message); }
  };
  const answer = async (dow: number, action: 'accept' | 'keep', to?: number) => {
    try { setData(await api<Item>(`/api/prep/items/${it.id}/suggestion`, { method: 'POST', body: { dow, action, to } })); setToast(action === 'accept' ? `${DAYS[dow]} par set to ${amt(to!, it.unit)}.` : `${DAYS[dow]} stays at ${amt(it.pars[dow], it.unit)}.`); } catch (e) { setToast((e as Error).message); }
  };
  const ranOut = async () => { try { await api(`/api/prep/items/${it.id}/ranout`, { method: 'POST', body: {} }); done(`Logged: ${it.name.toLowerCase()} ran out.`); } catch (e) { setToast((e as Error).message); } };
  const archive = async () => { try { await api(`/api/prep/items/${it.id}/archive`, { method: 'POST' }); nav('/prep'); } catch (e) { setToast((e as Error).message); setSheet(null); } };
  const restore = async () => { try { await api(`/api/prep/items/${it.id}/restore`, { method: 'POST' }); done(`${it.name} is back on the list.`); } catch (e) { setToast((e as Error).message); } };
  const open = it.batches.filter((b) => b.open);
  const wasteList: OpenBatch[] = open.map((b) => ({ batchId: b.id, itemId: it.id, remaining: b.remaining, unit: it.unit, expired: b.expired, label: `${it.name} · ${whenMade(b.madeAt)}` }));
  const shown = allBatches ? it.batches : it.batches.slice(0, 6);
  const closed = it.week.used + it.week.wasted;
  return (
    <div className="prp">
      <div className="prp-topbar">
        {it.can.log && !it.archived && <button type="button" className="prp-btn dark" onClick={() => setSheet('batch')}>{Ico.plus}Log a Batch</button>}
      </div>
      <Head line={KIND_LINE[it.kind]} title={it.name}
        crumbs={<nav className="prp-crumbs" aria-label="Breadcrumb"><Link to="/prep">Prep</Link><span aria-hidden="true">/</span><Link to={`/prep`}>{it.kindLabel}</Link><span aria-hidden="true">/</span><span aria-current="page">{it.name}</span></nav>}
        tools={<>
          {hasChat(user) && !it.archived && <SendToTeamButton item={{ type: 'page', slug: `prep/item/${it.id}` }} className="prp-btn" />}
          {it.can.log && !it.archived && <button type="button" className="prp-btn" onClick={() => setSheet('waste')} disabled={!open.length}>{Ico.bin}Log Waste</button>}
          {it.can.edit && (it.archived ? <button type="button" className="prp-btn" onClick={() => void restore()}>Restore</button> : <button type="button" className="prp-btn" onClick={() => setSheet('archive')}>Archive</button>)}
        </>}
        pills={<><DemoPill /><span className="prp-pill">In {it.drinks.length} {it.drinks.length === 1 ? 'drink' : 'drinks'}</span><span className="prp-pill">{it.shelf.words}</span><span className="prp-pill">Par today {amt(it.parToday, it.unit)}</span></>} />
      {it.archived && <p className="prp-card prp-pad prp-note">This item is archived. It’s off Today’s list. Restore it to log batches again.</p>}
      <div className="prp-cols item">
        <div className="prp-main">
          <ParCard it={it} onSave={(pars) => void patch({ pars }, 'Pars saved.')} onAnswer={(d, a, to) => void answer(d, a, to)} />
          <ShelfCard it={it} onSave={(b) => void patch(b, 'Shelf life saved.')} />
          <RecipeCard it={it} onSave={(b) => void patch(b, 'Recipe saved.')} />
          <section className="prp-card" aria-labelledby="rb-title">
            <div className="prp-card-head pad"><div><h2 id="rb-title">Recent batches and waste</h2><p className="prp-sub">Every batch, who made it, and where it went</p></div>
              {it.batches.length > 6 && <button type="button" className="prp-btn sm" onClick={() => setAll((v) => !v)} aria-expanded={allBatches}>{allBatches ? 'Show Fewer' : 'See All'}</button>}</div>
            {it.batches.length === 0 ? <p className="prp-empty">No batches yet. They show here as soon as someone logs one.</p> :
              <div className="prp-table batches" role="table" aria-label="Recent batches">
                <div className="prp-tr prp-th" role="row"><span role="columnheader">Made</span><span role="columnheader">By</span><span role="columnheader">Amount</span><span role="columnheader">Use by</span><span role="columnheader">What happened</span></div>
                {shown.map((b) => <BatchRow key={b.id} b={b} />)}
              </div>}
          </section>
        </div>
        <aside className="prp-side">
          <section className="prp-card prp-pad" aria-labelledby="dr-title">
            <p className="prp-kicker" id="dr-title">Used in {it.drinks.length} {it.drinks.length === 1 ? 'drink' : 'drinks'} · from your specs</p>
            {it.drinks.length ? <><p className="prp-sub">Tap a drink to open its spec</p>
              <ul className="prp-drinks">{it.drinks.map((d) => <li key={d.slug}><Link to={'/' + d.slug}><span>{d.name}</span><small>{d.amount}</small>{Ico.arrow}</Link></li>)}</ul></>
              : <p className="prp-sub">None of your house cocktails list it yet.</p>}
          </section>
          <section className="prp-card prp-pad prp-week" aria-labelledby="iw-title">
            <p className="prp-kicker" id="iw-title">This week</p>
            <div className="prp-stats"><div><strong>{amt(it.week.made, it.unit)}</strong><span>made</span></div><div><strong>{amt(it.week.used, it.unit)}</strong><span>used</span></div><div><strong>{amt(it.week.wasted, it.unit)}</strong><span>wasted</span></div></div>
            <p className="prp-sub">{it.week.inUse > 0 ? `${amt(it.week.inUse, it.unit)} is still in use. ` : ''}{closed > 0 ? `Waste is ${Math.round((it.week.wasted / closed) * 100)}% of the batches that have closed.` : 'No batch has closed yet this week.'}</p>
            {it.can.edit && <Link to={`/prep/reports?series=${it.id}`} className="prp-btn">{Ico.arrow}Open in Reports</Link>}
          </section>
          <section className="prp-card prp-pad" aria-labelledby="oh-title">
            <p className="prp-kicker" id="oh-title">On hand now</p>
            <p className="prp-big">{amt(it.onHand, it.unit)}</p>
            <p className="prp-sub">From open batches still inside their use-by.</p>
            {it.can.log && !it.archived && <div className="prp-row-btns"><button type="button" className="prp-btn" onClick={() => setSheet('count')}>Update Count</button><button type="button" className="prp-btn" onClick={() => void ranOut()}>{Ico.warn}We Ran Out</button></div>}
          </section>
          <section className="prp-card prp-pad" aria-labelledby="wm-title">
            <p className="prp-kicker" id="wm-title">Who makes it</p>
            {it.makers.length ? <><p className="prp-sub">From the last 4 weeks of batches</p>
              <ul className="prp-makers">{it.makers.map((p) => <li key={p.id}><Avatar p={p} /><span><strong>{p.name}</strong><small>{p.days.join(' · ')}</small></span></li>)}</ul></>
              : <p className="prp-sub">No one yet.</p>}
          </section>
        </aside>
      </div>
      {sheet === 'batch' && today && <Sheet kicker="Log a batch" title="Made something? Log it here." onClose={() => setSheet(null)}><BatchForm data={today} start={{ itemId: it.id }} onDone={done} /></Sheet>}
      {sheet === 'waste' && <Sheet kicker="Log waste" title="Tossed, spilled or not right?" onClose={() => setSheet(null)}><WasteForm batches={wasteList} onDone={done} /></Sheet>}
      {sheet === 'count' && <Sheet kicker="Update count" title={`How much ${it.name.toLowerCase()} is left?`} onClose={() => setSheet(null)}><CountForm it={it} onDone={done} /></Sheet>}
      {sheet === 'archive' && <Sheet kicker="Archive" title={`Archive ${it.name}?`} onClose={() => setSheet(null)}>
        <p className="prp-sub">It comes off Today’s list. Its batches stay in Reports. You can restore it any time from Archived.</p>
        <div className="prp-row-btns"><button type="button" className="prp-btn" onClick={() => setSheet(null)}>Cancel</button><button type="button" className="prp-btn dark" onClick={() => void archive()}>Archive</button></div>
      </Sheet>}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}

function CountForm({ it, onDone }: { it: Item; onDone: (m: string) => void }) {
  const [v, setV] = useState(String(it.onHand));
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    try { await api(`/api/prep/items/${it.id}/count`, { method: 'POST', body: { onHand: Number(v) } }); onDone(`${it.name}: ${amt(Number(v), it.unit)} on hand.`); } catch (err) { setError((err as Error).message); }
  };
  return (
    <form className="prp-form" onSubmit={(e) => void submit(e)}>
      <label className="prp-field"><span>On hand ({UNIT_LABEL[it.unit] || it.unit})</span><input type="number" inputMode="decimal" min="0" step="any" max={it.onHand} required value={v} onChange={(e) => setV(e.target.value)} /></label>
      <p className="prp-hint">{amt(it.onHand, it.unit)} was logged. What’s gone since counts as used, oldest batch first.</p>
      {error && <p className="prp-err" role="alert">{error}</p>}
      <button type="submit" className="prp-btn dark wide">{Ico.check}Save Count</button>
    </form>
  );
}

function BatchRow({ b }: { b: Batch }) {
  const pills: ReactNode[] = [];
  if (b.open) pills.push(<span key="o" className={'prp-state ' + (b.expired ? 'expired' : 'par')}>{b.expired ? `${amt(b.remaining, b.unit)} past its use-by` : 'In use'}</span>);
  const tossed = b.wasted.reduce((n, w) => n + w.amount, 0);
  if (!b.open && b.used > 0 && tossed === 0 && !b.ranOutAt) pills.push(<span key="u" className="prp-state made">All used</span>);
  else if (b.used > 0) pills.push(<span key="u" className="prp-state made">{amt(b.used, b.unit)} used</span>);
  for (const [i, w] of b.wasted.entries()) pills.push(<span key={'w' + i} className="prp-state expired">{amt(w.amount, b.unit)} {w.reason === 'other' ? 'tossed' : w.reason}</span>);
  if (b.ranOutAt) pills.push(<span key="r" className="prp-state today">{Ico.warn}Ran out {timeOf(b.ranOutAt)}</span>);
  return (
    <div className="prp-tr" role="row">
      <span role="cell" data-l="Made">{whenMade(b.madeAt)}</span>
      <span role="cell" data-l="By" className="c-who">{b.by ? <><Avatar p={b.by} /><span>{b.by.name}</span></> : '—'}</span>
      <span role="cell" data-l="Amount"><strong>{amt(b.amount, b.unit)}</strong></span>
      <span role="cell" data-l="Use by">{useByWords(b.useBy)}</span>
      <span role="cell" data-l="What happened" className="prp-pillrow">{pills}</span>
    </div>
  );
}

function ParCard({ it, onSave, onAnswer }: { it: Item; onSave: (p: number[]) => void; onAnswer: (dow: number, a: 'accept' | 'keep', to?: number) => void }) {
  const [edit, setEdit] = useState(false);
  const [pars, setPars] = useState<string[]>(it.pars.map(String));
  useEffect(() => setPars(it.pars.map(String)), [it.pars]);
  return (
    <section className="prp-card prp-pad" aria-labelledby="par-title">
      <div className="prp-card-head"><div><h2 id="par-title">Par by day</h2><p className="prp-sub">How much to have ready at the start of each shift</p></div>
        {it.can.edit ? (edit ? <div className="prp-row-btns"><button type="button" className="prp-btn sm" onClick={() => { setEdit(false); setPars(it.pars.map(String)); }}>Cancel</button><button type="button" className="prp-btn sm dark" onClick={() => { onSave(pars.map(Number)); setEdit(false); }}>Save Pars</button></div>
          : <button type="button" className="prp-btn sm" onClick={() => setEdit(true)}>Edit Pars</button>) : <span className="prp-pill sm">Managers edit</span>}</div>
      <div className="prp-days">
        {MON_FIRST.map((d) => {
          const s = it.stats[d];
          return (
            <div key={d} className={'prp-daytile' + (d === it.today ? ' now' : '')}>
              <span className="d">{DAYS[d]}{d === it.today ? ' · Today' : ''}</span>
              {edit ? <label className="prp-parin"><span className="sr-only">{DAYS[d]} par</span><input type="number" inputMode="decimal" min="0" step={it.step} value={pars[d]} onChange={(e) => setPars((p) => p.map((x, i) => (i === d ? e.target.value : x)))} /></label>
                : <strong>{amt(it.pars[d], it.unit)}</strong>}
              <small>{s.used == null ? 'no logs yet' : `used ${s.used}`}</small>
            </div>
          );
        })}
      </div>
      <p className="prp-sub">“Used” is the average of the last 4 weeks.</p>
      {it.suggestions.length > 0 && (
        <div className="prp-sugg">
          <p className="prp-kicker">From your logs</p>
          {it.suggestions.map((s) => (
            <div key={s.dow} className="prp-sugg-row">
              {Ico.warn}<p>{s.text}</p>
              {it.can.edit && <div className="prp-row-btns">
                <button type="button" className="prp-btn sm" onClick={() => onAnswer(s.dow, 'keep')}>Keep {amt(s.from, it.unit)}</button>
                <button type="button" className="prp-btn sm dark" onClick={() => onAnswer(s.dow, 'accept', s.to)}>{s.kind === 'raise' ? 'Raise' : 'Lower'} to {amt(s.to, it.unit)}</button>
              </div>}
            </div>
          ))}
          {!it.can.edit && <p className="prp-sub">A manager decides. Suggestions never change a par on their own.</p>}
        </div>
      )}
    </section>
  );
}

function ShelfCard({ it, onSave }: { it: Item; onSave: (b: Record<string, unknown>) => void }) {
  const [days, setDays] = useState<number | null>(it.shelf.days);
  const [custom, setCustom] = useState(!SHELF.some(([d]) => d === it.shelf.days) && it.shelf.days != null);
  const [storage, setStorage] = useState(it.shelf.storage);
  useEffect(() => { setDays(it.shelf.days); setStorage(it.shelf.storage); }, [it.shelf.days, it.shelf.storage]);
  const dirty = days !== it.shelf.days || storage !== it.shelf.storage;
  const can = it.can.edit;
  return (
    <section className="prp-card prp-pad" aria-labelledby="shelf-title">
      <div className="prp-card-head"><div><h2 id="shelf-title">Shelf life and storage</h2><p className="prp-sub">The use-by on every batch is worked out from this</p></div>{!can && <span className="prp-pill sm">Managers edit</span>}</div>
      <fieldset className="prp-field" disabled={!can}><legend>Keeps for</legend>
        <div className="prp-chips">
          {SHELF.map(([d, l]) => <button key={l} type="button" className={'prp-chip' + (days === d && !custom ? ' on' : '')} aria-pressed={days === d && !custom} onClick={() => { setDays(d); setCustom(false); }}>{days === d && !custom && Ico.check}{l}</button>)}
          <button type="button" className={'prp-chip' + (custom ? ' on' : '')} aria-pressed={custom} onClick={() => setCustom(true)}>Custom</button>
          {custom && <label className="prp-custom"><input type="number" min="0" max="90" value={days ?? ''} onChange={(e) => setDays(e.target.value === '' ? null : Number(e.target.value))} aria-label="Days it keeps" /> days</label>}
        </div>
      </fieldset>
      {days === 0 && <p className="prp-toss"><span className="prp-switch on" aria-hidden="true" /><span><strong>Toss at close</strong><small>Anything left goes on the Use First list as “Past its use-by” next shift.</small></span></p>}
      <label className="prp-field"><span>Storage</span><input value={storage} maxLength={200} disabled={!can} onChange={(e) => setStorage(e.target.value)} placeholder="Where it lives and how it’s labelled" /></label>
      {it.shelf.confirmed && it.shelf.note ? (
        <div className="prp-why"><p className="prp-kicker">Why {it.shelf.words.replace('Keeps ', '')}</p><p>{it.shelf.note}</p>
          <p className="src">{it.shelf.source}{it.shelf.lesson && <> <Link to={it.shelf.lesson} className="prp-link">Open the lesson {Ico.arrow}</Link></>}</p></div>
      ) : it.shelf.confirmed ? (
        <div className="prp-why"><p className="prp-kicker">Shelf life</p><p className="src">{it.shelf.source}</p></div>
      ) : (
        <div className="prp-why todo"><p className="prp-kicker">House standard · to confirm</p><p>The Cocktail Program doesn’t give a number for this one. {it.shelf.days == null ? 'Set how long it keeps.' : `${it.shelf.words} is a starting point: your bar lead confirms it.`}</p></div>
      )}
      {can && <div className="prp-card-foot"><p className="prp-sub">Changing it changes the use-by on new batches, not ones already made.</p><button type="button" className="prp-btn sm dark" disabled={!dirty} onClick={() => onSave({ shelfDays: days, storage })}>Save Changes</button></div>}
    </section>
  );
}

function RecipeCard({ it, onSave }: { it: Item; onSave: (b: Record<string, unknown>) => void }) {
  const [edit, setEdit] = useState(false);
  const [steps, setSteps] = useState(it.recipe.steps.join('\n'));
  const [ratio, setRatio] = useState(it.recipe.ratio);
  const [yieldNote, setYield] = useState(it.recipe.yield);
  const [batch, setBatch] = useState(String(it.batch));
  useEffect(() => { setSteps(it.recipe.steps.join('\n')); setRatio(it.recipe.ratio); setYield(it.recipe.yield); setBatch(String(it.batch)); }, [it]);
  const garnish = it.kind === 'garnish';
  return (
    <section className="prp-card prp-pad" id="recipe" aria-labelledby="rc-title">
      <div className="prp-card-head"><div><h2 id="rc-title">{garnish ? 'How to cut and yield' : 'Recipe and yield'}</h2><p className="prp-sub">{it.recipe.steps.length ? 'A draft: your bar lead confirms it before staff rely on it' : 'No written recipe yet'}</p></div>
        {it.can.edit && !edit && <button type="button" className="prp-btn sm" onClick={() => setEdit(true)}>{it.recipe.steps.length ? 'Edit Recipe' : 'Add a Recipe'}</button>}</div>
      {edit ? (
        <div className="prp-form">
          <div className="prp-two three">
            <label className="prp-field"><span>Batch size ({it.unit === 'each' ? 'pieces' : it.unit})</span><input type="number" min="0" step="any" value={batch} onChange={(e) => setBatch(e.target.value)} /></label>
            <label className="prp-field"><span>Ratio</span><input value={ratio} maxLength={20} onChange={(e) => setRatio(e.target.value)} placeholder="1:1" /></label>
            <label className="prp-field"><span>Yield note</span><input value={yieldNote} maxLength={120} onChange={(e) => setYield(e.target.value)} placeholder="Limes per quart" /></label>
          </div>
          <label className="prp-field"><span>Steps, one per line</span><textarea rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} /></label>
          <div className="prp-row-btns"><button type="button" className="prp-btn sm" onClick={() => setEdit(false)}>Cancel</button>
            <button type="button" className="prp-btn sm dark" onClick={() => { onSave({ steps: steps.split('\n'), ratio, yield: yieldNote, batch: Number(batch) }); setEdit(false); }}>Save Recipe</button></div>
        </div>
      ) : <>
        <div className="prp-tiles">
          <div><span>Batch size</span><strong>{amt(it.batch, it.unit)}</strong></div>
          <div><span>Ratio</span><strong className={it.recipe.ratio ? '' : 'muted'}>{it.recipe.ratio || 'Set by your bar lead'}</strong></div>
          <div><span>{it.kind === 'juice' ? 'Fruit per batch' : 'Yield'}</span><strong className={it.recipe.yield ? '' : 'muted'}>{it.recipe.yield || 'Set by your bar lead'}</strong></div>
        </div>
        {it.recipe.steps.length > 0 && <ol className="prp-steps">{it.recipe.steps.map((s, i) => <li key={i}><span className="n" aria-hidden="true">{i + 1}</span><span>{s}</span></li>)}</ol>}
        {it.recipe.lesson && <Link to={it.recipe.lesson} className="prp-link lesson">{Ico.book}Open the lesson {Ico.arrow}</Link>}
      </>}
    </section>
  );
}

/* ------------------------------------------------------------------ Reports */
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const RANGE_LABEL = { day: 'Day over Day', week: 'Week over Week', year: 'Year over Year' } as const;
function ReportsPage() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const range = (['day', 'week', 'year'].includes(params.get('range') || '') ? params.get('range') : 'week') as Report['range'];
  const at = params.get('at') || '';
  const series = params.get('series') || '';
  const q = `/api/prep/report?range=${range}${at ? '&at=' + at : ''}${series ? '&series=' + series : ''}`;
  const { data, error, load } = useLoad<Report>(q);
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [toast, setToast] = useState('');
  const [msg, setMsg] = useState('');
  const [editMsg, setEditMsg] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => { if (data) setMsg(data.summary); }, [data]);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k === 'range') p.delete('at'); setParams(p, { replace: true }); };
  const rows = useMemo(() => (data?.rows || []).filter((r) => kind === 'all' || r.kind === kind), [data, kind]);
  if (user && user.role === 'staff') return <div className="prp"><Head line="Bar prep" title="Prep Reports" /><p className="prp-card prp-pad prp-note">Reports are for managers. <Link to="/prep" className="prp-link">Back to Today’s prep {Ico.arrow}</Link></p></div>;
  if (error) return <div className="prp"><ErrorBox error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="prp"><Loading /></div>;
  const t = data.tiles;
  const counts: Record<string, number> = { all: data.rows.length, juice: 0, syrup: 0, garnish: 0 };
  for (const r of data.rows) counts[r.kind]++;
  const csv = () => {
    const head = ['Item', 'Kind', 'Unit', 'Made', 'Used', 'Wasted', 'Still in use', 'Waste %', `Waste % ${data.period.prevLabel}`, 'Change (pts)', 'Ran out', 'Batches'];
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head, ...data.rows.map((r) => [r.name, r.kind, r.unit === 'each' ? 'pieces' : r.unit, r.made, r.used, r.wasted, r.inUse, r.wastePct ?? '', r.prevWastePct ?? '', r.vsPrev ?? '', r.ranOut, r.batches])].map((l) => l.map(esc).join(','));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `prep-${data.range}-${data.period.from}${user?.demo ? '-demo' : ''}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const send = async () => {
    setSending(true);
    try { await api('/api/prep/report/send', { method: 'POST', body: { range: data.range, at: data.period.from, body: msg } }); setToast('Sent to #Bar in Team Chat.'); setEditMsg(false); } catch (e) { setToast((e as Error).message); }
    setSending(false);
  };
  const change = (now: number | null, prev: number | null) => {
    if (now == null || prev == null) return null;
    const d = now - prev;
    return d === 0 ? <span className="prp-chg same">Same as {data.period.prevLabel}</span> : <span className={'prp-chg ' + (d < 0 ? 'good' : 'bad')}>{d < 0 ? 'Down' : 'Up'} from {prev}%</span>;
  };
  const seriesLabel = data.series.options.find((o) => String(o.id) === String(data.series.id))?.label || '';
  const unitWord = data.series.unit === 'each' ? 'Pieces' : UNIT_LABEL[data.series.unit]?.replace(/^./, (c) => c.toUpperCase());
  return (
    <div className="prp prp-report">
      <Head line={`Bar prep · ${data.store}`} title="Prep Reports" crumbs={<nav className="prp-crumbs" aria-label="Breadcrumb"><Link to="/prep">Prep</Link><span aria-hidden="true">/</span><span aria-current="page">Reports</span></nav>}
        pills={<DemoPill />} />
      <div className="prp-filters" role="group" aria-label="Report filters">
        <div className="prp-seg" role="tablist" aria-label="Compare">
          {(['day', 'week', 'year'] as const).map((r) => <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'on' : ''} onClick={() => set('range', r)}>{RANGE_LABEL[r]}</button>)}
        </div>
        <label className="prp-select"><span className="sr-only">Period</span>
          <select value={data.periods.find((p) => p.at === data.period.from || p.at === data.at)?.at || ''} onChange={(e) => set('at', e.target.value)}>
            {!data.periods.some((p) => p.at === data.period.from || p.at === data.at) && <option value="">{data.period.label} vs {data.period.prevLabel}</option>}
            {data.periods.map((p) => <option key={p.at} value={p.at}>{p.label}</option>)}
          </select></label>
        <span className="grow" />
        <button type="button" className="prp-btn" onClick={csv}>CSV</button>
        <button type="button" className="prp-btn" onClick={() => window.print()}>Print or PDF</button>
        {hasChat(user) && <button type="button" className="prp-btn dark" onClick={() => document.getElementById('send')?.scrollIntoView({ block: 'center' })}>Send to Team Chat</button>}
      </div>
      <p className="prp-period">{data.period.label} compared with {data.period.prevLabel}. Counted by the day each batch was made.</p>
      <div className="prp-tiles4">
        <div className="prp-card prp-tile"><p className="prp-kicker">Juices + syrups wasted</p><div className="v"><strong>{pctText(t.liquid.pct)}</strong>{change(t.liquid.pct, t.liquid.prevPct)}</div><p className="prp-sub">{amt(t.liquid.wasted, 'qt')} of {amt(t.liquid.made, 'qt')} made</p></div>
        <div className="prp-card prp-tile"><p className="prp-kicker">Garnishes wasted</p><div className="v"><strong>{pctText(t.garnish.pct)}</strong>{change(t.garnish.pct, t.garnish.prevPct)}</div><p className="prp-sub">{Math.round(t.garnish.wasted)} of {Math.round(t.garnish.made).toLocaleString('en-US')} pieces cut</p></div>
        <div className="prp-card prp-tile"><p className="prp-kicker">Ran out</p><div className="v"><strong>{t.ranOut.count === 1 ? '1 time' : `${t.ranOut.count} times`}</strong></div><p className="prp-sub">{t.ranOut.prev} {t.ranOut.prev === 1 ? 'time' : 'times'} {data.period.prevLabel}</p></div>
        <div className="prp-card prp-tile"><p className="prp-kicker">Batches made</p><div className="v"><strong>{t.batches.count}</strong></div><p className="prp-sub">{t.batches.prev} {data.period.prevLabel}</p></div>
      </div>
      <section className="prp-card prp-pad" aria-labelledby="ch-title">
        <div className="prp-card-head"><div><h2 id="ch-title">Made, used and wasted, by {data.range === 'year' ? 'month' : 'day'}</h2>
          <p className="prp-sub">Each bar is what was made {data.range === 'year' ? 'that month' : 'that day'}: used on the bottom, wasted on top, still in use striped. {unitWord}.</p></div>
          <label className="prp-select"><span className="sr-only">Item</span><select value={String(data.series.id)} onChange={(e) => set('series', e.target.value)}>{data.series.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label></div>
        <ul className="prp-legend" aria-label="Key">
          <li><i className="sw used" />Used</li><li><i className="sw wasted" />Wasted</li><li><i className="sw inuse" />Still in use</li><li><i className="sw prev" />Used, {data.range === 'year' ? 'year' : data.range === 'day' ? 'week' : 'week'} before</li><li><i className="sw ran">!</i>Ran out</li>
        </ul>
        <MadeUsedChart data={data.chart} unit={data.series.unit} prevLabel={data.range === 'year' ? 'Last year' : 'Week before'} title={`${seriesLabel}: made, used and wasted`} />
      </section>
      <div className="prp-cols2">
        <section className="prp-card prp-pad" aria-labelledby="busy-title"><h2 id="busy-title">Busiest days</h2><p className="prp-sub">Batches made per day, average of the last 4 weeks · all items</p>
          <BusiestDays data={data.busiest} />
          {(() => { const top = data.busiest.reduce((m, d) => (d.batches > m.batches ? d : m), data.busiest[0]); return top.batches > 0 ? <p className="prp-sub">{WEEKDAY[top.dow]} is busiest: {Math.round(top.batches * 10) / 10} batches. Start that day’s prep early.</p> : null; })()}
        </section>
        <section className="prp-card prp-pad" aria-labelledby="ran-title"><h2 id="ran-title">Ran out</h2><p className="prp-sub">When an item hit zero during service</p>
          {data.ranOut.length === 0 ? <p className="prp-empty sm">Nothing ran out {data.range === 'day' ? 'that day' : data.range === 'year' ? 'this year' : 'that week'}.</p> :
            <ul className="prp-ran">{data.ranOut.slice(0, 6).map((r, i) => <li key={i}><span className="ic">{Ico.warn}</span><span><Link to={`/prep/item/${r.itemId}`}><strong>{r.item}</strong></Link>
              <small>{dayLabel(r.day, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')} · {timeOf(r.at)}{r.note ? ` · ${r.note}` : ''}</small></span></li>)}</ul>}
          {data.ranOut.length > 0 && <div className="prp-callout"><span>Raise the pars for {data.ranOut.length === 1 ? 'this one' : 'these'}?</span><Link className="prp-btn sm dark" to={`/prep/item/${data.ranOut[0].itemId}`}>Review Pars</Link></div>}
        </section>
      </div>
      <section className="prp-card" aria-labelledby="ei-title">
        <div className="prp-card-head pad"><div><h2 id="ei-title">Every item · {data.period.label}</h2><p className="prp-sub">Compared with {data.period.prevLabel}. Tap an item to open it.</p></div>
          <div className="prp-chips" role="group" aria-label="Show">{(['all', 'juice', 'syrup', 'garnish'] as const).map((k) => <button key={k} type="button" className={'prp-chip' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'all' ? 'All' : KIND_LABEL[k]} {counts[k]}</button>)}</div></div>
        <div className="prp-table items" role="table" aria-label="Every item">
          <div className="prp-tr prp-th" role="row"><span role="columnheader">Item</span><span role="columnheader">Made</span><span role="columnheader">Used</span><span role="columnheader">Wasted</span><span role="columnheader">In use</span><span role="columnheader">Waste</span><span role="columnheader">Vs {data.range === 'year' ? 'last year' : data.range === 'day' ? 'day before' : 'week before'}</span><span role="columnheader">Ran out</span></div>
          {rows.map((r) => (
            <div key={r.id} className="prp-tr" role="row">
              <span role="cell" data-l="Item" className="c-name"><Link to={`/prep/item/${r.id}`}>{r.name}</Link>{r.archived && <small> · archived</small>}</span>
              <span role="cell" data-l="Made">{amt(r.made, r.unit)}</span>
              <span role="cell" data-l="Used">{amt(r.used, r.unit)}</span>
              <span role="cell" data-l="Wasted">{amt(r.wasted, r.unit)}</span>
              <span role="cell" data-l="In use">{r.inUse ? amt(r.inUse, r.unit) : '—'}</span>
              <span role="cell" data-l="Waste"><span className={'prp-pct' + (r.wastePct == null ? '' : r.wastePct >= 20 ? ' bad' : r.wastePct >= 12 ? ' warn' : ' ok')}>{pctText(r.wastePct)}</span></span>
              <span role="cell" data-l="Vs before" className={r.vsPrev == null ? 'muted' : r.vsPrev < 0 ? 'good' : r.vsPrev > 0 ? 'bad' : ''}>{r.vsPrev == null ? '—' : r.vsPrev === 0 ? 'Same' : `${r.vsPrev < 0 ? 'Down' : 'Up'} ${Math.abs(r.vsPrev)} ${Math.abs(r.vsPrev) === 1 ? 'pt' : 'pts'}`}</span>
              <span role="cell" data-l="Ran out">{r.ranOut ? `${r.ranOut} · ${r.ranOutDays.join(', ')}` : '—'}</span>
            </div>
          ))}
        </div>
        <p className="prp-sub pad">Juices and syrups in their own units, garnishes in pieces, never added together. Waste is wasted ÷ made. No cost tracking yet.</p>
      </section>
      <div className="prp-cols2">
        <section className="prp-card prp-pad" aria-labelledby="yoy-title"><h2 id="yoy-title">Year over year</h2><p className="prp-sub">Same period, one year apart</p>
          {data.lastYear ? <p className="prp-note">{data.range === 'year' ? `The tiles and table above compare ${data.period.label} with ${data.period.prevLabel}.` : <>There’s a year of logs. <button type="button" className="prp-link asbtn" onClick={() => set('range', 'year')}>Compare Year over Year {Ico.arrow}</button></>}</p> : (
            <div className="prp-emptybox">{Ico.clock}<strong>Starts when you have a year of logs</strong>
              <span>{data.started ? `You started logging prep on ${dayLabel(data.started, { month: 'short', day: 'numeric', year: 'numeric' })}. The first year-over-year view is the week of ${dayLabel(data.started.replace(/^\d{4}/, (y) => String(Number(y) + 1)), { month: 'short', day: 'numeric', year: 'numeric' })}.` : 'Nothing is logged yet.'}</span></div>
          )}
          <p className="prp-sub">Until then, compare day over day or week over week.</p>
        </section>
        {hasChat(user) ? (
          <section className="prp-send" id="send" aria-labelledby="send-title">
            <p className="prp-kicker">Send to Team Chat · #Bar</p><h2 id="send-title">{data.range === 'week' ? 'Weekly' : data.range === 'day' ? 'Daily' : 'Yearly'} summary</h2>
            <div className="prp-send-card">
              {editMsg ? <label><span className="sr-only">Message</span><textarea rows={5} value={msg} maxLength={1500} onChange={(e) => setMsg(e.target.value)} /></label> : <p>{msg}</p>}
              <div className="prp-send-att"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 1.5h5L12.5 5v9.5h-8.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg><span><strong>Prep report · {data.period.label}</strong><small>Opens this report in the app</small></span></div>
            </div>
            <div className="prp-row-btns end">
              <button type="button" className="prp-btn ghostdark" onClick={() => setEditMsg((v) => !v)} aria-pressed={editMsg}>{editMsg ? 'Done Editing' : 'Edit Message'}</button>
              <button type="button" className="prp-btn ondark" disabled={sending} onClick={() => void send()}>{sending ? 'Sending…' : 'Send Now'}</button>
            </div>
          </section>
        ) : <span />}
      </div>
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
      {toast === 'Sent to #Bar in Team Chat.' && <button type="button" className="sr-only" onClick={() => openChat({ room: 'bar' })}>Open #Bar</button>}
    </div>
  );
}
