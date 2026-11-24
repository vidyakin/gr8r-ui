/* Встроенный мультиязычный чат с автопереводом: чаты, участники и сообщения. Таблицы арендатора: workspace_id + RLS. */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { CHAT_ENTITY_TYPES, CHAT_KINDS, CHAT_MESSAGE_FEEDBACKS, CHAT_TRANSLATION_STATUSES } from '@erp/shared';
import { archivedAt, createdAt, pk, ts, updatedAt } from './columns';
import { members } from './people';
import { wsCol } from './tenant';

export const chats = pgTable(
  'chats',
  {
    id: pk(),
    workspaceId: wsCol(),
    kind: text('kind', { enum: CHAT_KINDS }).notNull().default('group'),
    title: text('title').notNull().default(''),
    entityType: text('entity_type', { enum: CHAT_ENTITY_TYPES }),
    entityId: uuid('entity_id'),
    guestToken: text('guest_token'),
    guestName: text('guest_name'),
    guestLanguage: text('guest_language').notNull().default('en'),
    createdBy: uuid('created_by'),
    lastMessageAt: ts('last_message_at'),
    lastMessagePreview: text('last_message_preview'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('chats_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('chats_guest_token_uq').on(t.guestToken).where(sql`${t.guestToken} is not null`),
    index('chats_ws_last_msg_idx').on(t.workspaceId, t.lastMessageAt.desc().nullsLast(), t.createdAt.desc()),
    index('chats_ws_entity_idx').on(t.workspaceId, t.entityType, t.entityId),
    check('chats_kind_chk', sql`${t.kind} in ('direct','group','client')`),
    check('chats_entity_type_chk', sql`${t.entityType} is null or ${t.entityType} in ('lead','deal','company','project')`),
  ],
);

export const chatMembers = pgTable(
  'chat_members',
  {
    id: pk(),
    workspaceId: wsCol(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    preferredLanguage: text('preferred_language'),
    lastReadAt: ts('last_read_at'),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex('chat_members_chat_member_uq').on(t.chatId, t.memberId),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'chat_members_member_fk' }).onDelete('cascade'),
    index('chat_members_ws_member_idx').on(t.workspaceId, t.memberId),
    index('chat_members_ws_chat_idx').on(t.workspaceId, t.chatId),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: pk(),
    workspaceId: wsCol(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    senderMemberId: uuid('sender_member_id'),
    senderGuestName: text('sender_guest_name'),
    originalText: text('original_text').notNull(),
    originalLanguage: text('original_language'),
    translations: jsonb('translations').$type<Record<string, string>>().notNull().default({}),
    translationProvider: text('translation_provider'),
    translationStatus: text('translation_status', { enum: CHAT_TRANSLATION_STATUSES }).notNull().default('none'),
    feedback: text('feedback', { enum: CHAT_MESSAGE_FEEDBACKS }),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  t => [
    index('chat_messages_ws_chat_created_idx').on(t.workspaceId, t.chatId, t.createdAt),
    index('chat_messages_chat_created_idx').on(t.chatId, t.createdAt),
    check('chat_messages_translation_status_chk', sql`${t.translationStatus} in ('pending','done','failed','none')`),
    check('chat_messages_feedback_chk', sql`${t.feedback} is null or ${t.feedback} in ('like','dislike')`),
  ],
);
