// Wine videos: the "Learn more about …" section on every wine page, and a play button on wines on the list.
// The section is designed once in Figma (Cabernet page, layer "Learn more") and placed on every wine page.
import { clone, find, byName, findAll, texts, setText, remove } from './templates.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { now } from './db.mjs';

const LINKS_FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'content', 'wine-folly-links.json');
const SEED_FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'content', 'wine-videos.json');

const STYLES = { red: 'Red', white: 'White', rose: 'Rosé', orange: 'Orange', sparkling: 'Sparkling' };
const COUNTRIES = { italy: 'Italy', france: 'France', usa: 'USA', spain: 'Spain', portugal: 'Portugal', germany: 'Germany', austria: 'Austria', greece: 'Greece', hungary: 'Hungary', georgia: 'Georgia', argentina: 'Argentina', chile: 'Chile', australia: 'Australia', 'new-zealand': 'New Zealand', 'south-africa': 'South Africa' };
const WINE_PAGE = '25-2';
const SECTION_SOURCE = '68-2';

/** What kind of wine page a slug is: style, country, grape, wine (rosé, orange, sparkling styles) or region. */
export function wineKind(slug) {
  const [root, a, b] = String(slug).split('/');
  if (root !== 'wine' || !a) return null;
  if (!b) return STYLES[a] ? 'style' : COUNTRIES[a] ? 'country' : null;
  if (a === 'red' || a === 'white') return 'grape';
  if (STYLES[a]) return 'wine';
  if (COUNTRIES[a]) return 'region';
  return null;
}

const COPY = {
  grape: (t) => [`A few minutes on the grape: how it tastes and where it grows`, `A short video on ${t}: how it tastes, where it grows, and how to talk about it with a guest.`],
  wine: (t) => [`A few minutes on how it’s made and how it tastes`, `A short video on ${t}: how it’s made, how it tastes, and how to talk about it with a guest.`],
  region: (t) => [`A few minutes on the region: its grapes and its wines`, `A short video on ${t}: where it is, what grows there, and how to talk about its wines with a guest.`],
  style: (t) => [`A few minutes on ${t.toLowerCase()} wine: the grapes and the styles`, `A short video on ${t.toLowerCase()} wine: the main grapes, the styles, and how to talk about them with a guest.`],
  country: (t) => [`A few minutes on ${t}: its regions and grapes`, `A short video on ${t}: the main regions, the grapes, and how to talk about them with a guest.`],
};

/* ---- storage ---- */
export function wineVideos(db) {
  const out = new Map();
  for (const r of db.prepare('SELECT * FROM wine_videos').all()) out.set(r.key, { video: JSON.parse(r.video), note: r.note || '', updatedAt: r.updated_at });
  return out;
}
/** Starting videos from the repo. Added once; after that the admin owns them (a removed one stays removed). */
export function seedWineVideos(db) {
  if (!fs.existsSync(SEED_FILE)) return;
  const { videos = [] } = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const has = db.prepare('SELECT 1 FROM wine_videos WHERE key = ?');
  const gone = db.prepare('SELECT 1 FROM seed_removed WHERE seed_key = ?');
  for (const v of videos) {
    if (has.get(v.key) || gone.get('wine-video:' + v.key)) continue;
    db.prepare('INSERT INTO wine_videos(key,video,note,updated_by,updated_at) VALUES (?,?,?,?,?)').run(v.key, JSON.stringify(v.video), v.note || null, null, now());
  }
}
export function setWineVideo(db, key, video, note, userId) {
  if (!video) {
    db.prepare('DELETE FROM wine_videos WHERE key = ?').run(key);
    db.prepare('INSERT OR IGNORE INTO seed_removed(seed_key) VALUES (?)').run('wine-video:' + key);
    return;
  }
  db.prepare('INSERT INTO wine_videos(key,video,note,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET video=excluded.video, note=excluded.note, updated_by=excluded.updated_by, updated_at=excluded.updated_at')
    .run(key, JSON.stringify(video), note || null, userId ?? null, now());
}

/** The wine cards with a photo (the tasting wines), not the rows of the wine list. */
const isTastingCard = (n) => (n.n || '').startsWith('Wine · ') && !!find(n, (x) => (x.n || '').startsWith('IMG/'));

/** Every place a wine video can go, grouped for the admin. */
export function wineTargets(index, basePage) {
  const wine = index.filter((e) => wineKind(e.slug));
  const groups = [
    { label: 'Wine styles', items: wine.filter((e) => wineKind(e.slug) === 'style') },
    { label: 'Countries', items: wine.filter((e) => wineKind(e.slug) === 'country') },
    ...Object.entries(STYLES).map(([k, v]) => ({ label: `${v} · ${k === 'red' || k === 'white' ? 'grapes' : 'styles'}`, items: wine.filter((e) => e.slug.startsWith(`wine/${k}/`)) })),
    ...Object.entries(COUNTRIES).map(([k, v]) => ({ label: `${v} · regions`, items: wine.filter((e) => e.slug.startsWith(`wine/${k}/`)) })),
  ].map((g) => ({ label: g.label, items: g.items.map((e) => ({ key: e.slug, name: e.title, slug: e.slug })) }));
  const list = findAll(basePage(WINE_PAGE)?.main || {}, isTastingCard);
  groups.unshift({ label: 'Wines on our list', items: list.map((n) => ({ key: 'wine:' + n.n.slice(7), name: n.n.slice(7), slug: 'the-bar/wine' })) });
  return groups.filter((g) => g.items.length);
}

/* ---- pages ---- */
let proto;
function sectionProto(basePage) {
  if (proto === undefined) proto = find(basePage(SECTION_SOURCE)?.main || {}, byName('Learn more')) || null;
  return proto;
}

/** Adds (or fills in) the "Learn more about …" section on a wine page. */
export function learnMore(page, entry, rec, basePage) {
  const kind = wineKind(entry.slug);
  if (!kind) return;
  const main = page.main;
  let sec = find(main, byName('Learn more'));
  if (!sec) {
    const p = sectionProto(basePage);
    if (!p) return;
    sec = clone(p);
    const last = main.c.length - 1; // previous / next stays at the bottom
    main.c.splice(last, 0, sec);
  }
  const title = entry.title;
  const name = kind === 'style' ? title + ' wine' : title;
  const [line, body] = COPY[kind](title);
  const slot = find(sec, (n) => (n.n || '').startsWith('Video slot'));
  slot.n = 'Video slot · Learn more about ' + name;
  const st = texts(slot);
  setText(st[1], 'Learn more about ' + name);
  setText(st[2], line);
  const copy = find(sec, byName('Copy'));
  const ct = copy.c.filter((c) => c.t === 'T');
  setText(ct[1], name.toUpperCase());
  setText(ct[2], rec?.note || body);
  if (rec?.video) { slot.vid = rec.video; remove(sec, find(sec, byName('Add video'))); }
}

/** Wines on the list: a play button on the photo when a video is attached (the badge is designed on one card). */
export function wineCards(page, videos) {
  const cards = findAll(page.main, isTastingCard);
  const proto = cards.map((c) => find(c, byName('Play badge'))).find(Boolean);
  for (const card of cards) {
    const rec = videos.get('wine:' + card.n.slice(7));
    let badge = find(card, byName('Play badge'));
    if (!rec?.video) { if (badge) remove(card, badge); continue; }
    card.vid = rec.video;
    if (!badge && proto) { badge = clone(proto); badge.x = Math.round((card.w - badge.w) / 2); card.c.push(badge); }
  }
}

/* ---- "Read more on Wine Folly" (Tommy, Oct 31: "if there is a page in Wine Folly then add them") ---- */
let LINKS;
const folly = () => (LINKS ??= fs.existsSync(LINKS_FILE) ? JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8')).links || {} : {});
/** A card under "Part of" that opens the region's Wine Folly page. */
export function wineFollyLink(page, slug, basePage) {
  const url = folly()[slug];
  if (!url || !page?.main) return;
  const parentOf = (n, t) => (n.c || []).includes(t) ? n : (n.c || []).reduce((h, c) => h || parentOf(c, t), null);
  const find = (n, pred) => pred(n) ? n : (n.c || []).reduce((h, c) => h || find(c, pred), null);
  if (find(page.main, (n) => n.n === 'Read more · Wine Folly')) return;
  // Region pages put it under "Part of"; country pages (no "Part of") under "Good to know", in the region page's card style.
  let after = find(page.main, (n) => n.n === 'Back to parent');
  let proto = after;
  if (!after && basePage) { after = find(page.main, (n) => n.n === 'Good to know'); proto = find(basePage('70-2')?.main || {}, (n) => n.n === 'Back to parent'); }
  if (!after || !proto) return;
  const card = structuredClone(proto);
  card.n = 'Read more · Wine Folly'; card.to = url;
  if (card !== proto && after.w && card.sh !== 'L') { card.sh = 'L'; }
  const texts = []; (function walk(n) { if (n.t === 'T') texts.push(n); (n.c || []).forEach(walk); })(card);
  if (texts[0]) { texts[0].s = 'READ MORE'; delete texts[0].segs; }
  if (texts[1]) { texts[1].s = 'On Wine Folly'; delete texts[1].segs; }
  const host = parentOf(page.main, after);
  host.c.splice(host.c.indexOf(after) + 1, 0, card);
}
