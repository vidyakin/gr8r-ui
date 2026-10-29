# Модули и тарифы

План и решения — `docs/plans/2026-10-29-licensing.md`. Оператор установки (`users.is_operator`, `deploy.md`) включает арендатору модули
через тариф и докупленные модули. Данные при отключении модуля не удаляются.

## Каталог (`packages/shared/src/licensing.ts`)
Модуль — запись в коде, не таблица: `id`, зависимости `requires`, корневые пути API (`paths`), публичные вебхуки (`hooks`), разделы меню (`sections`,
id из `SECTIONS`), пункты настроек (`settings`, id из `SET_NAV`), типы задач воркера (`jobs`) и типы узлов автоматизаций (`nodes`).
Модули: `core` (всегда), `crm`, `trade`, `production` (→ trade), `services` (→ trade), `money` (→ trade), `payroll` (→ money), `automations`,
`integrations` (→ money), `docflow` (пока пустой). Один путь, раздел, задача или узел принадлежит ровно одному модулю (иначе ошибка при загрузке модуля).

**Новый путь, раздел, задача или узел обязан попасть в каталог.** Это проверяют тесты: `apps/api/test/licensing.test.ts` (каждый путь `TENANT_PATHS`, тип задачи в
`jobHandlers` и узел `NODE_LIST`), `apps/web/src/app/licensing/modules.test.ts` (каждый ключ `SECTIONS`); путь в `TENANT_PATHS` без модуля роняет сборку приложения.
Справочники, на которые ссылаются разные модули (контрагенты, номенклатура, организации, склады, должности, конструктор сущностей), живут в `core`:
выключенный модуль не должен ломать включённый.

Чистые функции: `resolveModules(raw)` (ядро + перечисленные + зависимости; `*` — все), `enabledModules(license, now)` (тариф и доп. модули с действующим сроком),
`licenseView`, `moduleOfApiPath`, `moduleOfSectionPath`, `disabledModulesOfNodes`.

## Хранение (миграция `0057_licensing`)
- `license_plans` — справочник тарифов: `key`, `name`, `modules text[]`, `all_modules` («Полный», включает и будущие модули), `limits`, `trial_days`, `is_default` (не более одного).
- `workspace_licenses` (на арендатора) — `plan_id`, `plan_expires_at`, персональные `limits`, `updated_by`.
- `workspace_module_grants` — докупленные модули `(workspace_id, module)` со своим `expires_at`.
- Эффективный набор = `core` + модули тарифа (пока тариф не истёк) + доп. модули с действующим сроком + зависимости. Арендатор без строки в `workspace_licenses` получает тариф по
  умолчанию; нет и его — только ядро. Миграция выдала существующим арендаторам «Полный» без срока и завела «Базовый» (ядро, CRM, торговля).
- Права: таблицы принадлежат `app_owner`, `app_worker` читает и пишет. У `workspace_licenses` и `workspace_module_grants` есть `workspace_id`, поэтому для них включён RLS (FORCE) с политикой
  только SELECT своего арендатора; `license_plans` для `app_user` недоступна. Из выгрузки арендатора (`tenants.ts`, `SKIP_TABLES`) все три исключены: тарифы — данные установки.
- Запись — только `SECURITY DEFINER`-функции (владелец `app_worker`, проверка `users.is_operator` внутри `app_require_operator()`): `app_operator_plans`, `app_operator_save_plan`,
  `app_operator_delete_plan` (нельзя удалить тариф по умолчанию или назначенный арендаторам — 409 `plan_in_use`), `app_operator_license`, `app_operator_set_license`.
  Арендатор читает только `app_workspace_license()` по `app.workspace_id`; код воркера — `app_license_of(ws)`. Сервис — `packages/db/src/licensing.ts`.
- Любая смена лицензии или тарифа пишет в `events` событие `license.changed` (entity `license`) и шлёт `pg_notify` — функцией БД, мимо RLS арендатора.

## Запрет
| Где | Как |
|---|---|
| API | `requireModule(module)` после `tenant()` для каждого пути `TENANT_PATHS` (кроме ядра): 403 `module_disabled`, транзакция откатывается. Набор читается один раз на запрос (`modulesOf(c)`). |
| Вебхуки | `/hooks/leads` (crm), `/hooks/prices` (trade) — как несуществующая ссылка (404); `/hooks/yookassa` (integrations) — ответ прежний, платёж не обрабатывается. |
| Воркер, задачи | `runJob`: тип задачи → модуль (`MODULE_OF_JOB`); выключен — `failed` с `module_disabled` без повторов. |
| Воркер, расписания | биллинг и записи — `services`; касания и просрочка сделок — `crm`; опрос банков — `integrations`; flow по расписанию — `automations`. |
| Воркер, автоматизации | без `automations` события запусков не порождают; flow с узлом выключенного модуля — запуск `skipped` с причиной в журнале; движок перепроверяет модуль на каждом шаге. |
| Интерфейс | `useSectionAccess` (меню, вторая панель, палитра, `SectionGuard`) = должности И модули; `SettingsPage` скрывает пункты настроек. Набор — `GET /license` (ключ `['ws', id, 'license']`). |

## Оператор
Настройки → Оператор → «Тарифы и модули» (CRUD тарифов) и кнопка «Лицензия» у арендатора (тариф, срок, доп. модули со сроками, итоговый набор).
API: `GET/POST /admin/plans`, `PUT/DELETE /admin/plans/:id`, `GET/PUT /admin/tenants/:id/license`. Realtime: событие `license.changed` сбрасывает кэш интерфейса арендатора.

## Что ещё впереди (задачи 1206–1209)
Режим «только чтение» после срока и баннер, пробный период при создании арендатора (`trial_days`), проверка лимитов, страница «Нужно больше?» и заявки, журнал изменений.
Сейчас срок — жёсткая граница: по истечении модуль выключается сразу.

Тесты: `apps/api/test/licensing.test.ts` (покрытие каталога; прямой вызов API выключенного модуля → 403; доп. модуль, зависимости, срок; событие realtime; воркер; flow; доступ оператора и
изоляция таблиц), `apps/web/src/app/licensing/modules.test.ts`.
