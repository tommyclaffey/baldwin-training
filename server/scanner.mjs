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
async function prepare(buffer, { maxPixels } = {}) {
  const eng = await engine();
  const { sharp, ort } = libs;
  const input = maxPixels ? { limitInputPixels: maxPixels } : {};
  let base;
  try { base = await sharp(buffer, input).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer(); }
  catch (e) {
    if (/pixel limit/i.test(e.message)) { const err = new Error('That photo is too big. Take it again, or use a smaller one.'); err.status = 413; throw err; }
    if (/unsupported image format|Input buffer|corrupt|bad seek|VipsJpeg|heif/i.test(e.message)) { const err = new Error('That photo didn’t open. Try a JPG or PNG.'); err.status = 415; throw err; }
    throw e;
  }
  const { width: W, height: H } = await sharp(base).metadata();
  const portrait = H > W;
  // Portrait photos turn sideways, so the bottle gets the canvas's long side.
  const work = portrait ? await sharp(base).rotate(90).toBuffer() : base;
  const ww = portrait ? H : W, wh = portrait ? W : H;
  const s = Math.min(CW / ww, CH / wh), sw = Math.round(ww * s), sh = Math.round(wh * s);
  const small = await sharp(work).resize(sw, sh).removeAlpha().raw().toBuffer();
  let image_embeddings = null;
  if (!eng.stub) {
    const canvas = new Float32Array(CW * CH * 3);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw * 3; x++) canvas[y * CW * 3 + x] = small[y * sw * 3 + x];
    image_embeddings = (await eng.enc.run({ input_image: new ort.Tensor('float32', canvas, [CH, CW, 3]) })).image_embeddings;
  }
  return { at: Date.now(), base, W, H, portrait, ww, wh, s, sw, sh, emb: image_embeddings, small: eng.stub ? small : null };
}
export async function startScan(buffer, { owner = null, demo = false, maxPixels } = {}) {
  const sc = await prepare(buffer, { maxPixels });
  prune();
  const token = crypto.randomBytes(12).toString('hex');
  scans.set(token, { ...sc, owner, demo });
  return { token, width: sc.W, height: sc.H };
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

/** The bottle inside `box` ([x0, y0, x1, y1] as fractions of the photo): a W × H mask (0–255) at the photo's own size.
 *  `diff` (tests only, with the stub): the object is what inside the box differs from the box's edge colour, so each
 *  test photo gets its own outline (the Photo by Photo alignment is checked on real shapes). */
async function maskOf(sc, box, { diff = false } = {}) {
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
  // Tests only: what differs from the colour along the box's edge.
  const diffCut = () => {
    const px = sc.small, r = new Uint8Array(sw * sh), x0 = Math.max(0, b[0] | 0), y0 = Math.max(0, b[1] | 0), x1 = Math.min(sw - 1, Math.ceil(b[2])), y1 = Math.min(sh - 1, Math.ceil(b[3]));
    const ref = [0, 0, 0]; let n = 0;
    const add = (x, y) => { for (let c = 0; c < 3; c++) ref[c] += px[(y * sw + x) * 3 + c]; n++; };
    for (let x = x0; x <= x1; x++) { add(x, y0); add(x, y1); } for (let y = y0; y <= y1; y++) { add(x0, y); add(x1, y); }
    for (let c = 0; c < 3; c++) ref[c] /= n;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * sw + x) * 3; if (Math.abs(px[i] - ref[0]) + Math.abs(px[i + 1] - ref[1]) + Math.abs(px[i + 2] - ref[2]) > 60) r[y * sw + x] = 1; }
    return r;
  };
  const bestOf = (o) => { const iou = o.iou_predictions.data; let k = 0; for (let i = 1; i < o.masks.dims[1]; i++) if (iou[i] > iou[k]) k = i; return k; };
  let raw;
  if (eng.stub) raw = diff && sc.small ? diffCut() : stubCut();
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
  return mask;
}

/** Cut out the object inside `box` ([x0, y0, x1, y1] as fractions of the photo). Returns a JPEG. */
export async function cutScan(token, box, owner = null) {
  const sc = mine(token, owner);
  if (!sc) throw expired();
  sc.at = Date.now();
  const mask = await maskOf(sc, box);
  const { sharp } = libs;
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

/* ---- Photo by Photo (Nov 18, Figma 09 · Proposals → 34; Tommy: "i have to rotate take a photo rotate take a photo") ----
 * No turntable: the bottle is turned by hand, 30° at a time, and photographed 12 times. A hand-turned bottle moves, so
 * every photo gets its own cut-out (a model run each, about 0.65 s), never one shared outline. Then the 12 are lined
 * up the same way: scaled to one bottle height, centred on the body, base on one line, so the spin doesn't wobble.
 * One photo is cut at a time across the whole server (`inTurn`), so a few spins at once can't run the 314 MB server out of
 * memory; each prepared photo is dropped as soon as its cut-out is made. A set keeps only the small cut-outs. */
export const SPIN_PHOTOS = 12;
const OUT_H = 900; // saved frame height, like the turntable spin's frames
const sets = new Map(); // token → { owner, demo, at, cuts: [{ png, w, h, cx }], frames: [jpg] | null }
const MAX_SETS = 8;
const pruneSets = () => {
  const old = Date.now() - 30 * 60e3;
  for (const [k, v] of sets) if (v.at < old) sets.delete(k);
  for (const demoFirst of [true, false]) for (const [k, v] of sets) if (sets.size >= MAX_SETS && (!demoFirst || v.demo)) sets.delete(k);
};
const mySet = (token, owner) => { const st = sets.get(token); return st && st.owner === owner ? st : null; };
let queue = Promise.resolve();
/** Runs `fn` after every earlier photo has finished (one at a time, server-wide). */
const inTurn = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

/** One photo of the set: cut it out on its own and keep the cut-out (RGBA, cropped tight) at index `i`.
 *  A new set starts when `token` is empty or gone. Returns the token and a small preview on the beige. */
export function spinPhoto(token, i, buffer, box, { owner = null, demo = false, maxPixels, diff = false } = {}) {
  const idx = Number(i);
  if (!Number.isInteger(idx) || idx < 0 || idx >= SPIN_PHOTOS) { const e = new Error('That photo number isn’t right.'); e.status = 400; return Promise.reject(e); }
  return inTurn(async () => {
    let st = token ? mySet(token, owner) : null;
    if (token && !st) throw expired('Those photos have expired. Start the spin again.');
    const sc = await prepare(buffer, { maxPixels });
    const mask = await maskOf(sc, box, { diff });
    const { sharp } = libs;
    const { W, H } = sc;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { const e = new Error('We couldn’t find a bottle in that photo. Take it again with the bottle inside the guide.'); e.status = 422; throw e; }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    // The body's centre: the middle of the mask across the lower half of the bottle (a neck or a stray edge can lean).
    let sum = 0, n = 0;
    for (let y = y0 + Math.round(ch * 0.45); y <= y1 - Math.round(ch * 0.05); y++) for (let x = x0; x <= x1; x++) { const a = mask[y * W + x]; if (a > 127) { sum += x - x0; n++; } }
    const cx = n ? sum / n : cw / 2;
    // The photo's own pixels with the mask as alpha, cropped to the bottle. Re-encoded, so no camera metadata survives.
    const rgb = await sharp(sc.base).removeAlpha().extract({ left: x0, top: y0, width: cw, height: ch }).raw().toBuffer();
    const rgba = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const si = (y * cw + x) * 3, di = (y * cw + x) * 4;
      rgba[di] = rgb[si]; rgba[di + 1] = rgb[si + 1]; rgba[di + 2] = rgb[si + 2]; rgba[di + 3] = mask[(y0 + y) * W + x0 + x];
    }
    const k = Math.min(1, 1100 / ch);
    const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
    const png = await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } }).resize(w, h).png({ compressionLevel: 6 }).toBuffer();
    if (!st) {
      pruneSets();
      token = crypto.randomBytes(12).toString('hex');
      st = { owner, demo, at: Date.now(), cuts: Array(SPIN_PHOTOS).fill(null), frames: null };
      sets.set(token, st);
    }
    st.at = Date.now();
    st.cuts[idx] = { png, w, h, cx: cx * k };
    st.frames = null; // lined up again after any change
    const thumb = await onBeige(png, w, h, 260);
    return { token, i: idx, thumb, taken: st.cuts.filter(Boolean).length };
  });
}

/** A cut-out on the beige, `height` tall with a little room round it (the processing grid's previews). */
async function onBeige(png, w, h, height) {
  const { sharp } = libs;
  const bh = Math.round(height * 0.86), k = bh / h, bw = Math.max(1, Math.round(w * k));
  const cw = Math.max(bw + Math.round(height * 0.14), Math.round(height * 0.62));
  const img = await sharp(png).resize(bw, bh).toBuffer();
  return sharp({ create: { width: cw, height, channels: 3, background: { r: BEIGE[0], g: BEIGE[1], b: BEIGE[2] } } })
    .composite([{ input: img, left: Math.round((cw - bw) / 2), top: Math.round(height * 0.07) }]).jpeg({ quality: 80 }).toBuffer();
}

/** Line the 12 cut-outs up: the same bottle height, centred on the body, base on one line, all on one canvas size.
 *  Returns the 12 frames (JPEG on the beige), or null if a photo is missing. */
export function spinAlign(token, owner = null) {
  return inTurn(async () => {
    const st = mySet(token, owner);
    if (!st) throw expired('Those photos have expired. Start the spin again.');
    if (st.cuts.some((c) => !c)) return null;
    if (st.frames) return st.frames;
    await engine();
    const { sharp } = libs;
    const pad = Math.round(OUT_H * 0.05), bh = OUT_H - pad * 2;
    const placed = st.cuts.map((c) => { const k = bh / c.h; return { c, k, w: Math.max(1, Math.round(c.w * k)), cx: c.cx * k }; });
    // Wide enough for every frame's reach either side of its centre line, plus the same margin.
    const half = Math.ceil(Math.max(...placed.map((p) => Math.max(p.cx, p.w - p.cx))));
    const width = half * 2 + pad * 2;
    st.frames = [];
    for (const p of placed) {
      const img = await sharp(p.c.png).resize(p.w, bh).toBuffer();
      st.frames.push(await sharp({ create: { width, height: OUT_H, channels: 3, background: { r: BEIGE[0], g: BEIGE[1], b: BEIGE[2] } } })
        .composite([{ input: img, left: Math.round(width / 2 - p.cx), top: pad }]).jpeg({ quality: 86, mozjpeg: true }).toBuffer());
    }
    st.at = Date.now();
    return st.frames;
  });
}
/** One lined-up frame (for the review screen). */
export const spinAligned = (token, i, owner = null) => mySet(token, owner)?.frames?.[i] || null;
/** Done with a set (kept or started over). */
export const dropSpinSet = (token, owner = null) => { if (mySet(token, owner)) sets.delete(token); };
/** What a set holds (tests and the status line). */
export const spinSetInfo = (token, owner = null) => { const st = mySet(token, owner); return st && { taken: st.cuts.filter(Boolean).length, aligned: !!st.frames }; };
