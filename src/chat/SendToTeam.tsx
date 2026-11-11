// Send to Team (Nov 11, Tommy: "make the chat similar to growth where you can select an item to populate in the chat").
// One small button, in the same spot on every page you can share: the page's top row, beside Edit Page (phones: both
// float together at the bottom right). It opens the Team Chat panel with the page staged as a card in the composer.
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { IndexEntry } from '../lib/api';
import { openChat, type ChatItem } from './panel';

/** Pages that are one thing you'd talk about: a dish, a cocktail, a wine, a bottle, a lesson. Not hubs or home. */
const SHAREABLE = new Set(['Recipe', 'Signature', 'Classic', 'Wine list', 'Back bar', 'Bottle', 'Wine', 'Spirit', 'Beer', 'Bar Basics', 'Wine Service']);
export const shareable = (e: IndexEntry | undefined) => !!e && (SHAREABLE.has(e.section) || /^Step \d/.test(e.section) || /^[lm]/.test(e.file));

const SendIcon = <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M2.5 7.5 12.5 2.5 8.75 12.5 7.19 8.44 2.5 7.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;

/** The button. `className` picks its look: the page's small button (eip-edit) or the People page's (mg-btn). */
export function SendToTeamButton({ item, className = 'eip-edit', label = 'Send to Team' }: { item: ChatItem; className?: string; label?: string }) {
  return (
    <button type="button" className={className + ' send-team'} aria-haspopup="dialog" onClick={() => openChat({ item })}>
      {SendIcon}{label}
    </button>
  );
}

/** The page's tool row (Send to Team, Edit Page): over the design's breadcrumb row on the right; floating on phones. */
export function PageTools({ floating, width, zoom, children }: { floating: boolean; width: number | string; zoom?: number; children: ReactNode }) {
  if (floating) return createPortal(<div className="page-tools floating" role="group" aria-label="Page tools">{children}</div>, document.body);
  return (
    <div className="eip-edit-wrap" style={{ width, zoom }}>
      <div className="page-tools" role="group" aria-label="Page tools">{children}</div>
    </div>
  );
}
