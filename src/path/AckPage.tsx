// The Training Acknowledgment (Nov 12, Tommy: "The employee training acknowledgement should be a part of their path, not a
// part of the hospitality part"). A Day 1 step on every job's path: the person reads it and signs it here, then their
// trainer or a manager signs it off (People, Sign-offs). The words are the company's own version (server/variant.mjs):
// BRG's for BRG's companies, the softened generic one for everyone else.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { currentBrand } from '../lib/theme';
import { Acknowledgment, type Ack } from '../components/Acknowledgment';
import { reloadPath } from './store';

type AckData = Ack & { script: string | null; title: string; statement: string };

export function AckPage() {
  const { user } = useSession();
  const [data, setData] = useState<AckData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    document.title = 'Training Acknowledgment · Mise Academy';
    api<AckData>('/api/path/ack').then(setData).catch((e) => setErr((e as Error).message));
  }, [user?.id]);
  const title = currentBrand() === 'mise' ? 'Training Acknowledgment' : 'TRAINING ACKNOWLEDGMENT';
  return (
    <main className="page mp ack-page" aria-labelledby="ack-title">
      <p className="ack-back"><Link to="/my-path">← My Path</Link></p>
      <header className="mp-head">
        <div>
          <p className="mp-script">Day 1 · part of your path</p>
          <h1 id="ack-title">{title}</h1>
        </div>
      </header>
      {err && <p role="alert" className="mp-err">{err}</p>}
      {!data && !err && <div className="loader" />}
      {data && (
        <section className="ack-card" aria-label={data.title}>
          <p className="ack-kicker">{data.script || 'Part of your new-hire paperwork'}</p>
          <h2>{data.title}</h2>
          <p className="ack-statement">{data.statement}</p>
          <Acknowledgment data={data} onSigned={() => void reloadPath()} />
        </section>
      )}
      <section className="mp-card mp-tint ack-how">
        <p className="mp-label">How It Works</p>
        <p>Read it, type your name and tick the box. Your trainer or a manager then signs it off, and it’s done on your path.</p>
      </section>
    </main>
  );
}
