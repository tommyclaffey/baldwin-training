// Bottle scanner: line the bottle up in the guide, take the photo, get just the bottle on the Wine Book beige.
// The cut-out runs on the server (server/scanner.mjs). The box can be moved and the bottle cut again.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { api, type MediaItem } from '../lib/api';

type Box = [number, number, number, number]; // x0, y0, x1, y1 as fractions of the photo

/** The guide: a tall bottle shape in the middle of the frame (frame width / height given). */
function guideFor(w: number, h: number): Box {
  const gh = 0.84, gw = Math.min(0.9, (gh * h * 0.36) / w);
  return [(1 - gw) / 2, (1 - gh) / 2, (1 + gw) / 2, (1 + gh) / 2];
}

async function post(path: string, blob: Blob) {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-BT': '1' }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The scanner couldn’t read that photo.');
  return data;
}

export function BottleScanner({ name, onDone, onClose, spin = false, onSpin }: { name: string; onDone: (url: string) => void; onClose: () => void; spin?: boolean; onSpin?: (frames: string[]) => void }) {
  const [step, setStep] = useState<'camera' | 'working' | 'review'>('camera');
  const [camErr, setCamErr] = useState('');
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<{ url: string; w: number; h: number } | null>(null);
  const [token, setToken] = useState('');
  const [box, setBox] = useState<Box>([0.3, 0.08, 0.7, 0.92]);
  const [cutBox, setCutBox] = useState<Box | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState('');
  // Spin: frames recorded while the bottle turns; the first is cut like a photo, the rest reuse its outline.
  const [frames, setFrames] = useState<Blob[]>([]);
  const [recording, setRecording] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => { void api('/api/scan/ready', { method: 'POST' }).catch(() => {}); }, []);
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => {
    if (step !== 'camera') return;
    let off = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCamErr('This browser can’t open the camera here. Upload a photo instead.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => { if (off) { s.getTracks().forEach((t) => t.stop()); return; } stream.current = s; if (video.current) { video.current.srcObject = s; void video.current.play(); } })
      .catch(() => setCamErr('The camera is blocked or not available. Upload a photo instead, or allow the camera in your browser settings.'));
    return () => { off = true; stop(); };
  }, [step]);
  useEffect(() => () => stop(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const cut = useCallback(async (t: string, b: Box) => {
    setBusy('Cutting out the bottle…'); setError('');
    try {
      const r = await api<{ preview: string }>('/api/scan/cut', { method: 'POST', body: { token: t, box: b } });
      setPreview(r.preview); setCutBox(b);
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  }, []);

  /** A photo (from the camera or a file): send it, then cut with the guide box. */
  const use = async (blob: Blob, w: number, h: number, b: Box) => {
    stop();
    setStep('working'); setError(''); setPreview('');
    setPhoto({ url: URL.createObjectURL(blob), w, h });
    setBox(b);
    setBusy('Reading the photo…');
    try {
      const r = await post('/api/scan', blob);
      setToken(r.token);
      setStep('review');
      await cut(r.token, b);
    } catch (e) { setError((e as Error).message); setStep('review'); setBusy(''); }
  };

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob((b) => b && void use(b, c.width, c.height, guideFor(c.width, c.height)), 'image/jpeg', 0.92);
  };
  const FRAMES = 24;
  const grab = (src: HTMLVideoElement) => new Promise<Blob>((ok) => {
    const k = Math.min(1, 1280 / Math.max(src.videoWidth, src.videoHeight));
    const c = document.createElement('canvas'); c.width = Math.round(src.videoWidth * k); c.height = Math.round(src.videoHeight * k);
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    c.toBlob((b) => ok(b!), 'image/jpeg', 0.9);
  });
  const startSpin = (all: Blob[], w: number, h: number) => { setFrames(all); void use(all[0], w, h, guideFor(w, h)); };
  /** Record about five seconds while the bottle turns on a lazy Susan. */
  const recordSpin = async () => {
    const v = video.current; if (!v || !v.videoWidth) return;
    const all: Blob[] = [];
    for (let k = 0; k < FRAMES; k++) { setRecording(k + 1); all.push(await grab(v)); await new Promise((r) => setTimeout(r, 200)); }
    setRecording(0);
    const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    startSpin(all, Math.round(v.videoWidth * k), Math.round(v.videoHeight * k));
  };
  /** Or a short video of the turn, from the camera roll. */
  const uploadSpin = async (f: File | undefined) => {
    if (!f) return;
    setBusy('Reading the video…'); setError('');
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(f);
    try {
      await new Promise<void>((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error('That video didn’t open. Try an MP4 or MOV.')); });
      const all: Blob[] = [];
      for (let k = 0; k < FRAMES; k++) { v.currentTime = (v.duration * k) / FRAMES; await new Promise((r) => { v.onseeked = r; }); all.push(await grab(v)); }
      const s2 = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      setBusy(''); stop(); startSpin(all, Math.round(v.videoWidth * s2), Math.round(v.videoHeight * s2));
    } catch (e) { setBusy(''); setError((e as Error).message); }
  };
  const keepSpin = async () => {
    setError('');
    try {
      for (let k = 1; k < frames.length; k++) {
        setBusy(`Cutting out frame ${k + 1} of ${frames.length}…`);
        const res = await fetch(`/api/scan/spin?token=${encodeURIComponent(token)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg', 'X-BT': '1' }, body: frames[k] });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'A frame didn’t cut out. Try the spin again.');
      }
      setBusy('Saving the spin…');
      const r = await api<{ frames: string[] }>('/api/scan/spin/keep', { method: 'POST', body: { token, name } });
      onSpin?.(r.frames);
    } catch (e) { setError((e as Error).message); setBusy(''); }
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    const img = new Image();
    img.onload = () => void use(f, img.naturalWidth, img.naturalHeight, guideFor(img.naturalWidth, img.naturalHeight));
    img.onerror = () => void use(f, 1000, 1500, [0.3, 0.08, 0.7, 0.92]);
    img.src = URL.createObjectURL(f);
  };
  const keep = async () => {
    setBusy('Saving…'); setError('');
    try { const m = await api<MediaItem>('/api/scan/keep', { method: 'POST', body: { token, name } }); if (m.url) onDone(m.url); }
    catch (e) { setError((e as Error).message); setBusy(''); }
  };
  const retake = () => { setPhoto(null); setPreview(''); setToken(''); setError(''); setCamErr(''); setFrames([]); setStep('camera'); };
  const changed = !cutBox || cutBox.some((v, i) => Math.abs(v - box[i]) > 0.002);
  const guide = video.current?.videoWidth ? guideFor(video.current.videoWidth, video.current.videoHeight) : guideFor(1080, 1440);

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal scanner" role="dialog" aria-modal="true" aria-label={`Scan the bottle · ${name}`}>
        <header className="scanner-head">
          <div><strong>{spin ? 'Spin the Bottle' : 'Scan the Bottle'}</strong><small>{name}</small></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {step === 'camera' && (
          <>
            <div className="scanner-stage">
              {!camErr ? (
                <div className="scanner-cam">
                  <video ref={video} playsInline muted />
                  <div className="scanner-guide" style={{ left: `${guide[0] * 100}%`, top: `${guide[1] * 100}%`, width: `${(guide[2] - guide[0]) * 100}%`, height: `${(guide[3] - guide[1]) * 100}%` }} />
                </div>
              ) : <p className="scanner-note">{camErr}</p>}
            </div>
            {spin
              ? <p className="muted scanner-tip">Stand the bottle on a lazy Susan, fill the outline, then tap Record and turn it slowly all the way round (about five seconds). Keep the phone still.</p>
              : <p className="muted scanner-tip">Stand the bottle up, label facing you, and fill the outline top to bottom. Plain background is best, but it works on the back bar too.</p>}
            {error && <p className="error" role="alert">{error}</p>}
            <div className="row scanner-actions">
              {spin
                ? <>
                    {!camErr && <button className="btn" disabled={!!recording || !!busy} onClick={() => void recordSpin()}>{recording ? `Recording… ${recording} of ${FRAMES}` : 'Record the Spin'}</button>}
                    <label className="btn ghost">{busy || 'Upload a Spin Video'}<input type="file" accept="video/*" hidden onChange={(e) => void uploadSpin(e.target.files?.[0])} /></label>
                  </>
                : <>
                    {!camErr && <button className="btn" onClick={snap}>Take Photo</button>}
                    <label className="btn ghost">Upload a Photo<input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
                  </>}
            </div>
          </>
        )}

        {step !== 'camera' && (
          <>
            <div className="scanner-review">
              <div className="scanner-pane">
                <small className="muted">Your photo · drag the box to fit the bottle</small>
                {photo && <BoxEditor src={photo.url} ratio={photo.w / photo.h} box={box} onChange={setBox} />}
              </div>
              <div className="scanner-pane">
                <small className="muted">Just the bottle</small>
                <div className="scanner-result">
                  {preview ? <img src={preview} alt={`${name}, cut out`} /> : <span className="muted">{busy || 'No cut-out yet'}</span>}
                </div>
              </div>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            {busy && preview && <p className="muted" role="status">{busy}</p>}
            <div className="row scanner-actions">
              <button className="btn ghost" onClick={retake}>Retake</button>
              <button className="btn ghost" disabled={!token || !!busy || !changed} onClick={() => void cut(token, box)}>Cut Again</button>
              {spin && frames.length > 1
                ? <button className="btn" disabled={!preview || !!busy || changed} onClick={() => void keepSpin()}>Cut Out All {frames.length} Frames</button>
                : <button className="btn" disabled={!preview || !!busy || changed} onClick={() => void keep()}>Use This Photo</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The photo with a box on top: drag inside to move it, drag a corner to resize. */
function BoxEditor({ src, ratio, box, onChange }: { src: string; ratio: number; box: Box; onChange: (b: Box) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; x: number; y: number; start: Box } | null>(null);
  const down = (mode: string) => (e: RPointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, start: box };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current, r = wrap.current?.getBoundingClientRect();
    if (!d || !r) return;
    const dx = (e.clientX - d.x) / r.width, dy = (e.clientY - d.y) / r.height;
    let [x0, y0, x1, y1] = d.start;
    const MIN = 0.05, cl = (v: number) => Math.max(0, Math.min(1, v));
    if (d.mode === 'move') { const w = x1 - x0, h = y1 - y0; x0 = cl(x0 + dx); y0 = cl(y0 + dy); x0 = Math.min(x0, 1 - w); y0 = Math.min(y0, 1 - h); x1 = x0 + w; y1 = y0 + h; }
    if (d.mode.includes('l')) x0 = Math.min(cl(x0 + dx), x1 - MIN);
    if (d.mode.includes('r')) x1 = Math.max(cl(x1 + dx), x0 + MIN);
    if (d.mode.includes('t')) y0 = Math.min(cl(y0 + dy), y1 - MIN);
    if (d.mode.includes('b')) y1 = Math.max(cl(y1 + dy), y0 + MIN);
    onChange([x0, y0, x1, y1]);
  };
  const nudge = (e: React.KeyboardEvent) => {
    const k = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }[e.key];
    if (!k) return;
    e.preventDefault();
    const [x0, y0, x1, y1] = box;
    if (x0 + k[0] < 0 || x1 + k[0] > 1 || y0 + k[1] < 0 || y1 + k[1] > 1) return;
    onChange([x0 + k[0], y0 + k[1], x1 + k[0], y1 + k[1]]);
  };
  return (
    <div ref={wrap} className="box-editor" style={{ aspectRatio: String(ratio), width: `min(100%, calc(62vh * ${ratio}))` }} onPointerMove={move} onPointerUp={() => { drag.current = null; }}>
      <img src={src} alt="" draggable={false} />
      <div className="box-shade" style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }}
        onPointerDown={down('move')} tabIndex={0} role="group" aria-label="Bottle box. Arrow keys move it." onKeyDown={nudge}>
        {['tl', 'tr', 'bl', 'br'].map((c) => <span key={c} className={'box-handle ' + c} onPointerDown={down(c)} />)}
      </div>
    </div>
  );
}

/* ---- Admin → Bottle Scanner: walk the cellar, scan each wine ---- */
type WineEntry = { id: number; slug: string; data: { name?: string; grape?: string; region?: string; list?: string; bottle_img?: string; source?: string } };

export function BottleScannerPage() {
  const [wines, setWines] = useState<WineEntry[] | null>(null);
  const [error, setError] = useState('');
  const [show, setShow] = useState<'all' | 'book' | 'scanned' | 'none'>('all');
  const [open, setOpen] = useState<WineEntry | null>(null);
  const load = () => { setError(''); api<{ entries: WineEntry[] }>('/api/entries?collection=wine').then((r) => setWines(r.entries)).catch((e) => setError(e.message)); };
  useEffect(load, []);
  const kind = (w: WineEntry) => (!w.data.bottle_img ? 'none' : /^Scanned/.test(w.data.source || '') ? 'scanned' : 'book');
  const save = async (w: WineEntry, url: string) => {
    setOpen(null);
    try {
      const full = await api<WineEntry>(`/api/entries/${w.id}`);
      const source = `Scanned ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      const saved = await api<WineEntry>(`/api/entries/${w.id}`, { method: 'PUT', body: { data: { ...full.data, bottle_img: url, source } } });
      setWines((ws) => ws && ws.map((x) => (x.id === w.id ? saved : x)));
    } catch (e) { setError((e as Error).message); }
  };
  const list = (wines || []).filter((w) => show === 'all' || kind(w) === show);
  const count = (k: string) => (wines || []).filter((w) => kind(w) === k).length;
  return (
    <div className="admin-page">
      <div className="editor-head">
        <div>
          <h1>Bottle Scanner</h1>
          <p className="muted">Take a photo of a bottle and the scanner cuts out just the bottle, on the same beige as the Wine Book. It goes straight onto that wine’s page. Works best on a phone, standing the bottle up with the label facing you.</p>
        </div>
        {wines && <span className="admin-pill">{count('scanned')} of {wines.length} scanned</span>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {wines && (
        <div className="row chip-row" role="tablist" aria-label="Show">
          {([['all', `All ${wines.length}`], ['scanned', `Scanned ${count('scanned')}`], ['none', `No photo ${count('none')}`]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={show === k} className={'chip' + (show === k ? ' on' : '')} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
      )}
      {!wines && !error && <p className="muted">Loading…</p>}
      <div className="scan-grid">
        {list.map((w) => (
          <button key={w.id} className="scan-card" onClick={() => setOpen(w)}>
            <span className="scan-thumb">{w.data.bottle_img ? <img src={w.data.bottle_img} alt="" loading="lazy" /> : <span className="muted small">No photo</span>}</span>
            <strong>{w.data.name}</strong>
            <small className="muted">{[w.data.grape, w.data.region].filter(Boolean).join(' · ')}</small>
            <small className={'scan-src ' + kind(w)}>{kind(w) === 'scanned' ? w.data.source : 'No photo yet'}</small>
          </button>
        ))}
      </div>
      {open && <BottleScanner name={open.data.name || 'Bottle'} onClose={() => setOpen(null)} onDone={(url) => void save(open, url)} />}
    </div>
  );
}
