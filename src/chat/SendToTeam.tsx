// Send to Team (Nov 11, Tommy: "make the chat similar to growth where you can select an item to populate in the chat").
// One small button, in the same spot on every page you can share: the page's top row, beside Edit Page (phones: both
// float together at the bottom right). It opens the Team Chat panel with the page staged as a card in the composer.
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { openChat, type ChatItem } from './panel';
export { shareable } from './sendable';

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
  // (floating, it sits outside the page's main area, so it's its own named region: Nov 12 scan, "content outside a landmark")
  if (floating) return createPortal(<div className="page-tools floating" role="region" aria-label="Page tools">{children}</div>, document.body);
  return (
    <div className="eip-edit-wrap" style={{ width, zoom }}>
      <div className="page-tools" role="group" aria-label="Page tools">{children}</div>
    </div>
  );
}

/** The speech bubble (the sidebar's Team Chat icon). */
const Bubble = <svg width="16" height="16" viewBox="0 0 17 17" fill="none" aria-hidden="true"><path d="M14.52 8.15a5.67 5.67 0 0 1-8.29 5.03l-3.4.99.99-3.12A5.67 5.67 0 1 1 14.52 8.15Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;

/** The small round chat button on an item (a card, a row, a person), shown on hover and focus (always on touch rows).
 *  No native tooltip (Nov 11, Tommy: it popped up over the dish name); the aria-label names it for screen readers.
 *  It stages the item in Team Chat, like Send to Team, and never follows the link it sits in. */
export function ItemChatButton({ item, title, className = '', style }: { item: ChatItem; title: string; className?: string; style?: CSSProperties }) {
  return (
    <button type="button" className={'item-chat ' + className} style={style} aria-label={`Send ${title} to Team Chat`} aria-haspopup="dialog"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openChat({ item }); }}>
      {Bubble}
    </button>
  );
}
