// Home: the dashboard (greeting, tonight's sections, what's new) and the live parts of the designed page
// (tonight's focus dish, Browse the Book counts, the Food Matrix preview). Your Training fills in on the phone.
import { clone, find, findAll, byName, startsWith, texts, setText, repeat, photoToCome } from './templates.mjs';
import { COLLECTIONS, COURSES, getEntry } from './cms.mjs';

const TZ = 'America/Detroit';
const SHORT = { 'For the Table': 'For the Table', 'From the Oven': 'From the Oven', 'Soups & Salads': 'Salad', Entrees: 'Entree', 'Social Hour': 'Social Hour', 'Snacks & Small Plates': 'Small Plate', Salads: 'Salad', Pizza: 'Pizza', Pasta: 'Pasta', Mains: 'Main', Dessert: 'Dessert' };
const NOUN = { recipe: 'DISH', house: 'COCKTAIL', wine: 'WINE', shelf: 'BOTTLE', beer: 'BEER', classic: 'CLASSIC' };
const LIST_PAGE = { shelf: '/the-bar/spirits', beer: '/the-bar/beer-and-draft' };
const parentOf = (root, node) => (root.c || []).includes(node) ? root : (root.c || []).reduce((hit, c) => hit || parentOf(c, node), null);
const drop = (root, node) => { const p = node && parentOf(root, node); if (p) p.c = p.c.filter((c) => c !== node); };
const img = (url) => [{ img: url, m: 'FILL' }];
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });

export function fillHome(db, page, { store, user, recipes, house, wines, bowl }) {
  const m = page.main;
  // Greeting
  const now = new Date();
  const hour = Number(now.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const first = String(user?.name || '').trim().split(/\s+/)[0];
  setText(find(m, byName('Hello')), first ? `Good ${part}, ${first}` : `Good ${part}`);
  setText(find(m, byName('Today')), `${now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' })} · ${store?.name || 'The Baldwin'}`);

  // Dashboard cards size to what's in them (the row lines them up on desktop; they stack on a phone).
  for (const c of find(m, byName('Cards'))?.c || []) c.sv = 'H';

  // Tonight's sections (Floor Plan), with this person's section on top.
  const card = find(m, byName('Card · Sections'));
  if (card) {
    const today = now.toLocaleDateString('en-CA', { timeZone: TZ });
    const order = (s) => ['Servers', 'Bar', 'Support'].findIndex((k) => s.startsWith(k)) * 100 + Number(s.split(' ').pop() || 0);
    const rows = db.prepare('SELECT slot, name FROM sections WHERE day = ? AND store_id = ?').all(today, store?.id ?? 1).sort((a, b) => order(a.slot) - order(b.slot));
    const list = find(card, byName('Slots'));
    const mine = rows.find((r) => user?.name && (r.name.toLowerCase() === user.name.toLowerCase() || r.name.toLowerCase() === first.toLowerCase()));
    const pill = find(card, byName('Your section'));
    if (mine) setText(texts(pill)[0], `YOUR SECTION · ${mine.slot.toUpperCase()}`); else drop(card, pill);
    if (rows.length) repeat(list, startsWith('Slot · '), rows, (row, r) => { row.n = 'Slot · ' + r.slot; const t = texts(row); setText(t[0], r.slot); setText(t[1], r.name); t[1].f = [{ c: '#1E1C1A' }]; });
    else {
      const proto = texts(list.c[0])[0];
      list.c = [{ ...clone(proto), n: 'Not set', s: 'Sections aren’t set yet. A manager sets them before line-up.', ar: 'H', sh: 'L', w: 300 }];
    }
    const link = find(card, byName('Link · Floor Plan')); if (link) link.to = '/floor-plan';
  }

  // What's new: the latest dishes, drinks and wines added or changed in this store's book.
  const news = find(m, byName('Card · What’s new'));
  if (news) {
    const rows = db.prepare(`SELECT id, collection, slug, data, created_at, updated_at FROM entries WHERE store_id = ? AND archived_at IS NULL
      AND collection IN ('recipe','house','wine','shelf','beer') ORDER BY updated_at DESC, id DESC LIMIT 3`).all(store?.id ?? 1);
    const box = find(news, byName('Updates'));
    if (rows.length) repeat(box, startsWith('Update · '), rows, (row, r, i) => {
      // Store dishes keep only their own fields; the name lives in the group library (Nov 5: names came out blank).
      const d = getEntry(db, r.id)?.data || JSON.parse(r.data);
      row.n = 'Update · ' + (i + 1);
      // Added in the last two weeks: new. Older and changed since: updated.
      const isNew = !r.created_at || Date.now() - new Date(r.created_at) < 14 * 864e5;
      const t = texts(row);
      setText(t[0], isNew ? `NEW ${NOUN[r.collection] || ''}`.trim() : 'UPDATED');
      setText(t[1], d.name || '');
      setText(t[2], [d.course || d.section || d.list || d.style, r.updated_at && day(r.updated_at)].filter(Boolean).join(' · '));
      const c = COLLECTIONS[r.collection];
      row.to = c?.hasPage && !c.hasPage(d) ? LIST_PAGE[r.collection] : '/' + r.slug;
    });
    else drop(news, box);
    const link = find(news, byName('Link · Food Matrix')); if (link) link.to = '/food-matrix';
  }

  // Tonight's focus: the signature dish.
  const focus = recipes.find((e) => e.data.signature) || recipes.find((e) => ['Entrees', 'Mains'].includes(e.data.course)) || recipes[0];
  const hero = find(m, (n) => (n.n || '').startsWith('Hero · '));
  if (hero && focus) {
    const d = focus.data;
    const copy = find(hero, byName('Copy'));
    const t = texts(copy);
    if (!d.signature) setText(t[1], 'On the menu tonight');
    setText(t[2], d.name.toUpperCase());
    // Long names wrap to a second line, a size down, instead of running under the photo.
    t[2].ar = 'H'; t[2].sh = 'L'; if (d.name.length > 12) { t[2].z = Math.min(t[2].z || 70, 56); t[2].lh = '100%'; }
    setText(t[3], d.description || '');
    t[3].ar = 'H'; t[3].sh = 'L'; // wraps inside the copy column instead of running under the photo (Nov 6)
    const stat = find(hero, byName('Stat'));
    if (stat && d.pairing) setText(texts(stat)[0], d.pairing); else drop(hero, find(hero, byName('Stats')));
    const watch = find(hero, byName('Button · Watch'));
    if (d.hasVideo && d.video) watch.to = '/' + focus.slug; else drop(hero, watch);
    const spec = find(hero, byName('Button · Spec')); if (spec) spec.to = '/' + focus.slug;
    const ph = find(find(hero, byName('Photo')) || hero, startsWith('IMG/'));
    if (ph) { if (d.photo) ph.f = img(d.photo); else photoToCome(ph, true, bowl); }
  }

  // Browse the Book: real counts.
  const count = (...cs) => recipes.filter((e) => cs.includes(e.data.course)).length;
  const items = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const tile = (name, label) => { const t = find(m, byName('Tile · ' + name)); if (t) setText(texts(t)[1], label); };
  tile('Small Plates', items(count('For the Table', 'Social Hour', 'Snacks & Small Plates'), 'item', 'items'));
  tile('Mains', items(count('Entrees', 'Mains'), 'item', 'items'));
  tile('Pizza & Pasta', items(count('From the Oven', 'Pizza', 'Pasta'), 'item', 'items'));
  tile('Cocktails', items(house.length, 'drink', 'drinks'));
  tile('Wine', `${wines.length} on our list`);

  // The Food Matrix preview: the signature dish, then one from each course.
  const sec = find(m, byName('Section · Food Matrix'));
  if (sec) {
    const rows = sec.c.filter(startsWith('Row · '));
    const proto = rows.find((r) => r.n === 'Row · Short Rib') || rows[0];
    const pick = [focus, ...COURSES.map((c) => recipes.find((e) => e.data.course === c && e !== focus))].filter(Boolean);
    for (const e of recipes) if (pick.length < 6 && !pick.includes(e)) pick.push(e);
    const out = pick.slice(0, 6).map((e) => {
      const d = e.data; const r = clone(proto);
      r.n = 'Row · ' + d.name; r.to = '/' + e.slug;
      const im = find(r, startsWith('IMG/'));
      if (im) { if (d.photo) im.f = img(d.photo); else photoToCome(im, false, bowl); if (!d.photo && im.c?.[0]) { im.c[0].w = 28; im.c[0].h = 19; } }
      const name = find(r, byName('Name')); const nt = texts(name);
      setText(nt[0], d.name); nt[0].sh = 'L'; nt[0].ar = 'H'; const tr = find(name, byName('Title row')); if (tr) tr.sh = 'L';
      if (nt[1]) setText(nt[1], d.description || '');
      setText(texts(find(r, byName('Course')))[0], SHORT[d.course] || d.course);
      setText(texts(find(r, byName('Station')))[0], d.station || '—');
      repeat(find(r, byName('Allergens')), startsWith('Allergen · '), d.allergens?.length ? d.allergens : ['None listed'], (p, a) => { p.n = 'Allergen · ' + a; setText(texts(p)[0], a.toUpperCase()); });
      setText(texts(find(r, byName('Pairing')))[0], d.pairing || '—');
      const media = find(r, byName('Media'));
      if (media) {
        setText(texts(find(media, byName('Videos')))[0], d.hasVideo && d.video ? 1 : 0);
        setText(texts(find(media, byName('Photos')))[0], (d.photo ? 1 : 0) + (d.photos || []).filter((p) => p?.img).length);
      }
      return r;
    });
    const first = sec.c.indexOf(rows[0]);
    sec.c = [...sec.c.slice(0, first).filter((c) => !rows.includes(c)), ...out, ...sec.c.slice(first).filter((c) => !rows.includes(c))];
    const foot = find(sec, byName('Footer'));
    if (foot) setText(texts(foot)[0], `Showing ${out.length} of ${recipes.length} · Chef to confirm allergens and stations`);
  }
  return page;
}
