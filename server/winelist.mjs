// The wine list (CMS records, no pages of their own). It fills:
//   • By the glass and By the bottle on the Wine page (designed on the Wine page in Figma)
//   • "On our list" on every wine style, country, grape and region page (designed on Cabernet)
import { clone, find, byName, startsWith, texts, setText } from './templates.mjs';
import { wineKind } from './wine.mjs';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const WINE_PAGE = '25-2', CARD_PAGE = '68-2';

let P;
function protos(basePage) {
  if (P) return P;
  const wine = basePage(WINE_PAGE).main;
  const glassCard = find(wine, byName('Glass list · Red'));
  const usa = find(wine, byName('Country · USA'));
  P = {
    glassRow: glassCard.c.find(startsWith('Wine · ')),
    bottleRow: usa.c.find(startsWith('Wine · ')),
    group: usa.c.find(startsWith('Group · ')),
    card: find(basePage(CARD_PAGE).main, byName('On our list')),
  };
  return P;
}

const isGlass = (d) => d.list === 'By the glass' || d.list === 'Sommelier selection';
/** One wine as a row: title, the line under it, and its prices (glass, ½ bottle, bottle; or just the bottle). */
function row(p, d, title, line, width) {
  const r = clone(isGlass(d) && d.glass ? p.glassRow : p.bottleRow);
  if (width) r.w = width; // rows span their card (prices stay on the right)
  r.n = 'Pour · ' + d.name;
  const t = texts(r);
  setText(t[0], title);
  setText(t[1], line);
  const cells = t.slice(2);
  if (cells.length === 3) { setText(cells[0], d.glass || '—'); setText(cells[1], d.half || '—'); setText(cells[2], d.bottle || '—'); }
  else setText(cells[0], d.bottle || '—');
  return r;
}
const line = (...parts) => parts.filter(Boolean).join(' · ');

/** The Wine page: glass lists, sommelier selections, and the bottle list by country. */
export function fillWinePage(page, wines, basePage) {
  const p = protos(basePage);
  const data = wines.map((e) => e.data);
  if (!data.length) return;
  const inner = (card) => card.w - (card.pd ? card.pd[1] + card.pd[3] : 0);
  const menuRow = (card) => (d) => row(p, d, d.grape || d.name, line(d.name, d.region, d.size), inner(card));
  const refill = (card, list) => { if (card) card.c = [...card.c.filter((c) => !startsWith('Wine · ')(c)).slice(0, 1), ...list.map(menuRow(card)), ...card.c.filter((c) => !startsWith('Wine · ')(c)).slice(1)]; };
  refill(find(page.main, byName('Glass list · White')), data.filter((d) => d.list === 'By the glass' && d.color !== 'Red'));
  refill(find(page.main, byName('Glass list · Red')), data.filter((d) => d.list === 'By the glass' && d.color === 'Red'));
  refill(find(page.main, byName('Sommelier selections')), data.filter((d) => d.list === 'Sommelier selection'));
  for (const country of ['USA', 'Italy', 'France', 'Around the world', 'Bubbles']) {
    const card = find(page.main, byName('Country · ' + country));
    if (!card) continue;
    const list = country === 'Bubbles' ? data.filter((d) => d.list === 'Bubbles') : data.filter((d) => d.list === 'By the bottle' && d.country === country);
    const head = card.c[0];
    const groups = country === 'Bubbles' ? [[null, list]] : [['WHITES', list.filter((d) => d.color !== 'Red')], ['REDS', list.filter((d) => d.color === 'Red')]];
    card.c = [head];
    for (const [g, items] of groups) {
      if (!items.length) continue;
      if (g) { const gl = clone(p.group); gl.n = 'Group · ' + g; setText(texts(gl)[0], g); card.c.push(gl); }
      card.c.push(...items.map(menuRow(card)));
    }
  }
}

/** Which wines belong on a wine page. */
function winesFor(slug, title, data) {
  const kind = wineKind(slug);
  if (kind === 'country') return data.filter((d) => norm(d.country) === norm(title));
  if (kind === 'style') {
    const color = { red: 'Red', white: 'White', sparkling: 'Bubbles' }[slug.split('/')[1]];
    if (color) return data.filter((d) => d.color === color);
    if (slug === 'wine/rose') return data.filter((d) => /\bros[eé](?![a-z])/i.test(d.grape || '') || (d.pages || []).some((x) => norm(x) === 'sparklingrose'));
    return [];
  }
  return data.filter((d) => (d.pages || []).some((x) => norm(x) === norm(title)));
}

/** "On our list" on a wine page: our wines from it, glass pours first. Long lists go full width in two columns. */
export function fillWineShelf(page, slug, title, wines, basePage) {
  const p = protos(basePage);
  const order = { 'Sommelier selection': 0, 'By the glass': 1, 'By the bottle': 2, Bubbles: 3 };
  const list = winesFor(slug, title, wines.map((e) => e.data)).sort((a, b) => (order[a.list] ?? 9) - (order[b.list] ?? 9));
  const target = find(page.main, byName('On our shelf')) || find(page.main, byName('On our list'));
  if (!list.length || !target) return;
  const parentOf = (root, node) => (root.c || []).includes(node) ? root : (root.c || []).reduce((hit, c) => hit || parentOf(c, node), null);
  const body = page.main.c.find((c) => c.n === 'Body');
  const wide = list.length > 12 && body && find(body, (n) => n === target);
  const card = clone(p.card);
  const pad = card.pd ? card.pd[1] + card.pd[3] : 0;
  const width = (wide ? body.w : target.w);
  const hasGlass = list.some((d) => isGlass(d) && d.glass);
  const at = card.c.findIndex(startsWith('Wine · '));
  const head = card.c.find((c) => c.n === 'Head');
  const before = card.c.slice(0, at).filter((c) => c.n !== 'Head');
  const after = card.c.slice(at).filter((c) => !startsWith('Wine · ')(c));
  const lineFor = (d) => line(d.grape, d.region, d.size, d.list === 'Sommelier selection' && 'Sommelier selection');
  if (!wide) {
    const inner = width - pad;
    const rows = list.map((d) => row(p, d, d.name, lineFor(d), inner));
    if (head) head.w = inner;
    card.c = [...before, ...(hasGlass && head ? [head] : []), ...rows, ...after];
  } else {
    const gap = 32, colW = (width - pad - gap) / 2, half = Math.ceil(list.length / 2);
    const col = (items, i) => ({ t: 'F', n: 'Column ' + i, w: colW, h: 10, sh: 'F', sv: 'H', lm: 'V',
      c: [...(items.some((d) => isGlass(d) && d.glass) && head ? [{ ...clone(head), w: colW }] : []), ...items.map((d) => row(p, d, d.name, lineFor(d), colW))] });
    card.c = [...before, { t: 'F', n: 'Columns', w: width - pad, h: 10, sh: 'F', sv: 'H', lm: 'H', gap, c: [col(list.slice(0, half), 1), col(list.slice(half), 2)] }, ...after];
  }
  for (const c of card.c) if (c.n === 'Footnote') c.w = width - pad;
  card.w = width;
  if (wide) {
    const parent = parentOf(page.main, target);
    parent.c = parent.c.filter((c) => c !== target);
    card.sh = 'F'; card.sv = 'H';
    page.main.c.splice(page.main.c.indexOf(body) + 1, 0, card);
  } else {
    const keep = { sh: target.sh, sv: target.sv };
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, card, keep);
  }
}

/** Search words: each wine on its pages and on the Wine page. */
export function wineSearchText(index, wines) {
  const out = new Map();
  const add = (slug, s) => out.set(slug, ((out.get(slug) || '') + ' ' + s).trim());
  for (const e of wines) {
    const d = e.data;
    const words = [d.name, d.grape, d.region].filter(Boolean).join(' ');
    add('the-bar/wine', words);
    for (const x of index) if (wineKind(x.slug) && winesFor(x.slug, x.title, [d]).length) add(x.slug, words);
  }
  return out;
}
