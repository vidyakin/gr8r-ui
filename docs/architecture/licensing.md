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

## Хранение (миграции `0057_licensing`, `0058`–`0061`)
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
Настройки → Оператор → «Тарифы и модули» (CRUD тарифов, лимиты), «Заявки на модули» и кнопка «Лицензия» у арендатора (тариф, срок, пробный период, лимиты и их использование, доп. модули со сроками, итоговый набор, журнал).
API: `GET/POST /admin/plans`, `PUT/DELETE /admin/plans/:id`, `GET/PUT /admin/tenants/:id/license`. Realtime: событие `license.changed` сбрасывает кэш интерфейса арендатора.

## Сроки, «только чтение», пробный период (задача 1206)
Состояние каждого модуля — `moduleStates(license, now)` в `@gr8r/shared`: `active` (действует), `readonly` (срок кончился не более `READONLY_DAYS` = 14 дней назад), `off`. Источники — тариф (`planExpiresAt`) и
каждый доп. модуль (`expiresAt`); модуль действует, пока действует любой источник, который его включает (в том числе как зависимость). Ядро не истекает.
| Функция | Смысл | Кто использует |
|---|---|---|
| `enabledModules` | можно писать (только `active`) | воркер, расписания, автоматизации, вебхуки лидов и ЮКассы |
| `readableModules` | можно читать (`active` + `readonly`) | API, `GET /license.modules` (меню), `/hooks/prices` |

API: `requireModule` — `off` → 403 `module_disabled`; `readonly` и метод не GET/HEAD/OPTIONS → 403 `module_expired` (`details.readonlyUntil`). Воркер: задачи только чтения (`READONLY_SAFE_JOBS`: `document.pdf`,
`settlement.act_pdf`, `billing.export_zip`) идут и в режиме «только чтение». `GET /license` отдаёт `states`, `isTrial`; баннер — `licenseNotices` (за `EXPIRY_NOTICE_DAYS` = 7 дней и в режиме «только чтение»), показывает `LicenseBanner`
владельцу и админу.
Пробный период: `workspace_licenses.is_trial`. `createTenant` (CLI `--plan`, `POST /admin/tenants {planId}`) вызывает `app_license_start`: тариф с `trial_days` → срок `now()+trial_days` и признак; без `trial_days` и без явного тарифа
строки лицензии нет. Самостоятельная регистрация пробного периода не получает.

## Лимиты (задача 1207)
Ключи (`LIMIT_KEYS`): `members` (участники без отключённых + неотвеченные приглашения), `organizations`, `warehouses` (не в архиве), `storageMb` (МБ: `files.size_bytes` + PDF `document_files` + архивы `document_exports`).
Нет ключа — без ограничения, `0` — добавлять нельзя. Итог = лимиты тарифа, поверх них персональные арендатора (`app_license_of`: `limits`, `planLimits`, `ownLimits`). Использование — `app_usage_of(ws)`/`app_workspace_usage()`.
`assertLimit(db, key, add)` (`packages/db/src/licensing.ts`) → 403 `limit_exceeded` `{limit, max, used}` при создании приглашения, организации, склада, файла; существующее не трогается. Файлы в S3 ещё не используются,
PDF воркера лимит не блокирует. Новое место создания сущности с лимитом должно вызвать `assertLimit`.

## «Нужно больше?» и заявки (задача 1208)
Раздел `upgrade` (`/upgrade`, кнопка внизу меню): все модули с описанием и возможностями (`licensing.modules.*`, `licensing.features.*`), состояние (подключён / пробный до / только чтение до / не подключён), заявка
(модули, контакт, комментарий). Таблица `module_requests` — арендаторская (RLS), арендатор создаёт (owner/admin) и читает свои через `/license/requests`, менять не может; оператор — `/admin/requests` (список, статус
`new|in_progress|done|rejected`, заметка; функции `app_operator_requests`, `app_operator_set_request`), экран «Настройки → Оператор → Заявки на модули». Вебхук: задача `module_request.notify` (ядро) отправляет заявку лидом на
`OPERATOR_LEAD_HOOK_URL` (воркер; пусто — ничего не делает; не 2xx — повтор), `hook_sent_at` отмечает отправку (`deploy.md`).

## Журнал изменений (задача 1209)
`license_log`: кто (email оператора на момент изменения; пусто — система), когда, что (`plan`, `plan_expires`, `trial`, `trial_started`, `limit`, `grant_added|removed|expires`, `plan_edit` — правка самого тарифа у каждого
арендатора на нём), старое → новое. Пишут функции `app_operator_set_license`, `app_operator_save_plan`, `app_license_start` (поэтому CLI и API ведут журнал одинаково); читает оператор `GET /admin/tenants/:id/license-log`
(диалог «Лицензия»). RLS — политика `USING (false)`, таблица исключена из выгрузки арендатора.

## Запросы данных чужого модуля на экране
Экран одного модуля не должен запрашивать данные другого, если тот выключен (иначе 403 `module_disabled` в сети). Хук данных такого модуля закрывается `enabled: useModuleReady(module)` (`app/licensing/data.ts`):
`useContracts`, `useDocumentStates`, `useWorkOrderKinds`, `useWorkNorms` (услуги), `useSnapshot`, `useWorkCenters` (производство).

Тесты: `apps/api/test/licensing.test.ts` (покрытие каталога; прямой вызов API выключенного модуля → 403; доп. модуль, зависимости, срок; событие realtime; воркер; flow; доступ оператора и
изоляция таблиц), `apps/web/src/app/licensing/modules.test.ts`.
