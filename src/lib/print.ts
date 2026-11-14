// Printing a page (Nov 14, Tommy: "making these one sheet prints better"). Before the print window opens, work out how small
// the desktop design has to get to fit one portrait Letter sheet, and hand it to the print CSS as --print-zoom (styles.css,
// "Print"). Never smaller than MIN_ZOOM so the words stay readable; a page that won't fit at that size prints full width
// across as many sheets as it needs (shrinking it and still needing two sheets helps nobody).
// The measure runs with .print-measure on <body>, which hides the same things the print CSS hides.

const PAGE_W = (8.5 - 0.8) * 96; // printable width in CSS px (0.4in margins)
const PAGE_H = (11 - 0.8) * 96;
const DESIGN_W = 1176;
const MAX_ZOOM = PAGE_W / DESIGN_W; // ≈ 0.63: the design's full width on the sheet
const MIN_ZOOM = 0.5;

/** The scale that fits a design of this height on one sheet, within the readable range. */
export function printZoom(height: number) {
  if (!(height > 0)) return MAX_ZOOM;
  const fit = (PAGE_H - 28) / height; // a little room: a page that overflows by a hair pushes a whole column to sheet two
  return fit >= MIN_ZOOM ? Math.min(MAX_ZOOM, fit) : MAX_ZOOM;
}

function measure() {
  const root = document.querySelector<HTMLElement>('.page > .fn');
  if (!root || document.body.classList.contains('printing-cert')) return;
  const body = document.body;
  body.classList.add('print-measure');
  const h = root.getBoundingClientRect().height / (parseFloat(getComputedStyle(root).zoom) || 1);
  body.classList.remove('print-measure');
  document.documentElement.style.setProperty('--print-zoom', String(printZoom(h)));
}

export function setupPrint() {
  window.addEventListener('beforeprint', measure);
  window.addEventListener('afterprint', () => document.documentElement.style.removeProperty('--print-zoom'));
}
