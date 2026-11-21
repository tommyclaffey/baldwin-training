// Keyboard pass (Nov 21, launch checklist stage 11: "manual keyboard … pass not recorded"). Drives both demos (The
// Baldwin's and the Mise demo) in headless Chrome as an employee and a manager, at 1440 and 390, with real key presses
// (Tab, Shift+Tab, Enter, Escape) and checks:
//   • skip link: the first Tab lands on "Skip to content", visible; Enter on it puts the next Tab inside the page content
//   • every stop: a visible focus ring, on something that's on screen and not hidden; no positive tabindex; no stop that
//     holds focus (a trap); the order follows the page (no jumps back up the page)
//   • clickable things a keyboard can't reach (pointer cursor, not a link, button, field or tab stop)
//   • overlays: the welcome card, the tour, the quiz box, the video player, Team Chat, the phone menu, Edit Mode and its
//     edit sheet, the bottle scanner: focus goes in, Tab stays in (modal) or can leave (not modal), Escape closes, and focus
//     comes back to where it was
// Runs with reduced motion on (a headless tab can leave a fade-in at its first frame).
// What it can't judge: whether a screen reader reads it well (VoiceOver needs a person).
// Usage: node scripts/keyboard-pass.mjs [baseUrl] [--json out.json]   (default http://127.0.0.1:8091; CHROME=… to choose)
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--') && /^https?:/.test(a)) || 'http://127.0.0.1:8091').replace(/\/$/, '');
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome found. Set CHROME=/path/to/chrome.'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = ['/', '/food-matrix', '/the-bar/cocktails', '/the-bar/wine', '/wine/red/cabernet', '/allergen-guide', '/steps-of-service', '/quizzes', '/my-path',
  '/cocktail-program', '/cocktail-program/level-4/bar-l4-law', '/beer-program/level-1', '/sommelier-program', '/team-chat', '/prep'];
const MANAGER_PAGES = ['/admin', '/admin/people', '/admin/bottle-scanner'];
const MAX_STOPS = 400;

async function browser() {
  const port = 21000 + Math.floor(Math.random() * 2000); const profile = `/tmp/mise-kbd-${process.pid}-${port}`;
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 150 && !ws; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); if (t) ws = new WebSocket(t.webSocketDebuggerUrl); } catch {} await sleep(200); }
  if (!ws) throw new Error('Chrome did not start');
  if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('JS error: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  // no animations: a headless tab can leave a fade-in at its first frame (the page's own reduced-motion rules apply)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // the tab acts as the focused window, so focus events and animation frames run as they do for a person
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }); await send('Page.bringToFront');
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  const size = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 800 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 800 });
  const go = async (url, wait = 2200) => { await send('Page.navigate', { url }); await sleep(wait); };
  const KEYS = { Tab: [9, 'Tab'], Escape: [27, 'Escape'], Enter: [13, 'Enter'] };
  const key = async (k, shift = false) => {
    const [vk, code] = KEYS[k]; const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(k === 'Tab' ? 40 : 500);
  };
  const close = () => { try { ws.close(); } catch {} proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { ev, size, go, key, close, errors };
}

// What has focus now. Each element gets a number the first time it's seen, so a repeat (a loop, a trap) shows.
const FOCUS = `(()=>{const a=document.activeElement;if(!a||a===document.body||a===document.documentElement)return {body:true};
window.__kpn=window.__kpn||0;if(!a.dataset.kp)a.dataset.kp=String(++window.__kpn);
const r=a.getBoundingClientRect();const cs=getComputedStyle(a);
const has=(s)=>s&&((s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0)||(s.boxShadow&&s.boxShadow!=='none'));
const pseudo=['::after','::before'].some(p=>{const s=getComputedStyle(a,p);return s.content&&s.content!=='none'&&has(s)});
const inner=[...a.querySelectorAll('*')].slice(0,30).some(x=>{const s=getComputedStyle(x);return has(s)&&s.outlineStyle!=='none'});
let op=1,zero='';for(let e=a;e&&e!==document.body;e=e.parentElement){const o=parseFloat(getComputedStyle(e).opacity);op*=o;if(o<0.05&&!zero)zero=(e.id||String(e.className).slice(0,30))}
const why=!(r.width>0&&r.height>0)?'no size':cs.visibility==='hidden'?'visibility':a.closest('[aria-hidden="true"],[inert]')?'aria-hidden':op<0.05?'opacity '+op.toFixed(2)+' at '+zero:'';
const hidden=!!why;
let up=false;for(let e=a.parentElement,i=0;e&&i<4;e=e.parentElement,i++){const s=getComputedStyle(e);if(e.matches(':focus-within')&&has(s)){up=true;break}}
const inView=r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
const label=(a.getAttribute('aria-label')||a.getAttribute('title')||a.innerText||a.value||a.getAttribute('alt')||a.getAttribute('data-name')||'').trim().replace(/\\s+/g,' ').slice(0,60);
const dlg=a.closest('[role=dialog],[role=alertdialog]');
return {kp:a.dataset.kp,tag:a.tagName.toLowerCase(),cls:String(a.className&&a.className.baseVal!==undefined?a.className.baseVal:a.className).slice(0,50),label,ring:has(cs)||pseudo||inner||up||a.tagName==='IFRAME',hidden,why,inView,iframe:a.tagName==='IFRAME',
 x:Math.round(r.left+scrollX),y:Math.round(r.top+scrollY),tabindex:a.getAttribute('tabindex'),dialog:dlg?(dlg.getAttribute('aria-label')||dlg.className||'dialog').slice(0,40):null,
 inSide:!!a.closest('#side'),inContent:!!a.closest('#content'),skip:a.classList.contains('skip')}})()`;
// Clickable things a keyboard can't get to: a pointer cursor on something that isn't a control, with no control round it.
const UNREACHABLE = `(()=>{const ok='a[href],button,input,select,textarea,summary,label,[tabindex],[contenteditable=true]';const out=[];const tab='a[href],button:not([disabled]),input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
for(const el of document.querySelectorAll('#content *,#side *,.tcp *')){if(getComputedStyle(el).cursor!=='pointer')continue;if(el.closest(ok))continue;if(el.querySelector(tab))continue;
 const r=el.getBoundingClientRect();if(!(r.width>0&&r.height>0))continue;if(el.parentElement&&getComputedStyle(el.parentElement).cursor==='pointer'&&!el.parentElement.closest(ok))continue;
 out.push((el.getAttribute('data-name')||el.className||el.tagName).toString().slice(0,50)+' «'+(el.innerText||'').trim().replace(/\\s+/g,' ').slice(0,30)+'»');}
return out.slice(0,12)})()`;
const POSITIVE = `[...document.querySelectorAll('[tabindex]')].filter(e=>Number(e.getAttribute('tabindex'))>0).map(e=>e.outerHTML.slice(0,80))`;
const OPEN_DIALOGS = `[...document.querySelectorAll('[role=dialog],[role=alertdialog],.dw,.tour-card,.qm,.tcp,.modal')].filter(d=>{const r=d.getBoundingClientRect();return r.width>0&&r.height>0}).map(d=>(d.getAttribute('aria-label')||d.className).toString().slice(0,40))`;

/** Tab through the page from the top: every stop, until focus comes back round to the first one. */
async function walk(b) {
  await b.ev(`(window.scrollTo(0,0),(document.querySelector('a.skip')||document.body).focus(),true)`);
  const stops = []; let stuck = 0, last = null;
  { const f0 = await b.ev(FOCUS); if (f0 && !f0.body) { stops.push(f0); last = f0; } }
  for (let i = 0; i < MAX_STOPS; i++) {
    await b.key('Tab');
    let f = await b.ev(FOCUS);
    if (f && (f.hidden || !f.ring)) { await sleep(400); f = await b.ev(FOCUS); } // a fade-in (a hover button shown on focus) gets its time
    if (!f || f.body) { if (stops.length && stops.at(-1).body) break; stops.push({ body: true }); continue; }
    if (last && f.kp === last.kp) { if (++stuck >= (f.iframe ? 40 : 3)) { stops.push({ ...f, stuck: true }); break; } continue; } else stuck = 0;
    if (stops.some((s) => s.kp === f.kp)) break; // round the loop
    stops.push(f); last = f;
  }
  return stops;
}

const results = []; // { tag, page, problems: [...] , stops }
function report(tag, page, problems, extra = {}) { results.push({ tag, page, problems, ...extra }); if (problems.length) for (const p of problems) console.log(`  ✖ ${tag} ${page}: ${p}`); }

async function checkPage(b, tag, page, width) {
  await b.go(BASE + page, 2600);
  // a dialog that opens by itself (the welcome card on Home) is checked in overlays(); close it here
  for (let i = 0; i < 2 && (await b.ev(OPEN_DIALOGS))?.length; i++) await b.key('Escape');
  const problems = [];
  // skip link
  // start from the top of the document, as a fresh page does (a temporary mark before everything takes focus, then goes)
  await b.ev(`(()=>{window.scrollTo(0,0);const m=document.createElement('span');m.tabIndex=-1;document.body.prepend(m);m.focus();m.remove();return true})()`);
  await b.key('Tab');
  const first = await b.ev(FOCUS);
  if (!first?.skip) problems.push(`first Tab lands on ${first?.body ? 'nothing' : `"${first.label}" (${first.tag})`}, not Skip to content`);
  else {
    if (!first.inView || first.hidden) problems.push('Skip to content is focused but not on screen');
    if (!first.ring) problems.push('Skip to content has no visible focus ring');
    await b.key('Enter'); await b.key('Tab');
    const next = await b.ev(FOCUS);
    if (!next?.inContent) problems.push(`after Skip to content, Tab goes to "${next?.label}" (${next?.inSide ? 'sidebar' : next?.tag}), not the page`);
  }
  // every stop
  const stops = await walk(b);
  const real = stops.filter((s) => !s.body);
  const noRing = real.filter((s) => !s.ring && !s.hidden), hidden = real.filter((s) => s.hidden), stuck = real.filter((s) => s.stuck);
  if (noRing.length) problems.push(`${noRing.length} stops with no visible focus ring: ${[...new Set(noRing.map((s) => `"${s.label}" (${s.tag}.${s.cls.split(' ')[0]})`))].slice(0, 6).join(', ')}`);
  if (hidden.length) problems.push(`${hidden.length} stops on hidden things: ${[...new Set(hidden.map((s) => `"${s.label}" (${s.tag}.${s.cls.split(" ")[0]}, ${s.why})`))].slice(0, 6).join(', ')}`);
  if (stuck.length) problems.push(`focus stuck on "${stuck[0].label}"`);
  if (real.length >= MAX_STOPS - 1) problems.push(`more than ${MAX_STOPS} stops (or a loop that never comes back round)`);
  // order: within the page content, each stop is below (or level with and right of) the one before, give or take
  if (process.env.DEBUG_STOPS) console.log(real.map((s, i) => `${i} ${s.y} ${s.tag}.${s.cls.split(' ')[0]} "${s.label}" ${s.ring ? '' : 'NO-RING '}${s.hidden ? 'HIDDEN(' + s.why + ') ' : ''}${s.inSide ? 'side' : s.inContent ? 'content' : ''}`).join('\n'));
  const content = real.filter((s) => s.inContent && !s.dialog);
  const jumps = [];
  for (let i = 1; i < content.length; i++) { const a = content[i - 1], c = content[i]; if (c.y < a.y - 600 && !(c.x > a.x + 200)) jumps.push(`"${a.label}" → "${c.label}" (${a.y}→${c.y})`); }
  if (jumps.length) problems.push(`${jumps.length} jumps back up the page: ${jumps.slice(0, 3).join('; ')}`);
  // Shift+Tab walks back
  if (content.length > 3) {
    const [p0, p1] = content.slice(-2);
    await b.ev(`(document.querySelector('[data-kp="${p1.kp}"]')||document.body).focus()`);
    await b.key('Tab', true); const back = await b.ev(FOCUS);
    if (back?.kp !== p0.kp) problems.push(`Shift+Tab from "${p1.label}" lands on "${back?.label || 'nothing'}", not "${p0.label}"`);
  }
  const pos = await b.ev(POSITIVE); if (pos?.length) problems.push(`positive tabindex: ${pos.slice(0, 3).join(' | ')}`);
  const un = await b.ev(UNREACHABLE); if (un?.length) problems.push(`clickable but not reachable by keyboard: ${un.slice(0, 6).join(', ')}`);
  report(tag, page, problems, { stops: real.length, width });
}

/** Focus a control by its label (keyboard users get there by Tab; this just saves 200 presses), then press Enter. */
const focusBy = (b, sel, re) => b.ev(`(()=>{const x=[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&${re}.test((e.getAttribute('aria-label')||e.innerText||'').trim())});if(!x)return false;x.focus();return document.activeElement===x})()`);

/** An overlay: open it, Tab 25 times, Escape. modal = Tab must stay in it. */
async function overlay(b, tag, name, { open, inside, modal = true, closes = true, restore = true, isOpen = null, press = true }) {
  const openExpr = isOpen || `(()=>{const d=document.querySelector(${JSON.stringify(inside)});if(!d)return false;const r=d.getBoundingClientRect();return r.width>0&&r.height>0})()`;
  const problems = [];
  const opened = await open(); // focuses the control that opens it (a keyboard user gets there by Tab)
  if (!opened) { report(tag, name, [], { skipped: 'could not open here' }); return; }
  const before = await b.ev(FOCUS);
  if (press) await b.key('Enter');
  await sleep(1500);
  const isIn = () => b.ev(`!!document.activeElement&&!!document.activeElement.closest(${JSON.stringify(inside)})`);
  if (!(await b.ev(openExpr))) { report(tag, name, ['did not open']); return; }
  if (!(await isIn())) { const f = await b.ev(FOCUS); problems.push(`focus didn't move into it (on "${f?.label || 'nothing'}")`); }
  let left = 0, noRing = 0, seen = new Set(), stuck = 0, prev = null;
  for (let i = 0; i < 25; i++) {
    await b.key('Tab');
    const f = await b.ev(FOCUS);
    if (!(await isIn())) left++;
    else if (f && !f.body) { if (!f.ring) noRing++; seen.add(f.kp); if (prev === f.kp) stuck++; prev = f.kp; }
  }
  if (modal && left) problems.push(`Tab left it ${left} of 25 times (it's modal: focus should stay in)`);
  if (!modal && !left && seen.size > 1) problems.push('Tab never leaves it (it isn’t modal: that’s a trap)');
  if (noRing) problems.push(`${noRing} stops inside with no visible focus ring`);
  const controls = await b.ev(`document.querySelector(${JSON.stringify(inside)})?.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])').length||0`);
  if (stuck > 20 && seen.size <= 1 && controls > 1) problems.push('focus stuck on one control');
  // Shift+Tab too
  if (modal) { let l2 = 0; for (let i = 0; i < 8; i++) { await b.key('Tab', true); if (!(await isIn())) l2++; } if (l2) problems.push(`Shift+Tab left it ${l2} of 8 times`); }
  if (closes) {
    await b.key('Escape'); await sleep(600);
    const still = await b.ev(openExpr);
    if (still) problems.push('Escape did not close it');
    else if (restore) {
      const f = await b.ev(FOCUS);
      if (f?.body) problems.push('after Escape, focus is lost (on nothing)');
      else if (before && !before.body && f.kp !== before.kp) problems.push(`after Escape, focus is on "${f.label}", not back on "${before.label}"`);
    }
  }
  report(tag, name, problems, { seen: seen.size });
}

const settle = async (b, url, wait = 2600) => { await b.go(BASE + url, wait); for (let i = 0; i < 2 && (await b.ev(OPEN_DIALOGS))?.length; i++) await b.key('Escape'); };
async function overlays(b, tag, role, width, demo) {
  // the welcome card opens on Home after the demo starts
  await b.go(BASE + '/', 3200);
  await overlay(b, tag, 'welcome card', { open: async () => !!(await b.ev(`!!document.querySelector('.dw')`)), inside: '.dw', restore: false, press: false });
  // the tour (from the welcome card's Take the Tour, or the demo bar's Show Me Around)
  await b.go(BASE + '/', 2600); for (let i = 0; i < 2 && (await b.ev(OPEN_DIALOGS))?.length; i++) await b.key('Escape');
  await overlay(b, tag, 'tour', { inside: '.tour-card', modal: true, restore: true,
    open: async () => focusBy(b, '.demo-bar button', '/Show Me Around|^Tour$/') });
  // the quiz box
  await b.go(BASE + '/quizzes', 2600); for (let i = 0; i < 2 && (await b.ev(OPEN_DIALOGS))?.length; i++) await b.key('Escape');
  await overlay(b, tag, 'quiz box', { inside: '.qm',
    open: async () => focusBy(b, '#content button, #content a', '/^Quick Quiz$/') });
  // the video player (the Cocktail Program's Start Here videos)
  await settle(b, '/cocktail-program', 3000);
  await overlay(b, tag, 'video player', { inside: '.video-modal',
    open: async () => focusBy(b, '.play-overlay', '/Play/') });
  // a photo, full size (a plating photo on a dish page)
  await settle(b, '/photo-library');
  await overlay(b, tag, 'photo (full size)', { inside: '.photo-modal',
    open: async () => { const ok = await b.ev(`(()=>{const x=[...document.querySelectorAll('#content [data-name^="Photo · "]')].find(e=>e.getBoundingClientRect().width>0&&e.tabIndex>=0);if(!x)return false;x.focus();return document.activeElement===x})()`); return !!ok; } });
  // Team Chat: a panel beside the page on a laptop (not modal), a sheet on a phone (modal)
  await b.go(BASE + '/', 2600); for (let i = 0; i < 2 && (await b.ev(OPEN_DIALOGS))?.length; i++) await b.key('Escape');
  await overlay(b, tag, 'Team Chat panel', { inside: '.tcp', modal: width < 800,
    open: async () => focusBy(b, width < 800 ? '.chat-btn' : '#side button, #side a', '/Team Chat/') });
  // the phone menu
  if (width < 800) {
    await b.go(BASE + '/', 2600); for (let i = 0; i < 2 && (await b.ev(OPEN_DIALOGS))?.length; i++) await b.key('Escape');
    await overlay(b, tag, 'phone menu', { inside: '#side, .menu-btn', modal: true, isOpen: `!!document.querySelector('.shell.menu-open')`,
      open: async () => focusBy(b, '.menu-btn', '/Open menu/') });
  }
  if (role === 'manager') {
    // Edit Mode: on, Tab through the page (no trap), open an edit sheet, Escape, off
    await settle(b, '/food-matrix');
    const on = await focusBy(b, '.em-toggle, .em-card-btn', '/Turn on Edit Mode/i');
    if (on) {
      await b.key('Enter'); await sleep(1200);
      const stops = await walk(b);
      const p = [];
      if (stops.some((s) => s.stuck)) p.push('focus stuck in Edit Mode');
      const noRing = stops.filter((s) => !s.body && !s.ring && !s.hidden);
      if (noRing.length) p.push(`${noRing.length} stops with no visible focus ring: ${[...new Set(noRing.map((s) => `"${s.label}" (${s.tag})`))].slice(0, 5).join(', ')}`);
      report(tag, 'Edit Mode (on, Food Matrix)', p, { stops: stops.length });
      await overlay(b, tag, 'Edit Mode · edit sheet', { inside: '.eip-panel',
        open: async () => { // a dish page (the first row of the Food Matrix, opened by keyboard), then More Fields
          if (!(await b.ev(`(()=>{const x=document.querySelector('#content a.row-link');if(!x)return false;x.focus();return true})()`))) return false;
          await b.key('Enter'); await sleep(2500); return focusBy(b, 'button', '/^More Fields$/'); } });
      await focusBy(b, '.em-toggle, .em-card-btn', '/Turn off Edit Mode/i') && await b.key('Enter');
    } else report(tag, 'Edit Mode', [], { skipped: 'no Edit Mode toggle here' });
    // the bottle scanner (Admin → Bottle Scanner)
    await settle(b, '/admin/bottle-scanner', 3500);
    await overlay(b, tag, 'bottle scanner', { inside: '.modal.scanner',
      open: async () => { const ok = await b.ev(`(()=>{const x=[...document.querySelectorAll('button')].find(e=>e.getBoundingClientRect().width>0&&/^Scan Bottle$/.test(e.innerText.trim()));if(!x)return false;x.focus();return true})()`); return !!ok; } });
  }
}

async function run(demo, role, width) {
  const b = await browser(); const tag = `${demo} ${role} @${width}`; let started = false;
  console.log(`▸ ${tag}`);
  try {
    await b.size(width);
    await b.go(BASE + (demo === 'mise' ? '/demo/mise' : '/demo'), 1500);
    const ok = await b.ev(`fetch('/api/demo/start',{method:'POST',headers:{'Content-Type':'application/json','X-BT':'1'},body:JSON.stringify({role:'${role}',demo:'${demo}'})}).then(r=>{sessionStorage.setItem('bt-demo-tab','1');return r.ok})`);
    if (!ok) throw new Error('demo did not start');
    started = true;
    await overlays(b, tag, role, width, demo);
    if (!process.env.OVERLAYS_ONLY) for (const p of [...PAGES, ...(role === 'manager' ? MANAGER_PAGES : [])]) await checkPage(b, tag, p, width);
    for (const e of [...new Set(b.errors)]) report(tag, 'console', [e]);
  } catch (e) { report(tag, 'run', [String(e.message || e)]); }
  finally {
    if (started) await Promise.race([b.ev(`fetch('/api/demo/exit',{method:'POST',headers:{'X-BT':'1'}}).then(r=>r.ok).catch(()=>false)`), sleep(15000)]).catch(() => {});
    b.close();
  }
}

if (process.env.DEBUG_PAGE) { const [demo, role, w] = (process.env.DEBUG_RUN || 'mise employee 1440').split(' '); const b = await browser(); await b.size(Number(w)); await b.go(BASE + (demo === 'mise' ? '/demo/mise' : '/demo'), 1500);
  await b.ev(`fetch('/api/demo/start',{method:'POST',headers:{'Content-Type':'application/json','X-BT':'1'},body:JSON.stringify({role:'${role}',demo:'${demo}'})}).then(r=>{sessionStorage.setItem('bt-demo-tab','1');return r.ok})`);
  if (process.env.DEBUG_OVERLAYS) await overlays(b, 'debug', role, Number(w), demo);
  if (process.env.DEBUG_KEYS) { await b.go(BASE + process.env.DEBUG_PAGE, 3500); for (const k of process.env.DEBUG_KEYS.split(';;')) { if (k.startsWith('eval:')) { console.log(JSON.stringify(await b.ev(k.slice(5)))); continue; } await b.key(k.replace('S-', ''), k.startsWith('S-')); console.log(k, JSON.stringify(await b.ev(FOCUS))); } b.close(); process.exit(0); }
  process.env.DEBUG_STOPS = '1'; await checkPage(b, 'debug', process.env.DEBUG_PAGE, Number(w)); await b.ev(`fetch('/api/demo/exit',{method:'POST',headers:{'X-BT':'1'}})`); b.close(); process.exit(0); }
const ONLY = process.env.RUNS ? process.env.RUNS.split(',') : null; // e.g. RUNS="mise manager 390"
for (const demo of ['baldwin', 'mise']) for (const role of ['employee', 'manager']) for (const width of [1440, 390]) {
  if (ONLY && !ONLY.includes(`${demo} ${role} ${width}`)) continue;
  await run(demo, role, width);
}
const bad = results.filter((r) => r.problems.length);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
console.log(`\n${results.length} checks, ${bad.length} with problems.`);
process.exit(bad.length ? 1 : 0);
