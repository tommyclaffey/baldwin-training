// Edit in place (Oct 31, Tommy: "I almost want to feel like you're interacting with your own platform").
// List pages get an "Add" row after every run of linked dishes, cocktails, wines or bottles. The row's link
// is the admin form for a new entry, with the group filled in from the run it follows (?course=Mains).
// In the browser that link opens the form over the page (src/components/EditSheet.tsx); for staff the
// link is dropped by forViewer, like every other /admin link.
import { listEntries, SHARED } from './cms.mjs';

/** Pages with lists of entries. */
const LIST_PAGES = new Set(['food-matrix', 'the-bar/cocktails', 'the-bar/wine', 'the-bar/beer-and-draft', 'the-bar/back-bar']);
const COL_OF = { recipe: 'recipe', signature: 'house', classic: 'classic', 'wine-list': 'wine', shelf: 'shelf' };
/** The fields that say which group an entry sits in, per collection. */
const GROUP_KEYS = { recipe: ['course'], house: ['menuSection'], classic: ['family'], wine: ['list', 'color', 'country'], shelf: ['spirit'], beer: ['serve'] };
const FAMILY = { Stirred: 'Stirred', Shaken: 'Shaken', Tall: 'Tall and Bubbly', Tropical: 'Tropical and Tiki', Brunch: 'Brunch', Hot: 'Hot and After Dinner' };

export const addHref = (col, preset = {}) => {
  const q = new URLSearchParams(Object.entries(preset).filter(([, v]) => v)).toString();
  return `/admin/pages/${col}/new${q ? '?' + q : ''}`;
};

function label(col, p) {
  if (col === 'recipe') return 'Add a Dish' + (p.course ? ` to ${p.course}` : '');
  if (col === 'house') return 'Add a House Cocktail' + (p.menuSection ? ` to ${p.menuSection}` : '');
  if (col === 'classic') return 'Add a Classic' + (p.family ? ` to ${FAMILY[p.family] || p.family}` : '');
  if (col === 'shelf') return 'Add a Bottle' + (p.spirit ? ` · ${p.spirit}` : '');
  if (col === 'beer') return p.serve === 'Draft' ? 'Add a Draft Beer' : p.serve === 'Bottle' ? 'Add a Bottled Beer' : 'Add a Beer';
  if (col === 'wine') {
    const kind = p.color === 'Bubbles' ? 'Sparkling Wine' : p.color ? `${p.color} Wine` : 'Wine';
    const where = p.list === 'By the glass' ? ' by the Glass' : p.list === 'Sommelier selection' ? ' · Sommelier Selection' : p.country ? ` from ${p.country === 'Around the world' ? 'Around the World' : p.country}` : '';
    return `Add a ${kind}${where}`;
  }
  return 'Add';
}

/** The node drawn as an Add row (or an Add tile in a row of cards). */
export function addNode(col, preset, { tile = false, meta = {}, inset = 0 } = {}) {
  const l = label(col, preset);
  return { t: 'F', n: 'Add · ' + l, to: addHref(col, preset), sh: 'F', sv: 'H', meta: { ...meta, add: { label: l, tile, inset } } };
}

function entriesBySlug(db, store) {
  const m = new Map();
  for (const col of Object.values(COL_OF)) for (const e of listEntries(db, col, SHARED.has(col) ? null : store)) m.set('/' + e.slug, { col, data: e.data });
  return m;
}

/** The values every entry in a run shares (e.g. all are course "Mains"). */
function common(col, items) {
  const out = {};
  for (const k of GROUP_KEYS[col] || []) {
    const vals = new Set(items.map((i) => i.data[k]).filter(Boolean));
    if (vals.size === 1) out[k] = [...vals][0];
  }
  return out;
}

export function addRows(page, slug, db, store) {
  if (!page?.main || !LIST_PAGES.has(slug)) return;
  const bySlug = entriesBySlug(db, store);
  const isEntry = (c) => c.to && bySlug.has(c.to.split(/[?#]/)[0]);
  const walk = (n) => {
    if (!n.c?.length) return;
    n.c.forEach(walk);
    if (!n.c.some(isEntry)) return;
    // Each run of entries (split by group headers) gets its own Add row after it.
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const items = run.map((c) => bySlug.get(c.to.split(/[?#]/)[0]));
      const col = items[0].col;
      if (items.every((i) => i.col === col)) {
        const last = run[run.length - 1];
        const meta = last.meta?.inGroup ? { inGroup: last.meta.inGroup, show: { req: (last.meta.show?.req || []).filter((k) => k.startsWith('course:')) } } : {};
        out.push(addNode(col, common(col, items), { tile: n.lm === 'H', meta, inset: last.pd ? last.pd[3] : 0 }));
      }
      run = [];
    };
    for (const c of n.c) {
      if (isEntry(c)) { run.push(c); out.push(c); continue; }
      flush(); out.push(c);
    }
    flush();
    n.c = out;
  };
  walk(page.main);
  // Beer has no pages of its own: the tap table and the bottle list get one each.
  if (slug === 'the-bar/beer-and-draft') {
    const tap = findNode(page.main, (x) => x.n === 'Tap table');
    if (tap?.c) { const i = tap.c.findIndex((x) => x.n === 'Footer'); tap.c.splice(i < 0 ? tap.c.length : i, 0, addNode('beer', { serve: 'Draft' }, { inset: tap.c.find((x) => (x.n || '').startsWith('Row · '))?.pd?.[3] || 0 })); }
    const bottles = findNode(page.main, (x) => x.n === 'Bottle list');
    if (bottles?.c) { const i = bottles.c.findIndex((x) => x.n === 'Footnote'); bottles.c.splice(i < 0 ? bottles.c.length : i, 0, addNode('beer', { serve: 'Bottle' })); }
  }
}

function findNode(n, pred) { if (pred(n)) return n; for (const c of n.c || []) { const h = findNode(c, pred); if (h) return h; } return null; }
