// The tab icon is always the restaurant's logo (Nov 5). Stores with a logo file in public/icons use it;
// a store without one shows its initial on the dark brand square until its logo is added.
const HAS_LOGO = new Set(['the-baldwin']);

function initialIcon(name: string) {
  const ch = (name.replace(/^the\s+/i, '').trim()[0] || '?').toUpperCase().replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1E1C1A"/><text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="Archivo, Arial, sans-serif" font-weight="800" font-size="38" fill="#F2EEE7">${ch}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export function setFavicon(store: { slug: string; name: string } | null | undefined) {
  const slug = store && HAS_LOGO.has(store.slug) ? store.slug : store ? null : 'the-baldwin';
  const icons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
  const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  icons.forEach((l) => {
    const size = (l.getAttribute('sizes') || '32x32').split('x')[0];
    if (slug) { l.type = 'image/png'; l.href = `/icons/${slug}-${size}.png`; }
    else { l.type = 'image/svg+xml'; l.href = initialIcon(store!.name); }
  });
  if (touch && slug) touch.href = `/icons/${slug}-180.png`;
}
