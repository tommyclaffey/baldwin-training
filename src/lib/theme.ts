// The theme layer (Nov 12, Tommy: "it is the same app so it should feel the same"). Every brand uses the same layouts and
// the same components; a brand only changes the paint: colours, the type face for each role, the logo, the photos and its
// accent (The Baldwin's script line, Mise's one piece of painter's tape). Replaces the Nov 10 "Mise skin", which re-coloured
// The Baldwin's pages for Mise one page type at a time.
//
// How it fits together:
//   1. ROLES: colour roles (page, card, ink, inverse panel, accent…) and type roles (page title, section heading, label…).
//   2. THEMES: one object per brand that fills every role. The Baldwin's values are its own palette (src/styles.css, the
//      Figma file), Mise's come from the Mise brand guide (Figma 01 · Brand guide, 518:74; section 25 on 09 · Proposals).
//   3. DRAWN: the pages are exported from Figma, where they were drawn in The Baldwin's paint. DRAWN says which role each
//      drawn colour plays (one table, the same for every brand), so `themePage` can repaint any page in any brand.
//      Because The Baldwin's values are the drawn colours, its pages come out exactly as drawn (test/theme.test.mjs).
//   4. Layouts shared by every brand (the cinematic hero on dish, cocktail and lesson pages) are built in drawn colours
//      and roles here, then painted by the brand like everything else.
// The coded screens (admin, Team Chat, My Path, quizzes…) read the same roles as CSS variables (`--c-*`, `--font-*`), set
// on <html> from these objects, alongside the older palette tokens in styles.css.
import type { FNode } from '../components/FigmaNode';

/** Every look (Nov 17: looks per store, Testa Barra and J.Baldwin's added). The same ids as server/looks.mjs LOOKS; a look's
 *  paint is its THEMES entry below. test/store-looks.test.mjs checks the two lists match. */
export const BRAND_IDS = ['baldwin', 'mise', 'testabarra', 'jbaldwins'] as const;
export type Brand = typeof BRAND_IDS[number];

/* ── Which brand is on screen ─────────────────────────────────────────────────────────────────────────────────────────
 * Nov 11: the brand is the company's look, sent with the session. Nov 16 (Tommy: "custom brand is an upgraded tier"): Mise
 * is every company's look; a custom look (The Baldwin's) comes with the Custom Brand plan, and the server decides which
 * look a company is drawn in (server/looks.mjs). Signed out it's Mise, the platform's front door. The last signed-in look
 * is remembered on the device, so a custom-look restaurant's loading screen doesn't flash Mise before the session loads.
 * `?brand=mise|baldwin` is kept as a dev override for this tab only (sessionStorage), so it can never stick to someone's
 * real account. Nov 17: the look is the store's (a store can wear its own look; server/looks.mjs lookOfStore). */
const OVERRIDE = 'brand-override';
const LAST = 'look';
const isBrand = (b: unknown): b is Brand => (BRAND_IDS as readonly unknown[]).includes(b);
/** A look id from the server (anything unknown is Mise, the platform's own look). */
export const asBrand = (b: unknown): Brand => (isBrand(b) ? b : 'mise');
let fromSession: Brand = (() => { try { return asBrand(localStorage.getItem(LAST)); } catch { return 'mise'; } })();
let fromPage: Brand | null = null; // a public page that has its own look (the Mise demo picker at /demo/mise)
const inBrowser = typeof document !== 'undefined';
try {
  localStorage.removeItem('brand'); // the old device-wide switch (Nov 10) is retired
  const q = new URLSearchParams(location.search).get('brand');
  if (isBrand(q)) sessionStorage.setItem(OVERRIDE, q);
} catch { /* private mode, or not in a browser */ }
function override(): Brand | null {
  try { const v = sessionStorage.getItem(OVERRIDE); return isBrand(v) ? v : null; } catch { return null; }
}
/** The look to draw right now. Read it while rendering (it changes when someone signs in or a demo starts). */
export function currentBrand(): Brand {
  return override() || fromPage || fromSession;
}
/** The signed-in company's brand (session.tsx sets it on every /api/me). */
export function setSessionBrand(b: string | null | undefined) {
  fromSession = asBrand(b);
  try { if (b) localStorage.setItem(LAST, fromSession); else localStorage.removeItem(LAST); } catch { /* private mode */ }
  apply();
}
/** A signed-out page with its own look (null = follow the session). */
export function setPageBrand(b: Brand | null) { fromPage = b; apply(); }

/* ── 1. Roles ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Colour roles. A role can have tone steps where The Baldwin's drawings use more than one shade for it (four washes,
 *  three hairlines); a brand with fewer shades lists fewer, and the last one covers the rest. */
export type ColorRole =
  | 'page' | 'card' | 'wash' | 'line'                                  // light surfaces and hairlines
  | 'ink' | 'inkMuted' | 'accentText'                                   // type on light
  | 'inverse' | 'inverseRaised' | 'inverseChip' | 'inverseLine'          // the dark panel ("watch = dark") and what sits on it
  | 'onInverse' | 'onInverseMuted' | 'onInverseLabel' | 'accentOnDark'  // type on dark
  | 'accent' | 'onAccent' | 'danger' | 'onDanger'                        // the accent fill, the allergen/warning fill
  // Nov 17 (Testa Barra, J.Baldwin's): the accent fill where it sits on a light surface (a progress bar on a card, a badge).
  // Chartreuse and gold disappear on light (1.1:1, 2.1:1), so those looks use their deep accent there. The Baldwin and Mise
  // use their accent on light too, so for them these are the accent's own values and nothing changes.
  | 'accentOnLight' | 'onAccentOnLight'
  | 'placeholder'                                                        // Nov 17: the beige "photo to come" panel
  | 'edgeStrong' | 'edgeMuted' | 'edgeSoft' | 'outlineOnDark'            // outlines
  | 'button' | 'onButton' | 'buttonOnDark' | 'onButtonOnDark'            // the main button, on light and on a dark panel
  | 'new' | 'onNew' | 'tape' | 'onTape'                                  // "New" status, the taped note
  | 'dataUsed' | 'dataWasted'                                            // chart marks (Nov 12, Prep reports): what got used, what got tossed
  | 'focus' | 'focusBand';                                              // the keyboard focus ring: the accent, and the band beside it
export type Colors = Record<ColorRole, string | string[]>;

/** Type roles. `z` set = the role has its own size; unset = the size the page was drawn at. */
export type TypeRole = 'pageTitle' | 'cardTitle' | 'sectionHeading' | 'cardHeading' | 'smallHeading' | 'label' | 'body' | 'accent';
/** `scale` (Nov 17): the drawn size times this (Bebas Neue is condensed, so Testa Barra's headings draw 1.26× bigger, as
 *  in its Figma Home 734:1085); used when `z` isn't set. `ls` replaces the drawn tracking. */
export type TypeSpec = { ff: string; fs?: string; z?: number; scale?: number; lh?: string; ls?: string; case: 'upper' | 'title' | 'as-is' };

export type Theme = {
  brand: Brand;
  colors: Colors;
  type: Record<TypeRole, TypeSpec>;
  /** The accent line above a hero title: The Baldwin's script line, or Mise's one taped note per screen. Other script
   *  lines: kept (script) or dropped, with an editable one shown as a label so Edit Mode still offers it (tape). */
  accentLine: 'script' | 'tape';
  /** The sidebar and phone-bar logo (null = the logo drawn in the sidebar). */
  logo: { src: string; alt: string; w: number; h: number; phoneH: number; crop?: Crop } | null;
  /** The file in the drawn sidebar's logo slot when `logo` is null (Nov 16): a custom look's own logo. The file is the
   *  account's, on the volume (server/account.mjs), so the build's sidebar carries the slot with no image in it. */
  drawnLogo?: { src: string; alt: string; w?: number; h?: number; crop?: Crop };
  /** The look's logo everywhere else it shows (Nov 17): the phone bar, the admin, the sign-in screens, Privacy/Terms/Help
   *  and the certificate band. `barH`: its height on the phone bar. `crop`: the artwork inside the file (see Crop). */
  mark: { src: string; alt: string; barH: number; crop?: Crop };
  /** Nov 18 (Mise rebrand): the logo for big moments only, the sign-in screens, the demo picker and the certificate band
   *  (Mise: the Mise Academy lockup, "academy" on blue tape). Unset: `mark` everywhere (every custom look). */
  hero?: { src: string; alt: string; crop: Crop };
  /** The tab and home-screen icon (Nov 17): /icons/<icon>-<size>.png. Unset: The Baldwin's way (its store's own icon, or
   *  the store's initial). */
  icon?: string;
  /** The demo tag's paint under the sidebar logo (Nov 9): the tint, its strength, the tag's ink and the line's ink. */
  demoPill: { tint: string; tintO: number; ink: string; muted: string };
  /** Nov 17: the coded screens (admin, My Path, Team Chat, quizzes…) were written in The Baldwin's paint, with Mise's
   *  overrides under .brand-mise. 'roles' = this look paints them from its roles instead (the `look-roles` class on <html>,
   *  styles.css, and the palette tokens from `legacyTokens`), so a new look needs no CSS of its own. */
  coded: 'baldwin' | 'mise' | 'roles';
  /** The active sidebar item: the drawn highlight, or a quiet tint of the panel's ink. */
  activeNav: 'drawn' | 'tint';
  /** Brand rules that aren't a colour or a face. Mise: text on a shaded photo is always light ink; a video's channel
   *  line is muted, not the accent (deep fig is for things that need attention). */
  photoTextLight: boolean;
  quietVideoCaptions: boolean;
};
/** The artwork's box inside a logo file whose PNG carries transparent margins (Testa Barra's wordmark): [x, y, w, h] of
 *  the artwork and the file's own [w, h], in pixels. The file is never changed: CSS shows that box (uniform scale only). */
export type Crop = [number, number, number, number, number, number];

/* ── 2. The brands ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const ARCHIVO = 'Archivo';
/** Mise's title face (Nov 18): DM Serif Display, Regular and Italic (Google Fonts, index.html). Was Instrument Serif. */
const SERIF = 'DM Serif Display';
/** The plain mise lockup for dark backgrounds (Figma Lockup/Mise, Theme=Dark) and its artwork box: the file keeps the
 *  component's clear space above and below (255 × 148), the art is 240.7 × 65.3 inside it. */
export const MISE_ON_DARK = '/img/mise-brand/mise-dark.svg';
export const MISE_ON_LIGHT = '/img/mise-brand/mise-light.svg';
export const MISE_CROP: Crop = [0, 41.3, 240.7, 65.4, 255, 148];
/** Testa Barra's and J.Baldwin's accent-line face, a stand-in for TAN Grandeur (see FONTS). One place to swap it. */
const ACCENT_FACE = 'Gilda Display';
export const THEMES: Record<Brand, Theme> = {
  /* The Baldwin: espresso, cream and copper; Archivo ExtraBold caps titles; a Pinyon Script line above them. */
  baldwin: {
    brand: 'baldwin',
    colors: {
      page: '#F2EEE7', card: '#FBF9F5', wash: ['#F3EEE6', '#EFE3D3', '#F1EADF', '#EEF0E6'], line: ['#E4DCCF', '#DDD3C5', '#CFC5B6', '#B8AFA3'],
      ink: '#1E1C1A', inkMuted: ['#5E574F', '#6B645B', '#4A443D', '#A39B90', '#B8AFA3'], accentText: ['#8A5A3A', '#C49A6C'],
      inverse: '#1E1C1A', inverseRaised: ['#2A2724', '#3F3A35'], inverseChip: '#34302C', inverseLine: ['#3A3632', '#4A443D'],
      onInverse: ['#F2EEE7', '#EDE6DC', '#1E1C1A'], onInverseMuted: ['#E2DACF', '#D9D1C6', '#CFC6BA'], onInverseLabel: '#B8AFA3', accentOnDark: ['#C49A6C', '#8A5A3A'],
      accent: ['#C49A6C', '#8A5A3A'], onAccent: ['#1E1C1A', '#FFFFFF', '#F2EEE7'], danger: '#8E2F24', onDanger: '#FFFFFF',
      edgeStrong: ['#8A5A3A', '#1E1C1A'], edgeMuted: '#6B645B', edgeSoft: '#A39B90', outlineOnDark: '#8A8178',
      button: '#C49A6C', onButton: '#1E1C1A', buttonOnDark: '#C49A6C', onButtonOnDark: '#1E1C1A',
      new: '#E7E2F0', onNew: '#4B3F6B', tape: '#C49A6C', onTape: '#1E1C1A',
      // Prep reports (Nov 12): espresso-copper for used, a warm terracotta for wasted. Checked with the dataviz validator
      // on the card: ΔE 18.4 normal vision, 13.8 protan; 6.7:1 and 3.4:1 against the card.
      dataUsed: '#7A4E31', dataWasted: '#D06A4C',
      // Focus ring (Nov 12, accessibility scan): copper with an espresso band. Copper alone is 2.2:1 on cream; the band is
      // 14.7:1 on cream and 16.2:1 on the card, and copper is 6.6:1 on the espresso sidebar, so one tone passes 3:1 everywhere.
      focus: '#C49A6C', focusBand: '#1E1C1A',
      accentOnLight: ['#C49A6C', '#8A5A3A'], onAccentOnLight: ['#1E1C1A', '#FFFFFF', '#F2EEE7'], // = accent, onAccent
      placeholder: '#E7DECF',
    },
    type: {
      pageTitle: { ff: ARCHIVO, fs: 'ExtraBold', case: 'upper' },
      cardTitle: { ff: ARCHIVO, fs: 'ExtraBold', case: 'upper' },
      sectionHeading: { ff: ARCHIVO, fs: 'ExtraBold', case: 'upper' },
      cardHeading: { ff: ARCHIVO, fs: 'ExtraBold', case: 'upper' },
      smallHeading: { ff: ARCHIVO, fs: 'ExtraBold', case: 'upper' },
      label: { ff: ARCHIVO, case: 'as-is' },
      body: { ff: ARCHIVO, case: 'as-is' },
      accent: { ff: 'Pinyon Script', fs: 'Regular', case: 'as-is' },
    },
    accentLine: 'script',
    logo: null,
    drawnLogo: { src: '/img/01f36254e089.png', alt: 'The Baldwin' }, // its official logo, white (Baldwin Restaurant Group's account files)
    mark: { src: '/img/logo-white.png', alt: 'The Baldwin', barH: 28 }, // the same logo (account files)
    demoPill: { tint: '#C49A6C', tintO: .24, ink: '#EBD2B2', muted: '#B8AFA3' },
    coded: 'baldwin',
    activeNav: 'drawn',
    photoTextLight: false,
    quietVideoCaptions: false,
  },
  /* Mise: light first (Bone page, Paper cards, Char panels), one red (deep fig) used sparingly, olive for "new",
   * DM Serif Display only from 40 px up (Nov 18 rebrand, Tommy: "Sold. This is our branding."): page titles and heroes in
   * its italic (Figma Mise/Page title, 64, 100%, −0.5%), card titles upright; Archivo SemiBold headings, DM Mono labels,
   * one taped note per screen. Logo: plain "mise" (Tommy's garlic + fig, Sauce TM outlined) in the nav and anywhere small;
   * the Mise Academy lockup ("academy" on blue tape) for big moments only. Figma YEaa2NZIPbFqldCyUxrIEi, 02 · Design system:
   * Lockup/Mise 508:31, Lockup/Mise Academy 508:52; the files are its exports, as they are (public/img/mise-brand/,
   * "-dark" = Theme=Dark, cream for dark backgrounds). The crops show the artwork inside each file at uniform scale. */
  mise: {
    brand: 'mise',
    colors: {
      page: '#EDE6DA', card: '#FBF8F2', wash: '#F4EFE0', line: '#D9CFBF',
      ink: '#121110', inkMuted: '#4A443E', accentText: '#8E2A26',
      inverse: '#121110', inverseRaised: ['#1E1C1A', '#26231F'], inverseChip: '#34302C', inverseLine: '#34302C',
      onInverse: '#EDE6DA', onInverseMuted: '#D9D4CB', onInverseLabel: '#9A928A', accentOnDark: '#9A928A',
      accent: '#8E2A26', onAccent: '#FFFFFF', danger: '#8E2A26', onDanger: '#FFFFFF',
      edgeStrong: '#121110', edgeMuted: '#4A443E', edgeSoft: '#9A928A', outlineOnDark: '#7F776F',
      button: '#121110', onButton: '#EDE6DA', buttonOnDark: '#EDE6DA', onButtonOnDark: '#121110',
      new: '#5B6B2E', onNew: '#FFFFFF', tape: '#7BA5CB', onTape: '#121110',
      // Prep reports (Nov 12): char-grey for used, a lighter fig for wasted (fig is Mise's "needs attention").
      // ΔE 21.0 normal vision, 9.5 protan, both ≥ 3:1 against Paper.
      dataUsed: '#4A443E', dataWasted: '#B8463F',
      // Focus ring (Nov 12): deep fig with a bone band. Fig is 6.8:1 on Bone and 7.9:1 on Paper but 2.3:1 on Char, where the
      // bone band is 15.2:1, so one tone passes 3:1 on the sidebar, dark buttons and light cards alike.
      focus: '#8E2A26', focusBand: '#EDE6DA',
      accentOnLight: '#8E2A26', onAccentOnLight: '#FFFFFF', // = accent, onAccent
      placeholder: '#E7DECF', // (as drawn, as before)
    },
    type: {
      pageTitle: { ff: SERIF, fs: 'Italic', z: 64, lh: '100%', ls: '-0.5%', case: 'title' },
      cardTitle: { ff: SERIF, fs: 'Regular', z: 32, lh: '100%', ls: '-0.5%', case: 'title' },
      sectionHeading: { ff: ARCHIVO, fs: 'SemiBold', z: 26, lh: '125%', ls: '-1%', case: 'title' },
      cardHeading: { ff: ARCHIVO, fs: 'SemiBold', z: 20, lh: '125%', ls: '-1%', case: 'title' },
      smallHeading: { ff: ARCHIVO, fs: 'Bold', case: 'title' },
      label: { ff: 'DM Mono', fs: 'Medium', ls: '12%', case: 'as-is' },
      body: { ff: ARCHIVO, case: 'as-is' },
      accent: { ff: 'Reenie Beanie', fs: 'Regular', z: 26, lh: '100%', case: 'as-is' },
    },
    accentLine: 'tape',
    logo: { src: MISE_ON_DARK, alt: 'Mise', w: 136, h: 37, phoneH: 28, crop: MISE_CROP },
    mark: { src: MISE_ON_DARK, alt: 'Mise', barH: 28, crop: MISE_CROP },
    hero: { src: '/img/mise-brand/mise-academy-dark.svg', alt: 'Mise Academy', crop: [0, 25, 263.3, 81, 289, 150] },
    icon: 'mise',
    demoPill: { tint: '#8E2A26', tintO: .42, ink: '#F6D3CE', muted: '#9A928A' },
    coded: 'mise',
    activeNav: 'tint',
    photoTextLight: true,
    quietVideoCaptions: true,
  },
  /* Testa Barra (Nov 17, Figma 09 · Proposals → 33: brand sheet 736:1085, Home 734:1085; from testabarra.com): navy panels,
   * chartreuse only on navy, blush light surfaces, deep coral for links, tags, allergens and accents on light. Bebas Neue
   * headings (after the condensed wordmark; the site's TAN Grandeur is licensed), Archivo labels and body, Gilda Display
   * for the accent line (a free stand-in for TAN Grandeur). Its own white wordmark, the only version the site has. */
  testabarra: {
    brand: 'testabarra',
    colors: {
      page: '#F7EDEA', card: '#FDF9F8', wash: ['#F9EEEB', '#F5E0DC', '#F7E8E4', '#F4ECEA'], line: ['#EDDCD7', '#E3CCC6', '#D6BDB6', '#B4BAC8'],
      ink: '#0E1525', inkMuted: ['#4A5570', '#5A647C', '#3C475F', '#7D869A', '#B4BAC8'], accentText: ['#B23A32', '#B23A32'],
      inverse: '#1F2A44', inverseRaised: ['#283350', '#3C475F'], inverseChip: '#3C475F', inverseLine: ['#34405C', '#4A5570'],
      onInverse: ['#FFFFFF', '#F5E0DC', '#0E1525'], onInverseMuted: ['#E1E4EB', '#D6DAE3', '#C9CEDA'], onInverseLabel: '#B4BAC8', accentOnDark: ['#DFFF00', '#DFFF00'],
      accent: ['#DFFF00', '#DFFF00'], onAccent: ['#0E1525', '#0E1525', '#0E1525'], danger: '#B23A32', onDanger: '#FFFFFF',
      accentOnLight: ['#B23A32', '#B23A32'], onAccentOnLight: ['#FFFFFF', '#FFFFFF', '#FFFFFF'], placeholder: '#F0DDD8',
      edgeStrong: ['#B23A32', '#0E1525'], edgeMuted: '#5A647C', edgeSoft: '#7D869A', outlineOnDark: '#8A93A6',
      button: '#1F2A44', onButton: '#FFFFFF', buttonOnDark: '#DFFF00', onButtonOnDark: '#0E1525',
      new: '#E7E2F0', onNew: '#4B3F6B', tape: '#DFFF00', onTape: '#0E1525',
      dataUsed: '#1F2A44', dataWasted: '#B23A32',
      focus: '#B23A32', focusBand: '#FFFFFF',
    },
    type: {
      pageTitle: { ff: 'Bebas Neue', fs: 'Regular', scale: 1.26, ls: '1%', case: 'upper' },
      cardTitle: { ff: 'Bebas Neue', fs: 'Regular', scale: 1.26, ls: '1%', case: 'upper' },
      sectionHeading: { ff: 'Bebas Neue', fs: 'Regular', scale: 1.26, ls: '1%', case: 'upper' },
      cardHeading: { ff: 'Bebas Neue', fs: 'Regular', scale: 1.26, ls: '1%', case: 'upper' },
      smallHeading: { ff: 'Bebas Neue', fs: 'Regular', scale: 1.26, ls: '1%', case: 'upper' },
      label: { ff: ARCHIVO, ls: '16%', case: 'as-is' },
      body: { ff: ARCHIVO, case: 'as-is' },
      accent: { ff: ACCENT_FACE, fs: 'Regular', lh: '115%', case: 'as-is' }, // same sizes as the script it replaces (Figma 734:1187)
    },
    accentLine: 'script',
    logo: null,
    // testa_barra_white.webp (1200 × 600, testabarra.com), its transparent margins left in the file and cropped by CSS
    drawnLogo: { src: '/img/looks/testabarra-wordmark-white.webp', alt: 'Testa Barra', w: 164, h: 39.4, crop: [36, 165, 1129, 271, 1200, 600] },
    mark: { src: '/img/looks/testabarra-wordmark-white.webp', alt: 'Testa Barra', barH: 24, crop: [36, 165, 1129, 271, 1200, 600] },
    icon: 'testabarra',
    demoPill: { tint: '#DFFF00', tintO: .18, ink: '#F2FF99', muted: '#B4BAC8' },
    coded: 'roles',
    activeNav: 'drawn',
    photoTextLight: false,
    quietVideoCaptions: false,
  },
  /* J.Baldwin's (Nov 17, Figma 09 · Proposals → 33: brand sheet 737:1085, Home 735:1085; from
   * jbaldwins.com): near-black panels, gold only on dark, cream light surfaces, the logo's burgundy J for links, tags,
   * allergens and accents on light. Cinzel headings (after the Roman wordmark; the site's TAN Grandeur is licensed),
   * Montserrat labels and body (the site's own web font), Gilda Display for the accent line (a stand-in for TAN Grandeur). */
  jbaldwins: {
    brand: 'jbaldwins',
    colors: {
      page: '#F3E9DA', card: '#FBF1E3', wash: ['#F7EEE1', '#EFE3D0', '#F2E8DA', '#F1EBDF'], line: ['#E7DCCB', '#D9D1C2', '#C9BFAE', '#9A9282'],
      ink: '#0B0A08', inkMuted: ['#5C554A', '#6B6457', '#3A352D', '#857D70', '#9A9282'], accentText: ['#860028', '#860028'],
      inverse: '#0B0A08', inverseRaised: ['#1A1814', '#23211E'], inverseChip: '#3A352D', inverseLine: ['#2A2722', '#3A352D'],
      onInverse: ['#FBF1E3', '#F3E8D6', '#0B0A08'], onInverseMuted: ['#E6DDCD', '#D9D1C2', '#C2BAA8'], onInverseLabel: '#9A9282', accentOnDark: ['#C9A455', '#C9A455'],
      accent: ['#C9A455', '#C9A455'], onAccent: ['#0B0A08', '#0B0A08', '#0B0A08'], danger: '#860028', onDanger: '#FFFFFF',
      accentOnLight: ['#860028', '#860028'], onAccentOnLight: ['#FFFFFF', '#FFFFFF', '#FFFFFF'], placeholder: '#EADFCB',
      edgeStrong: ['#860028', '#0B0A08'], edgeMuted: '#6B6457', edgeSoft: '#857D70', outlineOnDark: '#857D70',
      button: '#0B0A08', onButton: '#FBF1E3', buttonOnDark: '#C9A455', onButtonOnDark: '#0B0A08',
      new: '#E7E2F0', onNew: '#4B3F6B', tape: '#C9A455', onTape: '#0B0A08',
      dataUsed: '#8A6B22', dataWasted: '#860028',
      focus: '#860028', focusBand: '#FBF1E3',
    },
    type: {
      pageTitle: { ff: 'Cinzel', fs: 'Bold', scale: 0.84, ls: '2%', case: 'upper' },
      cardTitle: { ff: 'Cinzel', fs: 'Bold', scale: 0.84, ls: '2%', case: 'upper' },
      sectionHeading: { ff: 'Cinzel', fs: 'Bold', scale: 0.94, ls: '2%', case: 'upper' },
      cardHeading: { ff: 'Cinzel', fs: 'Bold', scale: 0.94, ls: '2%', case: 'upper' },
      smallHeading: { ff: 'Cinzel', fs: 'Bold', scale: 0.94, ls: '2%', case: 'upper' },
      label: { ff: 'Montserrat', ls: '12%', case: 'as-is' },
      body: { ff: 'Montserrat', case: 'as-is' },
      accent: { ff: ACCENT_FACE, fs: 'Regular', lh: '115%', case: 'as-is' }, // same sizes as the script it replaces (Figma 734:1187)
    },
    accentLine: 'script',
    logo: null,
    // JBALDWINSLOGO_white.webp (1248 × 463, jbaldwins.com): 12 px of transparent margin under the artwork, cropped by CSS
    drawnLogo: { src: '/img/looks/jbaldwins-logo-white.webp', alt: 'J.Baldwin’s', w: 164, h: 59.3, crop: [0, 0, 1248, 451, 1248, 463] },
    mark: { src: '/img/looks/jbaldwins-logo-white.webp', alt: 'J.Baldwin’s', barH: 32, crop: [0, 0, 1248, 451, 1248, 463] },
    icon: 'jbaldwins',
    demoPill: { tint: '#C9A455', tintO: .24, ink: '#EAD7A6', muted: '#9A9282' },
    coded: 'roles',
    activeNav: 'drawn',
    photoTextLight: false,
    quietVideoCaptions: false,
  },
};

export function theme(b: Brand = currentBrand()): Theme { return THEMES[b]; }
/** A role's colour in a brand (tone step `i`, or the last step the brand has). */
export function color(t: Theme, role: ColorRole, i = 0): string {
  const v = t.colors[role];
  return Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v;
}

/* The roles as CSS variables on <html>, so coded screens and the shared CSS (the hero's fade) paint from the same object. */
const cssName = (r: string) => '--c-' + r.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
/** Every face a look uses: its CSS stack, and where it loads from. The Baldwin's and Mise's load with the app (index.html);
 *  a newer look's faces load when that look is first drawn (`loadFonts`), so nobody else downloads them.
 *  ACCENT_FACE (Nov 17): Testa Barra's and J.Baldwin's accent line is Gilda Display, a free stand-in for the licensed TAN
 *  Grandeur both sites use (Tommy: Bigelow Rules was "too cartoony"). Swapping in the real face is one place: point
 *  ACCENT_FACE at a new entry here (its stack, and a Google Fonts family or a self-hosted @font-face in styles.css). */
export const FONTS: Record<string, { css: string; google?: string }> = {
  Archivo: { css: "'Archivo', system-ui, sans-serif" }, 'DM Serif Display': { css: "'DM Serif Display', Georgia, serif" },
  'DM Mono': { css: "'DM Mono', ui-monospace, monospace" }, 'Pinyon Script': { css: "'Pinyon Script', cursive" }, 'Reenie Beanie': { css: "'Reenie Beanie', cursive" },
  'Bebas Neue': { css: "'Bebas Neue', 'Archivo Narrow', sans-serif", google: 'Bebas+Neue' },
  Cinzel: { css: "'Cinzel', Georgia, serif", google: 'Cinzel:wght@400;600;700' },
  Montserrat: { css: "'Montserrat', system-ui, sans-serif", google: 'Montserrat:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400' },
  'Gilda Display': { css: "'Gilda Display', Georgia, serif", google: 'Gilda+Display' },
};
const FONT_CSS: Record<string, string> = Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.css]));
/** The CSS stack for a face (FigmaNode uses it for drawn text). */
export const fontCss = (ff: string | undefined) => (ff && FONT_CSS[ff]) || FONT_CSS.Archivo;
/** A look's faces that load on demand: one Google Fonts stylesheet (inside the CSP's style-src). */
export function fontsUrl(t: Theme): string | null {
  const fams = [...new Set(Object.values(t.type).map((x) => FONTS[x.ff]?.google).filter(Boolean))];
  return fams.length ? `https://fonts.googleapis.com/css2?${fams.map((f) => 'family=' + f).join('&')}&display=swap` : null;
}
function loadFonts(t: Theme) {
  const href = fontsUrl(t);
  if (!href || document.querySelector(`link[data-look-fonts="${t.brand}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.dataset.lookFonts = t.brand;
  document.head.appendChild(l);
}
/** The admin's select chevron (Nov 17, Tommy: "fix the drop-down arrows in the pill"), drawn in one of the look's colours. */
export const chevron = (hex: string) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23${hex.replace('#', '')}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
export function themeVars(t: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of Object.keys(t.colors) as ColorRole[]) out[cssName(r)] = color(t, r);
  // every <select> in the admin: ink on light surfaces, the on-dark type colour in the dark sidebar (src/styles.css)
  out['--select-chevron'] = chevron(color(t, 'ink'));
  out['--select-chevron-on-dark'] = chevron(color(t, 'onInverse'));
  for (const r of Object.keys(t.type) as TypeRole[]) out['--font-' + r.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] = FONT_CSS[t.type[r].ff] || FONT_CSS.Archivo;
  if (t.coded === 'roles') Object.assign(out, legacyTokens(t));
  return out;
}
const hexRgb = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`; };
/** The palette tokens the coded screens read (styles.css :root, written in The Baldwin's paint), filled from a look's
 *  roles (Nov 17). Only for `coded: 'roles'` looks: The Baldwin keeps :root and Mise its .brand-mise block, unchanged. */
export function legacyTokens(t: Theme): Record<string, string> {
  const c = (r: ColorRole, i = 0) => color(t, r, i);
  const head = t.type.sectionHeading;
  const W: Record<string, string> = { Regular: '400', Medium: '500', SemiBold: '600', Bold: '700', ExtraBold: '800' };
  return {
    '--ink': c('ink'), '--ink-fill': c('inverse'), '--cream': c('page'), '--card': c('card'), '--line': c('line'),
    '--copper': c('accentOnLight'), '--copper-dk': c('accentText'), '--copper-rgb': hexRgb(c('accentOnLight')),
    '--copper-text': c('accentOnDark'), '--on-copper': c('onAccentOnLight'), '--muted': c('inkMuted'),
    '--copper-lt': c('wash', 1), '--copper-lt-2': c('line', 0),
    '--tint': c('wash', 1), '--tint-2': c('wash', 2), '--tint-3': c('line', 0),
    '--border': c('line', 1), '--border-2': c('line', 2), '--hair': c('line', 0),
    '--wash': c('wash', 0), '--wash-2': c('wash', 2), '--wash-3': c('wash', 3), '--wash-4': c('card'),
    '--dark-2': c('inverseRaised', 0), '--dark-3': c('inverseChip'), '--dark-line': c('inverseLine', 0),
    '--on-dark-muted': c('onInverseLabel'), '--on-dark-2': c('onInverseMuted', 1), '--on-dark-3': c('onInverseMuted', 0), '--ink-2': c('ink'),
    '--look-head-weight': W[head.fs || 'Bold'] || '700', '--look-head-ls': head.ls ? `${parseFloat(head.ls) / 100}em` : '0',
    '--look-body': FONT_CSS[t.type.body.ff] || FONT_CSS.Archivo, // the coded screens' text face (styles.css falls back to Archivo)
  };
}
const LEGACY_KEYS = Object.keys(legacyTokens(THEMES.testabarra));
// The look changed: the class on <html>, the role variables, and a 'brandchange' event (favicon.ts swaps the tab icon on it).
function apply() {
  if (!inBrowser) return;
  const b = currentBrand(); const root = document.documentElement; const t = THEMES[b];
  root.classList.toggle('brand-mise', b === 'mise');
  root.classList.toggle('look-roles', t.coded === 'roles'); // Nov 17: the coded screens painted from the look's roles
  root.dataset.brand = b;
  if (t.coded !== 'roles') for (const k of LEGACY_KEYS) root.style.removeProperty(k); // back to :root (The Baldwin) or .brand-mise
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
  loadFonts(t);
  window.dispatchEvent(new Event('brandchange'));
}
apply();

/* ── 3. What each drawn colour is (the same for every brand) ───────────────────────────────────────────────────────────
 * The pages were drawn in The Baldwin's paint. Each entry: drawn colour → `role` or `role.step`. Text depends on what it
 * sits on. A colour that isn't listed keeps its drawn value in every brand (greens for "done", photo shades, white). */
type Ref = `${ColorRole}` | `${ColorRole}.${number}`;
export const DRAWN: Record<'fill' | 'stroke' | 'textOnLight' | 'textOnDark' | 'textOnAccent', Record<string, Ref>> = {
  fill: {
    '#F2EEE7': 'page', '#FBF9F5': 'card', '#F3EEE6': 'wash.0', '#EFE3D3': 'wash.1', '#F1EADF': 'wash.2', '#EEF0E6': 'wash.3',
    '#E4DCCF': 'line.0', '#DDD3C5': 'line.1', '#CFC5B6': 'line.2',
    '#1E1C1A': 'inverse', '#2A2724': 'inverseRaised.0', '#3F3A35': 'inverseRaised.1', '#3A3632': 'inverseLine.0',
    '#C49A6C': 'accent.0', '#8A5A3A': 'accent.1', '#8E2F24': 'danger', '#E7DECF': 'placeholder',
  },
  stroke: {
    '#E4DCCF': 'line.0', '#DDD3C5': 'line.1', '#B8AFA3': 'line.3', '#8A5A3A': 'edgeStrong.0', '#1E1C1A': 'edgeStrong.1',
    '#C49A6C': 'accent.0', '#6B645B': 'edgeMuted', '#A39B90': 'edgeSoft', '#3A3632': 'inverseLine.0', '#4A443D': 'inverseLine.1',
    '#8A8178': 'outlineOnDark',
  },
  textOnLight: {
    '#1E1C1A': 'ink', '#5E574F': 'inkMuted.0', '#6B645B': 'inkMuted.1', '#4A443D': 'inkMuted.2', '#A39B90': 'inkMuted.3', '#B8AFA3': 'inkMuted.4',
    '#8A5A3A': 'accentText.0', '#C49A6C': 'accentText.1',
  },
  textOnDark: {
    // step 2: dark type that a drawing left on a dark fill (the beer page's tap-colour chips); a brand may repair it
    '#F2EEE7': 'onInverse.0', '#EDE6DC': 'onInverse.1', '#1E1C1A': 'onInverse.2', '#E2DACF': 'onInverseMuted.0', '#D9D1C6': 'onInverseMuted.1', '#CFC6BA': 'onInverseMuted.2',
    '#B8AFA3': 'onInverseLabel', '#C49A6C': 'accentOnDark.0', '#8A5A3A': 'accentOnDark.1',
  },
  textOnAccent: { '#1E1C1A': 'onAccent.0', '#FFFFFF': 'onAccent.1', '#F2EEE7': 'onAccent.2' },
};
/** The drawn colour for a role: what shared layouts (the cinematic hero) are built in, before a brand paints them. */
export function drawn(role: ColorRole, i = 0) { return color(THEMES.baldwin, role, i); }
function paint(t: Theme, ctx: keyof typeof DRAWN, hex: string | undefined, onLight = false): string | undefined {
  const ref = hex && DRAWN[ctx][hex.toUpperCase()];
  if (!ref) return undefined;
  const [role, step] = ref.split('.') as [ColorRole, string?];
  // Nov 17: an accent fill or outline drawn on a light surface takes the look's accent for light (the same for The Baldwin)
  const r: ColorRole = onLight && role === 'accent' && ctx !== 'textOnAccent' ? 'accentOnLight' : role;
  return color(t, r, step ? Number(step) : 0);
}
const roleOf = (ctx: keyof typeof DRAWN, hex?: string) => (hex ? DRAWN[ctx][hex.toUpperCase()]?.split('.')[0] : undefined) as ColorRole | undefined;

/* ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────── */

function lum(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
/** A frame whose background is a photo under a Shade layer (the program level cards): its text sits on dark. */
const ON_PHOTO = '#000001';
const isDark = (hex?: string) => !!hex && /^#[0-9a-f]{6}/i.test(hex) && lum(hex) < 0.2;
const up = (s?: string) => (s || '').toUpperCase();
const solid = (n: FNode) => n.f?.find((f) => f.c && (f.o ?? 1) > 0.5)?.c;
const find = (n: FNode, f: (x: FNode) => boolean): FNode | null => { if (f(n)) return n; for (const c of n.c || []) { const r = find(c, f); if (r) return r; } return null; };
const all = (n: FNode, f: (x: FNode) => boolean, out: FNode[] = []) => { if (f(n)) out.push(n); (n.c || []).forEach((c) => all(c, f, out)); return out; };

const SMALL = new Set(['a', 'an', 'and', 'of', 'the', 'to', 'or', 'at', 'by', 'in', 'on', 'for', 'with']);
// Nov 11: short names that stay in capitals ("USA" read "Usa" on the Wine page). Nov 14: "ID" ("Check ID" read "Check Id").
const KEEP_CAPS = new Set(['usa', 'uk', 'ipa', 'vs', 'vsop', 'xo', 'xxo', 'abv', 'pos', 'na', 'ny', 'diy', 'tv', 'am', 'pm', 'id']);
/** "OLD FASHIONED" → "Old Fashioned"; leaves mixed-case text alone. */
export function titleCase(s: string) {
  if (!s || s !== s.toUpperCase() || !/[A-Z]{2}/.test(s)) return s;
  // split on any space or line break and keep it ("SOMMELIER\nPROGRAM" → "Sommelier\nProgram")
  let i = -1;
  return s.toLowerCase().split(/(\s+)/).map((w) => { if (/^\s*$/.test(w)) return w; i++; return !/['’]/.test(w) && KEEP_CAPS.has(w.replace(/[^a-z]/g, '')) ? w.toUpperCase() : i > 0 && SMALL.has(w) ? w : w.replace(/(^|-)([^a-z]*)([a-z])/g, (_m, h, p, c) => h + p + c.toUpperCase()); }).join('');
}
/** A title in the brand's case: The Baldwin's capitals, Mise's Title Case. For coded screens ("MY PATH" / "My Path"). */
export function brandTitle(s: string, t: Theme = theme()) { return t.type.pageTitle.case === 'title' ? titleCase(s) : s.toUpperCase(); }

/* ── Type roles: which role each drawn text plays ──────────────────────────────────────────────────────────────────────
 * Drawn type (The Baldwin): Archivo ExtraBold for every heading, Archivo Bold/SemiBold small capitals for labels, Pinyon
 * Script for the accent line. Which heading is which comes from where it sits:
 *   the page's own title (one per page: the hero's title)      → pageTitle
 *   a big title inside a card (program levels, hub tiles)        → cardTitle
 *   a small bold heading (a lesson's "01" badge)                 → smallHeading
 *   a section heading ("Your Path", "Start Here"), 26 px and up  → sectionHeading; smaller ones → cardHeading */
type Ctx = { title: FNode | null; card: number | null; outline?: boolean };
/** The page's own title: the biggest ExtraBold text in the hero; with no hero, the first ExtraBold text of 40 px or more. */
function pageTitle(main: FNode): FNode | null {
  const heavy = (t: FNode) => t.t === 'T' && t.ff === 'Archivo' && t.fs === 'ExtraBold';
  const hero = find(main, (n) => /^(Hero|Header)\b/.test(n.n || '') && n.t !== 'T');
  const inHero = hero ? all(hero, (t) => heavy(t) && ((t.z || 0) >= 30 || !!t.lw)) : [];
  if (inHero.length) return inHero.reduce((a, b) => ((b.z || 0) > (a.z || 0) ? b : a));
  return all(main, (t) => heavy(t) && (t.z || 0) >= 40)[0] || null;
}
function typeRole(t: FNode, bg: string | undefined, inPill: boolean, ctx: Ctx): TypeRole {
  if (t.ff === 'Pinyon Script') return 'accent';
  const z = t.z || 14;
  if (t.ff === 'Archivo' && t.fs === 'ExtraBold') {
    if (t === ctx.title) return 'pageTitle';
    if (ctx.card && (z >= 40 || (bg === ON_PHOTO && z >= 22)) && ctx.card >= 200) return 'cardTitle';
    if (z < 18) return 'smallHeading';
    return z >= 26 || (!ctx.card && t.lw) ? 'sectionHeading' : 'cardHeading';
  }
  if (t.ff === 'Archivo' && (t.fs === 'Bold' || t.fs === 'SemiBold') && z <= 12.5 && !inPill && t.s && t.s === t.s.toUpperCase() && /[A-Z]{2}/.test(t.s)) return 'label';
  return 'body';
}

const scaled = (z: number, k: number) => Math.round(z * k * 2) / 2;
function themeText(th: Theme, t: FNode, bg: string | undefined, drawnBg: string | undefined, inPill: boolean, ctx: Ctx) {
  const dark = isDark(bg) || bg === ON_PHOTO;
  const role = typeRole(t, bg, inPill, ctx);
  const spec = th.type[role];
  // Accessibility (Nov 12 scan): the page's headings become real h1–h3 (FigmaNode). The level comes from the drawn type, so
  // it's the same in every brand; `outlinePage` evens out the order afterwards.
  if (ctx.outline && !inPill && !t.to && /\p{L}/u.test(t.s || '')) { // (a number on its own, a step's "01", is a badge, not a heading)
    const want = role === 'pageTitle' ? 1 : role === 'sectionHeading' || (role === 'cardHeading' && (t.z || 14) >= 26) ? 2 : role === 'cardTitle' || role === 'cardHeading' ? 3 : 0;
    if (want) t.hd = want;
  }
  // Edit Mode: a field on a dark panel draws its outline light; a title typed in the brand's case, not forced to capitals
  if (t.ed) t.ed = { ...t.ed, ...(th.type.pageTitle.case === 'title' ? { u: undefined } : {}), ...(dark ? { dk: 1 as const } : {}) };
  // colour: what the drawn colour is, on what it sits
  const c = up(solid(t));
  const p = paint(th, isDark(bg) ? 'textOnDark' : 'textOnLight', c);
  if (p) t.f = [{ c: p }];
  if (th.photoTextLight && bg === ON_PHOTO && t.f?.[0]?.c && ![color(th, 'onInverse'), color(th, 'onInverseMuted'), '#FFFFFF'].includes(up(t.f[0].c))) t.f = [{ c: color(th, 'onInverseMuted') }];
  // on a filled accent or warning (a pill, a badge, a count): the brand's ink for that fill. Nov 17: an accent fill that sits
  // on light was painted in the look's accent for light (its deep accent), so the ink is the one for that fill
  const under = drawnBg && DRAWN.fill[up(drawnBg)];
  if (under?.startsWith('accent')) {
    const step = Number(under.split('.')[1] || 0);
    const onLightFill = up(bg) === up(color(th, 'accentOnLight', step)) && up(bg) !== up(color(th, 'accent', step));
    const ref = DRAWN.textOnAccent[up(c)];
    t.f = [{ c: onLightFill ? color(th, 'onAccentOnLight', ref ? Number(ref.split('.')[1] || 0) : 0) : paint(th, 'textOnAccent', c) || color(th, 'onAccent') }];
  } else if (under === 'danger') t.f = [{ c: color(th, 'onDanger') }];
  // type
  const z = t.z || 14;
  // Nov 17: a look whose body or accent line is another face (J.Baldwin's Montserrat; Gilda Display for the script line).
  // The Baldwin's and Mise's are the drawn faces, so their text is left as drawn.
  if (role === 'body') { if (spec.ff !== t.ff && t.ff === ARCHIVO) t.ff = spec.ff; return; }
  if (role === 'accent') {
    if (spec.ff !== t.ff && th.accentLine === 'script') { t.ff = spec.ff; if (spec.fs) t.fs = spec.fs; if (spec.scale) t.z = scaled(z, spec.scale); if (spec.ls) t.ls = spec.ls; if (spec.lh) t.lh = spec.lh; }
    return;
  }
  // (the drawn text is already in The Baldwin's case, so only a Title Case brand changes it)
  if (spec.case === 'title' && role !== 'label') t.s = titleCase(t.s || '');
  if (role === 'label') { t.ff = spec.ff; if (spec.fs) t.fs = spec.fs; if (spec.ls) t.ls = spec.ls; return; }
  if (spec.z === undefined) { // the drawn size (Nov 17: times the look's scale, with its tracking)
    t.ff = spec.ff; if (spec.fs) t.fs = spec.fs;
    if (spec.scale) t.z = scaled(z, spec.scale);
    if (spec.ls) t.ls = spec.ls;
    return;
  }
  if (role === 'pageTitle') {
    // Nov 18: DM Serif Display is wider than Instrument Serif was, so a title whose longest word is known (the hero titles,
    // wine and bottle names) comes down from the role's size just enough for that word to fit its box (about 0.5 em a
    // letter in the italic; measured 0.47 on average, 0.54 at most). Never shortened, never cut.
    const fit = t.lw && t.w ? Math.floor(t.w / (t.lw * 0.5)) : Infinity;
    Object.assign(t, { ff: spec.ff, fs: spec.fs, z: Math.min(spec.z, Math.max(34, fit)), lh: spec.lh, ls: spec.ls }); delete t.lw;
  }
  else if (role === 'cardTitle') {
    // a big title in a card: wrapping inside the card (never one long line that the card cuts off)
    Object.assign(t, { ff: spec.ff, fs: spec.fs, z: spec.z, lh: spec.lh, ls: spec.ls, tb: 1 });
    if (t.ar === 'W') { t.ar = 'H'; t.sh = 'F'; }
    // lw stays: on phones the card sizes the title by its longest word (styles.css), so no word is cut
  } else {
    const h = role === 'sectionHeading' || (role === 'cardHeading' && z >= 26) ? th.type.sectionHeading : th.type.cardHeading;
    Object.assign(t, { ff: h.ff, fs: h.fs, z: h.z, lh: h.lh, ls: h.ls, tb: 1 }); delete t.lw;
  }
}

/** Walks a page and paints it in the brand: every drawn colour by its role, every text by its type role. */
function walk(th: Theme, n: FNode, bg: string | undefined, drawnBg: string | undefined, inPill: boolean, ctx: Ctx = { title: null, card: null }): FNode | null {
  if (n.t === 'T' && n.ff === 'Pinyon Script' && th.accentLine === 'tape') {
    // Script lines in a brand without them: dropped (one taped note per screen). An editable one (a cocktail's tagline)
    // stays for Edit Mode, as a label.
    if (!n.ed) return null;
    const dark = isDark(bg) || bg === ON_PHOTO; const l = th.type.label;
    n.eo = 1; n.ff = l.ff; n.fs = l.fs; n.z = 13; n.ls = l.ls; n.lh = '130%';
    n.f = [{ c: dark ? color(th, 'onInverseMuted') : color(th, 'inkMuted') }];
    n.ed = { ...n.ed, u: undefined, ...(dark ? { dk: 1 as const } : {}) };
    return n;
  }
  const own = solid(n);
  const light = !isDark(bg) && bg !== ON_PHOTO; // what this node sits on
  if (n.f && n.t !== 'T') n.f = n.f.map((f) => { const p = f.c ? paint(th, 'fill', f.c, light) : undefined; return p ? { ...f, c: p } : f; });
  if (n.st) n.st = paint(th, 'stroke', n.st, light) || n.st;
  const photoBg = n.t !== 'T' && !own && n.f?.some((f) => f.img) && (n.c || []).some((c) => c.n === 'Shade');
  const here = photoBg ? ON_PHOTO : n.t !== 'T' && own ? (n.f?.find((f) => f.c)?.c || bg) : bg;
  const drawnHere = photoBg ? ON_PHOTO : n.t !== 'T' && own ? own : drawnBg;
  // The main button (drawn as an accent or warning fill): the brand's button, on light or on a dark panel
  const ownRole = roleOf('fill', own);
  if ((n.n || '').startsWith('Button') && (up(own) === drawn('accent') || ownRole === 'danger')) {
    const onDark = isDark(bg);
    n.f = [{ c: color(th, onDark ? 'buttonOnDark' : 'button') }];
    const ink = color(th, onDark ? 'onButtonOnDark' : 'onButton');
    const inkAll = (x: FNode) => { if (x.t === 'T') x.f = [{ c: ink }]; (x.c || []).forEach(inkAll); };
    (n.c || []).forEach(inkAll);
    return n;
  }
  const pill = inPill || (n.t !== 'T' && (n.h || 0) <= 30 && (n.w || 0) < 260 && n.r !== undefined && n.r >= (n.h || 0) / 2 - 1);
  if (n.t === 'T') { themeText(th, n, bg, drawnBg, pill, ctx); return n; }
  if (n.edc && isDark(here)) n.edk = 1;
  if (n.ed && (isDark(here) || here === ON_PHOTO)) n.ed = { ...n.ed, dk: 1 };
  // a card: a rounded frame with its own fill or photo (not the hero, which holds the page title)
  const isCard = !pill && (n.r || 0) > 0 && (photoBg || !!own || n.f?.some((f) => f.img)) && !/^(Hero)\b/.test(n.n || '') && (n.w || 0) < 900;
  const inner = isCard ? { ...ctx, card: (n.w || 0) - ((n.pd?.[1] || 0) + (n.pd?.[3] || 0)) } : ctx;
  if (n.c) n.c = n.c.map((c) => walk(th, c, here, drawnHere, pill, inner)).filter(Boolean) as FNode[];
  // A box holding a card title that's now in a wider face (the Sommelier levels' 172 px Copy): it spans the card, without
  // clipping, so the title wraps inside the card instead of being cut off (Nov 11, "Introdu", "Certifie")
  if (ctx.card && th.type.cardTitle.z !== undefined && n.c?.some((c) => c.t === 'T' && c.tb && c.ff === th.type.cardTitle.ff)) {
    const room = ctx.card - 2 * (n.x ?? 0);
    if ((n.w || 0) < room) { n.w = room; n.sh = 'F'; }
    delete n.clip;
    for (const c of n.c) if (c.t === 'T' && c.tb) c.w = n.w;
  }
  return n;
}

/* ── 4. The cinematic hero, for every brand (Figma 555:586 desktop, 555:388 phone) ─────────────────────────────────────
 * Watch = dark, read = light. Dish, house cocktail, classic cocktail and lesson pages open on a dark panel: the photo (or
 * the lesson's video) bleeds in from the right and fades into the panel; the pills, the accent line, the title, the lead
 * and the facts sit on the dark side. Phones: the photo on top, fading down. The fade is drawn in styles.css from
 * --c-inverse. Built here in drawn colours (role values from `drawn`), then painted by the brand like the rest. */
const HERO_W = 1080, PHOTO_W = 640, COPY_W = HERO_W - PHOTO_W;
const COPY_PD = [52, 8, 52, 52];
/** The hero title: the brand's page title. Drawn as Archivo ExtraBold capitals at one size, smaller only when its longest
 *  word wouldn't fit the copy column (Mise's serif takes over in the walk). */
function heroTitle(t: FNode, inner: number) {
  const s = (t.s || '').toUpperCase();
  const lw = Math.max(...s.split(/[\s/]+/).map((w) => w.length), 1);
  t.s = s; t.ff = 'Archivo'; t.fs = 'ExtraBold'; t.z = Math.max(34, Math.min(52, Math.floor(inner / (lw * 0.74)))); t.lh = '95%'; t.ls = '-1%';
  t.ar = 'H'; t.sh = 'F'; t.w = inner; t.lw = lw;
  t.f = [{ c: drawn('onInverse') }];
}
/** Type drawn for a light page, moved onto the dark panel: ink → light, muted → light muted, labels → the label tone. */
function onDark(n: FNode) {
  if (n.t === 'T') {
    const role = roleOf('textOnLight', solid(n));
    const label = (n.z || 14) <= 12.5 && n.s === (n.s || '').toUpperCase() && /[A-Z]{2}/.test(n.s || '');
    if (role === 'ink') n.f = [{ c: drawn('onInverse') }];
    else if (role === 'inkMuted') n.f = [{ c: drawn(label ? 'onInverseLabel' : 'onInverseMuted') }];
    else if (role === 'accentText') n.f = [{ c: drawn('accentOnDark') }];
    return;
  }
  if (solid(n)) return; // a filled pill or button keeps its own ink
  (n.c || []).forEach(onDark);
}
/** The one accent line above the title: The Baldwin's script line (copper on the dark panel), or Mise's taped note.
 *  Nov 18 (brand guide 05 Type: "One short line, lowercase"; Figma Handwritten note, Style=Taped, 509:87): the note is
 *  lowercase, on the torn tape (public/img/mise-tape.svg, the component's own vector), tilted −1.5° as drawn. */
function accentLine(th: Theme, tag: FNode): FNode {
  if (th.accentLine === 'script') { tag.f = [{ c: drawn('accentOnDark') }]; return tag; }
  const text = (tag.s || '').toLowerCase();
  const a = th.type.accent;
  const note: FNode = {
    t: 'F', n: 'Taped note', lm: 'H', sh: 'H', sv: 'H', pa: 'C', ca: 'C', pd: [9, 18, 7, 18], rot: -1.5,
    f: [{ img: '/img/mise-tape.svg', m: 'FILL' }], // torn painter's tape, stretched to the note
    c: [{ t: 'T', n: 'Note', s: text, ff: a.ff, fs: a.fs, z: a.z, lh: a.lh, f: [{ c: color(th, 'onTape') }], ar: 'W', sh: 'H', sv: 'H', w: 200, h: 26 } as FNode],
  } as FNode;
  if (tag.ed) note.c![0].ed = { ...tag.ed, u: undefined }; // Edit Mode types on the note
  return note;
}
function heroShell(hero: FNode, copy: FNode, media: FNode | null, h: number) {
  hero.n = 'Hero'; hero.lm = 'H'; hero.h = h; hero.w = HERO_W; hero.sh = 'F'; hero.sv = 'H'; hero.r = 22; hero.clip = 1; hero.gap = 0;
  hero.f = [{ c: drawn('inverse') }]; delete hero.st; delete hero.pd;
  copy.n = 'Copy'; copy.lm = 'V'; copy.w = media ? COPY_W : HERO_W; copy.sh = media ? 'L' : 'F'; copy.sv = 'F'; copy.h = h; copy.pa = 'C'; copy.pd = [...COPY_PD]; copy.gap = 16;
  delete copy.clip; delete copy.f;
  if (media) { media.w = PHOTO_W; media.h = h; media.sh = 'F'; media.sv = 'F'; delete media.r; }
  hero.c = media ? [copy, media] : [copy];
}
const heroPhoto = (photo: FNode) => { photo.n = 'Hero photo · ' + (photo.n || '').replace(/^IMG\//, ''); };

/** Classic and house cocktail pages: the drawn hero (photo left, copy right) becomes the cinematic hero. */
function cocktailHero(th: Theme, main: FNode) {
  const hero = find(main, (x) => x.n === 'Hero' && x.lm === 'H');
  const photo = hero?.c?.find((c) => (c.n || '').startsWith('IMG/'));
  const copy = hero?.c?.find((c) => c.n === 'Copy');
  if (!hero || !photo || !copy?.c) return;
  const tag = copy.c.find((c) => c.t === 'T' && c.ff === 'Pinyon Script');
  const title = copy.c.find((c) => c.t === 'T' && c.ff === 'Archivo' && c.fs === 'ExtraBold');
  heroShell(hero, copy, photo, 560); heroPhoto(photo);
  if (tag) copy.c[copy.c.indexOf(tag)] = accentLine(th, tag);
  if (title) heroTitle(title, COPY_W - COPY_PD[1] - COPY_PD[3]);
  // the glass and garnish facts share the narrower copy column (Edit Mode's fields too)
  const stats = copy.c.find((c) => c.n === 'Stats');
  if (stats) { stats.w = COPY_W - COPY_PD[1] - COPY_PD[3]; for (const c of stats.c || []) c.sh = 'L'; }
}

/** Dish pages: the light header (photo left, info right) becomes the cinematic hero, with everything it held: the tags,
 *  the accent line, the name, the description, ingredients, allergens, Sign Off This Dish and Print Spec. */
function dishHero(th: Theme, main: FNode) {
  const header = main.c?.find((c) => c.n === 'Header' && c.lm === 'H');
  const photo = header?.c?.find((c) => (c.n || '').startsWith('IMG/'));
  const info = header?.c?.find((c) => c.n === 'Info');
  if (!header || !photo || !info?.c) return;
  const inner = COPY_W - COPY_PD[1] - COPY_PD[3];
  // the tags: the dark panel's secondary pill (the cocktail hero's "Stirred · spirit-forward")
  for (const tag of all(info, (x) => (x.n || '').startsWith('Tag · ') && x.n !== 'Tag · Signature')) {
    tag.f = [{ c: drawn('inverseChip') }]; delete tag.st; delete tag.sw;
    for (const t of all(tag, (x) => x.t === 'T')) { t.f = [{ c: drawn('onInverseMuted') }]; t.fs = 'Medium'; }
  }
  const titles = info.c.find((c) => c.n === 'Titles');
  const tt = (titles?.c || []).filter((c) => c.t === 'T');
  const tag = tt.find((t) => t.ff === 'Pinyon Script');
  const title = tt.find((t) => t.ff === 'Archivo' && t.fs === 'ExtraBold');
  onDark(info);
  if (title) heroTitle(title, inner);
  if (titles) { titles.sh = 'F'; titles.w = inner; delete titles.clip; titles.gap = 16; }
  if (tag && titles?.c) titles.c[titles.c.indexOf(tag)] = accentLine(th, tag);
  for (const row of info.c) if (row.n === 'Ingredients' || row.n === 'Allergens') { row.w = inner; row.sh = 'F'; }
  // the buttons: the brand's main button on dark, and an outlined one beside it
  const btns = find(info, (x) => x.n === 'Buttons');
  for (const [i, b] of (btns?.c || []).entries()) {
    if (!(b.n || '').startsWith('Button')) continue;
    const ink = drawn(i === 0 ? 'onButton' : 'onInverse');
    if (i === 0) { b.f = [{ c: drawn('button') }]; delete b.st; }
    else { b.f = []; b.st = drawn('outlineOnDark'); b.sw = 1; }
    for (const t of all(b, (x) => x.t === 'T')) t.f = [{ c: ink }];
  }
  if (btns) delete btns.clip;
  heroShell(header, info, photo, 560); heroPhoto(photo);
  info.gap = 14;
}

/** Lesson pages: the video (or the section's photo) and the titles under it become the cinematic hero, across the top of
 *  the page; the reading column and the playlist start below it. A playing video is never covered (styles.css). */
function lessonHero(th: Theme, main: FNode) {
  const player = main.c?.find((c) => c.n === 'Player');
  const lesson = player?.c?.find((c) => c.n === 'Lesson');
  const under = lesson?.c?.find((c) => c.n === 'Under the video');
  if (!player || !lesson?.c || !under) return;
  const media = lesson.c.find((c) => (c.n || '').startsWith('Video slot') || c.n === 'IMG/Section photo') || null;
  lesson.c = lesson.c.filter((c) => c !== media && c !== under);
  const titles = (under.c || []).find((c) => c.n === 'Titles');
  const [kicker, title] = (titles?.c || []).filter((c) => c.t === 'T');
  const credit = (under.c || []).find((c) => c.t === 'T');
  const inner = (media ? COPY_W : HERO_W) - COPY_PD[1] - COPY_PD[3];
  const copy: FNode = { t: 'F', n: 'Copy', w: COPY_W, h: 360, c: [] } as FNode;
  if (kicker) { kicker.f = [{ c: drawn('accentOnDark') }]; kicker.ar = 'H'; kicker.sh = 'F'; kicker.w = inner; copy.c!.push(kicker); }
  // Nov 18 (Mise title moment: one label, one tape note, the italic title, one Archivo line): a look whose accent line is
  // tape gets one note on the lesson opener too. A script look's lesson opener has no accent line, as before.
  if (th.accentLine === 'tape') copy.c!.push(accentLine(th, { t: 'T', n: 'Note', s: LESSON_NOTE, w: 200, h: 26 } as FNode));
  if (title) { heroTitle(title, inner); copy.c!.push(title); }
  if (credit) { credit.f = [{ c: drawn('onInverseMuted') }]; credit.ar = 'H'; credit.sh = 'F'; credit.w = inner; copy.c!.push(credit); }
  if (media?.n === 'IMG/Section photo') heroPhoto(media);
  const hero: FNode = { t: 'F', n: 'Hero', w: HERO_W, h: 360, c: [] } as FNode;
  heroShell(hero, copy, media, 360);
  // the slot's drawn play button and length go (the live player draws its own), so phones lay it out as a plain box
  if (media) { media.w = PHOTO_W; media.h = 360; delete media.c; }
  main.c!.splice(main.c!.indexOf(player), 0, hero);
}
/** The lesson opener's taped note (Mise): the page's own rule, watch the video, then read below it. */
const LESSON_NOTE = 'watch, then read';

/** Which pages get the cinematic hero. */
function cinematic(th: Theme, page: { name?: string }, main: FNode) {
  const name = page.name || '';
  if (/^(Classic|Signature) · /.test(name)) cocktailHero(th, main);
  else if (/^Recipe · /.test(name)) dishHero(th, main);
  else if (main.c?.some((c) => c.n === 'Player' && c.c?.some((x) => x.n === 'Lesson'))) lessonHero(th, main);
}

/** Video cards: the channel line under a video (Anders Erickson, Wine Folly…) is muted ink, not the accent. */
function videoCaptions(th: Theme, n: FNode) {
  const hasPlay = (x: FNode): boolean => x.n === 'Play' || (x.c || []).some((c) => c.n === 'Play');
  if (n.c?.some((c) => c.t !== 'T' && hasPlay(c))) {
    const mute = (x: FNode) => { if (x.t === 'T' && x.ff === th.type.label.ff && up(solid(x)) === up(color(th, 'accentText'))) x.f = [{ c: color(th, 'inkMuted') }]; (x.c || []).forEach(mute); };
    n.c.filter((c) => !hasPlay(c)).forEach(mute);
  }
  (n.c || []).forEach((c) => videoCaptions(th, c));
}

/** The page's headings in reading order: one h1 (the page title), and no level skipped on the way down (an h3 with no h2
 *  above it becomes an h2). A page with no drawn title gets a hidden h1 from PageView (`hasPageTitle`). */
function outlinePage(main: FNode) {
  let last = 1;
  for (const t of all(main, (x) => x.t === 'T' && !!x.hd)) {
    if (t.hd === 1) { last = 1; continue; }
    t.hd = Math.min(t.hd!, last + 1) as 2 | 3;
    last = t.hd;
  }
}
/** Photos (Nov 12 scan): a photo is read out only when it shows the page's own subject, the dish, drink, wine, bottle or
 *  beer the page is about, and then by that name (never the Figma layer name: "shortrib", "Hero photo"). Every other
 *  photo has its caption or title beside it, or is mood, so screen readers skip it (FigmaNode: no `alt`, no role). */
const SUBJECT_PAGES = /^(Recipe|Classic|Signature|Wine list|Wine|Back Bar|Bottle|Beer|Spirit) · /;
function subjectPhoto(page: { name?: string }, main: FNode) {
  if (!SUBJECT_PAGES.test(page.name || '')) return;
  const path = (n: FNode, t: FNode, up: FNode[] = []): FNode[] | null => { if (n === t) return up; for (const c of n.c || []) { const r = path(c, t, [...up, n]); if (r) return r; } return null; };
  const title = find(main, (x) => x.t === 'T' && x.hd === 1);
  const up = title && path(main, title);
  const box = up?.slice(1).reverse().find((a) => /^(Hero|Header)\b/.test(a.n || ''));
  if (!title || !box) return;
  const photos = all(box, (x) => (x.t !== 'T' && x.t !== 'F' && !!x.f?.some((f) => f.img) && !/\bdrawn\b/.test(x.n || '')) || !!(x.meta as { spin?: unknown[] } | undefined)?.spin?.length);
  if (!photos.length || photos.length > 2) return;
  const name = titleCase((title.s || '').replace(/\s+/g, ' ').trim());
  for (const p of photos) p.alt = name;
}

/** True when the page draws its own h1 (else PageView adds a hidden one, so every page has exactly one). */
export const hasPageTitle = (main: FNode) => !!find(main, (x) => x.t === 'T' && x.hd === 1);

/** A page in the brand: the shared layouts first (in drawn colours), then the brand's paint and type. */
export function themePage<P extends { main: FNode; bg?: string; name?: string }>(page: P, th: Theme = theme()): P {
  const main = structuredClone(page.main);
  cinematic(th, page, main);
  const out = walk(th, main, drawn('page'), drawn('page'), false, { title: pageTitle(main), card: null, outline: true }) || main;
  outlinePage(out);
  subjectPhoto(page, out);
  if (th.quietVideoCaptions) videoCaptions(th, out);
  return { ...page, bg: paint(th, 'fill', page.bg) || page.bg || color(th, 'page'), main: out };
}

/** The look's logo in the drawn slot. Nov 17: a look can size the slot to its logo (Testa Barra's wordmark is wider and
 *  shorter than The Baldwin's) and show only the artwork of a file with transparent margins (cropFill). */
function drawnLogoNode(c: FNode, L: NonNullable<Theme['drawnLogo']>): FNode {
  const out: FNode = { ...c, alt: L.alt, f: [L.crop ? { img: L.src, m: 'FIT', ...cropFill(L.crop) } : { img: L.src, m: 'FIT' }] };
  if (L.w) out.w = L.w;
  if (L.h) out.h = L.h;
  return out;
}
/** A background that shows just the artwork box of a logo file, at uniform scale (the file itself is never changed). */
export function cropFill([x, y, w, h, W, H]: Crop) {
  const pos = (a: number, size: number, full: number) => (full === size ? 0 : (a / (full - size)) * 100);
  return { bs: `${(W / w) * 100}% ${(H / h) * 100}%`, bp: `${pos(x, w, W)}% ${pos(y, h, H)}%` };
}
/** The sidebar in the brand: its logo where the drawn one is, the same paint, and its active-item style. */
export function themeSidebar(node: FNode, th: Theme = theme()): FNode {
  const n = structuredClone(node);
  const logo = th.logo;
  const swapLogo = (x: FNode): FNode => {
    // (the slot takes the logo's own size, so a cropped file keeps its artwork's proportions)
    if (logo && x.n === 'Logo') return { ...x, pd: [0, 0, 0, 0], ...(logo.crop ? { w: logo.w, h: logo.h } : {}), c: [{ t: 'R', n: 'IMG/' + logo.alt + ' lockup', alt: logo.alt, w: logo.w, h: logo.h, sh: 'F', sv: 'F', f: [logo.crop ? { img: logo.src, m: 'FIT', ...cropFill(logo.crop) } : { img: logo.src, m: 'FIT' }] } as FNode] };
    // the drawn slot holds the look's own logo, read out by its name (photos without an `alt` are skipped, FigmaNode)
    if (x.n === 'Logo') return { ...x, c: x.c?.map((c) => (c.t === 'R' && th.drawnLogo ? drawnLogoNode(c, th.drawnLogo) : c)) };
    return x.c ? { ...x, c: x.c.map(swapLogo) } : x;
  };
  const out = walk(th, swapLogo(n), drawn('inverse'), drawn('inverse'), false) || n;
  if (th.activeNav === 'tint') {
    // The active nav item: a quiet highlight in the panel's ink, not the accent (Nov 10: the accent is for attention).
    const ink = color(th, 'onInverse');
    const active = (x: FNode) => {
      if ((x.n || '').startsWith('Nav · ') && solid(x)) { x.f = [{ c: ink, o: 0.1 }]; const paintInk = (y: FNode) => { if (y.t === 'T') y.f = [{ c: ink }]; (y.c || []).forEach(paintInk); }; paintInk(x); }
      (x.c || []).forEach(active);
    };
    active(out);
  }
  return out;
}

/** Back-compat for the Nov 10 names. */
export const MISE = {
  char: color(THEMES.mise, 'ink'), ash: color(THEMES.mise, 'accentOnDark'), fig: color(THEMES.mise, 'accent'), bone: color(THEMES.mise, 'page'),
};
