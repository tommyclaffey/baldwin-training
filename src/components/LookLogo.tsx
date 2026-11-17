// The look's logo outside the drawn sidebar (Nov 17, looks per store): the phone bar, the admin, the sign-in screens,
// Privacy/Terms/Help and the certificate band. Replaces the hard-coded The Baldwin logo (/img/logo-white.png, "The Baldwin")
// those places used to draw for every custom look.
//
// The Baldwin and Mise: the same <img> as before. A logo file with transparent margins (Testa Barra's wordmark) shows only
// its artwork: the file is never changed; a box at the artwork's proportions holds it at uniform scale (theme.ts Crop).
// The outer span takes the place's own class (size, padding, background); the inner box does the cropping.
import { theme, type Theme } from '../lib/theme';

export function LookLogo({ t = theme(), className, height, alt }: { t?: Theme; className?: string; height?: number; alt?: string }) {
  const m = t.mark;
  if (!m.crop) return <img src={m.src} alt={alt ?? m.alt} className={className} height={height} />;
  const [x, y, w, h, W] = m.crop;
  return (
    <span className={(className ? className + ' ' : '') + 'look-logo'} role="img" aria-label={alt ?? m.alt}>
      <span className="look-logo-box" style={{ aspectRatio: `${w} / ${h}`, ...(height ? { height, width: 'auto' } : {}) }}>
        <img className="look-logo-art" src={m.src} alt="" style={{ width: `${(W / w) * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }} />
      </span>
    </span>
  );
}
