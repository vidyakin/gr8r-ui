# Деплой на VPS и управление арендаторами

Статус: решения интервью приняты 2026-10-29, реализовано 2026-10-29 (см. «Фактическая реализация»).

## Решения интервью
- **Модель арендатора** — воркспейс в общей БД (RLS по `workspace_id`, как сейчас). Отдельные БД на клиента не делаем.
- **Кто создаёт** — CLI оператора и админка оператора в вебе. Самостоятельная регистрация (`/signup`) остаётся как есть.
- **Оператор** — флаг `users.is_operator`, выдаёт CLI `bun run operator:grant <email>` (и `operator:revoke`).
- **Демо-воркспейсы** — создаёт только оператор: владелец (email, пароль показывается один раз), срок жизни, по умолчанию 14 дней;
  воркер удаляет просроченные. Кнопки «Попробовать» для анонимов нет.
- **Бэкапы** — выгрузка арендатора в JSON-архив и загрузка обратно (в ту же или другую установку) + общий `pg_dump` по cron.
- **HTTPS** — Caddy в отдельном `docker-compose.prod.yml`, сертификат Let's Encrypt по переменной `DOMAIN`.

## Что уже есть (на 2026-10-29)
- `Dockerfile` (цели api, worker, migrate, web), `docker-compose.yml` (postgres, minio, migrate → api/worker, web на nginx),
  `migrate` создаёт роли `gr8r_app`/`gr8r_ddl`, сид по `SEED=1`. В облаке не проверялось.
- `apps/api/src/workspaces-service.ts` `createWorkspace` — пустой арендатор со справочниками по умолчанию.
- `packages/db/src/seed.ts` `seedDemoWorkspace(db, wsId, ownerUserId, userIds, inviteToken)` — генерирует свежие uuidv7,
  значит повторно применим к новому воркспейсу. Мешает: демо-участники требуют `users` с фиксированными email —
  для демо-арендатора создавать участников без `user_id` (кроме владельца).
- FK на `workspaces.id` — `on delete cascade` (`schema/core.ts`, `schema/tenant.ts`); проверить, что каскад покрывает все таблицы,
  и что `events` (только INSERT для `app_user`) удаляется под ролью воркера/админа.

## План реализации
1. **db**: миграция `0052` — `users.is_operator boolean default false`, `workspaces.kind ('regular'|'demo')`, `workspaces.expires_at`.
   Сервис `packages/db/src/tenants.ts`: `createTenant({name, ownerEmail, ownerName, password?, demo?, ttlDays?})`,
   `deleteTenant(id)`, `exportTenant(id) → JSON` (все таблицы с `workspace_id`, порядок по FK), `importTenant(json, {newIds?})`,
   `purgeExpiredDemos()`. Работает под `app_worker` (BYPASSRLS) или админ-подключением; список таблиц — из каталога
   (`information_schema.columns where column_name='workspace_id'`), порядок вставки — топосортировка FK.
2. **CLI** `packages/db/src/cli/tenant.ts`: `bun run tenant -- create|demo|list|delete|export|import`, `operator:grant|revoke`.
   На сервере: `docker compose run --rm migrate bun run tenant -- list`.
3. **worker**: задачи `tenant.create|delete|export` (API ставит в `jobs`, у API нет BYPASSRLS) и периодическая `tenant.purge_demos`.
4. **api**: `/admin/tenants` (только `is_operator`): список, создать, создать демо, удалить, выгрузить (ссылка на файл задачи).
5. **web**: экран «Арендаторы» для оператора, тексты через `t()` (en + ru).
6. **Деплой**: `docker-compose.prod.yml` (Caddy, без публикации портов БД/minio, обязательные `SECRETS_KEY`, пароли ролей),
   `.env.prod.example`, скрипт бэкапа `pg_dump` (cron), проверить `docker compose build` и запуск с нуля.
7. **Тесты** (только на `./scripts/pgtest.sh`, порт 5450): создание пустого и демо-арендатора, удаление не трогает чужие строки,
   export → delete → import восстанавливает данные, оператор/не-оператор на `/admin/tenants`, purge просроченных демо.
8. **Документы**: `docs/architecture/deploy.md` (+ строка в `docs/architecture.md`), README «Деплой».

## Фактическая реализация
- Миграция `0052_tenants`: `users.is_operator`, `workspaces.kind/expires_at/delete_requested_at`, `GRANT DELETE ON users TO app_worker`,
  функция `app_operator_tenants()` (SECURITY DEFINER, владелец `app_worker`).
- `packages/db/src/tenants.ts` — сервис; `initWorkspace` вынесен из API (`createWorkspace` и регистрация пользуются им),
  `seedDemoWorkspace` принимает имя, адрес и владельца. CLI — `packages/db/src/cli/tenant.ts` (`bun run tenant …`).
- Отклонения от плана: удаление из API — не задача `jobs` (строка задачи удалилась бы каскадом вместе с арендатором), а флаг
  `delete_requested_at`, который воркер разбирает раз в минуту вместе с просроченными демо (`purgeTenantsOnce`). Создание идёт прямо в API
  под `app_user` с контекстом нового арендатора, без воркера. Загрузка с новыми id (клон) не делалась: id лежат и внутри jsonb.
  Загрузка — только CLI. MinIO в прод-compose не включён (файлы пока в БД).
- API `/admin/tenants` (`apps/api/src/admin.ts`), экран «Настройки → Оператор → Арендаторы» (`apps/web/src/app/settings/tenants.tsx`).
- `docker-compose.prod.yml`, `docker/Caddyfile`, `.env.prod.example`, сервис `backup`. Документация — `docs/architecture/deploy.md`, README «Деплой».
- Тесты — `apps/api/test/tenants.test.ts`.
