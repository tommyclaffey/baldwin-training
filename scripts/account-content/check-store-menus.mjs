// Checks stores whose own menu is loaded (Nov 17, Testa Barra and J.Baldwin's): run it on a COPY of the database.
//
//   node scripts/account-content/check-store-menus.mjs --db <copy.db> --stores 3,2 [--menus a.json,b.json]
//        [--baseline <file>]   first run: writes The Baldwin's fingerprint there; later runs: compares with it
//
// For each store, as a staff member and as a manager of that store (two people added to the copy):
//   1. counts by type (dishes, house cocktails, wines, bottles, beers), and the menu files' counts when given;
//   2. The Baldwin's entries (store 1) and the group dishes: the same fingerprint as load-store-menu.mjs;
//   3. the leak sweep: every page in the store's book and its search index, for anything only The Baldwin has (its dishes',
//      drinks' and wines' names that this store doesn't share, its menu's name, Shelby, its flights). The store's own words
//      (its menu) are taken out first; mentions of the group (Baldwin Restaurant Group, Testa Barra, J.Baldwin's, Jeffrey
//      Baldwin) are counted and listed, not failed: they're the group's own content;
//   4. quizzes: the store's question pool is built, every question has four different answers with the right one among
//      them, none asks a price, and each store has sign-off quizzes from its own courses and drinks.
// Exit code 1 when a check fails.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dbFile = opt('--db');
if (!dbFile) { console.error('Usage: check-store-menus.mjs --db <copy.db> --stores 3,2 [--menus a.json,b.json] [--baseline <file>]'); process.exit(1); }
process.env.DATA_DIR ||= path.dirname(path.resolve(dbFile));
const { openDb } = await import('../../server/db.mjs');
const { listEntries } = await import('../../server/cms.mjs');
const { withStore, fullIndex, assemble } = await import('../../server/content.mjs');
const { questionPool, topicList } = await import('../../server/quizgen.mjs');
const { asVariant, isBrgCompany, accountOf } = await import('../../server/variant.mjs');
const { FINGERPRINT_SQL } = await import('./load-store-menu.mjs');
const { classify } = await import('../../server/generic.mjs');
const crypto = await import('node:crypto');

const db = openDb(path.resolve(dbFile));
const { initAccounts, accountIds } = await import('../../server/account.mjs');
initAccounts(db); // the account content folders (DATA_DIR/accounts), as the server reads them at start
console.log('account content: ' + (accountIds().map((id) => 'company ' + id).join(', ') || 'none (shared templates only)'));
const stores = (opt('--stores') || '3,2').split(',').map(Number);
const menus = (opt('--menus') || '').split(',').filter(Boolean).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
let failed = 0;
const fail = (msg) => { failed++; console.log('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

/* 2. The Baldwin unchanged */
console.log('\n== The Baldwin (store 1)');
// The Baldwin's entries and every group dish that was there at the baseline (the ids up to the baseline's last one)
const base = opt('--baseline');
const was = base && fs.existsSync(base) ? JSON.parse(fs.readFileSync(base, 'utf8')) : null;
const maxId = was ? was.maxId : db.prepare('SELECT COALESCE(MAX(id), 0) m FROM entries').get().m;
const rows = db.prepare(FINGERPRINT_SQL).all(maxId);
const fp = { count: rows.length, hash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'), maxId };
const counts1 = Object.fromEntries(['recipe', 'house', 'wine', 'shelf', 'beer', 'classic'].map((c) => [c, listEntries(db, c, 1).length]));
console.log('  entries:', JSON.stringify(counts1), 'fingerprint', fp.hash.slice(0, 16), `(${fp.count} rows)`);
if (was) {
  if (was.hash === fp.hash && was.count === fp.count) ok('store 1 and the group dishes that were there are exactly as in the baseline'); else fail(`store 1 changed: ${was.count}/${was.hash.slice(0, 16)} → ${fp.count}/${fp.hash.slice(0, 16)}`);
  if (JSON.stringify(was.counts) !== JSON.stringify(counts1)) fail('store 1 counts changed: ' + JSON.stringify(was.counts));
} else if (base) { fs.writeFileSync(base, JSON.stringify({ ...fp, counts: counts1, at: new Date().toISOString() })); ok('baseline written to ' + base); }

/* The Baldwin's own words, for the sweep */
// (a classic's name is the shared library's, not The Baldwin's: its "Sazerac" and "Negroni" are every store's classics)
const canon = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').replace(/^the/, '');
const classics = new Set([...listEntries(db, 'classic').flatMap((e) => [canon(e.data.name), canon(e.data.name).replace(/martini$|cocktail$/, '')]),
  'spritz', 'cosmo', 'lemondropmartini', 'propermartini']); // the quizzes' own twins (Aperol Spritz is the Spritz)
const theBaldwin = new Set([...listEntries(db, 'recipe', 1), ...listEntries(db, 'house', 1), ...listEntries(db, 'wine', 1)].map((e) => e.data.name).filter((n) => n && n.length > 4 && !classics.has(canon(n)) && !classics.has(canon(n).replace(/martini$/, ''))));
const FIXED = /The Baldwin(?!’s demo)|Shelby|thebaldwinshelby|Opening Menu|Fuschia Satin|Cozy Blankets|wine flight|sommelier flight|flight · \$30/i;
const GROUP = /Baldwin Restaurant Group|\bBRG\b|Testa Barra|J\.\s?Baldwin|Jeffrey(?! Ong)|Macomb|Feb 2[2-4], 2027/;
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const sid of stores) {
  const row = db.prepare('SELECT * FROM stores WHERE id = ?').get(sid);
  console.log(`\n== ${row.name} (store ${sid})`);
  /* 1. counts */
  const counts = Object.fromEntries(['recipe', 'house', 'wine', 'shelf', 'beer'].map((c) => [c, listEntries(db, c, sid).length]));
  console.log('  loaded:', `${counts.recipe} dishes, ${counts.house} house cocktails, ${counts.wine} wines, ${counts.shelf} bottles, ${counts.beer} beers`);
  const menu = menus.find((m) => m.store === sid);
  if (menu) {
    const want = { recipe: menu.recipes.length, house: menu.house.length, wine: menu.wine.length, shelf: menu.shelf.length, beer: menu.beer.length };
    for (const c of Object.keys(want)) if (counts[c] !== want[c]) fail(`${c}: ${counts[c]} in the book, ${want[c]} in the menu file`);
    if (Object.keys(want).every((c) => counts[c] === want[c])) ok('every item in the menu file is in the book');
  }
  if (!counts.recipe) fail('no dishes: the store reads the starter book');
  const own = new Set([row.name]);
  for (const c of ['recipe', 'house', 'wine', 'shelf', 'beer']) for (const e of listEntries(db, c, sid)) { const d = e.data; for (const v of [d.name, d.description, d.tagline, d.tableLine, d.notes, ...(d.ingredients || []), ...(d.build || []).map((b) => b?.ingredient)]) if (typeof v === 'string' && v.trim().length > 3) own.add(v.trim()); }
  const OURS = new RegExp([...own].sort((a, b) => b.length - a.length).map(esc).join('|'), 'g');
  const onlyBaldwin = [...theBaldwin].filter((n) => ![...own].some((o) => o.toLowerCase() === n.toLowerCase()));
  const THEIRS = new RegExp('\\b(' + onlyBaldwin.sort((a, b) => b.length - a.length).map(esc).join('|') + ')\\b');

  /* 3. the sweep, as staff and as a manager */
  const t = new Date().toISOString();
  const people = ['staff', 'manager'].map((role) => {
    const id = Number(db.prepare('INSERT INTO users(company_id, name, role, store_id, created_at) VALUES (?,?,?,?,?)').run(row.company_id, `Check ${role} ${sid}`, role, sid, t).lastInsertRowid);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  });
  const hits = [], group = new Map();
  let pages = 0;
  // Shared library pages (classics, spirits, wine regions, service) are every store's; there a producer or drink name is the
  // library's own wording ("Bottles to know: Silver Oak"), so only The Baldwin's fixed marks count. On the store's own and
  // mixed pages, its dishes and drinks, every name of The Baldwin's counts.
  let names = true;
  const scan = (v, where) => {
    if (typeof v === 'string') {
      let u = v; if (/%[0-9A-F]{2}/i.test(u)) { try { u = decodeURIComponent(u); } catch { /* keep */ } } // a link's search words
      const s = u.replace(OURS, ' ');
      const m = FIXED.exec(s) || (names && THEIRS.exec(s));
      if (m) hits.push(`${where}: …${s.slice(Math.max(0, m.index - 50), m.index + 60).replace(/\s+/g, ' ')}…`);
      const g = GROUP.exec(s); if (g) group.set(g[0], (group.get(g[0]) || 0) + 1);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => scan(x, where));
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(x, where + (k === 'n' ? '' : ''));
  };
  for (const u of people) {
    asVariant({ brg: isBrgCompany(db, row.company_id), restaurant: row.name, account: accountOf(row) }, () => withStore(row, () => {
      const idx = fullIndex(db);
      const kind = (e) => classify(e.slug); // a classic's page is the shared library's; a dish's, drink's, wine's or bottle's is the store's
      for (const e of idx) { names = kind(e) !== 'shared'; scan(e, `${u.role} index ${e.slug}`); }
      const seen = new Set();
      for (const e of idx) { if (seen.has(e.file)) continue; seen.add(e.file); names = kind(e) !== 'shared'; const p = assemble(db, e.file); pages++; scan(p, `${u.role} ${e.file} ${e.slug}`); }
    }, { ...u, demo: false }));
  }
  if (hits.length) { fail(`${hits.length} Baldwin-only mentions in ${pages} pages`); for (const h of hits.slice(0, 15)) console.log('     ' + h.slice(0, 200)); }
  else ok(`0 Baldwin-only mentions in ${pages} pages (staff + manager) and the search index`);
  console.log('    group mentions (the group’s own content): ' + ([...group].map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'));
  for (const u of people) db.prepare('DELETE FROM users WHERE id = ?').run(u.id);

  /* 4. quizzes */
  const pool = asVariant({ brg: isBrgCompany(db, row.company_id), restaurant: row.name, account: accountOf(row) }, () => questionPool(db, sid));
  const mine = pool.filter((q) => !q.topics.every((x) => x.startsWith('study:') || x.startsWith('final:')));
  const bad = mine.filter((q) => q.options.length !== 4 || new Set(q.options.map((o) => o.toLowerCase())).size !== 4 || !(q.answer >= 0 && q.answer < 4) || /price|cost|\$\d/i.test(q.q) || q.options.some((o) => !String(o).trim()));
  const topics = topicList(pool).filter((x) => x.group === 'Food' || x.group === 'Bar' || x.group === 'Know It Cold');
  console.log(`    quizzes: ${mine.length} questions from the store's own book; topics: ${topics.map((x) => `${x.label} ${x.count}`).join(' · ')}`);
  if (bad.length) { fail(`${bad.length} questions with a problem`); for (const q of bad.slice(0, 5)) console.log('     ' + q.q + ' → ' + q.options.join(' | ')); }
  else ok('every question has 4 different answers, the right one among them, and none asks a price');
  if (!topics.some((x) => x.group === 'Food')) fail('no food quizzes');
  const kinds = new Map(); for (const q of mine) { const k = q.ref.split(':')[0]; kinds.set(k, (kinds.get(k) || 0) + 1); }
  console.log('    by kind: ' + [...kinds].map(([k, n]) => `${k} ${n}`).join(', '));
  for (const q of mine.filter((_, i) => i % Math.max(1, Math.floor(mine.length / 6)) === 0).slice(0, 6)) console.log(`    e.g. ${q.q}\n         ${q.options.map((o, i) => (i === q.answer ? '[' + o + ']' : o)).join(' | ')}`);
}
db.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
