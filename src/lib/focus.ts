// Photo focus (Nov 6, Tommy: "choose to crop and move the center placement of the photos").
// The focus point and zoom travel with the photo's address as a #fragment, e.g. /media/abc.jpg#f=32,18,1.4. The browser never
// sends a fragment to the server, so the file is untouched, and every place that shows the photo gets the same framing.
import type { CSSProperties } from 'react';

export type Focus = { url: string; x: number; y: number; z: number };

export function parseFocus(src: string | undefined | null): Focus {
  const [url, frag] = String(src || '').split('#');
  const m = frag?.match(/^f=(\d{1,3}),(\d{1,3}),(\d(?:\.\d+)?)$/);
  if (!m) return { url, x: 50, y: 50, z: 1 };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return { url, x: clamp(Number(m[1]), 0, 100), y: clamp(Number(m[2]), 0, 100), z: clamp(Number(m[3]), 1, 3) };
}

export function withFocus(url: string, x: number, y: number, z: number) {
  const base = url.split('#')[0];
  const X = Math.round(x), Y = Math.round(y), Z = Math.round(z * 100) / 100;
  return X === 50 && Y === 50 && Z === 1 ? base : `${base}#f=${X},${Y},${Z}`;
}

/** Style for a `.f-zoom` box: the photo sits on a layer behind any children, framed on the focus point. */
export function focusVars(src: string | undefined | null): CSSProperties {
  const f = parseFocus(src);
  return { '--fimg': `url("${f.url}")`, '--fx': `${f.x}%`, '--fy': `${f.y}%`, '--fz': String(f.z) } as CSSProperties;
}

/** For a plain <img> with object-fit: cover (thumbnails): moves it to the focus point. Zoom needs the layer above. */
export function focusImg(src: string | undefined | null): CSSProperties | undefined {
  const f = parseFocus(src);
  return f.x === 50 && f.y === 50 ? undefined : { objectPosition: `${f.x}% ${f.y}%` };
}
