// The shared library: what every store sees, and what's left out because it's Baldwin's own.
//
// The Baldwin's book (store 1, book_ready) is the full designed book. Every other store gets:
//   shared  the library pages (classics, spirits, bottles, wine, wine service, beer styles, bar basics, service steps,
//           safety, cleanliness) with Baldwin's own cards taken off and Baldwin's names written out of the scripts;
//   mixed   pages that are part library, part the store's own lists (Cocktails, Wine, Beer, Food Matrix, Allergen
//           Guide): the library parts stay, the store's lists fill in, and empty lists go away;
//   own     pages that are only the store's (Home, Our Story, Floor Plan, the libraries, quizzes): an empty page that
//           says what goes there, until that store has its own.
import { find, findAll, startsWith, texts, setText } from './templates.mjs';

export function classify(slug) {
  if (/^(classic|spirit|bottle|wine|wine-service|beer|bar-basics)\//.test(slug)) return 'shared';
  // The Sommelier Program and its Study Guide belong to the whole group (Testa Barra hosts the courses).
  if (slug === 'sommelier-program' || slug.startsWith('sommelier-program/')) return 'shared';
  if (['the-bar/spirits', 'safety', 'cleanliness', 'steps-of-service'].includes(slug) || /^step-\d/.test(slug)) return 'shared';
  if (['the-bar/cocktails', 'the-bar/cocktail-specs', 'the-bar/wine', 'the-bar/beer-and-draft', 'the-bar/back-bar', 'food-matrix', 'allergen-guide'].includes(slug)) return 'mixed';
  return 'own';
}

const OWN = {
  '': { kind: 'home' },
  'our-story': { title: 'Our Story', body: 'Your restaurant’s story, history and the people behind it go here.' },
  'floor-plan': { title: 'Floor Plan', body: 'Your floor plan, table numbers and sections go here.' },
  'video-library': { title: 'Video Library', body: 'Your training videos go here. Managers add them in Admin → Videos and Photos.', admin: '/admin/media' },
  'photo-library': { title: 'Photo Library', body: 'Your plating references and photos go here. Managers add them in Admin → Videos and Photos.', admin: '/admin/media' },
  quizzes: { title: 'Quizzes & Sign-Offs', body: 'Quizzes come from your own menu. They show up here once your dishes and drinks are in.' },
  'the-bar/back-bar': { title: 'The Back Bar', body: 'Every bottle on your shelf goes here, each with its own page. Managers add them in Admin → Back Bar.', admin: '/admin/pages/shelf' },
  'food-matrix': { title: 'The Food Matrix', body: 'Your menu goes here: every dish, its station, allergens and pairing. Managers add dishes in Admin → Recipes.', admin: '/admin/pages/recipe' },
};
/** A page that's the store's own and has nothing in it yet. The app shows it as an empty state. */
export function emptyPage(file, slug, store) {
  const o = OWN[slug] || { title: 'This page', body: 'This part of the book is your restaurant’s own. It shows up once it’s added.' };
  return { id: file, name: o.title || store?.name || 'Home', empty: { kind: o.kind || 'page', title: o.title || store?.name, body: o.body, admin: o.admin || null, store: store?.name || null } };
}

/** Baldwin's names and places, from its own dishes and drinks plus the ones written into the design. */
// Names that are also classics or plain words stay (the Sidecar's history mentions the Ritz Hotel, for one).
const KEEP = new Set(['The Ritz', 'Espresso Martini', 'Perfect Martini', 'Proper Martini', 'Lemon Drop', 'Martini']);
export function baldwinTerms(names, classics = []) {
  // Plus the dish names written into the design before the Food Book renamed them (Oct 28).
  const fixed = ['The Baldwin', 'Baldwin family', 'J.Baldwin', 'Testa Barra', 'Macomb', 'Shelby', 'Bolgheri Rosso', 'Tenuta Spinelli', 'G4 Tequila', 'DCD Rye',
    'Short Rib', 'Scallop Rockefeller', 'Beet Confit', 'Mike’s Vegas Pie', "Mike's Vegas Pie", 'Agnolotti'];
  const skip = new Set([...KEEP, ...classics]);
  const all = [...new Set([...fixed, ...names.filter((n) => n && n.length > 3 && !skip.has(n))])].sort((a, b) => b.length - a.length);
  return new RegExp('\\b(' + all.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]")).join('|') + ')');
}

// Service scripts written for any restaurant ({store} = this store's name). null = leave the line out.
const LINES = new Map(Object.entries({
  'G4 Tequila · Fuschia Satin': null,
  'DCD Rye · Cozy Blankets': null,
  '“Welcome to The Baldwin. Have you been in with us before?”': '“Welcome to {store}. Have you been in with us before?”',
  '“The Cozy Blankets wins over people who don’t even like whiskey.”': '“Our signature cocktail is a great place to start. Can I tell you about it?”',
  'Ask about allergies every time. Guide them to the Short Rib.': 'Ask about allergies every time. Guide them to our signature dish.',
  '“Short Rib for you. Enjoy.”': '“And this one is for you. Enjoy.”',
  '“How’s the Short Rib tasting?”': '“How’s everything tasting?”',
  '“Save room for the Date Cake. Guests love the balance of sweetness.”': '“Save room for dessert. I’ll tell you what we have tonight.”',
  'Based on the FDA Food Code · confirm with Macomb County rules': 'Based on the FDA Food Code · confirm with your local health department',
  '“Good evening, welcome to The Baldwin! I’m [your name], and I’ll be taking care of you tonight.”': '“Good evening, welcome to {store}! I’m [your name], and I’ll be taking care of you tonight.”',
  '“Welcome! We’re part of the Baldwin family, with J.Baldwin’s and Testa Barra. Let me tell you a little about the menu.”': null,
  '“Have you had a look at our cocktails? The Cozy Blankets is a guest favorite.”': '“Have you had a look at our cocktails? I can point you to a favorite.”',
  '“DCD Rye, spiced pear, lemon and ginger-honey. It’s warm and spiced, and even people who don’t drink whiskey love it.”': null,
  '“If you’re thinking about the Short Rib, the Bolgheri Rosso is our favorite pairing with it.”': '“If you’re thinking about a main, I can suggest a wine to go with it.”',
  '“The Short Rib. It’s our signature dish, braised for four hours until it falls apart.”': '“Our signature dish. Let me tell you how the kitchen makes it.”',
  '“Thank you for telling me. The Scallop Rockefeller has shellfish, so I’d skip that one. I’ll tell the chef myself.”': '“Thank you for telling me. I’ll point out what to skip, and I’ll tell the chef myself.”',
  '“So that’s the Short Rib, the Agnolotti and the Beet Confit to start. Perfect.”': '“Let me read that back to make sure it’s right.”',
  '“Here’s the Short Rib, braised four hours with our pan gravy. Enjoy.”': '“Here’s your main. Enjoy.”',
  '“And the Agnolotti for you.”': '“And this one is for you.”',
  'Auction the food: “Who had the Short Rib?”': 'Auction the food: “Who had the …?”',
  'Short Rib': 'Mains',
  '“Did you save room for dessert? The Date Cake is our favorite, and it comes with ice cream.”': '“Did you save room for dessert? Let me tell you what we have tonight.”',
  'Date Cake': 'Dessert',
  '“We’d love to see you again. If you haven’t been to J.Baldwin’s or Testa Barra, they’re part of our family too.”': null,
  '“Ask about the Wine Club at Testa Barra. Members get hand-selected bottles and tastings.”': null,
}));

const parentOf = (root, node) => (root.c || []).includes(node) ? root : (root.c || []).reduce((hit, c) => hit || parentOf(c, node), null);
const drop = (root, node) => { const p = parentOf(root, node); if (p) p.c = p.c.filter((c) => c !== node); };
/** Leave a line out: the whole message (You / Guest bubble) or list item it sits in, not just the words. */
function dropLine(root, t) {
  let n = t, up = parentOf(root, t);
  for (let i = 0; i < 3 && up; i++) {
    if (/^(You|Guest|Bubble|Item|Row|Line)\b/.test(up.n || '') || /^(Pair|Dish|Key|Sibling|Chip|Pill|Spec|Wine|Pour|In our cocktails) · /.test(up.n || '')) n = up;
    up = parentOf(root, up);
  }
  drop(root, n);
}

// Library parts each section is built from: these stay; the store's own sections go when they're empty.
const OWN_SECTIONS = {
  'the-bar/wine': ['Section · Wine program'],
};
const STORE_CARDS = ['Pairs with', 'Try it with', 'In our cocktails'];
const SHELF_CARDS = ['On our shelf', 'On our list', 'Our whiskey shelf'];

/** Before the store's lists fill in: remember the designed (Baldwin) shelf cards, so the unfilled ones can go. */
export function snapshotShelves(page) {
  return new Map(findAll(page.main, (n) => SHELF_CARDS.includes(n.n)).map((n) => [n, JSON.stringify(n)]));
}

/** After filling: Baldwin's cards, sections, names and lines come out; the scripts read for this store. */
export function genericize(page, slug, { store, statics, terms, has }) {
  const m = page.main;
  // Top bar: The Baldwin's menu status and its pre-shift quiz.
  for (const n of findAll(m, (x) => x.n === 'Menu chip' || x.n === 'Button · Pre-Shift Quiz')) drop(m, n);
  for (const [n, json] of statics) if (JSON.stringify(n) === json) drop(m, n);
  for (const n of findAll(m, (x) => STORE_CARDS.includes(x.n))) drop(m, n);
  for (const name of OWN_SECTIONS[slug] || []) { const n = m.c.find((c) => c.n === name); if (n) drop(m, n); }
  if (slug === 'the-bar/cocktails' && !has.house) m.c = m.c.filter((c) => c.n !== 'Our signatures' && c.n !== 'Cocktail matrix');
  if (slug === 'the-bar/wine') {
    if (!has.wine) m.c = m.c.filter((c) => c.n !== 'Section · By the glass' && c.n !== 'Section · By the bottle');
    const key = find(m, (n) => n.n === 'Key' && (n.c || []).some(startsWith('Key · '))); if (key) drop(m, key);
  }
  if (slug === 'the-bar/beer-and-draft' && !has.beer) m.c = m.c.filter((c) => !['Tap wall', 'Section · Tap list', 'Section · In bottles'].includes(c.n));
  // Scripts and notes: rewrite the known lines, then take out any other mention of Baldwin's own names.
  for (const t of findAll(m, (n) => n.t === 'T')) {
    if (LINES.has(t.s)) {
      const v = LINES.get(t.s);
      if (v === null) { dropLine(m, t); continue; }
      const text = v.replace('{store}', store?.name || 'our restaurant'), p = parentOf(m, t);
      if (p && p.n === 'Pill · ' + t.s) p.n = 'Pill · ' + text;
      setText(t, text); t.n = text;
      continue;
    }
    if (terms.test(t.s || '')) dropLine(m, t);
  }
  // Wine-list markers on the tasting scales are The Baldwin's bottles.
  if (slug === 'the-bar/wine') for (const n of findAll(m, startsWith('Marker · '))) drop(m, n);
  // Anything still named for one of Baldwin's dishes or drinks (a card whose words were taken out) goes too.
  for (const n of findAll(m, (x) => x !== m && x.n && x.t !== 'T' && terms.test(x.n))) drop(m, n);
  return page;
}

/** Search text for a store that isn't The Baldwin: its own pages say nothing yet. */
export const indexText = (e) => (classify(e.slug) === 'own' ? { ...e, text: '', thumb: undefined, blurb: undefined } : e);
export { texts };
