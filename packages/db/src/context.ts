/* Контекст выполнения запросов. ВСЕ запросы приложения идут через withContext: транзакция,
   `SET LOCAL ROLE app_user` (без BYPASSRLS) и настройки app.user_id / app.workspace_id, на которые смотрят политики RLS.
   SET LOCAL действует до конца транзакции, поэтому настройки не «протекают» между запросами через пул соединений. */
import { drizzleOf, type Db, type Sql, type Tx } from './client';

export interface DbContext {
  userId?: string | null;
  workspaceId?: string | null;
  /** Токен доступа агента: события запроса помечаются им (events.api_token_id, default из настройки) */
  apiTokenId?: string | null;
  /** Действие системы без пользователя (шаг автоматизации): закрытые проекты видны, изоляция воркспейса действует */
  system?: boolean;
}

/** Роль, под которой работает код приложения */
export type AppRole = 'app_user' | 'app_worker';

export async function setContext(tx: Tx, ctx: DbContext, role: AppRole = 'app_user'): Promise<void> {
  await tx.unsafe(`set local role ${role}`);
  // все настройки одним запросом: каждый лишний обмен с базой держит соединение пула дольше
  const pairs: [string, string][] = [];
  if (ctx.userId) pairs.push(['app.user_id', ctx.userId]);
  if (ctx.workspaceId) pairs.push(['app.workspace_id', ctx.workspaceId]);
  if (ctx.apiTokenId) pairs.push(['app.api_token_id', ctx.apiTokenId]);
  if (ctx.system) pairs.push(['app.system', 'on']);
  if (pairs.length) await tx.unsafe(`select ${pairs.map((_, i) => `set_config($${2 * i + 1}, $${2 * i + 2}, true)`).join(', ')}`, pairs.flat());
}

export async function withContext<T>(sql: Sql, ctx: DbContext, fn: (db: Db, tx: Tx) => Promise<T>, role: AppRole = 'app_user'): Promise<T> {
  return (await sql.begin(async tx => {
    await setContext(tx, ctx, role);
    return fn(drizzleOf(tx), tx);
  })) as T;
}
