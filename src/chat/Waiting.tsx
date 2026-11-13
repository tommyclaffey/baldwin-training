// Team Chat v2 on every page (Nov 13, Figma 09 · Proposals → 27b; Tommy: "on the home page it should be more obvious that
// you have a message waiting").
//   • WaitingCard: top of Home (688:862 desktop, 690:862 phone), for anyone with something waiting. The most important
//     first: an @mention of you ("Mentioned you"), then a pre-shift note you haven't tapped Got It on (Got It right on the
//     card), then direct messages. "3 new in #front-of-house, plus 1 direct message", Open Chat, Mark All Read. Hidden
//     when nothing's waiting.
//   • ChatToast: a small dark toast on other pages (688:1469) with Reply and Open Chat. Decided default (Tommy didn't pick):
//     only for @mentions of you, direct messages and new pre-shift notes, not every message. One at a time, gone after
//     8 s (it waits while you hover or focus it), no slide when you've asked for reduced motion.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { hasChat, pollChatUnread, useChatState, type Latest } from './unread';
import { openChat, useChatPanel } from './panel';
import { clock, I } from './TeamChat';
import { useIsPhone } from './TeamChat';

type Who = { id: number; name: string; initials: string; manager: boolean };
type Item =
  | { type: 'mention'; id: number; key: string; kind: string; roomName: string; user: Who; text: string; body: string; at: string }
  | { type: 'preshift'; id: number; key: string; kind: string; roomName: string; user: Who; text: string; body: string; at: string; pinnedAt: string; title: string }
  | { type: 'dm'; id: number; key: string; kind: string; roomName: string; user: Who; text: string; at: string; count: number };
type Summary = { count: number; mentions: number; channels: { key: string; name: string; unread: number }[]; dms: number; items: Item[] };

const where = (i: { kind: string; roomName: string }) => (i.kind === 'dm' ? 'Direct message' : '#' + i.roomName);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "in #front-of-house, plus 1 direct message" · "in #bar and 1 more channel" · "in 2 direct messages". */
function summaryLine(s: Summary) {
  const ch = s.channels;
  const chPart = ch.length ? `in #${ch[0].name}${ch.length > 1 ? ` and ${plural(ch.length - 1, 'more channel', 'more channels')}` : ''}` : '';
  const dmPart = s.dms ? plural(s.dms, 'direct message', 'direct messages') : '';
  return chPart && dmPart ? `${chPart}, plus ${dmPart}` : chPart || (dmPart ? `in ${dmPart}` : '');
}
/** Phone: "3 new in #front-of-house · 1 direct message". */
function phoneLine(s: Summary) {
  const chNew = s.channels.reduce((n, c) => n + c.unread, 0);
  const parts = [chNew ? `${chNew} new in ${s.channels.length === 1 ? '#' + s.channels[0].name : plural(s.channels.length, 'channel', 'channels')}` : '', s.dms ? plural(s.dms, 'direct message', 'direct messages') : ''];
  return parts.filter(Boolean).join(' · ');
}

const Av = ({ p, size = 40 }: { p: Who; size?: number }) => <span className={'tc-av' + (p.manager ? ' mgr' : '')} style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }} aria-hidden="true">{p.initials}</span>;
/** <@12> → a bold @Name (the summary sends names already, as plain text; the mention is the first "@Name" there). */
function Said({ text }: { text: string }) {
  const m = /^(.*?)(@[A-Z][\w’'-]*(?: [A-Z][\w’'-]*)?)(.*)$/s.exec(text);
  return m ? <>{m[1]}<strong className="wc-at">{m[2]}</strong>{m[3]}</> : <>{text}</>;
}

export function WaitingCard({ style, className = '' }: { style?: CSSProperties; className?: string }) {
  const { user } = useSession();
  const on = hasChat(user);
  const { seq } = useChatState(on);
  const phone = useIsPhone();
  const nav = useNavigate();
  const [s, setS] = useState<Summary | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setS(await api<Summary>('/api/chat/summary')); } catch { /* keep what's shown */ } }, []);
  // Loads when Home opens and whenever the chat's number moves (the poll in unread.ts).
  useEffect(() => { if (on) void load(); }, [on, seq, load]);
  if (!on || !s || (!s.items.length && !s.count)) return null;
  const items = s.items.slice(0, 3);
  const open = (key?: string) => nav('/team-chat' + (key ? '/' + key : ''));
  const gotIt = async (id: number) => { setBusy('g' + id); try { await api(`/api/chat/message/${id}/got-it`, { method: 'POST' }); await load(); void pollChatUnread(); } catch { /* try again */ } setBusy(''); };
  const readAll = async () => { setBusy('all'); try { await api('/api/chat/read-all', { method: 'POST' }); await load(); void pollChatUnread(); } catch { /* try again */ } setBusy(''); };
  const firstKey = items[0]?.key || s.channels[0]?.key;
  return (
    <section className={'wc ' + className} style={{ ...style, width: undefined, maxWidth: '100%' }} aria-labelledby="wc-title">
      <div className="wc-main">
        <p className="wc-eyebrow" id="wc-title"><span className="wc-dot" aria-hidden="true" />Team Chat · Waiting for You</p>
        {items.map((i) => i.type === 'preshift' ? (
          <div key={'p' + i.id} className="wc-row">
            <Link to={'/team-chat/' + i.key} className="wc-link">
              <span className="wc-tile" aria-hidden="true">{I.pin18}</span>
              <span className="wc-copy">
                <span className="wc-head"><strong>Pre-shift note</strong>{phone ? null : <span>{where(i)} · {i.user.name} · {clock(i.pinnedAt)} · you haven’t tapped Got It</span>}</span>
                <span className="wc-text one">{(i.body || i.text).replace(/\n/g, ' ')}</span>
              </span>
            </Link>
            <button type="button" className="wc-got" disabled={busy === 'g' + i.id} onClick={() => void gotIt(i.id)} aria-label={`Got It: ${i.user.name}’s pre-shift note`}>{I.check}<span>Got It</span></button>
          </div>
        ) : (
          <div key={i.type + i.id} className={'wc-row' + (i.type === 'mention' ? ' at' : '')}>
            <Link to={'/team-chat/' + i.key} className="wc-link">
              <Av p={i.user} />
              <span className="wc-copy">
                <span className="wc-head">
                  <strong>{i.user.name}</strong>
                  {i.type === 'mention' && <span className="wc-tag">Mentioned You</span>}
                  {!(phone && i.type === 'mention') && <span>{i.type === 'mention' ? `in ${where(i)}` : where(i)} · {clock(i.at)}</span>}
                </span>
                {phone && i.type === 'mention' && <span className="wc-sub">{where(i)} · {clock(i.at)}</span>}
                <span className={'wc-text' + (i.type === 'dm' ? ' one' : '')}>{i.type === 'mention' ? <Said text={i.body || i.text} /> : i.text}</span>
              </span>
            </Link>
          </div>
        ))}
        {phone && <p className="wc-phone-line">{phoneLine(s)}</p>}
      </div>
      <div className="wc-side">
        {!phone && <p className="wc-count"><strong>{s.count}</strong><span>new</span></p>}
        {!phone && <p className="wc-line">{summaryLine(s) || 'Nothing else new'}</p>}
        <button type="button" className="wc-open" onClick={() => open(firstKey)}>Open Chat {I.arrow}</button>
        {!phone && s.count > 0 && <button type="button" className="wc-all" disabled={busy === 'all'} onClick={() => void readAll()}>Mark All Read</button>}
      </div>
    </section>
  );
}

/* ------------------------------ the toast ------------------------------ */
const SEEN_KEY = 'bt-chat-toast';
export function ChatToast() {
  const { user } = useSession();
  const on = hasChat(user);
  const { latest, loaded } = useChatState(on);
  const { open } = useChatPanel();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [shown, setShown] = useState<NonNullable<Latest> | null>(null);
  const hold = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChat = pathname === '/team-chat' || pathname.startsWith('/team-chat/');

  // A new item (newer than the last one this tab saw) shows once. The first poll in a tab only sets where "new" starts.
  useEffect(() => {
    if (!on || !loaded) return; // not until the first poll has answered
    let seen: string | null = null;
    try { seen = sessionStorage.getItem(SEEN_KEY); } catch { /* private mode */ }
    const at = latest?.at || '';
    const mark = (v: string) => { try { sessionStorage.setItem(SEEN_KEY, v); } catch { /* private mode */ } };
    if (seen === null) { mark(at || new Date(0).toISOString()); return; }
    if (latest && at > seen) {
      mark(at);
      if (!onChat && !open) setShown(latest);
    }
  }, [on, latest, loaded, onChat, open]);

  const dismiss = useCallback(() => { setShown(null); }, []);
  useEffect(() => {
    if (!shown) return;
    const tick = () => { timer.current = setTimeout(() => { if (hold.current) tick(); else dismiss(); }, 8000); };
    tick();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [shown, dismiss]);
  useEffect(() => { if (onChat || open) setShown(null); }, [onChat, open]);
  if (!shown) return null;
  const what = shown.type === 'mention' ? `Mentioned you in #${shown.roomName}` : shown.type === 'preshift' ? `Pre-shift note · #${shown.roomName}` : 'Direct message';
  return (
    <div className="chat-toast" role="status" aria-live="polite"
      onMouseEnter={() => { hold.current = true; }} onMouseLeave={() => { hold.current = false; }}
      onFocus={() => { hold.current = true; }} onBlur={() => { hold.current = false; }}>
      <Av p={shown.user} size={38} />
      <div className="chat-toast-copy">
        <p className="chat-toast-head"><strong>{shown.user.name}</strong><span>{what} · now</span></p>
        <p className="chat-toast-text">{shown.text}</p>
        <div className="chat-toast-btns">
          <button type="button" className="main" onClick={() => { dismiss(); openChat({ room: shown.key, reply: shown.type === 'preshift' ? undefined : shown.id }); }}>{shown.type === 'preshift' ? 'Read It' : 'Reply'}</button>
          <button type="button" onClick={() => { dismiss(); nav('/team-chat/' + shown.key); }}>Open Chat</button>
        </div>
      </div>
      <button type="button" className="chat-toast-x" aria-label="Dismiss" onClick={dismiss}>{I.close}</button>
    </div>
  );
}
