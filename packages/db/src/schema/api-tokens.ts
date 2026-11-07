/* Токены доступа агентов (задача 1285, docs/architecture/agent-tokens.md). Таблица арендатора: workspace_id + RLS,
   составные FK на members (workspace_id, id). Хранится только sha256 токена; prefix — первые 12 символов для показа в списке. */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts } from './columns';
import { members } from './people';
import { wsCol } from './tenant';

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** members.id — чей токен (действует от имени этого сотрудника) */
    memberId: uuid('member_id').notNull(),
    /** members.id выпустившего (null — участник удалён) */
    createdBy: uuid('created_by'),
    name: text('name').notNull(),
    /** sha256 (hex) полного токена; сам токен не хранится */
    tokenHash: text('token_hash').notNull(),
    /** Первые 12 символов токена для показа в списке (gr8r_ab12cd3) */
    prefix: text('prefix').notNull(),
    readOnly: boolean('read_only').notNull().default(true),
    /** null = все разделы сотрудника; иначе подмножество POSITION_SECTIONS */
    sections: text('sections').array(),
    /** Право проводить, оплачивать, удалять (инструменты MCP) */
    canPost: boolean('can_post').notNull().default(false),
    expiresAt: ts('expires_at'),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  t => [
    unique('api_tokens_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('api_tokens_token_hash_uq').on(t.tokenHash),
    check('api_tokens_name_chk', sql`char_length(${t.name}) between 1 and 120`),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'api_tokens_member_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.createdBy], foreignColumns: [members.workspaceId, members.id], name: 'api_tokens_created_by_fk' }).onDelete('set null'),
    index('api_tokens_ws_member_idx').on(t.workspaceId, t.memberId),
  ],
);
