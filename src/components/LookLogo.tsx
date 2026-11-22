// The look's logo outside the drawn sidebar (Nov 17, looks per store): the phone bar, the admin, the sign-in screens,
// Privacy/Terms/Help and the certificate band. Replaces the hard-coded The Baldwin logo (/img/logo-white.png, "The Baldwin")
// those places used to draw for every custom look.
//
// The Baldwin and Mise: the same <img> as before. A logo file with transparent margins (Testa Barra's wordmark) shows only
// its artwork: the file is never changed; a box at the artwork's proportions holds it at uniform scale (theme.ts Crop).
// The outer span takes the place's own class (size, padding, background); the inner box does the cropping.
import { theme, type Theme } from '../lib/theme';

// Nov 18 (Mise rebrand): `big` = a big moment (the certificate band), where a look with a `hero` logo shows it (Mise: the
// Mise Academy lockup); everywhere else, and every look without one, it's the look's mark.
export function LookLogo({ t = theme(), className, height, alt, big }: { t?: Theme; className?: string; height?: number; alt?: string; big?: boolean }) {
  const m = (big && t.hero) || t.mark;
  if (!m.crop) return <img src={m.src} alt={alt ?? m.alt} className={className} height={height} />;
  const [x, y, w, h, W] = m.crop;
  // Nov 22: a logo with no version for dark backgrounds sits on a light plate (the artwork itself is never changed)
  const plate = 'plate' in m && m.plate ? { background: m.plate, padding: '4px 8px', borderRadius: 6 } : undefined;
  return (
    <span className={(className ? className + ' ' : '') + 'look-logo'} role="img" aria-label={alt ?? m.alt} style={plate}>
      <span className="look-logo-box" style={{ aspectRatio: `${w} / ${h}`, ...(height ? { height, width: 'auto' } : {}) }}>
        <img className="look-logo-art" src={m.src} alt="" style={{ width: `${(W / w) * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }} />
      </span>
    </span>
  );
}
