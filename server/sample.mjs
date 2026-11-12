// Wrenfield, the Mise demo restaurant (Nov 11): the parts of its own pages that The Baldwin's design drew with The Baldwin's
// photos. Home's Browse the Book tiles and photo strip, and the Photo Library, are filled from Wrenfield's own dishes,
// drinks and a few room and kitchen shots (all Unsplash stand-ins, credited in content/demo-mise/photos.json).
import fs from 'node:fs';
import path from 'node:path';
import { clone, find, findAll, byName, startsWith, texts, setText } from './templates.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let photos;
/** Every stand-in photo, by its file: size, credit, and the room shots with their captions. */
function stock() {
  if (!photos) { try { photos = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/demo-mise/photos.json'), 'utf8')); } catch { photos = {}; } }
  return photos;
}
const byFile = (file) => Object.values(stock()).find((p) => p.file === file) || null;
const credit = (file) => (byFile(file)?.credit || 'Unsplash (stand-in)').replace(/ · Unsplash \(stand-in\)$/, ', Unsplash');
const ratio = (file) => { const p = byFile(file); return p?.w && p?.h ? p.h / p.w : 1; };
const fill = (node, file, label) => { node.f = [{ img: file, m: 'FILL' }]; node.n = `IMG/${label} · ${credit(file)} (stand-in)`; };

// The room, the bar and the kitchen: what a new hire sees on day one. Captions say what's in the picture.
const ROOM = [
  ['dining-room', 'The dining room', 'Before service'], ['bar-counter', 'The bar', 'Back bar, set for service'],
  ['chef-plating', 'On the pass', 'Plating reference'], ['table-service', 'Wine service', 'Pouring at the table'],
  ['kitchen-line', 'The line', 'Tickets on the rail'], ['herbs-prep', 'Herbs', 'Prep · picked and washed'],
];

/** What the photo pages show, in order: every dish, every drink, then the room. */
function gallery(recipes, house) {
  const dishes = recipes.filter((e) => e.data.photo).map((e, i) => ({ title: e.data.name, cap: i % 3 === 1 ? 'Plating reference' : 'Final plate', file: e.data.photo }));
  const drinks = house.filter((e) => e.data.photo).map((e) => ({ title: e.data.name, cap: [e.data.glass, e.data.garnish && e.data.garnish.toLowerCase()].filter(Boolean).join(', '), file: e.data.photo }));
  const room = ROOM.map(([k, title, cap]) => ({ title, cap, file: stock()[k]?.file })).filter((x) => x.file);
  // Mixed so the strip and the top of the library show food, drinks and the room together.
  const out = [];
  for (let i = 0; out.length < dishes.length + drinks.length + room.length; i++) for (const list of [dishes, drinks, room]) if (list[i]) out.push(list[i]);
  return out;
}

function photoCard(proto, it, width, tall = true) {
  const card = clone(proto);
  card.n = `Photo · ${it.title} · ${it.cap}`;
  const im = find(card, startsWith('IMG/'));
  const frame = find(card, byName('Image'));
  if (im) {
    fill(im, it.file, it.title);
    if (tall) { const h = Math.round(Math.min(Math.max(width * ratio(it.file), 200), 360)); im.h = h; if (frame) frame.h = h; card.h = h + 40; }
  }
  const [name, cap] = texts(find(card, byName('Meta')) || card);
  if (name) { setText(name, it.title); name.n = it.title; }
  if (cap) { setText(cap, it.cap); cap.n = it.cap; }
  return card;
}

/** Fill the Mise demo's own pages before they're wired. `slug` is the page ('' = Home). */
export function fillSample(page, slug, { recipes, house, wines }) {
  const m = page.main;
  const items = gallery(recipes, house);
  if (slug === '') {
    // Browse the Book: Wrenfield's own courses, each tile with one of its dishes.
    const n = (...cs) => recipes.filter((e) => cs.includes(e.data.course)).length;
    const first = (...cs) => recipes.find((e) => cs.includes(e.data.course) && e.data.photo && !e.data.signature)?.data.photo;
    const TILES = {
      'Small Plates': ['Small Plates', `${n('Snacks & Small Plates')} items`, first('Snacks & Small Plates')],
      Mains: ['Mains', `${n('Mains')} items`, first('Mains')],
      'Pizza & Pasta': ['Salads & Dessert', `${n('Salads', 'Dessert')} items`, first('Salads', 'Dessert')],
      Cocktails: ['Cocktails', `${house.length} drinks`, house.find((e) => e.data.photo)?.data.photo],
      Wine: ['Wine', `${wines.length} on our list`, stock()['table-service']?.file],
    };
    for (const [was, [name, label, file]] of Object.entries(TILES)) {
      const t = find(m, byName('Tile · ' + was));
      if (!t) continue;
      t.n = 'Tile · ' + name;
      const [a, b] = texts(t); if (a) { setText(a, name); a.n = name; } if (b) { setText(b, label); b.n = label; }
      const im = find(t, startsWith('IMG/')); if (im && file) fill(im, file, name);
    }
    // The Food Matrix preview's chips name Wrenfield's own courses.
    const course = new Map(recipes.map((e) => ['Row · ' + e.data.name, e.data.course]));
    for (const r of findAll(find(m, byName('Section · Food Matrix')) || { c: [] }, startsWith('Row · '))) if (course.has(r.n)) r.course = course.get(r.n);
    // The photo strip: the first six from the library.
    const row = find(find(m, byName('Section · Photo Library')) || { c: [] }, byName('Photos'));
    const proto = row && row.c.find(startsWith('Photo · '));
    if (proto) row.c = items.slice(0, row.c.filter(startsWith('Photo · ')).length || 6).map((it) => photoCard(proto, it, proto.w, false));
  }
  if (slug === 'photo-library') {
    const masonry = find(m, byName('Masonry'));
    const cols = masonry?.c?.filter((c) => (c.c || []).some(startsWith('Photo · '))) || [];
    const proto = cols[0] && cols[0].c.find(startsWith('Photo · '));
    if (proto) {
      const heights = cols.map(() => 0);
      const lists = cols.map(() => []);
      for (const it of items) {
        const card = photoCard(proto, it, proto.w);
        const i = heights.indexOf(Math.min(...heights)); // shortest column next, so the columns end level
        lists[i].push(card); heights[i] += (card.h || 300) + 16;
      }
      cols.forEach((col, i) => { col.c = [...col.c.filter((c) => !startsWith('Photo · ')(c)), ...lists[i]]; });
    }
    // Any counts drawn into the page header follow the real number.
    for (const t of findAll(m, (x) => x.t === 'T' && /^\d+ photos$/i.test(x.s || ''))) setText(t, `${items.length} photos`);
  }
  if (slug === 'our-story') fillStory(m);
  if (slug === 'floor-plan') fillFloorPlan(page);
  return page;
}

/* ---- Our Story, Floor Plan and the Sommelier "about" page for Wrenfield (Nov 11, Tommy: "make sure both styles have all
 * the same functions and features, only thing different should be the menu items and the style"). Same designed pages as
 * The Baldwin's, with Wrenfield's own words. Wrenfield is made up, and the pages say so: no awards, reviews or numbers it
 * couldn't back up; only the demo's own cast; Unsplash stand-in photos, credited. ---- */

/** Every text that reads `from` becomes `to` (and so does its layer name). `to` = null leaves the line out. */
function put(m, from, to) {
  for (const t of findAll(m, (x) => x.t === 'T' && x.s === from)) {
    if (to === null) { const p = parentOf(m, t); if (p) p.c = p.c.filter((x) => x !== t); continue; }
    setText(t, to); t.n = to;
  }
}
const parentOf = (root, node) => (root.c || []).includes(node) ? root : (root.c || []).reduce((hit, c) => hit || parentOf(c, node), null);
const rename = (m, from, to) => { const n = find(m, byName(from)); if (n) n.n = to; return n; };
const dropNode = (m, pred) => { for (const n of findAll(m, pred)) { const p = parentOf(m, n); if (p) p.c = p.c.filter((x) => x !== n); } };

function fillStory(m) {
  const hero = find(m, startsWith('IMG/exterior'));
  if (hero) fill(hero, stock()['dining-room']?.file, 'The dining room');
  put(m, 'BALDWIN RESTAURANT GROUP', 'WRENFIELD');
  put(m, 'Modern plates. Proper pours.', 'Wood fire. Good company.');
  put(m, 'A family restaurant group built on hospitality first. Three restaurants, one family, and a standard that started in 2004.',
    'A neighborhood kitchen and bar built around a wood fire. One room, one short menu, and a team that knows both by heart.');
  rename(m, 'Pill · Shelby Township, MI', 'Pill · Sample restaurant'); put(m, 'Shelby Township, MI', 'Sample restaurant');
  rename(m, 'Pill · Since 2004', 'Pill · Wood-fired American'); put(m, 'Since 2004', 'Wood-fired American');

  put(m, 'Where we came from', 'How it started');
  put(m, 'In 2004, after more than two decades in some of Metro Detroit’s most respected kitchens, Chef Jeff Baldwin and Rosemarie Baldwin opened J.Baldwin’s in Clinton Township. The idea: fine-dining flavor and technique in a room that feels welcoming.',
    'Wrenfield started with one idea from its owner, Gideon Ambrose: cook over a wood fire, pour drinks people remember, and treat every guest like a neighbor who walked in hungry.');
  put(m, 'It grew into a true family business. Testa Barra followed in Macomb Township, and The Baldwin is next, carrying the same values: hospitality, consistency and bringing people together.',
    'The menu is short on purpose. Learn every plate, every pour and every step of service in this book, and you can answer anything a guest asks.');
  const MILESTONES = [
    ['J.Baldwin’s opens', '2004', 'FIRST', 'The wood grill goes in', 'Chef Jeff and Rosemarie Baldwin, Clinton Township', 'Most of the menu starts on it'],
    ['Baldwin Restaurant Group is formed', '2016', 'THEN', 'The bar opens', 'The family business becomes a group', 'House cocktails, two of them without spirits'],
    ['Testa Barra opens', '2017', 'NOW', 'The Nest opens', 'Chefs Mike and Gabriella Baldwin, Macomb Township', 'A private room for up to 24, behind the bar'],
    ['The Baldwin opens', 'NEXT', 'NEXT', 'Your first shift', 'Shelby Township · date to add', 'Start with My Path, then the Floor Plan'],
  ];
  for (const [was, y0, y1, title, line0, line1] of MILESTONES) {
    const ms = rename(m, 'Milestone · ' + was, 'Milestone · ' + title);
    if (!ms) continue;
    put(ms, y0, y1); put(ms, was, title); put(ms, line0, line1);
  }

  const fam = rename(m, 'The Baldwin family', 'Section · The team');
  const famImg = fam && find(fam, startsWith('IMG/'));
  if (famImg) fill(famImg, stock()['chef-plating']?.file, 'On the pass');
  put(m, 'A true family business', 'Who you’ll work with');
  put(m, 'THE BALDWIN FAMILY', 'THE TEAM');
  const PEOPLE = [
    ['Chef Jeff Baldwin', 'Gideon Ambrose', 'Founder and chef. Opened J.Baldwin’s in 2004.', 'Owner. Opened Wrenfield, and still works the door on Fridays.'],
    ['Rosemarie Baldwin', 'Rosalind Hart', 'Co-founder. Retail designer and CMO.', 'General manager. Runs lineup, the schedule and your training.'],
    ['Chefs Mike and Gabriella Baldwin', 'The kitchen', 'Husband-and-wife CIA graduates who lead Testa Barra’s kitchen.', 'Every dish in this book is theirs. Not sure about an allergen? Ask the pass.'],
    ['Jeffrey Baldwin', 'Quinn Abbott', 'Director of Operations and Head Sommelier. Mentors 20+ certified sommeliers across the group.', 'Bartender. Passed Level 2 of the Cocktail Program: the one to shadow behind the bar.'],
  ];
  for (const [was, name, line0, line1] of PEOPLE) {
    const row = rename(m, 'Person · ' + was, 'Person · ' + name);
    if (!row) continue;
    put(row, was, name); put(row, line0, line1);
  }
  put(m, 'Source: jbaldwins.com and testabarra.com', 'Sample restaurant · photos from Unsplash');

  // Our Restaurants → the rooms of the one restaurant, each opening the page that teaches it.
  put(m, 'The family', 'Inside Wrenfield');
  put(m, 'OUR RESTAURANTS', 'THE ROOMS');
  rename(m, 'Pill · Add the group’s other locations', 'Pill · One restaurant, three rooms');
  put(m, '3 restaurants · one family', 'One restaurant · three rooms');
  const ROOMS = [
    ['J.Baldwin’s', 'The dining room', 'dining-room', '/floor-plan', 'Open the Floor Plan',
      ['Clinton Township · since 2004', 'Tables 101–504'], ['New American · stone-fired pizza · seafood', 'Window two-tops, the main floor, the banquette'],
      ['Home of Chef Jeff Baldwin’s signature calamari.', 'Where most of your shift happens.'], ['16981 18 Mile Road · (586) 416-3500', 'Sections change nightly'], 'Visit jbaldwins.com'],
    ['Testa Barra', 'The bar', 'bar-counter', '/the-bar/cocktails', 'Open The Bar',
      ['Macomb Township · since 2017', 'Bar seats 1–12'], ['Modern Italian · fresh pasta · hand-tossed pizza', 'House cocktails, wine by the glass, draft beer'],
      ['Led by Chefs Mike and Gabriella Baldwin, CIA graduates.', 'Every spec is in Cocktail Specs.'], ['48824 Romeo Plank Road · (586) 434-0100', 'Build every drink from the spec'], 'Visit testabarra.com'],
    ['The Baldwin', 'The kitchen', 'kitchen-line', '/food-matrix', 'Open the Food Matrix',
      ['Shelby Township · opening soon', 'Wood grill · sauté · garde manger'], ['Modern plates · proper pours', 'Everything on the menu starts here'],
      ['The newest member of the family.', 'Food leaves from the pass.'], ['Address to add', 'Allergens: always ask the pass'], 'Visit thebaldwinshelby.com'],
  ];
  for (const [was, name, photo, to, link, ...lines] of ROOMS) {
    const card = rename(m, 'Restaurant · ' + was, 'Room · ' + name);
    if (!card) continue;
    delete card.to;
    const img = find(card, (x) => typeof x.n === 'string' && x.n.startsWith('IMG/') && !/logo/i.test(x.n));
    if (img) fill(img, stock()[photo]?.file, name);
    dropNode(card, (x) => /^Logo|^IMG\/logo/.test(x.n || ''));
    dropNode(card, startsWith('Pill · You are here'));
    put(card, was, name);
    const site = lines.pop();
    for (const [a, b] of lines) put(card, a, b);
    put(card, site, link + ' →');
    const l = find(card, byName('Link · Website')); if (l) { l.n = 'Link · ' + link; l.to = to; }
  }

  put(m, 'From the group’s own words', 'A sample restaurant’s values');
  const VALUES = [
    ['Hospitality first', 'Know the plate', '“A place built on hospitality first.” Every guest is looked after before anything else.', 'Every dish has a story. Tell it in one line, the same way every time.', 'On a shift: Eye contact and a warm hello within seconds.', 'On a shift: Taste the focus dish at lineup.'],
    ['Consistency', 'Read the table', 'The same standard every visit, at every restaurant in the group.', 'A date, a business dinner, a birthday: each table wants something different.', 'On a shift: The Short Rib tastes the same on a Tuesday as a Saturday.', 'On a shift: Ask what brings them in tonight.'],
    ['Bringing people together', 'Help first', '“The best dining experiences are the ones shared with family and friends.”', 'If a teammate is in the weeds, their table is your table for a minute.', 'On a shift: Suggest dishes for the table to share.', 'On a shift: Run the food that’s up, even if it isn’t yours.'],
    ['Part of the family', 'Leave it better', '“Make every guest feel like part of the family.” That goes for the team too.', 'Reset every station the way you’d want to find it at the start of your shift.', 'On a shift: Learn regulars’ names. Help a teammate first.', 'On a shift: Side work done before you clock out.'],
  ];
  for (const [was, name, l0, l1, s0, s1] of VALUES) {
    const v = rename(m, 'Value · ' + was, 'Value · ' + name);
    if (!v) continue;
    put(v, was, name); put(v, l0, l1); put(v, s0, s1);
    // ♿ the "On a shift" line sits on a dark chip: near-white, not grey (the skin turns this into #D9D4CB)
    for (const t of texts(find(v, byName('On a shift')) || { c: [] })) t.f = [{ c: '#D9D1C6' }];
  }
  put(m, '“Make every guest feel like part of the family.”', '“Feed people like they’re guests in our home.”');
  // The promise is drawn in The Baldwin's script; Mise keeps handwriting for the taped note, so it's a serif quote here.
  for (const t of findAll(m, (x) => x.t === 'T' && x.s === '“Feed people like they’re guests in our home.”')) Object.assign(t, { ff: 'Instrument Serif', fs: 'Regular', z: 40, lh: '110%' });
  put(m, 'From jbaldwins.com', 'Wrenfield’s house rule');
  return m;
}

/** Wrenfield's room: its own plan (scripts/demo-mise-floorplan.mjs), areas and rooms. Find a Table and Tonight's
 *  Sections work the same way; the table list comes with the page (interact.mjs reads page.planTables). */
let wrenPlan;
function fillFloorPlan(page) {
  const m = page.main;
  wrenPlan ??= JSON.parse(fs.readFileSync(path.join(ROOT, 'content/demo-mise/floorplan.json'), 'utf8'));
  const img = find(m, startsWith('IMG/floorplan'));
  if (img) { img.f = [{ img: wrenPlan.image, m: 'FILL' }]; img.n = 'IMG/floorplan · Wrenfield sample floor plan (drawn for the demo)'; }
  page.planTables = wrenPlan.tables;
  put(m, 'The copper 1 on each table marks seat 1. Count the other seats from there, so food always goes to the right guest.',
    'The red 1 on each table marks seat 1. Count the other seats clockwise from there, so food always goes to the right guest.');
  const dot = find(find(m, byName('Seat 1')) || { c: [] }, byName('Dot'));
  if (dot) dot.f = [{ c: '#8E2A26' }]; // the plan's seat-1 red (deep fig); white 1 on it is 8.4:1
  for (const t of texts(dot || { c: [] })) t.f = [{ c: '#FFFFFF' }];
  const AREAS = [
    ['100s', '101–110', '101–106', 'Booth wall', 'Front windows', '10 tables along the back booth, on both sides of the wine room', '6 two-tops along the windows, past the host stand'],
    ['200s', '201–204', '201–210', 'Rounds and diamonds', 'Main floor', '2 large rounds and 2 diamond tops by the entry', '10 four-tops in two rows; 205 and 210 seat six'],
    ['300s', '301–312', '301–308', 'Center banquettes', 'Banquette', '12 tables down the double banquette', '8 two-tops along the back banquette'],
    ['400s', '401–403', '401–404', 'Front windows', 'The Nest', '3 tables along the front, past the host stand', '4 rounds in the private room, up to 24 guests'],
    ['500s', '501–510', '501–504', 'Bar side', 'High-tops', 'Tables beside the bar, including the long 510', '4 high-tops between the bar and the pass'],
    ['Bar', '1–16', '1–12', 'Bar seats', 'Bar seats', '16 seats wrapped around the bar', '9 seats down the front, 3 round the end'],
  ];
  for (const [tag, r0, r1, n0, n1, d0, d1] of AREAS) {
    const a = find(m, byName('Area · ' + tag));
    if (!a) continue;
    put(a, r0, r1); put(a, n0, n1); put(a, d0, d1);
  }
  rename(m, 'Wine Room', 'The Nest'); put(m, 'Wine Room', 'The Nest');
  put(m, 'Private dining in the center of the booth wall', 'Private dining behind the bar. Book it through Rosalind.');
  rename(m, 'Pasta Room', 'The Pass'); put(m, 'Pasta Room', 'The Pass');
  put(m, 'Glass-walled room beside the kitchen', 'Where food leaves the kitchen. Runners start here.');
  return page;
}

/** The Sommelier Program's "about" page without The Baldwin group's own Court sittings, dates or people: what the Court's
 *  levels are and how to get ready with the lessons in the app. Facts about the Court are the page's own (from the Court). */
export function sampleSommAbout(page) {
  const m = page.main;
  if (!m) return page;
  for (const t of findAll(m, (x) => x.t === 'T' && /^Our group hosts the Court/.test(x.s || '')))
    { setText(t, 'The Court of Master Sommeliers runs Level 1 and Level 2 in cities across the country. This is your guide: what each level is, and how to get ready with the lessons in this app.'); t.n = 'Intro'; }
  const CELLS = [
    ['Cell · LEVEL 1 AT TESTA BARRA', 'LEVEL 1', 'Course and exam'],
    ['Cell · LEVEL 2 AT TESTA BARRA', 'LEVEL 2', 'Exam, after Level 1'],
    ['Cell · WHERE', 'WHERE', 'Court dates, many cities'],
    ['Cell · ASK', 'GET READY', 'The lessons in this app'],
  ];
  for (const [was, label, value] of CELLS) {
    const c = rename(m, was, 'Cell · ' + label);
    if (!c) continue;
    const [a, b] = texts(c);
    if (a) { setText(a, label); a.n = label; }
    if (b) { setText(b, value); b.n = value; }
  }
  for (const t of findAll(m, (x) => x.t === 'T' && /^Dates from the Court’s calendar/.test(x.s || '')))
    { setText(t, 'Dates and cities are on the Court’s calendar at mastersommeliers.org. Seats are booked with the Court.'); t.n = 'Dates note'; }
  findAll(m, startsWith('Pill · We host this')).forEach((p, i) => { const word = i === 0 ? 'Start here' : 'Next'; p.n = 'Pill · ' + word; for (const t of texts(p)) { setText(t, word); t.n = word; } });
  const why = rename(m, 'Why · No travel needed', 'Why · Study on your own time');
  if (why) {
    const [a, b, c] = texts(why);
    if (a) { setText(a, 'Study on your own time'); a.n = a.s; }
    if (b) { setText(b, 'The lessons, practice cards and practice exams for both levels live in this app, so you can study between shifts.'); b.n = 'Why line'; }
    if (c) { setText(c, 'In the Sommelier Program'); c.n = c.s; }
  }
  const step1 = rename(m, 'Step · Tell Jeffrey', 'Step · Tell your manager');
  if (step1) {
    const [, a, b] = texts(step1);
    if (a) { setText(a, 'Tell your manager'); a.n = a.s; }
    if (b) { setText(b, 'Let your manager know you want in, so your schedule leaves room for the course.'); b.n = 'Step line'; }
  }
  const step2 = find(m, byName('Step · Book with the Court'));
  if (step2) { const [, , b] = texts(step2); if (b) { setText(b, 'Create an account at mastersommeliers.org and pick a course date and city. Seats are booked with the Court.'); b.n = 'Step line'; } }
  // Register buttons: the Court's calendar, not The Baldwin group's own sittings.
  const buttons = find(m, (x) => x.n === 'Buttons' && (x.c || []).some(startsWith('Button · Register')));
  if (buttons) {
    const [first] = buttons.c.filter(startsWith('Button · Register'));
    first.n = 'Button · See the Court’s calendar'; first.to = 'https://www.mastersommeliers.org';
    for (const t of texts(first)) { setText(t, 'See the Court’s Calendar'); t.n = t.s; }
    buttons.c = buttons.c.filter((x) => !startsWith('Button · Register')(x));
  }
  for (const t of findAll(m, (x) => x.t === 'T' && /^The Feb 24 Level 2 is for/.test(x.s || '')))
    { setText(t, 'Level 2 is for people who’ve already passed Level 1. Study the Level 2 lessons here first.'); t.n = 'Good to know'; }
  return page;
}
