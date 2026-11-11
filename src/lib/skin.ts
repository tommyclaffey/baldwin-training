// The Mise skin (Nov 10, Tommy: "build out those pages in the new style … start with the old-fashioned page").
// Each restaurant group keeps its own look (Tommy, Nov 10: "keep the baldwin account in the same style"), so this is a
// switch, not a restyle: The Baldwin's designed pages stay as drawn, and `?brand=mise` shows the same page in Mise.
// The rules come from the Mise brand guide (Figma 01 · Brand guide, 518:74) and section 25 on 09 · Proposals:
// light first, one red (deep fig), serif only from 40 px up, handwriting only on the taped note, watch = dark, read = light.
import type { FNode } from '../components/FigmaNode';

export type Brand = 'baldwin' | 'mise';
const KEY = 'brand';

/** `?brand=mise` turns the skin on (remembered on this device); `?brand=baldwin` turns it off. */
export function currentBrand(): Brand {
  try {
    const q = new URLSearchParams(location.search).get('brand');
    if (q === 'mise' || q === 'baldwin') localStorage.setItem(KEY, q);
    return localStorage.getItem(KEY) === 'mise' ? 'mise' : 'baldwin';
  } catch { return 'baldwin'; }
}

export const MISE = {
  char: '#121110', smoke: '#1E1C1A', smoke2: '#26231F', line: '#34302C', ash: '#9A928A', inkMuted: '#4A443E',
  sand: '#D9CFBF', bone: '#EDE6DA', paper: '#FBF8F2', tape: '#7BA5CB', fig: '#8E2A26', olive: '#5B6B2E', white: '#FFFFFF',
};

// The Baldwin's colours → Mise. Shapes and text map differently, and text depends on what it sits on.
const SHAPE: Record<string, string> = {
  '#F2EEE7': MISE.bone, '#FBF9F5': MISE.paper, '#F3EEE6': '#F4EFE0', '#EFE3D3': '#F4EFE0', '#F1EADF': '#F4EFE0', '#EEF0E6': '#F4EFE0',
  '#E4DCCF': MISE.sand, '#DDD3C5': MISE.sand, '#CFC5B6': MISE.sand,
  '#1E1C1A': MISE.char, '#2A2724': MISE.smoke, '#3F3A35': MISE.smoke2, '#3A3632': MISE.line,
  '#C49A6C': MISE.fig, '#8E2F24': MISE.fig, '#8A5A3A': MISE.fig,
};
const STROKE: Record<string, string> = {
  '#E4DCCF': MISE.sand, '#DDD3C5': MISE.sand, '#8A5A3A': MISE.char, '#C49A6C': MISE.fig, '#6B645B': MISE.inkMuted,
  '#A39B90': MISE.ash, '#B8AFA3': MISE.sand, '#1E1C1A': MISE.char, '#3A3632': MISE.line, '#4A443D': MISE.line,
};
const TEXT_ON_LIGHT: Record<string, string> = {
  '#1E1C1A': MISE.char, '#5E574F': MISE.inkMuted, '#6B645B': MISE.inkMuted, '#8A5A3A': MISE.fig, '#C49A6C': MISE.fig,
  '#B8AFA3': MISE.inkMuted, '#A39B90': MISE.inkMuted, '#4A443D': MISE.inkMuted,
};
const TEXT_ON_DARK: Record<string, string> = {
  '#F2EEE7': MISE.bone, '#EDE6DC': MISE.bone, '#E2DACF': '#D9D4CB', '#D9D1C6': '#D9D4CB', '#CFC6BA': '#D9D4CB',
  '#C49A6C': MISE.ash, '#B8AFA3': MISE.ash, '#8A5A3A': MISE.ash, '#1E1C1A': MISE.bone,
};

function lum(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
const isDark = (hex?: string) => !!hex && /^#[0-9a-f]{6}/i.test(hex) && lum(hex) < 0.2;
const up = (s?: string) => (s || '').toUpperCase();
const solid = (n: FNode) => n.f?.find((f) => f.c && (f.o ?? 1) > 0.5)?.c;

const SMALL = new Set(['a', 'an', 'and', 'of', 'the', 'to', 'or', 'at', 'by', 'in', 'on', 'for', 'with']);
/** "OLD FASHIONED" → "Old Fashioned"; leaves mixed-case text alone. */
export function titleCase(s: string) {
  if (!s || s !== s.toUpperCase() || !/[A-Z]{2}/.test(s)) return s;
  return s.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/^([^a-z]*)([a-z])/, (_m, p, c) => p + c.toUpperCase()))).join(' ');
}

function skinText(t: FNode, bg: string | undefined, inPill: boolean) {
  const dark = isDark(bg);
  const c = up(solid(t));
  const map = dark ? TEXT_ON_DARK : TEXT_ON_LIGHT;
  if (c && map[c]) t.f = [{ c: map[c] }];
  // a filled red pill or button: white on deep fig (8.4:1)
  if (up(bg) === MISE.fig) t.f = [{ c: MISE.white }];
  const z = t.z || 14;
  if (t.ff === 'Archivo' && t.fs === 'ExtraBold') {
    if (z >= 40) { t.ff = 'Instrument Serif'; t.fs = 'Regular'; t.z = 64; t.lh = '100%'; t.ls = '-0.5%'; t.s = titleCase(t.s || ''); if (t.lw) delete t.lw; }
    else { t.fs = 'SemiBold'; t.z = z >= 26 ? 26 : 20; t.ls = '-1%'; t.lh = '125%'; t.s = titleCase(t.s || ''); }
  } else if (t.ff === 'Archivo' && (t.fs === 'Bold' || t.fs === 'SemiBold') && z <= 12.5 && !inPill && t.s && t.s === t.s.toUpperCase() && /[A-Z]{2}/.test(t.s)) {
    t.ff = 'DM Mono'; t.fs = 'Medium'; t.ls = '12%';
  }
}

/** Walks the page, re-colouring and re-typing it as Mise. Pinyon Script lines are dropped (Nov 10: handwriting only on
 *  the one taped note per screen), except the one the page builder marks for the tape. */
function walk(n: FNode, bg: string | undefined, inPill: boolean): FNode | null {
  if (n.t === 'T' && n.ff === 'Pinyon Script') return null;
  const own = solid(n);
  if (n.f) n.f = n.f.map((f) => (f.c && SHAPE[up(f.c)] && n.t !== 'T' ? { ...f, c: SHAPE[up(f.c)] } : f));
  if (n.st && STROKE[up(n.st)]) n.st = STROKE[up(n.st)];
  const here = n.t !== 'T' && own ? (n.f?.find((f) => f.c)?.c || bg) : bg;
  // Main buttons: near-black on light, Bone on dark panels (Nov 10: the red read harsh as a big fill).
  if ((n.n || '').startsWith('Button') && up(own) && (up(own) === '#C49A6C' || up(own) === '#8E2F24')) {
    const onDark = isDark(bg);
    n.f = [{ c: onDark ? MISE.bone : MISE.char }];
    const ink = onDark ? MISE.char : MISE.bone;
    const paint = (x: FNode) => { if (x.t === 'T') x.f = [{ c: ink }]; (x.c || []).forEach(paint); };
    (n.c || []).forEach(paint);
    return n;
  }
  const pill = inPill || (n.t !== 'T' && (n.h || 0) <= 30 && (n.w || 0) < 260 && n.r !== undefined && n.r >= (n.h || 0) / 2 - 1);
  if (n.t === 'T') { skinText(n, bg, pill); return n; }
  if (n.c) n.c = n.c.map((c) => walk(c, here, pill)).filter(Boolean) as FNode[];
  return n;
}

/** Torn painter's tape behind the one handwritten note (public/img/mise-tape.svg stretches to the note). */
function tapedNote(text: string): FNode {
  return {
    t: 'F', n: 'Taped note', lm: 'H', sh: 'H', sv: 'H', pa: 'C', ca: 'C', pd: [9, 18, 7, 18], rot: 1.5,
    f: [{ img: '/img/mise-tape.svg', m: 'FILL' }],
    c: [{ t: 'T', n: 'Note', s: text, ff: 'Reenie Beanie', fs: 'Regular', z: 26, lh: '100%', f: [{ c: MISE.char }], ar: 'W', sh: 'H', sv: 'H', w: 200, h: 26 } as FNode],
  } as FNode;
}

/** Detail pages (classic cocktails): the cinematic hero. Watch = dark, read = light (Figma 555:586): the photo bleeds in
 *  from the right and fades into Char; the tag pills, the taped note, the serif title and the lead sit on the dark side. */
function cinematicHero(main: FNode) {
  const find = (n: FNode, f: (x: FNode) => boolean): FNode | null => { if (f(n)) return n; for (const c of n.c || []) { const r = find(c, f); if (r) return r; } return null; };
  const hero = find(main, (x) => x.n === 'Hero' && x.lm === 'H');
  if (!hero?.c) return;
  const photo = hero.c.find((c) => (c.n || '').startsWith('IMG/'));
  const copy = hero.c.find((c) => c.n === 'Copy');
  if (!photo || !copy?.c) return;
  const tag = copy.c.find((c) => c.t === 'T' && c.ff === 'Pinyon Script');
  const H = 560;
  hero.h = H; hero.f = [{ c: MISE.char }];
  photo.w = 640; photo.h = H; photo.sh = 'F'; photo.sv = 'F';
  photo.n = 'Mise hero photo · ' + (photo.n || '').replace(/^IMG\//, ''); // the fade into Char is drawn in styles.css (sideways on desktop, downwards on phones)
  copy.w = 440; copy.sh = 'L'; copy.sv = 'F'; copy.h = H; copy.pa = 'C'; copy.pd = [52, 8, 52, 52]; copy.gap = 16; // centred top to bottom (Tommy, Nov 10: "should we center this info?")
  if (tag) {
    const i = copy.c.indexOf(tag);
    copy.c[i] = tapedNote((tag.s || '').toLowerCase().replace(/^./, (c) => c.toUpperCase()));
  }
  hero.c = [copy, photo];
}

export function miseSkin<P extends { main: FNode; bg?: string }>(page: P): P {
  const main = structuredClone(page.main);
  const isClassic = (page as { name?: string }).name?.startsWith('Classic · ');
  if (isClassic) cinematicHero(main);
  const out = walk(main, MISE.bone, false) || main;
  return { ...page, bg: MISE.bone, main: out };
}

/** The sidebar in Mise: Char, the Mise Academy lockup where The Baldwin's logo is, and the same re-colouring. */
export function miseSidebar(node: FNode): FNode {
  const n = structuredClone(node);
  const swapLogo = (x: FNode): FNode => {
    if (x.n === 'Logo') return { ...x, pd: [0, 0, 0, 0], c: [{ t: 'R', n: 'IMG/Mise Academy lockup', w: 150, h: 72, sh: 'F', sv: 'F', f: [{ img: '/img/mise-academy-lockup-cream.png', m: 'FIT' }] } as FNode] };
    return x.c ? { ...x, c: x.c.map(swapLogo) } : x;
  };
  const out = walk(swapLogo(n), MISE.char, false) || n;
  out.f = [{ c: MISE.char }];
  // The active nav item: a quiet Bone highlight, not red (Nov 10: fig is the "attention" colour).
  const active = (x: FNode) => {
    if ((x.n || '').startsWith('Nav · ') && solid(x)) { x.f = [{ c: MISE.bone, o: 0.1 }]; const ink = (y: FNode) => { if (y.t === 'T') y.f = [{ c: MISE.bone }]; (y.c || []).forEach(ink); }; ink(x); }
    (x.c || []).forEach(active);
  };
  active(out);
  return out;
}
