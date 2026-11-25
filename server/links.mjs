// A link per account, and its link preview (Nov 19; Figma 09 · Idea Board → 43 "Link previews per account", 850:1360).
// Tommy: "for each account … its own preview text, like the social preview … if it has custom branding … If it's generic,
// just doing the Mise."
//
//   /sign-in, /join            Nov 23: Sign In and Join with a Code (src/lib/authroute.ts); both reserved below.
//   /<account>/join             that account's Join with a Code in its look (its code only); /<account>/sign-in = /<account>.
//   miseacademy.app/<account>   companies.slug, e.g. /the-baldwin. Opens that account's sign-in in its own look (the
//                               join code is still asked for: a public address can't be the key to a company's book).
//                               Demo copies and Mise Academy (HQ) have no link.
//   link previews               Messages, Slack, LinkedIn and X read the page without JavaScript, so the server writes the
//                               account's Open Graph and Twitter tags into the HTML it sends. Custom Brand accounts with a
//                               card of their own (account.json "share", the image in the account folder) get theirs;
//                               every other account, and every other address, gets the Mise Academy card.
//   reserved                    an account address can never be an app address: every page of the book, every program,
//                               the admin, the demos, the legal pages, the API and the build's own files are reserved, and
//                               a company that would land on one gets "-2" (fixAccountSlugs on start, accountSlug on add).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { audit } from './db.mjs';
import { baseIndex } from './content.mjs';
import { PROGRAMS, LEVELS, GUIDE, allChapters, isProgram } from './manual.mjs';
import { lessonSlug, wholeChapterSlug } from './study.mjs';
import { COLLECTIONS } from './cms.mjs';
import { lookOf } from './looks.mjs';
import { manifest, publicFile } from './account.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
/** Where the app lives, for the absolute addresses link previews need. */
export const SITE = (process.env.PUBLIC_URL || 'https://www.miseacademy.app').replace(/\/+$/, '');

/** 2 to 40 lower-case letters, numbers and single hyphens, starting and ending with a letter or number. */
export const SLUG = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,39}$/;

/** Addresses that open a demo (Figma 43's caption names miseacademy.app/fig-and-fire). Fig & Fire is Mise's demo
 *  restaurant, a private copy per visitor, so its link opens the demo. */
export const DEMO_LINKS = { 'fig-and-fire': '/demo/mise' };

/* The app's own first path segments that aren't pages of the book. */
const APP = [
  'admin', 'api', 'demo', 'privacy', 'terms', 'help', 'img', 'icons', 'assets', 'media', 'content', 'import', 'prep',
  'my-path', 'team-chat', 'certificate', 'share.jpg', 'favicon.ico', 'index.html', 'robots.txt', 'sitemap.xml',
  // words a link should never take, so a later page or a support link can use them
  'mise', 'mise-academy', 'mise-hq', 'hq', 'app', 'www', 'join', 'login', 'logout', 'signin', 'sign-in', 'signup', 'sign-up',
  'account', 'accounts', 'settings', 'support', 'about', 'pricing', 'blog', 'home', 'search', 'edit', 'new', 'static',
  'public', 'health', 'ops', 'well-known', 'auth', 'invite', 'reset', 'two-step', 'book', 'library', 'quiz', 'quizzes',
];
const first = (s) => String(s || '').replace(/^\/+/, '').split('/')[0];

let reservedSet = null;
/** Every first path segment the app uses (or keeps for itself). Read once: the book's addresses come with a deploy. */
export function reserved() {
  if (reservedSet) return reservedSet;
  const out = new Set(APP);
  for (const k of Object.keys(DEMO_LINKS)) out.add(k);
  for (const k of AUTH_PAGES) out.add(k); // Nov 23: Sign In and Join with a Code (also in APP, kept explicit)
  for (const e of baseIndex()) out.add(first(e.slug));
  for (const P of PROGRAMS) out.add(first(P.slug));
  for (const L of LEVELS) out.add(first(L.slug));
  for (const c of Object.values(COLLECTIONS)) out.add(first(c.prefix));
  out.add(first(GUIDE));
  for (const ch of allChapters()) {
    try { out.add(first(wholeChapterSlug(ch))); ch.sections.forEach((_, i) => out.add(first(lessonSlug(ch, i)))); } catch { /* a chapter without sections */ }
    if (isProgram(ch)) out.add(first(ch.program));
  }
  // the build's own top-level files and folders (dist/), and the source of them (public/)
  for (const d of [DIST, path.join(ROOT, 'public')]) { try { for (const f of fs.readdirSync(d)) out.add(f.toLowerCase()); } catch { /* not built */ } }
  out.delete('');
  reservedSet = out;
  return out;
}
/** Can't be an account's address: reserved, or a demo copy's (demo-…). */
export const isReserved = (slug) => reserved().has(slug) || slug === 'demo' || slug.startsWith('demo-');

const toSlug = (name) => String(name || '').toLowerCase().replace(/&/g, ' and ').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/, '');

/** A new company's address: from its name, never reserved, never taken (adds -2, -3…). */
export function accountSlug(db, name, { except = null } = {}) {
  let base = toSlug(name);
  if (base.length < 2) base = 'company';
  for (let i = 1; i < 1000; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    if (!SLUG.test(s) || isReserved(s)) continue;
    const taken = db.prepare('SELECT id FROM companies WHERE slug = ?').get(s);
    if (!taken || taken.id === except) return s;
  }
  return `company-${crypto.randomBytes(4).toString('hex')}`;
}

/** Start-up: a real company whose address is now reserved (a page added since) or malformed gets a safe one, logged. */
export function fixAccountSlugs(db) {
  const rows = db.prepare('SELECT id, name, slug FROM companies WHERE demo = 0 AND internal = 0').all();
  for (const co of rows) {
    if (SLUG.test(co.slug) && !isReserved(co.slug)) continue;
    const next = accountSlug(db, co.slug && co.slug.length >= 2 ? co.slug : co.name, { except: co.id });
    db.prepare('UPDATE companies SET slug = ? WHERE id = ?').run(next, co.id);
    audit(db, null, 'account link changed', `${co.name}: /${co.slug} → /${next} (the old address is the app's)`, co.id);
    console.log(`Account link: ${co.name} /${co.slug} → /${next}`);
  }
}

/** The company an account link opens, or null: real, not deleted, not HQ, not a demo copy, and not a reserved address. */
export function accountByLink(db, slug) {
  if (!SLUG.test(String(slug)) || isReserved(slug)) return null;
  return db.prepare('SELECT * FROM companies WHERE slug = ? AND demo = 0 AND internal = 0 AND deleted_at IS NULL').get(slug) || null;
}
/** A company's link path (/the-baldwin), or null for HQ, demo copies and deleted companies. */
export const linkOf = (co) => (co && !co.demo && !co.internal && !co.deleted_at && SLUG.test(co.slug) && !isReserved(co.slug) ? '/' + co.slug : null);

/* ---------------------------- link previews ---------------------------- */
const MISE_IMAGE = '/img/mise-brand/share-card.jpg';
const LINE = 'The menu, the bar, wine and service, all in one place.';
/** The Mise Academy card (Figma 850:1377; Nov 25 the sign-in's H8 words, scripts/share-card/render.mjs): the site's root, every Foundation account and every other address. */
export const MISE_SHARE = { title: 'Mise Academy', description: LINE, image: MISE_IMAGE,
  alt: 'Mise: ready for service, front and back of house. A bartender pouring a cocktail.' };

const versions = new Map();
/** ?v= from the file's own bytes, so a new card is a new address and cached previews refresh. */
function versioned(urlPath) {
  const file = publicFile(urlPath) || [path.join(DIST, urlPath), path.join(ROOT, 'public', urlPath)].find((f) => fs.existsSync(f));
  if (!file) return SITE + urlPath;
  const st = fs.statSync(file); const k = file + '|' + st.mtimeMs + '|' + st.size;
  if (!versions.has(k)) versions.set(k, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10));
  return `${SITE}${urlPath}?v=${versions.get(k)}`;
}

/** Nov 22 (Your Look): a company wearing a look made from its website gets a card made from that look (server/yourlook.mjs
 *  dataShareFor, set at startup). → { title, description, image, alt } or null. */
let dataShare = () => null, dataSpec = () => null;
export const setDataShare = (fn, spec) => { dataShare = fn; if (spec) dataSpec = spec; };
/** The card an account's link shows. Custom Brand + its own card in account.json's "share" → that card; a look made in
 *  Your Look → its card; else Mise's. */
export function shareFor(co) {
  const made = co && co.plan === 'custom-brand' && /^look-\d+$/.test(lookOf(co)) ? dataShare(co) : null;
  if (made) return { ...made, custom: true };
  const own = co && co.plan === 'custom-brand' && lookOf(co) !== 'mise' ? manifest(co.id)?.share : null;
  const ok = own && typeof own.title === 'string' && typeof own.image === 'string' && /^\/img\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(own.image) && publicFile(own.image);
  const card = ok ? { title: own.title, description: own.description || LINE, image: own.image, alt: own.alt || own.title } : MISE_SHARE;
  return { ...card, custom: !!ok };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The tags a link preview reads. `account`: { slug, name, brand } for the sign-in (no join code, ever). */
export function headTags({ title, description, image, alt }, { url = SITE + '/', account = null } = {}) {
  const img = versioned(image);
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Mise Academy" />',
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(img)}" />`,
    '<meta property="og:image:type" content="image/jpeg" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${esc(alt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(img)}" />`,
    `<meta name="twitter:image:alt" content="${esc(alt)}" />`,
    ...(account ? [`<meta name="mise-account" content="${esc(JSON.stringify(account))}" />`] : []),
  ].join('\n    ');
}

const SHARE_BLOCK = /<!-- share:start -->[\s\S]*?<!-- share:end -->/;
let shell = null;
/** dist/index.html with its link-preview block swapped for these tags. */
export function pageHtml(tags) {
  const f = path.join(DIST, 'index.html');
  const st = fs.statSync(f);
  if (!shell || shell.mtime !== st.mtimeMs) shell = { mtime: st.mtimeMs, html: fs.readFileSync(f, 'utf8') };
  const html = shell.html;
  if (!SHARE_BLOCK.test(html)) return html.replace(/<title>[\s\S]*?<\/title>/, () => tags); // an old build: at least the title
  return html.replace(SHARE_BLOCK, () => `<!-- share:start -->\n    ${tags}\n    <!-- share:end -->`);
}

/** The HTML for an account's link: its card, and what the sign-in needs (name and look; never its join code). */
/** Nov 23: `sub` is 'join' or 'sign-in' for /<account>/join and /<account>/sign-in (the same card, that address). */
export function accountHtml(co, sub = null) {
  const card = shareFor(co);
  const brand = lookOf(co);
  const spec = /^look-\d+$/.test(brand) ? dataSpec(brand) : null; // Nov 22: a look made in Your Look brings its paint
  return pageHtml(headTags(card, { url: `${SITE}/${co.slug}${sub ? '/' + sub : ''}`, account: { slug: co.slug, name: co.name, brand, ...(spec ? { lookSpec: spec } : {}) } }));
}
/** Every other page: the Mise card. Nov 23: /sign-in and /join say their own address. */
export const AUTH_PAGES = ['sign-in', 'join'];
export const miseHtml = (p = '/') => pageHtml(headTags(MISE_SHARE, { url: SITE + (AUTH_PAGES.includes(String(p).replace(/^\/+|\/+$/g, '')) ? '/' + String(p).replace(/^\/+|\/+$/g, '') : '/') }));
