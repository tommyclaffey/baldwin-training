// Privacy Policy, Terms of Service and Help (Nov 16). The words come from the server (content/legal.md, server/legal.mjs),
// never from the app bundle, so a draft isn't readable by anyone. Until the file's four blanks are filled the server says
// "not found" to everyone but a super admin: the public sees what any unknown address shows, a super admin sees the draft
// with a "Draft · not public" banner, and every link to these pages stays hidden (LegalLinks, SupportLine).
// One layout for every brand; the paint comes from the theme layer's roles (--c-*, --font-*).
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { brandTitle, currentBrand } from '../lib/theme';
import { LookLogo } from './LookLogo';

export type LegalKind = 'privacy' | 'terms' | 'help';
type Run = { t: string; b?: boolean; i?: boolean; mail?: boolean; blank?: boolean };
type Block = { h?: Run[]; p?: Run[]; ul?: Run[][]; ol?: Run[][] };
type Page = { kind: LegalKind; title: string; blocks: Block[]; supportEmail: string | null; draft: boolean; missing: string[] };
const BLANK_LABEL: Record<string, string> = { company: 'Company', state: 'State', supportEmail: 'Support email', date: 'Date' };
export const LEGAL_PATHS: Record<string, LegalKind> = { '/privacy': 'privacy', '/terms': 'terms', '/help': 'help' };

/** Privacy · Terms · Help, once they're public. Nothing at all before then. */
export function LegalLinks({ className = '' }: { className?: string }) {
  const { legal } = useSession();
  if (!legal.public) return null;
  return (
    // a div with the navigation role, not <nav>: the admin and book sidebars style every <nav> inside them as a menu
    <div role="navigation" className={'legal-links ' + className} aria-label="Privacy, terms and help">
      <Link to="/privacy">Privacy</Link><span aria-hidden="true">·</span><Link to="/terms">Terms</Link><span aria-hidden="true">·</span><Link to="/help">Help</Link>
    </div>
  );
}

/** The support line from the draft's "Support contact", once the pages are public. */
export function SupportLine({ className = '' }: { className?: string }) {
  const { legal } = useSession();
  if (!legal.public || !legal.supportEmail) return null;
  return (
    <p className={'support-line ' + className}>
      <strong>Need help?</strong> Email <a href={`mailto:${legal.supportEmail}`}>{legal.supportEmail}</a>. We answer within one business day.
      {' '}Something urgent on a shift? Tell your manager first; they can reset PINs and edit pages straight away.
    </p>
  );
}

/** /privacy, /terms, /help: the page when the server sends it, else whatever an unknown address shows (`fallback`). */
export function LegalRoute({ kind, fallback }: { kind: LegalKind; fallback: ReactNode }) {
  const { user } = useSession();
  const [state, setState] = useState<{ kind: LegalKind; page: Page | null } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/legal/${kind}`, { credentials: 'same-origin' })
      .then(async (r) => (r.ok ? ((await r.json()) as Page) : null))
      .catch(() => null)
      .then((page) => { if (live) setState({ kind, page }); });
    return () => { live = false; };
  }, [kind, user?.id]);
  if (!state || state.kind !== kind) return <main className="page page-loading" aria-busy="true"><div className="loader" /></main>;
  if (!state.page) return <>{fallback}</>;
  return <LegalPage page={state.page} />;
}

function Words({ runs }: { runs: Run[] }) {
  return <>{runs.map((r, i) => {
    let el: ReactNode = r.t;
    if (r.mail) el = <a href={`mailto:${r.t}`}>{r.t}</a>;
    if (r.blank) el = <mark className="legal-blank">{r.t}</mark>;
    if (r.i) el = <em>{el}</em>;
    if (r.b) el = <strong>{el}</strong>;
    return <span key={i}>{el}</span>;
  })}</>;
}

function LegalPage({ page }: { page: Page }) {
  const { user } = useSession();
  const mise = currentBrand() === 'mise';
  useEffect(() => { document.title = `${page.title} · Mise Academy`; }, [page.title]);
  const others = (Object.entries(LEGAL_PATHS) as [string, LegalKind][]).filter(([, k]) => k !== page.kind);
  const names: Record<LegalKind, string> = { privacy: 'Privacy', terms: 'Terms', help: 'Help' };
  return (
    <div className="legal">
      <header className="legal-bar">
        <Link to="/" className="legal-logo" aria-label="Mise Academy home">
          <LookLogo />
        </Link>
        <Link to="/" className="legal-back">{user ? 'Back to the Book' : 'Sign In'}</Link>
      </header>
      <main className="legal-main" id="content">
        {page.draft && (
          <div className="legal-draft" role="note">
            <span className="legal-draft-tag">Draft · not public</span>
            <p>Only super admins see this. It goes public, with its links, once these are filled in <code>content/legal.md</code>: {page.missing.map((k) => BLANK_LABEL[k] || k).join(', ')}.</p>
          </div>
        )}
        <h1 className="legal-title">{brandTitle(page.title)}</h1>
        {page.blocks.map((b, i) => {
          if (b.h) return <h2 key={i}><Words runs={b.h} /></h2>;
          if (b.ul) return <ul key={i}>{b.ul.map((li, j) => <li key={j}><Words runs={li} /></li>)}</ul>;
          if (b.ol) return <ol key={i}>{b.ol.map((li, j) => <li key={j}><Words runs={li} /></li>)}</ol>;
          return <p key={i}><Words runs={b.p || []} /></p>;
        })}
        <nav className="legal-foot" aria-label="More">
          {others.map(([to, k]) => <Link key={k} to={to}>{names[k]}</Link>)}
        </nav>
      </main>
    </div>
  );
}
