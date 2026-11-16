// The Baldwin demo's pairings (Nov 15 audit, item 23). The Baldwin demo copies The Baldwin's real wine list, so its wines
// "paired with" dishes the demo menu doesn't have (Walleye Milanese, Short Rib, Seasonal Veggie Pie, Duck Gnocchetti…).
// In a demo copy each Baldwin dish becomes the closest dish on the demo's own menu (content/demo/recipe.json), or goes
// when there isn't one. The real Baldwin's data is never touched: this only rewrites the copy a demo makes.

/** Baldwin menu dish (current Food Book names, the older design names and short mentions) → the demo menu's dish.
 *  null = nothing like it on the demo menu, so the pairing goes. */
export const BALDWIN_TO_DEMO = {
  'Braised Short Rib': '12 oz NY Strip', 'Short Rib': '12 oz NY Strip',
  'Espresso Filet': '12 oz NY Strip', 'Espresso Encrusted Filet Mignon': '12 oz NY Strip', 'Steak Frites': '12 oz NY Strip',
  'Lamb Chops': 'Bone-In Pork Chop', 'Lamb Chops au Poivre': 'Bone-In Pork Chop', 'Duck Gnocchetti': 'Bone-In Pork Chop',
  'Roasted Chicken': 'Chicken Parmesan', 'Chicken Saltimbocca': 'Chicken Parmesan',
  'Walleye Milanese': 'Seared Salmon', Walleye: 'Seared Salmon', 'Sun-Dried Tomato Salmon': 'Seared Salmon',
  'Scallops Rockefeller': 'Lobster Tagliatelle', 'Scallops Rock': 'Lobster Tagliatelle', 'Scallop Rockefeller': 'Lobster Tagliatelle',
  'Lobster & Crab Tortellini': 'Lobster Tagliatelle',
  'Squash Agnolotti': 'Cacio e Pepe', Agnolotti: 'Cacio e Pepe', 'Cacio Ravioli': 'Cacio e Pepe', 'Brown Butter Cacio Ravioli': 'Cacio e Pepe',
  'Rigatoni Ragu': 'Rigatoni alla Vodka', 'Sunday Sauce': 'Rigatoni alla Vodka', 'Sunday Sauce Pasta': 'Rigatoni alla Vodka',
  'Short Rib Arancini': 'Meatballs al Forno', 'Baked Meatballs': 'Meatballs al Forno',
  'JB Calamari': 'Crispy Calamari', 'Shrimp & Eggplant': 'Crispy Calamari',
  'Burrata & Artichoke': 'Burrata & Heirloom Tomato', 'Burrata & Artichokes': 'Burrata & Heirloom Tomato',
  'Prosciutto Fondue': 'Whipped Ricotta Toast', 'Mushroom Toast': 'Whipped Ricotta Toast',
  'Beet Salad': 'Farro & Arugula Salad', 'Beet Confit': 'Farro & Arugula Salad', 'Second Ave. Salad': 'Farro & Arugula Salad',
  'Roasted Cauliflower': 'Farro & Arugula Salad', Cauliflower: 'Farro & Arugula Salad',
  Romaine: 'Little Gem Caesar',
  'Cali Margherita': 'Margherita', 'Cali Margherita Pizza': 'Margherita', 'Seasonal Veggie Pie': 'Margherita',
  'Mike’s Vegas Winner': 'Margherita', "Mike's Vegas Winner": 'Margherita', 'Mike’s Vegas Pie': 'Margherita',
  'Double Pepperoni': 'Hot Honey Soppressata', 'Double Pepperoni Pizza': 'Hot Honey Soppressata', '2 A.M. Pie': 'Hot Honey Soppressata',
  'Spicy Bar Nutz': null, 'Hot Honey Eggplant': null, 'Harissa Carrots': null, 'Mushroom Brie Soup': null, 'Smash Burger': null,
  'Baldwin Burger': null, 'Tot Oscar': null, 'Ham & Cheese': null, 'Marinated Olives & Nuts': null, 'Cacio e Pepe Fries': null,
};
const squash = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]/g, '');
const BY_KEY = new Map(Object.entries(BALDWIN_TO_DEMO).map(([k, v]) => [squash(k), v]));

/** One pairing name on a demo's menu: the dish itself, its demo stand-in, or null (not a dish the demo has).
 *  Occasions ("A toast", "A celebration") aren't dishes and stay. */
export function demoDish(name, menu) {
  const onMenu = menu.find((n) => squash(n) === squash(name));
  if (onMenu) return onMenu;
  if (/^an?\s/i.test(name)) return name;
  const to = BY_KEY.get(squash(name));
  return to && menu.find((n) => squash(n) === squash(to)) ? to : null;
}

/** A "Pairs with" list ("A, B · C") rewritten for a demo's menu: mapped, de-duplicated, empty ones dropped. */
export function demoPairs(pairs, menu) {
  const out = [];
  for (const p of String(pairs || '').split(/,| · /).map((s) => s.trim()).filter(Boolean)) {
    const d = demoDish(p, menu);
    if (d && !out.includes(d)) out.push(d);
  }
  return out.join(', ');
}

/** A sentence that names Baldwin dishes ("a great match for the walleye"): each mention becomes its demo stand-in (same
 *  case as written). Returns null when a mentioned dish has no stand-in, so the caller can leave the line out. */
export function demoMentions(text, menu) {
  if (!text) return text;
  let out = String(text), lost = false;
  const names = Object.keys(BALDWIN_TO_DEMO).sort((a, b) => b.length - a.length);
  for (const n of names) {
    const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, (m) => {
      const to = demoDish(n, menu);
      if (!to) { lost = true; return m; }
      return m === m.toLowerCase() ? to.toLowerCase() : to;
    });
  }
  return lost ? null : out;
}
