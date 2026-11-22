// Scanner v2 bench (Nov 22): one engine set-up per process, so memory is that set-up's own.
//   node scripts/scanner/bench.mjs <photosDir> <set.json> <today|sam|u2net|isnet|birefnet> [--threads 2] [--n 4]
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const [photoDir, setFile, v] = args;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const modelDir = path.join(process.env.HOME, 'Coding/scanner-lab/models');
process.env.DATA_DIR = path.dirname(modelDir);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const sharp = (await import('sharp')).default;
const ort = await import('onnxruntime-node');
const rss0 = process.memoryUsage().rss;
const so = { intraOpNumThreads: Number(opt('--threads', 2)), ...(args.includes('--noarena') ? { enableCpuMemArena: false, enableMemPattern: false } : {}) };
const set = JSON.parse(fs.readFileSync(setFile, 'utf8')).photos.slice(0, Number(opt('--n', 4)));
const files = { u2net: 'u2net.onnx', isnet: 'isnet-general-use.onnx', birefnet: 'birefnet-lite.onnx' };
let run;
const tl = Date.now();
if (v === 'today') {
  const { bottleMask } = await import(path.join(root, 'server/scanner.mjs'));
  run = async (buf, box) => bottleMask(buf, box);
} else {
  const { cutBottle, onBeige } = await import(path.join(root, 'server/cutout.mjs'));
  const sam = { enc: await ort.InferenceSession.create(path.join(modelDir, 'mobile_sam_image_encoder.onnx'), so), dec: await ort.InferenceSession.create(path.join(modelDir, 'sam_mask_decoder_multi.onnx'), so) };
  const matte = files[v] ? await ort.InferenceSession.create(path.join(modelDir, files[v]), so) : null;
  run = async (buf, box) => {
    const base = await sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    const { width: W, height: H } = await sharp(base).metadata();
    const cut = await cutBottle({ sharp, ort, sam, matte, matteKind: matte ? v : null }, base, W, H, box);
    await onBeige({ sharp }, cut);
  };
}
const load = Date.now() - tl, rssLoaded = process.memoryUsage().rss;
const times = [];
const rssAfter = [];
for (const p of set) { const buf = fs.readFileSync(path.join(photoDir, p.f)); const t = Date.now(); await run(buf, p.box); times.push(Date.now() - t); rssAfter.push(Math.round(process.memoryUsage().rss / 1e6)); }
const ru = process.resourceUsage();
console.log(JSON.stringify({ v, threads: so.intraOpNumThreads, loadMs: load, firstMs: times[0], meanMsAfterFirst: Math.round(times.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, times.length - 1)), rssStartMB: Math.round(rss0 / 1e6), rssLoadedMB: Math.round(rssLoaded / 1e6), peakRssMB: Math.round(ru.maxRSS / 1e3), rssAfterEachMB: rssAfter, noArena: args.includes('--noarena') }));
