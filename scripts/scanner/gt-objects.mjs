// The known outlines for scripts/scanner/edge-score.mjs (Nov 22): four real bottles cut out with BiRefNet lite (MIT; not
// one of the engines being scored, and too slow for the server), no bottle-shape step, saved as transparent PNGs.
//   node scripts/scanner/gt-objects.mjs <set.json> <photosDir> <modelsDir> <outDir> [photo prefixes, default 05,12,13,15]
import fs from 'node:fs';
import path from 'node:path';
const [setFile, photoDir, modelDir, outDir, pre = '05,12,13,15'] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const sharp = (await import('sharp')).default;
const ort = await import('onnxruntime-node');
const { cutBottle, png } = await import(path.join(root, 'server/cutout.mjs'));
const sam = { enc: await ort.InferenceSession.create(path.join(modelDir, 'mobile_sam_image_encoder.onnx')), dec: await ort.InferenceSession.create(path.join(modelDir, 'sam_mask_decoder_multi.onnx')) };
const matte = await ort.InferenceSession.create(path.join(modelDir, 'birefnet-lite.onnx'));
const set = JSON.parse(fs.readFileSync(setFile, 'utf8')).photos;
fs.mkdirSync(outDir, { recursive: true });
for (const p of pre.split(',').map((x) => set.find((s) => s.f.startsWith(x)))) {
  const base = await sharp(path.join(photoDir, p.f)).rotate().resize({ width: 2400, height: 2400, fit: 'inside' }).jpeg({ quality: 92 }).toBuffer();
  const { width: W, height: H } = await sharp(base).metadata();
  const cut = await cutBottle({ sharp, ort, sam, matte, matteKind: 'birefnet' }, base, W, H, p.box, { shape: false, work: 2400 });
  fs.writeFileSync(path.join(outDir, p.f.replace('.jpg', '.png')), await png({ sharp }, cut));
  console.log(p.f, cut.w, cut.h);
}
