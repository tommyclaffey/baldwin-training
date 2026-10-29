// Builds pages for recipes and cocktails added in the admin, from the designed templates:
// the house cocktail page (Fuschia Satin) and the recipe page (Short Rib).
// Nodes are found by their Figma layer names, so the templates can be restyled in Figma.

export const clone = (o) => structuredClone(o);

export function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, 'and').replace(/[’'.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

export function find(n, pred) {
  if (pred(n)) return n;
  for (const c of n.c || []) { const r = find(c, pred); if (r) return r; }
  return null;
}
export const byName = (name) => (n) => n.n === name;
export const startsWith = (p) => (n) => typeof n.n === 'string' && n.n.startsWith(p);
export function findAll(n, pred, out = []) {
  if (pred(n)) out.push(n);
  for (const c of n.c || []) findAll(c, pred, out);
  return out;
}
export const texts = (n) => findAll(n, (x) => x.t === 'T');
export function setText(node, s) {
  if (!node) return;
  node.s = String(s ?? '');
  delete node.segs;
}
function parentOf(root, target) {
  return find(root, (n) => (n.c || []).includes(target));
}
export function remove(root, target) {
  if (!target) return;
  const p = parentOf(root, target);
  if (p) p.c = p.c.filter((c) => c !== target);
}

/** Replace the children of `container` that match `pred` with one clone of `proto` per item. */
export function repeat(container, pred, items, fill, proto) {
  if (!container) return;
  const kids = container.c || [];
  const first = kids.findIndex(pred);
  const sample = proto || (first >= 0 ? kids[first] : null);
  if (!sample) return;
  const made = items.map((item, i) => { const c = clone(sample); fill(c, item, i); return c; });
  const kept = kids.filter((k) => !pred(k));
  const at = first >= 0 ? first : kept.length;
  container.c = [...kept.slice(0, at), ...made, ...kept.slice(at)];
}

const img = (url) => (url ? [{ img: url, m: 'FILL' }] : [{ c: '#2A2724' }]);
const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((s) => String(s).trim()).filter(Boolean);
const COURSE_SHORT = { 'Passed Bites': 'Passed', Plates: 'Plate', Dessert: 'Dessert' };

/* ------------------------------ cocktail ------------------------------ */

export function cocktailPage(template, item, ctx) {
  const d = item.data;
  const main = clone(template.main);
  const name = d.name || 'New cocktail';

  const crumbs = find(main, byName('Breadcrumb'));
  setText(crumbs.c[crumbs.c.length - 1], name);

  const hero = find(main, byName('Hero'));
  const photo = find(hero, startsWith('IMG/'));
  photo.f = img(d.photo); photo.n = 'IMG/' + name;
  const copy = find(hero, byName('Copy'));
  const all = ctx.signatures;
  const k = all.findIndex((s) => s.slug === item.slug) + 1;
  const SECTION = { 'Specialty Cocktails': 'Specialty cocktail', 'BRG Staples': 'BRG staple', Martinis: 'Martini', 'Spiritless & Bubbles': 'Spiritless' };
  setText(texts(find(copy, byName('Pill · Signature')))[0], d.menuSection
    ? [SECTION[d.menuSection] || d.menuSection, d.price && '$' + d.price].filter(Boolean).join(' · ')
    : `Our signature · ${k} of ${all.length}`);
  const ct = copy.c.filter((c) => c.t === 'T');
  setText(ct[0], d.tagline || 'Our signature cocktail');
  setText(ct[1], name.toUpperCase());
  setText(ct[2], d.description || '');
  const stats = find(copy, byName('Stats'));
  for (const [label, key] of [['Glass', 'glass'], ['Method', 'method'], ['Ice', 'ice'], ['Garnish', 'garnish']]) {
    setText(texts(find(stats, byName(label)))[1], d[key] || 'To confirm');
  }

  // "Our cocktails" strip
  const strip = find(main, (n) => (n.c || []).some(startsWith('Signature · ')));
  if (all.length > 4) { strip.wrap = 1; strip.cg = 8; strip.c = strip.c.filter((c) => c.n !== 'More coming'); }
  repeat(strip, startsWith('Signature · '), all, (chip, s) => {
    chip.n = 'Signature · ' + s.name;
    const active = s.slug === item.slug;
    chip.to = active ? undefined : '/' + s.slug;
    chip.f = [{ c: active ? '#1E1C1A' : '#F3EEE6' }];
    chip.st = active ? undefined : '#E4DCCF';
    const dot = find(chip, (n) => n.t === 'E');
    if (dot) dot.f = s.photo ? [{ img: s.photo, m: 'FILL' }] : [{ c: '#C49A6C' }];
    const t = texts(chip)[0];
    setText(t, s.name);
    t.f = [{ c: active ? '#F2EEE7' : '#1E1C1A' }];
  });

  // The build
  const ingr = find(main, byName('Ingredients'));
  const kids = (ingr.c || []).filter(startsWith('Ingredient · '));
  const featured = kids[0], plain = kids[1] || kids[0];
  const build = (d.build || []).filter((b) => b && (b.amount || b.ingredient));
  ingr.c = build.map((b) => {
    const c = clone(b.spirit ? featured : plain);
    c.n = 'Ingredient · ' + b.ingredient;
    const t = texts(c);
    setText(t[0], b.amount);
    setText(t[1], b.ingredient);
    c.to = b.link || undefined;
    if (!b.link) remove(c, find(c, byName('Learn')));
    return c;
  });

  // The note by the build: where the amounts come from (Drink Book specs since Oct 28), or what's still to confirm.
  const amountNote = find(main, (n) => n.t === 'T' && /^Sample amounts/.test(n.s || ''));
  if (amountNote && build.some((b) => b.amount)) setText(amountNote, d.specNote || 'From the Drink Book');

  // Steps
  const how = find(main, byName('How to make it'));
  const stepList = lines(d.steps).length ? lines(d.steps) : ['Bar lead to add the build and steps.'];
  repeat(how, (n) => /^Step \d+$/.test(n.n || ''), stepList, (row, s, i) => {
    row.n = `Step ${i + 1}`;
    const t = texts(row);
    setText(t[0], i + 1);
    setText(t[1], s);
  });

  // Taste
  const taste = find(main, byName('Taste'));
  repeat(find(taste, byName('Flavors')), startsWith('Pill · '), lines(d.tags), (p, s) => { p.n = 'Pill · ' + s; setText(texts(p)[0], s); });
  const tl = taste.c.filter((c) => c.t === 'T');
  setText(tl[tl.length - 1], d.tasteLine || '');
  if (!d.tasteLine && !lines(d.tags).length) remove(main, taste);

  // The spirit
  const fs = find(main, byName('Featured spirit'));
  if (d.spiritName) {
    const t = texts(fs);
    setText(t[1], d.spiritName);
    setText(t[2], d.spiritLine || '');
    const btn = find(fs, byName('Button · Learn spirit'));
    if (d.spiritLink) { btn.to = d.spiritLink; setText(texts(btn)[0], d.spiritLinkLabel || 'Learn about the spirit'); }
    else remove(fs, btn);
    setText(texts(find(fs, byName('Our pour')))[1], `${d.spiritName} · bar lead to confirm`);
  } else remove(main, fs);

  // What's in it
  const links = find(find(main, byName('What’s in it')), byName('Links'));
  const linked = (links.c || []).find((c) => c.to) || links.c[0];
  const unlinked = (links.c || []).find((c) => !c.to) || links.c[0];
  links.c = build.map((b) => {
    const c = clone(b.link ? linked : unlinked);
    c.n = 'Link · ' + b.ingredient;
    c.to = b.link || undefined;
    setText(texts(c)[0], b.ingredient);
    return c;
  });

  const sayCard = find(main, byName('Say it'));
  setText(texts(sayCard)[1], d.say || '');
  if (!d.say) remove(main, sayCard);

  // Even out the two columns in the browser (short right-hand cards can move to the left).
  const balBody = find(main, (x) => x.n === 'Body' && (x.c || []).some((c) => c.n === 'Left'));
  if (balBody) balBody.bal = 1;

  // The glass
  const glass = find(main, byName('The glass'));
  const card = ctx.glassCard(d.glass);
  if (card && glass) Object.assign(glass, clone(card));
  else if (glass && !card) remove(main, glass);

  // The story + video
  const story = find(main, byName('The story'));
  const slot = find(story, startsWith('Video slot'));
  slot.n = 'Video slot · Making the ' + name;
  const st = texts(slot);
  setText(st[1], 'Making the ' + name);
  if (d.video) slot.vid = d.video;
  const sc = texts(find(story, byName('Copy')));
  setText(sc[0], 'How we made it');
  setText(sc[2], d.story || 'Bar lead to add who created it and the idea behind it.');
  if (d.video) remove(story, find(story, byName('Add video')));

  // Previous / next among our cocktails
  const i = all.findIndex((s) => s.slug === item.slug);
  const prev = all[(i - 1 + all.length) % all.length], next = all[(i + 1) % all.length];
  const nav = find(main, byName('Sub nav'));
  const pb = find(nav, byName('Button · Previous')), nb = find(nav, byName('Button · Next'));
  setText(texts(pb)[1], prev.name); pb.to = '/' + prev.slug;
  setText(texts(nb)[1], next.name); nb.to = '/' + next.slug;

  return { id: 'e' + item.id, name: 'Signature · ' + name, bg: template.bg, main };
}

/* ------------------------------ dish ------------------------------ */

export function dishPage(template, item) {
  const d = item.data;
  const main = clone(template.main);
  const name = d.name || 'New dish';
  const course = d.course || 'Plates';

  const crumbs = find(main, byName('Breadcrumb'));
  const ct = crumbs.c.filter((c) => c.t === 'T' && c.s !== '/');
  setText(ct[0], course);
  setText(ct[ct.length - 1], name);

  const header = find(main, byName('Header'));
  const photo = find(header, startsWith('IMG/'));
  photo.f = img(d.photo); photo.n = 'IMG/' + name;
  const tags = find(header, byName('Tags'));
  const tagProto = find(tags, startsWith('Tag · '));
  const sig = find(tags, byName('Tag · Signature'));
  const tagList = [COURSE_SHORT[course] || course, d.station && `${d.station} Station`].filter(Boolean);
  tags.c = [...tagList.map((t) => { const c = clone(tagProto); c.n = 'Tag · ' + t; setText(texts(c)[0], t); return c; }), ...(d.signature && sig ? [sig] : [])];
  const tt = texts(find(header, byName('Titles')));
  setText(tt[0], d.tagline || 'On our menu');
  setText(tt[1], name.toUpperCase());
  const info = find(header, byName('Info'));
  setText(info.c.find((c) => c.t === 'T'), d.description || '');

  const allergens = find(header, byName('Allergens'));
  repeat(allergens, startsWith('Allergen · '), d.allergens || [], (p, a) => { p.n = 'Allergen · ' + a; setText(texts(p)[0], a); });
  if (!(d.allergens || []).length) {
    const note = allergens.c.filter((c) => c.t === 'T');
    setText(note[note.length - 1], 'None listed · chef to confirm');
  }

  // Components table
  const comps = find(main, byName('Components'));
  const rows = (d.components || []).filter((r) => r && (r.component || r.portion || r.hold));
  if (rows.length) {
    repeat(comps, startsWith('Row · '), rows, (row, r) => {
      row.n = 'Row · ' + r.component;
      const t = texts(row);
      setText(t[0], r.component); setText(t[1], r.portion || '—'); setText(t[2], r.hold || '—');
    });
  } else remove(main, comps);

  // Steps
  const steps = find(main, byName('Steps'));
  const stepList = (d.steps || []).filter((s) => s && (s.title || s.detail));
  repeat(steps, (n) => /^Step \d+$/.test(n.n || ''), stepList, (row, s, i) => {
    row.n = `Step ${i + 1}`;
    const t = texts(row);
    setText(t[0], String(i + 1).padStart(2, '0'));
    setText(t[1], s.title || ''); setText(t[2], s.detail || '');
    if (s.time) setText(t[3], s.time); else remove(row, find(row, byName('Time')));
  });

  // Plating
  const plating = find(main, byName('Plating guide'));
  const plate = (d.plating || []).filter((p) => p && p.name).slice(0, 4);
  if (plate.length) {
    const ph = find(plating, byName('Plate photo'));
    const pimg = find(ph, startsWith('IMG/'));
    pimg.f = img(d.platePhoto || d.photo);
    ph.c = ph.c.filter((c) => !/^Pin (\d)$/.test(c.n || '') || Number(c.n.slice(4)) <= plate.length);
    const legend = find(plating, byName('Legend'));
    repeat(legend, startsWith('Key '), plate, (row, p, i) => {
      row.n = `Key ${i + 1}`;
      const t = texts(row);
      setText(t[0], i + 1);
      const s = `${p.name}  ${p.note || ''}`;
      t[1].s = s;
      t[1].segs = [[0, p.name.length, 'Bold', null], [p.name.length, s.length, 'Regular', '#5E574F']];
    });
  } else remove(main, plating);

  // At the table
  const table = find(main, byName('At the table'));
  setText(texts(table)[1], d.say || '');
  const pairing = find(table, byName('Pairing'));
  if (d.pairing) {
    const t = texts(pairing);
    setText(t[1], d.pairing); setText(t[2], d.pairingNote || '');
  } else remove(table, pairing);

  // Watch it made
  const watch = find(main, byName('Watch it made'));
  const player = find(watch, byName('Player'));
  const still = find(player, startsWith('IMG/'));
  if (still) still.f = img(d.videoStill || d.photo);
  const pt = texts(player);
  setText(pt[0], d.videoTitle || `${name} · How it’s made`);
  if (pt[1]) setText(pt[1], d.videoDuration ? `0:00 / ${d.videoDuration}` : '');
  if (d.video) player.vid = d.video;
  const chapters = (d.chapters || []).filter((c) => c && c.label);
  const chapBox = find(watch, byName('Chapters'));
  const wc = texts(find(watch, byName('Copy')));
  if (chapters.length && chapBox) {
    repeat(chapBox, startsWith('Chapter · '), chapters, (c, x) => { c.n = 'Chapter · ' + x.label; const t = texts(c); setText(t[0], x.time || ''); setText(t[1], x.label); });
  } else { remove(watch, chapBox); remove(watch, wc[3]); }
  if (!chapters.length) player.c = (player.c || []).filter((c) => c.n !== 'Chapter mark');
  setText(wc[1], d.videoHeading || 'HOW IT’S MADE');
  setText(wc[2], d.videoNote || `A walkthrough of the ${name} from prep to plate.`);
  if (d.video) remove(watch, find(watch, byName('Video note')));

  // Photos
  const photos = find(main, byName('Section · Photos'));
  const list = (d.photos || []).filter((p) => p && p.img);
  if (list.length) {
    repeat(find(photos, byName('Photos')), startsWith('Photo · '), list.slice(0, 8), (c, p) => {
      c.n = 'Photo · ' + (p.caption || name);
      const r = find(c, startsWith('IMG/'));
      r.f = img(p.img);
      setText(texts(c)[0], p.caption || '');
    });
    setText(texts(find(photos, byName('Link')))[0], `All ${list.length} Photos`);
  } else remove(main, photos);

  const signoff = find(main, byName('Sign-off'));
  setText(texts(signoff)[0], `Ready to sign off on the ${name}?`);
  // Sign-off buttons go to this dish's quiz when there is one.
  const quiz = item.quiz ? '/quizzes?quiz=' + item.quiz : '/quizzes';
  for (const b of findAll(main, (n) => n.n === 'Button · Sign Off' || n.n === 'Button · Start')) b.to = quiz;
  if (!d.signature) tags.c = tags.c.filter((c) => c.n !== 'Tag · Signature');

  return { id: 'e' + item.id, name: `Recipe · ${name}`, bg: template.bg, main };
}

/* ------------------------------ lists ------------------------------ */

/** Adds new cocktails as rows in the Cocktails page table. */
export function injectCocktailRows(page, cocktails) {
  const matrix = find(page.main, byName('Cocktail matrix'));
  if (!matrix || !cocktails.length) return;
  const proto = find(matrix, startsWith('Row · Fuschia'));
  const zero = find(matrix, (n) => n.n === 'Row · Zero-proof drink');
  const made = cocktails.map((it) => {
    const d = it.data;
    const r = clone(proto);
    r.n = 'Row · ' + d.name;
    r.to = '/' + it.slug;
    const im = find(r, startsWith('IMG/'));
    if (im) im.f = img(d.photo);
    const t = texts(r);
    const build = (d.build || []).filter((b) => b && b.ingredient);
    const base = build.find((b) => b.spirit) || build[0];
    const rest = build.filter((b) => b !== base).map((b) => b.ingredient).join(', ');
    const vals = [d.name, rest || d.tagline || '', base ? base.ingredient : '—', d.glass || '—', d.ice || '—', d.garnish || 'To confirm', d.pairs || '—'];
    vals.forEach((v, i) => t[i] && setText(t[i], v));
    return r;
  });
  const at = zero ? matrix.c.indexOf(zero) : matrix.c.length;
  matrix.c.splice(at, 0, ...made);
}

/** Links Food Matrix rows to recipe pages, and adds rows for dishes that aren't there yet. */
export function injectDishRows(page, dishes) {
  const table = find(page.main, byName('Matrix table'));
  if (!table || !dishes.length) return;
  const proto = find(table, startsWith('Row · Short Rib'));
  for (const it of dishes) {
    const d = it.data;
    const existing = find(table, (n) => n.n === 'Row · ' + d.name);
    if (existing) { existing.to = '/' + it.slug; continue; }
    const r = clone(proto);
    r.n = 'Row · ' + d.name;
    r.to = '/' + it.slug;
    const im = find(r, startsWith('IMG/'));
    if (im) im.f = img(d.photo);
    const nameT = texts(find(r, byName('Dish')));
    setText(nameT[0], d.name); if (nameT[1]) setText(nameT[1], d.description || '');
    setText(texts(find(r, byName('Station')))[0], d.station || '—');
    repeat(find(r, byName('Allergens')), startsWith('Pill · '), d.allergens || [], (p, a) => { p.n = 'Pill · ' + a; setText(texts(p)[0], a); });
    setText(texts(find(r, byName('Pairing')))[0], d.pairing || '—');
    // after the last row of its course group
    const group = { 'Passed Bites': 'Group · PASSED BITES', Plates: 'Group · PLATES', Dessert: 'Group · DESSERT' }[d.course || 'Plates'];
    const gi = table.c.findIndex((c) => c.n === group);
    let at = gi + 1;
    while (at < table.c.length && (table.c[at].n || '').startsWith('Row · ')) at++;
    table.c.splice(gi >= 0 ? at : table.c.length, 0, r);
    if (gi >= 0) {
      const count = texts(table.c[gi])[1];
      if (count) setText(count, Number(count.s) + 1 || count.s);
    }
  }
}
