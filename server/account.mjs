// Account content (Nov 16, Tommy: "the baldwin is supposed to [be] an account under the app" · "keep public").
// A customer's own material (its menu seeds, its own versions of designed pages, its own program text, its photos and logo)
// lives with its account on the volume, not in the public code repo:
//
//   DATA_DIR/accounts/<companyId>/
//     account.json             { "name": "…", "seedStore": <store id the menu seeds fill> }
//     cms/<collection>.json    menu seeds, same shape as content/cms/classic.json (server/cms.mjs, seed)
//     pages/<file>.json        the account's own version of a designed page (Our Story, Floor Plan, the Court sittings it
//                              hosts…), same shape as public/content/pages/<file>.json; page.planTables for a floor plan
//     pages/index.json         the search index entries for those pages (same shape as public/content/index.json)
//                              account.json "book": [files]: its own versions of pages the foundation book draws neutral
//                              (Nov 20: The Baldwin's service steps, Safety, templates, Cabernet, Rye), read by its demo
//                              copies too
//     programs/<key>/          the account's own version of a program's lessons (server/manual.mjs)
//     wine/pairs.json          its dish pairings (and Good to Know lines) on the wine region and grape pages (server/region.mjs)
//     public/img/…, public/icons/…   files its pages and look point at; served at /img/… and /icons/… (server/index.mjs)
//
// Nothing here is required: with no folder (a fresh install, the tests), the account's database rows still serve, the shared
// templates fill its designed pages, and nothing is archived or deleted. The folder is put on the volume by
// scripts/account-content/copy-to-volume.mjs before a deploy that needs it.
//
// Which account's folder a company reads: its own; a demo copy reads the account its demo shows off (The Baldwin's demo reads
// Baldwin Restaurant Group's), and only for the pages that are the restaurant's own (Our Story, Floor Plan) and its versions
// of the foundation book's pages (account.json "book"), never its bookings or offers.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.mjs';
import { BRG_NAME } from './variant.mjs';

export const ACCOUNTS_DIR = path.join(DATA_DIR, 'accounts');
const ID = /^[1-9][0-9]{0,8}$/;
export const accountDir = (id) => (ID.test(String(id)) ? path.join(ACCOUNTS_DIR, String(id)) : null);

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };

/** The accounts with a folder, by company id (read once; a new folder needs a restart, like a deploy). */
let listed = null;
export function accountIds() {
  if (!listed) { try { listed = fs.readdirSync(ACCOUNTS_DIR).filter((f) => ID.test(f) && isDir(path.join(ACCOUNTS_DIR, f))).map(Number).sort((a, b) => a - b); } catch { listed = []; } }
  return listed;
}
export const hasAccount = (id) => accountIds().includes(Number(id));
export const manifest = (id) => (hasAccount(id) ? readJson(path.join(accountDir(id), 'account.json')) || {} : null);

/* ---- which account a company reads ---- */
let DB = null;
/** The server's database, so a request's store can be matched to its account without passing it around. */
export function initAccounts(db) { DB = db; listed = null; pages.clear(); indexes.clear(); pairsCache.clear(); }
const companyCache = new Map(); // company id → { account, demoCopy } (company rows don't change account; demo rows go away)
/** { account, demoCopy } for a company: the account folder it reads, or null. */
export function accountFor(companyId) {
  if (!DB || !companyId || !accountIds().length) return null;
  const k = Number(companyId);
  if (companyCache.has(k)) return companyCache.get(k);
  const co = DB.prepare('SELECT id, name, demo, brand FROM companies WHERE id = ?').get(k);
  let out = null;
  if (co && !co.demo && hasAccount(co.id)) out = { account: co.id, demoCopy: false };
  // A demo copy of The Baldwin (server/demo.mjs, DEMOS.baldwin) shows Baldwin Restaurant Group's account: company 1.
  else if (co?.demo && co.brand === 'baldwin' && co.name === BRG_NAME && hasAccount(1)) out = { account: 1, demoCopy: true };
  if (companyCache.size > 500) companyCache.clear();
  companyCache.set(k, out);
  return out;
}

/** The account's own versions of the foundation book's pages (account.json "book"), as a Set of files. */
export const bookPages = (id) => new Set(Array.isArray(manifest(id)?.book) ? manifest(id).book.filter((f) => /^[0-9]+-[0-9]+$/.test(f)) : []);

/* ---- designed pages and their search entries ---- */
const pages = new Map();
/** The account's own version of a designed page (`file` = "23-2"), or null. Read once and kept. */
export function accountPage(id, file) {
  if (!/^[0-9]+-[0-9]+$/.test(file) || !hasAccount(id)) return null;
  const k = id + '/' + file;
  if (!pages.has(k)) pages.set(k, readJson(path.join(accountDir(id), 'pages', file + '.json')));
  return pages.get(k);
}
const indexes = new Map();
/** The account's search entries for its own pages, by file. */
export function accountIndex(id) {
  if (!hasAccount(id)) return new Map();
  if (!indexes.has(id)) { const list = readJson(path.join(accountDir(id), 'pages', 'index.json')); indexes.set(id, new Map((Array.isArray(list) ? list : []).map((e) => [e.file, e]))); }
  return indexes.get(id);
}

/* ---- program text ---- */
/** The account's own folder for a program's lessons (`key` = "hospitality"), or null. */
export function programDir(id, key) {
  if (!hasAccount(id) || !/^[a-z0-9-]+$/.test(key)) return null;
  const d = path.join(accountDir(id), 'programs', key);
  return isDir(d) ? d : null;
}

/* ---- wine pairings ---- */
const pairsCache = new Map();
/** The account's own words on the wine region and grape pages (wine/pairs.json): { pairs: { "<page slug>": [{ name, why,
 *  to }] }, goodToKnow: { "<page slug>": "…" } }. Nov 21: The Baldwin's pairings (and two Good to Know lines that name its
 *  menu) moved here out of content/wine; every other company has none. */
export function accountWine(id) {
  if (!hasAccount(id)) return { pairs: {}, goodToKnow: {} };
  if (!pairsCache.has(id)) {
    const j = readJson(path.join(accountDir(id), 'wine', 'pairs.json')) || {};
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    pairsCache.set(id, { pairs: obj(j.pairs), goodToKnow: obj(j.goodToKnow) });
  }
  return pairsCache.get(id);
}

/* ---- menu seeds ---- */
/** The account's seed files: [{ collection, file }] for collections that have one. */
export function seedFiles(id, collections) {
  if (!hasAccount(id)) return [];
  return collections.map((c) => ({ collection: c, file: path.join(accountDir(id), 'cms', c + '.json') })).filter((x) => fs.existsSync(x.file));
}

/* ---- files its pages and look point at ---- */
const PUBLIC = /^\/(img|icons)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/;
/** A file under /img/ or /icons/ that isn't in the app's build: the account folder that has it, or null. */
export function publicFile(urlPath) {
  if (!PUBLIC.test(urlPath) || urlPath.includes('..')) return null;
  for (const id of accountIds()) {
    const f = path.join(accountDir(id), 'public', urlPath);
    if (f.startsWith(path.join(accountDir(id), 'public') + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}
