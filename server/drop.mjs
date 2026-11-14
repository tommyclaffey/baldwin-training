// The three-line drop, worked out from the dish (Nov 14, Tommy: "this should be auto generated with the main dish component,
// side and sauce or topper"). Used when a manager hasn't typed the drop in; anything typed in always wins.
// Reads the build's components when there are any, else the Food Book's ingredient list (main ingredient first).

const SAUCE = /\b(sauce|gravy|jus|aioli|glaze|vinaigrette|dressing|pesto|ragu|crema|cream|hollandaise|coulis|salsa|chimichurri|fonduta|fondue|reduction|mostarda|jam|syrup|emulsion|agrumato|beurre blanc|crème fraîche|honey|oil)\b|\bbutter\b(?!-)/i;
const TOPPER = /\b(crispies|crisps?|chips|crumbs?|pangrattato|croutons?|panko|gremolata|tuile|herbs?|chives?|basil|thyme|sage|chervil|tendrils|micro ?greens|sea salt|flaky salt|salt|cracked pepper|black pepper|pepper|zest|parmesan|pecorino|locatelli|asiago|capers?|scallions?|caviar|almonds|pistachios?|pepitas|walnuts|nuts|pickled|grilled lemon|grilled orange|lemon|lime|cocoa|seeds)\b/i;
const CRUNCH = /\b(croutons?|chips|crisps?|crispies|crumbs?|pangrattato|panko|gremolata|tuile|blossoms)\b/i; // always a topper, even "sourdough croutons"
const SIDE = /\b(gnocchetti|gnocchi|tortellini|rigatoni|ravioli|pasta|purée|puree|potato(es)?|mash|fries|tots|polenta|grits|risotto|rice|spinach|asparagus|broccolini|green beans|beans|zucchini|carrots?|chard|kale|salad|greens|bread|sourdough|toast|focaccia|bun|spaghetti|tagliatelle|linguine|fingerlings?|slaw|fennel|cauliflower|squash)\b/i;
const METHOD = /\b(braise|crust|marinade|brine|rub)\b/i; // how the main is cooked, not a part of the plate
const PROPER = new Set(['Pernod', 'Calabrian', 'Fontina', 'Locatelli', 'Beemster', 'Michigan', 'California', 'Hatch', 'Maine', 'Swiss', 'Kalamata', 'Thai', 'Caesar', 'Asiago', 'Parmesan', 'Parma', 'San', 'Dijon', 'NY', 'Brussels', 'Fairway', 'Pecorino']);

const kind = (s) => (METHOD.test(s) ? 'method' : CRUNCH.test(s) ? 'topper' : SAUCE.test(s) && !SIDE.test(s.replace(SAUCE, '')) ? 'sauce' : SIDE.test(s) ? 'side' : TOPPER.test(s) ? 'topper' : 'other');
const lower = (s) => (PROPER.has(s.split(/[\s-]/)[0]) || /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const both = (a) => (a.length > 1 ? `${a[0]} and ${lower(a[1])}` : a[0]);

/** { main, side, sauce, sauceLabel: 'Sauce' | 'Topper', say } from a dish's data, or null when there's nothing to go on. */
export function autoDrop(d) {
  const parts = ((d.components || []).map((c) => c && (c.name || c.component)).filter(Boolean).length >= 3
    ? (d.components || []).map((c) => c.name || c.component)
    : (d.ingredients || [])).map((s) => String(s).trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const k = parts.map((p) => ({ p, k: kind(p) }));
  // The main: the part the dish is named after ("Mushroom Toast" → the mushrooms), else the first part that isn't a sauce or a topper.
  const GENERIC = new Set(['with', 'and', 'the', 'pie', 'pizza', 'salad', 'soup', 'sauce', 'toast', 'plate', 'board', 'brown', 'butter', 'roasted', 'crispy', 'baked', 'fried', 'grilled']);
  const words = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
  const named = words(d.name || '');
  const hit = (p) => words(p).some((w) => named.some((n) => w.startsWith(n) || n.startsWith(w)));
  const main = (k.find((x) => (x.k === 'other' || x.k === 'side') && hit(x.p)) || k.find((x) => x.k === 'other' || x.k === 'side') || k.find((x) => x.k !== 'method') || k[0]).p;
  const rest = k.filter((x) => x.p !== main && x.k !== 'method');
  let sides = rest.filter((x) => x.k === 'side').map((x) => x.p).slice(0, 2);
  if (!sides.length) sides = rest.filter((x) => x.k === 'other').map((x) => x.p).slice(0, 1);
  const sauce = rest.find((x) => x.k === 'sauce')?.p;
  const topper = rest.find((x) => x.k === 'topper' && !sides.includes(x.p))?.p;
  const third = sauce || topper || null;
  if (!sides.length) { const next = rest.find((x) => x.p !== third); if (next) sides = [next.p]; } // nothing side-like: the next part on the plate
  const label = sauce ? 'Sauce' : 'Topper';
  const side = sides.length ? both(sides) : null;
  return { main, side, sauce: third, sauceLabel: label, say: dropSentence(d.name, main, side, third, label) };
}

/** "Here’s the Steak Frites: sliced sirloin, fries, finished with salsa verde." (null without a name and a main) */
export function dropSentence(name, main, side, third, label = 'Sauce') {
  if (!name || !main) return null;
  let say = `Here’s the ${name}: ${lower(main)}`;
  if (side) say += `${third ? ',' : ' with'} ${lower(side)}`;
  if (third) say += label === 'Sauce' ? `, finished with ${lower(third)}` : `, topped with ${lower(third)}`;
  return say + '.';
}
