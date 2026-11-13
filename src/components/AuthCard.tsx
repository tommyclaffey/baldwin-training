// The signed-out screens (Nov 12; Figma 09 · Proposals, section 28 "Mise sign-in", 592:669: desktop 592:670 / 592:708,
// phone 592:754 / 592:802). Watch = dark, read = light: a photo side with the logo, the brand's accent line and "Know the
// menu cold.", and a light card with the form. Phones: the photo is a band on top and the form a light sheet below it.
//
// One layout for every brand (Tommy, Nov 12: "it is the same app so it should feel the same"); only the paint changes, and
// the paint comes from the theme layer (src/lib/theme.ts). The platform's front door (join code, email sign-in, forgot
// password, two-step, reset and invite links) wears Mise. After a valid join code, the store, name and PIN screens wear
// that restaurant's own look (The Baldwin stays The Baldwin; Wrenfield is Mise), so BookSignIn passes the company's brand.
//
// Photo: Olena Bohovyk on Unsplash (https://unsplash.com/photos/HN2ukPUF_og), the same photo as Figma section 25.
import { useLayoutEffect, type CSSProperties, type ReactNode } from 'react';
import { THEMES, brandTitle, color, setPageBrand, themeVars, type Brand, type Theme, type TypeSpec } from '../lib/theme';

const WEIGHT: Record<string, number> = { Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800 };
const weight = (s: TypeSpec, fallback: number) => (s.fs && WEIGHT[s.fs]) || fallback;
const tracking = (s: TypeSpec) => (s.ls ? `${parseFloat(s.ls) / 100}em` : '0');

/** The brand's roles as CSS variables on this screen only, so the card never mixes two brands' paint. */
function paint(t: Theme): CSSProperties {
  const title = t.type.pageTitle;
  const size = title.z ?? 40; // Mise: 64 (Instrument Serif, only from 40 px up). The Baldwin: Archivo ExtraBold capitals.
  return {
    ...themeVars(t),
    '--si-title-weight': weight(title, 800),
    '--si-title-tracking': tracking(title),
    '--si-title-size': `${size}px`,
    '--si-title-size-phone': `${Math.round(size * 0.69)}px`, // Mise: 44 (Figma "Mise/H2" on the phone sheet)
    '--si-label-weight': weight(t.type.label, 700),
    '--si-accent-on-dark': color(t, 'accentOnDark'),
  } as CSSProperties;
}

export function AuthCard({ title, sub, kicker, foot, brand = 'mise', children }: {
  title: string; sub?: ReactNode; kicker?: string; foot?: ReactNode; brand?: Brand; children: ReactNode;
}) {
  const t = THEMES[brand];
  // The rest of the page (tab icon, <html> colours) follows this screen while it's showing.
  useLayoutEffect(() => { setPageBrand(brand); return () => setPageBrand(null); }, [brand]);
  const logo = t.logo
    ? <img className="si-logo si-logo-lockup" src={t.logo.src} alt={t.logo.alt} />
    : <img className="si-logo si-logo-mark" src="/img/logo-white.png" alt="The Baldwin" />;
  return (
    <div className={`si si-${brand}`} style={paint(t)}>
      <div className="si-photo" role="banner">{/* (the logo and photo band is the screen's banner, so nothing sits outside a landmark; Nov 12 scan) */}
        <img className="si-photo-img" src="/img/signin-bartender-2400.jpg" srcSet="/img/signin-bartender-1200.jpg 1200w, /img/signin-bartender-2400.jpg 2400w"
          sizes="(min-width: 900px) 95vw, 100vw" alt="" />
        <div className="si-shade" />
        {logo}
        <div className="si-words">
          {t.accentLine === 'tape'
            ? <p className="si-tape"><span>pre-shift starts here</span></p>
            : <p className="si-script">pre-shift starts here</p>}
          <p className="si-headline">{brandTitle('Know the menu cold.', t)}</p>
        </div>
      </div>
      <main className="si-side">
        <div className="si-card">
          <div className="si-head">
            {kicker && <p className="si-kicker">{kicker}</p>}
            <h1 className="si-title">{brandTitle(title, t)}</h1>
            {sub && <p className="si-sub">{sub}</p>}
          </div>
          {children}
        </div>
        {foot && <p className="si-foot">{foot}</p>}
      </main>
    </div>
  );
}
