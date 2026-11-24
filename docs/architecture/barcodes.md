# Внутренние штрихкоды EAN-13, этикетки и ценники

Реализовано в рамках задачи #1391. Код: `packages/shared/src/barcode.ts`, `packages/shared/src/print/labels.ts`, `packages/db/src/barcodes.ts`, `apps/api/src/routes/catalog.ts` (`barcodeRoutes`), `apps/web/src/app/catalog/LabelDialog.tsx`.

## Генерация внутренних штрихкодов

- Используется внутренний префикс GS1 **200–299** (12 цифр `200_000_000_000 + random(0..99_999_999_999)` + контрольная цифра EAN-13, рассчитанная по `ean13CheckDigit`).
- Уникальность в рамках воркспейса обеспечивается `generateProductBarcodes` (`packages/db/src/barcodes.ts`):
  - внутри транзакции запроса берётся `pg_advisory_xact_lock(hashtextextended(workspaceId, 1391))` для сериализации конкурентных генераций;
  - целевые строки `products` блокируются через `FOR UPDATE`;
  - существующие непустые штрихкоды воркспейса загружаются в `Set`, и `allocateEan13` подбирает свободный код (товары, у которых штрихкод уже задан, не перезаписываются);
  - для каждого обновлённого товара пишется событие outbox `product.updated` с `changes: ['barcode']`.
- Эндпоинт: `POST /products/generate-barcodes` (`requireRole('member')`, тело `{ ids: uuid[] }` от 1 до 1000 уникальных id). Смонтирован в `apps/api/src/app.ts` перед `productRoutes`, чтобы путь не перехватывался `/:id`.

## Печать этикеток и ценников

- `ean13Svg(code)` (`packages/shared/src/print/labels.ts`) строит векторный штрихкод EAN-13 в SVG (таблицы L/G/R и паритет первой цифры, 95 модулей + подпись).
- `renderLabels(items, format)` формирует автономный HTML-документ с `@page` под форматы:
  - `58x40` (`58mm 40mm`) и `43x25` (`43mm 25mm`) — термоэтикетки;
  - `a6` (`105mm 148mm`) — крупный ценник;
  - `a4` (`A4`, карточки `70mm × 42mm` в `flex-wrap` сетке) — лист ценников.
- Все текстовые поля (`name`, `sku`, `price`) экранируются; количество копий ограничивается диапазоном `0..1000`.
- В веб-клиенте `LabelDialog` открывается из `CatalogPage` (для выбранных строк) и из `DocumentPage` (для документов типа `receipt`). Цены подтягиваются по выбранному виду цен через `POST /pricing/resolve`; HTML предпросмотра оборачивается в `withPrintCsp` и выводится в `<iframe>`, печать/PDF выполняется через `iframe.contentWindow.print()`.
