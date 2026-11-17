# Согласование по маршрутам

Задача 1199, модуль `docflow`. План и решения — `docs/plans/2026-11-16-approvals.md`; здесь — как устроено. Документ или договор уходит на согласование
по маршруту (этапы, участники или должности, срок); обязательный маршрут не даёт провести документ или отметить договор подписанным, пока процесс
не согласован.

## Данные (миграция 0123, все таблицы под RLS)
- `approval_routes` → `approval_route_steps` → `approval_route_participants` (сотрудник или должность) — справочник маршрутов. Условие: вид объекта
  (`document` / `contract`), тип документа, организация, сумма от и до; `required`, `sort_order`, `archived_at` (маршрут не удаляется).
- `approvals` — процесс: `snapshot` маршрута на момент отправки (должность раскрыта в держателей), `round`, `state` (`in_progress | approved | rejected | cancelled`),
  `fingerprint` (при отправке) и `approved_fingerprint` (при итоговом «согласовано»). Один `in_progress` на объект (частичный уникальный индекс).
- `approval_tasks` — задача на сотрудника: `waiting | pending | done | skipped`, решение, комментарий, заметки, `due_at`, `overdue_notified_at`.
- `notifications.approval_id`, тип уведомления `approval`.

## Сервис `packages/db/src/approvals.ts`
`matchRoute` (первый подходящий неархивный по `sort_order`), `startApproval`, `decide` (строка `approvals` под `FOR UPDATE`; два держателя должности решают
одновременно — засчитывается одно решение), `cancelApproval`, `fingerprintOf`, `approvalGate` / `assertApproved`, `scanOverdue`, CRUD маршрутов,
представления `approvalDetail`, `approvalsOfObject`, `listApprovals`. Модуль `docflow` сервис не проверяет: это делают API, воркер и узел автоматизации
(`docflowOn`).

Ворота `gate`: `not_required | required | in_progress | approved | outdated`. Проверка «без согласования нельзя» — в `POST /documents/:id/post` и
`PATCH /contracts/:id` (`isSigned: false → true`), не в `postDocument`: системные проведения (биллинг, выписка, закрытие месяца) маршрутом не
останавливаются. Заявка на расход: проведение запускает процесс (хук `afterPost`), ручные «Согласовать / Отклонить» закрыты, итог процесса ставит
`documents.state`.

## API
`/approval-routes` (чтение — все, правка — admin+), `/approvals` (`POST` отправить; `GET ?box=mine|sent|all`; `/by-object`; `/:id`; `/:id/print`; `/:id/cancel`),
`/approval-tasks/:id/decide`. Ошибки: `approval_required`, `approval_outdated`, `approval_in_progress`, `route_step_empty`, `route_not_found`,
`approval_not_applicable`, `approval_not_in_progress`, `task_not_pending`, `comment_required`. Лист согласования — `renderApprovalSheet`
(`packages/shared/src/print/approval-sheet.ts`).

## Воркер и автоматизации
- `apps/worker/src/approval-overdue.ts` — раз в минуту в цикле `index.ts`: по каждому воркспейсу с модулем `docflow` зовёт `scanOverdue` под `app_user`
  с `app.workspace_id` (под `app_worker` сервис увидел бы все воркспейсы). Просроченная задача: уведомление согласующему и автору и событие
  `approval.step_overdue` один раз (отметка `overdue_notified_at`).
- События outbox: `approval.started | decided | completed (payload.result) | cancelled | step_overdue`. Сущность `approval` пропущена в `startRunsForEvent`
  (`flows/triggers.ts`) только для триггеров; для полей и «обновить поле» её нет. `trigger.record` — строка `approvals` (таблица в `SYSTEM_TABLES`, только чтение).
- Узлы модуля `docflow` (`licensing.ts`): `trigger.approval_completed` (итог any / approved / rejected, вид объекта; отозванный процесс не запускает),
  `trigger.approval_step_overdue`, `action.submit_approval` (порт `submitApproval` в `NodeRuntime`, реализация `flows/records.ts` поверх `startApproval`;
  автор процесса — автор flow). Тесты: `packages/shared/test/approval-nodes.test.ts`, `apps/worker/test/approval-overdue.test.ts`.

## Интерфейс (`apps/web/src/app/approvals`)
- `RoutesSettings.tsx` — Настройки → «Маршруты согласования» (admin+): список, архив, редактор условий, этапов и согласующих.
- `ApprovalsPage.tsx` — Документооборот → «Согласования»: «Мне на согласование», «Отправленные», «Все» (admin+).
- `approval-body.tsx` (представление, тест `approval-body.test.tsx`) и `ApprovalPanel.tsx` (запросы) — вкладка «Согласование» в документе, раздел в окне договора и
  блок в заявке на расход (там ручные кнопки скрыты, пока процесс идёт). Печать листа — HTML с сервера под `withPrintCsp`.
- Уведомление типа `approval` открывает объект (`useOpenApproval`: документ, `/money/requests/:id` или `/contracts?open=<id>`).
- Кэш `['ws', id, 'approvals', …]`; события `approval` и `approval_route` обновляют также `docs` и `billing` (`data/realtime.ts`).

## Демо
`packages/db/src/seed-approvals.ts`: должность «Бухгалтерия» (держатель — менеджер), маршрут «Заказ поставщику от 100 000 ₽» (руководитель → бухгалтерия) и
черновик заказа поставщику на сумму выше порога, отправленный на согласование.
