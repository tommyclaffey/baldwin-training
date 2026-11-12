// Wrenfield's floor plan (Nov 11, Tommy: "make sure both styles have all the same functions and features"). Wrenfield is
// the made-up restaurant in the Mise demo (/demo/mise), so its room is drawn here rather than exported from Figma.
// Writes public/img/demo-mise/floor-plan.png (2x of the page's 1046 x 690 image box) and content/demo-mise/floorplan.json
// (each table's and bar seat's centre as fractions of the image, the same shape as content/floorplan.json).
//   node scripts/demo-mise-floorplan.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const W = 1046, H = 690;
const C = { paper: '#FBF8F2', floor: '#F4EFE0', bone: '#EDE6DA', sand: '#D9CFBF', char: '#121110', muted: '#4A443E', fig: '#8E2A26', tape: '#7BA5CB' };
const tables = {};
const out = [];
const font = "font-family='Helvetica Neue, Helvetica, Arial, sans-serif'";
const label = (x, y, s, size = 11, fill = C.muted, anchor = 'middle') => out.push(`<text x='${x}' y='${y}' ${font} font-size='${size}' font-weight='700' letter-spacing='1.4' fill='${fill}' text-anchor='${anchor}'>${s}</text>`);
const num = (x, y, s, size = 15, fill = C.char) => out.push(`<text x='${x}' y='${y + size * 0.36}' ${font} font-size='${size}' font-weight='700' fill='${fill}' text-anchor='middle'>${s}</text>`);
// Seat 1: a small red dot with a white 1 on one corner of every table.
const seat1 = (x, y) => { out.push(`<circle cx='${x}' cy='${y}' r='7.5' fill='${C.fig}'/>`); num(x, y, '1', 9.5, '#FFFFFF'); };
function rectTable(n, cx, cy, w, h) {
  out.push(`<rect x='${cx - w / 2}' y='${cy - h / 2}' width='${w}' height='${h}' rx='6' fill='${C.bone}' stroke='${C.char}' stroke-width='2'/>`);
  num(cx, cy, n); seat1(cx - w / 2, cy - h / 2); tables[n] = [cx / W, cy / H];
}
function roundTable(n, cx, cy, r) {
  out.push(`<circle cx='${cx}' cy='${cy}' r='${r}' fill='${C.bone}' stroke='${C.char}' stroke-width='2'/>`);
  num(cx, cy, n); seat1(cx - r * 0.72, cy - r * 0.72); tables[n] = [cx / W, cy / H];
}
function barSeat(n, cx, cy) {
  out.push(`<circle cx='${cx}' cy='${cy}' r='12' fill='${C.paper}' stroke='${C.char}' stroke-width='2'/>`);
  num(cx, cy, n, 11); tables[n] = [cx / W, cy / H];
}

// The room: floor, walls, windows (painter's-tape blue), the door.
out.push(`<rect width='${W}' height='${H}' fill='${C.paper}'/>`);
out.push(`<rect x='20' y='20' width='1006' height='650' fill='${C.floor}'/>`);
// Kitchen (bottom right) and The Nest (top right)
out.push(`<rect x='870' y='330' width='156' height='340' fill='${C.sand}'/>`);
for (let i = 0; i < 16; i++) out.push(`<line x1='${870 + i * 22}' y1='330' x2='${870 + i * 22 - 120}' y2='670' stroke='#CBBFAC' stroke-width='1.5' clip-path='url(#k)'/>`);
label(948, 505, 'KITCHEN', 13, C.char);
label(948, 525, 'WOOD GRILL · LINE', 9.5);
out.push(`<rect x='870' y='20' width='156' height='270' fill='${C.paper}'/>`);
label(948, 262, 'THE NEST', 13, C.char);
label(948, 278, 'PRIVATE ROOM', 9.5);
// Walls
const wall = (d) => out.push(`<path d='${d}' fill='none' stroke='${C.char}' stroke-width='5' stroke-linecap='square'/>`);
wall('M120 670 L20 670 L20 20 L1026 20 L1026 670 L220 670'); // outer, with the front door gap (120–220)
wall('M870 20 L870 225'); wall('M870 285 L870 290 L1026 290'); // The Nest, door at 225–285
wall('M870 330 L1026 330'); wall('M870 330 L870 400'); wall('M870 470 L870 670'); // kitchen, the pass at 400–470
// Windows on the front (left) wall
for (const [a, b] of [[60, 200], [250, 390], [440, 580]]) out.push(`<line x1='20' y1='${a}' x2='20' y2='${b}' stroke='${C.tape}' stroke-width='7'/>`);
label(170, 662, 'ENTRANCE', 10, C.char);
out.push(`<rect x='232' y='600' width='54' height='30' rx='4' fill='${C.paper}' stroke='${C.char}' stroke-width='2'/>`);
label(259, 619, 'HOST', 9, C.char);
out.push(`<rect x='878' y='424' width='44' height='22' rx='3' fill='${C.paper}'/>`);
label(900, 439, 'PASS', 10, C.char);

// 300s: two-tops along the back banquette
out.push(`<rect x='150' y='28' width='490' height='22' rx='4' fill='${C.sand}' stroke='${C.char}' stroke-width='1.5'/>`);
label(395, 43, 'BANQUETTE', 9, C.muted);
[...Array(8)].forEach((_, i) => rectTable(String(301 + i), 178 + i * 62, 88, 44, 44));
// 100s: two-tops along the front windows
[101, 102, 103, 104, 105, 106].forEach((n, i) => rectTable(String(n), 70, 120 + i * 82, 44, 44));
// 200s: the main floor, two rows; 205 and 210 seat six
[201, 202, 203, 204].forEach((n, i) => rectTable(String(n), 190 + i * 95, 235, 60, 60));
rectTable('205', 585, 235, 96, 60);
[206, 207, 208, 209].forEach((n, i) => rectTable(String(n), 190 + i * 95, 395, 60, 60));
rectTable('210', 585, 395, 96, 60);
// The bar: counter, back bar, 12 seats (9 down the front, 3 round the end)
out.push(`<rect x='700' y='190' width='80' height='272' rx='10' fill='${C.char}'/>`);
out.push(`<rect x='826' y='190' width='14' height='272' rx='3' fill='${C.sand}' stroke='${C.char}' stroke-width='1.5'/>`);
label(803, 330, 'BAR', 11, C.char);
[...Array(9)].forEach((_, i) => barSeat(String(i + 1), 678, 206 + i * 30));
[...Array(3)].forEach((_, i) => barSeat(String(10 + i), 712 + i * 28, 486));
// 500s: high-tops between the bar and the pass
[501, 502, 503, 504].forEach((n, i) => roundTable(String(n), 520 + i * 86, 590, 22));
// 400s: four rounds in The Nest
[[401, 912, 80], [402, 984, 80], [403, 912, 172], [404, 984, 172]].forEach(([n, x, y]) => roundTable(String(n), x, y, 27));
label(1026, 685, 'SAMPLE FLOOR PLAN · WRENFIELD IS A MADE-UP RESTAURANT', 9, C.muted, 'end');

const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W * 2}' height='${H * 2}' viewBox='0 0 ${W} ${H}'><defs><clipPath id='k'><rect x='870' y='330' width='156' height='340'/></clipPath></defs>${out.join('')}</svg>`;
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(ROOT, 'public/img/demo-mise/floor-plan.png'));
const round = (v) => Math.round(v * 1e4) / 1e4;
fs.writeFileSync(path.join(ROOT, 'content/demo-mise/floorplan.json'), JSON.stringify({
  image: '/img/demo-mise/floor-plan.png',
  note: 'Wrenfield (the Mise demo) floor plan, drawn by scripts/demo-mise-floorplan.mjs. Table and bar-seat centres as fractions of the image.',
  tables: Object.fromEntries(Object.entries(tables).map(([k, [x, y]]) => [k, [round(x), round(y)]])),
}, null, 1) + '\n');
console.log(Object.keys(tables).length, 'tables and seats');
