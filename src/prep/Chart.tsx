// Made, used and wasted, by day (Figma 632:985). Plain SVG, sized to its box (no chart library). Each column is the
// batches made in that bucket: used on the bottom, wasted on top, what's still in use faded above; a short dark line marks
// what was used in the same bucket of the period before. Colours are theme roles (--c-data-used, --c-data-wasted), so
// both brands paint the same chart. Hover or focus a column for its numbers; the table below the chart has them all too.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { timeOf, type Bucket } from './data';

const H = 250, TOP = 26, BOTTOM = 40, LEFT = 44, RIGHT = 8, GAP = 2, R = 4;

/** Clean axis steps (1, 2, 2.5, 5 × 10ⁿ), about four of them. */
function niceScale(v: number) {
  if (!(v > 0)) return { max: 1, step: 0.25 };
  const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) as number;
  return { max: Math.ceil(v / step - 1e-9) * step, step };
}
/** A column segment: square at the bottom, 4 px rounded at the top only when it's the top of the column. */
function seg(x: number, y: number, w: number, h: number, round: boolean) {
  if (h <= 0) return '';
  const r = round ? Math.min(R, h, w / 2) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`;
}

export function MadeUsedChart({ data, unit, prevLabel, title }: { data: Bucket[]; unit: string; prevLabel: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(700);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => { if (box.current) setW(box.current.clientWidth || 700); }, []);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 700));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = niceScale(Math.max(...data.map((d) => Math.max(d.used + d.wasted + d.inUse, d.made, d.prevUsed || 0)), 0));
  const max = scale.max;
  const plotW = Math.max(120, w - LEFT - RIGHT), plotH = H - TOP - BOTTOM;
  const band = plotW / data.length;
  const bw = Math.min(28, Math.max(10, band * 0.46));
  const y = (v: number) => TOP + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: Math.round(max / scale.step) + 1 }, (_, i) => Math.round(i * scale.step * 100) / 100);
  const many = data.length > 7;
  const peak = data.reduce((m, d, i) => (d.made > data[m].made ? i : m), 0);
  const fmt = (v: number) => (unit === 'each' ? String(Math.round(v)) : `${Math.round(v * 100) / 100} ${unit}`);
  const tip = hover != null ? data[hover] : null;
  return (
    <div className="prp-chart" ref={box}>
      <svg width={w} height={H} role="group" aria-label={title}>
        <defs>
          <pattern id="prp-inuse" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--c-card)" />
            <rect width="2.4" height="6" fill="var(--c-data-used)" opacity=".45" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={w - RIGHT} y1={y(t)} y2={y(t)} stroke="var(--c-line)" strokeWidth="1" />
            <text x={LEFT - 8} y={y(t) + 4} textAnchor="end" className="prp-axis">{unit === 'each' ? Math.round(t) : `${Math.round(t * 100) / 100} ${unit}`}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = LEFT + band * i + band / 2, x = cx - bw / 2;
          const hU = (d.used / max) * plotH, hW = (d.wasted / max) * plotH, hI = (d.inUse / max) * plotH;
          const segs: { h: number; fill: string; k: string }[] = [{ h: hU, fill: 'var(--c-data-used)', k: 'u' }, { h: hW, fill: 'var(--c-data-wasted)', k: 'w' }, { h: hI, fill: 'url(#prp-inuse)', k: 'i' }].filter((s) => s.h > 0.5);
          let base = TOP + plotH;
          const top = segs.length - 1;
          const label = `${d.label} ${d.sub}: made ${fmt(d.made)}, used ${fmt(d.used)}, wasted ${fmt(d.wasted)}${d.inUse ? `, ${fmt(d.inUse)} still in use` : ''}${d.prevUsed != null ? `, ${prevLabel} used ${fmt(d.prevUsed)}` : ''}${d.ranOut ? `, ran out${d.ranOutAt ? ' at ' + timeOf(d.ranOutAt) : ''}` : ''}`;
          const showCap = d.made > 0 && (!many || i === peak || hover === i);
          return (
            <g key={d.key} tabIndex={0} role="img" aria-label={label} className={'prp-col' + (hover === i ? ' on' : '') + (d.on ? ' picked' : '')}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <rect x={cx - band / 2} y={TOP - 20} width={band} height={plotH + 20} fill="transparent" />
              {segs.map((s, k) => {
                const yTop = base - s.h + (k > 0 ? GAP : 0);
                const out = <path key={s.k} d={seg(x, yTop, bw, s.h - (k > 0 ? GAP : 0), k === top)} fill={s.fill} />;
                base -= s.h;
                return out;
              })}
              {d.prevUsed != null && d.prevUsed > 0 && <line x1={cx - bw / 2 - 7} x2={cx + bw / 2 + 7} y1={y(d.prevUsed)} y2={y(d.prevUsed)} stroke="var(--c-ink)" strokeWidth="2" strokeLinecap="round" />}
              {showCap && <text x={cx} y={y(Math.max(d.used + d.wasted + d.inUse, d.made)) - 8} textAnchor="middle" className="prp-cap">{fmt(d.made)}</text>}
              {d.ranOut > 0 && <g transform={`translate(${cx + bw / 2 + 4}, ${Math.max(TOP, y(d.made) - 2)})`} aria-hidden="true">
                <circle r="8" cx="0" cy="0" fill="var(--c-card)" stroke="var(--c-data-wasted)" strokeWidth="2" />
                <text x="0" y="3.5" textAnchor="middle" className="prp-ranmark">!</text>
              </g>}
              <text x={cx} y={H - BOTTOM + 18} textAnchor="middle" className={'prp-axis x' + (d.on ? ' on' : '')}>{d.label}</text>
            </g>
          );
        })}
      </svg>
      {tip && hover != null && (
        <div className="prp-tip" role="presentation" style={{ left: Math.min(Math.max(8, LEFT + band * hover + band / 2 - 90), w - 188), top: 4 }}>
          <strong>{tip.label} · {tip.sub}</strong>
          <span><i className="sw used" />Used <b>{fmt(tip.used)}</b></span>
          <span><i className="sw wasted" />Wasted <b>{fmt(tip.wasted)}</b></span>
          {tip.inUse > 0 && <span><i className="sw inuse" />Still in use <b>{fmt(tip.inUse)}</b></span>}
          <span className="tot">Made <b>{fmt(tip.made)}</b></span>
          {tip.prevUsed != null && <span><i className="sw prev" />{prevLabel} used <b>{fmt(tip.prevUsed)}</b></span>}
          {tip.ranOut > 0 && <span className="ran">Ran out{tip.ranOutAt ? ` ${timeOf(tip.ranOutAt)}` : ''}</span>}
        </div>
      )}
    </div>
  );
}

/** Busiest days: batches made per weekday (horizontal bars, one series, the busiest one in the used colour). */
export function BusiestDays({ data }: { data: { dow: number; label: string; batches: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.batches));
  const top = data.reduce((m, d) => (d.batches > m.batches ? d : m), data[0]);
  return (
    <ul className="prp-busy" aria-label="Batches made per day, average of the last 4 weeks">
      {data.map((d) => (
        <li key={d.dow}>
          <span className="lbl">{d.label}</span>
          <span className="track"><span className={'bar' + (d === top ? ' top' : '')} style={{ width: `${(d.batches / max) * 100}%` }} /></span>
          <span className="val">{Math.round(d.batches * 10) / 10}</span>
        </li>
      ))}
    </ul>
  );
}

