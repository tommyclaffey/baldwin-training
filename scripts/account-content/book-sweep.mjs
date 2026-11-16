// Sweep a snapshot's fake-company viewers for anything of The Baldwin group's.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const RE = /The Baldwin|J\.?\s?Baldwin|Baldwin|Testa Barra|\bBRG\b|Jeffrey(?! Ong)|Shelby|Macomb|Feb 2[2-4]|\$22\b|flight · \$30|wine flight|sommelier flight|We host|Rosemarie|Gabriella(?! Clare)|jbaldwins|testabarra|thebaldwinshelby|WatchGuard/;
const hits = new Map();
const walk = (v, where, file) => {
  if (typeof v === 'string') { const m = RE.exec(v); if (m) { const k = file; (hits.get(k) || hits.set(k, []).get(k)).push(`${where}: …${v.slice(Math.max(0, m.index - 50), m.index + 60)}…`); } return; }
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, where + '[' + i + ']', file));
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, where + '.' + k, file);
};
for (const viewer of fs.readdirSync(dir).filter((v) => v.startsWith('fake'))) {
  const vd = path.join(dir, viewer);
  for (const f of ['me.json', 'index.json', 'counts.json']) walk(JSON.parse(fs.readFileSync(path.join(vd, f))), '', viewer + '/' + f);
  for (const f of fs.readdirSync(path.join(vd, 'page'))) walk(JSON.parse(fs.readFileSync(path.join(vd, 'page', f))), '', viewer + '/page/' + f);
}
let n = 0;
for (const [f, list] of hits) { n += list.length; console.log(`${f} (${list.length})`); for (const l of list.slice(0, 3)) console.log('   ' + l.slice(0, 220)); }
console.log(`${n} hits in ${hits.size} files`);
