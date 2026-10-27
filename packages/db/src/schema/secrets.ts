/* Хранилище секретов воркспейса (задача 1174а, docs/architecture/secrets.md): ключи интеграций и пароли каналов.
   В таблице лежит только шифртекст AES-256-GCM; открытое значение читает сервис `readSecret` (воркер/сервер), API его не отдаёт. */
import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './columns';
import { wsCol } from './tenant';

export const workspaceSecrets = pgTable(
  'workspace_secrets',
  {
    workspaceId: wsCol(),
    key: text('key').notNull(),
    /** `v1:` + base64(iv ‖ tag ‖ шифртекст); воркспейс и ключ входят в AAD */
    ciphertext: text('ciphertext').notNull(),
    /** members.id того, кто задал значение; без FK: удаление участника не должно трогать запись (как автор в журнале) */
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [primaryKey({ columns: [t.workspaceId, t.key], name: 'workspace_secrets_pk' })],
);
