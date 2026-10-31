// A bottle you can spin (Oct 31): frames from the spin scanner, swapped as you drag left and right.
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export function SpinViewer({ frames, alt = 'Bottle', style, className = '' }: { frames: string[]; alt?: string; style?: CSSProperties; className?: string }) {
  const [i, setI] = useState(0);
  const [touched, setTouched] = useState(false);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const n = frames.length;
  // Load every frame up front so spinning never flickers.
  useEffect(() => { for (const f of frames) { const im = new Image(); im.src = f; } }, [frames]);
  // One slow turn when it first appears, so people see it spins (not with reduced motion).
  useEffect(() => {
    if (n < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let k = 0; const t = window.setInterval(() => { k += 1; if (k > n) { window.clearInterval(t); return; } setI(k % n); }, 70);
    return () => window.clearInterval(t);
  }, [n]);
  const step = (d: number) => setI((v) => ((v + d) % n + n) % n);
  const per = () => Math.max(6, (box.current?.clientWidth || 240) / n / 1.2);
  return (
    <div ref={box} className={'spin ' + className} style={style} role="img" aria-label={`${alt}. Drag or use the arrow keys to turn it.`} tabIndex={0}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, start: i }; setTouched(true); }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; const k = Math.round((e.clientX - d.x) / per()); setI(((d.start - k) % n + n) % n); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); step(1); setTouched(true); } if (e.key === 'ArrowRight') { e.preventDefault(); step(-1); setTouched(true); } }}>
      <img src={frames[i]} alt="" draggable={false} />
      {!touched && <span className="spin-hint" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2" /><path d="M18.5 2v4h-4M5.5 22v-4h4" /></svg>Drag to spin</span>}
    </div>
  );
}
