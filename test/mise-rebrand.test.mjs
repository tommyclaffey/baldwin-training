// The Mise rebrand (Nov 18, Tommy: "Sold. This is our branding."; handoff "(C) Mise — Rebrand Handoff for the App"): the
// Mise look serves the new logo files (Figma YEaa2NZIPbFqldCyUxrIEi exports, Tommy's garlic + fig unchanged inside them)
// and DM Serif Display; the Custom Brand looks (The Baldwin, Testa Barra, J.Baldwin's) use none of it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const T = await import('../src/lib/theme.ts');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-rebrand-'));
const PORT = 9000 + Math.floor(Math.random() * 200); // (a range no other test uses)
const BASE = `http://127.0.0.1:${PORT}`;
let server;
before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@rebrand.test', PREP_WEEKLY: 'off' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

// Figma image hashes (sha1 of the file) of Tommy's garlic + fig: cream (for dark backgrounds) and black (for light).
const FIG_CREAM = 'ed6c597e1a2333e3e0589ee7aa238f1178214ab8';
const FIG_BLACK = 'b20251d86edb8bfdf8febf97c86e884b58f2cc92';
const figIn = (svg) => [...svg.matchAll(/base64,([A-Za-z0-9+/=]+)/g)].map((m) => crypto.createHash('sha1').update(Buffer.from(m[1], 'base64')).digest('hex'));
const CUSTOM = ['baldwin', 'testabarra', 'jbaldwins'];
const files = (t) => [t.logo?.src, t.mark.src, t.hero?.src, t.drawnLogo?.src].filter(Boolean);

test('the Mise look serves the new logo files: mise in the nav, Mise Academy for big moments, Tommy’s fig inside each', async () => {
  const m = T.THEMES.mise;
  assert.equal(m.logo.src, '/img/mise-brand/mise-dark.svg'); assert.equal(m.mark.src, '/img/mise-brand/mise-dark.svg');
  assert.equal(m.hero.src, '/img/mise-brand/mise-academy-dark.svg', 'big moments: the Mise Academy lockup');
  assert.equal(m.logo.alt, 'Mise'); assert.equal(m.hero.alt, 'Mise Academy');
  assert.ok(m.logo.h >= 24 && m.mark.barH >= 24, 'mise is never under 24 px tall (brand guide 03 Logo)');
  for (const [src, fig] of [[m.logo.src, FIG_CREAM], [m.hero.src, FIG_CREAM], [T.MISE_ON_LIGHT, FIG_BLACK]]) {
    const res = await fetch(BASE + src);
    assert.equal(res.status, 200, src);
    assert.match(res.headers.get('content-type') || '', /image\/svg\+xml/, src);
    assert.deepEqual(figIn(await res.text()), [fig], `${src} carries Tommy’s fig, unchanged`);
  }
  // every export is in the repo (SVG + PNG @2x/@3x, light and dark), and the old lockups are archived, not deleted
  const out = fs.readdirSync(path.join(root, 'public/img/mise-brand'));
  for (const n of ['mise', 'mise-one-line', 'mise-academy', 'mise-academy-one-line', 'mise-wordmark']) for (const th of ['dark', 'light']) for (const ext of ['.svg', '@2x.png', '@3x.png']) assert.ok(out.includes(`${n}-${th}${ext}`), `${n}-${th}${ext}`);
  assert.ok(fs.existsSync(path.join(root, 'public/img/archive/mise-academy-lockup-cream.png')));
  const src = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /mise-academy-lockup-cream|mise-lockup-char/, 'nothing points at the old lockups');
  // the tape: torn, tape blue, no border
  const tape = await (await fetch(BASE + '/img/mise-tape.svg')).text();
  assert.match(tape, /fill="#7BA5CB"/); assert.doesNotMatch(tape, /stroke/);
});

test('the Mise look’s type: DM Serif Display, italic for page titles and heroes, upright for card titles; Instrument Serif is gone', async () => {
  const ty = T.THEMES.mise.type;
  assert.deepEqual([ty.pageTitle.ff, ty.pageTitle.fs, ty.pageTitle.z], ['DM Serif Display', 'Italic', 64]);
  assert.deepEqual([ty.cardTitle.ff, ty.cardTitle.fs], ['DM Serif Display', 'Regular']);
  assert.ok(T.FONTS['DM Serif Display']); assert.equal(T.FONTS['Instrument Serif'], undefined);
  const html = await (await fetch(BASE + '/')).text();
  assert.match(html, /family=DM\+Serif\+Display:ital@0;1/); assert.doesNotMatch(html, /Instrument/);
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /Instrument Serif/);
});

test('Custom Brand looks use none of it: no new logo file, no big-moment lockup, no DM Serif Display', () => {
  for (const id of CUSTOM) {
    const t = T.THEMES[id];
    for (const f of files(t)) assert.doesNotMatch(f, /mise/, `${id}: ${f}`);
    assert.equal(t.hero, undefined, `${id} has no Mise Academy lockup`);
    for (const [role, spec] of Object.entries(t.type)) assert.notEqual(spec.ff, 'DM Serif Display', `${id} ${role}`);
    assert.doesNotMatch(T.fontsUrl(t) || '', /Serif\+Display/, id);
    assert.equal(t.accentLine, 'script', `${id} keeps its script line, no tape`);
  }
});

const page = (main, name) => ({ id: 'x', name, bg: '#F2EEE7', main });
const txt = (s, o = {}) => ({ t: 'T', n: s, s, ff: 'Archivo', fs: 'Regular', z: 16, w: 100, h: 20, f: [{ c: '#1E1C1A' }], ...o });
const lesson = () => ({ t: 'F', n: 'Main', w: 1176, h: 900, lm: 'V', c: [
  { t: 'F', n: 'Player', w: 1080, h: 700, lm: 'H', c: [{ t: 'F', n: 'Lesson', w: 760, h: 700, lm: 'V', c: [
    { t: 'R', n: 'IMG/Section photo', w: 760, h: 428, f: [{ img: '/img/x.jpg', m: 'FILL' }] },
    { t: 'F', n: 'Under the video', w: 760, h: 120, lm: 'V', c: [
      { t: 'F', n: 'Titles', w: 760, h: 80, lm: 'V', c: [txt('SECTION 1 OF 6 · WHISKEY', { fs: 'Bold', z: 11 }), txt('WHAT WHISKEY IS', { fs: 'ExtraBold', z: 40 })] },
      txt('Video: How To Drink · 37:35'),
    ] },
  ] }] },
] });
const dish = (name) => ({ t: 'F', n: 'Main', w: 1176, h: 900, lm: 'V', c: [
  { t: 'F', n: 'Header', w: 1080, h: 420, lm: 'H', c: [
    { t: 'R', n: 'IMG/Dish', w: 500, h: 420, f: [{ img: '/img/x.jpg', m: 'FILL' }] },
    { t: 'F', n: 'Info', w: 560, h: 420, lm: 'V', c: [{ t: 'F', n: 'Titles', w: 560, h: 120, lm: 'V', c: [
      txt('The signature dish', { ff: 'Pinyon Script', z: 28, f: [{ c: '#8A5A3A' }] }), txt(name.toUpperCase(), { fs: 'ExtraBold', z: 52 }),
    ] }] },
  ] },
] });
const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };

test('title moments: Mise’s lesson opener gets one taped note (lowercase, −1.5°, torn tape), The Baldwin’s lesson stays as drawn', () => {
  const copy = (b) => T.themePage(page(lesson(), 'Lesson'), T.THEMES[b]).main.c[0].c[0];
  const m = copy('mise').c;
  assert.deepEqual(m.map((c) => c.n === 'Taped note' ? 'tape' : c.ff), ['DM Mono', 'tape', 'DM Serif Display', 'Archivo'], 'label, one tape note, the italic title, one Archivo line');
  const note = m[1];
  assert.equal(note.c[0].s, 'watch, then read'); assert.equal(note.rot, -1.5); assert.equal(note.f[0].img, '/img/mise-tape.svg');
  assert.equal(m[2].fs, 'Italic'); assert.equal(m[2].s, 'What Whiskey Is');
  const b = copy('baldwin').c;
  assert.equal(all({ c: b }, (x) => x.n === 'Taped note').length, 0, 'no tape in The Baldwin');
  assert.deepEqual(b.map((c) => c.ff), ['Archivo', 'Archivo', 'Archivo']);
  // one tape note per opener, never two, on dish pages too; and the note is lowercase
  const d = T.themePage(page(dish('Seared Scallops'), 'Recipe · Seared Scallops'), T.THEMES.mise).main;
  const notes = all(d, (x) => x.n === 'Taped note');
  assert.equal(notes.length, 1); assert.equal(notes[0].c[0].s, 'the signature dish');
});

test('long dish names still fit: a Mise hero title comes down just enough for its longest word, never below 34', () => {
  const title = (name) => all(T.themePage(page(dish(name), 'Recipe · ' + name), T.THEMES.mise).main, (x) => x.hd === 1)[0];
  assert.equal(title('Seared Scallops').z, 64, 'a short word keeps the full 64');
  const long = title('Prosciutto-Wrapped Pork Tenderloin');
  const lw = 'Prosciutto-Wrapped'.length;
  assert.ok(long.z < 64 && long.z >= 34, String(long.z));
  assert.ok(lw * 0.5 * long.z <= long.w, `the longest word fits its ${long.w} px box at ${long.z} px`);
  assert.equal(long.s, 'Prosciutto-Wrapped Pork Tenderloin', 'never shortened');
});

test('contrast on the rebranded pieces (body 4.5:1, large 3:1)', () => {
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const m = T.THEMES.mise; const c = (r) => T.color(m, r);
  for (const [what, fg, bg, need] of [
    ['tape note ink on tape', c('onTape'), c('tape'), 4.5],
    ['handwriting (cream) on Char', '#FDFBEF', c('inverse'), 4.5],
    ['"cold." (white) on Char', '#FFFFFF', c('inverse'), 3],
    ['hero title on Char', c('onInverse'), c('inverse'), 3],
    ['sign-in title on the card', c('ink'), c('card'), 3],
    ['page title on Bone', c('ink'), c('page'), 3],
  ]) assert.ok(ratio(fg, bg) >= need, `${what} ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
});
