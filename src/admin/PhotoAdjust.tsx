import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { focusVars, parseFocus, withFocus } from '../lib/focus';

// The shapes a photo appears in across the app, so you can see nothing important gets cut off.
const SHAPES = [
  { name: 'Wide', sub: 'Heroes, video', ratio: '16 / 9' },
  { name: 'Square', sub: 'Home, dish page', ratio: '1 / 1' },
  { name: 'Tall', sub: 'Cocktail cards', ratio: '3 / 4' },
  { name: 'Small', sub: 'Lists, search', ratio: '1 / 1', small: true },
];

/** Drag to choose what stays in frame, slide to zoom. The original photo is never changed. */
export function PhotoAdjust({ value, label, onSave, onClose }: { value: string; label: string; onSave: (v: string) => void; onClose: () => void }) {
  const start = parseFocus(value);
  const [x, setX] = useState(start.x);
  const [y, setY] = useState(start.y);
  const [z, setZ] = useState(start.z);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const current = withFocus(start.url, x, y, z);

  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);

  const place = (e: PointerEvent<HTMLDivElement>) => {
    const r = stage.current!.getBoundingClientRect();
    setX(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
    setY(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)));
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    setX((v) => Math.min(100, Math.max(0, v + d[0])));
    setY((v) => Math.min(100, Math.max(0, v + d[1])));
  };

  return createPortal(
    <div className="modal-back adjust-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal adjust" role="dialog" aria-modal="true" aria-label={`Adjust ${label}`}>
        <div className="adjust-head">
          <h2>Adjust Photo</h2>
          <p>Drag to the part that matters most. It stays in frame in every shape.</p>
        </div>
        <div className="adjust-body">
          <div className="adjust-main">
            <div ref={stage} className="adjust-stage" tabIndex={0} role="group" aria-label={`Focus point, ${Math.round(x)}% across and ${Math.round(y)}% down. Use the arrow keys to move it.`}
              onKeyDown={keys}
              onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); place(e); }}
              onPointerMove={(e) => { if (drag.current) place(e); }}
              onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}>
              <img src={start.url} alt="" draggable={false} />
              <span className="adjust-dot" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />
            </div>
            <label className="adjust-zoom">
              <span>Zoom</span>
              <input type="range" min={1} max={3} step={0.05} value={z} onChange={(e) => setZ(Number(e.target.value))} />
              <strong>{z.toFixed(2).replace(/\.?0+$/, '')}×</strong>
            </label>
          </div>
          <div className="adjust-shapes" aria-label="How it looks across the app">
            {SHAPES.map((s) => (
              <div key={s.name} className={'adjust-shape' + (s.small ? ' small' : '')}>
                <div className="f-zoom adjust-preview" style={{ ...focusVars(current), aspectRatio: s.ratio }} />
                <span><strong>{s.name}</strong>{s.sub}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="adjust-foot">
          <button type="button" className="link-btn" onClick={() => { setX(50); setY(50); setZ(1); }}>Reset</button>
          <div className="row">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn" onClick={() => onSave(current)}>Use This Framing</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
