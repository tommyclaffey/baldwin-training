// The demo tour's card placement (Nov 12, Tommy on the certificate step: "fix positioning").
// src/components/tourPlace.ts is plain TypeScript with no React, so Node runs it directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_W, MARGIN, GAP, overlap, placeCard, roomScroll, sheetScroll, sheetTop } from '../src/components/tourPlace.ts';

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

// Nov 15 (audit 14): on a phone the docked card sat on top of the thing it described ("What's waiting on you",
// "One person, everything", the certificate). The page now scrolls the target above the card.
test('phones: a target under the docked card scrolls up into the space above it', () => {
  const v = screen(390, 844), c = { width: 366, height: 300 };
  const room = { top: 64, end: sheetTop(v, c) - GAP };
  // the sign-off band, sitting low on the screen at first view
  const band = { left: 8, top: 520, width: 374, height: 220 };
  const by = sheetScroll(band, v, c, 64);
  assert.ok(by > 0, 'it scrolls');
  const moved = { ...band, top: band.top - by };
  assert.ok(moved.top >= room.top && moved.top + moved.height <= room.end + 0.5, JSON.stringify({ moved, room }));
  // and, once moved, the card docks at the bottom without covering it
  const p = placeCard(moved, v, c);
  assert.equal(p.dock, 'bottom');
  assert.equal(overlap({ ...p, height: c.height }, moved), 0);
});

test('phones: a target taller than the space above the card starts at the top, so its heading shows', () => {
  const v = screen(390, 844), c = { width: 366, height: 300 };
  const person = { left: 8, top: 700, width: 374, height: 900 };
  assert.equal(sheetScroll(person, v, c, 64), 700 - 64);
});

test('phones: a target already clear of the card stays put', () => {
  const v = screen(390, 844), c = { width: 366, height: 300 };
  assert.equal(sheetScroll({ left: 8, top: 120, width: 374, height: 200 }, v, c, 64), 0);
  assert.equal(sheetScroll({ left: 8, top: 600, width: 374, height: 200 }, screen(1024, 800), c, 64), 0, 'wide screens: not a sheet');
});

test('phones: a target the page can’t scroll up (the end of the page) gets the card docked at the top instead', () => {
  const v = screen(390, 844), c = { width: 366, height: 300 };
  const last = { left: 8, top: 560, width: 374, height: 240 };
  const p = placeCard(last, v, c);
  assert.equal(p.side, 'sheet');
  assert.equal(p.dock, 'top');
  assert.equal(p.top, MARGIN);
  assert.equal(overlap({ ...p, height: c.height }, last), 0);
  // a target that fills the whole screen: covered either way, so the card stays at the bottom where it always sat
  assert.equal(placeCard({ left: 8, top: 0, width: 374, height: 844 }, v, c).dock, 'bottom');
  // a tall target scrolled to the top (One person, everything): the card stays at the bottom, off its heading
  assert.equal(placeCard({ left: 8, top: 56, width: 374, height: 1400 }, v, c).dock, 'bottom');
});

test('making room: scroll the box up under the top bar when it and the card both fit', () => {
  const v = screen(1024, 640);
  assert.equal(roomScroll({ left: 34, top: 180, width: 956, height: 335 }, v, { width: CARD_W, height: 204 }, 64), 116);
  assert.equal(roomScroll({ left: 40, top: 64, width: 944, height: 732 }, v, card, 64), 0, 'too tall: nothing to gain');
  assert.equal(roomScroll({ left: 34, top: 80, width: 956, height: 200 }, v, card, 64), 0, 'already room underneath');
});

// Nov 14: the manager's walk stops on Bar Prep, in both demos (the tour is shared; /prep is in both demos' menus).
// DemoTour.tsx is React, so this reads its stop list as text.
import fs from 'node:fs';
test('the manager tour has a Prep stop that points at something Today really draws', () => {
  const src = fs.readFileSync(new URL('../src/components/DemoTour.tsx', import.meta.url), 'utf8');
  const stop = src.split('\n').find((l) => /path: '\/prep'/.test(l));
  assert.ok(stop, 'a /prep stop');
  assert.match(stop, /manager: true/, 'for the manager (the employee demo is a server, who doesn’t log prep)');
  const cls = /target: '\.([a-z0-9-]+)'/.exec(stop)?.[1];
  assert.ok(cls, 'targets a class');
  const today = fs.readFileSync(new URL('../src/prep/PrepPage.tsx', import.meta.url), 'utf8');
  assert.ok(today.includes(`className="${cls}"`), `Today draws .${cls}`);
  // it comes before the manager home stops, so the walk ends on People as before
  assert.ok(src.indexOf("path: '/prep'") < src.indexOf("path: '/admin', target"), 'before the manager home');
});
