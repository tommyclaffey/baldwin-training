import { BottleScanner, type BottleKind } from './scanner';
import { SpinViewer } from '../components/SpinViewer';
// Small form pieces shared by the admin screens.
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalKeys } from '../lib/modal';
import { MediaPicker } from '../components/MediaPicker';
import { PhotoAdjust } from './PhotoAdjust';
import { focusVars } from '../lib/focus';
import { VideoEmbed } from '../components/VideoEmbed';
import type { MailStatus, Video } from '../lib/api';
import { isDenied } from '../lib/api';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Text({ label, hint, value, onChange, max, placeholder, area, list }: {
  label: string; hint?: string; value: string | undefined; onChange: (v: string) => void; max?: number; placeholder?: string; area?: boolean; list?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {area
        ? <textarea value={value || ''} maxLength={max} placeholder={placeholder} rows={4} onChange={(e) => onChange(e.target.value)} />
        : <input value={value || ''} maxLength={max} placeholder={placeholder} list={list} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** A photo slot: shows the photo, opens the picker to upload or reuse one. */
export function PhotoField({ label, hint, value, onChange, scanName, scanKind = 'wine' }: { label: string; hint?: string; value?: string; onChange: (v: string) => void; scanName?: string; scanKind?: BottleKind }) {
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState(false);
  const [adjust, setAdjust] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="photo-field">
        {value ? <div className="f-zoom photo-preview" style={focusVars(value)} role="img" aria-label={label} /> : <div className="photo-empty">No photo yet</div>}
        <div className="row">
          {scanName !== undefined && <button type="button" className="btn" onClick={() => setScan(true)}>Scan Bottle</button>}
          <button type="button" className="btn ghost" onClick={() => setOpen(true)}>{value ? 'Replace Photo' : 'Add Photo'}</button>
          {value && <button type="button" className="btn ghost" onClick={() => setAdjust(true)}>Adjust Photo</button>}
          {value && <button type="button" className="link-btn danger" onClick={() => onChange('')}>Remove</button>}
        </div>
      </div>
      {hint && <small>{hint}</small>}
      {open && (
        <MediaPicker kind="image" title={label} onClose={() => setOpen(false)}
          onPick={(v) => { if ('img' in v) onChange(v.img); setOpen(false); }} />
      )}
      {adjust && value && <PhotoAdjust value={value} label={label} onClose={() => setAdjust(false)} onSave={(v) => { onChange(v); setAdjust(false); }} />}
      {scan && <BottleScanner name={scanName || label} kind={scanKind} onClose={() => setScan(false)} onDone={(url) => { onChange(url); setScan(false); }} />}
    </div>
  );
}

/** A video slot: an uploaded file or a YouTube link. */
export function VideoField({ label, hint, value, onChange }: { label: string; hint?: string; value?: Video | null; onChange: (v: Video | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="video-field">
        {value ? <div className="video-frame"><VideoEmbed video={value} /></div> : <div className="photo-empty">No video yet</div>}
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setOpen(true)}>{value ? 'Change Video' : 'Add Video'}</button>
          {value && <button type="button" className="link-btn danger" onClick={() => onChange(null)}>Remove</button>}
        </div>
      </div>
      {hint && <small>{hint}</small>}
      {open && (
        <MediaPicker kind="video" title={label} onClose={() => setOpen(false)}
          onPick={(v) => { if ('video' in v) onChange(v.video); setOpen(false); }} />
      )}
    </div>
  );
}

/** A repeating list of rows (build, steps, components…). */
export function Rows<T>({ label, hint, rows, make, max, onChange, render }: {
  label: string; hint?: string; rows: T[]; make: () => T; max: number; onChange: (rows: T[]) => void;
  render: (row: T, set: (patch: Partial<T>) => void, i: number) => ReactNode;
}) {
  const set = (i: number, patch: Partial<T>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const next = [...rows];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r);
    onChange(next);
  };
  return (
    <fieldset className="rows">
      <legend>{label}</legend>
      {hint && <small className="hint">{hint}</small>}
      {rows.length === 0 && <p className="muted">None yet.</p>}
      {rows.map((r, i) => (
        <div className="row-item" key={i}>
          <span className="row-num">{i + 1}</span>
          <div className="row-body">{render(r, (p) => set(i, p), i)}</div>
          <div className="row-tools">
            <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="icon-btn" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="icon-btn" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
          </div>
        </div>
      ))}
      {rows.length < max && <button type="button" className="btn ghost" onClick={() => onChange([...rows, make()])}>Add Row</button>}
    </fieldset>
  );
}

/** Comma-separated list in one box (tags, allergens). */
export function ListText({ label, hint, value, onChange, placeholder }: { label: string; hint?: string; value: string[] | undefined; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState((value || []).join(', '));
  return (
    <Text label={label} hint={hint} placeholder={placeholder} value={text}
      onChange={(t) => { setText(t); onChange(t.split(',').map((s) => s.trim()).filter(Boolean)); }} />
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children}</div>;
}

export function Loading() {
  return <div className="admin-loading" aria-busy="true"><div className="loader" /></div>;
}

export function ErrorNote({ error, retry }: { error: string; retry?: () => void }) {
  return <p className="error" role="alert">{error} {retry && !isDenied(error) && <button className="link-btn" onClick={retry}>Try Again</button>}</p>;
}

export const when = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/** "Are you sure?" inside the app (Nov 23). Tommy: "links dont work" on Super Admin → People. The row's actions asked with the
 *  browser's own confirm(), or (Reset PIN) didn't ask or answer at all. A browser can switch its popups off without a sign
 *  (Chrome's "don't let this site prompt you", in-app and embedded browsers), and then confirm() says no and the button
 *  does nothing. This asks in the page, so it always shows; Cancel has the focus, Escape cancels.
 *  `const { ask, asking } = useAsk();` render `{asking}`, then `if (await ask({ … })) doIt();` */
export type AskCopy = { title: string; body: ReactNode; go: string; danger?: boolean };
export function useAsk() {
  const [open, setOpen] = useState<(AskCopy & { done: (ok: boolean) => void }) | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const answer = (ok: boolean) => { if (!open) return; open.done(ok); setOpen(null); };
  useModalKeys(box, !!open, () => answer(false));
  const ask = (copy: AskCopy) => new Promise<boolean>((done) => setOpen({ ...copy, done }));
  const asking = open && createPortal(
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) answer(false); }}>
      <div ref={box} className="modal arc-confirm ask-box" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby="ask-body">
        <h2 id="ask-title">{open.title}</h2>
        <p id="ask-body">{open.body}</p>
        <div className="arc-actions">
          <button type="button" className="btn ghost" onClick={() => answer(false)}>Cancel</button>
          <button type="button" className={'btn' + (open.danger ? ' ask-danger' : '')} onClick={() => answer(true)}>{open.go}</button>
        </div>
      </div>
    </div>, document.body);
  /** Ask, then run `fn` only on a yes. */
  const askThen = async (copy: AskCopy, fn: () => unknown) => { if (await ask(copy)) await fn(); };
  return { ask, askThen, asking };
}

/** What just happened, under the page's heading (Nov 23): every action says so, so nothing looks like it did nothing. */
export function DoneNote({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="card ok-card done-note" role="status">
      <p>{text}</p>
      <button type="button" className="link-btn" onClick={onClose}>Done</button>
    </div>
  );
}

/** A password reset link to send by hand (Nov 11): like an invite link, with Copy Link and when it stops working. */
export type ResetLink = { link: string; expiresAt: string; hours: number; name: string; email: string };
export function ResetLinkCard({ reset, onClose }: { reset: ResetLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = location.origin + reset.link;
  return (
    <div className="card ok-card reset-card" role="status">
      <p>Send this link to <strong>{reset.name}</strong> ({reset.email}). It works once and expires in {reset.hours} hours ({when(reset.expiresAt)}). They pick a new password and are signed out everywhere else.</p>
      <div className="row">
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={`Reset link for ${reset.name}`} />
        <button type="button" className="btn ghost" onClick={() => { void navigator.clipboard?.writeText(url); setCopied(true); }}>{copied ? 'Copied' : 'Copy Link'}</button>
        <button type="button" className="link-btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/** What happened to the email (Nov 16): every invite and promotion link goes by email once email is set up. */
export function mailLine(email: string, mail?: MailStatus | null) {
  if (mail?.sent) return `Email sent to ${email}.`;
  if (mail?.reason === 'limit') return `We didn’t email it: ${email} has had 3 emails from us in the last hour.`;
  if (mail?.reason === 'failed') return `The email to ${email} didn’t go through.`;
  if (mail?.reason === 'demo') return 'Emails are switched off in the demo.';
  return 'Email isn’t set up yet, so it wasn’t emailed.';
}
/** An invite or promotion link (Nov 16): whether it was emailed, and the link with Copy Link either way. */
export function InviteSentCard({ link, email, mail, days = 14, who, note, buttonClass = 'btn ghost', onDone }: {
  link: string; email: string; mail?: MailStatus | null; days?: number; who?: string; note?: ReactNode; buttonClass?: string; onDone?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card ok-card invite-sent" role="status">
      <p className="invite-sent-mail"><strong>{mailLine(email, mail)}</strong></p>
      <p>{mail?.sent ? 'You can also copy the link and send it yourself.' : `Copy the link and send it to ${who || email}.`} It works once and expires in {days} days.{note ? <> {note}</> : null}</p>
      <div className="row">
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label={`Invite link for ${email}`} />
        <button type="button" className={buttonClass} onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); }}>{copied ? 'Copied' : 'Copy Link'}</button>
        {onDone && <button type="button" className="link-btn" onClick={onDone}>Done</button>}
      </div>
    </div>
  );
}

/** A 360° spin of the bottle: frames from the spin scanner (Oct 31; Photo by Photo too, Nov 18). */
export function SpinField({ label, hint, value, onChange, name, kind = 'wine' }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; name: string; kind?: BottleKind }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="photo-field">
        {value.length > 1 ? <SpinViewer frames={value} alt={name} className="spin-field" /> : <div className="photo-empty">No spin yet</div>}
        <div className="row">
          <button type="button" className="btn" onClick={() => setOpen(true)}>{value.length ? 'Spin Again' : 'Make a Spin'}</button>
          {value.length > 0 && <button type="button" className="link-btn danger" onClick={() => onChange([])}>Remove</button>}
        </div>
      </div>
      {hint && <small>{hint}</small>}
      {open && <BottleScanner spin kind={kind} name={name || label} onClose={() => setOpen(false)} onSpin={(f) => { onChange(f); setOpen(false); }} />}
    </div>
  );
}
