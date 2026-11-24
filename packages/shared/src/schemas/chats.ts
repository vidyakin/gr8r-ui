/* zod-схемы встроенного мультиязычного чата с автопереводом: языки, чаты, гостевые ссылки, сообщения и обратная связь. */
import { z } from 'zod';

export const CHAT_LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'ar', label: 'العربية' },
  { code: 'kk', label: 'Қазақша' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'zh', label: '中文' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'pl', label: 'Polski' },
  { code: 'uk', label: 'Українська' },
  { code: 'hi', label: 'हिन्दी' },
] as const;

export const CHAT_LANGUAGE_CODES = [
  'ru', 'en', 'es', 'ar', 'kk', 'de', 'fr', 'zh',
  'tr', 'pt', 'it', 'ja', 'ko', 'pl', 'uk', 'hi',
] as const;

export const CHAT_KINDS = ['direct', 'group', 'client'] as const;
export const CHAT_ENTITY_TYPES = ['lead', 'deal', 'company', 'project'] as const;
export const CHAT_TRANSLATION_STATUSES = ['pending', 'done', 'failed', 'none'] as const;
export const CHAT_MESSAGE_FEEDBACKS = ['like', 'dislike'] as const;

export const chatLanguageSchema = z.enum(CHAT_LANGUAGE_CODES);
export const chatKindSchema = z.enum(CHAT_KINDS);
export const chatEntityTypeSchema = z.enum(CHAT_ENTITY_TYPES);

export const chatCreateBody = z.object({
  kind: chatKindSchema,
  title: z.string().trim().max(200).optional(),
  memberIds: z.array(z.string().uuid()).max(100).optional(),
  entityType: chatEntityTypeSchema.nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  guestName: z.string().trim().max(120).nullable().optional(),
  guestLanguage: chatLanguageSchema.optional(),
  enableGuestLink: z.boolean().optional(),
});

export const chatPatchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  entityType: chatEntityTypeSchema.nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  guestName: z.string().trim().max(120).nullable().optional(),
  guestLanguage: chatLanguageSchema.optional(),
  preferredLanguage: chatLanguageSchema.optional(),
  memberIds: z.array(z.string().uuid()).max(100).optional(),
  archived: z.boolean().optional(),
});

export const chatGuestLinkBody = z.object({
  action: z.enum(['enable', 'rotate', 'revoke']),
  guestName: z.string().trim().max(120).nullable().optional(),
  guestLanguage: chatLanguageSchema.optional(),
});

export const chatMessageCreateBody = z.object({
  text: z.string().trim().min(1).max(10000),
  language: chatLanguageSchema.optional(),
});

export const chatMessageFeedbackBody = z.object({
  feedback: z.enum(['like', 'dislike', 'none']),
});

export const publicChatPatchBody = z.object({
  guestName: z.string().trim().min(1).max(120).optional(),
  guestLanguage: chatLanguageSchema.optional(),
});

export const publicChatMessageBody = z.object({
  text: z.string().trim().min(1).max(10000),
  guestName: z.string().trim().min(1).max(120).optional(),
  language: chatLanguageSchema.optional(),
});

export type ChatLanguageCode = (typeof CHAT_LANGUAGE_CODES)[number];
export type ChatKind = z.infer<typeof chatKindSchema>;
export type ChatEntityType = z.infer<typeof chatEntityTypeSchema>;
export type ChatTranslationStatus = (typeof CHAT_TRANSLATION_STATUSES)[number];
export type ChatMessageFeedback = (typeof CHAT_MESSAGE_FEEDBACKS)[number];
export type ChatCreateBody = z.infer<typeof chatCreateBody>;
export type ChatPatchBody = z.infer<typeof chatPatchBody>;
export type ChatGuestLinkBody = z.infer<typeof chatGuestLinkBody>;
export type ChatMessageCreateBody = z.infer<typeof chatMessageCreateBody>;
export type ChatMessageFeedbackBody = z.infer<typeof chatMessageFeedbackBody>;
export type PublicChatPatchBody = z.infer<typeof publicChatPatchBody>;
export type PublicChatMessageBody = z.infer<typeof publicChatMessageBody>;
