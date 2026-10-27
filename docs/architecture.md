# Архитектура платформы gr8r

Документ фиксирует решения для перехода от фронтенд-шаблона к многоарендной платформе (задачи, CRM,
каталог, документы продаж и закупок, склад, автоматизации, конструктор сущностей). Любой новый код
следует этим решениям; меняя решение — обнови нужный раздел в том же коммите.

Разделы лежат отдельными файлами в `docs/architecture/` — читай только нужный. Устройство кода пакетов — в
`AGENTS.md` в корне каждого пакета (`apps/*`, `packages/*`).

## Основа

- [Стек и монорепозиторий](architecture/stack.md)
- [Арендаторы и доступ](architecture/tenancy.md) — RLS, роли, авторизация
- [Общие соглашения по данным](architecture/data-conventions.md) — id, деньги, мягкое удаление, аудит
- [Конструктор сущностей](architecture/metadata.md) — метаданные + JSONB
- [Фронтенд на сервере](architecture/frontend-server.md) — TanStack Query, realtime
- [Вторая левая панель](architecture/second-sidebar.md)
- [Языки интерфейса](architecture/i18n.md)
- [Этапы](architecture/stages.md) — что сделано и следующие шаги

## Задачи и автоматизации

- [Модули задач](architecture/task-modules.md)
- [Учёт времени и нормы работ](architecture/time-tracking.md)
- [Автоматизации](architecture/automations.md)

## Каталог, документы, склад

- [Каталог: товары и услуги](architecture/catalog.md)
- [Контрагенты и организации (Россия)](architecture/counterparties.md)
- [Документы продаж и закупок](architecture/documents.md)
- [Внутренние складские документы](architecture/internal-documents.md)
- [Склад](architecture/stock.md)
- [Договоры, тарифные планы и биллинг](architecture/billing.md)
- [Закрытие месяца](architecture/month-closing.md)

## Производство

- [Спецификации и себестоимость](architecture/production.md)
- [Параметрические спецификации, варианты и калькуляция заказа](architecture/production-parametric.md)
- [Заказы на производство и выпуск](architecture/production-orders.md)
- [Обеспечение материалов заказа на производство](architecture/production-materials.md)
- [Рабочее место «Выпуск продукции»](architecture/production-workplace.md)
- [Виды производства и этапы](architecture/production-stages.md)
- [Переработка](architecture/production-processing.md)
- [Разборка](architecture/production-disassembly.md)
- [Возвратные отходы и брак](architecture/production-waste.md)
- [Распределение материалов по итогам смены](architecture/production-shift-allocation.md)
- [Операции, исполнители и сдельный наряд](architecture/piecework.md)
- [Планирование загрузки ресурсов](architecture/resource-planning.md)
- [План производства и пополнение](architecture/replenishment.md)
- [Отчёты производства](architecture/production-reports.md)

## Услуги

- [Заказ-наряд: работы, материалы и состояния](architecture/work-orders.md)
- [Планирование услуг по часам](architecture/service-planning.md)
- [Контроль и отчёты услуг](architecture/service-reports.md)
- [Серийные номера, ремонт и гарантия](architecture/serials-repair.md)
- [Повторные продажи и план продаж](architecture/repeat-sales.md)
- [Запись клиентов на приём](architecture/appointments.md)

## Финансы

- [Инвестпроекты и окупаемость](architecture/investments.md)
