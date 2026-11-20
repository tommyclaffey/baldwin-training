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
export function baldwinTerms(names, classics = [], ours = []) {
  // Plus the dish names written into the design before the Food Book renamed them (Oct 28).
  // Nov 16: + the drinks and dishes the design's service scripts name, so the scrub never depends on The Baldwin's menu
  // being in the database (its menu is its account's content now).
  const fixed = ['The Baldwin', 'Baldwin family', 'J.Baldwin', 'Testa Barra', 'Macomb', 'Shelby', 'Bolgheri Rosso', 'Tenuta Spinelli', 'G4 Tequila', 'DCD Rye',
    'Short Rib', 'Scallop Rockefeller', 'Beet Confit', 'Mike’s Vegas Pie', "Mike's Vegas Pie", 'Agnolotti', 'Cozy Blankets', 'Fuschia Satin', 'Date Cake', 'Baldwin Burger'];
  const skip = new Set([...KEEP, ...classics]);
  const mine = new Set(ours); // a store that names its own drink the same keeps it
  const all = [...new Set([...fixed.filter((n) => !mine.has(n)), ...names.filter((n) => n && n.length > 3 && !skip.has(n))])].sort((a, b) => b.length - a.length);
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
  // Nov 20 (Tommy: "Go for it", Figma 09 · Idea Board, section 45, notes card 888:4693): the neutral foundation book's new
  // lines, word for word, where this list used to leave a line out or keep one only The Baldwin's group can say.
  '“Ask about the Wine Club at Testa Barra. Members get hand-selected bottles and tastings.”': '“I’m so glad. It’s on our list, so I’ll write the name down for you to take home.”',
  'Mention the sister restaurants': 'Mention our other locations, if your group has them',
  'Mention the Wine Club or Supper Club when it fits': 'Mention anything coming up: events, specials or a club, if you have one',
  'The family': 'Who we are',
  'Tell guests about the family': 'Tell guests a little about the restaurant',
  'From the Food Book': 'From the menu',
  'From the Wine Book and Drink Book': 'From our wine and drink lists',
  'From the Wine Book': 'From our wine list',
  // The foundation book itself (content/templates) is drawn with Fig & Fire, the Mise demo, as its restaurant: its name
  // becomes this store's.
  '“Welcome to Fig & Fire. Have you been in with us before?”': '“Welcome to {store}. Have you been in with us before?”',
  '“Good evening, welcome to Fig & Fire! I’m [your name], and I’ll be taking care of you tonight.”': '“Good evening, welcome to {store}! I’m [your name], and I’ll be taking care of you tonight.”',
}));
/** The foundation book's lines that name its sample restaurant, filled with this store's name (any store reading the
 *  foundation book's own version of a page: a store without an account folder, or with one that doesn't have that page). */
export function storeLines(page, store) {
  for (const t of findAll(page.main || {}, (n) => n.t === 'T' && typeof n.s === 'string' && n.s.includes(SAMPLE_STORE) && LINES.has(n.s))) {
    const text = LINES.get(t.s).replace('{store}', store?.name || 'our restaurant');
    if (t.n === t.s) t.n = text;
    setText(t, text);
  }
  // Slots that hold the sample restaurant's own drinks (the Rye page's house line) are its alone
  if (store?.name !== SAMPLE_STORE) dropSamples(page.main);
  return page;
}
export const SAMPLE_STORE = 'Fig & Fire';
/** A line of the foundation book (a search blurb) as this store reads it: the sample restaurant's name becomes the store's,
 *  and a line naming it that isn't one of the known lines is left out for any other store. */
export function storeText(s, store) {
  if (typeof s !== 'string' || !s.includes(SAMPLE_STORE)) return s;
  if (LINES.has(s)) return LINES.get(s).replace('{store}', store?.name || 'our restaurant');
  return store?.name === SAMPLE_STORE ? s : undefined;
}
/** Nodes marked `sample` in the foundation book hold Fig & Fire's own menu (Figma section 45: "Fig & Fire sample"). Only
 *  Fig & Fire shows them; every other store has its own lists or nothing there. */
function dropSamples(m) { if (m) for (const n of findAll(m, (x) => x !== m && x.sample)) drop(m, n); }
// Nov 20 (section 45, notes card): the Cabernet page's Bottles to Know names two bottles on neither The Baldwin's list nor
// Fig & Fire's, in place of Caymus and Silver Oak (both on The Baldwin's list).
const BRANDS = { 'wine/red/cabernet': { Caymus: 'Chateau Montelena', 'Silver Oak': 'Heitz Cellar' } };

const parentOf = (root, node) => (root.c || []).includes(node) ? root : (root.c || []).reduce((hit, c) => hit || parentOf(c, node), null);
const drop = (root, node) => { const p = parentOf(root, node); if (p) p.c = p.c.filter((c) => c !== node); };
/** Leave a line out: the whole message (You / Guest bubble) or list item it sits in, not just the words. */
export function dropLine(root, t) {
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
// Nov 11: + 'Section · On our shelf' (the Whiskey page's "Our whiskey shelf" band): a store with no shelf of its own was
// still showing The Baldwin's whiskeys there.
const SHELF_CARDS = ['On our shelf', 'On our list', 'Our whiskey shelf', 'Section · On our shelf'];

/** Before the store's lists fill in: remember the designed (Baldwin) shelf cards, so the unfilled ones can go. */
export function snapshotShelves(page) {
  return new Map(findAll(page.main, (n) => SHELF_CARDS.includes(n.n)).map((n) => [n, JSON.stringify(n)]));
}

/** After filling: Baldwin's cards, sections, names and lines come out; the scripts read for this store. */
export function genericize(page, slug, { store, statics, terms, has, topBar = false, ours = null, sample = topBar === true }) {
  const m = page.main;
  // Nov 17: a store's own words (its menu, ours) are never taken for The Baldwin's: "BBQ Short Rib – Round" isn't The
  // Baldwin's Short Rib, and J.Baldwin's own lines name J.Baldwin's.
  const theirs = (s) => terms.test(ours ? String(s || '').replace(ours, ' ') : String(s || ''));
  const termsI = new RegExp(terms.source, 'i'); // layer names are often in capitals ("FUSCHIA SATIN")
  // Top bar: The Baldwin's menu status and its pre-shift quiz. The Mise demo (topBar) keeps both: its chip is renamed for
  // its own menu and the Quick Quiz asks about its own dishes.
  // Nov 17: topBar 'quiz' (a store with its own menu): its Quick Quiz asks about its own dishes, but the chip names The
  // Baldwin's menu, so only the chip goes.
  if (topBar !== true) for (const n of findAll(m, (x) => x.n === 'Menu chip' || (!topBar && x.n === 'Button · Pre-Shift Quiz'))) drop(m, n);
  for (const [n, json] of statics) if (JSON.stringify(n) === json) drop(m, n);
  for (const n of findAll(m, (x) => STORE_CARDS.includes(x.n))) drop(m, n);
  for (const name of OWN_SECTIONS[slug] || []) { const n = m.c.find((c) => c.n === name); if (n) drop(m, n); }
  if (slug === 'the-bar/cocktails' && !has.house) m.c = m.c.filter((c) => c.n !== 'Our signatures' && c.n !== 'Cocktail matrix');
  if (slug === 'the-bar/wine') {
    if (!has.wine) m.c = m.c.filter((c) => c.n !== 'Section · By the glass' && c.n !== 'Section · By the bottle');
    const key = find(m, (n) => n.n === 'Key' && (n.c || []).some(startsWith('Key · '))); if (key) drop(m, key);
  }
  if (slug === 'the-bar/beer-and-draft' && !has.beer) m.c = m.c.filter((c) => !['Tap wall', 'Section · Tap list', 'Section · In bottles'].includes(c.n));
  if (!sample) dropSamples(m);
  for (const box of BRANDS[slug] ? findAll(m, (n) => n.n === 'Brands to know') : []) {
    for (const b of findAll(box, (n) => typeof n.n === 'string' && n.n.startsWith('Brand · ') && BRANDS[slug][n.n.slice(8)])) {
      const to = BRANDS[slug][b.n.slice(8)]; b.n = 'Brand · ' + to;
      for (const t of findAll(b, (n) => n.t === 'T')) { setText(t, to); t.n = to; }
    }
    // the other bottles are drawn from the first one, so their text layers keep its name
    for (const t of findAll(box, (n) => n.t === 'T' && BRANDS[slug][n.n])) t.n = t.s;
  }
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
    if (theirs(t.s)) { dropLine(m, t); continue; }
    // A text kept for this store's words but still named for one of The Baldwin's (a template's layer name, "FUSCHIA SATIN"
    // on every cocktail card) takes its own words as its name.
    if (t.n && termsI.test(ours ? String(t.n).replace(ours, ' ') : t.n)) t.n = String(t.s || '').slice(0, 60) || 'Text';
    // The Baldwin's flights ($22 wine flight, $30 sommelier flight), drawn on the Wine page, are its own offers.
    if (topBar !== true && /\bwine flight\b|\bsommelier flight\b/i.test(t.s || '')) dropLine(m, t);
  }
  // Wine-list markers on the tasting scales are The Baldwin's bottles.
  if (slug === 'the-bar/wine') for (const n of findAll(m, startsWith('Marker · '))) drop(m, n);
  // Anything still named for one of Baldwin's dishes or drinks (a card whose words were taken out) goes too.
  for (const n of findAll(m, (x) => x !== m && x.n && x.t !== 'T' && theirs(x.n))) drop(m, n);
  return page;
}

/** Search text for a store that isn't The Baldwin: its own pages say nothing yet. */
export const indexText = (e) => (classify(e.slug) === 'own' ? { ...e, text: '', thumb: undefined, blurb: undefined } : e);
export { texts };
