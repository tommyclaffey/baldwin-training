// Prep tracker (Nov 12, Tommy: "a garnish, syrup, and juice tracker in the app that works day over day, week over week,
// year over year and can give you clear reports"). Figma 09 · Proposals → 31 (632:802): Today / Prep list (632:803),
// Item detail · Lime juice (632:894), Reports (632:985). Server: server/prep.mjs.
//   /prep              Today: Step 1 the count, Step 2 prep to par (the list waits for the count), Use First, Log a Batch, Log Waste
//   /prep/count        Start of Shift Count (31b, CountPage.tsx): what the bar walked in with; Used comes from it
//   /prep/item/:id     an item: par by day + suggestions, shelf life, recipe, recent batches, the drinks that use it
//   /prep/reports      day / week / year over, the chart, ran out, every item, CSV, Print, Send to Team Chat (managers)
// Same layout for every brand; the look comes from the theme roles (src/lib/theme.ts) only.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { theme } from '../lib/theme';
import { SendToTeamButton } from '../chat/SendToTeam';
import { hasChat } from '../chat/unread';
import { openChat } from '../chat/panel';
import { BusiestDays, MadeUsedChart } from './Chart';
import {
  amt, dayLabel, DAYS, KIND_LABEL, KIND_LINE, MON_FIRST, pctText, spanLabel, timeOf, whenMade, UNIT_LABEL, UNITS,
  type Item, type LedgerRow, type Kind, type Person, type Report, type Row, type Today, type UseFirst,
} from './data';
import { Avatar, BatchForm, DemoPill, ErrorBox, Head, Ico, KindDot, Loading, Sheet, Toast, useLoad, WasteForm, openFromToday, type BatchFor, type OpenBatch, type WasteFor } from './ui';
import { CountPage } from './CountPage';
import './prep.css';

export function PrepPage() {
  const { pathname } = useLocation();
  const m = /^\/prep\/item\/(\d+)/.exec(pathname);
  useEffect(() => { document.title = 'Prep · Mise Academy'; }, []);
  if (m) return <ItemPage id={Number(m[1])} />;
  if (pathname.startsWith('/prep/reports')) return <ReportsPage />;
  if (pathname.startsWith('/prep/count')) return <CountPage />;
  return <TodayPage />;
}

/* ------------------------------------------------------------------ Today (Figma 31b: waiting 666:1413, counted 666:2008) */
// The shift is two steps: count what you walked in with, then prep to par. Until someone counts, the prep list waits.
type SheetState = { kind: 'batch'; start?: BatchFor } | { kind: 'waste'; start?: WasteFor } | { kind: 'add' } | null;
function TodayPage() {
  const { data, error, load } = useLoad<Today>('/api/prep');
  const loc = useLocation();
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toast, setToast] = useState((loc.state as { toast?: string } | null)?.toast || '');
  const [open, setOpen] = useState<OpenBatch[]>([]);
  const nav = useNavigate();
  useEffect(() => { if ((loc.state as { toast?: string } | null)?.toast) nav('.', { replace: true, state: null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The waste list also needs open batches that aren't on Use First: read each item's open batches from its page.
  useEffect(() => {
    if (!data?.can.log) return;
    let live = true;
    const ids = data.items.filter((i) => !data.useFirst.some((u) => u.itemId === i.id)).map((i) => i.id);
    Promise.all(ids.map((id) => api<Item>(`/api/prep/items/${id}`).catch(() => null))).then((items) => {
      if (!live) return;
      const more: OpenBatch[] = items.flatMap((it) => (it ? it.batches.filter((b) => b.open).map((b) => ({ batchId: b.id, itemId: it.id, remaining: b.remaining, unit: it.unit, expired: b.expired,
        label: `${it.name} · ${b.day === data.day ? 'today’s' : dayLabel(b.day, { weekday: 'short' })} batch` })) : []));
      setOpen([...openFromToday(data), ...more]);
    });
    return () => { live = false; };
  }, [data]);
  if (error) return <div className="prp"><ErrorBox error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="prp"><Loading /></div>;
  const done = (msg: string) => { setSheet(null); setToast(msg); void load(); };
  const counted = data.counted;
  const rows = data.items.filter((i) => filter === 'all' || i.kind === filter);
  const counts = { all: data.items.length, juice: 0, syrup: 0, garnish: 0 } as Record<string, number>;
  for (const i of data.items) counts[i.kind]++;
  const toMake = data.items.filter((i) => i.toMake > 0).length, made = data.items.filter((i) => i.made).length;
  const checks = data.items.filter((i) => i.check);
  const wk = data.week;
  const longDay = dayLabel(data.day, { weekday: 'long', month: 'short', day: 'numeric' }).replace(',', '');
  const lastWord = data.lastCount ? dayLabel(data.lastCount.day, { weekday: 'short' }) : '';
  const startBtn = (cls: string, label = `Start the Count · ${data.items.length} Items`) => <Link to="/prep/count" className={'prp-btn ' + cls}>{Ico.count}{label}</Link>;
  return (
    <div className="prp">
      <div className="prp-topbar">
        {data.can.edit && <Link to="/prep/reports" className="prp-btn">Reports</Link>}
        {data.can.log && (counted ? <button type="button" className="prp-btn dark" onClick={() => setSheet({ kind: 'batch' })}>{Ico.plus}Log a Batch</button> : startBtn('dark', 'Start the Count'))}
      </div>
      <Head line={`${longDay} · ${data.store}`} title="Bar Prep"
        pills={counted
          ? <><DemoPill /><span className="prp-pill good">{Ico.check}Counted {timeOf(counted.at)}</span><span className="prp-pill">{toMake} to make</span><span className="prp-pill good">{made} made</span>
            {data.useFirst.length > 0 && <span className="prp-pill warn">{data.useFirst.length} use first</span>}{checks.length > 0 && <span className="prp-pill warn">{checks.length} to check</span>}</>
          : <><DemoPill /><span className="prp-pill warn">Not counted yet</span><span className="prp-pill">{data.items.length} items to count</span></>} />
      <div className="prp-steps2">
        {counted ? (
          <section className="prp-card prp-stepcard" aria-labelledby="s1-title">
            <span className="prp-stepn done" aria-hidden="true">{Ico.check}</span>
            <div className="prp-stepbody">
              <div className="prp-steptop"><div><p className="prp-kicker good">Step 1 · Done</p><h2 id="s1-title">Count what you walked in with</h2></div>
                {data.can.log && <Link to="/prep/count" className="prp-btn sm">{Ico.pencil}Edit Count</Link>}</div>
              <p className="prp-who">{counted.by && <Avatar p={counted.by} />}<span>{counted.by ? `${counted.by.name} counted` : 'Counted'} at {timeOf(counted.at)} · {counted.n} of {data.items.length}</span></p>
              {(data.items.some((i) => i.tossed > 0) || checks.length > 0) && <div className="prp-pillrow">
                {data.items.filter((i) => i.tossed > 0).map((i) => <span key={i.id} className="prp-state expired">{amt(i.tossed, i.unit)} {i.name.toLowerCase()} tossed</span>)}
                {checks.map((i) => <Link key={i.id} to={`/prep/count#count-${i.id}`} className="prp-state today">{i.name}: Check This</Link>)}
              </div>}
            </div>
          </section>
        ) : (
          <section className="prp-stepcard dark" aria-labelledby="s1-title">
            <span className="prp-stepn tan" aria-hidden="true">1</span>
            <div className="prp-stepbody">
              <p className="prp-kicker">Step 1 · Start here</p><h2 id="s1-title">Count what you walked in with</h2>
              <p className="prp-sub">Not counted yet.{data.lastCount ? ` Last count: ${lastWord} ${timeOf(data.lastCount.at)}${data.lastCount.by ? ' by ' + data.lastCount.by.name : ''}.` : ''} Anything past its use-by: keep it or toss it as you go.</p>
              {data.can.log ? startBtn('ondark') : <p className="prp-sub">A bartender or manager counts first.</p>}
            </div>
          </section>
        )}
        {counted ? (
          <section className="prp-stepcard dark" aria-labelledby="s2-title">
            <span className="prp-stepn tan" aria-hidden="true">2</span>
            <div className="prp-stepbody">
              <div className="prp-steptop"><div><p className="prp-kicker">Step 2 · Now</p><h2 id="s2-title">Prep to par</h2></div>
                {data.can.log && <button type="button" className="prp-btn sm ondark" onClick={() => setSheet({ kind: 'batch' })}>{Ico.plus}Log a Batch</button>}</div>
              <p className="prp-sub">To make = today’s par − what you walked in with, rounded up to whole batches.</p>
              {data.steps.toMake > 0 ? <div className="prp-progress"><span className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={data.steps.toMake} aria-valuenow={data.steps.made} aria-label="Made so far"><i style={{ width: `${(data.steps.made / data.steps.toMake) * 100}%` }} /></span><span>{data.steps.made} of {data.steps.toMake} made</span></div>
                : <p className="prp-sub strong">Everything walked in at par. Nothing to make.</p>}
            </div>
          </section>
        ) : (
          <section className="prp-card prp-stepcard" aria-labelledby="s2-title">
            <span className="prp-stepn wash" aria-hidden="true">{Ico.lock}</span>
            <div className="prp-stepbody">
              <p className="prp-kicker plain">Step 2 · After the count</p><h2 id="s2-title">Prep to par</h2>
              <p className="prp-sub">The prep list opens once the count is saved. To make = today’s par − what you walked in with, rounded up to whole batches.</p>
              <span className="prp-pill sm plain">{Ico.lock}Waiting on Step 1</span>
            </div>
          </section>
        )}
      </div>
      {counted && data.useFirst.length > 0 && (
        <section className="prp-usefirst" aria-labelledby="uf-title">
          <div className="prp-uf-head">
            <div><p className="prp-kicker">Use first · {data.useFirst.length} {data.useFirst.length === 1 ? 'item' : 'items'}</p><h2 id="uf-title">Clear these before you open a new batch</h2></div>
            <p className="prp-uf-note">Oldest batch goes out first. Past its use-by was decided in the count.</p>
          </div>
          <ul>
            {data.useFirst.map((u) => (
              <li key={u.batchId} className="prp-uf-row">
                <KindDot kind={u.kind} />
                <div className="prp-uf-main"><Link to={`/prep/item/${u.itemId}`} className="prp-uf-name">{u.name}</Link><span className="prp-uf-line">{u.line}</span></div>
                <span className={'prp-state ' + u.state}>{u.state === 'today' ? 'Use Today' : 'Use Tomorrow'}</span>
                {data.can.log && <div className="prp-uf-actions"><button type="button" className="prp-btn ghostdark" onClick={() => setSheet({ kind: 'waste', start: { batchId: u.batchId } })}>Log Waste</button></div>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="prp-cols">
        <section className="prp-card prp-list" aria-labelledby="list-title">
          <div className="prp-list-head">
            <div><h2 id="list-title">Today’s prep list</h2><p className="prp-sub">{counted ? 'Par minus what you walked in with, in whole batches' : 'Fills in once the count is saved'}</p></div>
            <div className="prp-chips" role="group" aria-label="Show">
              {(['all', 'juice', 'syrup', 'garnish'] as const).map((k) => <button key={k} type="button" className={'prp-chip' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : KIND_LABEL[k]} {counts[k]}</button>)}
            </div>
          </div>
          {data.items.length === 0 && <p className="prp-empty">No prep items yet.{data.can.edit ? ' Add the juices, syrups and garnishes your bar makes.' : ' A manager adds them.'}</p>}
          {data.items.length > 0 && !counted && (
            <>
              <div className="prp-wait">
                <span className="prp-stepn wash" aria-hidden="true">{Ico.lock}</span>
                <h3>Count first, then prep</h3>
                <p>Nobody has counted what the bar walked in with today. Once someone does, this list fills in: walked in with + prepped = starting with, and what to make for each item.</p>
                {data.can.log && startBtn('dark', 'Start the Count')}
              </div>
              {data.items.some((i) => i.lastStarting != null) && <>
                <div className="prp-group"><span>What you’ll count{data.lastCount ? ` · started ${lastWord} with` : ''}</span></div>
                <div className="prp-willcount">
                  {(['juice', 'syrup', 'garnish'] as Kind[]).filter((k) => filter === 'all' || filter === k).map((k) => (
                    <div key={k}><p className="h">{KIND_LABEL[k]}</p>
                      <ul>{rows.filter((r) => r.kind === k).map((r) => <li key={r.id}><Link to={`/prep/item/${r.id}`}>{r.name}</Link><strong>{r.lastStarting == null ? '—' : amt(r.lastStarting, r.unit)}</strong></li>)}</ul></div>
                  ))}
                </div>
              </>}
            </>
          )}
          {data.items.length > 0 && counted && <div className="prp-table today" role="table" aria-label="Today’s prep list">
            <div className="prp-tr prp-th" role="row"><span role="columnheader" className="c-item">Item</span><span role="columnheader">Walked in with</span><span role="columnheader" className="c-op" aria-hidden="true" /><span role="columnheader">Prepped</span><span role="columnheader" className="c-op" aria-hidden="true" /><span role="columnheader">Starting with</span><span role="columnheader" className="c-act"><span className="sr-only">Action</span></span></div>
            {(['juice', 'syrup', 'garnish'] as Kind[]).map((k) => {
              const list = rows.filter((r) => r.kind === k);
              if (!list.length) return null;
              return (
                <div key={k} role="rowgroup">
                  <div className="prp-group" role="row"><span role="cell">{KIND_LINE[k]}</span></div>
                  {list.map((r) => <PrepRow key={r.id} r={r} canLog={data.can.log} onLog={() => setSheet({ kind: 'batch', start: { itemId: r.id } })} />)}
                </div>
              );
            })}
          </div>}
          <div className="prp-list-foot">
            {data.can.edit && <button type="button" className="prp-btn" onClick={() => setSheet({ kind: 'add' })}>{Ico.plus}Add an Item</button>}
            <p className="prp-sub">Walked in with comes from the count. Pars change by day; {data.can.edit ? 'set them on each item’s page.' : 'managers set them on each item’s page.'}</p>
          </div>
        </section>
        <aside className="prp-side" aria-label="Log and this week">
          {!counted && <section className="prp-card prp-pad" aria-labelledby="why-title">
            <p className="prp-kicker">Why count first</p><h2 id="why-title" className="prp-h3">Used comes from the count</h2>
            <p className="prp-sub">What an item started last shift with, minus what was wasted, minus what you walked in with today, is what the bar used. Reports and suggested pars run off it.</p>
            {data.example && <div className="prp-example"><p className="prp-kicker">From your counts · {data.example.item}</p>
              <p>{dayLabel(data.example.day, { weekday: 'short' })} started with {amt(data.example.starting, data.example.unit)} − {amt(data.example.wasted, data.example.unit)} wasted − {dayLabel(data.example.nextDay, { weekday: 'short' })} walked in with {amt(data.example.walkedIn, data.example.unit)} = {amt(data.example.used, data.example.unit)} used</p></div>}
          </section>}
          {data.can.log ? <>
            {counted && <section className="prp-card prp-pad prp-desk" aria-labelledby="lb-title"><p className="prp-kicker">Log a batch</p><h2 id="lb-title" className="prp-h3">Made something? Log it here.</h2><BatchForm key={'b' + data.items.length} data={data} inline onDone={done} /></section>}
            <section className="prp-card prp-pad prp-desk" aria-labelledby="lw-title"><p className="prp-kicker">Log waste</p><h2 id="lw-title" className="prp-h3">Tossed, spilled or not right?</h2><WasteForm key={open.map((o) => o.batchId).join()} batches={open} onDone={done} /></section>
          </> : <p className="prp-card prp-pad prp-note">Bartenders and managers count and log prep. You can see what’s made and what to use first.</p>}
          <section className="prp-card prp-pad prp-week" aria-labelledby="wk-title">
            <p className="prp-kicker" id="wk-title">This week so far</p>
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

function PrepRow({ r, canLog, onLog }: { r: Row; canLog: boolean; onLog: () => void }) {
  const recipe = r.kind === 'garnish' ? 'How to Cut' : r.hasRecipe ? 'Recipe' : 'Add a Recipe';
  const recipeTo = r.kind === 'garnish' && r.lesson ? r.lesson : `/prep/item/${r.id}#recipe`;
  const verb = r.kind === 'garnish' ? 'cut' : 'make';
  return (
    <div className="prp-tr" role="row">
      <span role="cell" className="c-item">
        <KindDot kind={r.kind} />
        <span className="prp-name"><Link to={`/prep/item/${r.id}`}>{r.name}</Link>
          <small>{r.ratio && <>{r.ratio} · </>}{(r.kind === 'garnish' && !r.lesson) ? null : <Link to={recipeTo} className="prp-link">{recipe} {Ico.arrow}</Link>}</small></span>
      </span>
      <span role="cell" className="c-num" data-l="Walked in with"><strong>{amt(r.walkedIn ?? 0, r.unit)}</strong>
        <small className={r.check ? 'warn' : ''}>{r.check ? 'Check this' : r.kept ? 'count kept' : r.tossed > 0 ? `${amt(r.tossed, r.unit)} tossed` : r.lastUsed != null ? `used ${amt(r.lastUsed, r.unit)}` : r.walkedIn == null ? 'not counted' : 'first count'}</small></span>
      <span role="cell" className="c-op" aria-hidden="true">+</span>
      <span role="cell" className="c-num" data-l="Prepped">{r.prepped > 0
        ? <><strong>{amt(r.prepped, r.unit)}</strong><small>{r.made?.by ? `by ${r.made.by.name}` : 'logged'}</small></>
        : <><strong className="none" aria-label="Nothing yet">—</strong><small>{r.toMake > 0 ? `${amt(r.toMake, r.unit)} to ${verb}` : 'Nothing to make'}</small></>}</span>
      <span role="cell" className="c-op" aria-hidden="true">=</span>
      <span role="cell" className="c-num" data-l="Starting with"><strong>{amt(r.starting ?? 0, r.unit)}</strong><small>Par {amt(r.par, r.unit)}</small></span>
      <span role="cell" className="c-act">
        {r.status === 'make' && canLog && <button type="button" className="prp-btn" onClick={onLog} aria-label={`Log a batch of ${r.name}`}>Log a Batch</button>}
        {r.status === 'make' && !canLog && <span className="prp-state par">To Make</span>}
        {r.status === 'made' && r.made && <span className="prp-state made">{Ico.check}Made {timeOf(r.made.at)}</span>}
        {r.status === 'use-first' && <span className="prp-state today">Use First</span>}
        {r.status === 'at-par' && <span className="prp-state par">At Par</span>}
        {r.status === 'check' && (canLog ? <Link to={`/prep/count#count-${r.id}`} className="prp-state today asbtn">{Ico.warn}Check This</Link> : <span className="prp-state today">{Ico.warn}Check This</span>)}
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
  const [sheet, setSheet] = useState<'batch' | 'waste' | 'archive' | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [allDays, setAll] = useState(false);
  const nav = useNavigate();
  useEffect(() => { if (data?.can.log) api<Today>('/api/prep').then(setToday).catch(() => {}); }, [data?.can.log, data?.batches.length, data?.ledger.length]);
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
  const shown = allDays ? it.ledger : it.ledger.slice(0, 7);
  const out = it.week.used + it.week.wasted;
  const closedRow = it.ledger.find((r) => r.used != null);
  const yesterday = dayLabel(new Date(Date.parse(it.day + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10), { weekday: 'short' });
  return (
    <div className="prp">
      <div className="prp-topbar">
        {it.can.log && !it.archived && (today && !today.counted ? <Link to="/prep/count" className="prp-btn dark">{Ico.count}Start the Count</Link> : <button type="button" className="prp-btn dark" onClick={() => setSheet('batch')}>{Ico.plus}Log a Batch</button>)}
      </div>
      <Head line={KIND_LINE[it.kind]} title={it.name}
        crumbs={<nav className="prp-crumbs" aria-label="Breadcrumb"><Link to="/prep">Prep</Link><span aria-hidden="true">/</span><Link to={`/prep`}>{it.kindLabel}</Link><span aria-hidden="true">/</span><span aria-current="page">{it.name}</span></nav>}
        tools={<>
          {hasChat(user) && !it.archived && <SendToTeamButton item={{ type: 'page', slug: `prep/item/${it.id}` }} className="prp-btn" />}
          {it.can.log && !it.archived && <button type="button" className="prp-btn" onClick={() => setSheet('waste')} disabled={!open.length}>{Ico.bin}Log Waste</button>}
          {it.can.edit && (it.archived ? <button type="button" className="prp-btn" onClick={() => void restore()}>Restore</button> : <button type="button" className="prp-btn" onClick={() => setSheet('archive')}>Archive</button>)}
        </>}
        pills={<><DemoPill />{it.counted ? <span className={'prp-pill ' + (it.counted.check ? 'warn' : 'good')}>{!it.counted.check && Ico.check}Walked in with {amt(it.counted.walkedIn, it.unit)}</span> : <span className="prp-pill warn">Not counted yet</span>}<span className="prp-pill">In {it.drinks.length} {it.drinks.length === 1 ? 'drink' : 'drinks'}</span><span className="prp-pill">{it.shelf.words}</span><span className="prp-pill">Par today {amt(it.parToday, it.unit)}</span></>} />
      {it.archived && <p className="prp-card prp-pad prp-note">This item is archived. It’s off Today’s list. Restore it to log batches again.</p>}
      <div className="prp-cols item">
        <div className="prp-main">
          <ParCard it={it} onSave={(pars) => void patch({ pars }, 'Pars saved.')} onAnswer={(d, a, to) => void answer(d, a, to)} />
          <section className="prp-card" aria-labelledby="rb-title">
            <div className="prp-card-head pad"><div><h2 id="rb-title">Shift by shift</h2><p className="prp-sub">Counted at the start of each shift. Used is worked out, never typed.</p></div>
              {it.ledger.length > 7 && <button type="button" className="prp-btn sm" onClick={() => setAll((v) => !v)} aria-expanded={allDays}>{Ico.arrow}{allDays ? 'Show Fewer' : 'See All Days'}</button>}</div>
            {it.ledger.length === 0 ? <p className="prp-empty">No counts yet. Each shift shows here once someone counts at the start of it.</p> : <>
              <div className="prp-table ledger" role="table" aria-label="Shift by shift">
                <div className="prp-tr prp-th" role="row"><span role="columnheader">Date</span><span role="columnheader">Walked in with</span><span role="columnheader">Prepped</span><span role="columnheader">Starting with</span><span role="columnheader">Wasted</span><span role="columnheader">Used (worked out)</span><span role="columnheader">Counted by</span></div>
                {shown.map((r) => <LedgerLine key={r.id} r={r} unit={it.unit} today={it.day} />)}
              </div>
              <div className="prp-formula"><strong>Used = what it started with − what was wasted − the next shift’s count</strong>
                {closedRow && <span>From these counts: {dayLabel(closedRow.day, { weekday: 'short' })} {amt(closedRow.starting, it.unit)} − {amt(closedRow.wasted, it.unit)} − {closedRow.nextDay ? dayLabel(closedRow.nextDay, { weekday: 'short' }) : ''} {amt(closedRow.nextCount ?? 0, it.unit)} = {amt(closedRow.used!, it.unit)}. Weekday averages and suggested pars come from this column.</span>}</div>
            </>}
          </section>
          <ShelfCard it={it} onSave={(b) => void patch(b, 'Shelf life saved.')} />
          <RecipeCard it={it} onSave={(b) => void patch(b, 'Recipe saved.')} />
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
            <p className="prp-sub">{it.week.closed > 0 ? `${dayLabel(it.week.from, { weekday: 'short' })}${it.week.closed > 1 ? ` to ${yesterday}` : ''}, from the counts. ` : 'No shift has closed yet this week. '}Today’s Used fills in after tomorrow’s count.{out > 0 ? ` Waste is ${Math.round((it.week.wasted / out) * 100)}% of what was used or wasted.` : ''}</p>
            {it.can.edit && <Link to={`/prep/reports?series=${it.id}`} className="prp-btn">{Ico.arrow}Open in Reports</Link>}
          </section>
          <section className="prp-card prp-pad" aria-labelledby="oh-title">
            <p className="prp-kicker" id="oh-title">Walked in with today</p>
            <p className="prp-big">{it.counted ? amt(it.counted.walkedIn, it.unit) : '—'}</p>
            <p className="prp-sub">{it.counted ? `Counted at ${timeOf(it.counted.at)}${it.counted.by ? ' by ' + it.counted.by.name : ''}.` : 'Not counted yet today.'}</p>
            {it.can.log && !it.archived && <div className="prp-row-btns"><Link to={`/prep/count#count-${it.id}`} className="prp-btn">{it.counted ? <>{Ico.pencil}Edit Count</> : <>{Ico.count}Start the Count</>}</Link><button type="button" className="prp-btn" onClick={() => void ranOut()}>{Ico.warn}We Ran Out</button></div>}
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
      {sheet === 'archive' && <Sheet kicker="Archive" title={`Archive ${it.name}?`} onClose={() => setSheet(null)}>
        <p className="prp-sub">It comes off Today’s list and the count. Its batches and counts stay in Reports. You can restore it any time from Archived.</p>
        <div className="prp-row-btns"><button type="button" className="prp-btn" onClick={() => setSheet(null)}>Cancel</button><button type="button" className="prp-btn dark" onClick={() => void archive()}>Archive</button></div>
      </Sheet>}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}

/** One counted shift (Figma 666:2603). A missed day makes it span two or more shifts; Used is never negative. */
function LedgerLine({ r, unit, today }: { r: LedgerRow; unit: string; today: string }) {
  const date = dayLabel(r.day, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  const sub = r.day === today ? 'Today' : r.shifts > 1 ? `${spanLabel(r.day, r.lastDay)} · ${r.shifts} shifts` : '';
  const reasons = r.waste.map((w) => w.reason === 'other' ? 'other' : w.reason).join(', ');
  return (
    <div className="prp-tr" role="row">
      <span role="cell" data-l="Date"><strong className="d">{date}</strong>{sub && <small className={r.day === today ? 'acc' : ''}>{sub}</small>}</span>
      <span role="cell" data-l="Walked in with">{amt(r.walkedIn, unit)}{r.tossed > 0 && <small>{amt(r.tossed, unit)} tossed</small>}{r.recounts.length > 0 && <small>recounted · was {r.recounts.map((x) => amt(x.amount, unit)).join(', ')}</small>}</span>
      <span role="cell" data-l="Prepped">{r.prepped > 0 ? amt(r.prepped, unit) : '—'}</span>
      <span role="cell" data-l="Starting with"><strong>{amt(r.starting, unit)}</strong></span>
      <span role="cell" data-l="Wasted" className={r.wasted > 0 ? 'bad' : ''}>{r.pending && r.wasted === 0 ? '—' : amt(r.wasted, unit)}{reasons && <small>{reasons}</small>}</span>
      <span role="cell" data-l="Used">{r.pending ? <><span>Pending</span><small>after {dayLabel(new Date(Date.parse(r.day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10), { weekday: 'short' })}’s count</small></>
        : r.used == null ? <><strong className="none" aria-label="No used figure">—</strong><small className="warn">{r.kept ? 'Count kept' : 'Check this'}</small></>
          : <><strong>{amt(r.used, unit)}</strong>{r.ranOutAt && <small className="bad">Ran out {timeOf(r.ranOutAt)}</small>}</>}</span>
      <span role="cell" data-l="Counted by" className="c-who">{r.by ? <><Avatar p={r.by} /><span>{r.by.name}</span></> : '—'}</span>
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
      <p className="prp-sub">“Used” is worked out from the shift counts: the average of the last 4 weeks.</p>
      {it.suggestions.length > 0 && (
        <div className="prp-sugg">
          <p className="prp-kicker">From your counts</p>
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
      {days === 0 && <p className="prp-toss"><span className="prp-switch on" aria-hidden="true" /><span><strong>Use by close</strong><small>A guide, never automatic: anything left shows as past its use-by at the next count, and whoever counts keeps it or tosses it.</small></span></p>}
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
const r2 = (n: number) => Math.round(n * 100) / 100;
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
    const head = ['Item', 'Kind', 'Unit', 'Made', 'Used (counted)', 'Wasted', 'Waste %', `Waste % ${data.period.prevLabel}`, 'Change (pts)', 'Ran out', 'Batches', 'Shifts counted'];
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head, ...data.rows.map((r) => [r.name, r.kind, r.unit === 'each' ? 'pieces' : r.unit, r.made, r.used, r.wasted, r.wastePct ?? '', r.prevWastePct ?? '', r.vsPrev ?? '', r.ranOut, r.batches, r.shifts])].map((l) => l.map(esc).join(','));
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
      <p className="prp-period">{data.period.label} compared with {data.period.prevLabel}. Made is counted by the day each batch was made; used and wasted come from the shift counts.</p>
      <div className="prp-tiles4">
        <div className="prp-card prp-tile"><p className="prp-kicker">Juices + syrups wasted</p><div className="v"><strong>{pctText(t.liquid.pct)}</strong>{change(t.liquid.pct, t.liquid.prevPct)}</div><p className="prp-sub">{amt(t.liquid.wasted, 'qt')} of {amt(r2(t.liquid.used + t.liquid.wasted), 'qt')} used or wasted</p></div>
        <div className="prp-card prp-tile"><p className="prp-kicker">Garnishes wasted</p><div className="v"><strong>{pctText(t.garnish.pct)}</strong>{change(t.garnish.pct, t.garnish.prevPct)}</div><p className="prp-sub">{Math.round(t.garnish.wasted)} of {Math.round(t.garnish.used + t.garnish.wasted).toLocaleString('en-US')} pieces used or wasted</p></div>
        <div className="prp-card prp-tile"><p className="prp-kicker">Ran out</p><div className="v"><strong>{t.ranOut.count === 1 ? '1 time' : `${t.ranOut.count} times`}</strong></div><p className="prp-sub">{t.ranOut.prev} {t.ranOut.prev === 1 ? 'time' : 'times'} {data.period.prevLabel}</p></div>
        <div className="prp-card prp-tile"><p className="prp-kicker">Batches made</p><div className="v"><strong>{t.batches.count}</strong></div><p className="prp-sub">{t.batches.prev} {data.period.prevLabel}</p></div>
      </div>
      <section className="prp-card prp-pad" aria-labelledby="ch-title">
        <div className="prp-card-head"><div><h2 id="ch-title">Used and wasted, by {data.range === 'year' ? 'month' : 'day'}</h2>
          <p className="prp-sub">Each bar is {data.range === 'year' ? 'that month’s shifts' : 'that shift'}, from the counts: used on the bottom, wasted on top. The number above is what was made. {unitWord}.</p></div>
          <label className="prp-select"><span className="sr-only">Item</span><select value={String(data.series.id)} onChange={(e) => set('series', e.target.value)}>{data.series.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label></div>
        <ul className="prp-legend" aria-label="Key">
          <li><i className="sw used" />Used</li><li><i className="sw wasted" />Wasted</li><li><i className="sw prev" />Used, {data.range === 'year' ? 'year' : data.range === 'day' ? 'week' : 'week'} before</li><li><i className="sw ran">!</i>Ran out</li>
        </ul>
        <MadeUsedChart data={data.chart} unit={data.series.unit} prevLabel={data.range === 'year' ? 'Last year' : 'Week before'} title={`${seriesLabel}: used and wasted, from the counts`} />
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
      <section className="prp-card prp-pad" aria-labelledby="kept-title"><h2 id="kept-title">Counts higher than expected</h2>
        <p className="prp-sub">More on the shelf than the shift before could have left: a batch nobody logged, or a miscount. That shift’s Used shows “—”.</p>
        {data.kept.length === 0 ? <p className="prp-empty sm">None {data.range === 'day' ? 'that day' : data.range === 'year' ? 'this year' : 'that week'}.</p> :
          <ul className="prp-ran">{data.kept.map((k, i) => <li key={i}><span className="ic">{Ico.warn}</span><span><Link to={`/prep/item/${k.itemId}`}><strong>{k.item}</strong></Link>
            <small>{dayLabel(k.day, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')} · counted {amt(k.amount, k.unit)}, expected {amt(k.expected ?? 0, k.unit)} · {k.kept ? `kept${k.by ? ' by ' + k.by : ''}` : 'not checked yet'}</small></span></li>)}</ul>}
      </section>
      <section className="prp-card" aria-labelledby="ei-title">
        <div className="prp-card-head pad"><div><h2 id="ei-title">Every item · {data.period.label}</h2><p className="prp-sub">Compared with {data.period.prevLabel}. Tap an item to open it.</p></div>
          <div className="prp-chips" role="group" aria-label="Show">{(['all', 'juice', 'syrup', 'garnish'] as const).map((k) => <button key={k} type="button" className={'prp-chip' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'all' ? 'All' : KIND_LABEL[k]} {counts[k]}</button>)}</div></div>
        <div className="prp-table items" role="table" aria-label="Every item">
          <div className="prp-tr prp-th" role="row"><span role="columnheader">Item</span><span role="columnheader">Made</span><span role="columnheader">Used</span><span role="columnheader">Wasted</span><span role="columnheader">Waste</span><span role="columnheader">Vs {data.range === 'year' ? 'last year' : data.range === 'day' ? 'day before' : 'week before'}</span><span role="columnheader">Ran out</span></div>
          {rows.map((r) => (
            <div key={r.id} className="prp-tr" role="row">
              <span role="cell" data-l="Item" className="c-name"><Link to={`/prep/item/${r.id}`}>{r.name}</Link>{r.archived && <small> · archived</small>}</span>
              <span role="cell" data-l="Made">{amt(r.made, r.unit)}</span>
              <span role="cell" data-l="Used">{amt(r.used, r.unit)}</span>
              <span role="cell" data-l="Wasted">{amt(r.wasted, r.unit)}</span>
              <span role="cell" data-l="Waste"><span className={'prp-pct' + (r.wastePct == null ? '' : r.wastePct >= 20 ? ' bad' : r.wastePct >= 12 ? ' warn' : ' ok')}>{pctText(r.wastePct)}</span></span>
              <span role="cell" data-l="Vs before" className={r.vsPrev == null ? 'muted' : r.vsPrev < 0 ? 'good' : r.vsPrev > 0 ? 'bad' : ''}>{r.vsPrev == null ? '—' : r.vsPrev === 0 ? 'Same' : `${r.vsPrev < 0 ? 'Down' : 'Up'} ${Math.abs(r.vsPrev)} ${Math.abs(r.vsPrev) === 1 ? 'pt' : 'pts'}`}</span>
              <span role="cell" data-l="Ran out">{r.ranOut ? `${r.ranOut} · ${r.ranOutDays.join(', ')}` : '—'}</span>
            </div>
          ))}
        </div>
        <p className="prp-sub pad">Juices and syrups in their own units, garnishes in pieces, never added together. Used comes from the shift counts; waste is wasted ÷ (used + wasted). No cost tracking yet.</p>
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
