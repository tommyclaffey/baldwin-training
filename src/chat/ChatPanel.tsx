// Team Chat as a side panel, on any page (Nov 11, Tommy: "make the chat similar to growth where you can select an item
// to populate in the chat"). Growth's ChatPanel is the pattern: it sits beside the page (the page narrows, like Growth's
// is-chat-open) rather than over it, so it isn't a focus trap; Escape closes it and focus goes back where it was.
// Phones: a full-screen sheet with a close button. Same conversations, unread counts, pinned note, Got It, reactions and
// polling as the Team Chat page, because it's the same pieces (TeamChat.tsx). Open Full Chat goes to that page.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { closeChat, setPanelRoom, useChatPanel } from './panel';
import { Conversation, Conversations, I, StagedCard, useIsPhone, usePoll, type List } from './TeamChat';
import { hasChat, setChatUnread } from './unread';

const onChatPage = (p: string) => p === '/team-chat' || p.startsWith('/team-chat/');

export function ChatPanelHost() {
  const { user } = useSession();
  const { open } = useChatPanel();
  const { pathname } = useLocation();
  const here = onChatPage(pathname);
  // Going to the Team Chat page (Open Full Chat, or a link) closes the panel: the page is the chat.
  useEffect(() => { if (here && open) closeChat({ restoreFocus: false }); }, [here, open]);
  const shown = open && !here && hasChat(user);
  useEffect(() => {
    document.body.classList.toggle('tcp-open', shown);
    return () => document.body.classList.remove('tcp-open');
  }, [shown]);
  return shown ? <ChatPanel /> : null;
}

function ChatPanel() {
  const { room, staged } = useChatPanel();
  const phone = useIsPhone();
  const nav = useNavigate();
  const ref = useRef<HTMLElement>(null);
  const [list, setList] = useState<List | null>(null);
  const [err, setErr] = useState('');
  const loadList = useCallback(async () => {
    try { const l = await api<List>('/api/chat'); setList(l); setChatUnread(l.unread); setErr(''); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Team Chat didn’t load. Try again.'); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);
  usePoll(loadList, 6000, !room);

  // Focus moves into the panel when it opens, and back to the panel when you leave a conversation for the list.
  useEffect(() => { if (!room) ref.current?.focus({ preventScroll: true }); }, [room]);
  // Escape closes the panel, unless something inside it is open (the New Message or Link a Page lists close first;
  // the @mention list handles its own Escape).
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (ref.current?.querySelector('.tc-pop')) return;
      if (document.querySelector('.dw-scrim, .tour-card, .eip, .qm-scrim')) return; // the demo's cards and the edit sheet own Escape
      closeChat();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  // The phone sheet covers the page: the page behind doesn't scroll.
  useEffect(() => {
    if (!phone) return;
    document.body.classList.add('menu-lock');
    return () => document.body.classList.remove('menu-lock');
  }, [phone]);

  const actions = (
    <>
      <button type="button" className="tcp-btn" aria-label="Open Full Chat" title="Open Full Chat"
        onClick={() => { closeChat({ restoreFocus: false }); nav('/team-chat' + (room ? '/' + room : '')); }}>{I.expand}</button>
      <button type="button" className="tcp-btn" aria-label="Close Team Chat" title="Close" onClick={() => closeChat()}>{I.close}</button>
    </>
  );
  return (
    <aside ref={ref} tabIndex={-1} className="tcp" aria-label="Team Chat" role={phone ? 'dialog' : 'complementary'} aria-modal={phone || undefined}>
      <div className={'tc tcp-in ' + (room ? 'tc-phone-room' : 'tc-phone-list')}>
        {room
          ? <Conversation key={room} roomKey={room} phone={phone} details={false} setDetails={() => {}} onChanged={loadList} onBack={() => setPanelRoom(null)} actions={actions} />
          : <Conversations list={list} error={err} active="" panel onOpen={(k) => setPanelRoom(k)} actions={actions} personOnly={staged?.type === 'person'} />}
        {!room && staged && (
          <div className="tcp-staged">
            <StagedCard staged={staged} note={<p className="tc-compose-note">Pick a conversation above to send it. You can add a message there.</p>} />
          </div>
        )}
      </div>
    </aside>
  );
}
