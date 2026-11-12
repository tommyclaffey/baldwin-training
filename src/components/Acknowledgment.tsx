// The Training Acknowledgment's sign box (Nov 11). BRG's paper form has a printed name, a signature, a date and the
// trainer's signature. Here the person types their name and ticks that they've read and agree (the date is kept with it);
// their trainer or a manager then signs it off in People. Nov 12: it's a Day 1 step on My Path (src/path/AckPage.tsx),
// no longer part of Hospitality 101.
import { useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

export type Ack = { level: string; signed: { name: string; at: string } | null; canSign: boolean; trainer: { at: string; by: string | null } | null };

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Detroit' });

export function Acknowledgment({ data, style, className = '', onSigned }: { data: Ack; style?: CSSProperties; className?: string; onSigned?: () => void }) {
  const { bump } = useSession();
  const [signed, setSigned] = useState(data.signed);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = name.trim().length >= 2 && agree && !busy;

  const sign = async () => {
    if (!ready) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ ack: { name: string; at: string } }>('/api/path/ack', { method: 'POST', body: { level: data.level, name: name.trim(), agree } });
      setSigned(r.ack); bump(); onSigned?.();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <section className={'ack ' + className} style={{ ...style, height: 'auto', minHeight: 0 }} aria-label="Sign the acknowledgment">
      {signed ? (
        <div className="ack-done">
          <p className="ack-line"><span className="ack-tick" aria-hidden="true">✓</span><span>Signed by <strong>{signed.name}</strong> · {day(signed.at)}</span></p>
          <p className="ack-line ack-sub">{data.trainer ? `Trainer sign-off: ${data.trainer.by ? data.trainer.by + ' · ' : ''}${day(data.trainer.at)}` : 'Next: your trainer or manager signs it off.'}</p>
        </div>
      ) : data.canSign ? (
        <form className="ack-form" onSubmit={(e) => { e.preventDefault(); void sign(); }}>
          <label className="ack-field">
            <span>Your full name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" autoComplete="name" maxLength={80} />
          </label>
          <label className="ack-check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I have read, understood and agree to the above.</span>
          </label>
          <div className="ack-actions">
            <button type="submit" className="ack-btn" disabled={!ready}>{busy ? 'Signing…' : 'Sign the Acknowledgment'}</button>
            <span className="ack-note">Then your trainer signs it off.</span>
          </div>
          {err && <p className="ack-err" role="alert">{err}</p>}
        </form>
      ) : (
        <p className="ack-line ack-sub">Sign in to sign the acknowledgment.</p>
      )}
    </section>
  );
}
