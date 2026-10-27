import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import svgs from '../content/svgs.json';
import { SearchBox } from './SearchBox';
import { VideoEmbed } from './VideoEmbed';
import { MediaPicker } from './MediaPicker';
import type { Video } from '../lib/api';

// One node of the Figma layout export (see scripts/build-content.mjs).
export type FNode = {
  t: 'F' | 'T' | 'R' | 'E' | 'S';
  n?: string; w: number; h: number; x?: number; y?: number; abs?: 1;
  sh?: 'F' | 'H' | 'L'; sv?: 'F' | 'H' | 'L';
  op?: number; rot?: number; to?: string; svg?: string;
  f?: { c?: string; o?: number; img?: string; m?: string; g?: [string, number, number][]; gt?: string }[];
  st?: string; sto?: number; sw?: number; sws?: number[]; dash?: 1; sa?: string;
  r?: number; rs?: number[];
  s?: string; ff?: string; fs?: string; z?: number; lh?: string | number; ls?: string | number; ta?: string; ar?: string;
  segs?: [number, number, string, string | null][];
  clip?: 1; lm?: 'H' | 'V'; gap?: number; pd?: number[]; pa?: string; ca?: string; wrap?: 1; cg?: number;
  c?: FNode[];
  vid?: Video;
};

/** Editing state for the page being shown. */
export type EditApi = { pageId: string; editing: boolean; save: (path: string, value: object) => Promise<void> };
export const EditContext = createContext<EditApi>({ pageId: '', editing: false, save: async () => {} });

/** Child paths use layer names, matching server/content.mjs, so inserted rows don't shift edits. */
function childPaths(node: FNode, path: string) {
  const seen = new Map<string, number>();
  return (node.c || []).map((c) => {
    const name = c.n || '';
    const k = seen.get(name) ?? 0;
    seen.set(name, k + 1);
    return `${path}/${name}#${k}`;
  });
}
const isVideoSlot = (n: FNode) => !!n.n && (n.n.startsWith('Video slot') || n.n === 'Player');
const isVideoCard = (n: FNode) => !!n.n && (n.n.startsWith('Video · ') || n.n.startsWith('Item · '));

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
      images.push(f.gt === 'GRADIENT_RADIAL' ? `radial-gradient(${stops})` : `linear-gradient(180deg, ${stops})`);
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

function boxStyle(node: FNode, parentLm: 'H' | 'V' | undefined): { st: CSSProperties; cls: string[] } {
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
    if (node.sv === 'F') st.height = node.h;
    else if (node.sv === 'L') st.alignSelf = 'stretch';
  } else {
    if (node.sh === 'F') { st.width = node.w; st.maxWidth = '100%'; if (node.w > 220) cls.push('wide'); }
    else if (node.sh === 'L') st.alignSelf = 'stretch';
    if (node.sv === 'F') { st.height = node.h; st.flexShrink = 0; }
    else if (node.sv === 'L') st.flex = '1 1 0';
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

export function FigmaNode({ node, parentLm, rootStyle, path = '' }: { node: FNode; parentLm?: 'H' | 'V'; rootStyle?: CSSProperties; path?: string }) {
  const activeNav = useContext(NavContext);
  const compact = useContext(CompactContext);
  const edit = useContext(EditContext);
  const [picker, setPicker] = useState<null | 'image' | 'video'>(null);
  const [playing, setPlaying] = useState(false);

  if (node.t === 'T') {
    const { st, cls, content } = textNode(node, parentLm);
    if (edit.editing && path) return <EditableText key={node.s} text={node.s || ''} className={cls.concat('editable').join(' ')} style={st} onSave={(v) => edit.save(path, { s: v })} />;
    return wrapLink(node, <div className={cls.join(' ')} style={st}>{content}</div>, st, cls, edit.editing);
  }

  const { st, cls } = boxStyle(node, parentLm);
  if (rootStyle) Object.assign(st, rootStyle);

  if (node.t === 'S') {
    st.width = node.w; st.height = node.h; st.display = 'inline-flex'; st.flexShrink = 0;
    const svg = node.svg ? SVGS[node.svg] : '';
    return <span aria-hidden="true" className={cls.concat('fsvg').join(' ')} style={st} dangerouslySetInnerHTML={{ __html: svg }} />;
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

  const paths = childPaths(node, path);
  let kids: ReactNode = node.c?.map((c, i) => <FigmaNode key={i} node={c} parentLm={node.lm} path={paths[i]} />);

  // Photos: a "Replace photo" button while editing.
  const extras: ReactNode[] = [];
  if (edit.editing && img && path) {
    cls.push('edit-media');
    extras.push(<button key="img" type="button" className="edit-chip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPicker('image'); }}>Replace photo</button>);
  }
  // Videos: slots play inline; library cards open a player.
  if (isVideoSlot(node) && node.vid) {
    kids = <div className="video-fill"><VideoEmbed video={node.vid} /></div>;
  }
  if (isVideoCard(node) && node.vid && !edit.editing) {
    cls.push('has-video');
    extras.push(<button key="play" type="button" className="play-overlay" aria-label={`Play ${node.n!.split(' · ').slice(1).join(' · ')}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPlaying(true); }} />);
  }
  if (edit.editing && path && (isVideoSlot(node) || node.n?.startsWith('Video · '))) {
    cls.push('edit-media');
    extras.push(<button key="vid" type="button" className="edit-chip video" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPicker('video'); }}>{node.vid ? 'Change video' : 'Add video'}</button>);
  }
  const overlays = (
    <>
      {picker && (
        <MediaPicker
          kind={picker}
          title={picker === 'image' ? 'Replace the photo' : node.vid ? 'Change the video' : 'Add a video'}
          onClose={() => setPicker(null)}
          onPick={async (v) => { setPicker(null); await edit.save(path, v); }}
          onRemove={picker === 'video' && node.vid ? async () => { setPicker(null); await edit.save(path, { video: null }); } : undefined}
        />
      )}
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
  if (extras.length || picker || playing) kids = <>{kids}{extras}{overlays}</>;
  if (cls.includes('edit-media') && !st.position) st.position = 'relative';
  if (compact && !node.lm && node.c && node.w > 200 && parentLm && !node.abs && !rootStyle) {
    const { flex, alignSelf, minWidth, flexShrink, ...inner } = st;
    const box = <div className={cls.join(' ')} style={{ ...inner, position: 'relative', width: node.w, height: node.h, maxWidth: 'none' }} data-name={node.n}>{kids}</div>;
    const scaled = <Scaled w={node.w} h={node.h} outer={{ flex, alignSelf, minWidth, flexShrink }}>{box}</Scaled>;
    return node.to && !edit.editing ? wrapLink(node, <div>{scaled}</div>, {}, ['fn']) : scaled;
  }
  const el = (
    <div className={cls.join(' ')} style={st} role={role} aria-label={label} data-name={node.n}>
      {kids}
    </div>
  );
  return wrapLink(node, el, st, cls, edit.editing);
}

function wrapLink(node: FNode, el: ReactNode, st: CSSProperties, cls: string[], editing = false) {
  if (!node.to || editing) return el;
  const label = node.n?.includes(' · ') ? node.n.split(' · ').slice(1).join(' · ') : undefined;
  return (
    <Link to={node.to} className={cls.concat('flink').join(' ')} style={{ ...st, display: st.display || 'block', color: 'inherit', textDecoration: 'none' }} aria-label={label}>
      {(el as { props: { children?: ReactNode } }).props.children}
    </Link>
  );
}

/** Click to edit. Saves when you click away; Escape cancels. */
function EditableText({ text, className, style, onSave }: { text: string; className: string; style: CSSProperties; onSave: (v: string) => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  return (
    <div
      ref={ref}
      className={className + (state === 'saving' ? ' saving' : state === 'error' ? ' save-error' : '')}
      style={style}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Edit text"
      spellCheck
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.currentTarget.innerText = text; e.currentTarget.blur(); }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
      }}
      onBlur={async (e) => {
        const v = e.currentTarget.innerText.replace(/\u00a0/g, ' ').replace(/\n$/, '');
        if (v === text) return;
        setState('saving');
        try { await onSave(v); setState('idle'); } catch { setState('error'); }
      }}
    >
      {text}
    </div>
  );
}
