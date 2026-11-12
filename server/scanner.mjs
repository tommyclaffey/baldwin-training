// Bottle scanner: a photo in, just the bottle out, on the Wine Book's beige.
// MobileSAM (MIT; ONNX export by Acly on Hugging Face) finds the object inside the box the manager drew.
// 1. start(photo)      → prepares the photo (orientation, encoder) and remembers it for 20 minutes
// 2. cut(token, box)   → the bottle inside `box` (fractions of the photo), as a JPEG preview
// 3. the admin keeps the cut it likes; it becomes a media file like any upload
// Each prepared photo belongs to the person who sent it (`owner`): nobody else's token works on it.
// Demos (Nov 12) use the same engine with smaller limits (see server/index.mjs); their photos go first when memory is full.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './db.mjs';

const REV = '0d3b403339b4674a82493d5e97964dd78089ddc8'; // pinned Hugging Face revision
const MODELS = {
  encoder: { file: 'mobile_sam_image_encoder.onnx', sha256: '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749' },
  decoder: { file: 'sam_mask_decoder_multi.onnx', sha256: '8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe' },
};
const MODEL_DIR = path.join(DATA_DIR, 'models');
const BEIGE = [231, 222, 207]; // the Wine Book's bottle panel
const CW = 1024, CH = 684; // this export expects a landscape 1024 × 684 canvas, photo scaled in from the top-left

// Tests only (SCANNER_STUB=1): no model download; the "cut" is the box itself. Everything around it (limits, saving,
// cleanup, the beige composite) runs for real.
const STUB = process.env.SCANNER_STUB === '1';
const DOWNLOAD_MS = 3 * 60e3; // a model download that stalls gives up, so a scan can't hang forever on a fresh volume

let libs, sessions, loading;
async function load() {
  if (sessions) return sessions;
  loading ??= (async () => {
    if (STUB) { libs = { sharp: (await import('sharp')).default }; sessions = { stub: true }; return sessions; }
    libs = { ort: await import('onnxruntime-node'), sharp: (await import('sharp')).default };
    fs.mkdirSync(MODEL_DIR, { recursive: true });
    for (const m of Object.values(MODELS)) {
      const dest = path.join(MODEL_DIR, m.file);
      if (!fs.existsSync(dest)) {
        const res = await fetch(`https://huggingface.co/Acly/MobileSAM/resolve/${REV}/${m.file}`, { signal: AbortSignal.timeout(DOWNLOAD_MS) });
        if (!res.ok) throw new Error(`Model download failed (${res.status})`);
        const buf = Buffer.from(await res.arrayBuffer());
        const sum = crypto.createHash('sha256').update(buf).digest('hex');
        if (sum !== m.sha256) throw new Error('Model download didn’t match its checksum');
        fs.writeFileSync(dest + '.part', buf); fs.renameSync(dest + '.part', dest);
      }
    }
    const opt = { intraOpNumThreads: 2 };
    sessions = {
      enc: await libs.ort.InferenceSession.create(path.join(MODEL_DIR, MODELS.encoder.file), opt),
      dec: await libs.ort.InferenceSession.create(path.join(MODEL_DIR, MODELS.decoder.file), opt),
    };
    return sessions;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
/** The engine, or a plain "not ready yet" (503) if the models couldn't be fetched or opened. */
async function engine() {
  try { return await load(); }
  catch (e) { console.error('Bottle scanner not ready:', e.message); const err = new Error('The scanner is still getting ready. Try again in a minute.'); err.status = 503; throw err; }
}
/** Warm up in the background so the first scan isn't slow. */
export const warmScanner = () => load().catch(() => { /* retried on first scan */ });
/** At startup: get the models ready in the background and say how it went. */
export function warmOnStart() {
  const t = Date.now();
  setTimeout(() => load()
    .then(() => console.log(`Bottle scanner ready in ${Date.now() - t} ms · memory ${Math.round(process.memoryUsage().rss / 1e6)} MB`))
    .catch((e) => console.error('Bottle scanner not ready:', e.message)), 3000).unref();
}

const scans = new Map(); // token → prepared photo
const MAX_KEPT = 12;
/** Old photos go after 20 minutes; past 12 in memory, demo photos go first, then the oldest. */
const prune = () => {
  const old = Date.now() - 20 * 60e3;
  for (const [k, v] of scans) if (v.at < old) scans.delete(k);
  for (const demoFirst of [true, false]) for (const [k, v] of scans) if (scans.size >= MAX_KEPT && (!demoFirst || v.demo)) scans.delete(k);
};
/** A prepared photo, only for the person who sent it. */
const mine = (token, owner) => { const sc = scans.get(token); return sc && sc.owner === owner ? sc : null; };
const expired = (msg = 'That photo has expired. Take it again.') => { const e = new Error(msg); e.status = 410; return e; };

/** Prepare a photo: upright, at most 2400 px tall, encoded once so each new box is quick.
 *  `maxPixels` (demos): a bigger photo is refused before it's decoded. */
export async function startScan(buffer, { owner = null, demo = false, maxPixels } = {}) {
  const eng = await engine();
  const { sharp, ort } = libs;
  const input = maxPixels ? { limitInputPixels: maxPixels } : {};
  let base;
  try { base = await sharp(buffer, input).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer(); }
  catch (e) { if (/pixel limit/i.test(e.message)) { const err = new Error('That photo is too big. Take it again, or use a smaller one.'); err.status = 413; throw err; } throw e; }
  const { width: W, height: H } = await sharp(base).metadata();
  const portrait = H > W;
  // Portrait photos turn sideways, so the bottle gets the canvas's long side.
  const work = portrait ? await sharp(base).rotate(90).toBuffer() : base;
  const ww = portrait ? H : W, wh = portrait ? W : H;
  const s = Math.min(CW / ww, CH / wh), sw = Math.round(ww * s), sh = Math.round(wh * s);
  const small = await sharp(work).resize(sw, sh).removeAlpha().raw().toBuffer();
  const canvas = new Float32Array(CW * CH * 3);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw * 3; x++) canvas[y * CW * 3 + x] = small[y * sw * 3 + x];
  const image_embeddings = eng.stub ? null : (await eng.enc.run({ input_image: new ort.Tensor('float32', canvas, [CH, CW, 3]) })).image_embeddings;
  prune();
  const token = crypto.randomBytes(12).toString('hex');
  scans.set(token, { at: Date.now(), owner, demo, base, W, H, portrait, ww, wh, s, sw, sh, emb: image_embeddings });
  return { token, width: W, height: H };
}

const flood = (grid, w, h, seeds, val) => {
  const seen = new Uint8Array(w * h); const st = [];
  for (const p of seeds) if (!seen[p] && grid[p] === val) { seen[p] = 1; st.push(p); }
  while (st.length) {
    const p = st.pop(); const x = p % w, y = (p / w) | 0;
    if (x > 0 && !seen[p - 1] && grid[p - 1] === val) { seen[p - 1] = 1; st.push(p - 1); }
    if (x < w - 1 && !seen[p + 1] && grid[p + 1] === val) { seen[p + 1] = 1; st.push(p + 1); }
    if (y > 0 && !seen[p - w] && grid[p - w] === val) { seen[p - w] = 1; st.push(p - w); }
    if (y < h - 1 && !seen[p + w] && grid[p + w] === val) { seen[p + w] = 1; st.push(p + w); }
  }
  return seen;
};

/** Cut out the object inside `box` ([x0, y0, x1, y1] as fractions of the photo). Returns a JPEG. */
export async function cutScan(token, box, owner = null) {
  const sc = mine(token, owner);
  if (!sc) throw expired();
  sc.at = Date.now();
  const eng = await engine();
  const { dec } = eng;
  const { sharp, ort } = libs;
  const { W, H, portrait, ww, wh, s, sw, sh } = sc;
  const [fx0, fy0, fx1, fy1] = box.map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
  const pts = [[fx0 * W, fy0 * H], [fx1 * W, fy1 * H]].map(([x, y]) => (portrait ? [H - y, x] : [x, y])).map(([x, y]) => [x * s, y * s]);
  const b = [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
  // The box, plus "this one" at its centre (the bottle sits in the middle of the guide).
  const prompt = (maskIn) => dec.run({
    image_embeddings: sc.emb,
    point_coords: new ort.Tensor('float32', Float32Array.from([b[0], b[1], b[2], b[3], (b[0] + b[2]) / 2, (b[1] + b[3]) / 2]), [1, 3, 2]),
    point_labels: new ort.Tensor('float32', Float32Array.from([2, 3, 1]), [1, 3]),
    mask_input: new ort.Tensor('float32', maskIn || new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor('float32', Float32Array.from([maskIn ? 1 : 0]), [1]),
    orig_im_size: new ort.Tensor('float32', Float32Array.from([CH, CW]), [2]),
  });
  // Tests only: the object is the box.
  const stubCut = () => { const r = new Uint8Array(sw * sh); for (let y = Math.max(0, b[1] | 0); y < Math.min(sh, Math.ceil(b[3])); y++) for (let x = Math.max(0, b[0] | 0); x < Math.min(sw, Math.ceil(b[2])); x++) r[y * sw + x] = 1; return r; };
  const bestOf = (o) => { const iou = o.iou_predictions.data; let k = 0; for (let i = 1; i < o.masks.dims[1]; i++) if (iou[i] > iou[k]) k = i; return k; };
  let raw;
  if (eng.stub) raw = stubCut();
  else {
    let out = await prompt();
    // A second pass, fed the first answer, tidies the edges and drops stray bits.
    const k0 = bestOf(out);
    out = await prompt(Float32Array.from(out.low_res_masks.data.subarray(k0 * 256 * 256, (k0 + 1) * 256 * 256)));
    const k = bestOf(out);
    const L = out.masks.data.subarray(k * CW * CH, (k + 1) * CW * CH);
    // Clean up: the piece under the box centre, with any holes inside its outline filled (labels, reflections).
    raw = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) raw[y * sw + x] = L[y * CW + x] > 0 ? 1 : 0;
  }
  // Open (shrink then grow) by a few pixels so thin bridges to a neighbouring bottle break.
  const R = Math.max(2, Math.round(Math.min(sw, sh) / 220));
  const morph = (src, grow) => { const o = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let v = grow ? 0 : 1;
      for (let d = -R; d <= R && v === (grow ? 0 : 1); d++) { const xx = x + d; if (xx < 0 || xx >= sw) { if (!grow) v = 0; continue; } if (src[y * sw + xx] === (grow ? 1 : 0)) v = grow ? 1 : 0; }
      o[y * sw + x] = v; }
    const o2 = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let v = grow ? 0 : 1;
      for (let d = -R; d <= R && v === (grow ? 0 : 1); d++) { const yy = y + d; if (yy < 0 || yy >= sh) { if (!grow) v = 0; continue; } if (o[yy * sw + x] === (grow ? 1 : 0)) v = grow ? 1 : 0; }
      o2[y * sw + x] = v; }
    return o2; };
  const opened = morph(morph(raw, false), true);
  const bin = opened;
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  let seed = -1, best = Infinity;
  for (let y = Math.max(0, b[1] | 0); y < Math.min(sh, Math.ceil(b[3])); y++) for (let x = Math.max(0, b[0] | 0); x < Math.min(sw, Math.ceil(b[2])); x++) {
    if (!bin[y * sw + x]) continue; const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < best) { best = d; seed = y * sw + x; }
  }
  if (seed < 0) { const e = new Error('We couldn’t find a bottle in that box. Move the box over the bottle and try again.'); e.status = 422; throw e; }
  const piece = flood(bin, sw, sh, [seed], 1);
  const near = morph(piece, true);
  const keep = new Uint8Array(sw * sh); for (let i = 0; i < sw * sh; i++) keep[i] = raw[i] && near[i] ? 1 : 0;
  const edge = []; for (let x = 0; x < sw; x++) edge.push(x, (sh - 1) * sw + x); for (let y = 0; y < sh; y++) edge.push(y * sw, y * sw + sw - 1);
  const outside = flood(keep, sw, sh, edge, 0);
  const m8 = Buffer.alloc(sw * sh); for (let i = 0; i < sw * sh; i++) m8[i] = outside[i] ? 0 : 255;
  // Smooth edge, at the photo's own size and orientation.
  let mask = await sharp(m8, { raw: { width: sw, height: sh, channels: 1 } }).blur(0.7).resize(ww, wh, { kernel: 'cubic' }).extractChannel(0).raw().toBuffer();
  if (portrait) mask = await sharp(mask, { raw: { width: ww, height: wh, channels: 1 } }).rotate(-90).extractChannel(0).raw().toBuffer();
  sc.mask = mask; sc.crop = null; // a new box, a new crop
  const jpg = await compose(sc, await sharp(sc.base).removeAlpha().raw().toBuffer(), 1400);
  sc.result = jpg;
  return jpg;
}

/** The bottle on the beige, tightly cropped: the photo's pixels where the mask is, beige elsewhere. */
async function compose(sc, rgb, height) {
  const { sharp } = libs;
  const { W, H, mask } = sc;
  if (!sc.crop) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    sc.crop = { x0, y0, x1, y1, pad: Math.round((y1 - y0 + 1) * 0.05) };
  }
  const { x0, y0, x1, y1, pad } = sc.crop;
  const cw = x1 - x0 + 1 + pad * 2, ch = y1 - y0 + 1 + pad * 2;
  const o = Buffer.alloc(cw * ch * 3);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sx = x0 - pad + x, sy = y0 - pad + y;
    const a = sx >= 0 && sy >= 0 && sx < W && sy < H ? mask[sy * W + sx] / 255 : 0;
    const si = (sy * W + sx) * 3, di = (y * cw + x) * 3;
    for (let c = 0; c < 3; c++) o[di + c] = Math.round((a ? rgb[si + c] : 0) * a + BEIGE[c] * (1 - a));
  }
  return sharp(o, { raw: { width: cw, height: ch, channels: 3 } }).resize({ height, withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

/* ---- Spin scan (Oct 31, Tommy: "a 3D digital scanner for the wine bottles") ----
 * A bottle turning on a lazy Susan keeps the same outline, so the cut from the first frame (cutScan) is reused for every
 * other frame: no model run per frame. The frames play back as a drag-to-spin bottle. */
export async function spinFrame(token, buffer, owner = null, { maxPixels } = {}) {
  const sc = mine(token, owner);
  if (!sc || !sc.mask) throw expired('Cut out the first frame first.');
  sc.at = Date.now();
  await engine();
  const { sharp } = libs;
  const rgb = await sharp(buffer, maxPixels ? { limitInputPixels: maxPixels } : {}).rotate().resize(sc.W, sc.H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  sc.spin = sc.spin || [];
  if (sc.spin.length >= 48) { const e = new Error('That’s enough frames.'); e.status = 400; throw e; }
  sc.spin.push(await compose(sc, rgb, 900));
  return sc.spin.length;
}
/** The first cut plus every spin frame, ready to keep. */
export async function spinFrames(token, owner = null) {
  const sc = mine(token, owner);
  if (!sc?.result || !sc.spin?.length) return null;
  const first = await libs.sharp(sc.result).resize({ height: 900, withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return [first, ...sc.spin];
}

/** The last cut for this photo (to keep it). */
export const lastCut = (token, owner = null) => mine(token, owner)?.result || null;
