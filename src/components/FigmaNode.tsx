import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import svgs from '../content/svgs.json';
import { SearchBox } from './SearchBox';
import { VideoEmbed } from './VideoEmbed';
import type { Video } from '../lib/api';

// One node of the Figma layout export (see scripts/build-content.mjs).
export type FNode = {
  t: 'F' | 'T' | 'R' | 'E' | 'S';
  n?: string; w: number; h: number; x?: number; y?: number; abs?: 1;
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
};

const isVideoSlot = (n: FNode) => !!n.n && (n.n.startsWith('Video slot') || n.n === 'Player');
const isVideoCard = (n: FNode) => !!n.n && (n.n.startsWith('Video · ') || n.n.startsWith('Item · '));

/** Live parts of a page: a layer with this name is replaced by the component (e.g. the quiz card). */
export type Slot = (p: { style: CSSProperties; className: string }) => ReactNode;
export const SlotContext = createContext<Record<string, Slot>>({});

/** Which sidebar item is active, so the shared sidebar can highlight it. */
export const NavContext = createContext<string>('Home');
/** True on phones, where rows reflow instead of the page scaling. */
export const CompactContext = createContext(false);

/** Scales a fixed-layout frame (absolute children) down to fit a narrow column. */
function Scaled({ w, h, outer, children }: { w: number; h: number; outer: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(Math.min(1, el.clientWidth / w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div ref={ref} style={{ ...outer, width: '100%', maxWidth: w, height: h * k, position: 'relative' }}>
      <div style={{ width: w, height: h, transform: `scale(${k})`, transformOrigin: 'top left' }}>{children}</div>
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

export function FigmaNode({ node, parentLm, parentH, rootStyle }: { node: FNode; parentLm?: 'H' | 'V'; parentH?: number; rootStyle?: CSSProperties }) {
  const activeNav = useContext(NavContext);
  const compact = useContext(CompactContext);
  const slots = useContext(SlotContext);
  const [playing, setPlaying] = useState(false);

  if (node.t === 'T') {
    const { st, cls, content } = textNode(node, parentLm);
    return wrapLink(node, <div className={cls.join(' ')} style={st}>{content}</div>, st, cls);
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
  const label = role ? (node.n || '').replace(/^IMG\//, '').split(' · ')[0] : undefined;

  let kids: ReactNode = node.c?.map((c, i) => <FigmaNode key={i} node={c} parentLm={node.lm} parentH={node.lm === 'H' ? node.h : undefined} />);

  // Videos: slots play inline; library cards open a player.
  const extras: ReactNode[] = [];
  if (isVideoSlot(node) && node.vid) {
    kids = <div className="video-fill"><VideoEmbed video={node.vid} /></div>;
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
  if (extras.length || playing) kids = <>{kids}{extras}{overlays}</>;
  if (extras.length && !st.position) st.position = 'relative';
  if (compact && !node.lm && node.c && node.w > 200 && parentLm && !node.abs && !rootStyle) {
    const { flex, alignSelf, minWidth, flexShrink, ...inner } = st;
    const box = <div className={cls.join(' ')} style={{ ...inner, position: 'relative', width: node.w, height: node.h, maxWidth: 'none' }} data-name={node.n}>{kids}</div>;
    const scaled = <Scaled w={node.w} h={node.h} outer={{ flex, alignSelf, minWidth, flexShrink }}>{box}</Scaled>;
    return node.to ? wrapLink(node, <div>{scaled}</div>, {}, ['fn']) : scaled;
  }
  const el = (
    <div className={cls.join(' ')} style={st} role={role} aria-label={label} data-name={node.n}>
      {kids}
    </div>
  );
  return wrapLink(node, el, st, cls);
}

function wrapLink(node: FNode, el: ReactNode, st: CSSProperties, cls: string[]) {
  if (!node.to) return el;
  const label = node.n?.includes(' · ') ? node.n.split(' · ').slice(1).join(' · ') : undefined;
  return (
    <Link to={node.to} className={cls.concat('flink').join(' ')} style={{ ...st, display: st.display || 'block', color: 'inherit', textDecoration: 'none' }} aria-label={label}>
      {(el as { props: { children?: ReactNode } }).props.children}
    </Link>
  );
}
