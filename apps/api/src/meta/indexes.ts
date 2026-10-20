/* Индексы по выражению для полей с флагом filterable. CREATE INDEX CONCURRENTLY не работает внутри транзакции, а запрос
   арендатора идёт в транзакции, поэтому индекс строится ПОСЛЕ её коммита (хуки afterCommit в middleware tenant) на отдельном
   соединении и не блокирует запись. Построение идёт в фоне: ответ API не ждёт индекса, ошибка пишется в лог (индекс —
   оптимизация, фильтры работают и без него). */
import { createFieldIndex, dropFieldIndex, type IndexTarget, type Sql } from '@gr8r/db';
import type { Context } from 'hono';
import type { AppEnv } from '../types';

const pending = new Set<Promise<unknown>>();

/** Запускает обслуживающую задачу в фоне и запоминает её (тесты дожидаются через settleMaintenance) */
export function runMaintenance(task: () => Promise<unknown>) {
  const p: Promise<unknown> = task()
    .catch(e => console.error('[meta] index maintenance failed:', e))
    .finally(() => pending.delete(p));
  pending.add(p);
}

export const settleMaintenance = async () => {
  while (pending.size) await Promise.all([...pending]);
};

/** Построить индекс поля после коммита запроса */
export const buildIndexAfterCommit = (c: Context<AppEnv>, t: IndexTarget) => {
  const sql: Sql = c.get('sql');
  c.get('afterCommit').push(() => createFieldIndex(sql, t));
};

/** Убрать индекс поля после коммита запроса */
export const dropIndexAfterCommit = (c: Context<AppEnv>, fieldId: string) => {
  const sql: Sql = c.get('sql');
  c.get('afterCommit').push(() => dropFieldIndex(sql, fieldId));
};
