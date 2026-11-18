// A bottle you can spin (Oct 31): frames from the spin scanner, swapped as you drag left and right. Left and right only,
// never up or down (Tommy, Nov 17: "rotate on a vertical axis"); a vertical swipe still scrolls the page (touch-action).
// Nov 18 (Figma 09 · Proposals → 34, 762:1191): a light crossfade between frames, and on a bottle panel (`panel`) a
// "360°" chip in the corner and "‹ Drag to spin ›" at the bottom. One slow turn on first view; reduced motion: no turn
// and no fade. The review screen of Photo by Photo plays it on a loop (`play`) and picks a frame (`frame`).
import { useEffect, useRef, useState, type CSSProperties } from 'react';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function SpinViewer({ frames, alt = 'Bottle', style, className = '', panel = false, play = false, frame, onFrame }: {
  frames: string[]; alt?: string; style?: CSSProperties; className?: string;
  /** Fills a bottle panel: room round the bottle, the 360° chip and the drag hint. */
  panel?: boolean;
  /** Keep turning (the review screen), until it's dragged or `play` goes false. */
  play?: boolean;
  /** Show this frame (the review's filmstrip). */
  frame?: number;
  /** Which frame is showing. */
  onFrame?: (i: number) => void;
}) {
  const [i, setRaw] = useState(0);
  const [prev, setPrev] = useState<{ i: number; k: number } | null>(null);
  const [touched, setTouched] = useState(false);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cur = useRef(0);
  const n = frames.length;
  const fade = !reduced();
  const setI = (v: number) => {
    if (v === cur.current) return;
    if (fade) setPrev((p) => ({ i: cur.current, k: (p?.k || 0) + 1 }));
    cur.current = v; setRaw(v); onFrame?.(v);
  };
  // Load every frame up front so spinning never flickers.
  useEffect(() => { for (const f of frames) { const im = new Image(); im.src = f; } }, [frames]);
  // One slow turn when it first appears (about 1.6 s whatever the frame count), so people see it spins.
  useEffect(() => {
    if (n < 2 || play || reduced()) return;
    let k = 0; const t = window.setInterval(() => { k += 1; if (k > n) { window.clearInterval(t); return; } setI(k % n); }, Math.max(70, 1600 / n));
    return () => window.clearInterval(t);
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  // The review: round and round until paused.
  useEffect(() => {
    if (!play || n < 2) return;
    const t = window.setInterval(() => { if (!drag.current) setI((cur.current + 1) % n); }, 160);
    return () => window.clearInterval(t);
  }, [play, n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (frame != null && frame >= 0 && frame < n) setI(frame); }, [frame]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (d: number) => setI(((cur.current + d) % n + n) % n);
  const per = () => Math.max(6, (box.current?.clientWidth || 240) / n / 1.2);
  return (
    <div ref={box} className={'spin ' + (panel ? 'spin-panel ' : '') + className} style={style} role="img" aria-label={`${alt}. Drag left or right, or use the arrow keys, to turn it.`} tabIndex={0}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, start: cur.current }; setTouched(true); }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; const k = Math.round((e.clientX - d.x) / per()); setI(((d.start - k) % n + n) % n); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); step(1); setTouched(true); } if (e.key === 'ArrowRight') { e.preventDefault(); step(-1); setTouched(true); } }}>
      <img src={frames[i]} alt="" draggable={false} />
      {prev && prev.i !== i && <img key={prev.k} className="spin-fade" src={frames[prev.i]} alt="" draggable={false} onAnimationEnd={() => setPrev(null)} />}
      {panel && <span className="spin-chip" aria-hidden="true">360°</span>}
      {!touched && (
        <span className="spin-hint" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          Drag to spin
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </span>
      )}
    </div>
  );
}
