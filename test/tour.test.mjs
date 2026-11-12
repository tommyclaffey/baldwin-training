// The demo tour's card placement (Nov 12, Tommy on the certificate step: "fix positioning").
// src/components/tourPlace.ts is plain TypeScript with no React, so Node runs it directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_W, MARGIN, overlap, placeCard, roomScroll } from '../src/components/tourPlace.ts';

const card = { width: CARD_W, height: 227 };
const screen = (width, height, left = 0, top = 0) => ({ left, top, width, height });
const box = (p) => ({ ...p, height: card.height });
const inside = (p, v) => p.left >= v.left + MARGIN - 0.5 && p.top >= v.top + MARGIN - 0.5 && p.left + p.width <= v.left + v.width - MARGIN + 0.5 && p.top + card.height <= v.top + v.height - MARGIN + 0.5;

test('room underneath: the card sits below the box, on its left edge', () => {
  const v = screen(1024, 800), hl = { left: 34, top: 120, width: 469, height: 58 };
  const p = placeCard(hl, v, card);
  assert.equal(p.side, 'below');
  assert.equal(p.left, 34);
  assert.equal(p.top, 190);
});

test('no room underneath but room above: the card goes above instead of covering the box', () => {
  const v = screen(1024, 640), hl = { left: 34, top: 258, width: 956, height: 186 };
  const p = placeCard(hl, v, card);
  assert.equal(p.side, 'above');
  assert.equal(overlap(box(p), hl), 0);
  assert.ok(inside(p, v));
});

test('a tall, narrow box (a filter rail, a spec card): the card goes beside it', () => {
  const v = screen(1024, 640), hl = { left: 56, top: 180, width: 300, height: 340 };
  const p = placeCard(hl, v, card);
  assert.equal(p.side, 'right');
  assert.equal(overlap(box(p), hl), 0);
  assert.ok(inside(p, v));
});

test('a box that fills the screen (the certificate at 1024 and 900): covered only then, as little as possible, and the card stays on screen', () => {
  for (const [w, h] of [[1024, 800], [900, 800], [1100, 700]]) {
    const v = screen(w, h), hl = { left: 40, top: 64, width: w - 80, height: h - 68 };
    const p = placeCard(hl, v, card);
    assert.equal(p.side, 'over');
    assert.ok(inside(p, v), `${w}×${h}: ${JSON.stringify(p)}`);
    // it covers as little of the box as it can: never more than the card, less where it can hang off the box's edge
    assert.ok(overlap(box(p), hl) <= CARD_W * card.height);
  }
});

test('a box near the right edge never pushes the card off screen', () => {
  const v = screen(1024, 800), hl = { left: 956, top: 4, width: 60, height: 54 };
  const p = placeCard(hl, v, card);
  assert.ok(inside(p, v));
  assert.equal(overlap(box(p), hl), 0);
});

test('pinch-zoomed in (only part of the page on screen): the card stays inside what you can see', () => {
  // 1024 × 800 zoomed to 1.3, panned to the right: the visible part starts 177 px in.
  const v = screen(788, 615, 177, 115), hl = { left: 40, top: 64, width: 944, height: 732 };
  const p = placeCard(hl, v, card);
  assert.ok(inside(p, v), JSON.stringify(p));
});

test('narrow screens dock the card at the bottom, full width', () => {
  for (const w of [390, 600]) {
    const v = screen(w, 844), p = placeCard({ left: 8, top: 300, width: w - 16, height: 280 }, v, card);
    assert.equal(p.side, 'sheet');
    assert.equal(p.left, MARGIN);
    assert.equal(p.width, w - MARGIN * 2);
  }
});

test('making room: scroll the box up under the top bar when it and the card both fit', () => {
  const v = screen(1024, 640);
  assert.equal(roomScroll({ left: 34, top: 180, width: 956, height: 335 }, v, { width: CARD_W, height: 204 }, 64), 116);
  assert.equal(roomScroll({ left: 40, top: 64, width: 944, height: 732 }, v, card, 64), 0, 'too tall: nothing to gain');
  assert.equal(roomScroll({ left: 34, top: 80, width: 956, height: 200 }, v, card, 64), 0, 'already room underneath');
});
