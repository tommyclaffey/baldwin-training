// The CMS: collections of pages built from a designed template. Content lives here; Figma holds the templates.
// Each collection has a field list (the admin form is built from it), a template page, and the lists it feeds.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { now } from './db.mjs';
import { slugify } from './templates.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const GLASSES = ['Rocks', 'Double rocks', 'Coupe', 'Nick & Nora', 'Martini', 'Highball', 'Collins', 'Copper mug', 'Wine glass', 'Flute', 'Julep cup'];
const MENU_SECTIONS = ['Specialty Cocktails', 'BRG Staples', 'Martinis', 'Spiritless & Bubbles'];
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
export const ALLERGENS = ['Dairy', 'Egg', 'Finfish', 'Shellfish', 'Tree Nut', 'Peanut', 'Gluten', 'Soy', 'Sesame', 'Allium', 'Nightshade'];
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
    group: { key: 'family', values: ['Stirred', 'Shaken', 'Tall'] },
    lists: 'Shows in every classic page’s cocktail strip and the Classic cocktails table on the Cocktails page.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', max: 80, required: true, section: 'The basics' },
      { key: 'family', label: 'Family', type: 'select', options: ['Stirred', 'Shaken', 'Tall'], section: 'The basics', hint: 'Which group it sits in on the Cocktails page.' },
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
      { key: 'tagline', label: 'One line under the name', type: 'text', max: 80, section: 'The basics' },
      { key: 'description', label: 'Description', type: 'textarea', max: 400, section: 'The basics' },
      { key: 'photo', label: 'Main photo', type: 'photo', section: 'The basics' },
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
      { key: 'score', label: 'Tasting score', type: 'text', max: 10, section: 'From the tasting', hint: 'Out of 5.' },
      { key: 'status', label: 'Status', type: 'text', max: 30, section: 'From the tasting', placeholder: 'Keep, Adjusting, New' },
      { key: 'pairs', label: 'Pairs with', type: 'text', max: 80, section: 'From the tasting' },
      { key: 'note', label: 'What guests said', type: 'textarea', max: 600, section: 'From the tasting' },
      ...spirit,
      { key: 'say', label: 'Say it at the table', type: 'textarea', max: 400, section: 'At the table' },
      { key: 'story', label: 'How we made it', type: 'textarea', max: 800, section: 'The story' },
      { key: 'video', label: 'Video', type: 'video', section: 'The story' },
    ],
  },
  shelf: {
    label: 'Back Bar', singular: 'bottle', prefix: 'shelf/', template: null, section: 'Back bar', nav: 'The Bar', noPages: true,
    group: { key: 'spirit', values: SHELF.map((x) => x.key) },
    hasPage: () => false,
    lists: 'Every bottle shows in “On our shelf” on its spirit page, under its style, and on that style’s page. Whiskeys also show on the Whiskey page.',
    fields: [
      { key: 'name', label: 'Bottle', type: 'text', max: 80, required: true, section: 'The bottle' },
      { key: 'spirit', label: 'Spirit', type: 'select', options: SHELF.map((x) => x.key), section: 'The bottle' },
      { key: 'styles', label: 'Style', type: 'tags', section: 'The bottle', placeholder: 'Wheated', hint: 'Match a style page under the spirit (e.g. Wheated, Small Batch, Reposado, Speyside). Leave empty if none fits.' },
      { key: 'limited', label: 'Limited quantities', type: 'toggle', section: 'The bottle', hint: 'Shows a * next to it, like the menu.' },
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
      { key: 'bottle_img', label: 'Bottle photo', type: 'photo', section: 'Tasting', hint: 'From the Wine Book unless replaced.' },
      { key: 'style', label: 'Style tag', type: 'text', max: 30, section: 'Tasting', placeholder: 'Crisp, Off-dry, Big and bold' },
      { key: 'notes', label: 'Tasting notes', type: 'textarea', max: 300, section: 'Tasting' },
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
    group: { key: 'course', values: ['Passed Bites', 'Plates', 'Dessert'] },
    hasPage: (d) => !!d.fullPage,
    lists: 'Every dish shows in the Food Matrix. Turn on “Full recipe page” to give it its own page.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', max: 80, required: true, section: 'The basics' },
      { key: 'course', label: 'Course', type: 'select', options: ['Passed Bites', 'Plates', 'Dessert'], section: 'The basics' },
      { key: 'station', label: 'Station', type: 'text', max: 40, section: 'The basics', placeholder: 'Sauté' },
      { key: 'description', label: 'Short description', type: 'text', max: 120, section: 'The basics', hint: 'One line. Shows in the Food Matrix.' },
      { key: 'photo', label: 'Main photo', type: 'photo', section: 'The basics' },
      { key: 'allergens', label: 'Allergens', type: 'chips', options: ALLERGENS, section: 'The basics' },
      { key: 'pairing', label: 'Pairs with', type: 'text', max: 80, section: 'The basics' },
      { key: 'score', label: 'Tasting score', type: 'text', max: 10, section: 'The basics', hint: 'Out of 5.' },
      { key: 'signature', label: 'Signature dish', type: 'toggle', section: 'The basics' },
      { key: 'refining', label: 'Being refined (shows a tag in the matrix)', type: 'toggle', section: 'The basics' },
      { key: 'fullPage', label: 'Full recipe page', type: 'toggle', section: 'Recipe page', hint: 'Turn on once the chef has the build, steps and plating.' },
      { key: 'tagline', label: 'Line above the name', type: 'text', max: 80, section: 'Recipe page', placeholder: 'The signature dish' },
      { key: 'stats', label: 'Stats', type: 'list', max: 3, section: 'Recipe page', fields: [
        { key: 'value', label: 'Number', type: 'text', max: 20 }, { key: 'label', label: 'Label', type: 'text', max: 60 }] },
      { key: 'components', label: 'Components', type: 'list', max: 10, section: 'The build', fields: [
        { key: 'component', label: 'Component', type: 'text', max: 80 }, { key: 'portion', label: 'Portion', type: 'text', max: 80 }, { key: 'hold', label: 'Hold', type: 'text', max: 80 }] },
      { key: 'steps', label: 'Steps', type: 'list', max: 10, section: 'The build', fields: [
        { key: 'title', label: 'Step', type: 'text', max: 80 }, { key: 'detail', label: 'Detail', type: 'textarea', max: 400 }, { key: 'time', label: 'Time', type: 'text', max: 30 }] },
      { key: 'platePhoto', label: 'Plate photo', type: 'photo', section: 'Plating' },
      { key: 'plating', label: 'Where things go (up to 4)', type: 'list', max: 4, section: 'Plating', fields: [
        { key: 'name', label: 'Item', type: 'text', max: 60 }, { key: 'note', label: 'Note', type: 'text', max: 120 }] },
      { key: 'say', label: 'Say it at the table', type: 'textarea', max: 400, section: 'At the table' },
      { key: 'pairingNote', label: 'Why the pairing works', type: 'text', max: 200, section: 'At the table' },
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
const rowOut = (r) => r && { id: r.id, collection: r.collection, slug: r.slug, data: JSON.parse(r.data), sort: r.sort, seeded: !!r.seed_key, updated_at: r.updated_at, edited: r.updated_by != null };

/**
 * Seeds each collection from content/cms/<id>.json. A seed entry is added once; later seed changes
 * update it only while nobody has edited it in the admin. Deleted seed entries stay deleted.
 */
export function seed(db) {
  for (const id of Object.keys(COLLECTIONS)) {
    const file = path.join(ROOT, 'content/cms', id + '.json');
    if (!fs.existsSync(file)) continue;
    const seeds = JSON.parse(fs.readFileSync(file, 'utf8'));
    const keys = new Set(seeds.map((s) => id + ':' + s.key));
    for (const row of db.prepare('SELECT id, seed_key FROM entries WHERE collection = ? AND seed_key IS NOT NULL AND updated_by IS NULL').all(id)) {
      if (!keys.has(row.seed_key)) db.prepare('DELETE FROM entries WHERE id = ?').run(row.id);
    }
    for (const s of seeds) {
      const data = cleanEntry(id, s.data);
      const h = hash(data);
      const row = db.prepare('SELECT * FROM entries WHERE seed_key = ?').get(id + ':' + s.key);
      if (!row) {
        if (db.prepare('SELECT 1 FROM seed_removed WHERE seed_key = ?').get(id + ':' + s.key)) continue;
        if (db.prepare('SELECT 1 FROM entries WHERE slug = ?').get(s.slug)) continue;
        db.prepare('INSERT INTO entries(collection,slug,data,sort,seed_key,seed_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, s.slug, JSON.stringify(data), s.sort ?? 0, id + ':' + s.key, h, now(), now());
      } else if (row.updated_by == null && row.seed_hash !== h) {
        db.prepare('UPDATE entries SET data = ?, seed_hash = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), h, now(), row.id);
      }
    }
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
    if (col === 'recipe') d.fullPage = true;
    if (!db.prepare('SELECT 1 FROM entries WHERE slug = ?').get(it.slug)) {
      db.prepare('INSERT INTO entries(collection,slug,data,sort,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(col, it.slug, JSON.stringify(cleanEntry(col, d)), 1000 + it.id, it.created_by, it.created_at, it.updated_by, it.updated_at);
    }
    db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
  }
}

export function listEntries(db, collection) {
  const rows = collection
    ? db.prepare('SELECT * FROM entries WHERE collection = ? ORDER BY sort, id').all(collection)
    : db.prepare('SELECT * FROM entries ORDER BY collection, sort, id').all();
  return rows.map(rowOut);
}
export const getEntry = (db, id) => rowOut(db.prepare('SELECT * FROM entries WHERE id = ?').get(id));

export function uniqueSlug(db, collection, name, exceptId) {
  const base = COLLECTIONS[collection].prefix + slugify(name);
  let slug = base, n = 2;
  while (db.prepare('SELECT 1 FROM entries WHERE slug = ? AND id != ?').get(slug, exceptId ?? -1)) slug = `${base}-${n++}`;
  return slug;
}

export function createEntry(db, collection, data, userId) {
  const d = cleanEntry(collection, data);
  const slug = uniqueSlug(db, collection, d.name);
  const g = COLLECTIONS[collection].group;
  const max = db.prepare('SELECT MAX(sort) m FROM entries WHERE collection = ?').get(collection).m ?? 0;
  const r = db.prepare('INSERT INTO entries(collection,slug,data,sort,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(collection, slug, JSON.stringify(d), max + 1, userId, now(), userId, now());
  void g;
  return getEntry(db, Number(r.lastInsertRowid));
}

/** Saving keeps the address (slug) the same, so links to the page never break. */
export function updateEntry(db, id, data, userId) {
  const e = getEntry(db, id);
  const d = cleanEntry(e.collection, data);
  db.prepare('UPDATE entries SET data = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(d), userId, now(), id);
  return getEntry(db, id);
}

export function deleteEntry(db, id) {
  const r = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!r) return false;
  if (r.seed_key) db.prepare('INSERT OR IGNORE INTO seed_removed(seed_key) VALUES (?)').run(r.seed_key);
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return true;
}

/** Moves an entry up or down within its group (family / course). */
export function moveEntry(db, id, dir) {
  const e = getEntry(db, id);
  const g = COLLECTIONS[e.collection].group;
  const peers = listEntries(db, e.collection).filter((x) => !g || x.data[g.key] === e.data[g.key]);
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
