// The link-preview cards (1200 × 630) with the sign-in's words (Nov 25). Tommy picked H8 for the sign-in on Nov 24
// (Figma 09 · Idea Board, section 51) and then: "update this for our custom ones as well. Same language, different
// style." The cards still said "Know the menu cold." Now each says the sign-in's label, title and line in its own look.
//
//   node scripts/share-card/render.mjs mise  [out.jpg]          → public/img/mise-brand/share-card.jpg
//   node scripts/share-card/render.mjs custom <master@2x.png> <out.jpg> <out@2x.png> <logo-bottom-px>
//
// mise: the Mise card, drawn whole: the sign-in's bartender photo (Olena Bohovyk, Unsplash), the plain mise lockup (as
//   on the sign-in), "FRONT AND BACK OF HOUSE" in DM Mono, "Ready for / service." in DM Serif Display Italic, the line in
//   Archivo. Same colours as the sign-in's title card (#CFC6B8, #FFFFFF, #EDE6DA on #121110).
// custom: a hand-built look's approved card (its photo, logo and "TRAINING ON mise" stay as they are): the words under
//   the logo are replaced on the card's own flat background with the same words in that look's style. Today that's
//   The Baldwin (Archivo Bold label, Archivo ExtraBold capitals, cream on its #1D1C1A), from its private master, which
//   lives outside this repo (~/Coding/mise-private/baldwin/share/). Nothing of it is written into the repo.
// Renders at 2x in headless Chrome, then a 1200 × 630 JPG (sharp). Needs Google Chrome and the internet (Google Fonts).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;700;800&family=DM+Serif+Display:ital@1&family=DM+Mono:wght@500&display=block';
const LINE = 'Training, inventory, prep and team chat<br />for every position, front and back of house.'; // the sign-in's line (src/components/AuthCard.tsx)
const dataUrl = (f, type) => `data:${type};base64,${fs.readFileSync(f).toString('base64')}`;

function misePage() {
  const photo = dataUrl(path.join(ROOT, 'public/img/signin-bartender-2400.jpg'), 'image/jpeg');
  const logo = dataUrl(path.join(ROOT, 'public/img/mise-brand/mise-dark.svg'), 'image/svg+xml');
  return `<!doctype html><html><head><link rel="stylesheet" href="${FONTS}"><style>
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #121110; }
    .card { position: relative; width: 1200px; height: 630px; overflow: hidden; background: #121110; }
    .photo { position: absolute; top: -10px; left: 300px; height: 650px; }
    .shade { position: absolute; inset: 0; background:
      linear-gradient(90deg, #121110 0, #121110 330px, rgba(18,17,16,.92) 430px, rgba(18,17,16,.55) 560px, rgba(18,17,16,.12) 760px, rgba(18,17,16,0) 900px),
      linear-gradient(0deg, rgba(18,17,16,.55) 0, rgba(18,17,16,0) 140px); }
    .logo { position: absolute; left: 47px; top: 34px; width: 204px; }
    .words { position: absolute; left: 64px; bottom: 76px; }
    .words p { margin: 0; }
    .label { font: 500 15px/18px 'DM Mono', monospace; letter-spacing: .2em; text-transform: uppercase; color: #CFC6B8; }
    .title { margin-top: 24px !important; font: italic 400 84px/84px 'DM Serif Display', Georgia, serif; letter-spacing: -1px; color: #FFFFFF; }
    .line { margin-top: 24px !important; font: 400 21px/31px 'Archivo', sans-serif; color: #EDE6DA; }
  </style></head><body><div class="card">
    <img class="photo" src="${photo}" alt="" /><div class="shade"></div>
    <img class="logo" src="${logo}" alt="" />
    <div class="words"><p class="label">Front and back of house</p><p class="title">Ready for<br />service.</p><p class="line">${LINE}</p></div>
  </div></body></html>`;
}

/** A hand-built look's card: its master (2400 × 1260) with the old words covered by its own flat background, from
 *  `top` px (1x) down to the "TRAINING ON" line, and the sign-in's words in its style. */
function customPage(master, top) {
  const bg = dataUrl(master, 'image/png');
  return `<!doctype html><html><head><link rel="stylesheet" href="${FONTS}"><style>
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    .card { position: relative; width: 1200px; height: 630px; overflow: hidden; }
    .bg { position: absolute; inset: 0; width: 1200px; height: 630px; }
    .cover { position: absolute; left: 0; top: ${top}px; width: 600px; height: ${520 - top}px; background: var(--flat); }
    .words { position: absolute; left: 64px; top: ${top + 22}px; }
    .words p { margin: 0; }
    .label { font: 700 15px/18px 'Archivo', sans-serif; letter-spacing: .16em; text-transform: uppercase; color: #F2EEE7; }
    .title { margin-top: 22px !important; font: 800 66px/68px 'Archivo', sans-serif; text-transform: uppercase; color: #F2EEE7; }
    .line { margin-top: 22px !important; font: 400 21px/31px 'Archivo', sans-serif; color: #E2DACF; }
  </style></head><body><div class="card">
    <img class="bg" src="${bg}" alt="" /><div class="cover"></div>
    <div class="words"><p class="label">Front and back of house</p><p class="title">Ready for<br />service.</p><p class="line">${LINE}</p></div>
  </div></body></html>`;
}

async function render(html, flat) {
  const port = 9900 + Math.floor(Math.random() * 90);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-card-'));
  const page = path.join(profile, 'card.html');
  fs.writeFileSync(page, html.replace('var(--flat)', flat || '#000'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws;
  try {
    for (let i = 0; i < 100 && !ws; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); if (t) ws = new WebSocket(t.webSocketDebuggerUrl); } catch {} await sleep(150); }
    if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pend = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 2, mobile: false });
    await send('Page.navigate', { url: 'file://' + page });
    for (let i = 0; i < 60; i++) {
      const r = await send('Runtime.evaluate', { expression: `document.readyState === 'complete' && document.fonts.status === 'loaded' && [...document.images].every((i) => i.complete)`, returnByValue: true, awaitPromise: true });
      if (r.result?.result?.value) break;
      await sleep(250);
    }
    const fonts = await send('Runtime.evaluate', { expression: `Promise.all(["500 15px 'DM Mono'", "italic 400 84px 'DM Serif Display'", "800 66px 'Archivo'", "400 21px 'Archivo'"].map((f) => document.fonts.load(f))).then(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight + ' ' + f.style))`, returnByValue: true, awaitPromise: true });
    const loaded = fonts.result?.result?.value || [];
    for (const want of ['DM Mono', 'DM Serif Display', 'Archivo']) if (!loaded.some((f) => f.includes(want))) throw new Error(`${want} didn’t load (needs the internet)`);
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 }, captureBeyondViewport: false });
    return Buffer.from(shot.result.data, 'base64');
  } finally { try { ws?.close(); } catch {} proc.kill(); await sleep(300); fs.rmSync(profile, { recursive: true, force: true }); }
}

const [kind, ...args] = process.argv.slice(2);
if (kind === 'mise') {
  const out = args[0] || path.join(ROOT, 'public/img/mise-brand/share-card.jpg');
  const png = await render(misePage());
  await sharp(png).resize(1200, 630).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
  console.log('wrote', out);
} else if (kind === 'custom') {
  const [master, out, out2x, top] = args;
  if (!master || !out || !out2x || !top) throw new Error('custom <master@2x.png> <out.jpg> <out@2x.png> <cover-top-px>');
  // the card's own flat background, read from the master just right of the words (x 1160–1180 at 2x, mid-height)
  const { data } = await sharp(master).extract({ left: 1160, top: 600, width: 20, height: 20 }).raw().toBuffer({ resolveWithObject: true });
  const flat = '#' + [0, 1, 2].map((c) => Math.round(data.filter((_, i) => i % (data.length / 400) === c).reduce((a, b) => a + b, 0) / 400).toString(16).padStart(2, '0')).join('');
  const png = await render(customPage(master, Number(top)), flat);
  fs.writeFileSync(out2x, png);
  await sharp(png).resize(1200, 630).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
  console.log('wrote', out, out2x, 'flat', flat);
} else {
  console.log('node scripts/share-card/render.mjs mise [out.jpg] | custom <master@2x.png> <out.jpg> <out@2x.png> <cover-top-px>');
  process.exit(1);
}
