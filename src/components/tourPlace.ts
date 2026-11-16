// Where the demo tour's card goes (Nov 12, Tommy on the certificate step: "fix positioning"). Plain TypeScript with no React,
// so Node's tests run it directly (test/tour.test.mjs).
//   • The card is always fully on screen: inside the part of the page you can actually see (the visual viewport, so a
//     pinch-zoomed laptop counts too, and never under a scrollbar), with a 12 px margin.
//   • It never covers what it points at when there's room: below, above, right, then left of the box. Only a box that leaves
//     no room anywhere gets covered, and then the card sits in the bottom corner on the box's left edge (or wherever it
//     covers far less of the box).
//   • A screen too narrow for the card docks it at the bottom, full width, like on a phone. Nov 15 (audit 14: the cards sat on
//     top of "What's waiting on you", "One person, everything", the certificate): the page first scrolls the target into the
//     part of the screen above the card (sheetScroll), and when the page can't scroll that far (the end of the page), the
//     card docks at the top instead, if that covers less of the target.

export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
/** `over`: no room anywhere, so the card covers part of the box. */
export type Side = 'below' | 'above' | 'right' | 'left' | 'over' | 'sheet';
/** `dock` (phones): the sheet sits at the bottom of the screen, or at the top when the target is down there. */
export type Place = { left: number; top: number; width: number; side: Side; dock?: 'bottom' | 'top' };

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
    const low: Place = { side: 'sheet', dock: 'bottom', width, left: vl, top: sheetTop(view, card) };
    const high: Place = { side: 'sheet', dock: 'top', width, left: vl, top: vt };
    const cover = (p: Place) => overlap({ ...p, height: card.height }, hl);
    // the top only when it covers well under half as much (a tall target scrolled to the top keeps its heading clear)
    return cover(low) >= 1 && cover(high) < cover(low) * 0.5 ? high : low;
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

/** Where the phone sheet's top edge sits when it docks at the bottom. */
export const sheetTop = (view: Box, card: Size) => Math.max(view.top + MARGIN, bottom(view) - Math.min(76, view.height * 0.1) - card.height);

/** Phones (Nov 15): how far to scroll so the target sits in the part of the screen above the docked card, under the top bar.
 *  A target that fits there is centred in it; a taller one starts at the top, so its heading shows. 0 when it's already
 *  clear of the card, or on a screen wide enough not to use the sheet. */
export function sheetScroll(target: Box, view: Box, card: Size, topInset: number): number {
  if (view.width >= SHEET_BELOW && view.width - 2 * MARGIN >= CARD_W) return 0;
  const top = view.top + topInset, end = sheetTop(view, card) - GAP;
  if (target.top >= top - 0.5 && bottom(target) <= end + 0.5) return 0;
  const room = end - top;
  const want = target.height <= room ? top + (room - target.height) / 2 : top;
  return Math.round(target.top - want);
}
