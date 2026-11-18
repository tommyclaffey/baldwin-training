// Test photos for Photo by Photo (Nov 18): 12 "hand-turned" photos of a bottle, made from ONE real photo (an Unsplash
// sample in public/img/scanner-samples). They are not 12 real photos: the bottle is cut out with the real scanner, then
// its surface is wrapped round a cylinder and turned 30° per photo (the label slides round and comes back), and each
// photo is nudged the way a hand-held phone and a hand-turned bottle move (a little left/right, nearer/further, up/down).
// Use them to try the scanner end to end and for screenshots; a real hand-turned set is still the true test.
//   DATA_DIR=/tmp/bt-models node scripts/scanner/spin-fixtures.mjs <spirit|red|rose|sparkling> <outDir> [--label]
// --label paints a plain cream label with grey lines on the bottle (no brand), so a label-less bottle shows its turn.
import fs from 'node:fs';
import path from 'node:path';

const [which = 'spirit', out = '/tmp/spin-fixtures', flag] = process.argv.slice(2);
process.env.DATA_DIR ||= '/tmp/bt-models';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { bottleMask } = await import(path.join(root, 'server/scanner.mjs'));
const sharp = (await import('sharp')).default;
const samples = JSON.parse(fs.readFileSync(path.join(root, 'public/img/scanner-samples/samples.json'), 'utf8')).samples;
const s = samples.find((x) => x.file.includes(`/${which}.jpg`));
if (!s) { console.error('No sample called', which); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

const photo = fs.readFileSync(path.join(root, 'public', s.file));
const { mask, W, H, base } = await bottleMask(photo, s.box);
const src = await sharp(base).removeAlpha().raw().toBuffer();
// The bottle's extent on every row.
const rows = [];
for (let y = 0; y < H; y++) {
  let l = -1, r = -1;
  for (let x = 0; x < W; x++) if (mask[y * W + x] > 127) { if (l < 0) l = x; r = x; }
  rows.push(l < 0 ? null : [l, r]);
}
let y0 = rows.findIndex(Boolean), y1 = rows.length - 1 - [...rows].reverse().findIndex(Boolean);
const tex = Buffer.from(src);
if (flag === '--label') {
  // A plain label on the body: 45–75% down the bottle, a third of its circumference, cream with three grey lines.
  const ly0 = Math.round(y0 + (y1 - y0) * 0.45), ly1 = Math.round(y0 + (y1 - y0) * 0.72);
  for (let y = ly0; y <= ly1; y++) {
    const [l, r] = rows[y] || [0, -1]; const cx = (l + r) / 2, rad = (r - l) / 2;
    for (let x = l; x <= r; x++) {
      const u = (x - cx) / rad; if (Math.abs(u) > 0.55) continue;
      const shade = 0.78 + 0.22 * Math.sqrt(Math.max(0, 1 - u * u));
      const t = (y - ly0) / (ly1 - ly0);
      const line = (Math.abs(t - 0.38) < 0.035 && Math.abs(u) < 0.32) || (Math.abs(t - 0.52) < 0.022 && Math.abs(u) < 0.22) || (Math.abs(t - 0.64) < 0.022 && Math.abs(u) < 0.26);
      const dot = Math.hypot(u / 0.16, (t - 0.18) / 0.09) < 1;
      const c = dot ? [138, 90, 58] : line ? [92, 86, 80] : [236, 228, 212];
      const i = (y * W + x) * 3; for (let k = 0; k < 3; k++) tex[i + k] = Math.round(c[k] * shade);
    }
  }
}
// Hand-held moves per photo: [dx, dy] as a share of the photo, and a scale.
const MOVES = [[0, 0, 1], [0.012, -0.008, 1.02], [-0.015, 0.006, 0.98], [0.02, -0.012, 1.035], [-0.008, 0.012, 0.97], [0.016, 0.004, 1],
  [-0.02, -0.006, 1.03], [0.008, 0.014, 0.985], [-0.012, -0.01, 1.015], [0.015, 0.006, 0.975], [0.004, -0.004, 1.025], [-0.006, 0.01, 0.995]];
for (let k = 0; k < 12; k++) {
  const th = (k * 30 * Math.PI) / 180;
  const o = Buffer.from(src);
  for (let y = y0; y <= y1; y++) {
    const row = rows[y]; if (!row) continue;
    const [l, r] = row; const cx = (l + r) / 2, rad = Math.max(1, (r - l) / 2);
    for (let x = l; x <= r; x++) {
      if (mask[y * W + x] < 128) continue;
      const u = Math.max(-1, Math.min(1, (x - cx) / rad));
      // the point on the surface now facing this pixel came from angle φ + θ; behind (|φ+θ| > 90°) is the mirrored front
      let a = Math.asin(u) + th; a = Math.atan2(Math.sin(a), Math.cos(a));
      const sx = Math.round(cx + rad * Math.sin(a));
      const back = Math.abs(a) > Math.PI / 2;
      const si = (y * W + Math.max(l, Math.min(r, sx))) * 3, di = (y * W + x) * 3;
      // the glass keeps its own light where it is (a soft glow from the original), the colour turns with the surface
      const glow = Math.max(0, (src[di] + src[di + 1] + src[di + 2]) / 3 - (tex[si] + tex[si + 1] + tex[si + 2]) / 3) * 0.35;
      for (let c = 0; c < 3; c++) o[di + c] = Math.max(0, Math.min(255, Math.round(tex[si + c] * (back ? 0.9 : 1) + glow)));
    }
  }
  const [dx, dy, sc] = MOVES[k];
  const sw = Math.round(W * sc), sh = Math.round(H * sc);
  let img = sharp(o, { raw: { width: W, height: H, channels: 3 } }).resize(sw, sh);
  const left = Math.round((sw - W) / 2 - dx * W), top = Math.round((sh - H) / 2 - dy * H);
  const buf = await img.toBuffer();
  const ext = sharp(buf, { raw: { width: sw, height: sh, channels: 3 } });
  const pad = { top: Math.max(0, -top), left: Math.max(0, -left), bottom: Math.max(0, top + H - sh), right: Math.max(0, left + W - sw) };
  const padded = await ext.extend({ ...pad, extendWith: 'mirror' }).raw().toBuffer({ resolveWithObject: true });
  const final = sharp(padded.data, { raw: padded.info }).extract({ left: Math.max(0, left), top: Math.max(0, top), width: W, height: H });
  await final.jpeg({ quality: 90 }).toFile(path.join(out, `${which}-${String(k + 1).padStart(2, '0')}.jpg`));
}
console.log(`12 photos of the ${s.label} sample (${s.credit}) → ${out}`);
