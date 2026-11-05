// The CMS: collections of pages built from a designed template. Content lives here; Figma holds the templates.
// Each collection has a field list (the admin form is built from it), a template page, and the lists it feeds.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { now } from './db.mjs';
import { slugify } from './templates.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const GLASSES = ['Rocks', 'Double rocks', 'Coupe', 'Nick & Nora', 'Martini', 'Highball', 'Collins', 'Copper mug', 'Wine glass', 'Flute', 'Julep cup'];
// Nov 5: the Drink Book's sections (Quiz Updates folder). The older names stay valid for the demo restaurant.
const MENU_SECTIONS = ['Specialty Cocktails', 'Classics', 'Barra Cart', 'BRG Staples', 'House Cocktails', 'Mules', 'Dessert Cocktails', 'Spiritless Cocktails', 'Martinis', 'Spiritless & Bubbles'];
/** Where a bottle shows: its spirit page (and that page's style pages). */
export const SHELF = [
  { key: 'Vodka', page: 'spirit/vodka' }, { key: 'Gin', page: 'spirit/gin' }, { key: 'Tequila', page: 'spirit/tequila' },
  { key: 'Mezcal', page: 'spirit/mezcal' }, { key: 'Rum', page: 'spirit/rum' },
  { key: 'Bourbon', page: 'spirit/bourbon', whiskey: true }, { key: 'Rye', page: 'spirit/rye', whiskey: true },
  { key: 'Scotch', page: 'spirit/scotch', whiskey: true }, { key: 'Irish whiskey', page: 'spirit/irish-whiskey', sub: 'spirit/irish/', whiskey: true },
  { key: 'Japanese whisky', page: 'spirit/japanese-whisky', sub: 'spirit/japanese/', whiskey: true }, { key: 'Canadian whisky', page: null, whiskey: true },
  { key: 'Cognac', page: 'spirit/cognac' }, { key: 'Pisco', page: 'spirit/pisco' }, { key: 'Amaro', page: 'spirit/amaro' },
  { key: 'Liqueur', page: 'spirit/liqueurs' },
];
export const BEER_STYLES = ['Light Lager', 'Pilsner', 'Amber and Red Ale', 'Pale Ale', 'IPA', 'Session IPA', 'Hazy IPA', 'Wheat Beer', 'Belgian Ale', 'Sour', 'Stout', 'Porter', 'Non-alcoholic', 'Rotating'];
export const ALLERGENS = ['Dairy', 'Egg', 'Finfish', 'Shellfish', 'Tree Nut', 'Peanut', 'Gluten', 'Soy', 'Sesame', 'Allium', 'Nightshade', 'Pork'];
/** Courses, in menu order (the Food Book, Oct 28). */
/** A wine's description as one sentence: structure (from the profile ratings unless written), mouthfeel, then fruit. */
export function wineStructure(d) {
  const n = (k) => Number(d[k]) || 0;
  const body = ['', 'Very light-bodied', 'Light-bodied', 'Medium-bodied', 'Full-bodied', 'Very full-bodied'][n('body')] || '';
  const sweet = ['', 'dry', 'off-dry', 'lightly sweet', 'sweet', 'sweet'][n('sweet')] || '';
  const acid = n('acid') >= 5 ? 'racy acidity' : n('acid') === 4 ? 'bright acidity' : n('acid') && n('acid') <= 2 ? 'soft acidity' : '';
  const tan = n('tannin') >= 5 ? 'big, grippy tannins' : n('tannin') === 4 ? 'firm tannins' : n('tannin') === 3 ? 'medium tannins' : n('tannin') ? 'soft tannins' : '';
  const head = [body, sweet].filter(Boolean).join(' and ');
  const tail = [acid, tan].filter(Boolean).join(' and ');
  return head ? head + (tail ? ' with ' + tail : '') : '';
}
export function wineDescription(d) {
  // The Wine Book's own wording comes first (Tommy, Oct 29: "do the book version"); the built sentence
  // is only for a wine with no tasting notes.
  if ((d.notes || '').trim()) return d.notes.trim();
  const s = (d.structure || wineStructure(d)).trim(), m = (d.mouthfeel || '').trim(), f = (d.fruit || '').trim();
  if (!m && !f) return '';
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  // "Light-bodied and dry with bright acidity; lively and light, with green apple, pear and white flowers."
  const feel = [m, f && `with ${f}`].filter(Boolean).join(', ');
  return cap([s, feel].filter(Boolean).join('; ')) + '.';
}
// Nov 5: the Food Book's sections (Quiz Updates folder). The older names stay valid for the demo restaurant.
export const COURSES = ['For the Table', 'From the Oven', 'Soups & Salads', 'Pasta', 'Entrees', 'Social Hour', 'Snacks & Small Plates', 'Salads', 'Pizza', 'Mains', 'Dessert'];
const PROFILE = ['—', '1', '2', '3', '4', '5'];

/* Field types: text · textarea · photo · video · select · toggle · tags · chips · lines · list · link · color */
const build = { key: 'build', label: 'Ingredients', type: 'list', max: 8, hint: 'Tick the main spirit so it’s highlighted.', fields: [
  { key: 'amount', label: 'Amount', type: 'text', max: 30, placeholder: '2 oz' },
  { key: 'ingredient', label: 'Ingredient', type: 'text', max: 80 },
  { key: 'link', label: 'Links to (optional)', type: 'link' },
  { key: 'spirit', label: 'Main spirit', type: 'toggle' },
] };
const spirit = [
  { key: 'spiritName', label: 'Spirit name', type: 'text', max: 80, section: 'The spirit' },
  { key: 'spiritLine', label: 'Why this spirit', type: 'textarea', max: 300, section: 'The spirit' },
  { key: 'spiritLink', label: 'Links to', type: 'link', section: 'The spirit' },
  { key: 'spiritLinkLabel', label: 'Button label', type: 'text', max: 60, placeholder: 'Learn about gin', section: 'The spirit' },
];

export const COLLECTIONS = {
  classic: {
    label: 'Classic Cocktails', singular: 'classic cocktail', prefix: 'classic/', template: '76-3930', section: 'Classic', nav: 'The Bar',
    group: { key: 'family', values: ['Stirred', 'Shaken', 'Tall', 'Tropical', 'Brunch', 'Hot'] },
    lists: 'Shows in every classic page’s cocktail strip and the Classic cocktails table on the Cocktails page.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', max: 80, required: true, section: 'The basics' },
      { key: 'family', label: 'Family', type: 'select', options: ['Stirred', 'Shaken', 'Tall', 'Tropical', 'Brunch', 'Hot'], section: 'The basics', hint: 'Which group it sits in on the Cocktails page.' },
      { key: 'tagline', label: 'One line under the name', type: 'text', max: 80, section: 'The basics' },
      { key: 'description', label: 'Description', type: 'textarea', max: 400, section: 'The basics' },
      { key: 'photo', label: 'Main photo', type: 'photo', section: 'The basics', hint: 'The first thing people see. Landscape works best.' },
      { key: 'photoCredit', label: 'Photo credit', type: 'text', max: 80, section: 'The basics' },
      { key: 'color', label: 'Dot colour', type: 'color', section: 'The basics', hint: 'The little dot next to its name in the cocktail strip.' },
      { key: 'glass', label: 'Glass', type: 'text', max: 60, options: GLASSES, section: 'Glass, method, ice', hint: 'Picks the matching glass drawing.' },
      { key: 'method', label: 'Method', type: 'text', max: 60, section: 'Glass, method, ice' },
      { key: 'ice', label: 'Ice', type: 'text', max: 60, section: 'Glass, method, ice' },
      { key: 'garnish', label: 'Garnish', type: 'text', max: 80, section: 'Glass, method, ice' },
      { key: 'glassCard', label: 'Glass card', type: 'text', max: 60, options: [], section: 'Glass, method, ice', hint: 'Which glass drawing shows on the page. Leave empty to match the glass.' },
      { key: 'tableBase', label: 'Base, for the Cocktails table', type: 'text', max: 60, section: 'Glass, method, ice', placeholder: 'Bourbon or rye' },
      { key: 'menuPrice', label: 'On our menu: price', type: 'text', max: 10, section: 'The basics', placeholder: '15', hint: 'Leave empty if it’s not on our menu. Shows as an “On our menu” tag.' },
      { key: 'allergyTag', label: 'Allergy tag', type: 'text', max: 40, section: 'Glass, method, ice', placeholder: 'Contains egg white', hint: 'Shows as a tag at the top and a note under the build.' },
      { key: 'allergyNote', label: 'Allergy note', type: 'textarea', max: 200, section: 'Glass, method, ice' },
      { ...build, section: 'The build' },
      { key: 'steps', label: 'Steps', type: 'lines', max: 8, section: 'The build' },
      { key: 'flavors', label: 'Taste words', type: 'tags', section: 'Taste', placeholder: 'Whiskey, Orange, Spice' },
      { key: 'tasteLine', label: 'How it tastes', type: 'textarea', max: 300, section: 'Taste' },
      { key: 'riffs', label: 'Riffs to know', type: 'list', max: 4, section: 'Riffs', fields: [
        { key: 'name', label: 'Riff', type: 'text', max: 60 }, { key: 'note', label: 'Note', type: 'text', max: 120 }, { key: 'link', label: 'Links to', type: 'link' }] },
      ...spirit,
      { key: 'pour', label: 'Our pour', type: 'text', max: 120, section: 'The spirit', placeholder: 'Bar lead to add our bottle' },
      { key: 'links', label: 'What’s in it (links)', type: 'list', max: 6, section: 'The spirit', fields: [
        { key: 'label', label: 'Label', type: 'text', max: 40 }, { key: 'link', label: 'Links to', type: 'link' }] },
      { key: 'say', label: 'Say it at the table', type: 'textarea', max: 400, section: 'At the table' },
      { key: 'story', label: 'Where it came from', type: 'textarea', max: 800, section: 'The story' },
      { key: 'video', label: 'Video', type: 'video', section: 'The story', hint: 'Upload a file or paste a YouTube link. Shows under the story, never first.' },
    ],
  },
  house: {
    label: 'House Cocktails', singular: 'house cocktail', prefix: 'signature/', template: '87-12', section: 'Signature', nav: 'The Bar',
    lists: 'Shows in the Our cocktails strip and the house table on the Cocktails page.',
    group: { key: 'menuSection', values: MENU_SECTIONS },
    fields: [
      { key: 'name', label: 'Name', type: 'text', max: 80, required: true, section: 'The basics' },
      { key: 'menuSection', label: 'Menu section', type: 'select', options: MENU_SECTIONS, section: 'The basics' },
      { key: 'price', label: 'Price', type: 'text', max: 10, section: 'The basics', placeholder: '17' },
      { key: 'onMenu', label: 'On the menu', type: 'toggle', section: 'The basics', hint: 'Off-menu drinks stay in the book and the quizzes, but not in the Our signatures carousel.' },
      { key: 'tagline', label: 'One line under the name', type: 'text', max: 80, section: 'The basics' },
      { key: 'description', label: 'Description', type: 'textarea', max: 400, section: 'The basics' },
      { key: 'photo', label: 'Main photo', type: 'photo', section: 'The basics' },
      { key: 'base', label: 'Base spirit (the Drink Book profile)', type: 'text', max: 40, section: 'Glass, method, ice', placeholder: 'Gin', hint: 'The quizzes ask for this. Leave empty for spiritless drinks.' },
      { key: 'glass', label: 'Glass', type: 'text', max: 60, options: GLASSES, section: 'Glass, method, ice' },
      { key: 'method', label: 'Method', type: 'text', max: 60, section: 'Glass, method, ice' },
      { key: 'ice', label: 'Ice', type: 'text', max: 60, section: 'Glass, method, ice' },
      { key: 'garnish', label: 'Garnish', type: 'text', max: 80, section: 'Glass, method, ice' },
      { key: 'tableLine', label: 'What’s in it, for the Cocktails table', type: 'text', max: 80, section: 'Glass, method, ice', placeholder: 'Hibiscus, pineapple, lime' },
      { key: 'tableIce', label: 'Ice, for the Cocktails table', type: 'text', max: 30, section: 'Glass, method, ice', placeholder: 'None, up' },
      { ...build, section: 'Our build' },
      { key: 'steps', label: 'Steps', type: 'lines', max: 8, section: 'Our build' },
      { key: 'specNote', label: 'Spec status (managers only)', type: 'text', max: 160, section: 'Our build', hint: 'What the bar lead still needs to confirm.' },
      { key: 'tags', label: 'Taste words', type: 'tags', section: 'Taste' },
      { key: 'tasteLine', label: 'How it tastes', type: 'textarea', max: 300, section: 'Taste' },
      { key: 'pairs', label: 'Pairs with', type: 'text', max: 80, section: 'At the table' },
      ...spirit,
      { key: 'say', label: 'Say it at the table', type: 'textarea', max: 400, section: 'At the table' },
      { key: 'story', label: 'How we made it', type: 'textarea', max: 800, section: 'The story' },
      { key: 'video', label: 'Video', type: 'video', section: 'The story' },
    ],
  },
  shelf: {
    label: 'Back Bar', singular: 'bottle', prefix: 'shelf/', template: '295-2', section: 'Back bar', nav: 'The Bar',
    group: { key: 'spirit', values: SHELF.map((x) => x.key) },
    lists: 'Every bottle has its own page and a row on the Back Bar page. It also shows in “On our shelf” on its spirit page, under its style, and on that style’s page. Whiskeys also show on the Whiskey page.',
    fields: [
      { key: 'name', label: 'Bottle', type: 'text', max: 80, required: true, section: 'The bottle' },
      { key: 'spirit', label: 'Spirit', type: 'select', options: SHELF.map((x) => x.key), section: 'The bottle' },
      { key: 'styles', label: 'Style', type: 'tags', section: 'The bottle', placeholder: 'Wheated', hint: 'Match a style page under the spirit (e.g. Wheated, Small Batch, Reposado, Speyside). Leave empty if none fits.' },
      { key: 'limited', label: 'Limited quantities', type: 'toggle', section: 'The bottle', hint: 'Shows a * next to it, like the menu.' },
      { key: 'spin', label: 'Spin (360°)', type: 'spin', section: 'The bottle', hint: 'Record our own bottle turning on a lazy Susan. It replaces the drawn bottle, and staff drag it to spin it.' },
      { key: 'price', label: 'Pour price', type: 'text', max: 10, section: 'Behind the bar', placeholder: '14' },
      { key: 'tier', label: 'Tier', type: 'select', options: ['', 'Well', 'Call', 'Premium', 'Top shelf'], section: 'Behind the bar' },
      { key: 'notes', label: 'About this bottle', type: 'textarea', max: 300, section: 'Behind the bar', hint: 'Shown under the name. Leave empty and the page writes one line from the spirit, style and drinks.' },
      { key: 'say', label: 'Say it at the table', type: 'text', max: 160, section: 'Behind the bar', hint: 'Only shows once it’s filled in.' },
    ],
  },
  wine: {
    label: 'Wine List', singular: 'wine', prefix: 'wine-list/', template: '176-50', section: 'Wine list', nav: 'The Bar',
    group: { key: 'list', values: ['By the glass', 'Sommelier selection', 'By the bottle', 'Bubbles'] },
    lists: 'Every wine has its own page (bottle, tasting notes, profile, pairings). It also fills By the glass and By the bottle on the Wine page, and On our list on every wine style, country, grape and region page.',
    fields: [
      { key: 'name', label: 'Producer and label', type: 'text', max: 80, required: true, section: 'The wine', placeholder: "Orin Swift 'Mercury Head'" },
      { key: 'grape', label: 'Grape or style (as on the menu)', type: 'text', max: 60, section: 'The wine', placeholder: 'Cabernet Sauvignon' },
      { key: 'region', label: 'Region', type: 'text', max: 60, section: 'The wine', placeholder: 'Napa' },
      { key: 'list', label: 'Where it sits on the menu', type: 'select', options: ['By the glass', 'Sommelier selection', 'By the bottle', 'Bubbles'], section: 'The wine' },
      { key: 'country', label: 'Country column', type: 'select', options: ['USA', 'Italy', 'France', 'Around the world'], section: 'The wine' },
      { key: 'color', label: 'Colour', type: 'select', options: ['White', 'Red', 'Bubbles', 'Sake'], section: 'The wine' },
      { key: 'glass', label: 'Glass price', type: 'text', max: 10, section: 'Prices', hint: 'Only for wines by the glass.' },
      { key: 'half', label: '½ bottle price', type: 'text', max: 10, section: 'Prices' },
      { key: 'bottle', label: 'Bottle price', type: 'text', max: 10, section: 'Prices' },
      { key: 'size', label: 'Size note', type: 'text', max: 20, section: 'Prices', placeholder: 'Split, 375 ml, 1 liter' },
      { key: 'pages', label: 'Shows on these pages', type: 'tags', section: 'Where it shows', hint: 'Grape, style or region pages by name, e.g. Cabernet, Napa Valley, Prosecco. It also shows on its country and colour pages.' },
      { key: 'bottle_img', label: 'Bottle photo', type: 'photo', scan: true, section: 'Tasting', hint: 'Scan Bottle: take a photo of your own bottle and it cuts out just the bottle. Never use photos from a winery’s or shop’s website.' },
      { key: 'spin', label: 'Spin (360°)', type: 'spin', section: 'Tasting', hint: 'Record the bottle turning on a lazy Susan. On the wine’s page, staff drag it to spin it.' },
      { key: 'style', label: 'Style tag', type: 'text', max: 30, section: 'Tasting', placeholder: 'Crisp, Off-dry, Big and bold' },
      { key: 'notes', label: 'Tasting notes (from the Wine Book)', type: 'textarea', max: 300, section: 'Tasting', hint: 'Shown on the wine’s page as written.' },
      { key: 'structure', label: 'No notes? Structure', type: 'text', max: 120, section: 'Tasting', hint: 'Only used when Tasting notes is empty. Leave empty to build it from the ratings.' },
      { key: 'mouthfeel', label: 'No notes? Mouthfeel', type: 'text', max: 120, section: 'Tasting', placeholder: 'silky and round' },
      { key: 'fruit', label: 'No notes? Fruit', type: 'text', max: 160, section: 'Tasting', placeholder: 'black cherry, plum and vanilla' },
      { key: 'pairs', label: 'Pairs with', type: 'text', max: 160, section: 'Tasting', hint: 'Dishes from our menu, separated by commas.' },
      { key: 'say', label: 'Say it at the table', type: 'text', max: 160, section: 'Tasting' },
      ...[['body', 'Body'], ['sweet', 'Sweetness'], ['acid', 'Acidity'], ['tannin', 'Tannin']].map(([key, label]) => ({ key, label, type: 'select', options: PROFILE, section: 'Profile (1 to 5)', hint: key === 'tannin' ? '— for whites and sparkling.' : undefined })),
      { key: 'source', label: 'Source', type: 'text', max: 60, section: 'Profile (1 to 5)', hint: 'Where the notes came from.' },
      { key: 'producerUrl', label: 'Producer website (optional)', type: 'text', max: 200, section: 'Read more', placeholder: 'https://…', hint: 'Shows under Read more. Wine Folly and Vivino links are added for you.' },
      { key: 'producerLabel', label: 'Producer link label', type: 'text', max: 60, section: 'Read more', placeholder: 'Caymus Vineyards' },
    ],
  },
  beer: {
    label: 'Beer List', singular: 'beer', prefix: 'beer-list/', template: null, section: 'Beer list', nav: 'The Bar', noPages: true,
    group: { key: 'serve', values: ['Draft', 'Bottle'] },
    hasPage: () => false,
    lists: 'Draft beers fill the tap wall and tap table on Beer & Draft. Bottles show under “In bottles”. Each shows on its style page.',
    fields: [
      { key: 'name', label: 'Beer', type: 'text', max: 80, required: true, section: 'The beer' },
      { key: 'serve', label: 'How we serve it', type: 'select', options: ['Draft', 'Bottle'], section: 'The beer' },
      { key: 'style', label: 'Style', type: 'select', options: BEER_STYLES, section: 'The beer' },
      { key: 'tap', label: 'Tap number', type: 'text', max: 4, section: 'Draft only' },
      { key: 'abv', label: 'ABV', type: 'text', max: 10, section: 'Draft only', placeholder: '5.0%' },
      { key: 'glass', label: 'Glass', type: 'text', max: 40, section: 'Draft only' },
      { key: 'pour', label: 'Pour', type: 'text', max: 20, section: 'Draft only', placeholder: '16 oz' },
      { key: 'price', label: 'Price', type: 'text', max: 10, section: 'Draft only' },
      { key: 'michigan', label: 'Michigan beer', type: 'toggle', section: 'Draft only' },
    ],
  },
  recipe: {
    label: 'Recipes', singular: 'dish', prefix: 'recipe/', template: '9-2', section: 'Recipe', nav: 'Food Matrix',
    group: { key: 'course', values: COURSES },
    hasPage: () => true,
    lists: 'Every dish has its own page and a row in the Food Matrix. Sections with nothing in them stay off the page.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', max: 80, required: true, section: 'The basics' },
      { key: 'course', label: 'Course', type: 'select', options: COURSES, section: 'The basics' },
      { key: 'price', label: 'Price', type: 'text', max: 10, section: 'The basics', placeholder: '38' },
      { key: 'station', label: 'Station', type: 'text', max: 40, section: 'The basics', placeholder: 'Sauté' },
      { key: 'description', label: 'Short description', type: 'text', max: 200, section: 'The basics', hint: 'One or two lines (the Food Book’s run up to about 140 characters). Shows in the Food Matrix.' },
      { key: 'photo', label: 'Main photo', type: 'photo', section: 'The basics' },
      { key: 'ingredients', label: 'Ingredients', type: 'tags', max: 20, section: 'The basics', hint: 'One per line.' },
      { key: 'allergens', label: 'Allergens', type: 'chips', options: ALLERGENS, section: 'The basics' },
      { key: 'confirm', label: 'Chef still to confirm', type: 'toggle', section: 'The basics', hint: 'Shows “chef to confirm” next to the ingredients and allergens.' },
      { key: 'signature', label: 'Signature dish', type: 'toggle', section: 'The basics' },
      { key: 'tagline', label: 'Line above the name', type: 'text', max: 80, section: 'Recipe page', placeholder: 'The signature dish' },
      { key: 'components', label: 'Components', type: 'list', max: 10, section: 'The build', fields: [
        { key: 'component', label: 'Component', type: 'text', max: 80 }, { key: 'portion', label: 'Portion', type: 'text', max: 80 }, { key: 'hold', label: 'Hold', type: 'text', max: 80 }] },
      { key: 'steps', label: 'Steps', type: 'list', max: 10, section: 'The build', fields: [
        { key: 'title', label: 'Step', type: 'text', max: 80 }, { key: 'detail', label: 'Detail', type: 'textarea', max: 400 }, { key: 'time', label: 'Time', type: 'text', max: 30 }] },
      { key: 'platePhoto', label: 'Plate photo', type: 'photo', section: 'Plating' },
      { key: 'plating', label: 'Where things go (up to 4)', type: 'list', max: 4, section: 'Plating', fields: [
        { key: 'name', label: 'Item', type: 'text', max: 60 }, { key: 'note', label: 'Note', type: 'text', max: 120 }] },
      { key: 'inspiration', label: 'Inspiration', type: 'textarea', max: 800, section: 'The story', hint: 'Where the dish comes from and why it’s on the menu.' },
      { key: 'sellingPoints', label: 'Selling points', type: 'lines', max: 5, section: 'The story', hint: 'One per line. What makes it worth ordering.' },
      { key: 'sellingLine', label: 'Selling line', type: 'textarea', max: 300, section: 'At the table', hint: 'What you say at the table to sell the dish, before it’s ordered.' },
      { key: 'dropMain', label: 'Three-line drop · main', type: 'text', max: 120, section: 'At the table', placeholder: 'Braised short rib' },
      { key: 'dropSide', label: 'Three-line drop · side', type: 'text', max: 120, section: 'At the table', placeholder: 'Spinach and a carrot ribbon' },
      { key: 'dropSauce', label: 'Three-line drop · sauce', type: 'text', max: 120, section: 'At the table', placeholder: 'Pan gravy' },
      { key: 'say', label: 'The drop as one sentence', type: 'textarea', max: 400, section: 'At the table', hint: 'What you say when you set the dish down.' },
      { key: 'talkingPoints', label: 'Talking points', type: 'lines', max: 3, section: 'At the table', hint: 'Up to 3 short lines a server can say. One per line.' },
      { key: 'pairing', label: 'Wine · similar', type: 'text', max: 80, section: 'At the table', hint: 'Also the pairing in the Food Matrix.' },
      { key: 'pairingRef', label: 'Wine · similar: where it’s from', type: 'text', max: 60, section: 'At the table', placeholder: 'Wine Book p. 26' },
      { key: 'pairingOpposite', label: 'Wine · opposite', type: 'text', max: 80, section: 'At the table' },
      { key: 'pairingOppositeRef', label: 'Wine · opposite: where it’s from', type: 'text', max: 60, section: 'At the table' },
      { key: 'cocktail', label: 'Cocktail', type: 'text', max: 80, section: 'At the table' },
      { key: 'cocktailRef', label: 'Cocktail: where it’s from', type: 'text', max: 60, section: 'At the table', placeholder: 'Drink Book p. 5' },
      { key: 'pairingNote', label: 'Why the wine works (optional)', type: 'text', max: 200, section: 'At the table' },
      { key: 'hasVideo', label: 'Add a video', type: 'toggle', section: 'Watch it made', hint: 'Off, or no video picked: the page leaves “Watch it made” out.' },
      { key: 'video', label: 'Video', type: 'video', section: 'Watch it made' },
      { key: 'videoStill', label: 'Still photo (before it plays)', type: 'photo', section: 'Watch it made' },
      { key: 'videoTitle', label: 'Video title', type: 'text', max: 120, section: 'Watch it made' },
      { key: 'videoDuration', label: 'Length', type: 'text', max: 10, section: 'Watch it made', placeholder: '2:40' },
      { key: 'videoHeading', label: 'Heading', type: 'text', max: 60, section: 'Watch it made', placeholder: 'FROM FIRE TO PASS' },
      { key: 'videoNote', label: 'Note', type: 'textarea', max: 400, section: 'Watch it made' },
      { key: 'chapters', label: 'Chapters', type: 'list', max: 6, section: 'Watch it made', fields: [
        { key: 'time', label: 'Time', type: 'text', max: 10, placeholder: '0:35' }, { key: 'label', label: 'Label', type: 'text', max: 40 }] },
      { key: 'photos', label: 'More photos', type: 'list', max: 8, section: 'Photos', fields: [
        { key: 'img', label: 'Photo', type: 'photo' }, { key: 'caption', label: 'Caption', type: 'text', max: 60 }] },
    ],
  },
};

/** Field lists for the admin form (no functions). */
export const publicSchemas = () => Object.fromEntries(Object.entries(COLLECTIONS).map(([id, c]) => [id, { id, label: c.label, singular: c.singular, prefix: c.prefix, group: c.group, lists: c.lists, fields: c.fields, noPages: !!c.noPages }]));

/* ------------------------------ validation ------------------------------ */
const str = (v, max = 600) => String(v ?? '').slice(0, max).trim();
const ytId = (s) => { const m = String(s || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || String(s || '').match(/^([A-Za-z0-9_-]{11})$/); return m ? m[1] : null; };
function cleanField(f, v) {
  switch (f.type) {
    case 'text': return str(v, f.max || 200);
    case 'textarea': return str(v, f.max || 2000);
    case 'link': { const s = str(v, 200); return s.startsWith('/') ? s : ''; }
    case 'photo': { const s = str(v, 300); return s.startsWith('/media/') || s.startsWith('/img/') ? s : ''; }
    case 'color': { const s = str(v, 7); return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : ''; }
    case 'toggle': return !!v;
    case 'select': return f.options.includes(v) ? v : f.options[0];
    case 'tags': case 'lines': return (Array.isArray(v) ? v : []).map((x) => str(x, 300)).filter(Boolean).slice(0, f.max || 12);
    case 'chips': return (Array.isArray(v) ? v : []).filter((x) => f.options.includes(x));
    case 'spin': return (Array.isArray(v) ? v : []).map((x) => str(x, 300)).filter((x) => x.startsWith('/media/')).slice(0, 48);
    case 'video': {
      if (!v || typeof v !== 'object') return null;
      if (v.kind === 'youtube' && ytId(v.youtubeId || v.url)) return { kind: 'youtube', youtubeId: ytId(v.youtubeId || v.url), title: str(v.title, 200) };
      if (v.kind === 'file' && String(v.url || '').startsWith('/media/')) return { kind: 'file', url: str(v.url, 300), mime: str(v.mime, 80), title: str(v.title, 200) };
      return null;
    }
    case 'list': return (Array.isArray(v) ? v : []).slice(0, f.max || 12).map((row) => cleanFields(f.fields, row || {}))
      .filter((row) => f.fields.some((sf) => sf.type !== 'toggle' && row[sf.key]));
    default: return null;
  }
}
const cleanFields = (fields, d) => Object.fromEntries(fields.map((f) => [f.key, cleanField(f, d[f.key])]));
export function cleanEntry(collection, d = {}) {
  const c = COLLECTIONS[collection];
  const out = cleanFields(c.fields, d);
  return out;
}

/* ------------------------------ storage ------------------------------ */
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);
const rowOut = (r) => r && { id: r.id, collection: r.collection, slug: r.slug, data: JSON.parse(r.data), sort: r.sort, seeded: !!r.seed_key, updated_at: r.updated_at, edited: r.updated_by != null, storeId: r.store_id, archivedAt: r.archived_at || null };

/**
 * Seeds each collection from content/cms/<id>.json. A seed entry is added once; later seed changes
 * update it only while nobody has edited it in the admin. Deleted seed entries stay deleted.
 */
export function seed(db) {
  moveDishesToLibrary(db);
  for (const id of Object.keys(COLLECTIONS)) {
    const file = path.join(ROOT, 'content/cms', id + '.json');
    if (!fs.existsSync(file)) continue;
    const seeds = JSON.parse(fs.readFileSync(file, 'utf8'));
    const keys = new Set(seeds.map((s) => id + ':' + s.key));
    // Gone from the seed file (e.g. dropped from the Food Book): archived, never deleted. Back in the file: back in the book,
    // unless a person archived it (archived_by is set).
    for (const row of db.prepare('SELECT id, seed_key, archived_at, archived_by FROM entries WHERE collection = ? AND seed_key IS NOT NULL AND updated_by IS NULL').all(id)) {
      if (!keys.has(row.seed_key) && !row.archived_at) db.prepare('UPDATE entries SET archived_at = ?, archived_by = NULL WHERE id = ?').run(now(), row.id);
      else if (keys.has(row.seed_key) && row.archived_at && row.archived_by == null) db.prepare('UPDATE entries SET archived_at = NULL WHERE id = ?').run(row.id);
    }
    for (const s of seeds) {
      const data = cleanEntry(id, s.data);
      const h = hash(data);
      const row = db.prepare('SELECT * FROM entries WHERE seed_key = ?').get(id + ':' + s.key);
      const lib = id === 'recipe'; // dishes: the seed is the group's dish; The Baldwin's menu entry holds its price, course, pairings
      const shared = lib ? pick(data, (k) => !isLocal(id, k)) : data;
      const own = lib ? pick(data, (k) => isLocal(id, k)) : null;
      if (!row) {
        if (db.prepare('SELECT 1 FROM seed_removed WHERE seed_key = ?').get(id + ':' + s.key)) continue;
        if (db.prepare('SELECT 1 FROM entries WHERE slug = ? AND store_id = ?').get(s.slug, lib ? 0 : 1)) continue;
        const r = db.prepare('INSERT INTO entries(collection,slug,data,sort,seed_key,seed_hash,created_at,updated_at,store_id) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, s.slug, JSON.stringify(shared), s.sort ?? 0, id + ':' + s.key, h, now(), now(), lib ? 0 : 1);
        if (lib && !db.prepare('SELECT 1 FROM entries WHERE slug = ? AND store_id = 1').get(s.slug)) {
          db.prepare('INSERT INTO entries(collection,slug,data,sort,created_at,updated_at,store_id) VALUES (?,?,?,?,?,?,1)')
            .run(id, s.slug, JSON.stringify({ libraryId: Number(r.lastInsertRowid), ...own }), s.sort ?? 0, now(), now());
        }
      } else if (row.updated_by == null && row.seed_hash !== h) {
        db.prepare('UPDATE entries SET data = ?, seed_hash = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(shared), h, now(), row.id);
        if (lib) {
          const mine = db.prepare("SELECT * FROM entries WHERE collection = ? AND store_id = 1 AND json_extract(data, '$.libraryId') = ?").get(id, row.id);
          if (mine && mine.updated_by == null) db.prepare('UPDATE entries SET data = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(mine.data), ...own }), mine.id);
        }
      }
    }
  }
  // Oct 28: the Wine Book's bottle photos came out (copyright: the photos are the wineries' and shops'). Scanned ones (/media/) stay.
  for (const r of db.prepare(`SELECT id, data FROM entries WHERE collection = 'wine' AND data LIKE '%"bottle_img":"/img/%'`).all()) {
    const d = JSON.parse(r.data);
    delete d.bottle_img;
    db.prepare('UPDATE entries SET data = ? WHERE id = ?').run(JSON.stringify(d), r.id);
  }
  // Oct 28: "Fish" became "Finfish" (Tommy: "Specify shellfish or finfish"). Edited recipes keep their tag.
  for (const r of db.prepare(`SELECT id, data FROM entries WHERE collection = 'recipe' AND data LIKE '%"Fish"%'`).all()) {
    const d = JSON.parse(r.data);
    if (Array.isArray(d.allergens)) d.allergens = d.allergens.map((a) => (a === 'Fish' ? 'Finfish' : a));
    db.prepare('UPDATE entries SET data = ? WHERE id = ?').run(JSON.stringify(d), r.id);
  }
  // Recipes and cocktails added before the CMS (items table) move over once.
  for (const it of db.prepare('SELECT * FROM items').all()) {
    const col = it.type === 'dish' ? 'recipe' : 'house';
    const d = JSON.parse(it.data);
    if (!db.prepare('SELECT 1 FROM entries WHERE slug = ?').get(it.slug)) {
      db.prepare('INSERT INTO entries(collection,slug,data,sort,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(col, it.slug, JSON.stringify(cleanEntry(col, d)), 1000 + it.id, it.created_by, it.created_at, it.updated_by, it.updated_at);
    }
    db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
  }
}

/** Collections every store shares (the library). Everything else belongs to one store. */
export const SHARED = new Set(['classic']);

/* ---- The group's kitchen (Oct 31, Tommy: "a database of dishes shared across the board at all the stores") ----
 * A dish lives once in the group library (store_id 0, the company's) and each store puts it on its menu with an entry that
 * holds only what's its own: course, price, station, signature, and pairings (they depend on that store's list).
 * Reading a store's dish merges the two; anything else a store changed "just for us" is kept as an override. */
export const LIBRARY_STORE = 0;
export const LOCAL_KEYS = { recipe: ['course', 'price', 'station', 'signature', 'pairing', 'pairingRef', 'pairingOpposite', 'pairingOppositeRef', 'cocktail', 'cocktailRef', 'pairingNote'] };
const isLocal = (col, k) => (LOCAL_KEYS[col] || []).includes(k);
const pick = (d, keys) => Object.fromEntries(Object.entries(d).filter(([k]) => keys(k)));
/** Cleans only the fields given (a store entry stores just its own fields). */
function cleanPartial(collection, d) {
  const out = {};
  for (const f of COLLECTIONS[collection].fields) if (f.key in d) out[f.key] = cleanField(f, d[f.key]);
  return out;
}
function withLibrary(db, e) {
  if (!e || !e.data.libraryId) return e;
  const lib = db.prepare('SELECT * FROM entries WHERE id = ?').get(e.data.libraryId);
  if (!lib) return e;
  const { libraryId, ...own } = e.data;
  e.data = { ...JSON.parse(lib.data), ...own };
  e.library = { id: lib.id, seeded: !!lib.seed_key, archived: !!lib.archived_at, overrides: Object.keys(own).filter((k) => !isLocal(e.collection, k)) };
  return e;
}
const readRow = (db, r) => withLibrary(db, rowOut(r));

/** A collection's entries: shared ones for everyone, the rest for one store (`store` null = all stores). */
export function listEntries(db, collection, store = null) {
  const own = store != null && !SHARED.has(collection);
  const rows = collection
    ? (own ? db.prepare('SELECT * FROM entries WHERE collection = ? AND store_id = ? AND archived_at IS NULL ORDER BY sort, id').all(collection, store)
      : db.prepare('SELECT * FROM entries WHERE collection = ? AND store_id != 0 AND archived_at IS NULL ORDER BY sort, id').all(collection))
    : db.prepare('SELECT * FROM entries WHERE store_id != 0 AND archived_at IS NULL ORDER BY collection, sort, id').all();
  return rows.map((r) => readRow(db, r)).filter((e) => !e.library?.archived);
}
/** The archive: entries taken out of the book, newest first, ready to restore. */
export function listArchived(db, collection, store = null) {
  const own = store != null && !SHARED.has(collection);
  return (own ? db.prepare('SELECT * FROM entries WHERE collection = ? AND store_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC').all(collection, store)
    : db.prepare('SELECT * FROM entries WHERE collection = ? AND store_id != 0 AND archived_at IS NOT NULL ORDER BY archived_at DESC').all(collection)).map((r) => readRow(db, r));
}
export const getEntry = (db, id) => readRow(db, db.prepare('SELECT * FROM entries WHERE id = ?').get(id));

/** The group's dishes, with the stores that have each on their menu. */
export function libraryList(db, collection, company, store) {
  const rows = db.prepare('SELECT * FROM entries WHERE collection = ? AND store_id = 0 AND company_id = ? AND archived_at IS NULL ORDER BY sort, id').all(collection, company);
  const uses = db.prepare(`SELECT e.store_id, s.name FROM entries e JOIN stores s ON s.id = e.store_id
    WHERE e.collection = ? AND e.archived_at IS NULL AND json_extract(e.data, '$.libraryId') = ? AND s.deleted_at IS NULL ORDER BY s.sort, s.id`);
  return rows.map((r) => { const e = rowOut(r); const st = uses.all(collection, e.id); return { id: e.id, data: e.data, stores: st.map((x) => x.name), onMine: st.some((x) => x.store_id === store) }; });
}
/** Names of the other stores that have this library dish on their menu. */
export function sharedWith(db, e) {
  if (!e?.library) return [];
  return db.prepare(`SELECT s.name FROM entries e JOIN stores s ON s.id = e.store_id WHERE e.collection = ? AND e.archived_at IS NULL
    AND json_extract(e.data, '$.libraryId') = ? AND e.store_id != ? AND s.deleted_at IS NULL ORDER BY s.sort, s.id`).all(e.collection, e.library.id, e.storeId).map((x) => x.name);
}

/** One-time move (Oct 31): every store's dishes become library dishes plus a menu entry. Seed keys move to the library. */
function moveDishesToLibrary(db) {
  if (db.prepare("SELECT 1 FROM entries WHERE collection = 'recipe' AND store_id = 0 LIMIT 1").get()) return;
  const rows = db.prepare("SELECT * FROM entries WHERE collection = 'recipe' AND store_id != 0 ORDER BY store_id, sort, id").all();
  for (const r of rows) {
    const d = JSON.parse(r.data);
    if (d.libraryId) continue;
    const shared = pick(d, (k) => !isLocal('recipe', k));
    const own = pick(d, (k) => isLocal('recipe', k));
    const lib = db.prepare(`INSERT INTO entries(collection,slug,data,sort,seed_key,seed_hash,created_by,created_at,updated_by,updated_at,company_id,store_id,archived_at,archived_by)
      VALUES ('recipe',?,?,?,NULL,NULL,?,?,?,?,?,0,?,?)`).run(r.slug, JSON.stringify(shared), r.sort, r.created_by, r.created_at, r.updated_by, r.updated_at, r.company_id, r.seed_key && r.archived_at && r.archived_by == null ? r.archived_at : null, null);
    const libId = Number(lib.lastInsertRowid);
    if (r.seed_key) {
      const key = r.seed_key, h = r.seed_hash;
      db.prepare('UPDATE entries SET seed_key = NULL, seed_hash = NULL WHERE id = ?').run(r.id);
      db.prepare('UPDATE entries SET seed_key = ?, seed_hash = ? WHERE id = ?').run(key, h, libId);
    }
    db.prepare('UPDATE entries SET data = ? WHERE id = ?').run(JSON.stringify({ libraryId: libId, ...own }), r.id);
  }
}

/** Addresses are unique within a store (shared collections live on store 1). */
export function uniqueSlug(db, collection, name, exceptId, store = 1) {
  const base = COLLECTIONS[collection].prefix + slugify(name);
  const st = SHARED.has(collection) ? 1 : store;
  let slug = base, n = 2;
  while (db.prepare('SELECT 1 FROM entries WHERE slug = ? AND store_id = ? AND id != ?').get(slug, st, exceptId ?? -1)) slug = `${base}-${n++}`;
  return slug;
}

export function createEntry(db, collection, data, userId, store = 1, company = 1, opts = {}) {
  const st = SHARED.has(collection) ? 1 : store;
  const insert = (slugName, d, at = st, co = SHARED.has(collection) ? 1 : company) => {
    const slug = uniqueSlug(db, collection, slugName, null, at);
    const max = db.prepare('SELECT MAX(sort) m FROM entries WHERE collection = ? AND store_id = ?').get(collection, at).m ?? 0;
    const r = db.prepare('INSERT INTO entries(collection,slug,data,sort,created_by,created_at,updated_by,updated_at,store_id,company_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(collection, slug, JSON.stringify(d), max + 1, userId, now(), userId, now(), at, co);
    return Number(r.lastInsertRowid);
  };
  if (LOCAL_KEYS[collection] && opts.libraryId) {
    // From the group's kitchen: this store's menu entry points at the group's dish.
    const lib = db.prepare('SELECT * FROM entries WHERE id = ? AND collection = ? AND store_id = 0 AND company_id = ?').get(opts.libraryId, collection, company);
    if (!lib) throw Object.assign(new Error('That dish isn’t in your group’s kitchen.'), { status: 404 });
    const ld = JSON.parse(lib.data);
    // Taken off this menu before? Bring that entry back (same address, its price and station kept).
    const was = db.prepare("SELECT id FROM entries WHERE collection = ? AND store_id = ? AND archived_at IS NOT NULL AND json_extract(data, '$.libraryId') = ? ORDER BY archived_at DESC").get(collection, st, lib.id);
    if (was) { db.prepare('UPDATE entries SET archived_at = NULL, archived_by = NULL, updated_by = ?, updated_at = ? WHERE id = ?').run(userId, now(), was.id); return getEntry(db, was.id); }
    const own = cleanPartial(collection, { course: data.course || ld.course, ...pick(data || {}, (k) => isLocal(collection, k)) });
    return getEntry(db, insert(ld.name, { libraryId: lib.id, ...own }));
  }
  const d = cleanEntry(collection, data);
  if (LOCAL_KEYS[collection] && opts.share) {
    // A new dish for the whole group: the dish goes in the library, this store gets it on its menu.
    const libId = insert(d.name, pick(d, (k) => !isLocal(collection, k)), 0, company);
    return getEntry(db, insert(d.name, { libraryId: libId, ...pick(d, (k) => isLocal(collection, k)) }));
  }
  return getEntry(db, insert(d.name, d));
}

/** Saving keeps the address (slug) the same, so links to the page never break.
 *  A group dish: scope "group" changes it for every store; scope "store" keeps the change as this store's own. */
export function updateEntry(db, id, data, userId, scope = 'group') {
  const raw = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  const e = getEntry(db, id);
  const d = cleanEntry(e.collection, data);
  if (e.library) {
    const own = pick(d, (k) => isLocal(e.collection, k));
    const shared = pick(d, (k) => !isLocal(e.collection, k));
    if (scope === 'store') {
      const lib = JSON.parse(db.prepare('SELECT data FROM entries WHERE id = ?').get(e.library.id).data);
      const diff = pick(shared, (k) => JSON.stringify(shared[k]) !== JSON.stringify(lib[k] ?? cleanEntry(e.collection, {})[k]));
      db.prepare('UPDATE entries SET data = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ libraryId: e.library.id, ...own, ...diff }), userId, now(), id);
    } else {
      // For every store. A field this store had changed just for itself stays its own unless it was edited now.
      const mine = JSON.parse(raw.data);
      const lib = JSON.parse(db.prepare('SELECT data FROM entries WHERE id = ?').get(e.library.id).data);
      const keep = {};
      for (const k of e.library.overrides) if (JSON.stringify(shared[k]) === JSON.stringify(mine[k])) { keep[k] = mine[k]; shared[k] = lib[k]; }
      db.prepare('UPDATE entries SET data = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...lib, ...shared }), userId, now(), e.library.id);
      db.prepare('UPDATE entries SET data = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ libraryId: e.library.id, ...own, ...keep }), userId, now(), id);
    }
    return getEntry(db, id);
  }
  db.prepare('UPDATE entries SET data = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(d), userId, now(), id);
  return getEntry(db, id);
}

/** Takes an entry out of the book without losing it (Tommy, Oct 28: archive, don't delete). */
export function archiveEntry(db, id, userId) {
  const r = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!r) return false;
  db.prepare('UPDATE entries SET archived_at = ?, archived_by = ? WHERE id = ?').run(now(), userId ?? 0, id);
  return true;
}
export function restoreEntry(db, id) {
  db.prepare('UPDATE entries SET archived_at = NULL, archived_by = NULL WHERE id = ?').run(id);
  return getEntry(db, id);
}

/** Moves an entry up or down within its group (family / course). */
export function moveEntry(db, id, dir) {
  const e = getEntry(db, id);
  const g = COLLECTIONS[e.collection].group;
  const peers = listEntries(db, e.collection, e.storeId).filter((x) => !g || x.data[g.key] === e.data[g.key]);
  const i = peers.findIndex((x) => x.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= peers.length) return e;
  const order = [...peers];
  [order[i], order[j]] = [order[j], order[i]];
  const sorts = peers.map((p) => p.sort).sort((a, b) => a - b);
  // keep each group's sort values, reassign in the new order (distinct values)
  order.forEach((p, k) => db.prepare('UPDATE entries SET sort = ? WHERE id = ?').run(sorts[k] + k * 1e-6, p.id));
  return getEntry(db, id);
}
