/* Storage, safe DOM text formatting, and HTTP/SSE helpers for the chat widget. */

import type { WidgetLang } from './i18n';

export interface WidgetConfig {
  botName?: string;
  accentColor?: string;
  position?: 'left' | 'right';
  greeting?: string;
  handoffEnabled?: boolean;
  soundEnabled?: boolean;
}

export interface WidgetMessage {
  id?: string;
  role: 'user' | 'assistant' | 'manager';
  content: string;
  senderName?: string;
}

export interface WidgetState {
  sessionId: string;
  messages: WidgetMessage[];
  guestToken: string | null;
  visitorName: string;
  soundMuted: boolean;
}

export interface PublicChatMessageDto {
  id: string;
  senderMemberId: string | null;
  senderName: string;
  originalText: string;
  translations?: Record<string, string>;
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadState(token: string): WidgetState {
  const key = `erp_widget_${token.slice(0, 16)}`;
  const fallback: WidgetState = {
    sessionId: createSessionId(),
    messages: [],
    guestToken: null,
    visitorName: '',
    soundMuted: false,
  };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<WidgetState>;
    return {
      sessionId: typeof parsed.sessionId === 'string' && parsed.sessionId ? parsed.sessionId : fallback.sessionId,
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-50) : [],
      guestToken: typeof parsed.guestToken === 'string' && parsed.guestToken ? parsed.guestToken : null,
      visitorName: typeof parsed.visitorName === 'string' ? parsed.visitorName : '',
      soundMuted: Boolean(parsed.soundMuted),
    };
  } catch {
    return fallback;
  }
}

export function saveState(token: string, state: WidgetState): void {
  const key = `erp_widget_${token.slice(0, 16)}`;
  try {
    const trimmed: WidgetState = { ...state, messages: state.messages.slice(-50) };
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota or private mode errors
  }
}

export function renderSafeText(container: HTMLElement, text: string): void {
  container.textContent = '';
  const lines = text.split('\n');
  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) container.appendChild(document.createElement('br'));
    let last = 0;
    URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_RE.exec(line)) !== null) {
      if (match.index > last) {
        container.appendChild(document.createTextNode(line.slice(last, match.index)));
      }
      const rawUrl = match[0];
      const a = document.createElement('a');
      a.href = rawUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = rawUrl;
      container.appendChild(a);
      last = match.index + rawUrl.length;
    }
    if (last < line.length) {
      container.appendChild(document.createTextNode(line.slice(last)));
    }
  });
}

export async function fetchWidgetConfig(
  apiBase: string,
  token: string,
  lang: WidgetLang,
): Promise<WidgetConfig | null> {
  try {
    const res = await fetch(
      `${apiBase}/hooks/widget/${encodeURIComponent(token)}/config?locale=${encodeURIComponent(lang)}`,
      { method: 'GET' },
    );
    if (!res.ok) return null;
    return (await res.json()) as WidgetConfig;
  } catch {
    return null;
  }
}

export async function streamAiReply(
  apiBase: string,
  token: string,
  payload: Record<string, unknown>,
  onDelta: (chunk: string) => void,
): Promise<string> {
  const res = await fetch(`${apiBase}/hooks/widget/${encodeURIComponent(token)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream') || !res.body) {
    const data = (await res.json()) as { reply?: string; content?: string; message?: string };
    const text = data.reply ?? data.content ?? data.message ?? '';
    if (text) onDelta(text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? '';
    for (const block of parts) {
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as { delta?: string; content?: string; error?: string };
          if (parsed.error) throw new Error(parsed.error);
          const piece = parsed.delta ?? parsed.content ?? '';
          if (piece) {
            full += piece;
            onDelta(piece);
          }
        } catch (err) {
          if (err instanceof Error && err.message && !err.message.includes('JSON')) throw err;
        }
      }
    }
  }
  return full;
}
