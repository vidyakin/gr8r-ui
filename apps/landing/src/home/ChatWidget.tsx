/* Плавающий виджет ИИ-консультанта: SSE-стриминг + JSON fallback, XSS-безопасный рендер */
import * as React from 'react';
import { ArrowUpRight, Maximize2, MessageSquare, Minimize2, SendHorizontal, Sparkles, X } from 'lucide-react';
import { DEFAULT_LOCALE, type Locale } from '../i18n';
import { getChatStrings } from '../i18n/chat';
import { getVisitorName } from './visitor-id';
import './chat-widget.css';

interface ChatMsg {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

const ALLOWED_ORIGIN = 'https://future-erp.ru/';
const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined)?.trim() || '/app/';

function resolveChatUrl(): string {
  const direct = (import.meta.env.VITE_CHAT_URL as string | undefined)?.trim();
  if (direct) return direct;
  const leadUrl = (import.meta.env.VITE_LEAD_FORM_URL as string | undefined)?.trim();
  if (leadUrl) {
    try {
      if (/\/hooks\/leads\/[^/]+/i.test(leadUrl)) return leadUrl.replace(/\/hooks\/leads\/.*$/i, '/hooks/chat');
      return `${new URL(leadUrl).origin}/hooks/chat`;
    } catch {
      /* некорректный URL вебхука — используем локальный прокси */
    }
  }
  return '/api/hooks/chat';
}

const CHAT_URL = resolveChatUrl();

const isSafeUrl = (url: string): boolean =>
  (url.startsWith('/') && !url.startsWith('//')) || url.startsWith(ALLOWED_ORIGIN);

function trimUrlPunctuation(raw: string): [string, string] {
  const m = raw.match(/^(.*?)([.,;:!?)]+)?$/);
  return [m?.[1] || raw, m?.[2] || ''];
}

function renderInline(line: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https:\/\/future-erp\.ru\/[^\s<>()]+)|((?:^|(?<=[\s(\[«"—:]))\/(?:(?:en|es)\/)?(?:modules|blog|app|docs|privacy|consent)(?:\/[a-z0-9._-]+)*\/?)/gi;
  let last = 0;
  let idx = 0;
  for (const m of line.matchAll(pattern)) {
    const start = m.index ?? 0;
    if (start > last) nodes.push(line.slice(last, start));
    if (m[1]) {
      nodes.push(<strong key={`${keyPrefix}-b${idx++}`}>{m[1]}</strong>);
    } else if (m[2] && m[3]) {
      const [label, url] = [m[2], m[3]];
      if (isSafeUrl(url)) {
        const external = url.startsWith(ALLOWED_ORIGIN);
        nodes.push(
          <a key={`${keyPrefix}-a${idx++}`} href={url} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
            {label}
          </a>,
        );
      } else {
        nodes.push(m[0]);
      }
    } else if (m[4]) {
      const [url, trail] = trimUrlPunctuation(m[4]);
      nodes.push(
        <a key={`${keyPrefix}-u${idx++}`} href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>,
      );
      if (trail) nodes.push(trail);
    } else if (m[5]) {
      const [url, trail] = trimUrlPunctuation(m[5]);
      nodes.push(
        <a key={`${keyPrefix}-p${idx++}`} href={url}>
          {url}
        </a>,
      );
      if (trail) nodes.push(trail);
    }
    last = start + m[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

function renderMessage(text: string): React.ReactNode {
  return text.split(/\n{2,}/).map((block, pIdx) => (
    <p key={pIdx}>
      {block.split('\n').map((line, lIdx) => (
        <React.Fragment key={lIdx}>
          {lIdx > 0 && <br />}
          {renderInline(line, `${pIdx}-${lIdx}`)}
        </React.Fragment>
      ))}
    </p>
  ));
}

export default function ChatWidget({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  const c = getChatStrings(locale);
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [customGreeting, setCustomGreeting] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const nextId = React.useRef(1);
  const sessionIdRef = React.useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '',
  );
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const fabRef = React.useRef<HTMLButtonElement | null>(null);
  const trapRef = React.useRef<HTMLInputElement | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const configFetchedRef = React.useRef(false);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  React.useEffect(() => {
    if (!open || configFetchedRef.current) return;
    const ctrl = new AbortController();
    fetch(`${CHAT_URL}/config?locale=${encodeURIComponent(locale)}`, { signal: ctrl.signal })
      .then(res => (res.ok ? res.json() : null))
      .then((data: { greeting?: unknown } | null) => {
        configFetchedRef.current = true;
        if (data && typeof data.greeting === 'string' && data.greeting.trim()) {
          setCustomGreeting(data.greeting);
        }
      })
      .catch(() => {
        /* конфигурация опциональна — используем стандартное приветствие */
      });
    return () => ctrl.abort();
  }, [open, locale]);

  React.useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        fabRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  React.useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, messages, busy, error]);

  const sendMessage = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    const userId = nextId.current++;
    const botId = nextId.current++;
    const history = [...messages, { id: userId, role: 'user' as const, content: text }];

    setError(null);
    setInput('');
    setBusy(true);
    setMessages([...history, { id: botId, role: 'assistant', content: '' }]);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const dropEmptyBot = () =>
      setMessages(prev => prev.filter(m => !(m.id === botId && !m.content)));

    try {
      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          sessionId: sessionIdRef.current || undefined,
          visitorName: typeof window !== 'undefined' ? getVisitorName() : undefined,
          pageUrl: typeof window !== 'undefined' ? window.location.pathname : undefined,
          locale,
          messages: history
            .slice(-10)
            .map(({ role, content }) => ({ role, content: content.slice(0, role === 'user' ? 800 : 3500) })),
          stream: true,
          website: trapRef.current?.value ?? '',
        }),
      });

      if (!res.ok) {
        dropEmptyBot();
        setError(res.status === 429 ? c.errRateLimit : res.status === 503 ? c.errUnavailable : c.errGeneric);
        return;
      }

      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const data = (await res.json()) as { reply?: string };
        if (typeof data.reply === 'string' && data.reply) {
          setMessages(prev => prev.map(m => (m.id === botId ? { ...m, content: data.reply! } : m)));
        } else {
          dropEmptyBot();
          setError(c.errGeneric);
        }
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        dropEmptyBot();
        setError(c.errGeneric);
        return;
      }

      const decoder = new TextDecoder();
      let buf = '';
      let gotText = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '');
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload) as { delta?: string; reply?: string };
            const chunk = parsed.delta ?? parsed.reply ?? '';
            if (chunk) {
              gotText = true;
              setMessages(prev => prev.map(m => (m.id === botId ? { ...m, content: m.content + chunk } : m)));
            }
          } catch {
            /* пропускаем неполный или служебный кадр */
          }
        }
      }
      if (!gotText) {
        dropEmptyBot();
        setError(c.errGeneric);
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      dropEmptyBot();
      setError(c.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hc-root">
      {open && expanded && <div className="hc-backdrop" aria-hidden="true" onClick={() => setExpanded(false)} />}
      {open && (
        <section className={`hc-panel${expanded ? ' is-expanded' : ''}`} id="hc-panel" role="dialog" aria-label={c.title}>
          <header className="hc-head">
            <div className="hc-head-info">
              <span className="hc-badge" aria-hidden="true"><Sparkles size={18} /></span>
              <div>
                <h2 className="hc-title">{c.title}</h2>
                <p className="hc-sub">{c.subtitle}</p>
              </div>
            </div>
            <div className="hc-head-actions">
              <button
                type="button"
                className="hc-close hc-expand"
                aria-label={expanded ? c.collapse : c.expand}
                title={expanded ? c.collapse : c.expand}
                onClick={() => setExpanded(v => !v)}
              >
                {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
              </button>
              <button type="button" className="hc-close" aria-label={c.close} onClick={() => { setOpen(false); setExpanded(false); }}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="hc-msgs" ref={listRef} aria-live="polite">
            <div className="hc-msg hc-msg-bot">
              <div className="hc-bubble"><p>{customGreeting || c.welcome}</p></div>
            </div>

            {messages.length === 0 && (
              <div className="hc-starters">
                {c.starters.map(q => (
                  <button key={q} type="button" className="hc-chip" onClick={() => void sendMessage(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            {messages.map(m => (
              <div key={m.id} className={`hc-msg ${m.role === 'user' ? 'hc-msg-user' : 'hc-msg-bot'}`}>
                <div className="hc-bubble">
                  {m.content ? renderMessage(m.content) : <span className="hc-thinking">{c.thinking}</span>}
                </div>
              </div>
            ))}

            {error && (
              <div className="hc-err" role="alert">
                <span>{error}</span>
                <a className="hc-err-link" href="#request" onClick={() => setOpen(false)}>
                  {c.ctaRequest}
                </a>
              </div>
            )}
          </div>

          <footer className="hc-foot">
            <div className="hc-ctas">
              <a className="hc-cta-btn hc-cta-primary" href={APP_URL}>
                {c.ctaDemo}
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
              <a className="hc-cta-btn" href="#request" onClick={() => setOpen(false)}>
                {c.ctaRequest}
              </a>
            </div>

            <form
              className="hc-form"
              onSubmit={e => {
                e.preventDefault();
                void sendMessage(input);
              }}
            >
              <input ref={trapRef} className="hc-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
              <input
                ref={inputRef}
                className="hc-input"
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={c.placeholder}
                aria-label={c.placeholder}
                maxLength={800}
              />
              <button type="submit" className="hc-send" aria-label={c.send} disabled={busy || !input.trim()}>
                <SendHorizontal size={16} aria-hidden="true" />
              </button>
            </form>
            <p className="hc-disclaimer">{c.disclaimer}</p>
          </footer>
        </section>
      )}

      <button
        ref={fabRef}
        type="button"
        className="hc-fab"
        aria-expanded={open}
        aria-controls="hc-panel"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <X size={18} aria-hidden="true" /> : <MessageSquare size={18} aria-hidden="true" />}
        <span>{c.fabLabel}</span>
      </button>
    </div>
  );
}
