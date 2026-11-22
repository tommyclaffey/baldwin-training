// Scanner v2 side by side (Nov 22): today's engine vs the new pipeline (and the cut-out models tried), on the same photos
// and boxes, on the beige at the same size. Research only; nothing here runs in the app.
//   node scripts/scanner/compare.mjs <set.json> <photosDir> <outDir> [--models <dir>] [--only 01,05] [--variants a,b]
// set.json: { photos: [{ f, box: [x0,y0,x1,y1] }] }. Writes <outDir>/<photo>.jpg (one row per photo), metrics.json.
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const [setFile, photoDir, outDir] = args;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const modelDir = opt('--models', path.join(process.env.HOME, 'Coding/scanner-lab/models'));
process.env.DATA_DIR = path.dirname(modelDir); // today's engine reads DATA_DIR/models
const only = opt('--only', '')?.split(',').filter(Boolean);
const variants = opt('--variants', 'today,sam,u2net,isnet,birefnet').split(',');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const sharp = (await import('sharp')).default;
const ort = await import('onnxruntime-node');
const { bottleMask } = await import(path.join(root, 'server/scanner.mjs'));
const { cutBottle, onBeige } = await import(path.join(root, 'server/cutout.mjs'));
fs.mkdirSync(outDir, { recursive: true });
const so = { intraOpNumThreads: Number(opt('--threads', 2)) };
const sam = { enc: await ort.InferenceSession.create(path.join(modelDir, 'mobile_sam_image_encoder.onnx'), so), dec: await ort.InferenceSession.create(path.join(modelDir, 'sam_mask_decoder_multi.onnx'), so) };
const files = { u2net: 'u2net.onnx', isnet: 'isnet-general-use.onnx', birefnet: 'birefnet-lite.onnx' };
const mattes = {};
for (const v of variants) { const kind = v.replace(/-.*/, ''); if (files[kind] && !mattes[kind]) mattes[kind] = await ort.InferenceSession.create(path.join(modelDir, files[kind]), so); }
const BEIGE = [231, 222, 207], ROW_H = 900;
const set = JSON.parse(fs.readFileSync(setFile, 'utf8')).photos.filter((p) => !only?.length || only.some((o) => p.f.startsWith(o)));

/** Roughness of an outline: mean |2nd difference| of each row's left and right 0.5 edge, per 1000 px of bottle height. */
function roughness(alpha, w, h) {
  const L = [], R = [];
  for (let y = 0; y < h; y++) { let l = -1, r = -1; for (let x = 0; x < w; x++) if (alpha[y * w + x] >= 128) { if (l < 0) l = x; r = x; } L.push(l); R.push(r); }
  let s = 0, n = 0;
  const y0 = Math.round(h * 0.05), y1 = Math.round(h * 0.97);
  for (let y = y0 + 1; y < y1 - 1; y++) for (const E of [L, R]) if (E[y - 1] >= 0 && E[y] >= 0 && E[y + 1] >= 0) { const d = Math.abs(E[y + 1] - 2 * E[y] + E[y - 1]); if (d < h * 0.02) { s += d; n++; } }
  return n ? (s / n) * (1000 / h) : null;
}
/** Today's compose: the photo where the mask is, beige elsewhere, 5% room, at most 1400 tall (copied from scanner.mjs). */
async function todayCut(base, W, H, mask) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = Math.round((y1 - y0 + 1) * 0.05), cw = x1 - x0 + 1 + pad * 2, ch = y1 - y0 + 1 + pad * 2;
  const rgb = await sharp(base).removeAlpha().raw().toBuffer();
  const o = Buffer.alloc(cw * ch * 3), a8 = Buffer.alloc((x1 - x0 + 1) * (y1 - y0 + 1));
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sx = x0 - pad + x, sy = y0 - pad + y;
    const a = sx >= 0 && sy >= 0 && sx < W && sy < H ? mask[sy * W + sx] / 255 : 0;
    const si = (sy * W + sx) * 3, di = (y * cw + x) * 3;
    for (let c = 0; c < 3; c++) o[di + c] = Math.round((a ? rgb[si + c] : 0) * a + BEIGE[c] * (1 - a));
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a8[(y - y0) * (x1 - x0 + 1) + x - x0] = mask[y * W + x];
  const jpg = await sharp(o, { raw: { width: cw, height: ch, channels: 3 } }).resize({ height: 1400, withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return { jpg, alpha: a8, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const label = (t, w) => Buffer.from(`<svg width="${w}" height="44"><rect width="100%" height="100%" fill="#2E2622"/><text x="12" y="29" font-size="20" font-family="Helvetica" fill="#F2EEE7">${t.replace(/&/g, '&amp;')}</text></svg>`);
const metrics = [];
for (const p of set) {
  const buf = fs.readFileSync(path.join(photoDir, p.f));
  const base = await sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const { width: W, height: H } = await sharp(base).metadata();
  const cols = [];
  // The photo with its box.
  const [bx0, by0, bx1, by1] = p.box;
  const pw = Math.round(ROW_H * W / H);
  const boxSvg = `<svg width="${pw}" height="${ROW_H}"><rect x="${bx0 * pw}" y="${by0 * ROW_H}" width="${(bx1 - bx0) * pw}" height="${(by1 - by0) * ROW_H}" fill="none" stroke="#7BA5CB" stroke-width="3" stroke-dasharray="10 7"/></svg>`;
  cols.push({ name: 'Photo + box', img: await sharp(base).resize(pw, ROW_H).composite([{ input: Buffer.from(boxSvg) }]).jpeg().toBuffer() });
  const row = { photo: p.f, W, H };
  for (const v of variants) {
    const t = Date.now();
    try {
      if (v === 'today') {
        const { mask } = await bottleMask(buf, p.box);
        const r = await todayCut(base, W, H, mask);
        row.today = { ms: Date.now() - t, outH: (await sharp(r.jpg).metadata()).height, rough: roughness(r.alpha, r.w, r.h) };
        const fitted = await sharp({ create: { width: Math.round(ROW_H * 0.5), height: ROW_H, channels: 3, background: { r: BEIGE[0], g: BEIGE[1], b: BEIGE[2] } } })
          .composite([{ input: await sharp(r.jpg).resize({ height: Math.round(ROW_H * 0.92), width: Math.round(ROW_H * 0.48), fit: 'inside' }).toBuffer(), gravity: 'center' }]).jpeg().toBuffer();
        cols.push({ name: 'Today', img: fitted });
        continue;
      }
      const kind = v.replace(/-.*/, '');
      const noshape = v.includes('noshape');
      const models = { sharp, ort, sam, matte: mattes[kind] || null, matteKind: mattes[kind] ? kind : null };
      const cut = await cutBottle(models, base, W, H, p.box, { shape: !noshape, select: v.includes('solo') ? 'matte' : 'sam' });
      const a8 = Buffer.alloc(cut.w * cut.h); for (let i = 0; i < a8.length; i++) a8[i] = cut.rgba[i * 4 + 3];
      const jpg = await onBeige({ sharp }, cut, { height: 1800 });
      row[v] = { ms: Date.now() - t, parts: cut.ms, tilt: +cut.tilt.toFixed(2), shaped: cut.shaped, srcH: cut.h, rough: roughness(a8, cut.w, cut.h) };
      fs.mkdirSync(path.join(outDir, 'full'), { recursive: true });
      fs.writeFileSync(path.join(outDir, 'full', `${p.f.replace(/\.jpg$/, '')}--${v}.jpg`), jpg);
      cols.push({ name: { sam: 'v2 · SAM only', u2net: 'v2 · U²-Net', isnet: 'v2 · IS-Net', birefnet: 'v2 · BiRefNet lite' }[kind] + (noshape ? ' (no shape)' : '') + (v.includes('solo') ? ' alone' : ''), img: await sharp(jpg).resize({ height: ROW_H }).toBuffer() });
    } catch (e) { row[v] = { error: e.message }; console.error(p.f, v, e.message); }
  }
  // One row: every column at ROW_H, labelled.
  const metas = await Promise.all(cols.map(async (c) => ({ ...c, w: (await sharp(c.img).metadata()).width })));
  const total = metas.reduce((s, c) => s + c.w + 16, 16);
  const comps = []; let x = 16;
  for (const c of metas) { comps.push({ input: c.img, left: x, top: 60 }, { input: label(c.name, c.w), left: x, top: 8 }); x += c.w + 16; }
  await sharp({ create: { width: total, height: ROW_H + 76, channels: 3, background: { r: 246, g: 242, b: 236 } } }).composite(comps).jpeg({ quality: 84 }).toFile(path.join(outDir, p.f));
  metrics.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
