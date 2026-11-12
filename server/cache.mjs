// Content caches (Nov 11, Tommy: "why is it taking so long to load?"). The search index, the quiz question pool and the
// shared library's names are worked out from a store's book, which only changes when someone saves to it. So they're kept
// per store and thrown away the moment the book changes.
//
// What counts as a change is watched in SQLite itself, so no save path can be missed (the admin, Edit Mode, archive and
// restore, the scanner, seeding, demo copies made and dropped): TEMP triggers (this connection only, nothing is written
// into the database file) call bt_changed(store, collection) after every insert, update or delete on the tables the book
// is read from. A change to a store's own lists drops that store's caches; a change that every store reads (The Baldwin's
// book or the group library, which the shared pages are scrubbed against; the shared classics; wine videos; a company's
// look) drops them all. A write from another connection (a script run against the live file) is caught by PRAGMA
// data_version and drops everything. Pages themselves aren't cached: they're drawn per person on every request.
const caches = new Set(); // each: Map<db, Map<store, Map<key, value>>>
const listeners = new Set();
let generation = 0; // bumps on every change, so a build that a change interrupted isn't kept
const watched = new WeakMap(); // db → { version: PRAGMA data_version statement, seen }

/** A cache per database and store id that empties itself when that store's book changes. */
export function storeCache() {
  const m = new Map();
  caches.add(m);
  return m;
}
/** How many stores' copies each cache keeps (each store's index and quiz pool are a few MB). */
const MAX_STORES = Number(process.env.CACHE_STORES) || 16;
/** Store id for things every store reads (cleared by any change that reaches every store). */
export const EVERY_STORE = -1;

/** What `build` returns for this store and key (e.g. the request's program version), built once until the store changes. */
export function cached(cache, db, store, key, build) {
  othersWrote(db);
  let perDb = cache.get(db);
  if (!perDb) cache.set(db, (perDb = new Map()));
  let byKey = perDb.get(store);
  if (byKey) { perDb.delete(store); perDb.set(store, byKey); } // most recently used last
  else {
    perDb.set(store, (byKey = new Map()));
    // Only the stores in use stay (a demo copy nobody's looking at any more is dropped first); a dropped one is rebuilt if asked.
    while (perDb.size > MAX_STORES) perDb.delete(perDb.keys().next().value);
  }
  if (byKey.has(key)) return byKey.get(key);
  if (byKey.size >= 64) byKey.clear(); // keys are a few program versions, or menus' dish names: never many
  const gen = generation;
  const value = build();
  // Something changed while it was being built (a write inside the build): don't keep a copy that's already old.
  if (gen === generation) byKey.set(key, value);
  return value;
}
/** Called with the store id that changed (null = every store). */
export const onContentChange = (fn) => listeners.add(fn);

/** Drop what's cached for one store, or for every store (store null). */
export function forget(store = null) {
  generation++;
  for (const m of caches) for (const perDb of m.values()) store == null ? perDb.clear() : perDb.delete(store);
  for (const fn of listeners) fn(store);
}

/** Another connection (a script, another process) committed to this database since we last looked: drop everything. */
function othersWrote(db) {
  const w = watched.get(db);
  if (!w) return;
  const v = w.version.get().data_version;
  if (v !== w.seen) { w.seen = v; forget(null); }
}

/** Store ids whose changes every store reads: 0 is the group library, 1 is The Baldwin (the shared pages are scrubbed of its names). */
const EVERYONE = new Set([0, 1]);
function changed(store, collection) {
  if (store == null || EVERYONE.has(Number(store)) || collection === 'classic') forget(null);
  else forget(Number(store));
  return null;
}

/** Start watching this connection's writes. Called by openDb, after migrations. */
export function watchContent(db) {
  db.function('bt_changed', { varargs: true }, (store, collection) => changed(store, collection));
  const on = (table, events, body) => {
    for (const ev of events) db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS bt_watch_${table}_${ev.toLowerCase()} AFTER ${ev} ON main.${table} BEGIN ${body(ev)} END;`);
  };
  const rows = (ev) => (ev === 'INSERT' ? ['NEW'] : ev === 'DELETE' ? ['OLD'] : ['OLD', 'NEW']);
  // entries: the book itself
  on('entries', ['INSERT', 'UPDATE', 'DELETE'], (ev) => rows(ev).map((r) => `SELECT bt_changed(${r}.store_id, ${r}.collection);`).join(' '));
  // a store's name or book (book_ready) changes what its pages say; a new or dropped store must never find an old copy
  on('stores', ['INSERT', 'UPDATE', 'DELETE'], (ev) => rows(ev).map((r) => `SELECT bt_changed(${r}.id, NULL);`).join(' '));
  // a company's look (brand) or demo flag: every store (rare)
  on('companies', ['UPDATE'], () => 'SELECT bt_changed(NULL, NULL);');
  // wine videos are on the shared wine pages and in every store's Video Library
  on('wine_videos', ['INSERT', 'UPDATE', 'DELETE'], () => 'SELECT bt_changed(NULL, NULL);');
  // (Uploaded videos and photos aren't read by anything cached: pages are drawn fresh on every request.)
  const version = db.prepare('PRAGMA data_version');
  watched.set(db, { version, seen: version.get().data_version });
}
