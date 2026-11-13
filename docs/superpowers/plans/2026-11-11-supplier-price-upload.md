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

### Этапы 1–4 (готово)

- **Схема.** Миграция 0117 вручную + журнал (снимков после 0088 нет). Колонка `note` в строках — причина пропуска (`price_invalid`, `manual`, `vat_rate_none`). Дополнительно к спеке: `supplier_price_profiles.archived_at` (удаление профиля — архив, на него ссылаются прайсы), `name_col`/`unit_col` необязательны.
- **Сервис** `packages/db/src/supplier-prices.ts`: `saveSupplierProfile` / `archiveSupplierProfile` / `listSupplierProfiles`; `uploadSupplierPrice` (получает таблицу `rows` из `readTable`, шапка включена; номера строк 1-based как в файле); `ensureSupplierPriceKind`; `updateSupplierPriceLine`, `matchSupplierLinesByName`, `createProductsForSupplierLines`; `previewSupplierPriceApply`, `applySupplierPrice`. Права admin+ проверяет маршрут (этап 5); файл-вложение `supplier_price` доступно только admin+ (резолвер в `attachments.ts`).
- **Общая функция.** `recordPriceKindPrice(db, ws, kindId, productId, price, date)` вынесена из `recordProductPrice`, её вызывают карточка товара (retail/purchase) и применение прайса. Поведение карточки не менялось (тесты каталога и цен зелёные).
- **НДС.** `convertPriceVatBase` в `packages/shared/src/pricing.ts` (decimal, одно округление до копейки), юнит-тесты в `packages/shared/test/pricing.test.ts`.
- **Решения по открытым вопросам спеки (раздел 7):** (1) повтор той же даты заменяет записи вида/товара/даты с `document_id IS NULL`, остальные остаются; (2) ставка `none` при разных базах — строка не пишется, помечается `skipped` с `note = vat_rate_none`, предупреждение возвращается в `skipped` результата и в сводке (`warning`); при совпадении баз `none` не мешает; (3) без колонки единицы (`unit_col`) `unit_code` пуст, при создании товара берётся «шт» (`796`); непонятная единица из файла тоже даёт `796`.
- **Прочие решения.** Вид цен поставщика создаётся с `includes_vat` по умолчанию (true), а не по флагу первой загрузки. Артикул у товара один на контрагента (уникальность в `product_partner_articles`): привязка заменяет прежний. «Найти по названиям» и «Создать товар» — только для `unmatched` с наименованием; при неоднозначности статус остаётся `unmatched`, кандидаты в `candidates`. Если товар встречается в прайсе дважды, действует последняя строка. Дата действия при применении может быть переопределена (`opts.date`).
- **Коды ошибок** (en/ru в `errors.ts`): `supplier_profile_exists`, `supplier_profile_invalid`, `supplier_price_date_invalid`, `supplier_price_empty`, `supplier_price_applied`, `supplier_line_price_invalid`.
- **Тесты:** `apps/api/test/supplier-prices.test.ts` (сервис через `withContext`, MemoryFileStore).
- **Не сделано (этапы 5–9):** маршруты, экраны, `GET /pricing/products/:id/suppliers`, `deleteSupplierPrice`, документация. Применение пишет цены построчно (`recordPriceKindPrice` — 2 запроса на товар): для прайсов в десятки тысяч строк при необходимости заменить пакетной вставкой.
