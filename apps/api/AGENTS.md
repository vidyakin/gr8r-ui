# apps/api — HTTP API (Hono) + WebSocket

Предметные правила — в `docs/architecture.md` (оглавление разделов). Доступ и RLS — `docs/architecture/tenancy.md`,
соглашения по данным — `docs/architecture/data-conventions.md`, realtime — `docs/architecture/frontend-server.md`.

## Точки входа
- `src/index.ts` — запуск `Bun.serve`.
- `src/app.ts` — `createApp({ sql, config?, hub? })`: сборка приложения. Тесты поднимают его без порта.
- `src/client.ts` — типизированный клиент `createApiClient` (`@gr8r/api/client`) для фронтенда, типы из `AppType`.

## Структура `src/`
- `routes/*.ts` — маршруты по областям (`documents`, `production*`, `work-orders`, `billing`, `flows`, `work` — задачи и проекты…).
- `crud.ts` — фабрика `crud()` для типовых сущностей (список, сортировка, поиск, архив, события `*.created/updated/…`), `ctxOf(c)`, `validationHook`.
- `middleware.ts` — `requireSession`, `tenant()`, `requireRole(min)`, `hasRole`.
- `errors.ts` — `AppError`, `notFound`/`forbidden`/`badRequest`, перевод ошибок PostgreSQL в HTTP (`23505` → 409 `conflict` и т. д.).
- `meta/`, `catalog/` — проверка значений полей конструктора и характеристик товара.
- `auth.ts`, `workspaces.ts`, `workspaces-service.ts` — вход, сессии, воркспейсы, приглашения.
- `realtime.ts` — `Hub`: LISTEN `gr8r_events` → рассылка по сокетам воркспейса; `/ws?workspace=&since=`.

## Как добавить маршрут
1. Схемы запроса — в `packages/shared/src/schemas/*`. Логика с записью в БД — сервис в `packages/db/src/*.ts`, а не в маршруте.
2. Файл `src/routes/<область>.ts`: `new Hono<AppEnv>()`, `zValidator(..., validationHook)`, `ctxOf(c)`, запись — `requireRole('member')` или выше.
3. Подключить в `buildTenantApi()` в `src/app.ts` (`.route(...)`). Новый корневой путь — добавить в `TENANT_PATHS`, иначе он без сессии и арендатора.
4. Тест в `apps/api/test/<область>.test.ts` на помощниках `test/helpers.ts` (`Client` с cookie, `admin` — мимо RLS только для подготовки).

## Правила
- Обработчик работает в транзакции из `tenant()`: роль `app_user`, `app.workspace_id` выставлен, RLS действует. Используй `c.var.db`/`ctx.db`, свои соединения не открывай.
  Ответ со статусом ≥ 400 откатывает транзакцию.
- Фильтр по `workspace_id` в запросах — дополнительный пояс, не замена RLS.
- DDL в API запрещён: индексы полей конструктора ставятся задачей воркера (`enqueueFieldIndex`).
- Роли: owner > admin > member > guest. guest — только чтение. Себестоимость видят admin и owner (`canSeeCost`, `maskCost`).
- Деньги и количества в JSON — строками; арифметика — `@gr8r/shared` (`decimal.ts`).
- Ошибки — `{ error: { code, message, details?, requestId } }`; доменные ошибки сервисов (`DomainError` из `@gr8r/db`) проходят с их статусом и кодом.
  Коды переводит фронтенд (`errors.*` в i18n), поэтому новый код добавь в словари `apps/web/src/i18n/{en,ru}/errors.ts`.
- Изменение данных пишет событие (`recordEvent`) в той же транзакции — по нему работают realtime и автоматизации.
- Токен сессии — только httpOnly cookie `gr8r_session`, в теле ответов не отдаётся.

## Команды
- Typecheck: `bun run --filter @gr8r/api typecheck` (или `bun run typecheck` из корня).
- Тесты из корня: `bun test apps/api/test/<файл>.test.ts`. Нужен Postgres из `.env`; `test/setup.ts` пересоздаёт `gr8r_test`.
- Тесты изоляции: `tenancy.test.ts` (в том числе проверка, что у каждой таблицы с `workspace_id` есть RLS).

## Частые ошибки
- Забыли путь в `TENANT_PATHS` — маршрут отвечает 400 `workspace_required` или работает без контекста.
- Запрос через `admin`/суперпользователя в коде приложения — обходит RLS. Только в тестах.
- `zValidator` без `validationHook` — ответ не в общем формате 400.
