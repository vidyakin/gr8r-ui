# apps/web — фронтенд (React 19 + Vite + Tailwind v4 + Radix)

Правила: `docs/architecture/frontend-server.md` (данные, кэш, realtime), `docs/architecture/i18n.md` (переводы),
`docs/architecture/second-sidebar.md` (навигация). Компоненты и тема — README, «Компоненты», «Тема».

## Точки входа
- `src/main.tsx` — `QueryClientProvider`, `SessionProvider`, `RouterProvider`.
- `src/app/router.tsx` — маршруты; `src/app/routes.ts` — `SECTIONS`, единый список разделов (навигация, крошки, заголовок).
- Алиас `@/…` → `apps/web/src`.

## Структура `src/`
- `app/<модуль>/` — экраны по областям: `production`, `docs` (документы и склад), `catalog`, `crm`, `automations`, `meta`, `settings`, `pages`, `overlays`, `layout`.
  Данные модуля — `data.ts` / `*-data.ts` рядом с экранами (хуки TanStack Query).
- `app/data/` — общий слой: `api.ts` (клиент `@gr8r/api/client` на воркспейс, разбор ошибок), `realtime.ts` (WebSocket и инвалидация кэша),
  `store.tsx` + `engine.ts` (состояние задач и проектов: reducer, оптимистичная запись в кэш, отправка разницы в API), `session.tsx`.
- `components/ui/` — базовый кит (button, dialog, select, menu, floating-window…), экспорт через `index.ts`.
- `components/gr8r/` — составные: `data-table`, `entity-drawer`, `filter-bar`, `kanban`, `panel`, `task`.
- `i18n/` — `t()`, `useT()`, словари `en/*` (источник ключей) и `ru/*`, форматтеры `format.ts`.

## Правила
- Сначала искать готовое в `components/ui` и `components/gr8r`, не дублировать.
- Все тексты — `t('ns.key')`. Новый ключ — в `i18n/en/<ns>.ts` и обязательно в `i18n/ru/<ns>.ts` (иначе ошибка типов).
  Даты, числа, деньги — `fmtNumber`, `fmtCurrency`, `fmtDateTime`… из `i18n/format.ts`, не `toFixed` и не `toLocaleString`.
  Значения `input`, CSV и печать форматтерами не форматируются.
- Серверные данные — только через TanStack Query, ключи `['ws', workspaceId, …]`. Новая сущность — добавить её событие
  в инвалидацию `app/data/realtime.ts`, иначе другие вкладки не увидят изменений.
- Суммы документа считать `computeDocument` из `@gr8r/shared`, деньги — `decimal.ts`, без float.
- В браузере хранятся только настройки вида (тема, плотность, свёрнутый сайдбар, окна).
- Ошибки API показываются по коду (`errors.*` в словаре).
- Изменил экран или поведение — обнови статью в `docs/user/` (поле `sources` её шапки ищет файлы экрана) и `verified` (`bun run docs:verify <файл>`) в том же коммите. Новый раздел в `SECTIONS` — статья или запись в `docs/user/pending.json`, иначе падает `i18n/docs-coverage.test.ts`. Формат — `docs/user/README.md`.

## Команды
- Typecheck: `bun run --filter @gr8r/web typecheck`; сборка `bun run build`.
- Тесты из корня: `bun test apps/web/src/i18n/i18n.test.ts`, `bun test apps/web/src/lib`, покрытие справки `bun test apps/web/src/i18n/docs-coverage.test.ts` (тесты корня поднимают тестовую БД — задай `TEST_ADMIN_DATABASE_URL` на кластер `./scripts/pgtest.sh`, имя `*_test`).
- Запуск: `bun run dev` из корня (api + worker + web), вход `demo@gr8r.dev` / `demo1234`.

## Частые ошибки
- Строка в JSX без `t()` или ключ только в `en`.
- Свой форматтер числа через `toFixed` вместо `i18n/format.ts`.
- Новый раздел добавлен в роутер, но не в `SECTIONS` — нет в навигации и крошках.
- Экран изменён, а статья в `docs/user/` и её `verified` нет — `bun run docs:check` покажет её устаревшей.
