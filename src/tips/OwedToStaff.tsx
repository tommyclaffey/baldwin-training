// Owed to Staff (Nov 25; Figma 09 · Idea Board → 52, Desktop 4, 1051:4879; Tommy: manager view yes). What the store still
// owes its people, from what they add on their own Tips page. A store's managers and owners see who is owed, why, how much
// and the status, and mark items settled. Never a tip total, a shift or a note (server/tips.mjs teamOwed).
import { useEffect, useState } from 'react';
import { Toast, useLoad } from '../prep/ui';
import { dayShort, FOOTNOTE, initials, money, monthDay, type StaffOwed, type TeamOwed } from './data';
import { DemoData, ErrorBox, Ico, Loading, Money, StatusPill, useWide } from './ui';
import { Crumbs, SettleSheet, Title } from './TipsPage';
import './tips.css';

export function OwedToStaffPage() {
  const { data, error, load } = useLoad<TeamOwed>('/api/tips/team');
  const wide = useWide();
  const [settle, setSettle] = useState<StaffOwed | null>(null);
  const [toast, setToast] = useState('');
  useEffect(() => { document.title = 'Owed to Staff · Mise'; }, []);
  if (error) return <div className="tip admin-tip"><Crumbs parts={[['Team'], ['Owed to Staff']]} /><Title>Owed to Staff</Title><ErrorBox error={error} retry={() => void load()} /></div>;
  if (!data) return <div className="tip admin-tip"><Loading /></div>;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
  const who = (o: StaffOwed) => (
    <span className="tip-person"><span className="tip-av" aria-hidden="true">{initials(o.person.name)}</span><span><strong>{o.person.name}</strong>{o.person.job && <small>{o.person.job}</small>}</span></span>
  );
  const owedCell = (o: StaffOwed) => <span className="tip-rownet"><Money c={o.status === 'settled' ? o.amount : o.remaining} />{o.status === 'part' && <small>left of {money(o.amount)}</small>}</span>;
  const by = (o: StaffOwed) => `by ${o.settledBy === 'you' ? 'you' : o.settledBy || 'them'}, ${monthDay(o.settledOn!)}`;
  const btn = (o: StaffOwed) => <button type="button" className="tip-btn sm" onClick={() => setSettle(o)} aria-label={`Mark Settled: ${o.person.name}, ${o.label}, ${dayShort(o.day)}`}>Mark Settled</button>;
  const empty = !data.open.length && !data.recent.length;
  return (
    <div className="tip admin-tip">
      <Crumbs parts={[['Team'], ['Owed to Staff']]} />
      <div className="tip-titlerow"><div><Title>Owed to Staff</Title><p className="tip-subline">What {data.store} still owes its people, from what they add on their own Tips page.</p></div><div className="tip-tools"><DemoData /></div></div>
      <p className="tip-banner">{Ico.lock(16)}You see owed items only. Tip totals, shifts and notes stay private to each person.</p>
      <div className="tip-stats three">
        <div className="tip-stat dark"><span>Owed now</span><Money c={data.owedNow} className="lg" /><small>{data.count} {data.count === 1 ? 'item' : 'items'} · {data.people} {data.people === 1 ? 'person' : 'people'}</small></div>
        <div className="tip-stat"><span>Oldest</span>{data.oldest ? <><b className="tip-money lg">{dayShort(data.oldest.day)}</b><small>{data.oldest.name} · {money(data.oldest.remaining)} left</small></> : <><b className="tip-money lg">None</b><small>Nothing owed right now</small></>}</div>
        <div className="tip-stat"><span>Settled this pay period</span><Money c={data.settledThisPeriod.amount} className="lg" /><small>{data.settledThisPeriod.count} {data.settledThisPeriod.count === 1 ? 'item' : 'items'}</small></div>
      </div>
      {empty ? <p className="tip-card tip-none">Nothing owed to anyone. When someone adds money the house owes them on their Tips page, it shows here.</p> : wide ? (
        <div className="tip-card tip-tablewrap">
          <table className="tip-table staff">
            <caption className="sr-only">Money {data.store} owes its people</caption>
            <thead><tr><th scope="col">Person</th><th scope="col">Reason</th><th scope="col">From</th><th scope="col" className="r">Owed</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {data.open.map((o) => (
                <tr key={o.id} className="tip-staff-row"><th scope="row">{who(o)}</th><td>{o.label}</td><td>{dayShort(o.day)}</td><td className="r">{owedCell(o)}</td><td><StatusPill status={o.status} /></td><td className="r">{btn(o)}</td></tr>
              ))}
              {!data.open.length && <tr><td colSpan={6} className="tip-none">Nothing owed right now.</td></tr>}
            </tbody>
            {data.recent.length > 0 && <tbody className="recent">
              <tr className="tip-band"><th colSpan={6} scope="colgroup">Recently settled</th></tr>
              {data.recent.map((o) => (
                <tr key={o.id} className="tip-staff-row"><th scope="row">{who(o)}</th><td>{o.label}</td><td>{dayShort(o.day)}</td><td className="r">{owedCell(o)}</td><td><StatusPill status="settled" /></td><td className="r tip-by">{by(o)}</td></tr>
              ))}
            </tbody>}
          </table>
        </div>
      ) : (
        <>
          <p className="tip-label tip-listhead">Still owed · {data.open.length}</p>
          {data.open.length ? <ul className="tip-card tip-list">{data.open.map((o) => (
            <li key={o.id} className="tip-staff-row tip-staffcard">{who(o)}<span className="tip-rowtext"><span className="tip-rowtitle">{o.label}</span><small>From {dayShort(o.day)}</small></span>
              <span className="tip-staffend">{owedCell(o)}<StatusPill status={o.status} /></span>{btn(o)}</li>))}</ul>
            : <p className="tip-card tip-none">Nothing owed right now.</p>}
          {data.recent.length > 0 && <><p className="tip-label tip-listhead">Recently settled</p><ul className="tip-card tip-list">{data.recent.map((o) => (
            <li key={o.id} className="tip-staff-row tip-staffcard">{who(o)}<span className="tip-rowtext"><span className="tip-rowtitle">{o.label}</span><small>From {dayShort(o.day)} · {by(o)}</small></span>
              <span className="tip-staffend">{owedCell(o)}<StatusPill status="settled" /></span></li>))}</ul></>}
        </>
      )}
      <p className="tip-foot">When you mark an item settled, the person sees “Settled by {data.you}” and the date on their own Tips page. {FOOTNOTE.split('.')[0]}.</p>
      {settle && <SettleSheet item={settle} who={settle.person.name} today={today} url={`/api/tips/team/${settle.id}/settle`} onClose={() => setSettle(null)}
        onDone={(m) => { setSettle(null); setToast(m); void load(); }} />}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}
