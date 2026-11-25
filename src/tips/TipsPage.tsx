// Tip Tracker (Nov 25; Tommy approved Figma 09 · Idea Board → 52, 1041:4459). A private tip log: log a shift at the end of
// the night, see the week and the pay period, and keep a list of money the restaurant still owes you until it's settled.
//   /tips              Tips home (phone 1044:4605, empty 1044:4460, full week 1044:4817; desktop 1048:4845)
//   /tips/owed         Owed to You (phone 1046:4673; desktop 1050:4864, with the selected item on the right)
//   /tips/owed/:id     an owed item (phone 1046:5067); on desktop the same Owed page with that item selected
//   Log a Shift (phone 1045:4629 / 1045:4794; desktop panel 1049:4853), Edit Shift (1045:4947), Mark as Settled (1046:4852)
// Only the signed-in person's own numbers ever reach this page (server/tips.mjs). Money is Archivo with tabular figures.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { pageTitle, roleStyle } from '../prep/data';
import { Toast, useLoad } from '../prep/ui';
import {
  centsInput, dayShort, dom, dow, FOOTNOTE, fromLine, hoursInput, hoursOf, money, monthDay, partNow, partWord, rangeWords, REASONS, short, toCents,
  type Owed, type OwedList, type Reason, type Shift, type TipsPageData,
} from './data';
import { Chips, DateField, DemoData, ErrorBox, HoursField, Ico, Loading, Money, MoneyField, PrivacyPill, SettleForm, Sheet, StatusPill, Switch, TextField, useWide } from './ui';
import './tips.css';

export function TipsPage() {
  const { pathname } = useLocation();
  const m = /^\/tips\/owed\/(\d+)/.exec(pathname);
  const wide = useWide();
  useEffect(() => { document.title = (pathname.startsWith('/tips/owed') ? 'Owed to You' : 'Tips') + ' · Mise'; }, [pathname]);
  return <main className="tip-main">{pathname.startsWith('/tips/owed') ? (m && !wide ? <OwedItemPage id={Number(m[1])} /> : <OwedPage selected={m ? Number(m[1]) : null} />) : <TipsHome />}</main>;
}

/** The page's title in the look's page-title face (Mise: DM Serif Display italic). */
export const Title = ({ children, id }: { children: string; id?: string }) => {
  const { fontFamily, fontWeight, letterSpacing } = roleStyle('pageTitle');
  return <h1 id={id} className="tip-title" style={{ fontFamily, fontWeight, letterSpacing }}>{pageTitle(children)}</h1>;
};
export const Crumbs = ({ parts }: { parts: [string, string?][] }) => (
  <p className="tip-crumbs">{parts.map(([w, to], i) => <span key={w}>{i > 0 && <span aria-hidden="true">/</span>}{to ? <Link to={to}>{w}</Link> : w}</span>)}</p>
);
/** Signed in as someone (a super admin's support view): the page stays closed. */
function Closed({ error }: { error: string }) {
  return (
    <div className="tip">
      <Crumbs parts={[['Private'], ['Tips']]} />
      <Title>Tips</Title>
      <section className="tip-card tip-closed">{Ico.lock(20)}<div><h2>Tips are private</h2><p>{error}</p></div></section>
    </div>
  );
}
const closedError = (e: string) => /private to|signed in as someone|for people on a restaurant/i.test(e);

/* ------------------------------------------------------------------ Tips home */
function TipsHome() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') === 'period' ? 'period' : 'week';
  const at = sp.get('at') || '';
  const { data, error, load } = useLoad<TipsPageData>(`/api/tips?view=${view}${at ? '&at=' + at : ''}`);
  const wide = useWide();
  const [sheet, setSheet] = useState<{ kind: 'log' } | { kind: 'edit'; id: number } | null>(null);
  const [toast, setToast] = useState('');
  if (error) return closedError(error) ? <Closed error={error} /> : <div className="tip"><ErrorBox error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="tip"><Loading /></div>;
  const go = (next: { view?: string; at?: string | null }) => {
    const q = new URLSearchParams();
    const v = next.view ?? view; if (v === 'period') q.set('view', 'period');
    const a = next.at === undefined ? at : next.at; if (a) q.set('at', a);
    setSp(q, { replace: true });
  };
  const done = (msg: string) => { setSheet(null); setToast(msg); void load(); };
  const t = data.totals;
  const period = view === 'period';
  const range = rangeWords(data.from, data.to);
  const thisOne = data.current;
  const lastOne = !thisOne && data.next && (period ? data.to >= addDaysIso(data.today, -14) : data.to >= addDaysIso(data.today, -7));
  const which = period ? (thisOne ? 'this pay period' : lastOne ? 'last pay period' : 'pay period') : (thisOne ? 'this week' : lastOne ? 'last week' : 'week of');
  const listHead = thisOne ? `Shifts ${which} · ${t.count}` : `${which} · ${range} · ${t.count} ${t.count === 1 ? 'shift' : 'shifts'}`;
  const sheets = <>
    {sheet?.kind === 'log' && <LogShift data={data} onClose={() => setSheet(null)} onDone={done} />}
    {sheet?.kind === 'edit' && <EditShift id={sheet.id} onClose={() => setSheet(null)} onDone={done} />}
    {toast && <Toast text={toast} onDone={() => setToast('')} />}
  </>;
  const logBtn = (cls = '') => <button type="button" className={'tip-btn primary ' + cls} onClick={() => setSheet({ kind: 'log' })}>{Ico.plus}Log a Shift</button>;
  const toggles = (
    <div className="tip-toggles" role="group" aria-label="Show">
      <button type="button" className={'tip-chip' + (!period ? ' on' : '')} aria-pressed={!period} onClick={() => go({ view: 'week', at: null })}>Week</button>
      <button type="button" className={'tip-chip' + (period ? ' on' : '')} aria-pressed={period} onClick={() => go({ view: 'period', at: null })}>Pay Period</button>
    </div>
  );
  const steps = (label?: ReactNode) => (
    <div className="tip-steps">
      <button type="button" className="tip-round" aria-label={period ? 'Earlier pay period' : 'Earlier week'} disabled={!data.prev} onClick={() => data.prev && go({ at: data.prev })}>{Ico.left}</button>
      {label}
      <button type="button" className="tip-round" aria-label={period ? 'Later pay period' : 'Later week'} disabled={!data.next} onClick={() => data.next && go({ at: data.next })}>{Ico.right}</button>
    </div>
  );
  const owedLine = data.owed.count ? `${data.owed.count} ${data.owed.count === 1 ? 'item' : 'items'}${data.owed.oldest ? ' · oldest ' + monthDay(data.owed.oldest) : ''}` : 'Nothing owed right now';

  if (!data.anyShifts) return ( // first time (Figma 1044:4460)
    <div className="tip">
      <Crumbs parts={[['Private'], ['Tips']]} />
      <div className="tip-titlerow"><Title>Tips</Title><span className="tip-pills"><DemoData /><PrivacyPill /></span></div>
      <div className="tip-empty-grid">
        <section className="tip-card tip-first">
          <p className="tip-label">No shifts yet</p>
          <h2 className="tip-serif">Log your first shift</h2>
          <p>At the end of the night, take 20 seconds: cash tips, card tips and what you tipped out. Mise adds it up by week and by pay period.</p>
          <ol>
            <li><span>1</span>Cash and card, kept apart</li>
            <li><span>2</span>Tip-out comes off, so you see what you take home</li>
            <li><span>3</span>Add hours if you like, to see your hourly</li>
          </ol>
        </section>
        <Link to="/tips/owed" className="tip-owedcard">
          <span className="tip-label">Owed to You</span>
          <Money c={data.owed.remaining} className="xl" />
          <span>{data.owed.count ? owedLine : 'If the restaurant owes you cash, add it when you log a shift. It stays here until you mark it settled.'}</span>
        </Link>
      </div>
      <p className="tip-foot">{FOOTNOTE}</p>
      <div className="tip-dock">{logBtn('wide')}</div>
      {sheets}
    </div>
  );

  if (wide) return ( // desktop (Figma 1048:4845)
    <div className="tip">
      <Crumbs parts={[['Private'], ['Tips']]} />
      <div className="tip-titlerow">
        <div><Title>Tips</Title><p className="tip-lockline">{Ico.lock(15)}Only you can see this page. Not your manager, not the owner.</p></div>
        <div className="tip-tools"><DemoData /><Link to="/tips/owed" className="tip-btn">Owed to You</Link>{logBtn()}</div>
      </div>
      <div className="tip-controls">{toggles}{steps(<span className="tip-range">{rangeWords(data.from, data.to, true)}{period ? ' · every two weeks' : ''}</span>)}</div>
      <div className="tip-stats">
        <Stat label="Cash tips" c={t.cash} sub={`${t.count} ${t.count === 1 ? 'shift' : 'shifts'}`} />
        <Stat label="Card tips" c={t.card} sub={`${t.count} ${t.count === 1 ? 'shift' : 'shifts'}`} />
        <Stat label="Tip-out given" c={-t.tipout} sub="given out" />
        <Stat label="Net" c={t.net} sub={t.minutes ? `${hoursOf(t.minutes)} · ${money(t.hourly!)} / h` : 'add hours for an hourly'} />
        <Link to="/tips/owed" className="tip-stat dark"><span>Owed to You</span><Money c={data.owed.remaining} className="lg" /><small>{data.owed.count ? `${data.owed.count} ${data.owed.count === 1 ? 'item' : 'items'} · View` : 'View'}{Ico.chev}</small></Link>
      </div>
      <div className="tip-card tip-tablewrap">
        <table className="tip-table">
          <caption className="sr-only">Your shifts, {range}</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Shift</th><th scope="col" className="r">Hours</th><th scope="col" className="r">Cash</th><th scope="col" className="r">Card</th><th scope="col" className="r">Tip-out</th><th scope="col" className="r">Net</th><th scope="col" className="r">Owed</th></tr></thead>
          <tbody>
            {data.shifts.map((s) => (
              <tr key={s.id}>
                <th scope="row"><button type="button" className="tip-rowbtn" onClick={() => setSheet({ kind: 'edit', id: s.id })} aria-label={`Edit ${dayShort(s.day)}, ${partWord(s.part)}`}>{dayShort(s.day)}</button></th>
                <td>{partWord(s.part)}{s.position ? ' · ' + s.position : ''}</td>
                <td className="r tip-money">{s.minutes ? hoursOf(s.minutes).replace(' h', ' h') : ''}</td>
                <td className="r"><Money c={s.cash} /></td><td className="r"><Money c={s.card} /></td><td className="r"><Money c={-s.tipout} /></td><td className="r"><Money c={s.net} /></td>
                <td className="r">{s.owed.length > 0 && <StatusPill status={rowStatus(s)} />}</td>
              </tr>
            ))}
            {!data.shifts.length && <tr><td colSpan={8} className="tip-none">No shifts {which === 'week of' ? 'this week' : which}. {thisOne ? 'Log one at the end of the night.' : ''}</td></tr>}
          </tbody>
          {data.shifts.length > 0 && <tfoot><tr>
            <th scope="row">{period ? 'Pay period' : 'Week'}</th><td>{t.count} {t.count === 1 ? 'shift' : 'shifts'}</td>
            <td className="r tip-money">{t.minutes ? hoursOf(t.minutes).replace(' h', ' h') : ''}</td>
            <td className="r"><Money c={t.cash} /></td><td className="r"><Money c={t.card} /></td><td className="r"><Money c={-t.tipout} /></td><td className="r"><Money c={t.net} /></td><td />
          </tr></tfoot>}
        </table>
      </div>
      <p className="tip-foot">{FOOTNOTE}</p>
      {sheets}
    </div>
  );

  return ( // phone (Figma 1044:4605, 1044:4817)
    <div className="tip">
      <Crumbs parts={[['Private'], ['Tips']]} />
      <div className="tip-titlerow"><Title>Tips</Title><span className="tip-pills"><DemoData /><PrivacyPill /></span></div>
      <div className="tip-controls">{toggles}{steps()}</div>
      <section className="tip-card tip-totals" aria-label={`Totals, ${range}`}>
        <p className="tip-label">Net {which === 'week of' ? 'week of' : which} · {range}</p>
        <div className="tip-netrow">
          <Money c={t.net} className="xxl" />
          {t.minutes > 0 && <div className="tip-hourly"><small>{hoursOf(t.minutes)} logged</small><span className="tip-money">{money(t.hourly!)} / h</span></div>}
        </div>
        <div className="tip-split">
          <div><small>Cash tips</small><Money c={t.cash} /></div>
          <div><small>Card tips</small><Money c={t.card} /></div>
          <div><small>Tip-out given</small><Money c={-t.tipout} /></div>
        </div>
      </section>
      <Link to="/tips/owed" className="tip-owedcard row">
        <span><span className="tip-label">Owed to You</span><Money c={data.owed.remaining} className="xl" /><span>{owedLine}</span></span>
        <span className="tip-view">View{Ico.chev}</span>
      </Link>
      <p className="tip-label tip-listhead">{listHead}</p>
      {data.shifts.length ? (
        <ul className="tip-card tip-list">
          {data.shifts.map((s) => (
            <li key={s.id}>
              <button type="button" className="tip-shiftrow" onClick={() => setSheet({ kind: 'edit', id: s.id })} aria-label={`${dayShort(s.day)}, ${partWord(s.part)}: net ${money(s.net)}. Edit`}>
                <span className="tip-date" aria-hidden="true"><small>{dow(s.day)}</small><b>{dom(s.day)}</b></span>
                <span className="tip-rowtext"><span className="tip-rowtitle">{partWord(s.part)}{s.position ? ' · ' + s.position : ''}{s.owed.length > 0 && <StatusPill status={rowStatus(s)} />}</span>
                  <small>{[hoursOf(s.minutes), `Cash ${short(s.cash)}`, `Card ${short(s.card)}`].filter(Boolean).join(' · ')}</small></span>
                <span className="tip-rownet"><Money c={s.net} /><small>net</small></span>
                {Ico.chev}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="tip-card tip-none">No shifts {thisOne ? which : 'that ' + (period ? 'pay period' : 'week')}.{thisOne ? ' Log one at the end of the night.' : ''}</p>}
      {data.shifts.length > 0 && (
        <section className="tip-card tip-weektotal" aria-label={`${period ? 'Pay period' : 'Week'} total`}>
          <p className="tip-label">{period ? 'Pay period' : 'Week'} total · {range}</p>
          <dl>
            <div><dt>Cash tips</dt><dd><Money c={t.cash} /></dd></div>
            <div><dt>Card tips</dt><dd><Money c={t.card} /></dd></div>
            <div><dt>Tip-out given</dt><dd><Money c={-t.tipout} /></dd></div>
            {t.minutes > 0 && <><div><dt>Hours</dt><dd className="tip-money">{hoursOf(t.minutes)}</dd></div><div><dt>Hourly</dt><dd className="tip-money">{money(t.hourly!)} / h</dd></div></>}
            <div className="net"><dt>Net</dt><dd><Money c={t.net} /></dd></div>
          </dl>
        </section>
      )}
      <p className="tip-foot">{FOOTNOTE}</p>
      <div className="tip-dock">{logBtn('wide')}</div>
      {sheets}
    </div>
  );
}
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const rowStatus = (s: Shift) => (s.owed.some((o) => o.status === 'owed') ? 'owed' : s.owed.some((o) => o.status === 'part') ? 'part' : 'settled');
function Stat({ label, c, sub }: { label: string; c: number; sub: string }) {
  return <div className="tip-stat"><span>{label}</span><Money c={c} className="lg" /><small>{sub}</small></div>;
}

/* ------------------------------------------------------------------ Log a Shift (1045:4629, owed on 1045:4794, desktop 1049:4853) */
function LogShift({ data, onClose, onDone }: { data: TipsPageData; onClose: () => void; onDone: (msg: string) => void }) {
  const wide = useWide();
  const [day, setDay] = useState(data.today);
  const [part, setPart] = useState<'lunch' | 'dinner'>(partNow());
  const [position, setPosition] = useState(data.position);
  const [cash, setCash] = useState(''); const [card, setCard] = useState(''); const [tipout, setTipout] = useState(''); const [hours, setHours] = useState(''); const [note, setNote] = useState('');
  const [owedOn, setOwedOn] = useState(false);
  const [owedAmount, setOwedAmount] = useState(''); const [reason, setReason] = useState<Reason | null>(null); const [label, setLabel] = useState(''); const [owedNote, setOwedNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const c = toCents(cash), d = toCents(card), o = toCents(tipout), ow = toCents(owedAmount);
  const net = c != null && d != null && o != null ? c + d - o : null;
  const submit = async (e?: FormEvent) => {
    e?.preventDefault(); setError('');
    if (!c && !d) { setError('Enter your cash tips or card tips (0 is fine for one of them).'); return; }
    if (owedOn && !ow) { setError('Enter how much the house owes you.'); return; }
    if (owedOn && !reason) { setError('Pick why the house owes you.'); return; }
    setBusy(true);
    try {
      await api('/api/tips/shifts', { method: 'POST', body: { day, part, position, cash, card, tipout, hours, note, owed: owedOn ? { on: true, amount: owedAmount, reason, label, note: owedNote } : undefined } });
      onDone(owedOn ? `Shift saved. ${money(ow!)} added to Owed to You.` : 'Shift saved.');
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  const foot = (
    <>
      <div className="tip-footsums">
        <p><span>Net tonight</span><Money c={net ?? 0} className={net == null ? 'muted' : ''} /></p>
        {owedOn && <p className="owed"><span>Owed to you</span><Money c={ow || 0} sign /></p>}
      </div>
      <div className="tip-btnrow">{wide && <button type="button" className="tip-btn" onClick={onClose}>Cancel</button>}<button type="button" className="tip-btn primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save Shift'}</button></div>
    </>
  );
  return (
    <Sheet kind="panel" title="Log a Shift" sub={<>{Ico.lock()}{day === data.today ? 'Tonight · only you can see this' : 'Only you can see this'}</>} onClose={onClose} foot={foot}>
      <form className="tip-form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="tip-grid2 dateshift">
          <DateField label="Date" value={day} onChange={setDay} today={data.today} />
          <Chips label="Shift" value={part} onChange={setPart} options={[{ key: 'lunch', label: 'Lunch' }, { key: 'dinner', label: 'Dinner' }]} />
        </div>
        <Chips label="Position" value={position} onChange={setPosition} options={data.positions.map((p) => ({ key: p, label: p }))} />
        <div className="tip-grid2">
          <MoneyField big label="Cash tips" name="cash" value={cash} onChange={setCash} />
          <MoneyField big label="Card tips" name="card" value={card} onChange={setCard} />
        </div>
        <div className="tip-grid3">
          <MoneyField label="Tip-out given (optional)" name="tipout" value={tipout} onChange={setTipout} />
          <HoursField value={hours} onChange={setHours} />
          <TextField label="Note (optional)" name="note" value={note} onChange={setNote} placeholder="Anything to remember" />
        </div>
        <section className={'tip-owedbox' + (owedOn ? ' on' : '')}>
          <Switch on={owedOn} onChange={setOwedOn} label="The house still owes me money" sub="Cash not paid out, card tips paid later, a short drawer" />
          {owedOn && <>
            <div className="tip-grid2 owed">
              <MoneyField big label="How much" name="owedAmount" value={owedAmount} onChange={setOwedAmount} />
              <TextField label="Note (optional)" name="owedNote" value={owedNote} onChange={setOwedNote} placeholder="House was short on cash at close" />
            </div>
            <Chips label="Why" value={reason} onChange={setReason} options={REASONS.map((r) => ({ key: r.key, label: r.chip }))} />
            {reason === 'other' && <TextField label="What it’s for" name="owedLabel" value={label} onChange={setLabel} placeholder="Private party gratuity" max={80} required />}
            <p className="tip-hint">Shows as Owed on your Tips page until you mark it Settled.</p>
          </>}
        </section>
        {error && <p className="tip-err" role="alert">{error}</p>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Edit Shift + delete (1045:4947) */
function EditShift({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: (msg: string) => void }) {
  const { data, error } = useLoad<Shift>(`/api/tips/shifts/${id}`);
  const [f, setF] = useState<{ cash: string; card: string; tipout: string; hours: string; note: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (data && !f) setF({ cash: centsInput(data.cash), card: centsInput(data.card), tipout: centsInput(data.tipout), hours: hoursInput(data.minutes), note: data.note }); }, [data, f]);
  const set = (k: keyof NonNullable<typeof f>) => (v: string) => setF((x) => x && { ...x, [k]: v });
  const save = async () => {
    setErr(''); setBusy(true);
    try { await api(`/api/tips/shifts/${id}`, { method: 'PATCH', body: f }); onDone('Changes saved.'); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const del = async () => {
    setErr(''); setBusy(true);
    try { await api(`/api/tips/shifts/${id}`, { method: 'DELETE' }); onDone('Shift deleted.'); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const owedLeft = data?.owed.reduce((s, o) => s + o.remaining, 0) || 0;
  return (
    <Sheet kind="panel" title="Edit Shift" sub={data ? `${dayShort(data.day)} · ${partWord(data.part)}${data.position ? ' · ' + data.position : ''}` : ''} onClose={onClose}
      foot={f && <div className="tip-btnrow"><button type="button" className="tip-btn dark wide" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save Changes'}</button></div>}>
      {error && <ErrorBox error={error} />}
      {!f || !data ? (!error && <Loading />) : (
        <form className="tip-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          <div className="tip-grid2">
            <MoneyField big label="Cash tips" name="cash" value={f.cash} onChange={set('cash')} />
            <MoneyField big label="Card tips" name="card" value={f.card} onChange={set('card')} />
          </div>
          <div className="tip-grid2">
            <MoneyField label="Tip-out given (optional)" name="tipout" value={f.tipout} onChange={set('tipout')} />
            <HoursField value={f.hours} onChange={set('hours')} />
          </div>
          <TextField label="Note (optional)" name="note" value={f.note} onChange={set('note')} />
          {data.owed.map((o) => (
            <Link key={o.id} to={`/tips/owed/${o.id}`} className="tip-fromshift"><span><strong>Owed from this shift</strong><small>{o.label}</small></span><StatusPill status={o.status} /><Money c={o.status === 'settled' ? o.amount : o.remaining} /></Link>
          ))}
          {confirm ? (
            <section className="tip-confirm" aria-labelledby="del-h">
              <h3 id="del-h">Delete this shift?</h3>
              <p>Its {money(data.net)} comes off this {'week'}’s total.{owedLeft > 0 ? ` The ${money(owedLeft)} the house owes you stays on your Owed list.` : data.owed.length ? ' What the house owed you from it stays on your Owed list.' : ''}</p>
              <div className="tip-btnrow"><button type="button" className="tip-btn" onClick={() => setConfirm(false)}>Keep It</button><button type="button" className="tip-btn primary" disabled={busy} onClick={() => void del()}>Delete Shift</button></div>
            </section>
          ) : <button type="button" className="tip-btn ghost danger" onClick={() => setConfirm(true)}>Delete Shift</button>}
          {err && <p className="tip-err" role="alert">{err}</p>}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Owed to You (1046:4673; desktop 1050:4864) */
function OwedPage({ selected }: { selected: number | null }) {
  const { data, error, load } = useLoad<OwedList>('/api/tips/owed');
  const wide = useWide();
  const nav = useNavigate();
  const [sheet, setSheet] = useState<{ kind: 'settle' | 'edit'; item: Owed } | { kind: 'add' } | null>(null);
  const [toast, setToast] = useState('');
  const today = todayOf();
  if (error) return closedError(error) ? <Closed error={error} /> : <div className="tip"><ErrorBox error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="tip"><Loading /></div>;
  const all = [...data.open, ...data.settled];
  const pick = wide ? all.find((x) => x.id === selected) || data.open[0] || data.settled[0] || null : null;
  const done = (msg: string) => { setSheet(null); setToast(msg); void load(); };
  const n = data.open.length;
  const row = (o: Owed) => {
    const sub = o.status === 'settled' ? `${fromLine(o).replace(/ · (Lunch|Dinner)$/, '')} · Settled ${monthDay(o.settledOn!)}` : o.status === 'part' ? `${fromLine(o).replace(/ · (Lunch|Dinner)$/, '')} · ${money(o.paid)} paid${wide && o.payments.length ? ' ' + monthDay(o.payments[o.payments.length - 1].paidOn) : ''}` : fromLine(o);
    return (
      <li key={o.id} className={'tip-owed-row' + (pick?.id === o.id ? ' on' : '')}>
        <Link to={`/tips/owed/${o.id}`} className="tip-owed-link" aria-current={pick?.id === o.id ? 'true' : undefined}>
          <span className="tip-rowtext"><span className="tip-rowtitle">{o.label}</span><small>{sub}</small></span>
          {wide && <StatusPill status={o.status} />}
          <span className="tip-rownet"><Money c={o.status === 'settled' ? o.amount : o.remaining} />{o.status === 'part' && <small>left of {money(o.amount)}</small>}{!wide && <StatusPill status={o.status} />}</span>
        </Link>
        {wide && <span className="tip-rowact">{o.status !== 'settled' && <button type="button" className="tip-btn sm" onClick={() => setSheet({ kind: 'settle', item: o })} aria-label={`Mark Settled: ${o.label}, ${fromLine(o)}`}>Mark Settled</button>}</span>}
      </li>
    );
  };
  const lists = (
    <div className="tip-owedlists">
      <p className="tip-label tip-listhead">Still owed · {n}</p>
      {n ? <ul className="tip-card tip-list">{data.open.map(row)}</ul> : <p className="tip-card tip-none">Nothing owed right now. When the house owes you cash, add it when you log a shift.</p>}
      {data.settledCount > 0 && <><p className="tip-label tip-listhead">Settled · {data.settledCount}</p><ul className="tip-card tip-list">{data.settled.map(row)}</ul></>}
      <p className="tip-foot">{FOOTNOTE}</p>
    </div>
  );
  const sheets = <>
    {sheet?.kind === 'settle' && <SettleSheet item={sheet.item} today={today} onClose={() => setSheet(null)} onDone={done} />}
    {sheet?.kind === 'edit' && <EditOwed item={sheet.item} onClose={() => setSheet(null)} onDone={(m, gone) => { if (gone) nav('/tips/owed', { replace: true }); done(m); }} />}
    {sheet?.kind === 'add' && <AddOwed today={today} onClose={() => setSheet(null)} onDone={done} />}
    {toast && <Toast text={toast} onDone={() => setToast('')} />}
  </>;
  const addBtn = (cls = '') => <button type="button" className={'tip-btn primary ' + cls} onClick={() => setSheet({ kind: 'add' })}>{Ico.plus}Add Owed Money</button>;
  if (!wide) return (
    <div className="tip">
      <div className="tip-titlerow top"><Crumbs parts={[['Private'], ['Tips', '/tips'], ['Owed']]} /><span className="tip-pills"><DemoData /><PrivacyPill /></span></div>
      <Title>Owed to You</Title>
      <p className="tip-bigline"><Money c={data.remaining} className="xl" /><span>still owed · {n} {n === 1 ? 'item' : 'items'}</span></p>
      {lists}
      <div className="tip-dock">{addBtn('wide')}</div>
      {sheets}
    </div>
  );
  return (
    <div className="tip">
      <Crumbs parts={[['Private'], ['Tips', '/tips'], ['Owed']]} />
      <div className="tip-titlerow">
        <div><Title>Owed to You</Title><p className="tip-lockline">{Ico.lock(15)}Only you can see this. {money(data.remaining)} still owed across {n} {n === 1 ? 'item' : 'items'}.</p></div>
        <div className="tip-tools"><DemoData /><Link to="/tips" className="tip-btn">Back to Tips</Link>{addBtn()}</div>
      </div>
      <div className="tip-owedcols">
        {lists}
        {pick && <section className="tip-card tip-detailcard" aria-label={pick.label}><OwedDetail item={pick} today={today} onSettled={done} onEdit={() => setSheet({ kind: 'edit', item: pick })} inline /></section>}
      </div>
      {sheets}
    </div>
  );
}
const todayOf = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });

/** An owed item: how much is left, its history, and Mark Settled (inline on desktop). */
function OwedDetail({ item: o, today, onSettled, onEdit, inline }: { item: Owed; today: string; onSettled: (msg: string) => void; onEdit: () => void; inline?: boolean }) {
  const pct = o.amount ? Math.round((o.paid / o.amount) * 100) : 0;
  const history = [...o.payments].reverse();
  return (
    <div className="tip-detail">
      {inline ? <p className="tip-detailtop"><StatusPill status={o.status} /><span>{fromLine(o)}</span></p> : null}
      <h2 className="tip-serif">{o.label}</h2>
      <p className="tip-label">{o.status === 'settled' ? `Settled ${monthDay(o.settledOn!)}${o.settledBy && o.settledBy !== 'you' ? ' by ' + o.settledBy : ''}` : 'Still owed'}</p>
      <p className="tip-bigline"><Money c={o.status === 'settled' ? o.amount : o.remaining} className="xxl" />{o.paid > 0 && o.status !== 'settled' && <span>of {money(o.amount)}</span>}</p>
      {o.paid > 0 && o.status !== 'settled' && <div className="tip-bar" role="progressbar" aria-label="Paid so far" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: pct + '%' }} /></div>}
      {o.paid > 0 && o.status !== 'settled' && !inline && <p className="tip-hint">{money(o.paid)} paid · {money(o.remaining)} left</p>}
      <p className="tip-label tip-listhead">History</p>
      <ul className="tip-history">
        {history.map((p) => <li key={p.id}><span><strong>Paid {money(p.amount)}</strong><small>{dayShort(p.paidOn)} · marked by {p.by}</small></span><Money c={-p.amount} /></li>)}
        <li><span><strong>Added as owed</strong><small>{dayShort(o.day)}{o.note ? ` · “${o.note}”` : ''}</small></span><Money c={o.amount} /></li>
      </ul>
      {inline ? (o.status !== 'settled'
        ? <><h3 className="tip-h3">Mark as Settled</h3><SettleForm compact remaining={o.remaining} day={o.day} today={today} onSettle={async (b) => { await api(`/api/tips/owed/${o.id}/settle`, { method: 'POST', body: b }); onSettled(b.all ? 'Marked settled.' : 'Payment saved.'); }}
            aside={<button type="button" className="tip-btn" onClick={onEdit}>Edit</button>} /></>
        : <div className="tip-btnrow"><button type="button" className="tip-btn" onClick={onEdit}>Edit</button></div>)
        : <p className="tip-lockline sm">{Ico.lock()}Only you can see this.</p>}
    </div>
  );
}

/** Phone: an owed item on its own page (1046:5067), Edit and Mark Settled at the bottom. */
function OwedItemPage({ id }: { id: number }) {
  const { data, error, load } = useLoad<Owed>(`/api/tips/owed/${id}`);
  const nav = useNavigate();
  const [sheet, setSheet] = useState<'settle' | 'edit' | null>(null);
  const [toast, setToast] = useState('');
  const today = todayOf();
  if (error) return closedError(error) ? <Closed error={error} /> : <div className="tip"><Link to="/tips/owed" className="tip-back">{Ico.left}Owed to You</Link><ErrorBox error={error} /></div>;
  if (!data) return <div className="tip"><Loading /></div>;
  const done = (msg: string) => { setSheet(null); setToast(msg); void load(); };
  return (
    <div className="tip">
      <Link to="/tips/owed" className="tip-back">{Ico.left}Owed to You</Link>
      <Title>{data.label}</Title>
      <p className="tip-detailtop"><StatusPill status={data.status} /><span>{fromLine(data)}</span><DemoData /></p>
      <section className="tip-card tip-detailcard"><OwedDetail item={data} today={today} onSettled={done} onEdit={() => setSheet('edit')} /></section>
      <div className="tip-dock"><div className="tip-btnrow">
        <button type="button" className="tip-btn" onClick={() => setSheet('edit')}>Edit</button>
        {data.status !== 'settled' && <button type="button" className="tip-btn primary grow" onClick={() => setSheet('settle')}>Mark Settled</button>}
      </div></div>
      {sheet === 'settle' && <SettleSheet item={data} today={today} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === 'edit' && <EditOwed item={data} onClose={() => setSheet(null)} onDone={(m, gone) => { if (gone) nav('/tips/owed', { replace: true, state: { toast: m } }); else done(m); }} />}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}

export function SettleSheet({ item, today, onClose, onDone, url, who }: { item: Owed; today: string; onClose: () => void; onDone: (msg: string) => void; url?: string; who?: string }) {
  return (
    <Sheet title="Mark as Settled" onClose={onClose}>
      <div className="tip-summary"><span><strong>{who ? `${who} · ` : ''}{item.label}</strong><small>{fromLine(item)}</small></span><Money c={item.remaining} /></div>
      <SettleForm remaining={item.remaining} day={item.day} today={today} onSettle={async (b) => {
        await api(url || `/api/tips/owed/${item.id}/settle`, { method: 'POST', body: b });
        onDone(b.all ? 'Marked settled.' : 'Payment saved.');
      }} />
    </Sheet>
  );
}

/** + Add Owed Money: money the house owes that isn't from a shift logged here. */
function AddOwed({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [day, setDay] = useState(today);
  const [part, setPart] = useState<'lunch' | 'dinner' | null>(null);
  const [amount, setAmount] = useState(''); const [reason, setReason] = useState<Reason | null>(null); const [label, setLabel] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!toCents(amount)) { setError('Enter how much the house owes you.'); return; }
    if (!reason) { setError('Pick why the house owes you.'); return; }
    setBusy(true);
    try { await api('/api/tips/owed', { method: 'POST', body: { day, part, amount, reason, label, note } }); onDone(`${money(toCents(amount)!)} added to Owed to You.`); } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  return (
    <Sheet title="Add Owed Money" sub={<>{Ico.lock()}Only you can see this</>} onClose={onClose}>
      <form className="tip-form" onSubmit={(e) => void submit(e)} noValidate>
        <DateField label="The day it’s from" value={day} onChange={setDay} today={today} />
        <Chips label="Shift (optional)" value={part} onChange={(v) => setPart(part === v ? null : v)} options={[{ key: 'lunch', label: 'Lunch' }, { key: 'dinner', label: 'Dinner' }]} />
        <MoneyField big label="How much" name="owedAmount" value={amount} onChange={setAmount} />
        <Chips label="Why" value={reason} onChange={setReason} options={REASONS.map((r) => ({ key: r.key, label: r.chip }))} />
        {reason === 'other' && <TextField label="What it’s for" name="owedLabel" value={label} onChange={setLabel} placeholder="Private party gratuity" max={80} required />}
        <TextField label="Note (optional)" name="owedNote" value={note} onChange={setNote} />
        {error && <p className="tip-err" role="alert">{error}</p>}
        <button type="submit" className="tip-btn primary wide" disabled={busy}>{busy ? 'Saving…' : 'Add Owed Money'}</button>
      </form>
    </Sheet>
  );
}

function EditOwed({ item, onClose, onDone }: { item: Owed; onClose: () => void; onDone: (msg: string, gone?: boolean) => void }) {
  const [amount, setAmount] = useState(centsInput(item.amount)); const [reason, setReason] = useState<Reason>(item.reason);
  const [label, setLabel] = useState(item.reason === 'other' ? item.label : ''); const [note, setNote] = useState(item.note || '');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { await api(`/api/tips/owed/${item.id}`, { method: 'PATCH', body: { amount, reason, label, note } }); onDone('Changes saved.'); } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  const del = async () => { setBusy(true); try { await api(`/api/tips/owed/${item.id}`, { method: 'DELETE' }); onDone('Owed item deleted.', true); } catch (err) { setError((err as Error).message); setBusy(false); } };
  return (
    <Sheet title="Edit Owed Money" sub={fromLine(item)} onClose={onClose}>
      <form className="tip-form" onSubmit={(e) => void submit(e)} noValidate>
        <Chips label="Why" value={reason} onChange={setReason} options={REASONS.map((r) => ({ key: r.key, label: r.chip }))} />
        {reason === 'other' && <TextField label="What it’s for" name="owedLabel" value={label} onChange={setLabel} max={80} required />}
        <MoneyField big label="How much" name="owedAmount" value={amount} onChange={setAmount} />
        {item.paid > 0 && <p className="tip-hint">{money(item.paid)} paid so far, so it can’t be less than that.</p>}
        <TextField label="Note (optional)" name="owedNote" value={note} onChange={setNote} />
        {error && <p className="tip-err" role="alert">{error}</p>}
        <button type="submit" className="tip-btn dark wide" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button>
        {confirm ? (
          <section className="tip-confirm" aria-labelledby="delo-h">
            <h3 id="delo-h">Delete this item?</h3>
            <p>It comes off your Owed list{item.paid > 0 ? ', with its history' : ''}. Managers stop seeing it too.</p>
            <div className="tip-btnrow"><button type="button" className="tip-btn" onClick={() => setConfirm(false)}>Keep It</button><button type="button" className="tip-btn primary" disabled={busy} onClick={() => void del()}>Delete Item</button></div>
          </section>
        ) : <button type="button" className="tip-btn ghost danger" onClick={() => setConfirm(true)}>Delete Item</button>}
      </form>
    </Sheet>
  );
}
