// Browser smoke test (Nov 10, audit: "UI breaks are caught by eye only"). Opens the demo in headless Chrome as an
// employee and a manager, on a laptop and a phone, takes the whole tour and visits the main pages. Fails on:
// a tour step that doesn't find its target, a JavaScript error, a Content-Security-Policy violation, a page that
// scrolls sideways on a phone, or a "We couldn't find that page".
// Usage: node scripts/smoke.mjs [baseUrl]   (default http://127.0.0.1:8091; CHROME=/path/to/chrome to choose a browser)
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8091').replace(/\/$/, '');
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome found. Set CHROME=/path/to/chrome.'); process.exit(2); }
const PAGES = ['/', '/our-story', '/floor-plan', '/sommelier-program/about', '/food-matrix', '/the-bar/cocktails', '/the-bar/cocktail-specs', '/the-bar/wine', '/allergen-guide', '/quizzes', '/my-path', '/team-chat', '/team-chat/foh',
  '/cocktail-program', '/cocktail-program/level-1', '/cocktail-program/level-1/bar-l1-whiskey', '/cocktail-program/level-1/bar-l1-basics', '/cocktail-program/level-2', '/beer-program', '/beer-program/level-1', '/sommelier-program', '/sommelier-program/level-1', '/sommelier-program/level-2',
  '/hospitality-program', '/hospitality-program/level-1', '/hospitality-program/level-1/hosp-welcome',
  '/cocktail-program/level-2/bar-vodka-gin/gin-styles', '/certificate/bar-1',
  '/prep', '/prep/reports']; // Nov 12: the Prep tracker
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browser() {
  const port = 9500 + Math.floor(Math.random() * 400); const profile = `/tmp/mise-smoke-${process.pid}-${port}`;
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 100 && !ws; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); if (t) ws = new WebSocket(t.webSocketDebuggerUrl); } catch {} await sleep(200); }
  if (!ws) throw new Error('Chrome did not start');
  if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const problems = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') problems.push('JS error: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI))" });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  const size = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 800 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 800 });
  const go = async (url, wait = 1800) => { await send('Page.navigate', { url }); await sleep(wait); };
  const close = () => { try { ws.close(); } catch {} proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { ev, size, go, close, problems };
}

// Nov 11: both demos, The Baldwin's (/demo) and the Mise demo (/demo/mise, Wrenfield). DEMOS=baldwin or DEMOS=mise runs one.
async function run(role, width, demo = 'baldwin') {
  const b = await browser(); const tag = `${demo} ${role} @${width}`; const fails = [];
  try {
    await b.size(width);
    await b.go(BASE + (demo === 'mise' ? '/demo/mise' : '/demo'), 1200);
    const ok = await b.ev(`fetch('/api/demo/start',{method:'POST',headers:{'Content-Type':'application/json','X-BT':'1'},body:JSON.stringify({role:'${role}',demo:'${demo}'})}).then(r=>{sessionStorage.setItem('bt-demo-tab','1');return r.ok})`);
    if (!ok) throw new Error('demo did not start');
    await b.go(BASE + '/', 3000);
    if (!(await b.ev(`!!document.querySelector('.dw')`))) fails.push('welcome card did not open');
    await b.ev(`[...document.querySelectorAll('button')].find(b=>/Take the Tour/.test(b.textContent))?.click()`); await sleep(2200);
    let steps = 0;
    for (let i = 0; i < 30; i++) {
      const st = await b.ev(`(()=>{const c=document.querySelector('.tour-card');const hl=document.querySelector('.tour-hl');const r=hl&&hl.getBoundingClientRect();return {card:!!c,hl:!!(r&&r.width>0&&r.height>0),text:c?c.innerText.split('\\n').slice(0,2).join(' / '):'',path:location.pathname}})()`);
      if (!st?.card) { fails.push(`tour stopped at step ${i + 1} (${st?.path})`); break; }
      if (!st.hl) fails.push(`tour step ${i + 1} on ${st.path} has no target`);
      steps++;
      const next = await b.ev(`(()=>{const x=[...document.querySelectorAll('button')].find(b=>/^(Next|Finish)$/.test(b.textContent.trim()));if(!x)return 'none';const t=x.textContent.trim();x.click();return t})()`);
      if (next !== 'Next') break;
      await sleep(2200);
    }
    for (const p of PAGES) {
      await b.go(BASE + p, 1800);
      const r = await b.ev(`({missing:/couldn.t find that page/i.test(document.body.innerText),wide:document.documentElement.scrollWidth>innerWidth+1,csp:window.__csp||[]})`);
      if (r?.missing) fails.push(`${p}: page not found`);
      if (r?.wide && width < 800) fails.push(`${p}: scrolls sideways`);
      for (const v of r?.csp || []) fails.push(`${p}: CSP blocked ${v}`);
    }
    fails.push(...b.problems);
    console.log(`${fails.length ? '✖' : '✔'} ${tag}: ${steps} tour steps, ${PAGES.length} pages`);
  } catch (e) { fails.push(String(e.message || e)); console.log(`✖ ${tag}: ${e.message}`); }
  finally { b.close(); }
  return fails.map((f) => `${tag}: ${f}`);
}

const all = [];
const DEMOS = (process.env.DEMOS || 'baldwin,mise').split(',');
for (const demo of DEMOS) for (const [role, w] of [['employee', 1440], ['manager', 1440], ['employee', 390], ['manager', 390]]) all.push(...(await run(role, w, demo)));
if (all.length) { console.log('\n' + [...new Set(all)].join('\n')); process.exit(1); }
console.log('\nSmoke test passed.');
