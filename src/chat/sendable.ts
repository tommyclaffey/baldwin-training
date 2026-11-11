// What can go to Team Chat, and where its chat button sits (Nov 11, Tommy: "Can you have those hover states where you
// can select the item and have the chat button? … somewhere so the item can be put in the chat").
// Pure functions (no React), so the tests can run them with Node.
import type { IndexEntry } from '../lib/api';

/** Pages that are one thing you'd talk about: a dish, a cocktail, a wine, a bottle, a lesson. Not hubs or home. */
const SHAREABLE = new Set(['Recipe', 'Signature', 'Classic', 'Wine list', 'Back bar', 'Bottle', 'Wine', 'Spirit', 'Beer', 'Bar Basics', 'Wine Service']);
export const shareable = (e: IndexEntry | undefined) => !!e && (SHAREABLE.has(e.section) || /^Step \d/.test(e.section) || /^[lm]/.test(e.file));

/** The book page a link goes to ("/classic/old-fashioned?x#y" → "classic/old-fashioned"); null for outside links. */
export const slugOf = (href: string) => (href.startsWith('/') && !href.startsWith('//') ? decodeURIComponent(href.split(/[?#]/)[0]).replace(/^\/+|\/+$/g, '') : null);

/** The part of a layout node this needs (see FNode in components/FigmaNode.tsx). */
export type Box = { t: string; n?: string; w: number; h: number; x?: number; y?: number; abs?: 1; to?: string; skipTab?: 1; lm?: 'H' | 'V'; sh?: 'F' | 'H' | 'L'; pd?: number[]; c?: Box[]; f?: { img?: string }[]; s?: string; gut?: number };

/** Links that move you around rather than show one thing: nav, breadcrumbs, buttons, chips, tabs, pills, "Part of …". */
const NOT_ITEMS = /^(Nav|Crumb|Breadcrumb|Button|Chip|Pill|Tag|Step tab|Node|Back to parent|Sibling|Section|Open in the book|In the book|Learn link|Carousel|Brand|Head|Use|Add|Logo)\b/;
const BTN = 32; // the chat button, in design px (the page's zoom scales it with everything else)
const INSET = 8; // from the corner of a card or its photo
const ROOM = 10; // between a row's content and the button

/** row: a list or table row (short and wide), the button at its end in a gutter of its own.
 *  card: anything bigger, the button in the top-right corner of its photo (or of the card). */
export type Shape = 'row' | 'card';
export function shapeOf(n: Box): Shape | null {
  if (n.t !== 'F' || n.skipTab || (n.n && NOT_ITEMS.test(n.n))) return null;
  if (n.w < 160 || n.h < 40) return null; // small links (pills, chips, inline links) keep the page's Send to Team
  return n.h <= 100 && n.w >= n.h * 3 ? 'row' : 'card';
}

export type Target = { slug: string; title: string };
export type Lookup = (slug: string) => Target | null;

/** The page this item would send, or null: it must be a frame-sized link to a page you can share. */
export function targetOf(n: Box, lookup: Lookup): (Target & { shape: Shape }) | null {
  if (!n.to) return null;
  const shape = shapeOf(n);
  if (!shape) return null;
  const slug = slugOf(n.to);
  const t = slug === null ? null : lookup(slug);
  return t ? { ...t, shape } : null;
}

const hasPhoto = (c: Box) => !!c.f?.some((f) => f.img);
const inFlowKids = (n: Box) => (n.c || []).filter((c) => !c.abs);
const gutter = (pd: number[] | undefined) => { const p = pd || [0, 0, 0, 0]; const right = Math.max(p[1], INSET); return { pd: [p[0], right + BTN + ROOM, p[2], p[3]], gut: right }; };

/** How a card carries its button: in the top-right corner of a leading photo; or, when it opens with a band (a coloured
 *  title strip, a name and price), centred at the end of that band, which gets a gutter like a row; or in the card's
 *  own top-right corner. `band` is the child that gets the gutter. */
export type CardPlan = { top: number; right: number; band?: Box };
export function cardPlan(n: Box): CardPlan {
  const pd = n.pd || [0, 0, 0, 0];
  if (n.lm) {
    const first = inFlowKids(n)[0];
    if (first && hasPhoto(first) && first.w >= 80 && first.h >= 80) return { top: pd[0] + INSET, right: Math.max(INSET, n.w - (pd[3] + first.w) + INSET) };
    const inner = n.w - pd[1] - pd[3];
    if (first && n.lm === 'V' && first.t === 'F' && Math.abs(first.w - inner) <= 4 && first.h <= 100) {
      const g = gutter(first.pd);
      return { top: pd[0] + Math.max(0, first.h / 2 - BTN / 2), right: pd[1] + g.gut, band: first };
    }
  } else {
    // A fixed layout: the biggest photo, by where it's placed.
    const p = (n.c || []).filter((c) => hasPhoto(c) && c.w >= 80 && c.h >= 80).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (p) return { top: (p.y ?? 0) + INSET, right: Math.max(INSET, n.w - ((p.x ?? 0) + p.w) + INSET) };
  }
  return { top: INSET, right: INSET };
}

/** Where the button sits, in the item's own px. Rows: centred in their gutter at the end. Cards: see cardPlan. */
export function placeOf(n: Box, shape: Shape): { top?: number; right: number } {
  if (shape === 'row') return { right: n.gut ?? Math.max(n.pd?.[1] ?? 0, INSET) };
  const { top, right } = cardPlan(n);
  return { top, right };
}

/** A card's children with its band's gutter in. */
export function withBand<T extends Box>(kids: T[], plan: CardPlan): T[] {
  if (!plan.band) return kids;
  return kids.map((c) => (c === plan.band ? { ...c, ...gutter(c.pd) } : c));
}

/** A card that isn't a link but is about one thing (Cocktail Specs: a spec card whose name links to the cocktail):
 *  the one shareable page its opening band links to. */
export function holderTarget(n: Box, lookup: Lookup): Target | null {
  if (n.t !== 'F' || n.to || n.lm !== 'V' || n.w < 200 || n.h < 120 || (n.n && NOT_ITEMS.test(n.n))) return null;
  const first = inFlowKids(n)[0];
  if (!first || first.h > 100) return null;
  const links: string[] = [];
  const walk = (b: Box) => { if (b.to) links.push(b.to); (b.c || []).forEach(walk); };
  walk(first);
  const slugs = [...new Set(links.map(slugOf).filter((x): x is string => x !== null))];
  return slugs.length === 1 ? lookup(slugs[0]) : null;
}

/** Rows get a gutter at their end for the button, so it never sits on a price, an allergen pill or a name. Rows of the
 *  same table that don't link (the header, group titles) get the same gutter, so the columns stay lined up. In a row
 *  of hugging parts (a wine's name, then its prices), the parts before the last may shrink and wrap into the room left. */
export function withGutters<T extends Box>(kids: T[], parent: Pick<Box, 'lm'>, isRow: (c: T) => boolean): T[] {
  const rows = kids.filter(isRow);
  if (!rows.length) return kids;
  const widths = rows.map((r) => r.w);
  const sameTable = (c: T) => parent.lm === 'V' && c.t === 'F' && c.lm === 'H' && !c.abs && widths.some((w) => Math.abs(w - c.w) <= 6);
  return kids.map((c) => {
    if (!rows.includes(c) && !sameTable(c)) return c;
    const flow = inFlowKids(c);
    const kidsOut = c.lm === 'H' && c.c ? c.c.map((k) => (!k.abs && k !== flow[flow.length - 1] && k.sh !== 'F' && k.sh !== 'L' && k.w >= 60 ? { ...k, sh: 'L' as const } : k)) : c.c;
    return { ...c, ...gutter(c.pd), c: kidsOut };
  });
}

/** A link's words, for its accessible name once a button sits inside it (so the button's label isn't read as part of it). */
export function wordsOf(n: Box): string {
  const out: string[] = [];
  const walk = (b: Box) => { if (b.t === 'T' && b.s) out.push(b.s.trim()); (b.c || []).forEach(walk); };
  walk(n);
  return out.filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 200);
}
