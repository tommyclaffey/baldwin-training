// Diff two snapshots: per viewer, which files differ, and the first differing paths in each.
import fs from 'node:fs';
import path from 'node:path';
const [a, b] = process.argv.slice(2);
const paths = (x, y, at = '', out = []) => {
  if (out.length > 6) return out;
  if (JSON.stringify(x) === JSON.stringify(y)) return out;
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) paths(x[k], y[k], at + '.' + k, out);
    return out;
  }
  out.push(`${at}: ${JSON.stringify(x)?.slice(0, 120)} → ${JSON.stringify(y)?.slice(0, 120)}`);
  return out;
};
let total = 0;
for (const v of fs.readdirSync(a).filter((x) => fs.statSync(path.join(a, x)).isDirectory())) {
  const files = new Set([...['me.json', 'index.json', 'counts.json'], ...fs.readdirSync(path.join(a, v, 'page')).map((f) => 'page/' + f), ...(fs.existsSync(path.join(b, v, 'page')) ? fs.readdirSync(path.join(b, v, 'page')).map((f) => 'page/' + f) : [])]);
  const diffs = [];
  for (const f of files) {
    const fa = path.join(a, v, f), fb = path.join(b, v, f);
    const ta = fs.existsSync(fa) ? fs.readFileSync(fa, 'utf8') : null, tb = fs.existsSync(fb) ? fs.readFileSync(fb, 'utf8') : null;
    if (ta === tb) continue;
    diffs.push([f, ta && tb ? paths(JSON.parse(ta), JSON.parse(tb)) : [ta ? 'only before' : 'only after']]);
  }
  total += diffs.length;
  console.log(`== ${v}: ${files.size} files, ${diffs.length} differ`);
  for (const [f, p] of diffs.slice(0, 40)) console.log(`  ${f}\n    ${p.join('\n    ')}`);
}
console.log('total differing files:', total);
