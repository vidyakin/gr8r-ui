/* Индексы по выражению для полей с флагом filterable. API сам DDL не выполняет (у его логин-роли нет прав владельца):
   он ставит задачу `index.create` / `index.drop` в таблицу jobs в той же транзакции, что и изменение поля, а воркер строит
   индекс (CREATE INDEX CONCURRENTLY) через отдельное подключение DATABASE_URL_DDL. Откат запроса отменяет и задачу.
   Индекс — оптимизация: пока он не построен, фильтры работают без него. */
import { enqueueFieldIndex } from '@gr8r/db';
import type { Ctx } from '../crud';

/** Построить индекс поля (воркер сверится с метаданными: поле должно быть filterable и не удалено) */
export const buildIndex = (ctx: Ctx, fieldId: string) => enqueueFieldIndex(ctx.db, ctx.workspaceId, 'create', fieldId);

/** Убрать индекс поля (воркер сверится с метаданными: поле не должно требовать индекса) */
export const dropIndex = (ctx: Ctx, fieldId: string) => enqueueFieldIndex(ctx.db, ctx.workspaceId, 'drop', fieldId);
