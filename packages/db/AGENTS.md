# packages/db — схема Drizzle, миграции, RLS, доменные сервисы

Правила: `docs/architecture/tenancy.md` (RLS, роли), `docs/architecture/data-conventions.md` (id, деньги, удаление),
предметные разделы — по оглавлению `docs/architecture.md`. Комментарий в шапке сервиса ссылается на свой раздел.

## Экспорты
- `@gr8r/db` (`src/index.ts`) — подключение, контекст, события, схема, сервисы.
- `@gr8r/db/schema` — только таблицы. `@gr8r/db/testing` — подготовка тестовой БД.

## Структура
- `src/schema/*.ts` — таблицы Drizzle по областям; `columns.ts` — общие колонки.
- `drizzle/NNNN_*.sql` + `drizzle/meta/` — SQL-миграции (последняя — смотри по номеру). `0002_rls.sql` — роли и функция `app_secure_tenant_table`.
- `src/context.ts` — `withContext(sql, { userId, workspaceId }, fn, role)`: транзакция, `SET LOCAL ROLE`, `app.user_id`/`app.workspace_id`.
- `src/events.ts` — `recordEvent` (outbox) и канал `EVENTS_CHANNEL`.
- `src/errors.ts` — `DomainError(status, code, message, details)`; API отдаёт его как есть.
- `src/*.ts` — доменные сервисы: `documents`, `stock`, `production*`, `cost-closing`, `piecework`, `work-orders`, `billing`, `automations`, `meta`…
- `src/seed*.ts` — демо-данные (по-русски); `src/cli/` — `migrate`, `seed`, `wipe`, `reset`.

## Как добавить таблицу
1. Описать в `src/schema/<область>.ts`, экспортировать из `schema/index.ts`.
2. `bun run db:generate` (из корня) — получить `drizzle/NNNN_*.sql`; дописать в конец миграции
   `SELECT app_secure_tenant_table('public.<таблица>'::regclass);` для каждой таблицы с `workspace_id`.
   Без этого падает тест покрытия RLS (`apps/api/test/tenancy.test.ts`).
3. Ссылки внутри арендатора — составные FK `(workspace_id, <id>)`, чтобы строка не сослалась на чужой воркспейс.
4. Первичный ключ — uuid v7 (`uuid_generate_v7()` по умолчанию, в коде `uuidv7()`).
5. `bun run db:migrate`, в dev удобнее `bun run db:reset`.

## Правила
- Все запросы приложения идут через `withContext` (или транзакцию из API) под `app_user`. Фильтр по `workspace_id` в запросах — дополнительный пояс.
- Изменение + аудит/активность + `recordEvent` — в одной транзакции.
- Деньги `numeric(18,2)`, количества `numeric(18,3)`, в коде — строки и `@gr8r/shared` decimal, без float.
- Проведение и правка документов с датой в закрытом периоде — `assertPeriodOpen` (422 `period_closed`, `src/cost-closing.ts`).
- Ошибка правила — `DomainError` с кодом; код добавить в словари ошибок фронтенда.
- DDL в рантайме — только задачи воркера через `DATABASE_URL_DDL`.

## Команды (из корня)
- `bun run db:generate | db:migrate | db:seed | db:wipe | db:reset`.
- Typecheck: `bun run --filter @gr8r/db typecheck`.
- Тесты: `bun test packages/db/test`. Большая часть проверок сервисов — тесты API в `apps/api/test`.
  `test/setup.ts` пересоздаёт `gr8r_test` на каждый запуск, рантайм ходит не суперпользователем (`gr8r_app`).

## Частые ошибки
- Таблица с `workspace_id` без `app_secure_tenant_table` — данные видны всем арендаторам.
- Простой FK на `id` вместо составного — можно сослаться на запись чужого арендатора.
- Правка уже применённой миграции вместо новой.
