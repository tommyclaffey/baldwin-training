// Chat buttons on items (Nov 11): which links get one, where it sits, and the gutters that keep it off the words.
// src/chat/sendable.ts is plain TypeScript with no React, so Node runs it directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardPlan, holderTarget, placeOf, shapeOf, shareable, slugOf, targetOf, withBand, withGutters } from '../src/chat/sendable.ts';

const pages = {
  'recipe/cacio-e-pepe': { title: 'Cacio e Pepe' },
  'signature/paloma-verde': { title: 'Paloma Verde' },
  'shelf/aperol': { title: 'Aperol' },
};
const lookup = (slug) => (pages[slug] ? { slug, title: pages[slug].title } : null);
const text = (s, w = 100) => ({ t: 'T', s, w, h: 16 });

test('shareable pages: items yes, hubs and home no', () => {
  assert.equal(shareable({ section: 'Recipe', file: '1-2' }), true);
  assert.equal(shareable({ section: 'Step 3', file: '5-2' }), true);
  assert.equal(shareable({ section: '', file: 'l-12' }), true); // a lesson
  assert.equal(shareable({ section: 'The Bar', file: '14-2' }), false);
  assert.equal(shareable({ section: '', file: '4-2' }), false);
  assert.equal(shareable(undefined), false);
});

test('slugOf: book links only', () => {
  assert.equal(slugOf('/recipe/cacio-e-pepe?x=1#top'), 'recipe/cacio-e-pepe');
  assert.equal(slugOf('/signature/paloma%20verde/'), 'signature/paloma verde');
  assert.equal(slugOf('https://winefolly.com'), null);
  assert.equal(slugOf('//evil.test/x'), null);
});

test('shapes: rows and cards get a button; nav, crumbs, pills, chips, texts and small links do not', () => {
  assert.equal(shapeOf({ t: 'F', n: 'Row · Cacio e Pepe', w: 814, h: 79, lm: 'H' }), 'row');
  assert.equal(shapeOf({ t: 'F', n: 'Spec · Paloma Verde', w: 502, h: 341, lm: 'H' }), 'card');
  assert.equal(shapeOf({ t: 'F', n: 'Lesson 01 · How wine is made', w: 258, h: 194, lm: 'V' }), 'card');
  for (const n of ['Nav · Food Matrix', 'Crumb · Whiskey', 'Button · Spec', 'Chip · France', 'Step tab 2', 'Back to parent', 'Sibling · Rye', 'Section · The vine'])
    assert.equal(shapeOf({ t: 'F', n, w: 300, h: 60, lm: 'H' }), null, n);
  assert.equal(shapeOf({ t: 'F', n: 'Signature · Paloma Verde', w: 136, h: 36 }), null); // a pill
  assert.equal(shapeOf({ t: 'T', n: 'Name', w: 288, h: 20 }), null); // a text link
  assert.equal(shapeOf({ t: 'F', n: 'Photo', w: 300, h: 300, skipTab: 1 }), null); // repeats its card's link
});

test('targetOf: only links to pages you can share, never outside links', () => {
  const row = { t: 'F', n: 'Row · Cacio e Pepe', w: 814, h: 79, lm: 'H', to: '/recipe/cacio-e-pepe' };
  assert.deepEqual(targetOf(row, lookup), { slug: 'recipe/cacio-e-pepe', title: 'Cacio e Pepe', shape: 'row' });
  assert.equal(targetOf({ ...row, to: '/the-bar/cocktails' }, lookup), null);
  assert.equal(targetOf({ ...row, to: 'https://example.test/' }, lookup), null);
  assert.equal(targetOf({ ...row, to: undefined }, lookup), null);
});

test('rows: a gutter at the end, and the same gutter on the rest of the table so columns stay lined up', () => {
  const header = { t: 'F', n: 'Column headers', w: 814, h: 39, lm: 'H', pd: [12, 20, 12, 20] };
  const row = { t: 'F', n: 'Row · Cacio e Pepe', w: 814, h: 79, lm: 'H', pd: [12, 20, 12, 20], to: '/recipe/cacio-e-pepe', c: [{ t: 'F', n: 'Dish', w: 300, h: 54, sh: 'F' }] };
  const other = { t: 'F', n: 'Note', w: 400, h: 20, lm: 'H' };
  const out = withGutters([header, row, other], { lm: 'V' }, (c) => targetOf(c, lookup)?.shape === 'row');
  assert.deepEqual(out[1].pd, [12, 62, 12, 20]);
  assert.equal(out[1].gut, 20);
  assert.deepEqual(out[0].pd, [12, 62, 12, 20]); // the header moves with it
  assert.equal(out[2], other); // a different width isn't part of the table
  assert.deepEqual(placeOf(out[1], 'row'), { right: 20 });
  // no padding: the button keeps 8 px from the edge
  const bare = withGutters([{ ...row, pd: undefined }], { lm: 'V' }, () => true)[0];
  assert.deepEqual(bare.pd, [0, 50, 0, 0]);
  assert.equal(bare.gut, 8);
});

test('a wrapping grid of cards at a row\'s width is not part of the table (Spirits: 3 cards a row, not 2)', () => {
  const band = { t: 'F', n: 'Whiskey family band', w: 1080, h: 76, lm: 'H', pd: [20, 24, 20, 24], to: '/shelf/aperol' };
  const grid = { t: 'F', n: 'Categories', w: 1080, h: 1706, lm: 'H', wrap: 1, gap: 20, c: [] };
  const out = withGutters([band, grid], { lm: 'V' }, (c) => targetOf(c, lookup)?.shape === 'row');
  assert.deepEqual(out[0].pd, [20, 66, 20, 24]); // the band keeps its gutter for the chat button
  assert.equal(out[1], grid);
});

test('rows of hugging parts: the name may shrink and wrap, the last part (prices) keeps its size', () => {
  const pour = { t: 'F', n: 'Pour · Taub', w: 480, h: 55, lm: 'H', to: '/shelf/aperol', c: [{ t: 'F', n: 'Name', w: 148, h: 32, sh: 'H' }, { t: 'F', n: 'Prices', w: 156, h: 15, sh: 'H' }] };
  const [out] = withGutters([pour], { lm: 'V' }, () => true);
  assert.equal(out.c[0].sh, 'L');
  assert.equal(out.c[1].sh, 'H');
});

test('cards: the photo corner, a band with its own gutter, or the card corner', () => {
  const spec = { t: 'F', w: 502, h: 341, lm: 'H', pd: [18, 18, 18, 18], c: [{ t: 'R', w: 190, h: 300, f: [{ img: '/img/a.jpg' }] }, { t: 'F', w: 254, h: 303 }] };
  assert.deepEqual(cardPlan(spec), { top: 26, right: 302 }); // over the photo's top-right corner
  const band = { t: 'F', n: 'Color band', w: 344, h: 49, lm: 'H', pd: [14, 18, 14, 18] };
  const beer = { t: 'F', w: 346, h: 243, lm: 'V', pd: [0, 0, 16, 0], c: [band, { t: 'F', w: 344, h: 164 }] };
  const plan = cardPlan(beer);
  assert.equal(plan.band, band);
  assert.equal(plan.right, 18);
  assert.equal(plan.top, 49 / 2 - 16);
  assert.deepEqual(withBand(beer.c, plan)[0].pd, [14, 60, 14, 18]);
  assert.deepEqual(cardPlan({ t: 'F', w: 300, h: 300, lm: 'V', c: [text('Hello', 300)] }), { top: 8, right: 8 });
  // a fixed layout: the biggest photo, where it's placed
  assert.deepEqual(cardPlan({ t: 'F', w: 400, h: 300, c: [{ t: 'R', x: 20, y: 30, w: 200, h: 200, f: [{ img: '/a.jpg' }] }] }), { top: 38, right: 188 });
});

test('holder cards: a stacked card whose head links to one shareable page (Cocktail Specs)', () => {
  const head = { t: 'F', n: 'Head', w: 288, h: 37, lm: 'V', c: [{ ...text('Paloma Verde', 288), to: '/signature/paloma-verde' }, text('Specialty · $15', 288)] };
  const card = { t: 'F', n: 'Spec · Paloma Verde', w: 326, h: 455, lm: 'V', pd: [18, 18, 18, 18], c: [head, { t: 'F', w: 288, h: 89 }] };
  assert.deepEqual(holderTarget(card, lookup), { slug: 'signature/paloma-verde', title: 'Paloma Verde' });
  assert.equal(holderTarget({ ...card, lm: 'H' }, lookup), null); // a row of pills isn't a card
  assert.equal(holderTarget({ ...card, to: '/signature/paloma-verde' }, lookup), null); // a linked card has its own button
  assert.equal(holderTarget({ ...card, c: [{ ...head, c: [{ ...text('Cocktails'), to: '/the-bar/cocktails' }] }] }, lookup), null);
});

// Nov 11, Tommy: "FIX THIS ERROR" — Home's What's New drew two chat buttons on its first row: the list counted as a holder
// (its first child, the row, links to one page) and the row had its own. A list of linked rows is never a holder.
test('one button per item: a list of linked rows is not a holder (Home’s What’s New)', () => {
  const row = (name, slug) => ({ t: 'F', n: 'Update · ' + name, w: 296, h: 53, lm: 'V', to: '/signature/' + slug, c: [text(name, 180)] });
  const updates = { t: 'F', n: 'Updates', w: 296, h: 159, lm: 'V', c: [row('Paloma Verde', 'paloma-verde'), row('Other', 'other'), row('Third', 'third')] };
  assert.equal(holderTarget(updates, lookup), null);
  assert.equal(holderTarget({ ...updates, c: [row('Paloma Verde', 'paloma-verde'), { t: 'F', w: 296, h: 100 }] }, lookup), null, 'even when only the first row links');
  assert.equal(targetOf(updates.c[0], lookup)?.shape, 'row', 'the row keeps its own button');
});
