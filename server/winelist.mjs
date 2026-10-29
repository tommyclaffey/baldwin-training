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
  if (d._slug) r.to = '/' + d._slug; // each wine opens its own page
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
  const data = wines.map((e) => ({ ...e.data, _slug: e.slug }));
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
  const list = winesFor(slug, title, wines.map((e) => ({ ...e.data, _slug: e.slug }))).sort((a, b) => (order[a.list] ?? 9) - (order[b.list] ?? 9));
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
    const words = [d.name, d.grape, d.region, d.notes].filter(Boolean).join(' ');
    add('the-bar/wine', words);
    for (const x of index) if (wineKind(x.slug) && winesFor(x.slug, x.title, [d]).length) add(x.slug, words);
  }
  return out;
}

/* ---- One page per wine (designed on "Wine List · Caymus" in Figma, section 06 · Wine) ---- */

// Wine Folly grape guides, checked Oct 28 2026 (each URL returned the grape's page, not a 404).
const FOLLY = {
  'cabernet sauvignon': 'cabernet-sauvignon', chardonnay: 'chardonnay', 'pinot noir': 'pinot-noir', 'sauvignon blanc': 'sauvignon-blanc',
  prosecco: 'prosecco', riesling: 'riesling', 'chianti classico': 'sangiovese', brunello: 'sangiovese', 'pinot grigio': 'pinot-grigio',
  'chenin blanc': 'chenin-blanc', rioja: 'tempranillo', malbec: 'malbec', merlot: 'merlot', 'cabernet franc': 'cabernet-franc',
  barolo: 'nebbiolo', barbaresco: 'nebbiolo', "moscato d'asti": 'muscat-blanc', 'gavi di gavi': 'cortese', zinfandel: 'zinfandel',
  viognier: 'viognier', vermentino: 'vermentino', verdicchio: 'verdicchio', garganega: 'garganega', "nero d'avola": 'nero-davola',
  'nerello mascalese': 'nerello-mascalese', barbera: 'barbera', montepulciano: 'montepulciano', ripasso: 'corvina', amarone: 'corvina',
  'gamay noir': 'gamay', 'gamay-pinot': 'gamay', syrah: 'syrah', shiraz: 'syrah', 'albariño': 'albarino', alvarinho: 'albarino',
};
const FOLLY_NAME = { sangiovese: 'Sangiovese', tempranillo: 'Tempranillo', nebbiolo: 'Nebbiolo', 'muscat-blanc': 'Muscat Blanc', cortese: 'Cortese', corvina: 'Corvina', gamay: 'Gamay', syrah: 'Syrah', albarino: 'Albariño' };
export const follyFor = (grape) => {
  const s = FOLLY[String(grape || '').toLowerCase().trim()];
  return s && { url: `https://winefolly.com/grapes/${s}/`, label: FOLLY_NAME[s] || grape };
};

/** Book serving temperatures (Wine Book, "Serve at"): bubbles, whites and rosé, light reds, full reds. */
export function serveAt(d) {
  const rose = /\bros[eé](?![a-z])/i.test(d.grape || '');
  if (d.color === 'Sake') return null;
  if (d.color === 'Bubbles') return ['40–45°F', 'Bubbles at 40 to 45°F.'];
  if (d.color === 'White' || rose) return ['45–50°F', `${rose ? 'Rosé' : 'Whites'} at 45 to 50°F.`];
  if (d.color === 'Red') return Number(d.body) && Number(d.body) <= 3 ? ['55–60°F', 'Light reds at 55 to 60°F.'] : ['60–65°F', 'Full reds at 60 to 65°F.'];
  return null;
}

// Sibling dot colours by wine colour (Red is the template's).
const DOT = { Red: '#4A0D1E', White: '#D8B861', Bubbles: '#E6D29A', 'Rosé': '#E3A0A0', Sake: '#E9E1CF' };
const money = (v) => (v && /^\d/.test(v) ? '$' + v : v || '—');
const LIST_LABEL = { 'By the glass': 'By the glass', 'Sommelier selection': 'Sommelier selection', 'By the bottle': 'By the bottle', Bubbles: 'Bubbles' };

/** The grape or region page a wine belongs to (first match in "Shows on these pages"), else its colour page. */
function parentPage(d, index) {
  const pages = (d.pages || []).map(norm);
  const kinds = ['grape', 'wine', 'region'];
  for (const k of kinds) {
    const hit = index.find((x) => wineKind(x.slug) === k && pages.includes(norm(x.title)));
    if (hit) return hit;
  }
  const color = { Red: 'wine/red', White: 'wine/white', Bubbles: 'wine/sparkling' }[d.color];
  return index.find((x) => x.slug === color) || index.find((x) => x.slug === 'the-bar/wine');
}

export function wineEntryPage(tpl, e, { all, index, recipes }) {
  const d = e.data;
  const main = clone(tpl.main);
  const parent = parentPage(d, index);
  const pTitle = parent ? parent.title : 'Wine';
  // Breadcrumb: Wine / <grape or region> / <wine>
  const bc = find(main, byName('Breadcrumb'));
  if (bc) {
    const crumb = find(bc, byName('Crumb · Parent'));
    if (crumb) { setText(texts(crumb)[0], pTitle); crumb.to = parent ? '/' + parent.slug : undefined; }
    const last = bc.c.filter((n) => n.t === 'T').pop();
    if (last) setText(last, d.name);
  }
  // Hero: bottle, list and style pills, name, line, prices, serving temperature
  const bottle = find(main, startsWith('IMG/Bottle'));
  if (bottle) {
    if (d.bottle_img) { bottle.f = [{ img: d.bottle_img, m: 'FIT' }]; bottle.w = 220; bottle.x = 70; }
    else bottle.f = [];
    bottle.n = 'IMG/Bottle · ' + d.name;
  }
  const src = find(main, byName('Source'));
  if (src) setText(src, d.bottle_img ? '' : 'PHOTO TO COME');
  const tags = find(main, byName('Tags'));
  if (tags) {
    const [p1, p2] = tags.c;
    setText(texts(p1)[0], LIST_LABEL[d.list] || 'On our list'); p1.n = 'Pill · ' + (d.list || '');
    const style = d.style || d.color;
    if (style && p2) { setText(texts(p2)[0], style); p2.n = 'Pill · ' + style; } else tags.c = [p1];
  }
  setText(find(main, byName('Title')), d.name.toUpperCase());
  setText(find(main, byName('Line')), line(d.grape, d.region, d.size));
  const stats = find(main, byName('Stats'));
  if (stats) {
    const serve = serveAt(d);
    const cell = (n) => stats.c.find((c) => c.n === n);
    const set = (n, v) => { const c = cell(n); if (c) setText(texts(c)[1], v); };
    set('Glass', money(d.glass)); set('Half', money(d.half)); set('Bottle', money(d.bottle));
    if (serve) set('Serve at', serve[0]);
    stats.c = stats.c.filter((c) => (c.n === 'Glass' || c.n === 'Half' ? !!d.glass : c.n === 'Serve at' ? !!serve : true));
  }
  // More from the same grape or region on our list
  const more = find(main, byName('More on our list'));
  if (more) {
    const siblings = all.filter((x) => x !== e && x.slug !== e.slug && (parent && winesFor(parent.slug, parent.title, [x.data]).length)).slice(0, 8);
    const grid = find(more, byName('Siblings'));
    if (!siblings.length || !grid) main.c = main.c.filter((c) => c !== more);
    else {
      setText(more.c.find((c) => c.t === 'T'), `MORE ${pTitle.toUpperCase()} ON OUR LIST`);
      const proto = grid.c[0];
      grid.c = siblings.map((x) => {
        const s = clone(proto);
        s.n = 'Sibling · ' + x.data.name; s.to = '/' + x.slug;
        const dot = find(s, (n) => n.t === 'E');
        if (dot) dot.f = [{ c: DOT[/\bros[eé](?![a-z])/i.test(x.data.grape || '') ? 'Rosé' : x.data.color] || DOT.Red }];
        const t = texts(s);
        setText(t[0], x.data.name);
        setText(t[1], line(x.data.region, x.data.glass ? `glass ${money(x.data.glass)}` : x.data.bottle ? `bottle ${money(x.data.bottle)}` : ''));
        return s;
      });
    }
  }
  // Left column: notes, profile, pairings
  const body = find(main, byName('Body'));
  const left = find(body, byName('Left'));
  const drop = (root, n) => { if (root && n) root.c = root.c.filter((c) => c !== n); };
  const notes = find(main, byName('Tasting notes'));
  if (d.notes) setText(find(notes, byName('Notes')), d.notes); else drop(left, notes);
  const prof = find(main, byName('Profile'));
  if (prof) {
    const rows = find(prof, byName('Rows'));
    const on = find(rows, byName('Dot · On')), off = find(rows, byName('Dot · Off'));
    const keys = { Body: 'body', Sweetness: 'sweet', Acidity: 'acid', Tannin: 'tannin' };
    rows.c = rows.c.filter((r) => {
      const v = Number(d[keys[r.n.slice(8)]]);
      if (!v) return false;
      const dots = r.c.find(startsWith('Dots · '));
      dots.n = `Dots · ${v} of 5`;
      dots.c = [1, 2, 3, 4, 5].map((i) => clone(i <= v ? on : off));
      return true;
    });
    if (!rows.c.length) drop(left, prof);
  }
  const pairs = find(main, byName('Pairs with'));
  const dishes = String(d.pairs || '').split(/,| · /).map((s) => s.trim()).filter(Boolean);
  if (!dishes.length) drop(left, pairs);
  else {
    const wrap = find(pairs, byName('Dishes'));
    const proto = wrap.c[0];
    wrap.c = dishes.map((name) => {
      const p = clone(proto); p.n = 'Dish · ' + name; setText(texts(p)[0], name);
      const r = recipes.find((x) => norm(x.data.name) === norm(name) && x.data.fullPage);
      p.to = r ? '/' + r.slug : undefined;
      return p;
    });
  }
  // Right column: say it, read more, serve it, part of
  const right = find(body, byName('Right'));
  const say = find(main, byName('Say it'));
  if (d.say) setText(texts(say)[1], `“${d.say.replace(/^[“"]|[”"]$/g, '')}”`); else drop(right, say);
  const read = find(main, byName('Read more'));
  if (read) {
    read.to = undefined;
    const folly = follyFor(d.grape);
    const q = encodeURIComponent([d.name.replace(/'/g, ''), d.grape, d.region].filter(Boolean).join(' '));
    const links = [
      folly && ['Link · Wine Folly', `${folly.label} · Wine Folly`, folly.url],
      ['Link · Vivino', `${d.name} · Vivino`, `https://www.vivino.com/search/wines?q=${q}`],
      d.producerUrl && ['Link · Producer', d.producerLabel || `${d.name} website`, d.producerUrl],
    ].filter(Boolean);
    read.c = read.c.filter((c) => !startsWith('Link · ')(c));
    const protoRow = find(tpl.main, byName('Link · Vivino'));
    for (const [n, label, url] of links) { const r = clone(protoRow); r.n = n; r.to = url; setText(texts(r)[0], label); read.c.push(r); }
  }
  const serveCard = find(main, byName('Serve it'));
  const serve = serveAt(d);
  if (serve) {
    const how = d.list === 'By the glass' || d.list === 'Sommelier selection'
      ? ' By the bottle, present it label-out to the host and pour a taste first.'
      : ' Present the bottle label-out to the host and pour a taste first.';
    setText(texts(serveCard)[2], serve[1] + how);
  } else drop(right, serveCard);
  const back = find(main, byName('Back to parent'));
  if (back) { back.to = parent ? '/' + parent.slug : '/the-bar/wine'; setText(texts(back)[1], pTitle); }
  // Previous / next on the list, in menu order
  const i = all.findIndex((x) => x.slug === e.slug);
  const nav = [['Button · Previous', all[i - 1]], ['Button · Next', all[i + 1]]];
  const sub = find(main, byName('Sub nav'));
  for (const [n, x] of nav) {
    const b = find(sub, byName(n));
    if (!b) continue;
    if (!x) { b.op = 0; b.to = undefined; continue; }
    b.to = '/' + x.slug; setText(texts(b)[1], x.data.name);
  }
  return { id: 'e' + e.id, name: 'Wine list · ' + d.name, bg: tpl.bg, main };
}
