// "Add video" on a wine page (Nov 2, Tommy: "have an option to upload a video"): opens the picker right on the page.
// Upload a file, paste a YouTube link, or pick one already uploaded. Saved for that page, then the page reloads.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { MediaPicker } from './MediaPicker';

export function AddVideoButton({ pageKey, title, style, className, children }: { pageKey: string; title: string; style: CSSProperties; className: string; children: ReactNode }) {
  const { bump } = useSession();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <button type="button" className={className + ' add-video-btn'} style={{ ...style, display: style.display || 'flex', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }} data-name="Add video" onClick={() => setOpen(true)}>{children}</button>
      {err && <span role="alert" className="add-video-err">{err}</span>}
      {open && createPortal(
        <MediaPicker kind="video" title={title} onClose={() => setOpen(false)}
          onPick={async (v) => {
            if (!('video' in v)) return;
            try { await api('/api/wine-videos', { method: 'PUT', body: { key: pageKey, video: v.video } }); setOpen(false); bump(); }
            catch (e) { setErr((e as Error).message || 'That didn’t save. Try again.'); setOpen(false); }
          }} />, document.body)}
    </>
  );
}
