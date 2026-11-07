// Cocktail Specs (Tommy, Nov 5: "make sure that there are no cocktail specs in any of the cocktail stuff, and make your own
// individual section that's for cocktail specs of every cocktail in the app … for bartenders").
//   • The page (Figma 430:17, "The Bar · Cocktail Specs"): every house cocktail and every classic, one card each, with the
//     amounts, glass, ice, method, garnish and any real steps. Lists follow the quiz categories.
//   • The cocktail pages, the Cocktails page cards and its tables no longer show amounts, ice, method or steps; they link here.
import { clone, find, findAll, byName, startsWith, texts, setText } from './templates.mjs';

export const SPECS_PATH = '/the-bar/cocktail-specs';
/** Where a cocktail's spec sits: the specs page, filtered to that drink. */
export const specHref = (name) => `${SPECS_PATH}?find=${encodeURIComponent(name)}`;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Names that are the same drink on the house list and the classic pages (our book's spec wins). Same as the quizzes.
const canon = (s) => { const k = String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^the/, ''); return { cosmopolitan: 'cosmo', lemondrop: 'lemondropmartini', martini: 'propermartini', aperolspritz: 'spritz' }[k] || k; };

const SECTION_LABEL = { 'Specialty Cocktails': 'Specialty', 'BRG Staples': 'BRG Staple', Classics: 'Classic', Mules: 'Mule', 'Dessert Cocktails': 'Dessert', 'Spiritless Cocktails': 'Spiritless' };

/** The lists, in page order. Each: { key, title, chip, note, items: [{ e, house }] }. */
export function specLists(house, classics) {
  const sec = (s) => house.filter((x) => x.data.menuSection === s);
  const known = new Set(Object.keys(SECTION_LABEL));
  const ownClassics = sec('Classics');
  const ownNames = new Set(house.map((x) => canon(x.data.name)));
  const lib = classics.filter((x) => !ownNames.has(canon(x.data.name)));
  const H = (l) => l.map((e) => ({ e, house: true })), C = (l) => l.map((e) => ({ e, house: false }));
  const lists = [
    { key: 'specialty', title: 'Specialty Cocktails', chip: 'Specialty', note: 'On the menu', items: H(sec('Specialty Cocktails')) },
    { key: 'brg', title: 'BRG Staples', chip: 'BRG Staples', note: 'On the menu', items: H(sec('BRG Staples')) },
  ];
  if (ownClassics.length) {
    lists.push({ key: 'classic-on', title: 'Classics on the Menu', chip: 'Classics on the Menu', note: 'Our house build first, then the standard',
      items: [...H(ownClassics.filter((x) => x.data.onMenu)), ...C(lib.filter((x) => x.data.onMenu))] });
  }
  lists.push(
    { key: 'mules', title: 'Mules', chip: 'Mules', note: 'On the menu', items: H(sec('Mules')) },
    { key: 'dessert', title: 'Dessert Cocktails', chip: 'Dessert', note: 'On the menu', items: H(sec('Dessert Cocktails')) },
    { key: 'spiritless', title: 'Spiritless Cocktails', chip: 'Spiritless', note: 'No alcohol', items: H(sec('Spiritless Cocktails')) },
    { key: 'house', title: 'House Cocktails', chip: 'House', note: 'Our own', items: H(house.filter((x) => !known.has(x.data.menuSection))) },
  );
  if (ownClassics.length) {
    lists.push({ key: 'classic-off', title: 'Classics off the Menu', chip: 'Classics off the Menu', note: 'Our house builds first, then the standard',
      items: [...H(ownClassics.filter((x) => !x.data.onMenu)), ...C(lib.filter((x) => !x.data.onMenu))] });
  } else {
    lists.push({ key: 'classic', title: 'Classic Cocktails', chip: 'Classics', note: 'The standard builds', items: C(classics) });
  }
  return lists.filter((l) => l.items.length);
}

// Steps worth showing: the classics' real steps. The house steps were written from the method, glass and garnish
// (Oct 28), so they only repeat the card and are left off.
const restates = (s, d) => /^(Serve in|Garnish|Glass to confirm|Method to confirm|Bar lead to)/i.test(s) || norm(s) === norm(d.method);
const stepsOf = (d) => (Array.isArray(d.steps) ? d.steps : String(d.steps || '').split('\n')).map((s) => String(s || '').trim()).filter((s) => s && !restates(s, d));

/** Fills the Cocktail Specs page from the house list and the classics. */
export function fillSpecs(page, house, classics) {
  const m = page.main;
  const protoList = m.c.find(startsWith('List · '));
  if (!protoList) return;
  const cards = findAll(protoList, startsWith('Spec · ')).concat(findAll(m, startsWith('Spec · ')));
  const withSteps = cards.find((c) => find(c, byName('Steps'))) || cards[0];
  const cardProto = clone(withSteps);
  const lists = specLists(house, classics);

  const made = lists.map((l) => {
    const list = clone(protoList);
    list.n = 'List · ' + l.title;
    const title = find(list, byName('Title'));
    setText(texts(title)[0], l.title.toUpperCase());
    setText(texts(find(title, byName('Count')))[0], `${l.items.length} spec${l.items.length === 1 ? '' : 's'}`);
    setText(find(list, byName('Note')), l.note);
    find(list, byName('Specs')).c = l.items.map(({ e, house: own }) => specCard(cardProto, e, own));
    list._g = l.key;
    list._find = norm([l.title, ...l.items.map(({ e }) => e.data.name)].join(' '));
    return list;
  });
  const at = m.c.indexOf(protoList);
  m.c = [...m.c.slice(0, at), ...made, ...m.c.slice(at).filter((c) => !startsWith('List · ')(c))];

  const total = lists.reduce((n, l) => n + l.items.length, 0);
  const stat = (name, n) => { const s = find(m, byName(name)); if (s) setText(texts(s)[0], String(n)); };
  stat('Stat · specs', total);
  stat('Stat · lists', lists.length);

  // The filter chips, one per list (wired in interact.mjs, like the Back Bar's).
  const filter = find(m, byName('Filter'));
  if (filter) {
    const all = filter.c.find((c) => c.n === 'Chip · All'), plain = filter.c.find((c) => c.n !== 'Chip · All');
    filter.c = [['All', total, 'All'], ...lists.map((l) => [l.chip, l.items.length, l.key])].map(([label, n, key]) => {
      const c = clone(label === 'All' ? all : plain);
      c.n = 'Chip · ' + label; c._val = key;
      const [a, b] = texts(c); setText(a, label); setText(b, String(n));
      return c;
    });
    filter._protos = { on: all, off: plain, keys: ['sbar', 'sfind'] };
  }
}

function specCard(proto, e, own) {
  const d = e.data;
  const c = clone(proto);
  c.n = 'Spec · ' + d.name;
  const name = find(c, byName('Name'));
  setText(name, d.name);
  name.to = '/' + e.slug;
  const price = own && d.price ? '$' + String(d.price).replace(/^\$/, '') : '';
  setText(find(c, byName('Sub')), own
    ? [SECTION_LABEL[d.menuSection] || d.menuSection || 'House cocktail', price].filter(Boolean).join(' · ')
    : ['Classic', d.family].filter(Boolean).join(' · '));

  const build = find(c, byName('Build'));
  const lines = (d.build || []).filter((b) => b && (b.amount || b.ingredient));
  const lp = build.c[1] || build.c[0], first = build.c[0];
  build.c = lines.map((b, i) => {
    const l = clone(i ? lp : first);
    l.n = 'Line · ' + b.ingredient;
    const [a, ing] = texts(l);
    setText(a, b.amount || '—'); setText(ing, b.ingredient || '');
    return l;
  });

  const meta = find(c, byName('Meta'));
  const mp = meta.c[0];
  const rows = [['Glass', d.glass || 'To confirm'], ['Ice', d.ice], ['Method', d.method || 'To confirm'], ['Garnish', d.garnish]].filter(([, v]) => v);
  meta.c = rows.map(([label, v]) => {
    const r = clone(mp);
    r.n = 'Meta · ' + label;
    const [l, val] = texts(r);
    setText(l, label.toUpperCase()); setText(val, v);
    return r;
  });

  const steps = find(c, byName('Steps'));
  const list = stepsOf(d);
  if (steps && list.length) {
    const sp = steps.c[0];
    steps.c = list.map((s, i) => {
      const r = clone(sp);
      r.n = 'Step ' + (i + 1);
      const [n, t] = texts(r);
      setText(n, String(i + 1)); setText(t, s);
      return r;
    });
  } else if (steps) c.c = c.c.filter((x) => x !== steps);

  setText(find(c, byName('Spec note')), d.specNote || (own ? 'From the Drink Book' : 'The standard build'));
  c._find = norm([d.name, d.menuSection, d.family, d.glass, d.method, d.garnish, ...lines.map((b) => b.ingredient)].join(' '));
  return c;
}
