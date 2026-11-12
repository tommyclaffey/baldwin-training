// Where the demo tour's card goes (Nov 12, Tommy on the certificate step: "fix positioning"). Plain TypeScript with no React,
// so Node's tests run it directly (test/tour.test.mjs).
//   • The card is always fully on screen: inside the part of the page you can actually see (the visual viewport, so a
//     pinch-zoomed laptop counts too, and never under a scrollbar), with a 12 px margin.
//   • It never covers what it points at when there's room: below, above, right, then left of the box. Only a box that leaves
//     no room anywhere gets covered, and then the card sits in the bottom corner on the box's left edge (or wherever it
//     covers far less of the box).
//   • A screen too narrow for the card docks it at the bottom, full width, like on a phone.

export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
/** `over`: no room anywhere, so the card covers part of the box. */
export type Side = 'below' | 'above' | 'right' | 'left' | 'over' | 'sheet';
export type Place = { left: number; top: number; width: number; side: Side };

export const CARD_W = 340, MARGIN = 12, GAP = 12;
/** Narrower than this (in CSS px of what you can see), the card docks at the bottom. */
export const SHEET_BELOW = 640;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
const right = (b: Box) => b.left + b.width;
const bottom = (b: Box) => b.top + b.height;
export const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(right(a), right(b)) - Math.max(a.left, b.left)) * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.top, b.top));

/** The card's spot for a highlight box `hl` (the box drawn round the target), in fixed-position coordinates. `view` is what's
 *  on screen, `card` the card's measured size. */
export function placeCard(hl: Box, view: Box, card: Size): Place {
  const vl = view.left + MARGIN, vt = view.top + MARGIN, vr = right(view) - MARGIN, vb = bottom(view) - MARGIN;
  if (view.width < SHEET_BELOW || vr - vl < CARD_W) {
    const width = Math.max(0, vr - vl);
    // 76 px clear of the bottom, as the phone sheet always sat (Safari's floating address bar); less if the screen is short.
    return { side: 'sheet', width, left: vl, top: Math.max(vt, bottom(view) - Math.min(76, view.height * 0.1) - card.height) };
  }
  const w = CARD_W, h = card.height;
  const x = clamp(hl.left, vl, vr - w); // under or over the box: its left edge, kept on screen
  const y = clamp(hl.top, vt, vb - h);  // beside the box: its top, kept on screen
  const options: Place[] = [
    { side: 'below', left: x, top: bottom(hl) + GAP, width: w },
    { side: 'above', left: x, top: hl.top - GAP - h, width: w },
    { side: 'right', left: right(hl) + GAP, top: y, width: w },
    { side: 'left', left: hl.left - GAP - w, top: y, width: w },
  ];
  const fits = (p: Place) => p.left >= vl - 0.5 && p.top >= vt - 0.5 && p.left + w <= vr + 0.5 && p.top + h <= vb + 0.5;
  const clear = options.find((p) => fits(p) && overlap({ ...p, height: h }, hl) < 1);
  if (clear) return clear;
  // No room anywhere: the card goes in the bottom corner on the box's left edge (where a box's least important part
  // usually is: a box's heading is at its top), unless another spot, kept on screen, covers well under as much of the box.
  const onScreen = options.map((p): Place => ({ ...p, side: 'over', left: clamp(p.left, vl, vr - w), top: clamp(p.top, vt, vb - h) }));
  const best = onScreen.reduce((a, p) => (overlap({ ...p, height: h }, hl) < overlap({ ...a, height: h }, hl) - 1 ? p : a));
  const corner: Place = { side: 'over', left: x, top: clamp(vb - h, vt, vb - h), width: w };
  return overlap({ ...best, height: h }, hl) < overlap({ ...corner, height: h }, hl) * 0.6 ? best : corner;
}

/** How far to scroll the page so the box and the card both fit (box below the top bar, card under or over it), or 0 when
 *  they can't both fit or already do. `topInset` keeps the box clear of a sticky top bar. */
export function roomScroll(target: Box, view: Box, card: Size, topInset: number): number {
  const top = view.top + topInset, end = bottom(view) - MARGIN, h = card.height;
  if (view.width < SHEET_BELOW || target.height + GAP + h > end - top) return 0;
  if (bottom(target) + GAP + h <= end && target.top >= top) return 0; // already room underneath
  // Put the box at the top and the card under it, or as close to that as moving the page allows.
  return target.top - top;
}
