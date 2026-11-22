/* Валидация, санитизация, обращение к OpenAI-совместимому LLM и сохранение истории ИИ-консультанта лендинга. */
import { sql as dsql } from 'drizzle-orm';
import { z } from 'zod';
import { aiChatSessions, isUuid, withContext, type LandingChatLogMessage, type Sql } from '@erp/db';
import { AppError } from '../errors';
import type { LandingAiConfig } from '../types';
import { buildSystemPrompt, type LandingLocale } from './knowledge';
import type { AiChatTone } from './settings';

export interface LandingChatStyle {
  tone?: AiChatTone;
  customToneNote?: string;
}

const chatMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.string().trim().min(1).max(800) }),
  z.object({ role: z.literal('assistant'), content: z.string().trim().min(1).max(4000) }),
]);

export const landingChatBody = z.object({
  sessionId: z.string().uuid().optional(),
  visitorName: z.string().trim().max(80).optional(),
  pageUrl: z.string().trim().max(300).optional(),
  locale: z.enum(['ru', 'en', 'es']).default('ru'),
  messages: z
    .array(chatMessageSchema)
    .min(1)
    .max(10)
    .refine(msgs => msgs[msgs.length - 1]?.role === 'user', { message: 'Last message must be from user' }),
  stream: z.boolean().optional().default(true),
  website: z.string().max(200).optional(),
});

export type LandingChatBody = z.infer<typeof landingChatBody>;
export type LandingChatMessage = z.infer<typeof chatMessageSchema>;

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LEAKED_TAGS_RE = /<\/?(?:system|instructions?|prompt|developer|assistant|tool_call)[^>]*>|<<\/?SYS>>|<\|(?:im_start|im_end|system|endoftext)\|>/gi;

/** Убирает нулевые байты и управляющие символы, сохраняя переносы строк и табуляции */
export function sanitizeUserText(s: string): string {
  return s.replace(CONTROL_CHARS_RE, '').trim();
}

/** Очищает ответ модели от возможных служебных тегов промпта и управляющих символов */
export function sanitizeAssistantOutput(s: string): string {
  return s.replace(CONTROL_CHARS_RE, '').replace(LEAKED_TAGS_RE, '');
}

/** Вежливая заглушка при срабатывании honeypot-поля (бот получает ответ без вызова LLM) */
export function honeypotReply(locale: LandingLocale): string {
  if (locale === 'en') return 'Thanks for your question! Please open the live demo or leave a request in the form below.';
  if (locale === 'es') return '¡Gracias por su consulta! Puede abrir la demo en vivo o dejar una solicitud en el formulario.';
  return 'Спасибо за вопрос! Откройте живое демо или оставьте заявку в форме на странице — мы всё подскажем.';
}

const aiUnavailable = () => new AppError(503, 'ai_unavailable', 'AI assistant is temporarily unavailable');

interface OpenAiPayload {
  choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown } }>;
}

const extractText = (raw: unknown): string => (typeof raw === 'string' ? sanitizeAssistantOutput(raw) : '');
const sseLine = (data: string): Uint8Array => new TextEncoder().encode(`data: ${data}\n\n`);

function toCleanSseStream(
  body: ReadableStream<Uint8Array>,
  onComplete?: (fullReply: string) => void | Promise<void>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = '';
  let sentDone = false;
  let fullReply = '';
  let completed = false;

  const finish = () => {
    if (completed) return;
    completed = true;
    const text = fullReply.trim();
    if (text && onComplete) void Promise.resolve(onComplete(text)).catch(() => {});
  };

  const processLine = (line: string, ctrl: ReadableStreamDefaultController<Uint8Array>): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    if (payload === '[DONE]') {
      if (!sentDone) {
        ctrl.enqueue(sseLine('[DONE]'));
        sentDone = true;
      }
      return true;
    }
    try {
      const parsed = JSON.parse(payload) as OpenAiPayload;
      const delta = extractText(parsed.choices?.[0]?.delta?.content);
      if (!delta) return false;
      fullReply += delta;
      ctrl.enqueue(sseLine(JSON.stringify({ delta })));
      return true;
    } catch {
      return false;
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      let emitted = false;
      while (!emitted) {
        const { done, value } = await reader.read();
        if (done) {
          buf += decoder.decode();
          for (const line of buf.split(/\r?\n/)) processLine(line, ctrl);
          if (!sentDone) ctrl.enqueue(sseLine('[DONE]'));
          finish();
          ctrl.close();
          return;
        }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (processLine(line, ctrl)) emitted = true;
        }
        if (sentDone) {
          await reader.cancel().catch(() => {});
          finish();
          ctrl.close();
          return;
        }
      }
    },
    cancel() {
      finish();
      return reader.cancel().catch(() => {});
    },
  });
}

export type LandingFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function callLandingLlm(
  cfg: LandingAiConfig,
  locale: LandingLocale,
  messages: LandingChatMessage[],
  stream: true,
  fetchFn?: LandingFetch,
  onComplete?: (fullReply: string) => void | Promise<void>,
  style?: LandingChatStyle,
): Promise<ReadableStream<Uint8Array>>;
export async function callLandingLlm(
  cfg: LandingAiConfig,
  locale: LandingLocale,
  messages: LandingChatMessage[],
  stream: false,
  fetchFn?: LandingFetch,
  onComplete?: (fullReply: string) => void | Promise<void>,
  style?: LandingChatStyle,
): Promise<{ reply: string }>;
export async function callLandingLlm(
  cfg: LandingAiConfig,
  locale: LandingLocale,
  messages: LandingChatMessage[],
  stream: boolean,
  fetchFn?: LandingFetch,
  onComplete?: (fullReply: string) => void | Promise<void>,
  style?: LandingChatStyle,
): Promise<ReadableStream<Uint8Array> | { reply: string }>;
export async function callLandingLlm(
  cfg: LandingAiConfig,
  locale: LandingLocale,
  messages: LandingChatMessage[],
  stream: boolean,
  fetchFn: LandingFetch = fetch,
  onComplete?: (fullReply: string) => void | Promise<void>,
  style?: LandingChatStyle,
): Promise<ReadableStream<Uint8Array> | { reply: string }> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(locale, style) },
          ...messages.map(m => ({ role: m.role, content: sanitizeUserText(m.content) })),
        ],
        temperature: 0.3,
        max_tokens: cfg.maxTokens,
        stream,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch {
    throw aiUnavailable();
  }

  if (!res.ok) throw aiUnavailable();

  if (stream) {
    if (!res.body) throw aiUnavailable();
    return toCleanSseStream(res.body, onComplete);
  }

  let data: OpenAiPayload;
  try {
    data = (await res.json()) as OpenAiPayload;
  } catch {
    throw aiUnavailable();
  }
  const reply = extractText(data.choices?.[0]?.message?.content).trim();
  if (!reply) throw aiUnavailable();
  if (onComplete) void Promise.resolve(onComplete(reply)).catch(() => {});
  return { reply };
}

/** Сохраняет пару «вопрос пользователя → ответ ИИ» в ai_chat_sessions (upsert по sessionId) */
export async function saveLandingChatTurn(
  sql: Sql,
  entry: {
    workspaceId: string;
    sessionId?: string;
    botName?: string;
    visitorName?: string | null;
    ip: string;
    userAgent?: string | null;
    locale: LandingLocale;
    pageUrl?: string | null;
    userMessage: string;
    assistantReply: string;
    askedAt: string;
  },
): Promise<void> {
  if (!entry.workspaceId || !isUuid(entry.workspaceId)) return;
  const id = entry.sessionId ?? crypto.randomUUID();
  const cleanVisitor = entry.visitorName ? sanitizeUserText(entry.visitorName).slice(0, 80) : null;
  const appended: LandingChatLogMessage[] = [
    { role: 'user', content: sanitizeUserText(entry.userMessage), ts: entry.askedAt },
    { role: 'assistant', content: sanitizeAssistantOutput(entry.assistantReply).trim(), ts: new Date().toISOString() },
  ];
  const appendedJson = JSON.stringify(appended);
  await withContext(sql, { workspaceId: entry.workspaceId }, async db => {
    await db
      .insert(aiChatSessions)
      .values({
        id,
        workspaceId: entry.workspaceId,
        botName: entry.botName ?? 'landing',
        visitorName: cleanVisitor,
        ip: entry.ip,
        userAgent: entry.userAgent?.slice(0, 500) ?? null,
        locale: entry.locale,
        pageUrl: entry.pageUrl?.slice(0, 300) ?? null,
        messages: appended,
        messageCount: appended.length,
      })
      .onConflictDoUpdate({
        target: aiChatSessions.id,
        set: {
          ip: entry.ip,
          visitorName: cleanVisitor ?? aiChatSessions.visitorName,
          locale: entry.locale,
          pageUrl: entry.pageUrl ? entry.pageUrl.slice(0, 300) : aiChatSessions.pageUrl,
          messages: dsql`${aiChatSessions.messages} || ${appendedJson}::jsonb`,
          messageCount: dsql`${aiChatSessions.messageCount} + ${appended.length}`,
          updatedAt: dsql`now()`,
        },
      });
  });
}
