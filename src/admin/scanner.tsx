// Bottle scanner: line the bottle up in the guide, take the photo, get just the bottle on the Wine Book beige.
// The cut-out runs on the server (server/scanner.mjs). The box can be moved and the bottle cut again.
// Nov 18 (Figma 09 · Proposals → 34): spirits as well as wine (one scanner; only where the result is saved differs),
// a guide shaped like the bottle (wine tall and slim, a spirit stockier with a shorter neck), and three ways to scan:
// Record a Spin (lazy Susan), Photo by Photo (12 photos turning the bottle by hand, each cut out on its own) and One Photo.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { api, type MediaItem } from '../lib/api';
import { useSession } from '../lib/session';
import { useModalKeys } from '../lib/modal';
import { SpinViewer } from '../components/SpinViewer';
import { AddBottleButton } from '../components/AddBottle';

type Box = [number, number, number, number]; // x0, y0, x1, y1 as fractions of the photo
export type BottleKind = 'wine' | 'spirit';

/** The guide (fractions of a frame `w` × `h`): a wine bottle is tall and slim, a spirit bottle stockier. */
const SHAPE: Record<BottleKind, { gh: number; ratio: number }> = { wine: { gh: 0.84, ratio: 0.33 }, spirit: { gh: 0.76, ratio: 0.44 } };
function guideFor(w: number, h: number, kind: BottleKind = 'wine'): Box {
  const { gh, ratio } = SHAPE[kind];
  const gw = Math.min(0.9, (gh * h * ratio) / w);
  return [(1 - gw) / 2, (1 - gh) / 2, (1 + gw) / 2, (1 + gh) / 2];
}
/** The bottle's outline inside its guide box, as [x, y] fractions of the box (drawn as one path). */
function outline(kind: BottleKind): string {
  // wine: a long neck that slopes into round shoulders · spirit: a short neck, square shoulders, a wide body
  const p = kind === 'wine'
    ? 'M .36 0 L .64 0 L .64 .27 C .64 .37 1 .37 1 .5 L 1 .965 Q 1 1 .965 1 L .035 1 Q 0 1 0 .965 L 0 .5 C 0 .37 .36 .37 .36 .27 Z'
    : 'M .33 0 L .67 0 L .67 .13 C .67 .2 1 .19 1 .27 L 1 .97 Q 1 1 .97 1 L .03 1 Q 0 1 0 .97 L 0 .27 C 0 .19 .33 .2 .33 .13 Z';
  return p;
}
/** The guide drawn over the camera: the bottle's outline, dashed, and a shade everywhere else. In the frame's own pixels. */
function GuideOverlay({ w, h, kind }: { w: number; h: number; kind: BottleKind }) {
  const [x0, y0, x1, y1] = guideFor(w, h, kind);
  const bx = x0 * w, by = y0 * h, bw = (x1 - x0) * w, bh = (y1 - y0) * h;
  const path = outline(kind).replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_, a, b) => `${(bx + Number(a) * bw).toFixed(1)} ${(by + Number(b) * bh).toFixed(1)}`);
  return (
    <svg className="scanner-overlay" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`M0 0H${w}V${h}H0Z ${path}`} fillRule="evenodd" fill="rgba(17,17,17,.45)" />
      <path d={path} fill="none" stroke="rgba(242,238,231,.92)" strokeWidth="2" strokeDasharray="7 6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Sample bottles for the demo (Nov 12): unbranded stand-ins, credited in public/img/scanner-samples/samples.json. */
type Sample = { file: string; thumb: string; label: string; box: Box; w: number; h: number; credit: string };
let samplesP: Promise<Sample[]> | null = null;
const loadSamples = () => (samplesP ??= fetch('/img/scanner-samples/samples.json').then((r) => r.json()).then((j) => j.samples as Sample[]).catch(() => { samplesP = null; return []; }));
type DemoLeft = { scans: number; saves: number; scansLeft: number; savesLeft: number; cuts?: number; cutsLeft?: number };

async function post(path: string, blob: Blob) {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-BT': '1' }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The scanner couldn’t read that photo.');
  return data;
}
/** A still from the camera (or a video), at most `max` px on its long side. */
const grabFrom = (src: HTMLVideoElement, max = 1280, q = 0.9) => new Promise<{ blob: Blob; w: number; h: number }>((ok) => {
  const k = Math.min(1, max / Math.max(src.videoWidth, src.videoHeight));
  const c = document.createElement('canvas'); c.width = Math.round(src.videoWidth * k); c.height = Math.round(src.videoHeight * k);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  c.toBlob((b) => ok({ blob: b!, w: c.width, h: c.height }), 'image/jpeg', q);
});
/** The camera's own full-resolution photo (ImageCapture), turned upright and kept only if it's framed like the preview
 *  (same shape within 2%), at most 2400 px on its long side (what the server keeps). Null where it isn't available. */
async function fullPhoto(v: HTMLVideoElement): Promise<{ blob: Blob; w: number; h: number } | null> {
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture;
  const track = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
  if (!IC || !track) return null;
  try {
    const blob = await new IC(track).takePhoto();
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    if (Math.abs(bmp.width / bmp.height - v.videoWidth / v.videoHeight) > 0.02 * (v.videoWidth / v.videoHeight)) return null;
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
    return out ? { blob: out, w: c.width, h: c.height } : null;
  } catch { return null; }
}
/** A picked photo, made smaller in the browser when it can be read (an iPhone's 12 MP photo → 2400 px, what the server
 *  keeps; was 1600 before the Nov 22 cut-out, which uses the extra detail for the edge). */
async function shrink(f: File, max = 2400): Promise<{ blob: Blob; w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
    if (blob) return { blob, w: c.width, h: c.height };
  } catch { /* the server reads it as it is */ }
  return { blob: f, w: 1200, h: 1600 };
}

/** The camera, opened while `on`. */
function useCamera(on: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [err, setErr] = useState('');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; }, []);
  useEffect(() => {
    if (!on) return;
    let off = false;
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia) { setErr('This browser can’t open the camera here. Upload photos instead.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
      .then((s) => {
        if (off) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = video.current;
        if (v) { v.srcObject = s; v.onloadedmetadata = () => setSize({ w: v.videoWidth, h: v.videoHeight }); void v.play(); }
      })
      .catch(() => setErr('The camera is blocked or not available. Upload photos instead, or allow the camera in your browser settings.'));
    return () => { off = true; stop(); };
  }, [on, stop]);
  useEffect(() => () => stop(), [stop]);
  return { video, err, size, stop };
}

type Mode = 'video' | 'photos' | 'photo';

export function BottleScanner({ name, detail, kind = 'wine', onDone, onClose, spin = false, onSpin, file }: {
  name: string; detail?: string; kind?: BottleKind;
  /** Nov 25 (Add a Bottle): start from a photo already picked (Upload a Photo Instead), straight to the cut-out. */
  file?: File;
  /** One photo kept (Scan Bottle, or One Photo from the picker). */
  onDone?: (url: string) => void;
  onClose: () => void;
  /** Open on the spin modes (Make a Spin). */
  spin?: boolean;
  onSpin?: (frames: string[]) => void;
}) {
  // Make a Spin opens on the picker, Photo by Photo chosen; Scan Bottle goes straight to the one photo.
  const [mode, setMode] = useState<Mode>(spin ? 'photos' : 'photo');
  const [picked, setPicked] = useState(!spin);
  const demo = !!useSession().user?.demo;
  const [left, setLeft] = useState<DemoLeft | null>(null);
  const ready = useCallback(() => { void api<{ demo?: DemoLeft }>('/api/scan/ready', { method: 'POST' }).then((r) => setLeft(r.demo || null)).catch(() => {}); }, []);
  useEffect(ready, [ready]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const [uploadNow, setUploadNow] = useState<File[] | null>(file ? [file] : null);
  // Nov 21 (keyboard pass): focus goes into the scanner and stays there; Escape (above) closes it; focus goes back after
  const box = useRef<HTMLDivElement>(null);
  useModalKeys(box, true);
  const title = spin || mode !== 'photo' ? 'Spin the Bottle' : 'Scan the Bottle';
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={'modal scanner' + (!picked ? ' scanner-pick' : mode === 'photos' ? ' scanner-pbp' : '')} role="dialog" aria-modal="true" aria-label={`${title} · ${name}`}>
        <header className="scanner-head">
          <div><strong>{title}</strong><small>{[name, detail].filter(Boolean).join(' · ')}</small></div>
          <button className="icon-btn scanner-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        {demo && (
          <p className="scanner-demo" role="note">
            <strong>Demo:</strong> photos you save here only last as long as this demo. They’re deleted when it resets.
            {left && (mode === 'photos' && left.cuts != null
              ? <> {left.savesLeft} of {left.saves} saves and {left.cutsLeft} of {left.cuts} cut-outs left (a spin uses 12).</>
              : <> {left.savesLeft} of {left.saves} saves and {left.scansLeft} of {left.scans} photos left.</>)}
          </p>
        )}
        {!picked
          ? <ModePicker mode={mode} setMode={setMode} canPhoto={!!onDone} onStart={() => setPicked(true)} onUpload={(files) => { setUploadNow(files); setPicked(true); }} />
          : mode === 'photos'
            ? <PhotoByPhoto name={name} kind={kind} uploaded={uploadNow} onSaved={(f) => { ready(); onSpin?.(f); }} onCut={demo ? ready : undefined} />
            : <ClassicScan name={name} kind={kind} spin={mode === 'video'} demo={demo} ready={ready} initial={uploadNow?.[0]} onDone={(u) => onDone?.(u)} onSpin={(f) => onSpin?.(f)} />}
      </div>
    </div>
  );
}

/* ---- 1 · Pick a mode (758:1123) ---- */
const MODES: { id: Mode; title: string; line: string; tag?: string; icon: string }[] = [
  { id: 'video', title: 'Record a Spin', line: 'Record 5 seconds while the bottle turns on a lazy Susan. Needs a turntable and a steady phone.', icon: 'record' },
  { id: 'photos', title: 'Photo by Photo', tag: 'New', line: 'Turn the bottle by hand and take 12 photos, one every 30°. No turntable needed.', icon: 'photos' },
  { id: 'photo', title: 'One Photo', line: 'A single photo of the front label. No spin.', icon: 'camera' },
];
const BEFORE: Record<Mode, string> = {
  photos: 'Stand the bottle on the bar, keep your phone in the same spot, and take your hand away before each photo.',
  video: 'Stand the bottle on a lazy Susan, fill the outline, then turn it slowly all the way round. Keep the phone still.',
  photo: 'Stand the bottle up, label facing you, and fill the outline top to bottom. Plain background is best.',
};
function ModeIcon({ icon }: { icon: string }) {
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (icon === 'record') return <svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none" /></svg>;
  if (icon === 'photos') return <svg {...p}><rect x="8" y="3.5" width="11" height="14" rx="2" /><path d="M5 7v11.5A2 2 0 0 0 7 20.5h9" /></svg>;
  return <svg {...p}><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.4" /></svg>;
}
function ModePicker({ mode, setMode, canPhoto, onStart, onUpload }: { mode: Mode; setMode: (m: Mode) => void; canPhoto: boolean; onStart: () => void; onUpload: (f: File[]) => void }) {
  const list = MODES.filter((m) => m.id !== 'photo' || canPhoto);
  const start = { photos: 'Start Photo by Photo', video: 'Start Recording', photo: 'Take One Photo' }[mode];
  const upload = { photos: 'Upload Photos Instead', video: 'Upload a Spin Video', photo: 'Upload a Photo' }[mode];
  const pick = (files: FileList | null) => { if (files?.length) onUpload([...files]); };
  return (
    <div className="scan-modes">
      <div>
        <h2 className="scan-modes-title">How do you want to scan it?</h2>
        <p className="muted scan-modes-line">Works for any bottle, wine or spirit.</p>
      </div>
      <div className="scan-mode-list" role="radiogroup" aria-label="How to scan it">
        {list.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={'scan-mode' + (mode === m.id ? ' on' : '')} onClick={() => setMode(m.id)}>
            <span className="scan-mode-icon"><ModeIcon icon={m.icon} /></span>
            <span className="scan-mode-copy">
              <strong>{m.title}{m.tag && <span className="scan-tag">{m.tag}</span>}</strong>
              <span>{m.line}</span>
            </span>
            <span className="scan-radio" aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="scan-before"><strong>Before you start</strong><p>{BEFORE[mode]}</p></div>
      <div className="scan-modes-actions">
        <button className="btn" onClick={onStart}>{start}</button>
        <label className="btn ghost">{upload}<input type="file" hidden multiple={mode === 'photos'} accept={mode === 'video' ? 'video/*' : 'image/*'} onChange={(e) => { pick(e.target.files); e.target.value = ''; }} /></label>
      </div>
    </div>
  );
}

/* ---- One Photo and Record a Spin (Oct 28 / Oct 31): unchanged, plus the bottle-shaped guide ---- */
function ClassicScan({ name, kind, spin, demo, ready, initial, onDone, onSpin }: { name: string; kind: BottleKind; spin: boolean; demo: boolean; ready: () => void; initial?: File; onDone: (url: string) => void; onSpin: (frames: string[]) => void }) {
  const [step, setStep] = useState<'camera' | 'working' | 'review'>('camera');
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
  const cam = useCamera(step === 'camera');
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sample, setSample] = useState('');
  useEffect(() => { if (demo && !spin) void loadSamples().then(setSamples); }, [demo, spin]);

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
    cam.stop();
    setStep('working'); setError(''); setPreview('');
    setPhoto({ url: URL.createObjectURL(blob), w, h });
    setBox(b);
    setBusy('Reading the photo…');
    try {
      const r = await post('/api/scan', blob);
      setToken(r.token);
      setStep('review');
      if (demo) ready();
      await cut(r.token, b);
    } catch (e) { setError((e as Error).message); setStep('review'); setBusy(''); }
  };
  const trySample = async (x: Sample) => {
    setSample(x.label); setError('');
    try {
      const res = await fetch(x.file);
      if (!res.ok) throw new Error('That sample didn’t load. Try another.');
      await use(await res.blob(), x.w, x.h, x.box);
    } catch (e) { setError((e as Error).message); }
    setSample('');
  };
  const snap = async () => {
    const v = cam.video.current;
    if (!v || !v.videoWidth) return;
    // Nov 22: a real photo (the camera's full resolution) where the browser can take one (ImageCapture: Chrome and
    // Android), as long as it's framed like the preview, so the guide still lines up. Otherwise the preview frame.
    const still = await fullPhoto(v);
    if (still) { void use(still.blob, still.w, still.h, guideFor(still.w, still.h, kind)); return; }
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob((b) => b && void use(b, c.width, c.height, guideFor(c.width, c.height, kind)), 'image/jpeg', 0.92);
  };
  const FRAMES = 24;
  const startSpin = (all: Blob[], w: number, h: number) => { setFrames(all); void use(all[0], w, h, guideFor(w, h, kind)); };
  const recordSpin = async () => {
    const v = cam.video.current; if (!v || !v.videoWidth) return;
    const all: Blob[] = []; let w = 0, h = 0;
    for (let k = 0; k < FRAMES; k++) { setRecording(k + 1); const g = await grabFrom(v); all.push(g.blob); w = g.w; h = g.h; await new Promise((r) => setTimeout(r, 200)); }
    setRecording(0);
    startSpin(all, w, h);
  };
  const uploadSpin = async (f: File | undefined) => {
    if (!f) return;
    setBusy('Reading the video…'); setError('');
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(f);
    try {
      await new Promise<void>((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error('That video didn’t open. Try an MP4 or MOV.')); });
      const all: Blob[] = []; let w = 0, h = 0;
      for (let k = 0; k < FRAMES; k++) { v.currentTime = (v.duration * k) / FRAMES; await new Promise((r) => { v.onseeked = r; }); const g = await grabFrom(v); all.push(g.blob); w = g.w; h = g.h; }
      setBusy(''); cam.stop(); startSpin(all, w, h);
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
      onSpin(r.frames);
    } catch (e) { setError((e as Error).message); setBusy(''); }
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    const img = new Image();
    img.onload = () => void use(f, img.naturalWidth, img.naturalHeight, guideFor(img.naturalWidth, img.naturalHeight, kind));
    img.onerror = () => void use(f, 1000, 1500, [0.3, 0.08, 0.7, 0.92]);
    img.src = URL.createObjectURL(f);
  };
  // A file picked on the mode picker starts here.
  useEffect(() => { if (initial) { if (spin) void uploadSpin(initial); else upload(initial); } }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = async () => {
    setBusy('Saving…'); setError('');
    try { const m = await api<MediaItem>('/api/scan/keep', { method: 'POST', body: { token, name } }); if (demo) ready(); if (m.url) onDone(m.url); }
    catch (e) { setError((e as Error).message); setBusy(''); }
  };
  const retake = () => { setPhoto(null); setPreview(''); setToken(''); setError(''); setFrames([]); setStep('camera'); };
  const changed = !cutBox || cutBox.some((v, i) => Math.abs(v - box[i]) > 0.002);
  const size = cam.size || { w: 1080, h: 1440 };

  return step === 'camera' ? (
    <>
      <div className="scanner-stage">
        {!cam.err ? (
          <div className="scanner-cam" style={{ aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, calc(62vh * ${size.w / size.h}))` }}>
            <video ref={cam.video} playsInline muted />
            <GuideOverlay w={size.w} h={size.h} kind={kind} />
          </div>
        ) : <p className="scanner-note">{cam.err}</p>}
      </div>
      {spin
        ? <p className="muted scanner-tip">Stand the bottle on a lazy Susan, fill the outline, then tap Record and turn it slowly all the way round (about five seconds). Keep the phone still.</p>
        : <p className="muted scanner-tip">Stand the bottle up, label facing you, and fill the outline cap to base. A plain wall behind it is best. Keep windows and bright lights out from behind it: they reflect in the glass.</p>}
      {demo && !spin && samples.length > 0 && (
        <div className="scanner-samples" role="group" aria-label="Try a sample bottle">
          <small className="muted">Try a sample bottle</small>
          <div className="scanner-sample-row">
            {samples.map((x) => (
              <button key={x.file} type="button" className="scanner-sample" disabled={!!sample} onClick={() => void trySample(x)} title={`Photo: ${x.credit}`}>
                <img src={x.thumb} alt="" loading="lazy" />
                <span>{sample === x.label ? 'Opening…' : x.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row scanner-actions">
        {spin
          ? <>
              {!cam.err && <button className="btn" disabled={!!recording || !!busy} onClick={() => void recordSpin()}>{recording ? `Recording… ${recording} of ${FRAMES}` : 'Record the Spin'}</button>}
              <label className="btn ghost">{busy || 'Upload a Spin Video'}<input type="file" accept="video/*" hidden onChange={(e) => void uploadSpin(e.target.files?.[0])} /></label>
            </>
          : <>
              {!cam.err && <button className="btn" onClick={() => void snap()}>Take Photo</button>}
              <label className="btn ghost">Upload a Photo<input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
            </>}
      </div>
    </>
  ) : (
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
  );
}

/* ---- Photo by Photo (758:1182 → 761:1372) ---- */
const N = 12;
const deg = (i: number) => `${i * 30}°`;
const sideOf = (i: number) => (i === 0 ? 'Front label' : i === 6 ? 'Back label' : i === 3 || i === 9 ? 'Side' : '');
type Shot = { blob: Blob; url: string; w: number; h: number; box: Box };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** The box a photo is cut with. From the camera: the guide with a little room (a hand-turned bottle drifts, and a cap
 *  just over the line shouldn't be cut off). Uploaded: the guide's width with room, top to bottom of the photo. */
const camBox = (w: number, h: number, kind: BottleKind): Box => { const [x0, y0, x1, y1] = guideFor(w, h, kind); return [clamp01(x0 - 0.03), clamp01(y0 - 0.05), clamp01(x1 + 0.03), clamp01(y1 + 0.04)]; };
const fileBox = (w: number, h: number, kind: BottleKind): Box => { const [x0, , x1] = guideFor(w, h, kind); return [Math.max(0.03, x0 - 0.08), 0.02, Math.min(0.97, x1 + 0.08), 0.98]; };

/** A top-down dial (760:1202): the bottle from above, you at the bottom, where the label should face for photo `at`. */
function TurnDial({ at, taken }: { at: number; taken: boolean[] }) {
  const cx = 40, cy = 38;
  const pt = (a: number, r: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const arc = (mid: number, r: number, half = 38) => { const [x0, y0] = pt(mid - half, r), [x1, y1] = pt(mid + half, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  // The label starts facing you (straight down) and moves 30° round for each photo.
  const angle = (i: number) => 90 - i * 30;
  const now = angle(at);
  const [ax, ay] = pt(now - 52, 30), [hx, hy] = pt(now - 40, 30);
  return (
    <svg width="80" height="86" viewBox="0 0 80 86" aria-hidden="true">
      {Array.from({ length: N }, (_, j) => { const [x, y] = pt(angle(j), 33); return <circle key={j} cx={x} cy={y} r={taken[j] ? 2 : 1.4} className={taken[j] ? 'dial-dot on' : 'dial-dot'} />; })}
      <circle cx={cx} cy={cy} r="24" className="dial-bottle" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r="8" fill="none" className="dial-neck" />
      {at > 0 && <path d={arc(angle(at - 1), 21.5)} className="dial-label was" strokeWidth="5" fill="none" />}
      <path d={arc(now, 21.5)} className="dial-label" strokeWidth="5" fill="none" />
      {at > 0 && <><path d={`M${ax.toFixed(2)} ${ay.toFixed(2)}L${hx.toFixed(2)} ${hy.toFixed(2)}`} className="dial-turn" strokeWidth="2" strokeLinecap="round" />
        <circle cx={hx} cy={hy} r="2.6" className="dial-turn-head" /></>}
      <rect x="33" y="78" width="14" height="5" rx="1.5" className="dial-you" />
    </svg>
  );
}
/** The shutter (760:1233): a 12-part ring that fills in as photos are taken. */
function Shutter({ done, now, disabled, onClick, label }: { done: boolean[]; now: number; disabled?: boolean; onClick: () => void; label: string }) {
  const seg = (j: number) => {
    const a0 = (-90 + j * 30 + 3) * Math.PI / 180, a1 = (-90 + (j + 1) * 30 - 3) * Math.PI / 180, R = 46, r = 41;
    const p = (a: number, rr: number) => `${(46 + rr * Math.cos(a)).toFixed(2)} ${(46 + rr * Math.sin(a)).toFixed(2)}`;
    return `M${p(a0, R)}A${R} ${R} 0 0 1 ${p(a1, R)}L${p(a1, r)}A${r} ${r} 0 0 0 ${p(a0, r)}Z`;
  };
  return (
    <button type="button" className="pbp-shutter" onClick={onClick} disabled={disabled} aria-label={label}>
      <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
        {Array.from({ length: N }, (_, j) => <path key={j} d={seg(j)} className={done[j] ? 'seg done' : j === now ? 'seg now' : 'seg'} />)}
        <circle cx="46" cy="46" r="35" className="shutter-body" />
        <circle cx="46" cy="46" r="28" fill="none" className="shutter-ring" strokeWidth="2" />
      </svg>
    </button>
  );
}

function PhotoByPhoto({ name, kind, uploaded, onSaved, onCut }: { name: string; kind: BottleKind; uploaded: File[] | null; onSaved: (frames: string[]) => void; onCut?: () => void }) {
  const [shots, setShots] = useState<(Shot | null)[]>(() => Array(N).fill(null));
  const [step, setStep] = useState<'camera' | 'cutting' | 'review'>('camera');
  const [retakeOf, setRetakeOf] = useState<number | null>(null); // retaking one photo (from review or after a failed cut)
  const [thumbs, setThumbs] = useState<(string | null)[]>(() => Array(N).fill(null));
  const [cutting, setCutting] = useState(-1);
  const [frames, setFrames] = useState<string[]>([]);
  const [odd, setOdd] = useState<number[]>([]); // photos whose cut-out doesn't look like the rest
  const [sel, setSel] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const token = useRef('');
  const stopCut = useRef(false);
  const cam = useCamera(step === 'camera');
  const taken = shots.filter(Boolean).length;
  const at = retakeOf ?? shots.findIndex((s) => !s); // the photo to take now (-1: all 12 taken)
  const size = cam.size || { w: 1080, h: 1440 };

  /** Cut out the photos that don't have a cut-out yet, one at a time; then line them up and review. */
  const thumbsRef = useRef<(string | null)[]>(Array(N).fill(null));
  const cutAll = useCallback(async (list: (Shot | null)[], only?: number) => {
    setStep('cutting'); setError(''); stopCut.current = false;
    for (let i = 0; i < N; i++) {
      if (only != null && i !== only) continue;
      const s = list[i];
      if (!s) continue;
      if (only == null && thumbsRef.current[i]) continue;
      if (stopCut.current) return;
      setCutting(i);
      try {
        const q = `/api/scan/photos?i=${i}&box=${s.box.map((v) => v.toFixed(4)).join(',')}${token.current ? `&token=${token.current}` : ''}`;
        const r = await post(q, s.blob) as { token: string; thumb: string };
        token.current = r.token;
        thumbsRef.current = thumbsRef.current.map((t, k) => (k === i ? r.thumb : t));
        setThumbs(thumbsRef.current);
        onCut?.();
      } catch (e) {
        setCutting(-1);
        setError(`Photo ${i + 1}: ${(e as Error).message}`);
        if (/expired/i.test((e as Error).message)) { token.current = ''; thumbsRef.current = Array(N).fill(null); setThumbs(thumbsRef.current); }
        setRetakeOf(i); setStep('camera');
        return;
      }
    }
    setCutting(-1);
    if (stopCut.current) return;
    setBusy('Lining them up…');
    try {
      const r = await api<{ frames: string[]; odd?: number[] }>('/api/scan/photos/align', { method: 'POST', body: { token: token.current } });
      setFrames(r.frames); setOdd(r.odd || []); setPlaying(true); setStep('review');
      if (r.odd?.length) { setSel(r.odd[0]); setPlaying(false); }
    } catch (e) { setError((e as Error).message); setStep('camera'); }
    setBusy('');
  }, [onCut]);

  /** Keep a photo at `i`: the 12th starts the cutting; a retake cuts just that one. */
  const keepShot = (i: number, s: Shot) => {
    const next = shots.map((x, k) => (k === i ? s : x));
    if (shots[i]) URL.revokeObjectURL(shots[i]!.url);
    setShots(next);
    thumbsRef.current = thumbsRef.current.map((t, k) => (k === i ? null : t)); setThumbs(thumbsRef.current);
    const wasRetake = retakeOf != null;
    setRetakeOf(null);
    if (next.every(Boolean)) void cutAll(next, wasRetake && frames.length ? i : undefined);
  };
  const snap = async () => {
    const v = cam.video.current;
    if (!v || !v.videoWidth || at < 0) return;
    const g = (await fullPhoto(v)) || await grabFrom(v, 2400, 0.9); // Nov 22: the full photo where the browser gives one
    keepShot(at, { ...g, url: URL.createObjectURL(g.blob), box: camBox(g.w, g.h, kind) });
  };
  const retakeLast = () => {
    const last = shots.map(Boolean).lastIndexOf(true);
    if (last < 0) return;
    URL.revokeObjectURL(shots[last]!.url);
    setShots(shots.map((x, k) => (k === last ? null : x)));
    thumbsRef.current = thumbsRef.current.map((t, k) => (k === last ? null : t)); setThumbs(thumbsRef.current);
  };
  /** Upload Photos Instead: 12 photos, in order (front first, then each 30° turn). */
  useEffect(() => {
    if (!uploaded) return;
    if (uploaded.length !== N) { setError(`Pick ${N} photos: the front first, then one for each 30° turn. You picked ${uploaded.length}.`); return; }
    const files = [...uploaded].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.lastModified - b.lastModified);
    void (async () => {
      setBusy('Reading the photos…');
      const list: Shot[] = [];
      for (const f of files) { const g = await shrink(f); list.push({ ...g, url: URL.createObjectURL(g.blob), box: fileBox(g.w, g.h, kind) }); }
      setBusy('');
      setShots(list);
      void cutAll(list);
    })();
  }, [uploaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const startOver = () => {
    if (token.current) void api('/api/scan/photos/drop', { method: 'POST', body: { token: token.current } }).catch(() => {});
    token.current = ''; shots.forEach((s) => s && URL.revokeObjectURL(s.url));
    setShots(Array(N).fill(null)); thumbsRef.current = Array(N).fill(null); setThumbs(thumbsRef.current);
    setFrames([]); setRetakeOf(null); setError(''); setSel(0); setStep('camera');
  };
  const useSpin = async () => {
    setBusy('Saving the spin…'); setError('');
    try { const r = await api<{ frames: string[] }>('/api/scan/photos/keep', { method: 'POST', body: { token: token.current, name } }); token.current = ''; onSaved(r.frames); }
    catch (e) { setError((e as Error).message); }
    setBusy('');
  };
  const done = useMemo(() => shots.map(Boolean), [shots]);
  const ghost = at >= 0 ? (retakeOf != null ? shots[(retakeOf + N - 1) % N] || shots[(retakeOf + 1) % N] : at > 0 ? shots[at - 1] : null) : null;

  if (step === 'cutting') {
    const n = thumbs.filter(Boolean).length;
    return (
      <div className="pbp">
        <div>
          <h2 className="pbp-title">Cutting out {N} photos…</h2>
          <p className="pbp-count" role="status">{busy || `${n} of ${N} done`}</p>
          <div className="pbp-bar" aria-hidden="true"><span style={{ width: `${(n / N) * 100}%` }} /></div>
        </div>
        <div className="pbp-grid">
          {shots.map((s, i) => (
            <div key={i} className={'pbp-cell' + (thumbs[i] ? ' done' : i === cutting ? ' now' : ' wait')}>
              {thumbs[i] ? <img src={thumbs[i]!} alt={`Photo ${i + 1}, cut out`} /> : s ? <img src={s.url} alt="" /> : null}
              {thumbs[i] && <span className="pbp-check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>}
              {i === cutting && <span className="pbp-spinner" aria-hidden="true" />}
            </div>
          ))}
        </div>
        <div className="scan-before"><strong>Each photo gets its own cut-out</strong><p>So your hand between photos and small moves don’t matter. Then they’re lined up: centred, same height, base on one line.</p></div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn ghost pbp-wide" onClick={() => { stopCut.current = true; setCutting(-1); setStep('camera'); }}>Cancel</button>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="pbp pbp-review">
        <div className="pbp-player">
          <SpinViewer frames={frames} alt={`${name}, the spin`} play={playing} frame={playing ? undefined : sel} onFrame={setShown} className="pbp-spin" />
          <span className="pbp-pill" aria-live="off">{playing ? 'Playing' : 'Paused'} · {deg(shown)}</span>
          <button type="button" className="pbp-pause" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause the spin' : 'Play the spin'}>
            {playing
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg>}
          </button>
        </div>
        <div className="pbp-strip-head"><strong>Your {N} photos</strong><small className="muted">Tap one to retake it</small></div>
        <div className="pbp-strip" role="listbox" aria-label={`Your ${N} photos`}>
          {frames.map((f, i) => (
            <button key={f} type="button" role="option" aria-selected={!playing && sel === i} aria-label={`Photo ${i + 1}, ${deg(i)}${odd.includes(i) ? ', doesn’t look like the others' : ''}`}
              className={'pbp-frame' + (!playing && sel === i ? ' on' : '') + (odd.includes(i) ? ' odd' : '')} onClick={() => { setSel(i); setPlaying(false); }}>
              <img src={f} alt="" /><span>{deg(i)}</span>{odd.includes(i) && <i className="pbp-odd" aria-hidden="true">!</i>}
            </button>
          ))}
        </div>
        {odd.length > 0 && <p className="pbp-warn" role="status">{odd.length === 1 ? `Photo ${odd[0] + 1} doesn’t look like the others. Retake it so the spin doesn’t jump.` : `Photos ${odd.map((i) => i + 1).join(', ')} don’t look like the others. Retake them so the spin doesn’t jump.`}</p>}
        <div className="pbp-picked">
          <div><strong>Photo {sel + 1} · {deg(sel)}</strong>{sideOf(sel) && <small className="muted">{sideOf(sel)}</small>}</div>
          <button className="btn ghost" disabled={!!busy} onClick={() => { setRetakeOf(sel); setError(''); setStep('camera'); }}>Retake This Photo</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="pbp-final">
          <button className="btn ghost" disabled={!!busy} onClick={startOver}>Start Over</button>
          <button className="btn" disabled={!!busy} onClick={() => void useSpin()}>{busy || 'Use This Spin'}</button>
        </div>
      </div>
    );
  }

  // The camera: photo `at` of 12, the last photo as a ghost, the dial, the shutter.
  const n = at < 0 ? N : at + 1;
  const lastKept = shots.map(Boolean).lastIndexOf(true);
  return (
    <div className="pbp">
      <div className="pbp-stage">
        {!cam.err ? (
          <div className="scanner-cam pbp-cam" style={{ aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, calc(58vh * ${size.w / size.h}))` }}>
            <video ref={cam.video} playsInline muted />
            {ghost && <img className="pbp-ghost" src={ghost.url} alt="" />}
            <GuideOverlay w={size.w} h={size.h} kind={kind} />
            {at >= 0 && <span className="pbp-tag dark">Photo {n} of {N}</span>}
            {ghost && <span className="pbp-tag light">Line it up with the ghost</span>}
            {at >= 0 && (
              <div className="pbp-dial">
                <TurnDial at={at} taken={done} />
                <span>{at === 0 ? 'Label to you' : retakeOf != null ? `Label at ${deg(at)}` : 'Turn about 30°'}</span>
              </div>
            )}
          </div>
        ) : <p className="scanner-note">{cam.err}</p>}
      </div>
      <div className="pbp-copy">
        <h2 className="pbp-title">{at < 0 ? `All ${N} taken` : retakeOf != null ? `Retake photo ${n} of ${N}` : `Photo ${n} of ${N}`}</h2>
        <p className="muted">{at < 0 ? 'Retake the last one, or cut them out.' : at === 0 ? 'Stand the bottle in the guide, label facing you.' : retakeOf != null ? 'Turn the label to where the dial shows, line it up with the ghost, then tap.' : 'Turn the bottle a little, then tap.'}</p>
      </div>
      {(error || busy) && (error ? <p className="error" role="alert">{error}</p> : <p className="muted" role="status">{busy}</p>)}
      <div className="pbp-controls">
        <div className="pbp-side">
          {retakeOf != null && frames.length
            ? <button className="btn ghost" onClick={() => { setRetakeOf(null); setError(''); setStep('review'); }}>Back</button>
            : <button className="btn ghost" disabled={!taken} onClick={retakeLast}>Retake Last</button>}
          {retakeOf == null && <small className="muted">{lastKept >= 0 ? `Photo ${lastKept + 1} kept` : ' '}</small>}
        </div>
        {at < 0
          ? <button className="btn pbp-go" onClick={() => void cutAll(shots)}>Cut Out {N} Photos</button>
          : <Shutter done={done} now={at} disabled={!!cam.err || !cam.size} onClick={() => void snap()} label={`Take photo ${n} of ${N}`} />}
        <div className="pbp-side right"><span className="pbp-taken">{taken} of {N} taken</span></div>
      </div>
      {cam.err && (
        <label className="btn ghost pbp-wide">Upload Photos Instead
          <input type="file" hidden multiple accept="image/*" onChange={(e) => { const f = e.target.files; if (f?.length === N) { const list = [...f]; e.target.value = ''; void (async () => { const all: Shot[] = []; for (const x of list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) { const g = await shrink(x); all.push({ ...g, url: URL.createObjectURL(g.blob), box: fileBox(g.w, g.h, kind) }); } setShots(all); void cutAll(all); })(); } else if (f?.length) setError(`Pick ${N} photos: the front first, then one for each 30° turn. You picked ${f.length}.`); }} />
        </label>
      )}
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

/* ---- Admin → Bottle Scanner (771:1303 / 771:1696): every wine and every back-bar bottle, one list per tab ---- */
type Entry = { id: number; slug: string; data: { name?: string; grape?: string; region?: string; spirit?: string; styles?: string[]; tier?: string; price?: string; bottle_img?: string; spin?: string[]; source?: string } };
type Tab = 'wine' | 'shelf';
type Show = 'all' | 'scanned' | 'spin' | 'none';
const FILLER: Record<Tab, string> = { wine: '/img/wine-bottle-filler.jpg', shelf: '/img/spirit-bottle-filler.jpg' };
const kindOf = (e: Entry): Exclude<Show, 'all'> => ((e.data.spin?.length || 0) > 1 ? 'spin' : e.data.bottle_img ? 'scanned' : 'none');
/** When a scan was made: from its file name (the scanner names files by the time, base 36), or the wine's Source line. */
function whenOf(url: string | undefined, source?: string): string {
  const m = /\/(?:[a-f0-9]{12}-)?([0-9a-z]{7,9})-(?:bottle|spin)-[^/]*$/.exec(url || '');
  const t = m ? parseInt(m[1], 36) : NaN;
  if (Number.isFinite(t) && t > 1.6e12 && t < 4e12) return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (source || '').replace(/^Scanned\s*/, '').replace(/,\s*\d{4}$/, '');
}
const lineOf = (tab: Tab, e: Entry) => tab === 'wine'
  ? [e.data.grape, e.data.region].filter(Boolean).join(' · ')
  : [(e.data.styles || [])[0] || e.data.spirit, e.data.tier, e.data.price ? `$${String(e.data.price).replace(/^\$/, '')}` : ''].filter(Boolean).join(' · ');

export function BottleScannerPage() {
  const [tab, setTab] = useState<Tab>('wine');
  const [lists, setLists] = useState<Record<Tab, Entry[] | null>>({ wine: null, shelf: null });
  const [error, setError] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [open, setOpen] = useState<{ e: Entry; tab: Tab; spin: boolean } | null>(null);
  useEffect(() => {
    for (const t of ['wine', 'shelf'] as Tab[]) api<{ entries: Entry[] }>(`/api/entries?collection=${t}`).then((r) => setLists((l) => ({ ...l, [t]: r.entries }))).catch((e) => setError(e.message));
  }, []);
  const items = lists[tab];
  /** The same scanner for both; only where the result is saved differs (a wine also gets its Source line). */
  const save = async (tb: Tab, e: Entry, patch: Partial<Entry['data']>) => {
    setOpen(null);
    try {
      const full = await api<Entry>(`/api/entries/${e.id}`);
      const data = { ...full.data, ...patch };
      if (tb === 'wine' && patch.bottle_img) data.source = `Scanned ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      const saved = await api<Entry>(`/api/entries/${e.id}`, { method: 'PUT', body: { data } });
      setLists((l) => ({ ...l, [tb]: l[tb] && l[tb]!.map((x) => (x.id === e.id ? saved : x)) }));
    } catch (err) { setError((err as Error).message); }
  };
  const count = (k: Show) => (items || []).filter((e) => k === 'all' || kindOf(e) === k).length;
  const list = (items || []).filter((e) => show === 'all' || kindOf(e) === show);
  const withPhoto = (items || []).filter((e) => kindOf(e) !== 'none').length;
  return (
    <div className="admin-page scan-page">
      <div className="editor-head">
        <div>
          <h1>Bottle Scanner</h1>
          <p className="muted">Take a photo of a bottle, or 12 photos for a spin, and the scanner cuts out just the bottle on the Wine Book beige. It goes straight onto that bottle’s page. Works for wine and spirits.</p>
        </div>
        <span className="scan-head-side">
          {items && <span className="admin-pill">{withPhoto} of {items.length} have a photo</span>}
          {/* Nov 25 (Figma 47 · 963:2443): Add a Bottle, for one we don't have on the list yet */}
          <AddBottleButton kind={tab === 'wine' ? 'wine' : 'spirit'} className="btn primary add-bottle-btn" />
        </span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="scan-tabs" role="tablist" aria-label="Bottles">
        {([['wine', 'Wine'], ['shelf', 'Spirits']] as const).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={'scan-tab' + (tab === t ? ' on' : '')} onClick={() => { setTab(t); setShow('all'); }}>
            {l} {lists[t] ? lists[t]!.length : ''}
          </button>
        ))}
      </div>
      {items && (
        <div className="row chip-row" role="group" aria-label="Show">
          {([['all', 'All'], ['scanned', 'Scanned'], ['spin', 'Spin'], ['none', 'No Photo']] as const).map(([k, l]) => (
            <button key={k} aria-pressed={show === k} className={'chip' + (show === k ? ' on' : '')} onClick={() => setShow(k)}>{l} {count(k)}</button>
          ))}
        </div>
      )}
      {!items && !error && <p className="muted">Loading…</p>}
      {items && !list.length && <p className="muted">{items.length ? 'Nothing here with that filter.' : tab === 'wine' ? 'No wines on the list yet. Add them under Wine List.' : 'No bottles on the back bar yet. Add them under Back Bar.'}</p>}
      {list.length > 0 && (
        <ul className="scan-list">
          {list.map((e) => {
            const k = kindOf(e);
            const img = k === 'spin' ? e.data.spin![0] : e.data.bottle_img || FILLER[tab];
            return (
              <li key={e.id} className="scan-row">
                <span className={'scan-row-thumb' + (k === 'none' ? ' filler' : '')}>
                  <img src={img} alt="" loading="lazy" />
                  {k === 'spin' && <span className="scan-360">360°</span>}
                </span>
                <span className="scan-row-copy">
                  <strong>{e.data.name}</strong>
                  <small className="muted">{lineOf(tab, e)}</small>
                </span>
                <small className={'scan-src scan-row-status ' + k}>{k === 'spin' ? `Spin · ${e.data.spin!.length} photos · ${whenOf(e.data.spin![0])}` : k === 'scanned' ? `Scanned ${whenOf(e.data.bottle_img, e.data.source)}`.trim() : 'No photo yet'}</small>
                <span className="scan-row-actions">
                  <button className="btn ghost" onClick={() => setOpen({ e, tab, spin: false })}>Scan Bottle</button>
                  <button className={'btn' + (k === 'none' ? '' : ' ghost')} onClick={() => setOpen({ e, tab, spin: true })}>{k === 'spin' ? 'Spin Again' : 'Make a Spin'}</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <BottleScanner name={open.e.data.name || 'Bottle'} detail={open.tab === 'wine' ? open.e.data.grape : (open.e.data.styles || [])[0] || open.e.data.spirit}
          kind={open.tab === 'wine' ? 'wine' : 'spirit'} spin={open.spin} onClose={() => setOpen(null)}
          onDone={(url) => void save(open.tab, open.e, { bottle_img: url })}
          onSpin={(frames) => void save(open.tab, open.e, { spin: frames })} />
      )}
    </div>
  );
}
