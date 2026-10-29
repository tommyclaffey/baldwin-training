import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import svgs from '../content/svgs.json';
import { SearchBox } from './SearchBox';
import { VideoEmbed } from './VideoEmbed';
import type { Video } from '../lib/api';
import { AssignName, TableFinder, TableMarker, controlProps, isActive, useInteract, visibleKids, type Meta } from './interact';

// One node of the Figma layout export (see scripts/build-content.mjs).
export type FNode = {
  t: 'F' | 'T' | 'R' | 'E' | 'S';
  n?: string; w: number; h: number; x?: number; y?: number; abs?: 1;
  lab?: string; empty?: 1; hdr?: 1; // table cells: column label, an empty allergen cell, the header row (phones stack rows)
  sh?: 'F' | 'H' | 'L'; sv?: 'F' | 'H' | 'L';
  op?: number; rot?: number; to?: string; svg?: string;
  f?: { c?: string; o?: number; img?: string; m?: string; g?: [string, number, number][]; gt?: string; ga?: number }[];
  st?: string; sto?: number; sw?: number; sws?: number[]; dash?: 1; sa?: string;
  r?: number; rs?: number[];
  s?: string; ff?: string; fs?: string; z?: number; lh?: string | number; ls?: string | number; ta?: string; ar?: string;
  segs?: [number, number, string, string | null][];
  clip?: 1; lm?: 'H' | 'V'; gap?: number; pd?: number[]; pa?: string; ca?: string; wrap?: 1; cg?: number;
  c?: FNode[];
  vid?: Video;
  /** Two-column row (Left / Right) that moves short right-hand cards across to even out the columns. */
  bal?: 1;
  /** A control or filtered layer (see server/interact.mjs). */
  meta?: Meta;
};

const isVideoSlot = (n: FNode) => !!n.n && (n.n.startsWith('Video slot') || n.n === 'Player');
const isVideoCard = (n: FNode) => !!n.n && (n.n.startsWith('Video · ') || n.n.startsWith('Item · ') || n.n.startsWith('Wine · '));

/** Live parts of a page: a layer with this name is replaced by the component (e.g. the quiz card). */
export type Slot = (p: { style: CSSProperties; className: string }) => ReactNode;
export const SlotContext = createContext<Record<string, Slot>>({});

/** Which sidebar item is active, so the shared sidebar can highlight it. */
export const NavContext = createContext<string>('Home');
/** True on phones, where rows reflow instead of the page scaling. */
export const CompactContext = createContext(false);
/** How much a phone has shrunk the frame we're inside (1 = not shrunk). Text never drops below 11px on screen. */
const ScaleContext = createContext(1);

/** Scales a fixed-layout frame (absolute children) down to fit a narrow column. */
function Scaled({ w, h, outer, children }: { w: number; h: number; outer: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(Math.min(w >= 300 ? 1.25 : 1, el.clientWidth / w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div ref={ref} style={{ ...outer, width: '100%', maxWidth: w >= 300 ? w * 1.25 : w, height: h * k, position: 'relative' }}>
      <div style={{ width: w, height: h, transform: `scale(${k})`, transformOrigin: 'top left' }}><ScaleContext.Provider value={k}>{children}</ScaleContext.Provider></div>
    </div>
  );
}

const SVGS = svgs as Record<string, string>;
const WEIGHT: Record<string, number> = { Regular: 400, Italic: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800 };
const JUSTIFY: Record<string, string> = { C: 'center', M: 'flex-end', S: 'space-between' };
const ALIGN: Record<string, string> = { C: 'center', M: 'flex-end', B: 'baseline' };

function rgba(hex: string, a = 1) {
  if (a >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function background(node: FNode, st: CSSProperties) {
  if (!node.f) return;
  const images: string[] = [];
  const sizes: string[] = [];
  for (const f of node.f) {
    if (f.img) {
      images.push(`url("${f.img}")`);
      sizes.push(f.m === 'FIT' ? 'contain' : f.m === 'TILE' ? 'auto' : 'cover');
    } else if (f.g) {
      const stops = f.g.map(([c, a, p]) => `${rgba(c, a)} ${Math.round(p * 100)}%`).join(', ');
      images.push(f.gt === 'GRADIENT_RADIAL' ? `radial-gradient(${stops})` : `linear-gradient(${f.ga ?? 180}deg, ${stops})`);
      sizes.push('cover');
    } else if (f.c) {
      st.backgroundColor = rgba(f.c, f.o ?? 1);
    }
  }
  if (images.length) {
    st.backgroundImage = images.reverse().join(', ');
    st.backgroundSize = sizes.reverse().join(', ');
    st.backgroundPosition = 'center';
    st.backgroundRepeat = 'no-repeat';
  }
}

function boxStyle(node: FNode, parentLm: 'H' | 'V' | undefined, parentH?: number): { st: CSSProperties; cls: string[] } {
  const st: CSSProperties = {};
  const cls: string[] = ['fn'];
  const inFlow = parentLm && !node.abs;
  if (!inFlow) {
    // Absolutely placed inside a fixed-layout frame (or the root).
    if (parentLm !== undefined || node.x !== undefined) {
      st.position = 'absolute';
      st.left = node.x;
      st.top = node.y;
    }
    st.width = node.w;
    st.height = node.t === 'T' ? undefined : node.h;
  } else if (parentLm === 'H') {
    if (node.sh === 'L') { st.flex = '1 1 0'; st.minWidth = 0; cls.push('fill-h'); }
    else if (node.sh === 'F') { st.width = node.w; st.flexShrink = node.w > 140 ? 1 : 0; if (node.w > 220) cls.push('wide'); }
    else st.flex = '0 0 auto';
    // Full-height children (e.g. a hero photo) stretch with the row if it grows.
    if (node.sv === 'F' && parentH && node.h >= parentH - 1) { st.alignSelf = 'stretch'; st.minHeight = node.h; }
    else if (node.sv === 'F') { if (node.lm) st.minHeight = node.h; else st.height = node.h; }
    else if (node.sv === 'L') st.alignSelf = 'stretch';
  } else {
    if (node.sh === 'F') { st.width = node.w; st.maxWidth = '100%'; if (node.w > 220) cls.push('wide'); }
    else if (node.sh === 'L') st.alignSelf = 'stretch';
    // Auto-layout boxes with a set height may grow a little if the browser's text runs taller than Figma's.
    if (node.sv === 'F') { if (node.lm) st.minHeight = node.h; else st.height = node.h; st.flexShrink = 0; }
    else if (node.sv === 'L') st.flex = '1 1 0';
    // Hug-height boxes never shrink below their content (clipped boxes otherwise lose their minimum height).
    else st.flexShrink = 0;
  }
  // Phone helpers: mid-width tiles pair up; small leading markers stay beside their text.
  if (inFlow && parentLm === 'H' && node.t !== 'T' && node.sh === 'F' && node.w >= 150 && node.w <= 300) cls.push('mid');
  // A big hug-width card (e.g. a video card) takes the full width once a phone wraps its row.
  if (inFlow && parentLm === 'H' && node.t !== 'T' && node.sh !== 'F' && node.w >= 300) cls.push('big');
  // (a narrow rail, e.g. a timeline dot and line, counts too)
  if (inFlow && parentLm === 'H' && ((node.t !== 'T' && node.w <= 48 && node.h >= 6 && (node.h <= 48 || node.w <= 24)) || (node.t === 'T' && node.w <= 20 && node.h <= 24))) cls.push('marker');
  if (node.op !== undefined) st.opacity = node.op;
  if (node.rot) { st.transform = `rotate(${-node.rot}deg)`; st.transformOrigin = 'top left'; }
  return { st, cls };
}

function textNode(node: FNode, parentLm: 'H' | 'V' | undefined, key?: number) {
  const { st, cls } = boxStyle(node, parentLm);
  cls.push('ftext');
  st.fontFamily = node.ff === 'Pinyon Script' ? "'Pinyon Script', cursive" : "'Archivo', system-ui, sans-serif";
  st.fontWeight = WEIGHT[node.fs || 'Regular'] ?? 400;
  if ((node.fs || '').includes('Italic')) st.fontStyle = 'italic';
  st.fontSize = node.z;
  // Big titles shrink to fit a phone (see .ftext.display in styles.css).
  if ((node.z || 0) >= 36) { cls.push('display'); (st as Record<string, unknown>)['--z'] = `${node.z}px`; }
  if (node.lh !== undefined) st.lineHeight = typeof node.lh === 'string' ? Number(node.lh.replace('%', '')) / 100 : `${node.lh}px`;
  else st.lineHeight = node.ff === 'Pinyon Script' ? 1.25 : 1.22;
  if (node.ls !== undefined) st.letterSpacing = typeof node.ls === 'string' ? `${Number(node.ls.replace('%', '')) / 100}em` : `${node.ls}px`;
  if (node.ta) st.textAlign = node.ta === 'C' ? 'center' : node.ta === 'R' ? 'right' : 'justify';
  const fill = node.f && node.f.find((f) => f.c);
  if (fill?.c) st.color = rgba(fill.c, fill.o ?? 1);
  if (node.ar === 'W') { st.whiteSpace = 'pre'; cls.push('nowrap'); st.width = undefined; if (parentLm === 'H') st.flex = '0 0 auto'; }
  else st.whiteSpace = 'pre-wrap';
  if (node.ar === 'H' && parentLm && !node.abs && node.sh !== 'F' && node.sh !== 'L') st.width = node.w;
  let content: ReactNode = node.s;
  if (node.segs && node.s) {
    content = node.segs.map(([a, b, style, color], i) => (
      <span key={i} style={{ fontWeight: WEIGHT[style] ?? undefined, fontStyle: style.includes('Italic') ? 'italic' : undefined, color: color || undefined }}>
        {node.s!.slice(a, b)}
      </span>
    ));
  }
  return { st, cls, content, key };
}

const padX = (n: FNode) => (n.pd ? n.pd[1] + n.pd[3] : 0);
const inFlow = (n: FNode) => (n.c || []).filter((c) => !c.abs);
/** A row whose children fill it edge to edge (so they can share a change in width). */
function packed(n: FNode) {
  const kids = inFlow(n);
  if (n.lm !== 'H' || n.wrap || !kids.length) return false;
  const total = kids.reduce((s, c) => s + c.w, 0) + (n.gap || 0) * (kids.length - 1) + padX(n);
  return Math.abs(total - n.w) <= 4;
}
/** In a packed row, the wider parts (text, columns, tiles) share the change; icons and badges keep their size. */
const shares = (n: FNode, c: FNode) => packed(n) && !c.abs && (c.t === 'F' || c.t === 'T') && c.sh === 'F' && c.w >= 60;
/** In a column, a part that spans its full inner width keeps spanning it. */
function spans(parent: FNode, c: FNode) {
  const inner = parent.w - padX(parent);
  return parent.lm === 'V' && (c.t === 'F' || c.t === 'T') && c.sh === 'F' && !c.abs && inner - c.w >= 0 && inner - c.w <= 4;
}

/** A card at a new width: full-width parts keep spanning it, packed rows share the change. */
function widen(n: FNode, w: number): FNode {
  const grow = w - n.w;
  if (!n.lm || !n.c) return { ...n, w };
  if (n.lm === 'H') {
    const total = n.c.filter((c) => shares(n, c)).reduce((s, c) => s + c.w, 0);
    return { ...n, w, c: n.c.map((c) => (total && shares(n, c) ? widen(c, c.w + (grow * c.w) / total) : c)) };
  }
  return { ...n, w, c: n.c.map((c) => (spans(n, c) ? widen(c, c.w + grow) : c)) };
}

/** The narrowest a card can go before something inside it overflows (fixed-size parts stay fixed). */
function minWidth(n: FNode): number {
  if (!n.lm || !n.c) return n.t === 'T' ? 80 : n.w;
  const kids = inFlow(n);
  if (!kids.length) return padX(n);
  const need = kids.map((c) => (c.sh === 'L' || spans(n, c) || shares(n, c) ? minWidth(c) : c.w));
  if (n.lm === 'H' && !n.wrap) return need.reduce((s, x) => s + x, 0) + (n.gap || 0) * (need.length - 1) + padX(n);
  return Math.max(...need) + padX(n);
}

/** Right-hand cards that read fine full width in the left column. */
const TO_LEFT = ['What’s in it', 'Say it', 'Back to parent', 'Good to know'];
/** Where each original card sits: column (0 left, 1 right) and its original index in its home column. */
type Card = { home: 0 | 1; i: number };
type Layout = [Card[], Card[]];
type Bal = { for: FNode; layout: Layout; best: { layout: Layout; gap: number }; pass: number; done: boolean };

const start = (cols: FNode[]): Layout => [(cols[0].c || []).map((_, i) => ({ home: 0, i })), (cols[1].c || []).map((_, i) => ({ home: 1, i }))];

/**
 * A two-column row. After it renders, the columns are measured; if one runs much longer, the mix of its cards
 * that should leave the smallest gap moves to the end of the other column (at that column's width). It then
 * measures again, up to 3 passes, and keeps the best layout it saw. Cards only move if nothing inside them
 * would overflow at the new width. The first card of each column stays put.
 */
function Balanced({ node, parentLm, parentH }: { node: FNode; parentLm?: 'H' | 'V'; parentH?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const compact = useContext(CompactContext);
  const [st, setSt] = useState<Bal | null>(null);
  const cols = node.c || [];
  const layout = !compact && st?.for === node ? st.layout : null;

  useLayoutEffect(() => {
    if (compact || cols.length !== 2 || (st?.for === node && st.done)) return;
    const row = ref.current?.firstElementChild;
    const els = row ? [row.children[0], row.children[1]] : [];
    if (!els[0] || !els[1]) return;
    const cur = st?.for === node ? st.layout : start(cols);
    const bottom = (el: Element) => [...el.children].reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), 0) - el.getBoundingClientRect().top;
    const diff = bottom(els[1]) - bottom(els[0]); // > 0: the right column runs longer
    const gap0 = Math.abs(diff);
    const k = els[0].getBoundingClientRect().width / cols[0].w;
    const best = !st || st.for !== node || gap0 < st.best.gap ? { layout: cur, gap: gap0 } : st.best;
    const pass = st?.for === node ? st.pass + 1 : 1;
    const finish = () => setSt({ for: node, layout: best.layout, best, pass, done: true });
    if (gap0 <= 60 * k || pass > 3) return finish();

    const from: 0 | 1 = diff > 0 ? 1 : 0;
    const to = cols[1 - from];
    const step = ((cols[0].gap || 0) + (cols[1].gap || 0)) * k;
    const ratio = from === 0 ? (cols[0].w / cols[1].w) ** 0.6 : 0.85; // narrower = taller
    const cards = cur[from].map((card, j) => ({ card, j, n: cols[card.home].c![card.i], h: els[from].children[j]?.getBoundingClientRect().height || 0 }))
      .filter(({ j, n, card }) => j > 0 && (from === 1 ? card.home === 0 || TO_LEFT.includes(n.n || '') : minWidth(n) <= to.w));
    let pick: typeof cards = [];
    let bestEst = gap0;
    for (let mask = 1; mask < 1 << cards.length && cards.length <= 8; mask++) {
      const p = cards.filter((_, j) => mask & (1 << j));
      const est = Math.abs(gap0 - p.reduce((s, c) => s + c.h * (1 + ratio) + step, 0));
      if (est < bestEst - 24 * k || (est < bestEst && p.length < pick.length)) { bestEst = est; pick = p; }
    }
    if (!pick.length) return finish();
    const moved = new Set(pick.map((p) => p.card));
    const next: Layout = [[...cur[0]], [...cur[1]]];
    next[from] = cur[from].filter((c) => !moved.has(c));
    const d = cur[1 - from];
    // On the right, "Part of …" stays last.
    const lastN = d.length ? cols[d[d.length - 1].home].c![d[d.length - 1].i].n : '';
    const tail = from === 0 && lastN === 'Back to parent' ? d.length - 1 : d.length;
    next[1 - from] = [...d.slice(0, tail), ...pick.map((p) => p.card), ...d.slice(tail)];
    setSt({ for: node, layout: next, best, pass, done: false });
  }, [node, compact, cols, st]);

  let shown = node;
  if (layout) {
    const place = (side: 0 | 1) => ({ ...cols[side], c: layout[side].map((card) => (card.home === side ? cols[side].c![card.i] : widen(cols[card.home].c![card.i], cols[side].w))) });
    shown = { ...node, c: [place(0), place(1)] };
  }
  return <div ref={ref} style={{ display: 'contents' }}><FigmaNode node={{ ...shown, bal: undefined }} parentLm={parentLm} parentH={parentH} /></div>;
}

/* ---- Carousel: a row named "Carousel · …" scrolls sideways (swipe, or the arrows named "Carousel prev/next"). ---- */
type Carousel = { setEl: (el: HTMLDivElement | null) => void; go: (dir: number) => void; label: string; atStart: boolean; atEnd: boolean };
const CarouselContext = createContext<Carousel | null>(null);
const isCarousel = (n: FNode) => !!n.n && n.n.startsWith('Carousel · ');

function CarouselGroup({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ first: 0, shown: 1, total: 0, atStart: true, atEnd: false });
  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const kids = [...el.children] as HTMLElement[];
      if (!kids.length) return;
      const step = kids.length > 1 ? kids[1].offsetLeft - kids[0].offsetLeft : kids[0].offsetWidth;
      const first = Math.round(el.scrollLeft / step);
      const gap = step - kids[0].offsetWidth;
      const shown = Math.max(1, Math.floor((el.clientWidth + gap + 2) / step));
      setPos({ first, shown, total: kids.length, atStart: el.scrollLeft < 4, atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });

    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => { el.removeEventListener('scroll', measure); ro.disconnect(); };
  }, [el]);
  const go = (dir: number) => {
    if (!el) return;
    const kids = [...el.children] as HTMLElement[];
    const step = kids.length > 1 ? kids[1].offsetLeft - kids[0].offsetLeft : el.clientWidth;
    el.scrollBy({ left: dir * step * pos.shown, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const last = Math.min(pos.first + pos.shown, pos.total);
  const label = pos.total ? (pos.shown > 1 && last > pos.first + 1 ? `${pos.first + 1}–${last} of ${pos.total}` : `${pos.first + 1} of ${pos.total}`) : '';
  return <CarouselContext.Provider value={{ setEl, go, label, atStart: pos.atStart, atEnd: pos.atEnd }}>{children}</CarouselContext.Provider>;
}

export function FigmaNode({ node, parentLm, parentH, rootStyle }: { node: FNode; parentLm?: 'H' | 'V'; parentH?: number; rootStyle?: CSSProperties }) {
  if (node.bal && !rootStyle) return <Balanced node={node} parentLm={parentLm} parentH={parentH} />;
  return <Node node={node} parentLm={parentLm} parentH={parentH} rootStyle={rootStyle} />;
}

function Node({ node: drawn, parentLm, parentH, rootStyle }: { node: FNode; parentLm?: 'H' | 'V'; parentH?: number; rootStyle?: CSSProperties }) {
  const activeNav = useContext(NavContext);
  const compact = useContext(CompactContext);
  const slots = useContext(SlotContext);
  const carousel = useContext(CarouselContext);
  const shrink = useContext(ScaleContext);
  const live = useInteract();
  const [playing, setPlaying] = useState(false);
  // A control is drawn in its current state (ticked / empty, selected / plain).
  const m = drawn.meta;
  const node: FNode = m?.on && m.off && live ? { ...(isActive(m, live) ? m.on : m.off), meta: m } : drawn;
  const ctl = controlProps(m, live);

  if (node.c?.some(isCarousel) && !carousel) {
    return <CarouselGroup><Node node={node} parentLm={parentLm} parentH={parentH} rootStyle={rootStyle} /></CarouselGroup>;
  }

  if (node.t === 'T') {
    const { st, cls, content: raw } = textNode(node, parentLm);
    if (shrink < 1 && node.z && node.z * shrink < 11) st.fontSize = 11 / shrink;
    const content = node.n === 'Carousel count' && carousel ? <span aria-live="polite">{carousel.label}</span> : raw;
    return wrapLink(node, <div className={cls.join(' ')} style={st} data-label={node.lab} data-empty={node.empty}>{content}</div>, st, cls);
  }

  const { st, cls } = boxStyle(node, parentLm, parentH);
  if (rootStyle) Object.assign(st, rootStyle);

  if (node.t === 'S') {
    st.width = node.w; st.height = node.h; st.display = 'inline-flex'; st.flexShrink = 0;
    const svg = node.svg ? SVGS[node.svg] : '';
    return <span aria-hidden="true" className={cls.concat('fsvg').join(' ')} style={st} dangerouslySetInnerHTML={{ __html: svg }} />;
  }

  // A live component replaces this layer (it keeps the layer's size and place in the layout).
  const slot = node.n ? slots[node.n] : undefined;
  if (slot) {
    const style: CSSProperties = { ...st };
    if (style.height !== undefined) { style.minHeight = style.height; style.height = undefined; style.alignSelf = 'stretch'; }
    return <>{slot({ style, className: cls.join(' ') })}</>;
  }

  // The real search box replaces the drawn one.
  if (node.n === 'Search' && node.lm) return <SearchBox style={st} />;
  // Floor Plan: the real table finder replaces the drawn box.
  if (m?.finder) return <TableFinder style={st} className={cls.join(' ')} list={m.list || []} />;

  background(node, st);
  if (node.st) {
    const color = rgba(node.st, node.sto ?? 1);
    const style = node.dash ? 'dashed' : 'solid';
    if (node.sws) {
      const [t, r, b, l] = node.sws;
      st.borderStyle = style; st.borderColor = color;
      st.borderWidth = `${t}px ${r}px ${b}px ${l}px`;
    } else st.border = `${node.sw ?? 1}px ${style} ${color}`;
  }
  if (node.t === 'E') st.borderRadius = '50%';
  else if (node.r) st.borderRadius = node.r;
  else if (node.rs) st.borderRadius = node.rs.map((v) => `${v}px`).join(' ');
  if (node.clip) st.overflow = 'hidden';

  if (node.lm) {
    st.display = 'flex';
    st.flexDirection = node.lm === 'H' ? 'row' : 'column';
    cls.push(node.lm === 'H' ? 'fx-h' : 'fx-v');
    if (node.gap) st.gap = node.gap;
    if (node.pd) st.padding = node.pd.map((v) => `${v}px`).join(' ');
    if (node.pa) st.justifyContent = JUSTIFY[node.pa];
    if (node.pa === 'S' && !node.gap) st.columnGap = 8;
    if (node.ca) st.alignItems = ALIGN[node.ca];
    else st.alignItems = 'flex-start';
    if (node.wrap) { st.flexWrap = 'wrap'; if (node.cg) st.rowGap = node.cg; st.columnGap = node.gap; }
    if (st.height !== undefined) cls.push('fixh');
  } else if (node.c) {
    st.position = st.position || 'relative';
    cls.push('fx-abs');
  }

  // Sidebar items: highlight the active section.
  if (node.n?.startsWith('Nav · ')) {
    cls.push('nav-item');
    if (node.n.slice(6) === activeNav) cls.push('is-active');
  }

  const img = node.f?.find((f) => f.img);
  const role = img && node.t !== 'F' ? 'img' : undefined;
  // Photos keep their shape when a phone reflows them (see .fx-v > [role="img"].wide in styles.css).
  if (role && node.w && node.h) st.aspectRatio = `${node.w} / ${node.h}`;
  const label = role ? (node.n || '').replace(/^IMG\//, '').split(' · ')[0] : undefined;

  if (m?.cls && live) { const c = m.cls[1][String(live.get(m.cls[0], ''))]; if (c) cls.push(c); }
  if (ctl) cls.push('is-ctl');
  // Floor Plan: the area card holding the table someone looked up.
  const table = String(live?.get('table', '') || '');
  if (m?.range && table && Number(table) >= m.range[0] && Number(table) <= m.range[1] && (m.range[0] < 100) === (Number(table) < 100)) cls.push('area-hit');
  const child = (c: FNode) => <FigmaNode node={c} parentLm={node.lm} parentH={node.lm === 'H' ? node.h : undefined} />;
  let kids: ReactNode = visibleKids(node.c, live)?.map((c, i) => (
    // Tonight's sections: the name in each row is live (and editable for a signed-in manager).
    m?.assign && c.t === 'T' && c.s === 'Unassigned'
      ? <AssignName key={i} slot={m.assign} node={c} render={child} />
      : <FigmaNode key={c.n ? c.n + i : i} node={c} parentLm={node.lm} parentH={node.lm === 'H' ? node.h : undefined} />
  ));

  // Videos: slots play inline; library cards open a player.
  const extras: ReactNode[] = [];
  if (isVideoSlot(node) && node.vid) {
    // A chapter button (Sear, Braise…) restarts the video at that point.
    const at = Number(live?.get('chapter', '') || 0);
    kids = <div className="video-fill"><VideoEmbed key={at} video={node.vid} start={at} /></div>;
  }
  if (isVideoCard(node) && node.vid) {
    cls.push('has-video');
    extras.push(<button key="play" type="button" className="play-overlay" aria-label={`Play ${node.n!.split(' · ').slice(1).join(' · ')}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPlaying(true); }} />);
  }
  const overlays = (
    <>
      {playing && node.vid && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setPlaying(false); }}>
          <div className="modal video-modal" role="dialog" aria-modal="true" aria-label="Video">
            <button className="icon-btn" onClick={() => setPlaying(false)} aria-label="Close">✕</button>
            <div className="video-frame"><VideoEmbed video={node.vid} /></div>
          </div>
        </div>
      )}
    </>
  );
  if (m?.tables && table && m.tables[table]) { extras.push(<TableMarker key="table" at={m.tables[table]} label={table} />); st.position = st.position || 'relative'; st.overflow = 'hidden'; }
  if (extras.length || playing) kids = <>{kids}{extras}{overlays}</>;
  if (extras.length && !st.position) st.position = 'relative';
  if (compact && !node.lm && node.c && node.w > 200 && parentLm && !node.abs && !rootStyle) {
    const { flex, alignSelf, minWidth, flexShrink, ...inner } = st;
    // A photo banner with a text block (Our Story): the photo fills behind, the text flows at its own size.
    const copy = node.c.find((c) => c.n === 'Copy' && c.lm);
    const bgs = node.c.filter((c) => c !== copy && c.w >= node.w - 2 && c.h >= node.h - 2);
    if (copy && bgs.length) {
      const { width, height, ...rest } = inner; void width; void height;
      return (
        <div className={cls.concat('hero-flow').join(' ')} style={{ ...rest, flex, alignSelf, position: 'relative', overflow: 'hidden', width: '100%' }} data-name={node.n}>
          {bgs.map((c, i) => <FigmaNode key={i} node={{ ...c, x: 0, y: 0 }} rootStyle={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />)}
          <div style={{ position: 'relative', padding: '32px 20px' }}><FigmaNode node={{ ...copy, abs: undefined, x: undefined, y: undefined }} parentLm="V" /></div>
        </div>
      );
    }
    // A wide diagram (the service timeline, the thermometer): full size, swipe sideways.
    if (node.w >= 900) {
      const box = <div className={cls.join(' ')} style={{ ...inner, position: 'relative', width: node.w, height: node.h, maxWidth: 'none' }} data-name={node.n}>{kids}</div>;
      return <div className="swipe-x" style={{ flex, alignSelf, width: '100%', overflowX: 'auto', overflowY: 'hidden' }} role="region" aria-label={node.n} tabIndex={0}>{box}</div>;
    }
    const box = <div className={cls.join(' ')} style={{ ...inner, position: 'relative', width: node.w, height: node.h, maxWidth: 'none' }} data-name={node.n}>{kids}</div>;
    const scaled = <Scaled w={node.w} h={node.h} outer={{ flex, alignSelf, minWidth, flexShrink }}>{box}</Scaled>;
    return node.to ? wrapLink(node, <div>{scaled}</div>, {}, ['fn']) : scaled;
  }
  if (carousel && (node.n === 'Carousel prev' || node.n === 'Carousel next')) {
    const prev = node.n === 'Carousel prev';
    const off = prev ? carousel.atStart : carousel.atEnd;
    return (
      <button type="button" className={cls.concat('carousel-btn').join(' ')} style={st} data-name={node.n} disabled={off}
        aria-label={prev ? 'Previous cocktails' : 'Next cocktails'} onClick={() => carousel.go(prev ? -1 : 1)}>{kids}</button>
    );
  }
  if (carousel && isCarousel(node)) {
    return <div ref={carousel.setEl} className={cls.concat('carousel').join(' ')} style={{ ...st, overflowX: 'auto', overflowY: 'hidden' }} data-name={node.n} tabIndex={0} aria-label={node.n!.split(' · ')[1]} role="region">{kids}</div>;
  }
  const el = ctl && !node.to ? (
    <div className={cls.join(' ')} style={st} data-name={node.n} data-label={node.lab} data-empty={node.empty} data-head={node.hdr} aria-label={node.n?.split(' · ').slice(1).join(' · ') || undefined} {...ctl}>
      {kids}
    </div>
  ) : (
    <div className={cls.join(' ')} style={st} role={role} aria-label={label} data-name={node.n} data-label={node.lab} data-empty={node.empty} data-head={node.hdr}>
      {kids}
    </div>
  );
  return wrapLink(node, el, st, cls);
}

function wrapLink(node: FNode, el: ReactNode, st: CSSProperties, cls: string[]) {
  if (!node.to) return el;
  const label = node.n?.includes(' · ') ? node.n.split(' · ').slice(1).join(' · ') : undefined;
  // Outside sources (Wine Folly, Vivino, producer sites) open in a new tab.
  if (/^https?:\/\//.test(node.to)) {
    return (
      <a href={node.to} target="_blank" rel="noopener noreferrer" className={cls.concat('flink').join(' ')} style={{ ...st, display: st.display || 'block', color: 'inherit', textDecoration: 'none' }} aria-label={label} data-name={node.n} data-label={node.lab} data-head={node.hdr}>
        {(el as { props: { children?: ReactNode } }).props.children}
      </a>
    );
  }
  return (
    <Link to={node.to} className={cls.concat('flink').join(' ')} style={{ ...st, display: st.display || 'block', color: 'inherit', textDecoration: 'none' }} aria-label={label} data-name={node.n} data-label={node.lab} data-head={node.hdr}>
      {(el as { props: { children?: ReactNode } }).props.children}
    </Link>
  );
}
