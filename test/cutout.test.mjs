// Bottle cut-out v2 (Nov 22, server/cutout.mjs) without the real models: a drawn bottle on a busy background, and a
// stand-in "cut-out model" that answers in coarse 16 px blocks with a bite out of one side, the way a weak model does.
// What v2 must still deliver: smooth symmetric edges, the bite filled from the other side, the base kept when the box
// clips it, a tilted bottle stood up straight, no halo of the old background, and the beige picture at 1800 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { cutBottle, onBeige, png } from '../server/cutout.mjs';

const W = 1200, H = 1800;
const RED = [150, 20, 30];
// A wine bottle 1300 px tall, axis at x = 600: cap, neck, shoulders, body, flat base.
const bottlePath = (cx, top, h) => {
  const bw = h * 0.25, nw = h * 0.075, y = (f) => top + h * f;
  return `M ${cx - nw / 2} ${y(0)} L ${cx + nw / 2} ${y(0)} L ${cx + nw / 2} ${y(0.3)} C ${cx + nw / 2} ${y(0.4)} ${cx + bw / 2} ${y(0.38)} ${cx + bw / 2} ${y(0.5)}
    L ${cx + bw / 2} ${y(1)} L ${cx - bw / 2} ${y(1)} L ${cx - bw / 2} ${y(0.5)} C ${cx - bw / 2} ${y(0.38)} ${cx - nw / 2} ${y(0.4)} ${cx - nw / 2} ${y(0.3)} Z`;
};
async function scene(tilt = 0) {
  // Busy background: grey stripes and blobs (no red in it).
  let bg = '';
  for (let i = 0; i < 30; i++) bg += `<rect x="${(i * 97) % W}" y="0" width="23" height="${H}" fill="rgb(${90 + (i * 37) % 120},${100 + (i * 53) % 100},${110 + (i * 29) % 100})"/>`;
  for (let i = 0; i < 25; i++) bg += `<circle cx="${(i * 211) % W}" cy="${(i * 331) % H}" r="${40 + (i * 13) % 60}" fill="rgb(${120 + (i * 41) % 100},${130 + (i * 17) % 90},${140})"/>`;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgb(170,175,180)"/>${bg}
    <g transform="rotate(${tilt} 600 900)"><path d="${bottlePath(600, 250, 1300)}" fill="rgb(${RED.join(',')})"/></g></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}
/** The stand-in model: red pixels of its 1024 × 1024 input, in 16 px blocks, with a bite out of the right side mid-body. */
function fakeMatte() {
  return {
    inputNames: ['input_image'], outputNames: ['output_image'],
    run: async (feeds) => {
      const t = feeds.input_image, S = t.dims[2], d = t.data, out = new Float32Array(S * S);
      // isnet input: v/255 - 0.5 per channel, planar
      const px = (i, c) => (d[c * S * S + i] + 0.5) * 255;
      const B = 16;
      for (let by = 0; by < S; by += B) for (let bx = 0; bx < S; bx += B) {
        let red = 0, n = 0;
        for (let y = by; y < Math.min(S, by + B); y++) for (let x = bx; x < Math.min(S, bx + B); x++) { const i = y * S + x; if (px(i, 0) > 110 && px(i, 1) < 70 && px(i, 2) < 80) red++; n++; }
        const v = red / n > 0.5 ? 1 : 0;
        for (let y = by; y < Math.min(S, by + B); y++) for (let x = bx; x < Math.min(S, bx + B); x++) out[y * S + x] = v;
      }
      // The bite: clear the right 30% of the mask's width for 12% of its height in the middle of the body.
      let x0 = S, x1 = -1, y0 = S, y1 = -1;
      for (let i = 0; i < S * S; i++) if (out[i]) { const x = i % S, y = (i / S) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const bxs = Math.round(x1 - (x1 - x0) * 0.3), bys = Math.round(y0 + (y1 - y0) * 0.66), bye = Math.round(y0 + (y1 - y0) * 0.78);
      for (let y = bys; y < bye; y++) for (let x = bxs; x <= x1; x++) out[y * S + x] = 0;
      return { output_image: { data: out } };
    },
  };
}
class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const models = { sharp, ort: { Tensor }, sam: null, matte: fakeMatte(), matteKind: 'isnet' };
const BOX = [0.33, 0.12, 0.67, 0.86]; // the guide clips the base (the bottle ends at 0.861 … 0.875 with tilt)

/** Each row's alpha ≥ 128 extent, in the cut. */
const rows = (cut) => { const r = []; for (let y = 0; y < cut.h; y++) { let l = -1, rr = -1; for (let x = 0; x < cut.w; x++) if (cut.rgba[(y * cut.w + x) * 4 + 3] >= 128) { if (l < 0) l = x; rr = x; } r.push([l, rr]); } return r; };

test('v2 cut-out: smooth, symmetric, bite filled, base kept', async () => {
  const photo = await scene(0);
  const cut = await cutBottle(models, photo, W, H, BOX, { select: 'matte' });
  assert.ok(cut.shaped, 'the bottle shape step ran');
  // Base kept: the bottle is 1300 px tall in the photo; the cut (worked at ≤ 1700 px) keeps all of it, not the boxed part.
  const scale = cut.at ? cut.at.scale : 1;
  assert.ok(Math.abs(cut.h / scale - 1300) < 1300 * 0.025, `bottle height ${Math.round(cut.h / scale)} ≈ 1300 (the box stopped at ${Math.round((BOX[3] - 0.12) * H / 0.78)})`);
  const r = rows(cut);
  const body = r.slice(Math.round(cut.h * 0.55), Math.round(cut.h * 0.95)).filter(([l]) => l >= 0);
  const widths = body.map(([l, rr]) => rr - l), maxW = Math.max(...widths);
  // The bite (66–78% down) is filled: every body row is within 3% of the widest.
  assert.ok(widths.every((w) => w > maxW * 0.97), `body widths ${Math.min(...widths)}…${maxW}`);
  // Symmetric about one vertical line, and smooth: no row's edge jumps more than 1 px from its neighbours on the body.
  const centres = body.map(([l, rr]) => (l + rr) / 2);
  assert.ok(Math.max(...centres) - Math.min(...centres) <= 2, 'one straight axis');
  for (let i = 1; i < body.length; i++) assert.ok(Math.abs(body[i][0] - body[i - 1][0]) <= 1, `left edge steps at row ${i}`);
  // No halo: soft edge pixels down the sides carry the bottle's red, not the grey background. (The base row is left to
  // the model: this stand-in's 16 px blocks put the base ~1% low, which the height check above allows.)
  let soft = 0, grey = 0;
  for (let i = 0; i < cut.w * cut.h; i++) {
    const y = Math.floor(i / cut.w); if (y < cut.h * 0.03 || y > cut.h * 0.96) continue;
    const a = cut.rgba[i * 4 + 3]; if (a > 20 && a < 235) { soft++; const [R, G] = [cut.rgba[i * 4], cut.rgba[i * 4 + 1]]; if (G > R) grey++; }
  }
  assert.ok(soft > 100 && grey / soft < 0.02, `edge pixels greyer than red: ${grey} of ${soft}`);
  // The pictures: beige JPEG 1800 tall, transparent PNG master.
  const jpg = await onBeige(models, cut);
  const m = await sharp(jpg).metadata();
  assert.equal(m.height, 1800); assert.equal(m.format, 'jpeg');
  const p = await sharp(await png(models, cut)).metadata();
  assert.equal(p.format, 'png'); assert.equal(p.channels, 4);
});

test('v2 cut-out: a tilted bottle comes out standing straight', async () => {
  const photo = await scene(4);
  const cut = await cutBottle(models, photo, W, H, [0.28, 0.1, 0.72, 0.9], { select: 'matte' });
  assert.ok(Math.abs(Math.abs(cut.tilt) - 4) < 1, `tilt found: ${cut.tilt.toFixed(2)}°`);
  const body = rows(cut).slice(Math.round(cut.h * 0.55), Math.round(cut.h * 0.95)).filter(([l]) => l >= 0);
  const centres = body.map(([l, rr]) => (l + rr) / 2);
  assert.ok(Math.max(...centres) - Math.min(...centres) <= 3, `axis wanders ${Math.max(...centres) - Math.min(...centres)} px`);
});

test('v2 cut-out: a box with no bottle in it says so', async () => {
  const photo = await scene(0);
  await assert.rejects(cutBottle(models, photo, W, H, [0.02, 0.02, 0.12, 0.2], { select: 'matte' }), (e) => e.status === 422);
});
