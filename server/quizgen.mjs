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
    { key: 'allergens', label: 'Allergens', group: 'Know it cold' },
    { key: 'pairings', label: 'Pairings', group: 'Know it cold' },
    { key: 'prices', label: 'Prices', group: 'Know it cold' },
    ...allChapters().map((c) => ({ key: 'study:' + c.slug, label: c.title, group: c.level === 2 ? 'Sommelier Level 2' : 'Sommelier Study Guide' })),
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
  const ask = (ref, { q, right, pool, why, page, label, topics }) => {
    right = clean(right);
    if (bad(right)) return;
    const r = rng(ref);
    // No near-twins of the answer ("Stir" next to "Stirred", "Rocks" next to "Rocks or coupe"), and no near-twins of each other.
    const key = (x) => x.toLowerCase().replace(/\b(then|and|or|a|the|with)\b/g, '').replace(/[^a-z0-9$]/g, '').replace(/(ed|ing|s)$/, '');
    const close = (a, b) => key(a) === key(b) || (Math.min(a.length, b.length) <= 24 && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase())));
    const others = [];
    for (const x of shuffle(uniq(pool), r)) { if (others.length === 3) break; if (!close(x, right) && !others.some((o) => close(o, x))) others.push(x); }
    if (others.length < 3) return;
    const options = shuffle([right, ...others], r);
    out.push({ ref, q, options, answer: options.indexOf(right), why, page, label, topics });
  };

  /* dishes */
  const dishName = (e) => e.data.name;
  for (const e of recipes) {
    const d = e.data, n = d.name, page = '/' + e.slug, course = 'course:' + d.course, base = { page, label: n };
    const same = recipes.filter((x) => x.data.course === d.course && x !== e);
    if (d.price) ask('price:' + e.id, { ...base, q: `What does ${the(n)} cost?`, right: money(d.price), pool: recipes.map((x) => money(x.data.price)), why: `The ${n} is ${money(d.price)}.`, topics: [course, 'prices'] });
    if (d.description) ask('describe:' + e.id, { ...base, q: `Which dish is this? “${clean(d.description)}”`, right: n, pool: (same.length >= 3 ? same : recipes).map(dishName), why: `That’s ${the(n)}.`, topics: [course] });
    const alOf = (x) => ((x.data.allergens || []).length ? [...x.data.allergens].sort().join(', ') : 'None listed');
    const al = alOf(e);
    ask('allergens:' + e.id, { ...base, q: `Which allergens are listed for ${the(n)}?`, right: al, pool: recipes.map(alOf), why: `${al}. Always confirm with the kitchen.`, topics: [course, 'allergens'] });
    if (d.pairing) ask('wine:' + e.id, { ...base, q: `Which wine do we suggest with ${the(n)}?`, right: d.pairing, pool: [...recipes.map((x) => x.data.pairing), ...wines.map((w) => `${w.data.name} ${w.data.grape || ''}`.trim())].filter((x) => !d.pairingOpposite || (x || '').toLowerCase() !== d.pairingOpposite.toLowerCase()), why: `${d.pairing} is the pairing to suggest.`, topics: [course, 'pairings'] });
    if (d.cocktail) ask('cocktail:' + e.id, { ...base, q: `Which cocktail pairs with ${the(n)}?`, right: d.cocktail, pool: [...house, ...classics].map((x) => x.data.name), why: `Suggest the ${d.cocktail}.`, topics: [course, 'pairings'] });
    if (d.dropSide) ask('side:' + e.id, { ...base, q: `What comes on the side of ${the(n)}?`, right: d.dropSide, pool: recipes.map((x) => x.data.dropSide), why: `${d.dropSide}.`, topics: [course] });
    if (d.dropSauce) ask('sauce:' + e.id, { ...base, q: `What sauce comes with ${the(n)}?`, right: d.dropSauce, pool: recipes.map((x) => x.data.dropSauce), why: `${d.dropSauce}.`, topics: [course] });
    if (d.station) ask('station:' + e.id, { ...base, q: `Which station makes ${the(n)}?`, right: d.station, pool: recipes.map((x) => x.data.station), why: `${d.station}.`, topics: [course] });
  }

  /* cocktails: house and classic */
  const drinks = [...house, ...classics];
  const spiritOf = (x) => (x.data.build || []).find((b) => b?.spirit)?.ingredient || x.data.tableBase || '';
  for (const [list, topic] of [[house, 'house'], [classics, 'classic']]) {
    for (const e of list) {
      const d = e.data, n = d.name, base = { page: '/' + e.slug, label: n };
      ask('spirit:' + e.id, { ...base, q: `What’s the base spirit in ${the(n)}?`, right: spiritOf(e), pool: drinks.map(spiritOf), why: `${spiritOf(e)}.`, topics: [topic] });
      ask('glass:' + e.id, { ...base, q: `Which glass is ${the(n)} served in?`, right: d.glass, pool: drinks.map((x) => x.data.glass), why: `A ${clean(d.glass).toLowerCase()}.`, topics: [topic] });
      ask('garnish:' + e.id, { ...base, q: `What’s the garnish on ${the(n)}?`, right: d.garnish, pool: drinks.map((x) => x.data.garnish), why: `${d.garnish}.`, topics: [topic] });
      ask('method:' + e.id, { ...base, q: `How is ${the(n)} made?`, right: d.method, pool: drinks.map((x) => x.data.method), why: `${d.method}.`, topics: [topic] });
      if (topic === 'house' && d.price) ask('dprice:' + e.id, { ...base, q: `What does ${the(n)} cost?`, right: money(d.price), pool: house.map((x) => money(x.data.price)), why: `The ${n} is ${money(d.price)}.`, topics: [topic, 'prices'] });
      const mine = (d.build || []).filter((b) => b && b.ingredient);
      const extra = mine.find((b) => !b.spirit);
      if (extra) {
        const inIt = new Set(mine.map((b) => b.ingredient.toLowerCase()));
        ask('in:' + e.id, { ...base, q: `Which of these is in ${the(n)}?`, right: extra.ingredient, pool: drinks.flatMap((x) => (x.data.build || []).map((b) => b?.ingredient)).filter((i) => i && !inIt.has(i.toLowerCase())), why: `${extra.amount ? extra.amount + ' ' : ''}${extra.ingredient}.`, topics: [topic] });
      }
    }
  }

  /* wines */
  const wineName = (w) => { const d = w.data; return d.grape && !d.name.toLowerCase().includes(d.grape.toLowerCase()) ? `${d.name} ${d.grape}` : d.name; };
  for (const e of wines) {
    const d = e.data, n = wineName(e), topic = money(d.glass) ? 'wine-glass' : 'wine-bottle', base = { page: '/' + e.slug, label: n };
    if (d.grape && !d.name.toLowerCase().includes(d.grape.toLowerCase())) ask('grape:' + e.id, { ...base, q: `What grape is ${the(d.name)}?`, right: d.grape, pool: wines.map((x) => x.data.grape), why: `${d.grape}.`, topics: [topic] });
    ask('region:' + e.id, { ...base, q: `Where is ${the(n)} from?`, right: d.region, pool: wines.map((x) => x.data.region), why: `${d.region}.`, topics: [topic] });
    if (money(d.glass)) ask('glass:' + e.id, { ...base, q: `What does a glass of ${the(n)} cost?`, right: money(d.glass), pool: wines.map((x) => money(x.data.glass)), why: `${money(d.glass)} a glass.`, topics: [topic, 'prices'] });
    else if (money(d.bottle)) ask('bottle:' + e.id, { ...base, q: `What does a bottle of ${the(n)} cost?`, right: money(d.bottle), pool: wines.map((x) => money(x.data.bottle)), why: `${money(d.bottle)} a bottle.`, topics: [topic, 'prices'] });
    const listed = String(d.pairs || '').split(/,| · /).map(clean).filter(Boolean);
    const dish = listed[0];
    const taken = new Set(listed.map((x) => x.toLowerCase()));
    if (dish) ask('pairs:' + e.id, { ...base, q: `Which dish pairs with ${the(n)}?`, right: dish, pool: recipes.map(dishName).filter((x) => !taken.has(x.toLowerCase())), why: `The ${dish}.`, topics: [topic, 'pairings'] });
  }

  /* beer */
  for (const e of beers) {
    const d = e.data, base = { page: '/the-bar/beer-and-draft', label: d.name };
    ask('style:' + e.id, { ...base, q: `What style of beer is ${d.name}?`, right: d.style, pool: beers.map((x) => x.data.style), why: `${d.style}.`, topics: ['beer'] });
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
