/* Настройки тона и приветствия ИИ-консультанта лендинга (хранятся в workspaces.settings.aiChat). */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { isUuid, withContext, workspaces, type Sql } from '@erp/db';

export const AI_CHAT_TONES = ['friendly', 'formal', 'concise', 'sales'] as const;
export type AiChatTone = (typeof AI_CHAT_TONES)[number];

export interface AiChatSettings {
  tone: AiChatTone;
  customToneNote: string;
  greeting: { ru: string; en: string; es: string };
}

export const DEFAULT_AI_CHAT_SETTINGS: AiChatSettings = {
  tone: 'friendly',
  customToneNote: '',
  greeting: { ru: '', en: '', es: '' },
};

const noteField = z.string().trim().max(400).optional();

export const aiChatSettingsPatch = z.object({
  tone: z.enum(AI_CHAT_TONES).optional(),
  customToneNote: noteField,
  greeting: z
    .object({
      ru: noteField,
      en: noteField,
      es: noteField,
    })
    .optional(),
});

export type AiChatSettingsPatch = z.infer<typeof aiChatSettingsPatch>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cleanStr = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 400) : '');

/** Безопасно извлекает настройки ИИ-чата из workspaces.settings с подстановкой значений по умолчанию */
export function extractAiChatSettings(rawSettings: Record<string, unknown> | null | undefined): AiChatSettings {
  const raw = isRecord(rawSettings) && isRecord(rawSettings.aiChat) ? rawSettings.aiChat : {};
  const tone = typeof raw.tone === 'string' && (AI_CHAT_TONES as readonly string[]).includes(raw.tone)
    ? (raw.tone as AiChatTone)
    : DEFAULT_AI_CHAT_SETTINGS.tone;
  const g = isRecord(raw.greeting) ? raw.greeting : {};
  return {
    tone,
    customToneNote: cleanStr(raw.customToneNote),
    greeting: {
      ru: cleanStr(g.ru),
      en: cleanStr(g.en),
      es: cleanStr(g.es),
    },
  };
}

/** Применяет частичный патч поверх текущих настроек ИИ-чата */
export function mergeAiChatSettings(current: AiChatSettings, patch: AiChatSettingsPatch): AiChatSettings {
  return {
    tone: patch.tone ?? current.tone,
    customToneNote: patch.customToneNote ?? current.customToneNote,
    greeting: {
      ru: patch.greeting?.ru ?? current.greeting.ru,
      en: patch.greeting?.en ?? current.greeting.en,
      es: patch.greeting?.es ?? current.greeting.es,
    },
  };
}

/** Читает настройки ИИ-чата воркспейса в контексте RLS (или возвращает значения по умолчанию) */
export async function readWorkspaceAiChatSettings(sql: Sql, workspaceId: string): Promise<AiChatSettings> {
  if (!workspaceId || !isUuid(workspaceId)) {
    return { ...DEFAULT_AI_CHAT_SETTINGS, greeting: { ...DEFAULT_AI_CHAT_SETTINGS.greeting } };
  }
  return withContext(sql, { workspaceId }, async db => {
    const [row] = await db
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return extractAiChatSettings(row?.settings);
  });
}
