// Scanner v2 smoke run (Nov 22): the server's own functions with the real models, on a few photos.
//   DATA_DIR=<dir with models/> node scripts/scanner/smoke-v2.mjs <set.json> <photosDir> <outDir>
import fs from 'node:fs';
import path from 'node:path';
const [setFile, photoDir, outDir] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const s = await import(path.join(root, 'server/scanner.mjs'));
const sharp = (await import('sharp')).default;
fs.mkdirSync(outDir, { recursive: true });
const set = JSON.parse(fs.readFileSync(setFile, 'utf8')).photos;
console.log('engine', s.ENGINE);
for (const p of set.slice(0, 3)) {
  const buf = fs.readFileSync(path.join(photoDir, p.f));
  let t = Date.now();
  const { token, width, height } = await s.startScan(buf, { owner: 1 });
  const tRead = Date.now() - t; t = Date.now();
  const jpg = await s.cutScan(token, p.box, 1);
  const tCut = Date.now() - t;
  const png = s.lastCutPng(token, 1);
  const mj = await sharp(jpg).metadata(), mp = png && await sharp(png).metadata();
  fs.writeFileSync(path.join(outDir, p.f), jpg); if (png) fs.writeFileSync(path.join(outDir, p.f.replace('.jpg', '.png')), png);
  console.log(JSON.stringify({ photo: p.f, width, height, readMs: tRead, cutMs: tCut, jpg: `${mj.width}x${mj.height}`, png: mp && `${mp.width}x${mp.height}x${mp.channels}`, rssMB: Math.round(process.memoryUsage().rss / 1e6) }));
}
// Photo by Photo: two photos into one set
const a = fs.readFileSync(path.join(photoDir, set[4].f));
let r = await s.spinPhoto('', 0, a, set[4].box, { owner: 1 });
r = await s.spinPhoto(r.token, 1, a, set[4].box, { owner: 1 });
console.log(JSON.stringify({ spin: s.spinSetInfo(r.token, 1), thumb: (await sharp(r.thumb).metadata()).height }));
