/* Публичная страница гостевого чата для внешних заказчиков (/c/:token, без регистрации). */
import * as React from 'react';
import { useParams } from 'react-router';
import { Globe, Languages, MessageSquare, Send } from 'lucide-react';
import { API_BASE, ok } from '../data/api';

interface PublicChat {
  id: string;
  title: string;
  workspaceName: string;
  guestName: string | null;
  guestLanguage: string;
}

interface PublicMessage {
  id: string;
  senderMemberId: string | null;
  senderName: string;
  senderGuestName: string | null;
  originalText: string;
  originalLanguage: string;
  translations: Record<string, string>;
  translationStatus: 'pending' | 'done' | 'failed' | 'none';
  createdAt: string;
}

interface PublicChatResponse {
  chat: PublicChat;
  messages: PublicMessage[];
  languages: { code: string; label: string }[];
}

const UI_STRINGS = {
  en: {
    unavailable: 'Chat unavailable',
    unavailableHint: 'This link may be expired or revoked.',
    loading: 'Loading chat…',
    yourName: 'Your name',
    save: 'Save',
    empty: 'No messages yet. Write something to start the conversation.',
    placeholder: 'Type a message…',
    send: 'Send',
    original: 'Original',
    hideOriginal: 'Hide original',
    translating: 'Translating…',
    guest: 'You',
    sendError: 'Failed to send message',
  },
  ru: {
    unavailable: 'Чат недоступен',
    unavailableHint: 'Возможно, ссылка устарела или была отозвана.',
    loading: 'Загрузка чата…',
    yourName: 'Ваше имя',
    save: 'Сохранить',
    empty: 'Сообщений пока нет. Напишите первым, чтобы начать диалог.',
    placeholder: 'Напишите сообщение…',
    send: 'Отправить',
    original: 'Оригинал',
    hideOriginal: 'Скрыть оригинал',
    translating: 'Переводится…',
    guest: 'Вы',
    sendError: 'Не удалось отправить сообщение',
  },
  es: {
    unavailable: 'Chat no disponible',
    unavailableHint: 'Es posible que este enlace haya caducado o sido revocado.',
    loading: 'Cargando chat…',
    yourName: 'Tu nombre',
    save: 'Guardar',
    empty: 'Aún no hay mensajes. Escribe algo para comenzar.',
    placeholder: 'Escribe un mensaje…',
    send: 'Enviar',
    original: 'Original',
    hideOriginal: 'Ocultar original',
    translating: 'Traduciendo…',
    guest: 'Tú',
    sendError: 'No se pudo enviar el mensaje',
  },
} as const;

const getUi = (lang: string) => {
  const code = lang.toLowerCase().slice(0, 2);
  if (code === 'ru') return UI_STRINGS.ru;
  if (code === 'es') return UI_STRINGS.es;
  return UI_STRINGS.en;
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function PublicChatPage() {
  const { token = '' } = useParams();
  const baseUrl = `${API_BASE()}/public/chats/${encodeURIComponent(token)}`;
  const [chat, setChat] = React.useState<PublicChat | null>(null);
  const [messages, setMessages] = React.useState<PublicMessage[]>([]);
  const [languages, setLanguages] = React.useState<{ code: string; label: string }[]>([]);
  const [lang, setLang] = React.useState('en');
  const [nameInput, setNameInput] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [showOriginal, setShowOriginal] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const prevCountRef = React.useRef(0);

  const ui = getUi(lang);

  const load = React.useCallback(async (initial = false) => {
    try {
      const data = await ok<PublicChatResponse>(fetch(baseUrl));
      setChat(data.chat);
      setMessages(data.messages);
      setLanguages(data.languages);
      if (initial) {
        setLang(data.chat.guestLanguage || 'en');
        setNameInput(data.chat.guestName ?? '');
      }
      setError(false);
    } catch {
      if (initial) setError(true);
    } finally {
      if (initial) setLoading(false);
    }
  }, [baseUrl]);

  React.useEffect(() => {
    setLoading(true);
    setError(false);
    void load(true);
    const id = setInterval(() => void load(false), 3000);
    return () => clearInterval(id);
  }, [load]);

  React.useEffect(() => {
    if (messages.length > prevCountRef.current) {
      endRef.current?.scrollIntoView({ behavior: prevCountRef.current ? 'smooth' : 'auto' });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  const patchGuest = async (body: { guestName?: string; guestLanguage?: string }) => {
    try {
      const res = await ok<{ ok: true; guestName: string | null; guestLanguage: string }>(
        fetch(baseUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      setChat(prev => (prev ? { ...prev, guestName: res.guestName, guestLanguage: res.guestLanguage } : prev));
      setLang(res.guestLanguage);
    } catch {
      /* ignore transient errors */
    }
  };

  const handleLangChange = (nextLang: string) => {
    setLang(nextLang);
    void patchGuest({ guestLanguage: nextLang }).then(() => load(false));
  };

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    void patchGuest({ guestName: trimmed });
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const guestName = (chat?.guestName || nameInput).trim() || undefined;
      const res = await ok<{ message: PublicMessage }>(
        fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, guestName, language: lang }),
        }),
      );
      setDraft('');
      setMessages(prev => (prev.some(m => m.id === res.message.id) ? prev : [...prev, res.message]));
      if (guestName && !chat?.guestName) {
        setChat(prev => (prev ? { ...prev, guestName } : prev));
      }
    } catch {
      setSendError(ui.sendError);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--text-3)' }}>
        <p>{ui.loading}</p>
      </main>
    );
  }

  if (error || !chat) {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 24, textAlign: 'center' }}>
        <div style={{ maxWidth: 380 }}>
          <MessageSquare size={32} style={{ color: 'var(--text-4)', margin: '0 auto 12px' }} />
          <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, margin: '0 0 6px' }}>{ui.unavailable}</h1>
          <p style={{ color: 'var(--text-3)', margin: 0 }}>{ui.unavailableHint}</p>
        </div>
      </main>
    );
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text)' }}>
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', fontWeight: 500 }}>{chat.workspaceName}</div>
            <h1 style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {chat.title}
            </h1>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
            <Globe size={15} />
            <select
              aria-label="Language"
              value={lang}
              onChange={e => handleLangChange(e.target.value)}
              style={{
                height: 32,
                padding: '0 8px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--border-strong)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 'var(--fs-sm)',
              }}
            >
              {(languages.length ? languages : [{ code: lang, label: lang.toUpperCase() }]).map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
        </div>

        {!chat.guestName && (
          <div style={{ maxWidth: 780, margin: '10px auto 0', display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder={ui.yourName}
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); }}
              style={{
                flex: 1,
                maxWidth: 280,
                height: 32,
                padding: '0 10px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--border-strong)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 'var(--fs-sm)',
              }}
            />
            <button
              type="button"
              onClick={handleSaveName}
              disabled={!nameInput.trim()}
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--border-strong)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                fontSize: 'var(--fs-sm)',
                cursor: nameInput.trim() ? 'pointer' : 'default',
                opacity: nameInput.trim() ? 1 : 0.5,
              }}
            >
              {ui.save}
            </button>
          </div>
        )}
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-3)', padding: '48px 16px', margin: 0 }}>{ui.empty}</p>
          )}
          {messages.map(m => {
            const isGuest = m.senderMemberId === null;
            const translated = m.translations?.[lang];
            const hasTranslation = Boolean(translated && translated !== m.originalText);
            const displayText = hasTranslation ? translated : m.originalText;
            const author = isGuest ? (m.senderGuestName || chat.guestName || ui.guest) : m.senderName;
            const expanded = Boolean(showOriginal[m.id]);

            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isGuest ? 'flex-end' : 'flex-start' }}>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-3)', margin: '0 6px 3px' }}>
                  {author} · {fmtTime(m.createdAt)}
                </div>
                <div
                  style={{
                    maxWidth: 'min(82%, 560px)',
                    padding: '9px 13px',
                    borderRadius: 14,
                    borderBottomRightRadius: isGuest ? 4 : 14,
                    borderBottomLeftRadius: isGuest ? 14 : 4,
                    background: isGuest ? 'var(--accent)' : 'var(--surface)',
                    color: isGuest ? 'var(--on-accent)' : 'var(--text)',
                    border: isGuest ? 'none' : '1px solid var(--border)',
                    boxShadow: 'var(--shadow-sm)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    lineHeight: 1.45,
                  }}
                >
                  {displayText}
                </div>
                {!isGuest && (hasTranslation || m.translationStatus === 'pending') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 6px 0', fontSize: 'var(--fs-2xs)', color: 'var(--text-3)' }}>
                    {m.translationStatus === 'pending' && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Languages size={12} /> {ui.translating}
                      </span>
                    )}
                    {hasTranslation && (
                      <button
                        type="button"
                        onClick={() => setShowOriginal(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 'inherit' }}
                      >
                        {expanded ? ui.hideOriginal : ui.original}
                      </button>
                    )}
                  </div>
                )}
                {!isGuest && expanded && hasTranslation && (
                  <div
                    style={{
                      maxWidth: 'min(82%, 560px)',
                      marginTop: 4,
                      padding: '6px 10px',
                      borderRadius: 'var(--r)',
                      background: 'var(--surface-2)',
                      color: 'var(--text-2)',
                      fontSize: 'var(--fs-sm)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.originalText}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </main>

      <footer style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '10px 12px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          {sendError && <div style={{ color: 'var(--red)', fontSize: 'var(--fs-xs)', marginBottom: 6 }}>{sendError}</div>}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <textarea
              rows={1}
              placeholder={ui.placeholder}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              style={{
                flex: 1,
                minHeight: 40,
                maxHeight: 140,
                padding: '9px 12px',
                borderRadius: 'var(--r-lg)',
                border: '1px solid var(--border-strong)',
                background: 'var(--bg)',
                color: 'var(--text)',
                font: 'inherit',
                resize: 'vertical',
              }}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!draft.trim() || sending}
              aria-label={ui.send}
              style={{
                height: 40,
                padding: '0 16px',
                borderRadius: 'var(--r-lg)',
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--on-accent)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 500,
                cursor: draft.trim() && !sending ? 'pointer' : 'default',
                opacity: draft.trim() && !sending ? 1 : 0.5,
              }}
            >
              <Send size={15} />
              <span>{ui.send}</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default PublicChatPage;
