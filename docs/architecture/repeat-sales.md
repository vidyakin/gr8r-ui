# Повторные продажи и план продаж

Задача 1133. Код: схема `packages/db/src/schema/crm.ts`, `catalog.ts` и `sales-plan.ts` (миграция `0036_repeat_sales.sql`), правила без БД — `packages/shared/src/sales-plan.ts`
(`nextContactAfterSale`, `planDocPeriods`, `buildPlanFact`), сервисы — `packages/db/src/repeat-sales.ts` (контакты) и `sales-plan.ts` (планирование), задача воркера — `apps/worker/src/next-contacts.ts`,
API — `apps/api/src/routes/sales-plan.ts` (`/sales-plan`), экраны — `apps/web/src/app/crm/SalesPlanPage.tsx` и `SalesPlanDocumentPage.tsx` (`/crm/sales-plan`), карточка компании — `crm/NextContactPanel.tsx`.
Тесты — `apps/api/test/repeat-sales.test.ts`.

- **Данные.** `companies.next_contact_date` (дата) и `next_contact_note`; `products.repeat_sale_days` (1–3650, пусто — нет; у товара, услуги и работы);
  `sales_plan_scenarios (name, periodicity month|quarter|year, dimension manager|category|product)`; `sales_plan_docs (document_id, scenario_id, period_start)` — шапка документа;
  `sales_plan_lines (document_id, period_start, member_id | category_id | product_id, amount, qty)` — строки; `sales_plan_figures` — регистр плановых показателей
  (те же поля + сценарий, склад и организация плана);
  `crm_next_contact_runs (company_id, contact_date)` — журнал напоминаний, ключ обеспечивает идемпотентность.
- **Установка даты** (`applySaleNextContact`, вызывается из `postDocument` после `afterPost`) для `realization`, `act` и `work_order` (заказ-наряд проводится входом в категорию `done`):
  дата документа + наименьший срок из товаров строк; если у компании уже стоит дата не позже — она не меняется, более поздняя заменяется. Отмена проведения дату не трогает.
  Пишется событие `company.updated` (`via: repeat_sale`), поле видно условиям автоматизаций (`BUILTIN_FIELDS.company.nextContactDate`).
- **Напоминание** (`runNextContacts`, воркер `runNextContactsOnce` — раз в час вместе с биллингом, «сегодня» по `workspaces.timezone`). Компаниям с датой не позже сегодняшней:
  запись в журнале (`ON CONFLICT DO NOTHING` — выигрывает один проход), дело `crm_activities` типа `task` «Позвонить клиенту: …» со сроком сегодня и заметкой, автор — ответственный компании
  (без него — первый активный владелец воркспейса), уведомление ему, затем дата и заметка очищаются. Просроченная дата обрабатывается тем же проходом.
- **Сценарии планирования** — справочник (`/sales-plan/scenarios`, правят admin/owner, читают все): периодичность и разрез. У сценария, по которому есть планы, периодичность и разрез менять нельзя
  (`409 scenario_in_use`). Имя уникально среди неархивных.
- **Документ «План продаж»** (`documents.type = 'sales_plan'`, группа продаж, префикс `ПП`, свои строки; общие журналы и меню «Создать» его не показывают — `DOCUMENT_META.section`).
  Сценарий + начало плана (приводится к началу периода сценария) задают периоды: год от начала (12 месяцев / 4 квартала / 1 год). Организация обязательна (по умолчанию), склад — необязателен.
  Строка — период × значение разреза: менеджер (участник), категория или товар (у товара ещё количество); пустое значение — «без менеджера/категории». Проверки: период из периодов плана
  (`invalid_period`), значение только своего разреза (`invalid_dimension`), пара период+значение один раз (`duplicate_line`), суммы не отрицательны. Сумма — без НДС.
  Проведение пишет регистр `sales_plan_figures` (с организацией и складом документа), отмена проведения стирает его; проведённый план не правится. Правят admin/owner, видят все.
  API: `GET/POST /sales-plan/plans`, `GET/PATCH/DELETE /sales-plan/plans/:id`, `POST …/post`, `POST …/unpost`. Смена сценария или начала требует прислать строки заново (`lines_required`).
- **План-фактный анализ** (`salesPlanAnalysis`, `GET /sales-plan/analysis?scenarioId&from&to[&warehouseId&organizationId]`, читает любой участник). Период выравнивается по периодам сценария.
  План — регистр проведённых планов (при фильтре склада/организации берутся показатели с этим складом/организацией и без склада). Факт — выручка без НДС (и количество) проведённых реализаций и актов
  по дате документа, выполненных заказ-нарядов по дню выполнения, минус возвраты покупателей; расчёт общий с отчётом услуг «Клиенты» (`postedSalesDocs`, `workOrdersFactDocs` в `service-reports.ts`).
  Разрез «менеджер» — ответственный документа (`documents.responsible_id`), иначе ответственный компании (`companies.owner_id`); «категория» и «товар» — по строкам документов. Прогноз (только «менеджер») —
  сделки (кроме проигранных и архивных) с датой закрытия в периоде, менеджер — ответственный сделки: выигранные, открытые и взвешенный по вероятности этапа (`DEAL_STAGE_PROBABILITY`, веса как в CRM).
  Ячейка: план, факт (и количества), % выполнения, отклонение, прогноз.
- **Интерфейс.** `/crm/sales-plan`: вкладки «Планы» (журнал), «План-факт» (отборы, график, таблица с группировкой по значению разреза, CSV — каркас отчётов производства) и «Сценарии»;
  документ — `/crm/sales-plan/:id`.
