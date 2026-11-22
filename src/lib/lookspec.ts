// "Your Look from your website" (Nov 22; Figma 09 · Idea Board → 44, 877:1388; Tommy, Nov 20: "Looks good to me").
// The pure part, shared by the server (server/yourlook.mjs, which reads a website) and the app (the Adjust screen's live
// preview, src/admin/yourlook.tsx; theme.ts `themeFromSpec`): colour maths, the roles a website's colours are given, the
// contrast check with its fixes, and the free stand-ins for paid or system fonts. No imports, no DOM, no Node.
//
// A look made this way is DATA (a `looks` row, server/yourlook.mjs), not an entry in theme.ts THEMES: the few roles below
// (a LookSpec) fill every role of a Theme the same way the hand-built Testa Barra and J.Baldwin's looks were filled on Nov 17.
// The hand-built looks (The Baldwin, Testa Barra, J.Baldwin's) stay in theme.ts, unchanged.

/* ── Colour maths ─────────────────────────────────────────────────────────────────────────────────────────────────── */
export type Rgb = [number, number, number];
export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9A-F]{6}$/.test(s);
export function normHex(s: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return '#' + h.toUpperCase();
}
export const rgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const hex = ([r, g, b]: Rgb | number[]): string => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
/** WCAG relative luminance. */
export function lum(h: string): number {
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb(h);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
/** WCAG contrast ratio, 1–21. */
export function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const round1 = (n: number) => Math.floor(n * 10) / 10; // shown ratios never round up past a limit
/** a → b by t (0–1), in sRGB. */
export const mix = (a: string, b: string, t: number) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
export function hsl(h: string): [number, number, number] {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
}
export function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return hex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
/** How colourful (HSL saturation, weighted down for near-black and near-white, where hue means little). */
export function chroma(h: string): number { const [, s, l] = hsl(h); return s * (1 - Math.abs(2 * l - 1)); }
/** Same hue and saturation, darker or lighter, until `fg` reaches `min` against `bg` (the contrast fix: "the shade
 *  changes, never the hue"). Returns the colour as it was when it already passes; null when no shade can pass. */
export function shadeTo(fg: string, bg: string, min: number, dir: 'darker' | 'lighter' = lum(bg) > 0.4 ? 'darker' : 'lighter'): string | null {
  if (ratio(fg, bg) >= min) return fg;
  const [h, s, l0] = hsl(fg);
  for (let i = 1; i <= 100; i++) {
    const l = dir === 'darker' ? l0 - (l0 * i) / 100 : l0 + ((1 - l0) * i) / 100;
    const c = fromHsl(h, s, l);
    if (ratio(c, bg) >= min) return c;
  }
  return null;
}
const INK = '#121110', WHITE = '#FFFFFF';
/** The best of a few type colours on a fill: the first that passes, else the one with the most contrast. */
export function bestOn(bg: string, choices: string[], min = 4.5): string {
  return choices.find((c) => ratio(c, bg) >= min) || choices.reduce((a, b) => (ratio(b, bg) > ratio(a, bg) ? b : a));
}

/* ── A look, as data ──────────────────────────────────────────────────────────────────────────────────────────────── */
/** The colours a look is made of: everything else in a Theme comes from these (theme.ts themeFromSpec). */
export type LookColors = {
  page: string; card: string; ink: string; muted: string; line: string;
  panel: string; onPanel: string; label: string;       // the dark sidebar, its type and its quiet labels
  accentDark: string; onAccentDark: string;           // the accent where it sits on dark (gold on J.Baldwin's sidebar)
  accentLight: string; onAccentLight: string;         // the accent on light surfaces (J.Baldwin's burgundy J)
};
export const COLOR_KEYS: (keyof LookColors)[] = ['page', 'card', 'ink', 'muted', 'line', 'panel', 'onPanel', 'label', 'accentDark', 'onAccentDark', 'accentLight', 'onAccentLight'];
/** The colour roles an owner sees and can change (Figma 879:1403 "Colour roles", 880:1408 "Colours"). */
export const COLOR_ROLES: { key: keyof LookColors; label: string }[] = [
  { key: 'page', label: 'Page' }, { key: 'card', label: 'Cards' }, { key: 'ink', label: 'Text' }, { key: 'muted', label: 'Quiet text' },
  { key: 'panel', label: 'Sidebar and dark panels' }, { key: 'accentDark', label: 'Accent on dark' }, { key: 'accentLight', label: 'Accent on light' }, { key: 'line', label: 'Lines' },
];
/** A logo file as it's used: the file is never changed; `crop` is its artwork box ([x, y, w, h, W, H], theme.ts Crop). */
export type LookLogo = { src: string; w: number; h: number; crop: [number, number, number, number, number, number] };
export type LookFonts = {
  heading: string; accent: string; body: string; headingCase: 'upper' | 'title';
  /** The site's own face each one stands in for (a paid or system font), or unset when it's the site's own free font. */
  standIn?: { heading?: string; accent?: string; body?: string };
};
export type LookSpec = {
  v: 1; name: string;
  colors: LookColors;
  fonts: LookFonts;
  logo: { dark?: LookLogo; light?: LookLogo };      // dark = for dark backgrounds (usually white), light = for light ones
  icon?: string;                                     // the tab and home-screen icon (the site's own icon file)
  photo?: string;                                    // sign-in and the link card
  source?: string;                                   // the website it was read from
};

/* ── The contrast check (Figma 879:1403: "anything under WCAG AA is fixed for you and flagged below") ─────────────── */
export type PairId = 'ink' | 'muted' | 'accentLight' | 'label' | 'accentDark' | 'onPanel' | 'onAccentLight' | 'onAccentDark';
export const PAIRS: { id: PairId; label: string; fg: keyof LookColors; bg: keyof LookColors; min: number }[] = [
  { id: 'ink', label: 'Text on cards', fg: 'ink', bg: 'card', min: 4.5 },
  { id: 'muted', label: 'Quiet text on the page', fg: 'muted', bg: 'page', min: 4.5 },
  { id: 'accentLight', label: 'Accent text on cards', fg: 'accentLight', bg: 'card', min: 4.5 },
  { id: 'label', label: 'Labels on the dark sidebar', fg: 'label', bg: 'panel', min: 4.5 },
  { id: 'accentDark', label: 'Accent on the dark sidebar', fg: 'accentDark', bg: 'panel', min: 4.5 },
  { id: 'onPanel', label: 'Light text on dark panels', fg: 'onPanel', bg: 'panel', min: 4.5 },
  { id: 'onAccentLight', label: 'Text on an accent button', fg: 'onAccentLight', bg: 'accentLight', min: 4.5 },
  { id: 'onAccentDark', label: 'Text on the bright accent', fg: 'onAccentDark', bg: 'accentDark', min: 4.5 },
];
export type PairResult = { id: PairId; label: string; fg: string; bg: string; ratio: number; pass: boolean; min: number };
export type Fix = { id: PairId; label: string; before: { fg: string; bg: string; ratio: number }; after: { fg: string; bg: string; ratio: number }; note: string };
export function checkPairs(c: LookColors): PairResult[] {
  return PAIRS.map((p) => { const r = ratio(c[p.fg], c[p.bg]); return { id: p.id, label: p.label, fg: c[p.fg], bg: c[p.bg], ratio: round1(r), pass: r >= p.min, min: p.min }; });
}
/** Every failing pair fixed: a shade darker or lighter in the same hue, a bright accent kept for dark surfaces only (with a
 *  deeper colour from the site for light ones), and dark ink on a bright fill. `alts`: other colours from the site, most
 *  used first (the accent on light can be one of them, e.g. the burgundy J in J.Baldwin's logo). */
export type Alts = { logo?: string[]; named?: string[]; other?: string[] };
export function fixColors(input: LookColors, alts: Alts | string[] = {}): { colors: LookColors; fixes: Fix[]; checked: number; passedAsFound: number } {
  const A: Alts = Array.isArray(alts) ? { other: alts } : alts;
  const c = { ...input };
  const fixes: Fix[] = [];
  const first = checkPairs(c);
  const note = (id: PairId, label: string, before: PairResult, fg: string, bg: string, text: string) =>
    fixes.push({ id, label, before: { fg: before.fg, bg: before.bg, ratio: before.ratio }, after: { fg, bg, ratio: round1(ratio(fg, bg)) }, note: text });
  const failing = (id: PairId) => { const r = checkPairs(c).find((x) => x.id === id)!; return r.pass ? null : r; };
  let r: PairResult | null;
  // 1. text on cards: ink, darker (or the plain ink when no shade passes)
  if ((r = failing('ink'))) { c.ink = shadeTo(c.ink, c.card, 4.5, 'darker') || INK; note('ink', r.label, r, c.ink, c.card, 'Darkened in the same hue.'); }
  // 2. quiet text: darker in the same hue (J.Baldwin's warm grey #9A9282 → #70695A)
  if ((r = failing('muted'))) {
    const dk = shadeTo(c.muted, c.page, 4.5, 'darker') || mix(c.ink, c.page, 0.3);
    c.muted = ratio(dk, c.card) >= 4.5 ? dk : shadeTo(dk, c.card, 4.5, 'darker') || dk;
    note('muted', r.label, r, c.muted, c.page, 'Darkened in the same hue.');
  }
  // 3. the accent on light: a bright accent stays on dark surfaces; light ones get another of the site's colours that
  //    passes (not a grey, not the ink or panel), else the accent itself, darkened
  if ((r = failing('accentLight'))) {
    // in order: a logo colour that reads on light as it is (J.Baldwin's burgundy J); another colour the site names in its
    // palette, darkened in its own hue (Testa Barra's coral #E05B53 → a deep coral); any other colour from the site that
    // reads; the accent itself, darker
    const taken = [c.ink, c.panel];
    const ok = (a: string) => chroma(a) > 0.18 && ratio(a, c.card) >= 4.5 && ratio(a, c.page) >= 4.5 && !taken.some((t) => ratio(t, a) < 1.25);
    const clean = (l?: string[]) => (l || []).map((a) => normHex(a)).filter((a): a is string => !!a);
    const fromLogo = clean(A.logo).find(ok);
    const fromNamed = fromLogo ? null : clean(A.named).filter((a) => a !== c.accentDark && chroma(a) > 0.3 && !taken.some((t) => ratio(t, a) < 1.25)).map((a) => shadeTo(a, c.page, 4.5, 'darker')).find((a): a is string => !!a && ok(a));
    const fromOther = fromLogo || fromNamed ? null : clean(A.other).find(ok);
    const alt = fromLogo || fromNamed || fromOther;
    const was = c.accentLight;
    c.accentLight = alt || shadeTo(was, c.card, 4.5, 'darker') || c.ink;
    if (ratio(c.accentLight, c.page) < 4.5) c.accentLight = shadeTo(c.accentLight, c.page, 4.5, 'darker') || c.accentLight;
    note('accentLight', r.label, r, c.accentLight, c.card, fromLogo ? `${was} kept for dark surfaces. On light, accent text uses ${c.accentLight} from your logo.`
      : fromNamed ? `${was} kept for dark surfaces. On light, accent text uses ${c.accentLight}, your other accent, darkened in its own hue.`
      : fromOther ? `${was} kept for dark surfaces. On light, accent text uses ${c.accentLight}, another colour from your site.`
      : `${was} kept for dark surfaces. On light it’s ${c.accentLight}, the same hue, darker.`);
  }
  // 4. labels on the sidebar: lighter in the same hue
  if ((r = failing('label'))) { c.label = shadeTo(c.label, c.panel, 4.5, 'lighter') || mix(c.onPanel, c.panel, 0.25); note('label', r.label, r, c.label, c.panel, 'Lightened in the same hue.'); }
  // 5. the accent on the sidebar: lighter in the same hue
  if ((r = failing('accentDark'))) { c.accentDark = shadeTo(c.accentDark, c.panel, 4.5, 'lighter') || c.onPanel; note('accentDark', r.label, r, c.accentDark, c.panel, 'Lightened in the same hue.'); }
  // 6. light type on the panel: the card colour, else white, else lighter
  if ((r = failing('onPanel'))) { c.onPanel = bestOn(c.panel, [c.card, c.page, WHITE]); note('onPanel', r.label, r, c.onPanel, c.panel, 'Light type on the panel.'); }
  // 7. type on the accent for light (a filled badge, a button): light type, else ink
  if ((r = failing('onAccentLight'))) { c.onAccentLight = bestOn(c.accentLight, [WHITE, c.card, c.ink, INK]); note('onAccentLight', r.label, r, c.onAccentLight, c.accentLight, ratio(c.onAccentLight, '#000000') > 10 ? 'Light type on the accent.' : 'Dark ink on the accent.'); }
  // 8. type on the bright accent: always dark ink ("text on a bright accent is always dark ink")
  if ((r = failing('onAccentDark'))) { c.onAccentDark = bestOn(c.accentDark, [c.ink, INK, c.panel, WHITE]); note('onAccentDark', r.label, r, c.onAccentDark, c.accentDark, 'Text on a bright accent is always dark ink.'); }
  return { colors: c, fixes, checked: PAIRS.length, passedAsFound: first.filter((x) => x.pass).length };
}

/* ── Colours found on a website → roles (the deterministic mapping; Claude may suggest roles first, server-side) ─── */
export type Candidate = { hex: string; weight: number; from: ('var' | 'meta' | 'css' | 'page' | 'logo')[] };
/** Framework and plugin palettes every site carries (Tailwind greys, WordPress presets, Elementor and SureCart defaults):
 *  never a restaurant's own colour. */
export const NOISE = new Set([
  '#F9FAFB', '#F3F4F6', '#E5E7EB', '#D1D5DB', '#9CA3AF', '#6B7280', '#4B5563', '#374151', '#1F2937', '#111827', '#030712',
  '#F8FAFC', '#F1F5F9', '#E2E8F0', '#CBD5E1', '#94A3B8', '#64748B', '#475569', '#334155', '#1E293B', '#0F172A',
  '#CF2E2E', '#FF6900', '#FCB900', '#7BDCB5', '#00D084', '#8ED1FC', '#0693E3', '#ABB8C3', '#EB144C', '#F78DA7', '#9B51E0', '#32373C', '#313131',
  '#6EC1E4', '#54595F', '#7A7A7A', '#61CE70', '#69727D', '#1F2124', '#0C0D0E', '#D5D8DC', '#818A91', '#495157', '#A4AFB7', '#C2CBD2', '#E6E8EA', '#F1F3F5', '#556068',
  '#828C99', '#DC2626', '#FBBF24', '#2271B1', '#135E96', '#007CBA', '#006BA1', '#3582C4', '#DDDDDD', '#EEEEEE', '#CCCCCC', '#999999', '#666666', '#333333', '#757575',
  '#0D6EFD', '#6C757D', '#198754', '#DC3545', '#FFC107', '#0DCAF0', '#212529', '#F8F9FA', '#E9ECEF', '#DEE2E6', '#CED4DA', '#ADB5BD', '#495057', '#343A40',
  '#1E3A5F', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF', '#3B5998', '#1DA1F2', '#E1306C', '#4267B2', '#25D366', '#0A66C2', '#FF4500',
  '#D6D5D5', '#706F6F', '#F1F1F1', '#F7F7F7', '#F5F5F5', '#FAFAFA', '#E0E0E0', '#BDBDBD', '#9E9E9E', '#616161', '#424242', '#212121',
]);
export type Mapped = { colors: LookColors; why: Partial<Record<keyof LookColors, string>> };
/** Roles from the site's colours (most used first). `logo`: colours read from the logo's own pixels (they rank as the
 *  site's own). The same steps Testa Barra and J.Baldwin's were built with by hand on Nov 17. */
export function rolesFromColors(cands: Candidate[]): Mapped {
  // pure black and white are every site's defaults (a page builder's kit starts with them), so they count for less; a
  // colour the site names in its own palette (a custom property) counts for more
  const score = (c: Candidate) => c.weight * (c.hex === '#000000' || c.hex === '#FFFFFF' ? 0.25 : 1) * (c.from.includes('var') ? 1.3 : 1);
  const list = cands.filter((c) => isHex(c.hex)).sort((a, b) => score(b) - score(a));
  const why: Mapped['why'] = {};
  const darks = list.filter((c) => lum(c.hex) < 0.06);
  const lights = list.filter((c) => lum(c.hex) > 0.6 && chroma(c.hex) < 0.3); // surfaces: a cream or blush, never chartreuse
  const chromatic = list.filter((c) => chroma(c.hex) > 0.22 && lum(c.hex) >= 0.02 && lum(c.hex) <= 0.95); // chartreuse is an accent too
  const neutralsMid = list.filter((c) => chroma(c.hex) <= 0.22 && lum(c.hex) >= 0.08 && lum(c.hex) <= 0.55);
  // the dark panel: the most used dark; the ink: the darkest dark (near-black), else the panel
  const panel = darks[0]?.hex || '#1E1C1A';
  why.panel = darks[0] ? 'Your most-used dark colour' : 'A warm near-black (your site has no dark colour)';
  const nearBlack = darks.find((c) => lum(c.hex) < 0.02 && chroma(c.hex) < 0.5);
  const ink = nearBlack && lum(nearBlack.hex) <= lum(panel) ? nearBlack.hex : lum(panel) < 0.02 ? panel : mix(panel, '#000000', 0.55);
  why.ink = nearBlack ? 'Your near-black' : 'Your dark colour, deeper';
  // light surfaces: a tinted light (cream, blush) over plain white. A near-white cream is the card and the page is a step
  // darker (J.Baldwin's #FBF1E3 → #F3E9DA); a deeper tint (Testa Barra's blush) is mixed with white for both.
  const tinted = lights.filter((c) => c.hex !== '#FFFFFF' && chroma(c.hex) > 0.01);
  const base = tinted[0]?.hex || lights.find((c) => c.hex !== '#FFFFFF')?.hex || null;
  let card: string, page: string;
  if (base && lum(base) > 0.82) { card = base; page = mix(base, '#000000', 0.033); why.card = 'Your cream'; why.page = 'From your cream, a step darker'; }
  else if (base) { card = mix('#FFFFFF', base, 0.13); page = mix('#FFFFFF', base, 0.6); why.card = 'White with a touch of your ' + base; why.page = 'Your ' + base + ', lightened'; }
  else { card = '#FBF9F5'; page = '#F2EEE7'; why.card = 'A warm white (your site has no light colour)'; why.page = 'A warm white, a step darker'; }
  // accents: the most used colourful one (gold, chartreuse) is the accent on dark; on light it's checked in fixColors
  const acc = chromatic.find((c) => ratio(c.hex, panel) >= 3) || chromatic[0];
  const accentDark = acc?.hex || mix(card, panel, 0.25);
  why.accentDark = acc ? 'Your ' + (acc.from.includes('logo') ? 'logo’s ' : '') + 'most-used accent' : 'No accent on your site: a tint of your page';
  // on light: the same accent to start with; when it can't be read on light, fixColors moves it to dark surfaces only and
  // picks a deeper colour from the site for light ones (the logo's first: J.Baldwin's burgundy J)
  const accentLight = accentDark;
  why.accentLight = why.accentDark;
  // quiet text and labels: the site's warm grey
  const grey = neutralsMid[0];
  const muted = grey?.hex || mix(ink, page, 0.42);
  why.muted = grey ? 'Your warm grey' : 'Your text colour, lighter';
  const label = grey?.hex || mix(page, panel, 0.4);
  why.label = grey ? 'Your warm grey' : 'Your page colour, dimmed';
  const lineSrc = list.find((c) => lum(c.hex) > 0.45 && lum(c.hex) < 0.8 && chroma(c.hex) < 0.2);
  const line = lineSrc?.hex || mix(page, ink, 0.12);
  why.line = lineSrc ? 'Your ' + (chroma(lineSrc.hex) > 0.04 ? 'warm ' : '') + 'grey line' : 'Your page, a step darker';
  const onPanel = ratio(card, panel) >= 7 ? card : '#FFFFFF';
  return {
    colors: { page, card, ink, muted, line, panel, onPanel, label, accentDark, onAccentDark: card, accentLight, onAccentLight: '#FFFFFF' },
    why,
  };
}

/* ── Fonts: Google Fonts as they are; paid and system fonts get the closest free stand-in ──────────────────────────── */
/** Paid faces we've met, and the free face that stands in (J.Baldwin's TAN Grandeur: Cinzel headings, Gilda Display for
 *  the accent line, as decided Nov 17). Keyed by the face's lower-case name. */
export const PAID: Record<string, { heading?: string; accent?: string; body?: string }> = {
  'tan grandeur': { heading: 'Cinzel', accent: 'Gilda Display' }, 'tan pearl': { heading: 'Playfair Display', accent: 'Gilda Display' },
  trajan: { heading: 'Cinzel' }, 'trajan pro': { heading: 'Cinzel' }, copperplate: { heading: 'Cinzel' }, 'copperplate gothic': { heading: 'Cinzel' },
  'proxima nova': { heading: 'Montserrat', body: 'Montserrat' }, gotham: { heading: 'Montserrat', body: 'Montserrat' }, futura: { heading: 'Jost', body: 'Jost' }, 'futura pt': { heading: 'Jost', body: 'Jost' },
  avenir: { heading: 'Nunito Sans', body: 'Nunito Sans' }, 'avenir next': { heading: 'Nunito Sans', body: 'Nunito Sans' }, 'brandon grotesque': { heading: 'Josefin Sans', body: 'Josefin Sans' },
  'gill sans': { heading: 'Lato', body: 'Lato' }, 'din': { heading: 'Barlow', body: 'Barlow' }, 'din next': { heading: 'Barlow', body: 'Barlow' },
  'freight display': { heading: 'Libre Caslon Display' }, 'freight text': { body: 'Libre Caslon Text' }, canela: { heading: 'Playfair Display' }, didot: { heading: 'Playfair Display' },
  bodoni: { heading: 'Bodoni Moda' }, baskerville: { heading: 'Libre Baskerville', body: 'Libre Baskerville' }, garamond: { heading: 'EB Garamond', body: 'EB Garamond' }, 'adobe garamond pro': { heading: 'EB Garamond', body: 'EB Garamond' },
  'brown': { heading: 'DM Sans', body: 'DM Sans' }, 'circular': { heading: 'DM Sans', body: 'DM Sans' }, 'sofia pro': { heading: 'Outfit', body: 'Outfit' }, 'museo sans': { heading: 'Nunito Sans', body: 'Nunito Sans' },
  'bebas': { heading: 'Bebas Neue' }, 'knockout': { heading: 'Oswald' }, 'trade gothic': { heading: 'Archivo Narrow', body: 'Archivo' }, 'akzidenz-grotesk': { heading: 'Inter', body: 'Inter' },
};
/** System fonts (not paid, but not on every phone) and their Google stand-in. */
export const SYSTEM: Record<string, string> = {
  verdana: 'Open Sans', tahoma: 'Open Sans', arial: 'Inter', helvetica: 'Inter', 'helvetica neue': 'Inter', 'segoe ui': 'Inter', 'system-ui': 'Inter', '-apple-system': 'Inter', 'sf pro': 'Inter',
  georgia: 'Lora', 'times new roman': 'Libre Baskerville', times: 'Libre Baskerville', 'trebuchet ms': 'Fira Sans', 'courier new': 'DM Mono', palatino: 'EB Garamond', 'palatino linotype': 'EB Garamond',
};
/** Faces that come with no meaning (icon fonts, framework defaults, plugin UIs). */
export const IGNORED_FONTS = new Set(['inherit', 'initial', 'unset', 'eicons', 'fontawesome', 'font awesome 5 free', 'font awesome 6 free', 'font awesome 5 brands', 'dashicons', 'monospace', 'sans-serif', 'serif', 'cursive', 'fantasy', 'roboto', 'roboto slab', 'swiper-icons', 'star', 'woocommerce', 'icomoon']);
/** The free face for a site's face, by what kind of face it seems to be (for paid faces we haven't met). */
export function standInByKind(name: string, generic = '', role: 'heading' | 'accent' | 'body' = 'heading'): string {
  const n = (name + ' ' + generic).toLowerCase();
  if (/script|hand|brush|signature|cursive/.test(n)) return role === 'body' ? 'Lato' : role === 'accent' ? 'Pinyon Script' : 'Playfair Display';
  if (/mono|code|courier/.test(n)) return role === 'body' ? 'DM Sans' : 'DM Mono';
  if (/condensed|compressed|narrow|gothic|bebas|oswald|league/.test(n)) return role === 'body' ? 'Archivo' : 'Bebas Neue';
  if (/serif|roman|display|didone|grandeur|caslon|garamond|times|book/.test(n) && !/sans/.test(n)) return role === 'body' ? 'Lora' : role === 'accent' ? 'Gilda Display' : 'Playfair Display';
  return role === 'accent' ? 'Gilda Display' : 'Montserrat';
}
/** Size factor for a heading face against the drawn Archivo ExtraBold (theme.ts TypeSpec.scale; Nov 17 measured Bebas
 *  1.26 and Cinzel 0.84 by hand). Faces not listed draw at the drawn size. */
export const HEADING_SCALE: Record<string, number> = {
  'Bebas Neue': 1.26, Oswald: 1.12, Anton: 1.1, 'League Gothic': 1.3, 'Archivo Narrow': 1.1, 'Barlow Condensed': 1.18, 'Fjalla One': 1.08,
  Cinzel: 0.84, 'Cinzel Decorative': 0.8, 'Playfair Display': 0.92, 'Libre Caslon Display': 0.92, 'Bodoni Moda': 0.92, 'EB Garamond': 1, 'Libre Baskerville': 0.86,
  Montserrat: 0.9, Jost: 0.95, 'Josefin Sans': 0.95, 'Nunito Sans': 0.95, Lato: 0.98, Inter: 0.92, 'DM Sans': 0.95, Outfit: 0.95, Barlow: 1, 'Open Sans': 0.92,
};
/** Faces drawn in capitals (a Roman or condensed face reads as the brand's wordmark in capitals). */
export const UPPER_FACES = new Set(['Cinzel', 'Cinzel Decorative', 'Bebas Neue', 'Oswald', 'Anton', 'League Gothic', 'Barlow Condensed', 'Fjalla One', 'Archivo Narrow']);

/** A spec's values are safe to draw: every colour a hex, every file one of ours, every face a plain name. */
export const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,40}$/;
export const LOOK_FILE = /^\/look-files\/\d+\/[a-f0-9]{16,64}\.(png|webp|jpg)$/; // never SVG (drawn to PNG when read)
export function validSpec(s: unknown): s is LookSpec {
  const x = s as LookSpec;
  if (!x || x.v !== 1 || typeof x.name !== 'string' || x.name.length > 60) return false;
  if (!x.colors || !COLOR_KEYS.every((k) => isHex(x.colors[k]))) return false;
  const f = x.fonts;
  if (!f || ![f.heading, f.accent, f.body].every((n) => FONT_NAME.test(n)) || !['upper', 'title'].includes(f.headingCase)) return false;
  for (const v of ['dark', 'light'] as const) {
    const L = x.logo?.[v];
    if (!L) continue;
    if (!LOOK_FILE.test(L.src) || !(L.w > 0 && L.h > 0) || !Array.isArray(L.crop) || L.crop.length !== 6 || !L.crop.every((n) => Number.isFinite(n) && n >= 0)) return false;
  }
  if (x.icon !== undefined && !LOOK_FILE.test(x.icon)) return false;
  if (x.photo !== undefined && !LOOK_FILE.test(x.photo)) return false;
  return true;
}
