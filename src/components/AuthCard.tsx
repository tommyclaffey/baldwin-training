// The signed-out screens (Nov 12; Figma 09 · Proposals, section 28 "Mise sign-in", 592:669: desktop 592:670 / 592:708,
// phone 592:754 / 592:802). Watch = dark, read = light: a photo side with the logo, the brand's accent line and "Know the
// menu cold.", and a light card with the form. Phones: the photo is a band on top and the form a light sheet below it.
// Nov 24: the Mise look's photo side is "H8 · Ready for service." (Figma 09 · Idea Board, section 51: desktop 1025:4310,
// phone 1027:4434): the mise lockup and a centred title card on a deep black gradient. Same day, every custom look too:
// the same words and gradient in the look's own photo, logo, faces and colours.
//
// One layout for every brand (Tommy, Nov 12: "it is the same app so it should feel the same"); only the paint changes, and
// the paint comes from the theme layer (src/lib/theme.ts). The platform's front door (join code, email sign-in, forgot
// password, two-step, reset and invite links) wears Mise. After a valid join code, the store, name and PIN screens wear
// that restaurant's own look (The Baldwin stays The Baldwin; Fig & Fire is Mise), so BookSignIn passes the company's brand.
//
// Photo: Olena Bohovyk on Unsplash (https://unsplash.com/photos/HN2ukPUF_og), the same photo as Figma section 25.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { lookTheme, onLookChange, brandTitle, color, setPageBrand, themeVars, type Brand, type ColorRole, type Theme, type TypeSpec } from '../lib/theme';
import { ratio } from '../lib/lookspec';
import { LegalLinks } from './Legal';
import { LookLogo } from './LookLogo';

const WEIGHT: Record<string, number> = { Regular: 400, Italic: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800 };
const weight = (s: TypeSpec, fallback: number) => (s.fs && WEIGHT[s.fs]) || fallback;
const tracking = (s: TypeSpec) => (s.ls ? `${parseFloat(s.ls) / 100}em` : '0');

/** The first of a look's on-dark colours with at least `min`:1 on Char (#121110, the gradient's black), else white. */
const lightest = (t: Theme, roles: ColorRole[], min: number) => roles.map((r) => color(t, r)).find((c) => ratio(c, '#121110') >= min) ?? '#FFFFFF';
/** H8's title in the look's casing: capitals for a look whose titles are capitals, else as written ("Ready for service."). */
export const readyCase = (s: string, t: Theme) => (t.type.pageTitle.case === 'upper' ? s.toUpperCase() : s);
/** The sign-in's line under the title (also the link card's, Nov 25). */
export const READY_LINE = ['Training, inventory, prep and team chat', 'for every position, front and back of house.'] as const;
/** Nov 25: the link card's words (Your Look's card) in the look's own on-dark colours, light enough on its dark card
 *  colour (the card's photo fades in behind the words' right end, so the same margins as the sign-in's title card). */
export function cardInk(t: Theme) {
  const bg = color(t, 'inverse');
  const pick = (roles: ColorRole[], min: number) => roles.map((r) => color(t, r)).find((c) => ratio(c, bg) >= min) ?? '#FFFFFF';
  return { label: pick(['onInverseMuted', 'onInverse'], 7), title: pick(['onInverse'], 7), line: pick(['onInverseMuted', 'onInverse'], 7) };
}

/** The brand's roles as CSS variables on this screen only, so the card never mixes two brands' paint. */
export function paint(t: Theme): CSSProperties {
  const title = t.type.pageTitle;
  const size = title.z ?? 40; // Mise: 64 (DM Serif Display Italic, only from 40 px up). The Baldwin: Archivo ExtraBold capitals.
  return {
    ...themeVars(t),
    '--si-title-weight': weight(title, 800),
    '--si-title-style': (title.fs || '').includes('Italic') ? 'italic' : 'normal',
    '--si-title-tracking': tracking(title),
    '--si-title-size': `${size}px`,
    '--si-title-size-phone': `${Math.round(size * 0.69)}px`, // Mise: 44 (Figma "Mise/H2" on the phone sheet)
    '--si-label-weight': weight(t.type.label, 700),
    '--si-label-tracking': t.type.label.ls ? `${Math.max(parseFloat(t.type.label.ls) / 100, .12)}em` : '.16em',
    // H8 (Nov 24): Mise's 84 px title (44 on phones), times the look's own scale (Bebas Neue is condensed, Cinzel wide)
    '--si-ready-size': `${Math.round(84 * (title.scale ?? 1))}px`,
    '--si-ready-size-phone': `${Math.round(44 * (title.scale ?? 1))}px`,
    // H8 on every look: the look's own on-dark colours, as long as they're light enough for the black gradient over any
    // photo (a website look brings its own); else the next lighter one, else white. The label is small and sits highest,
    // so it needs the most (15:1 on Char keeps 4.5:1 over a plain white photo under the gradient, measured Nov 24).
    '--si-ready-title': lightest(t, ['onInverse'], 7),
    '--si-ready-label': lightest(t, ['onInverseMuted', 'onInverse'], 15),
    '--si-ready-line': lightest(t, ['onInverseMuted', 'onInverse'], 7),
  } as CSSProperties;
}

/** H8's title stays on two lines in any face: when a wide one (The Baldwin's ExtraBold capitals) is wider than the photo
 *  side allows, it steps down to fit; when a tall one runs past Mise's two lines, the gradient lifts with it. Re-checked
 *  when the side resizes and when the look's fonts arrive. */
function useFitTitle(t: Theme) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current, box = el?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      el.style.removeProperty('--si-ready-fit');
      const room = box.clientWidth, w = el.scrollWidth;
      if (room > 0 && w > room) el.style.setProperty('--si-ready-fit', `${Math.floor(parseFloat(getComputedStyle(el).fontSize) * room / w)}px`);
      // a title taller than Mise's two lines (84 px each, 44 on phones) lifts the gradient's ramp by the difference
      const line = matchMedia('(max-width: 899px)').matches ? 44 : 84;
      box.parentElement?.style.setProperty('--si-ready-lift', `${Math.max(0, Math.ceil(el.offsetHeight - 2 * line))}px`);
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(box);
    let live = true; document.fonts?.ready.then(() => { if (live) fit(); });
    return () => { live = false; ro.disconnect(); };
  }, [t]);
  return ref;
}

/** The title card (Nov 24, Figma section 51, H8 "Ready for service."): centred low on the photo, on the black gradient;
 *  the phone band shows the label and the title only. Every look says the same words in its own style (Tommy, Nov 24:
 *  "update this for our custom ones as well. Same language, different style"): its label face, its title face and
 *  casing, its body face for the line. One sentence for a screen reader. Also Your Look's sign-in preview. Needs
 *  `paint(t)` on an ancestor and sits in a `.si-photo-ready` box. */
export function ReadyWords({ t }: { t: Theme }) {
  const ref = useFitTitle(t);
  return (
    <div className={t.signIn ? 'si-ready si-ready-mise' : 'si-ready'}>
      <p className="si-ready-label">Front and back of house</p>
      <p className="si-ready-title" ref={ref}><span className="sr-only">Ready for service.</span><span aria-hidden="true">{readyCase('Ready for', t)}<br />{readyCase('service.', t)}</span></p>
      <p className="si-ready-line">{READY_LINE[0]} <br />{READY_LINE[1]}</p>
    </div>
  );
}

export function AuthCard({ title, sub, kicker, foot, brand = 'mise', children }: {
  title: string; sub?: ReactNode; kicker?: string; foot?: ReactNode; brand?: Brand; children: ReactNode;
}) {
  const [, redraw] = useState(0);
  useEffect(() => onLookChange(() => redraw((n) => n + 1)), []); // a data look's paint arriving (Nov 22)
  const t = lookTheme(brand);
  // The rest of the page (tab icon, <html> colours) follows this screen while it's showing.
  useLayoutEffect(() => { setPageBrand(brand); return () => setPageBrand(null); }, [brand]);
  // Nov 24 (H8 · Ready for service.): a look with its own sign-in logo (Mise: the plain mise lockup, Figma Lockup/Mise
  // Theme=Dark 508:21) shows that file as it is, at its own size, where Figma 1025:4310 puts the component (47, 32).
  // Every other look: its mark, as before.
  const logo = t.signIn
    ? <img className="si-logo si-logo-file" src={t.signIn.logo.src} alt={t.signIn.logo.alt} />
    : <LookLogo t={t} className="si-logo si-logo-mark" style={t.mark.crop ? { '--logo-ar': t.mark.crop[2] / t.mark.crop[3] } as CSSProperties : undefined} />;
  return (
    <div className={`si si-${brand}`} style={paint(t)}>
      <div className="si-photo si-photo-ready" role="banner">{/* (the logo and photo band is the screen's banner, so nothing sits outside a landmark; Nov 12 scan) */}
        {/* Nov 22: a look made from a website brings its own photo; the hand-built looks keep the bartender */}
        {t.photo ? <img className="si-photo-img" src={t.photo} alt="" />
          : <img className="si-photo-img" src="/img/signin-bartender-2400.jpg" srcSet="/img/signin-bartender-1200.jpg 1200w, /img/signin-bartender-2400.jpg 2400w"
          sizes="(min-width: 900px) 95vw, 100vw" alt="" />}
        <div className="si-shade" />
        {logo}
        {/* The title card (Nov 24, Figma section 51, H8 "Ready for service."): centred low on the photo, on the black
            gradient; the phone band shows the label and the title only. Every look says the same words in its own style
            (Tommy, Nov 24: "update this for our custom ones as well. Same language, different style"): its label face,
            its title face and casing, its body face for the line. One sentence for a screen reader. */}
        <ReadyWords t={t} />
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
        {/* Nov 16: Privacy · Terms · Help, once they're public (content/legal.md) */}
        <LegalLinks className="si-legal" />
      </main>
    </div>
  );
}
