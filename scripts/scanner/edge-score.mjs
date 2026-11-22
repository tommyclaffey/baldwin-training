// Scanner v2 edge score (Nov 22): real bottle cut-outs pasted onto real bar photos, so the true outline is known, then
// each engine cuts them out again. Score = mask IoU and boundary IoU (Cheng et al. 2021: only the band within d px of each
// outline counts, d = 1% of the bottle's height), at the photo's own pixels. Research only.
//   node scripts/scanner/edge-score.mjs <objectsDir (RGBA .png)> <backgroundsDir> <outDir> [--variants today,sam,u2net,isnet]
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const [objDir, bgDir, outDir] = args;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const modelDir = opt('--models', path.join(process.env.HOME, 'Coding/scanner-lab/models'));
process.env.DATA_DIR = path.dirname(modelDir);
const variants = opt('--variants', 'today,sam,u2net,isnet').split(',');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const sharp = (await import('sharp')).default;
const ort = await import('onnxruntime-node');
const { bottleMask } = await import(path.join(root, 'server/scanner.mjs'));
const { cutBottle } = await import(path.join(root, 'server/cutout.mjs'));
fs.mkdirSync(outDir, { recursive: true });
const so = { intraOpNumThreads: Number(opt('--threads', 2)) };
const sam = { enc: await ort.InferenceSession.create(path.join(modelDir, 'mobile_sam_image_encoder.onnx'), so), dec: await ort.InferenceSession.create(path.join(modelDir, 'sam_mask_decoder_multi.onnx'), so) };
const files = { u2net: 'u2net.onnx', isnet: 'isnet-general-use.onnx', birefnet: 'birefnet-lite.onnx' };
const mattes = {};
for (const v of variants) { const k = v.split('-')[0]; if (files[k] && !mattes[k]) mattes[k] = await ort.InferenceSession.create(path.join(modelDir, files[k]), so); }

/** Pixels of a 0/1 mask within d of its own outline (and inside it). Distance by repeated 3×3 erosion (city-block-ish). */
function band(m, w, h, d) {
  let cur = m.slice(); const out = new Uint8Array(w * h);
  for (let k = 0; k < d; k++) {
    const nx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!cur[i]) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !cur[i - 1] || !cur[i + 1] || !cur[i - w] || !cur[i + w];
      if (edge) out[i] = 1; else nx[i] = 1;
    }
    cur = nx;
  }
  return out;
}
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return u ? i / u : 1; };

const objs = fs.readdirSync(objDir).filter((f) => f.endsWith('.png')).sort();
const bgs = fs.readdirSync(bgDir).filter((f) => f.endsWith('.jpg')).sort();
const rows = [];
for (const o of objs) for (const b of bgs) {
  const bg = await sharp(path.join(bgDir, b)).rotate().resize({ width: 1500, height: 2000, fit: 'cover' }).removeAlpha().toBuffer();
  const W = 1500, H = 2000;
  const om = await sharp(path.join(objDir, o)).metadata();
  const oh = Math.round(H * 0.74), ow = Math.round(om.width * oh / om.height);
  const obj = await sharp(path.join(objDir, o)).resize(ow, oh).ensureAlpha().raw().toBuffer();
  const ox = Math.round((W - ow) / 2), oy = Math.round(H * 0.12);
  const photo = await sharp(bg).composite([{ input: obj, raw: { width: ow, height: oh, channels: 4 }, left: ox, top: oy }]).jpeg({ quality: 90 }).toBuffer();
  const gt = new Uint8Array(W * H);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) if (obj[(y * ow + x) * 4 + 3] >= 128) gt[(oy + y) * W + ox + x] = 1;
  // The guide as a manager would line it up: a little loose at the sides, the base just inside the bottom edge.
  const box = [(ox - ow * 0.08) / W, (oy - oh * 0.03) / H, (ox + ow * 1.08) / W, (oy + oh * 0.985) / H];
  const d = Math.max(2, Math.round(oh * 0.01));
  const gtBand = band(gt, W, H, d);
  const name = `${o.replace('.png', '')} on ${b.slice(6, 16)}`;
  fs.writeFileSync(path.join(outDir, `${o.replace('.png', '')}--${b.slice(6, 16)}.jpg`), photo);
  const row = { name };
  for (const v of variants) {
    const t = Date.now(); let pm;
    if (v === 'today') { const r = await bottleMask(photo, box); pm = new Uint8Array(W * H); for (let i = 0; i < pm.length; i++) pm[i] = r.mask[i] > 127 ? 1 : 0; }
    else {
      const k = v.split('-')[0];
      const cut = await cutBottle({ sharp, ort, sam, matte: mattes[k] || null, matteKind: mattes[k] ? k : null }, photo, W, H, box, { straighten: false, select: v.includes('solo') ? 'matte' : 'sam' });
      pm = new Uint8Array(W * H);
      const k2 = cut.at.scale, a8 = Buffer.alloc(cut.w * cut.h); for (let i = 0; i < a8.length; i++) a8[i] = cut.rgba[i * 4 + 3];
      const fw = Math.round(cut.w / k2), fh = Math.round(cut.h / k2);
      const up = await sharp(a8, { raw: { width: cut.w, height: cut.h, channels: 1 } }).resize(fw, fh).extractChannel(0).raw().toBuffer();
      const ox2 = Math.round(cut.at.x), oy2 = Math.round(cut.at.y);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { const X = ox2 + x, Y = oy2 + y; if (X >= 0 && Y >= 0 && X < W && Y < H && up[y * fw + x] >= 128) pm[Y * W + X] = 1; }
    }
    const ms = Date.now() - t;
    const pBand = band(pm, W, H, d);
    const bi = iou(gtBand.map((g, i) => g && gt[i]), pBand.map((p, i) => p && pm[i]));
    row[v] = { iou: +iou(gt, pm).toFixed(4), biou: +bi.toFixed(4), ms };
  }
  rows.push(row); console.log(JSON.stringify(row));
}
const mean = (v, k) => +(rows.reduce((s, r) => s + r[v][k], 0) / rows.length).toFixed(4);
const summary = Object.fromEntries(variants.map((v) => [v, { iou: mean(v, 'iou'), biou: mean(v, 'biou'), ms: Math.round(mean(v, 'ms')) }]));
fs.writeFileSync(path.join(outDir, 'edge-score.json'), JSON.stringify({ rows, summary }, null, 2));
console.log('SUMMARY', JSON.stringify(summary));
