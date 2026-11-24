// Set Temporary Password (Nov 24; Tommy: "i need a assign temporary password vs a reset pin").
// Figma 09 · Idea Board → section 49 (1002:194): Make One for Me 1006:2850, Type One 1006:3017, the row once it's set
// 1007:3353. Nov 24, scope from Tommy ("you sign up with pin code and you sign in with email and password"): no temporary
// PIN; staff get a temporary password too, and the dialog asks for their email when they don't have one yet.
// Opens in the page (never the browser's own popups). The value is shown here once; the server only keeps its hash.
// Used on Super Admin → People, Owners and Managers, and a staff member's People panel.
import { useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { useModalKeys } from '../lib/modal';
import { DEFAULT_TEMP_DAYS, TEMP_DAYS, dayLabel, makeTempPassword, untilFor } from '../lib/temppass';
import { ErrorNote } from './ui';

/** An outstanding temporary password, as the People lists send it. */
export type Temporary = { expiresAt: string; createdAt: string } | null | undefined;
export type TempSet = { ok: true; name: string; email: string; days: number; expiresAt: string; until: string };
/** Who it's for: staff give an email here if they have none (they'll sign in with it). */
export type TempPerson = { id: number; name: string; email?: string | null; role: string };

const first = (name: string) => name.split(' ')[0];
const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

/** The row's tag: "Temporary · until Nov 30". */
export function TempTag({ temp }: { temp: Temporary }) {
  if (!temp) return null;
  return <span className="temp-tag">Temporary · until {dayLabel(temp.expiresAt)}</span>;
}

/** What the page says once it's set (DoneNote). */
export const tempDoneText = (r: TempSet, logged = 'It’s logged.') =>
  `${r.name} has a temporary password until ${r.until}. ${first(r.name)} signs in with ${r.email} and chooses their own the first time. ${logged}`;
/** Cancel Temporary's question (useAsk). */
export const cancelTempCopy = (p: TempPerson) => ({
  title: `Cancel ${p.name}’s Temporary Password?`,
  body: p.role === 'staff'
    ? `It stops working now. ${first(p.name)} signs in the way they did before. This is logged.`
    : `It stops working now, and ${first(p.name)}’s old password works again. This is logged.`,
  go: 'Cancel Temporary', no: 'Keep It',
});

export function TempDialog({ person, path, roleLabel, twoStep = false, onClose, onSet }: {
  person: TempPerson; /** POST here: /api/team/:id/temporary or /api/super/users/:id/temporary */ path: string;
  roleLabel?: string; twoStep?: boolean; onClose: () => void; onSet: (r: TempSet) => void;
}) {
  const staff = person.role === 'staff';
  const [mode, setMode] = useState<'make' | 'type'>('make');
  const [made, setMade] = useState(makeTempPassword);
  const [typed, setTyped] = useState('');
  const [email, setEmail] = useState(person.email || '');
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [days, setDays] = useState<number>(DEFAULT_TEMP_DAYS);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  useModalKeys(box, true, onClose);
  const name = first(person.name);
  const value = mode === 'make' ? made : typed;
  const until = untilFor(days);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (staff && !validEmail(email)) { setErr(`Add ${name}’s email. They’ll sign in with it.`); return; }
    if (value.length < 10) { setErr('Use at least 10 characters for the temporary password.'); return; }
    setBusy(true);
    try { onSet(await api<TempSet>(path, { method: 'POST', body: { value, days, ...(staff ? { email: email.trim() } : {}) } })); }
    catch (e2) { setErr((e2 as Error).message); setBusy(false); }
  };
  const copy = () => { void navigator.clipboard?.writeText(value).catch(() => {}); setCopied(true); };
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form ref={box} className="modal temp-box" role="dialog" aria-modal="true" aria-labelledby="temp-title" onSubmit={submit}>
        <p className="temp-kicker">People · {person.name}{roleLabel ? ` · ${roleLabel}` : ''}</p>
        <h2 id="temp-title">Set a Temporary Password for {name}</h2>
        <p className="temp-lead">{staff
          ? `Tell ${name} this password yourself, at line-up or by phone. They sign in with their email and this password, then choose their own.`
          : `Tell ${name} this password yourself, in person or by phone. Their current password stops working when you press Set.`}</p>
        {staff && (
          <label className="field temp-field"><span>{name}’s email</span>
            <input type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="name@email.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!person.email} />
            <small>{person.email ? 'They sign in with this. Change it if it’s wrong.' : 'They sign in with this from now on.'}</small>
          </label>
        )}
        <div className="temp-seg" role="radiogroup" aria-label="How to make it">
          {(['make', 'type'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''}
              onClick={() => { setMode(m); setErr(''); setCopied(false); }}>{m === 'make' ? 'Make One for Me' : 'Type One'}</button>
          ))}
        </div>
        {mode === 'make' ? (
          <div className="temp-field">
            <span className="temp-label" id="temp-made-label">Temporary password · shown once</span>
            <div className="temp-made-row">
              <output className="temp-made" aria-labelledby="temp-made-label" aria-live="polite">{made}</output>
              <button type="button" className="btn ghost temp-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <div className="temp-made-foot">
              <small>You’ll only see it here. Copy it now.</small>
              <button type="button" className="link-btn" onClick={() => { setMade(makeTempPassword()); setCopied(false); }}>Make Another</button>
            </div>
          </div>
        ) : (
          <label className="field temp-field"><span>Temporary password</span>
            <span className="temp-type-row">
              <input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} maxLength={200} value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
              <button type="button" className="link-btn temp-show" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
            </span>
            <small>At least 10 characters. {name} can’t keep it: they choose their own when they sign in.</small>
          </label>
        )}
        <label className="field temp-days"><span>Expires in</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {TEMP_DAYS.map((d) => <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'} · until {untilFor(d)}</option>)}
          </select>
        </label>
        <ul className="temp-facts">
          <li><Check />{name} must choose their own password the first time they sign in.</li>
          <li><Check />Works once. If it isn’t used by {until}, it stops working.</li>
          {twoStep
            ? <li><Lock />Two-step sign-in stays on: they still need their authenticator code.</li>
            : <li><Lock />Stored scrambled (hashed), like every password. You won’t see it again after you press Set.</li>}
        </ul>
        {err && <ErrorNote error={err} />}
        <div className="temp-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn temp-go" disabled={busy}>{busy ? 'Setting…' : 'Set Temporary Password'}</button>
        </div>
      </form>
    </div>, document.body);
}

const Check = () => <span className="temp-dot" aria-hidden="true">✓</span>;
const Lock = () => <svg className="temp-ico" viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.8a3 3 0 0 1 6 0V9" /></svg>;

/** Set Temporary Password / Cancel Temporary, for a list: the dialog, the cancel question and what to say after. `ask` is the
 *  page's useAsk().ask; `done` says what happened; `reload` refreshes the list. */
export function useTemp({ ask, done, fail, reload, logged }: { ask: (c: { title: string; body: string; go: string; no?: string; danger?: boolean }) => Promise<boolean>;
  done: (text: string) => void; fail: (msg: string) => void; reload: () => void; logged?: string }) {
  const [open, setOpen] = useState<{ person: TempPerson; path: string; roleLabel?: string; twoStep?: boolean } | null>(null);
  const dialog = open && <TempDialog {...open} onClose={() => setOpen(null)} onSet={(r) => { setOpen(null); done(tempDoneText(r, logged)); reload(); }} />;
  const cancel = async (person: TempPerson, path: string) => {
    if (!(await ask(cancelTempCopy(person)))) return;
    try { await api(path, { method: 'DELETE' }); done(`${person.name}’s temporary password is cancelled.`); reload(); }
    catch (e) { fail((e as Error).message); }
  };
  return { openTemp: setOpen, cancelTemp: cancel, tempDialog: dialog };
}
