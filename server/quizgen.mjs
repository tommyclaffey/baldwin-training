// Quizzes written from the book itself (Tommy, Oct 30: "built-in quizzes, or you can customize what's in the quizzes").
// Every question comes from a store's own dishes, cocktails, wines and beers, so a new restaurant gets quizzes the moment
// its menu is in. A question's id ("price:123") is enough to write it again on the server, so scoring never trusts the phone.
import { listEntries, COURSES } from './cms.mjs';
import { allChapters, chapterSlug, shuffleSeeded } from './manual.mjs';

export const PASS_PCT = 80;
export const passFor = (total) => Math.ceil((total * PASS_PCT) / 100);

/* ---- seeded randomness: the same question always gets the same answers in the same order ---- */
function seed(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(str) { let a = seed(str); return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, r) { const b = [...arr]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

const clean = (s) => String(s || '').trim();
const bad = (s) => !clean(s) || /^(—|-|tbd|ask the bar|none)$/i.test(clean(s)) || /to confirm/i.test(clean(s));
/** "the Old Fashioned", but "The Furest" (no doubled article). */
const the = (n) => (/^the\s/i.test(n) ? n : 'the ' + n);
const money = (p) => (clean(p) && /^\d/.test(clean(p)) ? `$${clean(p).replace(/^\$/, '')}` : '');
const uniq = (a) => [...new Set(a.filter((x) => !bad(x)))];

/* The Food Book's Allergen Guide (p. 50), as words to look for in a dish: a dish that might have it is never offered as safe. */
const GUIDE = {
  gluten: /pasta|spaghetti|tagliatelle|rigatoni|tortellini|gnocchetti|agnolotti|ravioli|pizza|\bpie\b|dough|bread|focaccia|toast|\bbun\b|brioche|crouton|pangrattato|panko|breaded|breading|fried|fries|\btots?\b|flour|semolina|malt|cutlet|crust|arancini|risotto|meatball|ragu/i,
  dairy: /chees|butter|cream|crema|crème|ricotta|burrata|stracciatella|mozzarella|parmesan|parmigiano|locatelli|fontina|fonduta|gruy|brie|goat|mascarpone|asiago|beemster|hollandaise|beurre|pesto|zip sauce|grits|cacio/i,
  egg: /pasta|spaghetti|tagliatelle|rigatoni|tortellini|gnocchetti|agnolotti|ravioli|aioli|hollandaise|caesar|bread|breaded|breading|fried|cutlet|meatball|arancini|crust|mayo|sauce|panko|pangrattato|crouton/i,
  'tree nut': /\bnut|almond|pistachio|walnut|pine nut|pesto|praline|hazelnut/i,
  peanut: /peanut|\bnut/i,
  shellfish: /shrimp|crab|lobster|scallop|calamari|clam|oyster|mussel|prawn/i,
  finfish: /salmon|fish|caviar|anchov|caesar|tuna|walleye|cod\b/i,
  pork: /pork|prosciutto|guanciale|pepperoni|bacon|pancetta|\bham\b|meatball|ragu|sausage|salumi|sunday sauce/i,
  allium: /onion|garlic|shallot|leek|scallion|chive|sauce|dressing|aioli|ragu|pesto|gravy|vinaigrette|salsa|\bjam\b|fonduta|fondue|crema|marinat|soup|beurre blanc|coulis|braise|confit|au poivre|pernod|rockefeller|cream sauce/i,
  nightshade: /tomato|potato|fries|\btots?\b|eggplant|peppers|pepperoni|chili|calabrian|paprika|harissa|hot honey|zip sauce|7 peppers|ragu|sunday sauce|margherita/i,
};
const dishText = (x) => [x.data.name, x.data.description, ...(x.data.ingredients || []), x.data.inspiration].filter(Boolean).join(' · ');
/** True when a dish might hold this allergen even though its page doesn't list it (or it has a gluten-free option, which means it isn't). */
const mayHave = (x, a) => { const k = String(a).toLowerCase(); return (GUIDE[k] ? GUIDE[k].test(dishText(x)) : false) || (k === 'gluten' && !!x.data.gfOption); };

/* ---- Nov 5 (Tommy: "Some of the questions are incorrect … the base spirit to a cocktail is a sugar cube"):
   every wrong answer has to be plainly wrong, so nothing in it may overlap the right answer. ---- */
const GENERIC = new Set(['juice', 'syrup', 'nectar', 'liqueur', 'bitters', 'oz', 'top', 'fill', 'splash', 'fresh', 'the', 'de', 'la', 'di', 'of', 'and', 'in', 'on', 'with', 'or', 'a', 'dashes', 'house', 'local', 'roasted', 'crispy', 'toasted', 'warm', 'grilled', 'sauteed', 'seared', 'pickled', 'fried', 'organic', 'hand', 'cut', 'sea', 'thin', 'paper', 'large', 'small', 'whole', 'shaker', 'mix']);
const words = (x) => String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).map((w) => w.replace(/(es|s)$/, '')).filter((w) => w.length > 2 && !GENERIC.has(w)).flatMap((w) => (/^(toast|focaccia|crouton|bun|brioche|bread)$/.test(w) ? ['bread'] : /^(sprite|7up|coke|soda|lemon-lime|lime-lemon)$/.test(w) ? ['soda'] : /^(saline|salt)$/.test(w) ? ['salt'] : [w]));
/** "Sprite (top)", "Thyme, in the shaker", "Angostura Bitters, on top" → the ingredient itself. */
const ingName = (x) => { const v = clean(x).replace(/\s*\((?:top)\)$/i, '').replace(/,\s*(?:in the shaker|on top)$/i, ''); return /^agave$/i.test(v) ? 'Agave nectar' : v; };
const shares = (a, b) => { const A = new Set(words(a)); return words(b).some((w) => A.has(w)); };
/** Garnish words that don't tell one garnish from another ("orange peel" vs "orange twist" are the same thing). */
const GARNISH_FORM = new Set(['peel', 'twist', 'slice', 'wedge', 'sprig', 'leaf', 'leave', 'wheel', 'optional', 'rim', 'dried', 'torched', 'half', 'discarded', 'dehydrated', 'champagne', 'spice', 'flower']);
const garnishWords = (x) => words(x).filter((w) => !GARNISH_FORM.has(w));
/** Glass families: "Short rocks, large ice" and "Crystal rocks" are both rocks glasses. */
const GLASSES = [['rocks', /rock|old fashion|short fancy/], ['coupe', /coupe/], ['martini', /martini/], ['nick & nora', /nick/], ['highball', /highball|collins|tall/], ['flute', /flute/], ['mule mug', /mule|copper/], ['wine glass', /wine/], ['pint', /pint/], ['goblet', /goblet/], ['snifter', /snifter/], ['julep cup', /julep/], ['hurricane', /hurricane/], ['irish coffee mug', /irish|mug/]];
const glassFam = (g) => GLASSES.filter(([, re]) => re.test(String(g || '').toLowerCase())).map(([k]) => k);
/** Shaken, stirred or built, from the method line. */
const methodFam = (m) => { const x = String(m || '').toLowerCase(); const f = [/shak/.test(x) && 'Shaken', /stir/.test(x) && 'Stirred', /build|built/.test(x) && 'Built in the glass'].filter(Boolean); return f.length === 1 ? f[0] : ''; };
/** A base spirit the quiz can ask about (not "Several spirits", spiritless or a guest's-choice aperitivo). */
const SPIRITS = ['Gin', 'Vodka', 'Rye', 'Bourbon', 'Tequila', 'Mezcal', 'Rum', 'Cognac', 'Pisco', 'Aquavit', 'Scotch', 'Brandy', 'Chartreuse', 'Limoncello', 'Pimm’s'];
const askableBase = (b) => SPIRITS.includes(clean(b));
/** For the shared classics (no base field): the base from the spirit line, if it names a spirit. */
const SPIRIT_RE = /\b(bourbon|rye|scotch|gin|vodka|mezcal|tequila|rum|cachaça|cognac|brandy|pisco|whiske?y)\b/i;
const baseFromBuild = (d) => { if ((d.build || []).filter((b) => SPIRIT_RE.test(b?.ingredient || '')).length > 2) return ''; // a Long Island has five
  const line = (d.build || []).find((b) => b?.spirit)?.ingredient || ''; const l = line.toLowerCase();
  return [['bourbon', 'Bourbon'], ['rye', 'Rye'], ['scotch', 'Scotch'], ['gin', 'Gin'], ['vodka', 'Vodka'], ['mezcal', 'Mezcal'], ['tequila', 'Tequila'], ['rum', 'Rum'], ['cachaça', 'Cachaça'], ['cognac', 'Cognac'], ['brandy', 'Brandy'], ['pisco', 'Pisco'], ['whiskey', 'Whiskey'], ['whisky', 'Whisky']].find(([k]) => new RegExp('\\b' + k + '\\b').test(l))?.[1] || ''; };

/** The topics a person can pick, in the order they're shown. */
export function topicList(pool) {
  const count = (k) => pool.filter((q) => q.topics.includes(k)).length;
  const t = [
    ...COURSES.map((c) => ({ key: 'course:' + c, label: c, group: 'Food' })),
    { key: 'house', label: 'House Cocktails', group: 'Bar' },
    { key: 'classic', label: 'Classic Cocktails', group: 'Bar' },
    { key: 'wine-glass', label: 'Wine by the Glass', group: 'Bar' },
    { key: 'wine-bottle', label: 'Wine by the Bottle', group: 'Bar' },
    { key: 'beer', label: 'Beer', group: 'Bar' },
    { key: 'allergens', label: 'Allergens', group: 'Know It Cold' },
    { key: 'pairings', label: 'Pairings', group: 'Know It Cold' },
    ...allChapters().map((c) => ({ key: 'study:' + c.slug, label: c.title, group: c.level === 2 ? 'Sommelier Level 2' : 'Sommelier Level 1' })),
  ];
  return t.map((x) => ({ ...x, count: count(x.key) })).filter((x) => x.count >= 3);
}
/** Topics that are also sign-off quizzes on their own. */
export const BUILT_IN = (key) => key.startsWith('course:') || key.startsWith('study:') || ['house', 'classic', 'wine-glass', 'wine-bottle', 'beer', 'allergens'].includes(key);

/** Every question this store's book can ask. */
export function questionPool(db, store) {
  const recipes = listEntries(db, 'recipe', store);
  const house = listEntries(db, 'house', store);
  const classics = listEntries(db, 'classic');
  const wines = listEntries(db, 'wine', store);
  const beers = listEntries(db, 'beer', store);
  const out = [];
  // One question: the right answer plus three others from the pool, in a fixed (seeded) order.
  const ask = (ref, { q, right, pool, why, page, label, topics, different }) => {
    right = clean(right);
    if (bad(right)) return;
    const r = rng(ref);
    // No near-twins of the answer ("Stir" next to "Stirred", "Rocks" next to "Rocks or coupe"), and no near-twins of each other.
    const key = (x) => x.toLowerCase().replace(/\b(then|and|or|a|the|with)\b/g, '').replace(/[^a-z0-9$]/g, '').replace(/(ed|ing|s)$/, '');
    const close = (a, b) => key(a) === key(b) || (Math.min(a.length, b.length) <= 24 && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase())));
    const others = [];
    for (const x of shuffle(uniq(pool), r)) { if (others.length === 3) break; if (!close(x, right) && !others.some((o) => close(o, x)) && (!different || different(x, others))) others.push(x); }
    if (others.length < 3) return;
    const options = shuffle([right, ...others], r);
    out.push({ ref, q, options, answer: options.indexOf(right), why, page, label, topics });
  };

  /* dishes */
  const dishName = (e) => e.data.name;
  for (const e of recipes) {
    const d = e.data, n = d.name, page = '/' + e.slug, course = 'course:' + d.course, base = { page, label: n };
    const same = recipes.filter((x) => x.data.course === d.course && x !== e);
    if (d.description) ask('describe:' + e.id, { ...base, q: `Which dish is this? “${clean(d.description)}”`, right: n, pool: (same.length >= 3 ? same : recipes).map(dishName), why: `That’s ${the(n)}.`, topics: [course] });
    // Nov 5 review: no "which allergens are listed" combos (the book's allergen matrix is a draft; options differing by one tag aren't fair).
    // Pairings: wrong answers are other wines and cocktails the Food Book pairs, never this dish's own (similar or opposite).
    const mineW = [d.pairing, d.pairingOpposite].filter(Boolean).map((x) => x.toLowerCase());
    if (d.pairing) ask('wine:' + e.id, { ...base, q: `Which wine do we suggest with ${the(n)}?`, right: d.pairing, pool: recipes.flatMap((x) => [x.data.pairing, x.data.pairingOpposite]).filter((x) => x && !mineW.includes(x.toLowerCase())), why: `${d.pairing} is the similar pairing${d.pairingOpposite ? `; ${d.pairingOpposite} is the opposite` : ''}.`, topics: [course, 'pairings'] });
    if (d.cocktail) ask('cocktail:' + e.id, { ...base, q: `Which cocktail do we pair with ${the(n)}?`, right: d.cocktail, pool: recipes.map((x) => x.data.cocktail).filter((x) => x && x.toLowerCase() !== d.cocktail.toLowerCase()), why: `Suggest the ${d.cocktail}.`, topics: [course, 'pairings'] });
    if (d.inspiration) ask('inspired:' + e.id, { ...base, q: `What’s the idea behind ${the(n)}?`, right: d.inspiration, pool: recipes.filter((x) => x.data.course !== d.course).map((x) => x.data.inspiration), why: `${d.inspiration}.`, topics: [course] });
    if (d.dropSide) ask('side:' + e.id, { ...base, q: `What comes on the side of ${the(n)}?`, right: d.dropSide, pool: recipes.map((x) => x.data.dropSide), why: `${d.dropSide}.`, topics: [course] });
    if (d.dropSauce) ask('sauce:' + e.id, { ...base, q: `What sauce comes with ${the(n)}?`, right: d.dropSauce, pool: recipes.map((x) => x.data.dropSauce), why: `${d.dropSauce}.`, topics: [course] });
    // Nov 5, Tommy: "Make sure they're not kitchen questions … We want allergens, ingredients, what to say to a guest."
    // (No station, portion or build questions.)
    // A guest's allergy: the dish to steer them away from, against dishes that don't list it.
    const alg = (d.allergens || []).filter(Boolean);
    if (alg.length) {
      const a = alg[Math.floor(rng('avoid:' + e.id)() * alg.length)];
      // The Food Book: pork is "often a dietary or religious choice rather than an allergy … ask about meatballs and ragu".
      const pork = /^pork$/i.test(a);
      // Wrong answers are dishes clear of it on their page AND by the Food Book's Allergen Guide (p. 50: egg in fresh pasta and
      // breading, nuts in pesto, nightshade in hot honey, allium in sauces, "ask about meatballs and ragu"…).
      const safe = recipes.filter((x) => !(x.data.allergens || []).some((y) => String(y).toLowerCase() === String(a).toLowerCase()) && !mayHave(x, a));
      ask('avoid:' + e.id, { ...base, q: pork ? 'A guest doesn’t eat pork. Which of these dishes has pork?' : `A guest has ${/^[aeiou]/i.test(String(a)) ? 'an' : 'a'} ${String(a).toLowerCase()} allergy. Which of these dishes lists ${String(a).toLowerCase()}?`, right: n, pool: (safe.filter((x) => x.data.course === d.course).length >= 3 ? safe.filter((x) => x.data.course === d.course) : safe).map(dishName), why: `${the(n)[0].toUpperCase() + the(n).slice(1)} lists ${String(a).toLowerCase()}. Always confirm with the kitchen.`, topics: [course, 'allergens'] });
    }
    // What's in it: one of its ingredients, against ingredients it doesn't have.
    const ing = (d.ingredients || []).filter(Boolean);
    if (ing.length) {
      const mine = new Set(ing.map((x) => String(x).toLowerCase()));
      // not one the name gives away ("Filet mignon" in the Espresso Encrusted Filet)
      const words = new Set(String(n).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3));
      const hidden = ing.filter((x) => !String(x).toLowerCase().split(/[^a-z]+/).some((w) => words.has(w)) && !shares(n, x));
      const one = hidden.length ? hidden[Math.floor(rng('ing:' + e.id)() * hidden.length)] : null;
      if (one) ask('ing:' + e.id, { ...base, q: `A guest asks what’s in ${the(n)}. Which of these is in it?`, right: one, pool: recipes.flatMap((x) => x.data.ingredients || []).filter((x) => x && !mine.has(String(x).toLowerCase()) && !ing.some((i) => shares(i, x)) && !shares(n, x) && !shares(d.description, x)), different: (x, others) => !others.some((o) => shares(o, x)), why: `${the(n)[0].toUpperCase() + the(n).slice(1)}: ${ing.join(', ')}.`, topics: [course] });
    }
    // What to say: the drop line, the selling line and a talking point (only finished lines, no "[sauce]" blanks).
    const done = (x) => x && !/\[[^\]]*\]/.test(x);
    if (done(d.say)) ask('say:' + e.id, { ...base, q: `You’re dropping ${the(n)}. What do you say?`, right: d.say, pool: recipes.map((x) => x.data.say).filter(done), why: `That’s the three-line drop for ${the(n)}.`, topics: [course] });
    if (done(d.sellingLine)) ask('sell:' + e.id, { ...base, q: `A guest is deciding. Which line sells ${the(n)}?`, right: d.sellingLine, pool: recipes.filter((x) => x.data.course !== d.course).map((x) => x.data.sellingLine).filter(done), why: `That’s the selling line for ${the(n)}.`, topics: [course] });
    const tps = (d.talkingPoints || []).filter(done);
    if (tps.length) ask('talk:' + e.id, { ...base, q: `Which of these can you tell a guest about ${the(n)}?`, right: tps[0], pool: recipes.filter((x) => x !== e).flatMap((x) => x.data.talkingPoints || []).filter(done), why: `It’s one of the talking points for ${the(n)}.`, topics: [course] });
  }

  /* cocktails. The Baldwin's bar is its Drink Book: the house list, with the book's classics as the Classic Cocktails topic.
     A store whose list has no Classics section quizzes the shared classics instead. */
  const ownClassics = house.filter((x) => x.data.menuSection === 'Classics');
  const sets = ownClassics.length ? [[house.filter((x) => x.data.menuSection !== 'Classics'), 'house'], [ownClassics, 'classic']] : [[house, 'house'], [classics, 'classic']];
  const drinks = sets.flatMap(([l]) => l);
  const baseOf = (x) => (x.data.base !== undefined ? clean(x.data.base) : baseFromBuild(x.data));
  const METHODS = ['Shaken', 'Stirred', 'Built in the glass', 'Blended'];
  for (const [list, topic] of sets) {
    for (const e of list) {
      const d = e.data, n = d.name, base = { page: '/' + e.slug, label: n };
      const b = baseOf(e);
      const liqueur = ['Chartreuse', 'Limoncello', 'Pimm’s'].includes(b);
      // The Drink Book: "All tequila is technically mezcal"; Pimm's is gin-based. A name that gives the answer away isn't a question.
      const near = { Tequila: ['Mezcal'], Gin: ['Pimm’s'], Rye: [], Bourbon: [] }[b] || [];
      if (/martini/i.test(n) && b === 'Vodka') near.push('Gin'); // "Vodka or Gin Martini" (Social Hour)
      if (askableBase(b) && !shares(n, b)) ask('spirit:' + e.id, { ...base, q: liqueur ? `What’s the base of ${the(n)}?` : `What’s the base spirit in ${the(n)}?`, right: b, pool: SPIRITS.slice(0, 10).filter((x) => !near.includes(x)), why: `${b}${(d.build || []).find((x) => x?.spirit) ? ': ' + [(d.build.find((x) => x?.spirit).amount || ''), d.build.find((x) => x?.spirit).ingredient].join(' ').trim() : ''}.`, topics: [topic] });
      const gf = glassFam(d.glass);
      if (gf.length && !bad(d.glass)) ask('glass:' + e.id, { ...base, q: `Which glass is ${the(n)} served in?`, right: d.glass, pool: drinks.map((x) => x.data.glass), different: (x, others) => { const f = glassFam(x); return f.length && !f.some((k) => gf.includes(k)) && !others.some((o) => glassFam(o).some((k) => f.includes(k))); }, why: `${d.glass}.`, topics: [topic] });
      const gw = garnishWords(d.garnish);
      if (gw.length && !bad(d.garnish) && !/^none|optional/i.test(d.garnish)) ask('garnish:' + e.id, { ...base, q: `What’s the garnish on ${the(n)}?`, right: d.garnish, pool: drinks.map((x) => x.data.garnish).filter((x) => !/^none|optional/i.test(x || '')), different: (x, others) => { const w = garnishWords(x); return w.length && !w.some((k) => gw.includes(k)) && !others.some((o) => garnishWords(o).some((k) => w.includes(k))); }, why: `${d.garnish}.`, topics: [topic] });
      const mf = methodFam(d.method);
      // The book's bar terms: shake drinks with citrus, juice, cream or egg; stir spirit-only drinks. A spec that breaks its own rule waits for the bar lead.
      const shakeable = (d.build || []).some((x) => /juice|lime|lemon|cream|egg|foam|pur[eé]e|pineapple|espresso|coffee|grapefruit|pom\b|pomegranate|cranberry|acai|syrup|agave|honey|orange|basil|mint|arugula|cucumber|thyme|sour mix|lemonade/i.test(x?.ingredient || ''));
      if (mf && !(mf === 'Shaken' && !shakeable)) ask('method:' + e.id, { ...base, q: `How is ${the(n)} made?`, right: mf, pool: METHODS, why: `${d.method}.`, topics: [topic] });
      const mine = (d.build || []).filter((x) => x && x.ingredient);
      // House preps (foams, cordials, oleo, house syrups and mixes) are made with sugar syrup (Drink Book prep pages), so it's never a wrong answer here.
      const madeWithSugar = mine.some((x) => /foam|cordial|oleo|mix|syrup|pur[eé]e/i.test(x.ingredient));
      const extras = mine.filter((x) => !x.spirit && words(x.ingredient).length && !/ or /.test(x.ingredient));
      const extra = extras.length ? extras[Math.floor(rng('in:' + e.id)() * extras.length)] : null;
      if (extra) ask('in:' + e.id, { ...base, q: `Which of these is in ${the(n)}?`, right: ingName(extra.ingredient), pool: drinks.flatMap((x) => (x.data.build || []).map((y) => ingName(y?.ingredient))).filter((i) => i && !/ or /.test(i) && !mine.some((m) => shares(m.ingredient, i)) && !shares(n, i) && !(madeWithSugar && /simple|sugar|demerara/i.test(i))), different: (x, others) => !others.some((o) => shares(o, x)), why: mine.map((x) => [x.amount, x.ingredient].filter(Boolean).join(' ')).join(', ') + '.', topics: [topic] });
    }
  }

  /* wines */
  const GRAPE_NAMES = ['Cabernet Sauvignon', 'Cabernet Franc', 'Merlot', 'Malbec', 'Pinot Noir', 'Gamay Noir', 'Syrah', 'Shiraz', 'Zinfandel', 'Barbera', 'Montepulciano', 'Nero d\'Avola', 'Nerello Mascalese', 'Sangiovese', 'Nebbiolo', 'Tempranillo', 'Grenache', 'Chardonnay', 'Sauvignon Blanc', 'Riesling', 'Pinot Grigio', 'Pinot Gris', 'Chenin Blanc', 'Viognier', 'Pecorino', 'Vermentino', 'Verdicchio', 'Garganega', 'Albariño', 'Alvarinho', 'Glera', 'Cortese'];
  const isGrape = (g) => GRAPE_NAMES.includes(clean(g));
  const TWINS = [['Syrah', 'Shiraz'], ['Albariño', 'Alvarinho'], ['Pinot Grigio', 'Pinot Gris']];
  const sameGrape = (a, b) => clean(a) === clean(b) || TWINS.some((t) => t.includes(clean(a)) && t.includes(clean(b)));
  const wineName = (w) => { const d = w.data; return isGrape(d.grape) && !d.name.toLowerCase().includes(d.grape.toLowerCase()) ? `${d.name} ${d.grape}` : d.name; };
  for (const e of wines) {
    const d = e.data, n = wineName(e), topic = money(d.glass) ? 'wine-glass' : 'wine-bottle', base = { page: '/' + e.slug, label: n };
    // Only real grape varieties ("Chianti Classico", "Rioja", "Blend" and "Brut" aren't grapes); same grape, two names, never side by side.
    if (isGrape(d.grape) && !d.name.toLowerCase().includes(d.grape.toLowerCase())) ask('grape:' + e.id, { ...base, q: `What grape is ${the(d.name)} made from?`, right: d.grape, pool: wines.map((x) => x.data.grape).filter(isGrape), different: (x, others) => !sameGrape(x, d.grape) && !others.some((o) => sameGrape(o, x)), why: `${d.grape}.`, topics: [topic] });
    // Wrong regions come from another country on the list, so "California" is never offered against "Napa".
    if (!/rouge|blanc\b|vieilles vignes/i.test(d.region || '') && !shares(d.name, d.region) && !/sake/i.test(d.grape || '')) ask('region:' + e.id, { ...base, q: `Where is ${the(n)} from?`, right: d.region, pool: wines.filter((x) => x.data.country !== d.country).map((x) => x.data.region), why: `${d.region}.`, topics: [topic] });
    // Which dish: from the Food Book's pairings (a dish names its wine), never a dish that pairs it either way.
    const named = (p) => { const w = words(p); return w.length && w.every((x) => words(`${d.name} ${d.grape || ''} ${d.region || ''}`).some((y) => y.startsWith(x) || x.startsWith(y))); };
    const sim = recipes.filter((x) => named(x.data.pairing));
    const any = new Set([...sim, ...recipes.filter((x) => named(x.data.pairingOpposite))]);
    const dish = sim.length ? sim[Math.floor(rng('pairs:' + e.id)() * sim.length)] : null;
    if (dish) ask('pairs:' + e.id, { ...base, q: `Which dish do we suggest ${the(n)} with?`, right: dish.data.name, pool: recipes.filter((x) => !any.has(x)).map(dishName), why: `${the(dish.data.name)[0].toUpperCase() + the(dish.data.name).slice(1)} lists it as the similar pairing.`, topics: [topic, 'pairings'] });
  }

  /* beer */
  for (const e of beers) {
    const d = e.data, base = { page: '/the-bar/beer-and-draft', label: d.name };
    // Nov 5 review: beer styles were sorted by us, not printed on the menu, so they aren't quizzed.
    void d; void base;
  }
  /* the Study Guide's cards: the chapter's own three wrong answers, in a fixed order per card */
  for (const ch of allChapters()) {
    ch.cards.forEach((c, i) => {
      const ref = `study:${ch.slug}:${i}`;
      const options = shuffleSeeded([c.answer, ...c.wrong.slice(0, 3)], ref);
      out.push({ ref, q: c.q, options, answer: options.indexOf(c.answer), why: `${c.answer}.`, page: '/' + chapterSlug(ch), label: ch.title, topics: ['study:' + ch.slug] });
    });
  }
  return out;
}

/** The questions for a set of topics. */
export const forTopics = (pool, topics) => pool.filter((q) => q.topics.some((t) => topics.includes(t)));

/** Up to n questions, at random. */
export function pick(qs, n) { const r = Math.random; return shuffle(qs, r).slice(0, n); }
