// Screenshots + horizontal-overflow check at real device widths (Chrome DevTools protocol).
// Needs the app running (npm start) and Google Chrome.
//   node scripts/shots.mjs [baseUrl] [outDir]
//   SCREENS=/,/classic/old-fashioned WIDTHS=1440,1024,390 node scripts/shots.mjs
//   COOKIE=<session> EDIT=1 … for signed-in screens · TYPE=old … to show search results
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8090';
const OUT = process.argv[3] ?? '/tmp/bt-shots';
const WIDTHS = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const SCREENS = (process.env.SCREENS ?? '/').split(',');
const FULL = process.env.FULL !== '0';
mkdirSync(OUT, { recursive: true });

const port = 9300 + Math.floor(Math.random() * 300);
const profile = `/tmp/bt-shot-${process.pid}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 80 && !ws; i++) {
  try {
    const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
    if (t) ws = new WebSocket(t.webSocketDebuggerUrl);
  } catch {}
  await sleep(150);
}
if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');
// Signed-in shots: COOKIE=<bt_session value>, EDIT=1 turns editing on.
if (process.env.COOKIE) {
  await send('Network.enable');
  await send('Network.setCookie', { name: 'bt_session', value: process.env.COOKIE, url: BASE });
  // A demo session only lives in the tab it was started in (Nov 10): DEMO_TAB=1 marks this tab, like the smoke test does.
  if (process.env.DEMO_TAB === '1') await send('Page.addScriptToEvaluateOnNewDocument', { source: "sessionStorage.setItem('bt-demo-tab','1')" });
  await send('Page.navigate', { url: BASE + '/admin' });
  await sleep(800);
  await send('Runtime.evaluate', { expression: `localStorage.setItem('bt-editing', '${process.env.EDIT === '1' ? 1 : 0}')` });
}
const report = [];
for (const screen of SCREENS) {
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 800 ? (+process.env.H || 844) : 1000, deviceScaleFactor: 1, mobile: w < 800 });
    await send('Page.navigate', { url: BASE + screen });
    await sleep(1800);
    const probe = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const W = document.documentElement.clientWidth; const bad = [];
      document.querySelectorAll('.content .fn').forEach(el => { const r = el.getBoundingClientRect();
        if (r.right > W + 1 && r.width > 0 && !Array.from(el.children).some(c => c.getBoundingClientRect().right > W + 1)) bad.push((el.dataset.name||el.className).slice(0,40) + ' r=' + Math.round(r.right)); });
      return { W, scroll: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, bad: bad.slice(0, 12) }; })()` });
    const v = probe.result.result.value;
    // TYPE=old types into the search box first, to check the results list.
    // EVAL='js' runs in the page first (click through a quiz, open a menu…).
    if (process.env.EVAL) { const r = await send('Runtime.evaluate', { expression: process.env.EVAL, awaitPromise: true, returnByValue: true }); if (r.result?.result?.value !== undefined) console.log(JSON.stringify(r.result.result.value, null, 1)); await sleep(700); }
    if (process.env.TYPE) {
      await send('Runtime.evaluate', { expression: `document.querySelector('.search input').focus()` });
      await send('Input.insertText', { text: process.env.TYPE });
      await sleep(500);
    }
    const h = FULL ? Math.min(v.h, 8000) : (w < 800 ? (+process.env.H || 844) : 1000);
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 });
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const name = `${(screen.replace(/\W+/g, '_').replace(/^_|_$/g, '') || 'home')}-${w}.png`;
    writeFileSync(`${OUT}/${name}`, Buffer.from(shot.result.data, 'base64'));
    report.push(`${screen} @${w}: overflow ${v.scroll - v.W}px${v.bad.length ? ' · ' + v.bad.join(', ') : ''}`);
  }
}
console.log(report.join('\n'));
ws.close(); chrome.kill(); await sleep(200); rmSync(profile, { recursive: true, force: true });
