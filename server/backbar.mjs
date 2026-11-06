// The Back Bar (Tommy, Oct 31: "a page for each one of these spirits … an inventory list that can live inside the app").
//   • The Back Bar page (Figma 294:2): every bottle on the shelf, by spirit, each one linked to its own page.
//   • A page for every bottle (template: Shelf · Willett Family Estate Rye, 295:2). No brand photos: the bottle is drawn.
// Everything here comes from the shelf list in the admin, the house cocktail builds and the spirit and style pages.
import { clone, find, findAll, byName, startsWith, texts, setText, fitTitle } from './templates.mjs';
import { SHELF } from './cms.mjs';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const lower = (s) => String(s || '').toLowerCase();
const an = (w) => (/^[aeiouáéíóú]/i.test(w) ? 'An ' : 'A ');
const list = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

/** House cocktails that pour this bottle (matched on the build's ingredient names). */
export function drinksWith(bottle, house) {
  const n = norm(bottle.data.name.replace(/^(BRG|DCD) /, ''));
  return house.filter((h) => (h.data.build || []).some((b) => {
    const ing = norm(b?.ingredient);
    return ing && (ing.includes(n) || (ing.length > 8 && n.includes(ing)));
  }));
}

/** Spirits in shelf order, biggest first. Whiskeys with only a bottle or two share an "Other whiskey" group. */
export function shelfGroups(shelf) {
  const by = new Map();
  for (const e of shelf) { const k = e.data.spirit || 'Other'; if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
  const groups = [];
  const other = { key: 'Other whiskey', page: 'spirit/whiskey', items: [] };
  for (const [key, items] of by) {
    const sh = SHELF.find((x) => x.key === key);
    if (sh?.whiskey && items.length < 3) other.items.push(...items);
    else groups.push({ key, page: sh?.page || null, items });
  }
  if (other.items.length) groups.push(other);
  for (const g of groups) g.items.sort((a, b) => a.data.name.localeCompare(b.data.name, 'en', { sensitivity: 'base' }));
  const order = (g) => (g.key === 'Other whiskey' ? 1 : 0);
  return groups.sort((a, b) => order(a) - order(b) || b.items.length - a.items.length || SHELF.findIndex((x) => x.key === a.key) - SHELF.findIndex((x) => x.key === b.key));
}
/** The drawn spirit bottle (Figma: Filler · Spirit bottle), shown for every bottle until there's a photo of our own. */
export const SPIRIT_FILLER = '/img/spirit-bottle-filler.jpg';
const art = (w, h) => ({ t: 'R', n: 'IMG/Spirit bottle · drawn', w, h, sh: 'L', sv: 'L', f: [{ img: SPIRIT_FILLER, m: 'FIT' }] });
const label = (key) => (key === 'Liqueur' ? 'Liqueurs' : key);

/** The Back Bar page. */
export function fillBackBar(page, shelf, house) {
  const m = page.main;
  const groups = shelfGroups(shelf);
  const cards = m.c.filter(startsWith('Spirit · '));
  if (!cards.length) return;
  const proto = clone(cards[0]);
  const rows = findAll(proto, startsWith('Bottle · '));
  const plainRow = rows.find((r) => !find(r, byName('Used in'))), usedRow = rows.find((r) => find(r, byName('Used in')));
  const made = groups.map((g) => {
    const card = clone(proto);
    card.n = 'Spirit · ' + label(g.key);
    const title = find(card, byName('Title'));
    setText(texts(title)[0], label(g.key).toUpperCase());
    setText(texts(find(title, byName('Count')))[0], `${g.items.length} bottle${g.items.length === 1 ? '' : 's'}`);
    const learn = find(card, byName('Learn link'));
    if (g.page) { setText(learn, g.key === 'Other whiskey' ? 'The Whiskey Family →' : `Learn ${label(g.key)} →`); learn.to = '/' + g.page; }
    else { const head = find(card, byName('Head')); head.c = head.c.filter((c) => c !== learn); }
    find(card, byName('Bottles')).c = g.items.map((e) => {
      const d = e.data, uses = drinksWith(e, house);
      const r = clone(uses.length ? usedRow : plainRow);
      r.n = 'Bottle · ' + d.name;
      r.to = '/' + e.slug;
      const tile = find(r, byName('Drawing'));
      if (tile) { tile.f = [{ c: '#E7DECF' }]; tile.c = [art(tile.w, tile.h)]; tile.clip = 1; }
      setText(find(r, byName('Name')), d.name + (d.limited ? '\u00a0*' : ''));
      const styles = (d.styles || []).join(', ');
      setText(find(r, byName('Style')), [styles || d.spirit, d.price ? `$${String(d.price).replace(/^\$/, '')}` : ''].filter(Boolean).join(' · '));
      if (uses.length) setText(find(r, byName('Used in')), 'In ' + list(uses.map((h) => h.data.name)));
      r._find = norm([d.name, d.spirit, styles, ...uses.map((h) => h.data.name)].join(' '));
      return r;
    });
    card._g = g.key;
    card._find = norm([g.key, ...g.items.map((e) => e.data.name), ...g.items.flatMap((e) => e.data.styles || [])].join(' '));
    return card;
  });
  const at = m.c.indexOf(cards[0]);
  m.c = [...m.c.slice(0, at), ...made, ...m.c.slice(at).filter((c) => !startsWith('Spirit · ')(c) && c.n !== 'More spirits')];
  // The counts at the top.
  const stat = (name, n) => { const s = find(m, byName(name)); if (s) setText(texts(s)[0], String(n)); };
  stat('Stat · bottles', shelf.length);
  stat('Stat · spirits', new Set(shelf.map((e) => e.data.spirit)).size);
  const lim = shelf.filter((e) => e.data.limited).length;
  if (lim) stat('Stat · limited *', lim);
  else { const st = find(m, byName('Stats')); if (st) st.c = st.c.filter((c) => c.n !== 'Stat · limited *'); }
  if (!lim) { const f = find(m, byName('Footnote')); if (f) m.c = m.c.filter((c) => c !== f); }
  // The filter chips, one per group (wired in interact.mjs).
  const filter = find(m, byName('Filter'));
  if (filter) {
    const all = filter.c.find((c) => c.n === 'Chip · All'), plain = filter.c.find((c) => c.n !== 'Chip · All');
    filter.c = [['All', shelf.length], ...groups.map((g) => [label(g.key), g.items.length, g.key])].map(([l, n, key]) => {
      const c = clone(l === 'All' ? all : plain);
      c.n = 'Chip · ' + l; c._val = key || 'All';
      const [a, b] = texts(c); setText(a, l); setText(b, String(n));
      return c;
    });
    filter._protos = { on: all, off: plain };
  }
}

/** A bottle's own page, from the template. */
export function bottlePage(tpl, e, { shelf, house, index, basePage }) {
  const page = clone(tpl);
  const m = page.main, d = e.data;
  page.id = 'e' + e.id; page.name = 'Back Bar · ' + d.name;
  const uses = drinksWith(e, house);
  const styles = d.styles || [];
  const spirit = d.spirit || 'Spirit';
  const sh = SHELF.find((x) => x.key === spirit);
  // Spirit names that are places keep their capital ("a Canadian whisky").
  const word = /^(Canadian|Irish|Japanese|Scotch)/.test(spirit) ? spirit : lower(spirit === 'Liqueur' ? 'liqueur' : spirit);
  // The group it sits in on the Back Bar (small whiskeys share "Other whiskey").
  const group = shelfGroups(shelf).find((g) => g.items.some((x) => x.id === e.id));

  // Breadcrumb: The Bar / Back Bar / bottle
  const crumb = find(m, byName('Breadcrumb'));
  if (crumb) {
    const back = find(crumb, byName('Back')); if (back) back.to = '/the-bar/spirits';
    const tx = crumb.c.filter((c) => c.t === 'T');
    const bar = tx.find((t) => t.s === 'Back Bar'); if (bar) bar.to = '/the-bar/back-bar';
    setText(tx[tx.length - 1], d.name);
  }
  // Hero: the drawn spirit bottle on cream, like a wine with no photo.
  const hero = find(m, byName('Hero')), copy = find(hero, byName('Copy'));
  const panel = find(hero, startsWith('Bottle art'));
  if (panel) {
    panel.f = [{ c: '#E7DECF' }]; panel.c = [art(panel.w, panel.h)];
    // Our own bottle, spun on the spin scanner, replaces the drawing (Oct 31).
    if (d.spin?.length > 1) { const a = panel.c[0]; a.f = [{ img: d.spin[0], m: 'FIT' }]; a.n = 'IMG/Bottle · ' + d.name; a.meta = { ...(a.meta || {}), spin: d.spin }; }
  }
  const tags = find(copy, byName('Tags'));
  const pills = tags.c;
  setText(texts(pills[0])[0], spirit);
  if (styles[0]) setText(texts(pills[1])[0], styles[0]);
  setText(texts(pills[2])[0], d.limited ? 'Limited quantities' : 'On our back bar');
  tags.c = styles[0] ? pills : [pills[0], pills[2]];
  const [script, title, line] = copy.c.filter((c) => c.t === 'T');
  setText(script, uses.length ? `The ${word} in ${uses[0].data.name}` : d.tier ? `${d.tier} on our back bar` : 'From our back bar');
  fitTitle(title, d.name.toUpperCase(), copy.w - (copy.pd ? copy.pd[1] + copy.pd[3] : 0));
  // "Straight Rye" is already a rye: no "straight rye rye".
  const kind = !styles[0] ? word : lower(styles[0]).includes(lower(word)) ? lower(styles[0]) : `${lower(styles[0])} ${word}`;
  setText(line, d.notes || `${an(kind)}${kind} on our back bar${uses.length ? `, and the ${word} we pour in ${list(uses.map((h) => h.data.name))}` : ''}.${d.limited ? ' Limited quantities.' : ''}`);
  const stats = find(copy, byName('Stats'));
  const vals = [spirit, styles.join(', ') || '—', d.price ? `$${String(d.price).replace(/^\$/, '')}` : 'Bar lead to add', d.tier || String(uses.length)];
  const heads = ['SPIRIT', 'STYLE', 'POUR PRICE', d.tier ? 'TIER' : 'IN OUR DRINKS'];
  stats.c.forEach((s, i) => { const t = texts(s); if (t[0]) setText(t[0], heads[i]); if (t[1]) setText(t[1], vals[i]); });

  // The style: taste from the style page (or the spirit page), linked to it.
  const taste = find(m, byName('Taste'));
  const parentSlug = sh?.page || (sh?.whiskey ? 'spirit/whiskey' : null);
  const stylePage = parentSlug && styles.map((s) => index.find((x) => x.slug.startsWith(sh.sub || parentSlug + '/') && norm(x.title) === norm(s))).find(Boolean);
  const source = stylePage || (parentSlug && index.find((x) => x.slug === parentSlug));
  const sourceTaste = source && find(basePage(source.file)?.main || {}, byName('Taste'));
  if (taste && sourceTaste) {
    const words = findAll(sourceTaste, startsWith('Pill · ')).map((p) => texts(p)[0]?.s).filter(Boolean);
    const sentence = texts(sourceTaste).filter((t) => !findAll(sourceTaste, startsWith('Pill · ')).some((p) => texts(p).includes(t))).pop()?.s || '';
    const head = texts(taste);
    setText(head[0], stylePage ? 'The style' : 'The spirit');
    setText(head[1], (stylePage ? stylePage.title : source.title).toUpperCase());
    const flav = find(taste, byName('Flavors'));
    const proto = flav?.c?.[0];
    if (flav && proto) flav.c = words.slice(0, 5).map((w) => { const p = clone(proto); p.n = 'Pill · ' + w; setText(texts(p)[0], w); return p; });
    if (flav && !words.length) taste.c = taste.c.filter((c) => c !== flav);
    setText(head[head.length - 1], `${sentence} From the ${stylePage ? stylePage.title : source.title} page →`.trim());
    taste.to = '/' + source.slug;
  } else if (taste) remove(m, taste);

  // In our drinks
  const drinks = find(m, byName('In our drinks'));
  if (drinks) {
    const proto = find(drinks, startsWith('Drink · '));
    const price = find(drinks, byName('Our price'));
    drinks.c = drinks.c.filter((c) => c !== price);
    if (!uses.length || !proto) remove(m, drinks);
    else {
      const at = drinks.c.indexOf(proto);
      const made = uses.map((h) => {
        const r = clone(proto);
        r.n = 'Drink · ' + h.data.name; r.to = '/' + h.slug;
        const img = find(r, (n) => (n.n || '').startsWith('IMG/'));
        if (img) img.f = h.data.photo ? [{ img: h.data.photo, m: 'FILL' }] : [{ c: '#3A3632' }];
        const build = (h.data.build || []).filter((b) => b?.ingredient);
        const mine = build.find((b) => drinksWith(e, [{ data: { build: [b] } }]).length);
        const rest = build.filter((b) => b !== mine).map((b) => b.ingredient);
        const [nm, ln] = texts(find(r, byName('Copy')));
        setText(nm, h.data.name);
        setText(ln, `With ${list(rest)}.`); // no pour amount (Nov 5): amounts live on Cocktail Specs
        return r;
      });
      drinks.c = [...drinks.c.slice(0, at), ...made, ...drinks.c.slice(at + 1)];
    }
  }

  // More of the same spirit, each linked to its page.
  const same = shelf.filter((x) => x.data.spirit === spirit);
  const kin = group ? group.items : same;
  const more = find(m, byName('Also on the shelf'));
  if (more) {
    const others = kin.filter((x) => x.id !== e.id);
    const chips = find(more, byName('Bottles'));
    const proto = chips?.c?.[0];
    if (!others.length || !proto) remove(m, more);
    else {
      const head = texts(more);
      setText(head[1], `MORE ${group?.key === 'Other whiskey' ? 'WHISKEY' : spirit === 'Liqueur' ? 'LIQUEURS' : spirit.toUpperCase()} ON THE SHELF`);
      chips.c = others.slice(0, 8).map((x) => { const c = clone(proto); c.n = 'Bottle · ' + x.data.name; c.to = '/' + x.slug; setText(texts(c)[0], x.data.name + (x.data.limited ? ' *' : '')); return c; });
      const link = find(more, byName('Link'));
      if (link) { setText(link, `See the Whole Back Bar →`); link.to = '/the-bar/back-bar'; }
    }
  }
  // Say it at the table: only once the bar lead has written one.
  const say = find(m, byName('Say it'));
  if (say) { if (d.say) setText(texts(say).pop(), `“${d.say.replace(/^[“"]|[”"]$/g, '')}”`); else remove(m, say); }

  // A column left with nothing in it goes, and the other one takes the width.
  const body = find(m, byName('Body'));
  if (body?.c) {
    body.c = body.c.filter((col) => (col.c || []).length);
    if (body.c.length === 1) { body.c[0].sh = 'L'; }
    if (!body.c.length) remove(m, body);
  }

  // Previous / next bottle of the same spirit.
  const nav = find(m, byName('Bottle nav'));
  if (nav) {
    const sorted = group ? group.items : [...same].sort((a, b) => a.data.name.localeCompare(b.data.name, 'en', { sensitivity: 'base' }));
    const i = sorted.findIndex((x) => x.id === e.id);
    if (sorted.length < 2) remove(m, nav);
    else {
      const prev = sorted[(i - 1 + sorted.length) % sorted.length], next = sorted[(i + 1) % sorted.length];
      const [pb, nb] = nav.c;
      setText(texts(pb)[1], prev.data.name); pb.to = '/' + prev.slug;
      setText(texts(nb)[1], next.data.name); nb.to = '/' + next.slug;
    }
  }
  return page;
}

function remove(root, target) {
  (function walk(n) { if (!n.c) return; n.c = n.c.filter((c) => c !== target); n.c.forEach(walk); })(root);
}
