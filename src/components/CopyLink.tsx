// An account's own link (Nov 19): miseacademy.app/<account>, shown and copied in Super Admin → Companies and the HQ home.
import { useEffect, useState } from 'react';
import { linkText } from '../lib/account';

export function CopyLink({ link, name }: { link: string; name: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 2000); return () => clearTimeout(t); }, [done]);
  return (
    <span className="copy-link">
      <a href={link} target="_blank" rel="noopener">{linkText(link)}<span className="sr-only"> ({name}’s sign-in, opens in a new tab)</span></a>
      <button type="button" className="link-btn" onClick={() => { void navigator.clipboard?.writeText(location.origin + link); setDone(true); }}>
        {done ? 'Copied' : 'Copy Link'}<span className="sr-only"> for {name}</span>
      </button>
    </span>
  );
}
