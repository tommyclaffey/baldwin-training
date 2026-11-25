// Tip Tracker: the parts every Tips screen shares (the person's pages and the manager's Owed to Staff).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isDenied } from '../lib/api';
import { useSession } from '../lib/session';
import { dayField, dayShort, money, STATUS_WORD, toCents, type Status } from './data';

export const Ico = {
  lock: (s = 13) => <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.25" y="7" width="9.5" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.6" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.6" /></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  left: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m11 4-5 5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  right: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m7 4 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  chev: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  check: <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2.5 7.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  cal: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.75" y="3.75" width="12.5" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M2.75 7.5h12.5M6 2.25v3M12 2.25v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  x: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
};

/** Owed / Part Settled / Settled, text centred both ways (Figma component 1041:4491). */
export function StatusPill({ status }: { status: Status }) {
  return <span className={'tip-pill ' + status}>{status === 'settled' && Ico.check}{STATUS_WORD[status]}</span>;
}
export const PrivacyPill = () => <span className="tip-privacy">{Ico.lock()}Only you can see this</span>;
export function DemoData() {
  const { user } = useSession();
  return user?.demo ? <span className="tip-demo" title="A sample restaurant: every number here is made up.">Demo data</span> : null;
}
export const Money = ({ c, sign, className = '' }: { c: number; sign?: boolean; className?: string }) => <span className={'tip-money ' + className}>{money(c, { sign })}</span>;
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="tip-error" role="alert">{error}{retry && !isDenied(error) && <button type="button" className="tip-btn sm" onClick={retry}>Try Again</button>}</div>;
}
export const Loading = () => <div className="tip-loading" aria-busy="true"><div className="loader" /></div>;

/** Phones and small tablets get the phone layout (the app's drawer breakpoint is 1239; the page itself reflows at 900). */
export function useWide(min = 901) {
  const q = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const on = () => setWide(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, [q]);
  return wide;
}

/** A sheet. 'panel': full screen on phones, a panel on the right on desktop (Log a Shift, Figma 1049:4853).
 *  'dialog': a bottom sheet on phones, centred on desktop (Mark as Settled, 1046:4852). Escape and the backdrop close it. */
export function Sheet({ title, sub, kind = 'dialog', onClose, children, foot }: { title: string; sub?: ReactNode; kind?: 'panel' | 'dialog'; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const id = useId();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('h2')?.focus();
    document.body.classList.add('menu-lock');
    const was = back.current;
    return () => { document.body.classList.remove('menu-lock'); was?.focus?.(); };
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const els = [...ref.current.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href]')].filter((x) => !x.hasAttribute('disabled') && x.getClientRects().length);
    if (!els.length) return;
    const a = els[0], z = els[els.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  };
  return createPortal(
    <div className={'tip-sheet-back ' + kind} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={trap}>
      <div className={'tip-sheet ' + kind} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        {kind === 'dialog' && <span className="tip-grab" aria-hidden="true" />}
        <div className="tip-sheet-head">
          <div><h2 className="tip-sheet-title" id={id} tabIndex={-1}>{title}</h2>{sub && <p className="tip-sheet-sub">{sub}</p>}</div>
          <button type="button" className="tip-x" aria-label="Close" onClick={onClose}>{Ico.x}</button>
        </div>
        <div className="tip-sheet-body">{children}</div>
        {foot && <div className="tip-sheet-foot">{foot}</div>}
      </div>
    </div>, document.body);
}

/** A money field: "$" then the amount, a numeric keyboard on phones. `big` = the drawn 64 px fields (cash, card, how much). */
export function MoneyField({ label, name, value, onChange, big, required, invalid }: { label: string; name: string; value: string; onChange: (v: string) => void; big?: boolean; required?: boolean; invalid?: boolean }) {
  const id = useId();
  const bad = value.trim() !== '' && toCents(value) === null;
  return (
    <div className={'tip-field' + (big ? ' big' : '')}>
      <label htmlFor={id}>{label}</label>
      <div className={'tip-input money' + (bad || invalid ? ' bad' : '')}>
        <span aria-hidden="true">$</span>
        <input id={id} name={name} data-money="" type="text" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={value} required={required}
          aria-invalid={bad || invalid || undefined} onChange={(e) => onChange(e.target.value.replace(/[^\d.,$]/g, ''))} />
      </div>
    </div>
  );
}
export function HoursField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="tip-field">
      <label htmlFor={id}>Hours (optional)</label>
      <div className="tip-input unit"><input id={id} name="hours" type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} /><span aria-hidden="true">h</span></div>
    </div>
  );
}
export function TextField({ label, name, value, onChange, placeholder, max = 300, required }: { label: string; name: string; value: string; onChange: (v: string) => void; placeholder?: string; max?: number; required?: boolean }) {
  const id = useId();
  return (
    <div className="tip-field">
      <label htmlFor={id}>{label}</label>
      <div className="tip-input"><input id={id} name={name} type="text" maxLength={max} value={value} placeholder={placeholder} required={required} onChange={(e) => onChange(e.target.value)} /></div>
    </div>
  );
}
/** The date: the day in words ("Today · Wed, Nov 25"), the phone's own date picker on top of it. */
export function DateField({ label, value, onChange, today }: { label: string; value: string; onChange: (v: string) => void; today: string }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="tip-field">
      <label htmlFor={id}>{label}</label>
      <div className="tip-input date">
        {Ico.cal}<span aria-hidden="true">{dayField(value, today)}</span>
        <input ref={ref} id={id} type="date" value={value} max={today} required aria-label={`${label}: ${dayShort(value)}`}
          onClick={() => { try { ref.current?.showPicker?.(); } catch { /* the browser opens its own */ } }}
          onChange={(e) => { if (e.target.value) onChange(e.target.value > today ? today : e.target.value); }} />
      </div>
    </div>
  );
}
/** One choice of a few, as chips (Lunch / Dinner, the positions, Why). */
export function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="tip-field tip-chipset">
      <legend>{label}</legend>
      <div className="tip-chips" role="radiogroup" aria-label={label}>
        {options.map((o) => <button key={o.key} type="button" role="radio" aria-checked={value === o.key} className={'tip-chip' + (value === o.key ? ' on' : '')} onClick={() => onChange(o.key)}>{o.label}</button>)}
      </div>
    </fieldset>
  );
}
export function Switch({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub: string }) {
  const id = useId();
  return (
    <div className="tip-switchrow">
      <div><strong id={id}>{label}</strong><small>{sub}</small></div>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={id} className={'tip-switch' + (on ? ' on' : '')} onClick={() => onChange(!on)}><i /></button>
    </div>
  );
}

/** Mark as Settled (Figma 1046:4852; inline on desktop, 1050:4864): all of what's left, or part of it, and the day it was paid. */
export function SettleForm({ remaining, day, today, onSettle, compact, aside }: { remaining: number; day: string; today: string; onSettle: (body: { all?: boolean; amount?: string; paidOn: string }) => Promise<void>; compact?: boolean; aside?: ReactNode }) {
  const [all, setAll] = useState(true);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cents = toCents(amount);
  const left = !all && cents != null && cents > 0 && cents < remaining ? remaining - cents : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!all && (!cents || cents <= 0)) { setError('Enter the amount paid.'); return; }
    if (!all && cents! > remaining) { setError(`Only ${money(remaining)} is still owed. Enter that or less.`); return; }
    if (paidOn < day) { setError('The date paid can’t be before the day it’s from.'); return; }
    setBusy(true);
    try { await onSettle(all ? { all: true, paidOn } : { amount, paidOn }); } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  return (
    <div className={'tip-settle' + (compact ? ' compact' : '')}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Chips label="How much did you get?" value={all ? 'all' : 'part'} onChange={(v) => setAll(v === 'all')}
          options={[{ key: 'all', label: `All of It · ${money(remaining)}` }, { key: 'part', label: 'Part of It' }]} />
        {!all && <MoneyField big label="Amount paid" name="paid" value={amount} onChange={setAmount} required />}
        {left != null && <p className="tip-hint strong">{money(left)} will still show as owed.</p>}
        <DateField label="Date paid" value={paidOn} onChange={setPaidOn} today={today} />
        {error && <p className="tip-err" role="alert">{error}</p>}
        <div className="tip-btnrow">{aside}<button type="submit" className="tip-btn primary wide" disabled={busy}>{busy ? 'Saving…' : 'Mark Settled'}</button></div>
      </form>
    </div>
  );
}
