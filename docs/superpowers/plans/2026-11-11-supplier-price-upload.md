# Загрузка прайсов поставщиков — план

**Проект:** `docs/superpowers/specs/2026-11-11-supplier-price-upload-design.md`. Порядок слоёв: `db` → `shared` → `api` → `web`.
Размеры: S — до полудня, M — до 1,5 дней, L — больше. Каждый этап — отдельный коммит со своими тестами.
Тесты с БД — только на тестовой базе (`TEST_ADMIN_DATABASE_URL=…/gr8r_prices_test`, кластер `scripts/pgtest.sh`).

## Решения

- Новые таблицы — `supplier_price_profiles`, `supplier_prices`, `supplier_price_lines` (`packages/db/src/schema/supplier-prices.ts`), миграция `0117_supplier_prices` (0116 занята сметами). Миграция написана вручную: снимки drizzle последний раз обновлялись на 0088, `drizzle-kit generate` сгенерировал бы лишний дифф — см. заметку в `CLAUDE.md`.
- Файл читает API (`readTable`), сервис получает уже прочитанные строки (`string[][]`) — БД-пакет не зависит от разбора XLSX.
- Сопоставление — только по `product_partner_articles` контрагента. Уникальность там `(company, product)`: у товара один артикул у поставщика.
- Запись цен — общая функция `recordPriceKindPrice` в `packages/db/src/pricing.ts`; `recordProductPrice` (retail/purchase) вызывает её же. Приведение НДС — чистая функция в `packages/shared/src/pricing.ts`.
- Вложение файла — `entity_type = 'supplier_price'` (реестр `ATTACHMENT_ENTITY_TYPES` и `RESOLVERS`, права admin+).

## Этапы

1. **Схема и миграция (S).** Таблицы, составные FK, RLS, индексы, план. Файлы: `schema/supplier-prices.ts`, `drizzle/0117_*.sql`, `_journal.json`, этот план, `CLAUDE.md`.
2. **Сервис: профили и загрузка (M).** `packages/db/src/supplier-prices.ts`: профили, `uploadSupplierPrice` (разбор по профилю, сопоставление по артикулу, вид цен поставщика, вложение, события). Тесты `packages/db/test/supplier-prices.test.ts`.
3. **Разбор строк (M).** Привязка товара (с артикулом), пропуск/снятие пропуска, «Найти по названиям», «Создать товар». Только `draft`.
4. **Применение (M).** `previewApply` («было → стало»), `applySupplierPrice`; `vatConvert` в `packages/shared`; `recordPriceKindPrice` — общая функция (вызывающие `recordProductPrice`: `apps/api/src/routes/catalog.ts`; поведение не меняется).
5. **API-маршруты (M).** `/pricing/supplier-profiles*`, `/pricing/supplier-prices*`, zod-схемы в `packages/shared/src/schemas/pricing.ts`, события outbox, права admin+.
6. **Экран «Прайсы» в карточке поставщика (L).** Список прайсов, загрузка, профили формата (сетка настройки колонок).
7. **Экран разбора и применения (L).** Фильтр строк, выбор кандидатов, «Найти по названиям», «Создать товар», «Применить» со сводкой.
8. **Карточка товара: цены поставщиков (S).** `GET /pricing/products/:id/suppliers`, колонка «Цена» в `partner-codes.tsx`.
9. **Документация (S).** `docs/architecture/pricing.md`, статья `docs/user/trade/purchases.md`, `docs:verify`, changelog.

## Фактическая реализация

Этапы 1–4: см. раздел ниже (заполняется по мере выполнения).
