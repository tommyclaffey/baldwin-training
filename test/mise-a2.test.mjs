// Mise colours A2 (Nov 21, Tommy: "A2"; Figma YEaa2NZIPbFqldCyUxrIEi, 09 · Idea Board section 46, exact values on the
// "A2 · for code" card 940:1522): a warm charcoal panel, one solid fig button per screen, a soft fig tint with a fig bar
// on the active nav item, tape blue for "new" and progress. Only the Mise look changes; the Custom Brand looks (The
// Baldwin, Testa Barra, J.Baldwin's) have none of it (their screens were compared pixel for pixel before and after).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const T = await import('../src/lib/theme.ts');

const M = T.THEMES.mise;
const CUSTOM = ['baldwin', 'testabarra', 'jbaldwins'];
const c = (role, i = 0) => T.color(M, role, i).toUpperCase();

test('the Mise roles are the A2 card’s values', () => {
  assert.equal(c('page'), '#EDE6DA'); assert.equal(c('card'), '#FBF8F2'); // Bone and Paper, unchanged
  assert.equal(c('inverse'), '#2E2622', 'the panel');
  assert.equal(c('inverseRaised'), '#3A302B'); assert.equal(c('inverseChip'), '#3D332E'); assert.equal(c('inverseLine'), '#4A3F39');
  assert.equal(c('onInverse'), '#EDE6DA'); assert.equal(c('onInverseMuted'), '#D9D4CB'); assert.equal(c('onInverseLabel'), '#A8A097');
  assert.equal(c('button'), '#121110', 'other filled buttons: Ink'); assert.equal(c('onButton'), '#EDE6DA');
  assert.equal(c('buttonOnDark'), '#EDE6DA'); assert.equal(c('onButtonOnDark'), '#121110');
  assert.equal(c('tape'), '#7BA5CB'); assert.equal(c('onTape'), '#121110'); assert.equal(c('new'), '#7BA5CB'); assert.equal(c('onNew'), '#121110');
  assert.equal(c('focus'), '#8E2A26'); assert.equal(c('focusBand'), '#EDE6DA');
  assert.deepEqual(M.primary, { fill: '#8E2A26', ink: '#EDE6DA', pressed: '#6E1F1C' });
  assert.deepEqual(M.navActive, { tint: '#8E2A26', tintO: 0.34, bar: '#8E2A26' });
  assert.deepEqual(M.progress, { onLight: '#3F6E99', onDark: '#7BA5CB' });
  assert.equal(M.control, '#121110');
  assert.deepEqual(M.demoPill, { tint: '#8E2A26', tintO: 0.42, ink: '#F6D3CE', muted: '#A8A097' });
});

// WCAG 2 contrast
const lum = (hex) => { const n = parseInt(hex.slice(1, 7), 16); const ch = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, bg, o) => '#' + [1, 3, 5].map((i) => Math.round(o * parseInt(fg.slice(i, i + 2), 16) + (1 - o) * parseInt(bg.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('').toUpperCase();

test('every changed pair passes: body 4.5:1, large text and UI 3:1 (two decorative pairs flagged)', () => {
  const P = '#2E2622';
  const tint = over(M.navActive.tint, P, M.navActive.tintO);
  assert.equal(tint, '#4F2723', 'the active tint over the panel = #4F2723 solid (A2 card)');
  const body = [
    ['#EDE6DA', P, 'titles on the panel'], ['#D9D4CB', P, 'nav labels'], ['#A8A097', P, 'muted labels on the panel'],
    ['#A8A097', '#3A302B', 'muted on raised'], ['#D9D4CB', '#3A302B', 'nav text on raised'], ['#EDE6DA', '#3D332E', 'counts on their chip'],
    ['#EDE6DA', tint, 'the active item’s label'], [M.primary.ink, M.primary.fill, 'the primary button label'], [M.primary.ink, M.primary.pressed, 'pressed'],
    ['#121110', '#7BA5CB', 'tape and new tags'], ['#EDE6DA', '#121110', 'Ink buttons'], ['#121110', '#EDE6DA', 'Bone buttons on the panel'],
    [M.demoPill.ink, over(M.demoPill.tint, P, M.demoPill.tintO), 'the DEMO tag'], [M.demoPill.muted, P, 'the demo product name'],
  ];
  for (const [fg, bg, what] of body) assert.ok(ratio(fg, bg) >= 4.5, `${what}: ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
  const ui = [
    ['#3F6E99', '#FBF8F2', 'progress on Paper'], ['#3F6E99', '#D9CFBF', 'progress against its track'], ['#7BA5CB', P, 'progress on the panel'],
    ['#7BA5CB', '#3A302B', 'progress on a raised card'], [M.primary.fill, '#EDE6DA', 'the fig button on Bone'], [M.primary.fill, '#FBF8F2', 'the fig button on Paper'],
    ['#8E2A26', '#EDE6DA', 'the focus ring on Bone'], ['#EDE6DA', P, 'the focus band on the panel'], ['#7F776F', P, 'outlines on the panel'],
  ];
  for (const [fg, bg, what] of ui) assert.ok(ratio(fg, bg) >= 3, `${what}: ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
  // Flagged on the A2 card, decorative only (the Bone label carries the active state): the tint and the bar on the panel
  assert.ok(ratio(tint, P) < 1.3 && ratio(M.navActive.bar, P) < 2, 'the flagged pairs are what the card says (1.2:1, 1.8:1)');
});

test('the Custom Brand looks have none of it', () => {
  for (const b of CUSTOM) {
    const t = T.THEMES[b];
    for (const k of ['primary', 'navActive', 'progress', 'control', 'sidebarCounts', 'newTags']) assert.equal(t[k], undefined, `${b}.${k}`);
    assert.equal(t.activeNav, 'drawn', b);
    const vars = T.themeVars(t);
    for (const k of ['--c-primary', '--nav-active-tint', '--c-progress', '--c-control', '--c-unread']) assert.equal(vars[k], undefined, `${b} ${k}`);
  }
  const vars = T.themeVars(M);
  assert.equal(vars['--c-primary'], '#8E2A26'); assert.equal(vars['--c-inverse'], '#2E2622'); assert.equal(vars['--nav-active-tint'], 'rgb(142 42 38 / 0.34)');
});

const load = (f) => JSON.parse(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.c || []).forEach((x) => all(x, f, out)); return out; };
const lessonPage = () => ({ id: 'x', name: 'Lesson · Gin styles', bg: '#F2EEE7', main: { t: 'F', n: 'Main', w: 1176, h: 900, lm: 'V', c: [
  { t: 'F', n: 'Player', w: 1080, h: 600, lm: 'H', c: [
    { t: 'F', n: 'Lesson', w: 700, h: 600, lm: 'V', c: [{ t: 'F', n: 'Under the video', w: 700, h: 100, c: [] }] },
    { t: 'F', n: 'Playlist', w: 330, h: 600, lm: 'V', c: [
      { t: 'F', n: 'Button · Next', w: 314, h: 41, r: 10, f: [{ c: '#1E1C1A' }], c: [{ t: 'T', n: 'Next', s: 'Next: Gin at the bar', ff: 'Archivo', fs: 'Bold', z: 14, w: 200, h: 18, f: [{ c: '#F2EEE7' }] }] },
    ] },
  ] },
] } });

test('one main action per drawn page in Mise (Home, a dish, a cocktail, a lesson), painted fig with a Bone label', () => {
  const cases = [
    [load('public/content/pages/4-2.json'), 'Button · Continue'], // Home: Your Training's Start Next Quiz
    [load('content/templates/9-2.json'), 'Button · Sign Off'], // a dish: Sign Off This Dish
    [load('content/templates/87-12.json'), 'Button · Open spec'], // a house cocktail: Open the Spec
    [lessonPage(), 'Button · Next'], // a lesson: Next
  ];
  for (const [page, name] of cases) {
    const out = T.themePage(page, M).main;
    const pri = all(out, (n) => n.pri === 1);
    assert.equal(pri.length, 1, `${page.name}: one primary`);
    assert.equal(pri[0].n, name, page.name);
    assert.equal(pri[0].f[0].c, '#8E2A26', page.name);
    for (const t of all(pri[0], (n) => n.t === 'T')) assert.equal(t.f[0].c, '#EDE6DA', `${page.name}: label`);
    for (const b of CUSTOM) assert.equal(all(T.themePage(page, T.THEMES[b]).main, (n) => n.pri === 1).length, 0, `${b} ${page.name}`);
  }
});

test('a dark control on light is Ink; a dark card or band is the panel', () => {
  const main = { t: 'F', n: 'Main', w: 1176, h: 800, lm: 'V', c: [
    { t: 'F', n: 'Button · Pre-Shift Quiz', w: 150, h: 40, r: 12, f: [{ c: '#1E1C1A' }], c: [{ t: 'T', n: 'Quick Quiz', s: 'Quick Quiz', ff: 'Archivo', z: 14, w: 80, h: 18, f: [{ c: '#F2EEE7' }] }] },
    { t: 'F', n: 'Band', w: 1080, h: 300, r: 22, f: [{ c: '#1E1C1A' }], c: [{ t: 'T', n: 'Copy', s: 'Copy', ff: 'Archivo', z: 16, w: 80, h: 18, f: [{ c: '#F2EEE7' }] }] },
  ] };
  const out = T.themePage({ id: 'x', name: 'Some page', bg: '#F2EEE7', main }, M).main;
  assert.equal(out.c[0].f[0].c, '#121110', 'the button: Ink');
  assert.equal(out.c[1].f[0].c, '#2E2622', 'the band: the panel');
  assert.equal(out.c[1].c[0].f[0].c, '#EDE6DA', 'its type: Bone');
  for (const b of CUSTOM) { const o = T.themePage({ id: 'x', name: 'Some page', bg: '#F2EEE7', main }, T.THEMES[b]).main; assert.equal(o.c[0].f[0].c, o.c[1].f[0].c, `${b}: both the look’s panel, as drawn`); }
});

test('progress is tape blue and "new" tags are filled tape in Mise; the Custom Brand looks keep the drawn accent and outline', () => {
  const home = load('public/content/pages/4-2.json');
  const out = T.themePage(home, M).main;
  const bar = all(out, (n) => n.n === 'Progress')[0];
  assert.equal(bar.c[0].f[0].c, '#3F6E99', 'Home’s Your Training bar, on a light card');
  const tags = all(out, (n) => n.n === 'Tag' && (n.c || []).some((x) => /^NEW\b/.test(x.s || '')));
  assert.ok(tags.length >= 1);
  for (const t of tags) { assert.equal(t.f[0].c, '#7BA5CB'); assert.equal(t.st, undefined); assert.equal(t.c.find((x) => x.t === 'T').f[0].c, '#121110'); }
  for (const b of CUSTOM) {
    const o = T.themePage(home, T.THEMES[b]).main;
    assert.equal(all(o, (n) => n.n === 'Progress')[0].c[0].f[0].c.toUpperCase(), T.color(T.THEMES[b], 'accentOnLight').toUpperCase(), b);
    assert.ok(all(o, (n) => n.n === 'Tag' && !!n.st).length >= 1, `${b}: tags stay outlined`);
  }
});

test('the A2 styles apply only under the Mise look (.brand-mise)', () => {
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')).filter((r) => r.length === 2);
  const uses = rules.filter(([, body]) => /var\(--(c-primary|c-on-primary|c-primary-pressed|nav-active-tint|nav-active-bar|c-progress|c-progress-on-dark|c-control|c-unread|c-on-unread)\)/.test(body));
  assert.ok(uses.length >= 8, 'the A2 rules are there');
  for (const [sel] of uses) for (const one of sel.split(/,(?![^(]*\))/)) assert.match(one.trim(), /^\.brand-mise /, one.trim());
});
