// Adds the new region page names to each wine's "Shows on these pages" tags. Usage: node tagwines.mjs <db> [seedJson]
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const MAP = { 'Alsace': 'Alsace', 'Beaujolais': 'Beaujolais', 'Abruzzo': 'Abruzzo', 'Marche': 'Marche', 'Umbria': 'Umbria', 'Alto Adige': 'Trentino-Alto Adige', 'Trentino-Alto Adige': 'Trentino-Alto Adige', 'Lombardy': 'Lombardy', 'Finger Lakes': 'Finger Lakes' };
const fix = (d) => { const t = MAP[d.region]; if (!t) return false; const pages = d.pages || []; if (pages.includes(t)) return false; d.pages = [...pages, t]; return true; };
const db = new DatabaseSync(process.argv[2]);
let n = 0;
for (const r of db.prepare("SELECT id, data FROM entries WHERE collection = 'wine'").all()) {
  const d = JSON.parse(r.data); if (fix(d)) { db.prepare('UPDATE entries SET data = ? WHERE id = ?').run(JSON.stringify(d), r.id); n++; }
}
console.log('db updated', n);
if (process.argv[3]) { const s = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); let m = 0; for (const e of (Array.isArray(s) ? s : s.entries || [])) { const d = e.data || e; if (fix(d)) m++; } fs.writeFileSync(process.argv[3], JSON.stringify(s, null, 1)); console.log('seed updated', m); }
