// Bottle cut-out, v2 (Nov 22; Tommy, Nov 20: "It's very sloppy … make it more robust? This is probably one of the best
// features of the app"). Pure image work: the caller loads the models and hands them in (server/scanner.mjs).
//
// Why v1 looked sloppy (diagnosed Nov 22 on Tommy's Cappone scan):
//  · stair-stepped edges: MobileSAM's mask is 256 × 256 for the whole photo, so one mask pixel was ~10 photo pixels; the
//    yes/no mask was then blown up to 1400 px with a 0.7 px blur.
//  · flat base / bitten label: the box went to the model exactly as drawn, so anything outside the guide (the base, the
//    cap) was cut off; a white label on a light wall read as background.
//  · pale halo: edge pixels kept the old background's colour.
//  · tilt, low resolution: nothing straightened the bottle; output stopped at the photo's own pixels (441 × 1400).
//
// v2, in order:
//  1. The box is padded (the base and cap are never clipped) and the photo is cropped to it, so every model works at the
//     bottle's own scale.
//  2. MobileSAM, prompted with the box and its centre, picks WHICH object is the bottle (a glass beside it is left out).
//  3. A cut-out model made for product photos (BiRefNet lite, MIT) draws the edge at 1024 × 1024 on the crop: 2–3 photo
//     pixels per mask pixel instead of ~10. Only the part that SAM chose is kept.
//  4. A guided filter on the full-resolution crop snaps the edge to the photo's real edge.
//  5. Bottle shape: bottles are symmetric about their axis. The axis is found, the bottle straightened, and each row's
//     half-width is checked against its mirror. A bite on one side (a white label against a white wall) is filled from
//     the other side; jaggies are smoothed down the height. Only when the outline is clearly a bottle; never more than a
//     quarter of the width is borrowed from the other side.
//  6. Edge colours come from inside the bottle, not the old background (no halo).
//  7. Out: an RGBA cut-out, straightened, cropped to the bottle. onBeige() puts it on the Wine Book beige at a fixed size
//     with the base on one line and a soft contact shadow; png() keeps the transparent master.

/* ---------------------------------- small helpers ---------------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Box mean filter (radius r) of a Float32 image, separable running sums. Edges use the pixels that exist. */
function boxMean(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0, n = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) { s += src[o + x]; n++; }
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / n;
      const add = x + r + 1, sub = x - r;
      if (add < w) { s += src[o + add]; n++; }
      if (sub >= 0) { s -= src[o + sub]; n--; }
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) { s += tmp[y * w + x]; n++; }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      const add = y + r + 1, sub = y - r;
      if (add < h) { s += tmp[add * w + x]; n++; }
      if (sub >= 0) { s -= tmp[sub * w + x]; n--; }
    }
  }
  return out;
}

/** Guided filter (He et al.): `p` (0–1) follows the edges of the grey guide `I` (0–1). */
function guided(I, p, w, h, r, eps) {
  const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i]; a[i] = (mIp[i] - mI[i] * mp[i]) / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = clamp(ma[i] * I[i] + mb[i], 0, 1);
  return q;
}

/** 4-connected flood fill over cells equal to `val`, from `seeds`. */
function flood(grid, w, h, seeds, val) {
  const seen = new Uint8Array(w * h), st = [];
  for (const p of seeds) if (!seen[p] && grid[p] === val) { seen[p] = 1; st.push(p); }
  while (st.length) {
    const p = st.pop(), x = p % w;
    if (x > 0 && !seen[p - 1] && grid[p - 1] === val) { seen[p - 1] = 1; st.push(p - 1); }
    if (x < w - 1 && !seen[p + 1] && grid[p + 1] === val) { seen[p + 1] = 1; st.push(p + 1); }
    if (p >= w && !seen[p - w] && grid[p - w] === val) { seen[p - w] = 1; st.push(p - w); }
    if (p < w * (h - 1) && !seen[p + w] && grid[p + w] === val) { seen[p + w] = 1; st.push(p + w); }
  }
  return seen;
}

/** Grow (or shrink) a 0/1 mask by a square of radius r. */
function morph(src, w, h, r, grow) {
  if (r <= 0) return src;
  const m = new Float32Array(w * h); for (let i = 0; i < m.length; i++) m[i] = src[i];
  const avg = boxMean(m, w, h, r), out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = grow ? (avg[i] > 1e-6 ? 1 : 0) : (avg[i] > 1 - 1e-6 ? 1 : 0);
  return out;
}

/** Sliding median of a 1-D array (NaN = no value), window ±k. */
function median1(a, k, minShare = 0) {
  const out = new Float64Array(a.length).fill(NaN);
  for (let i = 0; i < a.length; i++) {
    const v = [];
    for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) if (!Number.isNaN(a[j])) v.push(a[j]);
    if (v.length && v.length >= minShare * (2 * k + 1)) { v.sort((x, y) => x - y); out[i] = v[v.length >> 1]; }
  }
  return out;
}

/* ---------------------------------- the models ---------------------------------- */
const SAM_W = 1024, SAM_H = 684;
export const WORK = 1700; // longest side of the crop the cut is worked out on // this MobileSAM export expects a landscape 1024 × 684 canvas, photo scaled in from the top-left

/** MobileSAM's answer for the box: a 0–1 map at the crop's size (soft, from the decoder's logits). */
async function samMask({ sharp, ort, sam }, rgbCrop, cw, ch, box) {
  // Portrait crops turn sideways so the bottle gets the canvas's long side.
  const portrait = ch > cw;
  const ww = portrait ? ch : cw, wh = portrait ? cw : ch;
  const s = Math.min(SAM_W / ww, SAM_H / wh), sw = Math.round(ww * s), sh = Math.round(wh * s);
  // Turned in its own step: sharp resizes before it rotates when both are chained.
  const turned = portrait ? await sharp(rgbCrop, { raw: { width: cw, height: ch, channels: 3 } }).rotate(90).raw().toBuffer() : rgbCrop;
  const small = await sharp(turned, { raw: { width: ww, height: wh, channels: 3 } }).resize(sw, sh).raw().toBuffer();
  const canvas = new Float32Array(SAM_W * SAM_H * 3);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw * 3; x++) canvas[y * SAM_W * 3 + x] = small[y * sw * 3 + x];
  const emb = (await sam.enc.run({ input_image: new ort.Tensor('float32', canvas, [SAM_H, SAM_W, 3]) })).image_embeddings;
  const toCanvas = ([x, y]) => (portrait ? [ch - y, x] : [x, y]).map((v) => v * s);
  const a = toCanvas([box[0], box[1]]), b = toCanvas([box[2], box[3]]);
  const bx = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  // The box, plus "this one" down the middle of the guide (where a bottle stood up in the guide always is).
  const pts = [bx[0], bx[1], bx[2], bx[3]], labels = [2, 3];
  for (const f of [0.5, 0.35, 0.7]) { const p = toCanvas([(box[0] + box[2]) / 2, box[1] + (box[3] - box[1]) * f]); pts.push(p[0], p[1]); labels.push(1); }
  const run = (maskIn) => sam.dec.run({
    image_embeddings: emb,
    point_coords: new ort.Tensor('float32', Float32Array.from(pts), [1, pts.length / 2, 2]),
    point_labels: new ort.Tensor('float32', Float32Array.from(labels), [1, labels.length]),
    mask_input: new ort.Tensor('float32', maskIn || new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor('float32', Float32Array.from([maskIn ? 1 : 0]), [1]),
    orig_im_size: new ort.Tensor('float32', Float32Array.from([SAM_H, SAM_W]), [2]),
  });
  const best = (o) => { const iou = o.iou_predictions.data; let k = 0; for (let i = 1; i < o.masks.dims[1]; i++) if (iou[i] > iou[k]) k = i; return k; };
  let out = await run();
  const k0 = best(out);
  out = await run(Float32Array.from(out.low_res_masks.data.subarray(k0 * 65536, (k0 + 1) * 65536)));
  const k = best(out);
  const L = out.masks.data.subarray(k * SAM_W * SAM_H, (k + 1) * SAM_W * SAM_H);
  // Logits → 0–255 on the canvas, then back to the crop's own size and orientation.
  const m8 = Buffer.alloc(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) m8[y * sw + x] = Math.round(255 / (1 + Math.exp(-L[y * SAM_W + x])));
  let back = sharp(m8, { raw: { width: sw, height: sh, channels: 1 } }).resize(ww, wh, { kernel: 'cubic' });
  if (portrait) back = sharp(await back.extractChannel(0).raw().toBuffer(), { raw: { width: ww, height: wh, channels: 1 } }).rotate(-90);
  const buf = await back.extractChannel(0).raw().toBuffer();
  const f = new Float32Array(cw * ch); for (let i = 0; i < f.length; i++) f[i] = buf[i] / 255;
  return f;
}

/** How each cut-out model wants its input (rembg's settings for the same ONNX files). */
export const MATTES = {
  birefnet: { size: 1024, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 'fixed', sigmoid: true },
  isnet: { size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1], scale: 'fixed', sigmoid: false },
  u2net: { size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 'max', sigmoid: false },
};
/** The cut-out model's 0–1 map at the crop's size. */
async function matteMask({ sharp, ort, matte, matteKind }, rgbCrop, cw, ch) {
  const cfg = MATTES[matteKind];
  const S = cfg.size;
  const px = await sharp(rgbCrop, { raw: { width: cw, height: ch, channels: 3 } }).resize(S, S, { fit: 'fill' }).raw().toBuffer();
  let mx = 255; if (cfg.scale === 'max') { mx = 1; for (const v of px) if (v > mx) mx = v; }
  const t = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) t[c * S * S + i] = (px[i * 3 + c] / mx - cfg.mean[c]) / cfg.std[c];
  const out = await matte.run({ [matte.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, S, S]) });
  const d = out[matte.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  const v = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) { v[i] = cfg.sigmoid ? 1 / (1 + Math.exp(-d[i])) : d[i]; if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; }
  const m8 = Buffer.alloc(S * S); for (let i = 0; i < S * S; i++) m8[i] = Math.round(255 * clamp((v[i] - lo) / (hi - lo || 1), 0, 1));
  const buf = await sharp(m8, { raw: { width: S, height: S, channels: 1 } }).resize(cw, ch, { fit: 'fill', kernel: 'cubic' }).extractChannel(0).raw().toBuffer();
  const f = new Float32Array(cw * ch); for (let i = 0; i < f.length; i++) f[i] = buf[i] / 255;
  return f;
}

/* ---------------------------------- bottle shape ---------------------------------- */
/** Each row's left and right edge (where alpha crosses 0.5, to a fraction of a pixel). With `reach` (px), the outermost
 *  crossing within `reach` of the axis on each side, so a gap inside the row (dark glass the model half-missed) doesn't
 *  hide the true edge; without it, the run that holds the axis. */
function rowEdges(a, w, h, axisX, reach = 0) {
  const L = new Float64Array(h).fill(NaN), R = new Float64Array(h).fill(NaN);
  const crossL = (o, l) => { const fl = l > 0 ? a[o + l - 1] : 0; return l - 1 + (0.5 - fl) / Math.max(1e-3, a[o + l] - fl); };
  const crossR = (o, r) => { const fr = r < w - 1 ? a[o + r + 1] : 0; return r + (a[o + r] - 0.5) / Math.max(1e-3, a[o + r] - fr); };
  for (let y = 0; y < h; y++) {
    const o = y * w, ax = typeof axisX === 'number' ? axisX : axisX[y];
    if (reach) {
      const lo = Math.max(0, Math.floor(ax - reach)), hi = Math.min(w - 1, Math.ceil(ax + reach)), c = clamp(Math.round(ax), 0, w - 1);
      let l = -1, r = -1;
      for (let x = lo; x <= c; x++) if (a[o + x] >= 0.5) { l = x; break; }
      for (let x = hi; x >= c; x--) if (a[o + x] >= 0.5) { r = x; break; }
      if (l < 0 && r < 0) continue;
      if (l >= 0) L[y] = crossL(o, l);
      if (r >= 0) R[y] = crossR(o, r);
      continue;
    }
    let c = clamp(Math.round(ax), 0, w - 1);
    if (a[o + c] < 0.5) { // the axis misses this row (e.g. a thin neck off-centre): nearest inside pixel within 8%
      let found = -1; for (let d = 1; d < w * 0.08 && found < 0; d++) { if (c - d >= 0 && a[o + c - d] >= 0.5) found = c - d; else if (c + d < w && a[o + c + d] >= 0.5) found = c + d; }
      if (found < 0) continue; c = found;
    }
    let l = c; while (l > 0 && a[o + l - 1] >= 0.5) l--;
    let r = c; while (r < w - 1 && a[o + r + 1] >= 0.5) r++;
    L[y] = crossL(o, l); R[y] = crossR(o, r);
  }
  return { L, R };
}
/** The bottle's axis as x = m·y + k, fitted on the body rows (the widest part), outliers dropped once. */
function fitAxis(L, R, share = 0.6) {
  const h = L.length, wd = [];
  for (let y = 0; y < h; y++) if (!Number.isNaN(L[y])) wd.push(R[y] - L[y]);
  if (wd.length < 20) return null;
  const maxW = [...wd].sort((p, q) => p - q)[Math.floor(wd.length * 0.95)];
  let rows = [];
  // The body's rows (over 60% of the widest), the whole height of the body so the slope is well measured; rows a bite or a
  // glass pushes off centre are dropped twice over (the 30% furthest from the line, then again).
  for (let y = 0; y < h; y++) if (!Number.isNaN(L[y]) && R[y] - L[y] > share * maxW) rows.push(y);
  if (rows.length < 10) return null;
  const fit = (ys) => { let sy = 0, sc = 0, syy = 0, syc = 0; for (const y of ys) { const c = (L[y] + R[y]) / 2; sy += y; sc += c; syy += y * y; syc += y * c; } const n = ys.length, d = n * syy - sy * sy; const m = d ? (n * syc - sy * sc) / d : 0; return { m, k: (sc - m * sy) / n }; };
  let f = fit(rows);
  for (let pass = 0; pass < 2; pass++) {
    const res = rows.map((y) => Math.abs((L[y] + R[y]) / 2 - (f.m * y + f.k)));
    const cut = [...res].sort((p, q) => p - q)[Math.floor(res.length * 0.7)] + 0.5;
    const keep = rows.filter((_, i) => res[i] <= cut);
    if (keep.length < 10) break;
    rows = keep; f = fit(rows);
  }
  return { ...f, maxW };
}

/** Rebuild the outline as a symmetric bottle when it clearly is one. Returns the new alpha, or null (left as it was). */
/** The bottle's axis: fitted on the whole body, or on its widest rows only (when a glass or a hand covers part of the
 *  body, those rows pull the line), whichever leaves more rows mirroring each other. */
function bestAxis(a, w, h) {
  const first = rowEdges(a, w, h, w / 2);
  let best = null, bestN = -1;
  for (const share of [0.6, 0.9]) {
    const ax = fitAxis(first.L, first.R, share);
    if (!ax) continue;
    const at = new Float64Array(h); for (let y = 0; y < h; y++) at[y] = ax.m * y + ax.k;
    const { L, R } = rowEdges(a, w, h, at, ax.maxW * 0.75);
    let n = 0; const tol = Math.max(1.5, ax.maxW * 0.02);
    for (let y = 0; y < h; y++) if (!Number.isNaN(L[y]) && !Number.isNaN(R[y]) && Math.abs((at[y] - L[y]) - (R[y] - at[y])) <= tol) n++;
    if (n > bestN) { best = ax; bestN = n; }
  }
  return best;
}
function bottleShape(a, w, h) {
  const ax = bestAxis(a, w, h);
  if (!ax) return null;
  const axisAt = new Float64Array(h); for (let y = 0; y < h; y++) axisAt[y] = ax.m * y + ax.k;
  let { L, R } = rowEdges(a, w, h, axisAt, ax.maxW * 0.75);
  // The neck and cap can sit a little off the body's line (a lean, the camera's angle): where the bottle is narrow
  // (under 60% of the body), the axis follows that row's own middle, smoothed down the height.
  {
    const mids = new Float64Array(h).fill(NaN);
    for (let y = 0; y < h; y++) if (!Number.isNaN(L[y]) && !Number.isNaN(R[y]) && R[y] - L[y] < ax.maxW * 0.6) mids[y] = (L[y] + R[y]) / 2;
    const sm = median1(mids, Math.max(3, Math.round(h * 0.01)));
    let moved = false;
    for (let y = 0; y < h; y++) if (!Number.isNaN(sm[y]) && Math.abs(sm[y] - axisAt[y]) < ax.maxW * 0.15) { axisAt[y] = sm[y]; moved = true; }
    if (moved) ({ L, R } = rowEdges(a, w, h, axisAt, ax.maxW * 0.75));
  }
  let top = -1, bot = -1; for (let y = 0; y < h; y++) if (!Number.isNaN(L[y]) || !Number.isNaN(R[y])) { if (top < 0) top = y; bot = y; }
  if (top < 0) return null;
  const H = bot - top + 1, maxW = ax.maxW;
  if (H / maxW < 1.25) return null; // not bottle-shaped (lying down, or two bottles)
  // Half-widths each side, and how well they agree.
  const hl = new Float64Array(h).fill(NaN), hr = new Float64Array(h).fill(NaN), agree = new Float64Array(h).fill(NaN);
  let rowsN = 0, sym = 0;
  const tol = Math.max(1.5, maxW * 0.02);
  for (let y = top; y <= bot; y++) {
    if (Number.isNaN(L[y]) && Number.isNaN(R[y])) continue;
    hl[y] = Number.isNaN(L[y]) ? 0 : axisAt[y] - L[y]; hr[y] = Number.isNaN(R[y]) ? 0 : R[y] - axisAt[y];
    rowsN++;
    if (Math.abs(hl[y] - hr[y]) <= tol) { sym++; agree[y] = (hl[y] + hr[y]) / 2; }
  }
  if (rowsN < 20 || sym / rowsN < 0.2) return null; // hardly any row mirrors: not a bottle standing up (leave the photo's outline)
  // Each row: the side that matches its agreeing neighbours (a bite is the side that falls short). Only up to a quarter of
  // the width can come from the mirror; past that the photo's own (narrower) side is kept.
  const ref0 = median1(agree, Math.max(3, Math.round(H * 0.03)), 0.4); // only where most rows round it agree
  // Where no row nearby agrees, the nearest agreeing stretch (a bottle's body is a cylinder: the width carries on).
  const ref = Float64Array.from(ref0);
  for (let y = top; y <= bot; y++) if (Number.isNaN(ref[y])) {
    for (let d = 1; d < H; d++) { if (y - d >= top && !Number.isNaN(ref0[y - d])) { ref[y] = ref0[y - d]; break; } if (y + d <= bot && !Number.isNaN(ref0[y + d])) { ref[y] = ref0[y + d]; break; } }
  }
  const half = new Float64Array(h).fill(NaN);
  let explained = 0; // rows that mirror, or whose one good side matches the bottle's width there
  for (let y = top; y <= bot; y++) {
    if (Number.isNaN(hl[y])) continue;
    const lo = Math.max(0, Math.min(hl[y], hr[y])), hi = Math.max(hl[y], hr[y]);
    const r = ref[y];
    // How close counts as "matches": scaled to the width here, so a neck is judged against a neck, not the body.
    const near = Math.max(1.5, 0.06 * (Number.isNaN(r) ? hi : r) + 0.015 * maxW);
    if (hi - lo <= Math.min(tol, near)) { half[y] = (hl[y] + hr[y]) / 2; explained++; continue; }
    if (Number.isNaN(r)) { half[y] = lo; continue; }
    // A bite (one side short, the other matches the rows round it): mirror the good side.
    if (Math.abs(hi - r) <= near) { half[y] = hi; explained++; continue; }
    // Something stuck to one side (a glass, a hand), the other side matches: keep the bottle's own side.
    if (Math.abs(lo - r) <= near) { half[y] = lo; explained++; continue; }
    // Neither matches. One side short and the other long, with the bottle's own width between them (an off-line lean
    // plus a bite): that width. Otherwise (a real change of shape, e.g. the shoulder) the photo's narrower side, never more.
    if (lo > 0 && lo < r && r < hi) { half[y] = r; explained++; continue; }
    half[y] = lo > 0 ? lo : NaN;
  }
  // Only a bottle if nearly every row is explained that way; otherwise the photo's own outline stays.
  if (explained / rowsN < 0.6) return null;
  // Short gaps (rows the models missed between two good rows, under 6% of the height) take the rows either side.
  for (let y = top; y <= bot; y++) {
    if (!Number.isNaN(half[y]) && half[y] > 0) continue;
    let a0 = y - 1; while (a0 >= top && !(half[a0] > 0)) a0--;
    let b0 = y + 1; while (b0 <= bot && !(half[b0] > 0)) b0++;
    if (a0 < top || b0 > bot || b0 - a0 > H * 0.06) continue;
    for (let j = a0 + 1; j < b0; j++) half[j] = half[a0] + ((half[b0] - half[a0]) * (j - a0)) / (b0 - a0);
    y = b0;
  }
  // Smooth down the height: a short median takes out single-row jaggies and keeps the shoulders' steps.
  const sm = median1(half, Math.max(2, Math.round(H * 0.008)));
  // A light average on top (straight runs read straight); skipped across steep steps (shoulders, the lip under a cork).
  const k = Math.max(1, Math.round(H * 0.003)), fin = new Float64Array(h).fill(NaN);
  for (let y = top; y <= bot; y++) {
    if (Number.isNaN(sm[y])) continue;
    let s = 0, n = 0;
    for (let j = y - k; j <= y + k; j++) if (j >= top && j <= bot && !Number.isNaN(sm[j]) && Math.abs(sm[j] - sm[y]) < maxW * 0.03) { s += sm[j]; n++; }
    fin[y] = s / n;
  }
  const out = new Float32Array(w * h);
  for (let y = top; y <= bot; y++) {
    const hw = fin[y]; if (Number.isNaN(hw) || hw <= 0) continue;
    const c = axisAt[y];
    const x0 = Math.max(0, Math.floor(c - hw - 1)), x1 = Math.min(w - 1, Math.ceil(c + hw + 1));
    for (let x = x0; x <= x1; x++) out[y * w + x] = clamp(hw - Math.abs(x - c) + 0.5, 0, 1);
  }
  // The base and the top get the photo's own soft edge (a ¼-pixel step there would look cut with scissors).
  for (const y of [top, bot]) for (let x = 0; x < w; x++) out[y * w + x] = Math.min(out[y * w + x], a[y * w + x] * 1.5);
  return { alpha: out, filled: rowsN - sym };
}

/** The tilt of the bottle's axis in degrees (clockwise positive), from the 0.5 outline. Null if it can't tell. */
function tiltOf(a, w, h) {
  const ax = bestAxis(a, w, h);
  return ax ? (Math.atan(ax.m) * 180) / Math.PI : null;
}

/* ---------------------------------- edge colour ---------------------------------- */
/** Colours near the edge come from just inside the bottle, so no ring of the old background survives. */
function cleanEdges(rgb, a, w, h) {
  const r = Math.max(2, Math.round(Math.min(w, h) * 0.004));
  const solid = new Uint8Array(w * h); for (let i = 0; i < solid.length; i++) solid[i] = a[i] > 0.98 ? 1 : 0;
  const deep = morph(solid, w, h, r, false);
  const wgt = new Float32Array(w * h), ch = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let i = 0; i < w * h; i++) if (deep[i]) { wgt[i] = 1; for (let c = 0; c < 3; c++) ch[c][i] = rgb[i * 3 + c]; }
  const R2 = r * 3, mw = boxMean(wgt, w, h, R2), mc = ch.map((c) => boxMean(c, w, h, R2));
  // A wider look for rim pixels with no solid bottle near them (a soft base or cap a few rows deep).
  const R3 = r * 12, mw3 = boxMean(wgt, w, h, R3), mc3 = ch.map((c) => boxMean(c, w, h, R3));
  const out = Buffer.from(rgb);
  for (let i = 0; i < w * h; i++) {
    if (deep[i] || a[i] <= 0) continue;
    const [m, wt] = mw[i] >= 1e-3 ? [mc, mw[i]] : mw3[i] >= 1e-4 ? [mc3, mw3[i]] : [null, 0];
    if (!m) continue;
    const t = a[i] < 0.98 ? 1 : 0.5; // fully replaced on the soft rim, half on the last solid pixels
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(rgb[i * 3 + c] * (1 - t) + (m[c][i] / wt) * t);
  }
  return out;
}

/* ---------------------------------- the cut ---------------------------------- */
/**
 * Cut the bottle in `box` ([x0, y0, x1, y1], fractions) out of `base` (an upright JPEG/PNG, W × H).
 * models: { sharp, ort, sam: { enc, dec }, matte?: session, matteKind?: 'birefnet' | 'isnet' | 'u2net' }
 * opts: { shape = true, straighten = true, refine = true, select = 'sam' | 'matte', photoMask = false, work = WORK }
 * Returns { rgba, w, h, cx, tilt, shaped, ms } — rgba cropped to the bottle (straightened), cx = the body's centre.
 */
export async function cutBottle(models, base, W, H, box, opts = {}) {
  const { sharp } = models;
  const { shape = true, straighten = true, refine = true } = opts;
  const t0 = Date.now(), ms = {};
  const [fx0, fy0, fx1, fy1] = box.map((v) => clamp(Number(v) || 0, 0, 1));
  const bw = (fx1 - fx0) * W, bh = (fy1 - fy0) * H;
  if (bw < 8 || bh < 8) { const e = new Error('Draw a bigger box around the bottle.'); e.status = 422; throw e; }
  // 1. Pad the box (the guide may clip the base or the cap) and crop with a little room round it.
  const px = bw * 0.14, py = bh * 0.07;
  const pb = [fx0 * W - px, fy0 * H - py, fx1 * W + px, fy1 * H + py];
  const cx0 = Math.max(0, Math.floor(pb[0] - bw * 0.06)), cy0 = Math.max(0, Math.floor(pb[1] - bh * 0.03));
  const cx1 = Math.min(W, Math.ceil(pb[2] + bw * 0.06)), cy1 = Math.min(H, Math.ceil(pb[3] + bh * 0.03));
  // Worked on at most WORK px on its long side (memory: a 2400 px crop doubles every buffer below for no visible gain;
  // the cut-out model sees 1024 anyway). The saved picture is drawn from this, 1800 tall.
  const sc = Math.min(1, (opts.work || WORK) / Math.max(cx1 - cx0, cy1 - cy0));
  const cw = Math.max(1, Math.round((cx1 - cx0) * sc)), ch = Math.max(1, Math.round((cy1 - cy0) * sc));
  let crop = sharp(base).removeAlpha().extract({ left: cx0, top: cy0, width: cx1 - cx0, height: cy1 - cy0 });
  if (sc < 1) crop = sharp(await crop.raw().toBuffer(), { raw: { width: cx1 - cx0, height: cy1 - cy0, channels: 3 } }).resize(cw, ch, { kernel: 'lanczos3' });
  const rgb = await crop.raw().toBuffer();
  const inCrop = [(pb[0] - cx0) * sc, (pb[1] - cy0) * sc, (pb[2] - cx0) * sc, (pb[3] - cy0) * sc];
  // 2. Which object. 'sam': MobileSAM with the box as drawn (a little room) and points down its middle, then the cut-out
  //    model draws the edge near SAM's piece. 'matte': the cut-out model alone, its piece under the box centre (one model
  //    run instead of two; a glass touching the bottle is left to the bottle-shape step).
  const select = opts.select || 'sam';
  let fine = null, sel = null;
  if (models.matte) {
    const t1 = Date.now();
    fine = await matteMask(models, rgb, cw, ch);
    ms.matte = Date.now() - t1;
  }
  if (select === 'sam' || !fine) {
    const t1 = Date.now();
    const sbox = [fx0 * W - bw * 0.04 - cx0, fy0 * H - bh * 0.03 - cy0, fx1 * W + bw * 0.04 - cx0, fy1 * H + bh * 0.03 - cy0].map((v) => v * sc);
    sel = await samMask(models, rgb, cw, ch, sbox);
    ms.sam = Date.now() - t1;
  }
  const pick = sel || fine;
  const sb = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = y * cw + x; sb[i] = pick[i] > 0.5 && x >= inCrop[0] && x <= inCrop[2] && y >= inCrop[1] && y <= inCrop[3] ? 1 : 0; }
  const ccx = Math.round((inCrop[0] + inCrop[2]) / 2), ccy = Math.round((inCrop[1] + inCrop[3]) / 2);
  let seed = -1, bd = Infinity;
  for (let y = Math.max(0, Math.round(inCrop[1])); y < Math.min(ch, inCrop[3]); y += 2) for (let x = Math.max(0, Math.round(inCrop[0])); x < Math.min(cw, inCrop[2]); x += 2) {
    if (!sb[y * cw + x]) continue; const d = (x - ccx) ** 2 + ((y - ccy) * 0.5) ** 2; if (d < bd) { bd = d; seed = y * cw + x; }
  }
  if (seed < 0) { const e = new Error('We couldn’t find a bottle in that box. Move the box over the bottle and try again.'); e.status = 422; throw e; }
  const piece = flood(sb, cw, ch, [seed], 1);
  const near = morph(piece, cw, ch, Math.max(3, Math.round(Math.max(cw, ch) * 0.006)), true);
  // 3. The edge: the cut-out model where there is one, else SAM's own soft map. Inside SAM's piece (shrunk) never less
  //    than solid (clear glass the cut-out model half-misses stays whole).
  let alpha = new Float32Array(cw * ch);
  if (fine) {
    const core = sel ? morph(piece, cw, ch, Math.max(2, Math.round(Math.min(cw, ch) * 0.02)), false) : null;
    for (let i = 0; i < alpha.length; i++) alpha[i] = near[i] ? Math.max(fine[i], core && core[i] ? 1 : 0) : 0;
  } else {
    for (let i = 0; i < alpha.length; i++) alpha[i] = near[i] ? sel[i] : 0;
  }
  // 4. Snap to the photo's edges, then firm up (a guided filter leaves a wide grey ramp).
  if (refine) {
    const t2 = Date.now();
    const grey = new Float32Array(cw * ch); for (let i = 0; i < grey.length; i++) grey[i] = (rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114) / 255;
    const q = guided(grey, alpha, cw, ch, Math.max(2, Math.round(Math.max(cw, ch) * 0.003)), 1e-3);
    for (let i = 0; i < q.length; i++) alpha[i] = clamp((q[i] - 0.25) / 0.5, 0, 1);
    ms.refine = Date.now() - t2;
  }
  // One piece, no holes (labels, reflections and see-through glass stay part of the bottle).
  {
    const bin = new Uint8Array(cw * ch); for (let i = 0; i < bin.length; i++) bin[i] = alpha[i] >= 0.5 ? 1 : 0;
    let s2 = -1, b2 = Infinity; for (let i = 0; i < bin.length; i++) if (bin[i] && piece[i]) { const x = i % cw, y = (i / cw) | 0; const d = (x - ccx) ** 2 + (y - ccy) ** 2; if (d < b2) { b2 = d; s2 = i; } }
    if (s2 >= 0) {
      const one = flood(bin, cw, ch, [s2], 1), keepNear = morph(one, cw, ch, 2, true);
      for (let i = 0; i < alpha.length; i++) if (!keepNear[i]) alpha[i] = 0;
      for (let i = 0; i < bin.length; i++) bin[i] = alpha[i] >= 0.5 ? 1 : 0;
    }
    const edge = []; for (let x = 0; x < cw; x++) edge.push(x, (ch - 1) * cw + x); for (let y = 0; y < ch; y++) edge.push(y * cw, y * cw + cw - 1);
    const outside = flood(bin, cw, ch, edge, 0);
    for (let i = 0; i < alpha.length; i++) if (!outside[i] && !bin[i]) alpha[i] = 1;
  }
  // The outline at the photo's own size, before any straightening (the turntable spin reuses it on every frame).
  let photoMask = null;
  if (opts.photoMask) {
    const a8 = Buffer.alloc(cw * ch); for (let i = 0; i < a8.length; i++) a8[i] = Math.round(alpha[i] * 255);
    const full = await sharp(a8, { raw: { width: cw, height: ch, channels: 1 } }).resize(cx1 - cx0, cy1 - cy0).extractChannel(0).raw().toBuffer();
    photoMask = Buffer.alloc(W * H);
    for (let y = 0; y < cy1 - cy0; y++) full.copy(photoMask, (cy0 + y) * W + cx0, y * (cx1 - cx0), (y + 1) * (cx1 - cx0));
  }
  // 5. Straighten, then the bottle's shape.
  let img = rgb, w = cw, h = ch, tilt = 0;
  if (straighten) {
    const t = tiltOf(alpha, w, h);
    if (t != null && Math.abs(t) >= 0.4 && Math.abs(t) <= 12) {
      const turn = async (deg) => {
        const rgba = Buffer.alloc(w * h * 4);
        for (let i = 0; i < w * h; i++) { rgba[i * 4] = img[i * 3]; rgba[i * 4 + 1] = img[i * 3 + 1]; rgba[i * 4 + 2] = img[i * 3 + 2]; rgba[i * 4 + 3] = Math.round(alpha[i] * 255); }
        const { data, info } = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true });
        const a2 = new Float32Array(info.width * info.height), c2 = Buffer.alloc(info.width * info.height * 3);
        for (let i = 0; i < a2.length; i++) { a2[i] = data[i * 4 + 3] / 255; c2[i * 3] = data[i * 4]; c2[i * 3 + 1] = data[i * 4 + 1]; c2[i * 3 + 2] = data[i * 4 + 2]; }
        return { a2, c2, w2: info.width, h2: info.height };
      };
      // sharp turns clockwise for a positive angle; try the way that should undo the lean, keep it if it helped.
      for (const deg of [-t, t]) {
        const r = await turn(deg), after = tiltOf(r.a2, r.w2, r.h2);
        if (after != null && Math.abs(after) < Math.abs(t) * 0.5) { img = r.c2; alpha = r.a2; w = r.w2; h = r.h2; tilt = t; break; }
      }
    }
  }
  let shaped = false;
  if (shape) {
    const t3 = Date.now();
    const s = bottleShape(alpha, w, h);
    if (s) { alpha = s.alpha; shaped = true; }
    ms.shape = Date.now() - t3;
  }
  // 6. Edge colours from inside.
  const clean = cleanEdges(img, alpha, w, h);
  // 7. Crop to the bottle.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 0.02) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { const e = new Error('We couldn’t find a bottle in that box. Move the box over the bottle and try again.'); e.status = 422; throw e; }
  const ow = x1 - x0 + 1, oh = y1 - y0 + 1, rgba = Buffer.alloc(ow * oh * 4);
  let sum = 0, n = 0;
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const si = (y0 + y) * w + x0 + x, di = (y * ow + x) * 4, av = alpha[si];
    rgba[di] = clean[si * 3]; rgba[di + 1] = clean[si * 3 + 1]; rgba[di + 2] = clean[si * 3 + 2]; rgba[di + 3] = Math.round(av * 255);
    if (y > oh * 0.45 && y < oh * 0.95 && av > 0.5) { sum += x; n++; }
  }
  ms.total = Date.now() - t0;
  // `at`: where the cut sits in the photo (only meaningful when it wasn't straightened).
  return { rgba, w: ow, h: oh, cx: n ? sum / n : ow / 2, tilt, shaped, ms, photoMask, at: tilt ? null : { x: cx0 + x0 / sc, y: cy0 + y0 / sc, scale: sc } };
}

/** The transparent master (PNG). */
export const png = ({ sharp }, cut) => sharp(cut.rgba, { raw: { width: cut.w, height: cut.h, channels: 4 } }).png({ compressionLevel: 7 }).toBuffer();

/**
 * The cut-out on the Wine Book beige: `height` tall, the bottle 84% of it, its base on one line (8% up from the bottom),
 * centred on its body, with a soft contact shadow under the base. Small photos are enlarged to fit (lanczos).
 */
export async function onBeige({ sharp }, cut, { height = 1800, beige = [231, 222, 207], shadow = true, quality = 88, minWidth = 0.42 } = {}) {
  const bh = Math.round(height * 0.84), k = bh / cut.h, bw = Math.max(1, Math.round(cut.w * k));
  const cx = cut.cx * k, half = Math.ceil(Math.max(cx, bw - cx));
  const width = Math.max(Math.round(height * minWidth), half * 2 + Math.round(height * 0.12));
  const top = height - Math.round(height * 0.08) - bh, left = Math.round(width / 2 - cx);
  const img = await sharp(cut.rgba, { raw: { width: cut.w, height: cut.h, channels: 4 } }).resize(bw, bh, { kernel: 'lanczos3' }).png().toBuffer();
  const layers = [];
  if (shadow) {
    // Base width: the bottle's widest point in its bottom 4%.
    let bl = cut.w, br = -1;
    for (let y = Math.floor(cut.h * 0.96); y < cut.h; y++) for (let x = 0; x < cut.w; x++) if (cut.rgba[(y * cut.w + x) * 4 + 3] > 128) { if (x < bl) bl = x; if (x > br) br = x; }
    if (br > bl) {
      const sw = Math.round((br - bl) * k * 1.08), sh = Math.max(6, Math.round(height * 0.022)), blur = Math.max(2, Math.round(height * 0.009));
      const pad = blur * 3, cxs = left + ((bl + br) / 2) * k;
      const svg = `<svg width="${sw + pad * 2}" height="${sh + pad * 2}"><ellipse cx="${sw / 2 + pad}" cy="${sh / 2 + pad}" rx="${sw / 2}" ry="${sh / 2}" fill="rgb(70,52,38)" fill-opacity="0.34"/></svg>`;
      const sh2 = await sharp(Buffer.from(svg)).blur(blur).png().toBuffer();
      layers.push({ input: sh2, left: Math.round(cxs - sw / 2 - pad), top: Math.round(top + bh - sh * 0.55 - pad) });
    }
  }
  layers.push({ input: img, left, top });
  return sharp({ create: { width, height, channels: 3, background: { r: beige[0], g: beige[1], b: beige[2] } } })
    .composite(layers).jpeg({ quality, mozjpeg: true }).toBuffer();
}
