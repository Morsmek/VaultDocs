import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import * as Y from 'yjs';

interface ChatMessage {
  id: string;
  author: string;
  body: string;
  createdAt: number;
}

interface ChatPanelProps {
  doc: Y.Doc;
  username: string;
  onClose: () => void;
}

const toMessage = (value: unknown): ChatMessage | null => {
  const raw = value instanceof Y.Map ? value.toJSON() : value;
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Partial<ChatMessage>;
  if (typeof message.id !== 'string' || typeof message.body !== 'string' || typeof message.author !== 'string' || typeof message.createdAt !== 'number') {
    return null;
  }
  return message as ChatMessage;
};

export function ChatPanel({ doc, username, onClose }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chat = doc.getArray<Y.Map<unknown>>('chat');
    const refresh = () => {
      setMessages(chat.toArray().map(toMessage).filter((message): message is ChatMessage => message !== null));
    };
    refresh();
    chat.observe(refresh);
    return () => chat.unobserve(refresh);
  }, [doc]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const sendMessage = (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;

    const message = new Y.Map<unknown>();
    message.set('id', crypto.randomUUID());
    message.set('author', username.trim() || 'Anonymous');
    message.set('body', body);
    message.set('createdAt', Date.now());
    doc.getArray<Y.Map<unknown>>('chat').push([message]);
    setDraft('');
  };

  return (
    <aside className="chat-panel" aria-label="Document chat">
      <div className="chat-panel-header">
        <div className="chat-panel-title"><MessageCircle size={17} /> Chat</div>
        <button className="comments-close-btn" onClick={onClose} type="button" aria-label="Close chat"><X size={18} /></button>
      </div>
      <div className="chat-message-list" ref={scrollRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="chat-empty">No messages yet. Start the conversation.</p>
        ) : messages.map((message) => (
          <article className="chat-message" key={message.id}>
            <div className="chat-message-meta">
              <strong>{message.author}</strong>
              <time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
            <p>{message.body}</p>
          </article>
        ))}
      </div>
      <form className="chat-form" onSubmit={sendMessage}>
        <label className="sr-only" htmlFor="chat-message">Message</label>
        <textarea id="chat-message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message collaborators…" rows={3} />
        <button className="chat-send-btn" type="submit" disabled={!draft.trim()}><Send size={14} /> Send</button>
      </form>
    </aside>
  );
}
