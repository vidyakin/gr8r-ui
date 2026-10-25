# Планирование загрузки ресурсов

Реализовано на этапе 4г (сессия «УНФ: Производство»). Код: схема — `packages/db/src/schema/calendars.ts` и `schema/planning.ts`
(миграция `0015_planning.sql`), расчёт — `packages/shared/src/planning.ts`, сервис — `packages/db/src/planning.ts`,
API — `apps/api/src/routes/planning.ts`, клиент — `apps/web/src/app/production/PlannerPage.tsx` и `ResourcesPage.tsx`,
общая сетка времени — `apps/web/src/app/components/time-grid.tsx`.

- **Ресурсы трёх видов:** сотрудники (`members`), участки (`work_centers`) и **оборудование** — справочник ключевых
  ресурсов `resources (workspace_id, name, kind: equipment|other, work_center_id?, capacity_units, calendar_id?)`.
  Мощность участка — `work_centers.capacity_hours_per_day` (пусто — по графику), у ресурса мощность в день =
  `capacity_units × часов графика`.
- **Потребность в ресурсах — в нормативе и в документе.** Норматив: `product_resources (product_id, resource_id,
  hours_per_unit)` — у операции (вид номенклатуры `operation`) или работы; в документе — закладка «Ресурсы»:
  `document_resources (document_id, line_id?, resource_id, start_at, end_at, hours)` (заказ на производство и заказ-наряд).
- **Сменные графики.** `work_calendars (workspace_id, name, kind: weekly|cycle, pattern jsonb, cycle_start, hours_per_day,
  is_default)`: недельный (рабочие дни недели и часы) или циклический (2/2, сутки через трое) с датой начала цикла.
  График назначается участнику (`members.calendar_id`), участку (`work_centers.calendar_id`) и ресурсу
  (`resources.calendar_id`); без назначения — график воркспейса по умолчанию (`is_default`, он один), а если его нет —
  пятидневка 8 часов. **Праздники воркспейса** — `workspace_holidays (workspace_id, date, name)`; **исключения**
  (отпуск, больничный, ремонт) — `calendar_exceptions (scope: member|work_center|resource, scope_id, date_from, date_to)`:
  они снимают рабочий день у конкретного сотрудника, участка или ресурса.
- **Расчёт загрузки** — чистая функция `computeLoad` в `packages/shared/src/planning.ts`: часы записей распределяются
  по дням интервала, мощность дня берётся из графика (в выходной — ноль). **Перегрузка — предупреждение, не запрет:**
  день помечается `overloaded`, но план сохраняется. Записи: операции производства (`production_operations` с
  плановыми датами), назначения заказ-наряда (даты задачи) и работы ресурсов (`document_resources`).
- **Автопланирование** — `autoSchedule` (shared) и `POST /production-orders/:id/schedule`: операции расставляются
  **от даты старта заказа по порядку этапов** в пределах свободной мощности сотрудника, участка и ресурсов
  (по их графикам и исключениям), прогнозный финиш возвращается ответом и попадает в плановый финиш заказа.
  **Ручные даты не двигаются:** у назначения есть `production_operations.auto_planned` — даты, проставленные
  автопланированием, можно переставить, а ручные (проставленные пользователем) автопланирование оставляет на месте.
- **Общая сетка времени.** `components/time-grid.tsx` — левая панель со строками и правая с колонками дней, полосами
  и подсветкой выходных. Её используют диаграмма Ганта задач (`components/timeline-view.tsx`) и планировщик загрузки:
  перетаскивание полосы в планировщике меняет даты операции (`PATCH /production/operations/:id/move`) или назначения
  заказ-наряда (`PATCH /work-order-assignments/:taskId`) и приходит другим вкладкам по realtime.
- **API:** `/production/calendars`, `/production/holidays`, `/production/calendar-exceptions`, `/production/resources`,
  `/production/product-resources`, `/production/document-resources`, `/production/load?from=&to=&rowType=`,
  `POST /production-orders/:id/schedule`, `PATCH /production/operations/:id/move`. Справочники меняет admin и выше,
  план — member и выше.
- **Интерфейс:** `/production/planner` — строки (сотрудники, участки или ресурсы), полосы — операции и назначения,
  масштаб день/неделя/месяц, перетаскивание меняет даты, перегруженные строки помечаются; `/production/resources` —
  справочник ресурсов, сменные графики, праздники и исключения. В карточке заказа на производство — кнопка **Schedule**
  и раздел **Resources**; в карточке заказ-наряда — раздел **Resources**.
