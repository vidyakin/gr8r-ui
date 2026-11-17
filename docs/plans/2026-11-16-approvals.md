# Согласование по маршрутам — план реализации (задача 1199)

> **Дата:** 2026-11-16. **Решения:** раздел «Задача 1199» в `docs/plans/2026-10-29-docflow.md` (опрос 2026-10-29), подтверждены
> 2026-11-16: маршруты — отдельный справочник-форма, автоматизации только реагируют на итог (вариант «маршрут как граф
> автоматизации» отклонён). Пункты **«по умолчанию»** — решения плана там, где опрос молчит; их можно поправить.

**Цель:** документ или договор уходит на согласование по маршруту (этапы, участники или должности, срок); обязательный
маршрут не даёт провести документ или отметить договор подписанным, пока процесс не согласован; входящие «Мне на
согласование», лист согласования, уведомления и просрочка.

**Связанные разделы:** `docs/architecture/documents.md`, `payments.md` (заявки на расход, `STATE_PROVIDERS`),
`contracts.md`, `positions.md` (должности, 1172), `automations.md`, `licensing.md` (модуль `docflow`), `tenancy.md`.

## Что уже есть и от чего зависим

| Что | Состояние |
|---|---|
| Проведение | `postDocument` (`packages/db/src/documents.ts:982`) зовут 55 мест: HTTP `POST /documents/:id/post` (`apps/api/src/routes/documents.ts:542`), а также биллинг, банковская выписка, закрытие месяца, запись на приём, рейсы, сиды, предпросмотр движений (`stock-preview.ts`, откат в savepoint) |
| Заявка на расход | Проведение = подача; `pending → approved → paid / rejected`, согласует admin+ (`STATE_PROVIDERS.payment_request`, `DOCUMENT_HOOKS.payment_request` в `payment-requests.ts`) |
| Договор | Флажок `contracts.is_signed`, меняется `PATCH /contracts/:id` |
| Должности | `positions`, `member_positions` (1172) |
| Уведомления | `notifications.type` — `mention | assign | comment | update`, ссылки только на задачу, проект, объект |
| Простая ЭП (1197), внутренние документы (1198) | **Не сделаны.** v1 без подписи решения; внутренние документы — тоже `documents`, войдут без доработки, когда появятся |

## Решения плана

1. **К чему применяется:** учётные документы (`target_kind = document` + `document_type`) и договоры (`contract`).
   Условие маршрута — организация (необязательно) и сумма `documents.total` от / до; у договора сумма не учитывается.
2. **Выбор маршрута** (**по умолчанию**): подходящие неархивные маршруты по `sort_order`, берётся первый. Пользователь
   маршрут не выбирает. Нет подходящего — согласование не требуется, кнопка «Отправить на согласование» скрыта.
3. **Снимок маршрута:** при отправке этапы и участники копируются в `approvals.snapshot`; должность раскрывается в
   держателей на этот момент. Должность без держателей — 422 `route_step_empty`. Правка маршрута идущие процессы не меняет.
4. **Режимы этапа:** `sequential` — участники по очереди; `parallel` — всем сразу, нужны все решения. Участник-должность —
   одна задача на всех держателей, решает первый, остальным задачи закрываются (`skipped`). Отказ любого — процесс
   `rejected`. Решение `comment` процесс не двигает.
5. **Круги:** после отказа автор правит и отправляет заново — новая строка `approvals` с `round + 1`; история кругов видна.
   Отозвать процесс может автор или admin+ (`cancelled`).
6. **Изменение после согласования** (**по умолчанию**): при отправке и при итоговом «согласовано» сохраняется отпечаток
   документа (`fingerprint`: дата, организация, контрагент, договор, сумма, хеш строк `document_lines` и `payment_lines`).
   Проверка при проведении сравнивает отпечаток: изменён — 422 `approval_outdated`, нужен новый круг. Так не трогаем
   21 файл с правками черновиков (`not_draft`), а правку в любом из них всё равно ловим. Во время процесса правка не
   запрещена, панель предупреждает «документ изменён после отправки».
7. **Где проверка «без согласования нельзя»:** в HTTP-проведении `POST /documents/:id/post` и в `PATCH /contracts/:id`
   (`isSigned: false → true`), а не внутри `postDocument`. Системные проведения (биллинг, выписка, закрытие месяца,
   запись на приём, рейсы, сиды, предпросмотр) создают документы сами и маршрутом не останавливаются. При реализации
   grep-нуть остальные HTTP-пути, которые проводят документы по кнопке пользователя (`POST …/post` в `routes/*.ts`), и
   решить по каждому в таблице «Фактической реализации».
8. **Заявка на расход:** если маршрут подходит — проведение (подача) запускает процесс (хук `afterPost`), ручные
   «Согласовать / Отклонить» admin+ закрыты (`canTransition` → `approval_in_progress`), итог процесса ставит
   `documents.state` `approved / rejected`. Снятие с проведения отзывает процесс. Без маршрута — как сейчас.
9. **Срок:** `due_hours` этапа → `due_at` задачи при её активации. Проход воркера раз в минуту: просроченная задача —
   уведомление согласующему и автору один раз (`overdue_notified_at`) и событие `approval.step_overdue`.
10. **Модуль:** всё под модулем `docflow`. Без модуля маршрутов нет, проверка ничего не блокирует, заявки как сейчас.
11. **Самосогласование** (**по умолчанию**): автор, стоящий в маршруте, согласует свой этап сам — запрета нет.

## Данные (миграция 0123, все таблицы под RLS `app_secure_tenant_table`, ссылки составные `(workspace_id, id)`)

- `approval_routes` — название, `target_kind`, `document_type`, `organization_id`, `amount_from`, `amount_to`,
  `required`, `sort_order`, `archived_at`.
- `approval_route_steps` — `route_id`, `sort_order`, название, `mode sequential | parallel`, `due_hours`.
- `approval_route_participants` — `step_id`, `sort_order`, `member_id` или `position_id` (CHECK: ровно одно).
- `approvals` — `target_kind`, `document_id` / `contract_id` (CHECK: ровно одно), `route_id`, `route_name`, `round`,
  `state in_progress | approved | rejected | cancelled`, `snapshot jsonb`, `current_step`, `fingerprint`, `author_id`,
  `started_at`, `finished_at`, `cancel_reason`. Частичный уникальный индекс: один `in_progress` на объект.
- `approval_tasks` — `approval_id`, `step_index`, `seq` (очередь в последовательном этапе), `group_key` (держатели одной
  должности), `member_id`, `state waiting | pending | done | skipped`, `decision approve | reject | comment`, `comment`,
  `decided_at`, `due_at`, `overdue_notified_at`.
- `notifications`: тип `approval`, колонка `approval_id` (уведомление открывает объект согласования).

## Инкременты (каждый — свой коммит с тестами)

1. **БД и сервис** — схема Drizzle + миграция 0123 (сверить FK и `ON DELETE` со схемой, `packages/db/test/fk-set-null.test.ts`),
   `packages/db/src/approvals.ts`: `matchRoute`, `startApproval`, `decide` (строка `approvals` под `FOR UPDATE`),
   `cancelApproval`, `fingerprintOf`, `assertApproved`, `scanOverdue`. Тесты: последовательный и параллельный этап;
   должность — решает первый держатель; отказ и новый круг; отпечаток ловит правку строки; **два держателя должности
   решают одновременно — одно решение засчитано**; RLS — чужой арендатор не видит маршрут и процесс.
2. **shared и API** — zod-схемы и константы в `packages/shared`; `/approval-routes` (чтение — все, правка — admin+),
   `POST /approvals` (отправить), `GET /approvals?box=mine|sent|all`, `GET /approvals/by-object`,
   `POST /approval-tasks/:id/decide`, `POST /approvals/:id/cancel`; проверка в `POST /documents/:id/post` и
   `PATCH /contracts/:id`; хуки заявки на расход. Печатная форма листа согласования — чистая функция в
   `packages/shared/src/print`. Тесты API, плюс **существующие сценарии зелёные**: проведение без маршрутов, заявка на
   расход без маршрута, автопроведение биллинга при обязательном маршруте на реализацию не блокируется.
3. **Воркер и автоматизации** — `apps/worker/src/approval-overdue.ts` в цикле `index.ts`; события `approval.completed`,
   `approval.step_overdue` в outbox; узлы-триггеры «Согласование завершено» (фильтр согласовано / отклонено) и «Этап
   просрочен», действие «Отправить на согласование» (новый порт `submitApproval` в `NodeRuntime` и
   `apps/worker/src/flows/records.ts`). Тесты узлов с подставными портами и прохода просрочки.
4. **Интерфейс** — настройки «Маршруты согласования» (admin+, редактор этапов и участников); раздел «Документооборот →
   Согласования»: вкладки «Мне на согласование», «Отправленные», «Все» (admin+); вкладка «Согласование» в карточке
   документа и договора: состояние, текущий этап, задачи, кнопки «Отправить», «Согласовать», «Отклонить» с комментарием,
   «Отозвать», круги, печать листа; заявка на расход показывает процесс вместо ручных кнопок. Просрочка — «Просрочено на
   N ч» красным. Тексты через `t()` (`en/*` + `ru/*`), даты через `i18n/format.ts`. Рендер-тест вкладки с данными.
5. **Документация** — `docs/architecture/approvals.md` и строка в оглавлении `docs/architecture.md`; «Фактическая
   реализация» в разделе 1199 плана документооборота; статья в `docs/user/` + `bun run docs:verify`; демо-сид: маршрут
   «Заказ поставщику от 100 000 ₽» (руководитель → бухгалтерия) и один процесс в работе.

## Готово, когда

Последовательный и параллельный маршрут проходят; должность согласует первый держатель; обязательный маршрут блокирует
проведение и «подписан» (`approval_required`, `approval_outdated`); заявка на расход согласуется маршрутом и по-старому
без него; лист печатается; просрочка уведомляет один раз; `bun run typecheck`, `bun run docs:check`, тесты затронутых
пакетов зелёные; чек-лист «Перед пушем» из `docs/lessons.md` пройден.

## Не входит

Подпись решения простой ЭП (после 1197); условия маршрута сложнее «организация + сумма»; замещение отпуска и
делегирование; согласование задач, сделок и КП (не учётные документы); эскалация на руководителя (нет оргструктуры).

## Фактическая реализация (инкременты 1–2)

Сделано: миграция `0123_approvals.sql` (5 таблиц под RLS, `notifications.approval_id`, тип уведомления `approval`), сервис `packages/db/src/approvals.ts`,
`packages/shared/src/approvals.ts` (константы, `routeMatches`, `pickRoute`, `overdueHours`), `schemas/approvals.ts`, печатная форма `print/approval-sheet.ts`,
API `apps/api/src/routes/approvals.ts`. Тесты: `packages/db/test/approvals.test.ts` (в том числе конкурентное решение двух держателей и RLS),
`packages/shared/test/approvals.test.ts`, `apps/api/test/approvals.test.ts`.

### API
- `GET/POST /approval-routes`, `GET/PATCH/DELETE /approval-routes/:id` (DELETE = архив), `POST /approval-routes/:id/restore`; правка — admin и выше.
- `POST /approvals {targetKind, documentId|contractId}` → 201, процесс; `GET /approvals?box=mine|sent|all&state&targetKind&limit&offset` (`all` — admin);
  `GET /approvals/by-object?targetKind&documentId|contractId` → `{ enabled, gate, route, canStart, current, rounds[] }`; `GET /approvals/:id`;
  `GET /approvals/:id/print` (HTML листа); `POST /approvals/:id/cancel {reason}`; `POST /approval-tasks/:id/decide {decision, comment}`.
- Ворота `gate`: `not_required | required | in_progress | approved | outdated`. Ошибки: `approval_required`, `approval_outdated`, `approval_in_progress`
  (все 422), `route_step_empty` (422), `route_not_found` (422), `approval_not_applicable` (422, заявку на расход отправляют проведением),
  `approval_not_in_progress` / `task_not_pending` (409), `comment_required` (422).
- События (outbox): `approval.started`, `approval.decided`, `approval.completed` (`payload.result` = approved | rejected), `approval.cancelled`,
  `approval.step_overdue`, `approval_route.created|updated`.

### Пункт 7: HTTP-пути, проводящие документ по кнопке пользователя
| Путь | Решение |
|---|---|
| `POST /documents/:id/post` | проверка `assertApproved`; заявка на расход (`payment_request`) пропускается — её проведение само запускает процесс (хук `afterPost`) |
| `PATCH /contracts/:id` (`isSigned: false → true`) и `POST /contracts` с `isSigned: true` | проверка `assertApproved` (создание сразу подписанным закрыто тоже) |
| `POST /sales-plan/plans/:id/post` (admin) | не проверяется: плановый документ, не учётный |
| `POST /appointments/day-documents/:id/post` | не проверяется: «Оказанные услуги за день» собирает запись на приём |
| `POST /fleet/repairs/:id/post` | не проверяется: ремонт автопарка, внутренний |
| `POST /production-closing…/:id/post` (2 пути) | не проверяются: закрытие периода, системные документы |
| `POST /production/needs/post` | не проверяется: потребности производства |
| `POST /payments`, `/payments/from-document` | создают черновики; проведение — общий `POST /documents/:id/post` с проверкой |
Системные проведения (биллинг, выписка, закрытие месяца, запись на приём, рейсы, сиды, предпросмотр) не затронуты — проверка не в `postDocument`.

### Отклонения от плана и решения
- `required` у маршрута по умолчанию `true`; маршрут с `required = false` подбирается и допускает отправку, но проведение не блокирует.
- Подбор маршрута — в JS по всем неархивным маршрутам вида (`pickRoute`), порядок `sort_order, created_at`.
- Строки `approval_tasks` — по одной на сотрудника; держатели должности делят `group_key`, первый решивший закрывает остальных (`skipped`). Решение `comment`
  кладётся в `approval_tasks.notes`, задача остаётся `pending`.
- Решает только исполнитель задачи (admin за другого не решает); отзыв — автор или admin и выше.
- `fingerprint` (при отправке) и `approved_fingerprint` (при итоговом «согласовано») — раздельные колонки; правка во время процесса не блокируется,
  `changedSinceSubmit` в карточке процесса сообщает об изменении. Проверка при проведении сравнивает текущий отпечаток с `approved_fingerprint` последнего круга.
- Заявка на расход: если подходящий маршрут есть, но на этапе нет согласующих — проведение заявки откатывается с 422 `route_step_empty`. Отзыв процесса
  (`/approvals/:id/cancel`) оставляет заявку в `pending`, после чего admin согласует её вручную.
- В `StateProvider` добавлен `assertTransition` (асинхронная проверка перехода) — по нему закрыты ручные «Согласовать / Отклонить» заявки при идущем процессе.
- Уведомления: тип `approval`, `notifications.approval_id`; в интерфейсе добавлен значок в `InboxPage` и поле `approval` в `Notification` (минимум для typecheck).
- `isTokenPostingRequest` (токены агентов) теперь считает `…/decide` проводящим запросом (нужен `can_post`); три новых корня добавлены в `TOKEN_PATH_SECTIONS`.
- `docs/architecture/approvals.md`, раздел меню, настройки, узлы автоматизаций и демо-сид — инкременты 3–5.
- Тест `packages/db/test/db.test.ts` (счёт статей затрат демо: 22 вместо 21) падает на счёте статей затрат демо (22 вместо 21); к задаче 1199 не относится (статьи затрат не менялись), на чистой `dev` отдельно не перепроверялся.

## Фактическая реализация (инкременты 3–4)

Подробности — `docs/architecture/approvals.md`.

### Инкремент 3. Воркер и автоматизации
- `apps/worker/src/approval-overdue.ts` (`runApprovalOverdueOnce`) раз в минуту в `index.ts`. Идёт под `app_user` по воркспейсам с `docflow`: под `app_worker`
  `scanOverdue` не ограничен арендатором и обработал бы воркспейсы без модуля.
- Узлы `trigger.approval_completed` (фильтры: итог, вид объекта), `trigger.approval_step_overdue`, `action.submit_approval`; все в `nodes` модуля `docflow`.
  Порт `submitApproval` в `NodeRuntime` (проверка `docflowOn`, автор процесса — автор flow). В `startRunsForEvent` пропущена сущность `approval`
  (`SYSTEM_TABLES.approval` — для `trigger.record`).
- Не сделано: защита «цепочки flow» для `approval.*` (события согласования не несут метку `via`; зацикливание требует решения человека на каждом круге).

### Инкремент 4. Интерфейс
- Настройки «Маршруты согласования», раздел «Документооборот → Согласования» (новая группа меню `docflow`), вкладка «Согласование» в документе,
  раздел в окне договора, блок в заявке на расход; уведомление `approval` открывает объект; просрочка красным («Просрочено на N ч»).
- В ответ процесса (`approvalDetail`) добавлено `documentType` — по нему уведомление различает заявку на расход.
- Отклонения от задания: договор открывается как диалог на странице «Договоры», поэтому уведомление ведёт на `/contracts?open=<id>`; типы документов в
  редакторе маршрута — фиксированный список учётных (`ROUTE_DOC_TYPES`).
- Рендер-тест: `apps/web/src/app/approvals/approval-body.test.tsx` (статический рендер с подменой `useT`), логика редактора — `routes-settings.test.ts`.
- Пользовательская статья — `docs/user/docflow/approvals.md`.
- Демо: `seed-approvals.ts`; в `packages/db/test/db.test.ts` обновлены числа документов (84), должностей (6) и назначений (9).
