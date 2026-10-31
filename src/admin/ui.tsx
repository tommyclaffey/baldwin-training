import { BottleScanner } from './scanner';
import { SpinViewer } from '../components/SpinViewer';
// Small form pieces shared by the admin screens.
import { useState, type ReactNode } from 'react';
import { MediaPicker } from '../components/MediaPicker';
import { VideoEmbed } from '../components/VideoEmbed';
import type { Video } from '../lib/api';

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
export function PhotoField({ label, hint, value, onChange, scanName }: { label: string; hint?: string; value?: string; onChange: (v: string) => void; scanName?: string }) {
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="photo-field">
        {value ? <img src={value} alt="" /> : <div className="photo-empty">No photo yet</div>}
        <div className="row">
          {scanName !== undefined && <button type="button" className="btn" onClick={() => setScan(true)}>Scan Bottle</button>}
          <button type="button" className="btn ghost" onClick={() => setOpen(true)}>{value ? 'Replace Photo' : 'Add Photo'}</button>
          {value && <button type="button" className="link-btn danger" onClick={() => onChange('')}>Remove</button>}
        </div>
      </div>
      {hint && <small>{hint}</small>}
      {open && (
        <MediaPicker kind="image" title={label} onClose={() => setOpen(false)}
          onPick={(v) => { if ('img' in v) onChange(v.img); setOpen(false); }} />
      )}
      {scan && <BottleScanner name={scanName || label} onClose={() => setScan(false)} onDone={(url) => { onChange(url); setScan(false); }} />}
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
  return <p className="error" role="alert">{error} {retry && <button className="link-btn" onClick={retry}>Try Again</button>}</p>;
}

export const when = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/** A 360° spin of the bottle: frames from the spin scanner (Oct 31). */
export function SpinField({ label, hint, value, onChange, name }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="photo-field">
        {value.length > 1 ? <SpinViewer frames={value} alt={name} className="spin-field" /> : <div className="photo-empty">No spin yet</div>}
        <div className="row">
          <button type="button" className="btn" onClick={() => setOpen(true)}>{value.length ? 'Record Again' : 'Record a Spin'}</button>
          {value.length > 0 && <button type="button" className="link-btn danger" onClick={() => onChange([])}>Remove</button>}
        </div>
      </div>
      {hint && <small>{hint}</small>}
      {open && <BottleScanner spin name={name || label} onClose={() => setOpen(false)} onDone={() => setOpen(false)} onSpin={(f) => { onChange(f); setOpen(false); }} />}
    </div>
  );
}
