// Classic cocktail pages, built from the CMS entry and the designed classic layout (Daiquiri in Figma).
import { clone, find, byName, startsWith, findAll, texts, setText, remove, repeat } from './templates.mjs';

export const FAMILIES = [
  { key: 'Stirred', pill: 'Stirred · spirit-forward', head: 'STIRRED · SPIRIT-FORWARD' },
  { key: 'Shaken', pill: 'Shaken · sours and more', head: 'SHAKEN · SOURS AND MORE' },
  { key: 'Tall', pill: 'Tall and bubbly', head: 'TALL AND BUBBLY' },
];
const img = (url) => (url ? [{ img: url, m: 'FILL' }] : [{ c: '#2A2724' }]);

/** All classics in menu order: by family, then the order set in the admin. */
export function classicOrder(entries) {
  return FAMILIES.flatMap((f) => entries.filter((e) => (e.data.family || 'Shaken') === f.key).sort((a, b) => a.sort - b.sort || a.id - b.id));
}

/**
 * @param tpl   the classic template page (Daiquiri)
 * @param e     the entry { id, slug, data }
 * @param ctx   { all: ordered entries, glassCard(glass), protos: { learnTile, linkedRiff, plainRiff } }
 */
export function classicPage(tpl, e, ctx) {
  const d = e.data;
  const main = clone(tpl.main);
  const name = d.name || 'New cocktail';
  const all = ctx.all;
  const n = all.findIndex((x) => x.id === e.id) + 1;
  const fam = FAMILIES.find((f) => f.key === d.family) || FAMILIES[1];

  const crumbs = find(main, byName('Breadcrumb'));
  setText(crumbs.c[crumbs.c.length - 1], name);

  // Hero
  const hero = find(main, byName('Hero'));
  const photo = find(hero, startsWith('IMG/'));
  photo.f = img(d.photo); photo.n = `IMG/${name}${d.photoCredit ? ' · ' + d.photoCredit : ''}`;
  const tags = find(hero, byName('Tags'));
  setText(texts(tags.c[0])[0], `Classic · ${n} of ${all.length}`);
  setText(texts(tags.c[1])[0], fam.pill);
  // allergy tag (e.g. raw egg white): uses the design's warning pill
  tags.c = tags.c.filter((c) => !(c.n || '').startsWith('Pill · Contains'));
  if (d.menuPrice) { const p = clone(tags.c[1]); p.n = 'Pill · On our menu'; setText(texts(p)[0], `On our menu · $${d.menuPrice}`); tags.c.push(p); }
  if (d.allergyTag && ctx.protos.allergyPill) { const p = clone(ctx.protos.allergyPill); p.n = 'Pill · ' + d.allergyTag; setText(texts(p)[0], d.allergyTag); tags.c.push(p); }
  const copy = find(hero, byName('Copy'));
  const ct = copy.c.filter((c) => c.t === 'T');
  setText(ct[0], d.tagline || '');
  setText(ct[1], name.toUpperCase());
  setText(ct[2], d.description || '');
  const stats = find(copy, byName('Stats'));
  for (const [label, key] of [['Glass', 'glass'], ['Method', 'method'], ['Ice', 'ice'], ['Garnish', 'garnish']]) setText(texts(find(stats, byName(label)))[1], d[key] || '—');

  // The classics strip: every classic, this one highlighted.
  const strip = find(main, byName('The classics'));
  const allChips = findAll(strip, (x) => (x.n || '').startsWith('Classic · ') && x.c);
  const activeProto = allChips.find((c) => !c.to) || allChips[0];
  const plainProto = allChips.find((c) => c.to) || allChips[0];
  for (const f of FAMILIES) {
    const box = find(strip, (x) => (x.n || '').startsWith('Family · ') && texts(x)[0]?.s === f.head);
    const drinks = box && find(box, byName('Drinks'));
    if (!drinks) continue;
    drinks.c = all.filter((x) => (x.data.family || 'Shaken') === f.key).map((x) => {
      const me = x.id === e.id;
      const c = clone(me ? activeProto : plainProto);
      c.n = 'Classic · ' + x.data.name;
      c.to = me ? undefined : '/' + x.slug;
      setText(texts(c)[0], x.data.name);
      const dot = find(c, (y) => y.t === 'E');
      if (dot) dot.f = [{ c: x.data.color || '#C49A6C' }];
      return c;
    });
  }

  // The build
  const ingr = find(find(main, byName('Build band')), byName('Ingredients'));
  const tiles = (ingr.c || []).filter(startsWith('Ingredient · '));
  const featured = tiles[0];
  const plain = ctx.protos.learnTile || tiles[1] || tiles[0];
  const build = (d.build || []).filter((b) => b && (b.amount || b.ingredient));
  ingr.c = build.map((b, i) => {
    const c = clone(b.spirit || (i === 0 && !build.some((x) => x.spirit)) ? featured : plain);
    c.n = 'Ingredient · ' + b.ingredient;
    const t = texts(c);
    setText(t[0], b.amount); setText(t[1], b.ingredient);
    c.to = b.link || undefined;
    if (!b.link) remove(c, find(c, byName('Learn')));
    return c;
  });

  const band = find(main, byName('Build band'));
  band.c = band.c.filter((c) => c.n !== 'Allergen note');
  if (d.allergyNote && ctx.protos.allergyNote) { const nt = clone(ctx.protos.allergyNote); setText(texts(nt)[0], d.allergyNote); band.c.push(nt); }

  // Steps
  const how = find(main, byName('How to make it'));
  repeat(how, (x) => /^Step \d+$/.test(x.n || ''), (d.steps || []).filter(Boolean), (row, s, i) => {
    row.n = `Step ${i + 1}`;
    const t = texts(row);
    setText(t[0], i + 1); setText(t[1], s);
  });

  // Taste
  const taste = find(main, byName('Taste'));
  repeat(find(taste, byName('Flavors')), startsWith('Pill · '), (d.flavors || []).filter(Boolean), (p, s) => { p.n = 'Pill · ' + s; setText(texts(p)[0], s); });
  const tl = taste.c.filter((c) => c.t === 'T');
  setText(tl[tl.length - 1], d.tasteLine || '');
  if (!d.tasteLine && !(d.flavors || []).length) remove(main, taste);

  // Riffs
  const riffs = find(main, byName('Riffs'));
  const riffList = (d.riffs || []).filter((r) => r && r.name);
  if (riffList.length) {
    const kids = riffs.c.filter(startsWith('Riff · '));
    const linkedProto = ctx.protos.linkedRiff || kids.find((k) => k.to) || kids[0];
    const plainProto2 = ctx.protos.plainRiff || kids.find((k) => !k.to) || kids[0];
    const made = riffList.map((r, i) => {
      const c = clone(r.link ? linkedProto : plainProto2);
      c.n = 'Riff · ' + r.name;
      c.to = r.link || undefined;
      const t = texts(c);
      setText(t[0], r.name); setText(t[1], r.note || '');
      // the last riff has no divider under it
      if (i === riffList.length - 1) { const last = kids[kids.length - 1]; c.st = last.st; c.sws = last.sws; c.sw = last.sw; }
      else { c.st = kids[0].st; c.sws = kids[0].sws; c.sw = kids[0].sw; }
      return c;
    });
    riffs.c = [...riffs.c.filter((k) => !startsWith('Riff · ')(k)), ...made];
  } else remove(main, riffs);

  // The spirit
  const fs = find(main, byName('Featured spirit'));
  if (d.spiritName) {
    const t = fs.c.filter((c) => c.t === 'T');
    setText(t[1], d.spiritName); setText(t[2], d.spiritLine || '');
    const btn = find(fs, byName('Button · Learn spirit'));
    if (d.spiritLink) { btn.to = d.spiritLink; setText(texts(btn)[0], d.spiritLinkLabel || `Learn about ${d.spiritName.toLowerCase()}`); }
    else remove(fs, btn);
    setText(texts(find(fs, byName('Our pour')))[1], d.pour || 'Bar lead to add our bottle');
  } else remove(main, fs);

  // What's in it
  const linksBox = find(main, byName('What’s in it'));
  const links = find(linksBox, byName('Links'));
  const lp = links.c[0];
  const linkList = (d.links || []).filter((l) => l && l.label);
  if (linkList.length) {
    links.c = linkList.map((l) => {
      const c = clone(lp);
      c.n = 'Link · ' + l.label; c.to = l.link || undefined;
      setText(texts(c)[0], l.label);
      if (!l.link) c.c = (c.c || []).filter((x) => x.t !== 'S');
      return c;
    });
  } else remove(main, linksBox);

  // Say it
  const say = find(main, byName('Say it'));
  setText(texts(say)[1], d.say || '');
  if (!d.say) remove(main, say);

  // Even out the two columns in the browser (short right-hand cards can move to the left).
  const body = find(main, (x) => x.n === 'Body' && (x.c || []).some((c) => c.n === 'Left'));
  if (body) body.bal = 1;

  // The glass
  const glass = find(main, byName('The glass'));
  const card = ctx.glassCard(d.glassCard || d.glass, e.slug);
  if (card && glass) Object.assign(glass, clone(card));
  else if (glass) remove(main, glass);

  // The story + video
  const story = find(main, byName('The story'));
  const slot = find(story, startsWith('Video slot'));
  slot.n = 'Video slot · History of the ' + name;
  setText(texts(slot)[1], 'The history of the ' + name);
  if (d.video) { slot.vid = d.video; remove(story, find(story, byName('Add video'))); }
  const sc = find(story, byName('Copy')).c.filter((c) => c.t === 'T');
  setText(sc[sc.length - 1], d.story || '');

  // Previous / next
  const i = n - 1;
  const prev = all[(i - 1 + all.length) % all.length], next = all[(i + 1) % all.length];
  const nav = find(main, byName('Sub nav'));
  const pb = find(nav, byName('Button · Previous')), nb = find(nav, byName('Button · Next'));
  setText(texts(pb)[1], prev.data.name); pb.to = '/' + prev.slug;
  setText(texts(nb)[1], next.data.name); nb.to = '/' + next.slug;

  return { id: 'e' + e.id, name: 'Classic · ' + name, bg: tpl.bg, main };
}

/** The Cocktails page table: one row per classic, grouped by family, with counts. */
export function classicTable(page, all) {
  const sec = find(page.main, byName('Section · Classic cocktails'));
  if (!sec) return;
  const rows = sec.c.filter(startsWith('Classic row · '));
  if (!rows.length) return;
  const mid = rows[1] || rows[0];
  const out = [];
  for (const c of sec.c) {
    if (startsWith('Classic row · ')(c)) continue;
    out.push(c);
    const f = FAMILIES.find((x) => texts(c)[0]?.s === x.head && (c.n || '').startsWith('Family · '));
    if (!f) continue;
    // the original last row of this group has no divider
    const i = sec.c.indexOf(c);
    let j = i + 1; while (j < sec.c.length && startsWith('Classic row · ')(sec.c[j])) j++;
    const lastStyle = sec.c[j - 1];
    const list = all.filter((x) => (x.data.family || 'Shaken') === f.key);
    setText(texts(c)[1], list.length);
    list.forEach((x, k) => {
      const r = clone(mid);
      r.n = 'Classic row · ' + x.data.name; r.to = '/' + x.slug;
      if (k === list.length - 1 && lastStyle) { r.st = lastStyle.st; r.sws = lastStyle.sws; r.sw = lastStyle.sw; }
      const th = find(r, startsWith('Thumb · '));
      if (th) { th.n = 'Thumb · ' + x.data.name; th.f = img(x.data.photo); }
      const t = texts(r);
      const base = x.data.tableBase || (x.data.build || []).find((b) => b.spirit)?.ingredient || '—';
      [x.data.name, x.data.tagline || '', base, x.data.method || '—', x.data.glass || '—', x.data.garnish || '—'].forEach((v, k2) => t[k2] && setText(t[k2], v));
      out.push(r);
    });
  }
  sec.c = out;
  const head = find(sec, byName('Head'));
  const pill = head && find(head, startsWith('Pill · '));
  if (pill) { const t = texts(pill)[0]; setText(t, t.s.replace(/^\d+/, String(all.length))); }
}
