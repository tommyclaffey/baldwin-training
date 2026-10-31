// The back bar and the beer list: CMS records with no page of their own. They fill the lists the design holds:
//   • "On our shelf" on each spirit page (grouped by style) and on each style page (designed on Bourbon / Wheated)
//   • "Our whiskey shelf" on the Whiskey page, grouped by type
//   • the tap wall, tap table and "In bottles" on Beer & Draft, and "On our list" on each beer style page (Pilsner)
import { clone, find, byName, startsWith, texts, setText, remove } from './templates.mjs';
import { SHELF, BEER_STYLES } from './cms.mjs';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const SOURCES = { main: '49-2842', sub: '56-484', beer: '44-456', draft: '26-2' };

let P;
function protos(basePage) {
  if (P) return P;
  const main = find(basePage(SOURCES.main).main, byName('On our shelf'));
  const groups = find(main, byName('Groups'));
  const chips = groups.c.flatMap((g) => find(g, byName('Bottles')).c);
  const beerCard = find(basePage(SOURCES.beer).main, byName('On our list'));
  const draftPage = basePage(SOURCES.draft).main;
  P = {
    main,
    linked: groups.c.find((g) => find(g, byName('Head')).to),
    unlinked: groups.c.find((g) => !find(g, byName('Head')).to),
    chip: chips.find((c) => !find(c, byName('Limited'))),
    limited: chips.find((c) => find(c, byName('Limited'))),
    sub: find(basePage(SOURCES.sub).main, byName('On our shelf')),
    beerCard,
    draftRow: find(beerCard, startsWith('Draft · ')),
    tapRow: find(draftPage, (n) => n.n === 'Row · Stella Artois'),
    bottleSection: find(draftPage, byName('Section · In bottles')),
  };
  return P;
}

function chip(p, it) {
  const c = clone(it.limited ? p.limited : p.chip);
  c.n = 'Bottle · ' + it.name;
  if (it.slug) c.to = '/' + it.slug;
  setText(texts(c)[0], it.name);
  return c;
}

/** Group rows: a label (linked to its page when it has one), a count, and the bottles. */
function fillGroups(p, groupsNode, groups) {
  groupsNode.c = groups.filter((g) => g.items.length).map((g) => {
    const node = clone(g.to ? p.linked : p.unlinked);
    node.n = 'Group · ' + g.label;
    const head = find(node, byName('Head'));
    head.to = g.to || undefined;
    setText(texts(head)[0], g.label.toUpperCase());
    setText(find(head, byName('Count')), '· ' + g.items.length);
    find(node, byName('Bottles')).c = g.items.map((it) => chip(p, it));
    return node;
  });
}
function footnote(card, items, what) {
  const t = find(card, byName('Footnote'));
  if (t) setText(t, (items.some((i) => i.limited) ? '* Limited quantities. ' : '') + what);
}
/** Puts a card in another card's place, at that card's width (full-width rows follow). */
function place(target, card) {
  const grow = target.w - card.w;
  if (grow) {
    card.w = target.w;
    const fit = (n) => { for (const c of n.c || []) if (c.sh === 'F' && Math.abs(c.w - (n.w - grow) + (n.pd ? n.pd[1] + n.pd[3] : 0)) <= 4) { c.w += grow; fit(c); } };
    fit(card);
  }
  const keep = { sh: target.sh, sv: target.sv };
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, card, keep);
}

const bottleOf = (e) => ({ slug: e.slug, name: e.data.name, limited: !!e.data.limited, styles: (e.data.styles || []).map(norm), spirit: e.data.spirit });

/** Spirit pages, their style pages, the Whiskey page. */
export function fillShelf(page, slug, index, bottles, basePage) {
  const p = protos(basePage);
  const all = bottles.map(bottleOf);
  const subsOf = (sh) => index.filter((e) => sh.page && e.slug.startsWith(sh.sub || sh.page + '/'));

  if (slug === 'spirit/whiskey') {
    const list = find(page.main, byName('Bottle list'));
    if (!list) return;
    const groups = SHELF.filter((sh) => sh.whiskey).map((sh) => ({ label: sh.key === 'Canadian whisky' ? 'Canadian' : sh.key, to: sh.page ? '/' + sh.page : null, items: all.filter((b) => b.spirit === sh.key) }));
    fillGroups(p, find(list, byName('Groups')), groups);
    footnote(list, groups.flatMap((g) => g.items), 'Sorted by type from our spirit list; bar lead to confirm.');
    return;
  }

  const main = SHELF.find((sh) => sh.page === slug);
  if (main) {
    const items = all.filter((b) => b.spirit === main.key);
    const card = find(page.main, byName('On our shelf'));
    if (!items.length || !card) return;
    const subs = subsOf(main);
    const home = (b) => subs.find((s) => b.styles.includes(norm(s.title)));
    const groups = subs.map((s) => ({ label: s.title, to: '/' + s.slug, items: items.filter((b) => home(b) === s) }));
    groups.push({ label: 'More ' + main.key.toLowerCase(), to: null, items: items.filter((b) => !home(b)) });
    const made = clone(p.main);
    fillGroups(p, find(made, byName('Groups')), groups);
    footnote(made, items, 'Sorted by style from our spirit list; bar lead to confirm.');
    place(card, made);
    return;
  }

  const parent = SHELF.find((sh) => sh.page && slug.startsWith(sh.sub || sh.page + '/'));
  if (parent) {
    const title = index.find((e) => e.slug === slug)?.title;
    const items = all.filter((b) => b.spirit === parent.key && b.styles.includes(norm(title)));
    const card = find(page.main, byName('On our shelf'));
    if (!items.length || !card) return;
    const made = clone(p.sub);
    find(made, byName('Bottles')).c = items.map((it) => chip(p, it));
    footnote(made, items, 'From our menu; bar lead to confirm the style.');
    place(card, made);
  }
}

/** Beer & Draft: the tap wall, the tap table and "In bottles". */
export function fillBeerPage(page, index, beers, basePage) {
  const p = protos(basePage);
  const drafts = beers.filter((b) => b.data.serve === 'Draft').sort((a, b) => (Number(a.data.tap) || 99) - (Number(b.data.tap) || 99) || a.sort - b.sort);
  const bottles = beers.filter((b) => b.data.serve !== 'Draft');
  const styleLine = (d) => [d.style === 'Rotating' ? 'Rotating · ask the bar' : d.style, d.abv].filter(Boolean).join(' · ');
  if (drafts.length) {
    const wall = find(page.main, byName('Tap wall'));
    const handles = find(wall, byName('Handles'));
    const protoTaps = handles.c.filter(startsWith('Tap '));
    handles.c = drafts.map((b, i) => {
      const t = clone(protoTaps[i % protoTaps.length]);
      t.n = 'Tap ' + (b.data.tap || i + 1);
      const tx = texts(t);
      setText(tx[0], b.data.tap || i + 1); setText(tx[1], b.data.name); setText(tx[2], styleLine(b.data));
      return t;
    });
    const pill = find(wall, startsWith('Pill · '));
    if (pill) { pill.n = 'Pill · From our menu'; setText(texts(pill)[0], 'From our menu · tap order to confirm'); }
    const table = find(page.main, byName('Tap table'));
    const rows = table.c.filter(startsWith('Row · '));
    const dots = rows.map((r) => find(r, byName('Number'))?.f);
    const at = table.c.indexOf(rows[0]);
    const made = drafts.map((b, i) => {
      const r = clone(p.tapRow);
      r.n = 'Row · ' + b.data.name;
      const num = find(r, byName('Number'));
      if (num && dots.length) num.f = dots[i % dots.length];
      const d = b.data;
      [d.tap || i + 1, d.name, 'On draft', d.style || '—', d.abv || '—', d.glass || '—', d.pour || '—', d.michigan ? 'Michigan' : '—', d.price ? '$' + d.price : '$—']
        .forEach((v, k) => texts(r)[k] && setText(texts(r)[k], v));
      return r;
    });
    table.c = [...table.c.slice(0, at).filter((c) => !startsWith('Row · ')(c)), ...made, ...table.c.slice(at).filter((c) => !startsWith('Row · ')(c))];
    const foot = find(table, byName('Footer'));
    if (foot) setText(texts(foot)[0], bottles.length ? 'Bottles are listed under In bottles, below.' : 'No bottles on our list yet.');
  }
  const styles = find(page.main, (n) => n.n === 'Styles' && (n.c || []).some(startsWith('Style · ')));
  for (const card of styles ? styles.c : []) tapPills(card, beers.filter((b) => norm(b.data.style) === norm(card.n.slice(8))));
  const sec = find(page.main, byName('Section · In bottles'));
  if (sec) {
    const list = find(sec, byName('Bottle list'));
    const styleSlug = (s) => index.find((e) => e.slug.startsWith('beer/') && norm(e.title) === norm(s))?.slug;
    const groups = BEER_STYLES.map((s) => ({ label: s, to: styleSlug(s) ? '/' + styleSlug(s) : null, items: bottles.filter((b) => b.data.style === s).map((b) => ({ name: b.data.name })) }));
    groups.push({ label: 'More', to: null, items: bottles.filter((b) => !BEER_STYLES.includes(b.data.style)).map((b) => ({ name: b.data.name })) });
    if (bottles.length) fillGroups(p, find(list, byName('Groups')), groups);
    else remove(page.main, sec);
  }
}

/** "On tap" pills follow the beer list: on tap (with its tap), in bottles, or gone. */
function tapPills(root, mine) {
  const draft = mine.find((b) => b.data.serve === 'Draft');
  const label = draft ? ['On tap', draft.data.tap && 'Tap ' + draft.data.tap].filter(Boolean).join(' · ') : mine.length ? 'In bottles' : '';
  const walk = (n) => {
    if (!n.c) return;
    n.c = n.c.filter((c) => {
      if (!(c.n || '').startsWith('Pill · On tap')) return true;
      if (!label) return false;
      c.n = 'Pill · ' + label; setText(texts(c)[0], label);
      return true;
    });
    n.c.forEach(walk);
  };
  walk(root);
}

/** A beer style page: what we pour on draft and what we have in bottles. */
export function fillBeerStyle(page, slug, index, beers, basePage) {
  const p = protos(basePage);
  const title = index.find((e) => e.slug === slug)?.title;
  const mine = beers.filter((b) => norm(b.data.style) === norm(title));
  tapPills(page.main, mine);
  const card = find(page.main, byName('On our taps')) || find(page.main, byName('On our list'));
  if (!card) return;
  const made = clone(p.beerCard);
  const pour = find(card, byName('Pour'));
  if (pour) { const i = made.c.findIndex((c) => c.n === 'Pour'); if (i >= 0) made.c[i] = clone(pour); }
  const drafts = mine.filter((b) => b.data.serve === 'Draft');
  const bottles = mine.filter((b) => b.data.serve !== 'Draft');
  const rowAt = made.c.findIndex(startsWith('Draft · '));
  const rows = drafts.map((b) => {
    const r = clone(p.draftRow);
    r.n = 'Draft · ' + b.data.name;
    const t = texts(r);
    setText(t[0], b.data.name.charAt(0)); setText(t[1], b.data.name); setText(t[2], ['On draft', b.data.tap && 'tap ' + b.data.tap, b.data.abv].filter(Boolean).join(' · '));
    return r;
  });
  made.c.splice(rowAt, 1, ...rows);
  if (!drafts.length) made.c = made.c.filter((c) => c.n !== 'ON DRAFT');
  const label = find(made, byName('IN BOTTLES'));
  const chips = find(made, byName('Bottles'));
  if (bottles.length) chips.c = bottles.map((b) => chip(p, { name: b.data.name }));
  else {
    made.c = made.c.filter((c) => c !== chips);
    if (drafts.length) made.c = made.c.filter((c) => c !== label);
    else setText(label, 'NOT ON OUR LIST RIGHT NOW · ASK THE BAR');
  }
  place(card, made);
}

/** Extra search words for pages whose lists come from the CMS. */
export function shelfSearchText(index, bottles, beers) {
  const out = new Map();
  const add = (slug, s) => slug && out.set(slug, ((out.get(slug) || '') + ' ' + s).trim());
  for (const b of bottles.map(bottleOf)) {
    const sh = SHELF.find((x) => x.key === b.spirit);
    if (!sh) continue;
    if (sh.page) add(sh.page, b.name);
    if (sh.whiskey) add('spirit/whiskey', b.name);
    for (const e of index) if (sh.page && e.slug.startsWith(sh.sub || sh.page + '/') && b.styles.includes(norm(e.title))) add(e.slug, b.name);
  }
  for (const b of beers) {
    add('the-bar/beer-and-draft', b.data.name);
    const e = index.find((x) => x.slug.startsWith('beer/') && norm(x.title) === norm(b.data.style));
    if (e) add(e.slug, b.data.name);
  }
  return out;
}
