// Certificates (Nov 8, Tommy: "Let's do the cert"). Figma: 09 · Proposals → 22 · Certificates: the certificate (468:46,
// Level 1 without a practical 468:89) and its page (469:80). Every size is in container units, so the certificate scales
// with its box and prints edge to edge on US Letter, landscape. "Print or Save as PDF" uses the browser's own print window.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { currentBrand } from '../lib/skin';
import { useSession } from '../lib/session';

export type Cert = {
  key: string; isA?: boolean; program: string; programName: string; programSlug: string; level: number; levelWord: string; title: string; seal: string;
  name: string; final: { pct: number; at: string; firstAt: string }; practical: { at: string; by: string | null } | null;
  number: string; earnedAt: string; store: string | null; logo: string | null; fine: string;
};

const day = (iso: string, month: 'short' | 'long' = 'short') => new Date(iso).toLocaleDateString('en-US', { month, day: 'numeric', year: 'numeric', timeZone: 'America/Detroit' });

/** The certificate itself, 1056 × 816 in the design. */
export function Certificate({ c }: { c: Cert }) {
  const facts: [string, string][] = [['Final exam', `${c.final.pct}% · ${day(c.final.at)}`]];
  if (c.practical) facts.push(['Practical', c.practical.by ? `Signed off by ${c.practical.by}` : `Signed off ${day(c.practical.at)}`]);
  facts.push(['Certificate no.', c.number]);
  const store = c.store || 'Our restaurant';
  return (
    <div className="cert" role="img" aria-label={`Certificate: ${c.name}, ${c.title}, ${c.programName} Level ${c.level}, ${day(c.earnedAt, 'long')}`}>
      <div className="cert-in">
        <div className="cert-band">{c.logo ? <img src={c.logo} alt={store} /> : <span>{store}</span>}</div>
        <p className="cert-script">Certificate of Completion</p>
        <p className="cert-label">This certifies that</p>
        <p className="cert-name">{c.name}</p>
        <span className="cert-rule" aria-hidden="true" />
        <p className="cert-line">completed Level {c.levelWord} of {store === 'Our restaurant' ? 'the' : store} {c.programName}{c.isA === false ? ':' : ' and is a'}</p>
        <p className="cert-title">{c.title}</p>
        <div className="cert-facts">
          {facts.map(([k, v]) => <div key={k}><span>{k}</span><strong>{v}</strong></div>)}
        </div>
        <div className="cert-foot">
          <div><span>Issued by</span><strong>{store}</strong><small>Earned in the Mise training app</small></div>
          <div className="cert-seal" aria-hidden="true"><i>Level</i><b>{c.level}</b><i>{c.seal}</i></div>
          <div className="right"><span>Date</span><strong>{day(c.earnedAt, 'long')}</strong></div>
        </div>
        <p className="cert-fine">A training certificate from {store}. {c.fine}</p>
      </div>
    </div>
  );
}

/** Print only the certificate (the class hides the rest of the app while the print window is open). */
function printCert() {
  document.body.classList.add('printing-cert');
  const done = () => { document.body.classList.remove('printing-cert'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

/** /certificate/<level> (e.g. bar-2): your own, or a staff member's for managers (?user=<id>). */
export function CertificatePage() {
  const { pathname, search } = useLocation();
  const { user } = useSession();
  const key = pathname.split('/')[2] || '';
  const who = new URLSearchParams(search).get('user');
  const [list, setList] = useState<Cert[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setList(null); setErr('');
    api<{ certificates: Cert[] }>('/api/certificates' + (who ? `?user=${encodeURIComponent(who)}` : '')).then((r) => setList(r.certificates)).catch((e) => setErr((e as Error).message));
  }, [who]);
  const c = list?.find((x) => x.key === key);
  useEffect(() => { document.title = `${c ? c.title : 'Certificate'} · Mise Academy`; }, [c]);
  const mine = !who || Number(who) === user?.id;
  const [full, setFull] = useState(false); // Nov 10 (audit): on a phone the certificate is tiny; this shows it sideways, as big as the screen allows
  useEffect(() => { if (!full) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [full]);
  if (err) return <main className="page cp"><p role="alert" className="mp-err">{err}</p></main>;
  if (!list) return <main className="page cp"><div className="loader" /></main>;
  if (!c) return (
    <main className="page cp" aria-labelledby="cp-title">
      <h1 id="cp-title">{currentBrand() === 'mise' ? 'Not Earned Yet' : 'NOT EARNED YET'}</h1>
      <p className="cp-note">This certificate shows here once its final is passed, and its practical is signed off where the level has one.</p>
      <Link className="mp-btn dark" to="/my-path">Back to My Path</Link>
    </main>
  );
  return (
    <main className="page cp" aria-labelledby="cp-title">
      <nav className="cp-crumbs" aria-label="Breadcrumb">
        <Link to={'/' + c.programSlug}>← {c.programName}</Link><span aria-hidden="true">/</span>
        <Link to={'/' + c.programSlug}>Level {c.level}</Link><span aria-hidden="true">/</span>
        <span aria-current="page">Certificate</span>
      </nav>
      <header className="cp-head">
        <div>
          <p className="mp-script">{mine ? `Well earned, ${c.name.split(/\s+/)[0]}` : `${c.name}’s certificate`}</p>
          <h1 id="cp-title">{currentBrand() === 'mise' ? (mine ? 'Your Certificate' : 'Certificate') : mine ? 'YOUR CERTIFICATE' : 'CERTIFICATE'}</h1>
        </div>
        <div className="cp-actions">
          <button type="button" className="mp-btn dark" onClick={printCert}>Print or Save as PDF</button>
          <button type="button" className="mp-btn cp-full-btn" onClick={() => setFull(true)}>View Full Size</button>
        </div>
      </header>
      <div className="cp-sheet"><Certificate c={c} /></div>
      {full && (
        <div className="cp-full" role="dialog" aria-modal="true" aria-label="Certificate, full size" onClick={() => setFull(false)}>
          <div className="cp-full-rot"><Certificate c={c} /></div>
          <button type="button" className="cp-full-close" onClick={() => setFull(false)} autoFocus>Close</button>
        </div>
      )}
      <p className="cp-note">To keep a copy, pick “Save as PDF” in the print window. Your manager can see it on Admin → Training. Retaking the final never takes it away.</p>
    </main>
  );
}
