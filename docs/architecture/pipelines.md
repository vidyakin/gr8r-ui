# Воронки продаж (задача 1176)

Код: схема `packages/db/src/schema/pipelines.ts` (воронки, этапы, причины) и `schema/crm.ts` (`deals`, `deal_stage_history`), миграция `0056_deal_pipelines.sql`,
сервис `packages/db/src/pipelines.ts`, чистые правила `packages/shared/src/pipelines.ts`, схемы `packages/shared/src/schemas/pipelines.ts`,
API `apps/api/src/routes/pipelines.ts` и `routes/crm.ts` (сделки), узлы `packages/shared/src/automations/nodes/*deal*.ts`, проход воркера `apps/worker/src/deal-overdue.ts`,
интерфейс `apps/web/src/app/crm/` (`pipelines.ts`, `DealsPage`, `FunnelPage`, `overlays`) и `settings/deal-pipelines.tsx`. Тесты: `apps/api/test/pipelines.test.ts`, `packages/shared/test/pipelines.test.ts`.

Раньше у сделки был enum `deals.stage` (`lead … lost`). Теперь у сделки воронка и этап; механизм — как статусы лидов ([leads.md](leads.md)).

## Данные (миграция 0056)
Все таблицы арендатора: `workspace_id`, `unique(workspace_id, id)`, составные FK, `app_secure_tenant_table`.
- `deal_pipelines` — название (уникально без учёта регистра), `sort_order`, `is_default`. Частичный уникальный индекс: одна основная воронка на воркспейс.
- `deal_stages` — воронка, название (уникально в воронке), `color`, `sort_order`, `category` (`in_progress | won | lost`), `probability` (0–100, %), `required_fields` (jsonb-массив ключей), `sla_days` (норматив дней, null — без норматива).
  Частичный уникальный индекс: один этап `won` на воронку; «хотя бы один `lost` и один открытый» проверяет сервис (`assertPipelineValid`, при нарушении транзакция откатывается).
  Есть `unique(workspace_id, pipeline_id, id)`: на него ссылается сделка.
- `deal_lost_reasons` — справочник причин проигрыша.
- `deals` — вместо `stage`: `pipeline_id`, `stage_id`, `lost_reason_id`, `stage_entered_at`, `stage_overdue_notified_at`. Составной FK `(workspace_id, pipeline_id, stage_id) → deal_stages(workspace_id, pipeline_id, id)`: этап **не может** принадлежать чужой воронке даже при прямой записи в БД. Текст `lost_reason` остался комментарием.
- `deal_stage_history` — сделка, из/в воронку и этап, участник (null — автоматизация), время. Идентификаторы этапов без FK: запись переживает удаление этапа. Первая запись сделки (`from = null`) — вход при создании.

Миграция: у каждого воркспейса воронка «Sales» (основная) с шестью этапами из старого enum (`lead/qualified/proposal/negotiation` — `in_progress` с вероятностями 10/25/50/75, `won` 100, `lost` 0), сделки переносятся по индексу, `stage_entered_at = updated_at`, причины проигрыша заводятся из текстовых `lost_reason`, в историю пишется стартовая запись. Автоматизации «поле stage сделки изменилось на won/lost» (черновик `flows.graph` и версии `flow_versions`) переписываются на триггеры «Сделка выиграна / проиграна». Новый воркспейс получает воронку и причины в `initWorkspace` (`ensureDealPipeline`).

## Переход сделки
Одна точка входа — `planStageChange` (проверки и расчёт) + `recordStageChange` (история, заметка, событие). Её используют: PATCH/POST `/deals`, `moveDeal` (автоматизации), `insertDeal` (конвертация лида, демо).
- Вход: `stageId`, `pipelineId`, `lostReasonId`, `closedAt`. Только `stageId` — воронка этапа; только `pipelineId` — первый открытый этап воронки; оба — этап обязан принадлежать воронке (422 `deal_stage_pipeline_mismatch`). Не заданы при создании — основная воронка, первый этап.
- Обязательные поля этапа проверяются по значениям **после** изменения: поля из того же запроса учитываются (422 `deal_stage_required_fields`, `details.fields`). Ключи: `amount` (> 0), `closeDate`, `contact` (есть участники сделки), `source`, `custom:<ключ поля конструктора>`.
- Категория `lost`: нужна причина из справочника (422 `deal_lost_reason_required`; при повторном переходе между «проиграна» берётся прежняя). Категория `won`/`lost` ставит `closed_at` (по умолчанию сегодня), `in_progress` сбрасывает `closed_at` и причину. `sort_order` — в конец колонки. `stage_entered_at` обновляется, отметка просрочки сбрасывается.
- Побочные записи: строка истории, системная заметка в ленте сделки (`Stage changed: A → B (причина)`), событие `deal.stage_changed` с `payload.stage { fromId, fromCategory, toId, toCategory, toPipelineId … }` (его слушают триггеры; обычное `deal.updated` с изменениями полей пишет и общий `crud`).
- Конвертация лида ставит сделку на «квалифицирован» основной воронки: **второй открытый этап, а если он один — первый** (`qualifiedStageIndex`). Обязательные поля при конвертации не проверяются.
- Смена воронки в карточке переносит сделку на первый открытый этап новой воронки.

## Настройка
Читают все, пишут admin и owner. Этап нельзя удалить, пока на нём сделки (409 `deal_stage_in_use`); воронку — пока в ней сделки (409 `deal_pipeline_in_use`) или она основная (422 `deal_pipeline_default`); причину — пока она используется (409 `deal_lost_reason_in_use`). Нельзя оставить воронку без «выиграна» / «проиграна» / открытого этапа (422 `pipeline_stage_invariant`). Шаблоны при создании воронки (`PIPELINE_TEMPLATES`): `sale`, `service`, `repeat`.

## API
`/deal-pipelines` (список без пагинации, `POST` с `template` или `stages`, `PATCH` — название / `isDefault: true`, `DELETE`, `POST /reorder`), `/deal-stages` (CRUD, фильтр `pipelineId`, `POST /reorder {pipelineId, ids}`), `/deal-lost-reasons` (CRUD, `POST /reorder`), `GET /deals/:id/stage-history`, `GET /deal-funnel?pipelineId&from&to`. Фильтры `/deals`: `pipelineId`, `stageId`, `overdue=true|false`. События `deal_pipeline.*`, `deal_stage.*`, `deal_lost_reason.*`; клиент по ним (и по `deal.*`) обновляет ключ кэша `['ws', id, 'pipelines', …]`.

## Просрочка норматива
`deals.stage_entered_at + deal_stages.sla_days` меньше «сейчас» у открытой сделки. В списке это фильтр `overdue`, в канбане — красная метка на карточке. Проход воркера `runDealOverdueOnce` (раз в час вместе с биллингом) пишет событие `deal.stage_overdue` **один раз за вход в этап** (ставит `stage_overdue_notified_at` в той же транзакции; повторный вход в этап снова разрешает событие).

## Автоматизации
Триггеры (по одному файлу): `trigger.deal_stage_changed` (фильтры воронка / этап), `trigger.deal_won`, `trigger.deal_lost` (по категории этапа назначения, фильтр воронка), `trigger.deal_stage_overdue` (воронка / этап). Они читают `ev.payload.stage` события, а не изменения полей. Действие `action.move_deal` (порт `moveDeal` в `NodeRuntime`, реализация — `moveDealAction` воркера) переводит сделку тем же сервисом, обязательные поля проверяются как в API (ошибка шага); причина проигрыша — по названию из справочника. Поле `stage` убрано из полей сделки для «Обновить поле» (как статус лида). Демо-flow «Deal won → Kickoff» использует `trigger.deal_won`.

## Отчёт-воронка
`dealFunnel`: **когорта** — сделки воронки, созданные в периоде. По этапу: сколько сделок когорты сейчас на нём и их сумма; сколько «дошло» (побывало на этапе или на любом открытом этапе позже: прыжок через этап считается пройденным; по истории), конверсия к предыдущему открытому этапу (%), среднее время на этапе (по завершённым пребываниям и текущему), взвешенная сумма (сумма × вероятность этапа, только открытые). Суммы складываются как есть, без пересчёта валют. Вероятность этапа также взвешивает прогноз в плане продаж (`sales-plan.ts`, `weighted = сумма × probability / 100`) и дашборд CRM.

## Интерфейс
CRM → «Сделки»: выбор воронки над канбаном и таблицей (запоминается в браузере), фильтр «Просрочены», карточки с меткой нормативa. Перенос на этап открывает диалог, если нужен ввод: подтверждение победы, причина проигрыша, обязательные поля (значения уходят **тем же запросом**, что и смена этапа: `deal/move` несёт `patch`). Карточка сделки: поле «Воронка», вкладка «История этапов». CRM → «Воронка продаж» — отчёт. Settings → «Воронки продаж» (этапы, категории, цвет, вероятность, норматив, обязательные поля, порядок кнопками) и «Причины проигрыша». Реестр этапов для чистых выборок (`crm/stages.ts`) заполняет `CrmProvider` до отрисовки детей.

## Фактическая реализация
См. раздел «Фактическая реализация (задача 1176)» в `docs/plans/2026-10-21-unf-services.md`.
