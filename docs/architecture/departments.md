# Подразделения (оргструктура)

Код: `packages/db/src/departments.ts`, `packages/shared/src/departments.ts`, `packages/shared/src/schemas/departments.ts`, `apps/api/src/routes/departments.ts`,
`apps/web/src/app/departments/`, `apps/web/src/app/settings/departments.tsx`, демо — `packages/db/src/seed-departments.ts`.

## Данные (миграция 0124)
- `departments` — `name` (уникально в воркспейсе без учёта регистра, `departments_ws_name_uq` по `lower(name)`), `parent_id` (своя таблица,
  ON DELETE RESTRICT), `head_member_id` (участник, ON DELETE SET NULL (`head_member_id`)), `sort_order`, `archived_at`, `created_at`, `updated_at`.
- `department_members` — `department_id` (ON DELETE CASCADE), `member_id` (ON DELETE CASCADE). У участника не больше одного подразделения:
  уникальный индекс `(workspace_id, member_id)`.
- Обе таблицы под RLS (`app_secure_tenant_table`), ссылки составные `(workspace_id, id)`. Номер 0124: 0123 занят согласованием.

## Правила сервиса
- Справочник читают все, правят admin и owner (`requireRole('admin')` в маршрутах).
- Цикл в дереве запрещён: родитель не может быть самим подразделением или его потомком — 422 `department_cycle`.
- Удалить можно только пустое подразделение: есть дочерние или сотрудники — 409 `department_in_use`.
- Родитель, руководитель или подразделение из чужого воркспейса — 422 `invalid_reference` (RLS их не видит).
- `PATCH`: непришедшее поле не меняется, `null` очищает (`parentId: null` — на верхний уровень).
- События: `department.created/updated/deleted`; смена подразделения участника — `member.updated` (`changes: ['department']`).

## API
- `GET /departments` — `{ items }` с `memberIds`, порядок `sortOrder`, название.
- `POST /departments`, `PATCH /departments/:id`, `DELETE /departments/:id` — admin+.
- `PUT /departments/by-member/:memberId` `{ departmentId: string | null }` — admin+, заменяет прежнее подразделение, `null` убирает.
- `GET /departments/head-of/:memberId` — `{ memberId, departmentId, headMemberId }`.

## Руководитель подразделения сотрудника
`departmentHeadOf(memberId, departments, memberships)` (shared, без БД): берём подразделение сотрудника; если у него есть руководитель и это
не сам сотрудник — он; иначе поднимаемся к родителю; дошли до корня — `null`. Защита от испорченного дерева с циклом. Руководитель не обязан
состоять в своём подразделении. Основа будущего правила согласования «согласует руководитель подразделения инициатора».

## Интерфейс
«Настройки» → «Подразделения» (`settings/nav.ts`, пункт `departments`, модуль core): дерево с отступами (`departmentTree`), в строке —
руководитель и число сотрудников. Диалог: название, родитель (без себя и потомков — `selfAndDescendants`), руководитель, состав
(добавить из участников — сотрудник уходит из прежнего подразделения; убрать). Кэш `['ws', id, 'departments']`, инвалидация по событиям
`department` и `member.*` (`app/data/realtime.ts`).

## Фактическая реализация
- БД и shared, API с тестами (`apps/api/test/departments.test.ts`: права, цикл, удаление, состав, head-of, изоляция арендаторов;
  `packages/shared/test/departments.test.ts`: дерево из 3 уровней).
- Экран разделён: `DepartmentsView` получает данные пропсами и рендерится в тесте через `react-dom/server`
  (`DepartmentsView.test.tsx`); `useLocale` для этого получил снимок серверного рендера.
- Демо: «Руководство» (руководитель — владелец) → «Продажи» (руководитель — менеджер), «Производство» (руководитель — рабочий цеха),
  «Бухгалтерия»; сотрудники разнесены по порядку `seedPositions`.
- Не сделано: подразделение в карточке участника и в списке участников, архивирование (`archived_at` есть, в интерфейсе и API не используется),
  правило согласования по руководителю.
