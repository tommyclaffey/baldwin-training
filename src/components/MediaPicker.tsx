import { useEffect, useRef, useState } from 'react';
import { api, uploadFile, type MediaItem, type Video } from '../lib/api';

type Props = {
  kind: 'image' | 'video';
  title: string;
  onPick: (value: { img: string } | { video: Video }) => void;
  onClose: () => void;
  onRemove?: () => void;
};

/** Upload a file, paste a YouTube link (videos), or pick something already uploaded. */
export function MediaPicker({ kind, title, onPick, onClose, onRemove }: Props) {
  const [tab, setTab] = useState<'upload' | 'youtube' | 'library'>('upload');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [library, setLibrary] = useState<MediaItem[] | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button, input')?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); prev?.focus(); };
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'library' || library) return;
    api<{ media: MediaItem[] }>('/api/media').then((r) => setLibrary(r.media)).catch((e) => setError(e.message));
  }, [tab, library]);

  const pickItem = (m: MediaItem) => {
    if (kind === 'image') { if (m.url) onPick({ img: m.url }); return; }
    if (m.kind === 'youtube' && m.youtubeId) onPick({ video: { kind: 'youtube', youtubeId: m.youtubeId, title: m.title } });
    else if (m.url) onPick({ video: { kind: 'file', url: m.url, mime: m.mime || undefined, title: m.title } });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    const ok = kind === 'image' ? f.type.startsWith('image/') : f.type.startsWith('video/');
    if (!ok) { setError(kind === 'image' ? 'Choose a photo (JPG, PNG or WebP).' : 'Choose a video (MP4, MOV or WebM).'); return; }
    try { setProgress(0); pickItem(await uploadFile(f, setProgress)); }
    catch (e) { setError((e as Error).message); setProgress(null); }
  };

  const addYouTube = async () => {
    setError('');
    try { pickItem(await api<MediaItem>('/api/media/youtube', { method: 'POST', body: { url: link } })); }
    catch (e) { setError((e as Error).message); }
  };

  const items = (library || []).filter((m) => (kind === 'image' ? m.mime?.startsWith('image/') : m.kind === 'youtube' || m.mime?.startsWith('video/')));

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mp-title" ref={dialog}>
        <div className="modal-head">
          <h2 id="mp-title">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'upload'} onClick={() => setTab('upload')}>Upload</button>
          {kind === 'video' && <button role="tab" aria-selected={tab === 'youtube'} onClick={() => setTab('youtube')}>YouTube link</button>}
          <button role="tab" aria-selected={tab === 'library'} onClick={() => setTab('library')}>Already uploaded</button>
        </div>
        {tab === 'upload' && (
          <label className="drop">
            <input type="file" accept={kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/quicktime,video/webm'} onChange={(e) => onFile(e.target.files?.[0])} />
            {progress === null ? (
              <><strong>Choose a {kind === 'image' ? 'photo' : 'video'}</strong><span>{kind === 'image' ? 'JPG, PNG or WebP' : 'MP4, MOV or WebM, up to 600 MB'}</span></>
            ) : (
              <><strong>Uploading… {progress}%</strong><span className="bar"><span style={{ width: progress + '%' }} /></span></>
            )}
          </label>
        )}
        {tab === 'youtube' && (
          <div className="stack">
            <label className="field">
              <span>YouTube link</span>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtu.be/…" />
              <small>Copy it from the Share button on YouTube. Unlisted videos work too.</small>
            </label>
            <button className="btn" onClick={addYouTube} disabled={!link.trim()}>Use This Video</button>
          </div>
        )}
        {tab === 'library' && (
          <div className="lib">
            {!library && !error && <p className="muted">Loading…</p>}
            {library && items.length === 0 && <p className="muted">Nothing uploaded yet.</p>}
            {items.map((m) => (
              <button key={m.id} className="lib-item" onClick={() => pickItem(m)}>
                {m.mime?.startsWith('image/') && m.url ? <img src={m.url} alt="" /> : m.kind === 'youtube' ? <img src={`https://i.ytimg.com/vi/${m.youtubeId}/mqdefault.jpg`} alt="" /> : <span className="vid-icon">▶</span>}
                <span>{m.title}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {onRemove && <button className="link-btn danger" onClick={onRemove}>Remove the {kind === 'image' ? 'photo' : 'video'}</button>}
      </div>
    </div>
  );
}
