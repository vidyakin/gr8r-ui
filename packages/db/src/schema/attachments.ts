/* Вложения к любым объектам с версиями (docs/architecture/attachments.md).
   Привязка полиморфная (entity_type + entity_id), составного FK на объект нет: существование и права проверяет сервис по реестру типов.
   Содержимое — в S3-совместимом хранилище по ключу <workspace>/<attachment>/<version>. */
import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, pk } from './columns';
import { wsCol } from './people';

export const attachments = pgTable(
  'attachments',
  {
    id: pk(),
    workspaceId: wsCol(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['fig', 'pdf', 'zip', 'img', 'sheet', 'doc', 'code', 'other'] }).notNull().default('other'),
    /** Номер текущей версии */
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('attachments_ws_id_uq').on(t.workspaceId, t.id),
    index('attachments_entity_idx').on(t.workspaceId, t.entityType, t.entityId),
  ],
);

export const attachmentVersions = pgTable(
  'attachment_versions',
  {
    id: pk(),
    workspaceId: wsCol(),
    attachmentId: uuid('attachment_id').notNull(),
    version: integer('version').notNull(),
    /** null — метаданные перенесены из старой таблицы files, содержимого нет */
    storageKey: text('storage_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    mime: text('mime'),
    sha256: text('sha256'),
    comment: text('comment').notNull().default(''),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.attachmentId], foreignColumns: [attachments.workspaceId, attachments.id], name: 'attver_attachment_fk' }).onDelete('cascade'),
    unique('attver_attachment_version_uq').on(t.attachmentId, t.version),
    check('attver_size_chk', sql`${t.sizeBytes} >= 0`),
  ],
);
