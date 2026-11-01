/* Сборка мусора вложений (задача 1191, docs/architecture/attachments.md): раз в час удаляет из S3 объекты вложений,
   архивных дольше ATTACHMENT_RETENTION_DAYS, и осиротевшие ключи незавершённых загрузок. Без настроенного хранилища ничего не делает. */
import { collectAttachmentGarbage, getFileStore, withContext, type Sql } from '@gr8r/db';

/** Число удалённых объектов за проход */
export async function runAttachmentGcOnce(sql: Sql): Promise<number> {
  const store = getFileStore();
  if (!store) return 0;
  const res = await withContext(sql, {}, db => collectAttachmentGarbage(db, store), 'app_worker');
  return res.archivedObjects + res.orphanObjects;
}
