const sharp = (await import('sharp')).default;
import fs from 'node:fs';
const [a, b] = process.argv.slice(2);
let same = 0, diff = [];
for (const f of fs.readdirSync(a).filter((x) => x.endsWith('.png')).sort()) {
  if (!fs.existsSync(`${b}/${f}`)) { diff.push(f + ' (missing)'); continue; }
  const A = await sharp(`${a}/${f}`).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const B = await sharp(`${b}/${f}`).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) { diff.push(`${f} size ${A.info.width}x${A.info.height} vs ${B.info.width}x${B.info.height}`); continue; }
  let n = 0, minY = 1e9, maxY = -1;
  for (let i = 0; i < A.data.length; i += 4) if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) { n++; const y = Math.floor(i / 4 / A.info.width); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  if (n) diff.push(`${f}: ${n} px differ (rows ${minY}-${maxY})`); else same++;
}
console.log(`identical ${same}, different ${diff.length}`); for (const d of diff) console.log('  ' + d);
