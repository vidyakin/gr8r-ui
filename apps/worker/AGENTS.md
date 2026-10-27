# apps/worker — очередь jobs, outbox событий, автоматизации, PDF

Правила: `docs/architecture/automations.md`, `docs/architecture/documents.md` (печатные формы),
`docs/architecture/billing.md`, `docs/architecture/month-closing.md`, `docs/architecture/metadata.md` (индексы полей).

## Точки входа
- `src/index.ts` — процесс: опрос `jobs` и `events` (`WORKER_POLL_MS`), ускорение по LISTEN `gr8r_events`, планировщик flow (`scheduleFlowsOnce`), биллинг (`runBillingOnce`).
- `src/worker.ts` — `processJobsOnce`, `processEventsOnce`, `requeueStale`, `defaultOptions`. Экспорт `@gr8r/worker`; тесты API вызывают `processJobsOnce` напрямую.
- `src/handlers.ts` — `jobHandlers` (реестр задач по типу) и `handleEvent`. Экспорт `@gr8r/worker/handlers`.

## Задачи `jobs`
`index.create`/`index.drop` (DDL индексов полей конструктора), `flow.run`, `document.pdf`, `billing.export_zip`,
`production.close_period`, `bank.sync` (загрузка операций банка по API), `yookassa.payment` (проверка платежа ЮКассы), `noop`.

## Структура `src/`
- `flows/` — движок автоматизаций: `engine.ts` (пошаговый запуск), `triggers.ts` (события и расписание → запуски), `records.ts` (действия над данными), `runtime.ts` (порты `NodeRuntime`), `http.ts` (исходящие запросы с защитой от SSRF).
- `pdf/` — `render.ts` (HTML → PDF в headless Chromium, без сети), `storage.ts` (`PdfStore`, сейчас в БД `document_files`), `zip.ts`.
- `billing.ts` — ежедневный биллинг по договорам; `production-closing.ts` — закрытие и отмена закрытия месяца.

## Как добавить задачу
1. Поставить в очередь из сервиса `packages/db` в транзакции изменения (по образцу `enqueueRun`, `enqueueFieldIndex`).
2. Обработчик — ключ в `jobHandlers` (`src/handlers.ts`); тяжёлую логику вынести в отдельный файл `src/*.ts`.
3. Обработчик должен быть идемпотентным: задача может выполниться повторно (повторы с backoff, возврат «зависших» через `staleAfterSec`).

## Как добавить узел автоматизации
Узел — один файл в `packages/shared/src/automations/nodes/` и строка в `nodes/index.ts` (см. README, «Автоматизации»). Воркер менять не нужно,
если узлу хватает портов `NodeRuntime`; новый порт — в `flows/runtime.ts`.

## Правила
- Выборка задач и событий — `FOR UPDATE SKIP LOCKED`: несколько воркеров работают параллельно.
- Цикл очереди ходит под `app_worker` (BYPASSRLS), потому что задачи относятся ко всем арендаторам. Работа с данными арендатора —
  под `app_user` с `app.workspace_id` (`withContext`), RLS действует: так устроены `flow.run` и `production.close_period`.
- DDL — только здесь и только через отдельное подключение `DATABASE_URL_DDL` (`h.ddl`). Без него DDL-задачи падают и повторяются.
- Шаг flow — одна транзакция: действие, журнал `flow_run_steps` и курсор запуска. Действие узла — под SAVEPOINT.
- Изменения от flow пишут событие с меткой `via`, чтобы flow не запускал сам себя.
- Chromium для PDF не ходит в сеть: только `data:` и `about:`.

## Команды
- Typecheck: `bun run --filter @gr8r/worker typecheck`.
- Тесты из корня: `bun test apps/worker/test`. Сквозные проверки задач — в `apps/api/test` (`flows`, `pdf`, `billing-export`, `production-closing`).

## Частые ошибки
- Данные арендатора читаются под `app_worker` без `app.workspace_id` — RLS не защищает, легко задеть чужой воркспейс.
- Неидемпотентный обработчик — при повторе создаёт дубли (биллинг защищён `billing_runs`, бери как образец).
