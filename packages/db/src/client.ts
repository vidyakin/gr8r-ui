import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
export type Db = PostgresJsDatabase<typeof schema>;

/* drizzle-orm/postgres-js при создании мутирует client.options.parsers: отключает разбор дат в Date — драйвер отдаёт строки,
   а drizzle сам приводит их к нужному виду по типу колонки (date → 'YYYY-MM-DD', timestamptz → Date). Парсеры общие для всех
   соединений пула, поэтому достаточно один раз вызвать drizzle() на корневом клиенте при создании. */
export function createSql(url: string, opts: postgres.Options<Record<string, never>> = {}): Sql {
  const sql = postgres(url, { max: 10, onnotice: () => {}, ...opts }) as Sql;
  drizzle(sql, { schema });
  return sql;
}

/** drizzle поверх соединения или транзакции postgres.js (у TransactionSql нет options — подставляем заглушку для конструктора) */
export function drizzleOf(client: Sql | Tx): Db {
  const c = client as unknown as { options?: unknown };
  if (!c.options) c.options = { parsers: {}, serializers: {} };
  return drizzle(client as Sql, { schema });
}

export { schema };

/** Выделенное соединение LISTEN (postgres.js переподключается и подписывается заново). Возвращает функцию остановки */
export async function listenChannel(url: string, channel: string, onMessage: (payload: string) => void): Promise<() => Promise<void>> {
  const listener = postgres(url, { max: 1, onnotice: () => {}, idle_timeout: 0, connection: { application_name: 'gr8r-listener' } });
  const sub = await listener.listen(channel, onMessage);
  return async () => {
    await sub.unlisten();
    await listener.end({ timeout: 2 });
  };
}
