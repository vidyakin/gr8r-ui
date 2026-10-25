# Стек

| Слой | Выбор |
| --- | --- |
| Рантайм | Bun (workspaces, `Bun.password`, `Bun.serve`, `bun test`) |
| HTTP | Hono (`hono/bun`), валидация `@hono/zod-validator`, типизированный клиент `hono/client` |
| БД | PostgreSQL 16, Drizzle ORM + drizzle-kit (миграции SQL в репозитории) |
| Схемы | Zod — общие для API и фронтенда (`packages/shared`) |
| Фронтенд | React 19 + Vite, TanStack Query для серверного состояния; клиент API — `@gr8r/api/client` (hono/client) |
| Реальное время | WebSocket (`upgradeWebSocket` из `hono/bun`), события по арендатору |
| Файлы | S3-совместимое хранилище (MinIO локально); пока PDF печатных форм лежат в БД (`document_files`), интерфейс `PdfStore` готов под S3 |
| Фоновые задачи | таблица `jobs` + воркер на `FOR UPDATE SKIP LOCKED` (без внешних брокеров) |
| Запуск | Docker Compose: postgres, minio, api, worker, web; тот же compose — на VPS |

## Монорепозиторий

```
apps/
  web/        фронтенд (бывший корневой src/, vite); алиас `@/…` → apps/web/src
  api/        HTTP API (Hono) + WebSocket
  worker/     фоновые задачи: outbox событий, очередь jobs (DDL по белому списку — индексы полей конструктора; PDF печатных форм в headless Chromium), движок автоматизаций (`src/flows`); позже — пересчёты
packages/
  shared/     доменные типы, zod-схемы API, константы (статусы, приоритеты 1–10, роли, ставки НДС, единицы ОКЕИ),
              демо-данные (`@gr8r/shared/demo`: их используют и фронтенд в локальном режиме, и сид БД)
  db/         drizzle-схема, SQL-миграции (`drizzle/`), RLS, uuid v7, сид, утилиты администрирования БД
docs/
test/         preload для `bun test` (тестовая БД пересоздаётся при каждом запуске)
scripts/      dev.ts (api + worker + web), smoke.ts (сквозной сценарий против запущенного API)
docker/       конфиги контейнеров (nginx для web)
Dockerfile    цели api, worker, migrate, web (oven/bun; web раздаёт nginx)
docker-compose.yml
```

Команды из корня: `bun install`, `bun run dev` (api + worker + web), `bun run build`, `bun run typecheck`, `bun test`,
`bun run db:generate | db:migrate | db:seed | db:wipe | db:reset`. Переменные окружения — `.env` по образцу `.env.example`
(пакеты читают корневой `.env`, поэтому скрипты работают из любой папки).
