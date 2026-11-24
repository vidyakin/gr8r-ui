/* Handoff из виджета сайта в модуль «Чаты» + генерация базы знаний с сайта клиента. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { aiChatSessions, chatMembers, chats, members, type Db, type Sql, withContext, workspaces } from '@erp/db';
import { insertChatMessage, loadRecentContext } from '../chats/messages';
import { resolveTargetLanguages, translateAndStoreMessage } from '../chats/service';
import { scrapeWebsite } from '../crm/website-scraper';
import type { LandingAiConfig } from '../types';
import { extractAiChatSettings, normalizeOrigin, type AiChatSettings } from './settings';

export function generateWidgetSecret(): string {
  return randomBytes(24).toString('base64url');
}

export function timingSafeTokenMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true; // non-browser / server-side probe without Origin header
  if (allowedOrigins.length === 0) return false;
  const norm = normalizeOrigin(origin);
  return norm !== null && allowedOrigins.includes(norm);
}

export interface ResolvedWidget {
  workspaceId: string;
  workspaceName: string;
  settings: AiChatSettings;
}

/** Проверяет токен виджета и возвращает настройки воркспейса (или null, если выключен / неверный) */
export async function resolveWidgetWorkspace(
  sql: Sql,
  workspaceId: string,
  secret: string,
): Promise<ResolvedWidget | null> {
  return withContext(sql, { workspaceId }, async db => {
    const [ws] = await db
      .select({ name: workspaces.name, settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws) return null;
    const settings = extractAiChatSettings(ws.settings);
    if (!settings.widgetEnabled || !settings.widgetSecret) return null;
    if (!timingSafeTokenMatch(settings.widgetSecret, secret)) return null;
    return { workspaceId, workspaceName: ws.name, settings };
  });
}

export interface WidgetHandoffInput {
  workspaceId: string;
  sessionId?: string;
  visitorName?: string;
  pageUrl?: string;
  locale: 'ru' | 'en' | 'es';
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Создаёт клиентский чат в модуле «Чаты», переносит контекст ИИ-переписки и возвращает guestToken */
export async function createWidgetHandoffChat(
  sql: Sql,
  ai: LandingAiConfig,
  input: WidgetHandoffInput,
): Promise<{ chatId: string; guestToken: string }> {
  const guestToken = randomBytes(24).toString('base64url');
  const guestName = input.visitorName?.trim().slice(0, 80) || null;
  const pageHost = (() => {
    if (!input.pageUrl) return '';
    try {
      return new URL(input.pageUrl).hostname;
    } catch {
      return '';
    }
  })();
  const title = guestName
    ? `${guestName}${pageHost ? ` (${pageHost})` : ''}`.slice(0, 120)
    : pageHost
      ? `Чат с сайта ${pageHost}`.slice(0, 120)
      : 'Чат с сайта';

  const result = await withContext(sql, { workspaceId: input.workspaceId }, async (db: Db) => {
    const [chat] = await db
      .insert(chats)
      .values({
        workspaceId: input.workspaceId,
        kind: 'client',
        title,
        guestToken,
        guestName,
        guestLanguage: input.locale,
      })
      .returning();

    const activeMembers = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.workspaceId, input.workspaceId))
      .limit(20);
    if (activeMembers.length > 0) {
      await db
        .insert(chatMembers)
        .values(activeMembers.map(m => ({ workspaceId: input.workspaceId, chatId: chat!.id, memberId: m.id })))
        .onConflictDoNothing();
    }

    // Формируем вводное сообщение с историей ИИ-диалога (из БД или тела запроса)
    let history = input.messages ?? [];
    if (input.sessionId) {
      const [sess] = await db
        .select({ messages: aiChatSessions.messages })
        .from(aiChatSessions)
        .where(eq(aiChatSessions.id, input.sessionId))
        .limit(1);
      if (sess?.messages?.length) {
        history = sess.messages.slice(-8).map(m => ({ role: m.role, content: m.content }));
      }
    }

    const summaryLines: string[] = [];
    if (input.pageUrl) summaryLines.push(`URL: ${input.pageUrl}`);
    if (history.length > 0) {
      summaryLines.push('--- История ИИ-чата ---');
      for (const m of history.slice(-6)) {
        const prefix = m.role === 'user' ? (guestName || 'Посетитель') : 'ИИ';
        summaryLines.push(`${prefix}: ${m.content.slice(0, 400)}`);
      }
    } else {
      summaryLines.push('Посетитель запросил подключение менеджера.');
    }

    const introText = summaryLines.join('\n').slice(0, 3500);
    const targetLanguages = await resolveTargetLanguages(db, input.workspaceId, chat!, input.locale);
    const msg = await insertChatMessage(db, {
      workspaceId: input.workspaceId,
      chatId: chat!.id,
      senderMemberId: null,
      senderGuestName: guestName || 'Посетитель сайта',
      text: introText,
      originalLanguage: input.locale,
      translationStatus: targetLanguages.length > 0 ? 'pending' : 'none',
      guestEvent: true,
    });
    const context = targetLanguages.length > 0 ? await loadRecentContext(db, chat!.id, msg.id) : [];

    return { chatId: chat!.id, guestToken, msgId: msg.id, introText, targetLanguages, context };
  });

  if (result.targetLanguages.length > 0 && ai.baseUrl && ai.apiKey) {
    void translateAndStoreMessage({
      sql,
      workspaceId: input.workspaceId,
      chatId: result.chatId,
      messageId: result.msgId,
      originalText: result.introText,
      originalLanguage: input.locale,
      targetLanguages: result.targetLanguages,
      context: result.context,
      aiConfig: ai,
    }).catch(() => {});
  }

  return { chatId: result.chatId, guestToken: result.guestToken };
}

/** Скрапит сайт клиента и форматирует структурированный черновик базы знаний по секциям */
export async function buildKnowledgeDraftFromWebsite(url: string, ai: LandingAiConfig): Promise<{ knowledgeBase: string; pagesScraped: number }> {
  const scraped = await scrapeWebsite(url);
  if (!scraped.ok) {
    throw new Error(scraped.reason);
  }
  const rawText = scraped.text.slice(0, 12_000);

  if (ai.baseUrl && ai.model && ai.apiKey && rawText.length > 80) {
    try {
      const res = await fetch(`${ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
        body: JSON.stringify({
          model: ai.model,
          temperature: 0.2,
          max_tokens: 2000,
          messages: [
            {
              role: 'system',
              content:
                'You extract a clean, factual company knowledge base from scraped website text for a customer support AI chatbot. ' +
                'Structure it using Markdown sections: "## О КОМПАНИИ", "## ПРОДУКТЫ И ЦЕНЫ", "## УСЛУГИ", "## ДОСТАВКА И ОПЛАТА", "## ЧАСТЫЕ ВОПРОСЫ", "## КОНТАКТЫ" (omit empty sections, reply in the same language as the website). ' +
                'Include ONLY facts present in the text; never invent prices or policies. Keep it concise, bulleted, and ready for an AI assistant.',
            },
            { role: 'user', content: rawText },
          ],
        }),
        signal: AbortSignal.timeout(Math.max(ai.timeoutMs, 25_000)),
      });
      if (res.ok) {
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
        const text = typeof json.choices?.[0]?.message?.content === 'string' ? json.choices[0].message.content.trim() : '';
        if (text) return { knowledgeBase: text.slice(0, 20_000), pagesScraped: scraped.pagesScraped };
      }
    } catch {
      // Fallback to raw structured text below
    }
  }

  const fallback = [
    '## О КОМПАНИИ',
    rawText.slice(0, 6000),
    '',
    '## ПРОДУКТЫ И ЦЕНЫ',
    '- (добавьте ключевые позиции и цены)',
    '',
    '## КОНТАКТЫ',
    `- Сайт: ${url}`,
  ].join('\n');
  return { knowledgeBase: fallback.slice(0, 20_000), pagesScraped: scraped.pagesScraped };
}
