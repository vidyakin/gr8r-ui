/* Фоновый автоперевод сообщений и доперевод истории при смене языка гостя. */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { chatMessages, recordEvent, withContext, type Sql } from '@erp/db';
import type { ChatTranslationStatus } from '@erp/shared';
import type { LandingAiConfig } from '../types';
import { loadRecentContext } from './messages';
import { translateMessage, type TranslateContextItem } from './translator';

export interface TranslateAndStoreParams {
  sql: Sql;
  workspaceId: string;
  chatId: string;
  messageId: string;
  originalText: string;
  originalLanguage: string;
  targetLanguages: string[];
  context?: TranslateContextItem[];
  aiConfig?: LandingAiConfig;
}

export interface BackfillMessage {
  id: string;
  originalText: string;
  originalLanguage: string;
}

const norm = (l: string) => l.trim().toLowerCase().split(/[-_]/)[0] ?? '';

export async function translateAndStoreMessage(params: TranslateAndStoreParams): Promise<void> {
  const src = norm(params.originalLanguage);
  const targets = [...new Set(params.targetLanguages.map(norm).filter(l => l && l !== src))];
  if (!targets.length) return;

  const context =
    params.context ??
    (await withContext(params.sql, { workspaceId: params.workspaceId }, db =>
      loadRecentContext(db, params.chatId, params.messageId),
    ));

  const results = await Promise.all(
    targets.map(async toLang => ({
      toLang,
      res: await translateMessage({ text: params.originalText, fromLang: src, toLang, context, config: params.aiConfig }),
    })),
  );

  const translations: Record<string, string> = {};
  let provider: string | null = null;
  for (const { toLang, res } of results) {
    if (res.status === 'done') {
      translations[toLang] = res.text;
      if (!provider && res.provider !== 'none') provider = res.provider;
    }
  }
  const hasAny = Object.keys(translations).length > 0;
  const status: ChatTranslationStatus = hasAny ? 'done' : 'failed';
  const patchJson = JSON.stringify(translations);

  await withContext(params.sql, { workspaceId: params.workspaceId }, async db => {
    const updated = await db
      .update(chatMessages)
      .set({
        translations: sql`coalesce(${chatMessages.translations}, '{}'::jsonb) || ${patchJson}::jsonb`,
        translationProvider: hasAny ? (provider ?? 'none') : sql`coalesce(${chatMessages.translationProvider}, 'none')`,
        translationStatus: hasAny
          ? 'done'
          : sql`case when ${chatMessages.translations} = '{}'::jsonb then 'failed' else ${chatMessages.translationStatus} end`,
      })
      .where(and(eq(chatMessages.id, params.messageId), eq(chatMessages.chatId, params.chatId), isNull(chatMessages.deletedAt)))
      .returning({ id: chatMessages.id });
    if (!updated.length) return;
    await recordEvent(db, {
      workspaceId: params.workspaceId,
      type: 'chat.translated',
      entity: 'chat',
      recordId: params.chatId,
      payload: { chatId: params.chatId, messageId: params.messageId, status, provider: provider ?? 'none', languages: Object.keys(translations) },
    });
  });
}

export function scheduleTranslation(params: TranslateAndStoreParams): void {
  setTimeout(() => {
    void translateAndStoreMessage(params).catch(err => console.error('[chats] translation failed:', err));
  }, 20);
}

export function scheduleBackfill(
  sqlClient: Sql,
  workspaceId: string,
  chatId: string,
  targetLang: string,
  items: BackfillMessage[],
  aiConfig?: LandingAiConfig,
): void {
  if (!items.length) return;
  setTimeout(() => {
    void Promise.all(
      items.map(m =>
        translateAndStoreMessage({
          sql: sqlClient,
          workspaceId,
          chatId,
          messageId: m.id,
          originalText: m.originalText,
          originalLanguage: m.originalLanguage,
          targetLanguages: [targetLang],
          aiConfig,
        }),
      ),
    ).catch(err => console.error('[chats] backfill translation failed:', err));
  }, 20);
}
