// The tab icon is always the restaurant's logo (Nov 5). Stores with a logo file in public/icons use it;
// a store without one shows its initial on the dark brand square until its logo is added.
// Nov 11 (Tommy: "for the mise version can i get the garlic icon for the favicon"): anything drawn in the Mise look
// (a Mise-brand company, the /demo/mise picker, any Mise-look signed-out screen) shows Mise's garlic + fig app icon
// (Figma Brand assets/App icon 520:233), public/icons/mise-*.png. It follows the brand: skin.ts announces each change.
import { currentBrand } from './theme';

const HAS_LOGO = new Set(['the-baldwin', 'mise']);
type Store = { slug: string; name: string } | null | undefined;
let last: Store; // the signed-in store, once the session has loaded

function initialIcon(name: string) {
  const ch = (name.replace(/^the\s+/i, '').trim()[0] || '?').toUpperCase().replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1E1C1A"/><text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="Archivo, Arial, sans-serif" font-weight="800" font-size="38" fill="#F2EEE7">${ch}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function draw() {
  const store = last;
  const slug = currentBrand() === 'mise' ? 'mise' : store && HAS_LOGO.has(store.slug) ? store.slug : store ? null : 'the-baldwin';
  const icons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
  const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  icons.forEach((l) => {
    const size = (l.getAttribute('sizes') || '32x32').split('x')[0];
    if (slug) { l.type = 'image/png'; l.href = `/icons/${slug}-${size}.png`; }
    else { l.type = 'image/svg+xml'; l.href = initialIcon(store!.name); }
  });
  if (touch && slug) touch.href = `/icons/${slug}-180.png`;
}

export function setFavicon(store: Store) { last = store; draw(); }

if (typeof window !== 'undefined') { window.addEventListener('brandchange', draw); draw(); }
