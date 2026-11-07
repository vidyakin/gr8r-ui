# Модули задач

Реализовано на этапе 4а (сессия «УНФ: Производство»). Код: схема `packages/db/src/schema/work.ts` (миграция `0010_task_modules.sql`),
сервис модулей — `packages/db/src/modules.ts`, константы и схемы — `packages/shared/src/constants.ts` и `schemas/work.ts`,
API — `apps/api/src/routes/work.ts`, клиент — `apps/web/src/app/data/*`.

- **Модуль — вид задач.** `tasks.module` и `projects.module` — `general | production | services` (CHECK в БД, индекс по `(workspace_id, module)`).
  Существующие задачи и проекты — `general` (значение по умолчанию в миграции), поэтому старые экраны не меняются. Модуль задачи
  **наследуется от проекта**: задача модуля `production` лежит в проекте модуля `production`, иначе 422 `module_mismatch`.
  Перенос задачи в другой проект меняет её модуль и ключ (ключ задачи — `PROD-1`, `SERV-3`).
- **Системный проект на модуль.** В воркспейсе есть один проект на модуль: `Production` (ключ `PROD`) и `Services` (ключ `SERV`) —
  создаются при регистрации воркспейса и сиде, для существующих — миграцией; уникальность — частичный индекс
  `(workspace_id, module) WHERE module <> 'general'`. Ключ проекта уникален в воркспейсе, поэтому занятый ключ обходится суффиксом
  (`ensureModuleProject`). Пользовательские проекты всегда `general`: модуль проекта задаёт сервер.
- **Фильтр по модулю** — в списках задач, «Моих задачах», досках и сохранённых видах (поле фильтра `module` в `saved_views.filters`).
  Общие списки по всем проектам (Tasks, Calendar, Timeline) по умолчанию показывают только `general`: задачи модулей живут отдельно
  и видны там только с фильтром «Module» (`generalScope` в `apps/web/src/app/data/selectors.ts`). «Мои задачи» и страница проекта
  показывают модульные задачи всегда.
  В обычных проектах по умолчанию видны только задачи `general` — так и есть: модульные задачи лежат в своих проектах;
  в общих списках и «Моих задачах» они видны (фильтр по модулю — по желанию).
- **API:** `GET /tasks?module=`, `GET /projects?module=`. Поле `module` задачи — только для чтения в автоматизациях
  (`BUILTIN_FIELDS.task`, writable = false): сменить модуль можно только переносом задачи в проект другого модуля.

## Шаблоны проектов

Проект можно сохранить как шаблон и создать по нему новый. Код: схема `packages/db/src/schema/project-templates.ts` (миграция `0111_project_templates.sql`),
сервис `packages/db/src/project-templates.ts`, чистые правила и схемы — `packages/shared/src/project-templates.ts` и `schemas/project-templates.ts`,
API — `apps/api/src/routes/project-templates.ts` (`/project-templates`), экраны — `apps/web/src/app/settings/project-templates*.ts(x)`
и окна `overlays/project-dialogs.tsx` / `project-forms.tsx`. Тесты: `packages/shared/test/project-templates.test.ts`, `apps/api/test/project-templates.test.ts`.

- **Таблицы.** `project_templates` (название, описание, значок, цвет, `duration_days`, вехи `milestones` в днях, флаг `disabled`, уникальное
  имя без учёта регистра) и `project_template_tasks` (задача шаблона: статус, приоритет, `start_day`/`due_day`, план, `position_id`, метки,
  подзадачи-чек-лист в jsonb `subtasks` со сроками в днях). Обе — арендаторские (составные FK, RLS); `position_id` обнуляется при удалении
  должности (`ON DELETE SET NULL (position_id)`).
- **Относительные сроки.** «День N от старта»: день 1 — дата старта (`dayFromDate`/`dateFromDay`). Дата раньше старта сохраняется как день 1.
  При сохранении старт — `projects.start_date`, иначе самая ранняя дата задач, иначе сегодня. Срок проекта — `duration_days`.
- **Исполнители по должностям.** При сохранении исполнитель заменяется первой должностью участника (по порядку должностей); при создании
  проекта берётся первый активный участник с этой должностью (по дате добавления), иначе задача без исполнителя. Подзадачи — так же.
  Уведомления о назначении при создании из шаблона не рассылаются.
- **Что не переносится:** зависимости задач (`deps`), вложения, комментарии, учёт времени, заказчик, объект, вес. Выполненная задача
  (`done`) в шаблоне становится `todo`, подзадачи — не выполнены; статус, которого уже нет в воркспейсе, при создании тоже `todo`.
  Статусы глобальны для воркспейса (`statuses`), поэтому шаблон хранит ключ статуса, а не свой набор колонок. Разделов (секций) в проекте нет —
  их роль у вех (`milestones`).
- **API.** `GET /project-templates[?enabled=true]` (список со сводкой), `GET /:id` (с задачами), `POST /from-project {projectId, name, description?}`
  и `POST /:id/create-project {name, startDate, key?, description?, icon?, color?, teamId?, leadId?}` — роль member и выше;
  `PATCH /:id {name?, description?, disabled?}` и `DELETE /:id` — admin и owner. Создание из отключённого шаблона — 422 `template_disabled`.
  Проект, его участники, задачи, ключи задач (`issueTaskKey`), активность и события `project.created` / `task.created` пишутся в одной
  транзакции запроса. Ключ проекта не указан — строится из названия (`projectKeyFromName`).
- **Интерфейс.** Меню проекта «Сохранить как шаблон»; в «Новый проект» блок «Сохранённые шаблоны» (только включённые) и «Дата старта»;
  «Настройки → Шаблоны проектов» — список, переименование, «Отключить/Включить», удаление. Встроенные стартовые наборы (`TEMPLATES` в
  `project-dialogs.tsx`) остались как были: это локальные названия задач без сроков.
