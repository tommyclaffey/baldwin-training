// The theme layer (Nov 12, src/lib/theme.ts): The Baldwin's look must stay exactly as drawn, and every brand gets the same
// layouts. (A full check against every page of both demos was run by hand on Nov 12: The Baldwin 1061/1061 pages identical
// outside the new heroes.)
import test from 'node:test';
import assert from 'node:assert/strict';
const T = await import('../src/lib/theme.ts');

test('every drawn colour is The Baldwin’s own value for its role (so The Baldwin paints as drawn)', () => {
  for (const [ctx, map] of Object.entries(T.DRAWN)) for (const [hex, ref] of Object.entries(map)) {
    const [role, step] = ref.split('.');
    assert.equal(T.color(T.THEMES.baldwin, role, Number(step || 0)).toUpperCase(), hex, `${ctx} ${hex} → ${ref}`);
  }
});

test('every brand fills every role', () => {
  const roles = Object.keys(T.THEMES.baldwin.colors);
  for (const b of Object.values(T.THEMES)) { assert.deepEqual(Object.keys(b.colors).sort(), [...roles].sort(), b.brand); assert.deepEqual(Object.keys(b.type).sort(), Object.keys(T.THEMES.baldwin.type).sort()); }
});

const page = (main, name = 'Some page') => ({ id: 'x', name, bg: '#F2EEE7', main });
const txt = (s, o = {}) => ({ t: 'T', n: s, s, ff: 'Archivo', fs: 'Regular', z: 16, w: 100, h: 20, f: [{ c: '#1E1C1A' }], ...o });

test('a drawn page comes out unchanged in The Baldwin, repainted in Mise', () => {
  const main = { t: 'F', n: 'Main', w: 1176, h: 800, lm: 'V', c: [
    { t: 'F', n: 'Card', w: 500, h: 200, r: 18, lm: 'V', f: [{ c: '#FBF9F5' }], st: '#E4DCCF', c: [txt('SECTION', { fs: 'ExtraBold', z: 26 }), txt('BODY COPY', { f: [{ c: '#5E574F' }] }), txt('LABEL', { fs: 'Bold', z: 11 })] },
  ] };
  assert.deepEqual(T.themePage(page(main), T.THEMES.baldwin).main, main);
  const m = T.themePage(page(main), T.THEMES.mise).main.c[0];
  assert.equal(m.f[0].c, '#FBF8F2'); assert.equal(m.st, '#D9CFBF');
  assert.equal(m.c[0].s, 'Section'); assert.equal(m.c[0].fs, 'SemiBold');
  assert.equal(m.c[2].ff, 'DM Mono');
});

const cocktail = () => ({ t: 'F', n: 'Main', w: 1176, h: 900, lm: 'V', c: [
  { t: 'F', n: 'Hero', w: 1080, h: 329, lm: 'H', f: [{ c: '#1E1C1A' }], r: 22, c: [
    { t: 'R', n: 'IMG/Old Fashioned', w: 400, h: 329, f: [{ img: '/img/x.jpg', m: 'FILL' }] },
    { t: 'F', n: 'Copy', w: 680, h: 329, lm: 'V', c: [
      { t: 'F', n: 'Tags', w: 100, h: 23, lm: 'H', c: [] },
      txt('The original cocktail', { ff: 'Pinyon Script', z: 28, f: [{ c: '#C49A6C' }] }),
      txt('OLD FASHIONED', { fs: 'ExtraBold', z: 52, f: [{ c: '#F2EEE7' }] }),
      txt('Whiskey, sugar, bitters.', { f: [{ c: '#E2DACF' }] }),
    ] },
  ] },
] });

test('the cinematic hero is the same layout in every brand; only the paint and accent differ', () => {
  for (const b of ['baldwin', 'mise']) {
    const hero = T.themePage(page(cocktail(), 'Classic · Old Fashioned'), T.THEMES[b]).main.c[0];
    assert.deepEqual(hero.c.map((c) => c.n.split(' · ')[0]), ['Copy', 'Hero photo'], b); // copy left, photo right
    assert.equal(hero.c[1].w, 640); assert.equal(hero.h, 560);
    assert.equal(hero.f[0].c, T.color(T.THEMES[b], 'inverse'));
  }
  const bal = T.themePage(page(cocktail(), 'Classic · Old Fashioned'), T.THEMES.baldwin).main.c[0].c[0].c;
  assert.equal(bal[1].ff, 'Pinyon Script'); assert.equal(bal[2].ff, 'Archivo'); assert.equal(bal[2].s, 'OLD FASHIONED');
  const mise = T.themePage(page(cocktail(), 'Classic · Old Fashioned'), T.THEMES.mise).main.c[0].c[0].c;
  assert.equal(mise[1].n, 'Taped note'); assert.equal(mise[2].ff, 'Instrument Serif'); assert.equal(mise[2].s, 'Old Fashioned');
});
