// Loads one store's menu (food, house cocktails, wine list, back bar, beer) into its book (Nov 17, Testa Barra and
// J.Baldwin's, from their own websites). Tommy: "Sounds good to me. Just remember, we're doing spirits and wine as well."
//
//   node scripts/account-content/load-store-menu.mjs <menu.json> [--db <file>] [--user <id>] [--apply]
//
// Without --apply it runs everything inside a transaction and rolls it back: a dry run that prints exactly what would
// change. The menu file is account content (it stays out of this repo; Baldwin Restaurant Group's are in mise-private).
// Its shape: { store, storeName, recipes|house|wine|shelf|beer: [{ data, link? }], skipped: [...] }.
//
// It writes the way the app's own save paths do, so nothing downstream needs telling:
//   • every entry goes through createEntry/updateEntry (server/cms.mjs): the same field cleaning as the admin form and the
//     menu import's Approve, the store's own scope, slugs unique in the store, sort order = menu order;
//   • a new dish goes into the group's kitchen and onto this store's menu ({ share: true }, like Import a Menu); a dish the
//     menu file links to an existing group dish ("link": its library name) is put on the menu from the library, with this
//     store's course and price, and this store's own wording kept as a store-only change (scope "store");
//   • nothing is archived or deleted, and an entry already in the store (same name) is left alone, so it can run again;
//   • the search index and quiz caches of a running server drop on their own (another connection's write is caught by
//     PRAGMA data_version, server/cache.mjs);
//   • one line per collection in the activity log.
// Guards: the store must exist, not be The Baldwin's designed book (book_ready), and not be store 1. A select field whose
// value the form would have changed (an unknown course, say) stops the run. The Baldwin's entries (store 1) and every
// library dish that was already there are fingerprinted before and after; any change rolls everything back.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const isMain = import.meta.url === 'file://' + process.argv[1];
const args = isMain ? process.argv.slice(2) : [];
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const file = args.find((a, i) => !a.startsWith('--') && !['--db', '--user'].includes(args[i - 1]));
if (isMain && !file) { console.error('Usage: load-store-menu.mjs <menu.json> [--db <file>] [--user <id>] [--apply]'); process.exit(1); }
const dbFile = opt('--db');
if (dbFile) process.env.DATA_DIR ||= path.dirname(path.resolve(dbFile));

const { openDb, audit } = await import('../../server/db.mjs');
const { COLLECTIONS, cleanEntry, listEntries, createEntry, updateEntry, getEntry, LIBRARY_STORE } = await import('../../server/cms.mjs');

export const FINGERPRINT_SQL = 'SELECT id, collection, slug, data, sort, archived_at, store_id FROM entries WHERE store_id = 1 OR (store_id = 0 AND id <= ?) ORDER BY id';
/** The Baldwin's book (store 1) and the group library as it was: a hash that can't change while another store loads. */
export function fingerprint(db, maxLib) {
  const rows = db.prepare(FINGERPRINT_SQL).all(maxLib);
  return { count: rows.length, hash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}
/** What makes two entries the same in one store's list (two wines from one producer differ by grape). */
const ident = (col, d) => [d.name, col === 'wine' ? d.grape : col === 'beer' ? d.serve : ''].join('\u0001').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").trim();
const ORDER = ['recipe', 'house', 'wine', 'shelf', 'beer'];
const KEYS = { recipe: 'recipes', house: 'house', wine: 'wine', shelf: 'shelf', beer: 'beer' };

export function loadMenu(db, menu, { userId, apply }) {
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND deleted_at IS NULL').get(menu.store);
  if (!store) throw new Error(`No store ${menu.store}.`);
  if (store.id === 1 || store.book_ready) throw new Error(`${store.name} has a designed book; this loader is for stores reading their own menu.`);
  if (menu.storeName && menu.storeName !== store.name) throw new Error(`The file is for ${menu.storeName}, but store ${store.id} is ${store.name}.`);
  const user = db.prepare('SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);
  if (!user) throw new Error(`No user ${userId} to write as.`);
  const company = store.company_id;
  const maxLib = db.prepare('SELECT COALESCE(MAX(id), 0) m FROM entries').get().m;
  const before = fingerprint(db, maxLib);
  const report = { store: store.name, storeId: store.id, added: {}, kept: {}, linked: [], errors: [] };
  db.exec('BEGIN');
  try {
    for (const col of ORDER) {
      const list = menu[KEYS[col]] || [];
      const have = new Set(listEntries(db, col, store.id).map((e) => ident(col, e.data)));
      report.added[col] = 0; report.kept[col] = 0;
      for (const item of list) {
        const d = item.data;
        if (have.has(ident(col, d))) { report.kept[col]++; continue; }
        // The admin form would quietly pick the first option for a value it doesn't know; stop instead.
        const clean = cleanEntry(col, d);
        for (const f of COLLECTIONS[col].fields.filter((x) => x.type === 'select' && x.key in d)) {
          if (clean[f.key] !== d[f.key]) report.errors.push(`${col} “${d.name}”: ${f.key} “${d[f.key]}” isn’t one of the options`);
        }
        if (col === 'recipe' && item.link) {
          const lib = db.prepare("SELECT id, data FROM entries WHERE collection = 'recipe' AND store_id = ? AND company_id = ? AND archived_at IS NULL AND json_extract(data, '$.name') = ?").all(LIBRARY_STORE, company, item.link);
          if (lib.length !== 1) { report.errors.push(`recipe “${d.name}”: ${lib.length} group dishes are named “${item.link}”`); continue; }
          const e = createEntry(db, 'recipe', { course: d.course, price: d.price }, userId, store.id, company, { libraryId: lib[0].id });
          // This store's own wording (name, description, tagline as printed) stays this store's; the group dish is unchanged.
          const ld = JSON.parse(lib[0].data);
          const mine = Object.fromEntries(['name', 'description', 'tagline', 'gfOption'].filter((k) => k in d && JSON.stringify(d[k]) !== JSON.stringify(ld[k])).map((k) => [k, d[k]]));
          if (Object.keys(mine).length) { const cur = getEntry(db, e.id).data; delete cur.libraryId; updateEntry(db, e.id, { ...cur, ...mine }, userId, 'store'); }
          report.linked.push({ name: d.name, library: item.link, libraryId: lib[0].id, ownWording: Object.keys(mine) });
        } else {
          createEntry(db, col, d, userId, store.id, company, col === 'recipe' ? { share: true } : {});
        }
        have.add(ident(col, d));
        report.added[col]++;
      }
      if (report.added[col]) audit(db, userId, 'load menu · ' + col, `${store.name}: ${report.added[col]} from ${menu.sourceShort || 'its website'}`, company);
    }
    const after = fingerprint(db, maxLib);
    report.baldwin = { before, after, unchanged: before.hash === after.hash && before.count === after.count };
    if (!report.baldwin.unchanged) report.errors.push('The Baldwin’s entries or the existing group dishes changed: rolled back.');
    report.counts = Object.fromEntries(ORDER.map((c) => [c, listEntries(db, c, store.id).length]));
    if (report.errors.length || !apply) db.exec('ROLLBACK'); else db.exec('COMMIT');
    report.applied = !report.errors.length && !!apply;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return report;
}

if (isMain) {
  const menu = JSON.parse(fs.readFileSync(file, 'utf8'));
  const db = dbFile ? openDb(path.resolve(dbFile)) : openDb();
  // Written as: --user, else the primary super admin (Mise's team), else the company's first owner.
  const company = db.prepare('SELECT company_id FROM stores WHERE id = ?').get(menu.store)?.company_id;
  const userId = Number(opt('--user')) || db.prepare("SELECT id FROM users WHERE role = 'superadmin' AND super_primary = 1 AND deleted_at IS NULL").get()?.id
    || db.prepare("SELECT id FROM users WHERE role = 'owner' AND company_id = ? AND deleted_at IS NULL ORDER BY id").get(company ?? -1)?.id || 0;
  const r = loadMenu(db, menu, { userId, apply: args.includes('--apply') });
  console.log(JSON.stringify(r, null, 1));
  console.log(r.applied ? `Loaded into ${r.store}.` : r.errors.length ? `Not loaded: ${r.errors.length} problem(s).` : 'Dry run: nothing written (add --apply).');
  db.close();
  process.exit(r.errors.length ? 2 : 0);
}
