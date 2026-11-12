// Archive where items live (Nov 12, Tommy, Nov 11: "I want to create a system where you're archiving certain items and
// you're not necessarily removing them fully. You can archive the item.")
// Archive was only in the admin tables. Now it's also where managers work: the Edit Mode bar on an item's page, a small
// Archive button beside the chat button on list rows and cards, and one Archived page (/admin/archived) with Restore.
// Archiving is the same as the admin's: archived_at is set, the item leaves the book, the lists, the quizzes and search
// (server/cache.mjs drops the caches on the UPDATE), and it can be restored. Nothing is deleted.
//   node.arc = { e: entry id, n: name, c: collection, s?: store, o?: other restaurants }   (s: a group dish, comes off
//   this store's menu only; o: how many other restaurants keep it)
// Only marked for people who can edit that collection (canOpen), so staff never get a control.
import { COLLECTIONS, SHARED, listArchived, sharedWith } from './cms.mjs';
import { find, byName, startsWith } from './templates.mjs';

/** The order and names of the Archived page's groups. */
export const ARCHIVE_GROUPS = [
  { col: 'recipe', label: 'Dishes' }, { col: 'house', label: 'House Cocktails' }, { col: 'classic', label: 'Classic Cocktails' },
  { col: 'wine', label: 'Wines' }, { col: 'shelf', label: 'Bottles' }, { col: 'beer', label: 'Beers' },
];
const PAGED = ['recipe', 'house', 'classic', 'wine', 'shelf'];

const slugOf = (to) => (typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') ? decodeURIComponent(to.split(/[?#]/)[0]).replace(/^\/+|\/+$/g, '') : null);

/** What an archive control says about an entry: a group dish only comes off this store's menu. */
export function arcOf(db, e) {
  const out = { e: e.id, n: String(e.data.name || ''), c: e.collection };
  if (e.library) {
    out.s = db.prepare('SELECT name FROM stores WHERE id = ?').get(e.storeId)?.name || '';
    out.o = sharedWith(db, e).length;
  }
  return out;
}

/**
 * Marks the rows and cards on a page that the viewer can archive. `entry` is the page's own entry (its link to itself
 * gets nothing: the Edit Mode bar has Archive); `can(col)` says whether the viewer may edit that collection; `list(col)`
 * gives the store's live entries.
 */
export function markArchive(db, page, { entry, can, list }) {
  if (!page?.main) return page;
  const bySlug = new Map();
  for (const col of PAGED) if (can(col)) for (const e of list(col)) bySlug.set(e.slug, e);
  const beers = can('beer') ? list('beer').filter((b) => b.data.serve === 'Draft') : [];
  if (!bySlug.size && !beers.length) return page;
  const made = new Map();
  const mark = (e) => { if (!made.has(e.id)) made.set(e.id, arcOf(db, e)); return made.get(e.id); };
  (function walk(n) {
    if (!n || /^Hero\b/.test(n.n || '')) return; // the hero is the page itself
    if (n.t === 'F' && n.to) {
      const e = bySlug.get(slugOf(n.to));
      if (e && e.id !== entry?.id) { n.arc = mark(e); return; } // one control per item: nothing inside it gets another
    }
    (n.c || []).forEach(walk);
  })(page.main);
  // Beer & Draft: the tap table's rows are the beers (they have no pages of their own).
  const table = beers.length && find(page.main, byName('Tap table'));
  for (const row of table ? (table.c || []).filter(startsWith('Row · ')) : []) {
    const b = beers.find((x) => 'Row · ' + x.data.name === row.n);
    if (b) row.arc = mark(b);
  }
  return page;
}

/** Everything archived in this store, grouped by type, newest first, with who archived it. */
export function archivedList(db, store, can) {
  const who = db.prepare('SELECT e.archived_by AS by, u.name AS name FROM entries e LEFT JOIN users u ON u.id = e.archived_by WHERE e.id = ?');
  const groups = ARCHIVE_GROUPS.filter((g) => can(g.col)).map((g) => {
    const items = listArchived(db, g.col, SHARED.has(g.col) ? null : store).map((e) => {
      const w = who.get(e.id) || {};
      const item = { id: e.id, name: String(e.data.name || 'Untitled'), at: e.archivedAt, by: w.name || null, auto: w.by == null,
        slug: COLLECTIONS[g.col].noPages ? null : e.slug };
      if (e.library) item.storeOnly = { store: db.prepare('SELECT name FROM stores WHERE id = ?').get(e.storeId)?.name || '', others: sharedWith(db, e).length };
      return item;
    });
    return { id: g.col, label: g.label, items };
  });
  const media = db.prepare('SELECT m.*, u.name AS by_name FROM media m LEFT JOIN users u ON u.id = m.archived_by WHERE m.store_id = ? AND m.archived_at IS NOT NULL ORDER BY m.archived_at DESC').all(store)
    .map((m) => ({ id: m.id, name: m.title || m.file || 'Untitled', at: m.archived_at, by: m.by_name || null, auto: m.archived_by == null, kind: m.youtube_id ? 'YouTube video' : /^video\//.test(m.mime || '') ? 'Video' : 'Photo' }));
  groups.push({ id: 'media', label: 'Videos and Photos', items: media });
  return groups;
}
