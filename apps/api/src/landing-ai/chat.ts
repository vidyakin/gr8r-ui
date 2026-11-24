/* Валидация, санитизация, обращение к OpenAI-совместимому LLM и сохранение истории ИИ-консультанта лендинга. */
import { and, eq, sql as dsql } from 'drizzle-orm';
import { z } from 'zod';
import { aiChatSessions, isUuid, withContext, type LandingChatLogMessage, type Sql } from '@erp/db';
import { AppError } from '../errors';
import type { LandingAiConfig } from '../types';
import { buildSystemPrompt, type LandingLocale, type SalesScriptContext } from './knowledge';
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

const STAGE_DIRECTIVE_RE = /\[\[STAGE:([^|\]]+?)(?:\|([\s\S]*?))?\]\]/g;
const UNCLOSED_STAGE_RE = /\s*\[\[STAGE:[\s\S]*$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeExtractedRecord(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (count >= 20) break;
    const key = k.trim();
    if (!key || key.length > 60 || FORBIDDEN_KEYS.has(key)) continue;
    if (typeof v !== 'string') continue;
    const val = sanitizeUserText(v).slice(0, 200);
    if (!val) continue;
    out[key] = val;
    count++;
  }
  return out;
}

/** Извлекает и безопасно удаляет служебный тег перехода этапа `[[STAGE:nodeId|{...}]]` из ответа LLM */
export function parseStageDirective(
  raw: string,
  validNodeIds: Set<string>,
): { cleanText: string; nextNodeId: string | null; extracted: Record<string, string> } {
  let nextNodeId: string | null = null;
  let extracted: Record<string, string> = {};

  const matches = [...raw.matchAll(STAGE_DIRECTIVE_RE)];
  const last = matches[matches.length - 1];
  if (last) {
    const candidateId = last[1]?.trim() ?? '';
    if (candidateId && validNodeIds.has(candidateId)) {
      nextNodeId = candidateId;
    }
    const jsonPart = last[2]?.trim();
    if (jsonPart) {
      try {
        const parsed: unknown = JSON.parse(jsonPart);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          extracted = sanitizeExtractedRecord(parsed as Record<string, unknown>);
        }
      } catch {
        // Игнорируем невалидный JSON от модели
      }
    }
  }

  const cleanText = raw
    .replace(STAGE_DIRECTIVE_RE, '')
    .replace(UNCLOSED_STAGE_RE, '')
    .trim();

  return { cleanText, nextNodeId, extracted };
}

function splitStreamBuffer(pending: string): { emit: string; rest: string } {
  let emit = '';
  let cur = pending;
  while (cur.length > 0) {
    const dblIdx = cur.indexOf('[[');
    if (dblIdx === -1) {
      if (cur.endsWith('[')) {
        emit += cur.slice(0, -1);
        return { emit, rest: '[' };
      }
      return { emit: emit + cur, rest: '' };
    }
    if (dblIdx > 0) {
      emit += cur.slice(0, dblIdx);
      cur = cur.slice(dblIdx);
    }
    if (cur.startsWith('[[STAGE:') || '[[STAGE:'.startsWith(cur)) {
      return { emit, rest: cur };
    }
    emit += '[[';
    cur = cur.slice(2);
  }
  return { emit, rest: '' };
}

export function toCleanSseStream(
  body: ReadableStream<Uint8Array>,
  onComplete?: (fullReply: string) => void | Promise<void>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = '';
  let pending = '';
  let sentDone = false;
  let fullReply = '';
  let completed = false;

  const finish = () => {
    if (completed) return;
    completed = true;
    const text = fullReply.trim();
    if (text && onComplete) void Promise.resolve(onComplete(text)).catch(() => {});
  };

  const flushPending = (ctrl: ReadableStreamDefaultController<Uint8Array>) => {
    if (!pending) return;
    const cleaned = pending.replace(STAGE_DIRECTIVE_RE, '').replace(UNCLOSED_STAGE_RE, '');
    pending = '';
    if (cleaned) ctrl.enqueue(sseLine(JSON.stringify({ delta: cleaned })));
  };

  const processLine = (line: string, ctrl: ReadableStreamDefaultController<Uint8Array>): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    if (payload === '[DONE]') {
      flushPending(ctrl);
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
      pending += delta;
      const { emit, rest } = splitStreamBuffer(pending);
      pending = rest;
      if (!emit) return false;
      ctrl.enqueue(sseLine(JSON.stringify({ delta: emit })));
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
          flushPending(ctrl);
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
  scriptCtx?: SalesScriptContext,
  systemPromptOverride?: string,
): Promise<ReadableStream<Uint8Array>>;
export async function callLandingLlm(
  cfg: LandingAiConfig,
  locale: LandingLocale,
  messages: LandingChatMessage[],
  stream: false,
  fetchFn?: LandingFetch,
  onComplete?: (fullReply: string) => void | Promise<void>,
  style?: LandingChatStyle,
  scriptCtx?: SalesScriptContext,
  systemPromptOverride?: string,
): Promise<{ reply: string }>;
export async function callLandingLlm(
  cfg: LandingAiConfig,
  locale: LandingLocale,
  messages: LandingChatMessage[],
  stream: boolean,
  fetchFn?: LandingFetch,
  onComplete?: (fullReply: string) => void | Promise<void>,
  style?: LandingChatStyle,
  scriptCtx?: SalesScriptContext,
  systemPromptOverride?: string,
): Promise<ReadableStream<Uint8Array> | { reply: string }>;
export async function callLandingLlm(
  cfg: LandingAiConfig,
  locale: LandingLocale,
  messages: LandingChatMessage[],
  stream: boolean,
  fetchFn: LandingFetch = fetch,
  onComplete?: (fullReply: string) => void | Promise<void>,
  style?: LandingChatStyle,
  scriptCtx?: SalesScriptContext,
  systemPromptOverride?: string,
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
          { role: 'system', content: systemPromptOverride ?? buildSystemPrompt(locale, style, scriptCtx) },
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
  const rawReply = extractText(data.choices?.[0]?.message?.content).trim();
  if (!rawReply) throw aiUnavailable();
  if (onComplete) void Promise.resolve(onComplete(rawReply)).catch(() => {});
  const validIds = new Set(scriptCtx?.script.nodes.map(n => n.id) ?? []);
  const reply = scriptCtx?.script.enabled
    ? parseStageDirective(rawReply, validIds).cleanText || rawReply
    : rawReply;
  return { reply };
}

/** Читает текущий узел скрипта и собранные данные для сессии чата */
export async function readSessionScriptState(
  sql: Sql,
  workspaceId: string,
  sessionId: string,
): Promise<{ currentNodeId: string | null; collectedData: Record<string, string> }> {
  if (!workspaceId || !isUuid(workspaceId) || !sessionId || !isUuid(sessionId)) {
    return { currentNodeId: null, collectedData: {} };
  }
  return withContext(sql, { workspaceId }, async db => {
    const [row] = await db
      .select({
        currentNodeId: aiChatSessions.currentNodeId,
        collectedData: aiChatSessions.collectedData,
      })
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.workspaceId, workspaceId)))
      .limit(1);
    if (!row) return { currentNodeId: null, collectedData: {} };
    const collected =
      typeof row.collectedData === 'object' && row.collectedData !== null && !Array.isArray(row.collectedData)
        ? sanitizeExtractedRecord(row.collectedData)
        : {};
    return {
      currentNodeId: row.currentNodeId ?? null,
      collectedData: collected,
    };
  });
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
    currentNodeId?: string | null;
    collectedData?: Record<string, string>;
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
  const collected = entry.collectedData ? sanitizeExtractedRecord(entry.collectedData) : {};
  const collectedJson = JSON.stringify(collected);
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
        currentNodeId: entry.currentNodeId ?? null,
        collectedData: collected,
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
          ...(entry.currentNodeId ? { currentNodeId: entry.currentNodeId } : {}),
          collectedData: dsql`coalesce(${aiChatSessions.collectedData}, '{}'::jsonb) || ${collectedJson}::jsonb`,
          updatedAt: dsql`now()`,
        },
      });
  });
}
