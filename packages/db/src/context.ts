/* Контекст выполнения запросов. ВСЕ запросы приложения идут через withContext: транзакция,
   `SET LOCAL ROLE app_user` (без BYPASSRLS) и настройки app.user_id / app.workspace_id, на которые смотрят политики RLS.
   SET LOCAL действует до конца транзакции, поэтому настройки не «протекают» между запросами через пул соединений. */
import { drizzleOf, type Db, type Sql, type Tx } from './client';

export interface DbContext {
  userId?: string | null;
  workspaceId?: string | null;
  /** Действие системы без пользователя (шаг автоматизации): закрытые проекты видны, изоляция воркспейса действует */
  system?: boolean;
}

/** Роль, под которой работает код приложения */
export type AppRole = 'app_user' | 'app_worker';

export async function setContext(tx: Tx, ctx: DbContext, role: AppRole = 'app_user'): Promise<void> {
  await tx.unsafe(`set local role ${role}`);
  if (ctx.userId) await tx`select set_config('app.user_id', ${ctx.userId}, true)`;
  if (ctx.workspaceId) await tx`select set_config('app.workspace_id', ${ctx.workspaceId}, true)`;
  if (ctx.system) await tx`select set_config('app.system', 'on', true)`;
}

export async function withContext<T>(sql: Sql, ctx: DbContext, fn: (db: Db, tx: Tx) => Promise<T>, role: AppRole = 'app_user'): Promise<T> {
  return (await sql.begin(async tx => {
    await setContext(tx, ctx, role);
    return fn(drizzleOf(tx), tx);
  })) as T;
}
