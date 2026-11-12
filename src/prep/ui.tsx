// Prep tracker: the parts every prep screen shares (Today, the Shift Count, the item page, Reports).
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { theme } from '../lib/theme';
import { amt, dayLabel, KIND_LABEL, pageTitle, roleStyle, shelfWords, timeOf, UNIT_LABEL, useByWords, type Kind, type Person, type Today } from './data';

/* ------------------------------------------------------------------ shared bits */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { if (!path) return Promise.resolve(); setError(''); return api<T>(path).then(setData).catch((e) => setError((e as Error).message)); }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load, setData };
}

export const Ico = {
  juice: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" /><path d="M10 2.75v14.5M2.75 10h14.5M4.9 4.9l10.2 10.2M15.1 4.9 4.9 15.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
  syrup: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5c2.8 3.6 5 6.4 5 9.2a5 5 0 0 1-10 0c0-2.8 2.2-5.6 5-9.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
  garnish: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 16c0-7 4.5-11 12-12-.5 7.5-4.5 12-12 12Zm0 0 6.5-6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  check: <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2.5 7.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  bin: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  warn: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2 1.5 13.5h13L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  arrow: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  clock: <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" /><path d="M10 6v4.2l2.8 1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  count: <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="2.5" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M6 2.5V2h4v.5M5.8 7h4.4M5.8 10h4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  lock: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.5" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.5" /></svg>,
  minus: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  plusBig: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  redo: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M12.5 8A4.5 4.5 0 1 1 11 4.6M11.5 2v3h-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  pencil: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3l7.5-7.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>,
  book: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 3.5c2-.8 4-.8 6 .6 2-1.4 4-1.4 6-.6V13c-2-.8-4-.8-6 .6-2-1.4-4-1.4-6-.6V3.5ZM8 4.1v9.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>,
};
export const KindDot = ({ kind }: { kind: Kind }) => <span className={'prp-dot ' + kind} aria-hidden="true">{Ico[kind]}</span>;
export const Avatar = ({ p }: { p: Person }) => <span className="prp-av" aria-hidden="true">{p.initials}</span>;

/** The page's head: the accent line (The Baldwin's script, Mise's label), the title, and its pills. */
export function Head({ line, title, pills, crumbs, tools }: { line: string; title: string; pills?: ReactNode; crumbs?: ReactNode; tools?: ReactNode }) {
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
export function DemoPill() {
  const { user } = useSession();
  return user?.demo ? <span className="prp-pill demo" title="This is a sample restaurant: every number here is made up.">Demo data</span> : null;
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="prp-error" role="alert">{error}{retry && <button type="button" className="prp-btn sm" onClick={retry}>Try Again</button>}</div>;
}
export const Loading = () => <div className="prp-loading" aria-busy="true"><div className="loader" /></div>;
export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [text, onDone]);
  return createPortal(<div className="eip-toast" role="status"><span className="dot" aria-hidden="true" />{text}</div>, document.body);
}

/** A sheet: a dialog that slides up on phones and sits centred on bigger screens. Escape and the backdrop close it. */
export function Sheet({ title, kicker, onClose, children }: { title: string; kicker: string; onClose: () => void; children: ReactNode }) {
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
export type BatchFor = { itemId?: number; amount?: number; forShift?: 'last' };
export function BatchForm({ data, start, onDone, inline }: { data: Today; start?: BatchFor; onDone: (msg: string) => void; inline?: boolean }) {
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
  const last = start?.forShift === 'last';
  // The count gates the prep list (Figma 666:1413): today's batches wait for today's count.
  if (!data.counted && !last) return <p className="prp-muted">Count first. Today’s batches are logged after the shift count. <Link className="prp-link" to="/prep/count">Start the Count {Ico.arrow}</Link></p>;
  const useBy = item.useByIfMadeNow;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const madeAt = when === 'now' || last ? undefined : new Date(Date.now() - Number(when) * 60e3).toISOString();
      await api('/api/prep/batches', { method: 'POST', body: { itemId, amount: Number(amount), madeBy, madeAt, ranOut, forShift: last ? 'last' : undefined } });
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
      {last ? <p className="prp-hint">It goes on the shift that started {item.lastDay ? dayLabel(item.lastDay, { weekday: 'long' }) : 'last time'}, the one nobody logged it on, so that shift’s numbers add up.</p> : <label className="prp-field"><span>Made at</span>
        <select value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
          <option value="now">Just now, {timeOf(new Date().toISOString())}</option><option value="30">30 minutes ago</option><option value="60">An hour ago</option><option value="120">2 hours ago</option>
        </select></label>}
      {!last && <label className="prp-check"><input type="checkbox" checked={ranOut} onChange={(e) => setRanOut(e.target.checked)} /><span>We ran out before this batch</span></label>}
      {!last && <div className="prp-useby">{Ico.clock}<div><strong>{useBy == null ? 'No use-by yet' : `Use by ${useByWords(useBy).toLowerCase()}`}</strong>
        <small>{useBy == null ? 'Shelf life isn’t set for this item. A manager sets it on its page.' : `${item.name} ${shelfWords(item.shelfDays).toLowerCase()}. Set on its item page.`}</small></div></div>}
      {error && <p className="prp-err" role="alert">{error}</p>}
      <button type="submit" className="prp-btn dark wide" disabled={busy}>{Ico.check}{busy ? 'Logging…' : 'Log Batch'}</button>
    </form>
  );
}

export const REASONS: [string, string][] = [['expired', 'Expired'], ['spilled', 'Spilled'], ['quality', 'Quality'], ['other', 'Other']];
export type WasteFor = { batchId?: number; itemId?: number };
export type OpenBatch = { batchId: number; itemId: number; label: string; remaining: number; unit: string; expired: boolean };
export function WasteForm({ batches, start, onDone }: { batches: OpenBatch[]; start?: WasteFor; onDone: (msg: string) => void }) {
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
      {b && <p className="prp-hint">{amt(b.remaining, b.unit)} left in this batch.{reason === 'expired' ? ' Expired clears the batch.' : ' Waste is never counted as used.'}</p>}
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
export function openFromToday(d: Today): OpenBatch[] {
  const out: OpenBatch[] = d.useFirst.map((u) => ({ batchId: u.batchId, itemId: u.itemId, remaining: u.remaining, unit: u.unit, expired: false,
    label: `${u.name} · ${dayLabel(u.day, { weekday: 'short' })} batch` }));
  return out;
}

